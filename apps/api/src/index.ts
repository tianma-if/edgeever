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
  JsonBackupResourceMetadataSchema,
  MemoCreateSchema,
  MemoUpdateSchema,
  TemplateCreateSchema,
  TemplateUpdateSchema,
  TemplateUseSchema,
  MergeMemosSchema,
  MoveMemosSchema,
  normalizeTags,
  TagRenameSchema,
  UserCreateSchema,
  UserUpdateSchema,
  NotebookCreateSchema,
  NotebookUpdateSchema,
  RestoreJsonMemosSchema,
  RestoreJsonNotebooksSchema,
  type ApiToken,
  type CreatedApiToken,
  type MemoDetail,
  type MemoEditSession,
  type MemoRevision,
  type MemoSummary,
  type MemoUpdateInput,
  type MemoTemplate,
  type TemplateUpdateInput,
  type JsonBackupMemo,
  type JsonBackupNotebook,
  type JsonBackupResource,
  type JsonBackupRevision,
  type Notebook,
  type NotebookCreateInput,
  type Resource,
  type ResourceListItem,
  type ResourceStorageSummary,
  type TagSummary,
  type TiptapDoc,
  type InstanceUser,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import openApiSpec from "../../../docs/openapi.json";
import { hasBootstrapCredential, isSupportedPasswordHash, verifyBootstrapPassword } from "./auth-bootstrap";
import {
  isDatabaseNotReadyError,
  isUnauthenticatedAccessEnabled,
  resolveInstanceAuthMode,
  type InstanceAuthMode,
} from "./auth-state";
import {
  isDemoModeEnabled,
  isProtectedDemoAccount,
  resolveDemoPasswordHash,
  shouldUpsertDemoSeedRecord,
} from "./demo-mode";
import {
  groupLoginDeviceSessions,
  resolveSessionDeviceId,
  type LoginDeviceSessionRow,
} from "./auth-session-devices";
import {
  decodeDemoAttachment,
  DEMO_ATTACHMENT_MARKDOWN_EN,
  DEMO_ATTACHMENT_MARKDOWN_ZH,
  DEMO_ATTACHMENT_RESOURCES,
} from "./demo-attachments";
import { createCloudflareStorageAdapter } from "./cloudflare-storage-adapter";
import type {
  BlobStoreAdapter,
  CloudflareStorageBindings,
  DatabaseAdapter,
  PreparedStatementAdapter,
  StorageAdapter,
} from "./storage-contract";

// Compatibility aliases keep the existing SQL-heavy implementation small
// while routing its dependency through the platform-neutral contract above.
// New code should use DatabaseAdapter/BlobStoreAdapter directly.
type D1Database = DatabaseAdapter;
type D1PreparedStatement = PreparedStatementAdapter;
type R2Bucket = BlobStoreAdapter;

type Bindings = CloudflareStorageBindings & {
  /** The only persistence dependency exposed to application code. */
  storage: StorageAdapter;
  EDGE_EVER_AUTH_USERNAME?: string;
  EDGE_EVER_RUNTIME?: string;
  EDGE_EVER_AUTH_PASSWORD?: string;
  EDGE_EVER_AUTH_PASSWORD_HASH?: string;
  EDGE_EVER_SESSION_TTL_DAYS?: string;
  EDGE_EVER_R2_BUCKET_NAME?: string;
  EDGE_EVER_DEMO_MODE?: string;
  EDGE_EVER_LOCAL_DEMO_SEED?: string;
  EDGE_EVER_ALLOW_UNAUTHENTICATED?: string;
};

type WorkerBindings = Omit<Bindings, "storage">;

