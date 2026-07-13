import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  docToText,
  emptyDoc,
  ApiTokenCreateSchema,
  ChangePasswordSchema,
  DeleteMemosSchema,
  LoginSchema,
  markdownToDoc,
  isSuspiciousMemoOverwrite,
  isMemoEditBindingValid,
  MemoCreateSchema,
  MemoUpdateSchema,
  MergeMemosSchema,
  MoveMemosSchema,
  normalizeTags,
  TagRenameSchema,
  NotebookCreateSchema,
  NotebookUpdateSchema,
  type ApiToken,
  type CreatedApiToken,
  type MemoDetail,
  type MemoEditSession,
  type MemoRevision,
  type MemoSummary,
  type MemoUpdateInput,
  type Notebook,
  type NotebookCreateInput,
  type Resource,
  type ResourceListItem,
  type ResourceStorageSummary,
  type TagSummary,
  type TiptapDoc,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import openApiSpec from "../../../docs/openapi.json";

type Bindings = {
  DB: D1Database;
  RESOURCES: R2Bucket;
  EDGE_EVER_AUTH_USERNAME?: string;
  EDGE_EVER_AUTH_PASSWORD_HASH?: string;
  EDGE_EVER_SESSION_TTL_DAYS?: string;
  EDGE_EVER_R2_BUCKET_NAME?: string;
  EDGE_EVER_DEMO_MODE?: string;
};

type AuthContext = {
  kind: "user" | "agent";
  actorType: "user" | "agent";
  actorId: string | null;
  username: string;
  displayName: string | null;
  scopes: string[];
  sessionId?: string;
  tokenId?: string;
};

type AuditActor = {
  actorType: "user" | "agent";
  actorId: string | null;
};

type NotebookRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  memo_count: number | null;
  last_memo_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

type MemoSummaryRow = {
  id: string;
  notebook_id: string;
  title: string | null;
  excerpt: string;
  content_text?: string | null;
  tags_json: string;
  is_pinned: number;
  is_archived: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
};

type MemoListSortMode = "updated-desc" | "created-desc" | "title-asc";
type MemoListFilterMode = "all" | "tagged" | "untagged" | "pinned";

type MemoListCursor = {
  sort: MemoListSortMode;
  id: string;
  pinned?: number;
  updatedAt?: string;
  createdAt?: string;
  deletedAt?: string | null;
  title?: string;
};

type MemoDetailRow = MemoSummaryRow & {
  content_json: string;
  content_markdown: string;
  content_text: string;
  source_memo_ids: string;
  merge_source_count: number;
  merged_into_memo_id: string | null;
  content_hash: string;
};

type MemoRevisionRow = {
  id: string;
  memo_id: string;
  revision: number;
  title: string | null;
  tags_json: string;
  content_json: string;
  content_markdown: string;
  content_text: string;
  content_hash: string;
  created_by: string;
  created_at: string;
};

type MemoEditSessionRow = {
  id: string;
  memo_id: string;
  actor_type: "user" | "agent";
  actor_id: string | null;
  base_revision: number;
  base_content_hash: string;
  expires_at: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  is_disabled: number;
};

type SessionRow = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  expires_at: string;
};

type ApiTokenRow = {
  id: string;
  name: string;
  token_value: string | null;
  scopes_json: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_revoked: number;
  created_at: string;
};

type TagSummaryRow = {
  name: string;
  memo_count: number;
  updated_at: string | null;
};

type MemoTagUpdateRow = {
  id: string;
  title: string | null;
  tags_json: string;
  content_text: string;
};

type ResourceRow = {
  id: string;
  memo_id: string;
  original_memo_id: string | null;
  bucket_name: string;
  object_key: string;
  kind: "image" | "attachment";
  mime_type: string | null;
  filename: string | null;
  byte_size: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
};

type ResourceListRow = ResourceRow & {
  memo_title: string | null;
  memo_excerpt: string | null;
  memo_is_deleted: number | null;
};

type ResourceStatsRow = {
  total_count: number;
  total_bytes: number;
  image_count: number;
  attachment_count: number;
};

type AppContext = Context<{ Bindings: Bindings; Variables: { auth: AuthContext } }>;

const SESSION_COOKIE = "edgeever_session";
const DEFAULT_MEMO_LIST_LIMIT = 100;
const MAX_MEMO_LIST_LIMIT = 200;
const UNTITLED_MEMO_TITLE = "无标题笔记";
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_DAYS = 400;
const MAX_SESSION_TTL_DAYS = 400;
const DEFAULT_R2_BUCKET_NAME = "edgeever-resources";
const DEMO_SEED_NOTEBOOKS = [
  { id: "nb_inbox", parentId: null, name: "等待分类", slug: "inbox", icon: "notebook", color: "#0f766e", sortOrder: 10 },
  { id: "nb_projects", parentId: null, name: "工作项目", slug: "work-projects", icon: "notebook", color: "#2563eb", sortOrder: 20 },
  { id: "nb_learning", parentId: null, name: "学习资料", slug: "learning-resources", icon: "notebook", color: "#7c3aed", sortOrder: 30 },
  { id: "nb_creative", parentId: null, name: "灵感创作", slug: "creative-ideas", icon: "notebook", color: "#db2777", sortOrder: 40 },
  { id: "nb_personal", parentId: null, name: "生活个人", slug: "personal-life", icon: "notebook", color: "#ea580c", sortOrder: 50 },
  { id: "nb_demo_features", parentId: "nb_projects", name: "功能演示", slug: "demo-features", icon: "notebook", color: "#0891b2", sortOrder: 21 },
];
const DEMO_SEED_MEMOS = [
  {
    id: "memo_welcome",
    notebookId: "nb_inbox",
    title: "欢迎来到 EdgeEver",
    tags: ["edgeever", "welcome"],
    isPinned: true,
    markdown:
      "## 欢迎来到 EdgeEver\n\n这是公开演示环境，可以随便创建、编辑、搜索和合并笔记。\n\n演示环境会每天自动重置，请不要保存私密内容。",
  },
  {
    id: "memo_demo_editor",
    notebookId: "nb_demo_features",
    title: "富文本与 Markdown 编辑",
    tags: ["editor", "markdown"],
    isPinned: true,
    markdown:
      "## 富文本与 Markdown 编辑\n\nEdgeEver 使用 TipTap 保存结构化正文，同时保留 Markdown 和纯文本索引。\n\n- 支持标题、列表、引用和代码块\n- API 和 MCP 可以直接读写 Markdown\n- 搜索使用纯文本索引，不依赖前端编辑器\n\n![EdgeEver 编辑器图片示例](/api/v1/resources/res_demo_editor_image/blob)",
  },
  {
    id: "memo_demo_search_tags",
    notebookId: "nb_learning",
    title: "标签、搜索与归档",
    tags: ["search", "tags", "workflow"],
    isPinned: false,
    markdown:
      "## 标签、搜索与归档\n\n这条笔记用于演示标签和全文搜索。你可以搜索 `workflow`、`全文搜索` 或 `EdgeEver`。\n\n建议把临时资料先放入等待分类，再通过标签和笔记本整理。",
  },
  {
    id: "memo_demo_merge",
    notebookId: "nb_demo_features",
    title: "多选合并笔记示例",
    tags: ["merge", "long-term-note"],
    isPinned: false,
    markdown:
      "## 多选合并笔记示例\n\n在笔记列表中多选几条笔记后，可以合并为一条长期笔记。原笔记会进入回收站，资源关联会移动到新笔记。\n\n这个能力适合把零散摘录整理成项目总结。",
  },
  {
    id: "memo_demo_agent",
    notebookId: "nb_projects",
    title: "Agent-ready：REST API 与 MCP",
    tags: ["api", "mcp", "agent"],
    isPinned: false,
    markdown:
      "## Agent-ready\n\nEdgeEver 提供 REST API、OpenAPI schema 和 MCP endpoint。AI Agent 可以读取笔记本、创建笔记、整理标签，并把导入资料迁移到你的自托管实例。\n\nOpenAPI 路径：`/api/openapi.json`",
  },
  {
    id: "memo_demo_mobile",
    notebookId: "nb_personal",
    title: "移动端与 PWA",
    tags: ["pwa", "mobile"],
    isPinned: false,
    markdown:
      "## 移动端与 PWA\n\nEdgeEver 支持桌面三栏工作流，也适配移动端。你可以把站点安装为 PWA，用手机快速记录，再回到桌面整理。",
  },
  {
    id: "memo_demo_images",
    notebookId: "nb_creative",
    title: "图片笔记示例",
    tags: ["image", "attachment", "demo"],
    isPinned: false,
    markdown:
      "## 图片笔记示例\n\n笔记正文可以直接插入图片。上传后的图片会进入 R2，正文里保存的是资源 URL，API、MCP 和前端编辑器都能读取。\n\n![EdgeEver 图片资源示例](/api/v1/resources/res_demo_gallery_image/blob)\n\n这类笔记适合保存截图、设计稿、读书摘图和临时资料。",
  },
];
const DEMO_SEED_RESOURCES = [
  {
    id: "res_demo_editor_image",
    memoId: "memo_demo_editor",
    filename: "edgeever-editor-demo.svg",
    mimeType: "image/svg+xml",
    width: 960,
    height: 520,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="520" viewBox="0 0 960 520" role="img" aria-label="EdgeEver editor demo"><rect width="960" height="520" rx="32" fill="#f8fafc"/><rect x="42" y="44" width="876" height="432" rx="24" fill="#ffffff" stroke="#dbe7e2" stroke-width="2"/><rect x="42" y="44" width="250" height="432" rx="24" fill="#ecfdf5"/><rect x="322" y="88" width="524" height="24" rx="12" fill="#0f766e"/><rect x="322" y="138" width="408" height="14" rx="7" fill="#94a3b8"/><rect x="322" y="166" width="470" height="14" rx="7" fill="#cbd5e1"/><rect x="322" y="214" width="220" height="118" rx="18" fill="#d1fae5"/><circle cx="384" cy="272" r="34" fill="#10b981"/><path d="M356 314 402 264l35 38 24-28 51 40H356Z" fill="#047857"/><rect x="570" y="224" width="270" height="16" rx="8" fill="#64748b"/><rect x="570" y="258" width="230" height="14" rx="7" fill="#94a3b8"/><rect x="570" y="288" width="250" height="14" rx="7" fill="#cbd5e1"/><rect x="570" y="348" width="180" height="38" rx="19" fill="#10b981"/><text x="660" y="373" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#ffffff">支持图片笔记</text><rect x="78" y="90" width="170" height="18" rx="9" fill="#0f766e"/><rect x="78" y="132" width="124" height="14" rx="7" fill="#5eead4"/><rect x="78" y="166" width="148" height="14" rx="7" fill="#99f6e4"/><rect x="78" y="200" width="110" height="14" rx="7" fill="#99f6e4"/></svg>',
  },
  {
    id: "res_demo_gallery_image",
    memoId: "memo_demo_images",
    filename: "edgeever-gallery-demo.svg",
    mimeType: "image/svg+xml",
    width: 960,
    height: 540,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="EdgeEver image note demo"><defs><linearGradient id="sky" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#e0f2fe"/><stop offset="1" stop-color="#dcfce7"/></linearGradient></defs><rect width="960" height="540" rx="36" fill="url(#sky)"/><rect x="78" y="70" width="804" height="400" rx="30" fill="#ffffff" stroke="#bae6fd" stroke-width="2"/><rect x="118" y="112" width="390" height="276" rx="24" fill="#eff6ff"/><circle cx="220" cy="194" r="54" fill="#facc15"/><path d="M118 340 246 236l94 78 66-58 102 84v48H118Z" fill="#22c55e"/><path d="M118 360 292 276l112 84 104-64v92H118Z" fill="#15803d" opacity=".75"/><rect x="550" y="120" width="260" height="28" rx="14" fill="#0f172a"/><rect x="550" y="178" width="214" height="16" rx="8" fill="#64748b"/><rect x="550" y="212" width="250" height="16" rx="8" fill="#94a3b8"/><rect x="550" y="246" width="188" height="16" rx="8" fill="#cbd5e1"/><rect x="550" y="318" width="118" height="42" rx="21" fill="#0ea5e9"/><rect x="686" y="318" width="118" height="42" rx="21" fill="#10b981"/><text x="480" y="438" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0f766e">图片会作为资源保存，并在正文中直接展示</text></svg>',
  },
];
const DEMO_SEED_NOTEBOOK_IDS = DEMO_SEED_NOTEBOOKS.map((notebook) => notebook.id);
const DEMO_SEED_MEMO_IDS = DEMO_SEED_MEMOS.map((memo) => memo.id);
const MAX_IMAGE_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_ATTACHMENT_UPLOAD_BYTES = 100 * 1024 * 1024;
const REVISION_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const API_TOKEN_BYTES = 32;
const API_TOKEN_PREFIX = "eev";
const ALL_TOKEN_SCOPES = [
  "read:notebooks",
  "write:notebooks",
  "read:memos",
  "write:memos",
  "read:resources",
  "write:resources",
  "read:tags",
  "write:tags",
] as const;
type TokenScope = (typeof ALL_TOKEN_SCOPES)[number];
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

const app = new Hono<{ Bindings: Bindings; Variables: { auth: AuthContext } }>();

app.use(
  "/api/*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(
  "/mcp",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    name: "edgeever",
    runtime: "cloudflare-workers",
  })
);

app.get("/api/openapi.json", (c) => c.json(openApiSpec));

app.get("/api/v1/auth/session", async (c) => {
  const authRequired = await isAuthRequired(c.env);

  if (!authRequired) {
    return c.json({
      authRequired: false,
      authenticated: true,
      user: {
        id: "local",
        username: "owner",
        displayName: "Owner",
      },
    });
  }

  const auth = await authenticateRequest(c, false);

  return c.json({
    authRequired: true,
    authenticated: Boolean(auth && auth.kind === "user"),
    user:
      auth && auth.kind === "user"
        ? {
            id: auth.actorId,
            username: auth.username,
            displayName: auth.displayName,
          }
        : null,
  });
});

app.post("/api/v1/auth/login", zValidator("json", LoginSchema), async (c) => {
  const input = c.req.valid("json");
  const user = await verifyLogin(c.env, input.username, input.password);

  if (!user) {
    return unauthorized(c, "Username or password is incorrect.");
  }

  const session = await createSession(c, user);
  setSessionCookie(c, session.token, session.maxAge);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).bind(
      isoNow(),
      isoNow(),
      user.id
    ),
    auditStatement(c.env.DB, "user", user.id, "auth.login", "session", session.id, {
      username: user.username,
    }),
  ]);

  return c.json({
    authRequired: true,
    authenticated: true,
    sessionToken: session.token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
    },
  });
});

app.post("/api/v1/auth/change-password", zValidator("json", ChangePasswordSchema), async (c) => {
  const auth = await authenticateSession(c, true);

  if (!auth || auth.kind !== "user" || !auth.actorId || !auth.sessionId) {
    return unauthorized(c, "An interactive user session is required.");
  }

  const input = c.req.valid("json");
  const user = await c.env.DB.prepare(
    `SELECT id, username, password_hash, display_name, is_disabled
     FROM users
     WHERE id = ? AND is_disabled = 0`
  )
    .bind(auth.actorId)
    .first<UserRow>();

  if (!user || !(await verifyPassword(input.currentPassword, user.password_hash))) {
    return apiError(c, "invalid_current_password", "Current password is incorrect.", 400);
  }

  const now = isoNow();
  const passwordHash = await hashPassword(input.newPassword);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(
      passwordHash,
      now,
      user.id
    ),
    c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE user_id = ? AND id != ? AND revoked_at IS NULL`
    ).bind(now, user.id, auth.sessionId),
    auditStatement(c.env.DB, "user", user.id, "auth.password_change", "user", user.id, {}),
  ]);

  return c.json({ ok: true });
});

app.post("/api/v1/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE) ?? getBearerToken(c);

  if (token) {
    await revokeSession(c.env.DB, token);
  }

  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/v1/*", async (c, next) => {
  if (c.req.path.startsWith("/api/v1/auth/")) {
    await next();
    return;
  }

  const authRequired = await isAuthRequired(c.env);

  if (!authRequired) {
    c.set("auth", {
      kind: "user",
      actorType: "user",
      actorId: null,
      username: "owner",
      displayName: "Owner",
      scopes: [],
    });
    await next();
    return;
  }

  const auth = await authenticateRequest(c, true);

  if (!auth) {
    return unauthorized(c, "Authentication required.");
  }

  c.set("auth", auth);
  await next();
});

app.get("/api/v1/api-tokens", async (c) => {
  const userOnly = requireUser(c);

  if (userOnly) {
    return userOnly;
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at
     FROM api_tokens
     ORDER BY is_revoked ASC, created_at DESC
     LIMIT 200`
  ).all<ApiTokenRow>();

  return c.json({
    apiTokens: rows.results.map(mapApiToken),
    availableScopes: ALL_TOKEN_SCOPES,
  });
});

