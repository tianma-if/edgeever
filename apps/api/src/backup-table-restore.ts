import { z } from "zod";
import {
  BACKUP_TABLE_ROW_BATCH, BackupMemoDetailSchema, emptyDoc, JsonBackupRevisionSchema, normalizeTags,
  type BackupTableRestoreSnapshot, type BackupTableRestoreStart, type BackupTableRow, type MemoDetail, type TableDocument,
} from "@edgeever/shared";
import { AppError } from "./app-error";
import { auditStatement } from "./audit";
import { isoNow } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { upsertMemoSearchDocumentStatement } from "./memo-search-index";
import { indexStatements, type SharedFieldIndex } from "./shared-table-index";
import { normalizeSharedRecord, recordProjection, tableHeader } from "./shared-table-store";
import type { DatabaseAdapter } from "./storage-contract";
import { compactSharedMemo } from "./table-memo-storage";
import { tableStatement } from "./table-query-sql";

const ordinal = z.number().int().nonnegative();
const tableShape = z.object({ header: z.unknown(), rowCount: ordinal });
export const tableRestoreActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), memo: BackupMemoDetailSchema, snapshots: ordinal.positive() }),
  z.object({ action: z.literal("snapshot"), ordinal, revision: JsonBackupRevisionSchema.nullable(), table: tableShape.nullable() }),
  z.object({ action: z.literal("rows"), ordinal, rows: z.array(z.object({
    id: z.string().min(1).max(80), position: ordinal.positive(), cells: z.record(z.string(), z.unknown()),
  })).min(1).max(BACKUP_TABLE_ROW_BATCH) }),
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("cancel") }),
]);

type RestoreJob = {
  memo_id: string;
  request_hash: string;
  target_token: string | null;
  memo_json: string;
  content_json: string;
  content_markdown: string;
  content_text: string;
  snapshot_count: number;
  published: number;
};

const invalid = (message: string) => new AppError("invalid_backup", message, 400);
const changed = () => new AppError("backup_destination_changed", "The destination memo changed during restore.", 409);
const incomplete = () => new AppError("backup_restore_incomplete", "One or more table snapshots are missing records.", 409);
const unavailable = () => new AppError("backup_table_storage_inactive", "Activate shared table storage before restoring this backup.", 409);
const targetToken = `json_array(m.workspace_id, m.notebook_id, m.title, m.tags_json, m.is_pinned, m.is_archived,
  m.is_deleted, m.updated_at, c.revision, c.content_hash, h.revision)`;
const target = `FROM memos m
  LEFT JOIN memo_contents c ON c.memo_id = m.id LEFT JOIN ee_table_heads h ON h.table_id = m.id AND h.workspace_id = m.workspace_id`;
const blankBody = { content_json: JSON.stringify(emptyDoc()), content_markdown: "", content_text: "" };
const RESTORE_IDLE_MS = 24 * 60 * 60 * 1000;
const splitBody = (doc: { contentJson: unknown; contentMarkdown: string; contentText: string }) => {
  const { contentJson, contentMarkdown, contentText, ...metadata } = doc;
  return { metadata, body: { content_json: JSON.stringify(contentJson ?? emptyDoc()), content_markdown: contentMarkdown, content_text: contentText } };
};

export class ChunkedTableRestore {
  private readonly sql: ReturnType<typeof tableStatement>;

  constructor(private readonly db: DatabaseAdapter, private readonly workspace: string, private readonly id: string) {
    this.sql = tableStatement(db);
  }