type AuthContext = {
  kind: "user" | "agent";
  actorType: "user" | "agent";
  actorId: string | null;
  username: string;
  displayName: string | null;
  scopes: string[];
  workspaceId: string;
  role: "owner" | "member";
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

type MobileSyncChangeRow = {
  id: number;
  entity_type: "notebook" | "memo";
  entity_id: string;
  operation: "upsert" | "delete";
};

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

type MemoTemplateRow = {
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

type BackupRevisionRow = MemoRevisionRow;

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

type InstanceUserRow = UserRow & {
  last_login_at: string | null;
  created_at: string;
  role: "owner" | "member";
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
  workspace_id: string;
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
const DEFAULT_WORKSPACE_ID = "ws_default";
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
  { id: "nb_demo_features_en", parentId: "nb_projects", name: "Feature Demos", slug: "feature-demos", icon: "notebook", color: "#0e7490", sortOrder: 22 },
];
const DEMO_SEED_MEMOS_ZH = [
  {
    id: "memo_demo_overview",
    notebookId: "nb_demo_features",
    title: "🌟 欢迎使用 EdgeEver",
    tags: ["overview", "features", "demo"],
    isPinned: true,
    markdown:
      "## 🌟 欢迎使用 EdgeEver\n\n> **EdgeEver** 是一款基于 Cloudflare 的开源 Serverless 个人知识库。保留经典的**印象笔记三栏布局**与优雅体验，同时提供 **100% 免费**、数据完全掌控、可视化双向编辑与 AI Agent (MCP) 原生集成。\n\n---\n\n### 🚀 1. 核心优势对比 (可视化表格编辑)\n\n*提示：在线模式下点击下方表格单元格即可直接修改文字；在编辑器模式下右键可快捷添加或删除行列。*\n\n| 核心维度 | 印象笔记 (Evernote) | Obsidian | EdgeEver |\n| --- | --- | --- | --- |\n| **托管成本** | 商业订阅 ($15+/月) | 官方同步 ($5/月) | **100% 免费 (Cloudflare 免费额度)** |\n| **部署方式** | 封闭中心化云端 | 本地文件 + 插件配置 | **Serverless 自建 (零维护)** |\n| **交互体验** | 经典三栏 (广告较多) | 双栏/多面板 (移动端较重) | **经典三栏 + 原生 App / PWA** |\n| **数据与 API** | 封闭，导出一键设限 | 本地 Markdown | **标准 D1 SQLite / REST API / MCP** |\n| **AI Agent 支持** | 限制/仅特定版本 | 需配置第三方插件 | **原生支持 MCP 端点与 OpenAPI** |\n\n---\n\n### 📢 2. 微信公众号与跨平台一键排版复制 (WeChat / Substack / 博客)\n\nEdgeEver 专为自媒体与内容创作者设计，支持将当前笔记一键转换为精美排版并复制：\n\n- [x] 公众号与周刊：一键复制并无缝粘贴至微信公众号、Substack、竹白 Newsletter 后台\n- [x] 博客与平台：完美兼容 WordPress、Medium、Ghost 及各大富文本编辑器\n- [x] 零格式损失：自动内联精致 CSS 样式，代码高亮、表格与图片完美内嵌\n\n> 💡 **创作者体验提示**：尝试点击右上角操作栏的公众号复制按钮，直接粘贴到微信公众号、Substack 或 WordPress 后台，即可体验优雅的排版渲染！\n\n---\n\n### 🎨 3. 双视图编辑与可配置主题 (Dual View & Themes)\n\nEdgeEver 支持在**所见即所得富文本**与 **Markdown 源码**之间无缝切换（点击右上角 `</>` 按钮）。\n\n1. **经典三栏笔记本与树状无限层级**：结构清晰，轻松管理大量笔记。\n2. **预设 8 款经典编辑器主题**：摸鱼绿、红白色系、石墨极简风、留白禅意风、摸鱼票据风、橄榄手记、薄荷青等排版风格（可在 **个人中心 / 设置** 中自由切换）。\n3. **多端无缝同步与 WebP 压缩**：Web PWA / iOS & Android 原生 App，图片上传前本地自动压缩 (节省 50% ~ 90%)。\n\n> 💡 **小贴士**：所有富文本样式与主题块在切换至 Markdown 源码时均能保持完美兼容，不会丢失任何格式元数据。\n\n---\n\n### 4. 过去一周的交互优化 (v0.2.9 ~ v1.5.16)\n\n根据 07月18日 ~ 07月24日的代码 Commit 与正式 Release 日志，过去一周实际上线的核心交互优化包括：\n\n- [x] 原生移动端与离线同步：重构 Android 原生客户端，引入 SQLite 本地镜像、增量同步与离线编辑队列；首次同步可边加载边浏览，并补充自动聚焦、上传占位、应用内更新和平滑页面切换\n- [x] 写作、表格与搜索效率：新增桌面专注模式、实时字数统计和可视化表格增删编辑；优化移动端宽表格；支持选中文本快捷查找/替换、匹配高亮与自动滚动定位\n- [x] Mermaid、代码与附件体验：Web、PWA 与原生 App 支持 Mermaid 编辑和渲染，并提供多款图表主题；恢复多语言代码高亮和一键复制；新增文档、音视频、压缩包等通用附件卡片\n- [x] 主题与跨平台排版复制：支持 8 款正文编辑器主题；微信公众号复制可内联受保护图片、转换不兼容格式、保留 Mermaid 尺寸，并提供明确的加载与结果反馈\n- [x] 账户、版本与 Demo 操作：个人中心可查看并强制退出其他登录设备；系统信息可提示新版本并展示发布信息；Demo 数据支持一键恢复且保留当前登录状态\n\n---\n\n### 🎯 5. 沉浸式专注模式与快捷体验 (Focus Mode & Shortcuts)\n\n为提供极致写作体验，EdgeEver 引入了多项高效写作辅助工具：\n\n1. **Zen 专注写作模式**：快捷键 `Cmd/Ctrl + Shift + F` 或点击顶部图标，隐藏侧边栏与干扰元素，专注内容创作。\n2. **快捷选词搜索与替换**：选中文本后使用快捷键即可发起全局搜索或编辑器内快速替换。\n3. **实时高亮定位**：搜索词在编辑器与笔记列表中高亮定位，方便快速查阅。\n\n---\n\n### 💻 6. 代码高亮与快捷复制 (Syntax Highlighting)\n\n支持 Python、TypeScript、Rust、SQL 等数十种编程语言高亮，并在右上角提供一键复制功能：\n\n```python\nimport requests\n\n# 使用 REST API 获取 EdgeEver 笔记本列表\ndef fetch_edgeever_notebooks(instance_url: str, token: str):\n    headers = {\"Authorization\": f\"Bearer {token}\"}\n    response = requests.get(f\"{instance_url}/api/v1/notebooks\", headers=headers)\n    \n    if response.status_code == 200:\n        data = response.json()\n        print(f\"成功加载 {len(data['data'])} 个笔记本！\")\n        return data[\"data\"]\n    return []\n```\n\n---\n\n### 📊 7. Mermaid 交互式图表与精致主题 (Diagram Themes)\n\n在代码块中使用 `mermaid` 标记，即可在富文本与预览界面中即时渲染多种常见的交互式图表，并支持多款**精致图表主题**选择与复制尺寸保真：\n\n#### 1️⃣ 架构流程图 (Flowchart)\n```mermaid\nflowchart TD\n    subgraph Client[\"📱 客户端生态\"]\n        A[\"Web / PWA 浏览器\"]\n        B[\"iOS / Android 原生 App\"]\n    end\n\n    subgraph Backend[\"⚡ Cloudflare 后端服务\"]\n        C[\"Cloudflare Workers API\"]\n        D[(\"D1 SQLite 数据库\")]\n        E[(\"R2 资源存储\")]\n    end\n\n    A & B --> C\n    C <--> D & E\n```\n\n#### 2️⃣ 交互时序图 (Sequence Diagram)\n```mermaid\nsequenceDiagram\n    autonumber\n    actor User as 用户\n    participant App as 客户端 App\n    participant Worker as Cloudflare Worker API\n    participant D1 as D1 数据库\n\n    User->>App: 编辑并保存笔记\n    App->>Worker: POST /api/v1/memos (提交更改)\n    Worker->>D1: 写入笔记 & 更新修订版本\n    D1-->>Worker: 返回成功 (revision + 1)\n    Worker-->>App: 200 OK (同步最新游标)\n    App-->>User: 界面显示「已保存」\n```\n\n#### 3️⃣ 状态转换图 (State Diagram)\n```mermaid\nstateDiagram-v2\n    [*] --> 草稿箱: 新建笔记\n    草稿箱 --> 已发布: 保存并归档\n    已发布 --> 置顶笔记: 快捷置顶\n    置顶笔记 --> 已发布: 取消置顶\n    已发布 --> 回收站: 移入回收站\n    回收站 --> 已发布: 恢复笔记\n    回收站 --> [*]: 彻底删除\n```\n\n---\n\n### 🖼️ 8. 多媒体与图片集成 (Rich Media Integration)\n\n支持拖拽或粘贴插入图片与文件附件。本地浏览器会在上传前自动进行高保真 WebP 压缩：\n\n![EdgeEver 编辑器与系统架构](/api/v1/resources/res_demo_cat_image/blob)\n\n---\n\n### 🤖 9. 面向 AI Agent 的原生生态 (Agent-Ready)\n\nEdgeEver 为 AI 时代而设计，原生提供 MCP 端点：\n\n1. **REST API**：提供完整标准的 `/api/openapi.json` 定义。\n2. **MCP 端点**：部署在 `/mcp`，AI Agent（如 Antigravity, Claude Code, Cursor）可以直接连接并读写您的笔记库。\n3. **数据自动化**：实现自动归档、Markdown 导入导出、飞书多维表格 / Notion 数据库同步。\n\n---\n\n> 🎯 **快速体验建议**：\n> - 试试在顶部点击「复制到微信公众号」，体验优雅的内容排版导出；\n> - 试试在 **个人中心 / 设置** 中切换「编辑器主题」，挑选喜欢的写作配色风格；\n> - 试试按下 `Cmd/Ctrl + Shift + F` 进入专注模式，感受沉浸式写作；\n> - 试试在左侧列表中按住 `Cmd` / `Ctrl` 选中多篇笔记，点击底栏「合并」；\n> - 试试点击侧边栏或设置中的「恢复 Demo 数据」，随时重置演示状态！"
  },
];
const DEMO_SEED_REVISIONS = [
  {
    id: "rev_demo_revision_1",
    memoId: "memo_demo_overview",
    revision: 1,
    title: "🌟 欢迎使用 EdgeEver",
    markdown:
      "## 🌟 欢迎使用 EdgeEver（草稿）\n\n- 印象笔记经典三栏与自建 Serverless\n- 可视化表格与 Markdown 源码双向切换",
  },
  {
    id: "rev_demo_revision_1_en",
    memoId: "memo_demo_overview_en",
    revision: 1,
    title: "🌟 Welcome to EdgeEver",
    markdown:
      "## 🌟 Welcome to EdgeEver (Draft)\n\n- Classic Evernote 3-pane layout & Serverless self-hosted\n- Visual table editing & Markdown source toggle",
  },
];
const DEMO_MEMO_ENGLISH = {
  memo_demo_overview: {
    title: "🌟 Welcome to EdgeEver",
    markdown:
      "## 🌟 Welcome to EdgeEver\n\n> **EdgeEver** is an open-source, serverless personal knowledge base built on Cloudflare. It retains the classic **Evernote-style three-pane layout**, while offering **100% free hosting**, full data ownership, visual editing, and native AI Agent (MCP) integration.\n\n---\n\n### 🚀 1. Feature Comparison (Visual Table Editing)\n\n*Tip: Click any cell in the table below to edit directly; right-click in editor mode to insert/delete rows or columns.*\n\n| Metric | Evernote | Obsidian | EdgeEver |\n| --- | --- | --- | --- |\n| **Hosting Cost** | Commercial ($15+/mo) | Sync Plan ($5/mo) | **100% Free (Cloudflare Free Tier)** |\n| **Deployment** | Closed Cloud | Local Files + Plugins | **Serverless Self-Hosted (0 Maintenance)** |\n| **User Experience**| Classic 3-Pane (Heavy Ads) | Multi-Pane (Heavy Mobile) | **Classic 3-Pane + Native Apps & PWA** |\n| **Data & API** | Proprietary & Locked | Local Markdown | **Standard D1 SQLite / REST API / MCP** |\n| **AI Integration** | Limited / Paid | Requires 3rd Party Plugins| **Native MCP Endpoint & OpenAPI** |\n\n---\n\n### 📢 2. One-Click Cross-Platform Rich-Text Export (WeChat / Substack / Medium / WordPress)\n\nDesigned for content creators and writers, EdgeEver supports exporting notes to **elegantly formatted rich-text in one click**:\n\n- [x] Official Accounts & Newsletters: One-click copy & paste directly into WeChat, Substack, and Mailchimp\n- [x] Blogs & Platforms: Full compatibility with WordPress, Medium, Ghost, and major rich-text editors\n- [x] Zero Formatting Loss: Inlines CSS styling with code highlighting, tables, and images embedded seamlessly\n\n> 💡 **Creator Tip**: Click the copy button in the top action bar and paste directly into WeChat, Substack, or WordPress editor to see elegant formatting!\n\n---\n\n### 🎨 3. Dual-View & Configurable Themes\n\nSeamlessly toggle between **WYSIWYG Rich Text** and **Markdown Source** via the `</>` toggle in the top right.\n\n1. **Classic 3-Pane Notebook & Infinite Hierarchy**: Organized layout for managing notes.\n2. **8 Preset Editor Themes**: Moyu Green, Red & White, Graphite Minimal, Zen Whitespace, Moyu Ticket, Olive Journal, Mint Breeze, etc. (switchable in **User Settings / Profile**).\n3. **Multi-device Sync & WebP Compression**: Web PWA / iOS & Android Native Apps, saves 50% ~ 90% bandwidth.\n\n> 💡 **Tip**: All rich text formatting and themed blocks remain 100% compatible when toggling to Markdown mode.\n\n---\n\n### 4. Past Week UX Improvements (v0.2.9 ~ v1.5.16)\n\nBased on the actual commits and formal releases from July 18 to July 24, the key interaction improvements shipped over the past week include:\n\n- [x] Native Mobile & Offline Sync: Rebuilt the native Android client with a local SQLite mirror, incremental sync, and an offline edit queue; initial sync now reveals notes progressively, with editor autofocus, upload placeholders, in-app updates, and smoother navigation\n- [x] Writing, Tables & Search: Added desktop Focus Mode, live character counts, and visual table editing; improved wide tables on mobile; added selected-text find/replace shortcuts, match highlighting, and automatic scrolling\n- [x] Mermaid, Code & Attachments: Added Mermaid editing and rendering across Web, PWA, and native apps with selectable themes; restored multilingual syntax highlighting and one-click code copying; added attachment cards for documents, media, archives, and other files\n- [x] Themes & Cross-Platform Publishing: Added 8 editor themes; WeChat copy now embeds protected images, converts unsupported formats, preserves Mermaid dimensions, and reports clear loading and result states\n- [x] Accounts, Releases & Demo Controls: Personal Center now lists active devices and can revoke other sessions; System Info reports releases and available updates; one-tap Demo reset preserves the current login session\n\n---\n\n### 🎯 5. Immersive Focus Mode & Efficiency Shortcuts\n\nTo provide the ultimate writing experience, EdgeEver includes powerful productivity tools:\n\n1. **Zen Focus Mode**: Press `Cmd/Ctrl + Shift + F` or click the focus icon to hide sidebars and eliminate distractions.\n2. **Quick Text Search & Replace**: Highlight text and launch instant global search or in-editor replacement.\n3. **Real-time Search Highlighting**: Locate search terms with clear highlights across the editor and note lists.\n\n---\n\n### 💻 6. Syntax Highlighting & Quick Copy\n\nSupports dozens of programming languages (Python, TypeScript, Rust, SQL, etc.) with one-click code copying:\n\n```python\nimport requests\n\n# Fetch EdgeEver notebooks via REST API\ndef fetch_edgeever_notebooks(instance_url: str, token: str):\n    headers = {\"Authorization\": f\"Bearer {token}\"}\n    response = requests.get(f\"{instance_url}/api/v1/notebooks\", headers=headers)\n    \n    if response.status_code == 200:\n        data = response.json()\n        print(f\"Successfully fetched {len(data['data'])} notebooks!\")\n        return data[\"data\"]\n    return []\n```\n\n---\n\n### 📊 7. Interactive Mermaid Diagrams & Themes\n\nUse standard `mermaid` fenced code blocks to render multiple popular diagram types in real time, with support for **selectable diagram themes** and dimension-preserved copying:\n\n#### 1️⃣ System Flowchart\n```mermaid\nflowchart TD\n    subgraph Client[\"📱 Clients Ecosystem\"]\n        A[\"Web / PWA\"]\n        B[\"iOS / Android Apps\"]\n    end\n\n    subgraph Backend[\"⚡ Cloudflare Backend Services\"]\n        C[\"Cloudflare Workers API\"]\n        D[(\"D1 SQLite DB\")]\n        E[(\"R2 Object Storage\")]\n    end\n\n    A & B --> C\n    C <--> D & E\n```\n\n#### 2️⃣ Interactive Sequence Diagram\n```mermaid\nsequenceDiagram\n    autonumber\n    actor User as User\n    participant App as EdgeEver Client\n    participant Worker as Cloudflare Worker API\n    participant D1 as D1 Database\n\n    User->>App: Edit and save note\n    App->>Worker: POST /api/v1/memos (Save changes)\n    Worker->>D1: Write note content & update revision\n    D1-->>Worker: Return success (revision + 1)\n    Worker-->>App: 200 OK (Latest sync cursor)\n    App-->>User: Status updated to \"Saved\"\n```\n\n#### 3️⃣ State Transition Diagram\n```mermaid\nstateDiagram-v2\n    [*] --> Drafts: Create new note\n    Drafts --> Published: Save & Archive\n    Published --> Pinned: Pin to top\n    Pinned --> Published: Unpin note\n    Published --> Trash: Move to trash\n    Trash --> Published: Restore note\n    Trash --> [*]: Delete permanently\n```\n\n---\n\n### 🖼️ 8. Rich Media & Image Attachments\n\nDrag-and-drop or paste images into your notes. Images are compressed locally before being saved to R2 storage:\n\n![EdgeEver Architecture & Editor](/api/v1/resources/res_demo_cat_image/blob)\n\n---\n\n### 🤖 9. Native AI Agent Ecosystem (Agent-Ready)\n\nDesigned natively for the AI era:\n\n1. **REST API**: Provides standard OpenAPI definitions at `/api/openapi.json`.\n2. **MCP Endpoint**: Accessible at `/mcp`, allowing AI Agents to read/write notes directly.\n3. **Automated Workflows**: Auto-tagging, export/import, sync with Notion or Feishu.\n\n---\n\n> 🎯 **Quick Try**:\n> - Click \"Copy for WeChat / Publishing\" in the top toolbar to experience seamless content export;\n> - Switch **Editor Themes** in **User Settings / Profile** to customize your writing style;\n> - Press `Cmd/Ctrl + Shift + F` to toggle Focus Mode for distraction-free writing;\n> - Multi-select notes in the left list using `Cmd` / `Ctrl` and click \"Merge\" at the bottom;\n> - Click \"Reset Demo Data\" in the sidebar or settings to reset the demo state at any time!"
  },
} as const;
const DEMO_SEED_MEMOS_EN = DEMO_SEED_MEMOS_ZH.map((memo) => {
  const english = DEMO_MEMO_ENGLISH[memo.id as keyof typeof DEMO_MEMO_ENGLISH];
  if (!english) {
    return null;
  }

  return {
    ...memo,
    id: `${memo.id}_en`,
    notebookId: "nb_demo_features_en",
    title: english.title,
    markdown: `${english.markdown}${DEMO_ATTACHMENT_MARKDOWN_EN}`,
  };
}).filter((memo): memo is NonNullable<typeof memo> => memo !== null);
const DEMO_SEED_MEMOS_ZH_WITH_ATTACHMENTS = DEMO_SEED_MEMOS_ZH.map((memo) => ({
  ...memo,
  markdown: `${memo.markdown}${DEMO_ATTACHMENT_MARKDOWN_ZH}`,
}));
const DEMO_SEED_MEMOS = [...DEMO_SEED_MEMOS_ZH_WITH_ATTACHMENTS, ...DEMO_SEED_MEMOS_EN];
const DEMO_SEED_RESOURCES = [
  {
    id: "res_demo_cat_image",
    memoId: "memo_demo_overview",
    filename: "cute-cat-demo.svg",
    mimeType: "image/svg+xml",
    width: 960,
    height: 540,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="EdgeEver cat image demo"><defs><clipPath id="catClip"><rect width="960" height="540" rx="32" /></clipPath></defs><g clip-path="url(#catClip)"><image href="data:image/jpeg;base64,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" width="960" height="540" preserveAspectRatio="xMidYMid slice" /></g><rect width="960" height="540" rx="32" fill="none" stroke="#0f766e" stroke-width="4" stroke-opacity="0.3" /></svg>'},
] as const;
const DEMO_SEED_ATTACHMENT_RESOURCES = [...DEMO_SEED_RESOURCES, ...DEMO_ATTACHMENT_RESOURCES];
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
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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

app.get("/api/health", async (c) => {
  const authMode = await getInstanceAuthMode(c.env);

  if (authMode === "unconfigured") {
    return authNotConfigured(c);
  }

  return c.json({
    ok: true,
    name: "edgeever",
    runtime: c.env.EDGE_EVER_RUNTIME ?? "cloudflare-workers",
    authMode,
  });
});

app.get("/api/openapi.json", (c) => c.json(openApiSpec));

app.get("/api/v1/auth/session", async (c) => {
  const authMode = await getInstanceAuthMode(c.env);

  if (authMode === "unconfigured") {
    return authNotConfigured(c);
  }

  if (authMode === "disabled") {
    return c.json({
      authRequired: false,
      authenticated: true,
      demoMode: isDemoMode(c.env) || isLocalDemoSeedEnabled(c.env),
      user: {
        id: "local",
        username: "owner",
        displayName: "Owner",
        role: "owner",
      },
    });
  }

  const auth = await authenticateRequest(c, false);

  return c.json({
    authRequired: true,
    authenticated: Boolean(auth && auth.kind === "user"),
    demoMode: isDemoMode(c.env) || isLocalDemoSeedEnabled(c.env),
    user:
      auth && auth.kind === "user"
        ? {
            id: auth.actorId,
            username: auth.username,
            displayName: auth.displayName,
            role: auth.role,
          }
        : null,
  });
});

app.get("/api/v1/auth/sessions", async (c) => {
  const auth = await authenticateRequest(c, true);

  if (!auth || auth.kind !== "user" || !auth.actorId || !auth.sessionId) {
    return unauthorized(c, "An interactive user session is required.");
  }

  const now = isoNow();
  const rows = await c.env.storage.db.prepare(
    `SELECT id, device_id, user_agent, expires_at, created_at, last_seen_at
     FROM sessions
     WHERE user_id = ?
       AND revoked_at IS NULL
       AND expires_at > ?
     ORDER BY COALESCE(last_seen_at, created_at) DESC
     LIMIT 200`
  )
    .bind(auth.actorId, now)
    .all<LoginDeviceSessionRow>();

  return c.json({
    sessions: groupLoginDeviceSessions(rows.results, auth.sessionId).slice(0, 50),
  });
});

app.delete("/api/v1/auth/sessions", async (c) => {
  const auth = await authenticateRequest(c, true);

  if (!auth || auth.kind !== "user" || !auth.actorId || !auth.sessionId) {
    return unauthorized(c, "An interactive user session is required.");
  }

  const now = isoNow();
  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `UPDATE sessions
       SET revoked_at = ?
       WHERE user_id = ? AND id != ? AND revoked_at IS NULL AND expires_at > ?`
    ).bind(now, auth.actorId, auth.sessionId, now),
    auditStatement(c.env.storage.db, "user", auth.actorId, "auth.sessions_revoke_others", "session", auth.sessionId, {}),
  ]);

  return c.json({ ok: true });
});

app.delete("/api/v1/auth/sessions/:sessionId", async (c) => {
  const auth = await authenticateRequest(c, true);

  if (!auth || auth.kind !== "user" || !auth.actorId || !auth.sessionId) {
    return unauthorized(c, "An interactive user session is required.");
  }

  const sessionId = c.req.param("sessionId");
  if (sessionId === auth.sessionId) {
    return apiError(c, "current_session_cannot_be_revoked", "The current session cannot be revoked here.", 400);
  }

  const now = isoNow();
  const session = await c.env.storage.db.prepare(
    `SELECT id, device_id FROM sessions
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?`
  )
    .bind(sessionId, auth.actorId, now)
    .first<{ id: string; device_id: string | null }>();

  if (!session) {
    return notFound(c, "Login session not found.");
  }

  const currentSession = await c.env.storage.db.prepare(`SELECT device_id FROM sessions WHERE id = ? AND user_id = ?`)
    .bind(auth.sessionId, auth.actorId)
    .first<{ device_id: string | null }>();

  if (session.device_id && currentSession?.device_id === session.device_id) {
    return apiError(c, "current_session_cannot_be_revoked", "The current device cannot be revoked here.", 400);
  }

  await c.env.storage.db.batch([
    session.device_id
      ? c.env.storage.db.prepare(
          `UPDATE sessions SET revoked_at = ?
           WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`
        ).bind(now, auth.actorId, session.device_id)
      : c.env.storage.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(now, session.id),
    auditStatement(c.env.storage.db, "user", auth.actorId, "auth.session_revoke", "session", session.id, {}),
  ]);

  return c.json({ ok: true });
});

