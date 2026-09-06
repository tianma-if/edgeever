import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

const LOCAL_DATA_RESET_HELPER = String.raw`
parent_pid="$1"
user_data_dir="$2"
application_path="$3"
attempt=0
while /bin/kill -0 "$parent_pid" 2>/dev/null && [ "$attempt" -lt 3000 ]; do
  /bin/sleep 0.1
  attempt=$((attempt + 1))
done
if /bin/kill -0 "$parent_pid" 2>/dev/null; then
  exit 1
fi
if /bin/rm -rf -- "$user_data_dir"; then
  /bin/mkdir -p "$user_data_dir"
  /usr/bin/touch "$user_data_dir/installation-confirmed"
  /bin/chmod 700 "$user_data_dir"
  /bin/chmod 600 "$user_data_dir/installation-confirmed"
  /usr/bin/open -n "$application_path"
fi
`;

export class LocalDataResetError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "LocalDataResetError";
    this.code = code;
  }
}

export const managedUserDataDirectory = (userDataDirectory, appDataDirectory) => {
  const target = resolve(userDataDirectory);
  const appData = resolve(appDataDirectory);
  const relativeTarget = relative(appData, target);
  if (
    !relativeTarget ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget) ||
    relativeTarget.includes(sep)
  ) {
    throw new LocalDataResetError(
      "unsafe-data-directory",
      "EdgeEver local data must be a direct child of the application-data directory",
    );
  }
  return target;
};

export const macApplicationBundlePath = (executablePath) => {
  let candidate = resolve(executablePath);
  while (true) {
    if (candidate.toLowerCase().endsWith(".app")) return candidate;
    const parent = resolve(candidate, "..");
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new LocalDataResetError(
    "application-bundle-not-found",
    "EdgeEver must be running from a macOS application bundle",
  );
};

export const scheduleMacLocalDataReset = async ({
  appDataDirectory,
  executablePath,
  parentPid,
  spawnProcess = spawn,
  userDataDirectory,
}) => {
  const target = managedUserDataDirectory(userDataDirectory, appDataDirectory);
  const applicationPath = macApplicationBundlePath(executablePath);
  const helper = spawnProcess(
    "/bin/sh",
    [
      "-c",
      LOCAL_DATA_RESET_HELPER,
      "edgeever-local-data-reset",
      String(parentPid),
      target,
      applicationPath,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  try {
    await new Promise((resolveSpawn, rejectSpawn) => {
      helper.once("spawn", resolveSpawn);
      helper.once("error", rejectSpawn);
    });
  } catch (error) {
    throw new LocalDataResetError(
      "helper-start-failed",
      "EdgeEver could not start the local-data reset helper",
      { cause: error },
    );
  }
  helper.unref();
  return { applicationPath, target };
};
