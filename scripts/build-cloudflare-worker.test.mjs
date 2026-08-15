import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

test("keeps the AI provider runtime out of the Cloudflare Worker entrypoint", () => {
  const outputDirectory = resolve(import.meta.dir, "../.wrangler/edgeever-worker");
  rmSync(outputDirectory, { force: true, recursive: true });
  const result = spawnSync("bun", [resolve(import.meta.dir, "build-cloudflare-worker.mjs")], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf8",
  });
  expect(result.status).toBe(0);

  const moduleNames = readdirSync(resolve(outputDirectory, "modules"));
  const aiRuntimeName = moduleNames.find((name) => name.startsWith("ai-runtime-"));
  expect(aiRuntimeName).toBeTruthy();
  expect(readFileSync(resolve(outputDirectory, "index.js"), "utf8"))
    .not.toContain("edgeever-openai-compatible");
  expect(readFileSync(resolve(outputDirectory, "modules", aiRuntimeName), "utf8"))
    .toContain("edgeever-openai-compatible");
});
