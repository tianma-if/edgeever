import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { createMemoRecord, moveMemosToNotebook, updateMemoRecord } from "./memo-service.ts";
import { updateTagsForMemos } from "./tag-service.ts";
import { learnCompanionPreferences, applicableMemories } from "./companion-learning.ts";
import { listCompanionMemories, forgetCompanionMemory, saveCompanionMemory, companionRevision, importCompanionMemories } from "./companion-service.ts";
import { saveDiscoverySettings, getDiscoverySettings, checkDiscoveries, listDiscoveries, rememberDiscoveryFeedback } from "./companion-discovery.ts";
import { applyCompanionAction } from "./companion-actions.ts";

const scope = { workspaceId: "paw", ownerId: "user" };
const actor = { actorType: "user", actorId: "user" };
const opened = [];
afterEach(() => opened.splice(0).forEach(db => db.close()));
async function setup({ learning = true } = {}) {
  const sqlite = new Database(":memory:"); opened.push(sqlite);
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  sqlite.exec(`INSERT INTO workspaces(id,name) VALUES ('paw','Paw'),('other','Other');
    INSERT INTO notebooks(id,workspace_id,name) VALUES ('inbox','paw','Inbox'),('project','paw','Project'),('second','paw','Second'),('private','other','Secret');`);
  const storage = createSelfHostedStorageAdapter(sqlite, "/tmp/paw-learning-unused");
  const db = storage.db;
  await saveDiscoverySettings(db, scope, { enabled: true, version: 0, learningEnabled: learning, useMemory: true });
  const create = (tags = ["interview"], notebookId = "inbox") => createMemoRecord(db, scope.workspaceId,
    { notebookId, title: "Interview", contentMarkdown: "Customer feedback about the project", tags }, actor, "user");
  const move = async (memo, day = 0, who = actor) => {
    await moveMemosToNotebook(db, scope.workspaceId, [memo.id], "project", who, "user");
    sqlite.query("UPDATE audit_events SET created_at = ? WHERE entity_id = ? AND action = 'memo.move'")
      .run(new Date(Date.now() - day * 86400000).toISOString(), memo.id);
  };
  const learn = async () => { await learnCompanionPreferences(db, scope); return listCompanionMemories(db, scope); };
  const auth = { kind: "user", actorType: "user", actorId: "user", workspaceId: "paw", role: "member", scopes: [] };
  const context = { env: { storage }, get: () => auth };
  return { sqlite, db, create, move, learn, context };
}

test("three independent choices across days become an applicable scoped preference; retries do not add evidence", async () => {
  const f = await setup();
  for (let day = 0; day < 3; day++) await f.move(await f.create(), day);
  const [memory] = await f.learn();
  expect(memory).toMatchObject({ kind: "inferred", state: "active", scopeNotebookId: "project" });
  expect(memory.evidence).toHaveLength(3);
  const epoch = await companionRevision(f.db, scope);
  await f.learn(); expect(await companionRevision(f.db, scope)).toBe(epoch);
  expect(applicableMemories([memory], ["inbox"], ["interview"])).toHaveLength(1);
  expect(applicableMemories([memory], ["inbox"], ["unrelated"])).toHaveLength(0);
});

test("a bulk move is one choice, not many independent endorsements", async () => {
  const f = await setup(); const notes = await Promise.all([f.create(), f.create(), f.create()]);
  await moveMemosToNotebook(f.db, scope.workspaceId, notes.map(n => n.id), "project", actor, "user");
  expect((await f.learn())[0].state).toBe("candidate");
});

test("disabled learning and re-enabling skip past operations", async () => {
  const f = await setup({ learning: false });
  for (let day = 0; day < 3; day++) await f.move(await f.create(), day);
  expect(await f.learn()).toEqual([]);
  const settings = await getDiscoverySettings(f.db, scope);
  await saveDiscoverySettings(f.db, scope, { ...settings, learningEnabled: true });
  expect(await f.learn()).toEqual([]);
});

test("agent actions and foreign accounts never become user habits", async () => {
  const f = await setup();
  for (let day = 0; day < 3; day++) await f.move(await f.create(), day, { ...actor, actorType: "agent" });
  expect(await f.learn()).toEqual([]);
  expect(await listCompanionMemories(f.db, { workspaceId: "other", ownerId: "user" })).toEqual([]);
});

test("forget excludes the rule and deletes its evidence, including future repeat observations", async () => {
  const f = await setup(); for (let day = 0; day < 3; day++) await f.move(await f.create(), day);
  const [memory] = await f.learn();
  await forgetCompanionMemory(f.db, scope, memory.id, memory.version);
  for (let day = 0; day < 3; day++) await f.move(await f.create(), day);
  expect(await f.learn()).toEqual([]);
  expect(f.sqlite.query("SELECT COUNT(*) n FROM companion_memory_evidence").get().n).toBe(0);
});

