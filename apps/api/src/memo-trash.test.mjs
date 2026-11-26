import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "./app-error.ts";
import { apiError } from "./http-errors.ts";
import { listMemos } from "./memo-list-service.ts";
import { registerMemoRoutes } from "./memo-routes.ts";
import { registerNotebookRoutes } from "./notebook-routes.ts";
import {
  createMemoRecord,
  deleteMemoRecord,
  deleteMemosRecord,
  emptyTrashMemosRecord,
  getMemoDetail,
  restoreMemoRecord,
  restoreMemosRecord,
} from "./memo-service.ts";
import { createAttachmentResource, createImageResource } from "./resource-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const WORKSPACE_ID = "ws_default";
const OTHER_WORKSPACE_ID = "ws_other";
const userAuth = {
  kind: "user", actorType: "user", actorId: "usr_owner", username: "admin", displayName: "Admin",
  scopes: [], workspaceId: WORKSPACE_ID, role: "owner",
};
const agentAuth = (scopes) => ({
  kind: "agent", actorType: "agent", actorId: "tok_agent", username: "agent", displayName: null,
  scopes, workspaceId: WORKSPACE_ID, role: "member",
});
const actor = { actorType: "user", actorId: "usr_owner" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const notImplemented = async () => { throw new Error("not used"); };

const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const installation = () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  // The self-hosted server enables this on every connection.
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(`
    INSERT INTO workspaces (id, name, is_personal) VALUES ('${OTHER_WORKSPACE_ID}', 'Other', 1);
    INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, sort_order)
      VALUES ('nb_trips', '${WORKSPACE_ID}', NULL, 'Trips', 'trips', 7),
             ('nb_other', '${OTHER_WORKSPACE_ID}', NULL, 'Theirs', 'inbox', 0);
  `);
  const resourcesDirectory = mkdtempSync(join(tmpdir(), "edgeever-trash-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(resourcesDirectory, { recursive: true, force: true });
  });
  const storage = createSelfHostedStorageAdapter(sqlite, resourcesDirectory);
  const app = new Hono();
  let auth = userAuth;
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  // Mirrors the application's error handler in index.ts.
  app.onError((error, context) => {
    if (error instanceof AppError) return apiError(context, error.code, error.message, error.status);
    throw error;
  });
  registerMemoRoutes(app, {
    clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
    createImageResource,
    createMemo: createMemoRecord,
    createMemoEditSession: notImplemented,
    deleteMemo: deleteMemoRecord,
    deleteMemos: deleteMemosRecord,
    emptyTrash: emptyTrashMemosRecord,
    getMemoDetail,
    listMemoRevisions: notImplemented,
    listMemos,
    mergeMemos: notImplemented,
    moveMemos: notImplemented,
    restoreMemo: restoreMemoRecord,
    restoreMemoRevision: notImplemented,
    updateMemo: notImplemented,
  });
  registerNotebookRoutes(app, async () => {});
  const request = async (path, init = {}) => {
    const response = await app.request(path, init, { storage });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const postJson = (path, body) => request(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const storedFiles = () => readdirSync(resourcesDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name).slice(resourcesDirectory.length + 1))
    .sort();
  const readObject = async (objectKey) => {
    const object = await storage.resources.get(objectKey);
    return object ? Buffer.from(await new Response(object.body).arrayBuffer()) : null;
  };
  const contextFor = (workspaceId) => ({
    env: { storage },
    get: (key) => (key === "auth" ? { ...userAuth, workspaceId } : undefined),
  });
  return {
    sqlite, storage, env: { storage }, contextFor, request, postJson, storedFiles, readObject,
    setAuth: (next) => { auth = next; },
  };
};

// A note with tags, an image, an attachment, a revision and a public share.
const createNote = async (target, {
  workspaceId = WORKSPACE_ID, notebookId = "nb_trips", title = "Trip plan", body = "Pack the tent", tags = ["travel"],
} = {}) => {
  const memo = await createMemoRecord(target.storage.db, workspaceId, {
    notebookId, title, contentMarkdown: body, tags,
  }, actor, "admin");
  const context = target.contextFor(workspaceId);
  const image = await createImageResource(context, {
    memoId: memo.id, filename: "map.png", mimeType: "image/png", bytes: PNG, actor, source: "upload",
  });
  const attachment = await createAttachmentResource(context, {
    memoId: memo.id, filename: `${title}.txt`, mimeType: "text/plain", bytes: new TextEncoder().encode(`${title} file`), actor,
  });
  target.sqlite.query(
    `INSERT INTO memo_revisions (id, memo_id, revision, title, content_json, content_markdown, content_hash, created_by, tags_json, content_text)
     VALUES (?, ?, 1, ?, '{}', 'Old draft', 'hash', 'admin', '[]', 'Old draft')`,
  ).run(`rev_${memo.id}`, memo.id, title);
  target.sqlite.query("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES (?, ?, ?, ?)")
    .run(`share_${memo.id}`, memo.id, workspaceId, `token_${memo.id}`);
  const objectKeys = [image.id, attachment.id].map((id) =>
    target.sqlite.query("SELECT object_key FROM resources WHERE id = ?").get(id).object_key);
  return { memo, image, attachment, objectKeys, imageBytes: await target.readObject(objectKeys[0]) };
};

const countRows = (sqlite, table, memoId) =>
  sqlite.query(`SELECT COUNT(*) AS count FROM ${table} WHERE memo_id = ?`).get(memoId).count;

const memoRowCounts = (sqlite, memoId) => ({
  memos: sqlite.query("SELECT COUNT(*) AS count FROM memos WHERE id = ?").get(memoId).count,
  memo_contents: countRows(sqlite, "memo_contents", memoId),
  memo_revisions: countRows(sqlite, "memo_revisions", memoId),
  resources: countRows(sqlite, "resources", memoId),
  memo_tags: countRows(sqlite, "memo_tags", memoId),
  memo_search_documents: countRows(sqlite, "memo_search_documents", memoId),
  memo_shares: countRows(sqlite, "memo_shares", memoId),
});

const auditEvents = (sqlite, action) => sqlite.query(
  "SELECT actor_type, actor_id, entity_type, entity_id, metadata_json FROM audit_events WHERE action = ? ORDER BY entity_id",
).all(action).map((row) => ({ ...row, metadata: JSON.parse(row.metadata_json), metadata_json: undefined }));

const listedIds = async (target, query = "") => {
  const response = await target.request(`/api/v1/memos${query}`);
  expect(response.status).toBe(200);
  return response.body.memos.map((memo) => memo.id).sort();
};

const memoState = (sqlite, memoId) =>
  sqlite.query("SELECT notebook_id, is_deleted, deleted_at FROM memos WHERE id = ?").get(memoId);

const trash = (target, memoId) => target.request(`/api/v1/memos/${memoId}`, { method: "DELETE" });
const trashNotebook = (target, notebookId) =>
  target.request(`/api/v1/notebooks/${notebookId}/trash`, { method: "POST" });

describe("moving a notebook tree to trash", () => {
  test("trashes a large tree in one request and preserves files, revisions, and existing trash", async () => {
    const target = installation();
    const { sqlite } = target;
    sqlite.exec(`
      INSERT INTO notebooks (id, workspace_id, parent_id, name) VALUES
        ('nb_child', '${WORKSPACE_ID}', 'nb_trips', 'Child'),
        ('nb_leaf', '${WORKSPACE_ID}', 'nb_child', 'Grandchild');
      WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM ids WHERE n < 120)
      INSERT INTO notebooks (id, workspace_id, parent_id, name)
      SELECT 'nb_bulk_' || n, '${WORKSPACE_ID}', 'nb_leaf', 'Bulk ' || n FROM ids;
      INSERT INTO memos (id, workspace_id, notebook_id, title)
      SELECT 'memo_' || id, workspace_id, id, 'Bulk' FROM notebooks WHERE parent_id = 'nb_leaf';
    `);
    const rootNote = await createNote(target);
    const leafNote = await createNote(target, { notebookId: "nb_leaf", title: "Leaf note" });
    const alreadyTrashed = await createNote(target, { notebookId: "nb_child" });
    const otherNote = await createNote(target, { workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other" });
    await trash(target, alreadyTrashed.memo.id);
    const previousTrash = memoState(sqlite, alreadyTrashed.memo.id);
    const files = target.storedFiles();
    const cursor = sqlite.query("SELECT MAX(id) AS cursor FROM mobile_sync_changes").get().cursor;

    expect(await trashNotebook(target, "nb_trips")).toEqual({ status: 200, body: { ok: true } });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM notebooks WHERE workspace_id = ? AND is_deleted = 1").get(WORKSPACE_ID).count)
      .toBeGreaterThanOrEqual(123);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memos WHERE id LIKE 'memo_nb_bulk_%' AND is_deleted = 1").get().count).toBe(120);
    expect(memoState(sqlite, rootNote.memo.id).is_deleted).toBe(1);
    expect(memoState(sqlite, alreadyTrashed.memo.id)).toEqual(previousTrash);
    expect(memoState(sqlite, otherNote.memo.id).is_deleted).toBe(0);
    expect(await listedIds(target, "?trash=1")).toContain(leafNote.memo.id);
    expect(memoRowCounts(sqlite, leafNote.memo.id)).toMatchObject({
      memo_contents: 1, memo_revisions: 1, resources: 2, memo_search_documents: 0, memo_shares: 0,
    });
    expect(target.storedFiles()).toEqual(files);
    expect(sqlite.query("SELECT entity_type, operation FROM mobile_sync_changes WHERE id > ? AND entity_id IN (?, ?) ORDER BY id")
      .all(cursor, "nb_leaf", leafNote.memo.id)).toEqual([
        { entity_type: "memo", operation: "upsert" },
        { entity_type: "notebook", operation: "delete" },
      ]);

    expect((await trashNotebook(target, "nb_trips")).status).toBe(200);
    expect(auditEvents(sqlite, "notebook.delete")).toHaveLength(1);
    const restored = await target.request(`/api/v1/memos/${leafNote.memo.id}/restore`, { method: "POST" });
    expect(restored.body.memo).toMatchObject({ notebookId: "nb_inbox", isDeleted: false, contentMarkdown: "Pack the tent" });
    expect(sqlite.query("SELECT DISTINCT is_deleted FROM resources WHERE memo_id = ?").all(leafNote.memo.id))
      .toEqual([{ is_deleted: 0 }]);
  });

  test("requires both write scopes and protects the inbox even inside the target tree", async () => {
    const target = installation();
    const note = await createNote(target);
    for (const scope of ["write:notebooks", "write:memos"]) {
      target.setAuth(agentAuth([scope]));
      expect((await trashNotebook(target, "nb_trips")).status).toBe(403);
    }
    target.setAuth(userAuth);
    expect((await trashNotebook(target, "nb_other")).status).toBe(404);
    expect((await trashNotebook(target, "nb_inbox")).status).toBe(400);
    target.sqlite.exec("UPDATE notebooks SET parent_id = 'nb_trips' WHERE id = 'nb_inbox'");
    expect((await trashNotebook(target, "nb_trips")).status).toBe(409);
    expect(memoState(target.sqlite, note.memo.id).is_deleted).toBe(0);
    expect(memoRowCounts(target.sqlite, note.memo.id)).toMatchObject({ memo_search_documents: 1, memo_shares: 1 });
  });

  test("rolls back notes, notebooks, index, and shares together if writing the audit fails", async () => {
    const target = installation();
    const note = await createNote(target);
    target.sqlite.exec(`
      CREATE TRIGGER reject_notebook_audit BEFORE INSERT ON audit_events
      WHEN new.action = 'notebook.delete' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END
    `);

    await expect(trashNotebook(target, "nb_trips")).rejects.toThrow("audit unavailable");
    expect(memoState(target.sqlite, note.memo.id).is_deleted).toBe(0);
    expect(memoRowCounts(target.sqlite, note.memo.id)).toMatchObject({ memo_search_documents: 1, memo_shares: 1 });
    expect(target.sqlite.query("SELECT is_deleted FROM notebooks WHERE id = 'nb_trips'").get().is_deleted).toBe(0);
    expect(target.sqlite.query("SELECT DISTINCT is_deleted FROM resources WHERE memo_id = ?").all(note.memo.id))
      .toEqual([{ is_deleted: 0 }]);
  });
});

describe("moving notes to trash", () => {
  test("keeps content, files and revisions but removes the note from lists, search and sharing", async () => {
    const target = installation();
    const note = await createNote(target);
    const filesBefore = target.storedFiles();
    expect(filesBefore).toHaveLength(2);
    expect(await listedIds(target, "?q=tent")).toEqual([note.memo.id]);

    const response = await trash(target, note.memo.id);

    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(memoState(target.sqlite, note.memo.id)).toMatchObject({ is_deleted: 1, deleted_at: expect.any(String) });
    expect(memoRowCounts(target.sqlite, note.memo.id)).toEqual({
      memos: 1, memo_contents: 1, memo_revisions: 1, resources: 2, memo_tags: 1,
      memo_search_documents: 0, memo_shares: 0,
    });
    expect(target.sqlite.query("SELECT DISTINCT is_deleted FROM resources WHERE memo_id = ?").all(note.memo.id))
      .toEqual([{ is_deleted: 1 }]);
    expect(target.storedFiles()).toEqual(filesBefore);
    expect(await target.readObject(note.objectKeys[1])).toEqual(Buffer.from("Trip plan file"));

    expect(await listedIds(target)).not.toContain(note.memo.id);
    expect(await listedIds(target, "?q=tent")).toEqual([]);
    expect(await listedIds(target, "?trash=1")).toEqual([note.memo.id]);
    expect((await target.request(`/api/v1/memos/${note.memo.id}`)).status).toBe(404);
    const inTrash = await target.request(`/api/v1/memos/${note.memo.id}?includeDeleted=1`);
    expect(inTrash.body.memo).toMatchObject({ isDeleted: true, contentMarkdown: "Pack the tent", tags: ["travel"] });

    expect(auditEvents(target.sqlite, "memo.delete")).toEqual([{
      actor_type: "user", actor_id: "usr_owner", entity_type: "memo", entity_id: note.memo.id, metadata: {},
    }]);
  });

  test("treats a note that is already in trash or does not exist as a no-op", async () => {
    const target = installation();
    const note = await createNote(target);
    await trash(target, note.memo.id);
    const before = memoState(target.sqlite, note.memo.id);

    expect(await trash(target, note.memo.id)).toEqual({ status: 200, body: { ok: true } });
    expect(await trash(target, "memo_missing")).toEqual({ status: 200, body: { ok: true } });

    expect(memoState(target.sqlite, note.memo.id)).toEqual(before);
    expect(auditEvents(target.sqlite, "memo.delete")).toHaveLength(1);
  });

  test("does not touch a note from another workspace", async () => {
    const target = installation();
    const theirs = await createNote(target, { workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other" });

    expect(await trash(target, theirs.memo.id)).toEqual({ status: 200, body: { ok: true } });

    expect(memoState(target.sqlite, theirs.memo.id).is_deleted).toBe(0);
    expect(memoRowCounts(target.sqlite, theirs.memo.id)).toMatchObject({ memo_search_documents: 1, memo_shares: 1 });
    expect(auditEvents(target.sqlite, "memo.delete")).toEqual([]);
  });
});

describe("restoring notes from trash", () => {
  test("brings the note back with its content, tags, notebook and files", async () => {
    const target = installation();
    const note = await createNote(target);
    await trash(target, note.memo.id);

    const response = await target.request(`/api/v1/memos/${note.memo.id}/restore`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(response.body.memo).toMatchObject({
      id: note.memo.id, notebookId: "nb_trips", title: "Trip plan", contentMarkdown: "Pack the tent",
      tags: ["travel"], isDeleted: false, deletedAt: null,
    });
    expect(memoState(target.sqlite, note.memo.id)).toEqual({ notebook_id: "nb_trips", is_deleted: 0, deleted_at: null });
    expect(target.sqlite.query("SELECT DISTINCT is_deleted, deleted_at FROM resources WHERE memo_id = ?").all(note.memo.id))
      .toEqual([{ is_deleted: 0, deleted_at: null }]);
    expect(await target.readObject(note.objectKeys[0])).toEqual(note.imageBytes);
    expect(await target.readObject(note.objectKeys[1])).toEqual(Buffer.from("Trip plan file"));
    expect(memoRowCounts(target.sqlite, note.memo.id)).toMatchObject({ memo_revisions: 1, memo_search_documents: 1 });
    expect(await listedIds(target, "?q=tent")).toEqual([note.memo.id]);
    expect(await listedIds(target, "?tag=travel")).toEqual([note.memo.id]);
    expect(await listedIds(target, "?trash=1")).toEqual([]);
    // The public share link is not recreated.
    expect(countRows(target.sqlite, "memo_shares", note.memo.id)).toBe(0);
    expect(auditEvents(target.sqlite, "memo.restore")).toEqual([{
      actor_type: "user", actor_id: "usr_owner", entity_type: "memo", entity_id: note.memo.id,
      metadata: { fromNotebookId: "nb_trips", toNotebookId: "nb_trips" },
    }]);
  });

  test("restores into the inbox when the original notebook was deleted meanwhile", async () => {
    const target = installation();
    const note = await createNote(target);
    await trash(target, note.memo.id);
    target.sqlite.query("UPDATE notebooks SET is_deleted = 1, deleted_at = '2026-03-01T00:00:00.000Z' WHERE id = 'nb_trips'").run();

    const response = await target.request(`/api/v1/memos/${note.memo.id}/restore`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(response.body.memo).toMatchObject({ notebookId: "nb_inbox", contentMarkdown: "Pack the tent", tags: ["travel"] });
    expect(auditEvents(target.sqlite, "memo.restore")[0].metadata)
      .toEqual({ fromNotebookId: "nb_trips", toNotebookId: "nb_inbox" });
  });

  test("refuses to restore when both the original notebook and the inbox are gone", async () => {
    const target = installation();
    const note = await createNote(target);
    await trash(target, note.memo.id);
    target.sqlite.query("UPDATE notebooks SET is_deleted = 1 WHERE workspace_id = ?").run(WORKSPACE_ID);

    const response = await target.request(`/api/v1/memos/${note.memo.id}/restore`, { method: "POST" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("restore_notebook_missing");
    expect(memoState(target.sqlite, note.memo.id)).toMatchObject({ notebook_id: "nb_trips", is_deleted: 1 });
    expect(auditEvents(target.sqlite, "memo.restore")).toEqual([]);
  });

  test("returns 404 for a note that is active, missing or in another workspace's trash", async () => {
    const target = installation();
    const active = await createNote(target);
    const theirs = await createNote(target, { workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other" });
    await deleteMemoRecord(target.env, OTHER_WORKSPACE_ID, theirs.memo.id, false, actor);

    for (const memoId of [active.memo.id, "memo_missing", theirs.memo.id]) {
      const response = await target.request(`/api/v1/memos/${memoId}/restore`, { method: "POST" });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("not_found");
    }
    expect(memoState(target.sqlite, theirs.memo.id).is_deleted).toBe(1);
    expect(auditEvents(target.sqlite, "memo.restore")).toEqual([]);
  });

  test("restores several notes at once, each into its own or the fallback notebook", async () => {
    const target = installation();
    const kept = await createNote(target, { notebookId: "nb_projects", title: "Kept" });
    const orphan = await createNote(target, { title: "Orphan" });
    await deleteMemosRecord(target.env, WORKSPACE_ID, [kept.memo.id, orphan.memo.id], false, actor);
    target.sqlite.query("UPDATE notebooks SET is_deleted = 1 WHERE id = 'nb_trips'").run();

    expect(await restoreMemosRecord(target.storage.db, WORKSPACE_ID, [kept.memo.id, orphan.memo.id, kept.memo.id], actor))
      .toBe(2);

    expect(memoState(target.sqlite, kept.memo.id)).toEqual({ notebook_id: "nb_projects", is_deleted: 0, deleted_at: null });
    expect(memoState(target.sqlite, orphan.memo.id)).toEqual({ notebook_id: "nb_inbox", is_deleted: 0, deleted_at: null });
    expect(auditEvents(target.sqlite, "memo.restore")).toHaveLength(2);
    expect(await restoreMemosRecord(target.storage.db, WORKSPACE_ID, [], actor)).toBe(0);
  });

  test("restores nothing when any id is missing, active or from another workspace", async () => {
    const target = installation();
    const trashed = await createNote(target, { title: "Trashed" });
    const active = await createNote(target, { title: "Active" });
    const theirs = await createNote(target, { workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other" });
    await deleteMemoRecord(target.env, WORKSPACE_ID, trashed.memo.id, false, actor);
    await deleteMemoRecord(target.env, OTHER_WORKSPACE_ID, theirs.memo.id, false, actor);

    for (const extra of ["memo_missing", active.memo.id, theirs.memo.id]) {
      await expect(restoreMemosRecord(target.storage.db, WORKSPACE_ID, [trashed.memo.id, extra], actor))
        .rejects.toMatchObject({ code: "missing_memos", status: 400 });
    }

    expect(memoState(target.sqlite, trashed.memo.id).is_deleted).toBe(1);
    expect(memoState(target.sqlite, theirs.memo.id).is_deleted).toBe(1);
    expect(auditEvents(target.sqlite, "memo.restore")).toEqual([]);
  });
});

describe("permanently deleting notes", () => {
  test("removes a trashed note's rows and stored files and leaves other notes alone", async () => {
    const target = installation();
    const doomed = await createNote(target, { title: "Doomed" });
    const survivor = await createNote(target, { title: "Survivor" });
    // A file that was moved into the survivor during a merge still points back at the doomed note.
    target.sqlite.query("UPDATE resources SET original_memo_id = ? WHERE id = ?").run(doomed.memo.id, survivor.attachment.id);
    await trash(target, doomed.memo.id);

    const response = await target.request(`/api/v1/memos/${doomed.memo.id}?permanent=1`, { method: "DELETE" });

    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(memoRowCounts(target.sqlite, doomed.memo.id)).toEqual({
      memos: 0, memo_contents: 0, memo_revisions: 0, resources: 0, memo_tags: 0,
      memo_search_documents: 0, memo_shares: 0,
    });
    expect(target.storedFiles()).toEqual([...survivor.objectKeys].sort());
    expect(await target.readObject(doomed.objectKeys[1])).toBeNull();
    expect(await target.readObject(survivor.objectKeys[1])).toEqual(Buffer.from("Survivor file"));
    expect(memoRowCounts(target.sqlite, survivor.memo.id)).toEqual({
      memos: 1, memo_contents: 1, memo_revisions: 1, resources: 2, memo_tags: 1,
      memo_search_documents: 1, memo_shares: 1,
    });
    expect(target.sqlite.query("SELECT original_memo_id FROM resources WHERE id = ?").get(survivor.attachment.id))
      .toEqual({ original_memo_id: null });
    expect(auditEvents(target.sqlite, "memo.delete_permanent")).toEqual([{
      actor_type: "user", actor_id: "usr_owner", entity_type: "memo", entity_id: doomed.memo.id, metadata: {},
    }]);
  });

  test("only deletes notes that are in the caller's trash", async () => {
    const target = installation();
    const active = await createNote(target);
    const theirs = await createNote(target, { workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other" });
    await deleteMemoRecord(target.env, OTHER_WORKSPACE_ID, theirs.memo.id, false, actor);
    const filesBefore = target.storedFiles();

    for (const memoId of [active.memo.id, "memo_missing", theirs.memo.id]) {
      const response = await target.request(`/api/v1/memos/${memoId}?permanent=1`, { method: "DELETE" });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("not_found");
    }

    expect(target.storedFiles()).toEqual(filesBefore);
    expect(memoRowCounts(target.sqlite, active.memo.id).memos).toBe(1);
    expect(memoRowCounts(target.sqlite, theirs.memo.id).memos).toBe(1);
    expect(auditEvents(target.sqlite, "memo.delete_permanent")).toEqual([]);
  });
});

describe("batch deletion", () => {
  test("moves several notes to trash and counts duplicates once", async () => {
    const target = installation();
    const first = await createNote(target, { title: "First" });
    const second = await createNote(target, { title: "Second" });

    const response = await target.postJson("/api/v1/memos/batch/delete", {
      memoIds: [first.memo.id, second.memo.id, first.memo.id],
    });

    expect(response).toEqual({ status: 200, body: { ok: true, deleted: 2 } });
    expect(await listedIds(target, "?trash=1")).toEqual([first.memo.id, second.memo.id].sort());
    expect(target.storedFiles()).toHaveLength(4);
    expect(auditEvents(target.sqlite, "memo.delete").map((event) => event.entity_id))
      .toEqual([first.memo.id, second.memo.id].sort());
  });

  test("changes nothing when any id is missing, in the wrong state or from another workspace", async () => {
    const target = installation();
    const active = await createNote(target, { title: "Active" });
    const trashed = await createNote(target, { title: "Trashed" });
    const theirs = await createNote(target, { workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other" });
    await deleteMemoRecord(target.env, WORKSPACE_ID, trashed.memo.id, false, actor);
    const filesBefore = target.storedFiles();
    const auditBefore = target.sqlite.query("SELECT COUNT(*) AS count FROM audit_events").get().count;

    const attempts = [
      { memoIds: [active.memo.id, "memo_missing"] },
      { memoIds: [active.memo.id, trashed.memo.id] },
      { memoIds: [active.memo.id, theirs.memo.id] },
      { memoIds: [trashed.memo.id, active.memo.id], permanent: true },
      { memoIds: [trashed.memo.id, theirs.memo.id], permanent: true },
    ];
    for (const body of attempts) {
      const response = await target.postJson("/api/v1/memos/batch/delete", body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("missing_memos");
    }

    expect(memoState(target.sqlite, active.memo.id).is_deleted).toBe(0);
    expect(memoState(target.sqlite, trashed.memo.id).is_deleted).toBe(1);
    expect(memoState(target.sqlite, theirs.memo.id).is_deleted).toBe(0);
    expect(target.storedFiles()).toEqual(filesBefore);
    expect(target.sqlite.query("SELECT COUNT(*) AS count FROM audit_events").get().count).toBe(auditBefore);
  });

  test("permanently deletes several trashed notes with their files", async () => {
    const target = installation();
    const first = await createNote(target, { title: "First" });
    const second = await createNote(target, { title: "Second" });
    const survivor = await createNote(target, { title: "Survivor" });
    await deleteMemosRecord(target.env, WORKSPACE_ID, [first.memo.id, second.memo.id], false, actor);

    const response = await target.postJson("/api/v1/memos/batch/delete", {
      memoIds: [first.memo.id, second.memo.id], permanent: true,
    });

    expect(response).toEqual({ status: 200, body: { ok: true, deleted: 2 } });
    expect(target.storedFiles()).toEqual([...survivor.objectKeys].sort());
    for (const memoId of [first.memo.id, second.memo.id]) {
      expect(Object.values(memoRowCounts(target.sqlite, memoId)).every((count) => count === 0)).toBe(true);
    }
    expect(auditEvents(target.sqlite, "memo.delete_permanent")).toHaveLength(2);
  });

  test("rejects an empty or malformed id list before touching anything", async () => {
    const target = installation();
    for (const body of [{ memoIds: [] }, { memoIds: [""] }, {}]) {
      expect((await target.postJson("/api/v1/memos/batch/delete", body)).status).toBe(400);
    }
    expect(await deleteMemosRecord(target.env, WORKSPACE_ID, [], true, actor)).toBe(0);
  });
});

describe("emptying trash", () => {
  test("permanently deletes only the caller's trashed notes and their files", async () => {
    const target = installation();
    const first = await createNote(target, { title: "First" });
    const second = await createNote(target, { title: "Second" });
    const active = await createNote(target, { title: "Active" });
    const theirs = await createNote(target, { workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other", title: "Theirs" });
    target.sqlite.query("UPDATE resources SET original_memo_id = ? WHERE id = ?").run(first.memo.id, active.attachment.id);
    await deleteMemosRecord(target.env, WORKSPACE_ID, [first.memo.id, second.memo.id], false, actor);
    await deleteMemoRecord(target.env, OTHER_WORKSPACE_ID, theirs.memo.id, false, actor);

    const response = await target.request("/api/v1/memos/trash/empty", { method: "DELETE" });

    expect(response).toEqual({ status: 200, body: { ok: true, deleted: 2 } });
    for (const memoId of [first.memo.id, second.memo.id]) {
      expect(Object.values(memoRowCounts(target.sqlite, memoId)).every((count) => count === 0)).toBe(true);
    }
    expect(target.storedFiles()).toEqual([...active.objectKeys, ...theirs.objectKeys].sort());
    expect(memoState(target.sqlite, active.memo.id).is_deleted).toBe(0);
    expect(memoRowCounts(target.sqlite, active.memo.id).resources).toBe(2);
    expect(target.sqlite.query("SELECT original_memo_id FROM resources WHERE id = ?").get(active.attachment.id))
      .toEqual({ original_memo_id: null });
    expect(memoState(target.sqlite, theirs.memo.id).is_deleted).toBe(1);
    expect(memoRowCounts(target.sqlite, theirs.memo.id)).toMatchObject({ memos: 1, memo_contents: 1, resources: 2 });
    expect(auditEvents(target.sqlite, "memo.trash_empty")).toEqual([{
      actor_type: "user", actor_id: "usr_owner", entity_type: "trash", entity_id: "memos", metadata: { deleted: 2 },
    }]);
  });

  test("does nothing and writes no audit event when the trash is already empty", async () => {
    const target = installation();
    const active = await createNote(target);

    expect(await target.request("/api/v1/memos/trash/empty", { method: "DELETE" }))
      .toEqual({ status: 200, body: { ok: true, deleted: 0 } });

    expect(target.storedFiles()).toEqual([...active.objectKeys].sort());
    expect(auditEvents(target.sqlite, "memo.trash_empty")).toEqual([]);
  });
});

describe("trash route permissions", () => {
  const routes = (memoId) => [
    ["DELETE", `/api/v1/memos/${memoId}`],
    ["DELETE", `/api/v1/memos/${memoId}?permanent=1`],
    ["POST", `/api/v1/memos/${memoId}/restore`],
    ["POST", "/api/v1/memos/batch/delete", { memoIds: [memoId] }],
    ["DELETE", "/api/v1/memos/trash/empty"],
  ];
  const send = (target, [method, path, body]) => target.request(path, body
    ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method });

  test("requires write:memos for tokens and changes nothing without it", async () => {
    const target = installation();
    const note = await createNote(target);
    await deleteMemoRecord(target.env, WORKSPACE_ID, note.memo.id, false, actor);
    target.setAuth(agentAuth(["read:memos"]));

    for (const route of routes(note.memo.id)) {
      const response = await send(target, route);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("forbidden");
    }
    expect(memoState(target.sqlite, note.memo.id).is_deleted).toBe(1);
    expect(target.storedFiles()).toHaveLength(2);
  });

  test("rejects unauthenticated requests", async () => {
    const target = installation();
    target.setAuth(undefined);
    for (const route of routes("memo_any")) {
      expect((await send(target, route)).status).toBe(401);
    }
  });

  test("lets a token with write:memos trash, restore and purge notes, recorded as the agent", async () => {
    const target = installation();
    const note = await createNote(target);
    target.setAuth(agentAuth(["write:memos"]));

    expect((await trash(target, note.memo.id)).status).toBe(200);
    expect((await target.request(`/api/v1/memos/${note.memo.id}/restore`, { method: "POST" })).status).toBe(200);
    expect((await trash(target, note.memo.id)).status).toBe(200);
    expect(await target.request("/api/v1/memos/trash/empty", { method: "DELETE" }))
      .toEqual({ status: 200, body: { ok: true, deleted: 1 } });

    expect(target.sqlite.query(
      "SELECT action, actor_type, actor_id FROM audit_events WHERE actor_type = 'agent' ORDER BY rowid",
    ).all()).toEqual([
      { action: "memo.delete", actor_type: "agent", actor_id: "tok_agent" },
      { action: "memo.restore", actor_type: "agent", actor_id: "tok_agent" },
      { action: "memo.delete", actor_type: "agent", actor_id: "tok_agent" },
      { action: "memo.trash_empty", actor_type: "agent", actor_id: "tok_agent" },
    ]);
  });
});
