import { describe, expect, test } from "bun:test";
import {
  assertDownloadedApk,
  normalizePlayCertificateHash,
  selectPlayUniversalApk,
} from "./download-play-universal-apk.mjs";

describe("Google Play universal APK selection", () => {
  test("normalizes hex and base64 certificate hashes", () => {
    const hash = "ab".repeat(32);
    expect(normalizePlayCertificateHash(hash.toUpperCase().match(/.{2}/g).join(":"))).toBe(hash);
    expect(normalizePlayCertificateHash(Buffer.from(hash, "hex").toString("base64"))).toBe(hash);
  });

  test("selects the universal APK for the pinned Play signer", () => {
    const signer = "ab".repeat(32);
    expect(selectPlayUniversalApk({
      generatedApks: [
        {
          certificateSha256Hash: "cd".repeat(32),
          generatedUniversalApk: { downloadId: "wrong-key" },
        },
        {
          certificateSha256Hash: Buffer.from(signer, "hex").toString("base64"),
          generatedUniversalApk: { downloadId: "universal-42" },
        },
      ],
    }, signer)).toEqual({ downloadId: "universal-42", signerSha256: signer });
  });

  test("fails closed when the expected signer has no universal APK", () => {
    expect(() => selectPlayUniversalApk({ generatedApks: [] }, "ab".repeat(32))).toThrow(
      "Expected one Play universal APK",
    );
  });

  test("rejects empty or non-APK download responses", () => {
    expect(() => assertDownloadedApk(Buffer.alloc(0))).toThrow("empty or not a ZIP archive");
    expect(() => assertDownloadedApk(Buffer.from("not an apk"))).toThrow("empty or not a ZIP archive");
    const apk = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(assertDownloadedApk(apk)).toBe(apk);
  });
});
