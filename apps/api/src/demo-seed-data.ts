import {
  serializeDiagramDocument,
  serializeInfographicDocument,
  serializePosterDocument,
  serializeTableDocument,
  type DiagramDocument,
  type InfographicDocument,
  type PosterDocument,
  type TableDocument,
} from "@edgeever/shared";
import {
  decodeDemoAttachment,
  DEMO_ATTACHMENT_MARKDOWN_EN,
  DEMO_ATTACHMENT_MARKDOWN_ZH,
  DEMO_ATTACHMENT_RESOURCES,
} from "./demo-attachments";

export { decodeDemoAttachment };

export const DEMO_SEED_NOTEBOOKS = [
  { id: "nb_inbox", parentId: null, name: "等待分类", slug: "inbox", icon: "notebook", color: null, sortOrder: 10 },
  { id: "nb_projects", parentId: null, name: "工作项目", slug: "work-projects", icon: "notebook", color: null, sortOrder: 20 },
  { id: "nb_learning", parentId: null, name: "学习资料", slug: "learning-resources", icon: "notebook", color: null, sortOrder: 30 },
  { id: "nb_creative", parentId: null, name: "灵感创作", slug: "creative-ideas", icon: "notebook", color: null, sortOrder: 40 },
  { id: "nb_personal", parentId: null, name: "生活个人", slug: "personal-life", icon: "notebook", color: null, sortOrder: 50 },
  { id: "nb_demo_features", parentId: "nb_projects", name: "功能演示", slug: "demo-features", icon: "notebook", color: null, sortOrder: 21 },
  { id: "nb_demo_features_en", parentId: "nb_projects", name: "Feature Demos", slug: "feature-demos", icon: "notebook", color: null, sortOrder: 22 },
];

export const DEMO_ARCHITECTURE_DIAGRAM_ZH: DiagramDocument = {
  schemaVersion: 2,
  kind: "architecture",
  nodes: [
    { id: "boundary-clients", label: "全端体验层", x: 32, y: 32, width: 260, height: 694, shape: "boundary" },
    { id: "boundary-platform", label: "可移植应用平台 · Cloudflare Workers / Docker 共用业务核心", x: 380, y: 179, width: 732, height: 400, shape: "boundary" },
    { id: "boundary-data", label: "数据与文件层 · 可替换基础设施适配器", x: 1200, y: 390, width: 260, height: 380, shape: "boundary" },
    { id: "boundary-ecosystem", label: "AI 与自动化生态", x: 1200, y: 62, width: 260, height: 272, shape: "boundary" },

    { id: "client-web", label: "Web / PWA\n离线优先", x: 68, y: 88, width: 156, height: 64, shape: "frontend", resourceIcon: "webApp", parentId: "boundary-clients" },
    { id: "client-desktop", label: "macOS / Win / Linux\n桌面端", x: 68, y: 192, width: 156, height: 70, shape: "client", resourceIcon: "client", parentId: "boundary-clients" },
    { id: "client-ios", label: "iOS\nSwiftUI 原生端", x: 68, y: 302, width: 156, height: 70, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-android", label: "Android\nExpo 原生端", x: 68, y: 412, width: 156, height: 64, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-clipper", label: "浏览器剪藏\nChrome / Edge / Firefox", x: 68, y: 516, width: 156, height: 70, shape: "client", resourceIcon: "website", parentId: "boundary-clients" },
    { id: "client-sync", label: "全端共享同步通道", x: 68, y: 626, width: 156, height: 64, shape: "service", resourceIcon: "apiClient", parentId: "boundary-clients" },

    { id: "platform-api", label: "统一 API 入口\n认证 · 限流 · 路由", x: 416, y: 363, width: 156, height: 70, shape: "service", resourceIcon: "apiGateway", parentId: "boundary-platform" },
    { id: "platform-core", label: "共享业务核心\nHono · 领域服务", x: 668, y: 304, width: 156, height: 70, shape: "service", resourceIcon: "service", parentId: "boundary-platform" },
    { id: "platform-sync", label: "同步与修订引擎\n离线队列 · 冲突控制", x: 920, y: 295, width: 156, height: 88, shape: "service", resourceIcon: "streamProcessing", parentId: "boundary-platform" },
    { id: "platform-mcp", label: "MCP / ACP 双协议\n智能体读写与协同", x: 416, y: 235, width: 156, height: 88, shape: "service", resourceIcon: "mcpServer", parentId: "boundary-platform" },
    { id: "platform-model", label: "端侧模型网关\nBYOK 隐私直连", x: 416, y: 473, width: 156, height: 70, shape: "service", resourceIcon: "modelGateway", parentId: "boundary-platform" },

    { id: "data-search", label: "搜索与语义索引\n全文 · 向量", x: 1239, y: 446, width: 150, height: 72, shape: "database", resourceIcon: "vectorDatabase", parentId: "boundary-data" },
    { id: "data-sql", label: "D1 / SQLite\n笔记 · 标签 · 修订", x: 1239, y: 558, width: 150, height: 72, shape: "database", resourceIcon: "relationalDatabase", parentId: "boundary-data" },
    { id: "data-objects", label: "R2 / S3\n图片与附件", x: 1236, y: 670, width: 156, height: 64, shape: "storage", resourceIcon: "objectStorage", parentId: "boundary-data" },

    { id: "ecosystem-agents", label: "Claude / Codex\n外部与本机智能体", x: 1236, y: 118, width: 156, height: 70, shape: "external", resourceIcon: "aiAgent", parentId: "boundary-ecosystem" },
    { id: "ecosystem-models", label: "OpenAI / Gemini\n兼容模型服务", x: 1236, y: 228, width: 156, height: 70, shape: "external", resourceIcon: "largeLanguageModel", parentId: "boundary-ecosystem" },
  ],
  edges: [
    { id: "edge-clients-api", source: "client-sync", target: "platform-api", label: "HTTPS / 同步游标", kind: "request" },
    { id: "edge-api-core", source: "platform-api", target: "platform-core", label: "统一领域接口", kind: "request" },
    { id: "edge-core-sync", source: "platform-core", target: "platform-sync", label: "变更日志", kind: "async", bidirectional: true },
    { id: "edge-mcp-core", source: "platform-mcp", target: "platform-core", label: "受控读写", kind: "request", bidirectional: true },
    { id: "edge-core-sql", source: "platform-core", target: "data-sql", label: "事务", kind: "data" },
    { id: "edge-core-objects", source: "platform-core", target: "data-objects", label: "对象存取", kind: "data" },
    { id: "edge-sync-search", source: "platform-sync", target: "data-search", label: "增量索引", kind: "data" },
    { id: "edge-agents-mcp", source: "ecosystem-agents", target: "platform-mcp", label: "MCP Tools", kind: "request", bidirectional: true },
    { id: "edge-model-gateway", source: "platform-model", target: "ecosystem-models", label: "用户密钥直连", kind: "request", bidirectional: true },
  ],
};

export const DEMO_ARCHITECTURE_DIAGRAM_EN: DiagramDocument = {
  schemaVersion: 2,
  kind: "architecture",
  nodes: [
    { id: "boundary-clients", label: "Cross-Platform Experience", x: 32, y: 43, width: 260, height: 694, shape: "boundary" },
    { id: "boundary-platform", label: "Portable Application Platform · Shared Core on Cloudflare Workers or Docker", x: 380, y: 181, width: 732, height: 418, shape: "boundary" },
    { id: "boundary-data", label: "Data & Files · Replaceable Infrastructure Adapters", x: 1200, y: 396, width: 260, height: 436, shape: "boundary" },
    { id: "boundary-ecosystem", label: "AI & Automation Ecosystem", x: 1200, y: 32, width: 260, height: 308, shape: "boundary" },

    { id: "client-web", label: "Web / PWA\nOffline First", x: 68, y: 99, width: 156, height: 64, shape: "frontend", resourceIcon: "webApp", parentId: "boundary-clients" },
    { id: "client-desktop", label: "macOS / Win / Linux\nDesktop", x: 68, y: 203, width: 156, height: 70, shape: "client", resourceIcon: "client", parentId: "boundary-clients" },
    { id: "client-ios", label: "iOS\nNative SwiftUI", x: 68, y: 313, width: 156, height: 70, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-android", label: "Android\nNative Expo", x: 68, y: 423, width: 156, height: 64, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-clipper", label: "Web Clipper\nChrome / Edge / Firefox", x: 68, y: 527, width: 156, height: 70, shape: "client", resourceIcon: "website", parentId: "boundary-clients" },
    { id: "client-sync", label: "Shared Cross-Client Sync", x: 68, y: 637, width: 156, height: 64, shape: "service", resourceIcon: "apiClient", parentId: "boundary-clients" },

    { id: "platform-api", label: "Unified API Entry\nAuth · Limits · Routing", x: 416, y: 365, width: 156, height: 88, shape: "service", resourceIcon: "apiGateway", parentId: "boundary-platform" },
    { id: "platform-core", label: "Shared Business Core\nHono · Domain Services", x: 668, y: 301, width: 156, height: 88, shape: "service", resourceIcon: "service", parentId: "boundary-platform" },
    { id: "platform-sync", label: "Sync & Revision Engine\nOffline Queue · Conflicts", x: 920, y: 301, width: 156, height: 88, shape: "service", resourceIcon: "streamProcessing", parentId: "boundary-platform" },
    { id: "platform-mcp", label: "MCP & ACP Protocols\nAgent Read/Write Tools", x: 416, y: 237, width: 156, height: 88, shape: "service", resourceIcon: "mcpServer", parentId: "boundary-platform" },
    { id: "platform-model", label: "Client Model Gateway\nPrivate BYOK", x: 416, y: 493, width: 156, height: 70, shape: "service", resourceIcon: "modelGateway", parentId: "boundary-platform" },

    { id: "data-search", label: "Search & Semantic Index\nFull Text · Vectors", x: 1239, y: 452, width: 150, height: 106, shape: "database", resourceIcon: "vectorDatabase", parentId: "boundary-data" },
    { id: "data-sql", label: "D1 / SQLite\nNotes · Tags · Revisions", x: 1239, y: 598, width: 150, height: 88, shape: "database", resourceIcon: "relationalDatabase", parentId: "boundary-data" },
    { id: "data-objects", label: "R2 / S3\nImages & Attachments", x: 1236, y: 726, width: 156, height: 70, shape: "storage", resourceIcon: "objectStorage", parentId: "boundary-data" },

    { id: "ecosystem-agents", label: "Claude / Codex\nRemote & Local Agents", x: 1236, y: 88, width: 156, height: 88, shape: "external", resourceIcon: "aiAgent", parentId: "boundary-ecosystem" },
    { id: "ecosystem-models", label: "OpenAI / Gemini\nCompatible Models", x: 1236, y: 216, width: 156, height: 88, shape: "external", resourceIcon: "largeLanguageModel", parentId: "boundary-ecosystem" },
  ],
  edges: [
    { id: "edge-clients-api", source: "client-sync", target: "platform-api", label: "HTTPS / Sync Cursor", kind: "request" },
    { id: "edge-api-core", source: "platform-api", target: "platform-core", label: "Domain API", kind: "request" },
    { id: "edge-core-sync", source: "platform-core", target: "platform-sync", label: "Change Log", kind: "async", bidirectional: true },
    { id: "edge-mcp-core", source: "platform-mcp", target: "platform-core", label: "Governed Access", kind: "request", bidirectional: true },
    { id: "edge-core-sql", source: "platform-core", target: "data-sql", label: "Transactions", kind: "data" },
    { id: "edge-core-objects", source: "platform-core", target: "data-objects", label: "Objects", kind: "data" },
    { id: "edge-sync-search", source: "platform-sync", target: "data-search", label: "Incremental Index", kind: "data" },
    { id: "edge-agents-mcp", source: "ecosystem-agents", target: "platform-mcp", label: "MCP Tools", kind: "request", bidirectional: true },
    { id: "edge-model-gateway", source: "platform-model", target: "ecosystem-models", label: "User-Key Direct", kind: "request", bidirectional: true },
  ],
};

