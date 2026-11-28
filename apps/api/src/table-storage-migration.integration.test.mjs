import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { createEdgeEverClient } from "../../../packages/client/src/index.ts";
import { createBackupTableReaders, createEdgeEverZip, parseEdgeEverZip, restoreEdgeEverZip, streamZipEntries } from "@edgeever/shared/backup-archive";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  docToText,
  markdownToDoc,
  parseTableDocument,
  serializeTableDocument,
} from "@edgeever/shared";
import {
  createMemoEditSession,
  createMemoRecord,
  deleteMemosRecord,
  emptyTrashMemosRecord,
  getMemoDetail,
  getMemoDetailRow,
  mapMemoDetail,
  mergeMemosRecord,
  updateMemoRecord,
} from "./memo-service";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter";
import {
  getMemoRevisionRow,
  listMemoRevisions,
  restoreMemoRevision,
} from "./memo-revision-service";
import { recordProjection, SharedTableStore } from "./shared-table-store";
import { sha256 } from "./hash-utils";
import { appendTableFormSubmission } from "./table-form-service";
import { registerSharedTableRoutes } from "./shared-table-routes";
import { registerSyncRoutes } from "./sync-routes";
import { registerBackupRoutes } from "./backup-routes";
import { restoreJsonMemos, restoreJsonNotebooks } from "./backup-service";
import { SharedTableMigration } from "./table-storage-migration";
import { hydrateSharedMemoRows } from "./table-memo-storage";

const actor = { actorType: "user", actorId: "usr_owner" };
const workspace = "ws_default";
const fields = [
  { id: "name", name: "Name", type: "text" },
  { id: "files", name: "Files", type: "attachment" },
];
const records = Array.from({ length: 117 }, (_, i) => ({
  id: `row_${117 - i}`,
  cells: {
    name: `Task ${i}`,
    files:
      i === 0
        ? [
            {
              resourceId: "res_test",
              filename: "附件.pdf",
              mimeType: "application/pdf",
              byteSize: 7,
            },
          ]
        : [],
  },
}));
const tables = [
  { schemaVersion: 1, fields, records, view: { filters: [], sort: null } },
  {
    schemaVersion: 2,
    fields,
    records: records.slice(0, 2),
    views: [
      { id: "view_a", name: "My view", match: "all", filters: [], sorts: [] },
    ],
  },
];

async function seedLegacyMemo(db, document, id) {
  const contentMarkdown = serializeTableDocument(document);
  const doc = markdownToDoc(contentMarkdown);
  const contentJson = JSON.stringify(doc);
  const contentHash = await sha256(contentMarkdown + contentJson);
  await db.batch([
    db
      .prepare(
        "INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES (?, ?, 'nb_inbox', 'Fixture')",
      )
      .bind(id, workspace),
    db
      .prepare(
        "INSERT INTO memo_contents (memo_id, content_markdown, content_json, content_text, content_hash, revision) VALUES (?, ?, ?, ?, ?, 0)",
      )
      .bind(id, contentMarkdown, contentJson, docToText(doc), contentHash),
  ]);
  return { id, contentMarkdown, contentHash, revision: 0 };
}