app.post("/api/v1/api-tokens", zValidator("json", ApiTokenCreateSchema), async (c) => {
  const userOnly = requireUser(c);

  if (userOnly) {
    return userOnly;
  }

  const input = c.req.valid("json");
  const scopes = normalizeTokenScopes(input.scopes);

  if (!scopes) {
    return badRequest(c, "Token scope is not supported.");
  }

  const id = createId("tok");
  const token = `${API_TOKEN_PREFIX}_${randomToken(API_TOKEN_BYTES)}`;
  const now = isoNow();
  const actor = getAuditActor(c);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO api_tokens (id, name, token_hash, token_value, scopes_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.name, await sha256(token), token, JSON.stringify(scopes), input.expiresAt ?? null, now),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "api_token.create", "api_token", id, {
      name: input.name,
      scopes,
      expiresAt: input.expiresAt ?? null,
    }),
  ]);

  const row = await getApiTokenRow(c.env.DB, id);

  if (!row) {
    return notFound(c, "API token not found");
  }

  return c.json({ token, apiToken: mapApiToken(row) } satisfies CreatedApiToken, 201);
});

app.delete("/api/v1/api-tokens/:id", async (c) => {
  const userOnly = requireUser(c);

  if (userOnly) {
    return userOnly;
  }

  const id = c.req.param("id");
  const actor = getAuditActor(c);

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM api_tokens WHERE id = ?`).bind(id),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "api_token.delete", "api_token", id, {}),
  ]);

  return c.json({ ok: true });
});

app.get("/api/v1/notebooks", async (c) => {
  const denied = requireScopes(c, "read:notebooks");

  if (denied) {
    return denied;
  }

  if (isDemoMode(c.env)) {
    await ensureDemoSeed(c.env);
  }

  const rows = await c.env.DB.prepare(
    notebookSelectSql(
      `WHERE n.is_deleted = 0
       GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at
       ORDER BY n.parent_id IS NOT NULL, n.sort_order ASC, n.name ASC`
    )
  ).all<NotebookRow>();

  return c.json({ notebooks: rows.results.map(mapNotebook) });
});

app.post("/api/v1/notebooks", zValidator("json", NotebookCreateSchema), async (c) => {
  const denied = requireScopes(c, "write:notebooks");

  if (denied) {
    return denied;
  }

  const input = c.req.valid("json");
  const actor = getAuditActor(c);

  try {
    const notebook = await createNotebookRecord(c.env.DB, input, actor);
    return c.json({ notebook }, 201);
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(c, error.code, error.message, error.status);
    }

    throw error;
  }
});

app.patch("/api/v1/notebooks/:id", zValidator("json", NotebookUpdateSchema), async (c) => {
  const denied = requireScopes(c, "write:notebooks");

  if (denied) {
    return denied;
  }

  const id = c.req.param("id");
  const input = c.req.valid("json");
  const actor = getAuditActor(c);

  try {
    const notebook = await updateNotebookRecord(c.env.DB, id, input, actor);
    return c.json({ notebook });
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(c, error.code, error.message, error.status);
    }

    throw error;
  }
});

app.delete("/api/v1/notebooks/:id", async (c) => {
  const denied = requireScopes(c, "write:notebooks");

  if (denied) {
    return denied;
  }

  const id = c.req.param("id");
  const actor = getAuditActor(c);
  const now = isoNow();
  const current = await getNotebook(c.env.DB, id);

  if (!current) {
    return notFound(c, "Notebook not found");
  }

  if (id === "nb_inbox" || current.slug === "inbox") {
    return badRequest(c, "等待分类不能删除。");
  }

  const [childCount, memoCount] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM notebooks WHERE parent_id = ? AND is_deleted = 0`)
      .bind(id)
      .first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM memos WHERE notebook_id = ? AND is_deleted = 0`)
      .bind(id)
      .first<{ count: number }>(),
  ]);

  if ((childCount?.count ?? 0) > 0 || (memoCount?.count ?? 0) > 0) {
    return conflict(c, "notebook_not_empty", "Move or delete child notebooks and memos before deleting this notebook.");
  }

  await c.env.DB.prepare(
    `UPDATE notebooks
     SET is_deleted = 1, deleted_at = ?, updated_at = ?
     WHERE id = ? AND id <> 'nb_inbox'`
  )
    .bind(now, now, id)
    .run();

  await audit(c.env.DB, actor.actorType, actor.actorId, "notebook.delete", "notebook", id, {});
  return c.json({ ok: true });
});

app.get("/api/v1/tags", async (c) => {
  const denied = requireScopes(c, "read:tags");

  if (denied) {
    return denied;
  }

  return c.json({ tags: await listTagSummaries(c.env.DB) });
});

app.patch("/api/v1/tags/:tag", zValidator("json", TagRenameSchema), async (c) => {
  const denied = requireScopes(c, "write:tags");

  if (denied) {
    return denied;
  }

  const oldTag = decodeTagParam(c.req.param("tag"));
  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const updated = await updateTagAcrossMemos(c.env.DB, oldTag, input.name, actor, actorLabel);

  return c.json({ ok: true, updated });
});

app.delete("/api/v1/tags/:tag", async (c) => {
  const denied = requireScopes(c, "write:tags");

  if (denied) {
    return denied;
  }

  const tag = decodeTagParam(c.req.param("tag"));
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const updated = await updateTagAcrossMemos(c.env.DB, tag, null, actor, actorLabel);

  return c.json({ ok: true, updated });
});

app.get("/api/v1/memos", async (c) => {
  const denied = requireScopes(c, "read:memos");

  if (denied) {
    return denied;
  }

  const notebookId = c.req.query("notebookId");
  const q = c.req.query("q")?.trim();
  const includeTrash = c.req.query("trash") === "1";
  const sort = normalizeMemoListSort(c.req.query("sort"));
  const filter = normalizeMemoListFilter(c.req.query("filter"));
  const limit = clampNumber(Number(c.req.query("limit") ?? DEFAULT_MEMO_LIST_LIMIT), 1, MAX_MEMO_LIST_LIMIT);
  const cursor = decodeMemoListCursor(c.req.query("cursor"), sort);
  const deletedClause = includeTrash ? "m.is_deleted = 1" : "m.is_deleted = 0";
  const titleSortExpression = `LOWER(COALESCE(NULLIF(m.title, ''), '${UNTITLED_MEMO_TITLE}'))`;
  const baseConditions = [deletedClause];
  const baseBinds: unknown[] = [];

  if (notebookId) {
    baseConditions.push("m.notebook_id = ?");
    baseBinds.push(notebookId);
  }

  if (filter === "tagged") {
    baseConditions.push("m.tags_json <> '[]'");
  } else if (filter === "untagged") {
    baseConditions.push("m.tags_json = '[]'");
  } else if (filter === "pinned") {
    baseConditions.push("m.is_pinned = 1");
  }

  const getOrderBy = () => {
    if (includeTrash) {
      return "m.deleted_at DESC, m.id DESC";
    }

    if (sort === "created-desc") {
      return "m.is_pinned DESC, m.created_at DESC, m.id DESC";
    }

    if (sort === "title-asc") {
      return `m.is_pinned DESC, ${titleSortExpression} ASC, m.updated_at DESC, m.id DESC`;
    }

    return "m.is_pinned DESC, m.updated_at DESC, m.id DESC";
  };

  const cursorConditions = [...baseConditions];
  const cursorBinds = [...baseBinds];

  if (cursor) {
    if (includeTrash) {
      cursorConditions.push("(m.deleted_at < ? OR (m.deleted_at = ? AND m.id < ?))");
      cursorBinds.push(cursor.deletedAt ?? "", cursor.deletedAt ?? "", cursor.id);
    } else if (sort === "created-desc") {
      cursorConditions.push("(m.is_pinned < ? OR (m.is_pinned = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))))");
      cursorBinds.push(cursor.pinned ?? 0, cursor.pinned ?? 0, cursor.createdAt ?? "", cursor.createdAt ?? "", cursor.id);
    } else if (sort === "title-asc") {
      cursorConditions.push(
        `(m.is_pinned < ? OR (m.is_pinned = ? AND (${titleSortExpression} > ? OR (${titleSortExpression} = ? AND (m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))))))`
      );
      cursorBinds.push(cursor.pinned ?? 0, cursor.pinned ?? 0, cursor.title ?? "", cursor.title ?? "", cursor.updatedAt ?? "", cursor.updatedAt ?? "", cursor.id);
    } else {
      cursorConditions.push("(m.is_pinned < ? OR (m.is_pinned = ? AND (m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))))");
      cursorBinds.push(cursor.pinned ?? 0, cursor.pinned ?? 0, cursor.updatedAt ?? "", cursor.updatedAt ?? "", cursor.id);
    }
  }

  const pageLimit = limit + 1;

  if (q) {
    const ftsQuery = toFtsQuery(q);
    const likeQuery = `%${escapeLike(q)}%`;

    if (ftsQuery) {
      const searchPrefix = [ftsQuery, likeQuery, likeQuery, likeQuery];
      const [rows, totalRow] = await Promise.all([
        c.env.DB.prepare(
          `WITH raw_matches(memo_id, rank) AS (
             SELECT memo_id, bm25(memos_fts)
             FROM memos_fts
             WHERE memos_fts MATCH ?

             UNION ALL

             SELECT m.id, 100.0
             FROM memos m
             INNER JOIN memo_contents c ON c.memo_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\'
                OR c.content_text LIKE ? ESCAPE '\\'
                OR m.tags_json LIKE ? ESCAPE '\\'
           ),
           search_matches AS (
             SELECT memo_id, MIN(rank) AS rank
             FROM raw_matches
             GROUP BY memo_id
           )
           SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                  m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
                  mc.content_text
           FROM search_matches s
           INNER JOIN memos m ON m.id = s.memo_id
           INNER JOIN memo_contents mc ON mc.memo_id = m.id
           WHERE ${cursorConditions.join(" AND ")}
           ORDER BY ${getOrderBy()}
           LIMIT ?`
        )
          .bind(...searchPrefix, ...cursorBinds, pageLimit)
          .all<MemoSummaryRow>(),
        c.env.DB.prepare(
          `WITH raw_matches(memo_id) AS (
             SELECT memo_id
             FROM memos_fts
             WHERE memos_fts MATCH ?

             UNION ALL

             SELECT m.id
             FROM memos m
             INNER JOIN memo_contents c ON c.memo_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\'
                OR c.content_text LIKE ? ESCAPE '\\'
                OR m.tags_json LIKE ? ESCAPE '\\'
           ),
           search_matches AS (
             SELECT memo_id
             FROM raw_matches
             GROUP BY memo_id
           )
           SELECT COUNT(*) AS count
           FROM search_matches s
           INNER JOIN memos m ON m.id = s.memo_id
           WHERE ${baseConditions.join(" AND ")}`
        )
          .bind(...searchPrefix, ...baseBinds)
          .first<{ count: number }>(),
      ]);

      const page = rows.results.slice(0, limit);
      const nextCursor = rows.results.length > limit ? encodeMemoListCursor(page[page.length - 1], sort, includeTrash) : null;

      return c.json({ memos: page.map(mapMemoSummary), totalCount: totalRow?.count ?? page.length, nextCursor });
    }

    const searchConditions = [...baseConditions, "(m.title LIKE ? ESCAPE '\\' OR mc.content_text LIKE ? ESCAPE '\\' OR m.tags_json LIKE ? ESCAPE '\\')"];
    const searchBinds = [...baseBinds, likeQuery, likeQuery, likeQuery];
    const searchCursorConditions = [...cursorConditions, "(m.title LIKE ? ESCAPE '\\' OR mc.content_text LIKE ? ESCAPE '\\' OR m.tags_json LIKE ? ESCAPE '\\')"];
    const searchCursorBinds = [...cursorBinds, likeQuery, likeQuery, likeQuery];
    const [rows, totalRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
                mc.content_text
         FROM memos m
         INNER JOIN memo_contents mc ON mc.memo_id = m.id
         WHERE ${searchCursorConditions.join(" AND ")}
         ORDER BY ${getOrderBy()}
         LIMIT ?`
      )
        .bind(...searchCursorBinds, pageLimit)
        .all<MemoSummaryRow>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM memos m
         INNER JOIN memo_contents mc ON mc.memo_id = m.id
         WHERE ${searchConditions.join(" AND ")}`
      )
        .bind(...searchBinds)
        .first<{ count: number }>(),
    ]);

    const page = rows.results.slice(0, limit);
    const nextCursor = rows.results.length > limit ? encodeMemoListCursor(page[page.length - 1], sort, includeTrash) : null;

    return c.json({ memos: page.map(mapMemoSummary), totalCount: totalRow?.count ?? page.length, nextCursor });
  }

  const [rows, totalRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
              mc.content_text
       FROM memos m
       INNER JOIN memo_contents mc ON mc.memo_id = m.id
       WHERE ${cursorConditions.join(" AND ")}
       ORDER BY ${getOrderBy()}
       LIMIT ?`
    )
      .bind(...cursorBinds, pageLimit)
      .all<MemoSummaryRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM memos m
       WHERE ${baseConditions.join(" AND ")}`
    )
      .bind(...baseBinds)
      .first<{ count: number }>(),
  ]);

  const page = rows.results.slice(0, limit);
  const nextCursor = rows.results.length > limit ? encodeMemoListCursor(page[page.length - 1], sort, includeTrash) : null;

  return c.json({ memos: page.map(mapMemoSummary), totalCount: totalRow?.count ?? page.length, nextCursor });
});

app.post("/api/v1/memos", zValidator("json", MemoCreateSchema), async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const tags = normalizeTags(input.tags);
  const contentMarkdown = input.contentMarkdown ?? "";
  const contentJson = markdownToDoc(contentMarkdown);
  const contentText = docToText(contentJson);
  const title = normalizeMemoTitle(input.title);
  const excerpt = createExcerpt(contentText);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const id = createId("memo");
  const now = isoNow();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO memos (
        id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.notebookId, title, excerpt, JSON.stringify(tags), actorLabel, actorLabel, createdAt, updatedAt),
    c.env.DB.prepare(
      `INSERT INTO memo_contents (
        memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(id, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, createdAt, updatedAt),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.create", "memo", id, {
      notebookId: input.notebookId,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, id) }, 201);
});

app.post("/api/v1/memos/batch/move", zValidator("json", MoveMemosSchema), async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const input = c.req.valid("json");
  const target = await getNotebook(c.env.DB, input.notebookId);

  if (!target) {
    return notFound(c, "Target notebook not found");
  }

  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);

  try {
    const moved = await moveMemosToNotebook(c.env.DB, input.memoIds, input.notebookId, actor, actorLabel);

    return c.json({ ok: true, moved });
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(c, error.code, error.message, error.status);
    }

    throw error;
  }
});

app.post("/api/v1/memos/batch/delete", zValidator("json", DeleteMemosSchema), async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const input = c.req.valid("json");
  const actor = getAuditActor(c);

  try {
    const deleted = await deleteMemosRecord(c.env.DB, c.env.RESOURCES, input.memoIds, Boolean(input.permanent), actor);
    return c.json({ ok: true, deleted });
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(c, error.code, error.message, error.status);
    }

    throw error;
  }
});

app.delete("/api/v1/memos/trash/empty", async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const actor = getAuditActor(c);
  const deleted = await emptyTrashMemosRecord(c.env.DB, c.env.RESOURCES, actor);

  return c.json({ ok: true, deleted });
});

app.get("/api/v1/memos/:id", async (c) => {
  const denied = requireScopes(c, "read:memos");

  if (denied) {
    return denied;
  }

  const includeDeleted = c.req.query("includeDeleted") === "1";
  const memo = await getMemoDetail(c.env.DB, c.req.param("id"), includeDeleted);

  if (!memo) {
    return notFound(c, "Memo not found");
  }

  return c.json({ memo });
});

app.post("/api/v1/memos/:id/edit-sessions", async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const memoId = c.req.param("id");
  const current = await getMemoDetailRow(c.env.DB, memoId);

  if (!current) {
    return notFound(c, "Memo not found");
  }

  const actor = getAuditActor(c);
  const now = isoNow();
  const session: MemoEditSession = {
    id: createId("edit"),
    memoId,
    baseRevision: current.revision,
    baseContentHash: current.content_hash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  };

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM memo_edit_sessions WHERE expires_at <= ?`).bind(now),
    c.env.DB.prepare(
      `INSERT INTO memo_edit_sessions (
         id, memo_id, actor_type, actor_id, base_revision, base_content_hash,
         expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      session.id,
      memoId,
      actor.actorType,
      actor.actorId,
      session.baseRevision,
      session.baseContentHash,
      session.expiresAt,
      now,
      now
    ),
  ]);

  return c.json({ editSession: session });
});

