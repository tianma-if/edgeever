import { tableStatement, readStoredRecord } from "./table-query-sql";
import {
  coerceTableCell,
  parseTableDocumentJson,
  tableFallbackMarkdown,
  TABLE_RECORD_LIMIT,
  type TableDocument,
  type TableRecord,
} from "../../../packages/shared/src/table";
import { docToText, markdownToDoc } from "@edgeever/shared";
import { AppError } from "./app-error";
import { indexStatements, type SharedFieldIndex } from "./shared-table-index";
import { SharedTableQuery } from "./shared-table-query";
import type {
  DatabaseAdapter,
  PreparedStatementAdapter,
} from "./storage-contract";

export type SharedHead = {
  workspace_id: string;
  table_id: string;
  revision: number;
  schema_revision: number;
  row_count: number;
  max_position: number;
  header_json: string;
  indexes_json: string;
};
export type StoredSharedRecord = {
  record_id: string;
  position: number;
  cells_json: string;
};
type SharedCommit = Pick<
  SharedHead,
  "revision" | "schema_revision" | "row_count" | "header_json"
>;
type MutationInput = {
  expectedRevision: number;
  puts?: TableRecord[];
  deletes?: string[];
  header?: TableDocument;
};
type MutationReceipt = {
  revision: number;
  schemaRevision: number;
  recordCount: number;
};
type ChangeCursor = { revision: number; recordId: string };
const receipt = (row: SharedCommit): MutationReceipt => ({
  revision: row.revision,
  schemaRevision: row.schema_revision,
  recordCount: row.row_count,
});
export const tableConflict = () =>
  new AppError(
    "revision_conflict",
    "The table changed; retain the draft and refresh",
    409,
  );
const bad = () =>
  new AppError("bad_request", "Invalid table records or metadata", 400);
const withSharedCellEncoding = (document: TableDocument): TableDocument => ({
  ...document,
  cellEncoding: "nullable-v1",
});
export function tableHeader(document: TableDocument): TableDocument {
  const h = parseTableDocumentJson(
    JSON.stringify({ ...document, records: [] }),
    true,
  );
  if (!h) throw bad();
  return h;
}
export function normalizeSharedRecord(
  header: TableDocument,
  record: TableRecord,
): TableRecord {
  if (
    !record ||
    typeof record.id !== "string" ||
    !record.id ||
    record.id.length > 80 ||
    !record.cells ||
    typeof record.cells !== "object"
  )
    throw bad();
  return {
    id: record.id,
    cells: Object.fromEntries(
      header.fields.map((f) => {
        const value = Object.hasOwn(record.cells, f.id)
          ? record.cells[f.id]
          : undefined;
        return [f.id, value === null ? null : coerceTableCell(f, value)];
      }),
    ),
  };
}
export function recordProjection(header: TableDocument, record: TableRecord) {
  return {
    cells: JSON.stringify(record.cells),
    normalized: JSON.stringify(
      Object.fromEntries(
        header.fields.map((f) => {
          const v = record.cells[f.id];
          return [
            f.id,
            f.type === "attachment"
              ? Array.isArray(v)
                ? v.map((a) => a.filename.toLocaleLowerCase())
                : []
              : String(v ?? "").toLocaleLowerCase(),
          ];
        }),
      ),
    ),
    search: recordSearchText(header, record),
  };
}
const recordSearchText = (header: TableDocument, record: TableRecord) =>
  docToText(
    markdownToDoc(tableFallbackMarkdown({ ...header, records: [record] })),
  );

type PreparedSnapshot = { header: TableDocument; records: TableRecord[] };
const prepareSnapshot = (document: TableDocument): PreparedSnapshot => {
  const header = tableHeader(document);
  if (!Array.isArray(document.records)) throw bad();
  const records = document.records.map((r) => normalizeSharedRecord(header, r));
  if (new Set(records.map((r) => r.id)).size !== records.length)
    throw bad();
  return { header, records };
};

