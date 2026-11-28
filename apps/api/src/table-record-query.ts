import type { DatabaseAdapter } from "./storage-contract";
import { AppError } from "./app-error";
import {
  createTableSortKey,
  isValidTypedTableFilter,
  TABLE_VIEW_FILTER_LIMIT,
  type TableDocument,
  type TableField,
} from "../../../packages/shared/src/table";
import { bindQueryValue } from "./table-query-sql";
import { tableContainsSql } from "./table-query-contains";
const bad = () => new AppError("bad_request", "Invalid table query", 400);
const unsupported = () =>
  new AppError(
    "table_query_not_supported",
    "This table storage does not support the requested view",
    400,
  );
const conflict = () =>
  new AppError(
    "revision_conflict",
    "Cursor does not match the query or revision",
    409,
  );
export type IndexedSort = {
  sql: string;
  indexSql?: string;
  encode: (v: any) => number;
};
type SelectPartition = {
  predicate: string;
  value: number | null;
  rank: number;
};
type Key = {
  fieldId: string;
  partitions?: SelectPartition[];
  sql: string;
  direction: "ASC" | "DESC";
  nonNull: boolean;
  indexed?: IndexedSort;
};
type Cursor = {
  revision: number;
  signature: string;
  keys: (string | number | null)[];
  position: number;
};
export type QuerySnapshot = {
  row_count: number;
  header_json: string;
  [key: string]: unknown;
};
export type QueryLayout = {
  tableSql: string;
  selectSql: string;
  memoPredicate: string;
  cell: (field: TableField) => string;
  cellsJson: (row: any) => string;
  recordId: (row: any) => string;
  normalizedCell?: (field: TableField) => string;
  groupedSelectPages?: boolean;
  fieldIndexSql?: (
    fieldId: string,
    direction: "ASC" | "DESC",
  ) => string | undefined;
  indexedSort?: (
    field: TableField,
    direction: "asc" | "desc",
    view: any,
  ) => IndexedSort | undefined;
};
export function compileView(
  header: TableDocument,
  view: any,
  week: unknown,
  cell: (field: TableField) => string,
  bind: (value: unknown) => string,
  cursor?: Cursor,
  indexedSort?: QueryLayout["indexedSort"],
  normalizedCell?: QueryLayout["normalizedCell"],
) {
  if (
    !view ||
    !["all", "any"].includes(view.match) ||
    !Array.isArray(view.filters) ||
    view.filters.length > TABLE_VIEW_FILTER_LIMIT ||
    !Array.isArray(view.sorts)
  )
    throw bad();
  const fields = new Map(header.fields.map((f) => [f.id, f]));
  // Field IDs are logical data (UUIDs contain hyphens), never SQL identifiers.
  // Layouts resolve them through the server-owned storage expressions.
  const field = (id: string) => {
    const f = fields.get(id);
    if (!f) throw bad();
    return f;
  };
  const filters = view.filters.map((rule: any) => {
    if (!rule) throw bad();
    if (rule.legacy && !fields.has(rule.fieldId)) return "1";
    const f = field(rule.fieldId);
    if (rule.legacy) {
      if (
        !["eq", "contains", "empty", "notEmpty"].includes(rule.operator) ||
        (rule.value !== undefined && typeof rule.value !== "string")
      )
        throw bad();
    } else if (!isValidTypedTableFilter(f, rule)) throw bad();
    const x = cell(f),
      empty = `(${x} IS NULL OR ${x}=''${f.type === "attachment" ? ` OR json_array_length(${x})=0` : ""})`;
    const effectiveEmpty =
      rule.legacy && f.type === "checkbox" ? `(${x} IS NOT 1)` : empty;
    if (rule.operator === "empty") return effectiveEmpty;
    if (rule.operator === "notEmpty") return `(NOT ${effectiveEmpty})`;
    if (
      (rule.legacy && f.type === "attachment") ||
      ["contains", "notContains"].includes(rule.operator)
    ) {
      if (!normalizedCell) throw unsupported();
      const needle = String(rule.value ?? "")
          .trim()
          .toLocaleLowerCase(),
        expected = bind(needle),
        normalized = normalizedCell(f);
      const contains =
        f.type === "attachment"
          ? `EXISTS(SELECT 1 FROM json_each(CASE WHEN ${x} IS NULL THEN '[]' ELSE ${normalized} END) a WHERE ${rule.operator === "eq" ? `a.value=${expected}` : tableContainsSql("a.value", needle, expected, bind)})`
          : tableContainsSql(
              `COALESCE(${normalized},'')`,
              needle,
              expected,
              bind,
            );
      return rule.operator === "notContains"
        ? `(NOT (${contains}))`
        : `(${contains})`;
    }
    if (rule.legacy && rule.operator === "eq") {
      if (f.type === "number") {
        const n = Number(rule.value);
        return Number.isFinite(n) ? `(${x} IS ${bind(n)})` : "0";
      }
      if (f.type === "checkbox")
        return `(${x} IS${rule.value === "true" ? "" : " NOT"} 1)`;
      return `(COALESCE(${x},'')=${bind(rule.value ?? "")})`;
    }
    const validDate =
      f.type === "date"
        ? `length(${x})=10 AND date(${x},'+0 days')=${x} AND `
        : "";
    if (rule.operator === "thisWeek") {
      if (
        !Array.isArray(week) ||
        week.length !== 2 ||
        week.some(
          (v) =>
            !isValidTypedTableFilter(f, {
              fieldId: f.id,
              operator: "eq",
              value: v,
            }),
        ) ||
        week[0] > week[1]
      )
        throw bad();
      return `(${validDate}${x} BETWEEN ${bind(week[0])} AND ${bind(week[1])})`;
    }
    if (rule.operator === "between")
      return `(${validDate}${x} BETWEEN ${bind(rule.value)} AND ${bind(rule.endValue)})`;
    let op = (
      {
        eq: "IS",
        neq: "IS NOT",
        lt: "<",
        lte: "<=",
        gt: ">",
        gte: ">=",
      } as Record<string, string>
    )[rule.operator];
    if (!op) throw unsupported();
    let value =
      typeof rule.value === "boolean" ? Number(rule.value) : rule.value;
    // Two independent same-direction bounds can make SQLite choose the broad
    // original filter as its seek point on every page. Tighten that necessary
    // numeric bound too; the unchanged lexicographic predicate handles ties.
    const leading = view.sorts[0],
      key = cursor?.keys[0];
    if (
      view.match === "all" &&
      f.type === "number" &&
      leading?.fieldId === f.id &&
      typeof key === "number" &&
      typeof value === "number"
    ) {
      if (
        leading.direction === "asc" &&
        ["gt", "gte"].includes(rule.operator) &&
        key > value
      ) {
        op = ">=";
        value = key;
      }
      if (
        leading.direction === "desc" &&
        ["lt", "lte"].includes(rule.operator) &&
        key < value
      ) {
        op = "<=";
        value = key;
      }
    }
    return `(${validDate}${x} ${op} ${bind(value)})`;
  });
  const seen = new Set<string>();
  const keys: Key[] = view.sorts
    .filter((rule: any) => !(rule?.legacy && !fields.has(rule.fieldId)))
    .map((rule: any) => {
      if (!rule) throw bad();
      const f = field(rule.fieldId);
      if (seen.has(f.id) || !["asc", "desc"].includes(rule.direction))
        throw bad();
      seen.add(f.id);
      const indexed =
        !rule.legacy && f.type === "select" && view.sorts.length === 1
          ? indexedSort?.(f, rule.direction, view)
          : undefined;
      let sql = indexed?.sql ?? cell(f);
      let partitions: SelectPartition[] | undefined;
      if (f.type === "select" && !rule.legacy && !indexed) {
        const options = f.options ?? [];
        // Constant JSON paths preserve arbitrary option text without embedding it
        // in SQL; SQLite can hoist these parameter-only lookups out of the row loop.
        const optionsParam = options.length
          ? bind(JSON.stringify(options))
          : undefined;
        // A few finite ranks can continue by position without sorting the same
        // filtered rows again. Larger option sets retain the ordinary query plan.
        if (options.length <= 2) {
          const ordinals = options.map((_, i) => i);
          if (rule.direction === "desc") ordinals.reverse();
          partitions = [
            ...ordinals.map((value, rank) => ({
              value,
              rank,
              predicate: `${sql} IS json_extract(${optionsParam},'$[${value}]')`,
            })),
            {
              value: null,
              rank: options.length,
              predicate: options.length
                ? `(${sql} IS NULL OR ${sql} NOT IN (SELECT value FROM json_each(${optionsParam})))`
                : "1",
            },
          ];
        }
        sql = options.length
          ? `CASE ${sql} ${options.map((_, i) => `WHEN ${optionsParam}->>'$[${i}]' THEN ${i}`).join(" ")} ELSE NULL END`
          : "NULL";
      } else if (!indexed && ["date", "text", "url", "select"].includes(f.type))
        sql = `NULLIF(${sql},'') COLLATE BINARY`;
      else if (f.type === "attachment") {
        // Legacy display order is attachment count, then filenames in stored order.
        sql = `CASE WHEN json_array_length(${sql})>0 THEN printf('%04d',json_array_length(${sql}))||' '||(SELECT group_concat(json_extract(a.value,'$.filename'),' ') FROM json_each(${sql}) a) ELSE NULL END COLLATE BINARY`;
      } else if (!indexed && !["number", "checkbox"].includes(f.type))
        throw unsupported();
      return {
        fieldId: f.id,
        sql,
        indexed,
        partitions,
        direction: indexed ? "ASC" : rule.direction.toUpperCase(),
        nonNull:
          !!indexed ||
          (f.type === "number" &&
            view.match === "all" &&
            view.filters.some(
              (filter: any) =>
                filter.fieldId === f.id &&
                ["eq", "lt", "lte", "gt", "gte", "notEmpty"].includes(
                  filter.operator,
                ),
            )),
      };
    });
  return {
    predicate: filters.length
      ? "(" + filters.join(view.match === "all" ? " AND " : " OR ") + ")"
      : "1",
    keys,
    signature: JSON.stringify({
      filters: view.filters,
      sorts: view.sorts,
      match: view.match,
      week: week ?? null,
    }),
  };
}
/** Read disjoint option/value ranges; only the selected page carries cell JSON. */
function groupedSelectPage(
  keys: Key[],
  cursor: Cursor | undefined,
  source: string,
  layout: QueryLayout,
  where: string[],
  bind: (value: unknown) => string,
) {
  const partitions = keys[0].partitions!;
  const start = cursor
    ? partitions.findIndex((part) => part.value === cursor.keys[0])
    : 0;
  const names: string[] = [],
    ctes: string[] = [];
  const suffixOrder = keys
    .slice(1)
    .map((key) => `${key.sql} ${key.direction} NULLS LAST`)
    .concat("r.position ASC")
    .join(",");
  const add = (partition: SelectPartition, extra: string) => {
    const name = "grouped_page_" + names.length;
    const remaining = names.length
      ? `max(0,51-${names.map((n) => `(SELECT count(*) FROM ${n})`).join("-")})`
      : "51";
    ctes.push(`${name} AS MATERIALIZED (SELECT r.position,${keys.map((key, i) => `${key.sql} AS _s${i}`).join(",")},${partition.rank} AS _rank FROM ${source} r
   WHERE ${where.join(" AND ")} AND (${partition.predicate})${extra} ORDER BY ${suffixOrder} LIMIT ${remaining})`);
    names.push(name);
  };
  for (let i = start; i < partitions.length; i++) {
    const partition = partitions[i];
    if (cursor && i === start) {
      const position = bind(cursor.position);
      if (keys.length === 1) {
        add(partition, ` AND r.position>${position}`);
        continue;
      }
      const key = keys[1],
        value = cursor.keys[1];
      if (value === null) {
        add(partition, ` AND ${key.sql} IS NULL AND r.position>${position}`);
        continue;
      }
      const bound = bind(value);
      // Equality and later values are separate scalar seeks. A combined OR
      // predicate can scan all earlier positions in a large equal-value group.
      add(partition, ` AND ${key.sql} IS ${bound} AND r.position>${position}`);
      add(
        partition,
        ` AND ${key.sql} ${key.direction === "ASC" ? ">" : "<"} ${bound}`,
      );
      add(partition, ` AND ${key.sql} IS NULL`);
    } else add(partition, "");
  }
  const pageOrder = [
    "p._rank ASC",
    ...keys
      .slice(1)
      .map((key, i) => `p._s${i + 1} ${key.direction} NULLS LAST`),
    "p.position ASC",
  ];
  return `WITH ${ctes.join(",")} SELECT r.position,${layout.selectSql},${keys.map((_, i) => `p._s${i} AS _s${i}`).join(",")}
  FROM (${names.map((name) => "SELECT * FROM " + name).join(" UNION ALL ")}) p CROSS JOIN ${layout.tableSql} r
  WHERE r.position=p.position AND (${where[0]}) ORDER BY ${pageOrder.join(",")} LIMIT 51`;
}
/** Query execution is independent of physical naming and runtime bindings. */
export abstract class TableRecordQuery {
  constructor(readonly db: DatabaseAdapter) {}
  protected abstract head(
    workspace: string,
    id: string,
  ): Promise<{ revision: number }>;
  protected abstract snapshot(
    id: string,
    revision: number,
  ): Promise<QuerySnapshot | null>;
  protected abstract layout(
    id: string,
    header: TableDocument,
    snapshot?: QuerySnapshot,
    afterPosition?: number,
  ): Promise<QueryLayout>;
  protected async validateSnapshot(
    _workspace: string,
    _id: string,
    _revision: number,
    _snapshot: QuerySnapshot,
  ): Promise<void> {}
  async query(workspace: string, id: string, input: any): Promise<string> {
    if (!input || typeof input !== "object") throw bad();
    const h = await this.head(workspace, id);
    let cursor: Cursor | undefined;
    if (input.cursor !== undefined) {
      try {
        cursor = JSON.parse(input.cursor);
      } catch {
        throw bad();
      }
      if (
        !cursor ||
        !Number.isSafeInteger(cursor.revision) ||
        cursor.revision < 1 ||
        !Number.isSafeInteger(cursor.position) ||
        cursor.position < 1 ||
        !Array.isArray(cursor.keys) ||
        cursor.keys.some(
          (v) => v !== null && typeof v !== "string" && typeof v !== "number",
        )
      )
        throw bad();
    }
    const revision = cursor?.revision ?? input.revision ?? h.revision;
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > h.revision
    )
      throw conflict();
    if (input.revision !== undefined && input.revision !== revision)
      throw conflict();
    const commit = await this.snapshot(id, revision);
    if (!commit) throw conflict();
    const header = JSON.parse(commit.header_json),
      layout = await this.layout(id, header, commit, cursor?.position ?? 0);
    const params: unknown[] = [],
      bind = (value: unknown) => bindQueryValue(params, value);
    const q = compileView(
      header,
      input.view,
      input.week,
      layout.cell,
      bind,
      cursor,
      layout.indexedSort,
      layout.normalizedCell,
    );
    q.signature = JSON.stringify([
      id,
      commit.table_name ?? null,
      commit.schema_revision ?? null,
      q.signature,
    ]);
    if (
      cursor &&
      (cursor.signature !== q.signature || cursor.keys.length !== q.keys.length)
    )
      throw conflict();
    const where = [
      layout.memoPredicate,
      "r.created_revision<=" + bind(revision),
      "r.position<=" + bind(commit.position_max ?? commit.row_count),
      q.predicate,
    ];
    const secondaryIndex =
      q.keys.length === 2
        ? layout.fieldIndexSql?.(q.keys[1].fieldId, q.keys[1].direction)
        : undefined;
    const grouped = !!(
      layout.groupedSelectPages &&
      q.keys[0]?.partitions &&
      (q.keys.length === 1 || secondaryIndex) &&
      (!cursor ||
        q.keys[0].partitions.some((part) => part.value === cursor.keys[0]))
    );
    let tableSql = layout.tableSql,
      groupedTableSql: string | undefined;
    if (q.keys.length) {
      // SQLite can flatten this projection. Keep long sort expressions out of
      // every repeated cursor prefix without materializing all matching rows.
      if (grouped)
        groupedTableSql = `(SELECT r.*,${q.keys.map((k, i) => `${k.sql} AS _s${i}`).join(",")} FROM ${tableSql} r${secondaryIndex ? " INDEXED BY " + secondaryIndex : ""})`;
      const sourceIndex =
        q.keys[0]?.indexed?.indexSql ??
        layout.fieldIndexSql?.(q.keys[0].fieldId, q.keys[0].direction);
      tableSql = `(SELECT r.*,${q.keys.map((k, i) => `${k.sql} AS _s${i}`).join(",")} FROM ${tableSql} r${sourceIndex ? " INDEXED BY " + sourceIndex : ""})`;
      q.keys.forEach((k, i) => {
        k.sql = "r._s" + i;
      });
    }
    let indexedSeek: { key: string; position: string } | undefined;
    if (cursor && q.keys.length === 1 && q.keys[0].indexed) {
      indexedSeek = {
        key: bind(q.keys[0].indexed.encode(cursor.keys[0])),
        position: bind(cursor.position),
      };
    } else if (cursor && !grouped) {
      // Reuse each cursor key across lexicographic prefixes. Rebinding every
      // prefix uses O(sort-count squared) variables and exceeds D1's limit.
      const keyParams = cursor.keys.map(bind);
      const alternatives: string[] = [];
      for (let i = 0; i < q.keys.length; i++) {
        if (cursor.keys[i] === null) continue;
        const equal = q.keys
          .slice(0, i)
          .map((k, j) => `${k.sql} IS ${keyParams[j]}`);
        alternatives.push(
          "(" +
            [
              ...equal,
              `(${q.keys[i].sql} ${q.keys[i].direction === "ASC" ? ">" : "<"} ${keyParams[i]} OR ${q.keys[i].sql} IS NULL)`,
            ].join(" AND ") +
            ")",
        );
      }
      params.push(cursor.position);
      alternatives.push(
        "(" +
          [
            ...q.keys.map((k, i) => `${k.sql} IS ${keyParams[i]}`),
            "r.position>?" + params.length,
          ].join(" AND ") +
          ")",
      );
      where.push("(" + alternatives.join(" OR ") + ")");
      // Redundant leading-key bound gives SQLite a seek point rather than scanning prior pages.
      if (q.keys.length) {
        const k = q.keys[0],
          v = cursor.keys[0];
        if (v === null) where.push(`${k.sql} IS NULL`);
        else
          where.push(
            `(${k.sql} ${k.direction === "ASC" ? ">=" : "<="} ${keyParams[0]}${k.nonNull ? "" : ` OR ${k.sql} IS NULL`})`,
          );
      }
    }
    const order = [
      ...q.keys.map(
        (k) => `${k.sql} ${k.direction}${k.indexed ? "" : " NULLS LAST"}`,
      ),
      "r.position ASC",
    ];
    const pageFrom = `FROM ${tableSql} r WHERE ${where.join(" AND ")} ORDER BY ${order.join(",")} LIMIT 51`;
    let sql: string;
    if (grouped) {
      sql = groupedSelectPage(
        q.keys,
        cursor,
        groupedTableSql!,
        layout,
        where,
        bind,
      );
    } else if (indexedSeek) {
      const select = `SELECT r.position,${layout.selectSql},${q.keys[0].sql} AS _s0 FROM ${tableSql} r WHERE ${where.join(" AND ")}`;
      // Disjoint streams give SQLite scalar seeks on the expression index and
      // position, avoiding a row-value comparison that scans previous ranks.
      const equalPage = `${select} AND ${q.keys[0].sql}=${indexedSeek.key} AND r.position>${indexedSeek.position} ORDER BY r.position LIMIT 51`;
      sql = `SELECT * FROM (${equalPage}) UNION ALL ${select} AND ${q.keys[0].sql}>${indexedSeek.key} ORDER BY _s0 ASC,position ASC LIMIT 51`;
    } else {
      sql = `SELECT r.position,${layout.selectSql}${q.keys.map((k, i) => `,${k.sql} AS _s${i}`).join("")} ${pageFrom}`;
    }
    let fetched: any[];
    let matched: number | undefined;
    try {
      fetched = (
        await this.db
          .prepare(sql)
          .bind(...params)
          .all<any>()
      ).results;
    } catch (error) {
      // A concurrent schema switch can retire an index referenced by this query.
      // Translate that race into the same refresh contract as a stale cursor.
      await this.validateSnapshot(workspace, id, revision, commit);
      throw error;
    }
    if (input.includeTotal === true && !cursor) {
      if (input.view.filters.length === 0) matched = commit.row_count;
      else {
        // A view needs one exact count for its label. Continuation pages never
        // count again, and sorting cannot add bind parameters or work to COUNT.
        const values: unknown[] = [],
          countBind = (value: unknown) => bindQueryValue(values, value);
        const predicate = compileView(
          header,
          { ...input.view, sorts: [] },
          input.week,
          layout.cell,
          countBind,
          undefined,
          undefined,
          layout.normalizedCell,
        ).predicate;
        const memoPredicate = layout.memoPredicate;
        const countSql = `SELECT COUNT(*) AS matched FROM ${layout.tableSql} r WHERE ${memoPredicate} AND r.created_revision<=${countBind(revision)} AND r.position<=${countBind(commit.position_max ?? commit.row_count)} AND (${predicate})`;
        matched = (await this.db
          .prepare(countSql)
          .bind(...values)
          .first<{ matched: number }>())!.matched;
      }
    }
    await this.validateSnapshot(workspace, id, revision, commit);
    const rows = fetched.slice(0, 50),
      last = rows.at(-1);
    let next: string | null = null;
    if (fetched.length > 50) {
      const cells = JSON.parse(layout.cellsJson(last));
      const keys = q.keys.map((key) => {
        const field = header.fields.find(
          (f: TableField) => f.id === key.fieldId,
        )!;
        const rule = input.view.sorts.find(
          (sort: any) => sort.fieldId === key.fieldId,
        );
        return createTableSortKey(
          field,
          rule.legacy === true,
        )(cells[field.id] ?? null);
      });
      next = JSON.stringify({
        revision,
        signature: q.signature,
        keys,
        position: last.position,
      });
    }
    return (
      '{"revision":' +
      revision +
      ',"schemaRevision":' +
      (commit.schema_revision ?? 1) +
      ',"generation":' +
      JSON.stringify(commit.table_name ?? null) +
      ',"positions":' +
      JSON.stringify(rows.map((r) => r.position)) +
      ',"sourceRowCount":' +
      commit.row_count +
      (matched === undefined ? "" : ',"matchedRowCount":' + matched) +
      ',"header":' +
      commit.header_json +
      ',"records":[' +
      rows
        .map(
          (r) =>
            '{"id":' +
            JSON.stringify(layout.recordId(r)) +
            ',"cells":' +
            layout.cellsJson(r) +
            "}",
        )
        .join(",") +
      '],"next":' +
      JSON.stringify(next) +
      "}"
    );
  }
}
