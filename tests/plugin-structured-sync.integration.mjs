// Real IndexedDB repository -> in-process API/SQLite -> native sidecar repository.
// Every database and native process uses a temporary directory; no account data is read.
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
const storage = new Map();
globalThis.window = Object.assign(new EventTarget(), {
  location: { hostname: "edgeever.test", origin: "http://edgeever.test", href: "http://edgeever.test/" },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key), get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null },
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {}, style: { setProperty() {}, removeProperty() {} }, removeAttribute() {} } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

const shared = await import("@edgeever/shared");
const { fetchEdgeEverApp } = await import("../apps/api/src/index.ts");
const { createSelfHostedStorageAdapter } = await import("../apps/api/src/self-hosted-storage-adapter.ts");
const { createEdgeEverClient } = await import("../packages/client/src/index.ts");
const { api } = await import("../apps/web/src/lib/api.ts");
const { createWebRepository } = await import("../apps/web/src/lib/repository.ts");
const { createDesktopRepository } = await import("../apps/web/src/lib/desktop-repository.ts");
const { withRepositoryMutationEvents } = await import("../apps/web/src/lib/repository-events.ts");
const { EdgeEverPluginHost } = await import("../apps/web/src/lib/plugins/plugin-host.ts");
const { localDb } = await import("../apps/web/src/lib/local-db.ts");
const { syncQueuedChanges } = await import("../apps/web/src/lib/sync-queue.ts");
const { syncDesktopData } = await import("../apps/web/src/lib/desktop-sync.ts");

