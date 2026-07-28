import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { restrictDirectory, restrictFile } from "./file-permissions.mjs";

let directory;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("desktop private file permissions", () => {
  test("restricts directories and files on POSIX hosts", async () => {
    directory = await mkdtemp(join(tmpdir(), "edgeever-permissions-"));
    const nested = join(directory, "private");
    const file = join(nested, "payload.bin");
    await mkdir(nested);
    await writeFile(file, "secret");
    await restrictDirectory(nested);
    await restrictFile(file);

    if (process.platform !== "win32") {
      const directoryMode = (await stat(nested)).mode & 0o777;
      const fileMode = (await stat(file)).mode & 0o777;
      expect(directoryMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
    }
    expect(await readFile(file, "utf8")).toBe("secret");
  });
});