app.post("/api/v1/auth/login", zValidator("json", LoginSchema), async (c) => {
  const authMode = await getInstanceAuthMode(c.env);
  if (authMode === "unconfigured") {
    return authNotConfigured(c);
  }

  const input = c.req.valid("json");
  const user = await verifyLogin(c.env, input.username, input.password);

  if (!user) {
    return unauthorized(c, "Username or password is incorrect.");
  }

  const workspace = await ensureUserWorkspace(c.env.storage.db, user.id, user.username);
  const session = await createSession(c, user, input.deviceId);
  setSessionCookie(c, session.token, session.maxAge);

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).bind(
      isoNow(),
      isoNow(),
      user.id
    ),
    auditStatement(c.env.storage.db, "user", user.id, "auth.login", "session", session.id, {
      username: user.username,
    }),
  ]);

  return c.json({
    authRequired: true,
    authenticated: true,
    demoMode: isDemoMode(c.env) || isLocalDemoSeedEnabled(c.env),
    sessionToken: session.token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: workspace.role,
    },
  });
});

app.post("/api/v1/auth/change-password", zValidator("json", ChangePasswordSchema), async (c) => {
  const auth = await authenticateSession(c, true);

  if (!auth || auth.kind !== "user" || !auth.actorId || !auth.sessionId) {
    return unauthorized(c, "An interactive user session is required.");
  }

  if (isDemoMode(c.env)) {
    return forbidden(c, "The demo environment does not allow changing login passwords.");
  }

  const input = c.req.valid("json");
  const user = await c.env.storage.db.prepare(
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

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(
      passwordHash,
      now,
      user.id
    ),
    c.env.storage.db.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE user_id = ? AND id != ? AND revoked_at IS NULL`
    ).bind(now, user.id, auth.sessionId),
    auditStatement(c.env.storage.db, "user", user.id, "auth.password_change", "user", user.id, {}),
  ]);

  return c.json({ ok: true });
});

app.get("/api/v1/users", async (c) => {
  const auth = await authenticateSession(c, true);
  if (!auth) return unauthorized(c, "Authentication required.");
  c.set("auth", auth);
  const denied = requireOwner(c);
  if (denied) return denied;

  const rows = await c.env.storage.db.prepare(
    `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_disabled,
            u.last_login_at, u.created_at, wm.role
     FROM users u
     INNER JOIN workspace_members wm ON wm.user_id = u.id
     ORDER BY wm.role = 'owner' DESC, u.created_at ASC`
  ).all<InstanceUserRow>();

  return c.json({ users: rows.results.map(mapInstanceUser) });
});

app.post("/api/v1/users", zValidator("json", UserCreateSchema), async (c) => {
  const auth = await authenticateSession(c, true);
  if (!auth) return unauthorized(c, "Authentication required.");
  c.set("auth", auth);
  const denied = requireOwner(c);
  if (denied) return denied;

  const input = c.req.valid("json");
  const existing = await c.env.storage.db.prepare(`SELECT id FROM users WHERE username = ?`).bind(input.username).first();
  if (existing) return conflict(c, "username_exists", "Username already exists.");

  const userId = createId("usr");
  const workspaceId = createId("ws");
  const now = isoNow();
  const passwordHash = await hashPassword(input.password);
  const notebooks = createDefaultNotebookRows(workspaceId, now);
  const statements = [
    c.env.storage.db.prepare(
      `INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(userId, input.username, passwordHash, input.displayName ?? input.username, now, now),
    c.env.storage.db.prepare(`INSERT INTO workspaces (id, name, is_personal, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`)
      .bind(workspaceId, `${input.displayName ?? input.username}'s workspace`, now, now),
    c.env.storage.db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`)
      .bind(workspaceId, userId, now),
    ...notebooks.map((notebook) => c.env.storage.db.prepare(
      `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 'notebook', ?, ?, ?, ?)`
    ).bind(notebook.id, workspaceId, notebook.name, notebook.slug, notebook.color, notebook.sortOrder, now, now)),
    auditStatement(c.env.storage.db, "user", c.get("auth").actorId, "user.create", "user", userId, { username: input.username }),
  ];
  await c.env.storage.db.batch(statements);

  const user = await getInstanceUser(c.env.storage.db, userId);
  return c.json({ user: user ? mapInstanceUser(user) : null }, 201);
});

app.patch("/api/v1/users/:id", zValidator("json", UserUpdateSchema), async (c) => {
  const auth = await authenticateSession(c, true);
  if (!auth) return unauthorized(c, "Authentication required.");
  c.set("auth", auth);
  const denied = requireOwner(c);
  if (denied) return denied;

  const userId = c.req.param("id");
  const input = c.req.valid("json");
  const current = await getInstanceUser(c.env.storage.db, userId);
  if (!current) return notFound(c, "User not found");
  if (
    isProtectedDemoAccount(c.env.EDGE_EVER_DEMO_MODE, c.env.EDGE_EVER_AUTH_USERNAME, current.username)
    && (input.password !== undefined || input.isDisabled !== undefined)
  ) {
    return forbidden(c, "The demo owner account uses fixed credentials and cannot be modified.");
  }
  if (current.role === "owner" && input.isDisabled === true) {
    return badRequest(c, "The instance owner cannot be disabled.");
  }

  const updates: string[] = [];
  const binds: unknown[] = [];
  if (input.displayName !== undefined) {
    updates.push("display_name = ?");
    binds.push(input.displayName);
  }
  if (input.password !== undefined) {
    updates.push("password_hash = ?");
    binds.push(await hashPassword(input.password));
  }
  if (input.isDisabled !== undefined) {
    updates.push("is_disabled = ?");
    binds.push(input.isDisabled ? 1 : 0);
  }
  updates.push("updated_at = ?");
  binds.push(isoNow(), userId);

  const statements = [
    c.env.storage.db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...binds),
    auditStatement(c.env.storage.db, "user", c.get("auth").actorId, "user.update", "user", userId, {
      passwordReset: input.password !== undefined,
      isDisabled: input.isDisabled,
    }),
  ];
  if (input.password !== undefined || input.isDisabled === true) {
    statements.push(c.env.storage.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(isoNow(), userId));
  }
  await c.env.storage.db.batch(statements);

  const user = await getInstanceUser(c.env.storage.db, userId);
  return c.json({ user: user ? mapInstanceUser(user) : null });
});

app.post("/api/v1/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE) ?? getBearerToken(c);

  if (token) {
    await revokeSession(c.env.storage.db, token);
  }

  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/v1/*", async (c, next) => {
  if (c.req.path.startsWith("/api/v1/auth/")) {
    await next();
    return;
  }

  const authMode = await getInstanceAuthMode(c.env);

  if (authMode === "unconfigured") {
    return authNotConfigured(c);
  }

  if (authMode === "disabled") {
    c.set("auth", {
      kind: "user",
      actorType: "user",
      actorId: null,
      username: "owner",
      displayName: "Owner",
      scopes: [],
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "owner",
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

  const rows = await c.env.storage.db.prepare(
    `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at, workspace_id
     FROM api_tokens
     WHERE workspace_id = ?
     ORDER BY is_revoked ASC, created_at DESC
     LIMIT 200`
  ).bind(getWorkspaceId(c)).all<ApiTokenRow>();

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

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `INSERT INTO api_tokens (id, workspace_id, name, token_hash, token_value, scopes_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, getWorkspaceId(c), input.name, await sha256(token), token, JSON.stringify(scopes), input.expiresAt ?? null, now),
    auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "api_token.create", "api_token", id, {
      name: input.name,
      scopes,
      expiresAt: input.expiresAt ?? null,
    }),
  ]);

  const row = await getApiTokenRow(c.env.storage.db, id, getWorkspaceId(c));

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

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(`DELETE FROM api_tokens WHERE id = ? AND workspace_id = ?`).bind(id, getWorkspaceId(c)),
    auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "api_token.delete", "api_token", id, {}),
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

  const rows = await c.env.storage.db.prepare(
    notebookSelectSql(
      `WHERE n.workspace_id = ? AND n.is_deleted = 0
       GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at
       ORDER BY n.parent_id IS NOT NULL, n.sort_order ASC, n.name ASC`
    )
  ).bind(getWorkspaceId(c)).all<NotebookRow>();

  return c.json({ notebooks: rows.results.map(mapNotebook) });
});

