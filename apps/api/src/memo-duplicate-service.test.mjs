import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DUPLICATE_RESOURCE_BYTES, MAX_DUPLICATE_RESOURCE_COUNT, duplicateMemoRecord } from "./memo-duplicate-service.ts";
import { createMemoRecord, getMemoDetail } from "./memo-service.ts";
import { createAttachmentResource, createImageResource } from "./resource-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const WORKSPACE_ID = "ws_default";
const actor = { actorType: "user", actorId: "usr_owner" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const setup = () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const resourcesDirectory = mkdtempSync(join(tmpdir(), "edgeever-duplicate-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(resourcesDirectory, { recursive: true, force: true });
  });
  const storage = createSelfHostedStorageAdapter(sqlite, resourcesDirectory);
  const auth = { kind: "user", actorType: "user", actorId: "usr_owner", workspaceId: WORKSPACE_ID, scopes: [], role: "owner" };
  const context = { env: { storage }, get: (key) => (key === "auth" ? auth : undefined) };
  const notebookId = sqlite.query("SELECT id FROM notebooks WHERE workspace_id = ? AND slug = 'inbox'").get(WORKSPACE_ID).id;
  const otherNotebookId = sqlite.query("SELECT id FROM notebooks WHERE workspace_id = ? AND slug = 'work-projects'").get(WORKSPACE_ID).id;
  const storedFiles = () => (readdirSync(resourcesDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name)));
  const readObject = async (objectKey) => {
    const object = await storage.resources.get(objectKey);
    return object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null;
  };
  return { sqlite, storage, context, notebookId, otherNotebookId, storedFiles, readObject };
};

// A note with an image, an attachment and tags, as the editor saves them.
const createSourceNote = async ({ sqlite, storage, context, notebookId }) => {
  const memo = await createMemoRecord(storage.db, WORKSPACE_ID, {
    notebookId,
    title: "Trip plan",
    contentMarkdown: "Draft",
    tags: ["travel", "2026"],
  }, actor, "admin");
  const image = await createImageResource(context, {
    memoId: memo.id,
    filename: "map.png",
    mimeType: "image/png",
    bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3),
    actor,
    source: "upload",
  });
  const attachment = await createAttachmentResource(context, {
    memoId: memo.id,
    filename: "tickets.pdf",
    mimeType: "application/pdf",
    bytes: new TextEncoder().encode("%PDF tickets"),
    actor,
  });
  const markdown = `## Trip plan\n\n![map](/api/v1/resources/${image.id}/blob)\n\n[tickets.pdf](/api/v1/resources/${attachment.id}/blob)`;
  const json = JSON.stringify({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Trip plan" }] },
      { type: "image", attrs: { src: `/api/v1/resources/${image.id}/blob`, alt: "map" } },
      { type: "paragraph", content: [{ type: "text", text: "tickets.pdf", marks: [{ type: "link", attrs: { href: `/api/v1/resources/${attachment.id}/blob` } }] }] },
    ],
  });
  sqlite.query("UPDATE memo_contents SET content_markdown = ?, content_json = ?, content_text = 'Trip plan tickets.pdf' WHERE memo_id = ?")
    .run(markdown, json, memo.id);
  return { memo, image, attachment };
};

const byKind = (rows) => [rows.find((row) => row.kind === "image"), rows.find((row) => row.kind === "attachment")];

const resourceRows = (sqlite, memoId) => sqlite
  .query("SELECT id, object_key, kind, mime_type, filename, byte_size, sha256 FROM resources WHERE memo_id = ? AND is_deleted = 0 ORDER BY created_at, id")
  .all(memoId);