app.get("/api/v1/memos/:id/revisions", async (c) => {
  const denied = requireScopes(c, "read:memos");

  if (denied) {
    return denied;
  }

  const memoId = c.req.param("id");
  const memo = await getMemoDetail(c.env.DB, memoId);

  if (!memo) {
    return notFound(c, "Memo not found");
  }

  const limit = clampNumber(Number(c.req.query("limit") ?? 50), 1, 100);
  const rows = await c.env.DB.prepare(
    `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
            content_text, content_hash, created_by, created_at
     FROM memo_revisions
     WHERE memo_id = ?
     ORDER BY revision DESC, created_at DESC
     LIMIT ?`
  )
    .bind(memoId, limit)
    .all<MemoRevisionRow>();

  return c.json({ revisions: rows.results.map(mapMemoRevision) });
});

app.post("/api/v1/memos/:id/revisions/:revisionId/restore", async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const memoId = c.req.param("id");
  const revisionId = c.req.param("revisionId");
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const current = await getMemoDetailRow(c.env.DB, memoId);

  if (!current) {
    return notFound(c, "Memo not found");
  }

  const revision = await getMemoRevisionRow(c.env.DB, memoId, revisionId);

  if (!revision) {
    return notFound(c, "Memo revision not found");
  }

  const tags = parseJsonArray(revision.tags_json);
  const contentJson = parseDoc(revision.content_json);
  const contentMarkdown = revision.content_markdown || docToMarkdown(contentJson);
  const contentText = revision.content_text || docToText(contentJson);
  const title = normalizeMemoTitle(revision.title);
  const excerpt = createExcerpt(contentText);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const nextRevision = current.revision + 1;
  const now = isoNow();

  await c.env.DB.batch([
    createMemoRevisionStatement(c.env.DB, current, actorLabel, now),
    c.env.DB.prepare(
      `UPDATE memos
       SET title = ?, excerpt = ?, tags_json = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).bind(title, excerpt, JSON.stringify(tags), actorLabel, now, memoId),
    c.env.DB.prepare(
      `UPDATE memo_contents
       SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
           revision = ?, updated_at = ?
       WHERE memo_id = ?`
    ).bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, now, memoId),
    c.env.DB.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(memoId),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(memoId, title, contentText, tags.join(" ")),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.revision_restore", "memo", memoId, {
      revisionId,
      restoredRevision: revision.revision,
      revision: nextRevision,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, memoId) });
});

app.get("/api/v1/resources", async (c) => {
  const denied = requireScopes(c, "read:resources");

  if (denied) {
    return denied;
  }

  const limit = clampNumber(Number(c.req.query("limit") ?? 500), 1, 500);
  const [rows, stats] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.kind,
              r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height,
              r.created_at, r.updated_at, m.title AS memo_title, m.excerpt AS memo_excerpt,
              m.is_deleted AS memo_is_deleted
       FROM resources r
       LEFT JOIN memos m ON m.id = r.memo_id
       WHERE r.is_deleted = 0
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<ResourceListRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total_count,
              COALESCE(SUM(byte_size), 0) AS total_bytes,
              COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
              COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
       FROM resources
       WHERE is_deleted = 0`
    ).first<ResourceStatsRow>(),
  ]);

  return c.json({
    resources: rows.results.map(mapResourceListItem),
    summary: mapResourceStorageSummary(stats),
  });
});

app.post("/api/v1/memos/:id/resources", async (c) => {
  const denied = requireScopes(c, "write:resources");

  if (denied) {
    return denied;
  }

  const memoId = c.req.param("id");
  const memo = await getMemoDetail(c.env.DB, memoId);

  if (!memo) {
    return notFound(c, "Memo not found");
  }

  const form = await c.req.raw.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return badRequest(c, "Expected multipart form field named file.");
  }

  const actor = getAuditActor(c);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  let resource: Resource;

  try {
    resource = SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)
      ? await createImageResource(c, {
          memoId,
          filename: file.name,
          mimeType,
          bytes,
          actor,
          source: "upload",
        })
      : await createAttachmentResource(c, {
          memoId,
          filename: file.name,
          mimeType,
          bytes,
          actor,
        });
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(c, error.code, error.message, error.status);
    }

    throw error;
  }

  return c.json({ resource }, 201);
});

const createImageResource = async (
  c: AppContext,
  input: {
    memoId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    actor: AuditActor;
    source: "upload" | "mcp";
  }
) => {
  validateImageUpload(input.mimeType, input.bytes.byteLength);

  const resourceId = createId("res");
  const now = isoNow();
  const processed = prepareImageForStorage({
    bytes: input.bytes,
    filename: input.filename,
    mimeType: input.mimeType,
    source: input.source,
  });
  const objectKey = `memos/${input.memoId}/${resourceId}${inferImageExtension(processed.filename, processed.mimeType)}`;
  const bucketName = c.env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME;
  const filename = normalizeFilename(processed.filename) || `${resourceId}${inferImageExtension(processed.filename, processed.mimeType)}`;
  const checksum = await sha256Bytes(processed.bytes);

  await c.env.RESOURCES.put(objectKey, processed.bytes, {
    httpMetadata: {
      contentType: processed.mimeType,
      cacheControl: "private, max-age=3600",
    },
    customMetadata: {
      memoId: input.memoId,
      resourceId,
      filename,
    },
  });

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO resources (
          id, memo_id, bucket_name, object_key, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        resourceId,
        input.memoId,
        bucketName,
        objectKey,
        processed.mimeType,
        filename,
        processed.bytes.byteLength,
        checksum,
        processed.width,
        processed.height,
        JSON.stringify(processed.metadata),
        now,
        now
      ),
      auditStatement(c.env.DB, input.actor.actorType, input.actor.actorId, "resource.create", "resource", resourceId, {
        memoId: input.memoId,
        mimeType: processed.mimeType,
        byteSize: processed.bytes.byteLength,
        compressed: processed.compressed,
      }),
    ]);
  } catch (error) {
    await c.env.RESOURCES.delete(objectKey);
    throw error;
  }

  const resource = await getResourceRow(c.env.DB, resourceId);

  if (!resource) {
    throw new AppError("not_found", "Resource not found", 404);
  }

  return mapResource(resource);
};

const createAttachmentResource = async (
  c: AppContext,
  input: {
    memoId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    actor: AuditActor;
  }
) => {
  validateAttachmentUpload(input.bytes.byteLength);

  const resourceId = createId("res");
  const now = isoNow();
  const filename = normalizeFilename(input.filename) || resourceId;
  const objectKey = `memos/${input.memoId}/${resourceId}`;
  const bucketName = c.env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME;
  const checksum = await sha256Bytes(input.bytes);

  await c.env.RESOURCES.put(objectKey, input.bytes, {
    httpMetadata: {
      contentType: input.mimeType,
      cacheControl: "private, max-age=3600",
    },
    customMetadata: {
      memoId: input.memoId,
      resourceId,
      filename,
    },
  });

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO resources (
          id, memo_id, bucket_name, object_key, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'attachment', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
      ).bind(
        resourceId,
        input.memoId,
        bucketName,
        objectKey,
        input.mimeType,
        filename,
        input.bytes.byteLength,
        checksum,
        JSON.stringify({ originalFilename: filename }),
        now,
        now
      ),
      auditStatement(c.env.DB, input.actor.actorType, input.actor.actorId, "resource.create", "resource", resourceId, {
        memoId: input.memoId,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
      }),
    ]);
  } catch (error) {
    await c.env.RESOURCES.delete(objectKey);
    throw error;
  }

  const resource = await getResourceRow(c.env.DB, resourceId);

  if (!resource) {
    throw new AppError("not_found", "Resource not found", 404);
  }

  return mapResource(resource);
};

const validateImageUpload = (mimeType: string, size: number) => {
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new AppError("unsupported_media_type", "Only PNG, JPEG, GIF, WebP and AVIF images are supported.", 415);
  }

  if (size <= 0 || size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new AppError("upload_too_large", "Image must be between 1 byte and 50 MB.", 413);
  }
};

const validateAttachmentUpload = (size: number) => {
  if (size <= 0 || size > MAX_ATTACHMENT_UPLOAD_BYTES) {
    throw new AppError("upload_too_large", "Attachment must be between 1 byte and 50 MB.", 413);
  }
};

type PreparedImage = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  width: number | null;
  height: number | null;
  compressed: boolean;
  metadata: Record<string, unknown>;
};

const prepareImageForStorage = (input: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  source: "upload" | "mcp";
}): PreparedImage => ({
  bytes: input.bytes,
  mimeType: input.mimeType,
  filename: input.filename,
  width: null,
  height: null,
  compressed: false,
  metadata: {
    source: input.source,
    originalFilename: normalizeFilename(input.filename) || null,
    originalMimeType: input.mimeType,
    originalByteSize: input.bytes.byteLength,
    compression: "disabled",
  },
});

app.get("/api/v1/resources/:id/blob", async (c) => {
  const denied = requireScopes(c, "read:resources");

  if (denied) {
    return denied;
  }

  const resource = await getResourceRow(c.env.DB, c.req.param("id"));

  if (!resource) {
    return notFound(c, "Resource not found");
  }

  const object = await c.env.RESOURCES.get(resource.object_key);

  if (!object) {
    return notFound(c, "Resource object not found");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", resource.mime_type ?? headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", headers.get("Cache-Control") ?? "private, max-age=3600");
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Disposition", contentDispositionInline(resource.filename));
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { headers });
});

app.patch("/api/v1/memos/:id", zValidator("json", MemoUpdateSchema), async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  return updateMemoFromInput(c, c.req.param("id"), c.req.valid("json"));
});

app.post("/api/v1/memos/:id/save", zValidator("json", MemoUpdateSchema), async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  return updateMemoFromInput(c, c.req.param("id"), c.req.valid("json"));
});

const updateMemoFromInput = async (c: AppContext, id: string, input: MemoUpdateInput) => {
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const current = await getMemoDetailRow(c.env.DB, id);

  if (!current) {
    return notFound(c, "Memo not found");
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return c.json(
      {
        error: {
          code: "revision_conflict",
          message: "Memo was updated elsewhere. Reload before saving.",
          details: {
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
          },
        },
      },
      409
    );
  }

  const hasDocumentUpdate = input.contentJson !== undefined || input.contentMarkdown !== undefined;
  let editSession: MemoEditSessionRow | null = null;

  if (hasDocumentUpdate) {
    if (!input.editSessionId || !input.expectedContentHash || input.expectedRevision === undefined) {
      return c.json(
        { error: { code: "edit_session_required", message: "A bound edit session is required to save note content." } },
        428
      );
    }

    if (input.expectedContentHash !== current.content_hash) {
      return c.json(
        { error: { code: "content_conflict", message: "Note content changed after this edit session started." } },
        409
      );
    }

    editSession = await c.env.DB.prepare(
      `SELECT id, memo_id, actor_type, actor_id, base_revision, base_content_hash, expires_at
       FROM memo_edit_sessions
       WHERE id = ? AND memo_id = ? AND actor_type = ? AND actor_id IS ? AND expires_at > ?`
    )
      .bind(input.editSessionId, id, actor.actorType, actor.actorId, isoNow())
      .first<MemoEditSessionRow>();

    if (
      !editSession ||
      !isMemoEditBindingValid(
        { memoId: id, revision: current.revision, contentHash: current.content_hash },
        {
          id: editSession.id,
          memoId: editSession.memo_id,
          baseRevision: editSession.base_revision,
          baseContentHash: editSession.base_content_hash,
        },
        {
          editSessionId: input.editSessionId,
          memoId: id,
          expectedRevision: input.expectedRevision,
          expectedContentHash: input.expectedContentHash,
        }
      )
    ) {
      return c.json(
        { error: { code: "edit_session_conflict", message: "The edit session is stale or belongs to another note." } },
        409
      );
    }
  }

  const isPinned = input.isPinned ?? Boolean(current.is_pinned);
  const hasContentUpdate =
    input.notebookId !== undefined ||
    input.title !== undefined ||
    input.contentJson !== undefined ||
    input.contentMarkdown !== undefined ||
    input.tags !== undefined ||
    input.createdAt !== undefined ||
    input.updatedAt !== undefined;
  const now = isoNow();
  const updatedAt = input.updatedAt ?? now;

  if (!hasContentUpdate) {
    if (input.isPinned === undefined || isPinned === Boolean(current.is_pinned)) {
      return c.json({ memo: await getMemoDetail(c.env.DB, id) });
    }

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE memos
         SET is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE id = ? AND is_deleted = 0`
      ).bind(isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id),
      auditStatement(c.env.DB, actor.actorType, actor.actorId, isPinned ? "memo.pin" : "memo.unpin", "memo", id, {}),
    ]);

    return c.json({ memo: await getMemoDetail(c.env.DB, id) });
  }

  const currentContentJson = JSON.parse(current.content_json) as TiptapDoc;
  const contentJson = input.contentJson
    ? (input.contentJson as TiptapDoc)
    : input.contentMarkdown !== undefined
      ? markdownToDoc(input.contentMarkdown)
      : currentContentJson;
  const contentMarkdown =
    input.contentMarkdown !== undefined ? input.contentMarkdown : docToMarkdown(contentJson);
  const contentText = docToText(contentJson);
  const title =
    input.title !== undefined ? normalizeMemoTitle(input.title) : normalizeMemoTitle(current.title);
  if (
    !input.allowDestructiveOverwrite &&
    isSuspiciousMemoOverwrite(current.title, current.content_text, title, contentText)
  ) {
    return c.json(
      {
        error: {
          code: "suspicious_memo_overwrite",
          message: "Save blocked because the title changed while most of the note content disappeared.",
        },
      },
      409
    );
  }
  const tags = input.tags === undefined ? parseJsonArray(current.tags_json) : normalizeTags(input.tags);
  const excerpt = createExcerpt(contentText);
  const notebookId = input.notebookId ?? current.notebook_id;
  const nextRevision = current.revision + 1;
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const revisionStatements = (await shouldSnapshotMemoRevision(c.env.DB, current, title, JSON.stringify(tags), contentHash, updatedAt))
    ? [createMemoRevisionStatement(c.env.DB, current, actorLabel, updatedAt)]
    : [];
  const editSessionStatements = editSession
    ? [
        c.env.DB.prepare(
          `UPDATE memo_edit_sessions
           SET base_revision = ?, base_content_hash = ?, updated_at = ?
           WHERE id = ? AND memo_id = ? AND base_revision = ? AND base_content_hash = ?`
        ).bind(nextRevision, contentHash, updatedAt, editSession.id, id, current.revision, current.content_hash),
      ]
    : [
        c.env.DB.prepare(
          `UPDATE memo_edit_sessions
           SET base_revision = ?, base_content_hash = ?, updated_at = ?
           WHERE memo_id = ? AND actor_type = ? AND actor_id IS ?
             AND base_revision = ? AND base_content_hash = ? AND expires_at > ?`
        ).bind(
          nextRevision,
          contentHash,
          updatedAt,
          id,
          actor.actorType,
          actor.actorId,
          current.revision,
          current.content_hash,
          updatedAt
        ),
      ];

  await c.env.DB.batch([
    ...revisionStatements,
    c.env.DB.prepare(
      `UPDATE memos
       SET notebook_id = ?, title = ?, excerpt = ?, tags_json = ?, is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
       WHERE id = ? AND is_deleted = 0`
    ).bind(notebookId, title, excerpt, JSON.stringify(tags), isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id),
    c.env.DB.prepare(
      `UPDATE memo_contents
       SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
           revision = ?, updated_at = ?, created_at = COALESCE(?, created_at)
       WHERE memo_id = ?`
    ).bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, updatedAt, input.createdAt ?? null, id),
    c.env.DB.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    ...editSessionStatements,
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.update", "memo", id, {
      revision: nextRevision,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, id) });
};

app.delete("/api/v1/memos/:id", async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const id = c.req.param("id");
  const actor = getAuditActor(c);
  const permanent = c.req.query("permanent") === "1";
  const now = isoNow();

  if (permanent) {
    const current = await getMemoDetailRow(c.env.DB, id, true);

    if (!current || current.is_deleted === 0) {
      return notFound(c, "Memo not found in trash");
    }

    const resources = await getResourceRowsForMemo(c.env.DB, id);

    if (resources.length > 0) {
      await c.env.RESOURCES.delete(resources.map((resource) => resource.object_key));
    }

    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM resources WHERE memo_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM memo_revisions WHERE memo_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM memo_contents WHERE memo_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM memos WHERE id = ? AND is_deleted = 1`).bind(id),
      auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.delete_permanent", "memo", id, {}),
    ]);

    return c.json({ ok: true });
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE memos
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).bind(now, now, id),
    c.env.DB.prepare(
      `UPDATE resources
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE memo_id = ? AND is_deleted = 0`
    ).bind(now, now, id),
    c.env.DB.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.delete", "memo", id, {}),
  ]);

  return c.json({ ok: true });
});

