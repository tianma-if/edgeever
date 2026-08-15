import {
  DEFAULT_AI_PROMPT_SEEDS,
  defaultAiPromptId,
} from "@edgeever/shared/ai-prompt-seeds";
import { createId, isoNow } from "./entity-utils";
import type {
  DatabaseAdapter,
  PreparedStatementAdapter,
} from "./storage-contract";

export const DEFAULT_WORKSPACE_ID = "ws_default";

export type UserWorkspace = {
  workspaceId: string;
  role: "owner" | "member";
};

export type DefaultNotebookRow = {
  id: string;
  name: string;
  slug: string;
  color: string;
  sortOrder: number;
};

export const createDefaultNotebookRows = (workspaceId: string): DefaultNotebookRow[] => [
  { id: `${workspaceId}_inbox`, name: "等待分类", slug: "inbox", color: "#0f766e", sortOrder: 10 },
  { id: `${workspaceId}_projects`, name: "工作项目", slug: "work-projects", color: "#2563eb", sortOrder: 20 },
  { id: `${workspaceId}_learning`, name: "学习资料", slug: "learning-resources", color: "#7c3aed", sortOrder: 30 },
  { id: `${workspaceId}_creative`, name: "灵感创作", slug: "creative-ideas", color: "#db2777", sortOrder: 40 },
  { id: `${workspaceId}_personal`, name: "生活个人", slug: "personal-life", color: "#ea580c", sortOrder: 50 },
];

const PROJECT_WEEKLY_TEMPLATE_MARKDOWN = "## 本周进展\n\n- \n\n## 关键成果\n\n- \n\n## 风险与阻塞\n\n- \n\n## 下周计划\n\n- [ ] \n\n## 需要协助\n\n- ";

// This is the build-time result of parsing PROJECT_WEEKLY_TEMPLATE_MARKDOWN.
// Keeping it static avoids loading and executing the TipTap Markdown parser
// merely to provision a workspace.
const PROJECT_WEEKLY_TEMPLATE_CONTENT_JSON = JSON.stringify({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "本周进展" }] },
    { type: "paragraph", content: [{ type: "text", text: "- " }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "关键成果" }] },
    { type: "paragraph", content: [{ type: "text", text: "- " }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "风险与阻塞" }] },
    { type: "paragraph", content: [{ type: "text", text: "- " }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "下周计划" }] },
    {
      type: "taskList",
      content: [{
        type: "taskItem",
        attrs: { checked: false },
        content: [{ type: "paragraph", content: [] }],
      }],
    },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "需要协助" }] },
    { type: "paragraph", content: [{ type: "text", text: "- " }] },
  ],
});

export const createWorkspaceDefaultSeedStatements = (
  db: DatabaseAdapter,
  workspaceId: string,
  now = isoNow(),
): PreparedStatementAdapter[] => [
  db.prepare(
    `INSERT OR IGNORE INTO memo_templates (
       id, workspace_id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `${workspaceId}_template_project_weekly`,
    workspaceId,
    "项目周报模板",
    "每周同步项目进展、风险与下一步计划",
    "项目周报｜第 {{周次}} 周",
    PROJECT_WEEKLY_TEMPLATE_CONTENT_JSON,
    PROJECT_WEEKLY_TEMPLATE_MARKDOWN,
    JSON.stringify(["项目管理", "周报"]),
    now,
    now,
  ),
  ...DEFAULT_AI_PROMPT_SEEDS.map((seed) => db.prepare(
    `INSERT OR IGNORE INTO ai_prompt_templates (
       id, workspace_id, seed_key, action, parameter_kind, result_mode,
       name, description, instruction,
       name_customized, description_customized, instruction_customized,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
  ).bind(
    defaultAiPromptId(workspaceId, seed.key),
    workspaceId,
    seed.key,
    seed.action,
    seed.parameterKind,
    seed.resultMode,
    seed.name,
    seed.description,
    seed.instruction,
    now,
    now,
  )),
];

export const ensureUserWorkspace = async (
  db: DatabaseAdapter,
  userId: string,
  username: string,
): Promise<UserWorkspace> => {
  const existing = await db.prepare(
    `SELECT workspace_id, role FROM workspace_members WHERE user_id = ? LIMIT 1`,
  ).bind(userId).first<{ workspace_id: string; role: "owner" | "member" }>();
  if (existing) {
    return { workspaceId: existing.workspace_id, role: existing.role };
  }

  const defaultOwner = await db.prepare(
    `SELECT user_id FROM workspace_members WHERE workspace_id = ? LIMIT 1`,
  ).bind(DEFAULT_WORKSPACE_ID).first<{ user_id: string }>();
  if (!defaultOwner) {
    await db.prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')`,
    ).bind(DEFAULT_WORKSPACE_ID, userId).run();
    const claimed = await db.prepare(
      `SELECT workspace_id, role FROM workspace_members WHERE user_id = ? LIMIT 1`,
    ).bind(userId).first<{ workspace_id: string; role: "owner" | "member" }>();
    if (claimed) {
      await db.batch(createWorkspaceDefaultSeedStatements(db, claimed.workspace_id));
      return { workspaceId: claimed.workspace_id, role: claimed.role };
    }
  }

  const workspaceId = createId("ws");
  const now = isoNow();
  const notebooks = createDefaultNotebookRows(workspaceId);
  await db.batch([
    db.prepare(
      `INSERT INTO workspaces (id, name, is_personal, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
    ).bind(workspaceId, `${username}'s workspace`, now, now),
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`,
    ).bind(workspaceId, userId, now),
    ...notebooks.map((notebook) => db.prepare(
      `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 'notebook', ?, ?, ?, ?)`,
    ).bind(
      notebook.id,
      workspaceId,
      notebook.name,
      notebook.slug,
      notebook.color,
      notebook.sortOrder,
      now,
      now,
    )),
    ...createWorkspaceDefaultSeedStatements(db, workspaceId, now),
  ]);
  return { workspaceId, role: "member" };
};