app.get("/api/v1/sync/bootstrap", async (c) => {
  const denied = requireScopes(c, "read:notebooks", "read:memos");

  if (denied) {
    return denied;
  }

  const workspaceId = getWorkspaceId(c);
  const limit = clampNumber(Number(c.req.query("limit") ?? 100), 1, 200);
  const afterId = c.req.query("afterId")?.trim() ?? "";
  const [notebookRows, memoRows, totalRow, cursorRow] = await Promise.all([
    c.env.storage.db.prepare(
      `SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order,
              n.created_at, n.updated_at, COUNT(m.id) AS memo_count, MAX(m.updated_at) AS last_memo_updated_at
       FROM notebooks n
       LEFT JOIN memos m ON m.notebook_id = n.id AND m.workspace_id = n.workspace_id AND m.is_deleted = 0
       WHERE n.workspace_id = ? AND n.is_deleted = 0
       GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at
       ORDER BY n.sort_order ASC, n.name ASC`
    ).bind(workspaceId).all<NotebookRow>(),
    c.env.storage.db.prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
              mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents mc ON mc.memo_id = m.id
       WHERE m.workspace_id = ? AND m.id > ?
       ORDER BY m.id ASC
       LIMIT ?`
    ).bind(workspaceId, afterId, limit + 1).all<MemoDetailRow>(),
    c.env.storage.db.prepare(`SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ?`).bind(workspaceId).first<{ count: number }>(),
    c.env.storage.db.prepare(
      `SELECT w.created_at AS sync_identity, COALESCE(MAX(c.id), 0) AS cursor
       FROM workspaces w
       LEFT JOIN mobile_sync_changes c ON c.workspace_id = w.id
       WHERE w.id = ?
       GROUP BY w.created_at`
    ).bind(workspaceId).first<{ cursor: number; sync_identity: string }>(),
  ]);
  const page = memoRows.results.slice(0, limit);
  const totalCount = totalRow?.count ?? page.length;
  const nextAfterId = memoRows.results.length > limit ? page.at(-1)?.id ?? null : null;

  return c.json({
    notebooks: notebookRows.results.map(mapNotebook),
    memos: page.map(mapMemoDetail),
    snapshotCursor: cursorRow?.cursor ?? 0,
    syncIdentity: cursorRow?.sync_identity,
    totalCount,
    nextAfterId,
  });
});

app.get("/api/v1/sync/changes", async (c) => {
  const denied = requireScopes(c, "read:notebooks", "read:memos");

  if (denied) {
    return denied;
  }

  const workspaceId = getWorkspaceId(c);
  const cursor = clampNumber(Number(c.req.query("cursor") ?? 0), 0, Number.MAX_SAFE_INTEGER);
  const limit = clampNumber(Number(c.req.query("limit") ?? 100), 1, 200);
  const [rows, cursorRow] = await Promise.all([
    c.env.storage.db.prepare(
      `SELECT id, entity_type, entity_id, operation
       FROM mobile_sync_changes
       WHERE workspace_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`
    ).bind(workspaceId, cursor, limit + 1).all<MobileSyncChangeRow>(),
    c.env.storage.db.prepare(
      `SELECT w.created_at AS sync_identity, COALESCE(MAX(c.id), 0) AS cursor
       FROM workspaces w
       LEFT JOIN mobile_sync_changes c ON c.workspace_id = w.id
       WHERE w.id = ?
       GROUP BY w.created_at`
    ).bind(workspaceId).first<{ cursor: number; sync_identity: string }>(),
  ]);
  const page = rows.results.slice(0, limit);
  const memoIds = Array.from(new Set(page.filter((change) => change.entity_type === "memo" && change.operation === "upsert").map((change) => change.entity_id)));
  const notebookIds = Array.from(new Set(page.filter((change) => change.entity_type === "notebook" && change.operation === "upsert").map((change) => change.entity_id)));
  const memoPlaceholders = memoIds.map(() => "?").join(", ");
  const notebookPlaceholders = notebookIds.map(() => "?").join(", ");
  const [memoRows, notebookRows] = await Promise.all([
    memoIds.length > 0
      ? c.env.storage.db.prepare(
          `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                  m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
                  mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
                  m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
           FROM memos m
           INNER JOIN memo_contents mc ON mc.memo_id = m.id
           WHERE m.workspace_id = ? AND m.id IN (${memoPlaceholders})`
        ).bind(workspaceId, ...memoIds).all<MemoDetailRow>()
      : Promise.resolve({ results: [] as MemoDetailRow[] }),
    notebookIds.length > 0
      ? c.env.storage.db.prepare(
          `SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order,
                  n.created_at, n.updated_at, COUNT(m.id) AS memo_count, MAX(m.updated_at) AS last_memo_updated_at
           FROM notebooks n
           LEFT JOIN memos m ON m.notebook_id = n.id AND m.workspace_id = n.workspace_id AND m.is_deleted = 0
           WHERE n.workspace_id = ? AND n.is_deleted = 0 AND n.id IN (${notebookPlaceholders})
           GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at`
        ).bind(workspaceId, ...notebookIds).all<NotebookRow>()
      : Promise.resolve({ results: [] as NotebookRow[] }),
  ]);
  const memosById = new Map(memoRows.results.map((row) => [row.id, mapMemoDetail(row)]));
  const notebooksById = new Map(notebookRows.results.map((row) => [row.id, mapNotebook(row)]));
  const changes = page.map((change) => {
    if (change.entity_type === "memo") {
      const memo = change.operation === "upsert" ? memosById.get(change.entity_id) ?? null : null;
      return { cursor: change.id, entityType: change.entity_type, entityId: change.entity_id, operation: memo ? "upsert" as const : "delete" as const, notebook: null, memo };
    }

    const notebook = change.operation === "upsert" ? notebooksById.get(change.entity_id) ?? null : null;
    return { cursor: change.id, entityType: change.entity_type, entityId: change.entity_id, operation: notebook ? "upsert" as const : "delete" as const, notebook, memo: null };
  });

  return c.json({
    changes,
    cursor: page.at(-1)?.id ?? cursor,
    hasMore: rows.results.length > limit,
    serverCursor: cursorRow?.cursor ?? 0,
    syncIdentity: cursorRow?.sync_identity,
  });
});

app.post("/api/v1/notebooks", zValidator("json", NotebookCreateSchema), async (c) => {
  const denied = requireScopes(c, "write:notebooks");

  if (denied) {
    return denied;
  }

  const input = c.req.valid("json");
  const actor = getAuditActor(c);

  try {
    const notebook = await createNotebookRecord(c.env.storage.db, getWorkspaceId(c), input, actor);
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
    const notebook = await updateNotebookRecord(c.env.storage.db, getWorkspaceId(c), id, input, actor);
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
  const workspaceId = getWorkspaceId(c);
  const current = await getNotebook(c.env.storage.db, workspaceId, id);

  if (!current) {
    return notFound(c, "Notebook not found");
  }

  if (id === "nb_inbox" || current.slug === "inbox") {
    return badRequest(c, "等待分类不能删除。");
  }

  const [childCount, memoCount] = await Promise.all([
    c.env.storage.db.prepare(`SELECT COUNT(*) AS count FROM notebooks WHERE workspace_id = ? AND parent_id = ? AND is_deleted = 0`)
      .bind(workspaceId, id)
      .first<{ count: number }>(),
    c.env.storage.db.prepare(`SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ? AND notebook_id = ? AND is_deleted = 0`)
      .bind(workspaceId, id)
      .first<{ count: number }>(),
  ]);

  if ((childCount?.count ?? 0) > 0 || (memoCount?.count ?? 0) > 0) {
    return conflict(c, "notebook_not_empty", "Move or delete child notebooks and memos before deleting this notebook.");
  }

  await c.env.storage.db.prepare(
    `UPDATE notebooks
     SET is_deleted = 1, deleted_at = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND slug <> 'inbox'`
  )
    .bind(now, now, id, workspaceId)
    .run();

  await audit(c.env.storage.db, actor.actorType, actor.actorId, "notebook.delete", "notebook", id, {});
  return c.json({ ok: true });
});

app.get("/api/v1/tags", async (c) => {
  const denied = requireScopes(c, "read:tags");

  if (denied) {
    return denied;
  }

  return c.json({ tags: await listTagSummaries(c.env.storage.db, getWorkspaceId(c)) });
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
  const updated = await updateTagAcrossMemos(c.env.storage.db, getWorkspaceId(c), oldTag, input.name, actor, actorLabel);

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
  const updated = await updateTagAcrossMemos(c.env.storage.db, getWorkspaceId(c), tag, null, actor, actorLabel);

  return c.json({ ok: true, updated });
});

app.get("/api/v1/templates", async (c) => {
  const rows = await c.env.storage.db.prepare(
    `SELECT id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
     FROM memo_templates
     WHERE workspace_id = ?
     ORDER BY updated_at DESC, name ASC`
  ).bind(getWorkspaceId(c)).all<MemoTemplateRow>();

  return c.json({ templates: rows.results.map(mapMemoTemplate) });
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

app.get("/api/v1/memos", async (c) => {
  const denied = requireScopes(c, "read:memos");

  if (denied) {
    return denied;
  }

  const notebookId = c.req.query("notebookId");
  const includeNotebookDescendants = c.req.query("includeDescendants") === "1";
  const q = c.req.query("q")?.trim();
  const includeTrash = c.req.query("trash") === "1";
  const sort = normalizeMemoListSort(c.req.query("sort"));
  const filter = normalizeMemoListFilter(c.req.query("filter"));
  const limit = clampNumber(Number(c.req.query("limit") ?? DEFAULT_MEMO_LIST_LIMIT), 1, MAX_MEMO_LIST_LIMIT);
  const cursor = decodeMemoListCursor(c.req.query("cursor"), sort);
  const deletedClause = includeTrash ? "m.is_deleted = 1" : "m.is_deleted = 0";
  const titleSortExpression = `LOWER(COALESCE(NULLIF(m.title, ''), '${UNTITLED_MEMO_TITLE}'))`;
  const baseConditions = ["m.workspace_id = ?", deletedClause];
  const baseBinds: unknown[] = [getWorkspaceId(c)];

  if (notebookId) {
    if (includeNotebookDescendants) {
      baseConditions.push(
        `m.notebook_id IN (
           WITH RECURSIVE descendants(id) AS (
             SELECT id
             FROM notebooks
             WHERE workspace_id = ? AND id = ? AND is_deleted = 0

             UNION

             SELECT n.id
             FROM notebooks n
             INNER JOIN descendants d ON n.parent_id = d.id
             WHERE n.workspace_id = ? AND n.is_deleted = 0
           )
           SELECT id FROM descendants
         )`
      );
      baseBinds.push(getWorkspaceId(c), notebookId, getWorkspaceId(c));
    } else {
      baseConditions.push("m.notebook_id = ?");
      baseBinds.push(notebookId);
    }
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
        c.env.storage.db.prepare(
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
        c.env.storage.db.prepare(
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
      c.env.storage.db.prepare(
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
      c.env.storage.db.prepare(
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
    c.env.storage.db.prepare(
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
    c.env.storage.db.prepare(
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

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `INSERT INTO memos (
        id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
      ) SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ? FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
    ).bind(id, getWorkspaceId(c), title, excerpt, JSON.stringify(tags), actorLabel, actorLabel, createdAt, updatedAt, input.notebookId, getWorkspaceId(c)),
    c.env.storage.db.prepare(
      `INSERT INTO memo_contents (
        memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(id, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, createdAt, updatedAt),
    c.env.storage.db.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "memo.create", "memo", id, {
      notebookId: input.notebookId,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.storage.db, getWorkspaceId(c), id) }, 201);
});

app.post("/api/v1/memos/batch/move", zValidator("json", MoveMemosSchema), async (c) => {
  const denied = requireScopes(c, "write:memos");

  if (denied) {
    return denied;
  }

  const input = c.req.valid("json");
  const target = await getNotebook(c.env.storage.db, getWorkspaceId(c), input.notebookId);

  if (!target) {
    return notFound(c, "Target notebook not found");
  }

  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);

  try {
    const moved = await moveMemosToNotebook(c.env.storage.db, getWorkspaceId(c), input.memoIds, input.notebookId, actor, actorLabel);

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
    const deleted = await deleteMemosRecord(c.env.storage.db, c.env.storage.resources, getWorkspaceId(c), input.memoIds, Boolean(input.permanent), actor);
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
  const deleted = await emptyTrashMemosRecord(c.env.storage.db, c.env.storage.resources, getWorkspaceId(c), actor);

  return c.json({ ok: true, deleted });
});

app.get("/api/v1/memos/:id", async (c) => {
  const denied = requireScopes(c, "read:memos");

  if (denied) {
    return denied;
  }

  const includeDeleted = c.req.query("includeDeleted") === "1";
  const memo = await getMemoDetail(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), includeDeleted);

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
  const current = await getMemoDetailRow(c.env.storage.db, getWorkspaceId(c), memoId);

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

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(`DELETE FROM memo_edit_sessions WHERE expires_at <= ?`).bind(now),
    c.env.storage.db.prepare(
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
  const memo = await getMemoDetail(c.env.storage.db, getWorkspaceId(c), memoId);

  if (!memo) {
    return notFound(c, "Memo not found");
  }

  const limit = clampNumber(Number(c.req.query("limit") ?? 50), 1, 100);
  const rows = await c.env.storage.db.prepare(
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
  const current = await getMemoDetailRow(c.env.storage.db, getWorkspaceId(c), memoId);

  if (!current) {
    return notFound(c, "Memo not found");
  }

  const revision = await getMemoRevisionRow(c.env.storage.db, getWorkspaceId(c), memoId, revisionId);

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

  await c.env.storage.db.batch([
    createMemoRevisionStatement(c.env.storage.db, current, actorLabel, now),
    c.env.storage.db.prepare(
      `UPDATE memos
       SET title = ?, excerpt = ?, tags_json = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).bind(title, excerpt, JSON.stringify(tags), actorLabel, now, memoId),
    c.env.storage.db.prepare(
      `UPDATE memo_contents
       SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
           revision = ?, updated_at = ?
       WHERE memo_id = ?`
    ).bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, now, memoId),
    c.env.storage.db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(memoId),
    c.env.storage.db.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(memoId, title, contentText, tags.join(" ")),
    auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "memo.revision_restore", "memo", memoId, {
      revisionId,
      restoredRevision: revision.revision,
      revision: nextRevision,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.storage.db, getWorkspaceId(c), memoId) });
});

app.get("/api/v1/exports/markdown", async (c) => {
  const denied = requireScopes(c, "read:memos", "read:resources");

  if (denied) {
    return denied;
  }

  const limit = clampNumber(Number(c.req.query("limit") ?? 50), 1, 100);
  const offset = clampNumber(Number(c.req.query("offset") ?? 0), 0, 1_000_000);
  const [memoRows, totalRow] = await Promise.all([
    c.env.storage.db.prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
              mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents mc ON mc.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = 0
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT ? OFFSET ?`
    )
      .bind(getWorkspaceId(c), limit, offset)
      .all<MemoDetailRow>(),
    c.env.storage.db.prepare(`SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ? AND is_deleted = 0`).bind(getWorkspaceId(c)).first<{ count: number }>(),
  ]);

  const memoIds = memoRows.results.map((row) => row.id);
  let resources: Resource[] = [];

  if (memoIds.length > 0) {
    const placeholders = memoIds.map(() => "?").join(", ");
    const resourceRows = await c.env.storage.db.prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
       FROM resources
       WHERE is_deleted = 0 AND memo_id IN (${placeholders})
       ORDER BY memo_id ASC, created_at ASC, id ASC`
    )
      .bind(...memoIds)
      .all<ResourceRow>();
    resources = resourceRows.results.map(mapResource);
  }

  const totalCount = totalRow?.count ?? memoRows.results.length;
  const nextOffset = offset + memoRows.results.length < totalCount ? offset + memoRows.results.length : null;

  return c.json({
    memos: memoRows.results.map(mapMemoDetail),
    resources,
    totalCount,
    nextOffset,
  });
});

