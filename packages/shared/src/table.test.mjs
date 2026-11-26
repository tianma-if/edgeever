import { describe, expect, test } from "bun:test";
import { Base64 } from "js-base64";
import { markdownToDoc } from "./content.ts";
import {
  addTableField,
  addTableRecord,
  applyTableView,
  duplicateTableRecord,
  insertTableRecord,
  removeTableRecord,
  createDefaultTableDocument,
  listTableAttachmentResourceIds,
  tableAttachmentUrl,
  hasTableDocumentMarker,
  parseTableDocument,
  parseTableDocumentMetadata,
  removeTableField,
  replaceTableView,
  serializeTableDocument,
  stripTableDocumentMarker,
  tableDocumentToCsv,
  tableFallbackMarkdown,
  updateTableCell,
  updateTableField,
  getTableSummary,
  getTableViews,
  groupTableRecords,
  resolveTableViewColumns,
  setTableViewColumnWidth,
  saveTableViews,
  tableCellDisplayText,
  tableFieldIsComputed,
  tableFieldIsNumeric,
  TABLE_RATING_MAX,
  TABLE_OPTION_COLORS,
  tableOptionColor,
} from "./table.ts";
import { appendTableRecordsFromCsv } from "./table-csv.ts";

describe("structured table documents", () => {
  test("round-trips fields, records, filters, and sort through the markdown envelope", () => {
    const seeded = createDefaultTableDocument();
    const withView = replaceTableView(updateTableCell(seeded, "rec_sample", "fld_name", "阅读清单"), {
      filters: [{ fieldId: "fld_status", operator: "eq", value: "未开始" }],
      sort: { fieldId: "fld_name", direction: "asc" },
    });
    const markdown = serializeTableDocument(withView);
    expect(hasTableDocumentMarker(markdown)).toBe(true);
    expect(stripTableDocumentMarker(markdown)).toBe(tableFallbackMarkdown(withView));
    expect(parseTableDocument(markdown)).toEqual(withView);
    expect(markdownToDoc(tableFallbackMarkdown(withView)).content?.some((node) => node.type === "table")).toBe(true);
    expect(JSON.stringify(markdownToDoc(stripTableDocumentMarker(markdown)))).not.toContain("edgeever-table-v1");
  });

  test("rejects a broken envelope without dropping the readable table", () => {
    const markdown = `${tableFallbackMarkdown(createDefaultTableDocument())}\n\n<!-- edgeever-table-v1:not-json -->`;
    expect(parseTableDocument(markdown)).toBeNull();
    expect(hasTableDocumentMarker(markdown)).toBe(true);
    expect(stripTableDocumentMarker(markdown)).toContain("| 名称 |");
    expect(getTableSummary(markdown)).toEqual({ structuredTable: false });
  });

  test("filters, sorts, and keeps an ordinary markdown table untouched", () => {
    let document = createDefaultTableDocument();
    document = addTableRecord(document, "rec_next");
    document = updateTableCell(document, "rec_next", "fld_name", "已完成的书");
    document = updateTableCell(document, "rec_next", "fld_status", "完成");
    document = updateTableCell(document, "rec_next", "fld_date", "2026-09-01");
    document = replaceTableView(document, {
      filters: [{ fieldId: "fld_name", operator: "contains", value: "书" }],
      sort: { fieldId: "fld_date", direction: "desc" },
    });
    expect(applyTableView(document).map((record) => record.id)).toEqual(["rec_next"]);
    expect(parseTableDocument("| 名称 |\n| --- |\n| 普通表格 |")).toBeNull();
  });

  test("coerces cells when a field type changes and refuses to remove the last field", () => {
    const document = updateTableField(createDefaultTableDocument(), "fld_name", { type: "number" });
    expect(document.records[0]?.cells.fld_name).toBeNull();
    const onlyName = removeTableField(removeTableField(document, "fld_status"), "fld_date");
    expect(removeTableField(onlyName, "fld_name").fields.map((field) => field.id)).toEqual(["fld_name"]);
  });

  test("exports csv for the rows currently in view and escapes commas", () => {
    const document = updateTableCell(createDefaultTableDocument(), "rec_sample", "fld_name", "甲,乙");
    expect(tableDocumentToCsv(document)).toContain('"甲,乙"');
    expect(tableDocumentToCsv(document).charCodeAt(0)).toBe(0xfeff);
  });

  test("summarizes a table note for the memo list", () => {
    expect(getTableSummary(serializeTableDocument(createDefaultTableDocument()))).toEqual({
      structuredTable: true,
      tablePreview: { fieldCount: 3, recordCount: 1, fieldNames: ["名称", "状态", "日期"] },
    });
  });

  test("adds a field onto every existing record", () => {
    const document = addTableField(createDefaultTableDocument(), { id: "fld_url", name: "链接", type: "url" });
    expect(document.records[0]?.cells.fld_url).toBe("");
    expect(document.fields.at(-1)?.name).toBe("链接");
  });

  test("stores attachment references and writes filename links into the readable table", () => {
    const files = [
      { resourceId: "res_brief", filename: "brief.pdf", mimeType: "application/pdf", byteSize: 12 },
      { resourceId: "res_shot", filename: "shot.png", mimeType: "image/png", byteSize: 34 },
    ];
    let document = addTableField(createDefaultTableDocument(), { id: "fld_files", name: "附件", type: "attachment" });
    document = updateTableCell(document, "rec_sample", "fld_files", files);
    expect(document.records[0]?.cells.fld_files).toEqual(files);
    expect(listTableAttachmentResourceIds(document)).toEqual(new Set(["res_brief", "res_shot"]));
    const markdown = tableFallbackMarkdown(document);
    expect(markdown).toContain(`[brief.pdf](${tableAttachmentUrl("res_brief")})`);
    expect(markdown).toContain(`[shot.png](${tableAttachmentUrl("res_shot")})`);
    expect(parseTableDocument(serializeTableDocument(document))?.records[0]?.cells.fld_files).toEqual(files);
    expect(tableDocumentToCsv(document)).toContain("brief.pdf; shot.png");
    const filled = replaceTableView(document, { filters: [{ fieldId: "fld_files", operator: "notEmpty" }], sort: null });
    expect(applyTableView(filled)).toHaveLength(1);
    const empty = updateTableCell(document, "rec_sample", "fld_files", []);
    expect(applyTableView(replaceTableView(empty, { filters: [{ fieldId: "fld_files", operator: "empty" }], sort: null }))).toHaveLength(1);
  });

  test("keeps ten unique attachments and turns a removed attachment field back into text", () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      resourceId: `res_${index}`,
      filename: `file-${index}.txt`,
      mimeType: "text/plain",
      byteSize: index,
    }));
    files.push({ resourceId: "res_0", filename: "duplicate.txt", mimeType: "text/plain", byteSize: 1 });
    let document = addTableField(createDefaultTableDocument(), { id: "fld_files", name: "附件", type: "attachment" });
    document = updateTableCell(document, "rec_sample", "fld_files", files);
    expect(document.records[0]?.cells.fld_files).toHaveLength(10);
    document = updateTableField(document, "fld_files", { type: "text" });
    expect(document.records[0]?.cells.fld_files).toContain("file-0.txt");
    expect(listTableAttachmentResourceIds(document).size).toBe(0);
  });
});


