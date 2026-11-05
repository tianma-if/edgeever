import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSessionCredential, writeSessionCredential } from "./session-credential.mjs";

test("logout removes the saved session even when the keyring cannot encrypt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-session-test-"));
  const path = join(directory, "session-token");
  const baseUrl = "https://example.test";
  try {
    await writeSessionCredential(path, "old-session", baseUrl, {
      encryptString: plaintext => Buffer.from(`sealed:${plaintext}`),
    });
    const saved = await readFile(path, "utf8");
    expect(decodeSessionCredential(saved.slice("sealed:".length), baseUrl).token).toBe("old-session");

    const lockedKeyring = {
      encryptString() { throw new Error("Keyring unavailable"); },
    };
    await writeSessionCredential(path, "", baseUrl, lockedKeyring);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    await writeSessionCredential(path, "", baseUrl, lockedKeyring);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
