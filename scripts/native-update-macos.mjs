import { backgroundNodeExecutable } from "../apps/desktop/src/main/background-node.mjs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const macAppBundle = (directory) => {
  const bundles = readdirSync(directory).filter((name) => name.endsWith(".app") && statSync(join(directory, name)).isDirectory());
  if (bundles.length !== 1) throw new Error(`Expected exactly one macOS bundle in ${directory}, found ${bundles.length}`);
  return join(directory, bundles[0]);
};

export const macAppExecutable = (bundle) => {
  const metadata = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(bundle, "Contents/Info.plist")], { encoding: "utf8" });
  if (metadata.status !== 0) throw new Error("Cannot read the signed fixture's CFBundleExecutable");
  return join(bundle, "Contents/MacOS", metadata.stdout.trim());
};

export const MAC_UPDATE_FIXTURE_NAME = "EdgeEverUpdateVerifier";

export const assertMacFixtureRuntime = (bundle) =>
  backgroundNodeExecutable(macAppExecutable(bundle), "darwin");
