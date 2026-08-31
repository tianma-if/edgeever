import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { waitForChildProcessSpawn } from "./child-process-start.mjs";

describe("child process startup", () => {
  test("resolves only after the process is spawned", async () => {
    const child = new EventEmitter();
    const result = waitForChildProcessSpawn(child);
    child.emit("spawn");
    await expect(result).resolves.toBe(child);
  });

  test("rejects a missing runtime or executable", async () => {
    const child = new EventEmitter();
    const result = waitForChildProcessSpawn(child);
    child.emit("error", new Error("VCRUNTIME140.dll was not found"));
    await expect(result).rejects.toThrow("VCRUNTIME140.dll");
  });
});