describe("named table views", () => {
  test("an existing v1 view keeps its matches and select sort order after upgrading", () => {
    let old = createDefaultTableDocument();
    old = updateTableField(old, "fld_status", { options: ["Zulu active", "Alpha active", "Other"] });
    old = updateTableCell(old, "rec_sample", "fld_status", "Zulu active");
    old = updateTableCell(addTableRecord(old, "rec_a"), "rec_a", "fld_status", "Alpha active");
    old = updateTableCell(addTableRecord(old, "rec_hidden"), "rec_hidden", "fld_status", "Other");
    old = replaceTableView(old, {
      // V1 select fields supported textual filters and lexicographic order.
      filters: [{ fieldId: "fld_status", operator: "contains", value: "ACTIVE" }],
      sort: { fieldId: "fld_status", direction: "asc" },
    });
    expect(applyTableView(old).map((r) => r.id)).toEqual(["rec_a", "rec_sample"]);
    const [initial] = getTableViews(parseTableDocument(serializeTableDocument(old)));
    expect(saveTableViews(old, [initial])).toEqual(old);
    const changedLegacy = saveTableViews(old, [{ ...initial,
      filters: [{ fieldId: "fld_name", operator: "eq", value: "示例记录" }],
    }]);
    expect(changedLegacy.schemaVersion).toBe(1);
    expect(applyTableView(changedLegacy).map((r) => r.id)).toEqual(["rec_sample"]);
    const next = saveTableViews(old, [initial, { id: "custom", name: "New", match: "all", filters: [],
      sorts: [{ fieldId: "fld_status", direction: "asc" }] }]);
    const decoded = parseTableDocument(serializeTableDocument(next));
    expect(decoded.schemaVersion).toBe(2);
    expect(applyTableView(decoded).map((r) => r.id)).toEqual(applyTableView(old).map((r) => r.id));
    expect(applyTableView(decoded, decoded.records, decoded.views[1]).map((r) => r.id).slice(0, 2))
      .toEqual(["rec_sample", "rec_a"]);
  });

  test("evaluates relative dates, numeric comparisons, boolean values and secondary sorts without changing the source", () => {
    let document = addTableField(createDefaultTableDocument(), { id: "fld_priority", name: "Priority", type: "number" });
    document = addTableField(document, { id: "fld_done", name: "Done", type: "checkbox" });
    for (const [id, priority, date, done] of [
      ["rec_sample", 10, "2026-11-08", false], ["rec_early", 10, "2026-11-02", false],
      ["rec_next", 99, "2026-11-09", false], ["rec_complete", 20, "2026-11-06", true],
      ["rec_empty", null, "2026-11-06", false], ["rec_tie", 10, "2026-11-02", false],
    ]) {
      document = addTableRecord(document, id);
      for (const [field, value] of Object.entries({ fld_priority: priority, fld_date: date, fld_done: done })) {
        document = updateTableCell(document, id, field, value);
      }
    }
    const view = { id: "week", name: "This week", match: "all", filters: [
      { fieldId: "fld_date", operator: "thisWeek" }, { fieldId: "fld_done", operator: "eq", value: false },
      { fieldId: "fld_priority", operator: "gte", value: 10 },
    ], sorts: [{ fieldId: "fld_priority", direction: "desc" }, { fieldId: "fld_date", direction: "asc" }] };
    const current = saveTableViews(document, [...getTableViews(document), view]);
    const week = new Date(2026, 10, 6, 12);
    expect(applyTableView(current, current.records, current.views[1], week).map((r) => r.id))
      .toEqual(["rec_early", "rec_tie", "rec_sample"]);
    expect(applyTableView(current, current.records, { ...current.views[1], match: "any" }, week)).toHaveLength(6);
    expect(current.records.map((r) => r.id)).toEqual(document.records.map((r) => r.id));
    const changed = updateTableField(current, "fld_priority", { type: "text" });
    expect(changed.views[1].filters.map((rule) => rule.fieldId)).toEqual(["fld_date", "fld_done"]);
    expect(removeTableField(changed, "fld_date").views[1].sorts.map((rule) => rule.fieldId)).toEqual(["fld_priority"]);
  });
});