app.get("/api/v1/backups/json", async (c) => {
  const denied = requireScopes(c, "read:memos", "read:resources");

  if (denied) {
    return denied;
  }

  const limit = clampNumber(Number(c.req.query("limit") ?? 25), 1, 50);
  const offset = clampNumber(Number(c.req.query("offset") ?? 0), 0, 1_000_000);
  const [memoRows, totalRow] = await Promise.all([
    c.env.storage.db.prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
              mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents mc ON mc.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = 0
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT ? OFFSET ?`
    )
      .bind(getWorkspaceId(c), limit, offset)
      .all<MemoDetailRow>(),
    c.env.storage.db.prepare(`SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ? AND is_deleted = 0`).bind(getWorkspaceId(c)).first<{ count: number }>(),
  ]);
  const memoIds = memoRows.results.map((row) => row.id);
  let resources: Resource[] = [];
  let revisions: JsonBackupRevision[] = [];

  if (memoIds.length > 0) {
    const placeholders = memoIds.map(() => "?").join(", ");
    const [resourceRows, revisionRows] = await Promise.all([
      c.env.storage.db.prepare(
        `SELECT id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type,
                filename, byte_size, sha256, width, height, created_at, updated_at
         FROM resources
         WHERE is_deleted = 0 AND memo_id IN (${placeholders})
         ORDER BY memo_id ASC, created_at ASC, id ASC`
      )
        .bind(...memoIds)
        .all<ResourceRow>(),
      c.env.storage.db.prepare(
        `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
                content_text, content_hash, created_by, created_at
         FROM memo_revisions
         WHERE memo_id IN (${placeholders})
         ORDER BY memo_id ASC, revision ASC, created_at ASC`
      )
        .bind(...memoIds)
        .all<BackupRevisionRow>(),
    ]);
    resources = resourceRows.results.map(mapResource);
    revisions = revisionRows.results.map(mapJsonBackupRevision);
  }

  const totalCount = totalRow?.count ?? memoRows.results.length;
  const nextOffset = offset + memoRows.results.length < totalCount ? offset + memoRows.results.length : null;

  return c.json({
    memos: memoRows.results.map(mapMemoDetail),
    resources,
    revisions,
    totalCount,
    nextOffset,
  });
});

app.post("/api/v1/restores/json/notebooks", zValidator("json", RestoreJsonNotebooksSchema), async (c) => {
  const userOnly = requireUser(c);
  if (userOnly) {
    return userOnly;
  }

  await restoreJsonNotebooks(c.env.storage.db, getWorkspaceId(c), c.req.valid("json").notebooks as JsonBackupNotebook[]);
  return c.json({ ok: true });
});

app.post("/api/v1/restores/json/memos", zValidator("json", RestoreJsonMemosSchema), async (c) => {
  const userOnly = requireUser(c);
  if (userOnly) {
    return userOnly;
  }

  await restoreJsonMemos(c.env.storage.db, getWorkspaceId(c), c.req.valid("json").memos as JsonBackupMemo[]);
  return c.json({ ok: true });
});

app.put("/api/v1/restores/json/resources/:id", async (c) => {
  const userOnly = requireUser(c);
  if (userOnly) {
    return userOnly;
  }

  const form = await c.req.raw.formData();
  const file = form.get("file");
  const metadataValue = form.get("metadata");
  if (!(file instanceof File) || typeof metadataValue !== "string") {
    return badRequest(c, "Restore resource file and metadata are required.");
  }

  let metadataInput: unknown;
  try {
    metadataInput = JSON.parse(metadataValue);
  } catch {
    return badRequest(c, "Restore resource metadata must be valid JSON.");
  }

  const parsed = JsonBackupResourceMetadataSchema.safeParse(metadataInput);
  if (!parsed.success || parsed.data.id !== c.req.param("id")) {
    return badRequest(c, "Restore resource metadata is invalid.");
  }

  const metadata = parsed.data as JsonBackupResource;
  const memo = await getMemoDetail(c.env.storage.db, getWorkspaceId(c), metadata.memoId);
  if (!memo) {
    return notFound(c, "Restore target memo not found.");
  }

  const maxBytes = metadata.kind === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_ATTACHMENT_UPLOAD_BYTES;
  if (file.size <= 0 || file.size > maxBytes) {
    return apiError(c, "upload_too_large", "Backup resource size is invalid.", 413);
  }

  const filename = normalizeFilename(metadata.filename || file.name) || `${metadata.kind}-${metadata.id}`;
  const objectKey = `workspaces/${getWorkspaceId(c)}/restores/${metadata.memoId}/${metadata.id}/${Date.now()}-${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const foreignResource = await c.env.storage.db.prepare(
    `SELECT r.id FROM resources r INNER JOIN memos m ON m.id = r.memo_id
     WHERE r.id = ? AND m.workspace_id <> ? LIMIT 1`
  ).bind(metadata.id, getWorkspaceId(c)).first<{ id: string }>();
  if (foreignResource) {
    return conflict(c, "cross_workspace_id_conflict", "Backup resource ID is already used by another user.");
  }
  const previous = await c.env.storage.db.prepare(
    `SELECT r.object_key FROM resources r INNER JOIN memos m ON m.id = r.memo_id WHERE r.id = ? AND m.workspace_id = ?`
  ).bind(metadata.id, getWorkspaceId(c)).first<{ object_key: string }>();
  const originalMemo = metadata.originalMemoId
    ? await c.env.storage.db.prepare(`SELECT id FROM memos WHERE id = ? AND workspace_id = ?`).bind(metadata.originalMemoId, getWorkspaceId(c)).first<{ id: string }>()
    : null;

  await c.env.storage.resources.put(objectKey, bytes, {
    httpMetadata: { contentType: metadata.mimeType ?? file.type ?? "application/octet-stream" },
    customMetadata: { memoId: metadata.memoId, resourceId: metadata.id, restored: "true" },
  });

  try {
    const now = isoNow();
    await c.env.storage.db.prepare(
      `INSERT INTO resources (
        id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type, filename,
        byte_size, sha256, width, height, metadata_json, is_deleted, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        memo_id = excluded.memo_id,
        original_memo_id = excluded.original_memo_id,
        bucket_name = excluded.bucket_name,
        object_key = excluded.object_key,
        kind = excluded.kind,
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
    ).bind(
      metadata.id,
      metadata.memoId,
      originalMemo?.id ?? null,
      c.env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME,
      objectKey,
      metadata.kind,
      metadata.mimeType ?? file.type ?? null,
      filename,
      bytes.byteLength,
      await sha256Bytes(bytes),
      metadata.width,
      metadata.height,
      JSON.stringify({ source: "edgeever-zip-import" }),
      metadata.createdAt,
      now
    ).run();
  } catch (error) {
    await c.env.storage.resources.delete(objectKey);
    throw error;
  }

  if (previous?.object_key && previous.object_key !== objectKey) {
    await c.env.storage.resources.delete(previous.object_key);
  }

  return c.json({ ok: true });
});

app.get("/api/v1/resources", async (c) => {
  const denied = requireScopes(c, "read:resources");

  if (denied) {
    return denied;
  }

  const limit = clampNumber(Number(c.req.query("limit") ?? 500), 1, 500);
  const [rows, stats] = await Promise.all([
    c.env.storage.db.prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.kind,
              r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height,
              r.created_at, r.updated_at, m.title AS memo_title, m.excerpt AS memo_excerpt,
              m.is_deleted AS memo_is_deleted
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND r.is_deleted = 0
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
      .bind(getWorkspaceId(c), limit)
      .all<ResourceListRow>(),
    c.env.storage.db.prepare(
      `SELECT COUNT(*) AS total_count,
              COALESCE(SUM(byte_size), 0) AS total_bytes,
              COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
              COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND r.is_deleted = 0`
    ).bind(getWorkspaceId(c)).first<ResourceStatsRow>(),
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
  const memo = await getMemoDetail(c.env.storage.db, getWorkspaceId(c), memoId);

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
  const objectKey = `workspaces/${getWorkspaceId(c)}/memos/${input.memoId}/${resourceId}${inferImageExtension(processed.filename, processed.mimeType)}`;
  const bucketName = c.env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME;
  const filename = normalizeFilename(processed.filename) || `${resourceId}${inferImageExtension(processed.filename, processed.mimeType)}`;
  const checksum = await sha256Bytes(processed.bytes);

  await c.env.storage.resources.put(objectKey, processed.bytes, {
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
    await c.env.storage.db.batch([
      c.env.storage.db.prepare(
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
      auditStatement(c.env.storage.db, input.actor.actorType, input.actor.actorId, "resource.create", "resource", resourceId, {
        memoId: input.memoId,
        mimeType: processed.mimeType,
        byteSize: processed.bytes.byteLength,
        compressed: processed.compressed,
      }),
    ]);
  } catch (error) {
    await c.env.storage.resources.delete(objectKey);
    throw error;
  }

  const resource = await getResourceRow(c.env.storage.db, getWorkspaceId(c), resourceId);

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
  const objectKey = `workspaces/${getWorkspaceId(c)}/memos/${input.memoId}/${resourceId}`;
  const bucketName = c.env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME;
  const checksum = await sha256Bytes(input.bytes);

  await c.env.storage.resources.put(objectKey, input.bytes, {
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
    await c.env.storage.db.batch([
      c.env.storage.db.prepare(
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
      auditStatement(c.env.storage.db, input.actor.actorType, input.actor.actorId, "resource.create", "resource", resourceId, {
        memoId: input.memoId,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
      }),
    ]);
  } catch (error) {
    await c.env.storage.resources.delete(objectKey);
    throw error;
  }

  const resource = await getResourceRow(c.env.storage.db, getWorkspaceId(c), resourceId);

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
    throw new AppError("upload_too_large", "Attachment must be between 1 byte and 100 MB.", 413);
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

  const resource = await getResourceRow(c.env.storage.db, getWorkspaceId(c), c.req.param("id"));

  if (!resource) {
    return notFound(c, "Resource not found");
  }

  const object = await c.env.storage.resources.get(resource.object_key);

  if (!object) {
    return notFound(c, "Resource object not found");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", resource.mime_type ?? headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", headers.get("Cache-Control") ?? "private, max-age=3600");
  headers.set("Content-Length", String(object.size));
  headers.set(
    "Content-Disposition",
    resource.kind === "image"
      ? contentDispositionInline(resource.filename)
      : contentDispositionAttachment(resource.filename)
  );
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { headers });
});

app.post("/api/v1/demo/reset", async (c) => {
  if (!isDemoMode(c.env) && !isLocalDemoSeedEnabled(c.env)) {
    return c.json(
      {
        error: {
          code: "demo_mode_disabled",
          message: "Demo reset is only available when demo mode or local demo seed is enabled",
        },
      },
      400
    );
  }

  await resetDemoData(c.env, Date.now());
  return c.json({
    success: true,
    message: "Demo seed data successfully restored",
  });
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
  const workspaceId = getWorkspaceId(c);
  const current = await getMemoDetailRow(c.env.storage.db, workspaceId, id);

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

    editSession = await c.env.storage.db.prepare(
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
      return c.json({ memo: await getMemoDetail(c.env.storage.db, workspaceId, id) });
    }

    await c.env.storage.db.batch([
      c.env.storage.db.prepare(
        `UPDATE memos
         SET is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE id = ? AND is_deleted = 0`
      ).bind(isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id),
      auditStatement(c.env.storage.db, actor.actorType, actor.actorId, isPinned ? "memo.pin" : "memo.unpin", "memo", id, {}),
    ]);

    return c.json({ memo: await getMemoDetail(c.env.storage.db, workspaceId, id) });
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
  const revisionStatements = (await shouldSnapshotMemoRevision(c.env.storage.db, current, title, JSON.stringify(tags), contentHash, updatedAt))
    ? [createMemoRevisionStatement(c.env.storage.db, current, actorLabel, updatedAt)]
    : [];
  const editSessionStatements = editSession
    ? [
        c.env.storage.db.prepare(
          `UPDATE memo_edit_sessions
           SET base_revision = ?, base_content_hash = ?, updated_at = ?
           WHERE id = ? AND memo_id = ? AND base_revision = ? AND base_content_hash = ?`
        ).bind(nextRevision, contentHash, updatedAt, editSession.id, id, current.revision, current.content_hash),
      ]
    : [
        c.env.storage.db.prepare(
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

  await c.env.storage.db.batch([
    ...revisionStatements,
    c.env.storage.db.prepare(
      `UPDATE memos
       SET notebook_id = ?, title = ?, excerpt = ?, tags_json = ?, is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
       WHERE id = ? AND workspace_id = ? AND is_deleted = 0
         AND EXISTS (SELECT 1 FROM notebooks n WHERE n.id = ? AND n.workspace_id = ? AND n.is_deleted = 0)`
    ).bind(notebookId, title, excerpt, JSON.stringify(tags), isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id, workspaceId, notebookId, workspaceId),
    c.env.storage.db.prepare(
      `UPDATE memo_contents
       SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
           revision = ?, updated_at = ?, created_at = COALESCE(?, created_at)
       WHERE memo_id = ?`
    ).bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, updatedAt, input.createdAt ?? null, id),
    c.env.storage.db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    c.env.storage.db.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    ...editSessionStatements,
    auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "memo.update", "memo", id, {
      revision: nextRevision,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.storage.db, workspaceId, id) });
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
  const workspaceId = getWorkspaceId(c);

  if (permanent) {
    const current = await getMemoDetailRow(c.env.storage.db, workspaceId, id, true);

    if (!current || current.is_deleted === 0) {
      return notFound(c, "Memo not found in trash");
    }

    const resources = await getResourceRowsForMemo(c.env.storage.db, workspaceId, id);

    if (resources.length > 0) {
      await c.env.storage.resources.delete(resources.map((resource) => resource.object_key));
    }

    await c.env.storage.db.batch([
      c.env.storage.db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
      c.env.storage.db.prepare(`DELETE FROM resources WHERE memo_id = ?`).bind(id),
      c.env.storage.db.prepare(`DELETE FROM memo_revisions WHERE memo_id = ?`).bind(id),
      c.env.storage.db.prepare(`DELETE FROM memo_contents WHERE memo_id = ?`).bind(id),
      c.env.storage.db.prepare(`DELETE FROM memos WHERE id = ? AND workspace_id = ? AND is_deleted = 1`).bind(id, workspaceId),
      auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "memo.delete_permanent", "memo", id, {}),
    ]);

    return c.json({ ok: true });
  }

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `UPDATE memos
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
    ).bind(now, now, id, workspaceId),
    c.env.storage.db.prepare(
      `UPDATE resources
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE memo_id = ? AND is_deleted = 0`
    ).bind(now, now, id),
    c.env.storage.db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "memo.delete", "memo", id, {}),
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
  const workspaceId = getWorkspaceId(c);
  const current = await getMemoDetailRow(c.env.storage.db, workspaceId, id, true);

  if (!current || current.is_deleted === 0) {
    return notFound(c, "Memo not found in trash");
  }

  const tags = parseJsonArray(current.tags_json);
  const now = isoNow();
  const originalNotebook = await getNotebook(c.env.storage.db, workspaceId, current.notebook_id);
  const inbox = await c.env.storage.db.prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND slug = 'inbox' AND is_deleted = 0 LIMIT 1`).bind(workspaceId).first<{ id: string }>();
  const restoreNotebookId = originalNotebook ? current.notebook_id : inbox?.id;

  if (!restoreNotebookId) {
    return conflict(c, "restore_notebook_missing", "Original notebook was deleted and the default inbox is unavailable.");
  }

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `UPDATE memos
       SET notebook_id = ?, is_deleted = 0, deleted_at = NULL, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND is_deleted = 1`
    ).bind(restoreNotebookId, now, id, workspaceId),
    c.env.storage.db.prepare(
      `UPDATE resources
       SET is_deleted = 0, deleted_at = NULL, updated_at = ?
       WHERE memo_id = ? AND is_deleted = 1`
    ).bind(now, id),
    c.env.storage.db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    c.env.storage.db.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, current.title, current.content_text, tags.join(" ")),
    auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "memo.restore", "memo", id, {
      fromNotebookId: current.notebook_id,
      toNotebookId: restoreNotebookId,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.storage.db, workspaceId, id) });
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
    const memo = await mergeMemosRecord(c.env.storage.db, getWorkspaceId(c), input, actor, actorLabel);
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
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext) {
    const runtimeEnv = {
      ...env,
      storage: createCloudflareStorageAdapter(env),
    } as Bindings;

    if (isLocalDemoSeedEnabled(runtimeEnv)) {
      await ensureLocalDemoSeed(runtimeEnv);
    }

    return app.fetch(request, runtimeEnv, ctx);
  },
  async scheduled(controller: ScheduledController, env: WorkerBindings, ctx: ExecutionContext) {
    const runtimeEnv = {
      ...env,
      storage: createCloudflareStorageAdapter(env),
    } as Bindings;

    if (!isDemoMode(runtimeEnv)) {
      return;
    }

    ctx.waitUntil(resetDemoData(runtimeEnv, controller.scheduledTime, { resetCredentials: true }));
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

app.onError((error, c) => {
  if (error instanceof AppError) {
    return apiError(c, error.code, error.message, error.status);
  }

  if (isDatabaseNotReadyError(error)) {
    console.error("EdgeEver database readiness check failed", error);
    return databaseNotReady(c);
  }

  console.error("Unhandled EdgeEver API error", error);
  return apiError(c, "internal_error", "An unexpected server error occurred.", 500);
});

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
        memos: await searchMemoSummaries(c.env.storage.db, {
          workspaceId: auth.workspaceId,
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
      return await listMemosForMcp(c.env.storage.db, {
        workspaceId: auth.workspaceId,
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
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId, args.includeDeleted === true);

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
      const memo = await createMemoRecord(c.env.storage.db, auth.workspaceId, {
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
        c.env.storage.db,
        auth.workspaceId,
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
        return { dryRun: true, memos: await getMemosForBulkAction(c.env.storage.db, auth.workspaceId, memoIds, 0) };
      }

      const deleted = await deleteMemosRecord(c.env.storage.db, c.env.storage.resources, auth.workspaceId, memoIds, false, getAuditActor(c));
      return { ok: true, deleted };
    }
    case "restore_memos": {
      assertScope(auth, "write:memos");
      const memoIds = getRequiredStringArray(args.memoIds, "memoIds");

      if (args.dryRun === true) {
        return { dryRun: true, memos: await getMemosForBulkAction(c.env.storage.db, auth.workspaceId, memoIds, 1) };
      }

      const restored = await restoreMemosRecord(c.env.storage.db, auth.workspaceId, memoIds, getAuditActor(c));
      return { ok: true, restored };
    }
    case "upload_memo_image": {
      assertScope(auth, "write:resources");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId);

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
      const target = await getNotebook(c.env.storage.db, auth.workspaceId, notebookId);

      if (!target) {
        throw new AppError("not_found", "Target notebook not found", 404);
      }

      if (args.dryRun === true) {
        return { dryRun: true, targetNotebook: target, memos: await getMemosForBulkAction(c.env.storage.db, auth.workspaceId, memoIds, 0) };
      }

      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const moved = await moveMemosToNotebook(c.env.storage.db, auth.workspaceId, memoIds, notebookId, actor, actorLabel);

      return { ok: true, moved };
    }
    case "add_tags_to_memos": {
      assertScope(auth, "write:tags");
      return await updateTagsForMemos(c.env.storage.db, {
        workspaceId: auth.workspaceId,
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
      return await updateTagsForMemos(c.env.storage.db, {
        workspaceId: auth.workspaceId,
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
        return await previewTagRename(c.env.storage.db, auth.workspaceId, from, to);
      }

      const updated = await updateTagAcrossMemos(c.env.storage.db, auth.workspaceId, from, to, getAuditActor(c), getActorLabel(c));
      return { ok: true, updated };
    }
    case "delete_tag": {
      assertScope(auth, "write:tags");
      const tag = getRequiredString(args.tag, "tag");

      if (args.dryRun === true) {
        return await previewTagRename(c.env.storage.db, auth.workspaceId, tag, null);
      }

      const updated = await updateTagAcrossMemos(c.env.storage.db, auth.workspaceId, tag, null, getAuditActor(c), getActorLabel(c));
      return { ok: true, updated };
    }
    case "merge_memos": {
      assertScope(auth, "write:memos");
      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const memo = await mergeMemosRecord(
        c.env.storage.db,
        auth.workspaceId,
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
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId);

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
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId, true);

      if (!memo) {
        throw new AppError("not_found", "Memo not found", 404);
      }

      return { resources: await listResourcesForMemo(c.env.storage.db, auth.workspaceId, memoId) };
    }
    case "list_resources": {
      assertScope(auth, "read:resources");
      return await listResourcesForMcp(c.env.storage.db, auth.workspaceId, clampNumber(Number(args.limit ?? 100), 1, 500));
    }
    case "list_memo_revisions": {
      assertScope(auth, "read:memos");
      return {
        revisions: await listMemoRevisions(
          c.env.storage.db,
          auth.workspaceId,
          getRequiredString(args.memoId, "memoId"),
          clampNumber(Number(args.limit ?? 50), 1, 100)
        ),
      };
    }
    case "restore_memo_revision": {
      assertScope(auth, "write:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const revisionId = getRequiredString(args.revisionId, "revisionId");
      const revision = await getMemoRevisionRow(c.env.storage.db, auth.workspaceId, memoId, revisionId);

      if (!revision) {
        throw new AppError("not_found", "Memo revision not found", 404);
      }

      if (args.dryRun === true) {
        return { dryRun: true, revision: mapMemoRevision(revision) };
      }

      return { memo: await restoreMemoRevisionRecord(c.env.storage.db, auth.workspaceId, memoId, revisionId, getAuditActor(c), getActorLabel(c)) };
    }
    case "move_notebook": {
      assertScope(auth, "write:notebooks");
      const actor = getAuditActor(c);
      const notebook = await updateNotebookRecord(
        c.env.storage.db,
        auth.workspaceId,
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
        c.env.storage.db,
        auth.workspaceId,
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
      return { notebooks: await listNotebooks(c.env.storage.db, auth.workspaceId) };
    }
    case "list_tags": {
      assertScope(auth, "read:tags");
      return { tags: await listTagSummaries(c.env.storage.db, auth.workspaceId) };
    }
    case "get_workspace_stats": {
      assertScope(auth, "read:memos");
      return await getWorkspaceStats(c.env.storage.db, auth.workspaceId);
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

const getInstanceAuthMode = async (env: Bindings): Promise<InstanceAuthMode> => {
  if (!env.storage.db || typeof env.storage.db.prepare !== "function") {
    throw new AppError(
      "database_not_ready",
      "Database is not ready. Bind the D1 database as DB and apply the remote migrations.",
      503,
    );
  }

  let user: { id: string } | null;
  try {
    user = await env.storage.db.prepare(`SELECT id FROM users WHERE is_disabled = 0 LIMIT 1`).first<{ id: string }>();
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      throw new AppError(
        "database_not_ready",
        "Database is not ready. Bind the D1 database as DB and apply the remote migrations.",
        503,
      );
    }
    throw error;
  }

  return resolveInstanceAuthMode({
    allowUnauthenticated: isUnauthenticatedAccessEnabled(env.EDGE_EVER_ALLOW_UNAUTHENTICATED),
    hasBootstrapCredential: hasBootstrapCredential(
      env.EDGE_EVER_AUTH_PASSWORD,
      env.EDGE_EVER_AUTH_PASSWORD_HASH,
    ),
    hasEnabledUser: Boolean(user),
  });
};

const verifyLogin = async (env: Bindings, username: string, password: string): Promise<UserRow | null> => {
  const normalizedUsername = username.trim();
  const existingUser = await getUserByUsername(env.storage.db, normalizedUsername);

  if (existingUser) {
    if (await verifyPassword(password, existingUser.password_hash)) {
      return existingUser;
    }

    if (!isSupportedPasswordHash(existingUser.password_hash)) {
      throw new AppError(
        "password_hash_invalid",
        "This account has an invalid password hash. Reset it with the EdgeEver password reset command.",
        503,
      );
    }

    return null;
  }

  const configuredHash = env.EDGE_EVER_AUTH_PASSWORD_HASH?.trim();
  const configuredPassword = env.EDGE_EVER_AUTH_PASSWORD;

  if (!configuredHash && !configuredPassword) {
    return null;
  }

  const configuredUsername = env.EDGE_EVER_AUTH_USERNAME?.trim() || "admin";

  if (normalizedUsername !== configuredUsername) {
    return null;
  }

  const passwordMatches = await verifyBootstrapPassword(
    password,
    configuredPassword,
    configuredHash,
    verifyPassword,
  );

  if (!passwordMatches) {
    return null;
  }

  const now = isoNow();
  const userId = createId("usr");
  const passwordHash = await hashPassword(password);

  await env.storage.db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, normalizedUsername, passwordHash, normalizedUsername, now, now)
    .run();

  return getUserByUsername(env.storage.db, normalizedUsername);
};

const getUserByUsername = async (db: DatabaseAdapter, username: string) =>
  db
    .prepare(
      `SELECT id, username, password_hash, display_name, is_disabled
       FROM users
       WHERE username = ? AND is_disabled = 0`
    )
    .bind(username)
    .first<UserRow>();

const getInstanceUser = (db: D1Database, userId: string) =>
  db.prepare(
    `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_disabled,
            u.last_login_at, u.created_at, wm.role
     FROM users u
     INNER JOIN workspace_members wm ON wm.user_id = u.id
     WHERE u.id = ?`
  ).bind(userId).first<InstanceUserRow>();

const mapInstanceUser = (row: InstanceUserRow): InstanceUser => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  role: row.role,
  isDisabled: Boolean(row.is_disabled),
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

const ensureUserWorkspace = async (db: D1Database, userId: string, username: string) => {
  const existing = await db.prepare(
    `SELECT workspace_id, role FROM workspace_members WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<{ workspace_id: string; role: "owner" | "member" }>();
  if (existing) {
    await ensureWorkspaceTemplateSeed(db, existing.workspace_id);
    return { workspaceId: existing.workspace_id, role: existing.role };
  }

  const defaultOwner = await db.prepare(
    `SELECT user_id FROM workspace_members WHERE workspace_id = ? LIMIT 1`
  ).bind(DEFAULT_WORKSPACE_ID).first<{ user_id: string }>();
  if (!defaultOwner) {
    await db.prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')`
    ).bind(DEFAULT_WORKSPACE_ID, userId).run();
    const claimed = await db.prepare(
      `SELECT workspace_id, role FROM workspace_members WHERE user_id = ? LIMIT 1`
    ).bind(userId).first<{ workspace_id: string; role: "owner" | "member" }>();
    if (claimed) {
      await ensureWorkspaceTemplateSeed(db, claimed.workspace_id);
      return { workspaceId: claimed.workspace_id, role: claimed.role };
    }
  }

  const workspaceId = createId("ws");
  const now = isoNow();
  const notebooks = createDefaultNotebookRows(workspaceId, now);
  await db.batch([
    db.prepare(`INSERT INTO workspaces (id, name, is_personal, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`)
      .bind(workspaceId, `${username}'s workspace`, now, now),
    db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`)
      .bind(workspaceId, userId, now),
    ...notebooks.map((notebook) => db.prepare(
      `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 'notebook', ?, ?, ?, ?)`
    ).bind(notebook.id, workspaceId, notebook.name, notebook.slug, notebook.color, notebook.sortOrder, now, now)),
  ]);
  await ensureWorkspaceTemplateSeed(db, workspaceId);
  return { workspaceId, role: "member" as const };
};

const createDefaultNotebookRows = (workspaceId: string, _now: string) => [
  { id: `${workspaceId}_inbox`, name: "等待分类", slug: "inbox", color: "#0f766e", sortOrder: 10 },
  { id: `${workspaceId}_projects`, name: "工作项目", slug: "work-projects", color: "#2563eb", sortOrder: 20 },
  { id: `${workspaceId}_learning`, name: "学习资料", slug: "learning-resources", color: "#7c3aed", sortOrder: 30 },
  { id: `${workspaceId}_creative`, name: "灵感创作", slug: "creative-ideas", color: "#db2777", sortOrder: 40 },
  { id: `${workspaceId}_personal`, name: "生活个人", slug: "personal-life", color: "#ea580c", sortOrder: 50 },
];

const ensureWorkspaceTemplateSeed = async (db: D1Database, workspaceId: string) => {
  const now = isoNow();
  const templateId = `${workspaceId}_template_project_weekly`;
  const contentMarkdown = "## 本周进展\n\n- \n\n## 关键成果\n\n- \n\n## 风险与阻塞\n\n- \n\n## 下周计划\n\n- [ ] \n\n## 需要协助\n\n- ";
  const contentJson = markdownToDoc(contentMarkdown);

  await db.prepare(
    `INSERT OR IGNORE INTO memo_templates (
       id, workspace_id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    templateId,
    workspaceId,
    "项目周报模板",
    "每周同步项目进展、风险与下一步计划",
    "项目周报｜第 {{周次}} 周",
    JSON.stringify(contentJson),
    contentMarkdown,
    JSON.stringify(["项目管理", "周报"]),
    now,
    now,
  ).run();
};

const createSession = async (c: AppContext, user: UserRow, requestedDeviceId?: string) => {
  const token = randomToken(SESSION_TOKEN_BYTES);
  const id = createId("sess");
  const now = isoNow();
  const maxAge = getSessionMaxAge(c.env);
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
  const userAgent = c.req.header("User-Agent") ?? null;
  const deviceId = resolveSessionDeviceId(requestedDeviceId, userAgent, id);
  const ip = c.req.header("CF-Connecting-IP");
  const ipHash = ip ? await sha256(ip) : null;

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`
    ).bind(now, user.id, deviceId),
    c.env.storage.db.prepare(
      `INSERT INTO sessions (
        id, user_id, token_hash, device_id, user_agent, ip_hash, expires_at, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, await sha256(token), deviceId, userAgent, ipHash, expiresAt, now, now),
  ]);

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

  const row = await c.env.storage.db.prepare(
    `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at, workspace_id
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
    await c.env.storage.db.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).bind(isoNow(), row.id).run();
  }

  return {
    kind: "agent",
    actorType: "agent",
    actorId: row.id,
    username: row.name,
    displayName: row.name,
    scopes: parseJsonArray(row.scopes_json),
    workspaceId: row.workspace_id,
    role: "member",
    tokenId: row.id,
  };
};

const authenticateSessionToken = async (c: AppContext, token: string, touch: boolean): Promise<AuthContext | null> => {
  const row = await c.env.storage.db.prepare(
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
    await c.env.storage.db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).bind(isoNow(), row.id).run();
  }

  const workspace = await ensureUserWorkspace(c.env.storage.db, row.user_id, row.username);

  return {
    kind: "user",
    actorType: "user",
    actorId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    scopes: [],
    workspaceId: workspace.workspaceId,
    role: workspace.role,
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

const getWorkspaceId = (c: AppContext) => c.get("auth").workspaceId;

const requireOwner = (c: AppContext) => {
  const auth = c.get("auth");
  return auth?.kind === "user" && auth.role === "owner"
    ? null
    : forbidden(c, "Only the instance owner can manage users.");
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

const mapMemoTemplate = (row: MemoTemplateRow): MemoTemplate => ({
  id: row.id,
  name: row.name,
  description: row.description,
  title: row.title,
  contentJson: parseDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  tags: parseJsonArray(row.tags_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
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

const mapJsonBackupRevision = (row: BackupRevisionRow): JsonBackupRevision => ({
  id: row.id,
  memoId: row.memo_id,
  revision: row.revision,
  title: row.title,
  tags: parseJsonArray(row.tags_json),
  contentJson: parseDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const restoreJsonNotebooks = async (db: D1Database, workspaceId: string, notebooks: JsonBackupNotebook[]) => {
  await assertIdsAvailableInWorkspace(db, "notebooks", workspaceId, notebooks.map((notebook) => notebook.id));
  const importedIds = new Set(notebooks.map((notebook) => notebook.id));
  const externalParentIds = notebooks
    .map((notebook) => notebook.parentId)
    .filter((id): id is string => Boolean(id) && !importedIds.has(id as string));
  await assertNotebookIdsInWorkspace(db, workspaceId, externalParentIds);
  const statements = notebooks.map((notebook) =>
    db.prepare(
      `INSERT INTO notebooks (
        id, workspace_id, parent_id, name, slug, icon, color, sort_order, is_deleted, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
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
    ).bind(
      notebook.id,
      workspaceId,
      notebook.parentId,
      notebook.name,
      notebook.slug,
      notebook.icon,
      notebook.color,
      notebook.sortOrder,
      notebook.createdAt,
      notebook.updatedAt
    )
  );

  await db.batch(statements);
};

const restoreJsonMemos = async (db: D1Database, workspaceId: string, backups: JsonBackupMemo[]) => {
  await assertIdsAvailableInWorkspace(db, "memos", workspaceId, backups.map((backup) => backup.memo.id));
  await assertNotebookIdsInWorkspace(db, workspaceId, backups.map((backup) => backup.memo.notebookId));
  for (const backup of backups) {
    const memo = backup.memo;
    const contentJson = parseDoc(JSON.stringify(memo.contentJson));
    const contentMarkdown = memo.contentMarkdown || docToMarkdown(contentJson);
    const contentText = docToText(contentJson);
    const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
    const title = normalizeMemoTitle(memo.title);
    const tags = normalizeTags(memo.tags);

    if (backup.revisions.some((revision) => revision.memoId !== memo.id)) {
      throw new AppError("invalid_backup", "A backup revision belongs to a different memo.", 400);
    }

    await db.batch([
      db.prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted,
          source_memo_ids, merge_source_count, merged_into_memo_id,
          created_by, updated_by, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 'restore', 'restore', ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          notebook_id = excluded.notebook_id,
          title = excluded.title,
          excerpt = excluded.excerpt,
          tags_json = excluded.tags_json,
          is_pinned = excluded.is_pinned,
          is_archived = excluded.is_archived,
          is_deleted = 0,
          source_memo_ids = excluded.source_memo_ids,
          merge_source_count = excluded.merge_source_count,
          merged_into_memo_id = NULL,
          updated_by = 'restore',
          updated_at = excluded.updated_at,
          deleted_at = NULL`
      ).bind(
        memo.id,
        workspaceId,
        memo.notebookId,
        title,
        createExcerpt(contentText),
        JSON.stringify(tags),
        memo.isPinned ? 1 : 0,
        memo.isArchived ? 1 : 0,
        JSON.stringify(memo.sourceMemoIds),
        memo.mergeSourceCount,
        memo.createdAt,
        memo.updatedAt
      ),
      db.prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memo_id) DO UPDATE SET
          content_json = excluded.content_json,
          content_markdown = excluded.content_markdown,
          content_text = excluded.content_text,
          content_hash = excluded.content_hash,
          revision = excluded.revision,
          updated_at = excluded.updated_at`
      ).bind(
        memo.id,
        JSON.stringify(contentJson),
        contentMarkdown,
        contentText,
        contentHash,
        memo.revision,
        memo.createdAt,
        memo.updatedAt
      ),
      db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(memo.id),
      db.prepare(
        `INSERT INTO memos_fts (memo_id, title, content_text, tags) VALUES (?, ?, ?, ?)`
      ).bind(memo.id, title, contentText, tags.join(" ")),
      db.prepare(`DELETE FROM memo_revisions WHERE memo_id = ?`).bind(memo.id),
    ]);

    for (let index = 0; index < backup.revisions.length; index += 50) {
      const statements = backup.revisions.slice(index, index + 50).map((revision) => {
        const revisionJson = parseDoc(JSON.stringify(revision.contentJson));
        const revisionMarkdown = revision.contentMarkdown || docToMarkdown(revisionJson);
        const revisionText = docToText(revisionJson);
        return db.prepare(
          `INSERT INTO memo_revisions (
            id, memo_id, revision, title, content_json, content_markdown,
            content_hash, created_by, created_at, tags_json, content_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            revision = excluded.revision,
            title = excluded.title,
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_hash = excluded.content_hash,
            created_by = excluded.created_by,
            created_at = excluded.created_at,
            tags_json = excluded.tags_json,
            content_text = excluded.content_text`
        ).bind(
          revision.id,
          memo.id,
          revision.revision,
          normalizeMemoTitle(revision.title),
          JSON.stringify(revisionJson),
          revisionMarkdown,
          revision.contentHash || "",
          revision.createdBy,
          revision.createdAt,
          JSON.stringify(normalizeTags(revision.tags)),
          revisionText
        );
      });
      await db.batch(statements);
    }
  }

  await audit(db, "user", null, "backup.restore", "backup", createId("restore"), {
    memoCount: backups.length,
  });
};

const assertIdsAvailableInWorkspace = async (
  db: D1Database,
  table: "notebooks" | "memos",
  workspaceId: string,
  ids: string[],
) => {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  const collision = await db.prepare(
    `SELECT id FROM ${table} WHERE workspace_id <> ? AND id IN (${placeholders}) LIMIT 1`
  ).bind(workspaceId, ...ids).first<{ id: string }>();
  if (collision) {
    throw new AppError("cross_workspace_id_conflict", "Backup contains an ID already used by another user.", 409);
  }
};

const assertNotebookIdsInWorkspace = async (db: D1Database, workspaceId: string, ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return;
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT id FROM notebooks WHERE workspace_id = ? AND id IN (${placeholders})`
  ).bind(workspaceId, ...uniqueIds).all<{ id: string }>();
  if (rows.results.length !== uniqueIds.length) {
    throw new AppError("invalid_backup_workspace", "Backup references a notebook outside the current workspace.", 400);
  }
};

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

const getApiTokenRow = async (db: D1Database, id: string, workspaceId: string): Promise<ApiTokenRow | null> =>
  db
    .prepare(
      `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at, workspace_id
       FROM api_tokens
       WHERE id = ? AND workspace_id = ?`
    )
    .bind(id, workspaceId)
    .first<ApiTokenRow>();

const listNotebooks = async (db: D1Database, workspaceId: string): Promise<Notebook[]> => {
  const rows = await db
    .prepare(
      notebookSelectSql(
        `WHERE n.workspace_id = ? AND n.is_deleted = 0
         GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at
         ORDER BY n.parent_id IS NOT NULL, n.sort_order ASC, n.name ASC`
      )
    )
    .bind(workspaceId).all<NotebookRow>();

  return rows.results.map(mapNotebook);
};

const listTagSummaries = async (db: D1Database, workspaceId: string): Promise<TagSummary[]> => {
  const rows = await db
    .prepare(
      `SELECT json_each.value AS name,
              COUNT(DISTINCT m.id) AS memo_count,
              MAX(m.updated_at) AS updated_at
       FROM memos m, json_each(m.tags_json)
       WHERE m.workspace_id = ? AND m.is_deleted = 0
         AND trim(json_each.value) <> ''
       GROUP BY json_each.value
       ORDER BY lower(json_each.value) ASC`
    )
    .bind(workspaceId).all<TagSummaryRow>();

  return rows.results
    .filter((row) => typeof row.name === "string" && row.name.trim())
    .map(mapTagSummary);
};

const updateTagAcrossMemos = async (
  db: D1Database,
  workspaceId: string,
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
       WHERE m.workspace_id = ? AND m.is_deleted = 0
         AND EXISTS (
           SELECT 1
           FROM json_each(m.tags_json)
           WHERE json_each.value = ?
         )`
    )
    .bind(workspaceId, normalizedOld)
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
           WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
        )
        .bind(JSON.stringify(nextTags), actorLabel, now, row.id, workspaceId),
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

