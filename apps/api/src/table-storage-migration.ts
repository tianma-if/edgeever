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
type DailyAllowance = Pick<TableMigrationBudget, "readRows" | "writeRows">;
export const D1_MIGRATION_DAILY_ALLOWANCE: DailyAllowance = { readRows: 1_000_000, writeRows: 25_000 };
export type TableEstimateCursor = { memoId: string; copiedRecords: number };
const zeroBudget = (): TableMigrationBudget => ({ readRows: 0, writeRows: 0, extraBytes: 0 });
const fits = (cost: TableMigrationBudget, budget: TableMigrationBudget) =>
  cost.readRows <= budget.readRows && cost.writeRows <= budget.writeRows && cost.extraBytes <= budget.extraBytes;

const estimateCopy = (source: LegacySource, table: TableDocument, offset: number, rows: number, copiedRecords: number, newIndexes?: number): TableMigrationBudget => {
  const total = table.records.length;
  const buildsIndexes = offset + rows >= total;
  const views = getTableViews(table).filter((view) => view.sorts[0] && !view.sorts[0].legacy);
  const indexes = newIndexes ?? (buildsIndexes ? Math.min(TABLE_VIEW_INDEX_LIMIT, views.length) : 0);
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
  scan_done: number;
  budget_day: string;
  planned_reads: number;
  planned_writes: number;
  charge?: DailyAllowance;
};

type LegacySource = {
  id: string;
  workspace_id: string;
  content_markdown: string;
};

const dailyAllowanceSpent = (state: ProgressRow, allowance: DailyAllowance) =>
  state.budget_day === new Date().toISOString().slice(0, 10) &&
  (state.planned_reads >= allowance.readRows || state.planned_writes >= allowance.writeRows);

const progress = (row: ProgressRow | null) => ({
  phase: row?.phase ?? "legacy",
  tablesCopied: row?.tables_copied ?? 0,
  rowsCopied: row?.rows_copied ?? 0,
  tableId: row ? ((JSON.parse(row.pending_ids) as string[])[0] ?? null) : null,
  afterPosition: row?.after_position ?? 0,
  ...(row && dailyAllowanceSpent(row, D1_MIGRATION_DAILY_ALLOWANCE)
    ? { paused: true, reason: "table_migration_budget_exhausted" } : {}),
});

export class SharedTableMigration {
  private readonly sql: ReturnType<typeof tableStatement>;
  private readonly store: SharedTableStore;

