import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EDGE_EVER_ANDROID_SIGNER_SHA256 =
  "22bf52a9501c89020f5acc966960152c826bfa64f31e578e858d088f8cd75d87";

const normalizeFingerprint = (value) =>
  value.toLowerCase().replace(/[^0-9a-f]/g, "");

export const parseAllowedAndroidSignerDigests = (value = "") => {
  const configured = value.split(",").map(normalizeFingerprint).filter(Boolean);
  const digests = configured.length > 0
    ? configured
    : [EDGE_EVER_ANDROID_SIGNER_SHA256];
  if (digests.some((digest) => digest.length !== 64)) {
    throw new Error("Every allowed Android signer must be a SHA-256 fingerprint.");
  }
  return [...new Set(digests)];
};

export const verifyAndroidSignerOutput = (
  output,
  allowedSignerDigests = parseAllowedAndroidSignerDigests(),
) => {
  const digestMatches = [
    ...output.matchAll(
      /^(?:Signer #\d+|V\d+(?:\.\d+)? Signer:) certificate SHA-256 digest:\s*(.+)$/gim,
    ),
  ];
  const signerDigests = digestMatches
    .map((match) => normalizeFingerprint(match[1]))
    .filter((digest) => digest.length === 64);
  const uniqueSignerDigests = [...new Set(signerDigests)];
  const reportedSignerCount = output.match(
    /^Number of signers:\s*(\d+)$/im,
  )?.[1];
  const signerCount = reportedSignerCount
    ? Number(reportedSignerCount)
    : signerDigests.length;

  if (signerCount !== 1 || uniqueSignerDigests.length !== 1) {
    throw new Error(
      `Expected exactly one Android signer, found ${signerCount}.`,
    );
  }

  if (!allowedSignerDigests.includes(uniqueSignerDigests[0])) {
    throw new Error(
      `Android signer mismatch: expected one of ${allowedSignerDigests.join(", ")}, received ${uniqueSignerDigests[0]}.`,
    );
  }

  return uniqueSignerDigests[0];
};

const findApkSigner = (explicitPath) => {
  if (explicitPath) return explicitPath;

  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (!sdkRoot) {
    throw new Error(
      "ANDROID_SDK_ROOT or ANDROID_HOME is required to locate apksigner.",
    );
  }

  const buildToolsRoot = join(sdkRoot, "build-tools");
  const versions = readdirSync(buildToolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    );

  for (const version of versions) {
    const candidate = join(buildToolsRoot, version, "apksigner");
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(`Could not find apksigner under ${buildToolsRoot}.`);
};

const run = () => {
  const [apkPath, explicitApkSigner] = process.argv.slice(2);
  if (!apkPath) {
    console.error(
      "Usage: node scripts/verify-android-apk-signature.mjs <apk-path> [apksigner-path]",
    );
    process.exit(1);
  }

  const apkSigner = findApkSigner(explicitApkSigner);
  const result = spawnSync(
    apkSigner,
    ["verify", "--verbose", "--print-certs", apkPath],
    {
      encoding: "utf8",
    },
  );
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;

  if (result.status !== 0) {
    process.stderr.write(output);
    throw new Error(`apksigner rejected ${apkPath}.`);
  }

  let signerSha256;
  try {
    signerSha256 = verifyAndroidSignerOutput(
      output,
      parseAllowedAndroidSignerDigests(process.env.EDGE_EVER_ANDROID_ALLOWED_SIGNER_SHA256),
    );
  } catch (error) {
    process.stderr.write(output);
    throw error;
  }
  process.stdout.write(`Android signer SHA-256: ${signerSha256}\n`);
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run();
}
