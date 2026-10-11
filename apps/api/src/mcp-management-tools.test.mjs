import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { callMcpTool } from "./index.ts";
import { createPosterDocument, serializePosterDocument, parsePosterDocument, addTableField, parseDiagramDocument, parseInfographicDocument, parseTableDocument, serializeTableDocument, createDefaultTableDocument } from "@edgeever/shared";

class SqliteD1PreparedStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqliteD1PreparedStatement(this.db, this.sql, bindings);
  }

  async all() {
    return { results: this.db.query(this.sql).all(...this.bindings), success: true, meta: {} };
  }

  async first() {
    return this.db.query(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    this.db.query(this.sql).run(...this.bindings);
    return { success: true, meta: {} };
  }
}

class SqliteD1Database {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SqliteD1PreparedStatement(this.db, sql);
  }

  async batch(statements) {
    return this.db.transaction(() => statements.map((statement) =>
      this.db.query(statement.sql).run(...statement.bindings)))();
  }
}

const createFixture = (scopes = ["read:memos", "write:memos"]) => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_mcp", "MCP workspace");
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_other", "Other workspace");

  const auth = {
    kind: "agent",
    actorType: "agent",
    actorId: "tok_mcp",
    username: "mcp-agent",
    displayName: null,
    scopes,
    workspaceId: "ws_mcp",
    role: "member",
  };
  const context = {
    env: { storage: { db: new SqliteD1Database(sqlite), resources: {} } },
    get: (key) => key === "auth" ? auth : undefined,
  };
  return { sqlite, auth, context };
};