  async start({ memo, snapshots }: Omit<BackupTableRestoreStart, "restoreId">) {
    if (!await this.sql`SELECT 1 FROM ee_table_activation WHERE id = 1`.first()) throw unavailable();
    const requestHash = await sha256(JSON.stringify([memo, snapshots]));
    const existing = await this.job();
    if (existing) {
      if (existing.request_hash !== requestHash) throw invalid("This restore ID already has different backup metadata.");
      return;
    }
    const destination = await this.db.prepare(`SELECT m.workspace_id, ${targetToken} AS token ${target} WHERE m.id = ?`).bind(memo.id).first<{ workspace_id: string; token: string }>();
    if (destination && destination.workspace_id !== this.workspace) throw changed();
    if (!await this.sql`SELECT 1 FROM notebooks WHERE id = ${memo.notebookId} AND workspace_id = ${this.workspace} AND is_deleted = 0`.first()) {
      throw invalid("The backup notebook is unavailable in this workspace.");
    }
    const { metadata, body } = splitBody(memo);
    const data = memo.sharedTableRevision != null ? blankBody : body;
    await this.pruneAbandonedRestore();
    await this.sql`INSERT OR IGNORE INTO ee_table_restore_jobs
      (id,workspace_id,memo_id,request_hash,target_token,memo_json,content_json,content_markdown,content_text,snapshot_count,updated_at)
      VALUES(${this.id},${this.workspace},${memo.id},${requestHash},${destination?.token ?? null},${JSON.stringify(metadata)},
        ${data.content_json},${data.content_markdown},${data.content_text},${snapshots},${isoNow()})`.run();
    if ((await this.job())?.request_hash !== requestHash) throw invalid("This restore ID already has different backup metadata.");
  }

  private job(includeBody = false) {
    return this.db.prepare(`SELECT memo_id, request_hash, target_token, memo_json, snapshot_count, published
      ${includeBody ? ", content_json, content_markdown, content_text" : ""}
      FROM ee_table_restore_jobs WHERE id = ? AND workspace_id = ?`).bind(this.id, this.workspace).first<RestoreJob>();
  }

  private async requireJob(includeBody = false) {
    const job = await this.job(includeBody);
    if (!job) throw new AppError("not_found", "Table restore not found.", 404);
    return job;
  }

