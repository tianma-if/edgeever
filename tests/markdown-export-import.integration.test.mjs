import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js/index-native.js";
import { fetchEdgeEverApp } from "../apps/api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";
import { createEdgeEverClient } from "../packages/client/src/index.ts";
import { NoteImportSession, MemoryImportIndex } from "../packages/shared/src/note-import/index.ts";
import { executeNoteImport } from "../apps/web/src/lib/note-import/execute.ts";
import { convertImportEnml } from "../apps/web/src/lib/note-import/enml.ts";

const directories = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const archive = async (files, format) => {
  if (format === "zip") {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const entry of files) await writer.add(entry.path, new Uint8ArrayReader(new Uint8Array(await entry.file.arrayBuffer())));
    return [{ path: "export.zip", file: new File([await writer.close()], "export.zip") }];
  }
};
const target = async () => {
  const dir = await mkdtemp(join(tmpdir(), "edgeever-note-import-"));
  directories.push(dir);
  const db = new Database(join(dir, "db.sqlite"), { create: true });
  // Match the real self-hosted server: rollback-journal FULL sync makes this
  // query-budget regression depend on hundreds of unrelated disk flushes.
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(x => x.endsWith(".sql")).sort()) db.exec(await readFile(new URL(name, migrations), "utf8"));
  db.exec("INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)");
  const env = { storage: createSelfHostedStorageAdapter(db, join(dir, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
  let intercept = null;
  const apiFetch = async (url, init) => {
    const request = new Request(url, init);
    // Fetch normally supplies Content-Length for Blob multipart chunks.
    if (request.body && !request.headers.has("content-length")) request.headers.set("content-length", String(init.body instanceof Blob ? init.body.size : typeof init.body === "string" ? new TextEncoder().encode(init.body).length : init.body.byteLength));
    const response = await fetchEdgeEverApp(request, env, { waitUntil() {}, passThroughOnException() {} });
    return response;
  };
  const client = createEdgeEverClient({ baseUrl: "http://local.test", fetch: (url, init) => intercept?.(url, init) ?? apiFetch(url, init) });
  await client.getSession();
  await client.getImportCapabilities();
  return { client, db, env, intercept: (fn) => { intercept = fn; } };
};

const notionPartName = number => `Export-3f15dd29-7f7c-4388-812c-6bcf999914dd-Part-${number}.zip`;
const input = (path, data) => ({ path, file: new File([data], path) });
const notionPart = async (number, files) => ({ ...(await archive(files, "zip"))[0], path: notionPartName(number) });

describe("Notion and SiYuan through the unified import API", () => {
  test("Notion: imports a multipart export and preserves a missing CSV link with a warning", async () => {
    const { client, db, intercept } = await target();
    const missingHref = "Missing%20view.csv";
    const csv = "Title,Count\r\nExample,1\r\n";
    const zipBytes = randomBytes(1024 * 1024 + 128);
    const files = await archive([
      await notionPart(1, [input("Book/Home.md", `# Home\n\n[Missing view](${missingHref})\n\n[Data](Data.csv)\n\n[Archive](attachment.zip)`)]),
      await notionPart(2, [input("Book/Data.csv", csv), input("Book/attachment.zip", zipBytes)]),
    ], "zip");
    const session = new NoteImportSession("notion", files, new MemoryImportIndex());
    try {
      expect(await session.scan()).toMatchObject({ notes: 1, notebooks: 1, resources: 2, errors: 0, warnings: 2 });
      const staged = await session.index.count("archiveChunk");
      expect(staged).toBe(3);
      await session.finishReading();
      expect(await session.index.count("archiveChunk")).toBe(staged);
      expect(await session.index.page("issue")).toContainEqual(expect.objectContaining({
        severity: "warning", code: "missingAttachment", path: "Book/Home.md", detail: missingHref,
      }));
      const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
      intercept((url, init) => String(url).includes("/parts/") && init?.method === "PUT" ? Response.json({ error: { message: "fixture failure" } }, { status: 503 }) : null);
      expect(await executeNoteImport({ reader: session, index: session.index, client })).toMatchObject({ completed: 0, failed: 1 });
      expect(await session.index.count("archiveChunk")).toBe(staged);
      intercept(null);
      expect(await executeNoteImport({ reader: session, index: session.index, client })).toMatchObject({ completed: 1, failed: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n - before).toBe(1);
      const [result] = await session.index.page("result");
      const { memo } = await client.getMemo(result.memo.id);
      expect(memo.contentMarkdown).toContain(`[Missing view](${missingHref})`);
      expect(await (await client.getResourceBlob(result.urls["Book/Data.csv"])).text()).toBe(csv);
      const attachment = await (await client.getResourceBlob(result.urls["Book/attachment.zip"])).arrayBuffer();
      const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
      expect(sha256(new Uint8Array(attachment))).toBe(sha256(zipBytes));
    } finally { await session.close(); db.close(); }
    expect(await session.index.count("archiveChunk")).toBe(0);
  });

  test("Notion: root entries and a real same-name folder keep separate destinations", async () => {
    const { client, db } = await target();
    const files = await archive([input("Root.md", "# Root"), input("Notion/Child.md", "# Child")], "zip");
    const session = new NoteImportSession("notion", files, new MemoryImportIndex());
    try {
      expect(await session.scan()).toMatchObject({ notes: 2, notebooks: 2, errors: 0 });
      expect(await executeNoteImport({ reader: session, index: session.index, client })).toMatchObject({ completed: 2, failed: 0 });
      const notebooks = (await client.listNotebooks()).notebooks.filter(notebook => notebook.name === "Notion");
      const results = await session.index.page("result");
      expect(new Set(results.map(result => result.memo.notebookId))).toEqual(new Set(notebooks.map(notebook => notebook.id)));
      expect(notebooks).toHaveLength(2);
    } finally { await session.close(); db.close(); }
  });

  test("Notion: corrupt parts and duplicate paths across parts block preflight", async () => {
    const first = await notionPart(1, [input("Book/Page.md", "# One")]);
    const second = await notionPart(2, [input("Book/Page.md", "# Two")]);
    for (const [part, issue] of [[second, "duplicatePath"], [input(notionPartName(2), "invalid zip"), "invalidArchive"]]) {
      const files = await archive([first, part], "zip");
      const session = new NoteImportSession("notion", files, new MemoryImportIndex());
      try {
        expect((await session.scan()).errors).toBeGreaterThan(0);
        expect(await session.index.page("issue")).toContainEqual(expect.objectContaining({ severity: "error", code: issue }));
      } finally { await session.close(); }
    }
  });

  for (const format of ["notion", "siyuan"]) test(`${format}: Markdown ZIP, byte-preserving attachments, retry and new task`, async () => {
    const { client, db, intercept } = await target();
    const id = "a".repeat(32);
    const folder = format === "notion" ? `Project ${id}` : "Project";
    const csv = 'Name,Description\r\n"one","line 1\nline 2, with comma"\r\n';
    const asset = new Uint8Array([1, 2, 3, 4, 5]);
    const files = await archive([
      { path: `${folder}/Page ${id}.md`, file: new File([`# Page title\n\n![image](${format === "notion" ? "../" : ""}assets/a.png)\n${format === "siyuan" ? "[block](siyuan://blocks/20240101000000-abcdefg)" : ""}`], "page.md") },
      { path: "assets/a.png", file: new File([asset], "a.png") },
      ...(format === "notion" ? [{ path: `Database ${id}.csv`, file: new File([csv], "database.csv") }] : []),
    ], "zip");
    const session = new NoteImportSession(format, files, new MemoryImportIndex());
    const summary = await session.scan();
    expect(summary.errors).toBe(0);
    expect(summary.notes).toBe(format === "notion" ? 2 : 1);
    expect((await session.index.page("notebook")).some(n => n.name === "Project")).toBe(true);
    const notes = await session.index.page("note");
    expect(notes.some(n => n.title === "Page title")).toBe(true);
    for (const note of notes) for (const resource of note.resources) {
      expect(await session.readResourcePart(resource, 0, resource.byteSize)).toEqual(resource.mimeType === "text/csv" ? new TextEncoder().encode(csv) : asset);
      await session.releaseNote(note);
    }
    const parent = (await client.createNotebook({ name: "Imported" })).notebook.id;
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    intercept((url, init) => String(url).includes("/parts/") && init?.method === "PUT" ? Response.json({ error: { message: "fixture failure" } }, { status: 503 }) : null);
    const failed = await executeNoteImport({ reader: session, index: session.index, convertEnml: convertImportEnml, client, parentId: parent });
    expect(failed.failed).toBe(1);
    intercept(null);
    const first = await executeNoteImport({ reader: session, index: session.index, convertEnml: convertImportEnml, client, parentId: parent });
    expect(first).toMatchObject({ failed: 0 });
    expect(first.completed).toBe(summary.notes);
    for (const result of await session.index.page("result")) for (const [path, url] of Object.entries(result.urls)) {
      const bytes = new Uint8Array(await (await client.getResourceBlob(url)).arrayBuffer());
      expect(bytes).toEqual(path.endsWith(".csv") ? new TextEncoder().encode(csv) : asset);
    }
    const repeat = await executeNoteImport({ reader: session, index: session.index, convertEnml: convertImportEnml, client, parentId: parent });
    expect(repeat.failed).toBe(0);
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n - before).toBe(summary.notes);
    const fresh = new NoteImportSession(format, files, new MemoryImportIndex());
    await fresh.scan();
    expect((await executeNoteImport({ reader: fresh, index: fresh.index, convertEnml: convertImportEnml, client, parentId: parent })).failed).toBe(0);
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n - before).toBe(summary.notes * 2);
    await fresh.close(); await session.close();
  });

  for (const format of ["notion", "siyuan"]) test(`${format}: unsafe paths block writes and old servers reject the format`, async () => {
    const { client, db } = await target();
    const session = new NoteImportSession(format, [{ path: "page.md", file: new File(["# Page\n![missing](missing.png)\n[bad CSV](../outside.csv)"], "page.md") }], new MemoryImportIndex());
    expect(await session.scan()).toMatchObject({ errors: 1, warnings: 1 });
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    await expect(executeNoteImport({ reader: session, index: session.index, convertEnml: convertImportEnml, client })).rejects.toThrow("preflightErrors");
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before);
    await session.close();
    const valid = new NoteImportSession(format, [{ path: "page.md", file: new File(["# Page"], "page.md") }], new MemoryImportIndex());
    await valid.scan();
    const old = { ...client, getImportCapabilities: async () => ({ protocolVersion: 1, maxBatchSize: 25, formats: ["flomo"] }) };
    await expect(executeNoteImport({ reader: valid, index: valid.index, convertEnml: convertImportEnml, client: old })).rejects.toThrow("unsupportedImportServer");
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before);
    await valid.close();
  });


});