app.post("/api/v1/memos/:id/restore", async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const id = c.req.param("id");
  const actor = getAuditActor(c);
  const current = await getMemoDetailRow(c.env.DB, id, true);

  if (!current || current.is_deleted === 0) {
    return notFound(c, "Memo not found in trash");
  }

  const tags = parseJsonArray(current.tags_json);
  const now = isoNow();
  const originalNotebook = await getNotebook(c.env.DB, current.notebook_id);
  const restoreNotebookId = originalNotebook ? current.notebook_id : "nb_inbox";

  if (!originalNotebook && !(await getNotebook(c.env.DB, restoreNotebookId))) {
    return conflict(c, "restore_notebook_missing", "Original notebook was deleted and the default inbox is unavailable.");
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE memos
       SET notebook_id = ?, is_deleted = 0, deleted_at = NULL, updated_at = ?
       WHERE id = ? AND is_deleted = 1`
    ).bind(restoreNotebookId, now, id),
    c.env.DB.prepare(
      `UPDATE resources
       SET is_deleted = 0, deleted_at = NULL, updated_at = ?
       WHERE memo_id = ? AND is_deleted = 1`
    ).bind(now, id),
    c.env.DB.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, current.title, current.content_text, tags.join(" ")),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.restore", "memo", id, {
      fromNotebookId: current.notebook_id,
      toNotebookId: restoreNotebookId,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, id) });
});

app.post("/api/v1/memos/merge", zValidator("json", MergeMemosSchema), async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);

  try {
    const memo = await mergeMemosRecord(c.env.DB, input, actor, actorLabel);
    return c.json({ memo }, 201);
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(c, error.code, error.message, error.status);
    }

    throw error;
  }
});

app.get("/mcp", (c) =>
  c.json({
    name: "EdgeEver MCP endpoint",
    status: "ready",
    transport: "streamable-http-jsonrpc",
    auth: "Authorization: Bearer <api-token>",
    restBasePath: "/api/v1",
  })
);

app.post("/mcp", async (c) => {
  let payload: unknown;

  try {
    payload = await c.req.json();
  } catch {
    return c.json(jsonRpcError(null, -32700, "Parse error"), 400);
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return c.json(jsonRpcError(null, -32600, "Invalid Request"), 400);
    }

    const results = await Promise.all(payload.map((request) => handleMcpMessage(c, request)));
    const responses = results.filter((result): result is JsonRpcHandlerResult => Boolean(result));
    const bodies = responses.map((response) => response.body);

    if (bodies.length === 0) {
      return new Response(null, { status: 204 });
    }

    return c.json(bodies, Math.max(...responses.map((response) => response.status)) as 200);
  }

  const result = await handleMcpMessage(c, payload);

  if (!result) {
    return new Response(null, { status: 204 });
  }

  return c.json(result.body, result.status as 200);
});

const worker = {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    if (!isDemoMode(env)) {
      return;
    }

    ctx.waitUntil(resetDemoData(env, controller.scheduledTime));
  },
};

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "Route not found",
      },
    },
    404
  )
);

export default worker;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type JsonRpcId = string | number | null;
type JsonRpcHandlerResult = {
  body: unknown;
  status: number;
};

class AppError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

const MCP_PROTOCOL_VERSION = "2024-11-05";

const handleMcpMessage = async (c: AppContext, payload: unknown): Promise<JsonRpcHandlerResult | null> => {
  const request = payload as JsonRpcRequest;
  const id = getJsonRpcId(payload);
  const isNotification =
    payload &&
    typeof payload === "object" &&
    !("id" in payload) &&
    typeof (payload as JsonRpcRequest).method === "string";

  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return { body: jsonRpcError(id, -32600, "Invalid Request"), status: 400 };
  }

  if (request.method === "notifications/initialized" && isNotification) {
    return null;
  }

  if (request.method === "initialize") {
    return {
      body: jsonRpcResult(request.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "edgeever",
          version: "0.1.0",
        },
        instructions:
          "Use scoped EdgeEver API tokens. Prefer read-only scopes for search/list/get tools and grant write scopes only to agents that modify notes.",
      }),
      status: 200,
    };
  }

  const auth = await authenticateRequest(c, true);

  if (!auth) {
    return { body: jsonRpcError(request.id ?? null, -32001, "Authentication required"), status: 401 };
  }

  c.set("auth", auth);

  if (request.method === "tools/list") {
    return {
      body: jsonRpcResult(request.id ?? null, {
        tools: MCP_TOOLS,
      }),
      status: 200,
    };
  }

  if (request.method === "tools/call") {
    const params = asRecord(request.params);
    const name = getOptionalString(params.name);

    if (!name) {
      return { body: jsonRpcError(request.id ?? null, -32602, "Tool name is required"), status: 400 };
    }

    try {
      const result = await callMcpTool(c, auth, name, asRecord(params.arguments));
      return {
        body: jsonRpcResult(request.id ?? null, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: false,
        }),
        status: 200,
      };
    } catch (error) {
      const mapped = mapMcpToolError(error);
      return {
        body: jsonRpcError(request.id ?? null, mapped.rpcCode, mapped.message, mapped.data),
        status: mapped.status,
      };
    }
  }

  if (isNotification) {
    return null;
  }

  return { body: jsonRpcError(request.id ?? null, -32601, "Method not found"), status: 404 };
};

const mapMcpToolError = (error: unknown) => {
  if (error instanceof AppError) {
    const rpcCode =
      error.status === 401
        ? -32001
        : error.status === 403
          ? -32003
          : error.status === 404
            ? -32004
            : error.status === 409
              ? -32009
              : -32602;

    return {
      rpcCode,
      status: error.status,
      message: error.message,
      data: {
        code: error.code,
      },
    };
  }

  return {
    rpcCode: -32000,
    status: 400,
    message: error instanceof Error ? error.message : "Tool call failed",
    data: undefined,
  };
};

const MCP_TOOLS = [
  {
    name: "search_memos",
    description: "Search active EdgeEver memos by text, tag, notebook, time range, pin state, or resource presence.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        notebookId: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        createdAfter: { type: "string", format: "date-time" },
        createdBefore: { type: "string", format: "date-time" },
        updatedAfter: { type: "string", format: "date-time" },
        updatedBefore: { type: "string", format: "date-time" },
        isPinned: { type: "boolean" },
        hasResources: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "list_memos",
    description: "List EdgeEver memos with pagination. Use includeContent when full Markdown is needed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        notebookId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
        includeContent: { type: "boolean" },
        includeDeleted: { type: "boolean" },
      },
    },
  },
  {
    name: "get_memo",
    description: "Read a memo with Markdown content.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        includeDeleted: { type: "boolean" },
      },
    },
  },
  {
    name: "create_memo",
    description: "Create a memo in a notebook.",
    inputSchema: {
      type: "object",
      required: ["notebookId"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string" },
        title: { type: "string" },
        contentMarkdown: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "update_memo",
    description: "Update memo title, Markdown, tags, notebook, or pinned state.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        title: { type: "string" },
        isPinned: { type: "boolean" },
        contentMarkdown: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notebookId: { type: "string" },
        expectedRevision: { type: "integer", minimum: 0 },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "trash_memos",
    description: "Move one or more active memos to trash. Use dryRun to preview affected memos.",
    inputSchema: {
      type: "object",
      required: ["memoIds"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "restore_memos",
    description: "Restore one or more trashed memos. If the original notebook is gone, memos are restored to the default inbox.",
    inputSchema: {
      type: "object",
      required: ["memoIds"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "move_memos",
    description: "Move one or more active memos to another notebook. Use dryRun to preview affected memos.",
    inputSchema: {
      type: "object",
      required: ["memoIds", "notebookId"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        notebookId: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "add_tags_to_memos",
    description: "Add tags to one or more active memos. Use dryRun to preview changed tags.",
    inputSchema: {
      type: "object",
      required: ["memoIds", "tags"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        tags: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "remove_tags_from_memos",
    description: "Remove tags from one or more active memos. Use dryRun to preview changed tags.",
    inputSchema: {
      type: "object",
      required: ["memoIds", "tags"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        tags: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "rename_tag",
    description: "Rename a tag across all active memos. This merges into an existing tag with the same normalized name.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      additionalProperties: false,
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "delete_tag",
    description: "Remove a tag from all active memos.",
    inputSchema: {
      type: "object",
      required: ["tag"],
      additionalProperties: false,
      properties: {
        tag: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "merge_memos",
    description: "Merge multiple active memos into a new memo and soft-delete the sources.",
    inputSchema: {
      type: "object",
      required: ["memoIds"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 2, maxItems: 50, items: { type: "string" } },
        notebookId: { type: "string" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "upload_memo_image",
    description:
      "Upload a base64-encoded image resource to a memo and return Markdown that can be inserted into memo content. Images are stored as provided; server-side compression is disabled to avoid Cloudflare Images quota usage.",
    inputSchema: {
      type: "object",
      required: ["memoId", "mimeType", "dataBase64"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        filename: { type: "string" },
        mimeType: { type: "string", enum: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] },
        dataBase64: { type: "string" },
        alt: { type: "string" },
      },
    },
  },
  {
    name: "upload_memo_attachment",
    description: "Upload a base64-encoded attachment resource to a memo and return Markdown link text that can be inserted into memo content.",
    inputSchema: {
      type: "object",
      required: ["memoId", "filename", "mimeType", "dataBase64"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        filename: { type: "string" },
        mimeType: { type: "string" },
        dataBase64: { type: "string" },
        label: { type: "string" },
      },
    },
  },
  {
    name: "list_memo_resources",
    description: "List active resources attached to a memo.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
      },
    },
  },
  {
    name: "list_resources",
    description: "List active workspace resources with storage summary.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
    },
  },
  {
    name: "list_memo_revisions",
    description: "List revision history for a memo.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "restore_memo_revision",
    description: "Restore a memo to a previous revision. Use dryRun to preview the target revision.",
    inputSchema: {
      type: "object",
      required: ["memoId", "revisionId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        revisionId: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "move_notebook",
    description: "Move a notebook under another notebook or root and update its sort order.",
    inputSchema: {
      type: "object",
      required: ["notebookId"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string" },
        parentId: { type: ["string", "null"] },
        sortOrder: { type: "integer" },
      },
    },
  },
  {
    name: "create_notebook",
    description: "Create a notebook at the root or under another notebook.",
    inputSchema: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        parentId: { type: ["string", "null"] },
        sortOrder: { type: "integer" },
      },
    },
  },
  {
    name: "list_notebooks",
    description: "List active notebooks.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "list_tags",
    description: "List tags and memo counts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "get_workspace_stats",
    description: "Get notebook, memo, tag, and resource counts for workspace diagnostics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
];

const callMcpTool = async (
  c: AppContext,
  auth: AuthContext,
  name: string,
  args: Record<string, unknown>
) => {
  switch (name) {
    case "search_memos": {
      assertScope(auth, "read:memos");
      return {
        memos: await searchMemoSummaries(c.env.DB, {
          query: getOptionalString(args.query),
          notebookId: getOptionalString(args.notebookId),
          tags: getOptionalStringArray(args.tags),
          createdAfter: getOptionalString(args.createdAfter),
          createdBefore: getOptionalString(args.createdBefore),
          updatedAfter: getOptionalString(args.updatedAfter),
          updatedBefore: getOptionalString(args.updatedBefore),
          isPinned: typeof args.isPinned === "boolean" ? args.isPinned : null,
          hasResources: typeof args.hasResources === "boolean" ? args.hasResources : null,
          limit: clampNumber(Number(args.limit ?? 20), 1, 50),
        }),
      };
    }
    case "list_memos": {
      assertScope(auth, "read:memos");
      return await listMemosForMcp(c.env.DB, {
        notebookId: getOptionalString(args.notebookId),
        limit: clampNumber(Number(args.limit ?? 50), 1, 100),
        offset: clampNumber(Number(args.offset ?? 0), 0, 100_000),
        includeContent: args.includeContent === true,
        includeDeleted: args.includeDeleted === true,
      });
    }
    case "get_memo": {
      assertScope(auth, "read:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.DB, memoId, args.includeDeleted === true);

      if (!memo) {
        throw new Error("Memo not found");
      }

      return { memo };
    }
    case "create_memo": {
      assertScope(auth, "write:memos");
      const notebookId = getRequiredString(args.notebookId, "notebookId");
      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const memo = await createMemoRecord(c.env.DB, {
        notebookId,
        title: getOptionalString(args.title) ?? undefined,
        contentMarkdown: getOptionalString(args.contentMarkdown) ?? "",
        tags: getOptionalStringArray(args.tags),
        createdAt: getOptionalString(args.createdAt) ?? undefined,
        updatedAt: getOptionalString(args.updatedAt) ?? undefined,
      }, actor, actorLabel);

      return { memo };
    }
    case "update_memo": {
      assertScope(auth, "write:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const result = await updateMemoRecord(
        c.env.DB,
        memoId,
        {
          expectedRevision:
            typeof args.expectedRevision === "number" && Number.isInteger(args.expectedRevision)
              ? args.expectedRevision
              : undefined,
          notebookId: getOptionalString(args.notebookId) ?? undefined,
          title: getOptionalString(args.title) ?? undefined,
          isPinned: typeof args.isPinned === "boolean" ? args.isPinned : undefined,
          contentMarkdown: getOptionalString(args.contentMarkdown) ?? undefined,
          tags: Array.isArray(args.tags) ? getOptionalStringArray(args.tags) : undefined,
          createdAt: getOptionalString(args.createdAt) ?? undefined,
          updatedAt: getOptionalString(args.updatedAt) ?? undefined,
        },
        actor,
        actorLabel
      );

      if ("error" in result) {
        throw new Error(result.message);
      }

      return { memo: result.memo };
    }
    case "trash_memos": {
      assertScope(auth, "write:memos");
      const memoIds = getRequiredStringArray(args.memoIds, "memoIds");

      if (args.dryRun === true) {
        return { dryRun: true, memos: await getMemosForBulkAction(c.env.DB, memoIds, 0) };
      }

      const deleted = await deleteMemosRecord(c.env.DB, c.env.RESOURCES, memoIds, false, getAuditActor(c));
      return { ok: true, deleted };
    }
    case "restore_memos": {
      assertScope(auth, "write:memos");
      const memoIds = getRequiredStringArray(args.memoIds, "memoIds");

      if (args.dryRun === true) {
        return { dryRun: true, memos: await getMemosForBulkAction(c.env.DB, memoIds, 1) };
      }

      const restored = await restoreMemosRecord(c.env.DB, memoIds, getAuditActor(c));
      return { ok: true, restored };
    }
    case "upload_memo_image": {
      assertScope(auth, "write:resources");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.DB, memoId);

      if (!memo) {
        throw new AppError("not_found", "Memo not found", 404);
      }

      const mimeType = getRequiredString(args.mimeType, "mimeType");
      const filename = getOptionalString(args.filename) ?? `image${inferImageExtension("", mimeType)}`;
      const bytes = await decodeBase64Data(getRequiredString(args.dataBase64, "dataBase64"));
      const resource = await createImageResource(c, {
        memoId,
        filename,
        mimeType,
        bytes,
        actor: getAuditActor(c),
        source: "mcp",
      });
      const alt = getOptionalString(args.alt) ?? normalizeFilename(filename) ?? "image";

      return {
        resource,
        markdownImage: `![${escapeMarkdownImageAlt(alt)}](${resource.url})`,
      };
    }
    case "move_memos": {
      assertScope(auth, "write:memos");
      const notebookId = getRequiredString(args.notebookId, "notebookId");
      const memoIds = getRequiredStringArray(args.memoIds, "memoIds");
      const target = await getNotebook(c.env.DB, notebookId);

      if (!target) {
        throw new AppError("not_found", "Target notebook not found", 404);
      }

      if (args.dryRun === true) {
        return { dryRun: true, targetNotebook: target, memos: await getMemosForBulkAction(c.env.DB, memoIds, 0) };
      }

      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const moved = await moveMemosToNotebook(c.env.DB, memoIds, notebookId, actor, actorLabel);

      return { ok: true, moved };
    }
    case "add_tags_to_memos": {
      assertScope(auth, "write:tags");
      return await updateTagsForMemos(c.env.DB, {
        memoIds: getRequiredStringArray(args.memoIds, "memoIds"),
        tags: getRequiredStringArray(args.tags, "tags"),
        mode: "add",
        dryRun: args.dryRun === true,
        actor: getAuditActor(c),
        actorLabel: getActorLabel(c),
      });
    }
    case "remove_tags_from_memos": {
      assertScope(auth, "write:tags");
      return await updateTagsForMemos(c.env.DB, {
        memoIds: getRequiredStringArray(args.memoIds, "memoIds"),
        tags: getRequiredStringArray(args.tags, "tags"),
        mode: "remove",
        dryRun: args.dryRun === true,
        actor: getAuditActor(c),
        actorLabel: getActorLabel(c),
      });
    }
    case "rename_tag": {
      assertScope(auth, "write:tags");
      const from = getRequiredString(args.from, "from");
      const to = getRequiredString(args.to, "to");

      if (args.dryRun === true) {
        return await previewTagRename(c.env.DB, from, to);
      }

      const updated = await updateTagAcrossMemos(c.env.DB, from, to, getAuditActor(c), getActorLabel(c));
      return { ok: true, updated };
    }
    case "delete_tag": {
      assertScope(auth, "write:tags");
      const tag = getRequiredString(args.tag, "tag");

      if (args.dryRun === true) {
        return await previewTagRename(c.env.DB, tag, null);
      }

      const updated = await updateTagAcrossMemos(c.env.DB, tag, null, getAuditActor(c), getActorLabel(c));
      return { ok: true, updated };
    }
    case "merge_memos": {
      assertScope(auth, "write:memos");
      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const memo = await mergeMemosRecord(
        c.env.DB,
        {
          memoIds: getRequiredStringArray(args.memoIds, "memoIds"),
          notebookId: getOptionalString(args.notebookId) ?? undefined,
          title: getOptionalString(args.title) ?? undefined,
        },
        actor,
        actorLabel
      );

      return { memo };
    }
    case "upload_memo_attachment": {
      assertScope(auth, "write:resources");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.DB, memoId);

      if (!memo) {
        throw new AppError("not_found", "Memo not found", 404);
      }

      const filename = getRequiredString(args.filename, "filename");
      const bytes = await decodeBase64Data(getRequiredString(args.dataBase64, "dataBase64"));
      const resource = await createAttachmentResource(c, {
        memoId,
        filename,
        mimeType: getRequiredString(args.mimeType, "mimeType"),
        bytes,
        actor: getAuditActor(c),
      });
      const label = getOptionalString(args.label) ?? normalizeFilename(filename) ?? "attachment";

      return {
        resource,
        markdownLink: `[${escapeMarkdownLinkLabel(label)}](${resource.url})`,
      };
    }
    case "list_memo_resources": {
      assertScope(auth, "read:resources");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.DB, memoId, true);

      if (!memo) {
        throw new AppError("not_found", "Memo not found", 404);
      }

      return { resources: await listResourcesForMemo(c.env.DB, memoId) };
    }
    case "list_resources": {
      assertScope(auth, "read:resources");
      return await listResourcesForMcp(c.env.DB, clampNumber(Number(args.limit ?? 100), 1, 500));
    }
    case "list_memo_revisions": {
      assertScope(auth, "read:memos");
      return {
        revisions: await listMemoRevisions(
          c.env.DB,
          getRequiredString(args.memoId, "memoId"),
          clampNumber(Number(args.limit ?? 50), 1, 100)
        ),
      };
    }
    case "restore_memo_revision": {
      assertScope(auth, "write:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const revisionId = getRequiredString(args.revisionId, "revisionId");
      const revision = await getMemoRevisionRow(c.env.DB, memoId, revisionId);

      if (!revision) {
        throw new AppError("not_found", "Memo revision not found", 404);
      }

      if (args.dryRun === true) {
        return { dryRun: true, revision: mapMemoRevision(revision) };
      }

      return { memo: await restoreMemoRevisionRecord(c.env.DB, memoId, revisionId, getAuditActor(c), getActorLabel(c)) };
    }
    case "move_notebook": {
      assertScope(auth, "write:notebooks");
      const actor = getAuditActor(c);
      const notebook = await updateNotebookRecord(
        c.env.DB,
        getRequiredString(args.notebookId, "notebookId"),
        {
          parentId: args.parentId === null ? null : getOptionalString(args.parentId) ?? undefined,
          sortOrder: typeof args.sortOrder === "number" && Number.isInteger(args.sortOrder) ? args.sortOrder : undefined,
        },
        actor
      );

      return { notebook };
    }
    case "create_notebook": {
      assertScope(auth, "write:notebooks");
      const actor = getAuditActor(c);
      const name = getRequiredString(args.name, "name");

      if (name.length > 80) {
        throw new AppError("invalid_params", "name must be at most 80 characters", 400);
      }

      const notebook = await createNotebookRecord(
        c.env.DB,
        {
          name,
          parentId: args.parentId === null ? null : getOptionalString(args.parentId) ?? undefined,
          sortOrder: typeof args.sortOrder === "number" && Number.isInteger(args.sortOrder) ? args.sortOrder : undefined,
        },
        actor
      );

      return { notebook };
    }
    case "list_notebooks": {
      assertScope(auth, "read:notebooks");
      return { notebooks: await listNotebooks(c.env.DB) };
    }
    case "list_tags": {
      assertScope(auth, "read:tags");
      return { tags: await listTagSummaries(c.env.DB) };
    }
    case "get_workspace_stats": {
      assertScope(auth, "read:memos");
      return await getWorkspaceStats(c.env.DB);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const jsonRpcResult = (id: JsonRpcId, result: unknown) => ({
  jsonrpc: "2.0",
  id,
  result,
});

const jsonRpcError = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id,
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data }),
  },
});

const getJsonRpcId = (request: unknown): JsonRpcId => {
  if (!request || typeof request !== "object" || !("id" in request)) {
    return null;
  }

  const id = (request as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const getOptionalString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const getRequiredString = (value: unknown, name: string) => {
  const parsed = getOptionalString(value);

  if (!parsed) {
    throw new AppError("invalid_params", `${name} is required`, 400);
  }

  return parsed;
};

const getOptionalStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const getRequiredStringArray = (value: unknown, name: string) => {
  const items = getOptionalStringArray(value);

  if (items.length === 0) {
    throw new AppError("invalid_params", `${name} must include at least one item`, 400);
  }

  return items;
};

const decodeBase64Data = async (value: string) => {
  const [, dataUrlPayload] = value.match(/^data:[^;]+;base64,(.+)$/i) ?? [];
  const base64 = (dataUrlPayload ?? value).replace(/\s/g, "");

  if (!base64) {
    throw new AppError("invalid_params", "dataBase64 is required", 400);
  }

  try {
    const response = await fetch("data:application/octet-stream;base64," + base64);
    if (!response.ok) {
      throw new Error("failed to decode base64");
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new AppError("invalid_params", "dataBase64 must be valid base64 data: " + (error as Error).message, 400);
  }
};

const escapeMarkdownImageAlt = (value: string) => value.replace(/[\\[\]]/g, "\\$&");
const escapeMarkdownLinkLabel = (value: string) => value.replace(/[\\[\]]/g, "\\$&");

const isAuthRequired = async (env: Bindings) => {
  if (env.EDGE_EVER_AUTH_PASSWORD_HASH?.trim()) {
    return true;
  }

  const user = await env.DB.prepare(`SELECT id FROM users WHERE is_disabled = 0 LIMIT 1`).first<{ id: string }>();
  return Boolean(user);
};

const verifyLogin = async (env: Bindings, username: string, password: string): Promise<UserRow | null> => {
  const normalizedUsername = username.trim();
  const existingUser = await getUserByUsername(env.DB, normalizedUsername);

  if (existingUser) {
    return (await verifyPassword(password, existingUser.password_hash)) ? existingUser : null;
  }

  const configuredHash = env.EDGE_EVER_AUTH_PASSWORD_HASH?.trim();

  if (!configuredHash) {
    return null;
  }

  const configuredUsername = env.EDGE_EVER_AUTH_USERNAME?.trim() || "admin";

  if (normalizedUsername !== configuredUsername || !(await verifyPassword(password, configuredHash))) {
    return null;
  }

  const now = isoNow();
  const userId = createId("usr");
  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, normalizedUsername, passwordHash, normalizedUsername, now, now)
    .run();

  return getUserByUsername(env.DB, normalizedUsername);
};

const getUserByUsername = async (db: D1Database, username: string) =>
  db
    .prepare(
      `SELECT id, username, password_hash, display_name, is_disabled
       FROM users
       WHERE username = ? AND is_disabled = 0`
    )
    .bind(username)
    .first<UserRow>();

const createSession = async (c: AppContext, user: UserRow) => {
  const token = randomToken(SESSION_TOKEN_BYTES);
  const id = createId("sess");
  const now = isoNow();
  const maxAge = getSessionMaxAge(c.env);
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
  const ip = c.req.header("CF-Connecting-IP");
  const ipHash = ip ? await sha256(ip) : null;

  await c.env.DB.prepare(
    `INSERT INTO sessions (
      id, user_id, token_hash, user_agent, ip_hash, expires_at, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.id,
      await sha256(token),
      c.req.header("User-Agent") ?? null,
      ipHash,
      expiresAt,
      now,
      now
    )
    .run();

  return { id, token, maxAge };
};

const setSessionCookie = (c: AppContext, token: string, maxAge: number) => {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
};

const revokeSession = async (db: D1Database, token: string) => {
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(isoNow(), await sha256(token))
    .run();
};

const authenticateRequest = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const bearerAuth = await authenticateBearerToken(c, touch);

  if (bearerAuth) {
    return bearerAuth;
  }

  return authenticateSession(c, touch);
};