async function seededInstallation() {
  const directory = mkdtempSync(join(tmpdir(), "edgeever-table-migration-"));
  const path = join(directory, "data.sqlite");
  const open = () => {
    const sqlite = new Database(path);
    sqlite.exec("PRAGMA foreign_keys = ON");
    return { sqlite, db: createSelfHostedStorageAdapter(sqlite, directory).db };
  };
  const first = open();
  const files = globSync("migrations/*.sql").sort();
  for (const file of files.filter((file) => file < "migrations/0100"))
    first.sqlite.exec(readFileSync(file, "utf8"));
  const memos = await Promise.all(
    tables.map((table, index) =>
      seedLegacyMemo(first.db, table, `fixture_${index}`),
    ),
  );
  first.sqlite.close();
  const upgraded = open();
  for (const file of files.filter((file) => file >= "migrations/0100"))
    upgraded.sqlite.exec(readFileSync(file, "utf8"));
  return {
    ...upgraded,
    memos,
    open,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("interrupted migration resumes from committed rows and preserves v1 and v2 documents", async () => {
  const installation = await seededInstallation();
  let connection = installation;
  try {
    const migration = new SharedTableMigration(connection.db);
    await migration.start();
    let progress = await migration.advance();
    for (let calls = 0; progress.rowsCopied === 0 && calls < 30; calls++)
      progress = await migration.advance();
    expect(progress.rowsCopied).toBeGreaterThan(0);
    expect(progress.phase).toBe("copying");
    const before = await getMemoDetail(
      connection.db,
      workspace,
      installation.memos[0].id,
    );
    expect(before.contentMarkdown).toBe(installation.memos[0].contentMarkdown);
    connection.sqlite.close();
    connection = installation.open();
    const resumed = new SharedTableMigration(connection.db);
    expect(await resumed.status()).toEqual(progress);
    for (let calls = 0; progress.phase !== "ready" && calls < 30; calls++)
      progress = await resumed.advance();
    expect(progress).toMatchObject({
      phase: "ready",
      tablesCopied: 2,
      rowsCopied: 119,
    });
    expect(await resumed.advance()).toEqual(progress);
    const store = new SharedTableStore(connection.db);
    for (const memo of installation.memos) {
      const snapshot = await store.snapshot(workspace, memo.id);
      expect(snapshot).toEqual({
        ...parseTableDocument(memo.contentMarkdown),
        cellEncoding: "nullable-v1",
      });
      expect(
        (await getMemoDetail(connection.db, workspace, memo.id))
          .contentMarkdown,
      ).toBe(memo.contentMarkdown);
    }
    await resumed.activate();
    for (const memo of installation.memos) {
      const active = await getMemoDetail(connection.db, workspace, memo.id);
      expect(active.sharedTableRevision).toBe(1);
      expect(parseTableDocument(active.contentMarkdown)).toEqual(await store.snapshot(workspace, memo.id));
    }
  } finally {
    connection.sqlite.close();
    installation.cleanup();
  }
});

test("field add, type change and removal preserve old values in history", async () => {
  const installation = await seededInstallation();
  try {
    const migration = new SharedTableMigration(installation.db);
    let status = await migration.start();
    while (status.phase === "copying") status = await migration.advance();
    const store = new SharedTableStore(installation.db);
    const id = installation.memos[1].id;
    const { records: current, ...header } = await store.snapshot(workspace, id);
    await store.apply(workspace, id, {
      expectedRevision: 1,
      header: {
        ...header,
        fields: [...fields, { id: "count", name: "Count", type: "text" }],
        records: [],
      },
      puts: [{ ...current[0], cells: { ...current[0].cells, count: "42" } }],
    });
    const { records: added, ...nextHeader } = await store.snapshot(
      workspace,
      id,
    );
    expect(added.map((row) => row.cells.count)).toEqual(["42", ""]);
    await store.apply(workspace, id, {
      expectedRevision: 2,
      header: {
        ...nextHeader,
        fields: [fields[0], { id: "count", name: "Count", type: "number" }],
        records: [],
      },
    });
    const converted = await store.snapshot(workspace, id);
    expect(converted.records.map((row) => row.cells)).toEqual([
      { name: "Task 0", count: 42 },
      { name: "Task 1", count: null },
    ]);
    await store.restore(workspace, id, 1, 3);
    expect((await store.snapshot(workspace, id)).records).toEqual(current);
    expect((await store.snapshot(workspace, id, 2)).records).toEqual(added);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("D1 applies the schema and resumes guarded batches with saved-view indexes", async () => {
  const { createRequire } = await import("node:module");
  const requireWrangler = createRequire(
    new URL("../../../packages/wrangler/package.json", import.meta.url),
  );
  const wrangler = requireWrangler.resolve("edgeever-wrangler-cli");
  const { unstable_splitSqlQuery } = await import(wrangler);
  const { Miniflare } = createRequire(wrangler)("miniflare");
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {};",
    compatibilityDate: "2026-07-14",
    d1Databases: { DB: "edgeever-table-storage-test" },
  });
  try {
    const db = await miniflare.getD1Database("DB");
    const files = globSync("migrations/*.sql").sort();
    const apply = (file) =>
      db.batch(
        unstable_splitSqlQuery(readFileSync(file, "utf8")).map((sql) =>
          db.prepare(sql),
        ),
      );
    for (const file of files.filter((name) => name < "migrations/0100"))
      await apply(file);
    const table = {
      ...tables[1],
      records,
      views: [
        {
          id: "by_name",
          name: "By name",
          match: "all",
          filters: [],
          sorts: [{ fieldId: "name", direction: "asc" }],
        },
      ],
    };
    const memo = await seedLegacyMemo(db, table, "d1_fixture");
    for (const file of files.filter((name) => name >= "migrations/0100"))
      await apply(file);
    const migration = new SharedTableMigration(db);
    await migration.start();
    await Promise.all([migration.advance(), migration.advance()]);
    const resumed = new SharedTableMigration(db);
    let status = await resumed.status();
    while (status.phase === "copying") status = await resumed.advance();
    expect(status).toMatchObject({
      phase: "ready",
      tablesCopied: 1,
      rowsCopied: 117,
    });
    const store = new SharedTableStore(db);
    const first = await store.query(workspace, memo.id, {
      view: table.views[0],
      includeTotal: true,
    });
    expect(first.sourceRowCount).toBe(117);
    expect(first.matchedRowCount).toBe(117);
    expect(first.records[0].id).toBe("row_117");
    const second = await store.query(workspace, memo.id, {
      view: table.views[0],
      cursor: first.next,
    });
    expect(second.records).toHaveLength(50);
    expect((await store.snapshot(workspace, memo.id)).records).toEqual(records);
    await resumed.activate();
    const current = await getMemoDetail(db, workspace, memo.id);
    const edited = parseTableDocument(current.contentMarkdown);
    edited.records[2].cells.name = "D1 edit after activation";
    const saved = await updateMemoRecord(
      db,
      workspace,
      memo.id,
      {
        expectedRevision: current.revision,
        contentMarkdown: serializeTableDocument(edited),
      },
      actor,
      "test",
    );
    expect(saved.memo.revision).toBe(current.revision + 1);
    expect(
      (await store.changes(workspace, memo.id, { since: 1 })).changes,
    ).toMatchObject([
      { id: edited.records[2].id, cells: edited.records[2].cells },
    ]);
    expect(
      parseTableDocument(
        (await getMemoDetail(db, workspace, memo.id)).contentMarkdown,
      ).records,
    ).toEqual(edited.records);
  } finally {
    await miniflare.dispose();
  }
}, 30_000);

test("reading a full 2,000-record current snapshot fits the D1 free invocation query budget", async () => {
  const installation = await seededInstallation();
  try {
    const wide = Array.from({ length: 2000 }, (_, index) => ({
      id: `wide_${index}`,
      cells: { name: `Record ${index}`, files: [] },
    }));
    const memo = await createMemoRecord(
      installation.db,
      workspace,
      {
        notebookId: "nb_inbox",
        contentMarkdown: serializeTableDocument({
          ...tables[0],
          records: wide,
        }),
      },
      actor,
      "test",
    );
    const migration = new SharedTableMigration(installation.db);
    let status = await migration.start();
    while (status.phase === "copying") status = await migration.advance();
    let reads = 0;
    const budgeted = {
      prepare: (sql) => {
        expect(sql).not.toContain("ee_table_versions");
        if (++reads > 50)
          throw new Error("D1 free invocation query budget exhausted");
        return installation.db.prepare(sql);
      },
      batch: (statements) => installation.db.batch(statements),
    };
    expect(
      (await new SharedTableStore(budgeted).snapshot(workspace, memo.id))
        .records,
    ).toEqual(wide);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("canceling a staged migration preserves legacy bodies and releases the maintenance lock", async () => {
  const installation = await seededInstallation();
  try {
    const migration = new SharedTableMigration(installation.db);
    let status = await migration.start();
    while (status.phase === "copying") status = await migration.advance();
    const id = installation.memos[0].id;
    await expect(
      createMemoRecord(
        installation.db,
        workspace,
        {
          notebookId: "nb_inbox",
          contentMarkdown: serializeTableDocument(tables[0]),
        },
        actor,
        "test",
      ),
    ).rejects.toThrow("table_migration_in_progress");
    const store = new SharedTableStore(installation.db);
    status = await migration.beginRollback();
    while (status.phase === "rolling_back") status = await migration.advance();
    expect(status.phase).toBe("legacy");
    const legacy = await getMemoDetail(installation.db, workspace, id);
    expect(legacy.contentMarkdown).toBe(installation.memos[0].contentMarkdown);
    expect(legacy.revision).toBe(installation.memos[0].revision);
    expect(
      (
        await getMemoDetail(
          installation.db,
          workspace,
          installation.memos[1].id,
        )
      ).contentMarkdown,
    ).toBe(installation.memos[1].contentMarkdown);
    await expect(store.snapshot(workspace, id)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await createMemoRecord(
        installation.db,
        workspace,
        {
          notebookId: "nb_inbox",
          contentMarkdown: serializeTableDocument(tables[0]),
        },
        actor,
        "test",
      ),
    ).toHaveProperty("id");
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("merges the current shared records with an ordinary memo", async () => {
  const installation = await seededInstallation();
  try {
    const { db } = installation;
    const migration = new SharedTableMigration(db);
    await migration.start();
    while ((await migration.advance()).phase === "copying") {}
    await migration.activate();
    const create = (contentMarkdown) => createMemoRecord(db, workspace, { notebookId: "nb_inbox", contentMarkdown }, actor, "test");
    const table = await create(serializeTableDocument({ ...tables[0], records: [{ id: "row", cells: { name: "Only row in shared storage" } }] }));
    const note = await create("Ordinary note body");
    const merged = await mergeMemosRecord(db, workspace, { memoIds: [table.id, note.id] }, actor, "test");
    expect(merged.contentText).toContain("Only row in shared storage");
    expect(merged.contentText).toContain("Ordinary note body");
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("permanent delete and empty trash remove only the affected saved view indexes", async () => {
  const installation = await seededInstallation();
  try {
    const { db, sqlite } = installation;
    const migration = new SharedTableMigration(db);
    await migration.start();
    while ((await migration.advance()).phase === "copying") {}
    await migration.activate();
    const sorted = { ...tables[1], views: [{ ...tables[1].views[0], sorts: [{ fieldId: "name", direction: "asc" }] }] };
    const create = () => createMemoRecord(db, workspace, { notebookId: "nb_inbox", contentMarkdown: serializeTableDocument(sorted) }, actor, "test");
    const first = await create();
    const second = await create();
    const keep = await create();
    const indexName = (id) => JSON.parse(sqlite.query("SELECT indexes_json FROM ee_table_heads WHERE table_id = ?").get(id).indexes_json)[0].name;
    const indexes = () => sqlite.query("SELECT name FROM sqlite_schema WHERE type = 'index' AND name GLOB 'ee_table_view_*'").all().map(({ name }) => name);
    const names = [first.id, second.id, keep.id].map(indexName);
    const env = { storage: { db } };
    await deleteMemosRecord(env, workspace, [first.id, second.id], false, actor);
    expect(indexes()).toEqual(expect.arrayContaining(names));
    await deleteMemosRecord(env, workspace, [first.id], true, actor);
    expect(indexes()).not.toContain(names[0]);
    await emptyTrashMemosRecord(env, workspace, actor);
    expect(indexes()).toEqual([names[2]]);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("ordinary memo saves after cutover persist only changed shared records", async () => {
  const installation = await seededInstallation();
  const { db, sqlite, memos } = installation;
  try {
    const migration = new SharedTableMigration(db);
    let status = await migration.start();
    while (status.phase === "copying") status = await migration.advance();
    expect((await migration.activate()).phase).toBe("active");
    const memo = memos[0];
    const document = parseTableDocument(memo.contentMarkdown);
    document.records[1].cells.name = "Updated through ordinary memo save";
    const saved = await updateMemoRecord(
      db,
      workspace,
      memo.id,
      {
        expectedRevision: memo.revision,
        contentMarkdown: serializeTableDocument(document),
      },
      actor,
      "test",
    );
    expect(parseTableDocument(saved.memo.contentMarkdown).records).toEqual(
      document.records,
    );
    expect(
      parseTableDocument(
        (await getMemoDetail(db, workspace, memo.id)).contentMarkdown,
      ).records,
    ).toEqual(document.records);
    expect(
      (await new SharedTableStore(db).changes(workspace, memo.id, { since: 1 }))
        .changes,
    ).toMatchObject([
      {
        id: document.records[1].id,
        deleted: false,
        cells: document.records[1].cells,
      },
    ]);
    const stored = sqlite
      .query(
        "SELECT content_markdown, shared_table_revision FROM memo_contents WHERE memo_id = ?",
      )
      .get(memo.id);
    expect(stored.shared_table_revision).toBe(2);
    expect(stored.content_markdown).not.toContain(
      "Updated through ordinary memo save",
    );
  } finally {
    sqlite.close();
    installation.cleanup();
  }
});

test("backup reads current and historical shared rows in version-bound chunks", async () => {
  const installation = await seededInstallation();
  try {
    const { db, memos } = installation;
    const migration = new SharedTableMigration(db);
    await migration.start();
    while ((await migration.advance()).phase === "copying") {}
    await migration.activate();
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("auth", { ...actor, kind: "user", workspaceId: workspace, role: "owner" }); await next(); });
    registerBackupRoutes(app, { clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)), mapMemoDetail, getMemoDetail });
    const env = { storage: { db } };
    const id = memos[0].id;
    const before = await getMemoDetail(db, workspace, id);
    const edit = parseTableDocument(before.contentMarkdown);
    edit.records[0].cells.name = "Current value";
    expect((await updateMemoRecord(db, workspace, id, { expectedRevision: before.revision, contentMarkdown: serializeTableDocument(edit) }, actor, "test")).memo).toBeTruthy();
    const state = await (await app.request("/api/v1/backups/state", {}, env)).json();
    const read = (input) => app.request(`/api/v1/backups/data?${new URLSearchParams({ identity: state.identity, revision: state.backupRevision, ...input })}`, {}, env);
    const catalog = await (await read({ kind: "memos", tableChunks: "1" })).json();
    expect(catalog.memos.find((memo) => memo.id === id)).toMatchObject({ sharedTableRevision: 2, contentMarkdown: "" });
    const history = await (await read({ kind: "revisions", memoId: id })).json();
    const [revision] = history.revisions;
    expect(revision).toMatchObject({ sharedTableRevision: 1, contentMarkdown: "" });
    for (const [series, name] of [[{}, "Current value"], [{ revisionId: revision.id }, records[0].cells.name]]) {
      const rows = [];
      let after = "";
      do {
        const page = await read({ kind: "table", memoId: id, after, ...series });
        expect(page.status).toBe(200);
        const result = await page.json();
        expect(result.rows.length).toBeLessThanOrEqual(25);
        rows.push(...result.rows);
        after = result.nextCursor;
      } while (after !== null);
      rows.sort((a, b) => a.position - b.position);
      expect(rows.map((row) => row.id)).toEqual(records.map((row) => row.id));
      expect(rows[0].cells.name).toBe(name);
    }
    await db.prepare("UPDATE memos SET title = 'Changed during backup' WHERE id = ?").bind(id).run();
    expect((await read({ kind: "table", memoId: id })).status).toBe(409);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("publishes a chunked restore only when every snapshot is complete and the destination is unchanged", async () => {
  const installation = await seededInstallation();
  try {
    const { db, memos } = installation;
    const migration = new SharedTableMigration(db);
    await migration.start();
    while ((await migration.advance()).phase === "copying") {}
    await migration.activate();
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("auth", { ...actor, kind: "user", workspaceId: workspace, role: "owner" }); await next(); });
    app.onError((error, c) => c.json({ error: { code: error.code, message: error.message } }, error.status ?? 500));
    registerBackupRoutes(app, { clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)), mapMemoDetail, getMemoDetail });
    const env = { storage: { db } };
    const id = memos[0].id;
    const before = await getMemoDetail(db, workspace, id);
    const memo = { ...before, title: "Restored", contentMarkdown: "", contentText: "", contentJson: markdownToDoc("") };
    const revision = { id: "restored-history", memoId: id, revision: 1, title: "History", tags: [], createdAt: before.createdAt,
      createdBy: "backup", contentMarkdown: "", contentText: "", contentJson: memo.contentJson, contentHash: "history", sharedTableRevision: 1 };
    const snapshots = [
      { ordinal: 0, revision, table: { header: { ...tables[0], records: [] }, rowCount: 2 } },
      { ordinal: 1, revision: null, table: { header: { ...tables[1], records: [] }, rowCount: 1 } },
    ];
    const send = (restoreId, input) => app.request(`/api/v1/restores/json/tables/${restoreId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }, env);
    const stage = async (restoreId) => {
      expect((await send(restoreId, { action: "start", memo, snapshots: 2 })).status).toBe(200);
      for (const snapshot of snapshots) expect((await send(restoreId, { action: "snapshot", ...snapshot })).status).toBe(200);
      const put = { action: "rows", ordinal: 0, rows: [
        { ...records[0], position: 5 }, { ...records[1], position: 8 },
      ] };
      expect((await send(restoreId, put)).status).toBe(200);
      expect((await send(restoreId, put)).status).toBe(200);
    };
    const lastRow = { action: "rows", ordinal: 1, rows: [{ ...records[1], position: 8 }] };
    const interrupted = crypto.randomUUID();
    await stage(interrupted);
    expect((await send(interrupted, { action: "publish" })).status).toBe(409);
    expect((await getMemoDetail(db, workspace, id)).contentMarkdown).toBe(before.contentMarkdown);
    expect((await send(interrupted, { action: "cancel" })).status).toBe(200);
    expect((await send(interrupted, lastRow)).status).toBe(404);

    const concurrent = crypto.randomUUID();
    await stage(concurrent);
    expect((await send(concurrent, lastRow)).status).toBe(200);
    await db.prepare("UPDATE memos SET title = 'Destination changed' WHERE id = ?").bind(id).run();
    expect((await send(concurrent, { action: "publish" })).status).toBe(409);
    expect((await getMemoDetail(db, workspace, id)).title).toBe("Destination changed");
    await db.prepare("UPDATE ee_table_restore_jobs SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(concurrent).run();

    const successful = crypto.randomUUID();
    await stage(successful);
    expect(await db.prepare("SELECT id FROM ee_table_restore_jobs WHERE id = ?").bind(concurrent).first()).toBeNull();
    expect((await send(successful, lastRow)).status).toBe(200);
    const publish = await send(successful, { action: "publish" });
    expect(publish.status).toBe(200);
    expect((await send(successful, { action: "publish" })).status).toBe(200);
    const current = await getMemoDetail(db, workspace, id);
    expect(current.title).toBe("Restored");
    expect(parseTableDocument(current.contentMarkdown).records).toEqual([records[1]]);
    const historical = await getMemoRevisionRow(db, workspace, id, revision.id);
    expect(parseTableDocument(historical.content_markdown).records).toEqual(records.slice(0, 2));
    expect((await new SharedTableStore(db).changes(workspace, id, { since: current.sharedTableRevision - 1 })).changes.some((row) => row.id === records[0].id && row.deleted)).toBe(true);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("chunked backup round-trips legacy data beyond the table editor's add-record limit", async () => {
  const installation = await seededInstallation();
  try {
    const { db } = installation;
    const legacy = {
      ...tables[0],
      fields: fields.slice(0, 1),
      records: Array.from({ length: 2_001 }, (_, i) => ({ id: `existing-${i}`, cells: { name: `Value ${i}` } })),
    };
    const { id } = await seedLegacyMemo(db, legacy, "legacy-over-editor-limit");
    const migration = new SharedTableMigration(db);
    await migration.start();
    while ((await migration.advance()).phase === "copying") {}
    await migration.activate();
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("auth", { ...actor, kind: "user", workspaceId: workspace, role: "owner" }); await next(); });
    app.onError((error, c) => c.json({ error: { code: error.code, message: error.message } }, error.status ?? 500));
    registerBackupRoutes(app, {
      clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)), mapMemoDetail, getMemoDetail,
      restoreJsonMemos, restoreJsonNotebooks,
    });
    const client = createEdgeEverClient({
      baseUrl: "https://backup.local",
      fetch: (input, init) => app.fetch(new Request(input, init), { storage: { db } }),
    });
    const state = await client.getJsonBackupState();
    const read = (query) => client.getJsonBackupData(state, query);
    const archive = await createEdgeEverZip({
      listNotebooks: () => read({ kind: "notebooks" }),
      listPrompts: () => read({ kind: "prompts" }),
      getPage: async () => {
        const page = await read({ kind: "memos", tableChunks: "1" });
        return { ...page, tableChunks: state.tableChunks, totalCount: state.counts.memos, nextOffset: null };
      },
      readTable: (memoId, _revisionId, after) => read({ kind: "table", memoId, after }),
    }, { edgeeverVersion: "2.31.2", buildId: "legacy-table-backup-test" });
    const parsed = await parseEdgeEverZip(archive);
    expect(parsed.tableSnapshots.get(id)[0].rowCount).toBe(2_001);
    const env = { storage: { db } };
    await deleteMemosRecord(env, workspace, [id], false, actor);
    await deleteMemosRecord(env, workspace, [id], true, actor);
    await restoreEdgeEverZip(parsed, {
      restoreNotebooks: client.restoreJsonNotebooks, restoreMemos: client.restoreJsonMemos,
      restorePrompts: async () => {}, tableRestore: client.jsonTableRestore,
      createResourceRestoreSink: () => { throw new Error("No resource blobs were exported"); },
    });
    const restored = await getMemoDetail(db, workspace, id);
    expect(parseTableDocument(restored.contentMarkdown).records).toEqual(legacy.records);
    const document = parseTableDocument(restored.contentMarkdown);
    document.records[0].cells.name = "An edited legacy row";
    const result = await updateMemoRecord(db, workspace, id, {
      expectedRevision: restored.revision, contentMarkdown: serializeTableDocument(document),
    }, actor, "test");
    expect(parseTableDocument(result.memo.contentMarkdown).records[0].cells.name).toBe("An edited legacy row");
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
}, 30_000);

test("new tables and memo history use shared revisions after activation", async () => {
  const installation = await seededInstallation();
  try {
    const { db, sqlite } = installation;
    const migration = new SharedTableMigration(db);
    let status = await migration.start();
    while (status.phase === "copying") status = await migration.advance();
    await migration.activate();
    const created = await createMemoRecord(
      db,
      workspace,
      {
        notebookId: "nb_inbox",
        contentMarkdown: serializeTableDocument(tables[1]),
      },
      actor,
      "test",
    );
    expect(
      sqlite
        .query(
          "SELECT shared_table_revision FROM memo_contents WHERE memo_id = ?",
        )
        .get(created.id).shared_table_revision,
    ).toBe(1);
    const changed = parseTableDocument(created.contentMarkdown);
    changed.records[0].cells.name = "Current after save";
    await updateMemoRecord(
      db,
      workspace,
      created.id,
      {
        expectedRevision: created.revision,
        contentMarkdown: serializeTableDocument(changed),
      },
      actor,
      "test",
    );
    const revision = sqlite
      .query(
        "SELECT id, shared_table_revision FROM memo_revisions WHERE memo_id = ?",
      )
      .get(created.id);
    expect(revision.shared_table_revision).toBe(1);
    const histories = await listMemoRevisions(
      db,
      workspace,
      created.id,
      10,
      getMemoDetail,
      false,
    );
    expect(parseTableDocument(histories[0].contentMarkdown).records).toEqual(
      tables[1].records,
    );
    const restored = await restoreMemoRevision(
      db,
      workspace,
      created.id,
      revision.id,
      actor,
      "test",
      {
        getMemoDetail,
        getMemoDetailRow,
        updateMemoRecord,
      },
    );
    expect(parseTableDocument(restored.contentMarkdown).records).toEqual(
      tables[1].records,
    );
    expect(
      (
        await new SharedTableStore(db).changes(workspace, created.id, {
          since: 2,
        })
      ).changes[0].cells.name,
    ).toBe(tables[1].records[0].cells.name);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("an active table form appends one record without reading the current table snapshot", async () => {
  const installation = await seededInstallation();
  try {
    const { db, memos } = installation;
    const migration = new SharedTableMigration(db);
    let status = await migration.start();
    while (status.phase === "copying") status = await migration.advance();
    await migration.activate();
    const id = memos[0].id;
    const queries = [];
    const tracked = {
      prepare: (sql) => {
        queries.push(sql);
        return db.prepare(sql);
      },
      batch: (statements) => db.batch(statements),
    };
    await appendTableFormSubmission(
      tracked,
      {
        memo_id: id,
        workspace_id: workspace,
        created_by: actor.actorId,
        fields_json: JSON.stringify([{ fieldId: "name", required: true }]),
      },
      { name: "Published form response" },
      new Map(),
    );
    expect(
      queries.some((query) =>
        /ORDER BY (?:p\.)?position|c\.content_json/.test(query),
      ),
    ).toBe(false);
    const delta = await new SharedTableStore(db).changes(workspace, id, {
      since: 1,
    });
    expect(delta.changes).toMatchObject([
      { deleted: false, cells: { name: "Published form response", files: [] } },
    ]);
    const current = parseTableDocument(
      (await getMemoDetail(db, workspace, id)).contentMarkdown,
    );
    expect(current.records).toHaveLength(records.length + 1);
    expect(current.records.at(-1).id).toBe(delta.changes[0].id);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("legacy sync and the default backup entry read current shared records and revision snapshots", async () => {
  const installation = await seededInstallation();
  try {
    const { db } = installation;
    const migration = new SharedTableMigration(db);
    let status = await migration.start();
    while (status.phase === "copying") status = await migration.advance();
    await migration.activate();
    const created = await createMemoRecord(
      db,
      workspace,
      {
        notebookId: "nb_inbox",
        contentMarkdown: serializeTableDocument(tables[1]),
      },
      actor,
      "test",
    );
    const changed = parseTableDocument(created.contentMarkdown);
    changed.records[0].cells.name = "Visible in sync and backup";
    await updateMemoRecord(
      db,
      workspace,
      created.id,
      {
        expectedRevision: created.revision,
        contentMarkdown: serializeTableDocument(changed),
      },
      actor,
      "test",
    );
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("auth", {
        kind: "user",
        actorId: actor.actorId,
        workspaceId: workspace,
        role: "owner",
      });
      await next();
    });
    const common = {
      clampNumber: (n, min, max) =>
        Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min,
      mapMemoDetail,
    };
    registerSyncRoutes(app, common);
    registerSharedTableRoutes(app);
    registerBackupRoutes(app, { ...common, getMemoDetail });
    const get = async (url) => {
      const response = await app.request(url, undefined, { storage: { db } });
      expect(response.status).toBe(200);
      return response.json();
    };
    const deltaResponse = await app.request(
      `/api/v1/memos/${created.id}/table/changes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since: 1 }),
      },
      { storage: { db } },
    );
    expect(deltaResponse.status).toBe(200);
    expect((await deltaResponse.json()).changes).toMatchObject([
      { id: changed.records[0].id, cells: changed.records[0].cells },
    ]);
    const snapshot = await get("/api/v1/sync/bootstrap?limit=20");
    expect(
      parseTableDocument(
        snapshot.memos.find((memo) => memo.id === created.id).contentMarkdown,
      ).records,
    ).toEqual(changed.records);
    const sync = await get("/api/v1/sync/changes?cursor=0&limit=50");
    expect(
      parseTableDocument(
        sync.changes.find((change) => change.entityId === created.id).memo
          .contentMarkdown,
      ).records,
    ).toEqual(changed.records);
    const { identity, backupRevision } = await get("/api/v1/backups/state");
    const backup = await get(
      `/api/v1/backups/data?kind=memos&limit=25&identity=${encodeURIComponent(identity)}&revision=${backupRevision}`,
    );
    expect(
      parseTableDocument(
        backup.memos.find((memo) => memo.id === created.id).contentMarkdown,
      ).records,
    ).toEqual(changed.records);
    expect(
      parseTableDocument(
        backup.revisions.find((revision) => revision.memoId === created.id)
          .contentMarkdown,
      ).records,
    ).toEqual(tables[1].records);
    const exportedMemo = backup.memos.find((memo) => memo.id === created.id);
    const exportedRevisions = backup.revisions.filter(
      (revision) => revision.memoId === created.id,
    );
    const newRecords = { ...changed, records: changed.records.slice(0, 1) };
    const beforeRestore = await getMemoDetail(db, workspace, created.id);
    await updateMemoRecord(
      db,
      workspace,
      created.id,
      {
        expectedRevision: beforeRestore.revision,
        contentMarkdown: serializeTableDocument(newRecords),
      },
      actor,
      "test",
    );
    await restoreJsonMemos(db, workspace, [
      { memo: exportedMemo, revisions: exportedRevisions },
    ]);
    expect(
      parseTableDocument(
        (await getMemoDetail(db, workspace, created.id)).contentMarkdown,
      ).records,
    ).toEqual(changed.records);
    expect(
      parseTableDocument(
        (
          await listMemoRevisions(db, workspace, created.id, 10, getMemoDetail)
        )[0].contentMarkdown,
      ).records,
    ).toEqual(tables[1].records);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});


test("bound row writes replay a lost response and reject stale drafts without changing the successor", async () => {
  const installation = await seededInstallation();
  try {
    const { db, memos } = installation;
    const migration = new SharedTableMigration(db);
    let phase = await migration.start();
    while (phase.phase === "copying") phase = await migration.advance();
    await migration.activate();
    const app = new Hono();
    const auth = { ...actor, kind: "user", workspaceId: workspace, scopes: [], role: "owner" };
    app.use("*", async (c, next) => { c.set("auth", auth); await next(); });
    app.onError((error, c) => c.json({ error: { code: error.code } }, error.status ?? 500));
    registerSharedTableRoutes(app);
    const id = memos[0].id;
    const getSession = () => createMemoEditSession({ get: () => auth, env: { storage: { db } } }, id);
    const session = await getSession();
    const base = { expectedRevision: session.baseRevision, expectedContentHash: session.baseContentHash };
    const command = { ...base, mutationId: "first-row-edit", puts: [{ ...records[1], cells: { ...records[1].cells, name: "Original receipt" } }], deletes: [] };
    const send = async (input, binding = session) => {
      const res = await app.request(`/api/v1/memos/${id}/table/records`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, editSessionId: binding.id }),
      }, { storage: { db } });
      return { status: res.status, body: await res.json() };
    };
    const [first, concurrent] = await Promise.all([send(command), send(command)]);
    expect(first.status).toBe(200);
    expect(concurrent).toEqual(first);
    const current = await getSession();
    expect((await send({ ...command, expectedRevision: current.baseRevision, expectedContentHash: current.baseContentHash,
      mutationId: "delete-row", puts: [], deletes: [records[2].id] }, current)).status).toBe(200);
    expect(await send(command, await getSession())).toEqual(first);
    expect((await send({ ...command, mutationId: "stale-draft" })).status).toBe(409);
    expect((await send({ ...command, puts: [], deletes: [records[1].id] })).status).toBe(409);
    expect((await new SharedTableStore(db).changes(workspace, id, { since: 1 })).changes.map(({ id, deleted }) => ({ id, deleted })))
      .toEqual([{ id: records[1].id, deleted: false }, { id: records[2].id, deleted: true }]);
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

test("the owner can estimate and advance migration while a budget pause preserves the checkpoint", async () => {
  const installation = await seededInstallation();
  try {
    const { db } = installation;
    const app = new Hono();
    let role = "member";
    app.use("*", async (c, next) => { c.set("auth", { ...actor, kind: "user", workspaceId: workspace, role }); await next(); });
    app.onError((error, c) => c.json({ error: { code: error.code } }, error.status ?? 500));
    registerSharedTableRoutes(app);
    const send = async (payload) => {
      const response = await app.request("/api/v1/admin/table-storage", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }, { storage: { db } });
      return { status: response.status, data: await response.json() };
    };
    const budget = { readRows: 100000, writeRows: 100000, extraBytes: 10000000 };
    expect((await send({ action: "estimate" })).status).toBe(403);
    role = "owner";
    const estimate = await send({ action: "estimate" });
    expect(estimate.data.estimate).toMatchObject({ tables: 2, records: 119, next: null });
    expect((await send({ action: "activate" })).status).toBe(409);
    const started = (await send({ action: "start", backupConfirmed: true })).data.progress;
    expect(started.phase).toBe("copying");
    const noReadAllowance = await send({ action: "advance", budget: { ...budget, readRows: 0 } });
    expect(noReadAllowance.data).toMatchObject({ paused: true, progress: started });
    const scan = await send({ action: "advance", budget });
    expect(scan.data.progress.rowsCopied).toBe(0);
    const paused = await send({ action: "advance", budget: { ...budget, writeRows: 1 } });
    expect(paused.data).toMatchObject({ paused: true, progress: scan.data.progress });
    const resumed = await send({ action: "advance", budget });
    expect(resumed.data.progress.rowsCopied).toBeGreaterThan(0);
    const aborting = (await send({ action: "abort" })).data.progress;
    expect(aborting.phase).toBe("rolling_back");
    const abortPaused = await send({ action: "advance", budget: { ...budget, writeRows: 1 } });
    expect(abortPaused.data).toMatchObject({ paused: true, progress: aborting });
  } finally {
    installation.sqlite.close();
    installation.cleanup();
  }
});

const meterD1 = (database) => {
  const samples = [];
  const capture = (result) => {
    samples.push(result.meta);
    return result;
  };
  const wrap = (raw) => ({
    raw,
    bind: (...values) => wrap(raw.bind(...values)),
    all: async () => capture(await raw.all()),
    run: async () => capture(await raw.run()),
    first: async (column) => {
      const row = capture(await raw.all()).results[0] ?? null;
      return column === undefined ? row : row?.[column] ?? null;
    },
  });
  return {
    db: {
      prepare: (sql) => wrap(database.prepare(sql)),
      batch: async (statements) => (await database.batch(statements.map(({ raw }) => raw))).map(capture),
    },
    report: () => ({
      readRows: samples.reduce((sum, meta) => sum + meta.rows_read, 0),
      writeRows: samples.reduce((sum, meta) => sum + meta.rows_written, 0),
      maxBytes: Math.max(0, ...samples.map((meta) => meta.size_after)),
    }),
    reset: () => samples.splice(0),
  };
};

test("local D1 meters cumulative migration, saved-view pages, deltas and backups as rows and history grow", async () => {
  const { createRequire } = await import("node:module");
  const requireWrangler = createRequire(new URL("../../../packages/wrangler/package.json", import.meta.url));
  const wrangler = requireWrangler.resolve("edgeever-wrangler-cli");
  const { unstable_splitSqlQuery } = await import(wrangler);
  const { Miniflare } = createRequire(wrangler)("miniflare");
  const miniflare = new Miniflare({ modules: true, script: "export default {};", compatibilityDate: "2026-07-14",
    d1Databases: { SMALL: "table-budget-small", LARGE: "table-budget-large" } });
  const results = [];
  try {
    for (const [binding, count] of [["SMALL", 250], ["LARGE", 500]]) {
      const database = await miniflare.getD1Database(binding);
      for (const file of globSync("migrations/*.sql").sort()) {
        await database.batch(unstable_splitSqlQuery(readFileSync(file, "utf8")).map((sql) => database.prepare(sql)));
      }
      const { db, report, reset } = meterD1(database);
      const schema = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: `Field ${i}`, type: i === 0 ? "number" : "text" }));
      const view = { id: "numeric", name: "Numeric", match: "all", filters: [{ fieldId: "f0", operator: "gte", value: count / 4 }], sorts: [{ fieldId: "f0", direction: "asc" }] };
      const table = { schemaVersion: 2, fields: schema, views: [view], records: Array.from({ length: count }, (_, i) => ({
        id: `record_${i}`, cells: Object.fromEntries(schema.map(({ id }, f) => [id, f ? `Row ${i} value ${f}` : i])),
      })) };
      const { id } = await seedLegacyMemo(db, table, `budget_${count}`);
      const sizeBefore = report().maxBytes;
      const migration = new SharedTableMigration(db);
      const estimate = await migration.estimate();
      reset();
      let state = await migration.start();
      while (state.phase === "copying") state = await migration.advance();
      await migration.activate();
      const migrationCost = report();
      expect(migrationCost.readRows).toBeLessThanOrEqual(estimate.readRows);
      expect(migrationCost.writeRows).toBeLessThanOrEqual(estimate.writeRows);
      expect(migrationCost.maxBytes - sizeBefore).toBeLessThanOrEqual(estimate.extraBytes);
      const store = new SharedTableStore(db);
      reset();
      let cursor;
      let returned = 0;
      let pages = 0;
      do {
        const page = await store.query(workspace, id, { view, ...(cursor ? { cursor } : {}), includeTotal: true });
        returned += page.records.length;
        cursor = page.next;
        pages++;
      } while (cursor);
      expect(returned).toBe(count - Math.ceil(count / 4));
      const paginationReads = report().readRows;
      reset();
      await store.snapshot(workspace, id);
      const snapshotReads = report().readRows;
      for (let i = 0; i < 8; i++) {
        const memo = await getMemoDetail(db, workspace, id);
        const document = parseTableDocument(memo.contentMarkdown);
        document.records[0].cells.f1 = `Edition ${i}`;
        const edited = await updateMemoRecord(db, workspace, id, {
          expectedRevision: memo.revision, contentMarkdown: serializeTableDocument(document),
          updatedAt: new Date(Date.UTC(2026, 10, 28, 0, i * 6)).toISOString(),
        }, actor, "test");
        expect(edited.memo).toBeTruthy();
      }
      reset();
      await store.snapshot(workspace, id);
      expect(report().readRows).toBe(snapshotReads);
      reset();
      const delta = await store.changes(workspace, id, { since: 8 });
      expect(delta.changes).toHaveLength(1);
      const deltaReads = report().readRows;
      reset();
      const app = new Hono();
      app.use("*", async (c, next) => { c.set("auth", { ...actor, kind: "user", workspaceId: workspace, role: "owner" }); await next(); });
      registerBackupRoutes(app, { clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)), mapMemoDetail, getMemoDetail });
      const env = { storage: { db } };
      const backupState = await (await app.request("/api/v1/backups/state", {}, env)).json();
      const response = await app.request(`/api/v1/backups/data?kind=memos&limit=1&identity=${encodeURIComponent(backupState.identity)}&revision=${backupState.backupRevision}`, {}, env);
      expect(response.status).toBe(200);
      const backup = await response.json();
      expect(backup.revisions).toHaveLength(8);
      const backupReads = report().readRows;
      const historical = backup.revisions.find(({ revision }) => revision === 4);
      expect(historical).toBeDefined();
      reset();
      const historicalMemo = await getMemoRevisionRow(db, workspace, id, historical.id);
      expect(parseTableDocument(historicalMemo.content_markdown).records[0].cells.f1).toBe("Edition 3");
      const historyReads = report().readRows;
      reset();
      const restored = await restoreMemoRevision(db, workspace, id, historical.id, actor, "test", { getMemoDetail, getMemoDetailRow, updateMemoRecord });
      expect(parseTableDocument(restored.contentMarkdown).records[0].cells.f1).toBe("Edition 3");
      const restoreCost = report();
      results.push({ count, pages, migrationReads: migrationCost.readRows, migrationWrites: migrationCost.writeRows,
        extraBytes: migrationCost.maxBytes - sizeBefore, paginationReads, snapshotReads, deltaReads, backupReads,
        historyReads, restoreReads: restoreCost.readRows, restoreWrites: restoreCost.writeRows });

      if (count === 250) {
        const one = await createMemoRecord(db, workspace, {
          notebookId: "nb_inbox", contentMarkdown: serializeTableDocument({ ...table, records: table.records.slice(0, 1) }),
        }, actor, "test");
        const snapshots = [];
        for (let revision = 1; revision <= 80; revision++) {
          await store.apply(workspace, one.id, { expectedRevision: revision, puts: [{ id: "record_0", cells: { f0: revision } }] });
          snapshots.push({ id: one.id, shared_table_revision: revision + 1, content_markdown: "", content_json: "", content_text: "" });
        }
        const historyCosts = [];
        for (const length of [20, 40, 80]) {
          reset();
          const archive = await hydrateSharedMemoRows(db, workspace, snapshots.slice(0, length), true);
          expect(archive.map(({ content_markdown }) => parseTableDocument(content_markdown).records[0].cells.f0)).toEqual(Array.from({ length }, (_, index) => index + 1));
          historyCosts.push(report().readRows);
        }
        console.log("Shared table archive reads at 20, 40 and 80 revisions", historyCosts);
        expect(historyCosts[2]).toBeLessThan(historyCosts[1] * 2.5);
        expect(historyCosts[2]).toBeLessThan(2_000);
      }
    }
    console.log("Shared table D1 metrics", JSON.stringify(results));
    expect(results[1].paginationReads).toBeLessThan(results[0].paginationReads * 2.5);
    expect(results[1].deltaReads).toBe(results[0].deltaReads);
    expect(results[1].backupReads).toBeLessThan(results[0].backupReads * 2.5);
  } finally {
    await miniflare.dispose();
  }
}, 30_000);

test("the default ZIP pipeline exports and atomically restores table histories larger than a D1 query result", async () => {
  console.time("Chunked backup fixture");
  const { createRequire } = await import("node:module");
  const requireWrangler = createRequire(new URL("../../../packages/wrangler/package.json", import.meta.url));
  const wrangler = requireWrangler.resolve("edgeever-wrangler-cli");
  const { unstable_splitSqlQuery } = await import(wrangler);
  const { Miniflare } = createRequire(wrangler)("miniflare");
  const worker = new Miniflare({
    modules: true, script: "export default {};", compatibilityDate: "2026-07-14",
    d1Databases: { SOURCE: "backup-archive-source", TARGET: "backup-archive-target" },
  });
  const databases = {};
  try {
    for (const binding of ["SOURCE", "TARGET"]) {
      const raw = await worker.getD1Database(binding);
      for (const file of globSync("migrations/*.sql").sort()) {
        await raw.batch(unstable_splitSqlQuery(readFileSync(file, "utf8")).map((sql) => raw.prepare(sql)));
      }
      const metered = meterD1(raw);
      const { db } = metered;
      const migrator = new SharedTableMigration(db);
      await migrator.start();
      while ((await migrator.advance()).phase === "copying") {}
      await migrator.activate();
      const app = new Hono();
      app.use("*", async (c, next) => { c.set("auth", { ...actor, kind: "user", workspaceId: workspace, role: "owner" }); await next(); });
      app.onError((error, c) => c.json({ error: { code: error.code, message: error.message } }, error.status ?? 500));
      registerBackupRoutes(app, {
        clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)), mapMemoDetail, getMemoDetail,
        restoreJsonMemos, restoreJsonNotebooks,
      });
      const transport = { responses: 0, maxResponse: 0, maxRequest: 0, maxCurrentRequest: 0, rowChunks: 0, archiveCellBytes: 0 };
      const archivedPages = new Set();
      const client = createEdgeEverClient({
        baseUrl: "https://backup.local",
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (typeof init?.body === "string") {
            const size = Buffer.byteLength(init.body);
            transport.maxRequest = Math.max(transport.maxRequest, size);
            const payload = JSON.parse(init.body);
            if (payload.action === "rows" && payload.ordinal === 6) {
              transport.maxCurrentRequest = Math.max(transport.maxCurrentRequest, size);
            }
          }
          const response = await app.fetch(request, { storage: { db } });
          const text = await response.text();
          transport.responses++;
          transport.maxResponse = Math.max(transport.maxResponse, Buffer.byteLength(text));
          if (new URL(request.url).searchParams.get("kind") === "table" && response.ok) {
            if (!archivedPages.has(request.url)) {
              archivedPages.add(request.url);
              transport.rowChunks++;
              transport.archiveCellBytes += JSON.parse(text).rows.reduce((total, row) => total + Buffer.byteLength(JSON.stringify(row.cells)), 0);
            }
          }
          return new Response(text, { status: response.status, headers: response.headers });
        },
      });
      databases[binding] = { ...metered, client, transport };
    }
    const source = databases.SOURCE;
    const target = databases.TARGET;
    const longFields = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: `Field ${i}`, type: "text" }));
    const schema = [...longFields, { id: "file", name: "File", type: "attachment" }];
    const file = { resourceId: "archive-attachment", filename: "local.txt", mimeType: "text/plain", byteSize: 4 };
    const table = {
      schemaVersion: 2, fields: schema, views: [{ id: "all", name: "All", match: "all", filters: [], sorts: [] }],
      records: Array.from({ length: 500 }, (_, row) => ({
        // Both the 25-row snapshot cursor and the 256-change cursor land on an isolated surrogate.
        id: row < 24 ? `large-row-${row}` : row === 24 ? "\ud800"
          : row < 255 ? `\ud800-${row}` : row === 255 ? "\ud801" : `\uffff-${row}`,
        cells: { ...Object.fromEntries(longFields.map(({ id }) => [id, `${row} ${id} ` + "abcde".repeat(398)])), file: row === 0 ? [file] : [] },
      })),
    };
    const memo = await createMemoRecord(source.db, workspace, {
      notebookId: "nb_inbox", title: "Wide synthetic table", contentMarkdown: serializeTableDocument(table),
    }, actor, "test");
    await source.db.prepare(`INSERT INTO resources(id,memo_id,bucket_name,object_key,kind,mime_type,filename,byte_size)
      VALUES(?,?, 'edgeever-resources','fixture-object','attachment','text/plain','local.txt',4)`).bind(file.resourceId, memo.id).run();
    // A long-lived table can have many snapshot references to mostly unchanged rows.
    // Give each historical revision its own commit and a distinct value in the first row.
    for (let revision = 1; revision <= 7; revision++) {
      if (revision > 1) {
        const edited = { ...table.records[0], cells: { ...table.records[0].cells, f0: `Version ${revision} ` + "abcde".repeat(398) } };
        const row = recordProjection(table, edited);
        await source.db.batch([
          source.db.prepare(`INSERT INTO ee_table_commits(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json)
            SELECT workspace_id,table_id,?,schema_revision,row_count,max_position,header_json FROM ee_table_heads WHERE table_id = ?`).bind(revision, memo.id),
          source.db.prepare(`INSERT INTO ee_table_versions(workspace_id,table_id,record_id,revision,position,deleted,cells_json)
            VALUES(?,?,?,?,1,0,?)`).bind(workspace, memo.id, edited.id, revision, row.cells),
          source.db.prepare("UPDATE ee_table_records SET cells_json=?, normalized_json=?, search_text=? WHERE workspace_id=? AND table_id=? AND position=1")
            .bind(row.cells, row.normalized, row.search, workspace, memo.id),
        ]);
      }
      if (revision <= 6) {
        await source.db.prepare(`INSERT INTO memo_revisions(id,memo_id,revision,title,content_json,content_markdown,content_hash,created_by,shared_table_revision)
          VALUES(?,?,?,'History','{"type":"doc","content":[]}', '', 'historic','user',?)`).bind(`history-${revision}`, memo.id, revision, revision).run();
      }
    }
    await source.db.batch([
      source.db.prepare("UPDATE ee_table_heads SET revision=7 WHERE table_id=?").bind(memo.id),
      source.db.prepare("UPDATE memo_contents SET revision=7, shared_table_revision=7 WHERE memo_id=?").bind(memo.id),
    ]);
    const state = await source.client.getJsonBackupState();
    expect(state.tableChunks).toBe(true);
    const snapshotReads = { current: 0, historical: 0 };
    const changePageReads = [];
    const read = async (query) => {
      if (query.kind === "tableChanges") {
        const before = source.report().readRows;
        const page = await source.client.getJsonBackupData(state, query);
        changePageReads.push(source.report().readRows - before);
        return page;
      }
      if (query.kind === "table") snapshotReads[query.revisionId ? "historical" : "current"]++;
      return source.client.getJsonBackupData(state, query);
    };
    const exportSource = {
      listNotebooks: () => read({ kind: "notebooks" }),
      listPrompts: () => read({ kind: "prompts" }),
      getPage: async (offset, _limit, cursor) => {
        const page = await read({ kind: "memos", tableChunks: "1", after: cursor ?? "" });
        return { ...page, tableChunks: true, totalCount: state.counts.memos, nextOffset: page.nextCursor == null ? null : offset + page.memos.length };
      },
      readRevisions: (memoId, after) => read({ kind: "revisions", memoId, after }),
      ...createBackupTableReaders(read),
      verifyVersion: () => read({ kind: "check" }),
      getResourceResponse: async () => new Response("test"),
    };
    source.reset();
    console.timeEnd("Chunked backup fixture");
    console.time("Chunked backup export");
    const zipped = await createEdgeEverZip(exportSource, { edgeeverVersion: "2.31.2", buildId: "chunk-backup-test" });
    console.timeEnd("Chunked backup export");
    console.time("Chunked backup ZIP verification");
    const exported = source.report();
    const parsed = await parseEdgeEverZip(zipped);
    expect(parsed.manifest.formatVersion).toBe(3);
    expect(parsed.manifest.counts.revisions).toBe(6);
    expect(parsed.tableSnapshots.get(memo.id).map((snapshot) => [snapshot.rowCount, snapshot.rowPaths.length])).toEqual(Array.from({ length: 7 }, () => [500, 20]));
    expect(source.transport.archiveCellBytes).toBeGreaterThan(60_000_000);
    expect(source.transport.maxResponse).toBeLessThan(1_000_000);
    expect(source.transport.rowChunks).toBe(140);
    expect(snapshotReads).toEqual({ current: 40, historical: 120 });
    expect(changePageReads).toHaveLength(2);
    expect(Math.max(...changePageReads)).toBeLessThan(280);
    expect(exported.readRows).toBeLessThan(25_000);
    const markdown = [];
    await streamZipEntries(zipped, ({ name }) => name.endsWith("/Wide synthetic table.md") ? {
      write: (chunk) => { markdown.push(Buffer.from(chunk)); },
    } : undefined);
    const readable = Buffer.concat(markdown).toString();
    expect(readable).toContain("| Field 0 | Field 1");
    expect(readable).toContain("Version 7");
    expect(readable).toContain("Wide%20synthetic%20table.assets/local.txt");
    expect(readable).toContain("499 f0");
    expect(readable).not.toContain("<!-- edgeever-table-v1:");

    const importedBytes = [];
    target.reset();
    console.timeEnd("Chunked backup ZIP verification");
    console.time("Chunked backup restore");
    await restoreEdgeEverZip(parsed, {
      restoreMemos: target.client.restoreJsonMemos,
      restoreNotebooks: target.client.restoreJsonNotebooks,
      restorePrompts: async () => {},
      tableRestore: target.client.jsonTableRestore,
      createResourceRestoreSink: async (id) => {
        expect(id).toBe(file.resourceId);
        return { write: async (chunk) => importedBytes.push(Buffer.from(chunk)), close: async () => {}, abort: async () => {} };
      },
    });
    console.timeEnd("Chunked backup restore");
    console.time("Chunked backup data verification");
    const imported = target.report();
    expect(Buffer.concat(importedBytes).toString()).toBe("test");
    expect(target.transport.maxRequest).toBeLessThan(1_000_000);
    expect(target.transport.maxCurrentRequest).toBeGreaterThan(0);
    expect(target.transport.maxCurrentRequest).toBeLessThanOrEqual(263_000);
    expect((await target.db.prepare("SELECT COUNT(*) AS count FROM ee_table_restore_rows").first()).count).toBe(0);
    const restored = await getMemoDetail(target.db, workspace, memo.id);
    const document = parseTableDocument(restored.contentMarkdown);
    expect(document.records).toHaveLength(500);
    expect(document.records[0].cells.f0).toStartWith("Version 7");
    expect(document.records[0].cells.file).toEqual([file]);
    expect(document.records[24].id).toBe("\ud800");
    expect(document.records[255].id).toBe("\ud801");
    expect(document.records.at(-1)).toEqual(table.records.at(-1));
    const recovered = await getMemoRevisionRow(target.db, workspace, memo.id, "history-5");
    expect(parseTableDocument(recovered.content_markdown).records[0].cells.f0).toStartWith("Version 5");
    const persisted = await target.db.prepare("SELECT count(*) AS count FROM ee_table_versions WHERE workspace_id = ? AND table_id = ?").bind(workspace, memo.id).first();
    expect(persisted.count).toBe(506);
    expect(imported.readRows).toBeLessThan(50_000);
    expect(imported.maxBytes).toBeLessThan(100_000_000);
    console.timeEnd("Chunked backup data verification");
    console.log("Chunked backup D1 measurements", JSON.stringify({ export: source.transport, import: target.transport, reads: exported.readRows, changePageReads, restoreReadRows: imported.readRows, restoreWriteRows: imported.writeRows, restorePeakBytes: imported.maxBytes }));
  } finally {
    await worker.dispose();
  }
}, 300_000);

