import { describe, expect, test } from "bun:test";
import { Base64 } from "js-base64";
import {
  addTableField,
  createDefaultTableDocument,
  getTableViews,
  saveTableViews,
  serializeTableDocument,
  updateTableCell,
} from "./table.ts";
import {
  TABLE_BASE_MARKER_PREFIX,
  TABLE_BASE_SCHEMA_VERSION,
  TABLE_BASE_TABLE_LIMIT,
  addTableToBase,
  createTableBaseDocument,
  hasTableBaseDocumentMarker,
  parseTableBaseDocument,
  removeTableFromBase,
  renameTableInBase,
  serializeTableBaseDocument,
  setActiveTableInBase,
  tableBaseFallbackMarkdown,
  tableBaseTableDocument,
  updateTableBaseTable,
} from "./table-base.ts";

const markerFor = (value) =>
  `<!-- ${TABLE_BASE_MARKER_PREFIX}${Base64.encodeURI(JSON.stringify(value))} -->`;

const layoutDocument = () => {
  const initial = createDefaultTableDocument();
  const view = getTableViews(initial)[0];
  return saveTableViews(initial, [{
    ...view,
    columns: [{ fieldId: "fld_status", width: 220 }, { fieldId: "fld_name", hidden: true }],
    groupBy: { fieldId: "fld_status", direction: "asc" },
    layout: "kanban",
  }]);
};

