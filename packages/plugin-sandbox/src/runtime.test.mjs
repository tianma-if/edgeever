import { beforeEach, describe, expect, test } from "bun:test";
import { createSandboxRuntime } from "./runtime.ts";

const manifest = {
  type: "plugin",
  id: "com.example.sandbox-test",
  name: "Sandbox Test",
  version: "1.0.0",
  apiVersion: "2",
  settingsUi: "host",
  permissions: ["notes:read", "ui:panels", "ui:commands"],
};

const createFakeTransport = () => {
  let listener = null;
  const sent = [];
  return {
    sent,
    transport: {
      post(message) {
        sent.push(message);
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    receive(message) {
      listener?.(message);
    },
  };
};

const createFakeRoot = () => ({
  children: [],
  replaceChildren(...nodes) {
    this.children = nodes;
  },
  ownerDocument: {
    createElement() {
      return { className: "", remove() {} };
    },
  },
});

const createPlugin = (state) => ({
  async activate(context) {
    state.context = context;
    context.commands.register({ id: "publish", title: "发布", run: () => { state.runs += 1; } });
    context.ui.panels.register({ id: "main", title: "发布面板", purpose: "workflow", mount() {} });
    context.events.on("note.updated", (payload) => state.events.push(payload));
    return async () => {
      state.deactivated = true;
    };
  },
});

describe("sandbox runtime", () => {
  let fake;
  let state;

  beforeEach(() => {
    fake = createFakeTransport();
    state = { runs: 0, events: [], deactivated: false, context: null };
  });

  const boot = () => {
    const runtime = createSandboxRuntime({
      transport: fake.transport,
      loadPlugin: async () => createPlugin(state),
      root: createFakeRoot(),
    });
    fake.receive({ v: 1, type: "init", manifest, platform: "android", settings: { mode: "a" } });
    return runtime;
  };

  test("announces readiness and activates the plugin", async () => {
    const runtime = boot();
    expect(fake.sent[0]).toMatchObject({ type: "ready" });
    const activation = await runtime.whenActivated;
    expect(activation.commands).toEqual([{ id: "publish", title: "发布", listed: true, menu: true }]);
    expect(activation.panels).toEqual([{ id: "main", title: "发布面板", purpose: "workflow", presentation: "dialog" }]);
    expect(fake.sent.some((message) => message.type === "activated")).toBe(true);
    await runtime.dispose();
  });

  test("runs registered commands on host request", async () => {
    const runtime = boot();
    await runtime.whenActivated;
    fake.receive({ v: 1, type: "command.run", commandId: "publish" });
    await Bun.sleep(0);
    expect(state.runs).toBe(1);
    await runtime.dispose();
  });

  test("forwards host events to plugin listeners", async () => {
    const runtime = boot();
    await runtime.whenActivated;
    fake.receive({ v: 1, type: "event", event: "note.updated", payload: { note: { id: "memo_1" } } });
    expect(state.events).toEqual([{ note: { id: "memo_1" } }]);
    await runtime.dispose();
  });

  test("rejects plugins that do not target the current platform", async () => {
    const runtime = createSandboxRuntime({
      transport: fake.transport,
      loadPlugin: async () => createPlugin(state),
      root: createFakeRoot(),
    });
    fake.receive({
      v: 1,
      type: "init",
      manifest: { ...manifest, platforms: ["web", "desktop"] },
      platform: "android",
    });
    await expect(runtime.whenActivated).rejects.toThrow("does not support the android platform");
    expect(fake.sent.some((message) => message.type === "error" && message.scope === "activate")).toBe(true);
    await runtime.dispose();
  });

  test("deactivates the plugin on dispose", async () => {
    const runtime = boot();
    await runtime.whenActivated;
    await runtime.dispose();
    expect(state.deactivated).toBe(true);
  });
});
