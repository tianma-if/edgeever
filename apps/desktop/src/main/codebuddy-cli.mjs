// Standalone CodeBuddy CLI (`@tencent-ai/codebuddy-code`) support for the local
// agent list. Only the user's own npm installation is used; WorkBuddy's bundled
// CLI, `--serve`, credential bridging and gateway login stay with WorkBuddy.
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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

const isExecutableFile = (candidate, deps) => {
  try {
    if (!deps.stat(candidate).isFile()) return false;
    deps.access(candidate, deps.executableMode);
    return true;
  } catch {
    return false;
  }
};

// Every executable `name` on the search path, in order, so an invalid early
// candidate (for example a version-manager shim) does not hide a later install.
const findAll = (names, dirs, deps) => dirs.filter(Boolean).flatMap((dir) => (
  names.map((name) => deps.pathImpl.join(dir, name)).filter((candidate) => isExecutableFile(candidate, deps))
));

const findIn = (names, dirs, deps) => findAll(names, dirs, deps)[0] ?? null;

const isOfficialPackage = (root, deps) => {
  try {
    return JSON.parse(deps.readFile(deps.pathImpl.join(root, "package.json")))?.name === CODEBUDDY_PACKAGE;
  } catch {
    return false;
  }
};

// The entry inside the official npm package, never WorkBuddy's bundled copy.
const officialEntry = (entry, deps) => {
  if (!entry || /app\.asar/i.test(entry)) return null;
  try { if (!deps.exists(entry)) return null; } catch { return null; }
  const root = deps.pathImpl.dirname(deps.pathImpl.dirname(entry));
  return isOfficialPackage(root, deps) ? { entry, root } : null;
};

const realEntry = (file, deps) => {
  try { return officialEntry(deps.realpath(file), deps); } catch { return null; }
};

// asdf, mise and Volta put shims (scripts or links to the manager) on PATH
// instead of links to the npm entry. Ask the manager which real executable the
// shim runs, as a terminal would, and fall back to the next candidate otherwise.
const SHIM_LOOKUP_TTL_MS = 30_000;
const shimLookups = new Map();

const shimManager = (candidate, deps) => {
  const { pathImpl, home, env = {} } = deps;
  if (!home) return null;
  const dir = pathImpl.dirname(candidate);
  const asdfShims = pathImpl.join(env.ASDF_DATA_DIR || pathImpl.join(home, ".asdf"), "shims");
  const miseShims = pathImpl.join(env.MISE_DATA_DIR || pathImpl.join(home, ".local", "share", "mise"), "shims");
  const voltaBin = pathImpl.join(env.VOLTA_HOME || pathImpl.join(home, ".volta"), "bin");
  if (dir === asdfShims) return { name: "asdf", extraDirs: [pathImpl.join(home, ".asdf", "bin")] };
  if (dir === miseShims) return { name: "mise", extraDirs: [pathImpl.join(home, ".local", "bin")] };
  if (dir === voltaBin) return { name: "volta", extraDirs: [voltaBin] };
  return null;
};

const defaultRunManager = (command, args, options) => {
  const key = `${command}\0${args.join("\0")}`;
  const cached = shimLookups.get(key);
  if (cached && Date.now() - cached.at < SHIM_LOOKUP_TTL_MS) return cached.output;
  let output = null;
  try {
    const result = spawnSync(command, args, { ...options, encoding: "utf8", timeout: 5_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    if (result.status === 0) output = String(result.stdout ?? "").trim().split(/\r?\n/).pop() || null;
  } catch { /* An unusable manager means this shim is skipped. */ }
  shimLookups.set(key, { at: Date.now(), output });
  return output;
};

const resolveShim = (candidate, dirs, deps) => {
  const manager = shimManager(candidate, deps);
  if (!manager) return null;
  const binary = findIn([manager.name], [...manager.extraDirs, ...dirs], deps);
  if (!binary) return null;
  const run = deps.runManager ?? defaultRunManager;
  const target = run(binary, ["which", "codebuddy"], {
    // A neutral directory resolves the user's global version, like the CLI's workspace.
    cwd: deps.tmpdir ?? tmpdir(),
    env: { ...deps.env, PATH: dirs.join(":") },
  });
  return target && deps.pathImpl.isAbsolute(target) ? realEntry(target, deps) : null;
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
  const nodeName = windows ? "node.exe" : "node";
  for (const shim of findAll([windows ? "codebuddy.cmd" : "codebuddy"], dirs, search)) {
    const shimDir = pathImpl.dirname(shim);
    // npm writes codebuddy.cmd next to node_modules in the global prefix.
    const found = windows
      ? officialEntry(pathImpl.join(shimDir, "node_modules", "@tencent-ai", "codebuddy-code", "bin", "codebuddy"), search)
      : realEntry(shim, search) ?? resolveShim(shim, dirs, search);
    if (!found) continue;
    // Prefer the Node that installed the CLI: the npm prefix (nvm, asdf, mise,
    // Homebrew, ~/.local) or the shim's directory, then the tool path.
    // <prefix>/lib/node_modules/@tencent-ai/codebuddy-code -> <prefix>/bin
    const prefixBin = windows ? null : pathImpl.join(pathImpl.resolve(found.root, "..", "..", "..", ".."), "bin");
    const node = findIn([nodeName], [prefixBin, shimDir, ...dirs], search);
    if (!node) return { ok: false, state: "failed", detail: "node_missing" };
    return { ok: true, command: { command: node, args: [found.entry, "--acp"], env: {}, unsetEnv: CODEBUDDY_UNSET_ENV } };
  }
  return { ok: false, state: "not_installed" };
}