const previewTagRename = async (db: D1Database, workspaceId: string, oldTag: string, nextTag: string | null) => {
  const normalizedOld = normalizeTags([oldTag])[0];
  const normalizedNext = nextTag === null ? null : normalizeTags([nextTag])[0];

  if (!normalizedOld || normalizedOld === normalizedNext) {
    return { dryRun: true, updated: 0, changes: [] };
  }

  const rows = await getMemoRowsByTag(db, workspaceId, normalizedOld);
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

const getMemoRowsByTag = async (db: D1Database, workspaceId: string, tag: string) => {
  const rows = await db
    .prepare(
      `SELECT m.id, m.title, m.tags_json, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = 0
         AND EXISTS (
           SELECT 1
           FROM json_each(m.tags_json)
           WHERE json_each.value = ?
         )`
    )
    .bind(workspaceId, tag)
    .all<MemoTagUpdateRow>();

  return rows.results;
};

const updateTagsForMemos = async (
  db: D1Database,
  input: {
    workspaceId: string;
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
       WHERE m.workspace_id = ? AND m.is_deleted = 0 AND m.id IN (${placeholders})`
    )
    .bind(input.workspaceId, ...memoIds)
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
           WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
        )
        .bind(JSON.stringify(change.nextTags), input.actorLabel, now, change.memoId, input.workspaceId),
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
    workspaceId: string;
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
  const filters = ["m.workspace_id = ?", "m.is_deleted = 0"];
  const binds: unknown[] = [options.workspaceId];

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
  options: { workspaceId: string; notebookId?: string | null; limit: number; offset: number; includeContent: boolean; includeDeleted: boolean }
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
         WHERE m.workspace_id = ? AND ${deletedFilter}
           AND (? IS NULL OR m.notebook_id = ?)
         ORDER BY m.updated_at DESC, m.id ASC
         LIMIT ? OFFSET ?`
      )
      .bind(options.workspaceId, notebookId, notebookId, pageSize, offset)
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
       WHERE m.workspace_id = ? AND ${deletedFilter}
         AND (? IS NULL OR m.notebook_id = ?)
       ORDER BY m.updated_at DESC, m.id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(options.workspaceId, notebookId, notebookId, pageSize, offset)
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

const getNotebook = async (db: D1Database, workspaceId: string, id: string): Promise<Notebook | null> => {
  const row = await db
    .prepare(
      notebookSelectSql(
        `WHERE n.id = ? AND n.workspace_id = ? AND n.is_deleted = 0
         GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at`
      )
    )
    .bind(id, workspaceId)
    .first<NotebookRow>();

  return row ? mapNotebook(row) : null;
};

const createNotebookRecord = async (
  db: D1Database,
  workspaceId: string,
  input: NotebookCreateInput & { sortOrder?: number },
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const parentId = input.parentId ?? null;

  if (parentId && !(await getNotebook(db, workspaceId, parentId))) {
    throw new AppError("not_found", "Parent notebook not found", 404);
  }

  const id = createId("nb");
  const now = isoNow();
  const sortOrder = input.sortOrder ?? Date.now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, workspaceId, parentId, input.name, slugify(input.name), sortOrder, now, now),
    auditStatement(db, actor.actorType, actor.actorId, "notebook.create", "notebook", id, {
      name: input.name,
      parentId,
      sortOrder,
    }),
  ]);

  const notebook = await getNotebook(db, workspaceId, id);

  if (!notebook) {
    throw new AppError("not_found", "Notebook not found after create", 404);
  }

  return notebook;
};

