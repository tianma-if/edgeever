import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RequestError } from "@agentclientprotocol/sdk";
import {
  acpInitializeParams,
  automaticAcpPermissionResponse,
  buildPromptContent,
  classifyAcpFailure,
  createAcpHostRuntime,
  createAcpSpawnPlan,
  detectInstalledAgentApps,
  eventsFromSessionUpdate,
  isAuthRequiredError,
  promptResultFailure,
  registerAcpIpc,
  resolveAcpCommand,
  sanitizeFailureDetail,
  spawnAcpChild,
} from "./acp-host.mjs";

const require = createRequire(import.meta.url);
const sdkHref = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
const home = path.resolve(homedir());

const encode = (value) => Buffer.from(value).toString("base64");

test("classifies ACP prompt refusals without exposing vendor error details", () => {
  expect(promptResultFailure({ stopReason: "end_turn" })).toBeNull();
  expect(promptResultFailure({ stopReason: "refusal" })).toBe("agent_refused");
  expect(promptResultFailure({ stopReason: "refusal", _meta: { "codebuddy.ai/errorMessage": "not-json" } })).toBe("agent_refused");
  expect(promptResultFailure({ stopReason: "refusal", _meta: { "codebuddy.ai/errorMessage": JSON.stringify({ data: { category: "auth" }, message: "private detail" }) } })).toBe("needs_login");
});

test("ACP tool permissions automatically select a one-time allow option", () => {
  const options = [
    { optionId: "always", kind: "allow_always" },
    { optionId: "once", kind: "allow_once" },
    { optionId: "deny", kind: "reject_once" },
  ];
  expect(automaticAcpPermissionResponse({ options })).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
  expect(automaticAcpPermissionResponse({ options: options.filter((option) => option.kind !== "allow_once") }))
    .toEqual({ outcome: { outcome: "selected", optionId: "always" } });
  expect(automaticAcpPermissionResponse({ options: [{ optionId: "deny", kind: "reject_once" }] }))
    .toEqual({ outcome: { outcome: "cancelled" } });
  expect(automaticAcpPermissionResponse({ options: [{ optionId: "", kind: "allow_once" }] }))
    .toEqual({ outcome: { outcome: "cancelled" } });
});

const collector = () => {
  const events = [];
  let waiters = [];
  return {
    events,
    emit(event) {
      events.push(event);
      waiters = waiters.filter((waiter) => {
        if (!waiter.predicate(event)) return true;
        waiter.resolve(event);
        return false;
      });
    },
    waitFor(predicate, timeout = 5000) {
      const found = events.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out; saw ${events.map((event) => event.type).join(",") || "nothing"}`));
        }, timeout);
        waiters.push({
          predicate,
          resolve: (event) => {
            clearTimeout(timer);
            resolve(event);
          },
        });
      });
    },
  };
};

const fakeAgentSource = ({ reportPath, secretPath, allowImage, allowEmbedded, hold, requireAuth, advertiseAuth, promptRefusal }) => `#!/usr/bin/env bun
import * as acp from ${JSON.stringify(sdkHref)};
import { writeFileSync } from "node:fs";

const reportPath = ${JSON.stringify(reportPath)};
const secretPath = ${JSON.stringify(secretPath)};
const allowImage = ${allowImage ? "true" : "false"};
const allowEmbedded = ${allowEmbedded ? "true" : "false"};
const hold = ${hold ? "true" : "false"};
const requireAuth = ${requireAuth ? "true" : "false"};
const advertiseAuth = ${advertiseAuth ? "true" : "false"};
const promptRefusal = ${promptRefusal ? JSON.stringify(promptRefusal) : "null"};
let authenticated = false;
const report = { initialize: null, newSession: null, permission: null, readError: null, readResult: null, prompt: null, authMethod: null };
const save = () => writeFileSync(reportPath, JSON.stringify(report));
writeFileSync(reportPath + ".pid", String(process.pid));
let releaseHold = () => {};
const released = new Promise((resolve) => {
  releaseHold = resolve;
});

const stream = acp.ndJsonStream(
  new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        process.stdout.write(Buffer.from(chunk), (error) => (error ? reject(error) : resolve()));
      });
    },
  }),
  new ReadableStream({
    start(controller) {
      process.stdin.on("data", (chunk) => {
        const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
        try { controller.enqueue(bytes); } catch { /* closed */ }
      });
      process.stdin.on("end", () => {
        try { controller.close(); } catch { /* already closed */ }
      });
      process.stdin.on("error", (error) => {
        try { controller.error(error); } catch { /* already closed */ }
      });
    },
  }),
);

