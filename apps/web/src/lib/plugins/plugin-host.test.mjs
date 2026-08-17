import { beforeEach, describe, expect, test } from "bun:test";

const values = new Map();
const styles = new Map();
const eventListeners = new Map();

globalThis.window = {
  location: { href: "https://edgeever.example/settings" },
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  },
  addEventListener: (name, listener) => eventListeners.set(name, listener),
  removeEventListener: (name) => eventListeners.delete(name),
};

globalThis.document = {
  documentElement: {
    classList: { contains: () => false },
    dataset: {},
    style: {
      setProperty: (key, value) => styles.set(key, value),
      removeProperty: (key) => styles.delete(key),
    },
    removeAttribute: (name) => {
      if (name === "data-edgeever-extension-theme") delete globalThis.document.documentElement.dataset.edgeeverExtensionTheme;
    },
  },
};

globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};

const { EdgeEverPluginHost } = await import("./plugin-host.ts");
const { sha256Hex } = await import("./github-plugin-distribution.ts");

const repository = {
  listMemos: async () => ({ memos: [], totalCount: 0, nextCursor: null }),
};

beforeEach(() => {
  values.clear();
  styles.clear();
  eventListeners.clear();
  delete globalThis.window.fetch;
  globalThis.document.documentElement.dataset = {};
});

