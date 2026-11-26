import {
  getTableViews,
  hasTableDocumentMarker,
  parseTableDocument,
  type TableDocument,
} from "@edgeever/shared";
import { AppError } from "./app-error";
import { SharedTableStore, type SharedHead } from "./shared-table-store";
import { TABLE_VIEW_INDEX_LIMIT, type SharedFieldIndex } from "./shared-table-index";
import type {
  DatabaseAdapter,
  PreparedStatementAdapter,
} from "./storage-contract";
import { tableStatement } from "./table-query-sql";

const MEMO_BATCH = 50;
const RECORD_BATCH = 25;
const SCAN_BUDGET = { readRows: 16 + MEMO_BATCH * 4, writeRows: 16, extraBytes: 0 };

export type TableMigrationBudget = { readRows: number; writeRows: number; extraBytes: number };
export type TableEstimateCursor = { memoId: string; copiedRecords: number };
const zeroBudget = (): TableMigrationBudget => ({ readRows: 0, writeRows: 0, extraBytes: 0 });
const fits = (cost: TableMigrationBudget, budget: TableMigrationBudget) =>
  cost.readRows <= budget.readRows && cost.writeRows <= budget.writeRows && cost.extraBytes <= budget.extraBytes;

const estimateCopy = (source: LegacySource, table: TableDocument, offset: number, rows: number, copiedRecords: number): TableMigrationBudget => {
  const total = table.records.length;
  const buildsIndexes = offset + rows >= total;
  const views = getTableViews(table).filter((view) => view.sorts[0] && !view.sorts[0].legacy);
  const indexes = buildsIndexes ? Math.min(TABLE_VIEW_INDEX_LIMIT, views.length) : 0;
  const bytes = new TextEncoder().encode(source.content_markdown).length;
  // Count shared index builds against previously copied rows as SQLite may scan
  // the whole shared table. These are planning allowances, not D1 billing.
  return {
    readRows: 16 + rows * 8 + indexes * (copiedRecords + rows + 1),
    writeRows: 16 + rows * 32 + indexes * total,
    extraBytes: Math.ceil((bytes * 4 + 1024 * total) * (rows / Math.max(1, total)))
      + (offset === 0 ? 8192 + (total === 0 ? bytes * 4 : 0) : 0) + indexes * total * 128,
  };
};

type ProgressRow = {
  phase: "copying" | "ready" | "rolling_back";
  run_id: string;
  after_memo_id: string;
  pending_ids: string;
  after_position: number;
  tables_copied: number;
  rows_copied: number;
  step: number;
};

type LegacySource = {
  id: string;
  workspace_id: string;
  content_markdown: string;
};

const progress = (row: ProgressRow | null) => ({
  phase: row?.phase ?? "legacy",
  tablesCopied: row?.tables_copied ?? 0,
  rowsCopied: row?.rows_copied ?? 0,
  tableId: row ? ((JSON.parse(row.pending_ids) as string[])[0] ?? null) : null,
  afterPosition: row?.after_position ?? 0,
});

export class SharedTableMigration {
  private readonly sql: ReturnType<typeof tableStatement>;
  private readonly store: SharedTableStore;

  constructor(private readonly db: DatabaseAdapter) {
    this.sql = tableStatement(db);
    this.store = new SharedTableStore(db);
  }

  private state() {
    return this
      .sql`SELECT * FROM ee_table_migration WHERE id = 1`.first<ProgressRow>();
  }

  async status() {
    const active = await this
      .sql`SELECT tables_copied, rows_copied FROM ee_table_activation WHERE id = 1`.first<{
      tables_copied: number;
      rows_copied: number;
    }>();
    return active
      ? {
          phase: "active" as const,
          tablesCopied: active.tables_copied,
          rowsCopied: active.rows_copied,
          tableId: null,
          afterPosition: 0,
        }
      : progress(await this.state());
  }