  constructor(private readonly db: DatabaseAdapter, private readonly automatic = false, private readonly dailyAllowance?: DailyAllowance) {
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

  private activationStatements() {
    return [
      this.sql`INSERT INTO ee_table_activation(id,run_id,tables_copied,rows_copied)
        SELECT m.id,m.run_id,(SELECT count(*) FROM ee_table_heads h WHERE h.migration_run_id=m.run_id),
          (SELECT coalesce(sum(h.row_count),0) FROM ee_table_heads h WHERE h.migration_run_id=m.run_id)
        FROM ee_table_migration m WHERE m.id=1 AND (m.phase='ready' OR
          (m.phase='copying' AND m.scan_done=1 AND m.pending_ids='[]' AND m.after_position=0))
          AND NOT EXISTS (SELECT 1 FROM ee_table_migration_dirty)
          AND NOT EXISTS (SELECT 1 FROM ee_table_migration_replay)`,
      this.sql`DELETE FROM ee_table_migration WHERE id=1 AND run_id=(SELECT run_id FROM ee_table_activation WHERE id=1)`,
    ];
  }

  async activate(automatic = false) {
    await this.db.batch(this.activationStatements());
    const status = await this.status();
    if (!automatic && status.phase !== "active")
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

    if (this.dailyAllowance && dailyAllowanceSpent(state, this.dailyAllowance)) {
      throw new AppError("table_migration_budget_exhausted", "The daily migration allowance is spent; the checkpoint resumes after UTC midnight", 409);
    }
    const requireBudget = (cost: TableMigrationBudget) => {
      if (this.dailyAllowance) state.charge = cost;
      if (budget && !fits(cost, budget)) throw new AppError("table_migration_budget_exhausted", "Insufficient read, write or storage allowance for this step", 409);
    };
    if (state.phase === "rolling_back") return this.rollback(state, requireBudget);

    const pending = JSON.parse(state.pending_ids) as string[];
    const tableId = pending[0];
    if (tableId) {
      requireBudget({ readRows: 16, writeRows: 1, extraBytes: 0 });
      // A write made after scanning freezes the previous body in the same
      // transaction. Continue the initial copy from that image until replay.
      const source = await this.sql`SELECT m.id,m.workspace_id,COALESCE(d.before_markdown,mc.content_markdown) AS content_markdown
        FROM memos m JOIN memo_contents mc ON mc.memo_id=m.id LEFT JOIN ee_table_migration_dirty d ON d.memo_id=m.id
        WHERE m.id=${tableId} AND (${state.after_position}=0 OR EXISTS (
          SELECT 1 FROM ee_table_heads h WHERE h.table_id=m.id AND h.migration_run_id=${state.run_id}))`.first<LegacySource>();
      const remaining = JSON.stringify(pending.slice(1));
      if (source && hasTableDocumentMarker(source.content_markdown)) {
        const document = this.parseSource(source);
        const count = Math.min(RECORD_BATCH, document.records.length - state.after_position);
        requireBudget(estimateCopy(source, document, state.after_position, count, state.rows_copied));
        return this.copy(state, source, document, remaining);
      }
      return this.commit(state, [
        this
          .sql`UPDATE ee_table_migration SET pending_ids = ${remaining}, after_position=0, rows_copied=rows_copied-${state.after_position}, step = step + 1 WHERE id = 1`,
      ]);
    }

    if (state.scan_done || state.phase === "ready") return this.catchUp(state, requireBudget);
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
        .sql`UPDATE ee_table_migration SET phase = ${phase}, scan_done=${Number(page.length < MEMO_BATCH)}, after_memo_id = ${afterMemoId},
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

  private async catchUp(state: ProgressRow, requireBudget: (cost: TableMigrationBudget) => void) {
    const sql = this.sql;
    requireBudget(SCAN_BUDGET);
    const target = await sql`SELECT r.memo_id AS id,m.workspace_id,r.markdown AS content_markdown
      FROM ee_table_migration_replay r JOIN memos m ON m.id=r.memo_id WHERE image='target'`.first<LegacySource>();
    if (!target) {
      const dirty = await sql`SELECT memo_id FROM ee_table_migration_dirty ORDER BY memo_id LIMIT 1`.first<{ memo_id: string }>();
      if (!dirty) return state.phase === "ready" ? progress(state) : this.commit(state, [
        sql`UPDATE ee_table_migration SET phase='ready',after_position=0,step=step+1 WHERE id=1`,
      ]);
      const id = dirty.memo_id;
      // Freeze the pair, then release the dirty marker, all in one transaction.
      // Concurrent writes will remember the target as their next before image.
      return this.commit(state, [
        sql`INSERT INTO ee_table_migration_replay(image,memo_id,markdown)
          SELECT 'before',m.id,CASE WHEN h.table_id IS NULL THEN '' ELSE d.before_markdown END
          FROM memos m JOIN ee_table_migration_dirty d ON d.memo_id=m.id
          LEFT JOIN ee_table_heads h ON h.table_id=m.id AND h.migration_run_id=${state.run_id} WHERE m.id=${id}`,
        sql`INSERT INTO ee_table_migration_replay(image,memo_id,markdown)
          SELECT 'target',m.id,COALESCE(mc.content_markdown,'') FROM memos m LEFT JOIN memo_contents mc ON mc.memo_id=m.id WHERE m.id=${id}`,
        sql`DELETE FROM ee_table_migration_dirty WHERE memo_id=${id}`,
        sql`UPDATE ee_table_migration SET phase='copying',scan_done=1,after_position=0,step=step+1 WHERE id=1`,
      ]);
    }
    const before = await sql`SELECT markdown FROM ee_table_migration_replay WHERE image='before' AND memo_id=${target.id}`.first<{markdown: string}>();
    const prior = before && hasTableDocumentMarker(before.markdown) ? this.parseSource({ ...target, content_markdown: before.markdown }) : null;
    const next = hasTableDocumentMarker(target.content_markdown) ? this.parseSource(target) : null;
    const offset = state.after_position;
    const statements = [sql`INSERT INTO ee_table_assertion SELECT 0 WHERE NOT EXISTS (
      SELECT 1 FROM ee_table_migration_replay WHERE image='target' AND memo_id=${target.id})`];
    let end = 0, complete = true;
    if (prior) {
      const head = await sql`SELECT * FROM ee_table_heads WHERE table_id=${target.id} AND migration_run_id=${state.run_id}`.first<SharedHead>();
      if (!head) return this.status();
      const batch = this.store.stageLegacyChanges(head, prior, next, offset, RECORD_BATCH);
      requireBudget(estimateCopy(target, next ?? prior, offset, batch.end - offset, state.rows_copied, batch.newIndexes));
      statements.push(...batch.statements);
      ({ end, complete } = batch);
    } else if (next) {
      requireBudget(estimateCopy(target, next, offset, Math.min(RECORD_BATCH, next.records.length - offset), state.rows_copied));
      const batch = this.store.stageLegacyBatch(target.workspace_id, target.id, next, offset, RECORD_BATCH, state.run_id);
      statements.push(...batch.statements);
      end = batch.end;
      complete = end === next.records.length;
    }
    if (complete) statements.push(sql`DELETE FROM ee_table_migration_replay`);
    statements.push(sql`UPDATE ee_table_migration SET after_position=${complete ? 0 : end},step=step+1,
      tables_copied=tables_copied+${complete ? Number(!!next)-Number(!!prior) : 0},
      rows_copied=rows_copied+${complete ? (next?.records.length ?? 0)-(prior?.records.length ?? 0) : 0}
      WHERE id=1`);
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
        ...(state.charge ? [this.sql`UPDATE ee_table_migration SET
          planned_reads=(CASE WHEN budget_day=date('now') THEN planned_reads ELSE 0 END)+${state.charge.readRows},
          planned_writes=(CASE WHEN budget_day=date('now') THEN planned_writes ELSE 0 END)+${state.charge.writeRows},
          budget_day=date('now') WHERE id=1`] : []),
        ...(this.automatic ? this.activationStatements() : []),
      ]);
    } catch (error) {
      const latest = await this.state();
      if (latest?.run_id !== state.run_id || latest.step !== state.step)
        return latest ? progress(latest) : this.status();
      throw error;
    }
    return this.status();
  }
}

/** Both runtime schedulers drive the same durable cursor. Overlapping ticks are
 * serialized by the step check in the transaction that publishes each batch. */
export async function runOnlineTableMigration(db: DatabaseAdapter, steps = 4, dailyAllowance?: DailyAllowance) {
  const migration = new SharedTableMigration(db, true, dailyAllowance);
  let state = await migration.status();
  if (state.phase === "legacy") state = await migration.start();
  for (let i = 0; i < steps && state.phase !== "active"; i++) {
    if (state.phase === "ready") {
      state = await migration.activate(true);
      if (state.phase === "active") break;
    }
    try {
      state = await migration.advance();
    } catch (error) {
      if (error instanceof AppError && error.code === "table_migration_budget_exhausted") {
        return { ...state, paused: true, reason: error.code };
      }
      throw error;
    }
  }
  return state;
}