export const DEMO_FLOWCHART_DIAGRAM_ZH: DiagramDocument = {
  schemaVersion: 1,
  kind: "flowchart",
  theme: "plain",
  nodes: [
    { id: "capture", label: "捕捉灵感", x: 72, y: 176, width: 136, height: 48, shape: "terminator" },
    { id: "enrich", label: "补充正文、标签与附件", x: 264, y: 168, width: 184, height: 64, shape: "process" },
    { id: "organized", label: "已经适合归档？", x: 516, y: 164, width: 164, height: 72, shape: "decision" },
    { id: "inbox", label: "放入“等待分类”", x: 516, y: 304, width: 164, height: 56, shape: "process" },
    { id: "notebook", label: "归入项目或主题笔记本", x: 748, y: 168, width: 184, height: 64, shape: "process" },
    { id: "ai", label: "AI 提炼摘要与行动项", x: 748, y: 304, width: 184, height: 64, shape: "process" },
    { id: "publish", label: "发布、分享或持续迭代", x: 1000, y: 176, width: 184, height: 48, shape: "terminator" },
  ],
  edges: [
    { id: "capture-enrich", source: "capture", target: "enrich" },
    { id: "enrich-organized", source: "enrich", target: "organized" },
    { id: "organized-notebook", source: "organized", target: "notebook", label: "是" },
    { id: "organized-inbox", source: "organized", target: "inbox", label: "否" },
    { id: "inbox-ai", source: "inbox", target: "ai", label: "稍后整理" },
    { id: "notebook-publish", source: "notebook", target: "publish" },
    { id: "ai-publish", source: "ai", target: "publish" },
  ],
};

export const DEMO_FLOWCHART_DIAGRAM_EN: DiagramDocument = {
  schemaVersion: 1,
  kind: "flowchart",
  theme: "plain",
  nodes: [
    { id: "capture", label: "Capture an idea", x: 72, y: 176, width: 136, height: 48, shape: "terminator" },
    { id: "enrich", label: "Add content, tags & files", x: 264, y: 168, width: 184, height: 64, shape: "process" },
    { id: "organized", label: "Ready to organize?", x: 516, y: 164, width: 164, height: 72, shape: "decision" },
    { id: "inbox", label: "Keep in Inbox", x: 516, y: 304, width: 164, height: 56, shape: "process" },
    { id: "notebook", label: "Move to a project or topic", x: 748, y: 168, width: 184, height: 64, shape: "process" },
    { id: "ai", label: "Let AI extract summary & actions", x: 748, y: 304, width: 184, height: 64, shape: "process" },
    { id: "publish", label: "Publish, share, or iterate", x: 1000, y: 176, width: 184, height: 48, shape: "terminator" },
  ],
  edges: [
    { id: "capture-enrich", source: "capture", target: "enrich" },
    { id: "enrich-organized", source: "enrich", target: "organized" },
    { id: "organized-notebook", source: "organized", target: "notebook", label: "Yes" },
    { id: "organized-inbox", source: "organized", target: "inbox", label: "Not yet" },
    { id: "inbox-ai", source: "inbox", target: "ai", label: "Review later" },
    { id: "notebook-publish", source: "notebook", target: "publish" },
    { id: "ai-publish", source: "ai", target: "publish" },
  ],
};

export const DEMO_MIND_MAP_DIAGRAM_ZH: DiagramDocument = {
  schemaVersion: 1,
  kind: "mind-map",
  theme: "plain",
  structure: "map",
  nodes: [
    { id: "root", label: "我的第二大脑", x: 72, y: 216, width: 152, height: 52, shape: "topic" },
    { id: "capture", label: "采集", x: 304, y: 72, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "organize", label: "组织", x: 304, y: 176, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "connect", label: "连接", x: 304, y: 280, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "create", label: "创造", x: 304, y: 384, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "capture-clip", label: "网页与社媒剪藏", x: 520, y: 32, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-quick", label: "随手记与一键导入", x: 520, y: 88, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-files", label: "图片与附件", x: 520, y: 144, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "organize-notebooks", label: "树状笔记本", x: 520, y: 200, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "organize-tags", label: "标签与搜索", x: 520, y: 256, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "connect-links", label: "双向链接", x: 520, y: 312, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "connect-mcp", label: "MCP / ACP 智能体", x: 520, y: 368, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "create-writing", label: "可组合排版与长图", x: 520, y: 424, width: 112, height: 36, shape: "topic", parentId: "create" },
    { id: "create-share", label: "知识站点与插件", x: 520, y: 480, width: 112, height: 36, shape: "topic", parentId: "create" },
  ],
  edges: [
    { id: "edge-root-capture", source: "root", target: "capture" },
    { id: "edge-root-organize", source: "root", target: "organize" },
    { id: "edge-root-connect", source: "root", target: "connect" },
    { id: "edge-root-create", source: "root", target: "create" },
    { id: "edge-capture-clip", source: "capture", target: "capture-clip" },
    { id: "edge-capture-quick", source: "capture", target: "capture-quick" },
    { id: "edge-capture-files", source: "capture", target: "capture-files" },
    { id: "edge-organize-notebooks", source: "organize", target: "organize-notebooks" },
    { id: "edge-organize-tags", source: "organize", target: "organize-tags" },
    { id: "edge-connect-links", source: "connect", target: "connect-links" },
    { id: "edge-connect-mcp", source: "connect", target: "connect-mcp" },
    { id: "edge-create-writing", source: "create", target: "create-writing" },
    { id: "edge-create-share", source: "create", target: "create-share" },
  ],
};

export const DEMO_MIND_MAP_DIAGRAM_EN: DiagramDocument = {
  schemaVersion: 1,
  kind: "mind-map",
  theme: "plain",
  structure: "map",
  nodes: [
    { id: "root", label: "My Second Brain", x: 72, y: 216, width: 152, height: 52, shape: "topic" },
    { id: "capture", label: "Capture", x: 304, y: 72, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "organize", label: "Organize", x: 304, y: 176, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "connect", label: "Connect", x: 304, y: 280, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "create", label: "Create", x: 304, y: 384, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "capture-clip", label: "Web & social clipping", x: 520, y: 32, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-quick", label: "Quick notes & imports", x: 520, y: 88, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-files", label: "Images & files", x: 520, y: 144, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "organize-notebooks", label: "Notebook tree", x: 520, y: 200, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "organize-tags", label: "Tags & search", x: 520, y: 256, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "connect-links", label: "Backlinks", x: 520, y: 312, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "connect-mcp", label: "MCP & ACP agents", x: 520, y: 368, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "create-writing", label: "Composable prose & cards", x: 520, y: 424, width: 112, height: 36, shape: "topic", parentId: "create" },
    { id: "create-share", label: "Knowledge sites & plugins", x: 520, y: 480, width: 112, height: 36, shape: "topic", parentId: "create" },
  ],
  edges: [
    { id: "edge-root-capture", source: "root", target: "capture" },
    { id: "edge-root-organize", source: "root", target: "organize" },
    { id: "edge-root-connect", source: "root", target: "connect" },
    { id: "edge-root-create", source: "root", target: "create" },
    { id: "edge-capture-clip", source: "capture", target: "capture-clip" },
    { id: "edge-capture-quick", source: "capture", target: "capture-quick" },
    { id: "edge-capture-files", source: "capture", target: "capture-files" },
    { id: "edge-organize-notebooks", source: "organize", target: "organize-notebooks" },
    { id: "edge-organize-tags", source: "organize", target: "organize-tags" },
    { id: "edge-connect-links", source: "connect", target: "connect-links" },
    { id: "edge-connect-mcp", source: "connect", target: "connect-mcp" },
    { id: "edge-create-writing", source: "create", target: "create-writing" },
    { id: "edge-create-share", source: "create", target: "create-share" },
  ],
};

export const DEMO_INFOGRAPHIC_SYNTAX_ZH = `infographic sequence-timeline-rounded-rect-node
data
  title EdgeEver 演进里程碑
  sequences
    - label v1.0 经典三栏与零成本底座
      desc 印象笔记式三栏双视图、Cloudflare Serverless 与 Docker 同构内核
    - label v1.50 全端原生与全渠道剪藏
      desc macOS/Win/Linux/iOS/Android 全端覆盖、20+ 平台剪藏与微信聊天归档
    - label v1.88 多模态结构化知识台
      desc 原生架构图/流程图/导图、AntV AI 信息图、多维表格与海报画布
    - label v2.0 双协议智能体与插件生态
      desc 原生 MCP 端点、桌面 ACP 本机智能体协同与 @edgeever/plugin-api 开放市场
    - label v2.30 无损迁移与企业级可靠
      desc 6 大平台图形化一键迁入、多维表格命名视图、桌面定时加密备份与 WebDAV 灾备`;

export const DEMO_INFOGRAPHIC_SYNTAX_EN = `infographic sequence-timeline-rounded-rect-node
data
  title EdgeEver Evolution Milestones
  sequences
    - label v1.0 Classic 3-Pane & Zero-Cost Core
      desc Classic three-pane dual-view editor, Cloudflare Serverless & Docker shared core
    - label v1.50 Full-Platform & Omni-Clipper
      desc Native macOS/Win/Linux/iOS/Android apps, 20+ platform clipper & WeChat archiving
    - label v1.88 Multi-Modal Visual Workspace
      desc Native diagrams, AntV AI infographics, structured tables & poster canvas notes
    - label v2.0 Dual Agent Protocols & Plugins
      desc Native MCP endpoint, desktop ACP local agents & @edgeever/plugin-api ecosystem
    - label v2.30 Seamless Migration & Resilience
      desc 6-platform GUI note import, named table views, encrypted desktop backups & WebDAV`;

export const DEMO_INFOGRAPHIC_DOCUMENT_ZH: InfographicDocument = {
  schemaVersion: 1,
  syntax: DEMO_INFOGRAPHIC_SYNTAX_ZH,
};

export const DEMO_INFOGRAPHIC_DOCUMENT_EN: InfographicDocument = {
  schemaVersion: 1,
  syntax: DEMO_INFOGRAPHIC_SYNTAX_EN,
};

