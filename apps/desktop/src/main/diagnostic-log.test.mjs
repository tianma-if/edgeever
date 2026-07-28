import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateDiagnosticLog } from "./diagnostic-log.mjs";

test("diagnostic logs rotate after reaching the size limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-diagnostic-"));
  const path = join(directory, "desktop.log");
  await writeFile(path, "x".repeat(11));

  expect(await rotateDiagnosticLog(path, 10)).toBe(true);
  expect((await readFile(`${path}.1`, "utf8")).length).toBe(11);
  await expect(stat(path)).rejects.toThrow();
  expect(await rotateDiagnosticLog(path, 10)).toBe(false);
});