const temporary = await mkdtemp(join(tmpdir(), "edgeever-plugin-sync-"));
const children = new Set();
let cloud;
const checked = [];
const nativePath = resolve(process.env.EDGE_EVER_SIDECAR_PATH ?? "crates/desktop-sidecar/target/debug/edgeever-sidecar");
const migrations = resolve("migrations");
const startNative = async (path, directory, migrationsDir = migrations) => {
  const child = spawn(path, ["--data-dir", directory, "--migrations-dir", migrationsDir], { stdio: ["pipe", "pipe", "inherit"] });
  children.add(child);
  let sequence = 0;
  const pending = new Map();
  const exited = new Promise(resolveExit => child.once("close", resolveExit));
  let readyResolve, readyReject;
  const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
  child.on("error", readyReject);
  child.on("close", () => { readyReject(new Error("Sidecar exited before becoming ready")); children.delete(child); for (const request of pending.values()) request.reject(new Error("Sidecar exited")); });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    const message = JSON.parse(line);
    if (message.event === "ready") readyResolve();
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    else request.resolve(message.result);
  });
  await ready;
  return {
    request: (method, params = {}) => new Promise((resolveResult, rejectResult) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); rejectResult(new Error(`Sidecar timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve: result => { clearTimeout(timeout); resolveResult(result); }, reject: error => { clearTimeout(timeout); rejectResult(error); } });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    }),
    close: async () => { child.stdin.end(); await exited; },
  };
};
const attachNative = native => {
  window.edgeeverDesktop = { isAvailable: true, sidecarRequest: native.request, listStagedResources: async () => [], listStagedResourceAliases: async () => [], remapStagedResourceMemoIds: async () => {} };
};
const makeContext = repository => {
  const host = new EdgeEverPluginHost({ repository: withRepositoryMutationEvents(repository, "plugin-sync"), scope: "plugin-sync" });
  return host.createContext({ id: "org.test.plugin-sync", permissions: [] }, []);
};
const baseline = snapshot => ({ expectedRevision: snapshot.note.revision, expectedContentHash: snapshot.note.contentHash, expectedEditToken: snapshot.editToken });
const fixtures = [
  { api: "diagrams", document: { schemaVersion: 1, kind: "mind-map", theme: "slate", structure: "tree", nodes: [{ id: "root", label: "Original", shape: "topic", x: 40, y: 20, width: 120, height: 40 }], edges: [] }, serialize: shared.serializeDiagramDocument,
    edit: text => ({ operations: [{ op: "update_node", nodeId: "root", changes: { label: text } }] }), value: snapshot => snapshot.diagram.nodes[0].label },
  { api: "tables", document: { schemaVersion: 1, fields: [{ id: "name", name: "Name", type: "text" }], records: [{ id: "row", cells: { name: "Original" } }], view: { filters: [], sort: null } }, serialize: shared.serializeTableDocument,
    edit: text => ({ operations: [{ op: "update_record", recordId: "row", cells: { name: text } }] }), value: snapshot => snapshot.table.records[0].cells.name },
  { api: "posters", document: shared.createPosterDocument("Original", "Keep subtitle"), serialize: shared.serializePosterDocument,
    edit: text => ({ edits: [{ id: "heading", patch: { text } }] }), value: snapshot => snapshot.poster.elements.find(element => element.id === "heading").text },
  { api: "infographics", document: { schemaVersion: 1, syntax: "infographic list-grid-simple\ndata\n  lists\n    - label Original\n      desc Keep\ntheme dark\n  colorBg #123456" }, serialize: shared.serializeInfographicDocument,
    edit: text => ({ operations: [{ op: "set_data", path: ["lists", 0, "label"], value: text }] }), value: snapshot => snapshot.data?.lists[0].label ?? /- label (.+)/.exec(snapshot.infographic.syntax)[1] },
];
try {
  // Use the actual installed old binary only when explicitly supplied. It is
  // started against a test directory, never the installed application's data.
  if (process.env.EDGE_EVER_LEGACY_SIDECAR_PATH) {
    const path = resolve(process.env.EDGE_EVER_LEGACY_SIDECAR_PATH);
    const oldMigrations = process.env.EDGE_EVER_LEGACY_MIGRATIONS_PATH ?? join(dirname(dirname(path)), "migrations");
    const directory = join(temporary, "legacy");
    let native = await startNative(path, directory, oldMigrations);
    attachNative(native);
    const notebook = (await native.request("notebook.list")).notebooks.find(book => book.slug === "inbox");
    const oldNotes = [];
    const oldContext = makeContext(createDesktopRepository());
    for (const fixture of fixtures) {
      const markdown = fixture.serialize(fixture.document);
      const memo = (await native.request("memo.create", { notebookId: notebook.id, title: fixture.api, tags: ["keep"], contentMarkdown: markdown, contentJson: shared.markdownToDoc(markdown) })).memo;
      oldNotes.push({ fixture, memo });
      const read = await oldContext[fixture.api].get(memo.id);
      await assert.rejects(oldContext[fixture.api].edit(memo.id, { ...baseline(read), ...fixture.edit("Unsafe old host") }), error => error.code === "HOST_UPGRADE_REQUIRED");
      assert.equal((await native.request("memo.get", { memoId: memo.id })).memo.contentMarkdown, markdown);
    }
    await native.close();
    native = await startNative(nativePath, directory);
    attachNative(native);
    const context = makeContext(createDesktopRepository());
    for (const { fixture, memo } of oldNotes) {
      const loaded = await native.request("memo.get", { memoId: memo.id });
      assert.deepEqual(loaded.memo.contentJson, memo.contentJson);
      assert.equal(loaded.memo.contentMarkdown, memo.contentMarkdown);
      const read = await context[fixture.api].get(memo.id);
      await context[fixture.api].edit(memo.id, { ...baseline(read), ...fixture.edit("Upgraded") });
      assert.equal(fixture.value(await context[fixture.api].get(memo.id)), "Upgraded");
      assert.ok((await native.request("memo.revisions", { memoId: memo.id })).revisions.some(revision => revision.contentMarkdown === memo.contentMarkdown));
    }
    await native.close();
    native = await startNative(path, directory, oldMigrations);
    attachNative(native);
    const rollbackContext = makeContext(createDesktopRepository());
    for (const { fixture, memo } of oldNotes) {
      assert.equal(fixture.value(await rollbackContext[fixture.api].get(memo.id)), "Upgraded");
    }
    await native.close();
    checked.push("installed-old-sidecar -> current-sidecar -> old-sidecar: all four note types and history", "old-sidecar rejects guarded edits without fallback");
  }

  cloud = new Database(join(temporary, "cloud.sqlite"), { create: true });
  cloud.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) cloud.exec(await readFile(join(migrations, name), "utf8"));
  cloud.query("INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)").run();
  const environment = { storage: createSelfHostedStorageAdapter(cloud, join(temporary, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
  let reachable = true;
  const client = createEdgeEverClient({ baseUrl: "http://edgeever.test", fetch: (input, init) => {
    if (!reachable) throw new Error("Test network is offline");
    return fetchEdgeEverApp(new Request(input, init), environment, { waitUntil() {}, passThroughOnException() {} });
  }});
  Object.assign(api, client);
  const scope = "http://edgeever.test|plugin-sync";
  const repository = createWebRepository(scope);
  const context = makeContext(repository);
  const notebook = (await client.createNotebook({ name: "Structured sync" })).notebook;
  const notes = [];
  for (const fixture of fixtures) {
    const markdown = fixture.serialize(fixture.document);
    const memo = (await client.createMemo({ notebookId: notebook.id, title: fixture.api, tags: ["keep"], contentMarkdown: markdown, contentJson: shared.markdownToDoc(markdown) })).memo;
    notes.push({ fixture, memo });
  }
  await repository.sync();
  reachable = false;
  navigator.onLine = false;
  for (const { fixture, memo } of notes) {
    const read = await context[fixture.api].get(memo.id);
    await context[fixture.api].edit(memo.id, { ...baseline(read), ...fixture.edit("Web offline") });
    assert.equal(fixture.value(await context[fixture.api].get(memo.id)), "Web offline");
    await assert.rejects(context[fixture.api].edit(memo.id, { ...baseline(read), ...fixture.edit("Stale") }), error => error.code === "NOTE_CONFLICT");
    const queued = await localDb.syncQueue.get(`memo.update:${memo.id}`);
    assert.equal(queued.payload.contentMarkdown, (await localDb.memos.get([scope, memo.id])).contentMarkdown);
    assert.equal(queued.payload.editSessionId, "plugin:org.test.plugin-sync");
  }
  reachable = true;
  navigator.onLine = true;
  assert.deepEqual(await syncQueuedChanges({ scope }), { attempted: 4, synced: 4, failed: 0, conflicted: 0 });
  assert.equal(await localDb.syncQueue.count(), 0);
  checked.push("Web offline saves + guarded snapshots + real API synchronization");

  const appearance = { icon: "alarm-clock", color: "#2563eb", textColor: "#dc2626", isBold: true, iconInverted: true, rowInverted: true };
  await client.updateNotebook(notebook.id, appearance);
  await repository.sync();
  const nativeDirectory = join(temporary, "desktop");
  let native = await startNative(nativePath, nativeDirectory);
  attachNative(native);
  let desktopContext = makeContext(createDesktopRepository());
  const bootstrap = await syncDesktopData();
  assert.equal(bootstrap.failed, 0);
  const nativeNotebook = (await native.request("notebook.list")).notebooks.find(item => item.id === notebook.id);
  for (const [key, value] of Object.entries(appearance)) assert.equal(nativeNotebook[key], value);
  const desktopAppearance = { ...appearance, icon: "network", color: "#7c3aed", textColor: "#16a34a", iconInverted: false, rowInverted: false, isBold: false };
  await native.request("notebook.update", { notebookId: notebook.id, ...desktopAppearance });
  const appearanceSynced = await syncDesktopData();
  assert.equal(appearanceSynced.failed, 0);
  assert.equal(appearanceSynced.synced, 1);
  await repository.sync();
  const webNotebook = await localDb.notebooks.get([scope, notebook.id]);
  for (const [key, value] of Object.entries(desktopAppearance)) assert.equal(webNotebook[key], value);
  checked.push("notebook appearance: real API -> native desktop -> real API -> Web mirror");

  for (const { fixture, memo } of notes) assert.equal(fixture.value(await desktopContext[fixture.api].get(memo.id)), "Web offline");
  reachable = false;
  navigator.onLine = false;
  for (const { fixture, memo } of notes) {
    const read = await desktopContext[fixture.api].get(memo.id);
    await desktopContext[fixture.api].edit(memo.id, { ...baseline(read), ...fixture.edit("Desktop offline") });
    assert.equal(fixture.value(await desktopContext[fixture.api].get(memo.id)), "Desktop offline");
  }
  await native.close();
  native = await startNative(nativePath, nativeDirectory);
  attachNative(native);
  desktopContext = makeContext(createDesktopRepository());
  for (const { fixture, memo } of notes) assert.equal(fixture.value(await desktopContext[fixture.api].get(memo.id)), "Desktop offline");
  reachable = true;
  navigator.onLine = true;
  const synced = await syncDesktopData();
  assert.equal(synced.failed, 0);
  assert.equal(synced.conflicted, 0);
  assert.equal(synced.synced, 4);
  await repository.sync();
  for (const { fixture, memo } of notes) {
    assert.equal(fixture.value(await context[fixture.api].get(memo.id)), "Desktop offline");
    const history = (await client.listMemoRevisions(memo.id)).revisions;
    // Server history uses an existing five-minute snapshot interval. Verify
    // the original recoverable snapshot, without requiring every intermediate save.
    assert.ok(history.some(revision => revision.contentMarkdown === memo.contentMarkdown));
  }
  checked.push("native desktop offline persistence + restart + real API upload + Web download + history");

  // Both clients change the same cloud base. The losing Web draft must stay
  // durable and a plugin must not reset its conflict to pending.
  const { fixture, memo } = notes[1];
  reachable = false;
  navigator.onLine = false;
  const webBase = await context[fixture.api].get(memo.id);
  const desktopBase = await desktopContext[fixture.api].get(memo.id);
  await context[fixture.api].edit(memo.id, { ...baseline(webBase), ...fixture.edit("Web conflict") });
  await desktopContext[fixture.api].edit(memo.id, { ...baseline(desktopBase), ...fixture.edit("Desktop wins") });
  reachable = true;
  navigator.onLine = true;
  assert.equal((await syncDesktopData()).conflicted, 0);
  assert.equal((await syncQueuedChanges({ scope })).conflicted, 1);
  const conflict = await localDb.syncQueue.get(`memo.update:${memo.id}`);
  assert.equal(conflict.status, "conflict");
  const latestWeb = await context[fixture.api].get(memo.id);
  await assert.rejects(context[fixture.api].edit(memo.id, { ...baseline(latestWeb), ...fixture.edit("Must stay blocked") }), error => error.code === "NOTE_CONFLICT");
  assert.deepEqual(await localDb.syncQueue.get(conflict.id), conflict);
  assert.ok(conflict.payload.contentMarkdown.includes("Web conflict"), "the losing local draft remains recoverable in the conflict queue");
  await repository.adoptCloudMemo(memo.id);
  assert.equal(fixture.value(await context[fixture.api].get(memo.id)), "Desktop wins");
  checked.push("two-client sync conflicts preserved until explicit recovery");
  // A failed outbox write must also roll back memo content and local history.
  const inspection = new Database(join(nativeDirectory, "edgeever.sqlite"));
  const beforeMemo = (await native.request("memo.get", { memoId: memo.id })).memo;
  const beforeHistory = (await native.request("memo.revisions", { memoId: memo.id })).revisions;
  const safeBase = await desktopContext[fixture.api].get(memo.id);
  inspection.exec("CREATE TRIGGER fail_guarded_queue BEFORE INSERT ON _edgeever_sidecar_outbox BEGIN SELECT RAISE(ABORT, 'test outbox unavailable'); END");
  try {
    await assert.rejects(desktopContext[fixture.api].edit(memo.id, { ...baseline(safeBase), ...fixture.edit("Must roll back") }), /test outbox unavailable/);
    assert.deepEqual((await native.request("memo.get", { memoId: memo.id })).memo, beforeMemo);
    assert.deepEqual((await native.request("memo.revisions", { memoId: memo.id })).revisions, beforeHistory);
  } finally { inspection.exec("DROP TRIGGER fail_guarded_queue"); inspection.close(); }
  checked.push("native guarded memo/history/outbox failure rolls back atomically");

  reachable = false;
  navigator.onLine = false;
  const desktopConflictBase = await desktopContext[fixture.api].get(memo.id);
  await desktopContext[fixture.api].edit(memo.id, { ...baseline(desktopConflictBase), ...fixture.edit("Desktop conflict") });
  const webWinnerBase = await context[fixture.api].get(memo.id);
  await context[fixture.api].edit(memo.id, { ...baseline(webWinnerBase), ...fixture.edit("Web wins") });
  reachable = true;
  navigator.onLine = true;
  assert.equal((await syncQueuedChanges({ scope })).conflicted, 0);
  assert.equal((await syncDesktopData()).conflicted, 1);
  const nativeQueue = (await native.request("sync.outbox.list", { limit: 200, includeConflicts: true })).items;
  const nativeConflict = nativeQueue.find(item => item.entityId === memo.id && item.status === "conflict");
  assert.ok(nativeConflict);
  const blockedBase = await desktopContext[fixture.api].get(memo.id);
  await assert.rejects(desktopContext[fixture.api].edit(memo.id, { ...baseline(blockedBase), ...fixture.edit("Must stay blocked") }), error => error.code === "NOTE_CONFLICT");
  const afterQueue = (await native.request("sync.outbox.list", { limit: 200, includeConflicts: true })).items;
  assert.deepEqual(afterQueue.find(item => item.id === nativeConflict.id), nativeConflict);
  await createDesktopRepository().adoptCloudMemo(memo.id);
  assert.equal(fixture.value(await desktopContext[fixture.api].get(memo.id)), "Web wins");
  const recovered = await desktopContext[fixture.api].get(memo.id);
  await desktopContext[fixture.api].edit(memo.id, { ...baseline(recovered), ...fixture.edit("Desktop recovered") });
  assert.equal(fixture.value(await desktopContext[fixture.api].get(memo.id)), "Desktop recovered");
  checked.push("native losing conflict draft and diagnostics survive blocked writes, then recover explicitly");
  const nativeRepository = createDesktopRepository();
  const raceMemo = (await nativeRepository.getMemo(notes[0].memo.id)).memo;
  const raceInput = title => ({ expectedRevision: raceMemo.revision, expectedContentHash: raceMemo.contentHash, title,
    contentMarkdown: raceMemo.contentMarkdown, contentJson: raceMemo.contentJson, tags: raceMemo.tags });
  const racing = await Promise.allSettled([
    nativeRepository.updateMemo(raceMemo, raceInput("First racing client"), { guardLocalSnapshot: true }),
    nativeRepository.updateMemo(raceMemo, raceInput("Second racing client"), { guardLocalSnapshot: true }),
  ]);
  assert.deepEqual(racing.map(result => result.status), ["fulfilled", "rejected"]);
  assert.equal(racing[1].reason.code, "NOTE_CONFLICT");
  checked.push("native storage-boundary snapshot guard rejects concurrent stale clients");

  reachable = false;
  navigator.onLine = false;
  const { notebook: trashRoot } = await nativeRepository.createNotebook({ name: "Offline folder" });
  const { notebook: trashChild } = await nativeRepository.createNotebook({ name: "Child", parentId: trashRoot.id });
  const { memo: trashNote } = await nativeRepository.createMemo({ title: "Restore later", notebookId: trashChild.id, contentMarkdown: "Original text" });
  await nativeRepository.trashNotebook(trashRoot.id);
  assert.equal((await nativeRepository.getMemo(trashNote.id, true)).memo.isDeleted, true);

  reachable = true;
  navigator.onLine = true;
  const trashSync = await syncDesktopData();
  assert.equal(trashSync.failed, 0);
  const trashNoteRemoteId = trashSync.memoIdMappings.get(trashNote.id);
  assert.ok(trashNoteRemoteId);
  assert.ok(!(await client.listNotebooks()).notebooks.some(({ name }) => name === "Offline folder" || name === "Child"));
  await repository.sync();
  assert.equal((await repository.getMemo(trashNoteRemoteId, true)).memo.isDeleted, true);
  const restored = (await client.restoreMemo(trashNoteRemoteId)).memo;
  assert.equal(restored.isDeleted, false);
  assert.equal(restored.contentMarkdown, "Original text");
  assert.ok((await client.listNotebooks()).notebooks.some(({ id, slug }) => id === restored.notebookId && slug === "inbox"));
  checked.push("new desktop notebook subtree is created and trashed in order, then restored from the web");

  await native.close();
  console.log(JSON.stringify({ ok: true, checked }));
} finally {
  await Promise.all([...children].map(child => new Promise(resolveExit => {
    child.once("close", resolveExit);
    child.kill();
  })));
  cloud?.close();
  await localDb.delete();
  await rm(temporary, { recursive: true, force: true });
}