test("correction is explicit and cannot be overwritten by learning", async () => {
  const f = await setup(); for (let day = 0; day < 3; day++) await f.move(await f.create(), day);
  const [memory] = await f.learn();
  await saveCompanionMemory(f.db, scope, { content: "Keep interviews separate; never merge them." }, memory);
  await f.move(await f.create(), 4);
  expect((await f.learn())[0]).toMatchObject({ kind: "explicit", content: "Keep interviews separate; never merge them." });
});

test("deletion, contradictory filing and aging retract inferred preferences", async () => {
  const f = await setup(); const notes = [];
  for (let day = 0; day < 3; day++) { const memo = await f.create(); notes.push(memo); await f.move(memo, day); }
  expect((await f.learn())[0].state).toBe("active");
  await moveMemosToNotebook(f.db, scope.workspaceId, [notes[0].id], "second", actor, "user");
  expect((await f.learn()).every(memory => memory.state !== "active")).toBe(true);
  f.sqlite.exec("UPDATE memos SET is_deleted = 1 WHERE workspace_id = 'paw'");
  expect((await f.learn()).every(memory => memory.state !== "active")).toBe(true);
  expect(f.sqlite.query("SELECT COUNT(*) n FROM companion_memory_evidence").get().n).toBe(0);
});

test("bulk tag API contributes snapshots, but a single batch remains a candidate", async () => {
  const f = await setup(); const notes = await Promise.all([f.create([], "project"), f.create([], "project"), f.create([], "project")]);
  await updateTagsForMemos(f.db, { workspaceId: "paw", memoIds: notes.map(n => n.id), tags: ["interview"], mode: "add", dryRun: false, actor, actorLabel: "user" });
  const [memory] = await f.learn(); expect(memory.state).toBe("candidate"); expect(memory.ruleKey).toContain('"tag"');
});

test("imported inferences remain candidates; settings can revoke prior memory contexts even on duplicate imports", async () => {
  const f = await setup();
  await importCompanionMemories(f.db, scope, [{ content: "Prefer the project notebook", kind: "inferred" }]);
  expect((await listCompanionMemories(f.db, scope))[0]).toMatchObject({ kind: "inferred", state: "candidate" });
  const epoch = await companionRevision(f.db, scope);
  await importCompanionMemories(f.db, scope, [{ content: "Prefer the project notebook", kind: "inferred" }], { useMemory: false, learningEnabled: false });
  expect(await companionRevision(f.db, scope)).toBeGreaterThan(epoch);
  expect(await getDiscoverySettings(f.db, scope)).toMatchObject({ useMemory: false, learningEnabled: false });
});

test("learned context changes discoveries, memory-only edits bypass the daily check after one hour", async () => {
  const f = await setup(); for (let day = 0; day < 3; day++) await f.move(await f.create(), day);
  const fresh = await f.create();
  let calls = 0;
  const options = { locale: "en-US", signal: new AbortController().signal, loadModel: async () => ({ modelId: "mock" }),
    generate: async ({ memories }) => { calls++; expect(memories.some(m => m.kind === "inferred")).toBe(true); return { suggestion: null }; } };
  await checkDiscoveries(f.db, scope, options); expect(calls).toBe(1);
  await saveCompanionMemory(f.db, scope, { content: "Keep interview originals" });
  f.sqlite.query("UPDATE companion_discovery_settings SET last_check_at = ?").run(new Date(Date.now() - 2 * 3600000).toISOString());
  await checkDiscoveries(f.db, scope, options); expect(calls).toBe(2);
  expect(fresh.id).toBeTruthy();
});

for (const kind of ["move", "tag"]) test(`${kind} discovery is reviewable, preserves existing tags, and does not learn from its own execution`, async () => {
  const f = await setup(); const reference = await f.create(["interview"], "project"); const fresh = await f.create(["keep"]);
  f.sqlite.query("UPDATE memos SET updated_at = ? WHERE id = ?").run(new Date(Date.now() + 1000).toISOString(), fresh.id);
  await checkDiscoveries(f.db, scope, { locale: "en-US", signal: new AbortController().signal, loadModel: async () => ({ modelId: "mock" }),
    generate: async () => ({ suggestion: { kind, title: "Organize interview", body: "Related project evidence", sourceIds: [fresh.id], targetId: null, notebookId: "project", tags: ["interview"] } }) });
  const [item] = await listDiscoveries(f.db, scope); expect(item.action.status).toBe("pending");
  const result = await applyCompanionAction(f.db, scope, item.action.id, f.context); expect(result.status).toBe("applied");
  if (kind === "tag") expect(JSON.parse(f.sqlite.query("SELECT tags_json FROM memos WHERE id = ?").get(fresh.id).tags_json)).toEqual(["keep", "interview"]);
  expect(await f.learn()).toEqual([]);
  expect(reference.id).toBeTruthy();
});

