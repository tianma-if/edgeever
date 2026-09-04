import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Metafile imports reference output keys, not paths relative to each chunk.
// Follow the entire static graph: checking index.js alone misses eager shared chunks.
function reachableOutputs(outputs, start, includeDynamic = false) {
  const visited = new Set();
  const pending = [start];
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    const output = outputs[path];
    if (!output) throw new Error(`Missing build output: ${path}`);
    visited.add(path);
    for (const dependency of output.imports) {
      if (!dependency.external && (includeDynamic || dependency.kind !== "dynamic-import")) {
        pending.push(dependency.path);
      }
    }
  }
  return visited;
}

test("startup graph follows transitive shared chunks and cycles, but not dynamic or external imports", () => {
  const outputs = {
    entry: { imports: [{ path: "shared", kind: "import-statement" }, { path: "lazy", kind: "dynamic-import" }] },
    shared: { imports: [{ path: "runtime", kind: "import-statement" }, { path: "external", kind: "import-statement", external: true }] },
    runtime: { imports: [{ path: "shared", kind: "import-statement" }] },
    lazy: { imports: [] },
  };
  expect([...reachableOutputs(outputs, "entry")].sort()).toEqual(["entry", "runtime", "shared"]);
  expect([...reachableOutputs(outputs, "entry", true)].sort()).toEqual(["entry", "lazy", "runtime", "shared"]);
  expect(() => reachableOutputs(outputs, "missing")).toThrow("Missing build output");
});

test("a lazy facade may share its implementation with another lazy entry without loading it at startup", () => {
  const outputs = {
    entry: { imports: [{ path: "ai", kind: "dynamic-import" }, { path: "agent", kind: "dynamic-import" }] },
    ai: { imports: [{ path: "runtime", kind: "import-statement" }] },
    agent: { imports: [{ path: "runtime", kind: "import-statement" }] },
    runtime: { imports: [] },
  };
  expect([...reachableOutputs(outputs, "entry")]).toEqual(["entry"]);
  expect(reachableOutputs(outputs, "ai").has("runtime")).toBe(true);
  expect(reachableOutputs(outputs, "agent").has("runtime")).toBe(true);
});

test("keeps AI runtimes and SDKs out of the entire Cloudflare Worker startup graph", () => {
  // Keep esbuild's service isolated from Bun's test process, as in the CLI build.
  const directory = mkdtempSync(resolve(tmpdir(), "edgeever-worker-graph-"));
  const metadataPath = resolve(directory, "metadata.json");
  let build;
  try {
    const result = spawnSync("bun", ["--eval", `
      import { writeFileSync } from "node:fs";
      import { buildCloudflareWorker } from ${JSON.stringify(new URL("./build-cloudflare-worker.mjs", import.meta.url).href)};
      const { entry, metafile } = await buildCloudflareWorker();
      writeFileSync(${JSON.stringify(metadataPath)}, JSON.stringify({ entry, metafile: { outputs: metafile.outputs } }));
    `], {
      cwd: resolve(import.meta.dir, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        EDGE_EVER_DEPLOYMENT_TRIGGER: "github_release",
        EDGE_EVER_DEPLOYMENT_METHOD: "github_actions",
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    build = JSON.parse(readFileSync(metadataPath, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const { entry, metafile } = build;
  const startup = reachableOutputs(metafile.outputs, entry.path);
  const all = reachableOutputs(metafile.outputs, entry.path, true);
  const startupSource = [...startup].map(path => readFileSync(resolve(import.meta.dir, "..", path), "utf8")).join("\n");
  expect(startupSource).toContain("github_release");
  expect(startupSource).toContain("github_actions");
  const inputsFor = paths => [...new Set([...paths].flatMap(path =>
    Object.entries(metafile.outputs[path].inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([input]) => input.replaceAll("\\", "/")),
  ))];
  const runtimeSources = ["ai-runtime", "companion-runtime", "companion-discovery-runtime"]
    .map(name => `apps/api/src/${name}.ts`);
  const isAiInput = path => runtimeSources.includes(path)
    || /(?:^|\/)node_modules\/(?:ai|@ai-sdk\/[^/]+)\//.test(path);
  expect(inputsFor(startup).filter(isAiInput)).toEqual([]);
  // Ensure a passing startup check cannot be explained by dropping AI from the build.
  const allInputs = inputsFor(all);
  for (const source of runtimeSources) {
    expect(allInputs).toContain(source);
    const output = Object.entries(metafile.outputs).find(([, metadata]) => metadata.entryPoint === source);
    expect(output).toBeDefined();
    expect(startup.has(output[0])).toBe(false);
    expect(all.has(output[0])).toBe(true);
  }
  for (const sdk of ["ai", "@ai-sdk/anthropic", "@ai-sdk/google", "@ai-sdk/openai-compatible"]) {
    expect(allInputs.some(path => `/${path}`.includes(`/node_modules/${sdk}/`))).toBe(true);
  }
});
