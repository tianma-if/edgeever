import { beforeEach, describe, expect, test } from "bun:test";
import { createPanelHost } from "./panel.ts";

const createFakeRoot = () => {
  const root = {
    children: [],
    replaceChildren(...nodes) {
      root.children = nodes;
    },
    ownerDocument: {
      createElement() {
        return {
          className: "",
          removed: false,
          remove() {
            this.removed = true;
          },
        };
      },
    },
  };
  return root;
};

const createFakeBridge = () => {
  const sent = [];
  const handlers = new Map();
  let listener = null;
  return {
    protocol: 1,
    sent,
    handlers,
    request() {
      return Promise.resolve(undefined);
    },
    notify(message) {
      sent.push(message);
    },
    send(message) {
      sent.push(message);
    },
    handle(method, handler) {
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    subscribe(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    receive(message) {
      listener?.(message);
    },
  };
};

describe("panel host", () => {
  let root;
  let bridge;
  let panels;
  let events;

  beforeEach(() => {
    root = createFakeRoot();
    bridge = createFakeBridge();
    events = [];
    panels = new Map([[
      "main",
      {
        id: "main",
        title: "发布",
        purpose: "workflow",
        mount(container, context) {
          context.shell.set({
            header: { title: "发布笔记" },
            onAction: (id) => events.push(`action:${id}`),
            onChange: (key, value) => events.push(`change:${key}=${value}`),
          });
          return () => events.push("disposed");
        },
        beforeClose() {
          return { title: "确认关闭？", message: "有未保存的修改" };
        },
      },
    ]]);
  });

  test("mounts a panel and forwards host chrome", async () => {
    const host = createPanelHost({ root, bridge, getPanel: (id) => panels.get(id) });
    await host.open("main");
    expect(host.activePanelId).toBe("main");
    expect(bridge.sent.at(-1)).toMatchObject({
      type: "panel.chrome",
      panelId: "main",
      chrome: { header: { title: "发布笔记" } },
    });
  });

  test("dispatches host action/change and beforeClose queries", async () => {
    const host = createPanelHost({ root, bridge, getPanel: (id) => panels.get(id) });
    await host.open("main");
    bridge.receive({ v: 1, type: "panel.action", panelId: "main", actionId: "refresh" });
    bridge.receive({ v: 1, type: "panel.change", panelId: "main", key: "query", value: "halo" });
    expect(events).toEqual(["action:refresh", "change:query=halo"]);
    const decision = await bridge.handlers.get("panel.beforeClose")();
    expect(decision).toEqual({ title: "确认关闭？", message: "有未保存的修改" });
  });

  test("closes on request and runs panel cleanup", async () => {
    const host = createPanelHost({ root, bridge, getPanel: (id) => panels.get(id) });
    await host.open("main");
    bridge.receive({ v: 1, type: "panel.close", panelId: "main" });
    await Bun.sleep(0);
    expect(events).toContain("disposed");
    expect(host.activePanelId).toBeNull();
  });

  test("reports unsupported panel ids", async () => {
    const host = createPanelHost({ root, bridge, getPanel: (id) => panels.get(id) });
    await expect(host.open("missing")).rejects.toThrow("Plugin panel not found");
  });
});
