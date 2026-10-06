import { spawn as nodeSpawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import { waitForChildProcessSpawn } from "./child-process-start.mjs";
import { createAcpAdapterManager } from "./acp-adapter-manager.mjs";
import { startAcpMcpBridge } from "./acp-mcp-bridge.mjs";
import { withAntigravityMacProxy } from "./antigravity-proxy.mjs";

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
      return { ok: true, command: workBuddyCommand(deps.executablePath, actual, id) };
    } catch { /* Try another installed WorkBuddy application. */ }
  }
  const external = findOnPath(deps.platform === "win32" ? ["codebuddy.exe"] : ["codebuddy"], deps);
  return external
    ? { ok: true, command: workBuddyCommand(external, null, id) }
    : { ok: false, state: "not_installed" };
}

function workBuddyCommand(executablePath, bundledCli, id) {
  const edition = id === "workbuddyCn" ? { CODEBUDDY_INTERNET_ENVIRONMENT: "internal" } : {};
  return bundledCli
    ? { command: executablePath, args: [bundledCli, "--acp"], env: { ...edition, ELECTRON_RUN_AS_NODE: "1" }, ...(id === "workbuddyIntl" ? { unsetEnv: ["CODEBUDDY_INTERNET_ENVIRONMENT"] } : {}) }
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
  const home = homedir();
  if (home && home !== "/" && home !== "\\") text = text.split(home).join("[path]");
  text = text.replace(/~\/[^\s]+/g, "[path]");
  text = text.replace(/(?:\/[\w.+@-]+){2,}/g, "[path]");
  text = text.replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, "[path]");
  text = text.replace(/\b(?:[A-Za-z0-9_]*(?:key|token|secret|password|credential)[A-Za-z0-9_]*)=[^\s]+/gi, "[redacted]");
  text = text.replace(/\b(?:bearer|authorization)\s+[^\s]+/gi, "[redacted]");
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
      stdio: ["pipe", "pipe", "ignore"],
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
  const options = { ...plan.options, shell: false, stdio: ["pipe", "pipe", "ignore"] };
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
  await rmImpl(resolved, { recursive: true, force: true });
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