const authenticateBearerToken = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const token = getBearerToken(c);

  if (!token) {
    return null;
  }

  const sessionAuth = await authenticateSessionToken(c, token, touch);

  if (sessionAuth) {
    return sessionAuth;
  }

  const row = await c.env.DB.prepare(
    `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at
     FROM api_tokens
     WHERE token_hash = ?
       AND is_revoked = 0
       AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(await sha256(token), isoNow())
    .first<ApiTokenRow>();

  if (!row) {
    return null;
  }

  if (touch) {
    await c.env.DB.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).bind(isoNow(), row.id).run();
  }

  return {
    kind: "agent",
    actorType: "agent",
    actorId: row.id,
    username: row.name,
    displayName: row.name,
    scopes: parseJsonArray(row.scopes_json),
    tokenId: row.id,
  };
};

const authenticateSessionToken = async (c: AppContext, token: string, touch: boolean): Promise<AuthContext | null> => {
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, u.username, u.display_name, s.expires_at
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.is_disabled = 0`
  )
    .bind(await sha256(token), isoNow())
    .first<SessionRow>();

  if (!row) {
    return null;
  }

  if (touch) {
    await c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).bind(isoNow(), row.id).run();
  }

  return {
    kind: "user",
    actorType: "user",
    actorId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    scopes: [],
    sessionId: row.id,
  };
};

const authenticateSession = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  return authenticateSessionToken(c, token, touch);
};

const getBearerToken = (c: AppContext) => {
  const authorization = c.req.header("Authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme.toLowerCase() === "bearer" && token ? token : null;
};

const getAuditActor = (c: AppContext) => {
  const auth = c.get("auth");

  return {
    actorType: auth?.actorType ?? "user",
    actorId: auth?.actorId ?? null,
  };
};

const getActorLabel = (c: AppContext) => {
  const auth = c.get("auth");
  return auth?.actorId ? `${auth.actorType}:${auth.actorId}` : auth?.username ?? "user";
};

const requireUser = (c: AppContext) => {
  const auth = c.get("auth");

  if (auth?.kind === "user") {
    return null;
  }

  return forbidden(c, "Only an interactive user session can manage this resource.");
};

const requireScopes = (c: AppContext, ...scopes: TokenScope[]) => {
  const auth = c.get("auth");

  if (!auth) {
    return unauthorized(c, "Authentication required.");
  }

  if (hasScopes(auth, scopes)) {
    return null;
  }

  return forbidden(c, `Missing required scope: ${scopes.join(", ")}`);
};

const assertScope = (auth: AuthContext, scope: TokenScope) => {
  if (!hasScopes(auth, [scope])) {
    throw new AppError("forbidden", `Missing required scope: ${scope}`, 403);
  }
};

const hasScopes = (auth: AuthContext, scopes: TokenScope[]) => {
  if (auth.kind === "user") {
    return true;
  }

  return scopes.every((scope) => auth.scopes.includes(scope));
};

const normalizeTokenScopes = (scopes: string[]) => {
  const normalized = Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)));

  if (normalized.some((scope) => !isTokenScope(scope))) {
    return null;
  }

  return normalized as TokenScope[];
};

const isTokenScope = (scope: string): scope is TokenScope =>
  (ALL_TOKEN_SCOPES as readonly string[]).includes(scope);

const getSessionMaxAge = (env: Bindings) => {
  const days = clampNumber(Number(env.EDGE_EVER_SESSION_TTL_DAYS ?? DEFAULT_SESSION_TTL_DAYS), 1, MAX_SESSION_TTL_DAYS);
  return days * 24 * 60 * 60;
};

const hashPassword = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS,
    base64UrlEncode(salt),
    base64UrlEncode(hash),
  ].join("$");
};

const verifyPassword = async (password: string, passwordHash: string) => {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = passwordHash.split("$");
  const iterations = Number(iterationsRaw);

  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    !saltRaw ||
    !hashRaw
  ) {
    return false;
  }

  try {
    const expected = base64UrlDecode(hashRaw);
    const salt = base64UrlDecode(saltRaw);
    const actual = await derivePasswordHash(password, salt, iterations);

    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

const derivePasswordHash = async (password: string, salt: Uint8Array, iterations: number) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    key,
    PASSWORD_HASH_BYTES * 8
  );

  return new Uint8Array(bits);
};

const randomToken = (bytes: number) => {
  const token = crypto.getRandomValues(new Uint8Array(bytes));
  return base64UrlEncode(token);
};

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }

  return diff === 0;
};

const mapNotebook = (row: NotebookRow): Notebook => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  slug: row.slug,
  icon: row.icon,
  color: row.color,
  sortOrder: row.sort_order,
  memoCount: row.memo_count ?? 0,
  lastMemoUpdatedAt: row.last_memo_updated_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const notebookSelectSql = (tail: string) => `
  SELECT n.id,
         n.parent_id,
         n.name,
         n.slug,
         n.icon,
         n.color,
         n.sort_order,
         COUNT(m.id) AS memo_count,
         MAX(m.updated_at) AS last_memo_updated_at,
         n.created_at,
         n.updated_at
  FROM notebooks n
  LEFT JOIN memos m ON m.notebook_id = n.id AND m.is_deleted = 0
  ${tail}
`;

