import { describe, expect, test } from "bun:test";
import { Base64 } from "js-base64";
import {
  addTableField,
  addTableRecord,
  createDefaultTableDocument,
  getTableViews,
  parseTableDocument,
  saveTableViews,
  serializeTableDocument,
  updateTableCell,
} from "./table.ts";
import { tableBaseTableDocument, createTableBaseDocument } from "./table-base.ts";
import { computeTableBase, computeTableRecords } from "./table-base-compute.ts";

const STAMP = "2026-11-01T00:00:00.000Z";

const emptyTable = () => ({ ...createDefaultTableDocument(), fields: [], records: [] });

const row = (document, id, cells, now = STAMP) => {
  let next = addTableRecord(document, { id, now });
  for (const [fieldId, value] of Object.entries(cells)) next = updateTableCell(next, id, fieldId, value, { now });
  return next;
};

const timeTable = () => {
  let document = emptyTable();
  document = addTableField(document, { id: "fld_name", name: "任务", type: "text" });
  document = addTableField(document, { id: "fld_created", name: "创建时间", type: "createdTime" });
  document = addTableField(document, { id: "fld_updated", name: "更新时间", type: "updatedTime" });
  document = row(document, "rec_1", { fld_name: "任务甲" }, "2026-11-02T03:04:05.000Z");
  document = updateTableCell(document, "rec_1", "fld_name", "任务乙", { now: "2026-11-03T00:00:00.000Z" });
  return document;
};

describe("table base computation", () => {
  test("exposes record timestamps through createdTime and updatedTime fields", () => {
    const base = createTableBaseDocument({ tables: [{ id: "tbl_tasks", name: "任务表", document: timeTable() }] });
    const result = computeTableBase(base);
    expect(result.errors).toEqual([]);
    const record = result.tables.get("tbl_tasks").records[0];
    expect(record.cells.fld_created).toBe("2026-11-02T03:04:05.000Z");
    expect(record.cells.fld_updated).toBe("2026-11-03T00:00:00.000Z");

    // Stored content is never mutated by the compute pass.
    const stored = tableBaseTableDocument(base.tables[0]);
    expect(stored.records[0].cells.fld_created).toBeNull();
    expect(stored.records[0].cells.fld_updated).toBeNull();

    let legacy = emptyTable();
    legacy = addTableField(legacy, { id: "fld_created", name: "创建时间", type: "createdTime" });
    legacy = addTableField(legacy, { id: "fld_updated", name: "更新时间", type: "updatedTime" });
    legacy = addTableRecord(legacy, "rec_legacy");
    delete legacy.records[0].createdAt;
    delete legacy.records[0].updatedAt;
    const legacyBase = createTableBaseDocument({ tables: [{ id: "tbl_legacy", name: "旧表", document: legacy }] });
    const legacyRecord = computeTableBase(legacyBase).tables.get("tbl_legacy").records[0];
    expect(legacyRecord.cells.fld_created).toBeNull();
    expect(legacyRecord.cells.fld_updated).toBeNull();
  });

  test("computeTableRecords returns one table plus shared errors", () => {
    const base = createTableBaseDocument({ tables: [{ id: "tbl_tasks", name: "任务表", document: timeTable() }] });
    const tasks = computeTableRecords(base, "tbl_tasks");
    expect(tasks.records).toHaveLength(1);
    expect(tasks.records[0].cells.fld_created).toBe("2026-11-02T03:04:05.000Z");
    expect(tasks.errors).toEqual([]);

    const missing = computeTableRecords(base, "tbl_missing");
    expect(missing.records).toEqual([]);
    expect(missing.errors).toContain("数据表不存在");
  });

  test("skips tables whose content cannot be parsed", () => {
    const base = createTableBaseDocument({
      tables: [{ id: "tbl_broken", name: "坏表", document: timeTable() }],
    });
    const broken = { ...base, tables: [{ ...base.tables[0], content: "plain markdown without a marker" }] };
    const result = computeTableBase(broken);
    expect(result.tables.size).toBe(0);
    expect(result.errors).toEqual(["数据表「坏表」内容无法解析"]);
  });

  test("round-trips every layout and degrades unknown layouts to the grid", () => {
    const document = createDefaultTableDocument();
    const [view] = getTableViews(document);
    const kanban = saveTableViews(document, [
      { ...view, layout: "kanban", groupBy: { fieldId: "fld_status", direction: "asc" } },
    ]);
    for (const layout of ["grid", "kanban", "calendar", "gallery", "gantt"]) {
      const saved = saveTableViews(document, [
        layout === "kanban" ? { ...view, layout, groupBy: { fieldId: "fld_status", direction: "asc" } } : { ...view, layout },
      ]);
      const base = createTableBaseDocument({ tables: [{ id: "tbl_layout", name: "布局", document: saved }] });
      const [parsed] = getTableViews(tableBaseTableDocument(base.tables[0]));
      expect(parsed.layout ?? "grid").toBe(layout);
    }
    expect(getTableViews(kanban)[0].layout).toBe("kanban");

    const gallery = saveTableViews(document, [{ ...view, layout: "gallery" }]);
    const payload = { ...gallery, views: [{ ...gallery.views[0], layout: "timeline" }] };
    const marker = `<!-- edgeever-table-v1:${Base64.encodeURI(JSON.stringify(payload))} -->`;
    const degraded = parseTableDocument(marker);
    expect(degraded).not.toBeNull();
    const [degradedView] = getTableViews(degraded);
    expect(degradedView.layout ?? "grid").toBe("grid");
    expect(serializeTableDocument(degraded)).not.toContain("timeline");
  });
});
