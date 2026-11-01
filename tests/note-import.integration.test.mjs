import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BlobReader, ZipReader, ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js/index-native.js";
import { pack } from "it-tar";
import { fetchEdgeEverApp } from "../apps/api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";
import { createEdgeEverClient } from "../packages/client/src/index.ts";
import { docToMarkdown, markdownToDoc } from "../packages/shared/src/index.ts";
import { NoteImportSession, MemoryImportIndex } from "../packages/shared/src/note-import/index.ts";
import { executeNoteImport } from "../apps/web/src/lib/note-import/execute.ts";
import { convertImportEnml } from "../apps/web/src/lib/note-import/enml.ts";

const directories = [];
const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) server.stop(true); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const fixtureFiles = async (name) => {
  const root = new URL(`./fixtures/note-import/${name}/`, import.meta.url);
  const walk = async (prefix = "") => {
    const result = [];
    for (const entry of await readdir(new URL(prefix, root), { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) result.push(...await walk(path + "/"));
      else result.push({ path, file: new File([await readFile(new URL(path, root))], entry.name) });
    }
    return result;
  };
  return walk();
};
const archive = async (files, format) => {
  if (format === "zip") {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const entry of files) await writer.add(entry.path, new Uint8ArrayReader(new Uint8Array(await entry.file.arrayBuffer())));
    return [{ path: "export.zip", file: new File([await writer.close()], "export.zip") }];
  }
  const entries = [];
  for (const entry of files) entries.push({ header: { name: entry.path, size: entry.file.size }, body: [new Uint8Array(await entry.file.arrayBuffer())] });
  const chunks = [];
  for await (const part of pack()(entries)) chunks.push(part instanceof Uint8Array ? part : part.subarray());
  return [{ path: "export.jex", file: new File(chunks, "export.jex") }];
};
const target = async () => {
  const dir = await mkdtemp(join(tmpdir(), "edgeever-note-import-"));
  directories.push(dir);
  const db = new Database(join(dir, "db.sqlite"), { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(x => x.endsWith(".sql")).sort()) db.exec(await readFile(new URL(name, migrations), "utf8"));
  db.exec("INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)");
  const env = { storage: createSelfHostedStorageAdapter(db, join(dir, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => fetchEdgeEverApp(request, env, { waitUntil() {}, passThroughOnException() {} }) });
  servers.push(server);
  let intercept = null;
  const client = createEdgeEverClient({ baseUrl: server.url.toString(), fetch: (url, init) => intercept?.(url, init) ?? fetch(url, init) });
  await client.getSession();
  await client.getImportCapabilities();
  return { client, db, env, intercept: (fn) => { intercept = fn; } };
};

describe("native third-party import through the real API", () => {
  test("imports growing notebooks without recounting previously imported notes", async () => {
    for (const count of [64, 256]) {
      const { client, env } = await target();
      const queries = [];
      const prepare = env.storage.db.prepare.bind(env.storage.db);
      env.storage.db.prepare = (sql) => { queries.push(sql); return prepare(sql); };
      const session = new NoteImportSession("obsidian", Array.from({ length: count }, (_, index) => ({
        path: `Budget/note-${index}.md`, file: new File(["# Budget\n\nBody"], `note-${index}.md`),
      })), new MemoryImportIndex());
      await session.scan();
      const result = await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml });
      expect(result.completed).toBe(count);
      expect(result.failed).toBe(0);
      // Only the newly created, empty folder needs a full Notebook response.
      expect(queries.filter(sql => /COUNT\(m\.id\) AS memo_count/.test(sql))).toHaveLength(1);
      await session.close();
    }
  });

  test("creating child folders does not recount their populated parent", async () => {
    const { client, env, db } = await target();
    const { notebook: parent } = await client.createNotebook({ name: "Parent budget" });
    db.transaction(() => {
      for (let index = 0; index < 100; index++) db.query(
        "INSERT INTO memos(id,workspace_id,notebook_id,title) VALUES(?,'ws_default',?,'Existing')",
      ).run(`memo_parent_budget_${index}`, parent.id);
    })();
    let joinedMemoRows = 0;
    const prepare = env.storage.db.prepare.bind(env.storage.db);
    env.storage.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!/COUNT\(m\.id\) AS memo_count/.test(sql)) return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values), first = bound.first.bind(bound);
        bound.first = async (...args) => { const row = await first(...args); joinedMemoRows += row?.memo_count ?? 0; return row; };
        return bound;
      };
      return statement;
    };
    for (let index = 0; index < 8; index++) await client.createNotebook({ name: `Child ${index}`, parentId: parent.id });
    expect(joinedMemoRows).toBe(0);
  });

  for (const [format, fixture, kind, counts] of [
    ["evernote", "evernote", null, [3, 1, 1]],
    ["evernote", "evernote", "zip", [3, 1, 1]],
    ["obsidian", "obsidian", null, [1, 1, 2]],
    ["obsidian", "obsidian", "zip", [1, 1, 2]],
    ["joplin", "joplin", null, [2, 1, 1]],
    ["joplin", "joplin", "jex", [2, 1, 1]],
    ["joplin", "joplin-markdown", null, [2, 1, 1]],
    ["joplin", "joplin-markdown", "zip", [2, 1, 1]],
  ]) test(`${format} ${kind ?? "directory"}: preflight, import, resource readback, and timestamps`, async () => {
    const { client, db } = await target();
    const files = await fixtureFiles(fixture);
    const session = new NoteImportSession(format, kind ? await archive(files, kind) : files, new MemoryImportIndex());
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    const summary = await session.scan();
    expect(summary.errors).toBe(0);
    expect([summary.notebooks, summary.notes, summary.resources]).toEqual(counts);
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before);
    const result = await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml });
    expect((await session.index.page("result", 0, 10)).map(item => item.error)).toEqual([undefined]);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    const states = await session.index.page("result", 0, 10);
    const memo = (await client.getMemo(states[0].memo.id)).memo;
    const { notebooks } = await client.listNotebooks();
    const chain = [];
    let folder = notebooks.find(item => item.id === memo.notebookId);
    while (folder) { chain.unshift(folder.name); folder = notebooks.find(item => item.id === folder.parentId); }
    const preview = await session.index.page("notebook");
    for (const [index, folder] of preview.entries()) if (folder.parentKey) {
      expect(preview.findIndex(parent => parent.key === folder.parentKey)).toBeLessThan(index);
    }
    expect(chain).toEqual(format === "evernote" ? ["工作", "项目", "资料"] : format === "obsidian" ? ["研究"] : fixture === "joplin" ? ["项目", "工作/研究"] : ["工作", "项目"]);
    expect(memo.createdAt).toBe("2020-01-02T03:04:05.000Z");
    expect(memo.updatedAt).toBe("2021-02-03T04:05:06.000Z");
    expect(memo.contentMarkdown).toContain("/api/v1/resources/");
    if (format === "obsidian") {
      expect(memo.tags).toEqual(["迁移", "资料"]);
      expect(memo.contentMarkdown).toContain("author: Test Author");
      expect(memo.contentMarkdown).toContain("`![不是图片](missing.png)`");
      expect(memo.contentMarkdown).toContain("![[missing.png]]");
    }
    if (format === "joplin") expect(memo.tags).toEqual(fixture === "joplin" ? ["研究"] : ["迁移"]);
    const rows = db.query("SELECT id, filename FROM resources WHERE memo_id = ? AND is_deleted = 0").all(memo.id);
    expect(rows).toHaveLength(counts[2]);
    for (const row of rows) {
      const blob = await client.getResourceBlob(`/api/v1/resources/${row.id}/blob`);
      expect(blob.size).toBeGreaterThan(0);
      if (row.filename.endsWith(".txt")) expect(await blob.text()).toBe("hello");
    }
    const repeated = await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml });
    expect(repeated.completed).toBe(1);
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before + 1);
    await session.close();
    db.close();
  });

  test("REST import is scoped, preserves existing caller contracts, and replays a fixed key", async () => {
    const { client, db } = await target();
    expect(await client.getImportCapabilities()).toMatchObject({ protocolVersion: 1, maxBatchSize: 25 });
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    const { notebook } = await client.createNotebook({ name: "Existing" });
    const { memo } = await client.createMemo({ notebookId: notebook.id, title: "Existing", contentMarkdown: "keep" });
    const input = { importId: crypto.randomUUID(), format: "obsidian", notebookId: notebook.id, items: [{ externalId: "one", title: "Added", contentMarkdown: "new" }], dryRun: true };
    expect((await client.importMemos(input)).wouldCreate).toBe(1);
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before + 1);
    input.dryRun = false;
    const first = await client.importMemos(input);
    const second = await client.importMemos(input);
    expect(first.created).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.results[0].memo.id).toBe(first.results[0].memo.id);
    expect((await client.getMemo(memo.id)).memo.contentMarkdown).toBe("keep");
    db.exec("INSERT INTO workspaces(id,name) VALUES('ws_import_foreign','Foreign'); INSERT INTO notebooks(id,workspace_id,name) VALUES('nb_import_foreign','ws_import_foreign','Foreign')");
    await expect(client.importMemos({ ...input, notebookId: "nb_import_foreign" })).rejects.toMatchObject({ status: 404 });
    db.query("UPDATE notebooks SET is_deleted=1 WHERE id=?").run(notebook.id);
    await expect(client.importMemos(input)).rejects.toMatchObject({ status: 404 });
    db.close();
  });

  test("a bound import context cannot write into a changed account", async () => {
    const { client, db } = await target();
    const capabilities = await client.getImportCapabilities();
    expect(typeof capabilities.importContext).toBe("string");
    const before = db.query("SELECT COUNT(*) AS n FROM notebooks").get().n;
    const base = servers.at(-1).url.toString();
    const changed = createEdgeEverClient({ baseUrl: base, fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-edgeever-import-context", "other-workspace");
      return fetch(url, { ...init, headers });
    }});
    await expect(changed.createNotebook({ name: "Must not exist" })).rejects.toThrow();
    expect(db.query("SELECT COUNT(*) AS n FROM notebooks").get().n).toBe(before);
    db.close();
  });

  test("partial attachment failure retries only missing steps and releases sync before refresh", async () => {
    const { client, db, intercept } = await target();
    const files = [
      { path: "A.md", file: new File(["# A"], "A.md") },
      { path: "B.md", file: new File(["[one](one.txt)\n\n[two](two.txt)"], "B.md") },
      { path: "C.md", file: new File(["# C"], "C.md") },
      { path: "one.txt", file: new File(["one"], "one.txt") },
      { path: "two.txt", file: new File(["two"], "two.txt") },
    ];
    const session = new NoteImportSession("obsidian", files, new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(0);
    expect((await session.index.page("note")).map(note => note.path)).toEqual(["A.md", "B.md", "C.md"]);
    let uploads = 0;
    intercept((url, init) => {
      if (init?.method === "POST" && new URL(url).pathname.endsWith("/resource-uploads") && ++uploads === 2) return new Response(JSON.stringify({ error: { code: "test_failure", message: "Controlled failure" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    });
    const events = [];
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml, pauseSync: async () => { events.push("pause"); return () => { events.push("release"); }; }, refresh: async () => { expect(events.at(-1)).toBe("release"); events.push("refresh"); } };
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 1 });
    expect(db.query("SELECT title FROM memos WHERE title IN ('A','B','C') ORDER BY title").all()).toEqual([{ title: "A" }, { title: "B" }]);
    expect(await executeNoteImport(options)).toMatchObject({ completed: 3, failed: 0, resources: 2 });
    expect(db.query("SELECT COUNT(*) AS n FROM memos WHERE title IN ('A','B','C')").get().n).toBe(3);
    const b = db.query("SELECT id FROM memos WHERE title='B'").get();
    expect(db.query("SELECT COUNT(*) AS n FROM resources WHERE memo_id=?").get(b.id).n).toBe(2);
    expect(events).toEqual(["pause", "release", "refresh", "pause", "release", "refresh"]);
    await session.close(); db.close();
  });

  test("cancellation stops new note writes and still releases sync", async () => {
    const { client, db } = await target();
    const session = new NoteImportSession("obsidian", ["A", "B"].map(name => ({ path: name + ".md", file: new File([name], name + ".md") })), new MemoryImportIndex());
    await session.scan();
    const abort = new AbortController();
    let released = false;
    const result = await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml, signal: abort.signal, pauseSync: async () => () => { released = true; }, onProgress: progress => { if (progress.phase === "notes" && progress.path === "B.md") abort.abort(); } });
    expect(result).toMatchObject({ completed: 1, cancelled: true });
    expect(released).toBe(true);
    expect(db.query("SELECT COUNT(*) AS n FROM memos WHERE title='B'").get().n).toBe(0);
    await session.close(); db.close();
  });

  test("missing resources and .notes block confirmation without writes", async () => {
    for (const files of [[{ path: "bad.notes", file: new File(["not enex"], "bad.notes") }], [{ path: "note.md", file: new File(["![missing](lost.png)"], "note.md") }]]) {
      const session = new NoteImportSession(files[0].path.endsWith(".notes") ? "evernote" : "obsidian", files, new MemoryImportIndex());
      expect((await session.scan()).errors).toBeGreaterThan(0);
      await session.close();
    }
  });
  test("cleanup failure still refreshes committed notes after releasing sync", async () => {
    const { client, db } = await target();
    const session = new NoteImportSession("obsidian", [{ path: "note.md", file: new File(["Body"], "note.md") }], new MemoryImportIndex());
    await session.scan();
    const finish = session.finishReading, events = [];
    session.finishReading = async () => { events.push("finish"); throw new Error("importWorkerFailed"); };
    try {
      await expect(executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml, pauseSync: async () => () => { events.push("release"); }, refresh: async () => { events.push("refresh"); } })).rejects.toThrow("importWorkerFailed");
      expect(events).toEqual(["release", "finish", "refresh"]);
      const [state] = await session.index.page("result");
      expect(state.complete).toBe(true);
      expect((await client.getMemo(state.memo.id)).memo.contentMarkdown).toBe("Body");
    } finally { session.finishReading = finish; await session.close(); db.close(); }
  });

  for (const selectedParent of [true, false]) test(`source folder __destination preserves ${selectedParent ? "selected-parent hierarchy" : "top-level retries"}`, async () => {
    const { client, db, intercept } = await target();
    const files = await fixtureFiles("evernote");
    files[0].path = "__destination.enex";
    const session = new NoteImportSession("evernote", files, new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ notes: 1, notebooks: 1, errors: 0 });
    const parentId = selectedParent ? (await client.createNotebook({ name: "Chosen parent" })).notebook.id : null;
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    const options = { reader: session, index: session.index, client, parentId, convertEnml: convertImportEnml };
    if (!selectedParent) {
      intercept((url, init) => init?.method === "POST" && new URL(url).pathname.endsWith("/imports/memos") ? new Response(JSON.stringify({ error: { code: "test_failure", message: "Controlled rejection" } }), { status: 503, headers: { "Content-Type": "application/json" } }) : undefined);
      expect(await executeNoteImport(options)).toMatchObject({ completed: 0, failed: 1 });
      intercept(null);
    }
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0 });
    const [state] = await session.index.page("result");
    const memo = (await client.getMemo(state.memo.id)).memo;
    const folders = (await client.listNotebooks()).notebooks.filter(folder => folder.name === "__destination");
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ id: memo.notebookId, parentId });
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before + 1);
    await session.close(); db.close();
  });

  test("a concurrent human edit is not overwritten by link rewriting", async () => {
    const { client, db, intercept } = await target();
    const session = new NoteImportSession("obsidian", await fixtureFiles("obsidian"), new MemoryImportIndex());
    await session.scan();
    let changed = false;
    intercept(async (url, init) => {
      if (!changed && init?.method === "POST" && new URL(url).pathname.endsWith("/edit-sessions")) {
        changed = true;
        const id = new URL(url).pathname.split("/").at(-2);
        const { memo } = await client.getMemo(id);
        const { editSession } = await client.createMemoEditSession(id);
        await client.updateMemo(id, { contentMarkdown: "Human edit", expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId: editSession.id });
      }
      return fetch(url, init);
    });
    const outcome = await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml });
    expect(outcome).toMatchObject({ completed: 0, failed: 1, failure: { message: "importConflict" } });
    const [state] = await session.index.page("result");
    expect((await client.getMemo(state.memo.id)).memo.contentMarkdown).toBe("Human edit");
    await session.close(); db.close();
  });

  test("a lost final response is reconciled without duplicating the note or attachments", async () => {
    const { client, db, intercept } = await target();
    const session = new NoteImportSession("obsidian", await fixtureFiles("obsidian"), new MemoryImportIndex());
    await session.scan();
    let lost = false;
    intercept(async (url, init) => {
      const response = await fetch(url, init);
      if (!lost && init?.method === "PATCH" && /\/memos\/[^/]+$/.test(new URL(url).pathname)) {
        lost = true;
        throw new TypeError("Controlled lost response");
      }
      return response;
    });
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    expect(await executeNoteImport(options)).toMatchObject({ completed: 0, failed: 1, failure: { uncertain: true } });
    const count = db.query("SELECT COUNT(*) AS n FROM resources").get().n;
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM resources").get().n).toBe(count);
    await session.close(); db.close();
  });

  test("a missing but in-root relative reference is reported as missing, not an escape", async () => {
    const session = new NoteImportSession("obsidian", [{ path: "folder/note.md", file: new File(["[file](../missing.txt)"], "note.md") }], new MemoryImportIndex());
    await session.scan();
    expect((await session.index.page("issue")).map(item => item.code)).toContain("missingResource");
    await session.close();
  });

  test("cancelling an incomplete note retains its result without a transport error", async () => {
    const { client, db } = await target();
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File(["[file](file.txt)"], "note.md") },
      { path: "file.txt", file: new File(["hello"], "file.txt") },
    ], new MemoryImportIndex());
    await session.scan();
    const abort = new AbortController();
    const outcome = await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml, signal: abort.signal, onProgress: progress => { if (progress.phase === "resources") abort.abort(); } });
    expect(outcome).toMatchObject({ cancelled: true, completed: 0, failure: { message: "incomplete" } });
    const [state] = await session.index.page("result");
    expect(state).toMatchObject({ complete: false, error: "incomplete" });
    expect((await client.getMemo(state.memo.id)).memo).toBeDefined();
    await session.close(); db.close();
  });

  for (const format of ["evernote", "obsidian", "joplin"]) test(`${format}: extra tags are ignored without blocking import or idempotent retry`, async () => {
    const { client, db, intercept } = await target();
    const count = format === "obsidian" ? 130 : 30;
    const tags = Array.from({ length: count }, (_, i) => `tag${i}`);
    const rawTags = ["  ", "#", "##", " tag0 ", "###tag0", "#tag0", ...tags.slice(1), "tag1"];
    let files;
    if (format === "evernote") {
      files = await fixtureFiles("evernote");
      files = await Promise.all(files.map(async input => ({ ...input, file: new File([(await input.file.text()).replace("<tag>研究</tag>", rawTags.map(tag => `<tag>${tag}</tag>`).join(""))], input.file.name) })));
    } else if (format === "joplin") {
      files = (await fixtureFiles("joplin")).filter(input => !/^(4444|5555)/.test(input.path));
      for (const [i, tag] of rawTags.entries()) {
        const tagId = (1000 + i).toString(16).padStart(32, "0");
        const associationId = (2000 + i).toString(16).padStart(32, "0");
        files.push({ path: tagId + ".md", file: new File([`${tag}\n\nid: ${tagId}\ntype_: 5\n`], tagId + ".md") });
        files.push({ path: associationId + ".md", file: new File([`\n\nid: ${associationId}\nnote_id: 22222222222222222222222222222222\ntag_id: ${tagId}\ntype_: 6\n`], associationId + ".md") });
      }
    } else {
      files = [{ path: "Tags.md", file: new File([`---\ntitle: Tags\ntags: ${JSON.stringify(rawTags)}\ncreated: 2020-01-02T03:04:05Z\nupdated: 2021-02-03T04:05:06Z\n---\n\nBody`], "Tags.md") }];
    }
    const session = new NoteImportSession(format, files, new MemoryImportIndex());
    const summary = await session.scan();
    expect(summary.errors).toBe(0);
    const warning = (await session.index.page("issue")).find(issue => issue.code === "ignoredTags");
    expect(warning).toMatchObject({ severity: "warning", detail: String(count - 24) });
    expect((await session.index.page("note"))[0].tags).toEqual(tags.slice(0, 24));
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    let lost = false;
    if (format === "obsidian") intercept(async (url, init) => {
      const response = await fetch(url, init);
      if (!lost && init?.method === "POST" && new URL(url).pathname.endsWith("/imports/memos")) {
        lost = true;
        throw new TypeError("Controlled lost create response");
      }
      return response;
    });
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    const first = await executeNoteImport(options);
    if (format === "obsidian") expect(first).toMatchObject({ completed: 0, failed: 1 });
    else expect(first).toMatchObject({ completed: 1, failed: 0 });
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0 });
    const [state] = await session.index.page("result");
    expect((await client.getMemo(state.memo.id)).memo.tags).toEqual(tags.slice(0, 24));
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before + 1);
    await session.close(); db.close();
  });

  test("an uncertain attachment commit stays blocked across repeated retries", async () => {
    const { client, db, intercept } = await target();
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File(["[file](file.txt)"], "note.md") },
      { path: "file.txt", file: new File(["hello"], "file.txt") },
    ], new MemoryImportIndex());
    await session.scan();
    let lost = false;
    intercept(async (url, init) => {
      const response = await fetch(url, init);
      if (!lost && init?.method === "POST" && new URL(url).pathname.endsWith("/complete")) {
        lost = true; throw new TypeError("Lost attachment commit response");
      }
      return response;
    });
    const uncertain = [], counts = [];
    for (let retry = 0; retry < 3; retry++) {
      await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml });
      uncertain.push((await session.index.page("result"))[0].uncertain);
      counts.push(db.query("SELECT COUNT(*) AS n FROM resources WHERE memo_id=?").get((await session.index.page("result"))[0].memo.id).n);
    }
    expect(counts).toEqual([1, 1, 1]);
    expect(uncertain).toEqual([true, true, true]);
    await session.close(); db.close();
  });

  for (const exit of ["failure", "cancel"]) test(`partial folder ${exit} refreshes after releasing sync before any note exists`, async () => {
    const { client, db, intercept } = await target();
    const session = new NoteImportSession("obsidian", [{ path: "Parent/Child/note.md", file: new File(["body"], "note.md") }], new MemoryImportIndex());
    await session.scan();
    let folders = 0;
    intercept((url, init) => {
      if (exit === "failure" && init?.method === "POST" && new URL(url).pathname.endsWith("/notebooks") && ++folders === 2) return new Response(JSON.stringify({ error: { code: "test_failure", message: "Folder failure" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    });
    const abort = new AbortController(), events = [];
    const options = { reader: session, index: session.index, client, signal: abort.signal, convertEnml: convertImportEnml,
      pauseSync: async () => { events.push("pause"); return () => events.push("release"); },
      refresh: async () => { events.push("refresh"); expect((await client.listNotebooks()).notebooks.some(n => n.name === "Parent")).toBe(true); },
      onProgress: progress => { if (exit === "cancel" && progress.phase === "folders" && progress.completed === 1) abort.abort(); },
    };
    if (exit === "failure") await expect(executeNoteImport(options)).rejects.toThrow("Folder failure");
    else expect(await executeNoteImport(options)).toMatchObject({ cancelled: true, completed: 0 });
    expect(events).toEqual(["pause", "release", "refresh"]);
    expect(db.query("SELECT COUNT(*) AS n FROM notebooks WHERE name='Parent'").get().n).toBe(1);
    await session.close(); db.close();
  });

  test("failed resource mapping persistence cannot cause a duplicate commit on retry", async () => {
    const { client, db, intercept } = await target();
    let committed = false;
    class FailingIndex extends MemoryImportIndex {
      async put(kind, key, value) {
        if (committed && kind === "result") throw new DOMException("Mapping write failed", "QuotaExceededError");
        return super.put(kind, key, structuredClone(value));
      }
      async get(kind, key) { return structuredClone(await super.get(kind, key)); }
      async page(...args) { return structuredClone(await super.page(...args)); }
    }
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File(["[file](file.txt)"], "note.md") },
      { path: "file.txt", file: new File(["hello"], "file.txt") },
    ], new FailingIndex());
    await session.scan();
    intercept(async (url, init) => {
      const response = await fetch(url, init);
      if (init?.method === "POST" && new URL(url).pathname.endsWith("/complete")) committed = true;
      return response;
    });
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    await expect(executeNoteImport(options)).rejects.toThrow("Mapping write failed");
    committed = false;
    expect((await session.index.page("result"))[0].uncertain).toBe(true);
    await executeNoteImport(options);
    expect(db.query("SELECT COUNT(*) AS n FROM resources WHERE memo_id=?").get((await session.index.page("result"))[0].memo.id).n).toBe(1);
    await session.close(); db.close();
  });

  for (const phase of ["before", "after"]) test(`folder persistence failure ${phase} creation cannot duplicate the directory`, async () => {
    const { client, db, intercept } = await target();
    let quota = phase === "before";
    class FailingIndex extends MemoryImportIndex {
      async put(kind, key, value) {
        if (quota && kind === "folderResult" && key.startsWith("folder:")) throw new DOMException("Folder mapping write failed", "QuotaExceededError");
        return super.put(kind, key, structuredClone(value));
      }
      async get(...args) { return structuredClone(await super.get(...args)); }
      async page(...args) { return structuredClone(await super.page(...args)); }
    }
    const session = new NoteImportSession("obsidian", [{ path: "Quota folder/note.md", file: new File(["Body"], "note.md") }], new FailingIndex());
    await session.scan();
    intercept(async (url, init) => {
      const response = await fetch(url, init);
      if (phase === "after" && init?.method === "POST" && new URL(url).pathname.endsWith("/notebooks") && response.ok) quota = true;
      return response;
    });
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    await expect(executeNoteImport(options)).rejects.toThrow("Folder mapping write failed");
    expect(db.query("SELECT COUNT(*) AS n FROM notebooks WHERE name='Quota folder'").get().n).toBe(phase === "before" ? 0 : 1);
    quota = false;
    if (phase === "before") expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0 });
    else {
      expect(await session.index.get("folderResult", "folder:Quota folder")).toMatchObject({ uncertain: true });
      await expect(executeNoteImport(options)).rejects.toThrow("uncertainNotebook");
    }
    expect(db.query("SELECT COUNT(*) AS n FROM notebooks WHERE name='Quota folder'").get().n).toBe(1);
    await session.close(); db.close();
  });

  test("duplicate ENEX resources leave no chunks after releasing their note", async () => {
    const { client, db } = await target();
    const resource = '<resource><data encoding="base64">aGVsbG8=</data><mime>text/plain</mime><resource-attributes><file-name>file.txt</file-name></resource-attributes></resource>';
    const enex = `<en-export><note><title>Duplicate resources</title><content><![CDATA[<en-note>Body</en-note>]]></content><created>20200101T000000Z</created><updated>20200102T000000Z</updated>${resource}${resource}</note></en-export>`;
    const session = new NoteImportSession("evernote", [{ path: "notes.enex", file: new File([enex], "notes.enex") }], new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ notes: 1, resources: 1, errors: 0 });
    const release = session.releaseNote.bind(session), chunksAfterRelease = [];
    session.releaseNote = async note => { await release(note); chunksAfterRelease.push(await session.index.count("chunk")); };
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, resources: 1 });
    expect(chunksAfterRelease).toEqual([0]);
    const [state] = await session.index.page("result");
    expect(await (await client.getResourceBlob(Object.values(state.urls)[0])).text()).toBe("hello");
    await session.close(); db.close();
  });

  test("unreadable encrypted ZIP entries finish preflight instead of hanging", async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter(), { password: "fixture-password", useWebWorkers: false });
    await writer.add("note.md", new Uint8ArrayReader(new TextEncoder().encode("Encrypted note")));
    const session = new NoteImportSession("obsidian", [{ path: "vault.zip", file: new File([await writer.close()], "vault.zip") }], new MemoryImportIndex());
    try {
      expect((await session.scan()).errors).toBeGreaterThan(0);
      expect((await session.index.page("issue")).some(issue => issue.code === "invalidArchive")).toBe(true);
    } finally { await session.close(); }
  }, 3000);

  test("ZIP initialization cancellation settles its pending byte read", async () => {
    const session = new NoteImportSession("obsidian", await archive([{ path: "note.md", file: new File(["Body"], "note.md") }], "zip"), new MemoryImportIndex());
    await session.sources.scan();
    const [entry] = await session.index.page("entry"), abort = new AbortController();
    const bytes = session.sources.bytes(entry, abort.signal), pending = bytes.next();
    abort.abort();
    try { await expect(pending).rejects.toThrow(); }
    finally { await bytes.return(); await session.close(); }
  }, 3000);

  for (const name of ["toString", "constructor", "__proto__", "file.constructor"]) test(`legal prototype-like resource ${name} uploads and retries without duplication`, async () => {
    const { client, db, intercept } = await target();
    class CloningIndex extends MemoryImportIndex {
      async put(kind, key, value) { return super.put(kind, key, structuredClone(value)); }
      async get(...args) { return structuredClone(await super.get(...args)); }
      async page(...args) { return structuredClone(await super.page(...args)); }
    }
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File([`[file](${name})`], "note.md") },
      { path: name, file: new File(["Attachment bytes"], name) },
    ], new CloningIndex());
    expect(await session.scan()).toMatchObject({ notes: 1, resources: 1, errors: 0 });
    let rejected = false;
    intercept((url, init) => {
      if (!rejected && init?.method === "PATCH" && /\/memos\/[^/]+$/.test(new URL(url).pathname)) {
        rejected = true;
        return new Response(JSON.stringify({ error: { code: "test_unavailable", message: "Try later" } }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
    });
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    expect(await executeNoteImport(options)).toMatchObject({ completed: 0, failed: 1 });
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0, resources: 1 });
    const [state] = await session.index.page("result");
    expect(Object.hasOwn(state.urls, name)).toBe(true);
    expect((await client.getMemo(state.memo.id)).memo.contentMarkdown).toBe(`[file](${state.urls[name]})`);
    expect(db.query("SELECT COUNT(*) AS n FROM resources WHERE memo_id=?").get(state.memo.id).n).toBe(1);
    expect(await (await client.getResourceBlob(state.urls[name])).text()).toBe("Attachment bytes");
    await session.close(); db.close();
  });

  test("completed large-note results retain version baselines instead of full bodies", async () => {
    const { client, db } = await target();
    const body = "x".repeat(1024 * 1024) + "\n\n[file](file.txt)";
    const session = new NoteImportSession("obsidian", [
      { path: "Memory/first.md", file: new File([body], "first.md") },
      { path: "Memory/second.md", file: new File([body], "second.md") },
      { path: "Memory/file.txt", file: new File(["Attachment bytes"], "file.txt") },
    ], new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(0);
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 2, resources: 2 });
    const states = await session.index.page("result");
    for (const state of states) {
      expect(state.memo).not.toHaveProperty("contentMarkdown");
      expect(state.memo).not.toHaveProperty("contentJson");
      expect(state.memo).not.toHaveProperty("contentText");
      expect(state.intendedMarkdown).toBeUndefined();
    }
    expect(JSON.stringify(states).length).toBeLessThan(8192);
    await session.close(); db.close();
  });

  test("Evernote todo labels and adjacent paragraphs survive real import", async () => {
    const { client, db } = await target();
    const files = await fixtureFiles("evernote");
    const enml = '<en-note><div><en-todo checked="true"/>完成</div><div><en-todo checked="false"/>未完成</div><div>尾文</div></en-note>';
    files[0].file = new File([(await files[0].file.text()).replace(/<content><!\[CDATA\[[\s\S]*?\]\]><\/content>/, `<content><![CDATA[${enml}]]></content>`)], files[0].file.name);
    const session = new NoteImportSession("evernote", files, new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(0);
    await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml });
    const [state] = await session.index.page("result");
    const { memo } = await client.getMemo(state.memo.id);
    expect(memo.contentMarkdown).toContain("- [x] 完成");
    expect(memo.contentMarkdown).toContain("- [ ] 未完成");
    expect(memo.contentMarkdown).toContain("尾文");
    await session.close(); db.close();
  });

  test("ENML linked images retain outer links through saved documents", async () => {
    const { client, db } = await target();
    const data = await readFile(new URL("./fixtures/note-import/real-apps/assets/样本 图.png", import.meta.url));
    const hash = new Bun.CryptoHasher("md5").update(data).digest("hex");
    const links = [
      { href: "https://example.com/full", title: "Full image", alt: "Direct image" },
      { href: "https://example.com/details?view=full#photo", title: "Details", alt: "Nested image" },
    ];
    const media = alt => `<en-media type="image/png" hash="${hash}" alt="${alt}"/>`;
    const enml = `<en-note><a href="${links[0].href}" title="${links[0].title}">${media(links[0].alt)}</a><div>Before <a href="${links[1].href}" title="${links[1].title}"><span>${media(links[1].alt)}</span></a> after</div></en-note>`;
    const enex = `<en-export><note><title>Linked images</title><content><![CDATA[${enml}]]></content><created>20200102T030405Z</created><updated>20210203T040506Z</updated><resource><data encoding="base64">${data.toString("base64")}</data><mime>image/png</mime><resource-attributes><file-name>linked.png</file-name></resource-attributes></resource></note></en-export>`;
    const session = new NoteImportSession("evernote", [{ path: "linked.enex", file: new File([enex], "linked.enex") }], new MemoryImportIndex());
    try {
      expect(await session.scan()).toMatchObject({ notes: 1, resources: 1, errors: 0, warnings: 0 });
      expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0, resources: 1 });
      const [state] = await session.index.page("result");
      const imageUrl = Object.values(state.urls)[0];
      const checkImages = doc => {
        const images = [];
        const visit = node => { if (node.type === "image") images.push(node.attrs); node.content?.forEach(visit); };
        visit(doc);
        expect(images).toHaveLength(links.length);
        for (const [index, link] of links.entries()) expect(images[index]).toMatchObject({ src: imageUrl, alt: link.alt, link: { href: link.href, title: link.title } });
      };
      const { memo } = await client.getMemo(state.memo.id);
      checkImages(memo.contentJson);
      checkImages(markdownToDoc(docToMarkdown(memo.contentJson)));
      expect(memo.contentMarkdown).not.toContain("evernote-resource:");
      const edited = structuredClone(memo.contentJson);
      edited.content.push({ type: "paragraph", content: [{ type: "text", text: "Edited after import" }] });
      const { editSession } = await client.createMemoEditSession(memo.id);
      await client.updateMemo(memo.id, { contentJson: edited, contentMarkdown: docToMarkdown(edited), expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId: editSession.id });
      const reopened = (await client.getMemo(memo.id)).memo;
      checkImages(reopened.contentJson);
      expect(reopened.contentMarkdown).toContain("Edited after import");
      const blob = await client.getResourceBlob(imageUrl);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(data));
    } finally { await session.close(); db.close(); }
  }, 30_000);

  for (const format of ["obsidian", "joplin"]) test(`${format}: external URIs survive preflight and real import`, async () => {
    const { client, db } = await target();
    const body = "---\ncreated: 2020-01-02T03:04:05Z\nupdated: 2021-02-03T04:05:06Z\n---\n\n[FTP](ftp://example.com/file)\n\n[Vault](obsidian://open?vault=Demo&file=Note)";
    const session = new NoteImportSession(format, [{ path: "external.md", file: new File([body], "external.md") }], new MemoryImportIndex());
    try {
      const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
      expect(await session.scan()).toMatchObject({ notes: 1, resources: 0, errors: 0, warnings: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before);
      expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0, resources: 0 });
      const [state] = await session.index.page("result");
      expect((await client.getMemo(state.memo.id)).memo.contentMarkdown).toBe(body);
      expect(state.urls).toEqual({});
      expect(db.query("SELECT COUNT(*) AS n FROM resources WHERE memo_id=?").get(state.memo.id).n).toBe(0);
    } finally { await session.close(); db.close(); }
  }, 30_000);

  test("nested links, labels, titles and referenced definitions retain Markdown structure", async () => {
    const { client, db } = await target();
    const body = '[![thumb](assets/image.svg "Preview")](assets/manual.txt "Document")\n\n[section [A]](assets/manual.txt "See manual")\n\n[`code label`](assets/manual.txt)\n\n![reference][image]\n\n[image][]\n\n[image]\n\n[image]: assets/image.svg "Ref title"\n[unused]: missing.png\n\n`![code](missing.png)`';
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File([body], "note.md") },
      { path: "assets/image.svg", file: new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "image.svg") },
      { path: "assets/manual.txt", file: new File(["manual"], "manual.txt") },
    ], new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(0);
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, resources: 2 });
    const [state] = await session.index.page("result");
    const { memo } = await client.getMemo(state.memo.id);
    const image = state.urls["assets/image.svg"], manual = state.urls["assets/manual.txt"];
    expect(memo.contentMarkdown).toContain(`[![thumb](${image} "Preview")](${manual} "Document")`);
    expect(memo.contentMarkdown).toContain(`[section [A]](${manual} "See manual")`);
    expect(memo.contentMarkdown).toContain('[`code label`](' + manual + ')');
    expect(memo.contentMarkdown).toContain('![reference][image]');
    expect(memo.contentMarkdown).toContain('[image][]');
    expect(memo.contentMarkdown).toContain('\n\n[image]\n');
    expect(memo.contentMarkdown).toContain(`[image]: ${image} "Ref title"`);
    expect(memo.contentMarkdown).toContain('[unused]: missing.png');
    expect(memo.contentMarkdown).toContain('`![code](missing.png)`');
    const nodes = [];
    const visit = node => { nodes.push(node); node.content?.forEach(visit); };
    visit(memo.contentJson);
    expect(nodes.filter(node => node.type === "image").map(node => node.attrs.src)).toEqual([image, image]);
    expect(nodes.some(node => node.type === "image" && node.attrs.alt === "thumb")).toBe(true);
    expect(nodes.find(node => node.type === "image" && node.attrs.alt === "thumb").attrs.link).toEqual({ href: manual, title: "Document" });
    const edited = structuredClone(memo.contentJson);
    edited.content.push({ type: "paragraph", content: [{ type: "text", text: "Edited after import" }] });
    const { editSession } = await client.createMemoEditSession(memo.id);
    await client.updateMemo(memo.id, { contentJson: edited, contentMarkdown: docToMarkdown(edited), expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId: editSession.id });
    const reopened = (await client.getMemo(memo.id)).memo;
    expect(reopened.contentMarkdown).toContain(`[![thumb](${image} "Preview")](${manual} "Document")`);
    expect(reopened.contentMarkdown).toContain("Edited after import");
    await session.close(); db.close();
  });

  for (const kind of ["zip", "jex"]) test(`directory ${kind} attachment is not expanded as another import`, async () => {
    const { client, db } = await target();
    const [container] = await archive([{ path: "inside.md", file: new File(["Inside archive, not a note to import"], "inside.md") }], kind);
    const path = `assets/bundle.${kind}`;
    const session = new NoteImportSession("obsidian", [
      { path: "notes/main.md", file: new File([`[bundle](../${path})`], "main.md"), expandArchive: false },
      { path, file: container.file, expandArchive: false },
    ], new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ errors: 0, notes: 1, notebooks: 1, resources: 1 });
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, resources: 1 });
    const [state] = await session.index.page("result");
    expect(new Uint8Array(await (await client.getResourceBlob(state.urls[path])).arrayBuffer())).toEqual(new Uint8Array(await container.file.arrayBuffer()));
    await session.close(); db.close();
  });

  test("Vault-root folder paths win collisions and Wiki percent names remain literal", async () => {
    const { client, db } = await target();
    const session = new NoteImportSession("obsidian", [
      { path: "notes/main.md", file: new File(['![[assets/diagram.svg]]\n\n![MD](assets/diagram.svg)\n\n![[100% ready.svg]]'], "main.md") },
      { path: "assets/diagram.svg", file: new File(['<svg xmlns="http://www.w3.org/2000/svg"><text>ROOT</text></svg>'], "diagram.svg") },
      { path: "notes/assets/diagram.svg", file: new File(['<svg xmlns="http://www.w3.org/2000/svg"><text>LOCAL</text></svg>'], "diagram.svg") },
      { path: "100% ready.svg", file: new File(['<svg xmlns="http://www.w3.org/2000/svg"><text>Percent</text></svg>'], "100% ready.svg") },
    ], new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ errors: 0, notes: 1, resources: 2 });
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, resources: 2 });
    const [state] = await session.index.page("result");
    expect(await (await client.getResourceBlob(state.urls["assets/diagram.svg"])).text()).toContain("ROOT");
    expect(await (await client.getResourceBlob(state.urls["100% ready.svg"])).text()).toContain("Percent");
    await session.close(); db.close();
  });

  test("Wiki PDF embeds and escaped fragments become consumable attachment links", async () => {
    const { client, db } = await target();
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File(['![[paper.pdf#page=3]]\n\n[pdf](paper.pdf#name\\)value)'], "note.md") },
      { path: "paper.pdf", file: new File(["%PDF-1.4\n%%EOF"], "paper.pdf") },
    ], new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(0);
    await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml });
    const [state] = await session.index.page("result");
    const { memo } = await client.getMemo(state.memo.id);
    expect(memo.contentMarkdown).toContain(`[paper.pdf](${state.urls["paper.pdf"]}#page=3)`);
    expect(memo.contentMarkdown).toContain(`[pdf](${state.urls["paper.pdf"]}#name%29value)`);
    expect(JSON.stringify(markdownToDoc(memo.contentMarkdown))).not.toContain('"type":"image"');
    await session.close(); db.close();
  });

  test("invalid calendar dates warn instead of inventing another original date", async () => {
    const session = new NoteImportSession("joplin", [{ path: "note.md", file: new File(['---\ncreated: 2021-02-30T00:00:00Z\nupdated: 2020-02-29T08:00:00+08:00\n---\n\nBody'], "note.md") }], new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(0);
    const [note] = await session.index.page("note");
    expect(note.createdAt).toBeUndefined();
    expect(note.updatedAt).toBe("2020-02-29T00:00:00.000Z");
    expect((await session.index.page("issue")).some(issue => issue.code === "invalidTime")).toBe(true);
    await session.close();
  });

  test("renamed Joplin RAW entries are not imported again as Markdown", async () => {
    const { client, db } = await target();
    const files = await fixtureFiles("joplin");
    const note = files.find(entry => entry.path === "22222222222222222222222222222222.md");
    note.path = "Renamed.md";
    const session = new NoteImportSession("joplin", files, new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ notes: 1, notebooks: 2, resources: 1, errors: 0 });
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, resources: 1 });
    await session.close(); db.close();
  });

  for (const rawShaped of [false, true]) test(`RAW Markdown attachment ${rawShaped ? "with record-shaped content" : "with a large body"} is not scanned as a note`, async () => {
    const { client, db } = await target();
    const noteId = "11111111111111111111111111111111", resourceId = "33333333333333333333333333333333";
    const attachment = rawShaped ? "Attached exported note\n\nAttachment text\n\nid: 77777777777777777777777777777777\nparent_id: \ntype_: 1\n" : "# Attached Markdown\n" + "x".repeat(1024 * 1024);
    const session = new NoteImportSession("joplin", [
      { path: `${noteId}.md`, file: new File([`Root\n\n[file](:/${resourceId})\n\nid: ${noteId}\nparent_id: \ntype_: 1\n`], `${noteId}.md`) },
      { path: `${resourceId}.md`, file: new File([`attached.md\n\nid: ${resourceId}\nmime: text/markdown\nfile_extension: md\ntype_: 4\n`], `${resourceId}.md`) },
      { path: `_resources/${resourceId}.md`, file: new File([attachment], `${resourceId}.md`) },
    ], new MemoryImportIndex());
    const text = session.sources.text.bind(session.sources), attachmentReads = [];
    session.sources.text = async (entry, ...args) => { if (entry.path.startsWith("_resources/")) attachmentReads.push(entry.path); return text(entry, ...args); };
    expect(await session.scan()).toMatchObject({ notes: 1, resources: 1, errors: 0 });
    expect(attachmentReads).toEqual([]);
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, resources: 1 });
    const [state] = await session.index.page("result");
    expect(await (await client.getResourceBlob(Object.values(state.urls)[0])).text()).toBe(attachment);
    await session.close(); db.close();
  });

  test("a resource-shaped Markdown path without a RAW descriptor remains a note", async () => {
    const { client, db } = await target();
    const name = "33333333333333333333333333333333.md";
    const session = new NoteImportSession("joplin", [{ path: `_resources/${name}`, file: new File(["# A real Markdown note"], name) }], new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ notes: 1, notebooks: 1, resources: 0, errors: 0 });
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0 });
    const [state] = await session.index.page("result");
    expect((await client.getMemo(state.memo.id)).memo.contentMarkdown).toBe("# A real Markdown note");
    await session.close(); db.close();
  });

  test("a definite attachment commit rejection remains retryable", async () => {
    const { client, db, intercept } = await target();
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File(["[file](file.txt)"], "note.md") },
      { path: "file.txt", file: new File(["hello"], "file.txt") },
    ], new MemoryImportIndex());
    await session.scan();
    let rejected = false;
    intercept((url, init) => {
      if (!rejected && init?.method === "POST" && new URL(url).pathname.endsWith("/complete")) {
        rejected = true; return new Response(JSON.stringify({ error: { code: "test_quota", message: "Try later" } }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
    });
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    expect(await executeNoteImport(options)).toMatchObject({ completed: 0, failed: 1, failure: { uncertain: false } });
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0 });
    const [state] = await session.index.page("result");
    expect(db.query("SELECT COUNT(*) AS n FROM resources WHERE memo_id=?").get(state.memo.id).n).toBe(1);
    await session.close(); db.close();
  });

  test("inline HTML prefixes and CRLF link labels retain their actual resources", async () => {
    const { client, db } = await target();
    const body = '[<div></div>]\n![real](assets/image.svg)\n\n[<div></div>]\n![[assets/image.svg]]\n\n[two\r\nlines](assets/manual.txt)\n\n![two\r\nlines](assets/image.svg)';
    const session = new NoteImportSession("obsidian", [
      { path: "note.md", file: new File([body], "note.md") },
      { path: "assets/image.svg", file: new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "image.svg") },
      { path: "assets/manual.txt", file: new File(["manual"], "manual.txt") },
    ], new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ errors: 0, resources: 2 });
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, resources: 2 });
    const [state] = await session.index.page("result");
    const { memo } = await client.getMemo(state.memo.id);
    expect(memo.contentMarkdown).toContain(`[<div></div>]\n![real](${state.urls["assets/image.svg"]})`);
    expect(memo.contentMarkdown).toContain(`[two\r\nlines](${state.urls["assets/manual.txt"]})`);
    expect(memo.contentMarkdown).toContain(`![two\r\nlines](${state.urls["assets/image.svg"]})`);
    await session.close(); db.close();
  });

  test("large valid properties retain source metadata while ignoring extra tags", async () => {
    const { client, db } = await target();
    const tags = Array.from({ length: 6000 }, (_, i) => `tag_${String(i).padStart(5, "0")}`);
    const body = `---\ntitle: Large properties\ntags:\n${tags.map(tag => `  - ${tag}\n`).join("")}created: 2020-01-02T03:04:05Z\nupdated: 2021-02-03T04:05:06Z\nauthor: Retained Author\n---\n\nBody retained`;
    const session = new NoteImportSession("obsidian", [{ path: "note.md", file: new File([body], "note.md") }], new MemoryImportIndex());
    expect(body.length).toBeGreaterThan(64 * 1024);
    expect(await session.scan()).toMatchObject({ errors: 0, warnings: 1, notes: 1 });
    expect(await session.index.page("issue")).toMatchObject([{ code: "ignoredTags", detail: "5976" }]);
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0 });
    const [state] = await session.index.page("result");
    const { memo } = await client.getMemo(state.memo.id);
    expect(memo).toMatchObject({ title: "Large properties", tags: tags.slice(0, 24), createdAt: "2020-01-02T03:04:05.000Z", updatedAt: "2021-02-03T04:05:06.000Z", contentMarkdown: body });
    await session.close(); db.close();
  });

  for (const subtree of [false, true]) test(`Joplin ${subtree ? "JEX subtree" : "RAW standalone note"} accepts an excluded ancestor`, async () => {
    const { client, db } = await target();
    const files = (await fixtureFiles("joplin")).filter(file => file.path !== "66666666666666666666666666666666.md" && (subtree || file.path !== "11111111111111111111111111111111.md"));
    const session = new NoteImportSession("joplin", subtree ? await archive(files, "jex") : files, new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ errors: 0, notes: 1, notebooks: 1, resources: 1 });
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0, resources: 1 });
    const [state] = await session.index.page("result");
    const { memo } = await client.getMemo(state.memo.id);
    const { notebooks } = await client.listNotebooks();
    expect(notebooks.find(folder => folder.id === memo.notebookId)).toMatchObject({ name: subtree ? "工作/研究" : "Joplin", parentId: null });
    expect(memo.contentMarkdown).toContain("# 正文");
    expect(memo.tags).toEqual(["研究"]);
    expect(await (await client.getResourceBlob(Object.values(state.urls)[0])).text()).toBe("hello");
    await session.close(); db.close();
  });

  for (const invalid of ["cycle", "non-folder"]) test(`Joplin ${invalid} parent still blocks preflight`, async () => {
    const files = await fixtureFiles("joplin");
    const parent = files.find(file => file.path === "66666666666666666666666666666666.md");
    parent.file = new File([(await parent.file.text()).replace("parent_id:\n", "parent_id: 11111111111111111111111111111111\n").replace("type_: 2", invalid === "cycle" ? "type_: 2" : "type_: 5")], parent.file.name);
    const session = new NoteImportSession("joplin", files, new MemoryImportIndex());
    expect((await session.scan()).errors).toBeGreaterThan(0);
    expect((await session.index.page("issue")).some(issue => issue.code === "invalidJoplin" && issue.detail.includes(invalid === "cycle" ? "cyclicNotebook" : "missingNotebook"))).toBe(true);
    await session.close();
  });

  test("untitled RAW create response loss is replayed using the server title default", async () => {
    const { client, db, intercept } = await target();
    const files = await fixtureFiles("joplin");
    const note = files.find(file => file.path === "22222222222222222222222222222222.md");
    note.file = new File([(await note.file.text()).replace(/^Joplin 笔记/, "")], note.file.name);
    const session = new NoteImportSession("joplin", files, new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(0);
    let lost = false;
    intercept(async (url, init) => {
      const response = await fetch(url, init);
      if (!lost && init?.method === "POST" && new URL(url).pathname.endsWith("/imports/memos")) { lost = true; throw new TypeError("Lost create response"); }
      return response;
    });
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    expect(await executeNoteImport(options)).toMatchObject({ completed: 0, failed: 1 });
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0 });
    const [state] = await session.index.page("result");
    expect((await client.getMemo(state.memo.id)).memo.title).toBe("无标题笔记");
    await session.close(); db.close();
  });

});