for (const format of ["notion", "siyuan"]) test(`${format}: wrapped HTML keeps adjacent Markdown attachments through import`, async () => {
  const { client, db } = await target();
  const attachments = { "assets/p.png": new Uint8Array([137,80,78,71,0,255]), "assets/other.png": new Uint8Array([137,80,78,71,1,254]), "assets/file.pdf": new Uint8Array([37,80,68,70,0,128,255]) };
  const markdown = '<div><script>const x="</div>";</script><img src="assets/p.png"></div>\n<div><img src="assets/other.png"></div>\n[download](assets/file.pdf)\n![other](assets/other.png)\n**Keep bold**';
  const files = await archive([{ path: "Page.md", file: new File([markdown], "Page.md") }, ...Object.entries(attachments).map(([path, bytes]) => ({ path, file: new File([bytes], path) }))], "zip");
  const session = new NoteImportSession(format, files, new MemoryImportIndex());
  try {
    expect(await session.scan()).toMatchObject({ notes: 1, resources: 3, errors: 0, warnings: 0 });
    const [note] = await session.index.page("note");
    expect((await session.readNote(note.key)).contentMarkdown).toContain('[download](assets/file.pdf)\n![other](assets/other.png)\n**Keep bold**');
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0, resources: 3 });
    const [result] = await session.index.page("result");
    const { memo } = await client.getMemo(result.memo.id);
    expect(memo.contentMarkdown).toContain("**Keep bold**");
    expect(memo.contentMarkdown).toContain(`[download](${result.urls["assets/file.pdf"]})`);
    expect(memo.contentMarkdown).toContain(`![other](${result.urls["assets/other.png"]})`);
    for (const [path, bytes] of Object.entries(attachments)) {
      expect(result.urls[path]).toBeTruthy();
      expect(memo.contentMarkdown).toContain(result.urls[path]);
      expect(new Uint8Array(await (await client.getResourceBlob(result.urls[path])).arrayBuffer())).toEqual(bytes);
    }
  } finally { await session.close(); db.close(); }
});