/** Stores current records and the changes needed to reconstruct earlier revisions. */
export class SharedTableStore {
  private readonly sql: ReturnType<typeof tableStatement>;
  constructor(readonly db: DatabaseAdapter) {
    this.sql = tableStatement(db);
  }
  async head(workspace: string, id: string) {
    const h = await this
      .sql`SELECT h.* FROM ee_table_heads h JOIN memos m ON m.id=h.table_id AND m.workspace_id=h.workspace_id
   JOIN notebooks n ON n.id=m.notebook_id AND n.workspace_id=m.workspace_id
   WHERE h.workspace_id=${workspace} AND h.table_id=${id} AND m.is_deleted=0 AND n.is_deleted=0`.first<SharedHead>();
    if (!h) throw new AppError("not_found", "Table not found", 404);
    return { ...h, workspace_id: workspace, table_id: id };
  }
  private guard(h: SharedHead) {
    return this.sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS(
   SELECT 1 FROM ee_table_heads h JOIN memos m ON m.id=h.table_id AND m.workspace_id=h.workspace_id
   JOIN notebooks n ON n.id=m.notebook_id AND n.workspace_id=m.workspace_id
   WHERE h.workspace_id=${h.workspace_id} AND h.table_id=${h.table_id} AND h.revision=${h.revision} AND m.is_deleted=0 AND n.is_deleted=0
   )`;
  }
  private async batch(h: SharedHead, statements: PreparedStatementAdapter[]) {
    try {
      await this.db.batch([this.guard(h), ...statements]);
    } catch (error) {
      const current = await this.head(h.workspace_id, h.table_id);
      if (current.revision !== h.revision) throw tableConflict();
      throw error;
    }
  }
  commitStatements(
    h: SharedHead,
    header: TableDocument,
    rowCount: number,
    maxPosition: number,
    indexes: SharedFieldIndex[],
    schema = h.schema_revision,
  ) {
    const revision = h.revision + 1,
      json = JSON.stringify(header);
    return [
      this
        .sql`UPDATE ee_table_heads SET revision=${revision},schema_revision=${schema},row_count=${rowCount},max_position=${maxPosition},header_json=${json},indexes_json=${JSON.stringify(indexes)}
   WHERE workspace_id=${h.workspace_id} AND table_id=${h.table_id}`,
      this
        .sql`INSERT INTO ee_table_commits(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json)
    VALUES(${h.workspace_id},${h.table_id},${revision},${schema},${rowCount},${maxPosition},${json})`,
    ];
  }
  private rowStatement(
    workspace: string,
    id: string,
    record: TableRecord,
    position: number,
    revision: number,
    header: TableDocument,
  ) {
    const p = recordProjection(header, record);
    return this
      .sql`INSERT INTO ee_table_records(workspace_id,table_id,record_id,position,created_revision,cells_json,normalized_json,search_text)
   VALUES(${workspace},${id},${record.id},${position},${revision},${p.cells},${p.normalized},${p.search}) ON CONFLICT(workspace_id,table_id,record_id) DO UPDATE SET
   position=excluded.position,created_revision=excluded.created_revision,cells_json=excluded.cells_json,normalized_json=excluded.normalized_json,search_text=excluded.search_text`;
  }
  private versionStatement(
    workspace: string,
    id: string,
    record: TableRecord,
    position: number,
    revision: number,
    deleted = 0,
  ) {
    return this
      .sql`INSERT INTO ee_table_versions(workspace_id,table_id,record_id,revision,position,deleted,cells_json)
   VALUES(${workspace},${id},${record.id},${revision},${position},${deleted},${JSON.stringify(record.cells)})`;
  }
  private initialPlan(
    workspace: string,
    id: string,
    prepared: PreparedSnapshot,
  ) {
    const { header, records } = prepared,
      plan = indexStatements(this.db, workspace, id, header, []),
      json = JSON.stringify(header);
    const head: SharedHead = {
      workspace_id: workspace,
      table_id: id,
      revision: 1,
      schema_revision: 1,
      row_count: records.length,
      max_position: records.length,
      header_json: json,
      indexes_json: JSON.stringify(plan.next),
    };
    const statements = [
      this
        .sql`INSERT INTO ee_table_heads(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json,indexes_json)
   VALUES(${workspace},${id},1,1,${records.length},${records.length},${json},${head.indexes_json})`,
      this.initialCommit(head),
      ...plan.statements,
      ...this.initialRows(workspace, id, header, records, 0),
    ];
    return { head, statements };
  }
  private initialCommit(h: SharedHead) {
    return this
      .sql`INSERT INTO ee_table_commits(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json)
    VALUES(${h.workspace_id},${h.table_id},1,1,${h.row_count},${h.max_position},${h.header_json})`;
  }
  private initialRows(
    workspace: string,
    id: string,
    header: TableDocument,
    records: TableRecord[],
    after: number,
  ) {
    return records.flatMap((record, index) => {
      const position = after + index + 1;
      return [
        this.rowStatement(workspace, id, record, position, 1, header),
        this.versionStatement(workspace, id, record, position, 1),
      ];
    });
  }
  stageLegacyBatch(
    workspace: string,
    id: string,
    document: TableDocument,
    after: number,
    limit: number,
    migrationRunId: string,
  ) {
    const header = tableHeader(document);
    const end = Math.min(after + limit, document.records.length);
    const records = document.records
      .slice(after, end)
      .map((record) => normalizeSharedRecord(header, record));
    const statements: PreparedStatementAdapter[] = [];
    if (after === 0) {
      const json = JSON.stringify(header);
      statements.push(this
        .sql`INSERT INTO ee_table_heads(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json,migration_run_id)
    VALUES(${workspace},${id},1,1,${document.records.length},${document.records.length},${json},${migrationRunId})`);
    }
    statements.push(...this.initialRows(workspace, id, header, records, after));
    for (const [index, record] of records.entries()) {
      const position = after + index + 1,
        cells = JSON.stringify(record.cells);
      statements.push(this
        .sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
    SELECT 1 FROM ee_table_records WHERE workspace_id=${workspace} AND table_id=${id} AND position=${position}
       AND record_id=${record.id} AND cells_json=${cells})`);
    }
    if (end === document.records.length) {
      const indexes = indexStatements(this.db, workspace, id, header, []);
      statements.push(
        this
          .sql`INSERT INTO ee_table_commits(workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json)
    SELECT workspace_id,table_id,revision,schema_revision,row_count,max_position,header_json FROM ee_table_heads
    WHERE workspace_id=${workspace} AND table_id=${id}`,
        ...indexes.statements,
        this
          .sql`UPDATE ee_table_heads SET indexes_json=${JSON.stringify(indexes.next)} WHERE workspace_id=${workspace} AND table_id=${id}`,
      );
    }
    return { statements, end };
  }
  // Before activation revision 1 is private to the copier. Patch only rows
  // that differ between the two fixed images, removing their old positions
  // before inserting any replacements so swaps work across batch boundaries.
  stageLegacyChanges(h: SharedHead, before: TableDocument, target: TableDocument | null, offset: number, limit: number) {
    const sql = this.sql;
    const workspace = h.workspace_id, id = h.table_id;
    const next = target?.records ?? [];
    const fieldsChanged = JSON.stringify(before.fields) !== JSON.stringify(target?.fields);
    const changed = (index: number) => fieldsChanged || JSON.stringify(before.records[index]) !== JSON.stringify(next[index]);
    const deletes = before.records.filter((_, index) => changed(index));
    const puts = next.flatMap((row, index) => changed(index) ? [{ row, position: index + 1 }] : []);
    const end = Math.min(offset + limit, deletes.length + puts.length);
    const complete = end === deletes.length + puts.length;
    const statements: PreparedStatementAdapter[] = [];
    const header = target && tableHeader(target);
    let newIndexes = 0;
    for (let i = offset; i < end; i++) {
      if (i < deletes.length) {
        const key = deletes[i].id;
        statements.push(sql`DELETE FROM ee_table_records WHERE workspace_id=${workspace} AND table_id=${id} AND record_id=${key}`,
          sql`DELETE FROM ee_table_versions WHERE workspace_id=${workspace} AND table_id=${id} AND record_id=${key} AND revision=1`);
      } else {
        const { row, position } = puts[i - deletes.length];
        const record = normalizeSharedRecord(header!, row);
        statements.push(this.rowStatement(workspace, id, record, position, 1, header!),
          this.versionStatement(workspace, id, record, position, 1),
          sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM ee_table_records WHERE workspace_id=${workspace} AND table_id=${id} AND position=${position} AND record_id=${row.id} AND cells_json=${JSON.stringify(record.cells)})`);
      }
    }
    if (complete) {
      const indexes: SharedFieldIndex[] = JSON.parse(h.indexes_json);
      if (header) {
        const plan = indexStatements(this.db, workspace, id, header, indexes);
        newIndexes = plan.next.filter(index => !indexes.some(existing => existing.name === index.name)).length;
        const json = JSON.stringify(header);
        statements.push(...plan.statements,
          sql`UPDATE ee_table_heads SET header_json=${json},row_count=${next.length},max_position=${next.length},indexes_json=${JSON.stringify(plan.next)} WHERE workspace_id=${workspace} AND table_id=${id}`,
          sql`UPDATE ee_table_commits SET header_json=${json},row_count=${next.length},max_position=${next.length} WHERE workspace_id=${workspace} AND table_id=${id} AND revision=1`);
      } else {
        statements.push(...indexes.map(index => this.db.prepare(`DROP INDEX ${index.name}`)),
          sql`DELETE FROM ee_table_heads WHERE workspace_id=${workspace} AND table_id=${id}`);
      }
    }
    return { statements, end, complete, newIndexes };
  }
  committedHead(
    h: SharedHead,
    header: TableDocument,
    count: number,
    max: number,
    indexes: SharedFieldIndex[],
    schema = h.schema_revision,
  ) {
    return {
      ...h,
      revision: h.revision + 1,
      schema_revision: schema,
      row_count: count,
      max_position: max,
      header_json: JSON.stringify(header),
      indexes_json: JSON.stringify(indexes),
    };
  }
  async query(workspace: string, id: string, input: unknown) {
    const page = JSON.parse(
      await new SharedTableQuery(this.db, workspace).query(
        workspace,
        id,
        input,
      ),
    );
    page.header = withSharedCellEncoding(page.header);
    return page;
  }
  async apply(
    workspace: string,
    id: string,
    input: MutationInput,
    related: PreparedStatementAdapter[] = [],
    previousRecords?: TableRecord[],
  ): Promise<MutationReceipt> {
    const h = await this.head(workspace, id);
    if (h.revision !== input.expectedRevision) throw tableConflict();
    const old = JSON.parse(h.header_json) as TableDocument,
      header = input.header ? tableHeader(input.header) : old;
    const oldTypes = new Map(old.fields.map((field) => [field.id, field.type]));
    const shapeChanged =
      old.fields.length !== header.fields.length ||
      header.fields.some((field) => oldTypes.get(field.id) !== field.type);
    const fieldsChanged =
      JSON.stringify(old.fields) !== JSON.stringify(header.fields);
    const schema = h.schema_revision + Number(fieldsChanged);
    const puts = (input.puts ?? []).map((r) =>
        normalizeSharedRecord(header, r),
      ),
      deletes = input.deletes ?? [],
      ids = [...puts.map((r) => r.id), ...deletes];
    if (new Set(ids).size !== ids.length) throw bad();
    const rows = ids.length
      ? (
          await this
            .sql`SELECT hex(record_id) AS record_id,position,cells_json FROM ee_table_records WHERE workspace_id=${workspace} AND table_id=${id}
   AND record_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`.all<StoredSharedRecord>()
        ).results.map(readStoredRecord)
      : [];
    const byId = new Map(rows.map((row) => [row.record_id, row]));
    let count = h.row_count,
      max = h.max_position;
    const revision = h.revision + 1,
      statements: PreparedStatementAdapter[] = [];
    for (const record of puts) {
      const previous = byId.get(record.id),
        position = previous?.position ?? ++max;
      if (!previous) count++;
      statements.push(
        this.rowStatement(workspace, id, record, position, revision, header),
        this.versionStatement(workspace, id, record, position, revision),
      );
    }
    for (const recordId of deletes) {
      const row = byId.get(recordId);
      if (!row) continue;
      count--;
      statements.push(
        this
          .sql`DELETE FROM ee_table_records WHERE workspace_id=${workspace} AND table_id=${id} AND record_id=${recordId}`,
        this.versionStatement(
          workspace,
          id,
          { id: recordId, cells: JSON.parse(row.cells_json) },
          row.position,
          revision,
          1,
        ),
      );
    }
    if (count > Math.max(TABLE_RECORD_LIMIT, h.row_count))
      throw new AppError(
        "table_record_limit",
        "Table record limit reached",
        409,
      );
    if (fieldsChanged && previousRecords) {
      const changed = new Set(ids);
      for (const record of previousRecords) {
        if (changed.has(record.id)) continue;
        const searchText = recordSearchText(header, record);
        if (searchText !== recordSearchText(old, record)) {
          statements.push(this
            .sql`UPDATE ee_table_records SET search_text = ${searchText}
            WHERE workspace_id = ${workspace} AND table_id = ${id} AND record_id = ${record.id}`);
        }
      }
    } else if (fieldsChanged) {
      const changed = new Set(ids);
      let after = 0;
      for (;;) {
        const page = (
          await this
            .sql`SELECT hex(record_id) AS record_id,position,cells_json,search_text FROM ee_table_records
     WHERE workspace_id=${workspace} AND table_id=${id} AND position>${after} ORDER BY position LIMIT 50`.all<
            StoredSharedRecord & { search_text: string }
          >()
        ).results.map(readStoredRecord);
        if (!page.length) break;
        for (const row of page)
          if (!changed.has(row.record_id)) {
            const previous = {
              id: row.record_id,
              cells: JSON.parse(row.cells_json),
            };
            const updated = shapeChanged
              ? normalizeSharedRecord(header, previous)
              : previous;
            if (
              updated !== previous &&
              JSON.stringify(updated.cells) !== row.cells_json
            ) {
              statements.push(
                this.rowStatement(
                  workspace,
                  id,
                  updated,
                  row.position,
                  revision,
                  header,
                ),
                this.versionStatement(
                  workspace,
                  id,
                  updated,
                  row.position,
                  revision,
                ),
              );
              continue;
            }
            const search = recordSearchText(header, updated);
            if (search !== row.search_text)
              statements.push(
                this
                  .sql`UPDATE ee_table_records SET search_text=${search} WHERE workspace_id=${workspace} AND table_id=${id} AND record_id=${row.record_id}`,
              );
          }
        after = page.at(-1)!.position;
      }
    }
    const plan = indexStatements(
      this.db,
      workspace,
      id,
      header,
      JSON.parse(h.indexes_json),
    );
    await this.batch(h, [
      ...statements,
      ...plan.statements,
      ...this.commitStatements(h, header, count, max, plan.next, schema),
      ...related,
    ]);
    return receipt(
      this.committedHead(h, header, count, max, plan.next, schema),
    );
  }
  planMemoInitialization(
    workspace: string,
    id: string,
    document: TableDocument,
    runId: string,
  ) {
    const plan = this.initialPlan(workspace, id, prepareSnapshot(document));
    return [
      ...plan.statements,
      this
        .sql`UPDATE ee_table_heads SET migration_run_id = ${runId} WHERE workspace_id = ${workspace} AND table_id = ${id}`,
    ];
  }

  async saveMemoDocument(
    workspace: string,
    id: string,
    expectedRevision: number,
    current: TableDocument | null,
    next: TableDocument,
    related: PreparedStatementAdapter[],
  ) {
    if (!current) {
      const head = await this.head(workspace, id);
      if (head.revision !== expectedRevision) throw tableConflict();
      await this.replaceSnapshot(head, next, related);
      return;
    }
    const oldById = new Map(
      current.records.map((record) => [record.id, record]),
    );
    const nextIds = new Set(next.records.map((record) => record.id));
    const deletes = current.records
      .filter((record) => !nextIds.has(record.id))
      .map((record) => record.id);
    const appendOrder = [
      ...current.records.filter((record) => nextIds.has(record.id)),
      ...next.records.filter((record) => !oldById.has(record.id)),
    ];
    if (
      next.records.some((record, index) => appendOrder[index]?.id !== record.id)
    ) {
      const head = await this.head(workspace, id);
      if (head.revision !== expectedRevision) throw tableConflict();
      await this.replaceSnapshot(head, next, related);
      return;
    }
    const puts = next.records.filter((record) => {
      const previous = oldById.get(record.id);
      if (!previous) return true;
      const fieldIds = Object.keys(record.cells);
      return (
        fieldIds.length !== Object.keys(previous.cells).length ||
        fieldIds.some(
          (fieldId) =>
            JSON.stringify(previous.cells[fieldId]) !==
            JSON.stringify(record.cells[fieldId]),
        )
      );
    });
    await this.apply(
      workspace,
      id,
      { expectedRevision, puts, deletes, header: tableHeader(next) },
      related,
      current.records,
    );
  }

  async changes(
    workspace: string,
    id: string,
    input: { since: number; through?: number; after?: ChangeCursor },
  ) {
    const h = await this.head(workspace, id),
      revision = input.through ?? h.revision;
    if (
      !Number.isSafeInteger(input.since) ||
      !Number.isSafeInteger(revision) ||
      input.since < 1 ||
      input.since > revision ||
      revision > h.revision
    )
      throw tableConflict();
    const end =
      revision === h.revision
        ? h
        : await this
            .sql`SELECT revision,schema_revision,row_count,header_json FROM ee_table_commits
   WHERE workspace_id=${workspace} AND table_id=${id} AND revision=${revision}`.first<SharedCommit>();
    if (!end) throw tableConflict();
    const after = input.after ?? { revision: input.since, recordId: "" };
    if (
      input.after &&
      (!Number.isSafeInteger(after.revision) ||
        after.revision <= input.since ||
        after.revision > revision ||
        typeof after.recordId !== "string")
    )
      throw tableConflict();
    const rows = (
      await this
        .sql`SELECT hex(record_id) AS record_id,revision,position,deleted,cells_json FROM ee_table_versions
   WHERE workspace_id=${workspace} AND table_id=${id} AND revision>${input.since} AND revision<=${revision}
    AND (revision,record_id)>(${after.revision},${after.recordId})
   ORDER BY revision,ee_table_versions.record_id LIMIT 51`.all<
        StoredSharedRecord & { revision: number; deleted: number }
      >()
    ).results.map(readStoredRecord);
    const page = rows.slice(0, 50),
      last = page.at(-1);
    return {
      ...receipt(end),
      header: withSharedCellEncoding(JSON.parse(end.header_json)),
      changes: page.map((row) =>
        row.deleted
          ? {
              revision: row.revision,
              id: row.record_id,
              deleted: true as const,
            }
          : {
              revision: row.revision,
              id: row.record_id,
              position: row.position,
              cells: JSON.parse(row.cells_json),
              deleted: false as const,
            },
      ),
      next:
        rows.length > 50 && last
          ? { revision: last.revision, recordId: last.record_id }
          : null,
    };
  }
  private snapshotResult(
    commit: Pick<SharedHead, "revision" | "header_json" | "row_count">,
    rows: StoredSharedRecord[],
    limit = 50,
  ) {
    const visible = rows.slice(0, limit);
    return {
      revision: commit.revision,
      header: withSharedCellEncoding(JSON.parse(commit.header_json)),
      rowCount: commit.row_count,
      records: visible.map((r) => ({
        id: r.record_id,
        cells: JSON.parse(r.cells_json),
      })),
      next: rows.length > limit ? visible.at(-1)!.position : null,
    };
  }
  private async currentSnapshotPage(
    h: SharedHead,
    after = 0,
    allowHidden = false,
  ) {
    const limit = allowHidden ? 100 : 50;
    // Read the page and check visibility/revision in the same statement. The
    // LEFT JOIN distinguishes an empty page from a changed or deleted table.
    const page = await this
      .sql`SELECT hex(p.record_id) AS record_id,p.position,p.cells_json
   FROM ee_table_heads h JOIN memos m ON m.id=h.table_id AND m.workspace_id=h.workspace_id
   LEFT JOIN notebooks n ON n.id=m.notebook_id AND n.workspace_id=m.workspace_id
   LEFT JOIN (
     SELECT record_id,position,cells_json FROM ee_table_records
     WHERE workspace_id=${h.workspace_id} AND table_id=${h.table_id} AND position>${after} AND position<=${h.max_position}
     ORDER BY position LIMIT ${limit + 1}
   ) p ON 1=1
   WHERE h.workspace_id=${h.workspace_id} AND h.table_id=${h.table_id} AND h.revision=${h.revision}
     AND (${Number(allowHidden)} = 1 OR (m.is_deleted=0 AND n.is_deleted=0)) ORDER BY p.position`.all<StoredSharedRecord>();
    if (!page.results.length) {
      await this.head(h.workspace_id, h.table_id);
      throw tableConflict();
    }
    const rows = page.results
      .filter((row) => row.position !== null)
      .map(readStoredRecord);
    return this.snapshotResult(h, rows, limit);
  }
  private async historicalSnapshotPage(
    commit: SharedHead,
    after = 0,
    limit = 50,
  ) {
    const { workspace_id: workspace, table_id: id, revision } = commit;
    const rows = (
      await this
        .sql`SELECT hex(v.record_id) AS record_id,v.position,v.cells_json FROM ee_table_versions v
   WHERE v.workspace_id=${workspace} AND v.table_id=${id} AND v.position>${after} AND v.revision<=${revision} AND v.deleted=0
   AND v.revision=(SELECT max(latest.revision) FROM ee_table_versions latest
    WHERE latest.workspace_id=v.workspace_id AND latest.table_id=v.table_id AND latest.record_id=v.record_id AND latest.revision<=${revision})
   ORDER BY v.position LIMIT ${limit + 1}`.all<StoredSharedRecord>()
    ).results.map(readStoredRecord);
    return this.snapshotResult(commit, rows, limit);
  }
  private async collectSnapshot(
    readPage: (
      after?: number,
    ) => Promise<ReturnType<SharedTableStore["snapshotResult"]>>,
  ): Promise<TableDocument> {
    const first = await readPage();
    let next = first.next;
    const records = first.records;
    while (next !== null) {
      const page = await readPage(next);
      records.push(...page.records);
      next = page.next;
    }
    if (records.length !== first.rowCount)
      throw new AppError(
        "table_history_incomplete",
        "Snapshot record count does not match its revision",
        409,
      );
    return { ...first.header, records };
  }
  async snapshot(
    workspace: string,
    id: string,
    revision?: number,
  ): Promise<TableDocument> {
    const h = await this.head(workspace, id);
    if (revision === undefined) {
      return this.collectSnapshot((after) =>
        this.currentSnapshotPage(h, after),
      );
    }
    // An explicit revision is immutable, including an explicit current head.
    const commit = await this.sql`SELECT * FROM ee_table_commits
      WHERE workspace_id=${workspace} AND table_id=${id} AND revision=${revision}`.first<SharedHead>();
    if (!commit) throw tableConflict();
    return this.collectSnapshot((after) =>
      this.historicalSnapshotPage(commit, after),
    );
  }
  // Callers have already scoped and authorized the memo, including trash and history reads.
  async memoSnapshot(
    workspace: string,
    id: string,
    revision: number,
    history: boolean,
  ) {
    if (!history) {
      const current = await this.sql`SELECT * FROM ee_table_heads
        WHERE workspace_id = ${workspace} AND table_id = ${id} AND revision = ${revision}`.first<SharedHead>();
      if (current)
        return this.collectSnapshot((after) =>
          this.currentSnapshotPage(current, after, true),
        );
    }
    const commit = await this.sql`SELECT * FROM ee_table_commits
      WHERE workspace_id = ${workspace} AND table_id = ${id} AND revision = ${revision}`.first<SharedHead>();
    if (!commit) throw tableConflict();
    return this.collectSnapshot((after) =>
      this.historicalSnapshotPage(commit, after, 100),
    );
  }

  async restore(
    workspace: string,
    id: string,
    revision: number,
    expectedRevision: number,
  ) {
    const h = await this.head(workspace, id);
    if (h.revision !== expectedRevision) throw tableConflict();
    return this.replaceSnapshot(
      h,
      await this.snapshot(workspace, id, revision),
    );
  }
  async planMemoSnapshotRestore(
    workspace: string,
    id: string,
    runId: string,
    snapshots: TableDocument[],
  ) {
    const previous = await this
      .sql`SELECT * FROM ee_table_heads WHERE workspace_id = ${workspace} AND table_id = ${id}`.first<SharedHead>();
    const statements: PreparedStatementAdapter[] = [];
    const revisions: number[] = [];
    let head = previous;
    let current = previous
      ? (
          await this
            .sql`SELECT hex(record_id) AS record_id, position, cells_json FROM ee_table_records
      WHERE workspace_id = ${workspace} AND table_id = ${id}`.all<StoredSharedRecord>()
        ).results.map(readStoredRecord)
      : [];
    if (previous)
      statements.push(this
        .sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
      SELECT 1 FROM ee_table_heads WHERE workspace_id = ${workspace} AND table_id = ${id} AND revision = ${previous.revision})`);
    for (const snapshot of snapshots) {
      const prepared = prepareSnapshot(snapshot);
      const plan = head
        ? this.replacementPlan(head, prepared, current)
        : this.initialPlan(workspace, id, prepared);
      statements.push(...plan.statements);
      head = plan.head;
      revisions.push(head.revision);
      current = prepared.records.map((record, index) => ({
        record_id: record.id,
        position: index + 1,
        cells_json: JSON.stringify(record.cells),
      }));
    }
    statements.push(
      this
        .sql`UPDATE ee_table_heads SET migration_run_id = ${runId} WHERE workspace_id = ${workspace} AND table_id = ${id}`,
    );
    return { statements, revisions };
  }

  private replacementPlan(
    h: SharedHead,
    prepared: PreparedSnapshot,
    current: StoredSharedRecord[],
  ) {
    const { header, records } = prepared,
      revision = h.revision + 1;
    // Full replacement is reserved for explicit history/backup restore, never ordinary edits.
    const statements: PreparedStatementAdapter[] = [
      this
        .sql`DELETE FROM ee_table_records WHERE workspace_id=${h.workspace_id} AND table_id=${h.table_id}`,
    ];
    const ids = new Set(records.map((r) => r.id));
    for (const row of current)
      if (!ids.has(row.record_id))
        statements.push(
          this.versionStatement(
            h.workspace_id,
            h.table_id,
            { id: row.record_id, cells: JSON.parse(row.cells_json) },
            row.position,
            revision,
            1,
          ),
        );
    records.forEach((r, i) =>
      statements.push(
        this.rowStatement(
          h.workspace_id,
          h.table_id,
          r,
          i + 1,
          revision,
          header,
        ),
        this.versionStatement(h.workspace_id, h.table_id, r, i + 1, revision),
      ),
    );
    const plan = indexStatements(
      this.db,
      h.workspace_id,
      h.table_id,
      header,
      JSON.parse(h.indexes_json),
    );
    statements.push(
      ...plan.statements,
      ...this.commitStatements(
        h,
        header,
        records.length,
        records.length,
        plan.next,
        h.schema_revision + 1,
      ),
    );
    return {
      statements,
      head: this.committedHead(
        h,
        header,
        records.length,
        records.length,
        plan.next,
        h.schema_revision + 1,
      ),
    };
  }
  private async replaceSnapshot(
    h: SharedHead,
    document: TableDocument,
    related: PreparedStatementAdapter[] = [],
  ) {
    const prepared = prepareSnapshot(document),
      current = (
        await this
          .sql`SELECT hex(record_id) AS record_id,position,cells_json FROM ee_table_records
   WHERE workspace_id=${h.workspace_id} AND table_id=${h.table_id}`.all<StoredSharedRecord>()
      ).results.map(readStoredRecord);
    const plan = this.replacementPlan(h, prepared, current);
    await this.batch(h, [...plan.statements, ...related]);
    return plan.head;
  }
}
