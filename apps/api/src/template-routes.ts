import {
  emptyDoc,
  markdownToDoc,
  TemplateCreateSchema,
  TemplateUpdateSchema,
  TemplateUseSchema,
  type MemoDetail,
  type MemoTemplate,
  type TiptapDoc,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { audit } from "./audit";
import type { AppEnv, AuditActor } from "./api-context";
import { createId, parseJsonArray } from "./entity-utils";
import { notFound } from "./http-errors";
import { getActorLabel, getAuditActor, getWorkspaceId } from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";

export type MemoTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  title: string | null;
  content_json: string;
  content_markdown: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
};

type MemoCreateInput = {
  notebookId: string;
  title?: string;
  contentMarkdown?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type TemplateRouteDependencies = {
  createMemoRecord: (
    db: DatabaseAdapter,
    workspaceId: string,
    input: MemoCreateInput,
    actor: AuditActor,
    actorLabel: string
  ) => Promise<MemoDetail>;
  getMemoDetail: (
    db: DatabaseAdapter,
    workspaceId: string,
    id: string,
    includeDeleted?: boolean
  ) => Promise<MemoDetail | null>;
};

const parseTemplateDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as TiptapDoc) : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

export const mapMemoTemplateRow = (row: MemoTemplateRow): MemoTemplate => ({
  id: row.id,
  name: row.name,
  description: row.description,
  title: row.title,
  contentJson: parseTemplateDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  tags: parseJsonArray(row.tags_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getMemoTemplateRow = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string
): Promise<MemoTemplateRow | null> =>
  db.prepare(
    `SELECT id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
     FROM memo_templates
     WHERE id = ? AND workspace_id = ?`
  ).bind(id, workspaceId).first<MemoTemplateRow>();

export const getMemoTemplate = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string
): Promise<MemoTemplate | null> => {
  const row = await getMemoTemplateRow(db, workspaceId, id);
  return row ? mapMemoTemplateRow(row) : null;
};

export const listMemoTemplates = async (
  db: DatabaseAdapter,
  workspaceId: string,
): Promise<MemoTemplate[]> => {
  const rows = await db.prepare(
    `SELECT id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
     FROM memo_templates
     WHERE workspace_id = ?
     ORDER BY updated_at DESC, name ASC`,
  ).bind(workspaceId).all<MemoTemplateRow>();
  return rows.results.map(mapMemoTemplateRow);
};

export const registerTemplateRoutes = (
  app: Hono<AppEnv>,
  dependencies: TemplateRouteDependencies
) => {
  const { createMemoRecord, getMemoDetail } = dependencies;
  app.get("/api/v1/templates", async (c) => {
    return c.json({ templates: await listMemoTemplates(c.env.storage.db, getWorkspaceId(c)) });
  });

  app.post("/api/v1/templates", zValidator("json", TemplateCreateSchema), async (c) => {
    const input = c.req.valid("json");
    const workspaceId = getWorkspaceId(c);
    const memo = input.memoId ? await getMemoDetail(c.env.storage.db, workspaceId, input.memoId) : null;
    if (input.memoId && !memo) {
      return notFound(c, "Memo not found");
    }

    const id = createId("template");
    const now = new Date().toISOString();
    const title = memo?.title ?? (input.title?.trim() || null);
    const contentMarkdown = memo?.contentMarkdown ?? input.contentMarkdown ?? "";
    const tags = memo?.tags ?? input.tags ?? [];
    const contentJson = memo?.contentJson ?? markdownToDoc(contentMarkdown);
    await c.env.storage.db.prepare(
      `INSERT INTO memo_templates (
         id, workspace_id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      workspaceId,
      input.name.trim(),
      input.description?.trim() || null,
      title,
      JSON.stringify(contentJson),
      contentMarkdown,
      JSON.stringify(tags),
      now,
      now,
    ).run();

    const template = await getMemoTemplate(c.env.storage.db, workspaceId, id);
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.create", "template", id, { memoId: input.memoId ?? null });
    return c.json({ template }, 201);
  });

  app.patch("/api/v1/templates/:id", zValidator("json", TemplateUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const workspaceId = getWorkspaceId(c);
    const current = await getMemoTemplateRow(c.env.storage.db, workspaceId, id);
    if (!current) {
      return notFound(c, "Template not found");
    }

    const contentMarkdown = input.contentMarkdown ?? current.content_markdown;
    const contentJson = input.contentMarkdown !== undefined
      ? markdownToDoc(contentMarkdown)
      : JSON.parse(current.content_json);
    const tags = input.tags ?? parseJsonArray(current.tags_json);
    const now = new Date().toISOString();
    await c.env.storage.db.prepare(
      `UPDATE memo_templates
       SET name = ?, description = ?, title = ?, content_json = ?, content_markdown = ?, tags_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).bind(
      input.name ?? current.name,
      input.description !== undefined ? input.description?.trim() || null : current.description,
      input.title !== undefined ? input.title?.trim() || null : current.title,
      JSON.stringify(contentJson),
      contentMarkdown,
      JSON.stringify(tags),
      now,
      id,
      workspaceId,
    ).run();

    const template = await getMemoTemplate(c.env.storage.db, workspaceId, id);
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.update", "template", id, {});
    return c.json({ template });
  });

  app.post("/api/v1/templates/:id/use", zValidator("json", TemplateUseSchema), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const workspaceId = getWorkspaceId(c);
    const template = await getMemoTemplate(c.env.storage.db, workspaceId, id);
    if (!template) {
      return notFound(c, "Template not found");
    }

    const memo = await createMemoRecord(c.env.storage.db, workspaceId, {
      notebookId: input.notebookId,
      title: template.title ?? undefined,
      contentMarkdown: template.contentMarkdown,
      tags: template.tags,
    }, getAuditActor(c), getActorLabel(c));
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.use", "template", id, { memoId: memo.id });
    return c.json({ memo });
  });

  app.delete("/api/v1/templates/:id", async (c) => {
    const id = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const current = await getMemoTemplateRow(c.env.storage.db, workspaceId, id);
    if (!current) {
      return notFound(c, "Template not found");
    }

    await c.env.storage.db.prepare(`DELETE FROM memo_templates WHERE id = ? AND workspace_id = ?`).bind(id, workspaceId).run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.delete", "template", id, {});
    return c.json({ ok: true });
  });
};