test("exporting retained single-row snapshots with a replacement ID at every revision scales with history length", async () => {
  const { createRequire } = await import("node:module");
  const wrangler = createRequire(new URL("../../../packages/wrangler/package.json", import.meta.url)).resolve("edgeever-wrangler-cli");
  const { unstable_splitSqlQuery } = await import(wrangler);
  const { Miniflare } = createRequire(wrangler)("miniflare");
  const worker = new Miniflare({ modules: true, script: "export default {};", compatibilityDate: "2026-07-14", d1Databases: ["DB"] });
  try {
    const raw = await worker.getD1Database("DB");
    for (const file of globSync("migrations/*.sql").sort()) {
      await raw.batch(unstable_splitSqlQuery(readFileSync(file, "utf8")).map(sql => raw.prepare(sql)));
    }
    const { db, reset, report } = meterD1(raw);
    const row = revision => ({ id: `row-${revision}`, cells: { name: `value-${revision}` } });
    const { id } = await seedLegacyMemo(db, { ...tables[0], fields: [fields[0]], records: [row(1)] }, "churn");
    const migration = new SharedTableMigration(db);
    await migration.start();
    while ((await migration.advance()).phase === "copying") {}
    await migration.activate();
    const store = new SharedTableStore(db);
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("auth", { ...actor, kind: "user", workspaceId: workspace, role: "owner" }); await next(); });
    registerBackupRoutes(app, { clampNumber: (v, min, max) => Math.min(max, Math.max(min, v)), mapMemoDetail, getMemoDetail });
    const client = createEdgeEverClient({ baseUrl: "https://backup.local", fetch: (input, init) => app.fetch(new Request(input, init), { storage: { db } }) });
    let previous = 0;
    const costs = [];
    for (const count of [25, 50, 100, 200]) {
      for (let revision = previous + 1; revision <= count; revision++) {
        if (revision > 1) await store.apply(workspace, id, { expectedRevision: revision - 1, puts: [row(revision)], deletes: [row(revision - 1).id] });
        await db.prepare(`INSERT INTO memo_revisions(id,memo_id,revision,title,content_json,content_markdown,content_hash,created_by,shared_table_revision)
          VALUES(?,?,?,'History','{"type":"doc","content":[]}', '', 'historic','user',?)`).bind(`history-${revision}`, id, revision, revision).run();
      }
      previous = count;
      await db.prepare("UPDATE memo_contents SET shared_table_revision=?,revision=? WHERE memo_id=?").bind(count, count, id).run();
      reset();
      const version = await client.getJsonBackupState();
      let historyPages = 0;
      const read = query => {
        if (query.revisionId || query.kind === "tableChanges") historyPages++;
        return client.getJsonBackupData(version, query);
      };
      const archive = await createEdgeEverZip({
        listNotebooks: () => read({ kind: "notebooks" }), listPrompts: () => read({ kind: "prompts" }),
        getPage: async () => ({ ...await read({ kind: "memos", tableChunks: "1" }), tableChunks: true, totalCount: version.counts.memos, nextOffset: null }),
        readRevisions: (memoId, after) => read({ kind: "revisions", memoId, after }),
        ...createBackupTableReaders(read),
        verifyVersion: () => read({ kind: "check" }),
      }, { edgeeverVersion: "test", buildId: "churn" });
      costs.push({ count, historyPages, reads: report().readRows });
      const restored = Array.from({ length: count + 1 }, () => []);
      await restoreEdgeEverZip(await parseEdgeEverZip(archive), {
        restoreNotebooks: async () => {}, restorePrompts: async () => {}, restoreMemos: async () => {},
        tableRestore: {
          check: async () => {}, start: async () => {}, snapshot: async () => {}, publish: async () => {},
          rows: async (_job, ordinal, rows) => restored[ordinal].push(...rows),
        },
      });
      expect(restored).toEqual(Array.from({ length: count + 1 }, (_, index) => {
        const revision = Math.min(index + 1, count);
        return [{ ...row(revision), position: revision }];
      }));
    }
    console.log("Replacement history ZIP costs", JSON.stringify(costs));
    for (const [index, cost] of costs.entries()) {
      expect(cost.historyPages).toBeLessThanOrEqual(cost.count + 3);
      if (index) expect(cost.reads).toBeLessThan(costs[index - 1].reads * 2.3);
    }
  } finally {
    await worker.dispose();
  }
}, 180_000);