const createEdgeEverAcpClient = (requestId, emit, allowPermissions) => ({
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

function stopChild(child) {
  if (!child) return;
  const killTimer = setTimeout(() => {
    if (child.exitCode == null) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
  }, 500);
  killTimer.unref?.();
  child.once?.("exit", () => clearTimeout(killTimer));
  try { child.stdin?.destroy(); } catch { /* closed */ }
  try { child.kill("SIGTERM"); } catch { /* already gone */ }
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
  const version = options.clientVersion ?? clientVersion();
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const commandDeps = options;
  const manager = options.adapterManager ?? (options.adapterStore ? createAcpAdapterManager({ root: options.adapterStore, executablePath: options.executablePath }) : null);
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

  const connect = async (command, requestId, emit, signal, authMethodId, mcpServers = [], allowPermissions = false) => {
    const cwd = await createAcpWorkspace(mkdtempImpl, options.tmpRoot);
    let child = null;
    let authMethods = [];
    const abort = () => stopChild(child);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT" });
      child = await spawnAcpChild(spawnImpl, command, cwd);
      if (signal?.aborted) throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT" });
      const stream = acpNdJsonStream(child);
      const connection = new ClientSideConnection(() => createEdgeEverAcpClient(requestId, emit, allowPermissions), stream);
      void connection.closed?.catch(() => {});
      const initialized = await connection.initialize(acpInitializeParams(version));
      authMethods = publicAuthMethods(initialized);
      if (authMethodId) {
        if (!authMethods.some((method) => method.id === authMethodId)) throw new Error("invalid_auth_method");
        await connection.authenticate({ methodId: authMethodId });
      }
      const session = await connection.newSession({ cwd, mcpServers });
      if (signal?.aborted) throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT" });
      return {
        cwd,
        child,
        connection,
        sessionId: session.sessionId,
        authMethods,
        promptCapabilities: normalizePromptCapabilities(initialized),
        stop: abort,
      };
    } catch (error) {
      if (authMethods.length && error && typeof error === "object") error.authMethods = authMethods;
      abort();
      await removeAcpWorkspace(cwd, rmImpl);
      throw error;
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
        throw Object.assign(new Error("connection_timeout"), { code: "TIMEOUT" });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    listAdapters() {
      return ["codex", "claudeCode", "antigravity", "openClaw", "hermesAgent", "grokBuild", "deepseekHarness", "piAgent", "workbuddyCn", "workbuddyIntl"].map((id) => {
        if (installingIds.has(id)) return { ...adapterShell(id), state: "installing" };
        const resolved = resolveCommand({ id }, { prepareProxy: false });
        return resolved.ok
          ? { ...adapterShell(id), ...(latestStatus.get(id) ?? { state: "failed", detail: "not_probed" }), ...(resolved.version ? { version: resolved.version, managed: true } : {}), ...(updateFailures.has(id) ? { updateError: updateFailures.get(id) } : {}) }
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
              connected.stop();
              await removeAcpWorkspace(connected.cwd, rmImpl);
            }
          }
        }, { updateOnly });
        if (result.adapter) latestStatus.set(id, result.adapter);
        return result;
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
          updateFailures.delete(id);
          results.push({ id, ...result });
        } catch (error) {
          const reason = sanitizeFailureDetail(error);
          updateFailures.set(id, reason);
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
        connected = await withHandshakeTimeout((signal) => connect(resolved.command, `probe-${id}`, () => {}, signal));
      } catch (error) {
        const failure = { ...adapterShell(id), ...failureFields(classifyAcpFailure(error)), ...(isAuthRequiredError(error) ? { authMethods: error.authMethods ?? [] } : {}), ...(resolved.version ? { version: resolved.version, managed: true } : {}) };
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
      connected.stop();
      await removeAcpWorkspace(connected.cwd, rmImpl);
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
        connected = await withHandshakeTimeout((signal) => connect(resolved.command, `auth-${id}`, () => {}, signal, input.methodId), 5 * 60_000);
        const adapter = { ...adapterShell(id), state: "available", promptCapabilities: connected.promptCapabilities, authMethods: connected.authMethods, ...(resolved.version ? { version: resolved.version, managed: true } : {}) };
        latestStatus.set(id, adapter);
        return adapter;
      } catch (error) {
        return { ...adapterShell(id), ...failureFields(classifyAcpFailure(error)), ...(isAuthRequiredError(error) ? { authMethods: error.authMethods ?? [] } : {}), ...(resolved.version ? { version: resolved.version, managed: true } : {}) };
      } finally {
        if (connected) {
          connected.stop();
          await removeAcpWorkspace(connected.cwd, rmImpl);
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

      let connected;
      let mcpBridge;
      try {
        // OpenClaw's ACP Gateway bridge rejects session-scoped MCP servers.
        if (options.mcpAccess && input.noteAccess !== false && input.adapterId !== "openClaw") {
          const access = await options.mcpAccess();
          mcpBridge = await (options.startMcpBridge ?? startAcpMcpBridge)(access);
        }
        connected = await withHandshakeTimeout((signal) => connect(
          resolved.command, requestId, notify, signal, undefined,
          mcpBridge ? [mcpServerFor(mcpBridge)] : [], true,
        ));
      } catch (error) {
        await mcpBridge?.close();
        return fail(promptFailureMessage(classifyAcpFailure(error)));
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
            text: "For EdgeEver note operations in this conversation, use only the session-provided MCP server named edgeever-current-workspace. It is connected to the account currently signed in to EdgeEver. Ignore any EdgeEver MCP server from your persistent configuration, which may target a different instance or account. When you create a note, include a clickable Markdown link to it in your final answer: [note title](#memo=exact_memo_id_from_tool_result). Do not show the note ID as plain text or use an https://edgeever.ai/memo/ URL; that URL opens an external website instead of the current workspace.",
          });
        }
      } catch (error) {
        connected.stop();
        await removeAcpWorkspace(connected.cwd, rmImpl);
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
        session.stop();
        active.delete(requestId);
        void removeAcpWorkspace(session.cwd, rmImpl);
        void session.mcpBridge?.close();
      };
      void connected.connection.prompt({ sessionId: connected.sessionId, prompt: content.blocks }).then((result) => {
        if (session.cancelled) return finish({ requestId, type: "done" });
        const failure = promptResultFailure(result);
        if (failure === "needs_login") {
          latestStatus.set(input.adapterId, { ...adapterShell(input.adapterId), state: "needs_login", authMethods: connected.authMethods });
        }
        finish(failure ? { requestId, type: "error", message: failure } : { requestId, type: "done" });
      }).catch((error) => {
        if (session.cancelled) finish({ requestId, type: "done" });
        else {
          const failure = classifyAcpFailure(error);
          if (failure.state === "needs_login") {
            latestStatus.set(input.adapterId, { ...adapterShell(input.adapterId), state: "needs_login", authMethods: connected.authMethods });
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
      session.stop();
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

export function registerAcpIpc(ipcMain, runtime = createAcpHostRuntime(), { allowInstall = () => false, allowPrompt = allowInstall } = {}) {
  const send = (sender, event) => {
    if (!sender || sender.isDestroyed?.()) return;
    sender.send("desktop:acp-event", event);
  };
  ipcMain.handle("desktop:acp-list", () => runtime.listAdapters());
  ipcMain.handle("desktop:acp-probe", (_event, input) => runtime.probeAdapter(input));
  ipcMain.handle("desktop:acp-install", (event, id) => {
    if (!allowInstall(event.sender)) throw new Error("adapter_install_forbidden");
    return runtime.installAdapter(id);
  });
  ipcMain.handle("desktop:acp-authenticate", (event, input) => {
    if (!allowInstall(event.sender)) throw new Error("adapter_auth_forbidden");
    return runtime.authenticateAdapter(input);
  });
  ipcMain.handle("desktop:acp-prompt", (event, input) => {
    if (!allowPrompt(event.sender)) throw new Error("acp_prompt_forbidden");
    return runtime.prompt(input, (acpEvent) => send(event.sender, acpEvent));
  });
  ipcMain.handle("desktop:acp-cancel", (event, requestId) => {
    if (!allowPrompt(event.sender)) throw new Error("acp_cancel_forbidden");
    return runtime.cancel(requestId);
  });
  return runtime;
}