test("legacy and named table metadata matches full parsing without changing marker bytes", () => {
  const legacy = updateTableCell(createDefaultTableDocument(), "rec_sample", "fld_name", "旧表 🧭\r text");
  const named = saveTableViews(legacy, [getTableViews(legacy)[0], { id: "other", name: "Other", match: "all", filters: [], sorts: [] }]);
  for (const table of [legacy, named]) {
    const raw = JSON.stringify(table);
    const encoded = Base64.encodeURI(raw);
    const markdown = serializeTableDocument(table);
    expect(markdown.endsWith("<!-- edgeever-table-v1:" + encoded + " -->")).toBe(true);
    const wrapped = markdown.replace(encoded, encoded.slice(0, 35) + "\n  " + encoded.slice(35));
    expect(parseTableDocument(wrapped)).toEqual(table);
    expect(parseTableDocumentMetadata(wrapped)).toEqual({ fields: table.fields, recordCount: table.records.length });
  }
});

test("metadata rejects markers the full parser cannot read", () => {
  const legacy = createDefaultTableDocument();
  const marker = (raw) => "<!-- edgeever-table-v1:" + Base64.encodeURI(raw) + " -->";
  const bad = [
    JSON.stringify({ ...legacy, records: [legacy.records[0], legacy.records[0]] }),
    JSON.stringify({ ...legacy, records: [{ id: "bad", cells: { fld_name: { toString: 42 } } }] }).replace('"toString"', '"toStr\\u0069ng"'),
    JSON.stringify({ ...legacy, schemaVersion: 2, views: [] }),
    "\uFEFF" + JSON.stringify(legacy),
  ];
  for (const raw of bad) {
    expect(parseTableDocument(marker(raw))).toBeNull();
    expect(parseTableDocumentMetadata(marker(raw))).toBeNull();
  }
});

