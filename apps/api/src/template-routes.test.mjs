import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { listMemoTemplateGallery } from "@edgeever/shared/memo-template-gallery";
import { mapMemoTemplateRow, registerTemplateRoutes } from "./template-routes.ts";

const row = {
  id: "template_1",
  name: "Weekly review",
  description: "Review template",
  title: "Week 1",
  content_json: '{"type":"doc","content":[{"type":"paragraph"}]}',
  content_markdown: "# Week 1",
  tags_json: '["review","weekly"]',
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T01:00:00.000Z",
};

describe("template route mapping", () => {
  test("maps storage rows into the public template contract", () => {
    expect(mapMemoTemplateRow(row)).toEqual({
      id: "template_1",
      name: "Weekly review",
      description: "Review template",
      title: "Week 1",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMarkdown: "# Week 1",
      tags: ["review", "weekly"],
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T01:00:00.000Z",
    });
  });

  test("fails closed to an empty document for damaged stored JSON", () => {
    expect(mapMemoTemplateRow({ ...row, content_json: "damaged" }).contentJson).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("template gallery route", () => {
  test("lists the gallery in the requested language without touching storage", async () => {
    const app = new Hono();
    registerTemplateRoutes(app, { createMemoRecord: async () => null, getMemoDetail: async () => null });

    const response = await app.request("/api/v1/templates/gallery?locale=pl-PL", {}, {});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.templates).toEqual(listMemoTemplateGallery("pl"));
  });
});

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

const ownerAuth = {
  kind: "user",
  actorType: "user",
  actorId: "usr_owner",
  username: "owner",
  scopes: [],
  workspaceId: "ws_owner",
  role: "owner",
};

const otherAuth = { ...ownerAuth, actorId: "usr_other", username: "other", workspaceId: "ws_other" };

const createTemplateHarness = ({ memos = {} } = {}) => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  for (const id of ["ws_owner", "ws_other"]) {
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run(id, id);
  }
  // Start from an empty template table so assertions only see rows created here.
  sqlite.query("DELETE FROM memo_templates").run();

  const memoDetailCalls = [];
  const createdMemos = [];
  const dependencies = {
    getMemoDetail: async (_db, workspaceId, id) => {
      memoDetailCalls.push({ workspaceId, id });
      return memos[`${workspaceId}/${id}`] ?? null;
    },
    createMemoRecord: async (_db, workspaceId, input, actor, actorLabel) => {
      const memo = { id: `memo_${createdMemos.length + 1}`, workspaceId, ...input };
      createdMemos.push({ workspaceId, input, actor, actorLabel });
      return memo;
    },
  };

  const createApp = (currentAuth = ownerAuth) => {
    const app = new Hono();
    app.use("/api/v1/*", async (context, next) => {
      context.set("auth", currentAuth);
      await next();
    });
    registerTemplateRoutes(app, dependencies);
    return app;
  };

  const environment = { storage: { db: new SqliteD1Database(sqlite), resources: {} } };
  const request = (path, init = {}, currentAuth = ownerAuth) => {
    const { json, ...rest } = init;
    return createApp(currentAuth).request(
      path,
      json === undefined
        ? rest
        : { ...rest, headers: { "content-type": "application/json" }, body: JSON.stringify(json) },
      environment,
    );
  };

  const auditActions = () =>
    sqlite.query("SELECT action, entity_id, actor_id, metadata_json FROM audit_events ORDER BY rowid").all();

  return { sqlite, request, memoDetailCalls, createdMemos, auditActions };
};

describe("template CRUD routes", () => {
  test("creates a template from markdown, trims fields and records an audit event", async () => {
    const harness = createTemplateHarness();

    const response = await harness.request("/api/v1/templates", {
      method: "POST",
      json: {
        name: "  Standup  ",
        description: "  Daily notes  ",
        title: "  Today  ",
        contentMarkdown: "# Standup",
        tags: ["daily"],
      },
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.template).toMatchObject({
      name: "Standup",
      description: "Daily notes",
      title: "Today",
      contentMarkdown: "# Standup",
      tags: ["daily"],
    });
    expect(body.template.id).toStartWith("template");
    expect(body.template.contentJson.type).toBe("doc");
    expect(harness.memoDetailCalls).toEqual([]);

    const stored = harness.sqlite.query("SELECT workspace_id FROM memo_templates WHERE id = ?").get(body.template.id);
    expect(stored.workspace_id).toBe("ws_owner");
    expect(harness.auditActions()).toEqual([{
      action: "template.create",
      entity_id: body.template.id,
      actor_id: "usr_owner",
      metadata_json: JSON.stringify({ memoId: null }),
    }]);
  });

  test("stores blank optional text as null and defaults tags to an empty list", async () => {
    const harness = createTemplateHarness();

    const response = await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "Blank", description: "   ", title: "   ", contentMarkdown: "" },
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.template).toMatchObject({ description: null, title: null, contentMarkdown: "", tags: [] });
  });

  test("copies title, content and tags from a memo in the caller's workspace", async () => {
    const memoDoc = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Source" }] }] };
    const harness = createTemplateHarness({
      memos: {
        "ws_owner/memo_source": {
          id: "memo_source",
          title: "Source",
          contentMarkdown: "# Source",
          contentJson: memoDoc,
          tags: ["from-memo"],
        },
      },
    });

    const response = await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "From memo", memoId: "memo_source", title: "ignored", contentMarkdown: "ignored", tags: ["ignored"] },
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.template).toMatchObject({
      title: "Source",
      contentMarkdown: "# Source",
      contentJson: memoDoc,
      tags: ["from-memo"],
    });
    expect(harness.memoDetailCalls).toEqual([{ workspaceId: "ws_owner", id: "memo_source" }]);
    expect(JSON.parse(harness.auditActions()[0].metadata_json)).toEqual({ memoId: "memo_source" });
  });

  test("rejects a memo source that is missing or belongs to another workspace", async () => {
    const harness = createTemplateHarness({
      memos: { "ws_other/memo_foreign": { id: "memo_foreign", title: "Foreign", contentMarkdown: "x", contentJson: {}, tags: [] } },
    });

    const response = await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "Steal", memoId: "memo_foreign" },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "Memo not found" } });
    expect(harness.memoDetailCalls).toEqual([{ workspaceId: "ws_owner", id: "memo_foreign" }]);
    expect(harness.sqlite.query("SELECT COUNT(*) AS count FROM memo_templates").get().count).toBe(0);
    expect(harness.auditActions()).toEqual([]);
  });

  test("rejects invalid create payloads before touching storage", async () => {
    const harness = createTemplateHarness();

    for (const json of [
      { name: "No content" },
      { name: "   ", contentMarkdown: "x" },
      { name: "x".repeat(161), contentMarkdown: "x" },
      { name: "Bad tags", contentMarkdown: "x", tags: "daily" },
    ]) {
      const response = await harness.request("/api/v1/templates", { method: "POST", json });
      expect(response.status).toBe(400);
    }
    expect(harness.sqlite.query("SELECT COUNT(*) AS count FROM memo_templates").get().count).toBe(0);
  });

  test("lists only the caller's workspace templates, most recently updated first", async () => {
    const harness = createTemplateHarness();
    const insert = harness.sqlite.query(
      `INSERT INTO memo_templates (id, workspace_id, name, content_json, content_markdown, tags_json, updated_at)
       VALUES (?, ?, ?, '{"type":"doc","content":[]}', '', '[]', ?)`,
    );
    insert.run("template_old", "ws_owner", "Old", "2026-01-01T00:00:00.000Z");
    insert.run("template_new", "ws_owner", "New", "2026-02-01T00:00:00.000Z");
    insert.run("template_foreign", "ws_other", "Foreign", "2026-03-01T00:00:00.000Z");

    const response = await harness.request("/api/v1/templates");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.templates.map((template) => template.id)).toEqual(["template_new", "template_old"]);
  });

  test("updates only the provided fields and re-renders content from markdown", async () => {
    const harness = createTemplateHarness();
    const created = await (await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "Original", description: "Desc", title: "Title", contentMarkdown: "Old body", tags: ["a"] },
    })).json();
    const id = created.template.id;

    const renamed = await harness.request(`/api/v1/templates/${id}`, { method: "PATCH", json: { name: "Renamed" } });
    const renamedBody = await renamed.json();
    expect(renamed.status).toBe(200);
    expect(renamedBody.template).toMatchObject({
      name: "Renamed",
      description: "Desc",
      title: "Title",
      contentMarkdown: "Old body",
      contentJson: created.template.contentJson,
      tags: ["a"],
    });

    const rewritten = await harness.request(`/api/v1/templates/${id}`, {
      method: "PATCH",
      json: { description: null, title: "   ", contentMarkdown: "# New body", tags: [] },
    });
    const rewrittenBody = await rewritten.json();
    expect(rewritten.status).toBe(200);
    expect(rewrittenBody.template).toMatchObject({
      name: "Renamed",
      description: null,
      title: null,
      contentMarkdown: "# New body",
      tags: [],
    });
    expect(rewrittenBody.template.contentJson.content[0].type).toBe("heading");
    expect(harness.auditActions().map((event) => event.action)).toEqual([
      "template.create",
      "template.update",
      "template.update",
    ]);
  });

  test("does not let another workspace update, use or delete a template", async () => {
    const harness = createTemplateHarness();
    const created = await (await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "Private", contentMarkdown: "secret" },
    })).json();
    const id = created.template.id;

    const update = await harness.request(`/api/v1/templates/${id}`, { method: "PATCH", json: { name: "Hijacked" } }, otherAuth);
    const use = await harness.request(`/api/v1/templates/${id}/use`, { method: "POST", json: { notebookId: "nb_1" } }, otherAuth);
    const remove = await harness.request(`/api/v1/templates/${id}`, { method: "DELETE" }, otherAuth);

    for (const response of [update, use, remove]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: "Template not found" } });
    }
    expect(harness.createdMemos).toEqual([]);
    expect(harness.sqlite.query("SELECT name FROM memo_templates WHERE id = ?").get(id)).toEqual({ name: "Private" });
    expect(harness.auditActions().map((event) => event.action)).toEqual(["template.create"]);
  });

  test("returns 404 for unknown template ids", async () => {
    const harness = createTemplateHarness();

    expect((await harness.request("/api/v1/templates/template_missing", { method: "PATCH", json: {} })).status).toBe(404);
    expect((await harness.request("/api/v1/templates/template_missing", { method: "DELETE" })).status).toBe(404);
    expect((await harness.request("/api/v1/templates/template_missing/use", {
      method: "POST",
      json: { notebookId: "nb_1" },
    })).status).toBe(404);
  });

  test("rejects invalid update and use payloads", async () => {
    const harness = createTemplateHarness();

    expect((await harness.request("/api/v1/templates/template_1", { method: "PATCH", json: { name: "" } })).status).toBe(400);
    expect((await harness.request("/api/v1/templates/template_1", { method: "PATCH", json: { tags: [1] } })).status).toBe(400);
    expect((await harness.request("/api/v1/templates/template_1/use", { method: "POST", json: {} })).status).toBe(400);
    expect((await harness.request("/api/v1/templates/template_1/use", {
      method: "POST",
      json: { notebookId: "   " },
    })).status).toBe(400);
  });

  test("creates a memo from a template in the caller's notebook and audits the use", async () => {
    const harness = createTemplateHarness();
    const created = await (await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "Meeting", title: "Meeting notes", contentMarkdown: "## Agenda", tags: ["meeting"] },
    })).json();
    const id = created.template.id;

    const response = await harness.request(`/api/v1/templates/${id}/use`, {
      method: "POST",
      json: { notebookId: "nb_1", locale: "pl-PL" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.memo.id).toBe("memo_1");
    expect(harness.createdMemos).toEqual([{
      workspaceId: "ws_owner",
      input: { notebookId: "nb_1", title: "Meeting notes", contentMarkdown: "## Agenda", tags: ["meeting"] },
      actor: { actorType: "user", actorId: "usr_owner" },
      actorLabel: "user:usr_owner",
    }]);
    const useEvent = harness.auditActions().at(-1);
    expect(useEvent.action).toBe("template.use");
    expect(useEvent.entity_id).toBe(id);
    expect(JSON.parse(useEvent.metadata_json)).toEqual({ memoId: "memo_1" });
  });

  test("passes an untitled template to memo creation without a title", async () => {
    const harness = createTemplateHarness();
    const created = await (await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "Untitled", contentMarkdown: "Body" },
    })).json();

    await harness.request(`/api/v1/templates/${created.template.id}/use`, { method: "POST", json: { notebookId: "nb_2" } });

    expect(harness.createdMemos[0].input).toEqual({
      notebookId: "nb_2",
      title: undefined,
      contentMarkdown: "Body",
      tags: [],
    });
  });

  test("deletes a template from the caller's workspace", async () => {
    const harness = createTemplateHarness();
    const created = await (await harness.request("/api/v1/templates", {
      method: "POST",
      json: { name: "Disposable", contentMarkdown: "x" },
    })).json();
    const id = created.template.id;

    const response = await harness.request(`/api/v1/templates/${id}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(harness.sqlite.query("SELECT COUNT(*) AS count FROM memo_templates").get().count).toBe(0);
    expect(harness.auditActions().at(-1)).toMatchObject({ action: "template.delete", entity_id: id });
  });
});