acp.agent({ name: "edgeever-fake-agent" })
  .onRequest("initialize", (ctx) => {
    report.initialize = ctx.params;
    save();
    return {
      protocolVersion: ctx.params.protocolVersion,
      agentCapabilities: { promptCapabilities: { image: allowImage, embeddedContext: allowEmbedded } },
      authMethods: requireAuth || advertiseAuth ? [{ id: "browser", name: "Browser" }] : [],
    };
  })
  .onRequest("authenticate", (ctx) => {
    report.authMethod = ctx.params.methodId;
    authenticated = true;
    save();
    return {};
  })
  .onRequest("session/new", (ctx) => {
    if (requireAuth && !authenticated) throw new acp.RequestError(-32000, "auth_required");
    report.newSession = { cwd: ctx.params.cwd, mcpServers: ctx.params.mcpServers };
    save();
    return { sessionId: "sess-1" };
  })
  .onRequest("session/prompt", async (ctx) => {
    report.prompt = ctx.params.prompt;
    save();
    if (promptRefusal) return promptRefusal;
    await ctx.client.notify("session/update", {
      sessionId: ctx.params.sessionId,
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } },
    });
    await ctx.client.notify("session/update", {
      sessionId: ctx.params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello from agent" } },
    });
    await ctx.client.notify("session/update", {
      sessionId: ctx.params.sessionId,
      update: { sessionUpdate: "tool_call", toolCallId: "call_1", name: "search", title: "Search notes", status: "pending" },
    });
    if (!hold) {
      try {
        const result = await ctx.client.request("fs/read_text_file", { sessionId: ctx.params.sessionId, path: secretPath });
        report.readResult = result?.content ?? result ?? null;
      } catch (error) {
        report.readError = error instanceof Error ? error.message : String(error);
        report.readResult = null;
      }
      report.permission = await ctx.client.request("session/request_permission", {
        sessionId: ctx.params.sessionId,
        toolCall: { toolCallId: "call_1", title: "Search notes", status: "pending" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      });
      save();
      return { stopReason: "end_turn" };
    }
    await released;
    return { stopReason: "cancelled" };
  })
  .onNotification("session/cancel", () => {
    releaseHold();
  })
  .connect(stream);