describe("MVP table fields and layouts", () => {
  test("supports multi-select, phone, email and generated auto numbers without storing row numbers", () => {
    let document = createDefaultTableDocument();
    document = addTableField(document, { id: "fld_tags", name: "标签", type: "multiSelect", options: ["A", "B"] });
    document = addTableField(document, { id: "fld_phone", name: "电话", type: "phone" });
    document = addTableField(document, { id: "fld_email", name: "邮箱", type: "email" });
    document = addTableField(document, { id: "fld_number", name: "编号", type: "autoNumber" });
    document = updateTableCell(document, "rec_sample", "fld_tags", ["B", "A", "B", "invalid"]);
    document = updateTableCell(document, "rec_sample", "fld_phone", "+86 138 0000 0000");
    document = updateTableCell(document, "rec_sample", "fld_email", "user@example.com");
    document = updateTableCell(document, "rec_sample", "fld_number", 99);
    expect(document.records[0].cells.fld_tags).toEqual(["B", "A"]);
    expect(document.records[0].cells.fld_number).toBeNull();
    expect(tableCellDisplayText(document.fields.find((field) => field.id === "fld_number"), null, 0)).toBe("1");
    expect(tableDocumentToCsv(document)).toContain("B; A");
    const decoded = parseTableDocument(serializeTableDocument(document));
    expect(decoded.records[0].cells.fld_email).toBe("user@example.com");
    expect(decoded.records[0].cells.fld_tags).toEqual(["B", "A"]);
  });

  test("persists columns, grouping and kanban only in schema v3 and resolves newly added fields", () => {
    const initial = createDefaultTableDocument();
    const view = getTableViews(initial)[0];
    const enhanced = saveTableViews(initial, [{ ...view,
      columns: [{ fieldId: "fld_status", width: 220 }, { fieldId: "fld_name", hidden: true }],
      groupBy: { fieldId: "fld_status", direction: "asc" },
      layout: "kanban",
    }]);
    expect(enhanced.schemaVersion).toBe(3);
    expect(parseTableDocument(serializeTableDocument(enhanced))).toEqual(enhanced);
    const withDate = addTableField(enhanced, { id: "fld_owner", name: "Owner", type: "text" });
    expect(resolveTableViewColumns(withDate.fields, withDate.views[0]).map((column) => column.fieldId))
      .toEqual(["fld_status", "fld_name", "fld_date", "fld_owner"]);
    const raw = JSON.stringify(enhanced).replace('"schemaVersion":3', '"schemaVersion":2');
    const marker = "<!-- edgeever-table-v1:" + Base64.encodeURI(raw) + " -->";
    expect(parseTableDocument(marker)).toBeNull();
  });

  test("groups records with stable option order and optional empty lanes", () => {
    let document = createDefaultTableDocument();
    document = updateTableCell(document, "rec_sample", "fld_status", "进行中");
    document = updateTableCell(addTableRecord(document, "rec_done"), "rec_done", "fld_status", "完成");
    const groups = groupTableRecords(document, document.records, { fieldId: "fld_status", direction: "asc" }, { includeEmpty: true });
    expect(groups.map((group) => group.key)).toEqual(["未开始", "进行中", "完成"]);
    expect(groups.map((group) => group.records.length)).toEqual([0, 1, 1]);
  });

  test("imports valid CSV rows and ignores read-only columns", async () => {
    let document = createDefaultTableDocument();
    document = addTableField(document, { id: "fld_email", name: "邮箱", type: "email" });
    document = addTableField(document, { id: "fld_number", name: "编号", type: "autoNumber" });
    const result = await appendTableRecordsFromCsv(document, "\uFEFF名称,邮箱,编号\n\"甲,乙\",a@example.com,99\n丙,b@example.com,100");
    expect(result.imported).toBe(2);
    expect(result.skippedColumns).toEqual(["编号"]);
    expect(result.document.records).toHaveLength(3);
    expect(result.document.records[1].cells.fld_name).toBe("甲,乙");
    expect(result.document.records[1].cells.fld_email).toBe("a@example.com");
    expect(result.document.records[1].cells.fld_number).toBeUndefined();
    await expect(appendTableRecordsFromCsv(document, "名称,邮箱\n坏行,not-an-email")).rejects.toThrow("CSV row 2");
  });

  test("rejects CSV cells that are not existing select options and unknown columns", async () => {
    let document = createDefaultTableDocument();
    document = addTableField(document, { id: "fld_tags", name: "标签", type: "multiSelect", options: ["重要", "紧急"] });
    await expect(appendTableRecordsFromCsv(document, "名称,状态,标签\n甲,未开始,重要;缺失"))
      .rejects.toThrow('CSV row 2: 标签: unknown option "缺失"');
    await expect(appendTableRecordsFromCsv(document, "名称,状态\n甲,已归档"))
      .rejects.toThrow('CSV row 2: 状态: unknown option "已归档"');
    await expect(appendTableRecordsFromCsv(document, "名称,归档\n甲,是")).rejects.toThrow("Unknown CSV column: 归档");
    await expect(appendTableRecordsFromCsv(document, "名称,名称\n甲,乙")).rejects.toThrow("Duplicate CSV column: 名称");
  });

  test("orders grouped lanes by direction and keeps empty lanes opt-in", () => {
    let document = createDefaultTableDocument();
    document = updateTableCell(document, "rec_sample", "fld_status", "进行中");
    const ascending = groupTableRecords(document, document.records, { fieldId: "fld_status", direction: "asc" });
    const descending = groupTableRecords(document, document.records, { fieldId: "fld_status", direction: "desc" });
    expect(ascending.map((group) => group.key)).toEqual(["进行中"]);
    expect(descending.map((group) => group.key)).toEqual(["进行中"]);
    const lanes = groupTableRecords(document, document.records, { fieldId: "fld_status", direction: "desc" }, { includeEmpty: true });
    expect(lanes.map((group) => group.key)).toEqual(["完成", "进行中", "未开始"]);
    document = addTableField(document, { id: "fld_done", name: "完成", type: "checkbox" });
    expect(groupTableRecords(document, document.records, { fieldId: "fld_done", direction: "asc" })).toEqual([
      { key: "false", records: document.records },
    ]);
    document = updateTableCell(document, "rec_sample", "fld_done", true);
    const checked = groupTableRecords(document, document.records, { fieldId: "fld_done", direction: "asc" }, { includeEmpty: true });
    expect(checked.map((group) => group.key)).toEqual(["false", "true"]);
    expect(checked.map((group) => group.records.length)).toEqual([0, 1]);
  });
});