export const DEMO_POSTER_DOCUMENT_ZH: PosterDocument = {
  schemaVersion: 1,
  width: 1080,
  height: 1440,
  background: "#f4efe4",
  templateId: "editorial",
  copy: {
    badge: "EDGEEVER · 知识艺术",
    title: "极客的下一代\n数字第二大脑",
    subtitle: "重拾经典三栏工作流，融入 AI 智能体与无损开放数据资产。",
  },
  elements: [
    {
      id: "accent",
      name: "accent",
      type: "rect",
      x: 96,
      y: 110,
      width: 120,
      height: 12,
      fill: "#16a06e",
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "badge",
      name: "badge",
      type: "text",
      role: "badge",
      text: "EDGEEVER · 知识艺术",
      x: 96,
      y: 150,
      width: 888,
      height: 40,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#0f766e",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "heading",
      name: "heading",
      type: "text",
      role: "title",
      text: "极客的下一代\n数字第二大脑",
      x: 96,
      y: 220,
      width: 888,
      height: 220,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 84,
      fontFamily: "serif",
      fontWeight: "bold",
      textAlign: "left",
      lineHeight: 1.25,
    },
    {
      id: "subtitle",
      name: "subtitle",
      type: "text",
      role: "subtitle",
      text: "重拾经典三栏工作流，融入 AI 智能体与无损开放数据资产。",
      x: 96,
      y: 470,
      width: 888,
      height: 80,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#3f3f46",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
    },
    {
      id: "section-1-card",
      name: "section-1-card",
      type: "rect",
      x: 96,
      y: 590,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-1-heading",
      name: "section-1-heading",
      type: "text",
      text: "01 · 原生 MCP / ACP 与开放插件生态",
      x: 136,
      y: 630,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-1-body",
      name: "section-1-body",
      type: "text",
      text: "原生对接 Claude、Codex、Cursor 与本机 ACP 智能体，支持插件与主题跨端同步。",
      x: 136,
      y: 695,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
    {
      id: "section-2-card",
      name: "section-2-card",
      type: "rect",
      x: 96,
      y: 840,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-2-heading",
      name: "section-2-heading",
      type: "text",
      text: "02 · 零成本 Serverless 与无损迁移",
      x: 136,
      y: 880,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-2-body",
      name: "section-2-body",
      type: "text",
      text: "跑在 Cloudflare 免费额度内或一键 Docker 自建，支持 Notion、印象笔记、Obsidian 一键迁入。",
      x: 136,
      y: 945,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
    {
      id: "section-3-card",
      name: "section-3-card",
      type: "rect",
      x: 96,
      y: 1090,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-3-heading",
      name: "section-3-heading",
      type: "text",
      text: "03 · 全平台客户端与多模态知识台",
      x: 136,
      y: 1130,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-3-body",
      name: "section-3-body",
      type: "text",
      text: "覆盖 Web、macOS、Windows、Linux、iOS 与 Android，内置多维表格、图表、海报与知识库发布。",
      x: 136,
      y: 1195,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
  ],
};

export const DEMO_POSTER_DOCUMENT_EN: PosterDocument = {
  schemaVersion: 1,
  width: 1080,
  height: 1440,
  background: "#f4efe4",
  templateId: "editorial",
  copy: {
    badge: "EDGEEVER · KNOWLEDGE ART",
    title: "Next-Gen Second Brain\nfor Geeks & Creators",
    subtitle: "Revive the beloved three-pane workflow with native AI agents and total data ownership.",
  },
  elements: [
    {
      id: "accent",
      name: "accent",
      type: "rect",
      x: 96,
      y: 110,
      width: 120,
      height: 12,
      fill: "#16a06e",
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "badge",
      name: "badge",
      type: "text",
      role: "badge",
      text: "EDGEEVER · KNOWLEDGE ART",
      x: 96,
      y: 150,
      width: 888,
      height: 40,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#0f766e",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "heading",
      name: "heading",
      type: "text",
      role: "title",
      text: "Next-Gen Second Brain\nfor Geeks & Creators",
      x: 96,
      y: 220,
      width: 888,
      height: 220,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 80,
      fontFamily: "serif",
      fontWeight: "bold",
      textAlign: "left",
      lineHeight: 1.25,
    },
    {
      id: "subtitle",
      name: "subtitle",
      type: "text",
      role: "subtitle",
      text: "Revive the beloved three-pane workflow with native AI agents and total data ownership.",
      x: 96,
      y: 470,
      width: 888,
      height: 80,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#3f3f46",
      fontSize: 30,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
    },
    {
      id: "section-1-card",
      name: "section-1-card",
      type: "rect",
      x: 96,
      y: 590,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-1-heading",
      name: "section-1-heading",
      type: "text",
      text: "01 · Native MCP / ACP & Open Plugin Ecosystem",
      x: 136,
      y: 630,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-1-body",
      name: "section-1-body",
      type: "text",
      text: "Connect Claude, Codex, and Cursor via MCP, drive local agents via ACP, and sync plugins & themes.",
      x: 136,
      y: 695,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
    {
      id: "section-2-card",
      name: "section-2-card",
      type: "rect",
      x: 96,
      y: 840,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-2-heading",
      name: "section-2-heading",
      type: "text",
      text: "02 · 100% Free Serverless & Seamless Migration",
      x: 136,
      y: 880,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-2-body",
      name: "section-2-body",
      type: "text",
      text: "Run within Cloudflare free quotas or Docker with one-click GUI import from Notion, Evernote & Obsidian.",
      x: 136,
      y: 945,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
    {
      id: "section-3-card",
      name: "section-3-card",
      type: "rect",
      x: 96,
      y: 1090,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-3-heading",
      name: "section-3-heading",
      type: "text",
      text: "03 · Full-Platform Apps & Multi-Modal Canvas",
      x: 136,
      y: 1130,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-3-body",
      name: "section-3-body",
      type: "text",
      text: "Native coverage on Web, macOS, Windows, Linux, iOS & Android with tables, diagrams, posters & sites.",
      x: 136,
      y: 1195,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
  ],
};

export const DEMO_TABLE_DOCUMENT_ZH: TableDocument = {
  schemaVersion: 2,
  fields: [
    { id: "fld_feature", name: "功能特性", type: "text" },
    { id: "fld_category", name: "模块分类", type: "select", options: ["AI 与开放生态", "多端与剪藏", "图表与多维数据", "迁移与数据安全"] },
    { id: "fld_status", name: "交付状态", type: "select", options: ["已正式发布", "持续增强", "规划中"] },
    { id: "fld_verified", name: "验收通过", type: "checkbox" },
    { id: "fld_date", name: "发布日期", type: "date" },
    { id: "fld_docs", name: "规格文档", type: "attachment" },
  ],
  records: [
    {
      id: "rec_table",
      cells: {
        fld_feature: "多维表格命名视图、组合筛选、多字段排序与公开表单",
        fld_category: "图表与多维数据",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-11-19",
        fld_docs: [{ resourceId: "res_demo_product_brief_pdf", filename: "edgeever-product-brief.pdf", mimeType: "application/pdf", byteSize: 349 }],
      },
    },
    {
      id: "rec_note_import",
      cells: {
        fld_feature: "第三方笔记图形化一键迁入 (Notion / 思源 / flomo / 印象 / Obsidian / Joplin / MD)",
        fld_category: "迁移与数据安全",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-11-18",
        fld_docs: [{ resourceId: "res_demo_meeting_notes_docx", filename: "edgeever-meeting-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: 37961 }],
      },
    },
    {
      id: "rec_plugins",
      cells: {
        fld_feature: "开放插件 API (@edgeever/plugin-api) 与跨端主题市场",
        fld_category: "AI 与开放生态",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-11-12",
        fld_docs: [],
      },
    },
    {
      id: "rec_backup_security",
      cells: {
        fld_feature: "桌面端定时加密备份 (.edgeever.enc)、WebDAV 异地灾备与 TOTP 2FA",
        fld_category: "迁移与数据安全",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-11-05",
        fld_docs: [],
      },
    },
    {
      id: "rec_acp",
      cells: {
        fld_feature: "桌面端 ACP 本机智能体协同 (Codex / Claude Code / Antigravity / WorkBuddy / CodeBuddy)",
        fld_category: "AI 与开放生态",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-11-02",
        fld_docs: [],
      },
    },
    {
      id: "rec_poster",
      cells: {
        fld_feature: "原生海报画布、9 款质感长图卡片与可组合阅读排版",
        fld_category: "图表与多维数据",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-30",
        fld_docs: [],
      },
    },
    {
      id: "rec_clipper",
      cells: {
        fld_feature: "20+ 平台全渠道结构化剪藏与手机/桌面双端微信聊天归档",
        fld_category: "多端与剪藏",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-25",
        fld_docs: [],
      },
    },
    {
      id: "rec_notebook_site",
      cells: {
        fld_feature: "笔记本独立知识库站点发布与单篇分享精细控制",
        fld_category: "迁移与数据安全",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-20",
        fld_docs: [],
      },
    },
    {
      id: "rec_platforms",
      cells: {
        fld_feature: "全平台原生客户端 (Web / macOS / Win / Linux / iOS / Android)",
        fld_category: "多端与剪藏",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-15",
        fld_docs: [{ resourceId: "res_demo_attachment_bundle_zip", filename: "edgeever-attachment-demo.zip", mimeType: "application/zip", byteSize: 153 }],
      },
    },
    {
      id: "rec_infographic",
      cells: {
        fld_feature: "AntV AI 信息图与原生架构图 / 流程图 / 思维导图",
        fld_category: "图表与多维数据",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-10",
        fld_docs: [{ resourceId: "res_demo_feature_matrix_csv", filename: "feature-matrix.csv", mimeType: "text/csv", byteSize: 99 }],
      },
    },
    {
      id: "rec_mcp",
      cells: {
        fld_feature: "原生 MCP 服务端点 (/mcp) 与智能输出预算防截断",
        fld_category: "AI 与开放生态",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-01",
        fld_docs: [],
      },
    },
  ],
  views: [
    {
      id: "default",
      name: "",
      match: "all",
      filters: [],
      sorts: [
        { fieldId: "fld_date", direction: "desc" },
        { fieldId: "fld_category", direction: "asc" },
      ],
    },
    {
      id: "view_ai_ecosystem",
      name: "AI 与开放生态",
      match: "all",
      filters: [
        { fieldId: "fld_category", operator: "eq", value: "AI 与开放生态" },
        { fieldId: "fld_verified", operator: "eq", value: true },
      ],
      sorts: [{ fieldId: "fld_date", direction: "desc" }],
    },
    {
      id: "view_with_specs",
      name: "含规格附件",
      match: "all",
      filters: [
        { fieldId: "fld_docs", operator: "notEmpty" },
      ],
      sorts: [{ fieldId: "fld_date", direction: "desc" }],
    },
  ],
};

export const DEMO_TABLE_DOCUMENT_EN: TableDocument = {
  schemaVersion: 2,
  fields: [
    { id: "fld_feature", name: "Feature", type: "text" },
    { id: "fld_category", name: "Category", type: "select", options: ["AI & Ecosystem", "Apps & Clipping", "Visuals & Data", "Migration & Security"] },
    { id: "fld_status", name: "Status", type: "select", options: ["Released", "Enhancing", "Planned"] },
    { id: "fld_verified", name: "Verified", type: "checkbox" },
    { id: "fld_date", name: "Release Date", type: "date" },
    { id: "fld_docs", name: "Documents", type: "attachment" },
  ],
  records: [
    {
      id: "rec_table",
      cells: {
        fld_feature: "Structured Table Named Views, Typed Filters, Multi-Sort & Public Forms",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-11-19",
        fld_docs: [{ resourceId: "res_demo_product_brief_pdf", filename: "edgeever-product-brief.pdf", mimeType: "application/pdf", byteSize: 349 }],
      },
    },
    {
      id: "rec_note_import",
      cells: {
        fld_feature: "One-Click GUI Note Migration (Notion / SiYuan / flomo / Evernote / Obsidian / Joplin / MD)",
        fld_category: "Migration & Security",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-11-18",
        fld_docs: [{ resourceId: "res_demo_meeting_notes_docx", filename: "edgeever-meeting-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: 37961 }],
      },
    },
    {
      id: "rec_plugins",
      cells: {
        fld_feature: "Open Plugin API (@edgeever/plugin-api) & Cross-Device Theme Marketplace",
        fld_category: "AI & Ecosystem",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-11-12",
        fld_docs: [],
      },
    },
    {
      id: "rec_backup_security",
      cells: {
        fld_feature: "Scheduled Encrypted Backups (.edgeever.enc), WebDAV Replication & TOTP 2FA",
        fld_category: "Migration & Security",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-11-05",
        fld_docs: [],
      },
    },
    {
      id: "rec_acp",
      cells: {
        fld_feature: "Desktop ACP Local Agent Synergy (Codex / Claude Code / Antigravity / WorkBuddy / CodeBuddy)",
        fld_category: "AI & Ecosystem",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-11-02",
        fld_docs: [],
      },
    },
    {
      id: "rec_poster",
      cells: {
        fld_feature: "Native Poster Canvas, 9 Share Card Themes & Composable Prose Typography",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-30",
        fld_docs: [],
      },
    },
    {
      id: "rec_clipper",
      cells: {
        fld_feature: "20+ Platform Structured Web Clipper & Mobile/Desktop WeChat Chat Archiving",
        fld_category: "Apps & Clipping",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-25",
        fld_docs: [],
      },
    },
    {
      id: "rec_notebook_site",
      cells: {
        fld_feature: "Notebook Knowledge Base Site Publishing & Granular Single-Note Share Controls",
        fld_category: "Migration & Security",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-20",
        fld_docs: [],
      },
    },
    {
      id: "rec_platforms",
      cells: {
        fld_feature: "Full-Platform Native Apps (Web / macOS / Win / Linux / iOS / Android)",
        fld_category: "Apps & Clipping",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-15",
        fld_docs: [{ resourceId: "res_demo_attachment_bundle_zip", filename: "edgeever-attachment-demo.zip", mimeType: "application/zip", byteSize: 153 }],
      },
    },
    {
      id: "rec_infographic",
      cells: {
        fld_feature: "AntV AI Infographics & Native Architecture / Flowchart / Mind Map Suite",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-10",
        fld_docs: [{ resourceId: "res_demo_feature_matrix_csv", filename: "feature-matrix.csv", mimeType: "text/csv", byteSize: 99 }],
      },
    },
    {
      id: "rec_mcp",
      cells: {
        fld_feature: "Native MCP Endpoint (/mcp) & Smart Output Budgets with Anti-Truncation",
        fld_category: "AI & Ecosystem",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-01",
        fld_docs: [],
      },
    },
  ],
  views: [
    {
      id: "default",
      name: "",
      match: "all",
      filters: [],
      sorts: [
        { fieldId: "fld_date", direction: "desc" },
        { fieldId: "fld_category", direction: "asc" },
      ],
    },
    {
      id: "view_ai_ecosystem",
      name: "AI & Ecosystem",
      match: "all",
      filters: [
        { fieldId: "fld_category", operator: "eq", value: "AI & Ecosystem" },
        { fieldId: "fld_verified", operator: "eq", value: true },
      ],
      sorts: [{ fieldId: "fld_date", direction: "desc" }],
    },
    {
      id: "view_with_specs",
      name: "With Spec Docs",
      match: "all",
      filters: [
        { fieldId: "fld_docs", operator: "notEmpty" },
      ],
      sorts: [{ fieldId: "fld_date", direction: "desc" }],
    },
  ],
};

export const DEMO_SEED_MEMOS_ZH = [
  {
    id: "memo_demo_overview",
    notebookId: "nb_demo_features",
    title: "欢迎使用 EdgeEver：为极客与创作者打造的现代开源知识库",
    tags: ["overview", "guide", "features", "ai-agent"],
    isPinned: true,
    markdown:
      `> **EdgeEver** 是一款兼具**经典三栏美学**与 **AI 原生动力**的开源 Serverless / 容器化个人知识库。它既找回了极客们钟爱的经典印象笔记式双视图与树状目录，又以零服务器成本、无损第三方迁移、多模态富笔记（多维表格、思维导图、架构图、AI 信息图、海报）、全端原生覆盖与深度 MCP / ACP 智能体及插件生态，重新定义了下一代个人第二大脑。

---

## 1. 为什么选择 EdgeEver？

*提示：在编辑器模式下，你可以直接点击任意表格单元格进行行内编辑，或右键快捷插入/删除行列。*

| 核心维度 | 传统商业云笔记 (如 Evernote) | 本地离线知识库 (如 Obsidian) | EdgeEver 极客知识库 |
| :--- | :--- | :--- | :--- |
| **源代码** | 闭源 | 核心闭源，文件开放 | **整栈开源 (AGPL-3.0)** |
| **云端托管成本** | 商业订阅高昂（$10+/月） | 官方云同步收费（$5+/月） | **100% 永久免费 (Cloudflare 免费额度 / Docker 自建)** |
| **数据资产与平滑迁入** | 专有格式封闭，导出困难 | 本地 Markdown，移动端同步繁琐 | **完全自主掌控 (SQLite / R2 / 无损 ZIP) + 图形化一键导入 Notion / 思源 / flomo / 印象笔记 / Obsidian / Joplin / Markdown 目录** |
| **写作与多模态矩阵** | 仅富文本，排版易错乱 | 纯 Markdown，缺乏沉浸所见即所得 | **双视图自由切换 (所见即所得 ⇄ 源码) + 原生架构图/流程图/思维导图/AI 信息图/多维结构化表格 (命名视图 + 公开表单)/原生海报笔记** |
| **阅读排版与自媒体分发** | 无样式优化，格式易丢失 | 需借助外部排版扩展或工具 | **9 色可组合阅读排版 + 独立杂志封面与章节导航 + 「带排版复制」一键粘贴至微信公众号 / 知乎 / Substack / Medium / WordPress** |
| **高颜值长图与代码卡片** | 截图粗糙或无排版设计 | 需第三方插件实现 | **内置 9 款质感分享卡片主题（透明质感、金句、书摘、备忘录、便当格、黑日、画框、手写、代码卡片），支持字体亲和配对与高清 PNG/JPEG 导出** |
| **AI 智能体与插件生态** | 封闭收费，仅限特定功能 | 需配置复杂的第三方插件 | **原生 MCP 服务端点 (\`/mcp\`)、桌面端 ACP 本机智能体协同、伴随式 AI 助手、音视频转文字与 \`@edgeever/plugin-api\` 跨端插件/主题市场** |
| **全平台覆盖与自动灾备** | 限制免费设备登录数量 | 多端同步与移动端体验门槛高 | **Web / PWA / Android / iOS / macOS / Windows / Linux AppImage + 20+ 平台网页剪藏 + 桌面端定时加密备份 (\`.edgeever.enc\`) 与 WebDAV 异地灾备** |

---

## 2. 全景架构与生态联动

通过下面的 Mermaid 架构图，你可以清晰了解 EdgeEver 如何将多端客户端、零成本云基础设施与 AI Agent 紧密串联：

\`\`\`mermaid
flowchart LR
    subgraph ClientsBox["全端客户端与智能体"]
        Clients["全端客户端矩阵<br/>Web · PWA · 桌面客户端<br/>iOS · Android · 浏览器剪藏"]
        Agents["外部与本机 AI 智能体<br/>Claude Code · Codex · Cursor · Antigravity"]
    end

    subgraph Platform["EdgeEver 平台核心 (Cloudflare Workers / Docker)"]
        API["统一 REST API 入口<br/>认证鉴权 · 限流 · 增量同步游标"]
        MCP["MCP (/mcp) 与桌面 ACP 协议<br/>上下文感知 · 工具读写 · 插件生态"]
    end

    subgraph BackendBox["AI 模型与数据存储"]
        LLMs["主流大语言模型 (BYOK 直连)<br/>OpenAI · Gemini · Claude · DeepSeek"]
        Storage[("数据与对象存储<br/>Cloudflare D1 / SQLite · R2 / S3 兼容")]
    end

    Clients <-->|HTTPS 增量同步| API
    Clients -->|BYOK 客户端直连 · 隐私安全| LLMs
    Agents <-->|MCP / ACP 协议协同| MCP
    API <--> Storage
    MCP <--> Storage
\`\`\`

---

## 3. 极致创作体验与可组合排版美学

EdgeEver 将高效与优雅融入每一处交互细节，助你专注于思考与表达：

### 双视图编辑器、杂志封面与沉浸模式
- **自由切换视图**：点击右上角 \`</>\` 按钮或使用快捷键，可在**所见即所得富文本**与 **Markdown 源码**间无缝切换，实时双向保真。
- **独立杂志封面与章节导航**：支持按单篇笔记独立开启杂志级首屏封面与可折叠章节大纲（公开分享页同样内置可折叠目录大纲），万字长文脉络一目了然；桌面端还支持**在新窗口中独立打开多篇笔记**对照编辑。
- **Zen 专注模式**：按下 \`Cmd/Ctrl + Shift + F\`，隐藏所有侧边栏与干扰元素，进入纯粹写作心流。
- **阅读保护模式 (Reading Protection)**：日常翻阅或查阅笔记时，按下 \`Cmd/Ctrl + E\` 即可一键开启只读保护，锁定当前编辑状态，避免沉浸阅读时误触键盘或意外改动笔记内容；再次按下即可随手切回编辑。

### 可组合阅读排版与「带排版复制」
- **9 色调色板与自由组合样式**：内置陶土 (\`Clay\`)、晨曦 (\`Dawn\`)、翡翠 (\`Emerald\`)、青碧 (\`Teal\`)、蔚蓝 (\`Azure\`)、紫罗兰 (\`Violet\`)、樱粉 (\`Pink\`)、玫瑰红 (\`Rose\`) 与岩灰 (\`Slate\`) 9 款正文字色调色板（全面适配深色模式），可自由组合标题样式（默认 / 侧栏色条 / 自动编号）、引用块样式、荧光笔强调、段落间距、对齐方式与字距；默认提供拍立得图片卡片画框、中性冷灰行内代码、代码行一键复制，以及按需加载的 Maple Mono CN、霞鹜文楷、朱雀仿宋等精选字体。
- **一键带排版复制**：在笔记操作菜单或顶部工具栏点击**「带排版复制」**，系统会自动将当前排版主题、代码高亮、动图及 Mermaid 架构图（支持自动上传至已配置的图床）转为内联 CSS 富文本，直接粘贴至微信公众号后台、知乎、X 文章、Substack 或 WordPress，排版完美保真。

### 9 款质感长图与代码分享卡片 (Share as Image)
点击右上角「分享为图片」，即可将整篇笔记或片段渲染为高分辨率长图或社交卡片：
- **9 大精选卡片主题**：\`透明质感 (Glass)\`、\`金句 (Quote)\`、\`书摘 (Book)\`、\`备忘录 (Memo)\`、\`便当格 (Bento)\`、\`黑日 (Black Sun)\`、\`画框 (Frame)\`、\`手写 (Handwritten)\`，以及专为技术分享打造的 \`代码卡片 (Code)\`（自带窗口样式、行号与等宽代码排版）。
- **字体亲和与版式定制**：内置阿里普惠体、MiSans、汇文明朝、思源宋体、龙藏手书与 Geist Mono 等模板亲和字体，自由选择紧凑、标准或宽幅尺寸，一键导出高清 PNG / JPEG 或复制至剪贴板。

---

## 4. 多模态表达：图表、AI 信息图、多维表格与海报画布

EdgeEver 打破了传统笔记单一文本的局限，提供多种原生可视化与结构化数据载体：

### 原生图表体系 (Native Diagrams)
- **系统架构图 (Architecture)**：针对分布式系统与微服务设计，支持分层系统边界、云原生图标与自动拓扑布局；
- **业务流程图 (Flowchart)**：标准起止框、判断节点与过程流向，清晰梳理业务链路；
- **第二大脑思维导图 (Mind Map)**：树状辐射、主题归纳，支持在 AI 伴随助手中用自然语言一句话生成可交互导图。

### AntV AI 智能信息图 (Infographic)
集成 AntV 渲染引擎与 AI Agent：
- 涵盖时间线 (Timeline)、步骤图 (Steps)、四象限 (Quadrant)、对比矩阵 (VS) 等丰富模板；
- **对话式智能修订**：直接在信息图侧边栏用自然语言提需求（如“把重点放在 v2 插件生态与迁移能力上”或“转为时间线”），AI 自动匹配版式并完成调整，支持多轮对话、版本回退与矢量图导出。

### 多维结构化表格 (Structured Table)
为项目路线图、选题库、资产跟踪与表单收集而生：
- **丰富字段类型**：原生支持文本、数字、单选标签 (Select)、日期 (Date)、复选框 (Checkbox)、超链接 (URL) 与**多文件附件 (Attachment)**；
- **命名视图、组合筛选与多字段排序**：支持在同一张表内创建多个**命名视图**（如「全部记录」「AI 与开放生态」「含规格附件」），配置满足全部/任一条件（All / Any）的强类型过滤规则（含日期区间、本周、附件非空等）与多字段优先级排序；
- **AI 一句话建表与公开收集表单**：可在 AI 助手中用自然语言自动搭建业务表并填充示例数据；点击顶部「表单收集」即可一键生成免登录公开外链表单，外部提交实时同步入表。

### 原生海报设计工作台 (Poster Canvas)
在「新建 → 海报」或笔记菜单中选择「制作海报」，即可进入画布级海报工作台，内置 40+ 款设计模板（覆盖小红书 3:4、朋友圈 1:1 及横版画幅），双击画布元素即可自由调整文案、配色与版式。

---

## 5. 效率工具箱：斜杠指令、双链、数学公式与精细分享

### 斜杠指令 (Slash Commands)
在正文空白行输入 \`/\` 或直接按下 \`空格键\`，即可呼出快捷指令菜单：
- 快速插入 \`H1/H2/H3\` 标题、折叠块、引用、分割线、代码块与富文本表格；
- 输入 \`/date\`、\`/time\` 或 \`/now\` 快速插入当前标准时间戳；
- 插入附件、图片或调起行内 AI 智能助手。

### 知识双链与多笔记合并
在编辑器中输入 \`@\` 或插入 \`#memo=<笔记ID>\` 链接，即可建立笔记间的双向关联（相关笔记亦可直接引用如 \`#memo=memo_demo_infographic\`）；多选笔记支持一键合并为长期专题笔记，并以柔和的渐变分割线清晰区隔来源段落。

### 单篇分享精细控制与独立知识库站点
- **单篇分享控制**：生成公开分享链接时，支持自定义专属短链地址（Slug）、独立访问密码、可选过期时间、打开次数统计、页面可折叠大纲以及 Raw Markdown 直链；
- **笔记本知识库站点发布**：右键任意笔记本即可一键发布为带目录树导航与可选密码保护的独立静态知识库网站。

### KaTeX 专业数学公式渲染
EdgeEver 原生支持 LaTeX 数学表达式，无论是行内微积分还是多行物理方程，均可毫秒级高保真渲染：

- **行内公式**：例如质能方程 $E = mc^2$，以及正态分布概率密度函数 $f(x) = \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$。
- **多行独立公式块**：
$$
\\oint_{\\partial \\Omega} \\mathbf{E} \\cdot d\\mathbf{S} = \\frac{1}{\\varepsilon_0} \\iiint_{\\Omega} \\rho \\, dV, \\quad \\oint_{\\partial \\Omega} \\mathbf{B} \\cdot d\\mathbf{S} = 0
$$

### 交互式待办清单 (Task Lists)
- [x] 体验 EdgeEver 双视图切换、杂志封面与可折叠章节大纲
- [x] 探索 9 色可组合阅读排版、9 款分享长图卡片与「带排版复制」
- [x] 浏览【AI 信息图】v2.30 演进里程碑与【多维结构化表格】命名视图
- [ ] 尝试在「设置 → 备份与导入」中体验 Notion / 印象笔记 / Obsidian / flomo 一键迁入
- [ ] 配置个人 AI API Key 或在桌面端连接本机 ACP 智能体协同创作
- [ ] 逛一逛「设置 → 插件与主题」市场，一键安装跨端同步插件

---

## 6. AI 原生协同、MCP/ACP 双协议与开放插件生态

EdgeEver 走在 AI 时代前沿，将大语言模型、外部/本机智能体与开放插件深度融入知识管理生命周期：

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant User as 创作者 / 知识工作者
    participant Client as EdgeEver 多端应用
    participant Protocol as EdgeEver MCP (/mcp) & 桌面 ACP
    participant Agent as AI Agent (Claude / Codex / Cursor / Antigravity)
    participant Ecosystem as 插件面板 / 外部知识库

    User->>Client: 采集灵感、剪藏社媒图文或导入音视频附件
    Agent->>Protocol: 检索上下文与未整理笔记 (memo_search / get_memo)
    Protocol-->>Agent: 返回结构化 Markdown、表格 schema 与附件元数据
    Agent->>Agent: 提炼核心摘要、生成图表/多维表格并自动归类打标
    Agent->>Protocol: 原子级写回笔记、表格记录与关联附件
    Agent->>Ecosystem: 联动 Tasks / AI RSS 插件或外部工作流
    Client-->>User: 全端毫秒级增量同步，知识资产井井有条
\`\`\`

### 1. 伴随式与行内 AI 助手 (Inline & Companion AI)
在正文空白行按下 **\`空格键 (Space)\`**、输入 **\`/ai\`**、选中文本点击浮动工具栏 **AI 按钮**，或打开右侧 **AI 伴随助手**，即可随时调用 AI 能力：
- **总结、润色与格式保真翻译**：一键提炼核心结论与行动项，或在严格保留 Markdown、数学公式、链接与代码块的前提下精准互译多国语言；
- **智能输出预算与长文分段防截断**：自动识别模型上下文与输出上限（内置 \`models.dev\` 规格库自动兜底），长文生成支持自动分段续写与侧边栏草稿一键回填，彻底告别长文截断；
- **AI 音视频语音转文字**：客户端本地提取音视频音轨并智能切片，直连 OpenAI 兼容语音模型完成高准确度转写并一键插入正文；
- **BYOK 隐私直连 (Bring Your Own Key)**：客户端直连 OpenAI、Anthropic Claude、Google Gemini、DeepSeek 及各类兼容 API，密钥与请求无需经过第三方中转。

### 2. 远程 MCP 与桌面端 ACP 双协议互联
- **开放 MCP 协议 (\`/mcp\`)**：在**个人中心 → API / MCP** 中创建专属令牌，即可让 Claude Code、Codex、Cursor、Antigravity 等外部 Agent 安全读写文本笔记、架构图/流程图/导图、AI 信息图、多维表格、海报笔记、附件（支持先传附件再原子绑定笔记）、历史修订、笔记模板与 AI 指令；
- **桌面端 ACP 本机智能体协同**：桌面客户端支持通过 ACP 协议直接唤起本机已安装的 **Codex、Claude Code、Antigravity、WorkBuddy、CodeBuddy** 等本地 Agent，在笔记右侧栏直接对话、跨笔记检索并协同改稿。

### 3. 开放插件 API 与个性化主题市场 (\`@edgeever/plugin-api\`)
Web 与桌面端内置**插件与主题管理中心**，支持从官方市场、GitHub 仓库或 Manifest 地址一键安装，并随工作区自动跨设备同步：
- **核心扩展能力**：插件可安全读写笔记与编辑器选区、注册自定义侧栏面板与快捷命令、调用工作区已配置的 AI 模型以及执行定时后台任务；同时支持无代码个性化主题定制；
- **官方开源插件范式**：如跨笔记自动汇总 Markdown 待办并支持状态过滤跳转的 **EdgeEver Tasks**，以及自动抓取订阅源并生成 AI 每日分类简报的 **EdgeEver AI RSS**。

---

## 7. 全平台原生客户端、20+ 平台剪藏与微信归档

- **全平台原生客户端**：
  - **Web / PWA**：现代浏览器即开即用，支持离线安装与多语言界面（简/繁中文、英、西、德、法、日、波兰、俄语）；
  - **macOS / Windows / Linux 桌面端**：基于 Electron + Rust 高性能 Sidecar 构建（支持 macOS Apple Silicon & Intel、Windows x64、Linux x86_64 AppImage），内置本地 SQLite 离线镜像、静默自动更新、**全局快捷键框选截图直存**、**外部编辑器修改附件保存后自动回存**、**多窗口独立编辑**，以及 Windows 资源管理器右键「发送到 EdgeEver」；
  - **iOS 原生客户端**：纯正 Swift / SwiftUI + GRDB 本地镜像实现，流畅细腻，已上架 App Store（非中国大陆区 Apple ID 可直接下载）；
  - **Android 原生客户端**：基于 Expo + SQLite 构建，支持离线队列与系统分享接入，已上架 Google Play 并提供官方签名 APK。
- **全渠道结构化网页剪藏 (Web Clipper)**：
  - 已在 Chrome、Edge 和 Firefox 官方扩展商店上架，支持正文纯净 Markdown 提取、网页区域框选截图及右键划选文字/高清图片直存；
  - **深度适配 20+ 主流平台结构化抓取**：覆盖 **小红书（图文与多栏画廊）**、**微信公众号**、**X (Twitter，含引用推文与图集)**、**知乎**、**Reddit**、**Instagram（含多图轮播画廊）**、**GitHub（自动生成结构化仓库技术卡片）**、**即刻**、**豆瓣**、**Threads**、**Bluesky**、**V2EX**、**Hacker News**、**Medium**、**Substack**、**Bilibili**、**YouTube**、**小宇宙** 等。
- **微信生态全链路打通**：
  - **微信聊天记录一键归档**：在微信中多选消息点击「合并转发 → 转发到其他应用 → EdgeEver」（**手机端系统分享与桌面端导入均支持**），自动解析发言人、时间轴、引用、表情、内嵌图片与文档音视频附件，生成结构化可检索笔记；
  - **手机端剪藏公众号文章与图片**：在手机微信阅读文章或浏览任意 App 图片时，通过系统分享菜单选择 **EdgeEver**，即可后台自动提取图文排版或原图并创建笔记。
- **离线优先与弹性同步**：无网络环境下依然流畅书写，恢复联网后自动通过增量游标与同步队列完成多端瞬时同步。

---

## 8. 第三方一键迁移、加密灾备、图床扩展与零成本自建

### 第三方笔记平台图形化一键迁入
在 **设置 → 备份与导入 → 从其他应用导入** 中，无需配置任何命令行工具，在 Web 或桌面端直接拖入导出文件、文件夹或压缩包即可完成无损迁移：
- **原生支持 7 大来源**：覆盖 **Notion**、**思源笔记（SiYuan）**、**flomo**、**印象笔记（Evernote \`.enex\`）**、**Obsidian**、**Joplin** 以及**通用 Markdown 文件与目录树**；
- **完整结构还原**：自动保留原有笔记本目录层级、创建时间、标签体系与内嵌图片附件（包括妥善处理印象笔记超长标题、任务字段与独立附件笔记）。

### 智能本地图片压缩、S3 存储与第三方图床
在笔记中粘贴或拖入高分辨率图片时，前端会在本地自动转码压缩为 WebP 格式，在视觉无损前提下**减少 50% - 90% 体积**；同时支持分片流式上传最大 **1 GiB** 的大型附件。
- **OSS 对象存储**：实例管理员可在高级设置中挂载任意兼容 S3 API 的对象存储；
- **CloudFlare ImgBed 与 PicGo 图床**：Web 端（HTTPS）与桌面端均支持将新插图片直传自建 **CloudFlare ImgBed**（支持自动拉取并选择上传通道、配置 \`{Y}/{m}/{d}\` 与 \`{memoId}\` 动态路径）；桌面端同时支持对接本机或 NAS 上的 **PicGo / PicList** 图床服务。

![EdgeEver 官方 Logo](/api/v1/resources/res_demo_logo/blob)

### 多类型附件自由挂载与外部编辑回存
支持在笔记中嵌入 Word、PDF、CSV、压缩包及音视频资源，在线预览或下载；在桌面端打开附件调用本地 Office 或其他软件修改并保存后，EdgeEver 会**自动检测变更并静默回传更新附件**：

[📝 会议纪要 Word：edgeever-meeting-notes.docx](/api/v1/resources/res_demo_meeting_notes_docx/blob)

[📄 产品白皮书 PDF：edgeever-product-brief.pdf](/api/v1/resources/res_demo_product_brief_pdf/blob)

[📊 功能矩阵 CSV：feature-matrix.csv](/api/v1/resources/res_demo_feature_matrix_csv/blob)

[📦 示例附件压缩包：edgeever-attachment-demo.zip](/api/v1/resources/res_demo_attachment_bundle_zip/blob)

### 自建部署方案：Serverless 与 Docker
1. **Cloudflare Serverless（推荐，永久 100% 免费）**：基于 Workers + D1 数据库 + R2 对象存储构建，完全运行在 Cloudflare 免费配额内（可容纳约 15 万条短笔记与 5 万张图片），免服务器采购、免运维、支持绑定自定义域名并跟随上游正式版自动更新。
2. **Docker 一键自建（VPS / NAS / 家用服务器）**：
   \`\`\`sh
   # 官方 GHCR 镜像
   curl -fsSL https://edgeever.org/install.sh | bash
   \`\`\`
   单命令自动配置 Docker Compose 环境并开启每日定时自动更新。部分中国大陆网络环境在拉取 GHCR 镜像时，可能需要自行配置可用的网络代理或可信的镜像加速服务。

### 绝对的数据自由与企业级安全：无损 ZIP、定时加密备份与 2FA
- **无损 ZIP 导入与导出**：随时导出包含标准 YAML Front Matter、相对路径附件与完整修订历史的纯 Markdown ZIP 档案，可在 Obsidian、VS Code 中直接打开，亦可跨 EdgeEver 实例无损还原；
- **桌面端定时加密备份与 WebDAV 异地灾备**：桌面端支持按周/按月本地定时自动备份（多快照轮转保留，支持生成标准 ZIP 或高强度密码加密的 \`.edgeever.enc\` 归档），并可在每次备份后自动同步至 **WebDAV**（NAS / 私有云盘）；
- **账号安全与多空间隔离**：单实例支持多成员账号物理隔离与存储用量明细面板，内置服务端防暴力破解限流、**TOTP 两步验证（2FA）与恢复码**以及登录设备会话管理。

---

> 💡 **快速体验小贴士**：
> 1. 点击右上角 **\`</>\`** 体验丝滑的双视图切换，或在顶部外观菜单尝试 **9 色可组合排版与杂志封面**；
> 2. 浏览侧边栏中的 **AI 信息图**、**多维结构化表格（体验顶部命名视图切换与筛选排序）** 与 **视觉排版海报** 示例；
> 3. 按下 **\`Cmd/Ctrl + E\`** 试一试阅读保护模式，锁定只读避免误改内容；
> 4. 按下 **\`Cmd/Ctrl + O\`** 呼出快速切换器 (Quick Switcher)；
> 5. 体验分享与发布：单篇笔记分享支持自定义短链、密码、过期时间与可折叠大纲；右键笔记本可一键发布为独立知识库网站；
> 6. 点击笔记菜单中的 **「带排版复制」**，一键复制适配微信公众号与主流自媒体后台的富文本；
> 7. 点击 **「分享为图片」**，体验透明质感、金句、书摘、代码卡片等 9 款精选长图主题并导出；
> 8. 随时在侧边栏或设置中点击 **“恢复 Demo 数据”**，一键重置演示工作区。
`,
  },
  {
    id: "memo_demo_poster",
    notebookId: "nb_demo_features",
    title: "视觉排版：EdgeEver 极客第二大脑设计海报",
    tags: ["poster", "design", "visual-layout", "branding"],
    isPinned: false,
    markdown: serializePosterDocument(DEMO_POSTER_DOCUMENT_ZH),
  },
  {
    id: "memo_demo_infographic",
    notebookId: "nb_demo_features",
    title: "演进里程碑：EdgeEver 全平台架构与版本演进史",
    tags: ["infographic", "milestone", "timeline", "ai-agent"],
    isPinned: false,
    markdown: serializeInfographicDocument(DEMO_INFOGRAPHIC_DOCUMENT_ZH),
  },
  {
    id: "memo_demo_table",
    notebookId: "nb_demo_features",
    title: "交付追踪：EdgeEver 核心产品特性规划与进度表",
    tags: ["table", "roadmap", "project-management", "tracking"],
    isPinned: false,
    markdown: serializeTableDocument(DEMO_TABLE_DOCUMENT_ZH),
  },
  {
    id: "memo_demo_architecture",
    notebookId: "nb_demo_features",
    title: "系统架构：EdgeEver 可移植全栈与 AI 协同",
    tags: ["architecture", "diagram", "portable-runtime", "cloud-native", "mcp"],
    isPinned: false,
    markdown: serializeDiagramDocument(DEMO_ARCHITECTURE_DIAGRAM_ZH),
  },
  {
    id: "memo_demo_flowchart",
    notebookId: "nb_demo_features",
    title: "知识工作流：从捕捉灵感到发布分享的流程图",
    tags: ["flowchart", "diagram", "workflow", "knowledge-management"],
    isPinned: false,
    markdown: serializeDiagramDocument(DEMO_FLOWCHART_DIAGRAM_ZH),
  },
  {
    id: "memo_demo_mind_map",
    notebookId: "nb_demo_features",
    title: "第二大脑：个人知识管理体系思维导图",
    tags: ["mind-map", "diagram", "second-brain", "knowledge-management"],
    isPinned: false,
    markdown: serializeDiagramDocument(DEMO_MIND_MAP_DIAGRAM_ZH),
  },
];

export const DEMO_SEED_REVISIONS = [
  {
    id: "rev_demo_revision_1",
    memoId: "memo_demo_overview",
    revision: 1,
    title: "欢迎使用 EdgeEver：为极客与创作者打造的现代开源知识库",
    markdown:
      "## 欢迎使用 EdgeEver（初版草稿）\n\n- 印象笔记经典三栏与自建 Serverless\n- 可视化表格与 Markdown 源码双向切换\n- 原生 MCP 与 AI 智能体协同",
  },
  {
    id: "rev_demo_revision_1_en",
    memoId: "memo_demo_overview_en",
    revision: 1,
    title: "Welcome to EdgeEver: Modern Open-Source Knowledge Base for Geeks & Creators",
    markdown:
      "## Welcome to EdgeEver (Initial Draft)\n\n- Classic Evernote 3-pane layout & Serverless self-hosted\n- Visual table editing & Markdown source toggle\n- Native MCP & AI agent synergy",
  },
  {
    id: "rev_demo_poster_1",
    memoId: "memo_demo_poster",
    revision: 1,
    title: "视觉排版：EdgeEver 极客第二大脑设计海报",
    markdown: serializePosterDocument(DEMO_POSTER_DOCUMENT_ZH),
  },
  {
    id: "rev_demo_poster_1_en",
    memoId: "memo_demo_poster_en",
    revision: 1,
    title: "Visual Design: EdgeEver Geek Second Brain Poster Note",
    markdown: serializePosterDocument(DEMO_POSTER_DOCUMENT_EN),
  },
  {
    id: "rev_demo_infographic_1",
    memoId: "memo_demo_infographic",
    revision: 1,
    title: "演进里程碑：EdgeEver 全平台架构与版本演进史",
    markdown: serializeInfographicDocument(DEMO_INFOGRAPHIC_DOCUMENT_ZH),
  },
  {
    id: "rev_demo_infographic_1_en",
    memoId: "memo_demo_infographic_en",
    revision: 1,
    title: "Evolution Milestones: EdgeEver Architecture & Release History",
    markdown: serializeInfographicDocument(DEMO_INFOGRAPHIC_DOCUMENT_EN),
  },
  {
    id: "rev_demo_table_1",
    memoId: "memo_demo_table",
    revision: 1,
    title: "交付追踪：EdgeEver 核心产品特性规划与进度表",
    markdown: serializeTableDocument(DEMO_TABLE_DOCUMENT_ZH),
  },
  {
    id: "rev_demo_table_1_en",
    memoId: "memo_demo_table_en",
    revision: 1,
    title: "Delivery Tracking: EdgeEver Product Roadmap & Release Status",
    markdown: serializeTableDocument(DEMO_TABLE_DOCUMENT_EN),
  },
  {
    id: "rev_demo_architecture_1",
    memoId: "memo_demo_architecture",
    revision: 1,
    title: "系统架构：EdgeEver 可移植全栈与 AI 协同",
    markdown: serializeDiagramDocument(DEMO_ARCHITECTURE_DIAGRAM_ZH),
  },
  {
    id: "rev_demo_architecture_1_en",
    memoId: "memo_demo_architecture_en",
    revision: 1,
    title: "System Architecture: EdgeEver Portable Full Stack & AI Collaboration",
    markdown: serializeDiagramDocument(DEMO_ARCHITECTURE_DIAGRAM_EN),
  },
];

export const DEMO_MEMO_ENGLISH = {
  memo_demo_overview: {
    title: "Welcome to EdgeEver: Modern Open-Source Knowledge Base for Geeks & Creators",
    markdown:
      `> **EdgeEver** is an open-source, AI-native, and portable serverless/containerized personal knowledge base that revives the beloved **Evernote-style three-pane layout**. Designed for geeks and content creators, it combines 100% free serverless hosting, one-click third-party note migration, multi-modal canvases (structured tables, mind maps, architecture diagrams, AI infographics, posters), native cross-platform clients, and seamless MCP / ACP AI Agent & plugin synergy to redefine your digital second brain.

---

## 1. Why Choose EdgeEver?

*Tip: In editor mode, click any table cell to edit text directly, or right-click to insert/delete rows and columns.*

| Dimension | Traditional Cloud Notes (e.g. Evernote) | Local Offline Notes (e.g. Obsidian) | EdgeEver Geek Knowledge Base |
| :--- | :--- | :--- | :--- |
| **Source Code** | Closed source | Closed-source core, open files | **Full-stack open source (AGPL-3.0)** |
| **Hosting Cost** | Costly commercial subscriptions ($10+/mo) | Official cloud sync subscription ($5+/mo) | **100% Free Forever (Cloudflare Free Tier / Docker Self-Hosted)** |
| **Data Ownership & Migration** | Proprietary lock-in, hard to export | Local Markdown, cumbersome mobile sync | **Full Ownership (SQLite / R2 / Lossless ZIP) + One-Click GUI Import from Notion / SiYuan / flomo / Evernote / Obsidian / Joplin / Markdown Folders** |
| **Multi-Modal Expressive Matrix** | Rich text only, fragile formatting | Plain Markdown, lacks WYSIWYG flow | **Seamless Dual-View (WYSIWYG ⇄ Source) + Native Architecture/Flowchart/Mind-Map/AI Infographic/Structured Table (Named Views + Public Forms)/Poster Notes** |
| **Typography & Publishing** | No typography styling, loses format | Requires 3rd-party plugins or scripts | **9-Palette Composable Prose + Magazine Cover & Chapter Navigation + "Copy with Formatting" for WeChat, Substack, Medium & WordPress** |
| **Share Cards & Code Snapshots** | Basic screenshots without styling | Requires external tools or plugins | **9 Curated Share Card Themes (Glass, Quote, Book, Memo, Bento, Black Sun, Frame, Handwritten, Code Card) with Font Affinity & High-Res PNG/JPEG Export** |
| **AI Agents & Plugin Ecosystem** | Paywalled, limited features | Heavy plugin setup required | **Native MCP Endpoint (\`/mcp\`), Desktop ACP Local Agents, Companion AI, Audio/Video Transcription & \`@edgeever/plugin-api\` Cross-Device Marketplace** |
| **Cross-Platform & Resilience** | Restricts active free devices | Complex setup across platforms | **Web / PWA / Android / iOS / macOS / Windows / Linux AppImage + 20+ Platform Web Clipper + Scheduled Encrypted Backups (\`.edgeever.enc\`) & WebDAV** |

---

## 2. Architectural Overview & Ecosystem

The Mermaid diagram below demonstrates how EdgeEver connects cross-platform clients, zero-cost cloud infrastructure, and AI Agents into a cohesive workflow:

\`\`\`mermaid
flowchart LR
    subgraph ClientsBox["Cross-platform clients & agents"]
        Clients["Cross-Platform Clients<br/>Web · PWA · Desktop Apps<br/>iOS · Android · Web Clipper"]
        Agents["Remote & Local AI Agents<br/>Claude Code · Codex · Cursor · Antigravity"]
    end

    subgraph Platform["EdgeEver Platform Core (Cloudflare Workers / Docker)"]
        API["Unified REST API Entry<br/>Auth · Rate Limiting · Sync Cursor"]
        MCP["MCP (/mcp) & Desktop ACP<br/>Context Retrieval · Tools · Plugin API"]
    end

    subgraph BackendBox["AI Models & Data Storage"]
        LLMs["LLM Providers (Direct BYOK)<br/>OpenAI · Gemini · Claude · DeepSeek"]
        Storage[("Data & Object Storage<br/>Cloudflare D1 / SQLite · R2 / S3 Compatible")]
    end

    Clients <-->|HTTPS Incremental Sync| API
    Clients -->|Direct BYOK · Privacy First| LLMs
    Agents <-->|MCP / ACP Synergy| MCP
    API <--> Storage
    MCP <--> Storage
\`\`\`

---

## 3. Immersive Writing & Composable Typography

EdgeEver is engineered to provide a distraction-free, customizable writing and reading experience:

### Dual-View Editor, Magazine Cover & Focus Modes
- **Seamless Dual-View**: Click the \`</>\` button in the top-right corner (or use shortcuts) to instantly toggle between **WYSIWYG Rich Text** and **Markdown Source Code** with 100% fidelity.
- **Independent Magazine Cover & Chapter Navigation**: Toggle editorial magazine covers per note and navigate long documents with collapsible chapter outlines (also available on public shared note pages); on desktop, **open multiple notes in independent windows** for side-by-side comparison.
- **Zen Focus Mode**: Press \`Cmd/Ctrl + Shift + F\` to hide sidebars and distractions, immersing yourself in pure writing flow.
- **Reading Protection Mode**: When reading or reviewing notes, press \`Cmd/Ctrl + E\` to toggle read-only protection, locking the editor against accidental keystrokes; press it again to resume editing immediately.

### Composable Reading Typography & "Copy with Formatting"
- **9 Prose Palettes & Composable Styles**: Choose from 9 prose palettes (\`Clay\`, \`Dawn\`, \`Emerald\`, \`Teal\`, \`Azure\`, \`Violet\`, \`Pink\`, \`Rose\`, and \`Slate\`, all with full dark-mode support) and freely combine heading styles (Default / Accent Bar / Numbered), quote styles, marker emphasis, paragraph spacing, text alignment, and letter spacing—paired with default Polaroid image frames, neutral cool-gray inline code, one-click current code line copy, and on-demand Maple Mono CN, LXGW WenKai, and Zhuque Fangsong fonts.
- **One-Click Copy with Formatting**: Select **"Copy with Formatting"** in the note menu or toolbar to convert your note's active typography, syntax highlighting, animated images, and Mermaid diagrams (automatically uploaded to your configured image host) into inline-CSS rich text ready to paste into WeChat Official Account, Substack, Medium, X Articles, or WordPress.

### 9 Exquisite Share Card & Code Themes (Share as Image)
Click **"Share as Image"** in the top-right menu to render any note or selection into a high-resolution social card or long image:
- **9 Curated Themes**: \`Glass\`, \`Quote\`, \`Book\`, \`Memo\`, \`Bento\`, \`Black Sun\`, \`Frame\`, \`Handwritten\`, and a dedicated developer \`Code\` theme with window chrome and line numbers.
- **Font Affinity & Custom Layout**: Paired with Alibaba PuHuiTi, MiSans, Huiwen Mincho, Source Han Serif, Long Cang, and Geist Mono fonts; switch between compact, standard, or wide card widths and export as high-resolution PNG or JPEG.

---

## 4. Multi-Modal Canvas: Diagrams, AI Infographics, Structured Tables & Posters

EdgeEver transcends traditional plain text notes with native visual and structured data canvases:

### Native Diagram Suite
- **System Architecture (Architecture)**: Designed for microservices and cloud topologies with labeled boundaries, cloud icons, and automated layout;
- **Business Workflows (Flowchart)**: Standard terminators, decisions, and process nodes to map workflows cleanly;
- **Second Brain Mind Maps (Mind Map)**: Radial trees and grouped topics that can also be generated directly via natural language in the AI companion sidebar.

### AntV AI Infographic Engine (Infographic)
Powered by AntV and AI Agents:
- Select from Timelines, Steps, Quadrants, and Comparison matrices;
- **Conversational Refinement**: Instruct the AI in natural language directly in the infographic sidebar (e.g. "highlight v2 plugin ecosystem and migration milestones" or "convert to a timeline") to adjust layouts with full revision history and vector export.

### Multi-Dimensional Structured Tables (Structured Table)
Engineered for product roadmaps, content pipelines, asset tracking, and form collection:
- **Rich Field Types**: Native support for Text, Number, Single Select, Date, Checkbox, URL, and **Multi-File Attachments**;
- **Named Views, Typed Filtering & Multi-Field Sorting**: Create multiple **named views** on the same table (such as "All Records", "AI & Ecosystem", or "With Spec Docs"), combine \`All\` / \`Any\` typed filter rules (including date ranges, this week, and non-empty attachments), and stack multi-column sort orders;
- **AI Table Generation & Public Forms**: Describe a database in natural language to auto-generate schema and sample rows, or click **"Form Collection"** to publish a login-free public form that writes submissions directly into your table in real time.

### Native Poster Design Studio (Poster Canvas)
Choose **"Create Poster"** from the note menu (or **New → Poster**) to launch the canvas poster studio featuring 40+ design templates across 3:4, 1:1, and landscape aspect ratios. Double-click any canvas element to edit copy, colors, and layout.

---

## 5. Power Productivity: Slash Commands, Backlinks, Math & Granular Sharing

### Slash Commands
Type \`/\` or press \`Space\` on an empty line to invoke the command menu:
- Insert \`H1/H2/H3\` headings, collapsible details blocks, quotes, dividers, code blocks, and rich tables;
- Use \`/date\`, \`/time\`, or \`/now\` to insert current timestamps instantly;
- Attach files, insert images, or summon the inline AI assistant.

### Bi-directional Note Links & Note Merging
Type \`@\` or insert \`#memo=<memoId>\` links (e.g. \`#memo=memo_demo_infographic_en\`) to establish bi-directional references across your workspace; select multiple notes to merge them into a long-term note separated by subtle faded hairline dividers.

### Granular Single-Note Sharing & Standalone Knowledge Sites
- **Granular Share Links**: Customize your shared note's short slug, set an independent access password, configure an optional expiration date, track open counts, browse with a collapsible outline, or access the Raw Markdown link;
- **Notebook Knowledge Base Publishing**: Right-click any notebook to publish it as a standalone static knowledge base website with tree navigation and optional password protection.

### KaTeX Professional LaTeX Mathematics
Native support for KaTeX renders complex mathematical equations in milliseconds:

- **Inline Math**: For instance, Einstein's mass-energy equivalence $E = mc^2$ or the Gaussian probability density function $f(x) = \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$.
- **Display Block Math**:
$$
\\oint_{\\partial \\Omega} \\mathbf{E} \\cdot d\\mathbf{S} = \\frac{1}{\\varepsilon_0} \\iiint_{\\Omega} \\rho \\, dV, \\quad \\oint_{\\partial \\Omega} \\mathbf{B} \\cdot d\\mathbf{S} = 0
$$

### Interactive Task Lists
- [x] Explore EdgeEver's dual-view editing, magazine cover, and collapsible chapter outline
- [x] Experiment with 9 prose palettes, 9 share card themes, and "Copy with Formatting"
- [x] View the 【AI Infographic】 v2.30 milestones and 【Structured Table】 named views
- [ ] Try one-click GUI import from Notion, Evernote, Obsidian, or flomo in Settings → Backup & Import
- [ ] Connect your AI API Key or pair local desktop agents via ACP
- [ ] Browse Settings → Plugins & Themes to install cross-device extensions

---

## 6. Native AI Synergy, MCP/ACP Protocols & Open Plugin Ecosystem

EdgeEver is architected for the agentic AI era, weaving LLMs, remote/local agents, and extensible plugins directly into your knowledge lifecycle:

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant User as Creator / Knowledge Worker
    participant Client as EdgeEver Clients
    participant Protocol as EdgeEver MCP (/mcp) & Desktop ACP
    participant Agent as AI Agent (Claude / Codex / Cursor / Antigravity)
    participant Ecosystem as Plugins / External Knowledge Bases

    User->>Client: Capture notes, clip social posts, or attach audio/video
    Agent->>Protocol: Query context & unprocessed memos (memo_search / get_memo)
    Protocol-->>Agent: Returns Markdown, table schema & attachment metadata
    Agent->>Agent: Extracts takeaways, builds diagrams/tables & suggests tags
    Agent->>Protocol: Atomically writes back notes, records & bound attachments
    Agent->>Ecosystem: Triggers Tasks / AI RSS plugins or external workflows
    Client-->>User: Sub-second incremental sync across all devices
\`\`\`

### 1. Inline & Companion AI Assistant
Press **\`Space\`** on an empty line, type **\`/ai\`**, click the **AI button** on the selection toolbar, or open the right-hand **AI Companion Sidebar**:
- **Summarization, Polishing & Format-Preserving Translation**: Condense notes into action items or translate across languages while strictly preserving Markdown, math formulas, links, and code blocks;
- **Smart Output Budgets & Multi-Part Anti-Truncation**: Automatically detects model token limits (with \`models.dev\` fallback), splits long generations into seamless continuations, and supports sidebar body drafts so long outputs never truncate;
- **AI Audio & Video Transcription**: Extracts audio tracks client-side, segments automatically, and connects directly to OpenAI-compatible speech models to transcribe and insert text into your note;
- **Direct BYOK Privacy (Bring Your Own Key)**: Connects directly from your client to OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and compatible providers with zero third-party transit.

### 2. Dual Agent Protocols: Remote MCP & Desktop ACP
- **Model Context Protocol (\`/mcp\`)**: Generate a token in **Profile → API / MCP** to let Claude Code, Codex, Cursor, and Antigravity manage text notes, diagrams, infographics, structured tables, poster notes, attachments (supporting atomic pre-upload and binding), revisions, templates, and AI instructions;
- **Desktop ACP Local Agent Synergy**: On the desktop app, connect directly to local agents installed on your machine—including **Codex, Claude Code, Antigravity, WorkBuddy, and CodeBuddy**—for side-by-side reasoning, search, and co-writing.

### 3. Open Plugin API & Theme Marketplace (\`@edgeever/plugin-api\`)
Install functional plugins and custom themes from the official marketplace, GitHub repositories, or manifest URLs in **Settings → Plugins & Themes**, automatically synced across Web and desktop:
- **Rich Extension Capabilities**: Plugins can read/write notes, interact with the editor, register custom sidebar panels and commands, invoke workspace AI models, and schedule background jobs—alongside no-code theme customization;
- **Official Open-Source Reference Plugins**: Includes **EdgeEver Tasks** (aggregates Markdown tasks across notes with status filters and jump links) and **EdgeEver AI RSS** (fetches feeds and generates categorized AI daily briefings).

---

## 7. Cross-Platform Native Apps, 20+ Platform Clipper & WeChat Archiving

- **Full-Platform Native Clients**:
  - **Web / PWA**: Runs in any modern browser with offline installation and 9 localized interface languages (Simplified/Traditional Chinese, English, Spanish, German, French, Japanese, Polish, Russian);
  - **macOS / Windows / Linux Desktop**: Built on Electron + a high-performance Rust Sidecar (macOS Apple Silicon & Intel, Windows x64, Linux x86_64 AppImage) featuring local SQLite mirroring, silent updates, **global hotkey region screenshot capture**, **automatic re-upload when attachments are edited in external apps**, **multi-window note editing**, and Windows Explorer "Send to EdgeEver" context menu;
  - **iOS Native App**: Pure Swift / SwiftUI with GRDB local mirror, available on the App Store (non-mainland China Apple ID);
  - **Android Native App**: Built with Expo & SQLite with system share-sheet integration, available on Google Play and GitHub Releases.
- **20+ Platform Structured Web Clipper**:
  - Available on Chrome, Edge, and Firefox stores for clean article clipping, region screenshot clipping, and context-menu text/image saving;
  - **Tailored Structured Extractors for 20+ Sites**: Deeply adapted for **X (Twitter, including quote tweets & media galleries)**, **Reddit**, **GitHub (structured repository cards)**, **Instagram (multi-photo carousels)**, **Medium**, **Substack**, **Hacker News**, **YouTube**, **Bilibili**, **Xiaohongshu (RED)**, **WeChat Official Accounts**, **Zhihu**, **Threads**, **Bluesky**, **Douban**, **Jike**, **V2EX**, **Xiaoyuzhou**, and more.
- **WeChat Ecosystem Integration**:
  - **One-Click WeChat Chat Archiving**: Multi-select messages in WeChat, choose "Combine and Forward → Open in Another App → EdgeEver" (**supported on both mobile share sheet and desktop import**), and automatically convert conversations into searchable notes with timestamps, speakers, quotes, emojis, inline images, and file attachments;
  - **Mobile Article & Image Share**: Share any WeChat article or image from your phone's system share sheet to EdgeEver to extract clean Markdown and original images in the background.
- **Offline First & Resilient Sync**: Keep writing on flights or subways; changes queue locally and reconcile automatically via incremental sync cursors once online.

---

## 8. Seamless Migration, Encrypted Backups, Image Hosts & Zero-Cost Self-Hosting

### One-Click GUI Migration from 7 Note Platforms
In **Settings → Backup & Import → Import from Other Apps**, drag and drop export files, folders, or archives directly in the Web or desktop UI—no CLI required:
- **7 Supported Sources**: Native support for **Notion**, **SiYuan**, **flomo**, **Evernote (\`.enex\`)**, **Obsidian**, **Joplin**, and **Generic Markdown Files & Directory Trees**;
- **Lossless Structure Preservation**: Automatically preserves folder hierarchies, creation dates, tags, and embedded images/attachments (including long Evernote titles, task metadata, and standalone attachment notes).

### Client-Side WebP Compression, S3 Storage & External Image Hosts
Pasted or dragged high-resolution images are compressed to WebP locally in your browser before upload, **reducing file size by 50% - 90%** while supporting chunked streaming uploads up to **1 GiB** for large attachments.
- **S3-Compatible OSS Storage**: Instance owners can mount any S3-compatible object storage in Advanced Settings;
- **CloudFlare ImgBed & PicGo Image Hosts**: Both Web (HTTPS) and desktop apps can upload new images directly to self-hosted **CloudFlare ImgBed** (with channel list selection and \`{Y}/{m}/{d}\` / \`{memoId}\` path placeholders); the desktop app also supports local or NAS **PicGo / PicList** uploaders.

![EdgeEver Official Logo](/api/v1/resources/res_demo_logo/blob)

### Universal Attachments & External Edit Auto-Save
Embed Word documents, PDFs, spreadsheets, archives, and media files directly in notes; on desktop, opening an attachment in an external editor and saving automatically syncs the updated file back to your note:

[📝 Meeting notes Word: edgeever-meeting-notes.docx](/api/v1/resources/res_demo_meeting_notes_docx/blob)

[📄 Product brief PDF: edgeever-product-brief.pdf](/api/v1/resources/res_demo_product_brief_pdf/blob)

[📊 Feature matrix CSV: feature-matrix.csv](/api/v1/resources/res_demo_feature_matrix_csv/blob)

[📦 Sample attachment archive: edgeever-attachment-demo.zip](/api/v1/resources/res_demo_attachment_bundle_zip/blob)

### Zero-Cost Serverless & Docker Self-Hosting
1. **Cloudflare Serverless (Recommended, 100% Free Forever)**: Runs entirely within Cloudflare's free tier (Workers + D1 SQLite + R2 Storage—roughly 150,000 short notes and 50,000 images) with zero server bills and automated upstream release syncing.
2. **Docker One-Command Deployment (VPS / NAS / Home Server)**:
   \`\`\`sh
   # Official GHCR image
   curl -fsSL https://edgeever.org/install.sh | bash
   \`\`\`
   Configures Docker Compose and automated daily background updates with one command. Some network environments in mainland China may require an available network proxy or a trusted registry mirror to access GHCR.

### Total Data Freedom & Enterprise-Grade Security: Lossless ZIP, Encrypted Backups & 2FA
- **Lossless ZIP Portability**: Export your entire library anytime into pure Markdown files with YAML Front Matter, relative media paths, and revision histories—ready for Obsidian, VS Code, or cross-instance restoration;
- **Scheduled Encrypted Desktop Backups & WebDAV**: Configure weekly/monthly automatic local backups on desktop (with snapshot rotation and optional \`.edgeever.enc\` password encryption) and automatic replication to **WebDAV** (NAS or private cloud);
- **Account Security & Multi-Workspace Isolation**: Multi-user physical workspace isolation with storage quota breakdowns, brute-force rate limiting, **per-account TOTP two-factor authentication (2FA) with recovery codes**, and active session management.

---

> 💡 **Quick Exploration Tips**:
> 1. Click **\`</>\`** in the top right to toggle dual views, or open the appearance menu to try **9 prose palettes and magazine covers**;
> 2. Explore the **AI Infographic**, **Structured Table (try switching named views, filters & multi-sort at the top)**, and **Visual Poster** examples in the sidebar;
> 3. Press **\`Cmd/Ctrl + E\`** to test reading protection mode against accidental edits;
> 4. Press **\`Cmd/Ctrl + O\`** to summon the Quick Switcher;
> 5. Try Sharing & Publishing: set custom slugs, passwords, expiry, and collapsible outlines on single notes, or right-click any notebook to publish a standalone knowledge base site;
> 6. Click **"Copy with Formatting"** in the note menu to copy rich text ready for WeChat, Substack, or Medium;
> 7. Click **"Share as Image"** to preview and export the 9 curated card themes including Glass, Quote, Book, and Code;
> 8. Click **"Reset Demo Data"** in settings or the sidebar anytime to restore the demo workspace.
`,
  },
  memo_demo_poster: {
    title: "Visual Design: EdgeEver Geek Second Brain Poster Note",
    markdown: serializePosterDocument(DEMO_POSTER_DOCUMENT_EN),
  },
  memo_demo_infographic: {
    title: "Evolution Milestones: EdgeEver Architecture & Release History",
    markdown: serializeInfographicDocument(DEMO_INFOGRAPHIC_DOCUMENT_EN),
  },
  memo_demo_table: {
    title: "Delivery Tracking: EdgeEver Product Roadmap & Release Status",
    markdown: serializeTableDocument(DEMO_TABLE_DOCUMENT_EN),
  },
  memo_demo_architecture: {
    title: "System Architecture: EdgeEver Portable Full Stack & AI Collaboration",
    markdown: serializeDiagramDocument(DEMO_ARCHITECTURE_DIAGRAM_EN),
  },
  memo_demo_flowchart: {
    title: "Knowledge Workflow: From Capturing Ideas to Publishing",
    markdown: serializeDiagramDocument(DEMO_FLOWCHART_DIAGRAM_EN),
  },
  memo_demo_mind_map: {
    title: "Second Brain: A Personal Knowledge System Mind Map",
    markdown: serializeDiagramDocument(DEMO_MIND_MAP_DIAGRAM_EN),
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
    markdown: memo.id === "memo_demo_overview" ? `${english.markdown}${DEMO_ATTACHMENT_MARKDOWN_EN}` : english.markdown,
  };
}).filter((memo): memo is NonNullable<typeof memo> => memo !== null);

export const DEMO_SEED_MEMOS_ZH_WITH_ATTACHMENTS = DEMO_SEED_MEMOS_ZH.map((memo) => ({
  ...memo,
  markdown: memo.id === "memo_demo_overview" ? `${memo.markdown}${DEMO_ATTACHMENT_MARKDOWN_ZH}` : memo.markdown,
}));

export const DEMO_SEED_MEMOS = [...DEMO_SEED_MEMOS_ZH_WITH_ATTACHMENTS, ...DEMO_SEED_MEMOS_EN];

export const DEMO_SEED_RESOURCES = [
  {
    id: "res_demo_logo",
    memoId: "memo_demo_overview",
    filename: "edgeever-icon.svg",
    mimeType: "image/svg+xml",
    width: 1024,
    height: 1024,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc"><title id="title">EdgeEver</title><desc id="desc">An open cat face in near-black on the EdgeEver green rounded tile.</desc><rect x="100" y="100" width="824" height="824" rx="188" fill="#24cf83" /><g transform="translate(100 100) scale(0.74234234) translate(-72 -72)"><path fill="#07130b" fill-rule="evenodd" d="M253.5 707.5Q249 678 249.5 655Q250 632 253.5 611.5Q257 591 264.5 568.5Q272 546 281 530Q290 514 287 485Q284 456 283.5 417Q283 378 285 351.5Q287 325 292 299Q297 273 304.5 254.5Q312 236 318.5 227.5Q325 219 336 213Q347 207 358.5 207.5Q370 208 383 213.5Q396 219 407 226.5Q418 234 428 242.5Q438 251 455 268.5Q472 286 485.5 303.5Q499 321 510.5 339Q522 357 528 368.5Q534 380 534 385.5Q534 391 532.5 394.5Q531 398 527.5 401Q524 404 518 405Q512 406 507 404Q502 402 499.5 399.5Q497 397 491.5 386Q486 375 474 357Q462 339 450.5 324.5Q439 310 426 296.5Q413 283 400.5 272.5Q388 262 377 255.5Q366 249 361 248Q356 247 352.5 249.5Q349 252 344.5 261Q340 270 337 280Q334 290 329 325.5Q324 361 323.5 400Q323 439 327 479.5Q331 520 321 538Q311 556 306 568.5Q301 581 297 596Q293 611 291 624.5Q289 638 289 661Q289 684 292 702Q295 720 301 739.5Q307 759 315.5 776.5Q324 794 335 810Q346 826 358 838.5Q370 851 386.5 863.5Q403 876 419.5 884.5Q436 893 456 899.5Q476 906 501 909.5Q526 913 529.5 916Q533 919 534.5 922Q536 925 536 931.5Q536 938 532.5 943Q529 948 524 950Q519 952 505.5 951Q492 950 473 946Q454 942 426 931Q398 920 385.5 912.5Q373 905 359.5 894.5Q346 884 333.5 871.5Q321 859 313 849Q305 839 291 815Q277 791 267.5 764Q258 737 253.5 707.5ZM719 941.5Q716 936 717 929Q718 922 721 918.5Q724 915 727 913.5Q730 912 749 910Q768 908 785 903.5Q802 899 823 889.5Q844 880 860.5 868.5Q877 857 887.5 847Q898 837 911 820Q924 803 932 788.5Q940 774 947.5 753.5Q955 733 959.5 708Q964 683 964 660.5Q964 638 960.5 617.5Q957 597 952.5 582.5Q948 568 943.5 558Q939 548 931 535Q923 522 927 479Q931 436 930.5 400Q930 364 925.5 329Q921 294 917 280Q913 266 909 258.5Q905 251 902 249Q899 247 893 248.5Q887 250 867.5 264Q848 278 835.5 290.5Q823 303 810.5 318Q798 333 783.5 354Q769 375 762 387.5Q755 400 751 402.5Q747 405 742 405.5Q737 406 732 404Q727 402 723.5 397Q720 392 720.5 385Q721 378 736.5 353Q752 328 768 307.5Q784 287 803.5 267Q823 247 834 238Q845 229 858.5 221Q872 213 881 210Q890 207 899.5 207Q909 207 918.5 212Q928 217 935.5 226.5Q943 236 949.5 252Q956 268 960 286Q964 304 967.5 344.5Q971 385 970.5 418Q970 451 967 482.5Q964 514 972 528Q980 542 986 558Q992 574 996 591Q1000 608 1002 624.5Q1004 641 1003.5 667Q1003 693 998 719.5Q993 746 985 768Q977 790 964.5 812Q952 834 940 849Q928 864 915.5 876Q903 888 892.5 896Q882 904 858 917Q834 930 820 935Q806 940 789.5 944Q773 948 753 950Q733 952 727.5 949.5Q722 947 719 941.5ZM378.5 728Q373 718 373 714.5Q373 711 375.5 708Q378 705 387 699Q396 693 405 689Q414 685 426 682.5Q438 680 447.5 680Q457 680 467.5 682Q478 684 490 690Q502 696 512.5 706.5Q523 717 530.5 733Q538 749 539.5 762Q541 775 537 778Q533 781 515.5 784Q498 787 481 786.5Q464 786 451 783Q438 780 428.5 775.5Q419 771 412 766Q405 761 394.5 749.5Q384 738 378.5 728ZM713.5 778Q710 775 710.5 767Q711 759 714 749Q717 739 723.5 727.5Q730 716 740.5 706Q751 696 762 690.5Q773 685 785.5 682.5Q798 680 813 681Q828 682 843.5 688Q859 694 869.5 702.5Q880 711 880 714.5Q880 718 871.5 732Q863 746 853 755.5Q843 765 830.5 772Q818 779 804 782.5Q790 786 772.5 786.5Q755 787 736 784Q717 781 713.5 778ZM406 710Q395 716 398 722.5Q401 729 410 738.5Q419 748 427 753Q435 758 441 760Q447 762 444.5 749.5Q442 737 442.5 726.5Q443 716 445 707.5Q447 699 432 701.5Q417 704 406 710ZM819.5 701Q806 699 808 708.5Q810 718 810 730.5Q810 743 808 750.5Q806 758 806 760Q806 762 807 762Q808 762 815 759Q822 756 830.5 750Q839 744 846 736Q853 728 855.5 722Q858 716 845.5 709.5Q833 703 819.5 701ZM471 759.5Q469 763 469 765Q469 767 472 767.5Q475 768 488.5 768Q502 768 512 766Q522 764 519.5 754Q517 744 511 734Q505 724 498.5 718Q492 712 484.5 708Q477 704 475.5 704Q474 704 475 723Q476 742 474.5 749Q473 756 471 759.5ZM733 750.5Q730 759 730 761.5Q730 764 737 765.5Q744 767 763.5 767Q783 767 779.5 752Q776 737 776 730.5Q776 724 778 714Q780 704 770.5 708Q761 712 753 719.5Q745 727 740.5 734.5Q736 742 733 750.5ZM592.5 848.5Q588 841 588 836.5Q588 832 590 829Q592 826 599.5 822.5Q607 819 613.5 818Q620 817 626.5 817Q633 817 642.5 819Q652 821 655 822.5Q658 824 661.5 828.5Q665 833 664.5 838Q664 843 659.5 850Q655 857 645 867Q635 877 631.5 878.5Q628 880 625 879.5Q622 879 617.5 876Q613 873 605 864.5Q597 856 592.5 848.5Z" />\n  </g>\n</svg>',
  },
  {
    id: "res_demo_cat_image",
    memoId: "memo_demo_overview",
    filename: "cute-cat-demo.svg",
    mimeType: "image/svg+xml",
    width: 960,
    height: 540,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" fill="none"><rect width="960" height="540" rx="32" fill="#f0fdfa"/><g transform="translate(480, 270) scale(2.2)"><path d="M-60,-20 C-60,-60 -30,-80 0,-80 C30,-80 60,-60 60,-20 C60,20 40,40 0,40 C-40,40 -60,20 -60,-20 Z" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M-45,-68 L-55,-100 L-20,-78" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M45,-68 L55,-100 L20,-78" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M-30,-25 Q-20,-15 -10,-25" stroke="#0f766e" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M10,-25 Q20,-15 30,-25" stroke="#0f766e" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M-5,-10 L5,-10 L0,-5 Z" fill="#0f766e"/><path d="M0,-5 Q-5,5 -10,2 M0,-5 Q5,5 10,2" stroke="#0f766e" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M-40,-5 L-65,-8" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M-42,5 L-68,7" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M40,-5 L65,-8" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M42,5 L68,7" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M-30,35 C-30,70 -10,90 0,90 C10,90 30,70 30,35" stroke="#0f766e" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M25,75 C45,75 55,60 55,45 C55,30 45,25 40,30 C35,35 40,45 45,45" stroke="#0f766e" stroke-width="6" stroke-linecap="round" fill="none"/></g></svg>',
  },
] as const;

export const DEMO_SEED_ATTACHMENT_RESOURCES = [...DEMO_SEED_RESOURCES, ...DEMO_ATTACHMENT_RESOURCES];
export const DEMO_SEED_NOTEBOOK_IDS = DEMO_SEED_NOTEBOOKS.map((notebook) => notebook.id);
export const DEMO_SEED_MEMO_IDS = DEMO_SEED_MEMOS.map((memo) => memo.id);
