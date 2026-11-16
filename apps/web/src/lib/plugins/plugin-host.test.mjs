import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { restoreTestGlobal } from "../restore-test-global.mjs";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalMutationObserver = globalThis.MutationObserver;

const values = new Map();
const styles = new Map();
const eventListeners = new Map();

const stubWindow = {
  location: { href: "https://edgeever.example/settings" },
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
  },
  addEventListener: (name, listener) => eventListeners.set(name, listener),
  removeEventListener: (name) => eventListeners.delete(name),
};
globalThis.window = stubWindow;

const stubDocument = {
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
globalThis.document = stubDocument;

const StubMutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.MutationObserver = StubMutationObserver;

const { EdgeEverPluginHost, applyPluginMarkdownEdits } = await import("./plugin-host.ts");
const { sha256Hex } = await import("./github-plugin-distribution.ts");
const { withRepositoryMutationEvents } = await import("../repository-events.ts");
const { results: capabilityResults } = await import('./plugin-capabilities.fixture.mjs');

afterAll(() => {
  restoreTestGlobal("window", originalWindow, stubWindow);
  restoreTestGlobal("document", originalDocument, stubDocument);
  restoreTestGlobal("MutationObserver", originalMutationObserver, StubMutationObserver);
});

const repository = {
  getMemo: async () => ({ memo: { id: "note-1", contentMarkdown: "hello" } }),
  listMemos: async () => ({ memos: [], totalCount: 0, nextCursor: null }),
};

beforeEach(() => {
  capabilityResults.clear();
  values.clear();
  styles.clear();
  eventListeners.clear();
  delete globalThis.window.fetch;
  globalThis.document.documentElement.dataset = {};
});

describe("EdgeEverPluginHost", () => {
  test("rejects custom settings panels for API v2 plugins", async () => {
    const host = new EdgeEverPluginHost({ repository, scope: "settings-policy" });
    const id = "org.edgeever.settings-policy";
    host.installManifest({
      type: "plugin",
      id,
      name: "Settings policy",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry: new URL("./plugin-settings-policy.fixture.mjs", import.meta.url).href,
      permissions: ["ui:panels"],
    }, "https://example.org/manifest.json");

    await expect(host.setEnabled(id, true)).rejects.toThrow("custom settings panels are not allowed");
    expect(host.getSnapshot().extensions.find((extension) => extension.manifest.id === id)).toMatchObject({
      enabled: false,
      error: expect.stringContaining("custom settings panels are not allowed"),
    });
    await host.dispose();
  });

  test('enabled plugins can use host capabilities without manifest permission declarations', async () => {
    const calls = [];
    const directCalls = [];
    globalThis.window.fetch = async (...input) => { directCalls.push(input); return new Response('direct'); };
    const host = new EdgeEverPluginHost({ repository, scope: 'test',
      aiAdapter: { status: async () => ({ configured: true }), generate: async input => { calls.push(input); return { text: 'HELLO' }; } },
      publicNetworkAdapter: { fetchPublic: async input => { calls.push(input); return { url: input.url, status: 429, statusText: 'Too Many Requests', headers: {}, body: new TextEncoder().encode('limited').buffer }; } },
    });
    const install = async (id, permissions) => {
      host.installManifest({ type: 'plugin', id, name: id, version: '1.0.0', apiVersion: '2', settingsUi: 'host', entry: new URL('./plugin-capabilities.fixture.mjs', import.meta.url).href, ...(permissions ? { permissions } : {}) }, 'https://example.org/manifest.json');
      await host.setEnabled(id, true);
    };
    await install('org.test.trusted');
    await host.runCommand('org.test.trusted', 'ai'); expect(capabilityResults.get('org.test.trusted')).toEqual({ text: 'HELLO' });
    await host.runCommand('org.test.trusted', 'public'); expect(capabilityResults.get('org.test.trusted')).toEqual({ status: 429, text: 'limited', url: 'https://example.org/feed' });
    await host.runCommand('org.test.trusted', 'direct-unlisted');
    expect(String(directCalls[0][0])).toBe('http://192.168.1.8/feed');
    expect(directCalls[0][1].credentials).toBe('include');
    expect(new Headers(directCalls[0][1].headers).get('Authorization')).toBe('Bearer test');
    await expect(host.runCommand('org.test.trusted', 'post')).rejects.toThrow();
    await host.runCommand('org.test.trusted', 'unlisted'); expect(calls.at(-1).url).toBe('https://unlisted.org/feed');
    expect(calls[0].signal.aborted).toBe(false); await host.setEnabled('org.test.trusted', false); expect(calls[0].signal.aborted).toBe(true);
    await host.dispose();
  });
  test("lets a permitted plugin idempotently own schedules for its registered commands", async () => {
    const calls = [];
    const scheduleAdapter = {
      upsert: async (pluginId, input) => {
        calls.push({ pluginId, input });
        return {
          ...input,
          timezone: input.timezone ?? "UTC",
          missedRunPolicy: input.missedRunPolicy ?? "run-once",
          isEnabled: input.isEnabled ?? true,
          runsOnThisDevice: true,
          lastRun: null,
        };
      },
      list: async () => [],
      remove: async () => undefined,
    };
    const host = new EdgeEverPluginHost({ repository, scope: "test", scheduleAdapter });
    host.installManifest({
      type: "plugin",
      id: "org.edgeever.schedule-test",
      name: "Schedule Test",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry: new URL("./plugin-host-schedules.fixture.mjs", import.meta.url).href,
      permissions: ["ui:commands", "schedules"],
    }, "https://example.com/schedule-plugin/manifest.json");

    await host.setEnabled("org.edgeever.schedule-test", true);
    expect(calls).toEqual([{
      pluginId: "org.edgeever.schedule-test",
      input: {
        key: "hourly-refresh",
        name: "Hourly refresh",
        commandId: "refresh",
        cronExpression: "0 * * * *",
      },
    }]);
    await host.dispose();
  });

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
      clearNamespace: async (pluginId) => {
        for (const key of Array.from(secrets.keys())) if (key.startsWith(`${pluginId}:`)) secrets.delete(key);
      },
    };
    const packageStorage = {
      get: async () => null,
      put: async () => undefined,
      remove: async () => undefined,
    };
    const host = new EdgeEverPluginHost({ repository, scope: "test", onNotice: (message) => notices.push(message), secretStorage, packageStorage });
    let replacement = null;
    host.setEditorAdapter({
      getSelection: () => ({ noteId: "note-1", from: 1, to: 6, empty: false, text: "hello", contentMarkdown: "hello" }),
      getDocument: () => ({ noteId: "note-1", contentMarkdown: "hello", hasUnsavedChanges: false }),
      replaceDocument: () => undefined,
      insertEmbed: () => undefined,
      replaceSelection: (value) => { replacement = value; },
      insertAtCursor: () => undefined,
    });
    const entry = new URL("./plugin-host.fixture.mjs", import.meta.url).href;
    host.installManifest({
      type: "plugin",
      id: "org.edgeever.test-plugin",
      name: "Test plugin",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry,
      permissions: ["notes:write", "ui:commands", "ui:notices", "ui:panels", "editor:read", "editor:write", "secrets", "storage"],
      settings: {
        fields: [
          { key: "endpoint", type: "text", label: "Endpoint", default: "https://default.example" },
          { key: "token", type: "secret", label: "Token", required: true },
          { key: "limit", type: "number", label: "Limit", min: 1, max: 10, default: 5 },
        ],
      },
    }, "https://example.com/plugin/manifest.json");

    await host.setEnabled("org.edgeever.test-plugin", true);
    await host.runCommand("org.edgeever.test-plugin", "hello");

    expect(host.getSnapshot().commands).toHaveLength(7);
    expect(host.getSnapshot().panels).toEqual([{ pluginId: "org.edgeever.test-plugin", id: "fixture", title: "Fixture panel", purpose: "workflow", presentation: "dialog" }]);
    expect(notices).toEqual(["hello from plugin"]);
    await host.runCommand("org.edgeever.test-plugin", "read-without-permission");
    await host.runCommand("org.edgeever.test-plugin", "subscribe-without-read-permission");
    await host.runCommand("org.edgeever.test-plugin", "replace-selection");
    expect(replacement).toBe("HELLO");
    await host.runCommand("org.edgeever.test-plugin", "write-secret");
    expect(secrets.get("test:org.edgeever.test-plugin:token")).toBe("secret-value");
    await host.runCommand("org.edgeever.test-plugin", "write-storage");
    expect(values.get("edgeever.plugin-data.v1:test:org.edgeever.test-plugin:preference")).toBe('"stored-value"');
    await expect(host.getSettingValue("org.edgeever.test-plugin", "endpoint")).resolves.toBe("https://default.example");
    await host.setSettingValue("org.edgeever.test-plugin", "endpoint", "https://custom.example");
    await host.setSettingValue("org.edgeever.test-plugin", "token", "configured-token");
    await expect(host.getSettingValue("org.edgeever.test-plugin", "token")).resolves.toBeNull();
    await expect(host.getSettingValue("org.edgeever.test-plugin", "token", true)).resolves.toBe("configured-token");
    await expect(host.setSettingValue("org.edgeever.test-plugin", "limit", 11)).rejects.toThrow("at most 10");
    const container = {};
    const disposePanel = await host.mountPanel("org.edgeever.test-plugin", "fixture", container);
    expect(container.mountedByFixture).toBe(true);
    disposePanel();
    expect(container.mountedByFixture).toBe(false);
    const mountedDuringDisable = {};
    await host.mountPanel("org.edgeever.test-plugin", "fixture", mountedDuringDisable);
    await host.setEnabled("org.edgeever.test-plugin", false);
    expect(mountedDuringDisable.mountedByFixture).toBe(false);
    expect(host.getSnapshot().panels).toHaveLength(0);
    await host.uninstall("org.edgeever.test-plugin");
    expect(secrets.has("test:org.edgeever.test-plugin:token")).toBe(false);
    expect(secrets.has("test:org.edgeever.test-plugin:setting:token")).toBe(false);
    expect(values.has("edgeever.plugin-data.v1:test:org.edgeever.test-plugin:preference")).toBe(false);
    expect(values.has("edgeever.plugin-settings.v1:test:org.edgeever.test-plugin:endpoint")).toBe(false);
    await host.dispose();
  });

  test("installs checksum-pinned packages on HTTP, rejects tampering, and removes uninstalled caches", async () => {
    const manifest = {
      type: "plugin",
      id: "org.edgeever.marketplace-test",
      name: "Marketplace Test",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
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
      get: async (pluginId, version) => packages.get(`${pluginId}:${version}`) ?? null,
      put: async (value) => packages.set(`${value.pluginId}:${value.version}`, value),
      remove: async (pluginId, version) => {
        if (version) packages.delete(`${pluginId}:${version}`);
        else for (const key of Array.from(packages.keys())) if (key.startsWith(`${pluginId}:`)) packages.delete(key);
      },
    };
    const secretStorage = {
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      clearNamespace: async () => undefined,
    };
    const host = new EdgeEverPluginHost({ repository, scope: "test", packageStorage, secretStorage });
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

    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
    try {
      await host.installMarketplaceEntry(entry);

      expect(host.getSnapshot().extensions[0].source).toMatchObject({ kind: "marketplace", verified: true });
      expect(packages.get(`${manifest.id}:${manifest.version}`)?.checksums.mainJs).toBe(entry.verification.checksums.mainJs);
      await host.uninstall(manifest.id);
      expect([...packages.keys()].some((key) => key.startsWith(`${manifest.id}:`))).toBe(false);
      const originalFetch = globalThis.window.fetch;
      globalThis.window.fetch = async (input) => String(input).endsWith("/main.js")
        ? new Response(`${mainJs} // tampered`)
        : originalFetch(input);
      await expect(host.installMarketplaceEntry(entry)).rejects.toThrow("mainJs does not match the marketplace verified checksum.");
      expect(host.getSnapshot().extensions).toHaveLength(0);
      expect(packages.size).toBe(0);
    } finally {
      Object.defineProperty(globalThis, "crypto", originalCrypto);
      await host.dispose();
    }
  });

  test("rolls back an enabled plugin when an update cannot activate", async () => {
    const pluginId = "org.edgeever.rollback-test";
    const entry = new URL("./plugin-host.fixture.mjs", import.meta.url).href;
    const packages = new Map();
    const packageStorage = {
      get: async (id, version) => packages.get(`${id}:${version}`) ?? null,
      put: async (value) => packages.set(`${value.pluginId}:${value.version}`, value),
      remove: async (id, version) => {
        if (version) packages.delete(`${id}:${version}`);
        else for (const key of Array.from(packages.keys())) if (key.startsWith(`${id}:`)) packages.delete(key);
      },
    };
    const host = new EdgeEverPluginHost({ repository, scope: "test", packageStorage });
    host.installManifest({
      type: "plugin",
      id: pluginId,
      name: "Rollback Test",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry,
      permissions: ["notes:write", "ui:commands", "ui:notices", "ui:panels", "editor:read", "editor:write", "secrets", "storage"],
    }, "https://plugins.example/v1/manifest.json");
    await host.setEnabled(pluginId, true);

    const nextManifest = {
      type: "plugin",
      id: pluginId,
      name: "Rollback Test",
      version: "2.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry: "./main.js",
      permissions: [],
    };
    globalThis.window.fetch = async (input) => String(input).endsWith("main.js")
      ? new Response("export default {};", { headers: { "content-type": "text/javascript" } })
      : Response.json(nextManifest);

    await expect(host.installFromManifestUrl("https://plugins.example/v2/manifest.json", undefined, nextManifest))
      .rejects.toThrow("activate(context)");

    const restored = host.getSnapshot().extensions.find((extension) => extension.manifest.id === pluginId);
    expect(restored?.manifest.version).toBe("1.0.0");
    expect(restored?.enabled).toBe(true);
    expect(host.getSnapshot().commands.some((command) => command.pluginId === pluginId && command.id === "hello")).toBe(true);
    expect(packages.has(`${pluginId}:2.0.0`)).toBe(false);
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

  test("routes P1 notebook, note revision, resource, and setting capabilities through the repository", async () => {
    const resource = {
      id: "resource-1",
      memoId: "note-1",
      originalMemoId: null,
      kind: "attachment",
      mimeType: "text/plain",
      filename: "hello.txt",
      byteSize: 5,
      sha256: "resource-hash",
      width: null,
      height: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      url: "https://edgeever.example/resource-1",
    };
    const note = {
      id: "note-1",
      notebookId: "notebook-1",
      title: "First",
      excerpt: "First note",
      tags: ["test"],
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      revision: 3,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "First note",
      contentText: "First note",
      contentHash: "first-hash",
      sourceMemoIds: [],
      mergeSourceCount: 0,
      mergedIntoMemoId: null,
    };
    let updateInput = null;
    const template = {
      id: "template-1",
      name: "Existing template",
      description: null,
      title: null,
      contentMarkdown: "Template",
      tags: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const repositoryWithCapabilities = {
      ...repository,
      listMemos: async () => ({ memos: [note], totalCount: 1, nextCursor: null }),
      getMemo: async () => ({ memo: note }),
      updateMemo: async (_memo, input) => {
        updateInput = input;
        return { memo: { ...note, contentMarkdown: input.contentMarkdown, contentText: "Updated note" }, queued: true };
      },
      createNotebook: async (input) => ({ notebook: { id: "notebook-created", parentId: null, name: input.name, memoCount: 0 } }),
      moveMemos: async () => ({ ok: true, moved: 1 }),
      pinMemos: async () => ({ ok: true, updated: 1 }),
      listMemoRevisions: async () => ({ revisions: [{
        id: "revision-1",
        memoId: "note-1",
        revision: 1,
        title: "First",
        tags: ["test"],
        contentMarkdown: "First",
        contentText: "First",
        createdAt: "2026-09-01T00:00:00.000Z",
      }] }),
      listResources: async () => ({ resources: [{ ...resource, memoTitle: "Note", memoExcerpt: "", memoDeleted: false }], summary: {} }),
      readResource: async () => new Blob(["resource bytes"], { type: "text/plain" }),
      uploadMemoResource: async () => ({ resource }),
      updateResource: async (_resourceId, file) => ({ resource: { ...resource, filename: file.name, mimeType: file.type, sha256: "updated-resource-hash" } }),
      listTemplates: async () => ({ templates: [template] }),
      createTemplate: async (input) => ({ template: { ...template, name: input.name } }),
      updateTemplate: async (_templateId, input) => ({ template: { ...template, name: input.name ?? template.name } }),
      deleteTemplate: async () => ({ ok: true }),
      useTemplate: async () => ({ memo: { ...note, id: "templated-note", contentMarkdown: template.contentMarkdown } }),
    };
    const packageStorage = { get: async () => null, put: async () => undefined, remove: async () => undefined };
    const host = new EdgeEverPluginHost({ repository: repositoryWithCapabilities, scope: "capabilities", packageStorage });
    const opened = [];
    const openedPanels = [];
    const insertedEmbeds = [];
    let liveDocument = "First note";
    let liveDocumentDirty = false;
    host.setNavigationAdapter({ openNote: (noteId, notebookId, options) => opened.push({ noteId, notebookId, options }) });
    host.setPanelAdapter({ openPanel: (pluginId, panelId, options) => openedPanels.push({ pluginId, panelId, options }) });
    host.setEditorAdapter({
      getSelection: () => ({ noteId: "note-1", from: 0, to: 0, empty: true, text: "", contentMarkdown: "" }),
      getDocument: () => ({ noteId: "note-1", contentMarkdown: liveDocument, hasUnsavedChanges: liveDocumentDirty }),
      replaceDocument: (contentMarkdown) => { liveDocument = contentMarkdown; liveDocumentDirty = true; },
      insertEmbed: (embed) => insertedEmbeds.push(embed),
      replaceSelection: () => undefined,
      insertAtCursor: () => undefined,
    });
    const entry = new URL("./plugin-host-capabilities.fixture.mjs", import.meta.url).href;
    host.installManifest({
      type: "plugin",
      id: "org.edgeever.capabilities",
      name: "Capabilities",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry,
      permissions: [],
      settings: { fields: [{ key: "endpoint", type: "text", label: "Endpoint", default: "https://api.example" }] },
    }, "https://plugins.example/capabilities/manifest.json");

    await host.setEnabled("org.edgeever.capabilities", true);
    await host.runCommand("org.edgeever.capabilities", "exercise-capabilities");

    expect(globalThis.edgeeverPluginCapabilityResult).toMatchObject({
      notebook: { id: "notebook-created", name: "Created by plugin" },
      moved: 1,
      pinned: 1,
      revisions: [{ id: "revision-1", noteId: "note-1", contentMarkdown: "First" }],
      resources: [{ id: "resource-1", noteId: "note-1", filename: "hello.txt" }],
      resourceText: "resource bytes",
      uploaded: { id: "resource-1", noteId: "note-1" },
      updatedResource: { id: "resource-1", filename: "drawing.excalidraw", contentHash: "updated-resource-hash" },
      endpoint: "https://api.example",
      note: { id: "note-1", revision: 3, contentHash: "first-hash" },
      edited: { contentMarkdown: "Updated note" },
      contentQuery: { notes: [{ id: "note-1", contentMarkdown: "First note" }], totalCount: 1 },
      templates: [{ id: "template-1", name: "Existing template" }],
      createdTemplate: { id: "template-1", name: "Plugin template" },
      updatedTemplate: { id: "template-1", name: "Updated template" },
      templatedNote: { id: "templated-note", contentMarkdown: "Template" },
      editorDocument: { noteId: "note-1", contentMarkdown: "First note", hasUnsavedChanges: false },
      editedEditorDocument: { noteId: "note-1", contentMarkdown: "Live note", hasUnsavedChanges: true },
      insertedEmbed: { pluginId: "org.edgeever.capabilities", type: "drawing", resourceId: "resource-1", data: { mode: "edit" } },
    });
    expect(updateInput).toMatchObject({
      expectedRevision: 3,
      expectedContentHash: "first-hash",
      contentMarkdown: "Updated note",
    });
    expect(opened).toEqual([{ noteId: "note-1", notebookId: "notebook-1", options: { search: "Updated note" } }]);
    expect(openedPanels).toEqual([{
      pluginId: "org.edgeever.capabilities",
      panelId: "capability-panel",
      options: { state: { resourceId: "resource-1" } },
    }]);
    expect(insertedEmbeds).toHaveLength(1);
    expect(host.getSnapshot().embeds).toEqual([{ pluginId: "org.edgeever.capabilities", type: "drawing" }]);
    const embedContainer = { dataset: {} };
    const disposeEmbed = await host.mountEmbed("org.edgeever.capabilities", "drawing", embedContainer, insertedEmbeds[0]);
    expect(embedContainer.dataset.embedId).toBe(insertedEmbeds[0].id);
    disposeEmbed();
    expect(embedContainer.dataset.embedId).toBeUndefined();
    expect(host.getSnapshot().panels[0]).toMatchObject({ presentation: "fullscreen" });
    const panelContainer = {};
    let requestedPanelClose = false;
    const disposePanel = await host.mountPanel(
      "org.edgeever.capabilities",
      "capability-panel",
      panelContainer,
      { state: { resourceId: "resource-1" } },
      () => { requestedPanelClose = true; },
    );
    expect(panelContainer.panelState).toEqual({ resourceId: "resource-1" });
    expect(panelContainer.hasPanelShell).toBe(true);
    await panelContainer.requestPanelClose();
    expect(requestedPanelClose).toBe(true);
    disposePanel();
    expect(panelContainer.panelState).toBeUndefined();
    await expect(host.getPanelCloseDecision("org.edgeever.capabilities", "capability-panel")).resolves.toEqual({
      title: "Unsaved drawing",
      message: "Close without saving?",
      confirmLabel: "Close drawing",
    });
    await expect(host.runCommand("org.edgeever.capabilities", "edit-stale-note"))
      .rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    host.setEditorAdapter({
      getSelection: () => ({ noteId: "note-1", from: 0, to: 0, empty: true, text: "", contentMarkdown: "" }),
      getDocument: () => ({ noteId: "note-1", contentMarkdown: "Draft", hasUnsavedChanges: true }),
      replaceDocument: () => undefined,
      insertEmbed: () => undefined,
      replaceSelection: () => undefined,
      insertAtCursor: () => undefined,
    });
    await expect(host.runCommand("org.edgeever.capabilities", "exercise-capabilities"))
      .rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    delete globalThis.edgeeverPluginCapabilityResult;
    await host.dispose();
  });

  test("applies non-overlapping Markdown edits and rejects invalid ranges", () => {
    expect(applyPluginMarkdownEdits("one two three", [
      { from: 8, to: 13, insert: "THREE" },
      { from: 0, to: 3, insert: "ONE" },
    ])).toBe("ONE two THREE");
    expect(() => applyPluginMarkdownEdits("abcdef", [
      { from: 1, to: 4, insert: "x" },
      { from: 3, to: 5, insert: "y" },
    ])).toThrow("cannot overlap");
    expect(() => applyPluginMarkdownEdits("A😀B", [{ from: 2, to: 2, insert: "x" }]))
      .toThrow("surrogate pair");
  });

  test("delivers successful user and plugin repository mutations through one workspace event stream", async () => {
    const updatedMemo = {
      id: "note-events",
      notebookId: "notebook-1",
      title: "Updated",
      excerpt: "Updated",
      tags: ["events"],
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      revision: 2,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:01:00.000Z",
      deletedAt: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "Updated",
      contentText: "Updated",
      contentHash: "updated-hash",
      sourceMemoIds: [],
      mergeSourceCount: 0,
      mergedIntoMemoId: null,
    };
    const createdTemplate = {
      id: "template-events",
      name: "Event template",
      description: null,
      title: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "Template",
      tags: ["events"],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const updatedResource = {
      id: "resource-events",
      memoId: "note-events",
      originalMemoId: null,
      kind: "attachment",
      mimeType: "application/vnd.excalidraw+json",
      filename: "drawing.excalidraw",
      byteSize: 5,
      sha256: "resource-event-hash",
      width: null,
      height: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:01:00.000Z",
      url: "/api/v1/resources/resource-events/blob",
    };
    const repositoryWithEvents = withRepositoryMutationEvents({
      ...repository,
      updateMemo: async () => ({ memo: updatedMemo, queued: true }),
      createTemplate: async () => ({ template: createdTemplate, queued: true }),
      updateResource: async () => ({ resource: updatedResource }),
    }, "event-workspace");
    const packageStorage = { get: async () => null, put: async () => undefined, remove: async () => undefined };
    const host = new EdgeEverPluginHost({ repository: repositoryWithEvents, scope: "event-workspace", packageStorage });
    host.installManifest({
      type: "plugin",
      id: "org.edgeever.events",
      name: "Events",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry: new URL("./plugin-host-events.fixture.mjs", import.meta.url).href,
      permissions: ["notes:read", "templates:read", "resources:read"],
      settings: { fields: [{ key: "mode", type: "select", label: "Mode", default: "daily", options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
      ] }] },
    }, "https://plugins.example/events/manifest.json");
    await host.setEnabled("org.edgeever.events", true);
    await host.activateEnabled();

    host.installManifest({
      type: "plugin",
      id: "org.edgeever.events-other",
      name: "Other Events",
      version: "1.0.0",
      apiVersion: "2",
      settingsUi: "host",
      entry: new URL("./plugin-host-events.fixture.mjs", import.meta.url).href,
      permissions: [],
      settings: { fields: [{ key: "mode", type: "text", label: "Mode" }] },
    }, "https://plugins.example/events-other/manifest.json");
    await host.setEnabled("org.edgeever.events-other", true);
    await host.setSettingValue("org.edgeever.events", "mode", "weekly");
    await host.removeSettingValue("org.edgeever.events", "mode");

    await repositoryWithEvents.updateMemo(updatedMemo, {});
    await repositoryWithEvents.createTemplate({ name: "Event template" });
    await repositoryWithEvents.updateResource("resource-events", new File(["scene"], "drawing.excalidraw"), "old-hash");

    expect(globalThis.edgeeverPluginObservedNote).toMatchObject({
      id: "note-events",
      contentMarkdown: "Updated",
    });
    expect(globalThis.edgeeverPluginObservedTemplate).toMatchObject({
      id: "template-events",
      contentMarkdown: "Template",
    });
    expect(globalThis.edgeeverPluginObservedResource).toMatchObject({
      id: "resource-events",
      contentHash: "resource-event-hash",
    });
    expect(globalThis.edgeeverPluginObservedSettings).toEqual([
      { pluginId: "org.edgeever.events", key: "mode" },
      { pluginId: "org.edgeever.events", key: "mode" },
    ]);
    delete globalThis.edgeeverPluginObservedNote;
    delete globalThis.edgeeverPluginObservedTemplate;
    delete globalThis.edgeeverPluginObservedResource;
    delete globalThis.edgeeverPluginObservedSettings;
    await host.dispose();
  });
});

const structured = await import("@edgeever/shared");
describe("structured plugin note APIs", () => {
  const setup = (contentMarkdown, contentJson = structured.markdownToDoc(contentMarkdown)) => {
    let memo = { id: "note-1", notebookId: "book", title: "Original", excerpt: "", tags: ["keep"], isPinned: false,
      createdAt: "2026-01-01", updatedAt: "2026-01-01", revision: 4, contentHash: "cloud-hash", contentMarkdown, contentJson, contentText: "" };
    const saves = [];
    const resources = [];
    let onResourceRead = () => {};
    const host = new EdgeEverPluginHost({ scope: "structured", repository: {
      getMemo: async () => ({ memo: structuredClone(memo) }),
      listResources: async () => { onResourceRead(); return { resources }; },
      updateMemo: async (current, input) => {
        saves.push(input);
        // Simulate an offline Web write: cloud revision/hash have not advanced yet.
        memo = { ...memo, ...input };
        return { memo: structuredClone(memo) };
      },
    }});
    const context = host.createContext({ id: "org.test.structured", permissions: [] }, []);
    return { host, context, saves, resources, setResourceRead: (callback) => { onResourceRead = callback; }, getMemo: () => memo, change: (patch) => { memo = { ...memo, ...patch }; } };
  };
  const input = result => ({ expectedRevision: result.note.revision, expectedContentHash: result.note.contentHash, expectedEditToken: result.editToken });
  const diagramMarkdown = () => structured.serializeDiagramDocument({ schemaVersion: 1, kind: "mind-map", theme: "slate", structure: "tree",
    nodes: [{ id: "root", label: "Root", shape: "topic", x: 71, y: 22, width: 120, height: 40 }], edges: [] });
  const tableMarkdown = () => structured.serializeTableDocument({ schemaVersion: 1,
    fields: [{ id: "name", name: "Name", type: "text" }, { id: "file", name: "File", type: "attachment" }],
    records: [{ id: "row", cells: { name: "Original", file: [] } }], view: { filters: [], sort: null } });

  test("exposes full detached content and preserves special notes on metadata updates", async () => {
    const originalDoc = { type: "doc", content: [{ type: "paragraph", attrs: { custom: "preserve" } }] };
    const f = setup(diagramMarkdown(), originalDoc);
    const read = await f.context.notes.get("note-1");
    expect(read.kind).toBe("mind-map");
    read.contentJson.content[0].attrs.custom = "changed";
    expect(f.getMemo().contentJson).toEqual(originalDoc);
    await f.context.notes.update("note-1", { title: "Renamed", tags: ["new"] });
    expect(f.saves[0].contentJson).toEqual(originalDoc);
    expect(f.saves[0].contentMarkdown).toBe(diagramMarkdown());
    await expect(f.context.notes.update("note-1", { contentMarkdown: "oops" })).rejects.toMatchObject({ code: "STRUCTURED_NOTE_REQUIRED" });
    await expect(f.context.notes.editMarkdown("note-1", { expectedRevision: 4, expectedContentHash: "cloud-hash", edits: [{ from: 0, to: 0, insert: "oops" }] })).rejects.toMatchObject({ code: "STRUCTURED_NOTE_REQUIRED" });
    expect(f.saves).toHaveLength(1);
  });

  test("previews and edits diagrams while preserving styles and rejecting stale unsynced snapshots", async () => {
    const f = setup(diagramMarkdown());
    const snapshot = await f.context.diagrams.get("note-1", { includeLayout: true });
    const edit = { ...input(snapshot), operations: [{ op: "update_node", nodeId: "root", changes: { label: "Edited" } }] };
    const preview = await f.context.diagrams.edit("note-1", { ...edit, dryRun: true });
    expect(preview.diagram.nodes[0].label).toBe("Edited");
    expect(preview.note.contentMarkdown).toBe(snapshot.note.contentMarkdown);
    expect(f.saves).toHaveLength(0);
    const result = await f.context.diagrams.edit("note-1", edit);
    expect(result.diagram).toMatchObject({ theme: "slate", structure: "tree" });
    expect(result.diagram.nodes[0].layout).toMatchObject({ x: 71, y: 22 });
    await expect(f.context.diagrams.edit("note-1", edit)).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    expect(f.saves).toHaveLength(1);
  });

  test("rejects invalid diagram batches without a partial write", async () => {
    const f = setup(diagramMarkdown());
    const read = await f.context.diagrams.get("note-1");
    await expect(f.context.diagrams.edit("note-1", { ...input(read), operations: [
      { op: "update_node", nodeId: "root", changes: { label: "Must not save" } },
      { op: "add_edge", edge: { source: "root", target: "missing" } },
    ] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    expect(f.saves).toHaveLength(0);
    expect((await f.context.diagrams.get("note-1")).diagram.nodes[0].label).toBe("Root");
  });

  test("applies table records and cells as one batch and rejects bad values atomically", async () => {
    const f = setup(tableMarkdown());
    let read = await f.context.tables.get("note-1");
    await expect(f.context.tables.edit("note-1", { ...input(read), operations: [
      { op: "update_record", recordId: "row", cells: { name: "Must not save" } },
      { op: "update_record", recordId: "row", cells: { missing: "oops" } },
    ] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    expect(f.saves).toHaveLength(0);
    const result = await f.context.tables.edit("note-1", { ...input(read), operations: [
      { op: "update_record", recordId: "row", cells: { name: "Edited" } },
      { op: "add_record", recordId: "row2", cells: { name: "New" } },
    ] });
    expect(result.table.records.map(row => row.cells.name)).toEqual(["Edited", "New"]);
    expect(f.saves).toHaveLength(1);
    await expect(f.context.tables.edit("note-1", { ...input(read), operations: [{ op: "remove_record", recordId: "row" }] })).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    read = await f.context.tables.get("note-1");
    await f.context.tables.edit("note-1", { ...input(read), operations: [{ op: "remove_record", recordId: "row2" }] });
    expect(f.getMemo().tags).toEqual(["keep"]);
  });

  test("previews destructive schema changes and requires explicit data conversion", async () => {
    const f = setup(tableMarkdown());
    const read = await f.context.tables.get("note-1");
    const edit = { ...input(read), operations: [{ op: "update_field", fieldId: "name", changes: { type: "number" } }] };
    const preview = await f.context.tables.edit("note-1", { ...edit, dryRun: true });
    expect(preview.changedCellCount).toBe(1);
    expect(f.saves).toHaveLength(0);
    await expect(f.context.tables.edit("note-1", edit)).rejects.toMatchObject({ code: "TABLE_DATA_CHANGES_REQUIRED" });
    await f.context.tables.edit("note-1", { ...edit, allowDataChanges: true });
    expect(f.saves).toHaveLength(1);
  });

  test("validates attachment ownership and resolves metadata through the repository", async () => {
    const f = setup(tableMarkdown());
    const read = await f.context.tables.get("note-1");
    const edit = { ...input(read), operations: [{ op: "update_record", recordId: "row", cells: { file: ["attachment"] } }] };
    f.resources.push({ id: "attachment", memoId: "other-note", kind: "attachment", filename: "a.pdf", mimeType: "application/pdf", byteSize: 12 });
    await expect(f.context.tables.edit("note-1", edit)).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    f.resources[0].memoId = "note-1";
    const result = await f.context.tables.edit("note-1", edit);
    expect(result.table.records[0].cells.file).toEqual([{ resourceId: "attachment", filename: "a.pdf", mimeType: "application/pdf", byteSize: 12 }]);
  });

  test("rejects dirty editors, wrong note types, and concurrent writes using the same snapshot", async () => {
    const f = setup(tableMarkdown());
    const read = await f.context.tables.get("note-1");
    const edit = { ...input(read), operations: [{ op: "update_record", recordId: "row", cells: { name: "Edited" } }] };
    f.host.setEditorAdapter({ getDocument: () => ({ noteId: "note-1", contentMarkdown: "draft", hasUnsavedChanges: true }) });
    await expect(f.context.tables.edit("note-1", edit)).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    await expect(f.context.editor.insertAtCursor("oops")).rejects.toMatchObject({ code: "STRUCTURED_NOTE_REQUIRED" });
    await expect(f.context.editor.replaceSelection("oops")).rejects.toMatchObject({ code: "STRUCTURED_NOTE_REQUIRED" });
    await expect(f.context.editor.editMarkdown([{ from: 0, to: 0, insert: "oops" }])).rejects.toMatchObject({ code: "STRUCTURED_NOTE_REQUIRED" });
    f.host.setEditorAdapter(null);
    await expect(f.context.diagrams.get("note-1")).rejects.toMatchObject({ code: "NOTE_TYPE_MISMATCH" });
    const results = await Promise.allSettled([f.context.tables.edit("note-1", edit), f.context.tables.edit("note-1", edit)]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.saves).toHaveLength(1);
  });

  test("rechecks the saved baseline after asynchronous attachment validation", async () => {
    const f = setup(tableMarkdown());
    const read = await f.context.tables.get("note-1");
    f.resources.push({ id: "attachment", memoId: "note-1", kind: "attachment", filename: "file", mimeType: "text/plain", byteSize: 1 });
    f.setResourceRead(() => f.change({ title: "Changed elsewhere" }));
    await expect(f.context.tables.edit("note-1", { ...input(read), operations: [
      { op: "update_record", recordId: "row", cells: { file: ["attachment"] } },
    ] })).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    expect(f.saves).toHaveLength(0);
    expect(f.getMemo().title).toBe("Changed elsewhere");
  });

  test("rejects missing snapshot tokens and invalid typed cells", async () => {
    const f = setup(tableMarkdown());
    const read = await f.context.tables.get("note-1");
    await expect(f.context.tables.edit("note-1", { expectedRevision: 4, expectedContentHash: "cloud-hash", operations: [] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    await expect(f.context.tables.edit("note-1", { ...input(read), operations: [
      { op: "add_field", field: { name: "Count", type: "number" } },
      { op: "update_record", recordId: "row", cells: { name: 42 } },
    ] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    expect(f.saves).toHaveLength(0);
  });

  test("previews poster element changes, preserves locked elements and rejects stale snapshots", async () => {
    const poster = structured.createPosterDocument("Original", "Keep subtitle");
    poster.elements.find(element => element.id === "subtitle").locked = true;
    poster.previewResourceId = "old-preview";
    const f = setup(structured.serializePosterDocument(poster));
    const read = await f.context.posters.get("note-1");
    expect((await f.context.posters.capabilities()).editableFields).toContain("text");
    const edit = { ...input(read), edits: [{ id: "heading", patch: { text: "Edited", fill: "#16A06E" } }] };
    const preview = await f.context.posters.edit("note-1", { ...edit, dryRun: true });
    expect(preview.poster.elements.find(element => element.id === "heading").text).toBe("Edited");
    expect(preview.poster.previewResourceId).toBeUndefined();
    expect(f.saves).toHaveLength(0);
    const result = await f.context.posters.edit("note-1", edit);
    expect(result.poster.elements.find(element => element.id === "subtitle")).toEqual(poster.elements.find(element => element.id === "subtitle"));
    expect(f.getMemo().tags).toEqual(["keep"]);
    await expect(f.context.posters.edit("note-1", edit)).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    const fresh = await f.context.posters.get("note-1");
    await expect(f.context.posters.edit("note-1", { ...input(fresh), operations: [{ op: "remove", ids: ["subtitle"] }] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    await expect(f.context.posters.edit("note-1", { ...input(fresh), operations: [{ op: "apply_template", template: "bold" }] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    expect(f.saves).toHaveLength(1);
  });

  test("rejects poster partial batches and foreign image resources", async () => {
    const f = setup(structured.serializePosterDocument(structured.createPosterDocument("Original")));
    const read = await f.context.posters.get("note-1");
    const image = { id: "image", name: "Image", type: "image", resourceId: "resource", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 };
    const edit = { ...input(read), operations: [{ op: "add", element: image }] };
    f.resources.push({ id: "resource", memoId: "other-note", kind: "image" });
    await expect(f.context.posters.edit("note-1", edit)).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    expect(f.saves).toHaveLength(0);
    await expect(f.context.posters.edit("note-1", { ...input(read), edits: [{ id: "heading", patch: { text: "Must not save" } }], operations: [{ op: "remove", ids: ["missing"] }] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    expect(f.saves).toHaveLength(0);
    f.resources[0].memoId = "note-1";
    const result = await f.context.posters.edit("note-1", edit);
    expect(result.poster.elements.find(element => element.id === "image")).toEqual(image);
  });

  test("reads and edits infographic data without losing styles or conversation history", async () => {
    const infographic = { schemaVersion: 1, syntax: "infographic list-grid-simple\ndata\n  title Original\n  lists\n    - label First\n      desc Keep\ntheme dark\n  colorBg #123456", history: [
      { id: "history", prompt: "Create", createdAt: "2026-01-01", kind: "generated", resultTitle: "Original" },
    ] };
    const f = setup(structured.serializeInfographicDocument(infographic));
    const read = await f.context.infographics.get("note-1");
    expect((await f.context.infographics.capabilities()).templates).toContain("list-grid-simple");
    expect((await f.context.infographics.capabilities()).themes).toContain("dark");
    expect(read).toMatchObject({ template: "list-grid-simple", theme: "dark", data: { title: "Original", lists: [{ label: "First", desc: "Keep" }] } });
    const edit = { ...input(read), operations: [{ op: "set_data", path: ["lists", 0, "label"], value: "Edited" }] };
    const preview = await f.context.infographics.edit("note-1", { ...edit, dryRun: true });
    expect(preview.infographic.syntax).toContain("label Edited");
    expect(f.saves).toHaveLength(0);
    const result = await f.context.infographics.edit("note-1", edit);
    expect(result.infographic.history).toEqual(infographic.history);
    expect(result.infographic.syntax).toContain("theme dark\n  colorBg #123456");
    expect(f.getMemo().title).toBe("Original");
    await expect(f.context.infographics.edit("note-1", edit)).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    const fresh = await f.context.infographics.get("note-1");
    expect(fresh.data.lists[0].desc).toBe("Keep");
    expect(f.saves).toHaveLength(1);
  });

  test("rejects wrong poster/infographic types, dirty editors and invalid infographic batches", async () => {
    const f = setup(structured.serializeInfographicDocument({ schemaVersion: 1, syntax: "infographic list-grid-simple\ndata\n  lists\n    - label Original" }));
    const read = await f.context.infographics.get("note-1");
    await expect(f.context.posters.get("note-1")).rejects.toMatchObject({ code: "NOTE_TYPE_MISMATCH" });
    await expect(f.context.infographics.edit("note-1", { ...input(read), operations: [
      { op: "set_data", path: ["lists", 0, "label"], value: "Must not save" },
      { op: "remove_data", path: ["lists", 8] },
    ] })).rejects.toMatchObject({ code: "INVALID_STRUCTURED_EDIT" });
    f.host.setEditorAdapter({ getDocument: () => ({ noteId: "note-1", contentMarkdown: "draft", hasUnsavedChanges: true }) });
    await expect(f.context.infographics.edit("note-1", { ...input(read), operations: [{ op: "set_theme", theme: "dark" }] })).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
    expect(f.saves).toHaveLength(0);
  });

  test("protects poster and infographic markers, including malformed payloads", async () => {
    for (const kind of ["poster", "infographic", "diagram", "table"]) {
      const f = setup(`Body\n<!-- edgeever-${kind}-v1:invalid -->`);
      await expect(f.context.notes.update("note-1", { contentMarkdown: "oops" })).rejects.toMatchObject({ code: "STRUCTURED_NOTE_REQUIRED" });
      expect(f.saves).toHaveLength(0);
    }
  });
});