describe("Feishu-style field types", () => {
  test("classifies computed and numeric field types", () => {
    for (const type of ["createdTime", "updatedTime"]) {
      expect(tableFieldIsComputed(type)).toBe(true);
    }
    for (const type of ["text", "number", "progress", "rating"]) {
      expect(tableFieldIsComputed(type)).toBe(false);
    }
    for (const type of ["number", "progress", "rating", "currency", "percent"]) {
      expect(tableFieldIsNumeric(type)).toBe(true);
    }
    for (const type of ["text", "checkbox", "date", "select", "attachment"]) {
      expect(tableFieldIsNumeric(type)).toBe(false);
    }
  });

  test("never persists system time values", () => {
    let document = createDefaultTableDocument();
    document = addTableField(document, { id: "fld_created", name: "创建时间", type: "createdTime" });
    document = addTableField(document, { id: "fld_updated", name: "更新时间", type: "updatedTime" });
    document = updateTableCell(document, "rec_sample", "fld_created", "2026-01-01T00:00:00.000Z");
    document = updateTableCell(document, "rec_sample", "fld_updated", "2026-01-02T00:00:00.000Z");
    expect(document.records[0].cells.fld_created).toBeNull();
    expect(document.records[0].cells.fld_updated).toBeNull();
    const created = document.fields.find((item) => item.id === "fld_created");
    const localTime = new Date("2026-01-01T00:00:00.000Z");
    const expectedClock = `${localTime.getFullYear()}-${String(localTime.getMonth() + 1).padStart(2, "0")}-${String(localTime.getDate()).padStart(2, "0")} ${String(localTime.getHours()).padStart(2, "0")}:${String(localTime.getMinutes()).padStart(2, "0")}`;
    expect(tableCellDisplayText(created, "2026-01-01T00:00:00.000Z")).toBe(expectedClock);
    expect(tableCellDisplayText(created, null)).toBe("");
    const roundTrip = parseTableDocument(serializeTableDocument(document));
    expect(roundTrip.fields.find((item) => item.id === "fld_created").type).toBe("createdTime");
  });

  test("stamps createdAt and updatedAt without touching legacy records", () => {
    const created = "2026-01-02T03:04:05.000Z";
    let document = createDefaultTableDocument();
    document = addTableRecord(document, { id: "rec_new", now: created });
    expect(document.records[1].createdAt).toBe(created);
    expect(document.records[1].updatedAt).toBe(created);
    document = updateTableCell(document, "rec_new", "fld_name", "甲", { now: "2026-01-03T00:00:00.000Z" });
    expect(document.records[1].createdAt).toBe(created);
    expect(document.records[1].updatedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(document.records[0].createdAt).toBeUndefined();
    expect(document.records[0].updatedAt).toBeUndefined();

    const roundTrip = parseTableDocument(serializeTableDocument(document));
    expect(roundTrip.records[1].createdAt).toBe(created);
    expect(roundTrip.records[0].updatedAt).toBeUndefined();

    document = addTableRecord(document);
    const stamped = document.records.at(-1);
    expect(typeof stamped.createdAt).toBe("string");
    expect(stamped.createdAt).toBe(stamped.updatedAt);
    expect(Number.isNaN(Date.parse(stamped.createdAt))).toBe(false);
  });

  test("formats progress, rating, currency, and percent cells", () => {
    let document = createDefaultTableDocument();
    document = addTableField(document, { id: "fld_progress", name: "进度", type: "progress" });
    document = addTableField(document, { id: "fld_rating", name: "评分", type: "rating" });
    document = addTableField(document, { id: "fld_currency", name: "金额", type: "currency" });
    document = addTableField(document, { id: "fld_percent", name: "完成率", type: "percent" });
    const display = (id, value) => tableCellDisplayText(document.fields.find((field) => field.id === id), value);

    document = updateTableCell(document, "rec_sample", "fld_progress", 55.6);
    document = updateTableCell(document, "rec_sample", "fld_rating", 4.4);
    document = updateTableCell(document, "rec_sample", "fld_currency", -1234.5);
    document = updateTableCell(document, "rec_sample", "fld_percent", 0.125);
    expect(document.records[0].cells.fld_progress).toBe(56);
    expect(document.records[0].cells.fld_rating).toBe(4);
    expect(display("fld_progress", 56)).toBe("56%");
    expect(display("fld_rating", 4)).toBe(`4/${TABLE_RATING_MAX}`);
    expect(display("fld_currency", -1234.5)).toBe("-¥1,234.50");
    expect(display("fld_percent", 0.125)).toBe("12.5%");

    document = updateTableCell(document, "rec_sample", "fld_progress", 150);
    document = updateTableCell(document, "rec_sample", "fld_rating", 9);
    expect(document.records[0].cells.fld_progress).toBe(100);
    expect(document.records[0].cells.fld_rating).toBe(TABLE_RATING_MAX);
    expect(display("fld_currency", 1234567.891)).toBe("¥1,234,567.89");
    expect(display("fld_currency", 0)).toBe("¥0.00");
    expect(display("fld_percent", 1)).toBe("100%");
    expect(display("fld_percent", 1.25)).toBe("125%");
    expect(display("fld_percent", -0.5)).toBe("-50%");

    document = updateTableCell(document, "rec_sample", "fld_progress", -3);
    expect(document.records[0].cells.fld_progress).toBe(0);
  });

  test("renders created and updated timestamps without timezone drift", () => {
    let document = createDefaultTableDocument();
    document = addTableField(document, { id: "fld_created", name: "创建时间", type: "createdTime" });
    document = addTableField(document, { id: "fld_updated", name: "更新时间", type: "updatedTime" });
    document = addTableRecord(document, { id: "rec_stamp", now: "2026-01-02T03:04:05.000Z" });
    const created = document.fields.find((field) => field.id === "fld_created");
    const updated = document.fields.find((field) => field.id === "fld_updated");
    const record = document.records.at(-1);
    expect(tableCellDisplayText(created, record.createdAt)).toBe("2026-01-02 03:04");
    expect(tableCellDisplayText(updated, record.updatedAt)).toBe("2026-01-02 03:04");
    expect(tableCellDisplayText(created, null)).toBe("");
    // Unexpected values pass through unchanged so broken data stays visible instead of disappearing.
    expect(tableCellDisplayText(created, "not-a-date")).toBe("not-a-date");
  });
});

describe("record ordering helpers", () => {
  const seed = () => {
    let document = createDefaultTableDocument();
    document = addTableRecord(document, { id: "rec_a", now: "2026-01-01T00:00:00.000Z" });
    document = addTableRecord(document, { id: "rec_b", now: "2026-01-01T00:00:00.000Z" });
    document = updateTableCell(document, "rec_a", "fld_name", "甲");
    document = updateTableCell(document, "rec_b", "fld_name", "乙");
    return document;
  };

  test("inserts a blank record at the requested position", () => {
    const document = seed();
    const first = insertTableRecord(document, 0, { id: "rec_first", now: "2026-01-02T00:00:00.000Z" });
    expect(first.records.map((record) => record.id).slice(0, 2)).toEqual(["rec_first", "rec_sample"]);
    const middle = insertTableRecord(document, 1, { id: "rec_middle" });
    expect(middle.records.map((record) => record.id)).toEqual(["rec_sample", "rec_middle", "rec_a", "rec_b"]);
    const clamped = insertTableRecord(document, 99, { id: "rec_last" });
    expect(clamped.records.at(-1).id).toBe("rec_last");
    const withValues = insertTableRecord(document, 0, { id: "rec_values", cells: { fld_name: "新行" } });
    expect(withValues.records[0].cells.fld_name).toBe("新行");
    expect(withValues.records[0].createdAt).toBeTruthy();
  });

  test("rejects duplicate ids and a full table", () => {
    const document = seed();
    expect(insertTableRecord(document, 0, { id: "rec_a" })).toBe(document);
    const full = { ...document, records: Array.from({ length: 2000 }, (_, index) => ({ id: `rec_${index}`, cells: {} })) };
    expect(insertTableRecord(full, 0, { id: "rec_new" })).toBe(full);
  });

  test("duplicates a record right below its source and skips computed cells", () => {
    let document = seed();
    document = addTableField(document, { id: "fld_created", name: "创建时间", type: "createdTime" });
    document = addTableField(document, { id: "fld_index", name: "序号", type: "autoNumber" });
    const next = duplicateTableRecord(document, "rec_a", { id: "rec_copy", now: "2026-01-03T00:00:00.000Z" });
    const ids = next.records.map((record) => record.id);
    expect(ids.indexOf("rec_copy")).toBe(ids.indexOf("rec_a") + 1);
    const copy = next.records.find((record) => record.id === "rec_copy");
    expect(copy.cells.fld_name).toBe("甲");
    expect(copy.cells.fld_created ?? null).toBeNull();
    expect(duplicateTableRecord(document, "rec_missing")).toBe(document);
  });

  test("removes a record without touching the rest", () => {
    const document = seed();
    expect(removeTableRecord(document, "rec_a").records.map((record) => record.id)).toEqual(["rec_sample", "rec_b"]);
  });
});

describe("select option colors", () => {
  const withOptions = () => {
    const document = createDefaultTableDocument();
    return updateTableField(document, "fld_status", { options: ["未开始", "进行中", "完成"] });
  };

  test("round-trips explicit option colors and drops unknown ones", () => {
    const document = updateTableField(withOptions(), "fld_status", {
      optionColors: { 未开始: "blue", 进行中: "green", 已删除: "red", 完成: "not-a-color" },
    });
    const field = document.fields.find((item) => item.id === "fld_status");
    expect(field.optionColors).toEqual({ 未开始: "blue", 进行中: "green" });
    expect(parseTableDocument(serializeTableDocument(document)).fields.find((item) => item.id === "fld_status").optionColors)
      .toEqual({ 未开始: "blue", 进行中: "green" });
  });

  test("falls back to a stable hash color when nothing was picked", () => {
    const field = withOptions().fields.find((item) => item.id === "fld_status");
    const first = tableOptionColor(field, "进行中");
    expect(TABLE_OPTION_COLORS).toContain(first);
    expect(tableOptionColor(field, "进行中")).toBe(first);
    expect(tableOptionColor({ ...field, optionColors: { 进行中: "pink" } }, "进行中")).toBe("pink");
  });

  test("drops colors when the field is no longer a select", () => {
    const document = updateTableField(withOptions(), "fld_status", { optionColors: { 未开始: "blue" } });
    const text = updateTableField(document, "fld_status", { type: "text" });
    expect(text.fields.find((item) => item.id === "fld_status").optionColors).toBeUndefined();
  });

  test("drops malformed option colors coming from stored markdown", () => {
    const document = updateTableField(withOptions(), "fld_status", { optionColors: { 未开始: "blue" } });
    const markdown = serializeTableDocument(document);
    const marker = /<!-- edgeever-table-v1:([A-Za-z0-9_-]+) -->/.exec(markdown);
    const payload = Base64.decode(marker[1]);
    const raw = JSON.parse(payload);
    raw.fields.find((field) => field.id === "fld_status").optionColors = { 未开始: "blue", 进行中: 7, 完成: "rainbow" };
    const tampered = markdown.replace(marker[1], Base64.encodeURI(JSON.stringify(raw)));
    const field = parseTableDocument(tampered).fields.find((item) => item.id === "fld_status");
    expect(field.optionColors).toEqual({ 未开始: "blue" });
  });
});

describe("table field edits and saved views", () => {
  const kanbanDocument = () => {
    let document = createDefaultTableDocument("看板");
    document = addTableField(document, { id: "fld_status", name: "状态", type: "select", options: ["未开始", "进行中"] });
    document = addTableField(document, { id: "fld_title", name: "标题", type: "text" });
    const views = getTableViews(document);
    const kanban = {
      ...views[0],
      layout: "kanban",
      groupBy: { fieldId: "fld_status", direction: "asc" },
    };
    return saveTableViews(document, [kanban, ...views.slice(1)], kanban.id);
  };

  test("keeps a saved kanban layout when unrelated fields change", () => {
    const document = kanbanDocument();
    const stored = getTableViews(document)[0];
    expect(stored.layout).toBe("kanban");

    const renamed = updateTableField(document, "fld_title", { name: "标题（改）" });
    expect(getTableViews(renamed)[0].layout).toBe("kanban");
    expect(getTableViews(renamed)[0].groupBy).toEqual({ fieldId: "fld_status", direction: "asc" });

    const resized = updateTableField(document, "fld_title", { name: "标题", options: [] });
    expect(getTableViews(resized)[0].layout).toBe("kanban");

    const regroupedRename = updateTableField(document, "fld_status", { name: "进度" });
    expect(getTableViews(regroupedRename)[0].layout).toBe("kanban");
    expect(getTableViews(regroupedRename)[0].groupBy.fieldId).toBe("fld_status");
  });

  test("resets a kanban only when its grouping field stops being a single select", () => {
    const document = kanbanDocument();
    const toText = updateTableField(document, "fld_status", { type: "text" });
    expect(getTableViews(toText)[0].layout).toBe("grid");
    expect(getTableViews(toText)[0].groupBy).toBeUndefined();

    const toMulti = updateTableField(document, "fld_status", { type: "multiSelect", options: ["未开始", "进行中"] });
    expect(getTableViews(toMulti)[0].layout).toBe("grid");
    expect(getTableViews(toMulti)[0].groupBy).toBeUndefined();
  });
});

describe("view column width", () => {
  test("clamps column widths and ignores unknown fields", () => {
    let document = createDefaultTableDocument("计划");
    document = addTableField(document, { id: "fld_title", name: "标题", type: "text" });
    const view = getTableViews(document)[0];
    const wide = setTableViewColumnWidth(document.fields, view, "fld_title", 900);
    expect(wide.columns.find((column) => column.fieldId === "fld_title").width).toBe(600);
    const narrow = setTableViewColumnWidth(document.fields, wide, "fld_title", 10);
    expect(narrow.columns.find((column) => column.fieldId === "fld_title").width).toBe(80);
    const rounded = setTableViewColumnWidth(document.fields, narrow, "fld_title", 199.6);
    expect(rounded.columns.find((column) => column.fieldId === "fld_title").width).toBe(200);
    expect(setTableViewColumnWidth(document.fields, rounded, "fld_title", 200)).toBe(rounded);
    expect(setTableViewColumnWidth(document.fields, rounded, "fld_missing", 200)).toBe(rounded);
    expect(setTableViewColumnWidth(document.fields, rounded, "fld_title", Number.POSITIVE_INFINITY)).toBe(rounded);
  });
});
