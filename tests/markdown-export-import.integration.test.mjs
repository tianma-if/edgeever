import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
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

describe("Notion and SiYuan through the unified import API", () => {
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

  for (const format of ["notion", "siyuan"]) test(`${format}: missing attachments block writes and old servers reject the format`, async () => {
    const { client, db } = await target();
    const session = new NoteImportSession(format, [{ path: "page.md", file: new File(["# Page\n![missing](missing.png)"], "page.md") }], new MemoryImportIndex());
    expect((await session.scan()).errors).toBe(1);
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
