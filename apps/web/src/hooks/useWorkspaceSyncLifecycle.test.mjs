import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("startup refresh is stable across queue changes while scope changes and immediate pushes remain live", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./workspace-sync-lifecycle.fixture.mjs", import.meta.url))], {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)), encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("workspace lifecycle request budget passed");
});
