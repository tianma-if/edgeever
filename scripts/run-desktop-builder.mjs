import { spawnSync } from "node:child_process";

const publishIndex = process.argv.indexOf("--publish");
const publishMode = publishIndex >= 0 ? process.argv[publishIndex + 1] ?? "never" : "never";
const environment = { ...process.env };

// electron-builder treats an explicitly present empty CSC_LINK/WIN_CSC_LINK
// as a path. Remove empty optional signing variables so unsigned CI builds
// remain valid while non-empty secrets still enable signing and notarization.
for (const key of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
]) {
  if (!environment[key]) delete environment[key];
}
environment.CSC_IDENTITY_AUTO_DISCOVERY ||= "false";

const result = spawnSync(process.execPath, [
  "run",
  "--cwd",
  "apps/desktop",
  "dist",
  "--",
  "--publish",
  publishMode,
], { env: environment, stdio: "inherit" });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