const updateNotebookRecord = async (
  db: D1Database,
  workspaceId: string,
  id: string,
  input: { name?: string; parentId?: string | null; sortOrder?: number },
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const current = await getNotebook(db, workspaceId, id);

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
    const parent = await getNotebook(db, workspaceId, nextParentId);

    if (!parent) {
      throw new AppError("not_found", "Parent notebook not found", 404);
    }

    if (await isNotebookDescendant(db, workspaceId, nextParentId, id)) {
      throw new AppError("notebook_cycle", "Notebook cannot be moved into its own descendant.", 409);
    }
  }

  await db.batch([
    db
      .prepare(
        `UPDATE notebooks
         SET name = ?, slug = ?, parent_id = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
      )
      .bind(nextName, slugify(nextName), nextParentId ?? null, nextSortOrder, now, id, workspaceId),
    auditStatement(db, actor.actorType, actor.actorId, "notebook.update", "notebook", id, input),
  ]);

  const notebook = await getNotebook(db, workspaceId, id);

  if (!notebook) {
    throw new AppError("not_found", "Notebook not found after update", 404);
  }

  return notebook;
};

const isNotebookDescendant = async (db: D1Database, workspaceId: string, candidateId: string, ancestorId: string) => {
  const row = await db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id
         FROM notebooks
         WHERE workspace_id = ? AND parent_id = ? AND is_deleted = 0

         UNION ALL

         SELECT n.id
         FROM notebooks n
         INNER JOIN descendants d ON n.parent_id = d.id
         WHERE n.workspace_id = ? AND n.is_deleted = 0
       )
       SELECT id
       FROM descendants
       WHERE id = ?
       LIMIT 1`
    )
    .bind(workspaceId, ancestorId, workspaceId, candidateId)
    .first<{ id: string }>();

  return Boolean(row);
};

const getMemoDetailRow = async (
  db: D1Database,
  workspaceId: string,
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
       WHERE m.id = ? AND m.workspace_id = ? AND (? = 1 OR m.is_deleted = 0)`
    )
    .bind(id, workspaceId, includeDeleted ? 1 : 0)
    .first<MemoDetailRow>();

const getMemoDetail = async (db: D1Database, workspaceId: string, id: string, includeDeleted = false): Promise<MemoDetail | null> => {
  const row = await getMemoDetailRow(db, workspaceId, id, includeDeleted);
  return row ? mapMemoDetail(row) : null;
};

const getMemoTemplateRow = async (db: D1Database, workspaceId: string, id: string): Promise<MemoTemplateRow | null> =>
  db.prepare(
    `SELECT id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
     FROM memo_templates
     WHERE id = ? AND workspace_id = ?`
  ).bind(id, workspaceId).first<MemoTemplateRow>();

const getMemoTemplate = async (db: D1Database, workspaceId: string, id: string): Promise<MemoTemplate | null> => {
  const row = await getMemoTemplateRow(db, workspaceId, id);
  return row ? mapMemoTemplate(row) : null;
};

const deleteMemosRecord = async (
  db: D1Database,
  resourcesBucket: R2Bucket,
  workspaceId: string,
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
       WHERE workspace_id = ? AND is_deleted = ? AND id IN (${placeholders})`
    )
    .bind(workspaceId, expectedDeletedState, ...uniqueMemoIds)
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
      db.prepare(`DELETE FROM memos WHERE workspace_id = ? AND is_deleted = 1 AND id IN (${placeholders})`).bind(workspaceId, ...uniqueMemoIds)
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
           WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
        )
        .bind(now, now, workspaceId, ...uniqueMemoIds),
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

const getMemosForBulkAction = async (db: D1Database, workspaceId: string, memoIds: string[], deletedState: 0 | 1) => {
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
       WHERE m.workspace_id = ? AND m.is_deleted = ?
         AND m.id IN (${placeholders})
       ORDER BY m.updated_at DESC, m.id ASC`
    )
    .bind(workspaceId, deletedState, ...uniqueMemoIds)
    .all<MemoSummaryRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be found for this action in the expected state.", 400);
  }

  return rows.results.map(mapMemoSummary);
};

const restoreMemosRecord = async (
  db: D1Database,
  workspaceId: string,
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
       WHERE m.workspace_id = ? AND m.is_deleted = 1 AND m.id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<{ id: string; notebook_id: string; title: string | null; tags_json: string; content_text: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be restored.", 400);
  }

  const notebookIds = Array.from(new Set(rows.results.map((row) => row.notebook_id)));
  const notebookPlaceholders = notebookIds.map(() => "?").join(", ");
  const notebookRows = await db
    .prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${notebookPlaceholders})`)
    .bind(workspaceId, ...notebookIds)
    .all<{ id: string }>();
  const activeNotebookIds = new Set(notebookRows.results.map((row) => row.id));

  const needsInbox = rows.results.some((row) => !activeNotebookIds.has(row.notebook_id));

  const inbox = needsInbox
    ? await db.prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND slug = 'inbox' AND is_deleted = 0 LIMIT 1`).bind(workspaceId).first<{ id: string }>()
    : null;
  if (needsInbox && !inbox) {
    throw new AppError("restore_notebook_missing", "Original notebooks were deleted and the default inbox is unavailable.", 409);
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [];

  for (const row of rows.results) {
    const restoreNotebookId = activeNotebookIds.has(row.notebook_id) ? row.notebook_id : inbox!.id;
    const tags = parseJsonArray(row.tags_json);

    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET notebook_id = ?, is_deleted = 0, deleted_at = NULL, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND is_deleted = 1`
        )
        .bind(restoreNotebookId, now, row.id, workspaceId),
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
  workspaceId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 1`
    )
    .bind(workspaceId).first<{ count: number }>();
  const deleted = countRow?.count ?? 0;

  if (deleted === 0) {
    return 0;
  }

  const resourceRows = await db
    .prepare(
      `SELECT r.object_key
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND m.is_deleted = 1`
    )
    .bind(workspaceId).all<{ object_key: string }>();
  const objectKeys = resourceRows.results.map((resource) => resource.object_key);

  if (objectKeys.length > 0) {
    await resourcesBucket.delete(objectKeys);
  }

  await db.batch([
    db.prepare(`DELETE FROM memos_fts WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`UPDATE resources SET original_memo_id = NULL WHERE original_memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM resources WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memo_revisions WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memos WHERE workspace_id = ? AND is_deleted = 1`).bind(workspaceId),
    auditStatement(db, actor.actorType, actor.actorId, "memo.trash_empty", "trash", "memos", { deleted }),
  ]);

  return deleted;
};

const isDemoMode = (env: Bindings) => isDemoModeEnabled(env.EDGE_EVER_DEMO_MODE);
const isLocalDemoSeedEnabled = (env: Bindings) =>
  env.EDGE_EVER_LOCAL_DEMO_SEED?.trim().toLowerCase() === "true";

let localDemoSeedPromise: Promise<void> | null = null;

