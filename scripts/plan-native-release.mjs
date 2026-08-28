import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const planNativeRelease = (platform, changedFiles) => {
  if (!["mobile", "desktop"].includes(platform)) {
    throw new Error(`Unsupported native release platform: ${platform}`);
  }

  const runtimeChangedFiles = changedFiles.filter(
    (file) => !file.endsWith(".md"),
  );

  const mobileOnlyDependencyPatches = runtimeChangedFiles.filter((file) =>
    file.startsWith("patches/expo-sharing@")
  );
  const lockfileIsMobileOnly =
    mobileOnlyDependencyPatches.length > 0 &&
    runtimeChangedFiles.every((file) =>
      file === "package.json" ||
      file === "bun.lock" ||
      file.startsWith("apps/mobile/") ||
      file.startsWith("patches/expo-sharing@") ||
      file.startsWith("scripts/plan-native-release")
    );

  const relevantPrefixes =
    platform === "mobile"
      ? ["apps/mobile/", "packages/client/", "packages/shared/"]
      : [
          "apps/desktop/",
          "apps/web/",
          "crates/desktop-sidecar/",
          "packages/client/",
          "packages/shared/",
        ];

  const relevantFiles =
    platform === "mobile"
      ? new Set([
          ".github/workflows/mobile-build.yml",
          ".github/workflows/android-play-signature-audit.yml",
          ".github/workflows/store-delivery.yml",
          "bun.lock",
          "scripts/build-android-local.sh",
          "scripts/download-play-universal-apk.mjs",
          "scripts/verify-android-apk-signature.mjs",
          ...mobileOnlyDependencyPatches,
        ])
      : new Set([
          ".github/workflows/desktop-build.yml",
          "bun.lock",
          "scripts/create-mac-update-metadata.mjs",
          "scripts/desktop-icns.mjs",
          "scripts/prepare-desktop-icons.mjs",
          "scripts/run-desktop-builder.mjs",
          "scripts/verify-desktop-package.mjs",
        ]);

  const relevantChanges = runtimeChangedFiles.filter(
    (file) =>
      relevantPrefixes.some((prefix) => file.startsWith(prefix)) ||
      relevantFiles.has(file),
  ).filter((file) =>
    !(platform === "desktop" && file === "bun.lock" && lockfileIsMobileOnly),
  );

  return {
    rebuild: relevantChanges.length > 0,
    relevantChanges,
  };
};

const run = () => {
  const [platform, baseRef, headRef] = process.argv.slice(2);

  if (!["mobile", "desktop"].includes(platform) || !baseRef || !headRef) {
    console.error(
      "Usage: node scripts/plan-native-release.mjs <mobile|desktop> <base-ref> <head-ref>",
    );
    process.exit(1);
  }

  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
    }).trim();

  const changedFiles = git("diff", "--name-only", `${baseRef}...${headRef}`)
    .split("\n")
    .filter(Boolean);
  const { rebuild, relevantChanges } = planNativeRelease(
    platform,
    changedFiles,
  );

  process.stdout.write(`rebuild=${rebuild}\n`);
  process.stderr.write(
    `${platform} release plan: ${rebuild ? "rebuild" : "reuse"}${
      relevantChanges.length > 0 ? ` (${relevantChanges.join(", ")})` : ""
    }\n`,
  );
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run();
}
