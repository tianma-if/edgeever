// Standalone CodeBuddy CLI (`@tencent-ai/codebuddy-code`) support for the local
// agent list. Only the user's own npm installation is used; WorkBuddy's bundled
// CLI, `--serve`, credential bridging and gateway login stay with WorkBuddy.
import path from "node:path";

export const CODEBUDDY_PACKAGE = "@tencent-ai/codebuddy-code";
// The CLI picks its region from the login method; an inherited override can
// route requests to the wrong endpoint, so EdgeEver never forwards one.
export const CODEBUDDY_UNSET_ENV = ["CODEBUDDY_INTERNET_ENVIRONMENT", "CODEBUDDY_INTERNET_ENVIROMENT"];
// Hosts observed for the verified login methods: `internal` (WeChat) opens
// copilot.tencent.com and `external` (Google / GitHub) opens www.codebuddy.ai.
// Other hosts, including enterprise domains, are not opened by EdgeEver.
export const CODEBUDDY_LOGIN_HOSTS = ["copilot.tencent.com", "codebuddy.ai"];

export function codeBuddyLoginUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return CODEBUDDY_LOGIN_HOSTS.some((root) => host === root || host.endsWith(`.${root}`)) ? url.href : null;
}

const findIn = (names, dirs, deps) => {
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = deps.pathImpl.join(dir, name);
      try {
        if (!deps.stat(candidate).isFile()) continue;
        deps.access(candidate, deps.executableMode);
        return candidate;
      } catch { /* Try the next directory. */ }
    }
  }
  return null;
};

const isOfficialPackage = (root, deps) => {
  try {
    return JSON.parse(deps.readFile(deps.pathImpl.join(root, "package.json")))?.name === CODEBUDDY_PACKAGE;
  } catch {
    return false;
  }
};

// Resolves `node <package>/bin/codebuddy --acp`. Running the JS entry with an
// explicit Node avoids `#!/usr/bin/env node` lookups on POSIX and `.cmd` shims
// (which would need a shell) on Windows. The CLI ships native modules, so it
// needs a real Node rather than Electron's embedded runtime.
export function resolveCodeBuddyCli(deps) {
  const windows = deps.platform === "win32";
  const pathImpl = windows ? path.win32 : path.posix;
  const search = { ...deps, pathImpl };
  const dirs = String(deps.toolPath ?? "").split(windows ? ";" : ":").filter(Boolean);
  let entry;
  let shimDir;
  if (windows) {
    // npm writes codebuddy.cmd next to node_modules in the global prefix.
    const shim = findIn(["codebuddy.cmd"], dirs, search);
    if (!shim) return { ok: false, state: "not_installed" };
    shimDir = pathImpl.dirname(shim);
    entry = pathImpl.join(shimDir, "node_modules", "@tencent-ai", "codebuddy-code", "bin", "codebuddy");
  } else {
    const shim = findIn(["codebuddy"], dirs, search);
    if (!shim) return { ok: false, state: "not_installed" };
    shimDir = pathImpl.dirname(shim);
    try { entry = deps.realpath(shim); } catch { return { ok: false, state: "not_installed" }; }
  }
  const root = pathImpl.dirname(pathImpl.dirname(entry));
  // WorkBuddy's bundled copy lives inside its app bundle; it is not this adapter's CLI.
  if (/app\.asar/i.test(entry) || !deps.exists(entry) || !isOfficialPackage(root, search)) {
    return { ok: false, state: "not_installed" };
  }
  // Prefer the Node that installed the CLI (same bin directory, e.g. nvm or Homebrew).
  const nodeName = windows ? "node.exe" : "node";
  const node = findIn([nodeName], [shimDir, ...dirs], search);
  if (!node) return { ok: false, state: "failed", detail: "node_missing" };
  return { ok: true, command: { command: node, args: [entry, "--acp"], env: {}, unsetEnv: CODEBUDDY_UNSET_ENV } };
}
