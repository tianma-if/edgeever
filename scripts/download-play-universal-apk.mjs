import { createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_PACKAGE_NAME = "org.edgeever.mobile";
const DEFAULT_POLL_ATTEMPTS = 30;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const LOOKUP_TIMEOUT_MS = 30_000;

export const normalizePlayCertificateHash = (value) => {
  const compact = String(value ?? "").trim();
  const hex = compact.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length === 64 && /^[0-9a-f]{64}$/.test(hex)) {
    return hex;
  }
  try {
    const decoded = Buffer.from(compact.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return decoded.length === 32 ? decoded.toString("hex") : "";
  } catch {
    return "";
  }
};

export const selectPlayUniversalApk = (response, expectedSignerSha256) => {
  const expectedSigner = normalizePlayCertificateHash(expectedSignerSha256);
  if (!expectedSigner) {
    throw new Error("ANDROID_PLAY_APP_SIGNER_SHA256 must be a SHA-256 certificate fingerprint.");
  }
  const candidates = (response?.generatedApks ?? []).filter((candidate) =>
    normalizePlayCertificateHash(candidate.certificateSha256Hash) === expectedSigner &&
    candidate.generatedUniversalApk?.downloadId
  );
  if (candidates.length !== 1) {
    throw new Error(`Expected one Play universal APK for signer ${expectedSigner}, found ${candidates.length}.`);
  }
  return {
    downloadId: candidates[0].generatedUniversalApk.downloadId,
    signerSha256: expectedSigner,
  };
};

export const assertDownloadedApk = (buffer) => {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b
  ) {
    throw new Error("Google Play universal APK download was empty or not a ZIP archive.");
  }
  return buffer;
};

const getServiceAccountCredentials = () => {
  const encoded = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!encoded) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 is required.");
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded JSON.");
  }
};

const requestHeaders = async () => {
  const auth = new GoogleAuth({
    credentials: getServiceAccountCredentials(),
    scopes: [ANDROID_PUBLISHER_SCOPE],
  });
  const client = await auth.getClient();
  return client.getRequestHeaders();
};

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

export const downloadPlayUniversalApk = async ({
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  expectedSignerSha256,
  outputPath,
  packageName = DEFAULT_PACKAGE_NAME,
  pollAttempts = DEFAULT_POLL_ATTEMPTS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  versionCode,
}) => {
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw new Error("versionCode must be a positive integer.");
  }
  const headers = await requestHeaders();
  const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/generatedApks/${versionCode}`;
  let selected = null;
  let lastError = null;
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    const response = await fetch(baseUrl, {
      headers,
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (response.ok) {
      const body = await response.json();
      try {
        selected = selectPlayUniversalApk(body, expectedSignerSha256);
        break;
      } catch (error) {
        lastError = error;
      }
    } else {
      lastError = new Error(`Google Play generated APK lookup failed with HTTP ${response.status}: ${await response.text()}`);
    }
    if (attempt < pollAttempts) {
      await wait(pollIntervalMs);
    }
  }
  if (!selected) {
    throw lastError ?? new Error("Google Play did not produce a universal APK before the timeout.");
  }
  const downloadUrl = `${baseUrl}/downloads/${encodeURIComponent(selected.downloadId)}:download?alt=media`;
  const downloadResponse = await fetch(downloadUrl, {
    headers,
    signal: AbortSignal.timeout(downloadTimeoutMs),
  });
  if (!downloadResponse.ok) {
    throw new Error(`Google Play universal APK download failed with HTTP ${downloadResponse.status}: ${await downloadResponse.text()}`);
  }
  if (!downloadResponse.body) {
    throw new Error("Google Play universal APK download returned no response body.");
  }
  await pipeline(Readable.fromWeb(downloadResponse.body), createWriteStream(outputPath));
  const file = await open(outputPath, "r");
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await file.read(signature, 0, signature.length, 0);
    assertDownloadedApk(signature.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
  return selected;
};

const run = async () => {
  const [versionCodeValue, outputPath] = process.argv.slice(2);
  const versionCode = Number(versionCodeValue);
  if (!versionCodeValue || !outputPath) {
    throw new Error("Usage: node scripts/download-play-universal-apk.mjs <version-code> <output-apk>");
  }
  const selected = await downloadPlayUniversalApk({
    expectedSignerSha256: process.env.ANDROID_PLAY_APP_SIGNER_SHA256,
    outputPath,
    packageName: process.env.ANDROID_PACKAGE_NAME || DEFAULT_PACKAGE_NAME,
    versionCode,
  });
  process.stdout.write(`Downloaded Google Play universal APK signed by ${selected.signerSha256}.\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`[download-play-universal-apk] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