describe("EdgeEverPluginHost", () => {
  test("applies a validated code-free theme", async () => {
    const host = new EdgeEverPluginHost({ repository, scope: "test" });
    host.installManifest({
      type: "theme",
      id: "org.edgeever.test-theme",
      name: "Test theme",
      version: "1.0.0",
      themeApiVersion: "1",
      modes: ["light"],
      light: {
        "color.background": "#010203",
        "color.accent": "#16a06e",
      },
    }, "https://example.com/theme/manifest.json");

    await host.setEnabled("org.edgeever.test-theme", true);

    expect(styles.get("--edgeever-theme-background")).toBe("#010203");
    expect(styles.get("--edgeever-theme-accent")).toBe("#16a06e");
    expect(globalThis.document.documentElement.dataset.edgeeverExtensionTheme).toBe("org.edgeever.test-theme");
    await host.dispose();
  });

  test("loads a plugin and runs its registered command", async () => {
    const notices = [];
    const secrets = new Map();
    const secretStorage = {
      get: async (pluginId, key) => secrets.get(`${pluginId}:${key}`) ?? null,
      set: async (pluginId, key, value) => secrets.set(`${pluginId}:${key}`, value),
      remove: async (pluginId, key) => secrets.delete(`${pluginId}:${key}`),
    };
    const host = new EdgeEverPluginHost({ repository, scope: "test", onNotice: (message) => notices.push(message), secretStorage });
    let replacement = null;
    host.setEditorAdapter({
      getSelection: () => ({ noteId: "note-1", from: 1, to: 6, empty: false, text: "hello", contentMarkdown: "hello" }),
      replaceSelection: (value) => { replacement = value; },
      insertAtCursor: () => undefined,
    });
    const entry = new URL("./plugin-host.fixture.mjs", import.meta.url).href;
    host.installManifest({
      type: "plugin",
      id: "org.edgeever.test-plugin",
      name: "Test plugin",
      version: "1.0.0",
      apiVersion: "1",
      entry,
      permissions: ["ui:commands", "ui:notices", "ui:panels", "editor:read", "editor:write", "secrets"],
    }, "https://example.com/plugin/manifest.json");

    await host.setEnabled("org.edgeever.test-plugin", true);
    await host.runCommand("org.edgeever.test-plugin", "hello");

    expect(host.getSnapshot().commands).toHaveLength(4);
    expect(host.getSnapshot().panels).toHaveLength(1);
    expect(notices).toEqual(["hello from plugin"]);
    expect(host.getSnapshot().recentActions[0]).toMatchObject({ id: "hello", type: "command" });
    await expect(host.runCommand("org.edgeever.test-plugin", "read-without-permission")).rejects.toThrow("notes:read");
    await host.runCommand("org.edgeever.test-plugin", "replace-selection");
    expect(replacement).toBe("HELLO");
    await host.runCommand("org.edgeever.test-plugin", "write-secret");
    expect(secrets.get("test:org.edgeever.test-plugin:token")).toBe("secret-value");
    const container = {};
    const disposePanel = await host.mountPanel("org.edgeever.test-plugin", "fixture", container);
    expect(container.mountedByFixture).toBe(true);
    expect(host.getSnapshot().recentActions[0]).toMatchObject({ id: "fixture", type: "panel" });
    disposePanel();
    expect(container.mountedByFixture).toBe(false);
    const mountedDuringDisable = {};
    await host.mountPanel("org.edgeever.test-plugin", "fixture", mountedDuringDisable);
    await host.setEnabled("org.edgeever.test-plugin", false);
    expect(mountedDuringDisable.mountedByFixture).toBe(false);
    expect(host.getSnapshot().panels).toHaveLength(0);
    expect(host.getSnapshot().recentActions).toHaveLength(0);
    await host.dispose();
  });

  test("installs a checksum-pinned marketplace package and removes its cache on uninstall", async () => {
    const manifest = {
      type: "plugin",
      id: "org.edgeever.marketplace-test",
      name: "Marketplace Test",
      version: "1.0.0",
      apiVersion: "1",
      entry: "./main.js",
      permissions: [],
    };
    const manifestText = JSON.stringify(manifest);
    const mainJs = "export default { activate() {} };";
    globalThis.window.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) return new Response(manifestText, { headers: { "content-type": "application/json" } });
      if (url.endsWith("/main.js")) return new Response(mainJs, { headers: { "content-type": "text/javascript" } });
      return new Response(null, { status: 404 });
    };
    const packages = new Map();
    const packageStorage = {
      get: async (pluginId, version) => packages.get(pluginId)?.version === version ? packages.get(pluginId) : null,
      put: async (value) => packages.set(value.pluginId, value),
      remove: async (pluginId) => packages.delete(pluginId),
    };
    const host = new EdgeEverPluginHost({ repository, scope: "test", packageStorage });
    const entry = {
      id: manifest.id,
      name: manifest.name,
      description: "Verified test plugin",
      author: "EdgeEver",
      category: "Testing",
      repositoryUrl: "https://github.com/edgeever/marketplace-test",
      distribution: { type: "manifest", manifestUrl: "https://plugins.example/manifest.json" },
      verification: {
        version: manifest.version,
        checksums: { manifestJson: await sha256Hex(manifestText), mainJs: await sha256Hex(mainJs) },
      },
    };

    await host.installMarketplaceEntry(entry);

    expect(host.getSnapshot().extensions[0].source).toMatchObject({ kind: "marketplace", verified: true });
    expect(packages.get(manifest.id)?.checksums.mainJs).toBe(entry.verification.checksums.mainJs);
    await host.uninstall(manifest.id);
    expect(packages.has(manifest.id)).toBe(false);
    await host.dispose();
  });

  test("rejects a manifest that changed after update confirmation", async () => {
    const confirmedManifest = {
      type: "theme",
      id: "org.edgeever.changed-theme",
      name: "Changed theme",
      version: "2.0.0",
      themeApiVersion: "1",
      modes: ["light"],
      light: { "color.background": "#ffffff" },
    };
    globalThis.window.fetch = async () => Response.json({
      ...confirmedManifest,
      light: { "color.background": "#000000" },
    });
    const host = new EdgeEverPluginHost({ repository, scope: "test" });

    await expect(host.installFromManifestUrl(
      "https://plugins.example/manifest.json",
      undefined,
      confirmedManifest,
    )).rejects.toThrow("changed after update confirmation");

    expect(host.getSnapshot().extensions).toHaveLength(0);
    await host.dispose();
  });
});