`;

const writeFakeAgent = async (directory, options) => {
  const scriptPath = path.join(directory, "fake-agent.mjs");
  await writeFile(scriptPath, fakeAgentSource(options), "utf8");
  await chmod(scriptPath, 0o755);
  return scriptPath;
};

const waitUntilExited = async (pid) => {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`process ${pid} is still running`);
};

describe("ACP command allow-list", () => {
  test("rejects relative paths and basenames that contain a slash", () => {
    for (const configured of ["codex-acp/evil", "bin\\codex-acp", "../codex-acp", "./codex-acp"]) {
      const result = resolveAcpCommand({ id: "codex", path: configured }, { pathEnv: "", platform: "darwin" });
      expect(result.ok).toBe(false);
      expect(result.detail).toBe("invalid_path");
      expect(JSON.stringify(result)).not.toContain(configured);
    }
    expect(resolveAcpCommand({ id: "antigravity", path: "agy" }).ok).toBe(false);
    expect(resolveAcpCommand({ id: "antigravity", path: "relative/agy" }).detail).toBe("invalid_path");
    expect(resolveAcpCommand({ id: "antigravity", path: "../agy" }).detail).toBe("invalid_path");
    expect(JSON.stringify(resolveAcpCommand({ id: "antigravity", path: "/tmp/../agy" }))).not.toContain("/tmp/../agy");
  });

  test("lists Codex from PATH presence without marking it available", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-path-"));
    try {
      const binary = path.join(directory, "codex-acp");
      await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const present = createAcpHostRuntime({ pathEnv: directory, platform: "darwin", sep: path.sep, delimiter: path.delimiter });
      const listed = present.listAdapters();
      expect(listed.find((adapter) => adapter.id === "codex")).toEqual({
        id: "codex",
        label: "Codex",
        state: "failed",
        detail: "not_probed",
      });
      expect(listed.find((adapter) => adapter.id === "antigravity")?.state).toBe("not_installed");
      expect(JSON.stringify(listed)).not.toContain(directory);

      const missing = createAcpHostRuntime({ pathEnv: "", platform: "darwin" });
      expect(missing.listAdapters().find((adapter) => adapter.id === "codex")?.state).toBe("not_installed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("detects installed agent applications separately from ACP connectors", () => {
    const detected = detectInstalledAgentApps({
      platform: "darwin",
      home: "/Users/example",
      pathEnv: "",
      access() { throw new Error("not on PATH"); },
      exists(candidate) { return candidate === "/Applications/Antigravity.app" || candidate === "/Applications/ChatGPT.app/Contents/Resources/codex"; },
    });
    expect(detected).toEqual(["codex", "antigravity"]);
  });

  test("starts the official DeepSeek ACP profile and uses a separate adapter for pi", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-new-agents-"));
    try {
      const bin = path.join(directory, "bin");
      await mkdir(bin);
      const pi = path.join(bin, "pi");
      const piAcp = path.join(bin, "pi-acp");
      const dsh = path.join(bin, "dsh");
      await writeFile(pi, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await writeFile(piAcp, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await writeFile(dsh, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const deps = { platform: "darwin", pathEnv: bin, home: directory, executablePath: "/usr/bin/node" };
      expect(resolveAcpCommand({ id: "deepseekHarness" }, deps).command).toEqual({ command: realpathSync(dsh), args: ["--profile", "acp"] });
      expect(resolveAcpCommand({ id: "piAgent" }, deps).command).toEqual({ command: realpathSync(piAcp), args: [] });
      expect(detectInstalledAgentApps({ platform: "darwin", pathEnv: bin, home: directory })).toContain("piAgent");
      const localBin = path.join(directory, ".local", "bin");
      await mkdir(localBin, { recursive: true });
      await writeFile(path.join(localBin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await writeFile(path.join(localBin, "pi-acp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const fallback = resolveAcpCommand({ id: "piAgent" }, { ...deps, pathEnv: "" });
      expect(fallback.command.env.PATH.startsWith(`${localBin}:`)).toBe(true);
      await rm(piAcp);
      await rm(path.join(localBin, "pi-acp"));
      expect(resolveAcpCommand({ id: "piAgent" }, deps)).toMatchObject({ ok: false, detail: "adapter_missing" });
      await rm(pi);
      await rm(path.join(localBin, "pi"));
      expect(resolveAcpCommand({ id: "piAgent" }, deps)).toMatchObject({ ok: false, state: "not_installed" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("resolves the three additional ACP entry points from installed commands", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-extra-"));
    try {
      for (const name of ["claude-agent-acp", "openclaw", "hermes"]) {
        await writeFile(path.join(directory, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      }
      const deps = { platform: "darwin", pathEnv: directory, home: directory };
      expect(resolveAcpCommand({ id: "claudeCode" }, deps).command).toMatchObject({ command: realpathSync(path.join(directory, "claude-agent-acp")), args: [] });
      expect(resolveAcpCommand({ id: "openClaw" }, deps).command).toMatchObject({ command: realpathSync(path.join(directory, "openclaw")), args: ["acp"] });
      expect(resolveAcpCommand({ id: "hermesAgent" }, deps).command).toMatchObject({ command: realpathSync(path.join(directory, "hermes")), args: ["acp"] });
      expect(resolveAcpCommand({ id: "openClaw" }, deps).command.env.PATH).toContain(path.join(directory, ".local", "bin"));
      expect(resolveAcpCommand({ id: "openClaw" }, { ...deps, pathEnv: "" }).state).toBe("not_installed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("automatically installs only a detected agent missing its ACP connector", async () => {
    let installed = false;
    let installs = 0;
    const runtime = createAcpHostRuntime({
      platform: "darwin",
      pathEnv: "",
      detectInstalledAgentApps: () => ["codex"],
      adapterManager: {
        get: () => installed ? { version: "2.0.1", command: { command: "/tmp/codex-acp", args: [] } } : null,
        install: async () => {
          installs += 1;
          installed = true;
          return { updated: true, version: "2.0.1", adapter: { id: "codex", label: "Codex", state: "available" } };
        },
      },
    });
    expect((await runtime.installDetected())[0]?.updated).toBe(true);
    expect(runtime.listAdapters()[0]?.state).toBe("available");
    expect(await runtime.installDetected()).toEqual([]);
    expect(installs).toBe(1);
  });

  test("looks up codex-acp.exe only as a win32 basename", () => {
    const seen = [];
    resolveAcpCommand({ id: "codex" }, {
      platform: "win32",
      pathEnv: "C:\\Tools",
      delimiter: ";",
      sep: "\\",
      accessSync(candidate) {
        seen.push(candidate);
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    });
    expect(seen).toEqual(["C:\\Tools\\codex-acp", "C:\\Tools\\codex-acp.exe"]);
  });

  test("runs an installed Grok Build CLI through its built-in ACP mode", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-grok-acp-"));
    try {
      const binary = path.join(directory, ".grok", "bin", "grok");
      await mkdir(path.dirname(binary), { recursive: true });
      await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const resolved = resolveAcpCommand({ id: "grokBuild" }, { platform: "darwin", pathEnv: "", home: directory });
      expect(resolved).toEqual({ ok: true, command: { command: realpathSync(binary), args: ["agent", "stdio"] } });
      const runtime = createAcpHostRuntime({ platform: "darwin", pathEnv: "", home: directory });
      expect(runtime.listAdapters().find((adapter) => adapter.id === "grokBuild")?.state).toBe("failed");
      expect(resolveAcpCommand({ id: "grokBuild", path: "../grok" }, { platform: "darwin", home: directory }).detail).toBe("invalid_path");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps WorkBuddy domestic and international ACP authentication environments separate", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-workbuddy-acp-"));
    try {
      const bundled = path.join(directory, "Applications", "WorkBuddy AI.app", "Contents", "Resources", "app.asar.unpacked", "cli", "bin", "codebuddy");
      await mkdir(path.dirname(bundled), { recursive: true });
      await writeFile(bundled, "// fake bundled CLI");
      const deps = {
        platform: "darwin", home: directory, pathEnv: "", executablePath: "/usr/bin/node",
        realpathSync(candidate) {
          if (!candidate.startsWith(directory)) throw new Error("not installed");
          return realpathSync(candidate);
        },
      };
      const domestic = resolveAcpCommand({ id: "workbuddyCn" }, deps);
      const international = resolveAcpCommand({ id: "workbuddyIntl" }, deps);
      expect(domestic.command.args).toEqual([realpathSync(bundled), "--acp"]);
      expect(domestic.command.env.CODEBUDDY_INTERNET_ENVIRONMENT).toBe("internal");
      expect(international.command.args).toEqual([realpathSync(bundled), "--acp"]);
      expect(international.command.unsetEnv).toEqual(["CODEBUDDY_INTERNET_ENVIRONMENT"]);
      expect(createAcpSpawnPlan(international.command, directory).options.env.CODEBUDDY_INTERNET_ENVIRONMENT).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("requires an Antigravity absolute file and does not accept a directory", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-agy-"));
    try {
      const file = path.join(directory, "antigravity-acp");
      await writeFile(file, "", { mode: 0o755 });
      const fileResult = resolveAcpCommand({ id: "antigravity", path: file });
      expect(fileResult).toEqual({ ok: true, command: realpathSync(file) });
      expect(resolveAcpCommand({ id: "antigravity", path: directory })).toMatchObject({ ok: false, detail: "invalid_path" });
      const missing = resolveAcpCommand({ id: "antigravity", path: path.join(directory, "missing-binary") });
      expect(missing).toEqual({ ok: false, state: "not_installed" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("ACP prompt blocks", () => {
  const image = { filename: "pic.png", mediaType: "image/png", dataBase64: encode("png-bytes") };
  const pdf = { filename: "/Users/me/secret.pdf", mediaType: "application/pdf", dataBase64: encode("%PDF-1.7") };
  const note = { filename: "/tmp/notes/body.txt", mediaType: "text/plain", dataBase64: encode("hello notes") };

  test("omits images and PDFs until the agent advertises those capabilities", () => {
    const blocked = buildPromptContent({
      prompt: "go",
      contextText: "ctx",
      attachments: [image, pdf, note, { filename: "song.mp3", mediaType: "audio/mpeg", dataBase64: encode("nope") }],
      promptCapabilities: {},
    });
    expect(blocked.blocks.map((block) => block.type)).toEqual(["text", "text", "text"]);
    expect(blocked.blocks.map((block) => block.text)).toEqual(["ctx", "go", "hello notes"]);
    expect(blocked.rejectedAttachments.map((item) => item.reason)).toEqual([
      "This agent does not accept images.",
      "This agent does not accept embedded files.",
      "This file type is not supported.",
    ]);
    expect(JSON.stringify(blocked.blocks)).not.toContain("/Users/me/secret.pdf");
    expect(JSON.stringify(blocked.blocks)).not.toContain("/tmp/notes/body.txt");
    expect(JSON.stringify(blocked.blocks)).not.toContain("resource_link");
  });

  test("puts a Codex user's request before context for a useful thread title", () => {
    const content = buildPromptContent({ prompt: "分析资金往来", contextText: "Current note and earlier turns", promptFirst: true });
    expect(content.blocks).toEqual([
      { type: "text", text: "分析资金往来" },
      { type: "text", text: "Current note and earlier turns" },
    ]);
  });

  test("includes images and embedded PDFs without a filesystem path", () => {
    const allowed = buildPromptContent({
      prompt: "go",
      attachments: [image, pdf],
      promptCapabilities: { image: true, embeddedContext: true },
    });
    const picture = allowed.blocks.find((block) => block.type === "image");
    const resource = allowed.blocks.find((block) => block.type === "resource");
    expect(picture).toEqual({ type: "image", data: image.dataBase64, mimeType: "image/png" });
    expect(resource.resource.uri).toBe("edgeever-attachment:secret.pdf");
    expect(resource.resource.mimeType).toBe("application/pdf");
    expect(resource.resource.blob).toBe(pdf.dataBase64);
    const serialized = JSON.stringify(allowed.blocks);
    expect(serialized).not.toContain("/Users/me");
    expect(serialized).not.toContain("file:");
    expect(serialized).not.toContain("resource_link");
    expect(allowed.rejectedAttachments).toEqual([]);
  });
});

describe("ACP spawn and failure mapping", () => {
  test("forces shell false and refuses the home directory as cwd", async () => {
    const source = await Bun.file(new URL("./acp-host.mjs", import.meta.url)).text();
    expect(source).toContain("shell: false");
    expect(source).not.toContain("shell: true");
    expect(() => createAcpSpawnPlan("/bin/echo", home)).toThrow(/invalid_workspace/);
    const workspace = await mkdtemp(path.join(tmpdir(), "edgeever-acp-spawn-"));
    const child = new EventEmitter();
    let captured;
    const spawned = spawnAcpChild((command, args, options) => {
      captured = { command, args, options };
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }, "/opt/codex-acp", workspace);
    await spawned;
    expect(captured).toEqual({
      command: "/opt/codex-acp",
      args: [],
      options: expect.objectContaining({ shell: false, cwd: path.resolve(workspace) }),
    });
    expect(captured.options.shell).toBe(false);
    expect(captured.options.stdio).toEqual(["pipe", "pipe", "ignore"]);
    await rm(workspace, { recursive: true, force: true });
  });

  test("maps auth, missing binaries, and strips home paths from details", () => {
    expect(isAuthRequiredError(RequestError.authRequired())).toBe(true);
    expect(isAuthRequiredError(new Error("session failed: auth_required"))).toBe(true);
    expect(isAuthRequiredError(new Error("connection reset"))).toBe(false);
    expect(classifyAcpFailure(Object.assign(new Error(`spawn ${home}/bin ENOENT`), { code: "ENOENT" })).state).toBe("not_installed");
    const detail = sanitizeFailureDetail(new Error(`failed ${home}/.gemini/oauth TOKEN=abc Bearer secret-value`));
    expect(detail).not.toContain(home);
    expect(detail).not.toContain("TOKEN=abc");
    expect(detail).not.toContain("secret-value");
    expect(detail).not.toContain(".gemini");
  });

  test("client capabilities do not enable filesystem or terminal access", () => {
    expect(acpInitializeParams("1.2.3")).toEqual({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "edgeever", version: "1.2.3" },
    });
  });

  test("maps text, reasoning, and tool progress without diff payloads", () => {
    expect(eventsFromSessionUpdate("r1", {
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    })).toEqual([{ requestId: "r1", type: "text-delta", text: "hello" }]);
    expect(eventsFromSessionUpdate("r1", {
      update: { sessionUpdate: "agent_message_chunk", messageId: "message-1", content: { type: "text", text: "hello" } },
    })).toEqual([{ requestId: "r1", type: "text-delta", text: "hello", messageId: "message-1" }]);
    expect(eventsFromSessionUpdate("r1", {
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
    })).toEqual([{ requestId: "r1", type: "reasoning", text: "hmm" }]);
    const tool = eventsFromSessionUpdate("r1", {
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        name: "edit",
        title: "Edit note",
        status: "pending",
        content: [{ type: "diff", path: `${home}/note.md`, oldText: "a", newText: "b" }],
      },
    });
    expect(tool).toEqual([{ requestId: "r1", type: "tool", name: "edit", status: "pending", title: "Edit note" }]);
    expect(JSON.stringify(tool)).not.toContain(home);
    expect(eventsFromSessionUpdate("r1", {
      update: { sessionUpdate: "tool_call", toolCallId: "call_2", title: `${home}/secret`, status: "completed" },
    })).toEqual([{ requestId: "r1", type: "tool", name: "call_2", status: "completed" }]);
  });

  test("forwards generated images without paths, diffs, or non-image payloads", () => {
    const png = Buffer.from("png-bytes").toString("base64");
    const wrapped = `data:image/png;base64,${png.slice(0, 4)}\n${png.slice(4)}`;
    const message = eventsFromSessionUpdate("r1", {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", mimeType: "image/png", data: wrapped, uri: `${home}/cat.png` },
      },
    });
    const again = eventsFromSessionUpdate("r1", {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", mimeType: "image/png", data: png, uri: `file://${home}/cat.png` },
      },
    });
    expect(message).toEqual([{ requestId: "r1", type: "image", id: again[0].id, mediaType: "image/png", base64: png }]);
    expect(message[0].id.startsWith("message:")).toBe(true);
    expect(JSON.stringify(message)).not.toContain(home);
    expect(JSON.stringify(message)).not.toContain("file:");

    const tool = eventsFromSessionUpdate("r1", {
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_img",
        title: "Image generation",
        status: "completed",
        content: [
          { type: "diff", path: `${home}/note.md`, oldText: "a", newText: "b" },
          { type: "content", content: { type: "text", text: `saved ${home}/cat.png` } },
          { type: "content", content: { type: "image", mimeType: "image/jpeg", data: png, uri: `${home}/cat.png` } },
          { type: "content", content: { type: "image", mimeType: "image/svg+xml", data: png } },
          { type: "image", mimeType: "image/webp", data: `${home}/cat.webp` },
        ],
      },
    });
    expect(tool).toEqual([
      { requestId: "r1", type: "tool", name: "call_img", status: "completed", title: "Image generation" },
      { requestId: "r1", type: "image", id: "call_img:0", mediaType: "image/jpeg", base64: png },
    ]);
    expect(JSON.stringify(tool)).not.toContain(home);
    expect(eventsFromSessionUpdate("r1", {
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "image", mimeType: "image/png", data: png } },
    })).toEqual([]);
    expect(eventsFromSessionUpdate("r1", {
      update: { sessionUpdate: "agent_message_chunk", content: { type: "image", mimeType: "image/png", data: "@@@@" } },
    })).toEqual([]);
  });
});