describe("real desktop-app exports", () => {
  const root = new URL("./fixtures/note-import/real-apps/", import.meta.url);
  test("ENEX media and unreferenced resources retain special-character labels through real import", async () => {
    const { client, db } = await target();
    const samples = [
      { filename: "photo ] &copy; 100%.png", mime: "image/png", media: true },
      { filename: "report [v1] ] &copy; 100%.pdf", mime: "application/pdf", media: true },
      { filename: "explicit alt.png", alt: "Alt [ unpaired ] ] \\ value", mime: "image/png", media: true },
      { filename: "unmatched [ note\\name.txt", storedFilename: "unmatched [ note-name.txt", mime: "text/plain", media: true },
      { filename: "line\r\n\r\nimage.png", storedFilename: "lineimage.png", mime: "image/png", media: true },
      { filename: "orphan ]\r\n\r\n100%.txt", storedFilename: "orphan ]100%.txt", mime: "text/plain", media: false },
    ].map((sample, index) => {
      const data = new TextEncoder().encode(`Independent resource ${index}`);
      return { ...sample, data, hash: new Bun.CryptoHasher("md5").update(data).digest("hex") };
    });
    const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const enml = `<en-note>${samples.filter(sample => sample.media).map(sample => `<en-media type="${sample.mime}" hash="${sample.hash}"${sample.alt ? ` alt="${xml(sample.alt)}"` : ""}/>`).join("")}</en-note>`;
    const enex = `<en-export><note><title>Special labels</title><content><![CDATA[${enml}]]></content>${samples.map(sample => `<resource><data encoding="base64">${Buffer.from(sample.data).toString("base64")}</data><mime>${sample.mime}</mime><resource-attributes><file-name>${xml(sample.filename)}</file-name></resource-attributes></resource>`).join("")}</note></en-export>`;
    const session = new NoteImportSession("evernote", [{ path: "labels.enex", file: new File([enex], "labels.enex") }], new MemoryImportIndex());
    try {
      expect(await session.scan()).toMatchObject({ notes: 1, resources: samples.length, errors: 0 });
      expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0, resources: samples.length });
      const [state] = await session.index.page("result");
      let { memo } = await client.getMemo(state.memo.id);
      expect(memo.contentMarkdown).not.toContain("evernote-resource:");
      const checkLabels = () => {
        const labels = [];
        const visit = node => {
          if (node.type === "image") labels.push(node.attrs.alt);
          if (node.type === "edgeeverPdfAttachment" || node.type === "edgeeverFileAttachment") labels.push(node.attrs.filename);
          node.content?.forEach(visit);
        };
        visit(memo.contentJson);
        for (const sample of samples) expect(labels).toContain((sample.alt ?? sample.filename).replace(/[\r\n]+/g, " "));
      };
      checkLabels();
      const { editSession } = await client.createMemoEditSession(memo.id);
      await client.updateMemo(memo.id, { contentMarkdown: docToMarkdown(memo.contentJson) + "\n\nEdited", expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId: editSession.id });
      ({ memo } = await client.getMemo(memo.id));
      checkLabels();
      expect(memo.contentMarkdown).not.toContain("evernote-resource:");
      const resources = db.query("SELECT id,filename FROM resources WHERE memo_id=? AND is_deleted=0").all(memo.id);
      expect(resources).toHaveLength(samples.length);
      expect(resources.map(resource => resource.filename).sort()).toEqual(samples.map(sample => sample.storedFilename ?? sample.filename).sort());
      const received = [];
      for (const resource of resources) {
        const blob = await client.getResourceBlob(`/api/v1/resources/${resource.id}/blob`);
        received.push(await blob.text());
      }
      expect(received.sort()).toEqual(samples.map(sample => new TextDecoder().decode(sample.data)).sort());
    } finally { await session.close(); db.close(); }
  });
  test("Evernote 11.40.2 ENEX retains current task states, code blocks and original attachment bytes", async () => {
    const { client, db } = await target();
    const name = "evernote-11.40.2.enex";
    const session = new NoteImportSession("evernote", [{ path: name, file: new File([await readFile(new URL(name, root))], name) }], new MemoryImportIndex());
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    expect(await session.scan()).toMatchObject({ notes: 1, notebooks: 1, resources: 5, errors: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before);
    const options = { reader: session, index: session.index, client, convertEnml: convertImportEnml };
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0, resources: 5 });
    const [state] = await session.index.page("result");
    const { memo } = await client.getMemo(state.memo.id);
    expect(memo).toMatchObject({ title: "EdgeEver QA · 正文与附件 🌿", tags: ["edgeever-import-qa", "迁移验收"], createdAt: "2026-10-31T03:38:38.000Z", updatedAt: "2026-10-31T03:41:05.000Z" });
    expect(memo.contentMarkdown).toMatch(/^- +\[ \] 尚未完成的导入检查/m);
    expect(memo.contentMarkdown).toMatch(/^- +\[x\] 已经完成的格式准备/m);
    expect(memo.contentMarkdown.startsWith("## 真实 ENEX 导出验收")).toBe(true);
    expect(memo.contentMarkdown).toContain("```\nconst message = 'ENEX & EdgeEver';\n```");
    expect(memo.contentMarkdown).toContain("| 项目");
    expect(memo.contentMarkdown).toContain("保留原字节");
    expect(memo.contentMarkdown).toContain("https://example.com/edgeever?q=100%25#section");
    const structure = { pdfs: [], files: [], tableRows: 0 };
    const emphasis = { bold: [], italic: [] };
    const visit = node => {
      if (node.type === "text") for (const mark of node.marks ?? []) if (Object.hasOwn(emphasis, mark.type)) emphasis[mark.type].push(node.text);
      if (node.type === "edgeeverPdfAttachment") structure.pdfs.push(node.attrs.filename);
      if (node.type === "edgeeverFileAttachment") structure.files.push(node.attrs.filename);
      if (node.type === "table") structure.tableRows = node.content.length;
      for (const child of node.content ?? []) visit(child);
    };
    visit(memo.contentJson);
    expect(structure).toEqual({ pdfs: ["迁移说明.pdf"], files: ["说明 100%.txt", "原样保留.zip"], tableRows: 2 });
    expect(emphasis.bold).toContain("粗体");
    expect(emphasis.italic).toContain("斜体");
    const resources = db.query("SELECT id,filename FROM resources WHERE is_deleted=0 AND memo_id=?").all(memo.id);
    expect(resources).toHaveLength(5);
    for (const resource of resources) {
      const blob = await client.getResourceBlob(`/api/v1/resources/${resource.id}/blob`);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(await readFile(new URL(`assets/${encodeURIComponent(resource.filename)}`, root))));
    }
    expect(await executeNoteImport(options)).toMatchObject({ completed: 1, failed: 0, resources: 5 });
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before + 1);
    expect(db.query("SELECT COUNT(*) AS n FROM resources WHERE is_deleted=0 AND memo_id=?").get(memo.id).n).toBe(5);
    await session.close(); db.close();
  });
  for (const [name, format, directory, notes, notebooks] of [
    ["obsidian-1.14.5.zip", "obsidian", false, 6, 4],
    ["obsidian-1.14.5.zip", "obsidian", true, 6, 4],
    ["joplin-3.7.21.jex", "joplin", false, 5, 3],
    ["joplin-3.7.21-raw.zip", "joplin", false, 5, 3],
    ["joplin-3.7.21-raw.zip", "joplin", true, 5, 3],
    ["joplin-3.7.21-md.zip", "joplin", true, 5, 3],
    ["joplin-3.7.21-md-frontmatter.zip", "joplin", true, 5, 3],
  ]) test(`${name} ${directory ? "directory" : "archive"}: metadata and original attachment bytes`, async () => {
    const { client, db } = await target();
    const file = new File([await readFile(new URL(name, root))], name);
    let files = [{ path: name, file }];
    if (directory) {
      const reader = new ZipReader(new BlobReader(file));
      files = [];
      for (const entry of await reader.getEntries()) if (!entry.directory) {
        const path = entry.filename.split("/").slice(1).join("/");
        files.push({ path, file: new File([await entry.getData(new Uint8ArrayWriter())], path.split("/").at(-1)), expandArchive: false });
      }
      await reader.close();
    }
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    const session = new NoteImportSession(format, files, new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ notes, notebooks, resources: 6, errors: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before);
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: notes, failed: 0, resources: 6 });
    const imported = [];
    for (const state of await session.index.page("result", 0, 100)) imported.push((await client.getMemo(state.memo.id)).memo);
    expect(imported.map(note => note.title).sort()).toEqual((format === "obsidian" ? ["迁移验收 · 欢迎 🌿", "图片与附件", "研究索引", "100% 完整", "任务清单", "代码示例"] : ["欢迎 🌿", "图片与附件", "任务清单", "代码示例", "空正文"]).sort());
    const plainMarkdown = name === "joplin-3.7.21-md.zip";
    for (const memo of imported) if (!plainMarkdown) {
      expect(memo.createdAt).toBe("2020-01-02T03:04:05.000Z");
      expect(memo.updatedAt).toBe("2021-02-03T04:05:06.000Z");
    }
    const picture = imported.find(note => note.title === "图片与附件");
    expect(picture.tags).toHaveLength(plainMarkdown ? 0 : 24);
    expect(picture.tags.every(tag => /^tag(?:0[1-9]|[12][0-9]|30)$/.test(tag))).toBe(true);
    expect(picture.contentMarkdown).toContain("https://example.com/full");
    expect(picture.contentMarkdown).toContain("missing.png");
    if (format === "obsidian") expect(picture.contentMarkdown).toContain("provenance: official-obsidian-cli");
    const { notebooks: folders } = await client.listNotebooks();
    const chain = [];
    let folder = folders.find(item => item.id === picture.notebookId);
    while (folder) { chain.unshift(folder.name); folder = folders.find(item => item.id === folder.parentId); }
    expect(chain).toEqual(format === "obsidian" ? [...(directory ? [] : ["Obsidian Vault"]), "研究", "项目 A"] : ["EdgeEver 导入验收", "研究", "项目 A"]);
    const resources = db.query(`SELECT id,filename FROM resources WHERE is_deleted=0 AND memo_id IN (${imported.map(() => "?").join(",")})`).all(...imported.map(note => note.id));
    expect(resources).toHaveLength(6);
    for (const resource of resources) {
      const blob = await client.getResourceBlob(`/api/v1/resources/${resource.id}/blob`);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(await readFile(new URL(`assets/${encodeURIComponent(resource.filename)}`, root))));
    }
    await session.close(); db.close();
  });

  test("local paths retain traversal, drive, file-URI and invalid-UTF-8 rejection", async () => {
    const body = ["[outside](%2e%2e/secret.txt)", "[invalid](%FF%20.txt)", "[file](file:///private/secret.txt)", "[drive](C:/private/secret.txt)", "[drive relative](C:secret.txt)"].join("\n\n");
    const session = new NoteImportSession("joplin", [{ path: "note.md", file: new File([body], "note.md") }], new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ errors: 5 });
    expect((await session.index.page("issue")).filter(issue => issue.code === "outsideRoot")).toHaveLength(5);
    await session.close();
  });
});
