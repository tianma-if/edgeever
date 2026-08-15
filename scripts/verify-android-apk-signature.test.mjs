import { describe, expect, test } from "bun:test";
import {
  EDGE_EVER_ANDROID_SIGNER_SHA256,
  parseAllowedAndroidSignerDigests,
  verifyAndroidSignerOutput,
} from "./verify-android-apk-signature.mjs";

describe("Android APK signer verification", () => {
  test("accepts the single pinned EdgeEver signer", () => {
    expect(
      verifyAndroidSignerOutput(
        `Signer #1 certificate SHA-256 digest: ${EDGE_EVER_ANDROID_SIGNER_SHA256}`,
      ),
    ).toBe(EDGE_EVER_ANDROID_SIGNER_SHA256);
  });

  test("normalizes colon-separated uppercase fingerprints", () => {
    const fingerprint = EDGE_EVER_ANDROID_SIGNER_SHA256.toUpperCase()
      .match(/.{2}/g)
      .join(":");
    expect(
      verifyAndroidSignerOutput(
        `Signer #1 certificate SHA-256 digest: ${fingerprint}`,
      ),
    ).toBe(EDGE_EVER_ANDROID_SIGNER_SHA256);
  });

  test("accepts fingerprints wrapped and spaced by newer build tools", () => {
    const fingerprint = EDGE_EVER_ANDROID_SIGNER_SHA256.toUpperCase()
      .match(/.{2}/g)
      .join(" ");
    expect(
      verifyAndroidSignerOutput(
        `Signer #1 certificate SHA-256 digest: [${fingerprint}]`,
      ),
    ).toBe(EDGE_EVER_ANDROID_SIGNER_SHA256);
  });

  test("accepts scheme-prefixed signer output from Linux build tools", () => {
    expect(
      verifyAndroidSignerOutput(
        [
          "Number of signers: 1",
          `V2 Signer: certificate SHA-256 digest: ${EDGE_EVER_ANDROID_SIGNER_SHA256}`,
        ].join("\n"),
      ),
    ).toBe(EDGE_EVER_ANDROID_SIGNER_SHA256);
  });

  test("rejects an APK signed by a different certificate", () => {
    expect(() =>
      verifyAndroidSignerOutput(
        `Signer #1 certificate SHA-256 digest: ${"0".repeat(64)}`,
      ),
    ).toThrow("Android signer mismatch");
  });

  test("accepts an explicitly configured Play app signer", () => {
    const playSigner = "a".repeat(64);
    expect(
      verifyAndroidSignerOutput(
        `Signer #1 certificate SHA-256 digest: ${playSigner}`,
        parseAllowedAndroidSignerDigests(`${EDGE_EVER_ANDROID_SIGNER_SHA256},${playSigner}`),
      ),
    ).toBe(playSigner);
  });

  test("rejects malformed configured signer fingerprints", () => {
    expect(() => parseAllowedAndroidSignerDigests("not-a-fingerprint")).toThrow(
      "SHA-256 fingerprint",
    );
  });

  test("rejects missing or multiple signers", () => {
    expect(() => verifyAndroidSignerOutput("Verified")).toThrow(
      "Expected exactly one Android signer",
    );
    expect(() =>
      verifyAndroidSignerOutput(
        [
          `Signer #1 certificate SHA-256 digest: ${EDGE_EVER_ANDROID_SIGNER_SHA256}`,
          `Signer #2 certificate SHA-256 digest: ${EDGE_EVER_ANDROID_SIGNER_SHA256}`,
        ].join("\n"),
      ),
    ).toThrow("Expected exactly one Android signer");
  });
});