const mapMemoSummary = (row: MemoSummaryRow): MemoSummary => ({
  id: row.id,
  notebookId: row.notebook_id,
  title: row.title,
  excerpt: row.excerpt || createExcerpt(row.content_text ?? ""),
  tags: parseJsonArray(row.tags_json),
  isPinned: Boolean(row.is_pinned),
  isArchived: Boolean(row.is_archived),
  isDeleted: Boolean(row.is_deleted),
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

const mapMemoDetail = (row: MemoDetailRow): MemoDetail => ({
  ...mapMemoSummary(row),
  contentJson: parseDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  sourceMemoIds: parseJsonArray(row.source_memo_ids),
  mergeSourceCount: row.merge_source_count,
  mergedIntoMemoId: row.merged_into_memo_id,
});

const mapMemoRevision = (row: MemoRevisionRow): MemoRevision => ({
  id: row.id,
  memoId: row.memo_id,
  revision: row.revision,
  title: row.title,
  tags: parseJsonArray(row.tags_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const mapResource = (row: ResourceRow): Resource => ({
  id: row.id,
  memoId: row.memo_id,
  originalMemoId: row.original_memo_id,
  kind: row.kind,
  mimeType: row.mime_type,
  filename: row.filename,
  byteSize: row.byte_size,
  sha256: row.sha256,
  width: row.width,
  height: row.height,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  url: `/api/v1/resources/${row.id}/blob`,
});

const mapResourceListItem = (row: ResourceListRow): ResourceListItem => ({
  ...mapResource(row),
  memoTitle: row.memo_title,
  memoExcerpt: row.memo_excerpt,
  memoDeleted: Boolean(row.memo_is_deleted),
});

const mapResourceStorageSummary = (row: ResourceStatsRow | null): ResourceStorageSummary => ({
  totalCount: row?.total_count ?? 0,
  totalBytes: row?.total_bytes ?? 0,
  imageCount: row?.image_count ?? 0,
  attachmentCount: row?.attachment_count ?? 0,
});

const mapApiToken = (row: ApiTokenRow): ApiToken => ({
  id: row.id,
  name: row.name,
  token: row.token_value,
  scopes: parseJsonArray(row.scopes_json),
  lastUsedAt: row.last_used_at,
  expiresAt: row.expires_at,
  isRevoked: Boolean(row.is_revoked),
  createdAt: row.created_at,
});

const mapTagSummary = (row: TagSummaryRow): TagSummary => ({
  name: row.name,
  memoCount: row.memo_count,
  updatedAt: row.updated_at,
});

const getApiTokenRow = async (db: D1Database, id: string): Promise<ApiTokenRow | null> =>
  db
    .prepare(
      `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at
       FROM api_tokens
       WHERE id = ?`
    )
    .bind(id)
    .first<ApiTokenRow>();

const listNotebooks = async (db: D1Database): Promise<Notebook[]> => {
  const rows = await db
    .prepare(
      notebookSelectSql(
        `WHERE n.is_deleted = 0
         GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at
         ORDER BY n.parent_id IS NOT NULL, n.sort_order ASC, n.name ASC`
      )
    )
    .all<NotebookRow>();

  return rows.results.map(mapNotebook);
};

const listTagSummaries = async (db: D1Database): Promise<TagSummary[]> => {
  const rows = await db
    .prepare(
      `SELECT json_each.value AS name,
              COUNT(DISTINCT m.id) AS memo_count,
              MAX(m.updated_at) AS updated_at
       FROM memos m, json_each(m.tags_json)
       WHERE m.is_deleted = 0
         AND trim(json_each.value) <> ''
       GROUP BY json_each.value
       ORDER BY lower(json_each.value) ASC`
    )
    .all<TagSummaryRow>();

  return rows.results
    .filter((row) => typeof row.name === "string" && row.name.trim())
    .map(mapTagSummary);
};

const updateTagAcrossMemos = async (
  db: D1Database,
  oldTag: string,
  nextTag: string | null,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const normalizedOld = normalizeTags([oldTag])[0];
  const normalizedNext = nextTag === null ? null : normalizeTags([nextTag])[0];

  if (!normalizedOld || normalizedOld === normalizedNext) {
    return 0;
  }

  const rows = await db
    .prepare(
      `SELECT m.id, m.title, m.tags_json, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.is_deleted = 0
         AND EXISTS (
           SELECT 1
           FROM json_each(m.tags_json)
           WHERE json_each.value = ?
         )`
    )
    .bind(normalizedOld)
    .all<MemoTagUpdateRow>();

  const now = isoNow();
  const statements: D1PreparedStatement[] = [];
  let updated = 0;

  for (const row of rows.results) {
    const currentTags = parseJsonArray(row.tags_json);

    if (!currentTags.includes(normalizedOld)) {
      continue;
    }

    const nextTags = normalizeTags(
      currentTags.flatMap((tag) => {
        if (tag !== normalizedOld) {
          return [tag];
        }

        return normalizedNext ? [normalizedNext] : [];
      })
    );

    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET tags_json = ?, updated_by = ?, updated_at = ?
           WHERE id = ? AND is_deleted = 0`
        )
        .bind(JSON.stringify(nextTags), actorLabel, now, row.id),
      db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(row.id),
      db
        .prepare(
          `INSERT INTO memos_fts (memo_id, title, content_text, tags)
           VALUES (?, ?, ?, ?)`
        )
        .bind(row.id, row.title, row.content_text, nextTags.join(" ")),
      auditStatement(db, actor.actorType, actor.actorId, normalizedNext ? "tag.rename" : "tag.delete", "memo", row.id, {
        from: normalizedOld,
        to: normalizedNext,
      })
    );
    updated += 1;
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return updated;
};

const previewTagRename = async (db: D1Database, oldTag: string, nextTag: string | null) => {
  const normalizedOld = normalizeTags([oldTag])[0];
  const normalizedNext = nextTag === null ? null : normalizeTags([nextTag])[0];

  if (!normalizedOld || normalizedOld === normalizedNext) {
    return { dryRun: true, updated: 0, changes: [] };
  }

  const rows = await getMemoRowsByTag(db, normalizedOld);
  const changes = rows.map((row) => {
    const currentTags = parseJsonArray(row.tags_json);
    const nextTags = normalizeTags(
      currentTags.flatMap((tag) => {
        if (tag !== normalizedOld) {
          return [tag];
        }

        return normalizedNext ? [normalizedNext] : [];
      })
    );

    return {
      memoId: row.id,
      title: row.title,
      currentTags,
      nextTags,
    };
  });

  return { dryRun: true, updated: changes.length, changes };
};

const getMemoRowsByTag = async (db: D1Database, tag: string) => {
  const rows = await db
    .prepare(
      `SELECT m.id, m.title, m.tags_json, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.is_deleted = 0
         AND EXISTS (
           SELECT 1
           FROM json_each(m.tags_json)
           WHERE json_each.value = ?
         )`
    )
    .bind(tag)
    .all<MemoTagUpdateRow>();

  return rows.results;
};

const updateTagsForMemos = async (
  db: D1Database,
  input: {
    memoIds: string[];
    tags: string[];
    mode: "add" | "remove";
    dryRun: boolean;
    actor: { actorType: "user" | "agent"; actorId: string | null };
    actorLabel: string;
  }
) => {
  const memoIds = Array.from(new Set(input.memoIds));
  const tags = normalizeTags(input.tags);

  if (memoIds.length === 0 || tags.length === 0) {
    throw new AppError("invalid_params", "memoIds and tags must include at least one item", 400);
  }

  const placeholders = memoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.title, m.tags_json, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.is_deleted = 0 AND m.id IN (${placeholders})`
    )
    .bind(...memoIds)
    .all<MemoTagUpdateRow>();

  if (rows.results.length !== memoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be updated.", 400);
  }

  const changes = rows.results
    .map((row) => {
      const currentTags = parseJsonArray(row.tags_json);
      const nextTags =
        input.mode === "add"
          ? normalizeTags([...currentTags, ...tags])
          : currentTags.filter((tag) => !tags.includes(tag));

      return {
        memoId: row.id,
        title: row.title,
        currentTags,
        nextTags,
        contentText: row.content_text,
      };
    })
    .filter((change) => JSON.stringify(change.currentTags) !== JSON.stringify(change.nextTags));

  if (input.dryRun) {
    return {
      dryRun: true,
      updated: changes.length,
      changes: changes.map(({ contentText: _contentText, ...change }) => change),
    };
  }

  if (changes.length === 0) {
    return { ok: true, updated: 0 };
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [];

  for (const change of changes) {
    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET tags_json = ?, updated_by = ?, updated_at = ?
           WHERE id = ? AND is_deleted = 0`
        )
        .bind(JSON.stringify(change.nextTags), input.actorLabel, now, change.memoId),
      db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(change.memoId),
      db
        .prepare(
          `INSERT INTO memos_fts (memo_id, title, content_text, tags)
           VALUES (?, ?, ?, ?)`
        )
        .bind(change.memoId, change.title, change.contentText, change.nextTags.join(" ")),
      auditStatement(db, input.actor.actorType, input.actor.actorId, input.mode === "add" ? "tag.add" : "tag.remove", "memo", change.memoId, {
        tags,
      })
    );
  }

  await db.batch(statements);
  return { ok: true, updated: changes.length };
};

const searchMemoSummaries = async (
  db: D1Database,
  options: {
    query?: string | null;
    notebookId?: string | null;
    tags?: string[];
    createdAfter?: string | null;
    createdBefore?: string | null;
    updatedAfter?: string | null;
    updatedBefore?: string | null;
    isPinned?: boolean | null;
    hasResources?: boolean | null;
    limit: number;
  }
): Promise<MemoSummary[]> => {
  const q = options.query?.trim();
  const notebookId = options.notebookId?.trim() || null;
  const tags = normalizeTags(options.tags ?? []);
  const limit = clampNumber(options.limit, 1, 100);
  const filters = ["m.is_deleted = 0"];
  const binds: unknown[] = [];

  if (notebookId) {
    filters.push("m.notebook_id = ?");
    binds.push(notebookId);
  }

  for (const tag of tags) {
    filters.push("EXISTS (SELECT 1 FROM json_each(m.tags_json) WHERE json_each.value = ?)");
    binds.push(tag);
  }

  if (options.createdAfter) {
    filters.push("m.created_at >= ?");
    binds.push(options.createdAfter);
  }

  if (options.createdBefore) {
    filters.push("m.created_at <= ?");
    binds.push(options.createdBefore);
  }

  if (options.updatedAfter) {
    filters.push("m.updated_at >= ?");
    binds.push(options.updatedAfter);
  }

  if (options.updatedBefore) {
    filters.push("m.updated_at <= ?");
    binds.push(options.updatedBefore);
  }

  if (options.isPinned !== null && options.isPinned !== undefined) {
    filters.push("m.is_pinned = ?");
    binds.push(options.isPinned ? 1 : 0);
  }

  if (options.hasResources !== null && options.hasResources !== undefined) {
    filters.push(
      options.hasResources
        ? "EXISTS (SELECT 1 FROM resources r WHERE r.memo_id = m.id AND r.is_deleted = 0)"
        : "NOT EXISTS (SELECT 1 FROM resources r WHERE r.memo_id = m.id AND r.is_deleted = 0)"
    );
  }

  if (q) {
    const ftsQuery = toFtsQuery(q);
    const likeQuery = `%${escapeLike(q)}%`;

    if (ftsQuery) {
      const rows = await db
        .prepare(
          `WITH raw_matches(memo_id, rank) AS (
             SELECT memo_id, bm25(memos_fts)
             FROM memos_fts
             WHERE memos_fts MATCH ?

             UNION ALL

             SELECT m.id, 100.0
             FROM memos m
             INNER JOIN memo_contents c ON c.memo_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\'
                OR c.content_text LIKE ? ESCAPE '\\'
                OR m.tags_json LIKE ? ESCAPE '\\'
           ),
           search_matches AS (
             SELECT memo_id, MIN(rank) AS rank
             FROM raw_matches
             GROUP BY memo_id
           )
           SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                  m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
                  c.content_text
           FROM search_matches s
           INNER JOIN memos m ON m.id = s.memo_id
           INNER JOIN memo_contents c ON c.memo_id = m.id
           WHERE ${filters.join(" AND ")}
           ORDER BY s.rank ASC, m.is_pinned DESC, m.updated_at DESC
           LIMIT ?`
        )
        .bind(ftsQuery, likeQuery, likeQuery, likeQuery, ...binds, limit)
        .all<MemoSummaryRow>();

      return rows.results.map(mapMemoSummary);
    }
  }

  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE ${filters.join(" AND ")}
       ORDER BY m.is_pinned DESC, m.updated_at DESC
       LIMIT ?`
    )
    .bind(...binds, limit)
    .all<MemoSummaryRow>();

  return rows.results.map(mapMemoSummary);
};

const listMemosForMcp = async (
  db: D1Database,
  options: { notebookId?: string | null; limit: number; offset: number; includeContent: boolean; includeDeleted: boolean }
) => {
  const notebookId = options.notebookId?.trim() || null;
  const limit = clampNumber(options.limit, 1, 100);
  const offset = clampNumber(options.offset, 0, 100_000);
  const pageSize = limit + 1;
  const deletedFilter = options.includeDeleted ? "1 = 1" : "m.is_deleted = 0";

  if (options.includeContent) {
    const rows = await db
      .prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
                c.content_json, c.content_markdown, c.content_text, c.content_hash,
                m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
         FROM memos m
         INNER JOIN memo_contents c ON c.memo_id = m.id
         WHERE ${deletedFilter}
           AND (? IS NULL OR m.notebook_id = ?)
         ORDER BY m.updated_at DESC, m.id ASC
         LIMIT ? OFFSET ?`
      )
      .bind(notebookId, notebookId, pageSize, offset)
      .all<MemoDetailRow>();
    const page = rows.results.slice(0, limit).map(mapMemoDetail);

    return {
      memos: page,
      limit,
      offset,
      nextOffset: rows.results.length > limit ? offset + limit : null,
      hasMore: rows.results.length > limit,
    };
  }

  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE ${deletedFilter}
         AND (? IS NULL OR m.notebook_id = ?)
       ORDER BY m.updated_at DESC, m.id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(notebookId, notebookId, pageSize, offset)
    .all<MemoSummaryRow>();
  const page = rows.results.slice(0, limit).map(mapMemoSummary);

  return {
    memos: page,
    limit,
    offset,
    nextOffset: rows.results.length > limit ? offset + limit : null,
    hasMore: rows.results.length > limit,
  };
};

const getNotebook = async (db: D1Database, id: string): Promise<Notebook | null> => {
  const row = await db
    .prepare(
      notebookSelectSql(
        `WHERE n.id = ? AND n.is_deleted = 0
         GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at`
      )
    )
    .bind(id)
    .first<NotebookRow>();

  return row ? mapNotebook(row) : null;
};

const createNotebookRecord = async (
  db: D1Database,
  input: NotebookCreateInput & { sortOrder?: number },
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const parentId = input.parentId ?? null;

  if (parentId && !(await getNotebook(db, parentId))) {
    throw new AppError("not_found", "Parent notebook not found", 404);
  }

  const id = createId("nb");
  const now = isoNow();
  const sortOrder = input.sortOrder ?? Date.now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO notebooks (id, parent_id, name, slug, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, parentId, input.name, slugify(input.name), sortOrder, now, now),
    auditStatement(db, actor.actorType, actor.actorId, "notebook.create", "notebook", id, {
      name: input.name,
      parentId,
      sortOrder,
    }),
  ]);

  const notebook = await getNotebook(db, id);

  if (!notebook) {
    throw new AppError("not_found", "Notebook not found after create", 404);
  }

  return notebook;
};

const updateNotebookRecord = async (
  db: D1Database,
  id: string,
  input: { name?: string; parentId?: string | null; sortOrder?: number },
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const current = await getNotebook(db, id);

  if (!current) {
    throw new AppError("not_found", "Notebook not found", 404);
  }

  const nextName = input.name ?? current.name;
  const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
  const nextSortOrder = input.sortOrder ?? current.sortOrder;
  const now = isoNow();

  if (nextParentId === id) {
    throw new AppError("bad_request", "Notebook cannot be its own parent", 400);
  }

  if (nextParentId) {
    const parent = await getNotebook(db, nextParentId);

    if (!parent) {
      throw new AppError("not_found", "Parent notebook not found", 404);
    }

    if (await isNotebookDescendant(db, nextParentId, id)) {
      throw new AppError("notebook_cycle", "Notebook cannot be moved into its own descendant.", 409);
    }
  }

  await db.batch([
    db
      .prepare(
        `UPDATE notebooks
         SET name = ?, slug = ?, parent_id = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND is_deleted = 0`
      )
      .bind(nextName, slugify(nextName), nextParentId ?? null, nextSortOrder, now, id),
    auditStatement(db, actor.actorType, actor.actorId, "notebook.update", "notebook", id, input),
  ]);

  const notebook = await getNotebook(db, id);

  if (!notebook) {
    throw new AppError("not_found", "Notebook not found after update", 404);
  }

  return notebook;
};

const isNotebookDescendant = async (db: D1Database, candidateId: string, ancestorId: string) => {
  const row = await db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id
         FROM notebooks
         WHERE parent_id = ? AND is_deleted = 0

         UNION ALL

         SELECT n.id
         FROM notebooks n
         INNER JOIN descendants d ON n.parent_id = d.id
         WHERE n.is_deleted = 0
       )
       SELECT id
       FROM descendants
       WHERE id = ?
       LIMIT 1`
    )
    .bind(ancestorId, candidateId)
    .first<{ id: string }>();

  return Boolean(row);
};

const getMemoDetailRow = async (
  db: D1Database,
  id: string,
  includeDeleted = false
): Promise<MemoDetailRow | null> =>
  db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.id = ? AND (? = 1 OR m.is_deleted = 0)`
    )
    .bind(id, includeDeleted ? 1 : 0)
    .first<MemoDetailRow>();

const getMemoDetail = async (db: D1Database, id: string, includeDeleted = false): Promise<MemoDetail | null> => {
  const row = await getMemoDetailRow(db, id, includeDeleted);
  return row ? mapMemoDetail(row) : null;
};

const deleteMemosRecord = async (
  db: D1Database,
  resourcesBucket: R2Bucket,
  memoIds: string[],
  permanent: boolean,
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const expectedDeletedState = permanent ? 1 : 0;
  const rows = await db
    .prepare(
      `SELECT id
       FROM memos
       WHERE is_deleted = ? AND id IN (${placeholders})`
    )
    .bind(expectedDeletedState, ...uniqueMemoIds)
    .all<{ id: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError(
      "missing_memos",
      permanent ? "One or more memos cannot be permanently deleted." : "One or more memos cannot be deleted.",
      400
    );
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [];

  if (permanent) {
    const resourceRows = await db
      .prepare(
        `SELECT object_key
         FROM resources
         WHERE memo_id IN (${placeholders})`
      )
      .bind(...uniqueMemoIds)
      .all<{ object_key: string }>();
    const objectKeys = resourceRows.results.map((resource) => resource.object_key);

    if (objectKeys.length > 0) {
      await resourcesBucket.delete(objectKeys);
    }

    statements.push(
      db.prepare(`DELETE FROM memos_fts WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM resources WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memo_revisions WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memo_contents WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memos WHERE is_deleted = 1 AND id IN (${placeholders})`).bind(...uniqueMemoIds)
    );

    for (const memoId of uniqueMemoIds) {
      statements.push(auditStatement(db, actor.actorType, actor.actorId, "memo.delete_permanent", "memo", memoId, {}));
    }
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET is_deleted = 1, deleted_at = ?, updated_at = ?
           WHERE is_deleted = 0 AND id IN (${placeholders})`
        )
        .bind(now, now, ...uniqueMemoIds),
      db
        .prepare(
          `UPDATE resources
           SET is_deleted = 1, deleted_at = ?, updated_at = ?
           WHERE is_deleted = 0 AND memo_id IN (${placeholders})`
        )
        .bind(now, now, ...uniqueMemoIds),
      db.prepare(`DELETE FROM memos_fts WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds)
    );

    for (const memoId of uniqueMemoIds) {
      statements.push(auditStatement(db, actor.actorType, actor.actorId, "memo.delete", "memo", memoId, {}));
    }
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

const getMemosForBulkAction = async (db: D1Database, memoIds: string[], deletedState: 0 | 1) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return [];
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.is_deleted = ?
         AND m.id IN (${placeholders})
       ORDER BY m.updated_at DESC, m.id ASC`
    )
    .bind(deletedState, ...uniqueMemoIds)
    .all<MemoSummaryRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be found for this action in the expected state.", 400);
  }

  return rows.results.map(mapMemoSummary);
};

const restoreMemosRecord = async (
  db: D1Database,
  memoIds: string[],
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.tags_json, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.is_deleted = 1 AND m.id IN (${placeholders})`
    )
    .bind(...uniqueMemoIds)
    .all<{ id: string; notebook_id: string; title: string | null; tags_json: string; content_text: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be restored.", 400);
  }

  const notebookIds = Array.from(new Set(rows.results.map((row) => row.notebook_id)));
  const notebookPlaceholders = notebookIds.map(() => "?").join(", ");
  const notebookRows = await db
    .prepare(`SELECT id FROM notebooks WHERE is_deleted = 0 AND id IN (${notebookPlaceholders})`)
    .bind(...notebookIds)
    .all<{ id: string }>();
  const activeNotebookIds = new Set(notebookRows.results.map((row) => row.id));

  const needsInbox = rows.results.some((row) => !activeNotebookIds.has(row.notebook_id));

  if (needsInbox && !(await getNotebook(db, "nb_inbox"))) {
    throw new AppError("restore_notebook_missing", "Original notebooks were deleted and the default inbox is unavailable.", 409);
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [];

  for (const row of rows.results) {
    const restoreNotebookId = activeNotebookIds.has(row.notebook_id) ? row.notebook_id : "nb_inbox";
    const tags = parseJsonArray(row.tags_json);

    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET notebook_id = ?, is_deleted = 0, deleted_at = NULL, updated_at = ?
           WHERE id = ? AND is_deleted = 1`
        )
        .bind(restoreNotebookId, now, row.id),
      db
        .prepare(
          `UPDATE resources
           SET is_deleted = 0, deleted_at = NULL, updated_at = ?
           WHERE memo_id = ? AND is_deleted = 1`
        )
        .bind(now, row.id),
      db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(row.id),
      db
        .prepare(
          `INSERT INTO memos_fts (memo_id, title, content_text, tags)
           VALUES (?, ?, ?, ?)`
        )
        .bind(row.id, row.title, row.content_text, tags.join(" ")),
      auditStatement(db, actor.actorType, actor.actorId, "memo.restore", "memo", row.id, {
        fromNotebookId: row.notebook_id,
        toNotebookId: restoreNotebookId,
      })
    );
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

const emptyTrashMemosRecord = async (
  db: D1Database,
  resourcesBucket: R2Bucket,
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memos
       WHERE is_deleted = 1`
    )
    .first<{ count: number }>();
  const deleted = countRow?.count ?? 0;

  if (deleted === 0) {
    return 0;
  }

  const resourceRows = await db
    .prepare(
      `SELECT r.object_key
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.is_deleted = 1`
    )
    .all<{ object_key: string }>();
  const objectKeys = resourceRows.results.map((resource) => resource.object_key);

  if (objectKeys.length > 0) {
    await resourcesBucket.delete(objectKeys);
  }

  await db.batch([
    db.prepare(`DELETE FROM memos_fts WHERE memo_id IN (SELECT id FROM memos WHERE is_deleted = 1)`),
    db.prepare(`UPDATE resources SET original_memo_id = NULL WHERE original_memo_id IN (SELECT id FROM memos WHERE is_deleted = 1)`),
    db.prepare(`DELETE FROM resources WHERE memo_id IN (SELECT id FROM memos WHERE is_deleted = 1)`),
    db.prepare(`DELETE FROM memo_revisions WHERE memo_id IN (SELECT id FROM memos WHERE is_deleted = 1)`),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id IN (SELECT id FROM memos WHERE is_deleted = 1)`),
    db.prepare(`DELETE FROM memos WHERE is_deleted = 1`),
    auditStatement(db, actor.actorType, actor.actorId, "memo.trash_empty", "trash", "memos", { deleted }),
  ]);

  return deleted;
};