for (const format of ["notion", "siyuan"]) test(`${format}: missing attachments warn and preserve links while existing attachments import`, async () => {
  const { client, db } = await target();
  const markdown = '[pdf](assets/missing.pdf)\n![image](assets/missing.png)\n[csv](assets/missing.csv)\n[asset](assets/missing.md)\n[existing](assets/present.pdf)';
  const session = new NoteImportSession(format, [{ path: "Page.md", file: new File([markdown], "Page.md") }, { path: "assets/present.pdf", file: new File(["%PDF-present"], "present.pdf") }], new MemoryImportIndex());
  try {
    const before = db.query("SELECT COUNT(*) AS n FROM memos").get().n;
    expect(await session.scan()).toMatchObject({ notes: 1, resources: 1, errors: 0, warnings: 4 });
    expect(db.query("SELECT COUNT(*) AS n FROM memos").get().n).toBe(before);
    const issues = await session.index.page("issue");
    expect(issues.every(issue => issue.severity === "warning" && issue.path === "Page.md" && issue.detail)).toBe(true);
    expect(issues.find(issue => issue.detail === "assets/missing.pdf").code).toBe("missingAttachment");
    expect(await executeNoteImport({ reader: session, index: session.index, client, convertEnml: convertImportEnml })).toMatchObject({ completed: 1, failed: 0, resources: 1 });
    const [result] = await session.index.page("result");
    const { memo } = await client.getMemo(result.memo.id);
    expect(memo.contentMarkdown).toContain(markdown.split('\n').slice(0, 4).join('\n'));
    expect(memo.contentMarkdown).toContain(`[existing](${result.urls["assets/present.pdf"]})`);
    expect(await (await client.getResourceBlob(result.urls["assets/present.pdf"])).text()).toBe("%PDF-present");
    expect(Object.keys(result.urls)).toEqual(["assets/present.pdf"]);
  } finally { await session.close(); db.close(); }
});
