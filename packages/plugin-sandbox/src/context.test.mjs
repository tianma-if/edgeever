import { beforeEach, describe, expect, test } from "bun:test";
import { SandboxUnsupportedError } from "./bridge.ts";
import { createSandboxPluginContext } from "./context.ts";

const manifest = {
  type: "plugin",
  id: "com.example.sandbox-test",
  name: "Sandbox Test",
  version: "1.0.0",
  apiVersion: "2",
  settingsUi: "host",
};

const createFakeBridge = () => {
  const calls = [];
  let responder = () => undefined;
  return {
    protocol: 1,
    calls,
    setResponder(next) {
      responder = next;
    },
    request(method, params, options) {
      calls.push({ method, params, options });
      return Promise.resolve(responder(method, params));
    },
    notify(message) {
      calls.push({ notify: message });
    },
    send(message) {
      calls.push({ send: message });
    },
    handle() {
      return () => undefined;
    },
    subscribe() {
      return () => undefined;
    },
    dispose() {},
  };
};

describe("sandbox plugin context", () => {
  let bridge;
  let handle;

  beforeEach(() => {
    bridge = createFakeBridge();
    handle = createSandboxPluginContext({ bridge, manifest, platform: "android", settings: { mode: "a" } });
  });

  test("maps note APIs to bridge requests", async () => {
    bridge.setResponder((method) => ({ method, notes: [], totalCount: 0, nextOffset: null }));
    await handle.context.notes.query({ text: "halo", limit: 10 });
    expect(bridge.calls.at(-1)).toMatchObject({ method: "notes.query", params: { text: "halo", limit: 10 } });

    bridge.setResponder(() => ({ id: "memo_1" }));
    await handle.context.notes.update("memo_1", { title: "新标题" });
    expect(bridge.calls.at(-1)).toMatchObject({ method: "notes.update", params: { noteId: "memo_1", input: { title: "新标题" } } });

    await handle.context.notes.delete("memo_1", { permanent: true });
    expect(bridge.calls.at(-1)).toMatchObject({ method: "notes.delete", params: { noteId: "memo_1", permanent: true } });

    await handle.context.notes.move(["memo_1"], "nb_2");
    expect(bridge.calls.at(-1)).toMatchObject({ method: "notes.move", params: { noteIds: ["memo_1"], notebookId: "nb_2" } });
  });

  test("keeps a local settings snapshot and persists writes", async () => {
    await expect(handle.context.settings.get("mode")).resolves.toBe("a");
    await expect(handle.context.settings.get("missing")).resolves.toBeNull();
    await handle.context.settings.set("mode", "b");
    expect(bridge.calls.at(-1)).toMatchObject({ method: "settings.set", params: { key: "mode", value: "b" } });
    await expect(handle.context.settings.get("mode")).resolves.toBe("b");
    handle.applySettingChange("mode", "c");
    await expect(handle.context.settings.get("mode")).resolves.toBe("c");
    handle.applySettingChange("mode", null);
    await expect(handle.context.settings.get("mode")).resolves.toBeNull();
  });

  test("serializes network requests and rebuilds responses", async () => {
    bridge.setResponder(() => ({
      status: 200,
      statusText: "OK",
      headers: [["content-type", "application/json"]],
      body: { kind: "text", text: '{"items":[]}' },
    }));
    const response = await handle.context.network.fetch("https://example.com/api", {
      method: "POST",
      headers: { "X-Test": "1" },
      body: "payload",
    });
    const call = bridge.calls.at(-1);
    expect(call.method).toBe("network.fetch");
    expect(call.params).toMatchObject({
      url: "https://example.com/api",
      method: "POST",
      headers: [["x-test", "1"]],
      body: { kind: "text", text: "payload" },
    });
    expect(call.options).toEqual({ timeoutMs: 120000 });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [] });
  });

  test("reads resources as blobs", async () => {
    bridge.setResponder(() => ({ mimeType: "image/png", dataBase64: btoa("\u0001\u0002") }));
    const blob = await handle.context.resources.read("res_1");
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  test("registers commands and panels and exposes them to the runtime", () => {
    const disposeCommand = handle.context.commands.register({ id: "publish", title: "发布", run() {} });
    const disposePanel = handle.context.ui.panels.register({
      id: "main",
      title: "发布面板",
      purpose: "workflow",
      mount() {},
    });
    expect(handle.registeredCommands()).toEqual([{ id: "publish", title: "发布", listed: true, menu: true }]);
    expect(handle.registeredPanels()).toEqual([{ id: "main", title: "发布面板", purpose: "workflow", presentation: "dialog" }]);
    expect(handle.getCommand("publish")?.title).toBe("发布");
    expect(handle.getPanel("main")?.id).toBe("main");
    disposeCommand();
    disposePanel();
    expect(handle.registeredCommands()).toEqual([]);
    expect(handle.registeredPanels()).toEqual([]);
  });

  test("dispatches events to registered listeners", () => {
    const received = [];
    handle.context.events.on("note.updated", (payload) => received.push(payload));
    handle.dispatchEvent("note.updated", { note: { id: "memo_1" } });
    expect(received).toEqual([{ note: { id: "memo_1" } }]);
  });

  test("rejects APIs the mobile sandbox does not support yet", async () => {
    await expect(handle.context.editor.getSelection()).rejects.toBeInstanceOf(SandboxUnsupportedError);
    await expect(handle.context.ai.status()).rejects.toBeInstanceOf(SandboxUnsupportedError);
    await expect(handle.context.schedules.list()).rejects.toBeInstanceOf(SandboxUnsupportedError);
    await expect(handle.context.diagrams.get("memo_1")).rejects.toBeInstanceOf(SandboxUnsupportedError);
  });

  test("notifies the host for ui notices and panel opens", async () => {
    bridge.setResponder(() => undefined);
    handle.context.ui.showNotice("你好");
    expect(bridge.calls.at(-1)).toMatchObject({ notify: { type: "notice", message: "你好" } });
    await handle.context.ui.panels.open("main");
    expect(bridge.calls.at(-1)).toMatchObject({ method: "panel.open", params: { panelId: "main", state: null } });
  });
});
