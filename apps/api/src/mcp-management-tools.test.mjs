import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { callMcpTool } from "./index.ts";

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