const isDemoMode = (env: Bindings) => env.EDGE_EVER_DEMO_MODE?.trim().toLowerCase() === "true";

const ensureDemoSeed = async (env: Bindings, options: { refreshResources?: boolean } = {}) => {
  const db = env.DB;
  const now = isoNow();
  const statements: D1PreparedStatement[] = [];
  const bucketName = env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME;

  for (const notebook of DEMO_SEED_NOTEBOOKS) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notebooks (
            id, parent_id, name, slug, icon, color, sort_order, is_deleted, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            parent_id = excluded.parent_id,
            name = excluded.name,
            slug = excluded.slug,
            icon = excluded.icon,
            color = excluded.color,
            sort_order = excluded.sort_order,
            is_deleted = 0,
            updated_at = excluded.updated_at,
            deleted_at = NULL`
        )
        .bind(
          notebook.id,
          notebook.parentId,
          notebook.name,
          notebook.slug,
          notebook.icon,
          notebook.color,
          notebook.sortOrder,
          now,
          now
        )
    );
  }

  for (const memo of DEMO_SEED_MEMOS) {
    const contentJson = markdownToDoc(memo.markdown);
    const contentText = docToText(contentJson);
    const contentHash = await sha256(memo.markdown + JSON.stringify(contentJson));

    statements.push(
      db
        .prepare(
          `INSERT INTO memos (
            id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted,
            created_by, updated_by, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'system', 'system', ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            notebook_id = excluded.notebook_id,
            title = excluded.title,
            excerpt = excluded.excerpt,
            tags_json = excluded.tags_json,
            is_pinned = excluded.is_pinned,
            is_archived = 0,
            is_deleted = 0,
            updated_by = 'system',
            updated_at = excluded.updated_at,
            deleted_at = NULL`
        )
        .bind(
          memo.id,
          memo.notebookId,
          memo.title,
          createExcerpt(contentText),
          JSON.stringify(normalizeTags(memo.tags)),
          memo.isPinned ? 1 : 0,
          now,
          now
        ),
      db
        .prepare(
          `INSERT INTO memo_contents (
            memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(memo_id) DO UPDATE SET
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_text = excluded.content_text,
            content_hash = excluded.content_hash,
            revision = 0,
            updated_at = excluded.updated_at`
        )
        .bind(memo.id, JSON.stringify(contentJson), memo.markdown, contentText, contentHash, now, now),
      db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(memo.id),
      db
        .prepare(
          `INSERT INTO memos_fts (memo_id, title, content_text, tags)
           VALUES (?, ?, ?, ?)`
        )
        .bind(memo.id, memo.title, contentText, memo.tags.join(" "))
    );
  }

  const existingResourceIds = options.refreshResources
    ? new Set<string>()
    : new Set(
        (
          await db
            .prepare(`SELECT id FROM resources WHERE id IN (${DEMO_SEED_RESOURCES.map(() => "?").join(", ")})`)
            .bind(...DEMO_SEED_RESOURCES.map((resource) => resource.id))
            .all<{ id: string }>()
        ).results.map((resource) => resource.id)
      );

  for (const resource of DEMO_SEED_RESOURCES) {
    const bytes = new TextEncoder().encode(resource.svg);
    const objectKey = `demo/${resource.memoId}/${resource.id}.svg`;

    if (options.refreshResources || !existingResourceIds.has(resource.id)) {
      await env.RESOURCES.put(objectKey, bytes, {
        httpMetadata: {
          contentType: resource.mimeType,
          cacheControl: "private, max-age=3600",
        },
        customMetadata: {
          memoId: resource.memoId,
          resourceId: resource.id,
          filename: resource.filename,
          demoSeed: "true",
        },
      });
    }

    statements.push(
      db
        .prepare(
          `INSERT INTO resources (
            id, memo_id, bucket_name, object_key, kind, mime_type, filename,
            byte_size, sha256, width, height, metadata_json, is_deleted, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            bucket_name = excluded.bucket_name,
            object_key = excluded.object_key,
            kind = 'image',
            mime_type = excluded.mime_type,
            filename = excluded.filename,
            byte_size = excluded.byte_size,
            sha256 = excluded.sha256,
            width = excluded.width,
            height = excluded.height,
            metadata_json = excluded.metadata_json,
            is_deleted = 0,
            updated_at = excluded.updated_at,
            deleted_at = NULL`
        )
        .bind(
          resource.id,
          resource.memoId,
          bucketName,
          objectKey,
          resource.mimeType,
          resource.filename,
          bytes.byteLength,
          await sha256Bytes(bytes),
          resource.width,
          resource.height,
          JSON.stringify({ source: "demo-seed" }),
          now,
          now
        )
    );
  }

  await db.batch(statements);
};

const resetDemoData = async (env: Bindings, scheduledTime: number) => {
  const db = env.DB;
  const memoPlaceholders = DEMO_SEED_MEMO_IDS.map(() => "?").join(", ");
  const notebookPlaceholders = DEMO_SEED_NOTEBOOK_IDS.map(() => "?").join(", ");
  const resourceRows = await db.prepare(`SELECT object_key FROM resources`).all<{ object_key: string }>();
  const objectKeys = resourceRows.results.map((resource) => resource.object_key);

  for (let index = 0; index < objectKeys.length; index += 1000) {
    await env.RESOURCES.delete(objectKeys.slice(index, index + 1000));
  }

  await db.batch([
    db.prepare(`DELETE FROM memos_fts`),
    db.prepare(`DELETE FROM resources`),
    db.prepare(`DELETE FROM memo_revisions`),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id NOT IN (${memoPlaceholders})`).bind(...DEMO_SEED_MEMO_IDS),
    db.prepare(`DELETE FROM memos WHERE id NOT IN (${memoPlaceholders})`).bind(...DEMO_SEED_MEMO_IDS),
    db.prepare(`UPDATE notebooks SET parent_id = NULL`),
    db.prepare(`DELETE FROM notebooks WHERE id NOT IN (${notebookPlaceholders})`).bind(...DEMO_SEED_NOTEBOOK_IDS),
    db.prepare(`DELETE FROM api_tokens`),
    db.prepare(`DELETE FROM audit_events`),
  ]);

  await ensureDemoSeed(env, { refreshResources: true });
  await audit(db, "system", null, "demo.reset", "demo", "edgeever-demo", {
    scheduledTime: new Date(scheduledTime).toISOString(),
    seedMemoCount: DEMO_SEED_MEMOS.length,
  });
};

const moveMemosToNotebook = async (
  db: D1Database,
  memoIds: string[],
  notebookId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT id, notebook_id
       FROM memos
       WHERE is_deleted = 0 AND id IN (${placeholders})`
    )
    .bind(...uniqueMemoIds)
    .all<{ id: string; notebook_id: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be moved.", 400);
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE memos
         SET notebook_id = ?, updated_by = ?, updated_at = ?
         WHERE is_deleted = 0 AND id IN (${placeholders})`
      )
      .bind(notebookId, actorLabel, now, ...uniqueMemoIds),
  ];

  for (const row of rows.results) {
    statements.push(
      auditStatement(db, actor.actorType, actor.actorId, "memo.move", "memo", row.id, {
        fromNotebookId: row.notebook_id,
        toNotebookId: notebookId,
      })
    );
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

const mergeMemosRecord = async (
  db: D1Database,
  input: { memoIds: string[]; notebookId?: string; title?: string },
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const uniqueMemoIds = Array.from(new Set(input.memoIds));

  if (uniqueMemoIds.length < 2) {
    throw new AppError("bad_request", "At least two memos are required to merge.", 400);
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.is_deleted = 0 AND m.id IN (${placeholders})`
    )
    .bind(...uniqueMemoIds)
    .all<MemoDetailRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be merged.", 400);
  }

  if (input.notebookId && !(await getNotebook(db, input.notebookId))) {
    throw new AppError("not_found", "Target notebook not found", 404);
  }

  const ordered = uniqueMemoIds
    .map((memoId) => rows.results.find((row) => row.id === memoId))
    .filter((row): row is MemoDetailRow => Boolean(row));
  const notebookId = input.notebookId ?? ordered[0].notebook_id;
  const title = resolveMergedMemoTitle(input.title, ordered);
  const mergedMarkdown = ordered.map((memo) => memo.content_markdown).join("\n\n---\n\n");
  const contentJson = markdownToDoc(mergedMarkdown);
  const contentText = docToText(contentJson);
  const tags = Array.from(new Set(ordered.flatMap((memo) => parseJsonArray(memo.tags_json))));
  const excerpt = createExcerpt(contentText || title);
  const contentHash = await sha256(mergedMarkdown + JSON.stringify(contentJson));
  const newMemoId = createId("memo");
  const now = isoNow();

  await db.batch([
    db
      .prepare(
        `INSERT INTO memos (
          id, notebook_id, title, excerpt, tags_json, source_memo_ids, merge_source_count,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newMemoId,
        notebookId,
        title,
        excerpt,
        JSON.stringify(tags),
        JSON.stringify(uniqueMemoIds),
        uniqueMemoIds.length,
        actorLabel,
        actorLabel,
        now,
        now
      ),
    db
      .prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(newMemoId, JSON.stringify(contentJson), mergedMarkdown, contentText, contentHash, now, now),
    db
      .prepare(
        `INSERT INTO memos_fts (memo_id, title, content_text, tags)
         VALUES (?, ?, ?, ?)`
      )
      .bind(newMemoId, title, contentText, tags.join(" ")),
    db
      .prepare(
        `UPDATE memos
         SET is_deleted = 1, deleted_at = ?, merged_into_memo_id = ?, merged_at = ?, updated_at = ?
         WHERE id IN (${placeholders})`
      )
      .bind(now, newMemoId, now, now, ...uniqueMemoIds),
    db.prepare(`DELETE FROM memos_fts WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
    db
      .prepare(
        `UPDATE resources
         SET original_memo_id = COALESCE(original_memo_id, memo_id),
             memo_id = ?,
             updated_at = ?
         WHERE memo_id IN (${placeholders})`
      )
      .bind(newMemoId, now, ...uniqueMemoIds),
    auditStatement(db, actor.actorType, actor.actorId, "memo.merge", "memo", newMemoId, {
      sourceMemoIds: uniqueMemoIds,
    }),
  ]);

  const memo = await getMemoDetail(db, newMemoId);

  if (!memo) {
    throw new AppError("not_found", "Merged memo not found after create.", 404);
  }

  return memo;
};

const createMemoRecord = async (
  db: D1Database,
  input: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[]; createdAt?: string; updatedAt?: string },
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
): Promise<MemoDetail> => {
  const tags = normalizeTags(input.tags);
  const contentMarkdown = input.contentMarkdown ?? "";
  const contentJson = markdownToDoc(contentMarkdown);
  const contentText = docToText(contentJson);
  const title = normalizeMemoTitle(input.title);
  const excerpt = createExcerpt(contentText);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const id = createId("memo");
  const now = isoNow();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;

  await db.batch([
    db
      .prepare(
        `INSERT INTO memos (
          id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, input.notebookId, title, excerpt, JSON.stringify(tags), actorLabel, actorLabel, createdAt, updatedAt),
    db
      .prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(id, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, createdAt, updatedAt),
    db
      .prepare(
        `INSERT INTO memos_fts (memo_id, title, content_text, tags)
         VALUES (?, ?, ?, ?)`
      )
      .bind(id, title, contentText, tags.join(" ")),
    auditStatement(db, actor.actorType, actor.actorId, "memo.create", "memo", id, {
      notebookId: input.notebookId,
    }),
  ]);

  const memo = await getMemoDetail(db, id);

  if (!memo) {
    throw new Error("Memo was created but could not be read.");
  }

  return memo;
};

const updateMemoRecord = async (
  db: D1Database,
  id: string,
  input: {
    expectedRevision?: number;
    notebookId?: string;
    title?: string;
    isPinned?: boolean;
    contentJson?: TiptapDoc;
    contentMarkdown?: string;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
    allowDestructiveOverwrite?: boolean;
  },
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
): Promise<{ memo: MemoDetail; error?: never; message?: never } | { error: string; message: string }> => {
  const current = await getMemoDetailRow(db, id);

  if (!current) {
    return { error: "not_found", message: "Memo not found" };
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return { error: "revision_conflict", message: "Memo was updated elsewhere. Reload before saving." };
  }

  const isPinned = input.isPinned ?? Boolean(current.is_pinned);
  const hasContentUpdate =
    input.notebookId !== undefined ||
    input.title !== undefined ||
    input.contentJson !== undefined ||
    input.contentMarkdown !== undefined ||
    input.tags !== undefined ||
    input.createdAt !== undefined ||
    input.updatedAt !== undefined;
  const now = isoNow();
  const updatedAt = input.updatedAt ?? now;

  if (!hasContentUpdate) {
    if (input.isPinned === undefined || isPinned === Boolean(current.is_pinned)) {
      const memo = await getMemoDetail(db, id);

      if (!memo) {
        return { error: "not_found", message: "Memo not found after update" };
      }

      return { memo };
    }

    await db.batch([
      db
        .prepare(
          `UPDATE memos
           SET is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
           WHERE id = ? AND is_deleted = 0`
        )
        .bind(isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id),
      auditStatement(db, actor.actorType, actor.actorId, isPinned ? "memo.pin" : "memo.unpin", "memo", id, {}),
    ]);

    const memo = await getMemoDetail(db, id);

    if (!memo) {
      return { error: "not_found", message: "Memo not found after update" };
    }

    return { memo };
  }

  const currentContentJson = parseDoc(current.content_json);
  const contentJson =
    input.contentJson !== undefined
      ? input.contentJson
      : input.contentMarkdown !== undefined
        ? markdownToDoc(input.contentMarkdown)
        : currentContentJson;
  const contentMarkdown =
    input.contentMarkdown !== undefined ? input.contentMarkdown : docToMarkdown(contentJson);
  const contentText = docToText(contentJson);
  const title =
    input.title !== undefined ? normalizeMemoTitle(input.title) : normalizeMemoTitle(current.title);
  if (
    !input.allowDestructiveOverwrite &&
    isSuspiciousMemoOverwrite(current.title, current.content_text, title, contentText)
  ) {
    return {
      error: "suspicious_memo_overwrite",
      message: "Save blocked because the title changed while most of the note content disappeared.",
    };
  }
  const tags = input.tags === undefined ? parseJsonArray(current.tags_json) : normalizeTags(input.tags);
  const excerpt = createExcerpt(contentText);
  const notebookId = input.notebookId ?? current.notebook_id;
  const nextRevision = current.revision + 1;
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const revisionStatements = (await shouldSnapshotMemoRevision(db, current, title, JSON.stringify(tags), contentHash, updatedAt))
    ? [createMemoRevisionStatement(db, current, actorLabel, updatedAt)]
    : [];

  await db.batch([
    ...revisionStatements,
    db
      .prepare(
        `UPDATE memos
         SET notebook_id = ?, title = ?, excerpt = ?, tags_json = ?, is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE id = ? AND is_deleted = 0`
      )
      .bind(notebookId, title, excerpt, JSON.stringify(tags), isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id),
    db
      .prepare(
        `UPDATE memo_contents
         SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
             revision = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE memo_id = ?`
      )
      .bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, updatedAt, input.createdAt ?? null, id),
    db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    db
      .prepare(
        `INSERT INTO memos_fts (memo_id, title, content_text, tags)
         VALUES (?, ?, ?, ?)`
      )
      .bind(id, title, contentText, tags.join(" ")),
    auditStatement(db, actor.actorType, actor.actorId, "memo.update", "memo", id, {
      revision: nextRevision,
    }),
  ]);

  const memo = await getMemoDetail(db, id);

  if (!memo) {
    return { error: "not_found", message: "Memo not found after update" };
  }

  return { memo };
};

