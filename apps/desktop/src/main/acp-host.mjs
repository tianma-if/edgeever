import { spawn as nodeSpawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { validateTrustedAcpPath } from "./acp-path-store.mjs";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import { waitForChildProcessSpawn } from "./child-process-start.mjs";
import { createAcpAdapterManager } from "./acp-adapter-manager.mjs";
import { startAcpMcpBridge } from "./acp-mcp-bridge.mjs";
import { withAntigravityMacProxy } from "./antigravity-proxy.mjs";
import { authenticateWorkBuddy, prepareWorkBuddyAuth } from "./workbuddy-auth.mjs";

const ADAPTERS = {
  codex: { id: "codex", label: "Codex" },
  claudeCode: { id: "claudeCode", label: "Claude Code" },
  antigravity: { id: "antigravity", label: "Antigravity" },
  openClaw: { id: "openClaw", label: "OpenClaw" },
  hermesAgent: { id: "hermesAgent", label: "Hermes Agent" },
  grokBuild: { id: "grokBuild", label: "Grok Build" },
  deepseekHarness: { id: "deepseekHarness", label: "DeepSeek Harness" },
  piAgent: { id: "piAgent", label: "pi agent" },
  workbuddyCn: { id: "workbuddyCn", label: "WorkBuddy 中国版" },
  workbuddyIntl: { id: "workbuddyIntl", label: "WorkBuddy International" },
};
const AUTH_REQUIRED_CODE = -32000;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_CHARS = 8_000_000;
const HANDSHAKE_TIMEOUT_MS = 20_000;
const WORKSPACE_MARKER = `${path.sep}edgeever-acp-`;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const liveChildren = new Set();
const closedChildren = new WeakSet();
const stoppingChildren = new WeakMap();
let exitHooked = false;

const clientVersion = () => {
  try {
    const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
    return typeof version === "string" && version.trim() ? version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const trackChild = (child) => {
  if (!child) return;
  liveChildren.add(child);
  child.once?.("close", () => closedChildren.add(child));
  child.once?.("exit", () => liveChildren.delete(child));
  if (!exitHooked) {
    exitHooked = true;
    process.once("exit", () => {
      for (const live of liveChildren) {
        try { live.kill("SIGKILL"); } catch { /* already gone */ }
      }
    });
  }
};

export const codexBasenames = (platform = process.platform) => (
  platform === "win32" ? ["codex-acp", "codex-acp.exe"] : ["codex-acp"]
);

const slashRejected = (value) => value.includes("/") || value.includes("\\") || value.includes("\0");

const findOnPath = (names, { access, pathEnv, delimiter, sep }) => {
  for (const dir of String(pathEnv ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      if (slashRejected(name)) continue;
      const candidate = dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}${sep}${name}`;
      try {
        access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return null;
};

export function detectInstalledAgentApps({
  platform = process.platform,
  pathEnv = process.env.PATH ?? "",
  home = homedir(),
  env = process.env,
  access = accessSync,
  exists = existsSync,
} = {}) {
  const lookup = (names) => !!findOnPath(names, {
    access,
    pathEnv,
    delimiter: platform === "win32" ? ";" : ":",
    sep: platform === "win32" ? "\\" : "/",
  });
  const candidates = (id) => {
    if (platform === "darwin") return id === "codex"
      ? ["/Applications/Codex.app", path.join(home, "Applications", "Codex.app"), "/Applications/ChatGPT.app/Contents/Resources/codex"]
      : ["/Applications/Antigravity.app", path.join(home, "Applications", "Antigravity.app")];
    if (platform === "win32") return id === "codex"
      ? [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Codex", "Codex.exe")]
      : [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Antigravity", "Antigravity.exe"), env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Antigravity", "Antigravity.exe")];
    return [];
  };
  return ["codex", "antigravity", "piAgent"].filter((id) => {
    if (id === "piAgent") return lookup(platform === "win32" ? ["pi.exe"] : ["pi"])
      || (platform !== "win32" && [path.join(home, ".local", "bin", "pi"), ...(platform === "darwin" ? ["/opt/homebrew/bin/pi", "/usr/local/bin/pi"] : [])].some((candidate) => exists(candidate)));
    const names = platform === "win32" ? [`${id}.exe`, id] : [id];
    return lookup(names) || candidates(id).some((candidate) => candidate && exists(candidate));
  });
}

const resolutionDeps = (deps = {}) => ({
  platform: deps.platform ?? process.platform,
  home: deps.home ?? homedir(),
  env: deps.env ?? process.env,
  executablePath: deps.executablePath ?? process.execPath,
  access: deps.accessSync ?? accessSync,
  realpath: deps.realpathSync ?? realpathSync,
  stat: deps.statSync ?? statSync,
  exists: deps.existsSync ?? existsSync,
  pathEnv: deps.pathEnv ?? process.env.PATH ?? "",
  delimiter: deps.delimiter ?? path.delimiter,
  sep: deps.sep ?? path.sep,
});

export function resolveAcpCommand(input, deps = {}) {
  const resolved = resolutionDeps(deps);
  const id = input?.id;
  if (!Object.hasOwn(ADAPTERS, id)) return { ok: false, state: "failed", detail: "unknown_adapter" };
  if (id === "codex") return resolveCodex(input?.path, resolved);
  if (id === "claudeCode") return resolveAgentCli("claude-agent-acp", [], resolved);
  if (id === "antigravity") return resolveAntigravity(input?.path, resolved);
  if (id === "openClaw") return resolveAgentCli("openclaw", ["acp"], resolved);
  if (id === "hermesAgent") return resolveAgentCli("hermes", ["acp"], resolved);
  if (id === "grokBuild") return resolveGrok(input?.path, resolved);
  if (id === "deepseekHarness") return resolveLocalAcpCli("dsh", ["--profile", "acp"], resolved);
  if (id === "piAgent") {
    if (!localExecutable("pi", resolved)) return { ok: false, state: "not_installed" };
    const adapter = resolveLocalAcpCli("pi-acp", [], resolved);
    return adapter.ok ? { ...adapter, command: withPiPath(adapter.command, resolved) } : { ...adapter, detail: "adapter_missing" };
  }
  return resolveWorkBuddy(id, resolved);
}

function localExecutable(name, deps) {
  const executable = deps.platform === "win32" ? `${name}.exe` : name;
  const candidates = [findOnPath([executable], deps)];
  if (deps.platform !== "win32") candidates.push(path.join(deps.home, ".local", "bin", name));
  if (deps.platform === "darwin") candidates.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const actual = deps.realpath(candidate);
      if (deps.stat(actual).isFile()) { deps.access(actual, fsConstants.X_OK); return actual; }
    } catch { /* Try another installation. */ }
  }
  return null;
}

function resolveLocalAcpCli(name, args, deps) {
  const executable = localExecutable(name, deps);
  if (!executable) return { ok: false, state: "not_installed" };
  return { ok: true, command: /\.[cm]?js$/i.test(executable)
    ? { command: deps.executablePath, args: [executable, ...args], env: { ELECTRON_RUN_AS_NODE: "1" } }
    : { command: executable, args } };
}

function resolveAgentCli(name, args, deps) {
  const result = resolveLocalAcpCli(name, args, deps);
  if (!result.ok || deps.platform === "win32") return result;
  // Desktop launchers may omit the directories containing node or agent shims.
  const paths = [path.join(deps.home, ".local", "bin"), ...(deps.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []), deps.pathEnv];
  return { ...result, command: { ...result.command, env: { ...result.command.env, PATH: paths.join(":") } } };
}

function withPiPath(command, deps) {
  if (deps.platform === "win32" || findOnPath(["pi"], deps)) return command;
  const candidates = [path.join(deps.home, ".local", "bin", "pi"), ...(deps.platform === "darwin" ? ["/opt/homebrew/bin/pi", "/usr/local/bin/pi"] : [])];
  for (const candidate of candidates) {
    try {
      const actual = deps.realpath(candidate);
      if (!deps.stat(actual).isFile()) continue;
      deps.access(actual, fsConstants.X_OK);
      return { ...command, env: { ...command.env, PATH: `${path.dirname(candidate)}:${deps.pathEnv}` } };
    } catch { /* Try another installation. */ }
  }
  return command;
}

function resolveWorkBuddy(id, deps) {
  const homeApplications = path.join(deps.home, "Applications");
  const macApps = id === "workbuddyCn" ? ["WorkBuddy.app", "WorkBuddy AI.app"] : ["WorkBuddy AI.app", "WorkBuddy.app"];
  const candidates = deps.platform === "darwin"
    ? macApps.flatMap((name) => [path.join("/Applications", name), path.join(homeApplications, name)])
      .map((app) => path.join(app, "Contents", "Resources", "app.asar.unpacked", "cli", "bin", "codebuddy"))
    : deps.platform === "win32"
      ? [deps.env.LOCALAPPDATA && path.join(deps.env.LOCALAPPDATA, "Programs", "WorkBuddy"), deps.env.LOCALAPPDATA && path.join(deps.env.LOCALAPPDATA, "WorkBuddy"), deps.env.PROGRAMFILES && path.join(deps.env.PROGRAMFILES, "WorkBuddy")]
        .filter(Boolean).map((folder) => path.join(folder, "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"))
      : [];
  for (const candidate of candidates) {
    try {
      const actual = deps.realpath(candidate);
      if (!deps.stat(actual).isFile()) continue;
      deps.access(actual, fsConstants.R_OK);
      const liteBundle = isWorkBuddyLiteBundle(actual, deps);
      if (deps.platform === "darwin") {
        const executable = path.resolve(path.dirname(actual), "../../../../MacOS/Electron");
        if (deps.exists(executable)) {
          return { ok: true, command: workBuddyCommand(executable, actual, id, true, liteBundle) };
        }
      }
      return { ok: true, command: workBuddyCommand(deps.executablePath, actual, id, false, liteBundle) };
    } catch { /* Try another installed WorkBuddy application. */ }
  }
  const external = findOnPath(deps.platform === "win32" ? ["codebuddy.exe"] : ["codebuddy"], deps);
  return external
    ? { ok: true, command: workBuddyCommand(external, null, id) }
    : { ok: false, state: "not_installed" };
}

// WorkBuddy 5.8+ ships only dist/codebuddy-lite-wb.mjs. That bundle loads only
// with CODEBUDDY_FORCE_LITE_WB_BUNDLE, and its bare --acp runs a one-shot print
// session; stdio ACP is served only alongside --serve, whose gateway stays on loopback.
function isWorkBuddyLiteBundle(bundledCli, deps) {
  const dist = path.resolve(path.dirname(bundledCli), "../dist");
  return deps.exists(path.join(dist, "codebuddy-lite-wb.mjs")) && !deps.exists(path.join(dist, "codebuddy.js"));
}

function workBuddyCommand(executablePath, bundledCli, id, nativeBootstrap = false, liteBundle = false) {
  const edition = id === "workbuddyCn" ? { CODEBUDDY_INTERNET_ENVIRONMENT: "internal" } : {};
  const acpArgs = liteBundle ? ["--acp", "--serve", "--acp-transport", "stdio", "--host", "127.0.0.1"] : ["--acp"];
  const bundleEnv = liteBundle ? { CODEBUDDY_FORCE_LITE_WB_BUNDLE: "1", SERVER__HOST: "127.0.0.1" } : {};
  return bundledCli
    ? { command: executablePath, args: [...(nativeBootstrap ? [fileURLToPath(new URL("./workbuddy-launch.cjs", import.meta.url))] : []), bundledCli, ...acpArgs], env: { ...edition, ...bundleEnv, ELECTRON_RUN_AS_NODE: "1" }, ...(id === "workbuddyIntl" ? { unsetEnv: ["CODEBUDDY_INTERNET_ENVIRONMENT"] } : {}) }
    : { command: executablePath, args: ["--acp"], env: edition, ...(id === "workbuddyIntl" ? { unsetEnv: ["CODEBUDDY_INTERNET_ENVIRONMENT"] } : {}) };
}

function resolveGrok(configured, deps) {
  const executable = deps.platform === "win32" ? "grok.exe" : "grok";
  const explicit = typeof configured === "string" && configured.trim() ? configured.trim() : null;
  if (explicit && (explicit.includes("\0") || !path.isAbsolute(explicit) || explicit.split(/[/\\]/).includes(".."))) {
    return { ok: false, state: "failed", detail: "invalid_path" };
  }
  const candidates = explicit ? [explicit] : [
    findOnPath([executable], deps),
    path.join(deps.home, ".grok", "bin", executable),
    ...(deps.platform === "darwin" ? [`/opt/homebrew/bin/${executable}`, `/usr/local/bin/${executable}`] : []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const actual = deps.realpath(candidate);
      if (!deps.stat(actual).isFile()) continue;
      deps.access(actual, fsConstants.X_OK);
      return { ok: true, command: { command: actual, args: ["agent", "stdio"] } };
    } catch { /* Try another installed Grok binary. */ }
  }
  return { ok: false, state: explicit ? "failed" : "not_installed", ...(explicit ? { detail: "invalid_path" } : {}) };
}

function resolveCodex(configured, deps) {
  const allowed = codexBasenames(deps.platform);
  let names = allowed;
  if (typeof configured === "string" && configured.trim()) {
    const name = configured.trim();
    if (slashRejected(name) || !allowed.includes(name)) return { ok: false, state: "failed", detail: "invalid_path" };
    names = [name];
  }
  const command = findOnPath(names, deps);
  return command ? { ok: true, command } : { ok: false, state: "not_installed" };
}

function resolveAntigravity(configured, { realpath, stat }) {
  if (typeof configured !== "string" || !configured.trim()) return { ok: false, state: "not_installed" };
  const raw = configured.trim();
  if (raw.includes("\0") || !path.isAbsolute(raw) || raw.split(/[/\\]/).includes("..")) {
    return { ok: false, state: "failed", detail: "invalid_path" };
  }
  let resolvedPath;
  try {
    resolvedPath = realpath(raw);
  } catch (error) {
    return error?.code === "ENOENT"
      ? { ok: false, state: "not_installed" }
      : { ok: false, state: "failed", detail: "invalid_path" };
  }
  let info;
  try {
    info = stat(resolvedPath);
  } catch (error) {
    return error?.code === "ENOENT"
      ? { ok: false, state: "not_installed" }
      : { ok: false, state: "failed", detail: "invalid_path" };
  }
  if (typeof info?.isFile !== "function" || !info.isFile()) return { ok: false, state: "failed", detail: "invalid_path" };
  return { ok: true, command: resolvedPath };
}

export function isAuthRequiredError(error) {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error?.message ?? error);
  if (/auth/i.test(message)) return true;
  return error instanceof RequestError && error.code === AUTH_REQUIRED_CODE;
}

export function sanitizeFailureDetail(error) {
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? "");
  let text = message.replace(/\s+/g, " ").trim();
  text = text.replace(/https?:\/\/[^\s"']+/gi, "[url]");
  const home = homedir();
  if (home && home !== "/" && home !== "\\") text = text.split(home).join("[path]");
  text = text.replace(/~\/[^\s]+/g, "[path]");
  text = text.replace(/(?:\/[\w.+@-]+){2,}/g, "[path]");
  text = text.replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, "[path]");
  text = text.replace(/\b(?:[A-Za-z0-9_]*(?:key|token|secret|password|credential)[A-Za-z0-9_]*)=[^\s]+/gi, "[redacted]");
  text = text.replace(/\b(?:bearer|authorization)\s+[^\s]+/gi, "[redacted]");
  text = text.replace(/(["']?[\w-]*(?:key|token|secret|password|credential|authorization)[\w-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}]+)/gi, "$1[redacted]");
  text = text.replace(/\b(?:sk-ant-|sk-)[A-Za-z0-9_-]+/g, "[redacted]");
  text = text.replace(/\s+/g, " ").trim();
  if (!text || text === "[path]" || text === "[redacted]") return "connection_failed";
  return text.slice(0, 160);
}

export function classifyAcpFailure(error) {
  if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { state: "not_installed" };
  if (error?.code === "TIMEOUT" || error?.message === "connection_timeout") {
    return { state: "failed", detail: "connection_timeout" };
  }
  if (isAuthRequiredError(error)) return { state: "needs_login" };
  return { state: "failed", detail: sanitizeFailureDetail(error) };
}

const adapterShell = (id) => ({ ...ADAPTERS[id] });

const adapterFromResolution = (id, resolution) => {
  const adapter = adapterShell(id);
  if (!resolution.ok && resolution.state === "failed") {
    return { ...adapter, state: "failed", detail: resolution.detail || "connection_failed" };
  }
  if (!resolution.ok) return { ...adapter, state: "not_installed", ...(resolution.detail ? { detail: resolution.detail } : {}) };
  return adapter;
};

const mediaTypeBase = (value) => (
  typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : ""
);

const attachmentToken = (filename) => {
  const base = String(filename ?? "").split(/[/\\]/).filter(Boolean).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80);
  return cleaned || "attachment";
};

const decodeText = (dataBase64) => Buffer.from(dataBase64, "base64").toString("utf8");

const rejectAttachment = (attachment, reason) => ({
  filename: typeof attachment?.filename === "string" && attachment.filename ? attachment.filename : "attachment",
  reason,
});

export function buildPromptContent({ prompt, contextText, attachments, promptCapabilities = {}, promptFirst = false } = {}) {
  const blocks = [];
  const rejectedAttachments = [];
  if (promptFirst) blocks.push({ type: "text", text: typeof prompt === "string" ? prompt : "" });
  if (typeof contextText === "string" && contextText.length > 0) blocks.push({ type: "text", text: contextText });
  if (!promptFirst) blocks.push({ type: "text", text: typeof prompt === "string" ? prompt : "" });
  const list = Array.isArray(attachments) ? attachments : [];
  list.forEach((attachment, index) => {
    if (index >= MAX_ATTACHMENTS) {
      rejectedAttachments.push(rejectAttachment(attachment, "Too many attachments."));
      return;
    }
    const mapped = mapAttachment(attachment, promptCapabilities);
    if (mapped.block) blocks.push(mapped.block);
    if (mapped.rejected) rejectedAttachments.push(mapped.rejected);
  });
  assertPromptBlocksSafe(blocks);
  return { blocks, rejectedAttachments };
}

function mapAttachment(attachment, capabilities) {
  if (!attachment || typeof attachment !== "object") {
    return { rejected: rejectAttachment(attachment, "This attachment could not be read.") };
  }
  const dataBase64 = attachment.dataBase64;
  if (typeof dataBase64 !== "string" || dataBase64.length > MAX_ATTACHMENT_CHARS) {
    return { rejected: rejectAttachment(attachment, "This attachment could not be read.") };
  }
  const mediaType = mediaTypeBase(attachment.mediaType);
  if (mediaType.startsWith("text/") || mediaType === "application/json") {
    return { block: { type: "text", text: decodeText(dataBase64) } };
  }
  if (IMAGE_TYPES.has(mediaType)) {
    if (capabilities.image !== true) {
      return { rejected: rejectAttachment(attachment, "This agent does not accept images.") };
    }
    return { block: { type: "image", data: dataBase64, mimeType: mediaType } };
  }
  if (mediaType === "application/pdf") {
    if (capabilities.embeddedContext !== true) {
      return { rejected: rejectAttachment(attachment, "This agent does not accept embedded files.") };
    }
    return {
      block: {
        type: "resource",
        resource: {
          uri: `edgeever-attachment:${attachmentToken(attachment.filename)}`,
          blob: dataBase64,
          mimeType: "application/pdf",
        },
      },
    };
  }
  return { rejected: rejectAttachment(attachment, "This file type is not supported.") };
}

function assertPromptBlocksSafe(blocks) {
  for (const block of blocks) {
    if (!block || block.type === "resource_link") throw new Error("invalid_prompt");
    if (block.type === "resource") {
      const uri = block.resource?.uri ?? "";
      if (!uri.startsWith("edgeever-attachment:") || /[/\\]/.test(uri) || uri.includes("..")) {
        throw new Error("invalid_prompt");
      }
    }
    if (block.type === "image" && typeof block.uri === "string") throw new Error("invalid_prompt");
  }
}

const safeToolToken = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /[/\\]/.test(trimmed) || trimmed.includes("://")) return "";
  return trimmed;
};

const MAX_GENERATED_IMAGES = 8;

const compactBase64 = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("data:") && !trimmed.includes(",")) return "";
  const payload = trimmed.startsWith("data:") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  const compact = payload.replace(/\s+/g, "");
  if (!compact || compact.length > MAX_ATTACHMENT_CHARS || compact.length % 4 === 1) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return "";
  return compact;
};

const imageFingerprint = (base64) => createHash("sha256").update(base64).digest("hex").slice(0, 16);

const imageEventFromBlock = (requestId, block, id) => {
  if (!block || typeof block !== "object" || block.type !== "image") return null;
  const mediaType = mediaTypeBase(block.mimeType);
  if (!IMAGE_TYPES.has(mediaType)) return null;
  const base64 = compactBase64(block.data);
  if (!base64) return null;
  return { requestId, type: "image", id, mediaType, base64 };
};

const toolImageEvents = (requestId, update) => {
  if (!Array.isArray(update.content)) return [];
  const toolId = safeToolToken(update.toolCallId) || "tool";
  const events = [];
  for (const item of update.content) {
    if (events.length >= MAX_GENERATED_IMAGES) break;
    const block = item?.type === "content" ? item.content : item;
    const image = imageEventFromBlock(requestId, block, `${toolId}:${events.length}`);
    if (image) events.push(image);
  }
  return events;
};

export function eventsFromSessionUpdate(requestId, params) {
  const update = params?.update;
  if (!update || typeof update !== "object") return [];
  if (update.sessionUpdate === "agent_thought_chunk") {
    if (update.content?.type !== "text" || typeof update.content.text !== "string" || update.content.text.length === 0) {
      return [];
    }
    return [{ requestId, type: "reasoning", text: update.content.text }];
  }
  if (update.sessionUpdate === "agent_message_chunk") {
    if (update.content?.type === "text" && typeof update.content.text === "string" && update.content.text.length > 0) {
      return [{ requestId, type: "text-delta", text: update.content.text,
        ...(typeof update.messageId === "string" && update.messageId ? { messageId: update.messageId } : {}) }];
    }
    const image = imageEventFromBlock(requestId, update.content, "");
    if (!image) return [];
    return [{ ...image, id: `message:${imageFingerprint(image.base64)}` }];
  }
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return [];
  const name = safeToolToken(update.name) || safeToolToken(update.toolCallId) || "tool";
  const status = safeToolToken(update.status) || "pending";
  const event = { requestId, type: "tool", name, status };
  const title = safeToolToken(update.title);
  if (title) event.title = title;
  return [event, ...toolImageEvents(requestId, update)];
}

export function acpInitializeParams(version = clientVersion()) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: "edgeever", version },
  };
}

export function createAcpSpawnPlan(input, cwd) {
  const spec = typeof input === "string" ? { command: input, args: [] } : input;
  const command = spec?.command;
  if (typeof command !== "string" || !command.trim() || command.includes("\0")) throw new Error("invalid_command");
  if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw new Error("invalid_command");
  if (typeof cwd !== "string" || !cwd.trim()) throw new Error("invalid_workspace");
  const workspace = path.resolve(cwd);
  if (workspace === path.resolve(homedir())) throw new Error("invalid_workspace");
  return {
    command,
    args: spec.args,
    options: {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      ...(spec.env || spec.unsetEnv ? { env: (() => {
        const env = { ...process.env, ...spec.env };
        for (const key of spec.unsetEnv ?? []) delete env[key];
        return env;
      })() } : {}),
    },
  };
}

export function spawnAcpChild(spawnImpl, command, cwd) {
  const plan = createAcpSpawnPlan(command, cwd);
  const options = { ...plan.options, shell: false, stdio: ["pipe", "pipe", "pipe"] };
  if (options.shell !== false) throw new Error("ACP processes cannot use a shell");
  const child = spawnImpl(plan.command, plan.args, options);
  trackChild(child);
  return waitForChildProcessSpawn(child);
}

// Bun's test runner makes Readable.toWeb end a child pipe before any bytes arrive.
// Electron (Node) keeps the official Writable.toWeb / Readable.toWeb conversion.
const useBunStdioBridge = typeof process.versions?.bun === "string";

export function nodeReadableToWeb(nodeStream) {
  let settled = false;
  return new ReadableStream({
    start(controller) {
      const close = () => {
        if (settled) return;
        settled = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { controller.error(error); } catch { /* already closed */ }
      };
      nodeStream.on("data", (chunk) => {
        if (settled) return;
        const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
        try { controller.enqueue(bytes); } catch { /* closed */ }
      });
      nodeStream.on("end", close);
      nodeStream.on("error", fail);
    },
    cancel() {
      settled = true;
    },
  });
}

export function nodeWritableToWeb(nodeStream) {
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        try {
          nodeStream.write(Buffer.from(chunk), (error) => (error ? reject(error) : resolve()));
        } catch (error) {
          reject(error);
        }
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        try {
          nodeStream.end((error) => (error ? reject(error) : resolve()));
        } catch (error) {
          reject(error);
        }
      });
    },
  });
}

const acpNdJsonStream = (child) => {
  if (!child?.stdin || !child?.stdout) throw new Error("stdio_bridge_unavailable");
  if (!useBunStdioBridge && typeof Writable.toWeb === "function" && typeof Readable.toWeb === "function") {
    return ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  }
  return ndJsonStream(nodeWritableToWeb(child.stdin), nodeReadableToWeb(child.stdout));
};

export async function createAcpWorkspace(mkdtempImpl = mkdtemp, root = tmpdir()) {
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot === path.resolve(homedir())) throw new Error("invalid_workspace");
  const directory = await mkdtempImpl(path.join(resolvedRoot, "edgeever-acp-"));
  if (path.resolve(directory) === path.resolve(homedir())) throw new Error("invalid_workspace");
  return directory;
}

export async function removeAcpWorkspace(directory, rmImpl = rm) {
  if (typeof directory !== "string" || !directory) return;
  const resolved = path.resolve(directory);
  if (resolved === path.resolve(homedir()) || !resolved.includes(WORKSPACE_MARKER)) return;
  await rmImpl(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

const normalizePromptCapabilities = (initialized) => {
  const caps = initialized?.agentCapabilities?.promptCapabilities ?? {};
  return {
    image: caps.image === true,
    embeddedContext: caps.embeddedContext === true,
  };
};

const publicAuthMethods = (initialized) => (
  Array.isArray(initialized?.authMethods)
    ? initialized.authMethods.filter((method) => (method?.type == null || method.type === "agent") && typeof method.id === "string" && method.id.length <= 120)
      .map((method) => ({ id: method.id, name: typeof method.name === "string" ? method.name.slice(0, 120) : method.id }))
    : []
);

export function automaticAcpPermissionResponse(params) {
  const options = Array.isArray(params?.options) ? params.options : [];
  const option = options.find((item) => item?.kind === "allow_once" && typeof item.optionId === "string" && item.optionId.length > 0 && item.optionId.length <= 120)
    ?? options.find((item) => item?.kind === "allow_always" && typeof item.optionId === "string" && item.optionId.length > 0 && item.optionId.length <= 120);
  return { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } };
}

const createEdgeEverAcpClient = (requestId, emit, allowPermissions, onAuthStatus) => ({
  extNotification(method, params) {
    if (method === "_auth/status_update") onAuthStatus?.(params?.authStatus);
  },
  requestPermission(params) {
    // Probe, install, and sign-in sessions do not originate from a user prompt.
    return allowPermissions ? automaticAcpPermissionResponse(params) : { outcome: { outcome: "cancelled" } };
  },
  sessionUpdate(params) {
    for (const event of eventsFromSessionUpdate(requestId, params)) emit(event);
  },
  readTextFile() {
    throw new Error("filesystem access is not available");
  },
  writeTextFile() {
    throw new Error("filesystem access is not available");
  },
  createTerminal() {
    throw new Error("terminal access is not available");
  },
  terminalOutput() {
    throw new Error("terminal access is not available");
  },
  releaseTerminal() {
    throw new Error("terminal access is not available");
  },
  waitForTerminalExit() {
    throw new Error("terminal access is not available");
  },
  killTerminal() {
    throw new Error("terminal access is not available");
  },
});

// exit only describes the direct process; inherited pipes can remain open until close.
export function stopAcpChild(child) {
  if (!child) return Promise.resolve();
  if (stoppingChildren.has(child)) return stoppingChildren.get(child);
  if (closedChildren.has(child)) return Promise.resolve();
  let finish;
  const stopped = new Promise((resolve) => { finish = resolve; });
  stoppingChildren.set(child, stopped);
  const onClose = () => { closedChildren.add(child); settle(); };
  const settle = () => {
    clearTimeout(killTimer);
    clearTimeout(deadline);
    child.off("close", onClose);
    finish();
  };
  const killTimer = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  }, 500);
  // Descendants may retain inherited pipes. Bound the wait and let fs.rm retry locks.
  const deadline = setTimeout(settle, 2_000);
  child.once("close", onClose);
  try { child.stdin?.destroy(); } catch { /* closed */ }
  if (child.exitCode == null && child.signalCode == null) {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
  return stopped;
}

const promptFailureMessage = (failure) => {
  if (failure.state === "not_installed") return "not_installed";
  if (failure.state === "needs_login") return "needs_login";
  return failure.detail || "connection_failed";
};

export function promptResultFailure(result) {
  if (result?.stopReason !== "refusal") return null;
  const rawError = result?._meta?.["codebuddy.ai/errorMessage"];
  if (typeof rawError === "string" && rawError.length <= 4_096) {
    try {
      const error = JSON.parse(rawError);
      if (error?.data?.category === "auth" || isAuthRequiredError(error)) return "needs_login";
    } catch { /* The agent may return an unstructured refusal. */ }
  }
  return "agent_refused";
}

export function createAcpHostRuntime(options = {}) {
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const mkdtempImpl = options.mkdtemp ?? mkdtemp;
  const rmImpl = options.rm ?? rm;
  // Workspace cleanup must not replace a successful handshake or its original failure.
  const cleanupWorkspace = (directory) => removeAcpWorkspace(directory, rmImpl).catch((error) => {
    console.warn("ACP workspace cleanup failed:", sanitizeFailureDetail(error));
  });
  const version = options.clientVersion ?? clientVersion();
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const authenticationTimeoutMs = options.authenticationTimeoutMs ?? 5 * 60_000;
  const commandDeps = options;
  const manager = options.adapterManager ?? (options.adapterStore ? createAcpAdapterManager({ root: options.adapterStore, executablePath: options.executablePath, fetchImpl: options.adapterFetchImpl }) : null);
  const active = new Map();
  const updateFailures = new Map();
  const installingIds = new Set();
  const latestStatus = new Map();
  const mcpScriptPath = options.mcpScriptPath ?? fileURLToPath(new URL("../../../../scripts/edgeever-mcp-stdio.mjs", import.meta.url));
  const mcpServerFor = (bridge) => ({
    name: "edgeever-current-workspace",
    command: options.mcpExecutablePath ?? process.execPath,
    args: [mcpScriptPath],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      { name: "EDGEEVER_URL", value: bridge.url },
      { name: "EDGEEVER_TOKEN", value: bridge.secret },
    ],
  });

  const resolveCommand = (input, { prepareProxy = true } = {}) => {
    const adapt = (resolution) => prepareProxy && input?.id === "antigravity" && resolution.ok
      ? { ...resolution, command: withAntigravityMacProxy(resolution.command, commandDeps) }
      : resolution;
    if (input?.id === "antigravity" && typeof input.path === "string" && input.path.trim()) return adapt(resolveAcpCommand(input, commandDeps));
    if (input?.id === "piAgent" && !localExecutable("pi", resolutionDeps(commandDeps))) return { ok: false, state: "not_installed" };
    const managed = manager?.get(input?.id);
    if (managed) return adapt({ ok: true, command: input?.id === "piAgent" ? withPiPath(managed.command, resolutionDeps(commandDeps)) : managed.command, version: managed.version, managed: true });
    return adapt(resolveAcpCommand(input, commandDeps));
  };

  const connect = async (command, requestId, emit, signal, authMethodId, mcpServers = [], allowPermissions = false, workBuddyAuth = null, verifyWorkBuddy = false) => {
    const cwd = await createAcpWorkspace(mkdtempImpl, options.tmpRoot);
    let child = null;
    let authMethods = [];
    let authenticationPending = false;
    let authStatusKind;
    let connected = false;
    let resolveAuthStatus;
    let authStatusReceived = new Promise((resolve) => { resolveAuthStatus = resolve; });
    const onAuthStatus = (status) => {
      if (!status || !["none", "account", "api_key", "gateway", "external"].includes(status.kind)) return;
      authStatusKind = status.kind;
      resolveAuthStatus();
      if (connected && status.kind === "none") abort();
    };
    const abort = () => stopAcpChild(child);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT" });
      child = await spawnAcpChild(spawnImpl, command, cwd);
      // Correlate transient Windows consoles with adapter connections without
      // logging command arguments, environment variables or credential paths.
      const processDiagnostic = (event, details = {}) => {
        try { options.onProcessDiagnostic?.({ event, requestId, pid: child.pid, ...details }); } catch { /* diagnostics are optional */ }
      };
      processDiagnostic("spawned");
      child.once("exit", (code, signal) => processDiagnostic("exited", { code, signal }));
      if (signal?.aborted) throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT" });
      // Drain stderr even when no logger is configured. Bound each connection's
      // diagnostic output and sanitize before crossing into the log callback.
      const secretValues = [
        ...Object.entries({ ...process.env, ...(typeof command === "object" ? command.env : {}) }),
        ...mcpServers.flatMap((server) => (server.env ?? []).map(({ name, value }) => [name, value])),
      ].filter(([key, value]) => /key|token|secret|password|credential|authorization/i.test(key) && typeof value === "string" && value.length > 0)
        .map(([, value]) => value).sort((a, b) => b.length - a.length);
      let diagnosticBytes = 0;
      let stderrBuffer = "";
      const recordStderr = (line) => {
        if (!line.trim() || diagnosticBytes >= 16_384) return;
        diagnosticBytes += Buffer.byteLength(line);
        for (const secret of secretValues) line = line.split(secret).join("[redacted]");
        try { options.onDiagnostic?.({ requestId, message: sanitizeFailureDetail(line) }); } catch { /* diagnostics are optional */ }
      };
      child.stderr?.setEncoding?.("utf8");
      child.stderr?.on("data", (chunk) => {
        if (diagnosticBytes >= 16_384) return;
        stderrBuffer += String(chunk);
        let newline;
        while ((newline = stderrBuffer.indexOf("\n")) !== -1) {
          recordStderr(stderrBuffer.slice(0, newline));
          stderrBuffer = stderrBuffer.slice(newline + 1);
        }
        // Never log a partial line: a secret can span pipe chunks.
        if (stderrBuffer.length > 16_384) { stderrBuffer = ""; diagnosticBytes = 16_384; }
      });
      child.stderr?.on("end", () => { recordStderr(stderrBuffer); stderrBuffer = ""; });
      const stream = acpNdJsonStream(child);
      const connection = new ClientSideConnection(() => createEdgeEverAcpClient(requestId, emit, allowPermissions, onAuthStatus), stream);
      void connection.closed?.catch(() => {});
      const initialized = await connection.initialize(acpInitializeParams(version));
      authMethods = publicAuthMethods(initialized);
      const readCredential = async () => {
        const result = await connection.extMethod("_codebuddy.ai/getUserInfo", {});
        const token = result?.userInfo?.accessToken ?? result?.userInfo?.token;
        // The bundled CLI can restore account metadata without decrypting tokens.
        if (result?.userInfo && !(typeof token === "string" && token)) throw new Error("workbuddy_credentials_unavailable");
        return typeof token === "string" && token ? createHash("sha256").update(token).digest("hex") : null;
      };
      if (verifyWorkBuddy) await readCredential();
      if (authMethodId) {
        if (!authMethods.some((method) => method.id === authMethodId)) throw new Error("invalid_auth_method");
        authenticationPending = true;
        if (authStatusKind === "none") {
          authStatusKind = undefined;
          authStatusReceived = new Promise((resolve) => { resolveAuthStatus = resolve; });
        }
        if (workBuddyAuth) await authenticateWorkBuddy(workBuddyAuth, authMethodId, signal, { readCredential });
        else await connection.authenticate({ methodId: authMethodId });
        authenticationPending = false;
      }
      if (authStatusKind === "none") throw RequestError.authRequired();
      const session = await connection.newSession({ cwd, mcpServers });
      // The extension is pushed asynchronously after initialize. Only agents
      // advertising it must answer; older ACP adapters keep their existing path.
      if (initialized?.agentCapabilities?._meta?.authStatus != null && authStatusKind === undefined) {
        let timer;
        try {
          await Promise.race([
            authStatusReceived,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("identity_status_unavailable")), options.authStatusTimeoutMs ?? 5_500); }),
            connection.closed.then(() => { throw new Error("connection_closed"); }),
          ]);
        } finally { clearTimeout(timer); }
      }
      if (authStatusKind === "none") throw RequestError.authRequired();
      connected = true;
      if (signal?.aborted) throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT" });
      return {
        cwd,
        child,
        connection,
        sessionId: session.sessionId,
        authMethods,
        promptCapabilities: normalizePromptCapabilities(initialized),
        stop: abort,
        authenticationRequired: () => authStatusKind === "none",
      };
    } catch (error) {
      const failure = authStatusKind === "none" && !authenticationPending ? RequestError.authRequired() : error;
      if (authMethods.length && failure && typeof failure === "object") failure.authMethods = authMethods;
      if (authenticationPending && failure && typeof failure === "object") failure.authenticationPending = true;
      await abort();
      await cleanupWorkspace(cwd);
      throw failure;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  };

  const withHandshakeTimeout = async (operation, timeoutMs = handshakeTimeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (controller.signal.aborted && !isAuthRequiredError(error) && error?.code !== "ENOENT") {
        throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT", authMethods: error?.authMethods, authenticationPending: error?.authenticationPending });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    clearAdapterStatus(id) { latestStatus.delete(id); },
    listAdapters(configuredPaths = {}) {
      return ["codex", "claudeCode", "antigravity", "openClaw", "hermesAgent", "grokBuild", "deepseekHarness", "piAgent", "workbuddyCn", "workbuddyIntl"].map((id) => {
        if (installingIds.has(id)) return { ...adapterShell(id), state: "installing", ...(manager?.get(id) ? { managed: true, version: manager.get(id).version } : {}), ...(updateFailures.has(id) ? { updateError: updateFailures.get(id) } : {}) };
        const customPath = configuredPaths[id];
        const resolved = resolveCommand({ id, path: customPath }, { prepareProxy: false });
        return resolved.ok
          ? { ...adapterShell(id), ...(latestStatus.get(id) ?? { state: "not_probed", detail: "not_probed" }), ...(resolved.version ? { version: resolved.version, managed: true } : {}), ...(customPath ? { customPath, managed: false, version: undefined } : {}), ...(!customPath && updateFailures.has(id) ? { updateError: updateFailures.get(id) } : {}) }
          : adapterFromResolution(id, resolved);
      });
    },

    async installAdapter(id, { updateOnly = false } = {}) {
      if (!manager) return { updated: false, reason: "adapter_store_unavailable" };
      if (id === "piAgent" && !localExecutable("pi", resolutionDeps(commandDeps))) return { updated: false, reason: "agent_not_installed" };
      installingIds.add(id);
      try {
        const result = await manager.install(id, async (command) => {
          let connected;
          try {
            const prepared = id === "piAgent" ? withPiPath(command, resolutionDeps(commandDeps))
              : id === "antigravity" ? withAntigravityMacProxy(command, commandDeps) : command;
            connected = await withHandshakeTimeout((signal) => connect(prepared, `install-${id}`, () => {}, signal), 90_000);
            return { ...adapterShell(id), state: "available", promptCapabilities: connected.promptCapabilities, authMethods: connected.authMethods };
          } catch (error) {
            return { ...adapterShell(id), ...failureFields(classifyAcpFailure(error)), ...(isAuthRequiredError(error) ? { authMethods: error.authMethods ?? [] } : {}) };
          } finally {
            if (connected) {
              await connected.stop();
              await cleanupWorkspace(connected.cwd);
            }
          }
        }, { updateOnly });
        if (result.adapter) latestStatus.set(id, result.adapter);
        updateFailures.delete(id);
        return result;
      } catch (error) {
        const reason = sanitizeFailureDetail(`${error.updateStage ? `${error.updateStage}: ` : ""}${error.message ?? error}${error.cause?.code ? ` (${error.cause.code})` : ""}`);
        updateFailures.set(id, reason);
        try { options.onUpdateDiagnostic?.({ id, reason }); } catch { /* diagnostics are optional */ }
        throw new Error(reason);
      } finally {
        installingIds.delete(id);
      }
    },

    async installDetected() {
      if (!manager) return [];
      const detected = options.detectInstalledAgentApps?.() ?? detectInstalledAgentApps();
      const results = [];
      for (const id of detected) {
        if (manager.get(id) || resolveAcpCommand({ id }, commandDeps).ok) continue;
        try {
          results.push({ id, ...await this.installAdapter(id) });
        } catch (error) {
          results.push({ id, updated: false, reason: sanitizeFailureDetail(error) });
        }
      }
      return results;
    },

    async updateInstalled() {
      if (!manager) return [];
      const results = [];
      for (const id of manager.installedIds()) {
        if (id === "piAgent" && !localExecutable("pi", resolutionDeps(commandDeps))) continue;
        try {
          const result = await this.installAdapter(id, { updateOnly: true });
          results.push({ id, ...result });
        } catch (error) {
          const reason = sanitizeFailureDetail(error);
          results.push({ id, updated: false, reason });
        }
      }
      return results;
    },

    async pruneAdapters() {
      await manager?.prune();
    },

    async probeAdapter(input) {
      const id = input?.id;
      if (!Object.hasOwn(ADAPTERS, id)) throw new Error("unknown_adapter");
      const resolved = resolveCommand(input);
      if (!resolved.ok) return adapterFromResolution(id, resolved);
      let connected;
      try {
        connected = await withHandshakeTimeout((signal) => connect(resolved.command, `probe-${id}`, () => {}, signal, undefined, [], false, null, id === "workbuddyCn" || id === "workbuddyIntl"));
      } catch (error) {
        const failure = { ...adapterShell(id), ...failureFields(classifyAcpFailure(error)), ...(error.authMethods?.length ? { authMethods: error.authMethods } : {}), ...(resolved.version ? { version: resolved.version, managed: true } : {}) };
        latestStatus.set(id, failure);
        return failure;
      }
      const adapter = {
        ...adapterShell(id),
        state: "available",
        promptCapabilities: connected.promptCapabilities,
        authMethods: connected.authMethods,
        ...(resolved.version ? { version: resolved.version, managed: true } : {}),
      };
      latestStatus.set(id, adapter);
      await connected.stop();
      await cleanupWorkspace(connected.cwd);
      return adapter;
    },

    async authenticateAdapter(input) {
      const id = input?.id;
      if (!Object.hasOwn(ADAPTERS, id)) throw new Error("unknown_adapter");
      if (typeof input.methodId !== "string" || !input.methodId || input.methodId.length > 120) throw new Error("invalid_auth_method");
      const resolved = resolveCommand(input);
      if (!resolved.ok) return adapterFromResolution(id, resolved);
      let connected;
      try {
        connected = await withHandshakeTimeout(async (signal) => {
          const workBuddyAuth = id === "workbuddyCn" || id === "workbuddyIntl" ? await prepareWorkBuddyAuth(resolved.command) : null;
          return connect(workBuddyAuth?.command ?? resolved.command, `auth-${id}`, () => {}, signal, input.methodId, [], false, workBuddyAuth);
        }, authenticationTimeoutMs);
        if (id === "workbuddyCn" || id === "workbuddyIntl") {
          await connected.stop();
          await cleanupWorkspace(connected.cwd);
          connected = null;
          // Login is useful only if a fresh chat process can restore credentials.
          connected = await withHandshakeTimeout((signal) => connect(resolved.command, `auth-check-${id}`, () => {}, signal, undefined, [], false, null, true));
        }
        const adapter = { ...adapterShell(id), state: "available", promptCapabilities: connected.promptCapabilities, authMethods: connected.authMethods, ...(resolved.version ? { version: resolved.version, managed: true } : {}) };
        latestStatus.set(id, adapter);
        return adapter;
      } catch (error) {
        const timedOut = error?.code === "TIMEOUT" && error?.authenticationPending;
        const adapter = {
          ...adapterShell(id),
          ...(timedOut ? { state: "needs_login", detail: "authentication_timeout" } : error?.message === "authentication_failed" ? { state: "needs_login", detail: "authentication_failed" } : failureFields(classifyAcpFailure(error))),
          ...(error.authMethods?.length || timedOut || isAuthRequiredError(error) ? { authMethods: error.authMethods ?? latestStatus.get(id)?.authMethods ?? [] } : {}),
          ...(resolved.version ? { version: resolved.version, managed: true } : {}),
        };
        latestStatus.set(id, adapter);
        return adapter;
      } finally {
        if (connected) {
          await connected.stop();
          await cleanupWorkspace(connected.cwd);
        }
      }
    },

    async prompt(input, emit = () => {}) {
      if (!input || typeof input !== "object" || typeof input.prompt !== "string") throw new Error("invalid_prompt");
      if (!Object.hasOwn(ADAPTERS, input.adapterId)) throw new Error("unknown_adapter");
      const requestId = randomUUID();
      const notify = (event) => emit(event);
      const fail = (message) => {
        notify({ requestId, type: "error", message });
        return { requestId };
      };
      const resolved = resolveCommand({ id: input.adapterId, path: input.path });
      if (!resolved.ok) return fail(promptFailureMessage(resolved));
      const customPath = input.adapterId === "antigravity" && typeof input.path === "string" ? input.path.trim() : "";
      const rememberPromptStatus = (fields) => latestStatus.set(input.adapterId, {
        ...adapterShell(input.adapterId),
        ...fields,
        ...(customPath ? { customPath } : {}),
      });

      let connected;
      let mcpBridge;
      try {
        // OpenClaw's ACP Gateway bridge rejects session-scoped MCP servers.
        if (options.mcpAccess && input.noteAccess !== false && input.adapterId !== "openClaw") {
          const access = await options.mcpAccess();
          mcpBridge = await (options.startMcpBridge ?? startAcpMcpBridge)(access);
        }
      } catch (error) {
        return fail(promptFailureMessage(classifyAcpFailure(error)));
      }
      try {
        connected = await withHandshakeTimeout((signal) => connect(
          resolved.command, requestId, notify, signal, undefined,
          mcpBridge ? [mcpServerFor(mcpBridge)] : [], true, null, input.adapterId === "workbuddyCn" || input.adapterId === "workbuddyIntl",
        ));
        rememberPromptStatus({
          state: "available",
          authMethods: connected.authMethods,
          promptCapabilities: connected.promptCapabilities,
        });
      } catch (error) {
        const failure = classifyAcpFailure(error);
        rememberPromptStatus({
          ...failureFields(failure),
          ...(failure.state === "needs_login" ? { authMethods: error.authMethods ?? [] } : {}),
        });
        await mcpBridge?.close();
        return fail(promptFailureMessage(failure));
      }

      let content;
      try {
        content = buildPromptContent({
          prompt: input.prompt,
          contextText: input.contextText,
          attachments: input.attachments,
          promptCapabilities: connected.promptCapabilities,
          // Codex derives its thread title from the start of the first user turn.
          promptFirst: input.adapterId === "codex",
        });
        if (mcpBridge) {
          content.blocks.splice(input.adapterId === "codex" ? 1 : 0, 0, {
            type: "text",
            text: "For EdgeEver note operations in this conversation, use only the session-provided MCP server named edgeever-current-workspace. It is connected to the account currently signed in to EdgeEver. Ignore any EdgeEver MCP server from your persistent configuration, which may target a different instance or account. For a request to generate a poster or 海报笔记, use create_poster_memo with concise copy; it produces the actual editable poster type. Never manually encode poster source, inspect local files to discover the format, or substitute poster-style Markdown. If the tool is unavailable or fails, report that clearly. To query posters, use search_memos or list_memos with poster=true rather than searching the title for 海报. For detailed design, read get_poster_capabilities for valid fields, fonts, platform sizes and operations. Read and edit a poster with get_poster then update_poster. apply_template replaces the layout and must be requested. get_poster_preview and export_poster provide saved previews and editable source, not fresh rendering. Request new PNG rendering or a full browser template with request_poster_render and expectedRevision; an online desktop/Web client handles it. Query get_poster_render_job no faster than every 5 seconds; only completed means rendered, then get_poster_preview. Pending means waiting for a client; report that honestly. Delete exact queried IDs with trash_memos; restore them with restore_memos. When you create a note, include a clickable Markdown link to it in your final answer: [note title](#memo=exact_memo_id_from_tool_result). Do not show the note ID as plain text or use an https://edgeever.ai/memo/ URL; that URL opens an external website instead of the current workspace.",
          });
        }
      } catch (error) {
        await connected.stop();
        await cleanupWorkspace(connected.cwd);
        await mcpBridge?.close();
        return fail(promptFailureMessage(classifyAcpFailure(error)));
      }

      const session = {
        cancelled: false,
        settled: false,
        ...connected,
        mcpBridge,
      };
      active.set(requestId, session);
      const finish = (event) => {
        if (session.settled) return;
        session.settled = true;
        notify(event);
        active.delete(requestId);
        void session.stop().then(() => cleanupWorkspace(session.cwd));
        void session.mcpBridge?.close();
      };
      void connected.connection.prompt({ sessionId: connected.sessionId, prompt: content.blocks }).then((result) => {
        if (session.cancelled) return finish({ requestId, type: "done" });
        const failure = connected.authenticationRequired() ? "needs_login" : promptResultFailure(result);
        if (failure === "needs_login") {
          rememberPromptStatus({ state: "needs_login", authMethods: connected.authMethods });
        }
        finish(failure ? { requestId, type: "error", message: failure } : { requestId, type: "done" });
      }).catch((error) => {
        if (session.cancelled) finish({ requestId, type: "done" });
        else {
          const failure = connected.authenticationRequired() ? { state: "needs_login" } : classifyAcpFailure(error);
          if (failure.state === "needs_login") {
            rememberPromptStatus({ state: "needs_login", authMethods: connected.authMethods });
          }
          finish({ requestId, type: "error", message: promptFailureMessage(failure) });
        }
      });
      return { requestId, rejectedAttachments: content.rejectedAttachments };
    },

    async cancel(requestId) {
      const session = active.get(requestId);
      if (!session) return { ok: true };
      session.cancelled = true;
      try {
        if (session.connection && session.sessionId) await session.connection.cancel({ sessionId: session.sessionId });
      } catch {
        // The process may already be gone. Killing it is enough.
      }
      await session.stop();
      void session.mcpBridge?.close();
      return { ok: true };
    },
  };
}

const failureFields = (failure) => (
  failure.state === "failed"
    ? { state: "failed", detail: failure.detail || "connection_failed" }
    : { state: failure.state }
);

export function registerAcpIpc(ipcMain, runtime = createAcpHostRuntime(), {
  allowInstall = () => false, allowPrompt = allowInstall,
  adapterPathStore = { get: async () => null, set: async () => {} },
  chooseAdapterPath = async () => null,
  validateAdapterPath = validateTrustedAcpPath,
} = {}) {
  let choosing = false;
  const withRecordedPath = async (input) => {
    const recorded = (input?.id ?? input?.adapterId) === "antigravity" ? await adapterPathStore.get() : null;
    return { ...input, path: recorded ? await validateAdapterPath(recorded) : undefined };
  };
  const send = (sender, event) => {
    if (!sender || sender.isDestroyed?.()) return;
    sender.send("desktop:acp-event", event);
  };
  ipcMain.handle("desktop:acp-list", async (event) => {
    if (!allowPrompt(event.sender, event)) throw new Error("acp_list_forbidden");
    const recorded = await adapterPathStore.get();
    return runtime.listAdapters({ antigravity: recorded }).map((adapter) => adapter.id === "antigravity" && recorded
      ? { ...adapter, customPath: recorded } : adapter);
  });
  ipcMain.handle("desktop:acp-choose-path", async (event, id) => {
    if (!allowInstall(event.sender, event) || id !== "antigravity") throw new Error("adapter_path_forbidden");
    if (choosing || event.sender.isFocused?.() !== true) return null;
    choosing = true;
    try {
      const selected = await chooseAdapterPath();
      if (!selected) return null;
      await adapterPathStore.set(selected);
      runtime.clearAdapterStatus?.("antigravity");
      return selected;
    } finally { choosing = false; }
  });
  ipcMain.handle("desktop:acp-probe", async (event, input) => {
    if (!allowPrompt(event.sender, event)) throw new Error("acp_probe_forbidden");
    return runtime.probeAdapter(await withRecordedPath(input));
  });
  ipcMain.handle("desktop:acp-install", async (event, id) => {
    if (!allowInstall(event.sender, event)) throw new Error("adapter_install_forbidden");
    const result = await runtime.installAdapter(id);
    if (id === "antigravity" && result.updated) await adapterPathStore.set(null);
    return result;
  });
  ipcMain.handle("desktop:acp-authenticate", async (event, input) => {
    if (!allowInstall(event.sender, event)) throw new Error("adapter_auth_forbidden");
    return runtime.authenticateAdapter(await withRecordedPath(input));
  });
  ipcMain.handle("desktop:acp-prompt", async (event, input) => {
    if (!allowPrompt(event.sender, event)) throw new Error("acp_prompt_forbidden");
    return runtime.prompt(await withRecordedPath(input), (acpEvent) => send(event.sender, acpEvent));
  });
  ipcMain.handle("desktop:acp-cancel", (event, requestId) => {
    if (!allowPrompt(event.sender, event)) throw new Error("acp_cancel_forbidden");
    return runtime.cancel(requestId);
  });
  return runtime;
}