test("explicit negative feedback persists a scoped preference while ordinary dismissal does not", async () => {
  const f = await setup(); const fresh = await f.create();
  await checkDiscoveries(f.db, scope, { locale: "en-US", signal: new AbortController().signal, loadModel: async () => ({ modelId: "mock" }),
    generate: async () => ({ suggestion: { kind: "move", title: "File", body: "Project context", sourceIds: [fresh.id], targetId: null, notebookId: "project" } }) });
  const [item] = await listDiscoveries(f.db, scope);
  await rememberDiscoveryFeedback(f.db, scope, item.id);
  expect((await listCompanionMemories(f.db, scope))[0]).toMatchObject({ kind: "explicit", scopeNotebookId: "inbox" });
  expect(await listDiscoveries(f.db, scope)).toEqual([]);
});

for (const legacyColumn of [false, true]) test(`upgrade preserves old SQLite data (historical development column: ${legacyColumn})`, async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/paw-upgrade-`);
  let sqlite = new Database(`${dir}/old.sqlite`);
  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of globSync("migrations/*.sql").sort().filter(file => file.split('/').at(-1) < "0045")) sqlite.exec(readFileSync(file, "utf8"));
    sqlite.exec(`INSERT INTO workspaces(id,name) VALUES ('paw','Paw'); INSERT INTO notebooks(id,workspace_id,name) VALUES ('inbox','paw','Inbox');
      INSERT INTO companion_state(workspace_id,owner_id) VALUES ('paw','user');
      INSERT INTO companion_memories(id,workspace_id,owner_id,content,version,created_at,updated_at) VALUES ('legacy','paw','user','Keep originals',4,'2026-09-01','2026-09-01');
      INSERT INTO companion_discovery_settings(workspace_id,owner_id,enabled,version) VALUES ('paw','user',1,7);
      INSERT INTO companion_turns(id,workspace_id,owner_id,thread_id,memory_revision,message,status,model,use_memory,allow_notes,locale,created_at,expires_at)
      VALUES ('legacy-turn','paw','user','legacy-turn',0,'old','completed','old-model',0,1,'en-US','2026-09-01','2027-01-01');
      INSERT INTO companion_discoveries(id,workspace_id,owner_id,turn_id,settings_version,kind,title,body,sources_json,fingerprint,created_at)
      VALUES ('legacy-discovery','paw','user','legacy-turn',7,'insight','Old','Keep me','[]','old','2026-09-01');`);
    const oldStorage = createSelfHostedStorageAdapter(sqlite, `${dir}/resources`);
    const note = await createMemoRecord(oldStorage.db, scope.workspaceId, { notebookId: "inbox", title: "Original", contentMarkdown: "Preserve **exactly**", tags: ["original"] }, actor, "user");
    if (legacyColumn) sqlite.exec("ALTER TABLE companion_discovery_settings ADD COLUMN use_memory INTEGER NOT NULL DEFAULT 0");
    sqlite.close(); sqlite = new Database(`${dir}/old.sqlite`);
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.transaction(() => sqlite.exec(readFileSync("migrations/0045_companion_learning.sql", "utf8")))();
    const db = createSelfHostedStorageAdapter(sqlite, `${dir}/resources`).db;
    expect(await getDiscoverySettings(db, scope)).toMatchObject({ enabled: true, version: 7, learningEnabled: false, useMemory: false });
    expect((await listCompanionMemories(db, scope))[0]).toMatchObject({ id: "legacy", content: "Keep originals", version: 4, kind: "explicit" });
    expect(sqlite.query("SELECT body FROM companion_discoveries WHERE id = 'legacy-discovery'").get().body).toBe("Keep me");
    expect(sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(note.id).content_markdown).toBe("Preserve **exactly**");
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { sqlite.close(); rmSync(dir, { recursive: true }); }
});

test("negative feedback is enforced even when the model proposes the same operation again", async () => {
  const f = await setup(); let fresh = await f.create();
  const options = { locale: "en-US", signal: new AbortController().signal, loadModel: async () => ({ modelId: "mock" }),
    generate: async () => ({ suggestion: { kind: "move", title: "File", body: "Project context", sourceIds: [fresh.id], targetId: null, notebookId: "project" } }) };
  await checkDiscoveries(f.db, scope, options);
  const [item] = await listDiscoveries(f.db, scope);
  await rememberDiscoveryFeedback(f.db, scope, item.id);
  fresh = await f.create();
  f.sqlite.query("UPDATE memos SET updated_at = ? WHERE id = ?").run(new Date(Date.now() + 1000).toISOString(), fresh.id);
  f.sqlite.exec("UPDATE companion_discovery_settings SET last_check_at='2020-01-01'");
  await checkDiscoveries(f.db, scope, options);
  expect(await listDiscoveries(f.db, scope)).toEqual([]);
});