describe("multi-table base documents", () => {
  test("creates one default table and round-trips fields, records and a v3 layout view", () => {
    const base = createTableBaseDocument();
    expect(base.schemaVersion).toBe(TABLE_BASE_SCHEMA_VERSION);
    expect(base.schemaVersion).toBe(4);
    expect(base.tables).toHaveLength(1);
    expect(base.activeTableId).toBe(base.tables[0].id);
    expect(base.tables[0].id.startsWith("tbl_")).toBe(true);
    expect(base.tables[0].name).toBe("数据表 1");
    expect(tableBaseTableDocument(base.tables[0])).toEqual(createDefaultTableDocument());

    const enhanced = layoutDocument();
    expect(enhanced.schemaVersion).toBe(3);
    const layoutBase = createTableBaseDocument({
      tables: [{ id: "tbl_layout", name: "任务", document: enhanced }],
    });
    expect(layoutBase.activeTableId).toBe("tbl_layout");
    const roundTrip = parseTableBaseDocument(serializeTableBaseDocument(layoutBase));
    expect(roundTrip).toEqual(layoutBase);
    expect(roundTrip.tables[0].content).toBe(serializeTableDocument(enhanced));
    expect(tableBaseTableDocument(roundTrip.tables[0])).toEqual(enhanced);
  });

  test("round-trips several tables and preserves the active table", () => {
    let archive = addTableField(createDefaultTableDocument(), { id: "fld_owner", name: "负责人", type: "text" });
    archive = updateTableCell(archive, "rec_sample", "fld_name", "第二张表");
    const base = createTableBaseDocument({
      tables: [
        { id: "tbl_tasks", name: "任务", document: layoutDocument() },
        { id: "tbl_archive", name: "归档", document: archive },
      ],
    });
    const switched = setActiveTableInBase(base, "tbl_archive");
    expect(switched.activeTableId).toBe("tbl_archive");
    expect(base.activeTableId).toBe("tbl_tasks");

    const parsed = parseTableBaseDocument(serializeTableBaseDocument(switched));
    expect(parsed.tables.map((table) => table.id)).toEqual(["tbl_tasks", "tbl_archive"]);
    expect(parsed.tables.map((table) => table.name)).toEqual(["任务", "归档"]);
    expect(parsed.activeTableId).toBe("tbl_archive");
    expect(tableBaseTableDocument(parsed.tables[1])).toEqual(archive);
  });

  test("renders a visible section per table while the marker stays out of the readable markdown", () => {
    const base = createTableBaseDocument({
      tables: [
        { name: "任务", document: layoutDocument() },
        { name: "归档", document: createDefaultTableDocument() },
      ],
    });
    const markdown = serializeTableBaseDocument(base);
    expect(markdown.startsWith(`<!-- ${TABLE_BASE_MARKER_PREFIX}`)).toBe(true);
    expect(markdown).toContain(TABLE_BASE_MARKER_PREFIX);
    expect(hasTableBaseDocumentMarker(markdown)).toBe(true);

    const fallback = tableBaseFallbackMarkdown(base);
    expect(fallback).toContain("## 任务");
    expect(fallback).toContain("## 归档");
    expect(fallback).toContain("| 名称 | 状态 | 日期 |");
    expect(fallback).toContain("| 示例记录 | 未开始 |  |");
    expect(fallback).not.toContain(TABLE_BASE_MARKER_PREFIX);
    expect(fallback).not.toContain("edgeever-table-v1");
    expect(fallback).not.toContain(markdown.split(" -->")[0]);
    expect(markdown.slice(markdown.indexOf("## 任务"))).not.toContain(TABLE_BASE_MARKER_PREFIX);
    expect(hasTableBaseDocumentMarker(fallback)).toBe(false);
    expect(parseTableBaseDocument(fallback)).toBeNull();
    expect(tableBaseFallbackMarkdown(parseTableBaseDocument(markdown))).toBe(fallback);
  });

  test("rejects missing, corrupt and wrongly versioned markers", () => {
    expect(hasTableBaseDocumentMarker("| 名称 |\n| --- |")).toBe(false);
    expect(parseTableBaseDocument("| 名称 |\n| --- |")).toBeNull();
    expect(parseTableBaseDocument("")).toBeNull();
    expect(parseTableBaseDocument(null)).toBeNull();

    const valid = serializeTableBaseDocument(createTableBaseDocument());
    const corrupt = valid.replace(new RegExp(`${TABLE_BASE_MARKER_PREFIX}[^ ]+`), `${TABLE_BASE_MARKER_PREFIX}not-json`);
    expect(hasTableBaseDocumentMarker(corrupt)).toBe(true);
    expect(parseTableBaseDocument(corrupt)).toBeNull();

    const base = createTableBaseDocument();
    expect(parseTableBaseDocument(markerFor({ ...base, schemaVersion: 3 }))).toBeNull();
    expect(parseTableBaseDocument(markerFor({ ...base, schemaVersion: "4" }))).toBeNull();
    expect(parseTableBaseDocument(markerFor({ schemaVersion: 4, tables: [], activeTableId: "tbl_a" }))).toBeNull();
    expect(parseTableBaseDocument(markerFor({ schemaVersion: 4, tables: [{ name: "空" }] }))).not.toBeNull();
  });

  test("falls back to the first table, normalizes names and truncates past the limit", () => {
    const content = serializeTableDocument(createDefaultTableDocument());
    const tables = Array.from({ length: 25 }, (_, index) => ({
      id: `tbl_${index}`,
      name: `表 ${index}`,
      content,
    }));
    const truncated = parseTableBaseDocument(markerFor({ schemaVersion: 4, tables, activeTableId: "tbl_24" }));
    expect(truncated.tables).toHaveLength(TABLE_BASE_TABLE_LIMIT);
    expect(truncated.activeTableId).toBe("tbl_0");
    expect(truncated.tables.at(-1).name).toBe(`表 ${TABLE_BASE_TABLE_LIMIT - 1}`);

    const normalized = parseTableBaseDocument(markerFor({
      schemaVersion: 4,
      tables: [
        { id: "tbl_a", name: "  ", content },
        { id: "tbl_b", name: " 归档 ", content },
        { id: "tbl_c", name: null, content },
      ],
      activeTableId: "tbl_missing",
    }));
    expect(normalized.tables.map((table) => table.name)).toEqual(["数据表 1", "归档", "数据表 3"]);
    expect(normalized.activeTableId).toBe("tbl_a");

    const seeded = createTableBaseDocument({
      tables: Array.from({ length: 25 }, (_, index) => ({
        name: `表 ${index}`,
        document: createDefaultTableDocument(),
      })),
    });
    expect(seeded.tables).toHaveLength(TABLE_BASE_TABLE_LIMIT);
  });

  test("adds, renames, removes, updates and activates tables with the documented errors", () => {
    const base = createTableBaseDocument();
    const added = addTableToBase(base);
    expect(added.tables).toHaveLength(2);
    expect(added.tables[1].name).toBe("数据表 2");
    expect(added.activeTableId).toBe(base.activeTableId);
    expect(tableBaseTableDocument(added.tables[1])).toEqual(createDefaultTableDocument());
    expect(addTableToBase(base, "  归档  ").tables[1].name).toBe("归档");
    const renamedDefault = renameTableInBase(base, base.tables[0].id, "数据表 2");
    expect(addTableToBase(renamedDefault).tables[1].name).toBe("数据表 3");

    const renamed = renameTableInBase(base, base.tables[0].id, "  任务清单  ");
    expect(renamed.tables[0].name).toBe("任务清单");
    expect(base.tables[0].name).toBe("数据表 1");
    expect(renameTableInBase(renamed, base.tables[0].id, "   ")).toBe(renamed);
    expect(renameTableInBase(base, "tbl_missing", "任务")).toBe(base);
    expect(() => renameTableInBase(added, base.tables[0].id, "数据表 2")).toThrow("duplicate table name");
    expect(() => renameTableInBase(added, base.tables[0].id, "  数据表 2  ")).toThrow("duplicate table name");

    const removed = removeTableFromBase(added, added.tables[0].id);
    expect(removed.tables.map((table) => table.id)).toEqual([added.tables[1].id]);
    const activeSecond = setActiveTableInBase(added, added.tables[1].id);
    expect(activeSecond.activeTableId).toBe(added.tables[1].id);
    expect(removeTableFromBase(activeSecond, added.tables[1].id).activeTableId).toBe(added.tables[0].id);
    expect(removeTableFromBase(added, "tbl_missing")).toBe(added);
    expect(() => removeTableFromBase(base, base.tables[0].id)).toThrow("cannot remove the last table");

    const updatedDocument = updateTableCell(createDefaultTableDocument(), "rec_sample", "fld_name", "更新后");
    const updated = updateTableBaseTable(base, base.tables[0].id, updatedDocument);
    expect(updated.tables[0].content).toBe(serializeTableDocument(updatedDocument));
    expect(tableBaseTableDocument(updated.tables[0])).toEqual(updatedDocument);
    expect(updateTableBaseTable(base, "tbl_missing", updatedDocument)).toBe(base);
    expect(base.tables[0].content).toBe(serializeTableDocument(createDefaultTableDocument()));

    expect(setActiveTableInBase(added, added.tables[1].id).activeTableId).toBe(added.tables[1].id);
    expect(setActiveTableInBase(added, "tbl_missing")).toBe(added);

    let full = base;
    for (let index = 0; index < TABLE_BASE_TABLE_LIMIT - 1; index += 1) full = addTableToBase(full);
    expect(full.tables).toHaveLength(TABLE_BASE_TABLE_LIMIT);
    expect(() => addTableToBase(full)).toThrow("table base table limit reached");
  });

  test("keeps a base whose nested table content is plain markdown and reports it in the fallback", () => {
    const base = createTableBaseDocument();
    const plainContent = "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 2 |";
    const broken = {
      ...base,
      tables: [...base.tables, { id: "tbl_plain", name: "普通表格", content: plainContent }],
    };
    const parsed = parseTableBaseDocument(serializeTableBaseDocument(broken));
    expect(parsed).toEqual(broken);
    expect(tableBaseTableDocument(parsed.tables[0])).not.toBeNull();
    expect(tableBaseTableDocument(parsed.tables[1])).toBeNull();
    const fallback = tableBaseFallbackMarkdown(parsed);
    expect(fallback).toContain("## 普通表格");
    expect(fallback).toContain("> 该数据表暂时无法解析");
    expect(fallback).not.toContain("| 苹果 | 2 |");
    expect(fallback).toContain("| 名称 | 状态 | 日期 |");
  });
});