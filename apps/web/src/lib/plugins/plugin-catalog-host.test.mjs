import { afterAll, expect, test } from "bun:test";
import { restoreTestGlobal } from "../restore-test-global.mjs";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalMutationObserver = globalThis.MutationObserver;
const values = new Map();
const stubWindow = {
  location: { href: "https://example.test" },
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
  },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.window = stubWindow;
const stubDocument = {
  documentElement: {
    classList: { contains: () => false },
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    removeAttribute() {},
  },
};
globalThis.document = stubDocument;
const StubMutationObserver = class { observe() {} disconnect() {} };
globalThis.MutationObserver = StubMutationObserver;

const { EdgeEverPluginHost } = await import("./plugin-host.ts");

afterAll(() => {
  restoreTestGlobal("window", originalWindow, stubWindow);
  restoreTestGlobal("document", originalDocument, stubDocument);
  restoreTestGlobal("MutationObserver", originalMutationObserver, StubMutationObserver);
});

const secretStorage = { get: async () => null, set: async () => {}, remove: async () => {}, clearNamespace: async () => {} };

const pluginManifest = (id) => ({
  type: "plugin",
  id,
  name: "Catalog sync",
  version: "1.0.0",
  apiVersion: "2",
  settingsUi: "host",
  entry: new URL("./plugin-lifecycle.fixture.mjs", import.meta.url).href,
  permissions: ["notes:read", "ui:commands", "ui:panels"],
});

test("enable and uninstall update the workspace catalog", async () => {
  values.clear();
  const upserts = [];
  const removals = [];
  const host = new EdgeEverPluginHost({
    scope: "catalog-host",
    packageStorage: { get: async () => null, put: async () => {}, remove: async () => {} },
    secretStorage,
    repository: { listMemos: async () => ({ memos: [], totalCount: 0, nextCursor: null }) },
    catalogAdapter: {
      list: async () => [],
      upsert: async (extensionId, input) => {
        upserts.push({ extensionId, input });
        return {
          extensionId,
          ...input,
          repositoryUrl: input.repositoryUrl ?? null,
          releaseTag: input.releaseTag ?? null,
          publisher: input.publisher ?? null,
          updatedAt: "2026-09-14T10:00:00.000Z",
          deletedAt: null,
        };
      },
      remove: async (extensionId) => {
        removals.push(extensionId);
        return {
          extensionId,
          type: "plugin",
          version: "1.0.0",
          enabled: false,
          installedAt: "2026-09-14T09:00:00.000Z",
          updatedAt: "2026-09-14T10:00:00.000Z",
          deletedAt: "2026-09-14T10:00:00.000Z",
          manifestUrl: "https://example.test/manifest.json",
          sourceKind: "manifest",
          verified: false,
          repositoryUrl: null,
          releaseTag: null,
          publisher: null,
        };
      },
    },
  });
  const id = "org.edgeever.catalog-sync";
  host.installManifest(pluginManifest(id), "https://example.test/manifest.json");
  await host.setEnabled(id, true);
  expect(upserts.at(-1)).toMatchObject({ extensionId: id, input: { enabled: true, version: "1.0.0" } });
  await host.uninstall(id);
  expect(removals).toEqual([id]);
  await host.dispose();
});

test("a remote tombstone uninstalls the local extension without writing the catalog again", async () => {
  values.clear();
  const upserts = [];
  const removals = [];
  const id = "org.edgeever.catalog-tombstone";
  // installManifest stamps catalogUpdatedAt with now; the tombstone must be newer
  // so reconcile uninstalls instead of treating the local install as a later write.
  const tombstoneAt = new Date(Date.now() + 60_000).toISOString();
  const host = new EdgeEverPluginHost({
    scope: "catalog-tombstone",
    packageStorage: { get: async () => null, put: async () => {}, remove: async () => {} },
    secretStorage,
    repository: { listMemos: async () => ({ memos: [], totalCount: 0, nextCursor: null }) },
    catalogAdapter: {
      list: async () => [{
        extensionId: id,
        type: "plugin",
        version: "1.0.0",
        enabled: false,
        installedAt: "2026-09-13T10:00:00.000Z",
        updatedAt: tombstoneAt,
        deletedAt: tombstoneAt,
        manifestUrl: "https://example.test/manifest.json",
        sourceKind: "manifest",
        verified: false,
        repositoryUrl: null,
        releaseTag: null,
        publisher: null,
      }],
      upsert: async (extensionId, input) => {
        upserts.push({ extensionId, input });
        throw new Error("tombstone reconcile must not upsert");
      },
      remove: async (extensionId) => {
        removals.push(extensionId);
        throw new Error("tombstone reconcile must not delete again");
      },
    },
  });
  host.installManifest(pluginManifest(id), "https://example.test/manifest.json");
  await host.syncFromCatalog();
  expect(host.getSnapshot().extensions.find((item) => item.manifest.id === id)).toBeUndefined();
  expect(upserts).toEqual([]);
  expect(removals).toEqual([]);
  await host.dispose();
});

