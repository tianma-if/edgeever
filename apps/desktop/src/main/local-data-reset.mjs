import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

const LOCAL_DATA_RESET_HELPER = String.raw`
parent_pid="$1"
user_data_dir="$2"
application_path="$3"
attempt=0
while /bin/kill -0 "$parent_pid" 2>/dev/null && [ "$attempt" -lt 300 ]; do
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
    throw new Error("EdgeEver local data must be a direct child of the application-data directory");
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
  throw new Error("EdgeEver must be running from a macOS application bundle");
};

export const scheduleMacLocalDataReset = ({
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
  helper.unref();
  return { applicationPath, target };
};