describe("MCP template and AI instruction management", () => {
  test("poster tools preserve untouched elements, previews, scopes and revision guards", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)").run("nb_posters", "ws_mcp", "Posters");
    const poster = { ...createPosterDocument("Original"), previewResourceId: "old_preview" };
    const created = await callMcpTool(context, auth, "create_memo", { notebookId: "nb_posters", title: "Poster", contentMarkdown: serializePosterDocument(poster) });
    const read = await callMcpTool(context, auth, "get_poster", { memoId: created.memo.id });
    const heading = read.poster.elements.find(element => element.type === "text");
    const input = { memoId: created.memo.id, expectedRevision: read.memo.revision, edits: [{ id: heading.id, patch: { text: "Updated", fill: "#16A06E" } }] };
    const preview = await callMcpTool(context, auth, "update_poster", { ...input, dryRun: true });
    expect(preview.poster.elements.find(element => element.id === heading.id).text).toBe("Updated");
    expect((await callMcpTool(context, auth, "get_poster", { memoId: created.memo.id })).poster.previewResourceId).toBe("old_preview");
    await expect(callMcpTool(context, { ...auth, scopes: ["read:memos"] }, "update_poster", input)).rejects.toThrow();
    await expect(callMcpTool(context, { ...auth, workspaceId: "ws_other" }, "get_poster", { memoId: created.memo.id })).rejects.toThrow();
    const result = await callMcpTool(context, auth, "update_poster", input);
    expect(result.poster.previewResourceId).toBeUndefined();
    expect(result.poster.elements.filter(element => element.id !== heading.id)).toEqual(read.poster.elements.filter(element => element.id !== heading.id));
    expect(parsePosterDocument(result.memo.contentMarkdown).elements.find(element => element.id === heading.id).text).toBe("Updated");
    await expect(callMcpTool(context, auth, "update_poster", input)).rejects.toThrow();
    await expect(callMcpTool(context, auth, "update_poster", { ...input, expectedRevision: result.memo.revision, edits: [{ id: "missing", patch: { text: "Bad" } }] })).rejects.toThrow();
  });
  test.each([
    ["mind-map", [
      { id: "root", label: "Root" },
      { id: "branch", label: "Branch", parentId: "root" },
    ], []],
    ["flowchart", [
      { id: "start", label: "Start", type: "start" },
      { id: "pay", label: "Pay", type: "process" },
    ], [{ source: "start", target: "pay", label: "Continue" }]],
    ["architecture", [
      { id: "system", label: "System", type: "boundary" },
      { id: "api", label: "API", type: "service", parentId: "system" },
    ], []],
  ])("creates editable %s diagram memos from structured graphs", async (kind, nodes, edges) => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_diagrams", "ws_mcp", "Diagrams");

    const created = await callMcpTool(context, auth, "create_diagram_memo", {
      notebookId: "nb_diagrams",
      title: "Generated diagram",
      kind,
      theme: "brand",
      tags: ["design"],
      nodes,
      edges,
    });

    expect(created).toMatchObject({ diagramKind: kind, memo: { title: "Generated diagram", tags: ["design"] } });
    expect(JSON.stringify(created.memo)).not.toContain("edgeever-diagram-v1");
    expect(created.diagram.nodes[0].layout).toBeUndefined();
    const stored = sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(created.memo.id);
    const diagram = parseDiagramDocument(stored.content_markdown);
    expect(diagram).toMatchObject({ kind, theme: kind === "architecture" ? "brand" : "plain" });
    expect(diagram.nodes.map((node) => node.id)).toEqual(nodes.map((node) => node.id));
    expect(diagram.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBeTrue();
    expect(diagram.nodes.every((node) => node.width > 0 && node.height > 0)).toBeTrue();
    if (kind === "mind-map") expect(diagram.edges).toHaveLength(1);
    if (kind === "flowchart") {
      expect(diagram.edges).toMatchObject([{ id: "edge-1", source: "start", target: "pay" }]);
      expect(diagram.nodes.find((node) => node.id === "start").y)
        .toBeLessThan(diagram.nodes.find((node) => node.id === "pay").y);
    }
    if (kind === "architecture") {
      const boundary = diagram.nodes.find((node) => node.id === "system");
      const api = diagram.nodes.find((node) => node.id === "api");
      expect(boundary.x).toBeLessThan(api.x);
      expect(boundary.y).toBeLessThan(api.y);
      expect(boundary.x + boundary.width).toBeGreaterThan(api.x + api.width);
    }
  });

  test("creates a revenue-share infographic and refuses to overwrite it as markdown", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_graphics", "ws_mcp", "Graphics");
    const created = await callMcpTool(context, auth, "create_infographic_memo", {
      notebookId: "nb_graphics",
      template: "chart-pie-donut-plain-text",
      data: {
        title: "腾讯 2025 年营收占比",
        desc: "图中比例为演示用估算，不代表腾讯官方披露数据。",
        values: [
          { label: "增值服务", value: 52 },
          { label: "金融科技与企业服务", value: 30 },
          { label: "网络广告", value: 16 },
          { label: "其他业务", value: 2 },
        ],
      },
    });
    expect(created).toMatchObject({ infographic: true, template: "chart-pie-donut-plain-text", memo: { title: "腾讯 2025 年营收占比" } });
    expect(JSON.stringify(created.memo)).not.toContain("edgeever-infographic-v1");
    const stored = sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(created.memo.id);
    const infographic = parseInfographicDocument(stored.content_markdown);
    expect(infographic.syntax).toContain("value 52");
    const read = await callMcpTool(context, auth, "get_memo", { memoId: created.memo.id });
    expect(read.infographic).toEqual({ template: "chart-pie-donut-plain-text" });
    expect(read.memo.contentMarkdown).not.toContain("edgeever-infographic-v1");
    await expect(callMcpTool(context, auth, "update_memo", {
      memoId: created.memo.id, contentMarkdown: "# replaced",
    })).rejects.toMatchObject({ code: "infographic_update_required" });
    await expect(callMcpTool(context, auth, "create_infographic_memo", {
      notebookId: "nb_graphics",
      template: "chart-pie-donut-plain-text",
      data: { title: "坏占比", values: [{ label: "甲", value: -5 }] },
    })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(callMcpTool(context, { ...auth, scopes: ["read:memos"] }, "create_infographic_memo", {
      notebookId: "nb_graphics",
      template: "chart-pie-donut-plain-text",
      data: { title: "占比", values: [{ label: "甲", value: 1 }] },
    })).rejects.toMatchObject({ code: "forbidden" });
  });

  test("rejects invalid diagram graphs before creating a memo", async () => {
    const { auth, context } = createFixture();
    await expect(callMcpTool(context, auth, "create_diagram_memo", {
      notebookId: "nb_diagrams",
      kind: "mind-map",
      nodes: [{ id: "root", label: "Root", type: "database" }],
      edges: [],
    })).rejects.toMatchObject({ code: "invalid_params" });
  });

  test("reads semantic diagrams without layout by default and applies revision-safe operations", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_diagrams", "ws_mcp", "Diagrams");
    const created = await callMcpTool(context, auth, "create_diagram_memo", {
      notebookId: "nb_diagrams",
      title: "Architecture",
      kind: "architecture",
      nodes: [
        { id: "system", label: "System", type: "boundary" },
        { id: "api", label: "API", type: "service", parentId: "system" },
        { id: "database", label: "Database", type: "database", parentId: "system" },
      ],
      edges: [{ source: "api", target: "database", type: "data" }],
    });

    const semantic = await callMcpTool(context, auth, "get_diagram", { memoId: created.memo.id });
    expect(semantic.diagram.nodes[0].layout).toBeUndefined();
    expect(JSON.stringify(semantic)).not.toContain("edgeever-diagram-v1");
    const genericMemo = await callMcpTool(context, auth, "get_memo", { memoId: created.memo.id });
    expect(genericMemo.diagram.nodes[0].layout).toBeUndefined();
    expect(JSON.stringify(genericMemo)).not.toContain("edgeever-diagram-v1");
    const withLayout = await callMcpTool(context, auth, "get_diagram", { memoId: created.memo.id, includeLayout: true });
    const apiLayout = withLayout.diagram.nodes.find((node) => node.id === "api").layout;
    expect(apiLayout).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });

    const operations = [
      { op: "add_node", node: { id: "redis", label: "Redis", type: "database", parentId: "system", resourceIcon: "cache" } },
      { op: "add_edge", edge: { source: "api", target: "redis", type: "data", label: "cache" } },
    ];
    const preview = await callMcpTool(context, auth, "update_diagram", {
      memoId: created.memo.id,
      expectedRevision: semantic.memo.revision,
      operations,
      dryRun: true,
    });
    expect(preview).toMatchObject({ dryRun: true, changes: { addedNodes: 1, addedEdges: 1 } });
    expect((await callMcpTool(context, auth, "get_diagram", { memoId: created.memo.id })).diagram.nodes)
      .toHaveLength(3);

    const updated = await callMcpTool(context, auth, "update_diagram", {
      memoId: created.memo.id,
      expectedRevision: semantic.memo.revision,
      operations,
    });
    expect(updated.memo.revision).toBe(semantic.memo.revision + 1);
    expect(updated.diagram.nodes.find((node) => node.id === "redis")).toMatchObject({ type: "database", parentId: "system" });
    const afterLayout = await callMcpTool(context, auth, "get_diagram", { memoId: created.memo.id, includeLayout: true });
    expect(afterLayout.diagram.nodes.find((node) => node.id === "api").layout).toEqual(apiLayout);

    await expect(callMcpTool(context, auth, "update_diagram", {
      memoId: created.memo.id,
      expectedRevision: semantic.memo.revision,
      operations: [{ op: "remove_node", nodeId: "redis" }],
    })).rejects.toMatchObject({ code: "revision_conflict", status: 409 });
    await expect(callMcpTool(context, auth, "update_memo", {
      memoId: created.memo.id,
      contentMarkdown: "plain text",
    })).rejects.toMatchObject({ code: "diagram_update_required" });

    const stored = sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(created.memo.id);
    expect(parseDiagramDocument(stored.content_markdown).nodes.map((node) => node.id)).toContain("redis");
  });

  test("refuses to replace a structured table through update_memo", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    const created = await callMcpTool(context, auth, "create_memo", {
      notebookId: "nb_tables",
      title: "阅读清单",
      contentMarkdown: serializeTableDocument(createDefaultTableDocument()),
    });
    const read = await callMcpTool(context, auth, "get_memo", { memoId: created.memo.id });
    expect(read.structuredTable).toMatchObject({ fieldCount: 3, recordCount: 1 });
    expect(JSON.stringify(read)).not.toContain("edgeever-table-v1");
    await expect(callMcpTool(context, auth, "update_memo", {
      memoId: created.memo.id,
      contentMarkdown: "plain text",
    })).rejects.toMatchObject({ code: "table_update_required" });
    const stored = sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(created.memo.id);
    expect(parseTableDocument(stored.content_markdown)?.records).toHaveLength(1);
  });

  test("reads and mutates records in one structured table without replacing other records", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    const created = await callMcpTool(context, auth, "create_memo", {
      notebookId: "nb_tables",
      title: "阅读清单",
      contentMarkdown: serializeTableDocument(createDefaultTableDocument()),
    });
    const memoId = created.memo.id;
    const first = await callMcpTool(context, auth, "get_table_records", { memoId, limit: 1 });
    expect(first).toMatchObject({ memoId, totalRecords: 1, limit: 1, offset: 0 });
    expect(first.fields.map((field) => field.id)).toEqual(["fld_name", "fld_status", "fld_date"]);
    expect(first.records.map((record) => record.id)).toEqual(["rec_sample"]);

    const added = await callMcpTool(context, auth, "add_table_record", {
      memoId, expectedRevision: first.revision,
      cells: { fld_name: "读一本书", fld_status: "进行中" },
    });
    expect(added.record).toMatchObject({ id: added.recordId, cells: { fld_name: "读一本书", fld_status: "进行中" } });
    const page = await callMcpTool(context, auth, "get_table_records", { memoId, offset: 1, limit: 1 });
    expect(page.records.map((record) => record.id)).toEqual([added.recordId]);
    const byId = await callMcpTool(context, auth, "get_table_records", { memoId, recordId: added.recordId });
    expect(byId.records[0].cells.fld_name).toBe("读一本书");

    const changed = await callMcpTool(context, auth, "update_table_record", {
      memoId, recordId: added.recordId, expectedRevision: added.revision,
      cells: { fld_status: "完成", fld_date: "2026-09-30" },
    });
    expect(changed.record.cells).toMatchObject({ fld_name: "读一本书", fld_status: "完成", fld_date: "2026-09-30" });
    const deleted = await callMcpTool(context, auth, "delete_table_record", {
      memoId, recordId: added.recordId, expectedRevision: changed.revision,
    });
    expect(deleted.deleted).toBe(true);
    const final = await callMcpTool(context, auth, "get_table_records", { memoId });
    expect(final.records.map((record) => record.id)).toEqual(["rec_sample"]);
    const stored = sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(memoId);
    expect(parseTableDocument(stored.content_markdown)?.records.map((record) => record.id)).toEqual(["rec_sample"]);
  });

  test("rejects stale revisions, invalid cells, non-tables, and missing scope for table tools", async () => {
    const { auth, context } = createFixture();
    const sqlite = context.env.storage.db.db;
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    const table = await callMcpTool(context, auth, "create_memo", {
      notebookId: "nb_tables", contentMarkdown: serializeTableDocument(createDefaultTableDocument()),
    });
    const plain = await callMcpTool(context, auth, "create_memo", {
      notebookId: "nb_tables", contentMarkdown: "Plain note",
    });
    const memoId = table.memo.id;
    const revision = table.memo.revision;
    await expect(callMcpTool(context, auth, "add_table_record", {
      memoId, expectedRevision: revision + 1, cells: { fld_name: "stale" },
    })).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(callMcpTool(context, auth, "add_table_record", {
      memoId, expectedRevision: revision, cells: { unknown: "value" },
    })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(callMcpTool(context, auth, "update_table_record", {
      memoId, recordId: "rec_sample", expectedRevision: revision, cells: { fld_status: "not-an-option" },
    })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(callMcpTool(context, auth, "get_table_records", { memoId: plain.memo.id }))
      .rejects.toMatchObject({ code: "not_table" });
    await expect(callMcpTool(context, { ...auth, scopes: ["read:memos"] }, "delete_table_record", {
      memoId, recordId: "rec_sample", expectedRevision: revision,
    })).rejects.toMatchObject({ code: "forbidden" });
    await expect(callMcpTool(context, { ...auth, workspaceId: "ws_other" }, "get_table_records", { memoId }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  test("accepts only attachment resources owned by the target table memo", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    const document = addTableField(createDefaultTableDocument(), { id: "fld_files", name: "附件", type: "attachment" });
    const table = await callMcpTool(context, auth, "create_memo", {
      notebookId: "nb_tables", contentMarkdown: serializeTableDocument(document),
    });
    const other = await callMcpTool(context, auth, "create_memo", {
      notebookId: "nb_tables", contentMarkdown: "Other note",
    });
    sqlite.query("INSERT INTO resources (id, memo_id, object_key, kind, filename, mime_type, byte_size) VALUES (?, ?, ?, 'attachment', ?, ?, ?)")
      .run("res_owned", table.memo.id, "mcp-owned", "notes.pdf", "application/pdf", 123);
    sqlite.query("INSERT INTO resources (id, memo_id, object_key, kind, filename, mime_type, byte_size) VALUES (?, ?, ?, 'attachment', ?, ?, ?)")
      .run("res_other", other.memo.id, "mcp-other", "secret.pdf", "application/pdf", 456);
    await expect(callMcpTool(context, auth, "add_table_record", {
      memoId: table.memo.id, expectedRevision: table.memo.revision,
      cells: { fld_files: ["res_other"] },
    })).rejects.toMatchObject({ code: "invalid_params" });
    const added = await callMcpTool(context, auth, "add_table_record", {
      memoId: table.memo.id, expectedRevision: table.memo.revision,
      cells: { fld_files: ["res_owned"] },
    });
    expect(added.record.cells.fld_files).toEqual([{
      resourceId: "res_owned", filename: "notes.pdf", mimeType: "application/pdf", byteSize: 123,
    }]);
    await callMcpTool(context, auth, "delete_table_record", {
      memoId: table.memo.id, recordId: added.recordId, expectedRevision: added.revision,
    });
    expect(sqlite.query("SELECT is_deleted FROM resources WHERE id = 'res_owned'").get().is_deleted).toBe(1);
  });

  test("creates a table from a field plan and edits its schema while preserving records", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    const created = await callMcpTool(context, auth, "create_table_memo", {
      notebookId: "nb_tables", title: "客户跟进", tags: ["CRM"],
      fields: [
        { name: "客户", type: "text" },
        { name: "阶段", type: "select", options: ["线索", "洽谈", "成交"] },
      ],
    });
    const memoId = created.memo.id;
    const [customer, stage] = created.fields;
    expect(created.memo.title).toBe("客户跟进");
    expect(JSON.stringify(created.memo)).not.toContain("edgeever-table-v1");
    expect((await callMcpTool(context, auth, "get_table_records", { memoId })).totalRecords).toBe(0);
    const added = await callMcpTool(context, auth, "add_table_record", {
      memoId, expectedRevision: created.revision,
      cells: { [customer.id]: "明月公司", [stage.id]: "洽谈" },
    });

    const operations = [
      { op: "update_field", fieldId: customer.id, changes: { name: "客户名称" } },
      { op: "add_field", field: { name: "金额", type: "number" } },
    ];
    const preview = await callMcpTool(context, auth, "update_table_schema", {
      memoId, expectedRevision: added.revision, operations, dryRun: true,
    });
    expect(preview).toMatchObject({ dryRun: true, changedCellCount: 0, removedAttachmentCount: 0 });
    expect(preview.fields[2].id).toBeNull();
    expect((await callMcpTool(context, auth, "get_table_records", { memoId })).fields).toHaveLength(2);
    const changed = await callMcpTool(context, auth, "update_table_schema", {
      memoId, expectedRevision: added.revision, operations,
    });
    expect(changed.fields.map((field) => field.name)).toEqual(["客户名称", "阶段", "金额"]);
    expect(changed.fields[0].id).toBe(customer.id);
    expect(changed.fields[2].id).toMatch(/^fld_/);
    const after = await callMcpTool(context, auth, "get_table_records", { memoId, recordId: added.recordId });
    expect(after.records[0].cells).toMatchObject({ [customer.id]: "明月公司", [stage.id]: "洽谈" });
    expect(after.records[0].cells[changed.fields[2].id]).toBeNull();
  });

  test("previews destructive schema edits and requires explicit data-change authorization", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    const created = await callMcpTool(context, auth, "create_table_memo", {
      notebookId: "nb_tables", title: "销售线索",
      fields: [
        { name: "名称", type: "text" },
        { name: "状态", type: "select", options: ["新建", "完成"] },
      ],
    });
    const [nameField, statusField] = created.fields;
    const added = await callMcpTool(context, auth, "add_table_record", {
      memoId: created.memo.id, expectedRevision: created.revision,
      cells: { [nameField.id]: "机会 A", [statusField.id]: "完成" },
    });
    const operations = [{ op: "update_field", fieldId: statusField.id, changes: { options: ["新建"] } }];
    const preview = await callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: added.revision, operations, dryRun: true,
    });
    expect(preview.changedCellCount).toBe(1);
    await expect(callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: added.revision, operations,
    })).rejects.toMatchObject({ code: "table_data_changes_required" });
    expect((await callMcpTool(context, auth, "get_table_records", { memoId: created.memo.id, recordId: added.recordId }))
      .records[0].cells[statusField.id]).toBe("完成");
    const changed = await callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: added.revision, operations, allowDataChanges: true,
    });
    expect(changed.changedCellCount).toBe(1);
    const after = await callMcpTool(context, auth, "get_table_records", { memoId: created.memo.id, recordId: added.recordId });
    expect(after.records[0].cells[statusField.id]).toBe("");
    await expect(callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: added.revision,
      operations: [{ op: "remove_field", fieldId: nameField.id }],
    })).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: changed.revision,
      operations: [{ op: "remove_field", fieldId: nameField.id }],
    })).rejects.toMatchObject({ code: "table_data_changes_required" });
  });

  test("rejects invalid table field plans and cross-workspace schema edits", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    await expect(callMcpTool(context, auth, "create_table_memo", {
      notebookId: "nb_tables", title: "Invalid", fields: [{ name: "状态", type: "select" }],
    })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(callMcpTool(context, auth, "create_table_memo", {
      notebookId: "nb_tables", title: "Invalid",
      fields: [{ name: "名称", type: "text" }, { name: "名称", type: "number" }],
    })).rejects.toMatchObject({ code: "invalid_params" });
    const created = await callMcpTool(context, auth, "create_table_memo", {
      notebookId: "nb_tables", title: "Valid", fields: [{ name: "名称", type: "text" }],
    });
    await expect(callMcpTool(context, { ...auth, scopes: ["read:memos"] }, "create_table_memo", {
      notebookId: "nb_tables", title: "Denied", fields: [{ name: "名称", type: "text" }],
    })).rejects.toMatchObject({ code: "forbidden" });
    await expect(callMcpTool(context, { ...auth, scopes: ["read:memos"] }, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: created.revision,
      operations: [{ op: "add_field", field: { name: "金额", type: "number" } }],
    })).rejects.toMatchObject({ code: "forbidden" });
    await expect(callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: created.revision,
      operations: [{ op: "remove_field", fieldId: created.fields[0].id }],
    })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(callMcpTool(context, { ...auth, workspaceId: "ws_other" }, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: created.revision,
      operations: [{ op: "add_field", field: { name: "金额", type: "number" } }],
    })).rejects.toMatchObject({ code: "not_found" });
  });

  test("previews field removal, releases unused attachments, and converts cell values only when allowed", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_tables", "ws_mcp", "Tables");
    const created = await callMcpTool(context, auth, "create_table_memo", {
      notebookId: "nb_tables", title: "合同",
      fields: [{ name: "预算", type: "text" }, { name: "文件", type: "attachment" }],
    });
    const [budget, file] = created.fields;
    sqlite.query("INSERT INTO resources (id, memo_id, object_key, kind, filename, mime_type, byte_size) VALUES (?, ?, ?, 'attachment', ?, ?, ?)")
      .run("res_contract", created.memo.id, "contract-file", "contract.pdf", "application/pdf", 100);
    const added = await callMcpTool(context, auth, "add_table_record", {
      memoId: created.memo.id, expectedRevision: created.revision,
      cells: { [budget.id]: "1200", [file.id]: ["res_contract"] },
    });
    const changeType = [{ op: "update_field", fieldId: budget.id, changes: { type: "number" } }];
    const typePreview = await callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: added.revision, operations: changeType, dryRun: true,
    });
    expect(typePreview.changedCellCount).toBe(1);
    const converted = await callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: added.revision,
      operations: changeType, allowDataChanges: true,
    });
    const row = await callMcpTool(context, auth, "get_table_records", { memoId: created.memo.id, recordId: added.recordId });
    expect(row.records[0].cells[budget.id]).toBe(1200);

    const removeFile = [{ op: "remove_field", fieldId: file.id }];
    const dropPreview = await callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: converted.revision, operations: removeFile, dryRun: true,
    });
    expect(dropPreview).toMatchObject({ changedCellCount: 1, removedAttachmentCount: 1 });
    expect(sqlite.query("SELECT is_deleted FROM resources WHERE id = 'res_contract'").get().is_deleted).toBe(0);
    await callMcpTool(context, auth, "update_table_schema", {
      memoId: created.memo.id, expectedRevision: converted.revision,
      operations: removeFile, allowDataChanges: true,
    });
    expect(sqlite.query("SELECT is_deleted FROM resources WHERE id = 'res_contract'").get().is_deleted).toBe(1);
  });

  test("keeps mind-map hierarchy edges consistent when a node is reparented", async () => {
    const { sqlite, auth, context } = createFixture();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_diagrams", "ws_mcp", "Diagrams");
    const created = await callMcpTool(context, auth, "create_diagram_memo", {
      notebookId: "nb_diagrams",
      kind: "mind-map",
      nodes: [
        { id: "root", label: "Root" },
        { id: "left", label: "Left", parentId: "root" },
        { id: "leaf", label: "Leaf", parentId: "left" },
      ],
    });
    const updated = await callMcpTool(context, auth, "update_diagram", {
      memoId: created.memo.id,
      expectedRevision: created.memo.revision,
      operations: [{ op: "update_node", nodeId: "leaf", changes: { parentId: "root" } }],
    });
    expect(updated.diagram.nodes.find((node) => node.id === "leaf").parentId).toBe("root");
    expect(updated.diagram.edges.filter((edge) => edge.target === "leaf")).toMatchObject([
      { source: "root", target: "leaf" },
    ]);
  });

  test("manages note templates within the authenticated workspace", async () => {
    const { sqlite, auth, context } = createFixture();

    const created = await callMcpTool(context, auth, "create_note_template", {
      name: "Weekly review",
      description: "Reusable weekly structure",
      title: "Week of",
      contentMarkdown: "## Progress\n\n- ",
      tags: ["weekly"],
    });
    expect(created.template).toMatchObject({
      name: "Weekly review",
      contentMarkdown: "## Progress\n\n- ",
      tags: ["weekly"],
    });

    sqlite.query(
      `INSERT INTO memo_templates (
         id, workspace_id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
       ) VALUES ('template_other', 'ws_other', 'Hidden', NULL, NULL, '{"type":"doc","content":[]}', '', '[]', ?, ?)`,
    ).run(new Date().toISOString(), new Date().toISOString());

    const listed = await callMcpTool(context, auth, "list_note_templates", {});
    expect(listed.templates.map((template) => template.id)).toEqual([created.template.id]);

    const updated = await callMcpTool(context, auth, "update_note_template", {
      templateId: created.template.id,
      name: "Updated weekly review",
      contentMarkdown: "## Outcomes",
    });
    expect(updated.template).toMatchObject({ name: "Updated weekly review", contentMarkdown: "## Outcomes" });

    await expect(callMcpTool(context, auth, "get_note_template", { templateId: "template_other" }))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(callMcpTool(context, auth, "update_note_template", { templateId: created.template.id }))
      .rejects.toMatchObject({ code: "invalid_params" });

    expect(await callMcpTool(context, auth, "delete_note_template", { templateId: created.template.id }))
      .toEqual({ ok: true });
    expect((await callMcpTool(context, auth, "list_note_templates", {})).templates).toEqual([]);
  });

  test("manages custom AI instructions and restores built-ins", async () => {
    const { auth, context } = createFixture();

    const created = await callMcpTool(context, auth, "create_ai_instruction", {
      name: "Decision log",
      description: "Extract decisions",
      instruction: "Return decisions and owners as a Markdown list.",
      resultMode: "append",
    });
    expect(created.instruction).toMatchObject({
      origin: "custom",
      name: "Decision log",
      parameterKind: "none",
      resultMode: "append",
    });

    const updated = await callMcpTool(context, auth, "update_ai_instruction", {
      instructionId: created.instruction.id,
      instruction: "Return decisions, owners, and due dates.",
      parameterKind: "tone",
    });
    expect(updated.instruction).toMatchObject({
      instruction: "Return decisions, owners, and due dates.",
      parameterKind: "tone",
    });

    const restored = await callMcpTool(context, auth, "restore_default_ai_instructions", { locale: "zh-CN" });
    expect(restored.restoredCount).toBeGreaterThan(0);
    expect(restored.instructions).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: "default" }),
      expect.objectContaining({ id: created.instruction.id }),
    ]));

    expect(await callMcpTool(context, auth, "delete_ai_instruction", { instructionId: created.instruction.id }))
      .toEqual({ ok: true });
    await expect(callMcpTool(context, auth, "get_ai_instruction", { instructionId: created.instruction.id }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  test("enforces memo scopes and demo-mode mutation protection", async () => {
    const readOnly = createFixture(["read:memos"]);
    await expect(callMcpTool(readOnly.context, readOnly.auth, "create_note_template", {
      name: "Denied",
      contentMarkdown: "No",
    })).rejects.toMatchObject({ code: "forbidden" });

    const writeOnly = createFixture(["write:memos"]);
    await expect(callMcpTool(writeOnly.context, writeOnly.auth, "list_ai_instructions", {}))
      .rejects.toMatchObject({ code: "forbidden" });

    const demo = createFixture();
    demo.context.env.EDGE_EVER_DEMO_MODE = "true";
    await expect(callMcpTool(demo.context, demo.auth, "create_ai_instruction", {
      name: "Denied",
      instruction: "No",
    })).rejects.toMatchObject({ code: "forbidden" });
  });
});