  async activate() {
    await this.db.batch([
      this
        .sql`INSERT INTO ee_table_activation(id, run_id, tables_copied, rows_copied)
        SELECT id, run_id, tables_copied, rows_copied FROM ee_table_migration WHERE id = 1 AND phase = 'ready'`,
      this.sql`DELETE FROM ee_table_migration WHERE id = 1 AND phase = 'ready'`,
    ]);
    const status = await this.status();
    if (status.phase !== "active")
      throw new AppError(
        "table_migration_not_ready",
        "Finish verifying the table migration before activation",
        409,
      );
    return status;
  }

  async estimate(cursor?: TableEstimateCursor) {
    const limit = 20;
    const after = cursor?.memoId ?? "";
    const page = (await this.sql`SELECT m.id, mc.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' AS table_marker
      FROM memos m JOIN memo_contents mc ON mc.memo_id = m.id WHERE m.id > ${after}
      ORDER BY m.id LIMIT ${limit}`.all<{ id: string; table_marker: number }>()).results;
    const estimate = zeroBudget();
    estimate.readRows = page.length * 4 + 64;
    let records = 0, tables = 0, copied = cursor?.copiedRecords ?? 0;
    for (const { id, table_marker } of page) {
      if (!table_marker) continue;
      const source = await this.readSource(id);
      if (!source || !hasTableDocumentMarker(source.content_markdown)) continue;
      const document = this.parseSource(source);
      const count = document.records.length;
      for (let offset = 0; offset < Math.max(1, count); offset += RECORD_BATCH) {
        const rows = Math.min(RECORD_BATCH, count - offset);
        const cost = estimateCopy(source, document, offset, rows, copied + records + offset);
        estimate.readRows += cost.readRows;
        estimate.writeRows += cost.writeRows;
        estimate.extraBytes += cost.extraBytes;
      }
      records += count;
      tables++;
    }
    return { ...estimate, tables, records,
      next: page.length === limit ? { memoId: page.at(-1)!.id, copiedRecords: copied + records } : null };
  }

  private readSource(id: string) {
    return this.sql`SELECT m.id, m.workspace_id, mc.content_markdown
      FROM memos m JOIN memo_contents mc ON mc.memo_id = m.id WHERE m.id = ${id}`.first<LegacySource>();
  }

  private parseSource(source: LegacySource) {
    const document = parseTableDocument(source.content_markdown);
    if (!document) throw new AppError("invalid_legacy_table", `Cannot parse table ${source.id}`, 409);
    return document;
  }

  async start() {
    await this
      .sql`INSERT INTO ee_table_migration(id, run_id, phase) SELECT 1, ${crypto.randomUUID()}, 'copying' WHERE NOT EXISTS (SELECT 1 FROM ee_table_activation WHERE id = 1) ON CONFLICT(id) DO NOTHING`.run();
    return this.status();
  }

  async beginRollback() {
    await this
      .sql`UPDATE ee_table_migration SET phase = 'rolling_back', step = step + 1 WHERE id = 1 AND phase <> 'rolling_back'`.run();
    const status = await this.status();
    if (status.phase === "active") {
      throw new AppError("table_storage_already_active", "Use a server version that supports shared records to roll back an active instance", 409);
    }
    return status;
  }

