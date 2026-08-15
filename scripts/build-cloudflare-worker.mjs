import { rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

export const CLOUDFLARE_WORKER_OUTPUT_DIRECTORY = resolve(".wrangler/edgeever-worker");
const normalizePath = (value) => value.replaceAll("\\", "/");

export const buildCloudflareWorker = async () => {
  const generatedRoot = resolve(".wrangler");
  if (!CLOUDFLARE_WORKER_OUTPUT_DIRECTORY.startsWith(`${generatedRoot}${sep}`)) {
    throw new Error(
      `Refusing to clean unsafe Worker output path: ${CLOUDFLARE_WORKER_OUTPUT_DIRECTORY}`,
    );
  }
  await rm(CLOUDFLARE_WORKER_OUTPUT_DIRECTORY, { recursive: true, force: true });

  const result = await build({
    entryPoints: [resolve("apps/api/src/index.ts")],
    outdir: CLOUDFLARE_WORKER_OUTPUT_DIRECTORY,
    entryNames: "index",
    chunkNames: "modules/[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    minify: true,
    keepNames: true,
    legalComments: "none",
    treeShaking: true,
    metafile: true,
    write: true,
    allowOverwrite: true,
    outExtension: { ".js": ".js" },
  });

  const outputs = await Promise.all(Object.entries(result.metafile.outputs).map(async ([path, metadata]) => ({
    path,
    bytes: (await stat(path)).size,
    entryPoint: metadata.entryPoint,
    imports: metadata.imports,
  })));
  const entry = outputs.find((output) =>
    normalizePath(output.entryPoint ?? "").endsWith("apps/api/src/index.ts"));
  const modules = outputs.filter((output) => normalizePath(output.path).includes("/modules/"));
  const dynamicImportPaths = new Set(
    entry?.imports.filter((item) => item.kind === "dynamic-import").map((item) => item.path) ?? [],
  );
  const lazyModules = modules.filter((module) =>
    Array.from(dynamicImportPaths).some((path) =>
      normalizePath(module.path).endsWith(normalizePath(path))));
  const sharedModules = modules.filter((module) => !lazyModules.includes(module));
  if (!entry || lazyModules.length === 0) {
    throw new Error("Cloudflare Worker build must produce one entrypoint and at least one on-demand module.");
  }

  console.log([
    `[worker-build] entry: ${(entry.bytes / 1024).toFixed(2)} KiB`,
    ...sharedModules.map((module) =>
      `[worker-build] shared module: ${(module.bytes / 1024).toFixed(2)} KiB`),
    ...lazyModules.map((module) =>
      `[worker-build] on-demand module: ${(module.bytes / 1024).toFixed(2)} KiB`),
  ].join("\n"));
  return { entry, sharedModules, lazyModules };
};

if (import.meta.main) {
  await buildCloudflareWorker();
}