const ensureLocalDemoSeed = (env: Bindings) => {
  localDemoSeedPromise ??= (async () => {
    const memoPlaceholders = DEMO_SEED_MEMO_IDS.map(() => "?").join(", ");
    await env.storage.db.batch([
      env.storage.db.prepare(`DELETE FROM mobile_sync_changes`),
      env.storage.db.prepare(`DELETE FROM memos_fts`),
      env.storage.db.prepare(`DELETE FROM resources`),
      env.storage.db.prepare(`DELETE FROM memo_revisions`),
      env.storage.db.prepare(`DELETE FROM memo_contents WHERE memo_id NOT IN (${memoPlaceholders})`).bind(...DEMO_SEED_MEMO_IDS),
      env.storage.db.prepare(`DELETE FROM memos WHERE id NOT IN (${memoPlaceholders})`).bind(...DEMO_SEED_MEMO_IDS),
    ]);

    await ensureDemoSeed(env, { overwriteExisting: true, refreshResources: true });
    await audit(env.storage.db, "system", null, "demo.local_seed", "demo", "edgeever-local", {
      seedMemoCount: DEMO_SEED_MEMOS.length,
      mode: "sync-seed",
    });
  })().catch((error) => {
    localDemoSeedPromise = null;
    throw error;
  });

  return localDemoSeedPromise;
};

const ensureDemoSeed = async (
  env: Bindings,
  options: { overwriteExisting?: boolean; refreshResources?: boolean } = {},
) => {
  const db = env.storage.db;
  const now = isoNow();
  const statements: D1PreparedStatement[] = [];
  const bucketName = env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME;
  const overwriteExisting = options.overwriteExisting === true;
  const existingNotebookIds = overwriteExisting
    ? new Set<string>()
    : new Set(
        (
          await db
            .prepare(`SELECT id FROM notebooks WHERE id IN (${DEMO_SEED_NOTEBOOK_IDS.map(() => "?").join(", ")})`)
            .bind(...DEMO_SEED_NOTEBOOK_IDS)
            .all<{ id: string }>()
        ).results.map((notebook) => notebook.id),
      );
  const existingMemoIds = overwriteExisting
    ? new Set<string>()
    : new Set(
        (
          await db
            .prepare(`SELECT id FROM memos WHERE id IN (${DEMO_SEED_MEMO_IDS.map(() => "?").join(", ")})`)
            .bind(...DEMO_SEED_MEMO_IDS)
            .all<{ id: string }>()
        ).results.map((memo) => memo.id),
      );

  for (const notebook of DEMO_SEED_NOTEBOOKS) {
    if (!shouldUpsertDemoSeedRecord(existingNotebookIds, notebook.id, overwriteExisting)) {
      continue;
    }

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
    const isOverviewSeedMemo = memo.id === "memo_demo_overview" || memo.id === "memo_demo_overview_en";
    if (!overwriteExisting && !isOverviewSeedMemo && existingMemoIds.has(memo.id)) {
      continue;
    }

    const contentJson = markdownToDoc(memo.markdown);
    const applyDemoImageWidths = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.type === "image") {
          node.attrs = { ...node.attrs, width: 35 };
        }
        if (Array.isArray(node.content)) {
          applyDemoImageWidths(node.content);
        }
      }
    };
    if (Array.isArray(contentJson.content)) {
      applyDemoImageWidths(contentJson.content);
    }
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(memo_id) DO UPDATE SET
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_text = excluded.content_text,
            content_hash = excluded.content_hash,
            revision = excluded.revision,
            updated_at = excluded.updated_at`
        )
        .bind(
          memo.id,
          JSON.stringify(contentJson),
          memo.markdown,
          contentText,
          contentHash,
          "revision" in memo ? memo.revision : 0,
          now,
          now,
        ),
      db.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(memo.id),
      db
        .prepare(
          `INSERT INTO memos_fts (memo_id, title, content_text, tags)
           VALUES (?, ?, ?, ?)`
        )
        .bind(memo.id, memo.title, contentText, memo.tags.join(" "))
    );
  }

  for (const revision of DEMO_SEED_REVISIONS) {
    const contentJson = markdownToDoc(revision.markdown);
    const contentHash = await sha256(revision.markdown + JSON.stringify(contentJson));

    statements.push(
      db
        .prepare(
          `INSERT INTO memo_revisions (
            id, memo_id, revision, title, content_json, content_markdown, content_hash,
            created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'system', ?)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            revision = excluded.revision,
            title = excluded.title,
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_hash = excluded.content_hash`
        )
        .bind(
          revision.id,
          revision.memoId,
          revision.revision,
          revision.title,
          JSON.stringify(contentJson),
          revision.markdown,
          contentHash,
          now,
        ),
    );
  }

  const existingResourceIds = options.refreshResources || overwriteExisting
    ? new Set<string>()
    : new Set(
        (
          await db
            .prepare(`SELECT id FROM resources WHERE id IN (${DEMO_SEED_ATTACHMENT_RESOURCES.map(() => "?").join(", ")})`)
            .bind(...DEMO_SEED_ATTACHMENT_RESOURCES.map((resource) => resource.id))
            .all<{ id: string }>()
        ).results.map((resource) => resource.id)
      );

  for (const resource of DEMO_SEED_ATTACHMENT_RESOURCES) {
    if (!shouldUpsertDemoSeedRecord(existingResourceIds, resource.id, overwriteExisting)) {
      continue;
    }

    const isImageSeed = "svg" in resource;
    const bytes = isImageSeed ? new TextEncoder().encode(resource.svg) : decodeDemoAttachment(resource);
    const extension = isImageSeed ? "svg" : resource.filename.split(".").pop() || "bin";
    const objectKey = `demo/${resource.memoId}/${resource.id}.${extension}`;

    if (options.refreshResources || !existingResourceIds.has(resource.id)) {
      await env.storage.resources.put(objectKey, bytes, {
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            bucket_name = excluded.bucket_name,
            object_key = excluded.object_key,
            kind = excluded.kind,
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
          isImageSeed ? "image" : "attachment",
          resource.mimeType,
          resource.filename,
          bytes.byteLength,
          await sha256Bytes(bytes),
          isImageSeed ? resource.width : null,
          isImageSeed ? resource.height : null,
          JSON.stringify({ source: "demo-seed" }),
          now,
          now
        )
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
};

const resetDemoData = async (
  env: Bindings,
  scheduledTime: number,
  options: { resetCredentials?: boolean } = {}
) => {
  const db = env.storage.db;
  const now = isoNow();
  const demoUsername = env.EDGE_EVER_AUTH_USERNAME?.trim() || "admin";
  const demoPasswordHash = await resolveDemoPasswordHash(
    env.EDGE_EVER_AUTH_PASSWORD,
    env.EDGE_EVER_AUTH_PASSWORD_HASH,
    hashPassword,
  );
  const resourceRows = await db.prepare(`SELECT object_key FROM resources`).all<{ object_key: string }>();
  const objectKeys = resourceRows.results.map((resource) => resource.object_key);

  for (let index = 0; index < objectKeys.length; index += 1000) {
    await env.storage.resources.delete(objectKeys.slice(index, index + 1000));
  }

  const resetStatements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM mobile_sync_changes`),
    db.prepare(`DELETE FROM memos_fts`),
    db.prepare(`DELETE FROM resources`),
    db.prepare(`DELETE FROM memo_revisions`),
    db.prepare(`DELETE FROM memo_contents`),
    db.prepare(`DELETE FROM memos`),
    db.prepare(`UPDATE notebooks SET parent_id = NULL`),
    db.prepare(`DELETE FROM notebooks`),
    db.prepare(`DELETE FROM api_tokens`),
    db.prepare(`DELETE FROM audit_events`),
  ];

  if (options.resetCredentials && demoPasswordHash) {
    resetStatements.push(
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ? AND is_disabled = 0`)
        .bind(demoPasswordHash, now, demoUsername),
      db.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE user_id IN (SELECT id FROM users WHERE username = ? AND is_disabled = 0)
           AND revoked_at IS NULL`
      ).bind(now, demoUsername),
    );
  }

  await db.batch(resetStatements);

  await ensureDemoSeed(env, { overwriteExisting: true, refreshResources: true });
  await audit(db, "system", null, "demo.reset", "demo", "edgeever-demo", {
    scheduledTime: new Date(scheduledTime).toISOString(),
    seedMemoCount: DEMO_SEED_MEMOS.length,
  });
};

const moveMemosToNotebook = async (
  db: D1Database,
  workspaceId: string,
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
       WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
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
         WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
      )
      .bind(notebookId, actorLabel, now, workspaceId, ...uniqueMemoIds),
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
  workspaceId: string,
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
       WHERE m.workspace_id = ? AND m.is_deleted = 0 AND m.id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<MemoDetailRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be merged.", 400);
  }

  if (input.notebookId && !(await getNotebook(db, workspaceId, input.notebookId))) {
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
          id, workspace_id, notebook_id, title, excerpt, tags_json, source_memo_ids, merge_source_count,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newMemoId,
        workspaceId,
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
         WHERE workspace_id = ? AND id IN (${placeholders})`
      )
      .bind(now, newMemoId, now, now, workspaceId, ...uniqueMemoIds),
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

  const memo = await getMemoDetail(db, workspaceId, newMemoId);

  if (!memo) {
    throw new AppError("not_found", "Merged memo not found after create.", 404);
  }

  return memo;
};

const createMemoRecord = async (
  db: D1Database,
  workspaceId: string,
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
          id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
        ) SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ? FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
      )
      .bind(id, workspaceId, title, excerpt, JSON.stringify(tags), actorLabel, actorLabel, createdAt, updatedAt, input.notebookId, workspaceId),
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

  const memo = await getMemoDetail(db, workspaceId, id);

  if (!memo) {
    throw new Error("Memo was created but could not be read.");
  }

  return memo;
};

const updateMemoRecord = async (
  db: D1Database,
  workspaceId: string,
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
  const current = await getMemoDetailRow(db, workspaceId, id);

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
      const memo = await getMemoDetail(db, workspaceId, id);

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
           WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
        )
        .bind(isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id, workspaceId),
      auditStatement(db, actor.actorType, actor.actorId, isPinned ? "memo.pin" : "memo.unpin", "memo", id, {}),
    ]);

    const memo = await getMemoDetail(db, workspaceId, id);

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
         WHERE id = ? AND workspace_id = ? AND is_deleted = 0
           AND EXISTS (SELECT 1 FROM notebooks n WHERE n.id = ? AND n.workspace_id = ? AND n.is_deleted = 0)`
      )
      .bind(notebookId, title, excerpt, JSON.stringify(tags), isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id, workspaceId, notebookId, workspaceId),
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

  const memo = await getMemoDetail(db, workspaceId, id);

  if (!memo) {
    return { error: "not_found", message: "Memo not found after update" };
  }

  return { memo };
};

const getMemoRevisionRow = async (
  db: D1Database,
  workspaceId: string,
  memoId: string,
  revisionId: string
): Promise<MemoRevisionRow | null> =>
  db
    .prepare(
      `SELECT mr.id, mr.memo_id, mr.revision, mr.title, mr.tags_json, mr.content_json, mr.content_markdown,
              mr.content_text, mr.content_hash, mr.created_by, mr.created_at
       FROM memo_revisions mr
       INNER JOIN memos m ON m.id = mr.memo_id
       WHERE mr.id = ? AND mr.memo_id = ? AND m.workspace_id = ?`
    )
    .bind(revisionId, memoId, workspaceId)
    .first<MemoRevisionRow>();

const listMemoRevisions = async (db: D1Database, workspaceId: string, memoId: string, limit: number): Promise<MemoRevision[]> => {
  const memo = await getMemoDetail(db, workspaceId, memoId, true);

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
  workspaceId: string,
  memoId: string,
  revisionId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const current = await getMemoDetailRow(db, workspaceId, memoId);

  if (!current) {
    throw new AppError("not_found", "Memo not found", 404);
  }

  const revision = await getMemoRevisionRow(db, workspaceId, memoId, revisionId);

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
         WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
      )
      .bind(title, excerpt, JSON.stringify(tags), actorLabel, now, memoId, workspaceId),
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

  const memo = await getMemoDetail(db, workspaceId, memoId);

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

const getResourceRow = async (db: D1Database, workspaceId: string, id: string): Promise<ResourceRow | null> =>
  db
    .prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.id = ? AND m.workspace_id = ? AND r.is_deleted = 0`
    )
    .bind(id, workspaceId)
    .first<ResourceRow>();

const getResourceRowsForMemo = async (db: D1Database, workspaceId: string, memoId: string): Promise<ResourceRow[]> => {
  const rows = await db
    .prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.memo_id = ? AND m.workspace_id = ?`
    )
    .bind(memoId, workspaceId)
    .all<ResourceRow>();

  return rows.results;
};

const listResourcesForMemo = async (db: D1Database, workspaceId: string, memoId: string): Promise<Resource[]> => {
  const rows = await db
    .prepare(
      `SELECT id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type,
              filename, byte_size, sha256, width, height, created_at, updated_at
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.memo_id = ? AND m.workspace_id = ? AND r.is_deleted = 0
       ORDER BY r.created_at ASC, r.id ASC`
    )
    .bind(memoId, workspaceId)
    .all<ResourceRow>();

  return rows.results.map(mapResource);
};

const listResourcesForMcp = async (db: D1Database, workspaceId: string, limit: number) => {
  const [rows, stats] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.kind,
                r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height,
                r.created_at, r.updated_at, m.title AS memo_title, m.excerpt AS memo_excerpt,
                m.is_deleted AS memo_is_deleted
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0
         ORDER BY r.created_at DESC
         LIMIT ?`
      )
      .bind(workspaceId, limit)
      .all<ResourceListRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0`
      )
      .bind(workspaceId).first<ResourceStatsRow>(),
  ]);

  return {
    resources: rows.results.map(mapResourceListItem),
    summary: mapResourceStorageSummary(stats),
  };
};

const getWorkspaceStats = async (db: D1Database, workspaceId: string) => {
  const [memoCounts, notebookCount, tagCount, resourceStats] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END), 0) AS active,
           COALESCE(SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END), 0) AS trashed,
           COALESCE(SUM(CASE WHEN is_deleted = 0 AND is_pinned = 1 THEN 1 ELSE 0 END), 0) AS pinned,
           COALESCE(SUM(CASE WHEN is_deleted = 0 AND tags_json = '[]' THEN 1 ELSE 0 END), 0) AS untagged
         FROM memos WHERE workspace_id = ?`
      )
      .bind(workspaceId).first<{ total: number; active: number; trashed: number; pinned: number; untagged: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM notebooks WHERE workspace_id = ? AND is_deleted = 0`).bind(workspaceId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT json_each.value) AS count
         FROM memos m, json_each(m.tags_json)
         WHERE m.workspace_id = ? AND m.is_deleted = 0 AND trim(json_each.value) <> ''`
      )
      .bind(workspaceId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0`
      )
      .bind(workspaceId).first<ResourceStatsRow>(),
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

const contentDispositionAttachment = (filename: string | null) => {
  if (!filename) {
    return "attachment";
  }

  const fallback = normalizeFilename(filename).replace(/"/g, "'");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
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

const authNotConfigured = (c: Context) =>
  apiError(
    c,
    "auth_not_configured",
    "Authentication is not configured. Set EDGE_EVER_AUTH_PASSWORD as a Worker Secret and redeploy.",
    503,
  );

const databaseNotReady = (c: Context) =>
  apiError(
    c,
    "database_not_ready",
    "Database is not ready. Bind the D1 database as DB and apply the remote migrations.",
    503,
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
