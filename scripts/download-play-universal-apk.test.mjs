import { describe, expect, test } from "bun:test";
import {
  assertDownloadedApk,
  normalizePlayCertificateHash,
  selectPlayUniversalApk,
  summarizePlayGeneratedApks,
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

  test("refuses an installer-locked universal APK when automatic protection is enabled", () => {
    const signer = "ab".repeat(32);
    expect(() => selectPlayUniversalApk({
      generatedApks: [{
        certificateSha256Hash: signer,
        generatedUniversalApk: { downloadId: "protected-universal" },
        unprotectedGeneratedSplitApks: [],
      }],
    }, signer)).toThrow("Automatic Protection is enabled");
  });

  test("reports protected and unprotected generated APK variants", () => {
    const signer = "ab".repeat(32);
    expect(summarizePlayGeneratedApks({
      generatedApks: [{
        certificateSha256Hash: signer,
        generatedSplitApks: [{ downloadId: "protected-split" }],
        generatedStandaloneApks: [{ downloadId: "protected-standalone", variantId: 1 }],
        generatedUniversalApk: { downloadId: "protected-universal" },
        unprotectedGeneratedSplitApks: [{ downloadId: "plain-split" }],
        unprotectedGeneratedStandaloneApks: [{ downloadId: "plain-standalone", variantId: 2 }],
      }],
    }, signer)).toEqual({
      protectedSplitCount: 1,
      protectedStandaloneVariants: [1],
      protectedUniversal: true,
      unprotectedSplitCount: 1,
      unprotectedStandaloneVariants: [2],
    });
  });

  test("rejects empty or non-APK download responses", () => {
    expect(() => assertDownloadedApk(Buffer.alloc(0))).toThrow("empty or not a ZIP archive");
    expect(() => assertDownloadedApk(Buffer.from("not an apk"))).toThrow("empty or not a ZIP archive");
    const apk = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(assertDownloadedApk(apk)).toBe(apk);
  });
});
