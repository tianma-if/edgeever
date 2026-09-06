import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  WINDOWS_UPDATE_KEY_ID,
  verifyDownloadedWindowsUpdate,
  verifyWindowsUpdateMetadata,
} from "./windows-update-trust.mjs";

const manifest = {
  schemaVersion: 1,
  keyId: WINDOWS_UPDATE_KEY_ID,
  version: "1.49.0",
  platform: "win32",
  arch: "x64",
  releaseDate: "2026-08-30T00:00:00.000Z",
  file: {
    name: "EdgeEver-1.49.0-windows-x64.exe",
    size: 7,
    sha512: "cLM86ckEfjD5F+fqE+Qvd2cAjD9PnJuvSeQ5D8YlVJ6WJe7jm5RUUHTooYJM8/I4RjsRvAPZc0jg/CmZyh//fw==",
    sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
  },
};

const updateInfo = {
  version: manifest.version,
  files: [{
    url: manifest.file.name,
    size: manifest.file.size,
    sha512: manifest.file.sha512,
  }],
};

const signedFixture = () => {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const signature = "Itc3UD0G6Hn6BWdk9qlJ4SoqAUDn8efi1VRVUWDtA3Ip5+gwpAj7HxElxM6D/GXcAlHFxnVv19soEWxlfZLCDA==";
  return {
    manifestBytes: bytes,
    signatureBytes: Buffer.from(`${JSON.stringify({ schemaVersion: 1, keyId: WINDOWS_UPDATE_KEY_ID, signature })}\n`),
  };
};

describe("Windows update trust", () => {
  test("accepts metadata signed by the pinned release key", () => {
    const signed = signedFixture();
    expect(verifyWindowsUpdateMetadata({
      ...signed,
      expectedVersion: manifest.version,
      updateInfo,
    })).toEqual(manifest);
  });

  test("rejects metadata signed by any other key", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    const signature = sign(null, bytes, privateKey).toString("base64");
    expect(() => verifyWindowsUpdateMetadata({
      manifestBytes: bytes,
      signatureBytes: Buffer.from(JSON.stringify({
        schemaVersion: 1,
        keyId: WINDOWS_UPDATE_KEY_ID,
        signature,
      })),
      expectedVersion: manifest.version,
      updateInfo,
    })).toThrow("signature is invalid");
  });

  test("rejects a signed manifest that disagrees with latest.yml", () => {
    const signed = signedFixture();
    expect(() => verifyWindowsUpdateMetadata({
      ...signed,
      expectedVersion: manifest.version,
      updateInfo: {
        ...updateInfo,
        files: [{ ...updateInfo.files[0], size: manifest.file.size + 1 }],
      },
    })).toThrow("does not match the signed manifest");
  });

  test("rejects update metadata that could select an extra installer", () => {
    const signed = signedFixture();
    expect(() => verifyWindowsUpdateMetadata({
      ...signed,
      expectedVersion: manifest.version,
      updateInfo: {
        ...updateInfo,
        files: [
          { url: "unexpected.exe", size: 1, sha512: manifest.file.sha512 },
          ...updateInfo.files,
        ],
      },
    })).toThrow("exactly one trusted installer");
  });

  test("checks the downloaded installer size and both digests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-windows-update-test-"));
    const path = join(directory, manifest.file.name);
    try {
      await writeFile(path, "payload");
      await expect(verifyDownloadedWindowsUpdate({ path, manifest })).resolves.toBe(true);
      await writeFile(path, "tampered");
      await expect(verifyDownloadedWindowsUpdate({ path, manifest })).rejects.toThrow("size does not match");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