  private stagingGuard() {
    return this.sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
      SELECT 1 FROM ee_table_restore_jobs WHERE id = ${this.id} AND workspace_id = ${this.workspace} AND published = 0)`;
  }

  private touch() {
    return this.sql`UPDATE ee_table_restore_jobs SET updated_at = ${isoNow()} WHERE id = ${this.id} AND workspace_id = ${this.workspace}`;
  }

  private async pruneAbandonedRestore() {
    const cutoff = new Date(Date.now() - RESTORE_IDLE_MS).toISOString();
    const stale = await this.sql`SELECT id FROM ee_table_restore_jobs WHERE workspace_id = ${this.workspace} AND updated_at <= ${cutoff}
      ORDER BY updated_at LIMIT 1`.first<{ id: string }>();
    if (!stale) return;
    // Bound a later restore's cleanup work even if the abandoned archive had many revisions.
    await this.db.batch([
      this.sql`DELETE FROM ee_table_restore_rows WHERE (job_id,ordinal,position) IN (
        SELECT r.job_id,r.ordinal,r.position FROM ee_table_restore_rows r JOIN ee_table_restore_jobs j ON j.id = r.job_id
        WHERE j.id = ${stale.id} AND j.updated_at <= ${cutoff} ORDER BY r.ordinal,r.position LIMIT 250)`,
      this.sql`DELETE FROM ee_table_restore_values WHERE (job_id,value_hash) IN (
        SELECT v.job_id,v.value_hash FROM ee_table_restore_values v JOIN ee_table_restore_jobs j ON j.id = v.job_id
        WHERE j.id = ${stale.id} AND j.updated_at <= ${cutoff} AND NOT EXISTS (
          SELECT 1 FROM ee_table_restore_rows r WHERE r.job_id = v.job_id AND r.value_hash = v.value_hash
        ) ORDER BY v.value_hash LIMIT 250)`,
      this.sql`DELETE FROM ee_table_restore_jobs WHERE id = ${stale.id} AND updated_at <= ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM ee_table_restore_rows WHERE job_id = ${stale.id})
        AND NOT EXISTS (SELECT 1 FROM ee_table_restore_values WHERE job_id = ${stale.id})`,
    ]);
  }

  async snapshot(input: BackupTableRestoreSnapshot) {
    const job = await this.requireJob();
    if (job.published) return;
    const { ordinal, revision, table } = input;
    const current = ordinal === job.snapshot_count - 1;
    const memo = JSON.parse(job.memo_json) as MemoDetail;
    if (ordinal >= job.snapshot_count || current !== (revision === null) || (revision && revision.memoId !== job.memo_id) ||
        Boolean(table) !== ((revision ?? memo).sharedTableRevision != null)) throw invalid("A backup snapshot does not match its memo.");
    const header = table ? tableHeader(table.header) : null;
    const headerJson = header ? JSON.stringify(header) : null;
    const detached = revision ? splitBody(revision) : null;
    const revisionJson = JSON.stringify(detached?.metadata ?? {});
    const body = !header && detached ? detached.body : blankBody;
    const count = table?.rowCount ?? 0;
    await this.db.batch([
      this.stagingGuard(),
      this.sql`INSERT OR IGNORE INTO ee_table_restore_snapshots
        (job_id,ordinal,revision_id,revision_json,header_json,row_count,content_json,content_markdown,content_text)
        VALUES(${this.id},${ordinal},${revision?.id ?? null},${revisionJson},${headerJson},${count},${body.content_json},${body.content_markdown},${body.content_text})`,
      this.sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
        SELECT 1 FROM ee_table_restore_snapshots WHERE job_id = ${this.id} AND ordinal = ${ordinal}
          AND revision_id IS ${revision?.id ?? null} AND revision_json = ${revisionJson} AND header_json IS ${headerJson}
          AND row_count = ${count} AND content_json = ${body.content_json} AND content_markdown = ${body.content_markdown} AND content_text = ${body.content_text})`,
      this.touch(),
    ]);
  }

  async rows(ordinal: number, rows: BackupTableRow[]) {
    const job = await this.requireJob();
    if (job.published) return;
    const snapshot = await this.sql`SELECT header_json, row_count FROM ee_table_restore_snapshots
      WHERE job_id = ${this.id} AND ordinal = ${ordinal}`.first<{ header_json: string | null; row_count: number }>();
    if (!snapshot?.header_json || rows.length > snapshot.row_count) throw invalid("Rows do not match an announced table snapshot.");
    const header = JSON.parse(snapshot.header_json) as TableDocument;
    const current = ordinal === job.snapshot_count - 1;
    const prepared = await Promise.all(rows.map(async (row) => {
      const record = normalizeSharedRecord(header, row);
      const stored = current ? recordProjection(header, record) : { cells: JSON.stringify(record.cells), normalized: "{}", search: "" };
      return { ...stored, id: row.id, position: row.position, hash: await sha256(stored.cells) };
    }));
    await this.db.batch([
      this.stagingGuard(),
      ...prepared.flatMap((row) => [
        this.sql`INSERT OR IGNORE INTO ee_table_restore_values(job_id,value_hash,cells_json) VALUES(${this.id},${row.hash},${row.cells})`,
        this.sql`INSERT OR IGNORE INTO ee_table_restore_rows(job_id,ordinal,position,record_id,cells_json,normalized_json,search_text,value_hash)
          VALUES(${this.id},${ordinal},${row.position},${row.id},'{}',${row.normalized},${row.search},${row.hash})`,
        this.sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
          SELECT 1 FROM ee_table_restore_rows WHERE job_id = ${this.id} AND ordinal = ${ordinal} AND position = ${row.position}
            AND record_id = ${row.id} AND coalesce(value_hash = ${row.hash}, cells_json = ${row.cells}))`,
      ]),
      this.touch(),
    ]);
  }

  async cancel() {
    await this.sql`DELETE FROM ee_table_restore_jobs WHERE id = ${this.id} AND workspace_id = ${this.workspace} AND published = 0`.run();
  }

  async publish() {
    const job = await this.requireJob(true);
    if (job.published) return;
    const { sql, id, workspace } = this;
    const memoId = job.memo_id;
    const memo = JSON.parse(job.memo_json) as MemoDetail;
    const completeSql = `(SELECT count(*) FROM ee_table_restore_snapshots WHERE job_id = ?1) = ?2
      AND NOT EXISTS (SELECT 1 FROM ee_table_restore_snapshots s WHERE s.job_id = ?1 AND s.row_count <> (
        SELECT count(*) FROM ee_table_restore_rows r WHERE r.job_id = s.job_id AND r.ordinal = s.ordinal))`;
    const complete = () => this.db.prepare(`SELECT (${completeSql}) AS ok`).bind(id, job.snapshot_count).first<{ ok: number }>();
    if (!(await complete())?.ok) throw incomplete();
    const currentTarget = () => this.db.prepare(`SELECT ${targetToken} AS token ${target} WHERE m.id = ?`).bind(memoId).first<{ token: string }>();
    if (((await currentTarget())?.token ?? null) !== job.target_token) throw changed();
    const latest = await sql`SELECT ordinal,header_json,row_count FROM ee_table_restore_snapshots
      WHERE job_id = ${id} AND header_json IS NOT NULL ORDER BY ordinal DESC LIMIT 1`.first<{ ordinal: number; header_json: string; row_count: number }>();
    if (!latest) throw invalid("The archive has no table snapshots.");
    const active = await sql`SELECT run_id FROM ee_table_activation WHERE id = 1`.first<{ run_id: string }>();
    if (!active) throw unavailable();
    const previous = await sql`SELECT revision,schema_revision,indexes_json FROM ee_table_heads WHERE table_id = ${memoId} AND workspace_id = ${workspace}`
      .first<{ revision: number; schema_revision: number; indexes_json: string }>();
    const base = previous?.revision ?? 0;
    const schemaBase = previous?.schema_revision ?? 0;
    const latestRevision = base + latest.ordinal + 1;
    const header = JSON.parse(latest.header_json) as TableDocument;
    const currentIsTable = latest.ordinal === job.snapshot_count - 1;
    const stored = currentIsTable ? compactSharedMemo(header) : job;
    const reference = currentIsTable ? latestRevision : null;
    const indexes = indexStatements(this.db, workspace, memoId, currentIsTable ? header : { ...header, fields: [] }, JSON.parse(previous?.indexes_json ?? "[]") as SharedFieldIndex[]);
    const now = isoNow();

    try {
      await this.db.batch([
        this.stagingGuard(),
        this.db.prepare(`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT (${completeSql})`).bind(id, job.snapshot_count),
        sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM notebooks WHERE id = ${memo.notebookId} AND workspace_id = ${workspace} AND is_deleted = 0)`,
        this.db.prepare(`INSERT INTO ee_table_assertion SELECT 0 WHERE (SELECT ${targetToken} ${target} WHERE m.id = ?) IS NOT ?`)
          .bind(memoId, job.target_token),
        sql`INSERT INTO ee_table_assertion SELECT 0 FROM ee_table_restore_snapshots s JOIN memo_revisions r ON r.id = s.revision_id
          WHERE s.job_id = ${id} AND r.memo_id <> ${memoId} LIMIT 1`,
        sql`INSERT INTO memos(id,workspace_id,notebook_id,title,excerpt,tags_json,is_pinned,is_archived,is_deleted,source_memo_ids,merge_source_count,
          created_by,updated_by,created_at,updated_at) VALUES(${memoId},${workspace},${memo.notebookId},${memo.title},${memo.excerpt},
          ${JSON.stringify(normalizeTags(memo.tags))},${Number(memo.isPinned)},${Number(memo.isArchived)},0,${JSON.stringify(memo.sourceMemoIds)},
          ${memo.mergeSourceCount},'restore','restore',${memo.createdAt},${memo.updatedAt})
          ON CONFLICT(id) DO UPDATE SET notebook_id = excluded.notebook_id,title = excluded.title,excerpt = excluded.excerpt,
            tags_json = excluded.tags_json,is_pinned = excluded.is_pinned,is_archived = excluded.is_archived,is_deleted = 0,deleted_at = NULL,
            source_memo_ids = excluded.source_memo_ids,merge_source_count = excluded.merge_source_count,merged_into_memo_id = NULL,
            updated_by = 'restore',updated_at = excluded.updated_at`,
        sql`INSERT INTO ee_table_heads(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json,indexes_json,migration_run_id)
          SELECT ${workspace},${memoId},${latestRevision},${schemaBase + latest.ordinal + 1},${latest.row_count},COALESCE(MAX(position),0),
            ${latest.header_json},${JSON.stringify(indexes.next)},${active.run_id} FROM ee_table_restore_rows WHERE job_id = ${id} AND ordinal = ${latest.ordinal}
          ON CONFLICT(workspace_id,table_id) DO UPDATE SET revision = excluded.revision,schema_revision = excluded.schema_revision,
            row_count = excluded.row_count,max_position = excluded.max_position,header_json = excluded.header_json,indexes_json = excluded.indexes_json,
            migration_run_id = excluded.migration_run_id`,
        sql`INSERT INTO ee_table_commits(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json)
          SELECT ${workspace},${memoId},${base} + s.ordinal + 1,${schemaBase} + s.ordinal + 1,s.row_count,
            COALESCE((SELECT MAX(position) FROM ee_table_restore_rows r WHERE r.job_id = s.job_id AND r.ordinal = s.ordinal),0),s.header_json
          FROM ee_table_restore_snapshots s WHERE s.job_id = ${id} AND s.header_json IS NOT NULL`,
        // Drive the record joins by snapshot ordinal to keep index reads bounded.
        sql`WITH ordered AS (SELECT ordinal, LAG(ordinal) OVER (ORDER BY ordinal) AS previous
            FROM ee_table_restore_snapshots WHERE job_id = ${id} AND header_json IS NOT NULL)
          INSERT INTO ee_table_versions(workspace_id,table_id,record_id,revision,position,deleted,cells_json)
          SELECT ${workspace},${memoId},r.record_id,${base} + r.ordinal + 1,r.position,0,coalesce(v.cells_json,r.cells_json)
          FROM ordered o CROSS JOIN ee_table_restore_rows r ON r.job_id = ${id} AND r.ordinal = o.ordinal
          LEFT JOIN ee_table_restore_values v ON v.job_id = r.job_id AND v.value_hash = r.value_hash
          LEFT JOIN ee_table_restore_rows p ON p.job_id = r.job_id AND p.ordinal = o.previous AND p.record_id = r.record_id
          LEFT JOIN ee_table_restore_values pv ON pv.job_id = p.job_id AND pv.value_hash = p.value_hash
          WHERE p.position IS NOT r.position OR (
            CASE WHEN p.value_hash IS NOT NULL AND r.value_hash IS NOT NULL THEN p.value_hash <> r.value_hash
              ELSE coalesce(pv.cells_json,p.cells_json) IS NOT coalesce(v.cells_json,r.cells_json) END)`,
        // Keep deletions visible to clients pulling from the old head or an archive revision.
        sql`WITH ordered AS (SELECT ordinal, LAG(ordinal) OVER (ORDER BY ordinal) AS previous
            FROM ee_table_restore_snapshots WHERE job_id = ${id} AND header_json IS NOT NULL)
          INSERT INTO ee_table_versions(workspace_id,table_id,record_id,revision,position,deleted,cells_json)
          SELECT ${workspace},${memoId},r.record_id,${base} + o.ordinal + 1,r.position,1,'{}' FROM ordered o
          CROSS JOIN ee_table_restore_rows r ON r.job_id = ${id} AND r.ordinal = o.previous
          WHERE NOT EXISTS (SELECT 1 FROM ee_table_restore_rows n WHERE n.job_id = r.job_id AND n.ordinal = o.ordinal AND n.record_id = r.record_id)
          UNION ALL
          SELECT ${workspace},${memoId},r.record_id,${base} + o.ordinal + 1,r.position,1,'{}' FROM ordered o
          CROSS JOIN ee_table_records r ON r.workspace_id = ${workspace} AND r.table_id = ${memoId}
          WHERE o.previous IS NULL AND NOT EXISTS (SELECT 1 FROM ee_table_restore_rows n WHERE n.job_id = ${id} AND n.ordinal = o.ordinal AND n.record_id = r.record_id)`,
        sql`DELETE FROM ee_table_records WHERE workspace_id = ${workspace} AND table_id = ${memoId}`,
        sql`INSERT INTO ee_table_records(workspace_id,table_id,record_id,position,created_revision,cells_json,normalized_json,search_text)
          SELECT ${workspace},${memoId},r.record_id,r.position,${latestRevision},coalesce(v.cells_json,r.cells_json),r.normalized_json,r.search_text
          FROM ee_table_restore_rows r LEFT JOIN ee_table_restore_values v ON v.job_id = r.job_id AND v.value_hash = r.value_hash
          WHERE r.job_id = ${id} AND r.ordinal = ${latest.ordinal}`,
        ...indexes.statements,
        sql`INSERT INTO memo_contents(memo_id,content_json,content_markdown,content_text,content_hash,revision,shared_table_revision,created_at,updated_at)
          VALUES(${memoId},${stored.content_json},${stored.content_markdown},${stored.content_text},${memo.contentHash},${memo.revision},${reference},${memo.createdAt},${memo.updatedAt})
          ON CONFLICT(memo_id) DO UPDATE SET content_json = excluded.content_json,content_markdown = excluded.content_markdown,content_text = excluded.content_text,
            content_hash = excluded.content_hash,revision = excluded.revision,shared_table_revision = excluded.shared_table_revision,updated_at = excluded.updated_at`,
        sql`DELETE FROM memo_revisions WHERE memo_id = ${memoId}`,
        sql`INSERT INTO memo_revisions(id,memo_id,revision,title,tags_json,content_json,content_markdown,content_text,content_hash,created_by,created_at,shared_table_revision)
          SELECT revision_id,${memoId},json_extract(revision_json,'$.revision'),json_extract(revision_json,'$.title'),json_extract(revision_json,'$.tags'),
            content_json,content_markdown,content_text,json_extract(revision_json,'$.contentHash'),json_extract(revision_json,'$.createdBy'),
            json_extract(revision_json,'$.createdAt'),CASE WHEN header_json IS NOT NULL THEN ${base} + ordinal + 1 END
          FROM ee_table_restore_snapshots WHERE job_id = ${id} AND revision_id IS NOT NULL`,
        upsertMemoSearchDocumentStatement(this.db, memoId, memo.title ?? "", stored.content_text, memo.tags.join(" ")),
        auditStatement(this.db, "user", null, "backup.restore", "backup", id, { memoCount: 1 }),
        sql`UPDATE ee_table_restore_jobs SET published = 1, updated_at = ${now}, memo_json = '{}', content_json = '{}', content_markdown = '', content_text = '' WHERE id = ${id}`,
        sql`DELETE FROM ee_table_restore_snapshots WHERE job_id = ${id}`,
        sql`DELETE FROM ee_table_restore_values WHERE job_id = ${id}`,
      ]);
    } catch (error) {
      if ((await this.job())?.published) return;
      if (((await currentTarget())?.token ?? null) !== job.target_token) throw changed();
      if (!(await complete())?.ok) throw incomplete();
      throw error;
    }
  }
}
