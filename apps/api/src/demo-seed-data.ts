import {
  decodeDemoAttachment,
  DEMO_ATTACHMENT_MARKDOWN_EN,
  DEMO_ATTACHMENT_MARKDOWN_ZH,
  DEMO_ATTACHMENT_RESOURCES,
} from "./demo-attachments";

export { decodeDemoAttachment };

export const DEMO_SEED_NOTEBOOKS = [
  { id: "nb_inbox", parentId: null, name: "等待分类", slug: "inbox", icon: "notebook", color: "#0f766e", sortOrder: 10 },
  { id: "nb_projects", parentId: null, name: "工作项目", slug: "work-projects", icon: "notebook", color: "#2563eb", sortOrder: 20 },
  { id: "nb_learning", parentId: null, name: "学习资料", slug: "learning-resources", icon: "notebook", color: "#7c3aed", sortOrder: 30 },
  { id: "nb_creative", parentId: null, name: "灵感创作", slug: "creative-ideas", icon: "notebook", color: "#db2777", sortOrder: 40 },
  { id: "nb_personal", parentId: null, name: "生活个人", slug: "personal-life", icon: "notebook", color: "#ea580c", sortOrder: 50 },
  { id: "nb_demo_features", parentId: "nb_projects", name: "功能演示", slug: "demo-features", icon: "notebook", color: "#0891b2", sortOrder: 21 },
  { id: "nb_demo_features_en", parentId: "nb_projects", name: "Feature Demos", slug: "feature-demos", icon: "notebook", color: "#0e7490", sortOrder: 22 },
];
export const DEMO_SEED_MEMOS_ZH = [
  {
    id: "memo_demo_overview",
    notebookId: "nb_demo_features",
    title: "🌟 欢迎使用 EdgeEver",
    tags: ["overview", "features", "demo"],
    isPinned: true,
    markdown:
      "## 🚀 开启您的 EdgeEver 笔记之旅\n\n> **EdgeEver** 是一款专为极客与创作者打造的现代开源 Serverless 个人知识库。它找回了经典的**印象笔记三栏式双视图布局**，以 Cloudflare 免费额度提供 **100% 免费**的自建云端，数据完全掌控，并原生集成 AI Agent (MCP) 接口。\n\n---\n\n### ⚡ 1. 核心产品特性对比\n\n*提示：在线模式下点击表格单元格可以直接修改文本；右键可快捷操作行列。*\n\n| 核心维度 | 传统云笔记 (如 Evernote) | 本地知识库 (如 Obsidian) | EdgeEver 极客笔记 |\n| :--- | :--- | :--- | :--- |\n| **云端托管成本** | 商业订阅高昂 ($10+/月) | 官方同步收费 ($5/月) | **100% 免费 (Cloudflare 免费额度)** |\n| **数据与隐私** | 封闭平台，导出受限 | 本地文件，同步需配置 | **完全掌控 (D1 SQLite 数据库 / R2 / WebDAV)** |\n| **编辑体验** | 富文本编辑 | 纯 Markdown | **双视图自由切换 (富文本 / Markdown 源码)** |\n| **多端支持** | 限制设备数量 | 移动端配置繁琐 | **Web / PWA / Android / macOS / iOS (审核中)** |\n| **创作者排版** | 无优化，格式易乱 | 需借助外部工具 | **微信公众号、Substack 一键富文本格式复制** |\n| **AI 原生集成** | 限制/仅特定付费版本 | 需繁琐的第三方插件 | **原生支持 MCP 协议与标准 OpenAPI** |\n\n---\n\n### 🎨 2. 沉浸式写作与排版美学\n\nEdgeEver 追求极致的创作体验，将设计美学融于字里行间：\n\n- **双视图编辑器**：点击右上角 `</>` 按钮，可在**所见即所得富文本**与 **Markdown 源码**间无缝切换，格式完全兼容。\n- **左侧可折叠大纲**：提供固定或折叠的大纲目录视图，支持点击标题平滑滚动定位，助您轻松掌控长文结构。\n- **8+ 款精致编辑器主题**：可在 **个人中心 / 设置** 中一键切换如 `WeChat Classic Green (微信经典绿)`、`Modern Mint (薄荷青)`、`minimal-emerald (极简祖母绿)` 等排版风格。\n- **自媒体一键排版复制**：专为创作者设计。点击右上角“复制到公众号”按钮，系统会自动将笔记转化为带行内样式的公众号美化格式，直接粘贴至微信公众号、Substack 或 WordPress 后台，排版与代码高亮完美保真。\n- **列表缩进与快捷操作**：支持快捷缩进列表，双击或选中文本可通过快捷键快速关联已有笔记。\n\n---\n\n### 📝 3. 模板中心与单篇导出\n\n- **可视化推荐模板库**：内置多种精美模板，点击即可弹窗预览。支持在当前笔记本中一键套用模板创建笔记，并支持一键返回列表。\n- **用户自定义模板**：您可以将常用笔记结构保存为自定义模板，实现效率翻倍。\n- **单篇便捷导出**：支持将当前笔记一键导出为标准的 `.md` Markdown 文件或排版优美的 `.pdf` 电子文档，便于独立归档与分发。\n\n---\n\n### 📊 4. 原生 Mermaid 动态图表渲染\n\n在代码块中使用 `mermaid` 标记，即可实时渲染高保真的动态逻辑图。支持多款**精致图表主题**选择，且微信复制时尺寸完美兼容：\n\n#### 1️⃣ 架构流程图 (Flowchart)\n```mermaid\nflowchart TD\n    subgraph Client[\"📱 客户端生态\"]\n        A[\"Web / PWA 浏览器\"]\n        B[\"macOS / Android / iOS 客户端\"]\n    end\n\n    subgraph Backend[\"⚡ Cloudflare Serverless\"]\n        C[\"Cloudflare Workers API\"]\n        D[(\"D1 SQLite 数据库\")]\n        E[(\"R2 资源存储\")]\n    end\n\n    A & B --> C\n    C <--> D & E\n```\n\n#### 2️⃣ 交互时序图 (Sequence Diagram)\n```mermaid\nsequenceDiagram\n    autonumber\n    actor User as 用户\n    participant App as 客户端 App\n    participant Worker as Cloudflare Worker API\n    participant D1 as D1 数据库\n\n    User->>App: 编辑并保存笔记\n    App->>Worker: POST /api/v1/memos (提交更改)\n    Worker->>D1: 写入笔记 & 更新修订版本\n    D1-->>Worker: 返回成功 (revision + 1)\n    Worker-->>App: 200 OK (同步最新游标)\n    App-->>User: 界面显示「已保存」\n```\n\n---\n\n### 📁 5. 多端覆盖、自动同步与剪藏\n\n- **全平台多端覆盖**：已发布 Web、Android 原生 App 以及 macOS 桌面端（支持 Apple Silicon 和 Intel Mac），iOS 客户端正在 App Store 审核中。\n- **网页裁剪器 (Web Clipper)**：已上架 Chrome, Edge 和 Firefox 插件商店，支持一键剪藏网页。\n- **微信文章一键剪藏**：在手机上直接将微信公众号文章分享至 EdgeEver App，系统将智能提取正文并保存为可编辑笔记。\n- **离线草稿与同步队列**：无网环境下自动保存本地，恢复连线后自动入队同步；支持在设置中灵活配置自动同步间隔。\n\n---\n\n### 🖼️ 6. 多媒体集成与图片前端压缩\n\n支持直接拖拽或粘贴插入图片与文件附件。本地浏览器会在上传前自动对图片进行 WebP 高保真压缩，缩减 **50% - 90%** 的体积，大幅加快加载速度并节省您的云端存储空间。\n\n![EdgeEver 极客猫猫](/api/v1/resources/res_demo_cat_image/blob)\n\n---\n\n### 🤖 7. 面向 AI Agent 的原生生态\n\nEdgeEver 走在 AI 时代前沿，为 AI 协作者提供了原生支持：\n\n1. **REST API**：提供标准的 OpenAPI 接口，接口定义见 `/api/openapi.json`。\n2. **MCP (Model Context Protocol) 接口**：内置 MCP 服务端点 `/mcp`。像 Antigravity, Claude Code, Cursor 等 AI Agent 可以直接连接并安全地读写您的笔记库，实现笔记自动整理、标签归纳与双向联动。\n\n---\n\n### 🔒 8. 个人空间隔离与安全分享\n\n- **多账号与管理员中心**：支持多账号独立登录，数据物理隔离。系统提供防暴力破解的安全防护。\n- **多活跃设备管理**：个人设置中可直观查看当前账户在哪些设备登录，并可随时强制下线其他设备。\n- **可撤销的公开分享**：支持生成单独笔记的公开分享链接（列表及正文顶部可直观感知分享状态），他人无需登录即可查阅最新内容，您也可以随时关闭分享。\n\n---\n\n> 🎯 **快速探索建议**：\n> - 试试点击右上角的**微信图标**，将排版精美的富文本直接粘贴至公众号或 WordPress 后台；\n> - 试试在 **个人中心 / 设置 / 编辑器主题** 中切换您喜爱的写作风格；\n> - 按下 `Cmd/Ctrl + Shift + F` 开启 Zen 专注模式，享受无干扰的写作空间；\n> - 鼠标拖拽左侧的笔记本，体验无限层级目录的顺滑管理；\n> - 在个人中心或侧边栏点击“恢复 Demo 数据”，即可随时一键将整个演示环境恢复如初。"
  },
];
export const DEMO_SEED_REVISIONS = [
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
export const DEMO_MEMO_ENGLISH = {
  memo_demo_overview: {
    title: "🌟 Welcome to EdgeEver",
    markdown:
      "## 🚀 Get Started with EdgeEver: The Geek's Knowledge Base\n\n> **EdgeEver** is a modern, open-source, serverless personal knowledge base built for geeks and creators. It restores the classic **Evernote-style three-pane layout**, while offering **100% free hosting** using Cloudflare's free tier, full data ownership, dual-view editing, and native AI Agent (MCP) integration.\n\n---\n\n### ⚡ 1. Feature Comparison\n\n*Tip: Click any cell in the table below to edit directly; right-click in editor mode to insert/delete rows or columns.*\n\n| Metric | Traditional Cloud Notes (e.g. Evernote) | Local Offline Notes (e.g. Obsidian) | EdgeEver Notes |\n| :--- | :--- | :--- | :--- |\n| **Hosting Cost** | High monthly fee ($10+/mo) | Official sync fee ($5/mo) | **100% Free (Cloudflare Free Tier)** |\n| **Data & Privacy** | Closed platform, locked export | Local files, sync needs setup | **Full Ownership (D1 SQLite, R2, WebDAV)** |\n| **Editing Mode** | Rich Text | Pure Markdown | **Seamless Dual-View Toggle (Rich Text / MD)** |\n| **Device Sync** | Limits active devices | Complicated mobile setup | **Web / PWA / Android / macOS / iOS (In Review)** |\n| **For Creators** | No formatting optimizations | Requires 3rd-party tools | **One-Click Rich Copy for WeChat & Substack** |\n| **AI Integration**| Paid/Limited versions only | Requires heavy plugin config | **Native MCP Protocol & Standard OpenAPI** |\n\n---\n\n### 🎨 2. Immersive Writing & Typography Aesthetics\n\nEdgeEver is crafted to provide a distraction-free and beautiful writing experience:\n\n- **Seamless Dual-View Editor**: Click the `</>` button in the top right to switch effortlessly between **WYSIWYG Rich Text** and **Markdown Source Code** with 100% compatibility.\n- **Collapsible Outline View**: Enjoy a fixed or collapsible sidebar outline of your document headings. Click any heading to navigate smoothly.\n- **8+ Exquisite Editor Themes**: Change your writing vibe instantly in **User Settings / Profile** with preset themes such as `WeChat Classic Green`, `Modern Mint`, `minimal-emerald`, and more.\n- **One-Click Publishing Export**: Built for publishers. Click \"Copy for WeChat / Publishing\" to automatically format your note with inline CSS. Paste it directly into WeChat, Substack, Medium, or WordPress editor while preserving layout and syntax highlighting.\n- **List Indentation & Quick Link**: Use quick keys for list indents, and double-click or select text to quickly link to existing notes with shortcut hints.\n\n---\n\n### 📝 3. Template Center & Single-Note Export\n\n- **Visual Template Library**: Access a curated collection of note templates with live modal preview cards. Instantly create notes using a template and jump back with one click.\n- **Custom Templates**: Save your frequent note structures as custom templates to double your productivity.\n- **Flexible File Export**: Export the current note as a standard `.md` Markdown file or a beautifully styled `.pdf` document for offline archival and sharing.\n\n---\n\n### 📊 4. Native Mermaid Diagram Rendering\n\nUse standard `mermaid` fenced code blocks to render beautiful diagrams in real time, with support for **selectable diagram themes** and dimension-preserved copying:\n\n#### 1️⃣ System Flowchart\n```mermaid\nflowchart TD\n    subgraph Client[\"📱 Clients Ecosystem\"]\n        A[\"Web / PWA\"]\n        B[\"macOS / Android / iOS Apps\"]\n    end\n\n    subgraph Backend[\"⚡ Cloudflare Serverless\"]\n        C[\"Cloudflare Workers API\"]\n        D[(\"D1 SQLite DB\")]\n        E[(\"R2 Object Storage\")]\n    end\n\n    A & B --> C\n    C <--> D & E\n```\n\n#### 2️⃣ Interactive Sequence Diagram\n```mermaid\nsequenceDiagram\n    autonumber\n    actor User as User\n    participant App as EdgeEver Client\n    participant Worker as Cloudflare Worker API\n    participant D1 as D1 Database\n\n    User->>App: Edit and save note\n    App->>Worker: POST /api/v1/memos (Save changes)\n    Worker->>D1: Write note content & update revision\n    D1-->>Worker: Return success (revision + 1)\n    Worker-->>App: 200 OK (Latest sync cursor)\n    App-->>User: Status updated to \"Saved\"\n```\n\n---\n\n### 📁 5. Multi-Device Sync, Offline Queue & Clipping\n\n- **Everywhere You Need It**: Native clients are available for Web, Android, and macOS (Intel & Apple Silicon), with the iOS client under App Store review.\n- **Web Clipper**: Available on Chrome, Edge, and Firefox Add-ons stores to save webpage contents with one click.\n- **Mobile WeChat Clipper**: Share any WeChat article to EdgeEver on your phone, and it automatically extracts the article content as an editable note.\n- **Offline Sync & Queue**: Keep writing even without network. Your edits are queued locally and synchronized automatically when connection resumes. Customize sync intervals in settings.\n\n---\n\n### 🖼️ 6. Rich Media & Smart Image Compression\n\nDrag-and-drop or paste images directly into your editor. EdgeEver compresses images locally to WebP before upload, reducing file sizes by **50% - 90%** to save bandwidth and Cloudflare storage.\n\n![EdgeEver Mascot: Geek Cat](/api/v1/resources/res_demo_cat_image/blob)\n\n---\n\n### 🤖 7. Native AI Agent Ecosystem (Agent-Ready)\n\nEdgeEver is architected natively for the AI era:\n\n1. **REST API**: Provides complete OpenAPI definitions at `/api/openapi.json`.\n2. **MCP (Model Context Protocol) Endpoint**: Accessible at `/mcp`, allowing AI agents (like Antigravity, Claude Code, and Cursor) to securely connect, read, and write notes in your workspace for automated tags, summaries, and edits.\n\n---\n\n### 🔒 8. Account Isolation & Secure Sharing\n\n- **Multi-Tenant Isolation**: Supports multiple user accounts with independent workspace databases and brute-force login protection.\n- **Active Devices Session Control**: Check active login locations and user agents, and revoke other sessions with one tap in settings.\n- **Revocable Note Sharing**: Share a note publicly with a secure link and toggle it off anytime. Active sharing status is visible on the note list and editor header.\n\n---\n\n> 🎯 **Quick Try**:\n> - Click the **WeChat Icon** in the top bar and paste the styled rich text directly into WeChat, Substack, or WordPress;\n> - Swap **Editor Themes** in **Settings** to find your favorite color scheme;\n> - Press `Cmd/Ctrl + Shift + F` to enter Focus Mode for distraction-free writing;\n> - Drag and drop notebooks in the left list to experiment with infinite nesting;\n> - Click \"Reset Demo Data\" in the sidebar or settings to reset the workspace state at any time!"
  },
} as const;
export const DEMO_SEED_MEMOS_EN = DEMO_SEED_MEMOS_ZH.map((memo) => {
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
export const DEMO_SEED_MEMOS_ZH_WITH_ATTACHMENTS = DEMO_SEED_MEMOS_ZH.map((memo) => ({
  ...memo,
  markdown: `${memo.markdown}${DEMO_ATTACHMENT_MARKDOWN_ZH}`,
}));
export const DEMO_SEED_MEMOS = [...DEMO_SEED_MEMOS_ZH_WITH_ATTACHMENTS, ...DEMO_SEED_MEMOS_EN];
export const DEMO_SEED_RESOURCES = [
  {
    id: "res_demo_cat_image",
    memoId: "memo_demo_overview",
    filename: "cute-cat-demo.svg",
    mimeType: "image/svg+xml",
    width: 960,
    height: 540,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" fill="none"><rect width="960" height="540" rx="32" fill="#f0fdfa"/><g transform="translate(480, 270) scale(2.2)"><path d="M-60,-20 C-60,-60 -30,-80 0,-80 C30,-80 60,-60 60,-20 C60,20 40,40 0,40 C-40,40 -60,20 -60,-20 Z" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M-45,-68 L-55,-100 L-20,-78" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M45,-68 L55,-100 L20,-78" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M-30,-25 Q-20,-15 -10,-25" stroke="#0f766e" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M10,-25 Q20,-15 30,-25" stroke="#0f766e" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M-5,-10 L5,-10 L0,-5 Z" fill="#0f766e"/><path d="M0,-5 Q-5,5 -10,2 M0,-5 Q5,5 10,2" stroke="#0f766e" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M-40,-5 L-65,-8" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M-42,5 L-68,7" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M40,-5 L65,-8" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M42,5 L68,7" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M-30,35 C-30,70 -10,90 0,90 C10,90 30,70 30,35" stroke="#0f766e" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M25,75 C45,75 55,60 55,45 C55,30 45,25 40,30 C35,35 40,45 45,45" stroke="#0f766e" stroke-width="6" stroke-linecap="round" fill="none"/></g></svg>'},
] as const;
export const DEMO_SEED_ATTACHMENT_RESOURCES = [...DEMO_SEED_RESOURCES, ...DEMO_ATTACHMENT_RESOURCES];
export const DEMO_SEED_NOTEBOOK_IDS = DEMO_SEED_NOTEBOOKS.map((notebook) => notebook.id);
export const DEMO_SEED_MEMO_IDS = DEMO_SEED_MEMOS.map((memo) => memo.id);
