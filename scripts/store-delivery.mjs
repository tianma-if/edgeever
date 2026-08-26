import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPOSITORY = "tianma-if/edgeever";
const PLATFORMS = new Set(["android", "ios", "both"]);
const ANDROID_TRACKS = new Set(["internal", "alpha", "beta", "production"]);

const usage = `Usage:
  bun run publish:stores -- --release vX.Y.Z [options]

Options:
  --release <tag>             Required formal GitHub Release tag
  --platform <target>         android, ios, or both (default: both)
  --android-track <track>     production, alpha, beta, or internal (default: production)
  --recover-play-apk          Skip Play upload and recover its already signed APK
  --repository <owner/name>   GitHub repository (default: ${DEFAULT_REPOSITORY})
  --dry-run                   Print the workflow dispatch plan
  --help                      Show this help
`;

export const parseStoreDeliveryArgs = (argv) => {
  const options = {
    releaseTag: "",
    platform: "both",
    androidTrack: "production",
    repository: DEFAULT_REPOSITORY,
    dryRun: false,
    recoverPlayApk: false,
    help: false,
  };
  const valueOptions = new Map([
    ["--release", "releaseTag"],
    ["--platform", "platform"],
    ["--android-track", "androidTrack"],
    ["--repository", "repository"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--recover-play-apk") {
      options.recoverPlayApk = true;
      continue;
    }
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1]?.trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    options[key] = value;
    index += 1;
  }

  if (options.help) {
    return options;
  }
  if (!/^v\d+\.\d+\.\d+$/.test(options.releaseTag)) {
    throw new Error("--release must use stable vX.Y.Z format.");
  }
  if (!PLATFORMS.has(options.platform)) {
    throw new Error("--platform must be android, ios, or both.");
  }
  if (!ANDROID_TRACKS.has(options.androidTrack)) {
    throw new Error(
      "--android-track must be internal, alpha, beta, or production.",
    );
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
    throw new Error("--repository must use owner/name format.");
  }
  return options;
};

const run = (options) => {
  const args = [
    "workflow",
    "run",
    "store-delivery.yml",
    "--repo",
    options.repository,
    "--ref",
    "main",
    "-f",
    `release_tag=${options.releaseTag}`,
    "-f",
    `platform=${options.platform}`,
    "-f",
    `android_track=${options.androidTrack}`,
    "-f",
    `recover_play_apk=${options.recoverPlayApk}`,
  ];
  if (options.dryRun) {
    console.log(`gh ${args.join(" ")}`);
    return;
  }

  const result = spawnSync("gh", args, {
    cwd: resolve("."),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(
      `GitHub workflow dispatch failed with status ${result.status ?? 1}.`,
    );
  }
  const output = String(result.stdout ?? "").trim();
  console.log(output || "Store delivery workflow dispatched.");
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseStoreDeliveryArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
    } else {
      run(options);
    }
  } catch (error) {
    console.error(
      `[store-delivery] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