// bun test started at the workspace root drops child stdin and stdout pipes
// (the bytes never arrive). The same processes work when cwd is apps/desktop,
// which is how `bun run test:desktop` runs this file.
const stdioPipesWork = await (async () => {
  const proc = Bun.spawn(["/bin/echo", "ok"], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.includes("ok");
})();
const sessionTest = stdioPipesWork ? test : test.skip;

describe("ACP stdio session", () => {
  const attachments = () => ([
    { filename: "/Users/me/secret.pdf", mediaType: "application/pdf", dataBase64: encode("%PDF-1.7") },
    { filename: "pic.png", mediaType: "image/png", dataBase64: encode("png-bytes") },
  ]);

  const readReport = async (reportPath) => JSON.parse(await readFile(reportPath, "utf8"));

  sessionTest("probes a session, then closes the process", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-probe-"));
    const reportPath = path.join(directory, "report.json");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: true,
        allowEmbedded: true,
        hold: false,
      });
      const wrapper = path.join(directory, "wrap.sh");
      await writeFile(wrapper, `#!/bin/sh\necho RAN > ${JSON.stringify(path.join(directory, "ran.txt"))}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}\n`);
      await chmod(wrapper, 0o755);
      const { spawn } = await import("node:child_process");
      const spawned = [];
      const runtime = createAcpHostRuntime({
        platform: "darwin",
        env: {},
        readProxy: () => "HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : 10808\nHTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 10809\nSOCKSEnable : 1",
        spawnImpl(command, args, options) {
          spawned.push({ command, args, cwd: options.cwd, shell: options.shell, httpProxy: options.env?.HTTP_PROXY, httpsProxy: options.env?.HTTPS_PROXY });
          return spawn(command, args, options);
        },
      });
      const probed = await runtime.probeAdapter({ id: "antigravity", path: wrapper });
      expect(spawned[0]?.shell).toBe(false);
      expect(spawned[0]?.httpProxy).toBe("http://127.0.0.1:10808");
      expect(spawned[0]?.httpsProxy).toBe("http://127.0.0.1:10809");
      expect(realpathSync(spawned[0]?.command)).toBe(realpathSync(wrapper));
      expect(probed.state).toBe("available");
      expect(probed.promptCapabilities).toEqual({ image: true, embeddedContext: true });
      const report = await readReport(reportPath);
      expect(report.initialize.clientCapabilities).toEqual({
        auth: { terminal: false },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      });
      expect(path.resolve(report.newSession.cwd)).not.toBe(home);
      expect(report.newSession.cwd).toContain(`${path.sep}edgeever-acp-`);
      expect(report.newSession.mcpServers).toEqual([]);
      const pid = Number(await readFile(`${reportPath}.pid`, "utf8"));
      await waitUntilExited(pid);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("provides the signed-in workspace MCP server only during an ACP prompt", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-mcp-"));
    const reportPath = path.join(directory, "report.json");
    let closed = false;
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
      });
      const runtime = createAcpHostRuntime({
        mcpAccess: () => ({ baseUrl: "https://notes.example", sessionToken: "login-secret" }),
        startMcpBridge: () => ({
          url: "http://127.0.0.1:12345",
          secret: "temporary-secret",
          close: async () => { closed = true; },
        }),
      });
      const events = collector();
      await runtime.prompt({ adapterId: "antigravity", path: scriptPath, prompt: "List my notes" }, events.emit);
      await events.waitFor((event) => event.type === "done");
      const servers = (await readReport(reportPath)).newSession.mcpServers;
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("edgeever-current-workspace");
      expect(servers[0].env).toContainEqual({ name: "EDGEEVER_TOKEN", value: "temporary-secret" });
      expect(JSON.stringify(servers)).not.toContain("login-secret");
      expect(closed).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("starts Codex prompts with the request while preserving workspace MCP guidance", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-codex-title-"));
    const reportPath = path.join(directory, "report.json");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
      });
      const runtime = createAcpHostRuntime({
        adapterManager: { get: (id) => id === "codex" ? { version: "test", command: { command: scriptPath, args: [] } } : null },
        mcpAccess: () => ({ baseUrl: "https://notes.example", sessionToken: "login-secret" }),
        startMcpBridge: () => ({ url: "http://127.0.0.1:12345", secret: "temporary-secret", close: async () => {} }),
      });
      const events = collector();
      await runtime.prompt({ adapterId: "codex", prompt: "分析资金往来", contextText: "Current note and earlier turns" }, events.emit);
      await events.waitFor((event) => event.type === "done");
      const report = await readReport(reportPath);
      expect(report.prompt[0]).toEqual({ type: "text", text: "分析资金往来" });
      expect(report.prompt[1].text).toContain("edgeever-current-workspace");
      expect(report.prompt[1].text).toContain("[note title](#memo=exact_memo_id_from_tool_result)");
      expect(report.prompt[2]).toEqual({ type: "text", text: "Current note and earlier turns" });
      expect(report.newSession.mcpServers[0].name).toBe("edgeever-current-workspace");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("keeps infographic prompts from granting note write access", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-infographic-"));
    const reportPath = path.join(directory, "report.json");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
      });
      const runtime = createAcpHostRuntime({
        mcpAccess: () => { throw new Error("infographic prompts must not open note access"); },
        startMcpBridge: () => { throw new Error("infographic prompts must not open note access"); },
      });
      const events = collector();
      await runtime.prompt({
        adapterId: "antigravity",
        path: scriptPath,
        prompt: "换成小米",
        contextText: "Reply with one json proposal.",
        noteAccess: false,
      }, events.emit);
      await events.waitFor((event) => event.type === "done");
      const report = await readReport(reportPath);
      expect(report.newSession.mcpServers).toEqual([]);
      expect(JSON.stringify(report.prompt)).not.toContain("edgeever-current-workspace");
      expect(report.prompt).toEqual([
        { type: "text", text: "Reply with one json proposal." },
        { type: "text", text: "换成小米" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("keeps OpenClaw ACP sessions free of unsupported session MCP servers", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-openclaw-acp-"));
    const reportPath = path.join(directory, "report.json");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
      });
      const executable = path.join(directory, "openclaw");
      await writeFile(executable, await readFile(scriptPath), { mode: 0o755 });
      const runtime = createAcpHostRuntime({
        pathEnv: `${directory}${path.delimiter}${path.dirname(process.execPath)}`,
        home: directory,
        mcpAccess: () => { throw new Error("OpenClaw must use Gateway MCP configuration"); },
      });
      const events = collector();
      await runtime.prompt({ adapterId: "openClaw", prompt: "Hello" }, events.emit);
      await events.waitFor((event) => event.type === "done");
      const report = await readReport(reportPath);
      expect(report.newSession.mcpServers).toEqual([]);
      expect(report.prompt).toEqual([{ type: "text", text: "Hello" }]);
      expect(report.permission?.outcome).toEqual({ outcome: "selected", optionId: "allow" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("offers advertised agent login and verifies a session after authentication", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-auth-"));
    const reportPath = path.join(directory, "report.json");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
        requireAuth: true,
      });
      const runtime = createAcpHostRuntime();
      const probed = await runtime.probeAdapter({ id: "antigravity", path: scriptPath });
      expect(probed.state).toBe("needs_login");
      expect(probed.authMethods).toEqual([{ id: "browser", name: "Browser" }]);
      const authenticated = await runtime.authenticateAdapter({ id: "antigravity", path: scriptPath, methodId: "browser" });
      expect(authenticated.state).toBe("available");
      expect(authenticated.authMethods).toBeUndefined();
      expect((await readReport(reportPath)).authMethod).toBe("browser");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("hides ACP login methods when an agent can already create a session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-optional-auth-"));
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath: path.join(directory, "report.json"),
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
        advertiseAuth: true,
      });
      const runtime = createAcpHostRuntime();
      const probed = await runtime.probeAdapter({ id: "antigravity", path: scriptPath });
      expect(probed.state).toBe("available");
      expect(probed.authMethods).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("reports a prompt-time authentication refusal instead of an empty reply", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-refusal-"));
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath: path.join(directory, "report.json"),
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
        promptRefusal: {
          stopReason: "refusal",
          _meta: { "codebuddy.ai/errorMessage": JSON.stringify({ code: -32000, message: "Authentication required", data: { category: "auth" } }) },
        },
      });
      const runtime = createAcpHostRuntime();
      const probed = await runtime.probeAdapter({ id: "antigravity", path: scriptPath });
      expect(probed.state).toBe("available");
      const events = collector();
      const result = await runtime.prompt({ adapterId: "antigravity", path: scriptPath, prompt: "Hello" }, events.emit);
      expect(await events.waitFor((event) => event.type === "error")).toEqual({ requestId: result.requestId, type: "error", message: "needs_login" });
      expect(events.events.some((event) => event.type === "done")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("streams updates, auto-approves tools, and never reads a local file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-prompt-"));
    const reportPath = path.join(directory, "report.json");
    const secretPath = path.join(directory, "secret.txt");
    await writeFile(secretPath, "SENTINEL_SECRET_CONTENT");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath,
        allowImage: true,
        allowEmbedded: true,
        hold: false,
      });
      const runtime = createAcpHostRuntime();
      const events = collector();
      const result = await runtime.prompt({
        adapterId: "antigravity",
        path: scriptPath,
        prompt: "hello",
        contextText: "context",
        attachments: attachments(),
      }, events.emit);
      await events.waitFor((event) => event.type === "done");
      const report = await readReport(reportPath);
      expect(report.permission?.outcome).toEqual({ outcome: "selected", optionId: "allow" });
      expect(report.readResult).toBeNull();
      expect(JSON.stringify(report)).not.toContain("SENTINEL_SECRET_CONTENT");
      expect(path.resolve(report.newSession.cwd)).not.toBe(home);
      const serialized = JSON.stringify(report.prompt);
      expect(serialized).not.toContain("/Users/me/secret.pdf");
      expect(serialized).not.toContain(secretPath);
      expect(serialized).not.toContain("resource_link");
      expect(report.prompt.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(true);
      expect(report.prompt.some((block) => block.type === "resource" && String(block.resource?.uri).startsWith("edgeever-attachment:"))).toBe(true);
      expect(events.events).toContainEqual({ requestId: result.requestId, type: "reasoning", text: "thinking" });
      expect(events.events).toContainEqual({ requestId: result.requestId, type: "text-delta", text: "hello from agent" });
      expect(events.events).toContainEqual({
        requestId: result.requestId,
        type: "tool",
        name: "search",
        status: "pending",
        title: "Search notes",
      });
      expect(events.events.at(-1)).toEqual({ requestId: result.requestId, type: "done" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("drops image and PDF blocks when the agent does not advertise them", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-omit-"));
    const reportPath = path.join(directory, "report.json");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: false,
      });
      const runtime = createAcpHostRuntime();
      const events = collector();
      const result = await runtime.prompt({
        adapterId: "antigravity",
        path: scriptPath,
        prompt: "hello",
        attachments: attachments(),
      }, events.emit);
      expect(result.rejectedAttachments?.map((item) => item.reason)).toEqual([
        "This agent does not accept embedded files.",
        "This agent does not accept images.",
      ]);
      await events.waitFor((event) => event.type === "done");
      const report = await readReport(reportPath);
      expect(report.prompt.every((block) => block.type === "text")).toBe(true);
      expect(JSON.stringify(report.prompt)).not.toContain("/Users/me");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  sessionTest("cancels an in-flight prompt and ignores unknown ids", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edgeever-acp-cancel-"));
    const reportPath = path.join(directory, "report.json");
    try {
      const scriptPath = await writeFakeAgent(directory, {
        reportPath,
        secretPath: path.join(directory, "secret.txt"),
        allowImage: false,
        allowEmbedded: false,
        hold: true,
      });
      const runtime = createAcpHostRuntime();
      const events = collector();
      const result = await runtime.prompt({
        adapterId: "antigravity",
        path: scriptPath,
        prompt: "wait",
      }, events.emit);
      await events.waitFor((event) => event.type === "text-delta");
      expect(await runtime.cancel(result.requestId)).toEqual({ ok: true });
      expect(await runtime.cancel("missing-request")).toEqual({ ok: true });
      await events.waitFor((event) => event.type === "done" || event.type === "error");
      const pid = Number(await readFile(`${reportPath}.pid`, "utf8"));
      await waitUntilExited(pid);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

test("desktop preload and main process expose the ACP host", async () => {
  const [main, preload, host] = await Promise.all([
    Bun.file(new URL("./index.mjs", import.meta.url)).text(),
    Bun.file(new URL("../preload/index.cjs", import.meta.url)).text(),
    Bun.file(new URL("./acp-host.mjs", import.meta.url)).text(),
  ]);
  expect(main).toContain("registerAcpIpc(ipcMain, createAcpHostRuntime({");
  expect(preload).toContain('installAcpAdapter: (id) => ipcRenderer.invoke("desktop:acp-install", id)');
  expect(preload).toContain('authenticateAcpAdapter: (input) => ipcRenderer.invoke("desktop:acp-authenticate", input)');
  expect(host).toContain('ipcMain.handle("desktop:acp-prompt"');
  expect(preload).toContain('listAcpAdapters: () => ipcRenderer.invoke("desktop:acp-list")');
  expect(preload).toContain('probeAcpAdapter: (input) => ipcRenderer.invoke("desktop:acp-probe", input)');
  expect(preload).toContain('promptAcp: (input) => ipcRenderer.invoke("desktop:acp-prompt", input)');
  expect(preload).toContain('cancelAcp: (requestId) => ipcRenderer.invoke("desktop:acp-cancel", requestId)');
  expect(preload).toContain('ipcRenderer.on("desktop:acp-event"');
  const handlers = new Map();
  registerAcpIpc({ handle: (channel, handler) => handlers.set(channel, handler) });
  expect([...handlers.keys()]).toEqual(["desktop:acp-list", "desktop:acp-probe", "desktop:acp-install", "desktop:acp-authenticate", "desktop:acp-prompt", "desktop:acp-cancel"]);
  expect(() => handlers.get("desktop:acp-prompt")({ sender: {} }, { prompt: "test" })).toThrow("acp_prompt_forbidden");
});