const getMemoRevisionRow = async (
  db: D1Database,
  memoId: string,
  revisionId: string
): Promise<MemoRevisionRow | null> =>
  db
    .prepare(
      `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
              content_text, content_hash, created_by, created_at
       FROM memo_revisions
       WHERE id = ? AND memo_id = ?`
    )
    .bind(revisionId, memoId)
    .first<MemoRevisionRow>();

const listMemoRevisions = async (db: D1Database, memoId: string, limit: number): Promise<MemoRevision[]> => {
  const memo = await getMemoDetail(db, memoId, true);

  if (!memo) {
    throw new AppError("not_found", "Memo not found", 404);
  }

  const rows = await db
    .prepare(
      `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
              content_text, content_hash, created_by, created_at
       FROM memo_revisions
       WHERE memo_id = ?
       ORDER BY revision DESC, created_at DESC
       LIMIT ?`
    )
    .bind(memoId, limit)
    .all<MemoRevisionRow>();

  return rows.results.map(mapMemoRevision);
};

const restoreMemoRevisionRecord = async (
  db: D1Database,
  memoId: string,
  revisionId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const current = await getMemoDetailRow(db, memoId);

  if (!current) {
    throw new AppError("not_found", "Memo not found", 404);
  }

  const revision = await getMemoRevisionRow(db, memoId, revisionId);

  if (!revision) {
    throw new AppError("not_found", "Memo revision not found", 404);
  }

  const tags = parseJsonArray(revision.tags_json);
  const contentJson = parseDoc(revision.content_json);
  const contentMarkdown = revision.content_markdown || docToMarkdown(contentJson);
  const contentText = revision.content_text || docToText(contentJson);
  const title = normalizeMemoTitle(revision.title);
  const excerpt = createExcerpt(contentText);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const nextRevision = current.revision + 1;
  const now = isoNow();

  await db.batch([
    createMemoRevisionStatement(db, current, actorLabel, now),
    db
      .prepare(
        `UPDATE memos
         SET title = ?, excerpt = ?, tags_json = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND is_deleted = 0`
      )
      .bind(title, excerpt, JSON.stringify(tags), actorLabel, now, memoId),
    db
      .prepare(
        `UPDATE memo_contents
         SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
             revision = ?, updated_at = ?
         WHERE memo_id = ?`
      )
      .bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, now, memoId),
    db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(memoId),
    db
      .prepare(
        `INSERT INTO memos_fts (memo_id, title, content_text, tags)
         VALUES (?, ?, ?, ?)`
      )
      .bind(memoId, title, contentText, tags.join(" ")),
    auditStatement(db, actor.actorType, actor.actorId, "memo.revision_restore", "memo", memoId, {
      revisionId,
      restoredRevision: revision.revision,
      revision: nextRevision,
    }),
  ]);

  const memo = await getMemoDetail(db, memoId);

  if (!memo) {
    throw new AppError("not_found", "Memo not found after revision restore", 404);
  }

  return memo;
};

const getLatestMemoRevisionRow = async (db: D1Database, memoId: string): Promise<MemoRevisionRow | null> =>
  db
    .prepare(
      `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
              content_text, content_hash, created_by, created_at
       FROM memo_revisions
       WHERE memo_id = ?
       ORDER BY created_at DESC, revision DESC
       LIMIT 1`
    )
    .bind(memoId)
    .first<MemoRevisionRow>();

const createMemoRevisionStatement = (
  db: D1Database,
  current: MemoDetailRow,
  actorLabel: string,
  createdAt: string
) =>
  db
    .prepare(
      `INSERT INTO memo_revisions (
        id, memo_id, revision, title, content_json, content_markdown,
        content_hash, created_by, created_at, tags_json, content_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      createId("rev"),
      current.id,
      current.revision,
      current.title,
      current.content_json,
      current.content_markdown,
      current.content_hash,
      actorLabel,
      createdAt,
      current.tags_json,
      current.content_text
    );

const shouldSnapshotMemoRevision = async (
  db: D1Database,
  current: MemoDetailRow,
  nextTitle: string | null,
  nextTagsJson: string,
  nextContentHash: string,
  now: string
) => {
  const changed =
    (current.title ?? "") !== (nextTitle ?? "") ||
    current.tags_json !== nextTagsJson ||
    current.content_hash !== nextContentHash;

  if (!changed) {
    return false;
  }

  const latest = await getLatestMemoRevisionRow(db, current.id);

  if (!latest) {
    return true;
  }

  const alreadyCapturedCurrent =
    (latest.title ?? "") === (current.title ?? "") &&
    latest.tags_json === current.tags_json &&
    latest.content_hash === current.content_hash;

  if (alreadyCapturedCurrent) {
    return false;
  }

  return Date.parse(now) - Date.parse(latest.created_at) >= REVISION_SNAPSHOT_INTERVAL_MS;
};

const getResourceRow = async (db: D1Database, id: string): Promise<ResourceRow | null> =>
  db
    .prepare(
      `SELECT id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type,
              filename, byte_size, sha256, width, height, created_at, updated_at
       FROM resources
       WHERE id = ? AND is_deleted = 0`
    )
    .bind(id)
    .first<ResourceRow>();

const getResourceRowsForMemo = async (db: D1Database, memoId: string): Promise<ResourceRow[]> => {
  const rows = await db
    .prepare(
      `SELECT id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type,
              filename, byte_size, sha256, width, height, created_at, updated_at
       FROM resources
       WHERE memo_id = ?`
    )
    .bind(memoId)
    .all<ResourceRow>();

  return rows.results;
};

const listResourcesForMemo = async (db: D1Database, memoId: string): Promise<Resource[]> => {
  const rows = await db
    .prepare(
      `SELECT id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type,
              filename, byte_size, sha256, width, height, created_at, updated_at
       FROM resources
       WHERE memo_id = ? AND is_deleted = 0
       ORDER BY created_at ASC, id ASC`
    )
    .bind(memoId)
    .all<ResourceRow>();

  return rows.results.map(mapResource);
};

const listResourcesForMcp = async (db: D1Database, limit: number) => {
  const [rows, stats] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.kind,
                r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height,
                r.created_at, r.updated_at, m.title AS memo_title, m.excerpt AS memo_excerpt,
                m.is_deleted AS memo_is_deleted
         FROM resources r
         LEFT JOIN memos m ON m.id = r.memo_id
         WHERE r.is_deleted = 0
         ORDER BY r.created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<ResourceListRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources
         WHERE is_deleted = 0`
      )
      .first<ResourceStatsRow>(),
  ]);

  return {
    resources: rows.results.map(mapResourceListItem),
    summary: mapResourceStorageSummary(stats),
  };
};

const getWorkspaceStats = async (db: D1Database) => {
  const [memoCounts, notebookCount, tagCount, resourceStats] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END), 0) AS active,
           COALESCE(SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END), 0) AS trashed,
           COALESCE(SUM(CASE WHEN is_deleted = 0 AND is_pinned = 1 THEN 1 ELSE 0 END), 0) AS pinned,
           COALESCE(SUM(CASE WHEN is_deleted = 0 AND tags_json = '[]' THEN 1 ELSE 0 END), 0) AS untagged
         FROM memos`
      )
      .first<{ total: number; active: number; trashed: number; pinned: number; untagged: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM notebooks WHERE is_deleted = 0`).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT json_each.value) AS count
         FROM memos m, json_each(m.tags_json)
         WHERE m.is_deleted = 0 AND trim(json_each.value) <> ''`
      )
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources
         WHERE is_deleted = 0`
      )
      .first<ResourceStatsRow>(),
  ]);

  return {
    memos: {
      total: memoCounts?.total ?? 0,
      active: memoCounts?.active ?? 0,
      trashed: memoCounts?.trashed ?? 0,
      pinned: memoCounts?.pinned ?? 0,
      untagged: memoCounts?.untagged ?? 0,
    },
    notebooks: {
      active: notebookCount?.count ?? 0,
    },
    tags: {
      active: tagCount?.count ?? 0,
    },
    resources: mapResourceStorageSummary(resourceStats),
  };
};

const parseJsonArray = (json: string): string[] => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const parseDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as TiptapDoc) : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

const audit = async (
  db: D1Database,
  actorType: "user" | "agent" | "system",
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown
) => auditStatement(db, actorType, actorId, action, entityType, entityId, metadata).run();

const auditStatement = (
  db: D1Database,
  actorType: "user" | "agent" | "system",
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown
) =>
  db
    .prepare(
      `INSERT INTO audit_events (
        id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(createId("audit"), actorType, actorId, action, entityType, entityId, JSON.stringify(metadata ?? {}), isoNow());

const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

const isoNow = () => new Date().toISOString();

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const normalizeMemoTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || DEFAULT_MEMO_TITLE;
};

const isCustomMemoTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return Boolean(title && title !== DEFAULT_MEMO_TITLE);
};

const resolveMergedMemoTitle = (inputTitle: string | undefined, sourceMemos: Array<{ title: string | null }>) => {
  const title = inputTitle?.trim();
  if (title) {
    return title;
  }

  return sourceMemos.find((memo) => isCustomMemoTitle(memo.title))?.title?.trim() ?? `合并笔记 ${new Date().toLocaleDateString("zh-CN")}`;
};

const normalizeMemoListSort = (value: string | undefined): MemoListSortMode =>
  value === "created-desc" || value === "title-asc" ? value : "updated-desc";

const normalizeMemoListFilter = (value: string | undefined): MemoListFilterMode =>
  value === "tagged" || value === "untagged" || value === "pinned" ? value : "all";

const clampNumber = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
};

const encodeMemoListCursor = (memo: MemoSummaryRow, sort: MemoListSortMode, includeTrash: boolean) => {
  const cursor: MemoListCursor = {
    sort,
    id: memo.id,
  };

  if (includeTrash) {
    cursor.deletedAt = memo.deleted_at;
  } else {
    cursor.pinned = memo.is_pinned;
  }

  if (sort === "created-desc") {
    cursor.createdAt = memo.created_at;
  } else if (sort === "title-asc") {
    cursor.title = normalizeMemoTitle(memo.title).toLocaleLowerCase();
    cursor.updatedAt = memo.updated_at;
  } else {
    cursor.updatedAt = memo.updated_at;
  }

  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const decodeMemoListCursor = (value: string | undefined, sort: MemoListSortMode): MemoListCursor | null => {
  if (!value) {
    return null;
  }

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const cursor = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MemoListCursor>;

    if (cursor.sort !== sort || typeof cursor.id !== "string") {
      return null;
    }

    return cursor as MemoListCursor;
  } catch {
    return null;
  }
};

const toFtsQuery = (value: string) => {
  const tokens = value.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens
    .slice(0, 8)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return sha256Bytes(bytes);
};

const sha256Bytes = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  const hashArray = new Uint8Array(digest);
  let hexString = "";
  for (let i = 0; i < hashArray.length; i++) {
    const hex = hashArray[i].toString(16);
    hexString += hex.length === 1 ? "0" + hex : hex;
  }
  return hexString;
};

const inferImageExtension = (filename: string, mimeType: string) => {
  const extension = /\.(png|jpe?g|gif|webp|avif)$/i.exec(filename)?.[0]?.toLowerCase();

  if (extension) {
    return extension === ".jpeg" ? ".jpg" : extension;
  }

  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/avif":
      return ".avif";
    default:
      return "";
  }
};

const normalizeFilename = (filename: string) =>
  filename
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 160);

const contentDispositionInline = (filename: string | null) => {
  if (!filename) {
    return "inline";
  }

  const fallback = normalizeFilename(filename).replace(/"/g, "'");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

const decodeTagParam = (value: string) => {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

const notFound = (c: Context, message: string) =>
  c.json(
    {
      error: {
        code: "not_found",
        message,
      },
    },
    404
  );

const badRequest = (c: Context, message: string) =>
  c.json(
    {
      error: {
        code: "bad_request",
        message,
      },
    },
    400
  );

const apiError = (c: Context, code: string, message: string, status: number) =>
  c.json(
    {
      error: {
        code,
        message,
      },
    },
    status as 400
  );

const conflict = (c: Context, code: string, message: string) =>
  c.json(
    {
      error: {
        code,
        message,
      },
    },
    409
  );

const unauthorized = (c: Context, message: string) =>
  c.json(
    {
      error: {
        code: "unauthorized",
        message,
      },
    },
    401
  );

const forbidden = (c: Context, message: string) =>
  c.json(
    {
      error: {
        code: "forbidden",
        message,
      },
    },
    403
  );