const catalogEntry = (id) => ({
  extensionId: id, type: "plugin", version: "1.0.0", enabled: false,
  installedAt: "2026-09-13T10:00:00.000Z", updatedAt: "2026-09-14T10:00:00.000Z",
  deletedAt: null, manifestUrl: `https://example.test/${id}/manifest.json`,
  sourceKind: "manifest", verified: false, repositoryUrl: null, releaseTag: null, publisher: null,
});

test("catalog read failures remain visible until a successful retry", async () => {
  values.clear();
  let fail = true;
  const host = new EdgeEverPluginHost({
    scope: "catalog-read-failure", secretStorage,
    repository: {},
    catalogAdapter: { list: async () => { if (fail) throw new Error("HTTP 503"); return []; } },
  });
  try {
    await host.syncFromCatalog();
    expect(host.getSnapshot().catalogErrors).toEqual([{ extensionId: null, message: "HTTP 503" }]);
    fail = false;
    await host.syncFromCatalog();
    expect(host.getSnapshot().catalogErrors).toEqual([]);
  } finally { await host.dispose(); }
});

test("failed restore is visible, preserves existing installs, and retries on LAN HTTP", async () => {
  values.clear();
  const oldCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const oldFetch = stubWindow.fetch;
  const oldHref = stubWindow.location.href;
  let fail = true;
  const packages = new Map();
  const writes = [];
  const remote = [catalogEntry("org.edgeever.restore-fail"), catalogEntry("org.edgeever.restore-ok"), catalogEntry("org.edgeever.restore-fail-new")];
  stubWindow.location.href = "http://192.168.1.2:8787";
  stubWindow.fetch = async (input) => {
    const url = String(input);
    if (fail && url.includes("restore-fail")) return new Response(null, { status: 503 });
    if (url.endsWith("manifest.json")) {
      const id = remote.find((entry) => url === entry.manifestUrl).extensionId;
      return Response.json({ ...pluginManifest(id), entry: "./main.js" });
    }
    if (url.endsWith("main.js")) return new Response("export default { activate() {} }");
    return new Response(null, { status: 404 });
  };
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
  const host = new EdgeEverPluginHost({
    scope: "catalog-restore-failure", secretStorage, repository: {},
    packageStorage: {
      get: async (id) => packages.get(id) ?? null,
      put: async (value) => { packages.set(value.pluginId, value); }, remove: async () => {},
    },
    catalogAdapter: {
      list: async () => remote,
      upsert: async () => { writes.push("upsert"); throw new Error("unexpected upsert"); },
      remove: async () => { writes.push("remove"); throw new Error("unexpected remove"); },
    },
  });
  try {
    host.installManifest(pluginManifest(remote[0].extensionId), remote[0].manifestUrl);
    // Simulate an older locally persisted install requiring a newer remote package.
    const saved = JSON.parse(values.get("edgeever.extensions.installed.v1"));
    saved[0].manifest.version = "0.9.0";
    saved[0].catalogUpdatedAt = "2026-09-12T10:00:00.000Z";
    values.set("edgeever.extensions.installed.v1", JSON.stringify(saved));
    await host.dispose();
    const restoredHost = new EdgeEverPluginHost({
      scope: "catalog-restore-failure", secretStorage, repository: {},
      packageStorage: { get: async (id) => packages.get(id) ?? null, put: async (value) => { packages.set(value.pluginId, value); }, remove: async () => {} },
      catalogAdapter: { list: async () => remote, upsert: async () => { writes.push("upsert"); }, remove: async () => { writes.push("remove"); } },
    });
    try {
      await restoredHost.syncFromCatalog();
      expect(restoredHost.getSnapshot().catalogErrors).toEqual([
        { extensionId: remote[0].extensionId, message: "Manifest request failed with HTTP 503." },
        { extensionId: remote[2].extensionId, message: "Manifest request failed with HTTP 503." },
      ]);
      expect(restoredHost.getSnapshot().extensions.find((item) => item.manifest.id === remote[0].extensionId).manifest.version).toBe("0.9.0");
      expect(restoredHost.getSnapshot().extensions.find((item) => item.manifest.id === remote[1].extensionId)).toBeDefined();
      fail = false;
      await restoredHost.syncFromCatalog();
      expect(restoredHost.getSnapshot().catalogErrors).toEqual([]);
      expect(restoredHost.getSnapshot().extensions).toHaveLength(3);
      expect(restoredHost.getSnapshot().extensions.find((item) => item.manifest.id === remote[0].extensionId).manifest.version).toBe("1.0.0");
      expect(packages.get(remote[0].extensionId).checksums.mainJs).toMatch(/^[a-f0-9]{64}$/);
      expect(writes).toEqual([]);
    } finally { await restoredHost.dispose(); }
  } finally {
    await host.dispose();
    Object.defineProperty(globalThis, "crypto", oldCrypto);
    stubWindow.fetch = oldFetch;
    stubWindow.location.href = oldHref;
  }
});
