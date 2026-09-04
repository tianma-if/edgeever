import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { registerCompanionRoutes } from "./companion-routes.ts";
import { beginCompanionTurn, checkpointCompanionTurn, clearCompanionHistory, saveCompanionMemory } from "./companion-service.ts";
import { createMemoRecord, getMemoDetail, updateMemoRecord } from "./memo-service.ts";
import { companionWorkspaceCursor, proposeCompanionToolAction } from "./companion-tool-actions.ts";
import { getCompanionAction, applyCompanionAction, dismissCompanionAction } from "./companion-actions.ts";
import { COMPANION_MCP_TOOLS, validateCompanionTool } from "./companion-tool-catalog.ts";
import { MCP_TOOLS } from "./mcp-tools.ts";
import { createCompanionTools } from "./companion-agent-tools.ts";
import { companionExecutionReceipts } from "./companion-runtime.ts";

const databases = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const scope = { workspaceId: "ws_test", ownerId: "owner" };
const actor = { actorType: "user", actorId: scope.ownerId };
async function setup() {
  const sqlite = new Database(":memory:"); databases.push(sqlite);
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  sqlite.query("INSERT INTO workspaces(id, name) VALUES (?, 'Test')").run(scope.workspaceId);
  for (const id of ["ideas", "target"]) sqlite.query("INSERT INTO notebooks(id, workspace_id, name) VALUES (?, ?, ?)").run(id, scope.workspaceId, id);
  const storage = createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-companion-tool-test-unused");
  const db = storage.db;
  const auth = { kind: "user", actorType: "user", actorId: scope.ownerId, workspaceId: scope.workspaceId, scopes: [], role: "member" };
  const context = { env: { storage }, get: () => auth };
  const notes = [];
  for (const title of ["One", "Two"]) notes.push(await createMemoRecord(db, scope.workspaceId,
    { notebookId: "ideas", title, contentMarkdown: `${title} original content`, tags: ["old"] }, actor, "owner"));
  const input = { id: crypto.randomUUID(), threadId: crypto.randomUUID(), message: "Organize my notes", allowNotes: true, useMemory: false, locale: "en-US" };
  const turn = await beginCompanionTurn(db, scope, input, "mock");
  const complete = () => checkpointCompanionTurn(db, scope, turn, "Review the operations", [], "completed");
  const propose = async (name, args, inspected = new Map(notes.map(note => [note.id, note.revision]))) => {
    const { proposalId } = await proposeCompanionToolAction(db, scope, turn.id, name, args, "User-requested organization",
      await companionWorkspaceCursor(db, scope.workspaceId), inspected);
    return proposalId;
  };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("auth", c.req.header("x-other") ? { ...auth, actorId: "other" } : auth); await next(); });
  registerCompanionRoutes(app, { isDemoMode: () => false });
  const request = (path, body = {}, headers = {}) => app.request(`/api/v1/companion/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }, context.env);
  return { sqlite, db, storage, context, notes, input, turn, complete, propose, request };
}

describe("shared companion MCP adapter", () => {
  test("reuses the exact reviewed MCP definitions, with no administration or upload tools", () => {
    expect(COMPANION_MCP_TOOLS).toHaveLength(28);
    for (const definition of COMPANION_MCP_TOOLS) expect(MCP_TOOLS.includes(definition)).toBe(true);
    for (const name of ["upload_memo_image", "upload_memo_attachment", "create_ai_instruction", "empty_trash", "share_memo"]) {
      expect(() => validateCompanionTool(name, {})).toThrow();
    }
    expect(() => validateCompanionTool("create_memo", { notebookId: "ideas", unexpected: true })).toThrow();
    expect(() => validateCompanionTool("trash_memos", { memoIds: [] })).toThrow();
    expect(() => validateCompanionTool("update_memo", { memoId: "x", expectedRevision: -1 })).toThrow();
    expect(() => validateCompanionTool("create_memo", { notebookId: "ideas", contentMarkdown: "x".repeat(25000) })).toThrow();
  });

  const operations = [
    ["create_memo", n => ({ notebookId: "ideas", title: "New", contentMarkdown: "Exact new body" })],
    ["update_memo", n => ({ memoId: n[0].id, title: "Changed", contentMarkdown: "Exact replacement" })],
    ["merge_memos", n => ({ memoIds: n.map(note => note.id), title: "Merged", notebookId: "target" })],
    ["move_memos", n => ({ memoIds: [n[0].id], notebookId: "target" })],
    ["add_tags_to_memos", n => ({ memoIds: [n[0].id], tags: ["new"] })],
    ["remove_tags_from_memos", n => ({ memoIds: [n[0].id], tags: ["old"] })],
    ["rename_tag", () => ({ from: "old", to: "renamed" })],
    ["delete_tag", () => ({ tag: "old" })],
    ["trash_memos", n => ({ memoIds: [n[0].id] })],
    ["restore_memos", n => ({ memoIds: [n[0].id] })],
    ["create_notebook", () => ({ name: "Created notebook" })],
    ["rename_notebook", () => ({ notebookId: "ideas", name: "Renamed notebook" })],
    ["move_notebook", () => ({ notebookId: "target", parentId: "ideas" })],
    ["import_memos", () => ({ source: "test", notebookId: "ideas", items: [{ externalId: "one", contentMarkdown: "Imported body" }] })],
  ];
  for (const [name, parameters] of operations) test(`${name} proposes without writing, then confirms through the shared executor`, async () => {
    const f = await setup();
    if (name === "restore_memos") f.sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run(f.notes[0].id);
    const before = f.sqlite.query("SELECT id, title, notebook_id, tags_json, is_deleted FROM memos ORDER BY id").all();
    const id = await f.propose(name, parameters(f.notes));
    expect(f.sqlite.query("SELECT id, title, notebook_id, tags_json, is_deleted FROM memos ORDER BY id").all()).toEqual(before);
    expect((await f.request(`actions/${id}/apply`)).status).toBe(409);
    await f.complete();
    const response = await f.request(`actions/${id}/apply`, { arguments: { title: "tampered" } });
    const body = await response.json();
    expect(body).toMatchObject({ action: { status: "applied", plan: { toolName: name } } });
    expect(response.status).toBe(200);
    expect(await (await f.request(`actions/${id}/apply`)).json()).toEqual(body);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_action_checks").get().n).toBe(0);
    const note = await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id, true);
    if (name === "update_memo") expect(note).toMatchObject({ title: "Changed", contentMarkdown: "Exact replacement" });
    if (name === "move_memos") expect(note.notebookId).toBe("target");
    if (name === "add_tags_to_memos") expect(note.tags).toEqual(["old", "new"]);
    if (name === "remove_tags_from_memos" || name === "delete_tag") expect(note.tags).toEqual([]);
    if (name === "rename_tag") expect(note.tags).toEqual(["renamed"]);
    if (name === "trash_memos" || name === "merge_memos") expect(note.isDeleted).toBe(true);
    if (name === "restore_memos") expect(note.isDeleted).toBe(false);
    if (name === "create_memo" || name === "merge_memos") expect(body.action.resultMemoId).toBeTruthy();
    if (name === "merge_memos") expect(body.action.resultNotebookId).toBe("target");
  });

  test("restores a historical revision using the existing revision service", async () => {
    const f = await setup();
    await updateMemoRecord(f.db, scope.workspaceId, f.notes[0].id, { contentMarkdown: "New body" }, actor, "owner");
    const revision = f.sqlite.query("SELECT id FROM memo_revisions WHERE memo_id = ? ORDER BY created_at LIMIT 1").get(f.notes[0].id);
    const id = await f.propose("restore_memo_revision", { memoId: f.notes[0].id, revisionId: revision.id });
    await f.complete();
    expect(await (await f.request(`actions/${id}/apply`)).json()).toMatchObject({ action: { status: "applied" } });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).contentMarkdown).toBe("One original content");
  });

  test("read and dry-run tools reuse MCP without writing or requiring a proposal", async () => {
    const f = await setup();
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    expect(Object.keys(tools)).toHaveLength(28);
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toMatchObject({ content: "One original content" });
    expect(await tools.trash_memos.execute({ memoIds: [f.notes[0].id], dryRun: true })).toMatchObject({ dryRun: true });
    expect(await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).not.toBeNull();
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM companion_actions").get().n).toBe(0);
    expect(createCompanionTools({ ...f, scope, input: { ...f.input, allowNotes: false } })).toEqual({});
  });
  test("repeated complete reads return a reference without consuming the note budget again", async () => {
    const f = await setup();
    for (const note of f.notes) await updateMemoRecord(f.db, scope.workspaceId, note.id, { contentMarkdown: "x".repeat(6000) }, actor, "owner");
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    const first = await tools.get_memo.execute({ memoId: f.notes[0].id });
    const repeated = await tools.get_memo.execute({ memoId: f.notes[0].id });
    expect(first.content).toHaveLength(6000); expect(first.truncated).toBe(false);
    expect(repeated).toMatchObject({ id: f.notes[0].id, alreadyRead: true });
    expect(repeated).not.toHaveProperty("content");
    expect(JSON.stringify(repeated).length).toBeLessThan(JSON.stringify(first).length / 10);
    const second = await tools.get_memo.execute({ memoId: f.notes[1].id });
    expect(second.content).toHaveLength(6000); expect(second.truncated).toBe(false);
    expect(await tools.merge_memos.execute({ memoIds: f.notes.map(note => note.id), _reason: "Same idea" })).toHaveProperty("proposalId");
    await updateMemoRecord(f.db, scope.workspaceId, f.notes[0].id, { contentMarkdown: "changed" }, actor, "owner");
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toHaveProperty("error");
  });
  test("a truncated read cannot become a complete source through the duplicate-read optimization", async () => {
    const f = await setup();
    await updateMemoRecord(f.db, scope.workspaceId, f.notes[0].id, { contentMarkdown: "x".repeat(9000) }, actor, "owner");
    const tools = createCompanionTools({ ...f, scope, signal: new AbortController().signal, assertActive: async () => {}, sources: [] });
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toMatchObject({ truncated: true });
    expect(await tools.get_memo.execute({ memoId: f.notes[0].id })).toMatchObject({ truncated: true });
    await expect(tools.update_memo.execute({ memoId: f.notes[0].id, contentMarkdown: "replacement", _reason: "Rewrite" })).rejects.toThrow();
  });

  for (const state of ["owner", "edit", "move-notebook", "forget", "dismiss", "expire", "clear"]) test(`rejects ${state} changes before any write`, async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "Must not exist" });
    await f.complete();
    if (state === "edit") f.sqlite.query("UPDATE memos SET title = 'Other edit' WHERE id = ?").run(f.notes[0].id);
    if (state === "move-notebook") f.sqlite.query("UPDATE notebooks SET parent_id = 'target' WHERE id = 'ideas'").run();
    if (state === "forget") await saveCompanionMemory(f.db, scope, { content: "Changed context" });
    if (state === "dismiss") await dismissCompanionAction(f.db, scope, id);
    if (state === "expire") f.sqlite.query("UPDATE companion_actions SET expires_at = '2000-01-01' WHERE id = ?").run(id);
    if (state === "clear") await clearCompanionHistory(f.db, scope);
    const response = await f.request(`actions/${id}/apply`, {}, state === "owner" ? { "x-other": "1" } : {});
    expect([404, 409]).toContain(response.status);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = 'Must not exist'").get().n).toBe(0);
  });

  test("concurrent confirmations create only one note", async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "Only once" }); await f.complete();
    await Promise.all([f.request(`actions/${id}/apply`), f.request(`actions/${id}/apply`)]);
    expect((await getCompanionAction(f.db, scope, id)).status).toBe("applied");
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = 'Only once'").get().n).toBe(1);
  });
  test("continuations see scoped receipts only with current note and memory permissions", async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "New" }); await f.complete();
    await f.request(`actions/${id}/apply`);
    expect(await companionExecutionReceipts(f.db, scope, f.input, 0)).toMatchObject([{ tool: "create_memo", status: "applied" }]);
    expect(await companionExecutionReceipts(f.db, scope, { ...f.input, allowNotes: false }, 0)).toEqual([]);
    expect(await companionExecutionReceipts(f.db, { ...scope, ownerId: "other" }, f.input, 0)).toEqual([]);
    expect(await companionExecutionReceipts(f.db, scope, { ...f.input, threadId: crypto.randomUUID() }, 0)).toEqual([]);
    expect(await companionExecutionReceipts(f.db, scope, f.input, 1)).toEqual([]);
    f.sqlite.query("UPDATE companion_turns SET use_memory = 1 WHERE id = ?").run(f.turn.id);
    expect(await companionExecutionReceipts(f.db, scope, f.input, 0)).toEqual([]);
  });

  test("a lost commit acknowledgement leaves a non-replayable uncertain receipt", async () => {
    const f = await setup();
    const id = await f.propose("create_memo", { notebookId: "ideas", title: "Committed once" }); await f.complete();
    let failed = false;
    const uncertainDb = { prepare: sql => f.db.prepare(sql), batch: async statements => {
      const result = await f.db.batch(statements);
      if (!failed) { failed = true; throw new Error("Connection lost after commit"); }
      return result;
    } };
    const context = { ...f.context, env: { storage: { ...f.storage, db: uncertainDb } } };
    expect((await applyCompanionAction(uncertainDb, scope, id, context)).status).toBe("uncertain");
    expect((await f.request(`actions/${id}/apply`)).status).toBe(409);
    expect((await dismissCompanionAction(f.db, scope, id)).status).toBe("uncertain");
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE title = 'Committed once'").get().n).toBe(1);
  });

  test("an edit between the service read and write is caught inside the mutation batch", async () => {
    const f = await setup();
    const id = await f.propose("update_memo", { memoId: f.notes[0].id, contentMarkdown: "Must not replace" }); await f.complete();
    let changed = false;
    const racingDb = { prepare: sql => f.db.prepare(sql), batch: async statements => {
      if (!changed) { changed = true; f.sqlite.query("UPDATE memo_contents SET revision = revision + 1 WHERE memo_id = ?").run(f.notes[0].id); }
      return f.db.batch(statements);
    } };
    await expect(applyCompanionAction(racingDb, scope, id, { ...f.context, env: { storage: { ...f.storage, db: racingDb } } }))
      .rejects.toMatchObject({ code: "companion_action_conflict" });
    expect((await getMemoDetail(f.db, scope.workspaceId, f.notes[0].id)).contentMarkdown).toBe("One original content");
  });
});