  async advance(budget?: TableMigrationBudget) {
    const state = await this.state();
    if (!state) return this.status();
    if (state.phase === "ready") return progress(state);
    const requireBudget = (cost: TableMigrationBudget) => {
      if (budget && !fits(cost, budget)) throw new AppError("table_migration_budget_exhausted", "Insufficient read, write or storage allowance for this step", 409);
    };
    if (state.phase === "rolling_back") return this.rollback(state, requireBudget);

    const pending = JSON.parse(state.pending_ids) as string[];
    const tableId = pending[0];
    if (tableId) {
      requireBudget({ readRows: 16, writeRows: 1, extraBytes: 0 });
      const source = await this.readSource(tableId);
      if (!source)
        throw new AppError(
          "invalid_legacy_table",
          `Cannot read table ${tableId}`,
          409,
        );
      const remaining = JSON.stringify(pending.slice(1));
      if (hasTableDocumentMarker(source.content_markdown)) {
        const document = this.parseSource(source);
        const count = Math.min(RECORD_BATCH, document.records.length - state.after_position);
        requireBudget(estimateCopy(source, document, state.after_position, count, state.rows_copied));
        return this.copy(state, source, document, remaining);
      }
      return this.commit(state, [
        this
          .sql`UPDATE ee_table_migration SET pending_ids = ${remaining}, step = step + 1 WHERE id = 1`,
      ]);
    }

    requireBudget(SCAN_BUDGET);
    const page = (
      await this
        .sql`SELECT m.id, mc.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' AS table_marker
      FROM memos m JOIN memo_contents mc ON mc.memo_id = m.id WHERE m.id > ${state.after_memo_id}
      ORDER BY m.id LIMIT ${MEMO_BATCH}`.all<{
        id: string;
        table_marker: number;
      }>()
    ).results;
    const candidates = page
      .filter((row) => row.table_marker)
      .map((row) => row.id);
    const phase =
      page.length < MEMO_BATCH && candidates.length === 0 ? "ready" : "copying";
    const afterMemoId = page.at(-1)?.id ?? state.after_memo_id;
    return this.commit(state, [
      this
        .sql`UPDATE ee_table_migration SET phase = ${phase}, after_memo_id = ${afterMemoId},
        pending_ids = ${JSON.stringify(candidates)}, step = step + 1 WHERE id = 1`,
    ]);
  }

  private copy(state: ProgressRow, source: LegacySource, document: TableDocument, remaining: string) {
    const { statements, end } = this.store.stageLegacyBatch(
      source.workspace_id,
      source.id,
      document,
      state.after_position,
      RECORD_BATCH,
      state.run_id,
    );
    const copied = end - state.after_position;
    const complete = end === document.records.length;
    statements.push(this.sql`UPDATE ee_table_migration SET
      pending_ids = ${complete ? remaining : state.pending_ids}, after_position = ${complete ? 0 : end},
      rows_copied = rows_copied + ${copied}, tables_copied = tables_copied + ${Number(complete)}, step = step + 1 WHERE id = 1`);
    return this.commit(state, statements);
  }

  private async rollback(state: ProgressRow, requireBudget: (cost: TableMigrationBudget) => void) {
    requireBudget({ readRows: 16, writeRows: 1, extraBytes: 0 });
    const head = await this
      .sql`SELECT * FROM ee_table_heads WHERE migration_run_id = ${state.run_id} ORDER BY table_id LIMIT 1`.first<SharedHead>();
    if (!head)
      return this.commit(state, [
        this.sql`DELETE FROM ee_table_migration WHERE id = 1`,
      ]);

    const [pending] = JSON.parse(state.pending_ids) as string[];
    const records = head.table_id === pending ? state.after_position : head.row_count;
    requireBudget({ readRows: 16 + records * 8, writeRows: 16 + records * 32, extraBytes: 0 });

    const statements = [
      this.sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
        SELECT 1 FROM ee_table_heads WHERE table_id = ${head.table_id} AND migration_run_id = ${state.run_id} AND revision = ${head.revision})`,
    ];
    const indexes = JSON.parse(head.indexes_json) as SharedFieldIndex[];
    statements.push(
      ...indexes.map((index) => this.db.prepare(`DROP INDEX ${index.name}`)),
      this
        .sql`DELETE FROM ee_table_heads WHERE table_id = ${head.table_id} AND migration_run_id = ${state.run_id}`,
      this
        .sql`UPDATE ee_table_migration SET step = step + 1 WHERE id = 1`,
    );
    return this.commit(state, statements);
  }

  private async commit(
    state: ProgressRow,
    statements: PreparedStatementAdapter[],
  ) {
    try {
      await this.db.batch([
        this.sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
          SELECT 1 FROM ee_table_migration WHERE id = 1 AND run_id = ${state.run_id} AND phase = ${state.phase} AND step = ${state.step})`,
        ...statements,
      ]);
    } catch (error) {
      const latest = await this.state();
      if (latest?.run_id !== state.run_id || latest.step !== state.step)
        return progress(latest);
      throw error;
    }
    return this.status();
  }
}