describe("duplicate a note", () => {
  test("validates its destination without recounting the notebook's notes", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);
    const queries = [], prepare = fixture.storage.db.prepare.bind(fixture.storage.db);
    fixture.storage.db.prepare = sql => { queries.push(sql); return prepare(sql); };
    const copy = await duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin");
    expect(copy.notebookId).toBe(memo.notebookId);
    expect(queries.filter(sql => /COUNT\(m\.id\) AS memo_count/.test(sql))).toHaveLength(0);
  });

  test("copies the title, content, tags and files into an independent note", async () => {
    const fixture = setup();
    const { sqlite, context, storage } = fixture;
    const { memo, image, attachment } = await createSourceNote(fixture);
    const sourceBefore = await getMemoDetail(storage.db, WORKSPACE_ID, memo.id);

    const copy = await duplicateMemoRecord(context, memo.id, { title: "Trip plan (copy)" }, actor, "admin");

    expect(copy.id).not.toBe(memo.id);
    expect(copy.title).toBe("Trip plan (copy)");
    expect(copy.notebookId).toBe(memo.notebookId);
    expect(copy.tags).toEqual(["travel", "2026"]);
    expect(copy.revision).toBe(0);

    const copiedResources = resourceRows(sqlite, copy.id);
    expect(copiedResources).toHaveLength(2);
    const [copiedImage, copiedAttachment] = byKind(copiedResources);
    expect(copiedImage).toMatchObject({ kind: "image", filename: "map.png", mime_type: "image/png", sha256: image.sha256 });
    expect(copiedAttachment).toMatchObject({ kind: "attachment", filename: "tickets.pdf", mime_type: "application/pdf" });
    expect(copiedImage.id).not.toBe(image.id);
    expect(copiedAttachment.id).not.toBe(attachment.id);
    expect(copiedImage.object_key).toBe(`workspaces/${WORKSPACE_ID}/memos/${copy.id}/${copiedImage.id}.png`);

    // The copy references its own files, and only those.
    expect(copy.contentMarkdown).toBe(sourceBefore.contentMarkdown
      .replace(image.id, copiedImage.id)
      .replace(attachment.id, copiedAttachment.id));
    expect(JSON.stringify(copy.contentJson)).not.toContain(image.id);
    expect(JSON.stringify(copy.contentJson)).toContain(copiedImage.id);
    expect(JSON.stringify(copy.contentJson)).toContain(copiedAttachment.id);

    // Same bytes, separate objects.
    const [sourceImage, sourceAttachment] = byKind(resourceRows(sqlite, memo.id));
    expect(await fixture.readObject(copiedImage.object_key)).toEqual(await fixture.readObject(sourceImage.object_key));
    expect(await fixture.readObject(copiedAttachment.object_key)).toEqual(await fixture.readObject(sourceAttachment.object_key));

    // The source is unchanged, and the copy is searchable and tagged.
    expect(await getMemoDetail(storage.db, WORKSPACE_ID, memo.id)).toEqual(sourceBefore);
    expect(sqlite.query("SELECT memo_id FROM memos_fts WHERE memos_fts MATCH 'tickets'").all().map((row) => row.memo_id))
      .toContain(copy.id);
    expect(sqlite.query("SELECT name FROM memo_tags WHERE memo_id = ? ORDER BY name").all(copy.id).map((row) => row.name))
      .toEqual(["2026", "travel"]);
    expect(sqlite.query("SELECT action, metadata_json FROM audit_events WHERE entity_id = ?").get(copy.id).action)
      .toBe("memo.duplicate");
  });

  test("keeps the copy's files when the source's files are deleted", async () => {
    const fixture = setup();
    const { sqlite, context, storage } = fixture;
    const { memo } = await createSourceNote(fixture);
    const copy = await duplicateMemoRecord(context, memo.id, {}, actor, "admin");

    for (const resource of resourceRows(sqlite, memo.id)) await storage.resources.delete(resource.object_key);

    for (const resource of resourceRows(sqlite, copy.id)) {
      expect(await fixture.readObject(resource.object_key)).not.toBeNull();
    }
    expect(copy.title).toBe("Trip plan");
  });

  test("places the copy in another notebook when asked", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);

    const copy = await duplicateMemoRecord(fixture.context, memo.id, { notebookId: fixture.otherNotebookId }, actor, "admin");

    expect(copy.notebookId).toBe(fixture.otherNotebookId);
  });

  test("rejects a missing or deleted note, or an unknown notebook", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);

    await expect(duplicateMemoRecord(fixture.context, "memo_missing", {}, actor, "admin"))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(duplicateMemoRecord(fixture.context, memo.id, { notebookId: "nb_missing" }, actor, "admin"))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    fixture.sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run(memo.id);
    await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin"))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  test("refuses files above the size limit without writing anything", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);
    fixture.sqlite.query("UPDATE resources SET byte_size = ? WHERE memo_id = ? AND kind = 'attachment'")
      .run(MAX_DUPLICATE_RESOURCE_BYTES, memo.id);
    const filesBefore = fixture.storedFiles();
    const memoCount = fixture.sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count;

    await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin"))
      .rejects.toMatchObject({ code: "duplicate_too_large", status: 413 });

    expect(fixture.storedFiles()).toEqual(filesBefore);
    expect(fixture.sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count).toBe(memoCount);
  });

  test("checks the size limit on the bytes read when a row records no size", async () => {
    const fixture = setup();
    const memo = await createMemoRecord(fixture.storage.db, WORKSPACE_ID, {
      notebookId: fixture.notebookId, title: "Legacy", contentMarkdown: "Draft",
    }, actor, "admin");
    const big = await createAttachmentResource(fixture.context, {
      memoId: memo.id, filename: "big.bin", mimeType: "application/octet-stream",
      bytes: new Uint8Array(MAX_DUPLICATE_RESOURCE_BYTES + 1), actor,
    });
    fixture.sqlite.query("UPDATE resources SET byte_size = 0 WHERE id = ?").run(big.id);
    const filesBefore = fixture.storedFiles();

    await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin"))
      .rejects.toMatchObject({ code: "duplicate_too_large", status: 413 });
    expect(fixture.storedFiles()).toEqual(filesBefore);
  });

  test("removes the copied files when the database write fails", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);
    const filesBefore = fixture.storedFiles();
    const memoCount = fixture.sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count;
    fixture.storage.db.batch = async () => {
      throw new Error("database unavailable");
    };

    await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin")).rejects.toThrow("database unavailable");

    expect(fixture.storedFiles()).toEqual(filesBefore);
    expect(fixture.sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count).toBe(memoCount);
  });

  test("keeps the copy's files when reading the committed copy fails", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);
    const { db } = fixture.storage;
    const batch = db.batch.bind(db);
    const prepare = db.prepare.bind(db);
    let committed = false;
    db.batch = async (statements) => {
      const result = await batch(statements);
      committed = true;
      return result;
    };
    // The first database read after the write batch fails, as a transient error would.
    db.prepare = (sql) => {
      if (committed) {
        db.prepare = prepare;
        throw new Error("database read failed");
      }
      return prepare(sql);
    };

    await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin")).rejects.toThrow("database read failed");
    db.batch = batch;
    db.prepare = prepare;

    const copy = fixture.sqlite.query("SELECT id FROM memos WHERE id <> ? AND title = 'Trip plan'").get(memo.id);
    expect(copy).not.toBeNull();
    const copiedResources = resourceRows(fixture.sqlite, copy.id);
    expect(copiedResources).toHaveLength(2);
    for (const resource of copiedResources) {
      expect(await fixture.readObject(resource.object_key)).not.toBeNull();
    }
  });

  test("fails without a partial copy when a source file is missing from storage", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);
    const [, attachment] = byKind(resourceRows(fixture.sqlite, memo.id));
    await fixture.storage.resources.delete(attachment.object_key);
    const filesBefore = fixture.storedFiles();

    await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin"))
      .rejects.toMatchObject({ code: "duplicate_resource_missing", status: 409 });

    expect(fixture.storedFiles()).toEqual(filesBefore);
  });

  test("refuses more files than the limit without writing anything", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);
    for (let index = 0; index < MAX_DUPLICATE_RESOURCE_COUNT - 1; index += 1) {
      await createAttachmentResource(fixture.context, {
        memoId: memo.id,
        filename: `extra-${index}.txt`,
        mimeType: "text/plain",
        bytes: new TextEncoder().encode(`extra ${index}`),
        actor,
      });
    }
    const filesBefore = fixture.storedFiles();

    await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin"))
      .rejects.toMatchObject({ code: "duplicate_too_large", status: 413 });
    expect(fixture.storedFiles()).toEqual(filesBefore);
  });

  test("leaves out pending public-form uploads and the form link of submitted ones", async () => {
    const fixture = setup();
    const { memo, attachment } = await createSourceNote(fixture);
    const pending = await createAttachmentResource(fixture.context, {
      memoId: memo.id,
      filename: "visitor.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("not submitted"),
      actor,
      metadata: { tableFormId: "form_1", pending: 1 },
    });
    fixture.sqlite.query("UPDATE resources SET metadata_json = ? WHERE id = ?")
      .run(JSON.stringify({ tableFormId: "form_1", pending: 0, originalFilename: "tickets.pdf" }), attachment.id);

    const copy = await duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin");

    const copied = fixture.sqlite.query("SELECT filename, metadata_json FROM resources WHERE memo_id = ? ORDER BY filename").all(copy.id);
    expect(copied.map((row) => row.filename)).toEqual(["map.png", "tickets.pdf"]);
    expect(copied.map((row) => row.filename)).not.toContain(pending.filename);
    expect(JSON.parse(copied.find((row) => row.filename === "tickets.pdf").metadata_json)).toEqual({ originalFilename: "tickets.pdf" });
  });

  test("rewrites whole resource ids only", async () => {
    const fixture = setup();
    const memo = await createMemoRecord(fixture.storage.db, WORKSPACE_ID, {
      notebookId: fixture.notebookId,
      title: "Prefixes",
      contentMarkdown: "Draft",
    }, actor, "admin");
    const short = await createAttachmentResource(fixture.context, {
      memoId: memo.id, resourceId: "res_legacy01", filename: "a.txt", mimeType: "text/plain", bytes: Uint8Array.of(1), actor,
    });
    const long = await createAttachmentResource(fixture.context, {
      memoId: memo.id, resourceId: "res_legacy01_x", filename: "b.txt", mimeType: "text/plain", bytes: Uint8Array.of(2), actor,
    });
    const markdown = `[a](/api/v1/resources/${short.id}/blob) [b](/api/v1/resources/${long.id}/blob) mentions res_legacy01abc`;
    fixture.sqlite.query("UPDATE memo_contents SET content_markdown = ?, content_json = ? WHERE memo_id = ?")
      .run(markdown, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: markdown }] }] }), memo.id);

    const copy = await duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin");

    const byFilename = Object.fromEntries(fixture.sqlite.query("SELECT id, filename FROM resources WHERE memo_id = ?").all(copy.id)
      .map((row) => [row.filename, row.id]));
    expect(copy.contentMarkdown).toBe(`[a](/api/v1/resources/${byFilename["a.txt"]}/blob) [b](/api/v1/resources/${byFilename["b.txt"]}/blob) mentions res_legacy01abc`);
    expect(JSON.stringify(copy.contentJson)).toContain(byFilename["b.txt"]);
  });

  test("reports a cleanup failure and still returns the original error", async () => {
    const fixture = setup();
    const { memo } = await createSourceNote(fixture);
    fixture.storage.db.batch = async () => {
      throw new Error("database unavailable");
    };
    const remove = fixture.storage.resources.delete;
    fixture.storage.resources.delete = async () => {
      throw new Error("storage unavailable");
    };
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      await expect(duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin")).rejects.toThrow("database unavailable");
    } finally {
      console.error = consoleError;
      fixture.storage.resources.delete = remove;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0][1].objectKeys).toHaveLength(2);
  });

  test("copies a note without files", async () => {
    const fixture = setup();
    const memo = await createMemoRecord(fixture.storage.db, WORKSPACE_ID, {
      notebookId: fixture.notebookId,
      title: "Plain",
      contentMarkdown: "Just **text**",
    }, actor, "admin");

    const copy = await duplicateMemoRecord(fixture.context, memo.id, {}, actor, "admin");

    expect(copy.contentMarkdown).toBe(memo.contentMarkdown);
    expect(copy.contentJson).toEqual(memo.contentJson);
    expect(resourceRows(fixture.sqlite, copy.id)).toEqual([]);
  });
});
