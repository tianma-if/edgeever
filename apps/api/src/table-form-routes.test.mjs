import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { addTableField, createDefaultTableDocument, serializeTableDocument } from "@edgeever/shared";
import { hashPassword } from "./auth-crypto.ts";
import { updateMemoRecord } from "./memo-service.ts";
import { registerPublicTableFormRoutes } from "./table-form-routes.ts";

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

const token = "f".repeat(43);

const createApp = async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(migration, "utf8"));
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_form', 'Form', 1)").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_form', 'ws_form', 'Inbox')").run();
  sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES ('memo_form', 'ws_form', 'nb_form', '报名')").run();
  sqlite.query("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash) VALUES ('memo_form', '{}', '', '', 'hash')").run();
  const database = new SqliteD1Database(sqlite);
  await updateMemoRecord(database, "ws_form", "memo_form", {
    contentMarkdown: serializeTableDocument(createDefaultTableDocument()),
  }, { actorType: "user", actorId: null }, "owner", false);
  sqlite.query(
    `INSERT INTO table_forms (id, memo_id, workspace_id, token, enabled, title, fields_json)
     VALUES ('form_1', 'memo_form', 'ws_form', ?, 1, '报名表', ?)`,
  ).run(token, JSON.stringify([{ fieldId: "fld_name", required: true }]));
  const app = new Hono();
  registerPublicTableFormRoutes(app);
  return { sqlite, app, environment: { storage: { db: database, resources: {} } } };
};

describe("public table forms", () => {
  test("appends one row and does not publish existing records", async () => {
    const { sqlite, app, environment } = await createApp();
    const listed = await app.request(`/api/public/forms/${token}`, {}, environment);
    expect(listed.status).toBe(200);
    const body = JSON.stringify(await listed.json());
    expect(body).toContain("名称");
    expect(body).not.toContain("示例记录");

    const submitted = await app.request(`/api/public/forms/${token}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells: { fld_name: "外来记录" } }),
    }, environment);
    expect(submitted.status).toBe(201);
    const stored = sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = 'memo_form'").get().content_markdown;
    expect(stored).toContain("外来记录");
    expect(sqlite.query("SELECT updated_by FROM memos WHERE id = 'memo_form'").get().updated_by).toBe("table-form");

    const again = await app.request(`/api/public/forms/${token}`, {}, environment);
    expect(JSON.stringify(await again.json())).not.toContain("外来记录");
    const missing = await app.request(`/api/public/forms/${token}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells: { fld_name: "" } }),
    }, environment);
    expect(missing.status).toBe(400);
    sqlite.close();
  });

  test("skips saved required settings whose field became a system timestamp", async () => {
    const { sqlite, app, environment } = await createApp();
    const document = addTableField(createDefaultTableDocument(), { name: "创建时间", type: "createdTime" });
    const createdField = document.fields[document.fields.length - 1];
    await updateMemoRecord(environment.storage.db, "ws_form", "memo_form", {
      contentMarkdown: serializeTableDocument(document),
    }, { actorType: "user", actorId: null }, "owner", false);
    sqlite.query("UPDATE table_forms SET fields_json = ? WHERE id = 'form_1'").run(
      JSON.stringify([{ fieldId: createdField.id, required: true }, { fieldId: "fld_name", required: false }]),
    );

    const listed = await app.request(`/api/public/forms/${token}`, {}, environment);
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.form.fields.map((field) => field.name)).toEqual(["名称"]);

    const submitted = await app.request(`/api/public/forms/${token}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells: { fld_name: "系统字段不拦截" } }),
    }, environment);
    expect(submitted.status).toBe(201);
    expect(sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = 'memo_form'").get().content_markdown)
      .toContain("系统字段不拦截");
    sqlite.close();
  });

  test("hides fields until the password is entered and stops when the form is closed", async () => {
    const { sqlite, app, environment } = await createApp();
    const passwordHash = await hashPassword("secret12");
    sqlite.query("UPDATE table_forms SET password_hash = ? WHERE id = 'form_1'").run(passwordHash);
    const locked = await app.request(`/api/public/forms/${token}`, {}, environment);
    const lockedBody = await locked.json();
    expect(lockedBody.form.passwordRequired).toBe(true);
    expect(lockedBody.form.fields).toEqual([]);
    expect(JSON.stringify(lockedBody)).not.toContain("示例记录");

    sqlite.query("UPDATE table_forms SET enabled = 0 WHERE id = 'form_1'").run();
    const closed = await app.request(`/api/public/forms/${token}`, {}, environment);
    expect(closed.status).toBe(404);
    sqlite.close();
  });
});
