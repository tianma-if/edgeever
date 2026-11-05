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
    { id: "client-desktop", label: "macOS / Windows\n桌面端", x: 68, y: 192, width: 156, height: 70, shape: "client", resourceIcon: "client", parentId: "boundary-clients" },
    { id: "client-ios", label: "iOS\nSwiftUI 原生端", x: 68, y: 302, width: 156, height: 70, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-android", label: "Android\nExpo 原生端", x: 68, y: 412, width: 156, height: 64, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-clipper", label: "浏览器剪藏\nChrome / Edge", x: 68, y: 516, width: 156, height: 70, shape: "client", resourceIcon: "website", parentId: "boundary-clients" },
    { id: "client-sync", label: "全端共享同步通道", x: 68, y: 626, width: 156, height: 64, shape: "service", resourceIcon: "apiClient", parentId: "boundary-clients" },

    { id: "platform-api", label: "统一 API 入口\n认证 · 限流 · 路由", x: 416, y: 363, width: 156, height: 70, shape: "service", resourceIcon: "apiGateway", parentId: "boundary-platform" },
    { id: "platform-core", label: "共享业务核心\nHono · 领域服务", x: 668, y: 304, width: 156, height: 70, shape: "service", resourceIcon: "service", parentId: "boundary-platform" },
    { id: "platform-sync", label: "同步与修订引擎\n离线队列 · 冲突控制", x: 920, y: 295, width: 156, height: 88, shape: "service", resourceIcon: "streamProcessing", parentId: "boundary-platform" },
    { id: "platform-mcp", label: "原生 MCP 端点\n智能体读写工具", x: 416, y: 235, width: 156, height: 88, shape: "service", resourceIcon: "mcpServer", parentId: "boundary-platform" },
    { id: "platform-model", label: "端侧模型网关\nBYOK 隐私直连", x: 416, y: 473, width: 156, height: 70, shape: "service", resourceIcon: "modelGateway", parentId: "boundary-platform" },

    { id: "data-search", label: "搜索与语义索引\n全文 · 向量", x: 1239, y: 446, width: 150, height: 72, shape: "database", resourceIcon: "vectorDatabase", parentId: "boundary-data" },
    { id: "data-sql", label: "D1 / SQLite\n笔记 · 标签 · 修订", x: 1239, y: 558, width: 150, height: 72, shape: "database", resourceIcon: "relationalDatabase", parentId: "boundary-data" },
    { id: "data-objects", label: "R2 / S3\n图片与附件", x: 1236, y: 670, width: 156, height: 64, shape: "storage", resourceIcon: "objectStorage", parentId: "boundary-data" },

    { id: "ecosystem-agents", label: "Claude / Cursor\n自动化智能体", x: 1236, y: 118, width: 156, height: 70, shape: "external", resourceIcon: "aiAgent", parentId: "boundary-ecosystem" },
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
    { id: "client-desktop", label: "macOS / Windows\nDesktop", x: 68, y: 203, width: 156, height: 70, shape: "client", resourceIcon: "client", parentId: "boundary-clients" },
    { id: "client-ios", label: "iOS\nNative SwiftUI", x: 68, y: 313, width: 156, height: 70, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-android", label: "Android\nNative Expo", x: 68, y: 423, width: 156, height: 64, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-clipper", label: "Web Clipper\nChrome / Edge", x: 68, y: 527, width: 156, height: 70, shape: "client", resourceIcon: "website", parentId: "boundary-clients" },
    { id: "client-sync", label: "Shared Cross-Client Sync", x: 68, y: 637, width: 156, height: 64, shape: "service", resourceIcon: "apiClient", parentId: "boundary-clients" },

    { id: "platform-api", label: "Unified API Entry\nAuth · Limits · Routing", x: 416, y: 365, width: 156, height: 88, shape: "service", resourceIcon: "apiGateway", parentId: "boundary-platform" },
    { id: "platform-core", label: "Shared Business Core\nHono · Domain Services", x: 668, y: 301, width: 156, height: 88, shape: "service", resourceIcon: "service", parentId: "boundary-platform" },
    { id: "platform-sync", label: "Sync & Revision Engine\nOffline Queue · Conflicts", x: 920, y: 301, width: 156, height: 88, shape: "service", resourceIcon: "streamProcessing", parentId: "boundary-platform" },
    { id: "platform-mcp", label: "Native MCP Endpoint\nAgent Read/Write Tools", x: 416, y: 237, width: 156, height: 88, shape: "service", resourceIcon: "mcpServer", parentId: "boundary-platform" },
    { id: "platform-model", label: "Client Model Gateway\nPrivate BYOK", x: 416, y: 493, width: 156, height: 70, shape: "service", resourceIcon: "modelGateway", parentId: "boundary-platform" },

    { id: "data-search", label: "Search & Semantic Index\nFull Text · Vectors", x: 1239, y: 452, width: 150, height: 106, shape: "database", resourceIcon: "vectorDatabase", parentId: "boundary-data" },
    { id: "data-sql", label: "D1 / SQLite\nNotes · Tags · Revisions", x: 1239, y: 598, width: 150, height: 88, shape: "database", resourceIcon: "relationalDatabase", parentId: "boundary-data" },
    { id: "data-objects", label: "R2 / S3\nImages & Attachments", x: 1236, y: 726, width: 156, height: 70, shape: "storage", resourceIcon: "objectStorage", parentId: "boundary-data" },

    { id: "ecosystem-agents", label: "Claude / Cursor\nAutomation Agents", x: 1236, y: 88, width: 156, height: 88, shape: "external", resourceIcon: "aiAgent", parentId: "boundary-ecosystem" },
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
    { id: "capture-clip", label: "网页剪藏", x: 520, y: 32, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-quick", label: "随手记录", x: 520, y: 88, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-files", label: "图片与附件", x: 520, y: 144, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "organize-notebooks", label: "树状笔记本", x: 520, y: 200, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "organize-tags", label: "标签与搜索", x: 520, y: 256, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "connect-links", label: "双向链接", x: 520, y: 312, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "connect-mcp", label: "MCP 智能体", x: 520, y: 368, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "create-writing", label: "沉浸写作", x: 520, y: 424, width: 112, height: 36, shape: "topic", parentId: "create" },
    { id: "create-share", label: "发布与分享", x: 520, y: 480, width: 112, height: 36, shape: "topic", parentId: "create" },
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
    { id: "capture-clip", label: "Web clipping", x: 520, y: 32, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-quick", label: "Quick notes", x: 520, y: 88, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-files", label: "Images & files", x: 520, y: 144, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "organize-notebooks", label: "Notebook tree", x: 520, y: 200, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "organize-tags", label: "Tags & search", x: 520, y: 256, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "connect-links", label: "Backlinks", x: 520, y: 312, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "connect-mcp", label: "MCP agents", x: 520, y: 368, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "create-writing", label: "Focused writing", x: 520, y: 424, width: 112, height: 36, shape: "topic", parentId: "create" },
    { id: "create-share", label: "Publish & share", x: 520, y: 480, width: 112, height: 36, shape: "topic", parentId: "create" },
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
    - label v1.0 架构奠基
      desc 经典三栏美学、Serverless D1 存储与双向同步游标
    - label v1.50 智能体与全端
      desc 原生 MCP 协议端点 (/mcp)、双端原生移动客户端与剪藏矩阵
    - label v1.88 结构化知识台
      desc AI 智能信息图、多维结构化表格与可视化图表体系
    - label v1.100 双协议与生态
      desc 桌面端 ACP 深度驱动本地 Agent、知识库独立发布与全平台客户端
    - label v1.120 视觉表现与排版
      desc 原生海报笔记与画布排版、微信聊天完整归档与全场景自建部署`;

export const DEMO_INFOGRAPHIC_SYNTAX_EN = `infographic sequence-timeline-rounded-rect-node
data
  title EdgeEver Evolution Milestones
  sequences
    - label v1.0 Foundation
      desc Classic three-pane layout, Serverless D1 storage & sync cursors
    - label v1.50 Agents & Mobile
      desc Native MCP endpoint (/mcp), native mobile apps & clipping matrix
    - label v1.88 Structured Workspace
      desc AI-driven infographics, structured tables & visual diagram suite
    - label v1.100 Dual Protocols & Web
      desc Desktop ACP for local agents, public notebook site publishing & full platform apps
    - label v1.120 Visual Canvas & Layout
      desc Native poster notes & canvas layout, WeChat chat archiving & flexible self-hosting`;

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
      text: "01 · 原生 MCP / ACP 双协议支持",
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
      text: "原生对接 Claude、Cursor、Codex 等外部 Agent，桌面端无缝协同本地智能体。",
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
      text: "02 · 零成本 Serverless 与自由部署",
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
      text: "跑在 Cloudflare 免费额度内或一键 Docker 自建，标准 SQLite 存储，导出无阻碍。",
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
      text: "03 · 全平台客户端与独立知识库",
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
      text: "macOS、Windows、Linux、iOS 与 Android 覆盖，支持一键将笔记本发布为知识库网站。",
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
      text: "01 · Native MCP & ACP Dual Protocols",
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
      text: "Connect Claude, Cursor, and Codex via MCP, and drive local agents seamlessly via ACP on desktop.",
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
      text: "02 · 100% Free Serverless & Self-Hosting",
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
      text: "Run within Cloudflare free quotas or one-command Docker on your VPS/NAS with standard SQLite storage.",
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
      text: "03 · Full-Platform Apps & Knowledge Sites",
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
      text: "Native coverage on macOS, Windows, Linux, iOS & Android; publish entire notebooks as standalone sites.",
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
  schemaVersion: 1,
  fields: [
    { id: "fld_feature", name: "功能特性", type: "text" },
    { id: "fld_category", name: "模块分类", type: "select", options: ["AI 智能体", "多端客户端", "图表与可视化", "数据与架构"] },
    { id: "fld_status", name: "交付状态", type: "select", options: ["已正式发布", "公测迭代中", "规划中"] },
    { id: "fld_verified", name: "验收通过", type: "checkbox" },
    { id: "fld_date", name: "发布日期", type: "date" },
    { id: "fld_docs", name: "规格文档", type: "attachment" },
  ],
  records: [
    {
      id: "rec_poster",
      cells: {
        fld_feature: "原生海报笔记与画布排版",
        fld_category: "图表与可视化",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-05",
        fld_docs: [],
      },
    },
    {
      id: "rec_acp",
      cells: {
        fld_feature: "桌面端 ACP 本地智能体协同",
        fld_category: "AI 智能体",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-08",
        fld_docs: [],
      },
    },
    {
      id: "rec_notebook_site",
      cells: {
        fld_feature: "笔记本公开发布独立知识库",
        fld_category: "数据与架构",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-10-10",
        fld_docs: [],
      },
    },
    {
      id: "rec_platforms",
      cells: {
        fld_feature: "全平台客户端 (macOS / Win / Linux / iOS / Android)",
        fld_category: "多端客户端",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-09-28",
        fld_docs: [{ resourceId: "res_demo_attachment_bundle_zip", filename: "edgeever-attachment-demo.zip", mimeType: "application/zip", byteSize: 153 }],
      },
    },
    {
      id: "rec_infographic",
      cells: {
        fld_feature: "AntV AI 信息图笔记",
        fld_category: "图表与可视化",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-09-15",
        fld_docs: [{ resourceId: "res_demo_feature_matrix_csv", filename: "feature-matrix.csv", mimeType: "text/csv", byteSize: 99 }],
      },
    },
    {
      id: "rec_table",
      cells: {
        fld_feature: "多维结构化表格与公开表单",
        fld_category: "图表与可视化",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-09-20",
        fld_docs: [{ resourceId: "res_demo_product_brief_pdf", filename: "edgeever-product-brief.pdf", mimeType: "application/pdf", byteSize: 349 }],
      },
    },
    {
      id: "rec_mcp",
      cells: {
        fld_feature: "原生 MCP 服务端点 (/mcp)",
        fld_category: "AI 智能体",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-08-10",
        fld_docs: [],
      },
    },
    {
      id: "rec_clipper",
      cells: {
        fld_feature: "Web Clipper 剪藏与微信聊天归档",
        fld_category: "多端客户端",
        fld_status: "已正式发布",
        fld_verified: true,
        fld_date: "2026-09-25",
        fld_docs: [],
      },
    },
  ],
  view: {
    filters: [],
    sort: null,
  },
};

export const DEMO_TABLE_DOCUMENT_EN: TableDocument = {
  schemaVersion: 1,
  fields: [
    { id: "fld_feature", name: "Feature", type: "text" },
    { id: "fld_category", name: "Category", type: "select", options: ["AI Agents", "Cross-Platform", "Visuals & Data", "Data & Architecture"] },
    { id: "fld_status", name: "Status", type: "select", options: ["Released", "Public Beta", "Planned"] },
    { id: "fld_verified", name: "Verified", type: "checkbox" },
    { id: "fld_date", name: "Release Date", type: "date" },
    { id: "fld_docs", name: "Documents", type: "attachment" },
  ],
  records: [
    {
      id: "rec_poster",
      cells: {
        fld_feature: "Native Poster Notes & Canvas Layout",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-05",
        fld_docs: [],
      },
    },
    {
      id: "rec_acp",
      cells: {
        fld_feature: "Desktop ACP Local Agent Integration",
        fld_category: "AI Agents",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-08",
        fld_docs: [],
      },
    },
    {
      id: "rec_notebook_site",
      cells: {
        fld_feature: "Notebook Knowledge Base Web Publishing",
        fld_category: "Data & Architecture",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-10",
        fld_docs: [],
      },
    },
    {
      id: "rec_platforms",
      cells: {
        fld_feature: "Full-Platform Apps (macOS / Win / Linux / iOS / Android)",
        fld_category: "Cross-Platform",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-28",
        fld_docs: [{ resourceId: "res_demo_attachment_bundle_zip", filename: "edgeever-attachment-demo.zip", mimeType: "application/zip", byteSize: 153 }],
      },
    },
    {
      id: "rec_infographic",
      cells: {
        fld_feature: "AntV AI Infographic Notes",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-15",
        fld_docs: [{ resourceId: "res_demo_feature_matrix_csv", filename: "feature-matrix.csv", mimeType: "text/csv", byteSize: 99 }],
      },
    },
    {
      id: "rec_table",
      cells: {
        fld_feature: "Structured Tables & Public Forms",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-20",
        fld_docs: [{ resourceId: "res_demo_product_brief_pdf", filename: "edgeever-product-brief.pdf", mimeType: "application/pdf", byteSize: 349 }],
      },
    },
    {
      id: "rec_mcp",
      cells: {
        fld_feature: "Native MCP Endpoint (/mcp)",
        fld_category: "AI Agents",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-08-10",
        fld_docs: [],
      },
    },
    {
      id: "rec_clipper",
      cells: {
        fld_feature: "Web Clipper & WeChat Chat Archiving",
        fld_category: "Cross-Platform",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-25",
        fld_docs: [],
      },
    },
  ],
  view: {
    filters: [],
    sort: null,
  },
};

export const DEMO_SEED_MEMOS_ZH = [
  {
    id: "memo_demo_overview",
    notebookId: "nb_demo_features",
    title: "欢迎使用 EdgeEver：为极客与创作者打造的现代开源知识库",
    tags: ["overview", "guide", "features", "ai-agent"],
    isPinned: true,
    markdown:
      `> **EdgeEver** 是一款兼具**经典三栏美学**与 **AI 原生动力**的开源 Serverless / 容器化个人知识库。它既找回了极客们钟爱的经典印象笔记式双视图与树状目录，又以零服务器成本、完全数据自主、全端原生覆盖与深度 MCP 智能体协同，重新定义了下一代个人第二大脑。

---

## 1. 为什么选择 EdgeEver？

*提示：在编辑器模式下，你可以直接点击任意表格单元格进行行内编辑，或右键快捷插入/删除行列。*

| 核心维度 | 传统商业云笔记 (如 Evernote) | 本地离线知识库 (如 Obsidian) | EdgeEver 极客知识库 |
| :--- | :--- | :--- | :--- |
| **源代码** | 闭源 | 核心闭源，文件开放 | **整栈开源 (AGPL-3.0)** |
| **云端托管成本** | 商业订阅高昂（$10+/月） | 官方云同步收费（$5+/月） | **100% 永久免费 (Cloudflare 免费额度 / Docker 自建)** |
| **数据资产所有权** | 专有格式封闭，导出困难 | 本地 Markdown，移动端同步繁琐 | **完全自主掌控 (D1 SQLite 数据库 / R2 / 无损 ZIP 导出)** |
| **写作与表达矩阵** | 仅富文本，排版易错乱 | 纯 Markdown，缺乏沉浸所见即所得 | **双视图自由切换 (所见即所得 ⇄ 源码) + 原生架构图/流程图/思维导图/AI信息图/多维结构化表格/原生海报笔记** |
| **自媒体排版分发** | 无样式优化，格式丢失 | 需借助外部排版扩展或工具 | **一键复制到微信公众号 / Substack / Medium / WordPress** |
| **社交卡片分享** | 截图粗糙或无排版设计 | 需第三方插件实现 | **内置 8 款精美海报主题，支持自定义字体与 PNG/JPEG 导出** |
| **AI 原生集成生态** | 封闭收费，仅限特定功能 | 需配置复杂的第三方插件 | **原生内置 MCP 服务端点 (\`/mcp\`)、桌面端 ACP 本地智能体协同与行内 AI 助手** |
| **全平台多端覆盖** | 限制免费设备登录数量 | 多端同步与移动端体验门槛高 | **Web / PWA / Android / iOS / macOS / Windows / Linux AppImage** |

---

## 2. 全景架构与生态联动

通过下面的 Mermaid 架构图，你可以清晰了解 EdgeEver 如何将多端客户端、零成本云基础设施与 AI Agent 紧密串联：

\`\`\`mermaid
flowchart LR
    subgraph ClientsBox["全端客户端与智能体"]
        Clients["全端客户端矩阵<br/>Web · PWA · 桌面客户端<br/>iOS · Android · 浏览器剪藏"]
        Agents["外部 AI 智能体<br/>Claude Code · Cursor · Antigravity"]
    end

    subgraph Platform["EdgeEver 平台核心 (Cloudflare Workers / Docker)"]
        API["统一 REST API 入口<br/>认证鉴权 · 限流 · 增量同步游标"]
        MCP["原生 MCP 服务端点 (/mcp)<br/>上下文感知 · 工具读写协议"]
    end

    subgraph BackendBox["AI 模型与数据存储"]
        LLMs["主流大语言模型 (BYOK 直连)<br/>OpenAI · Gemini · DeepSeek"]
        Storage[("数据与对象存储<br/>Cloudflare D1 / SQLite · R2 / S3 兼容")]
    end

    Clients <-->|HTTPS 增量同步| API
    Clients -->|BYOK 客户端直连 · 隐私安全| LLMs
    Agents <-->|MCP Tools / SSE 协议| MCP
    API <--> Storage
    MCP <--> Storage
\`\`\`

---

## 3. 极致创作体验与排版美学

EdgeEver 将高效与优雅融入每一处交互细节，助你专注于思考与表达：

### 双视图编辑器与沉浸模式
- **自由切换视图**：点击右上角 \`</>\` 按钮或使用快捷键，可在**所见即所得富文本**与 **Markdown 源码**间无缝切换，实时双向保真。
- **左侧可折叠大纲**：自动解析文档 \`H1-H3\` 标题层级，支持点击平滑滚动跳转，助你轻松把控万字长文。
- **Zen 专注模式**：按下 \`Cmd/Ctrl + Shift + F\`，隐藏所有侧边栏与干扰元素，进入纯粹写作心流。
- **阅读保护模式 (Reading Protection)**：日常翻阅或查阅笔记时，按下 \`Cmd/Ctrl + E\` 即可一键开启只读保护，锁定当前编辑状态，避免沉浸阅读时误触键盘或意外改动笔记内容；再次按下即可随手切回编辑。

### 精选排版主题与一键自媒体发布
- **内置排版主题**：支持一键切换 \`微信新绿\`、\`薄荷清新\`、\`极简青翠\`、\`线描翠绿\`，以及日暖素笺、青页讲义、夜蓝制图等排版风格，并支持朱雀仿宋、霞鹜文楷等正文字体。
- **一键排版复制**：专为内容创作者设计。点击顶部工具栏的**微信公众号图标**，系统自动将当前笔记转为内联 CSS 样式的优雅富文本，直接粘贴至微信公众号后台、Substack 或 WordPress，排版与代码高亮完美保真。

### 8 套精美社交分享海报 (Poster Cards)
点击右上角“分享为卡片”，即可将任意笔记或片段渲染为高清分享海报，支持：
- **8 大主题风格**：\`Slate (岩灰)\`、\`Aurora (极光青)\`、\`Sunset (落日暖橙)\`、\`Midnight (暗夜极客)\`、\`Mint (清爽薄荷)\`、\`Notepad (复古便签)\`、\`Xuan (宣纸水墨)\`、\`Lavender (薰衣草紫)\`。
- **排版定制**：支持无衬线 (Sans)、宋体/明朝 (Serif)、等宽代码 (Mono) 字体切换，自由选择紧凑、标准或宽幅卡片，一键导出为高清晰度 PNG 或 JPEG 图片。

---

## 4. 丰富表达力：图表、AI 信息图与多维表格

EdgeEver 打破了传统笔记单一文本的局限，提供多种原生可视化与结构化数据载体：

### 原生图表体系
- **系统架构图 (Architecture)**：针对分布式系统与微服务设计，支持分层边界、图标元数据与自动拓扑排版；
- **业务流程图 (Flowchart)**：标准起止框、判断节点与过程流动，清晰梳理业务链路；
- **第二大脑思维导图 (Mind Map)**：树状辐射、主题归纳，一目了然梳理网状知识脉络。

### AntV AI 智能信息图 (Infographic)
集成 AntV 渲染引擎与 AI Agent：
- 支持时间线 (Timeline)、步骤图 (Steps)、四象限 (Quadrant)、对比矩阵 (VS) 等多种精美模板；
- **对话式智能修订**：直接在信息图面板用自然语言提需求（如“帮我把重点放在跨端上”或“转为时间线”），AI 自动匹配合适板式并完成调整，支持多轮对话与版本回退。

### 多维结构化表格 (Structured Table)
为项目规划、资产跟踪与表单收集而生：
- **丰富字段类型**：原生支持文本、数字、状态单选 (Select)、日期 (Date)、复选框 (Checkbox)、超链接与**多类型附件 (Attachment)**；
- **多条件筛选与排序**：支持动态组合过滤条件与字段升降序；
- **公开表单收集**：可一键生成公开收集入口，外部填写即可实时入表。

---

## 5. 效率工具箱：斜杠指令、双链与数学公式

### 斜杠指令 (Slash Commands)
在正文空白行输入 \`/\` 或直接按下 \`空格键\`，即可呼出快捷指令菜单：
- 快速插入 \`H1/H2/H3\` 标题、引用、分割线、代码块与富文本表格；
- 输入 \`/date\`、\`/time\` 或 \`/now\` 快速插入当前标准时间戳；
- 插入附件、图片或调起行内 AI 智能助手。

### 知识双链与笔记引用
在编辑器中输入 \`@\` 或插入 \`#memo=<笔记ID>\` 链接，即可建立笔记间的双向关联，点击即可在工作区内快速打开关联笔记，构建结构化网状知识库。

### KaTeX 专业数学公式渲染
EdgeEver 原生支持 LaTeX 数学表达式，无论是行内微积分还是多行物理方程，均可毫秒级高保真渲染：

- **行内公式**：例如质能方程 $E = mc^2$，以及正态分布概率密度函数 $f(x) = \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$。
- **多行独立公式块**：
$$
\\oint_{\\partial \\Omega} \\mathbf{E} \\cdot d\\mathbf{S} = \\frac{1}{\\varepsilon_0} \\iiint_{\\Omega} \\rho \\, dV, \\quad \\oint_{\\partial \\Omega} \\mathbf{B} \\cdot d\\mathbf{S} = 0
$$

### 交互式待办清单 (Task Lists)
- [x] 体验 EdgeEver 双视图与大纲导航
- [x] 探索 8 款编辑器主题与 8 套社交海报卡片
- [x] 浏览最新【AI 信息图】演进里程碑与【多维结构化表格】交付追踪
- [ ] 尝试使用斜杠指令 \`/\` 插入当前日期与结构化表格
- [ ] 配置个人 AI API Key，体验行内智能总结与续写
- [ ] 开启 MCP 协议，让 AI Agent 协助整理工作区

---

## 6. AI 原生协同与 MCP 智能体生态

EdgeEver 走在 AI 时代前沿，将大语言模型与智能体深度融入知识管理生命周期：

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant User as 创作者 / 知识工作者
    participant Client as EdgeEver 多端应用
    participant MCP as EdgeEver MCP 服务端点
    participant Agent as AI Agent (Claude / Cursor / Antigravity)
    participant Database as Notion / 飞书多维表格

    User->>Client: 快速记录碎片想法与会议灵感
    Agent->>MCP: tools/call memo_search (检索近期未整理笔记)
    MCP-->>Agent: 返回结构化 Markdown 笔记内容与标签
    Agent->>Agent: 理解内容、自动提炼核心摘要并归类标签
    Agent->>MCP: tools/call memo_update (写回智能总结与增强标签)
    Agent->>Database: 同步结构化字段至个人知识总库
    Client-->>User: 客户端毫秒级感知更新，笔记井井有条
\`\`\`

### 1. 行内 AI 助手 (Inline AI Assistant)
在正文空白行直接按下 **\`空格键 (Space)\`**、输入 **\`/ai\`**、通过 **\`/\`** 斜杠指令菜单，或选中文本点击浮动工具栏中的 **AI 按钮**，即可即时呼出 AI 写作助手面板：
- **精炼总结与要点提取**：一键压缩提炼全文核心结论、提取待办事项与关键行动项；
- **格式保真智能翻译**：在严格保留原有 Markdown、数学公式、链接与代码块的前提下，精准翻译多国语言；
- **内容重塑与续写**：支持润色与精炼表达，或按上下文顺滑续写；
- **BYOK 隐私直连 (Bring Your Own Key)**：支持直连 OpenAI、Anthropic Claude、Google Gemini、DeepSeek 及各类 OpenAI 兼容的中继 API，数据完全由端侧直发，不经过任何第三方中转。

### 2. 开放 MCP 协议 (Model Context Protocol)
在**设置 → MCP 设置**中生成专属令牌，即可将 EdgeEver 接入 Claude Code、Cursor、Antigravity、OpenClaw 等主流 AI 编码助手与智能体平台：
- **无缝读写**：支持标准 MCP 端点 \`/mcp\`（兼容最新的无状态 \`2026-07-28\` 协议与经典握手协议）；
- **自动化流转**：AI Agent 可自动读取笔记、智能归档、批量打标，甚至与 Notion、飞书多维表格建立跨平台自动化同步。

---

## 7. 全平台原生覆盖、离线同步与智能剪藏

- **多端原生支持**：
  - **Web / PWA**：支持现代浏览器全功能运行与离线安装；
  - **Android 原生客户端**：基于 Expo 与 SQLite 构建，已上架 Google Play，并提供签名 APK 下载；
  - **iOS 原生客户端**：基于 Swift / SwiftUI 与 GRDB 原生实现，流畅细腻，已上架 App Store（可使用非大陆区 Apple ID 下载）；
  - **macOS 桌面端**：Electron + Rust 高性能 Sidecar，支持 Apple Silicon 和 Intel Mac，内置静默后台更新；
  - **Windows 桌面端**：已正式推出 x64 Preview 版本，支持开机启动、全局快捷键与系统右键上下文菜单将文件一键发送至笔记。
- **浏览器网页剪藏 (Web Clipper)**：已在 Chrome、Edge 和 Firefox 官方扩展商店发布，支持页面纯净剪藏、右键菜单一键剪藏选中文字/高画质图片、以及一键提取 X (Twitter) 完整推文。
- **微信生态与外部导入**：
  - **微信文章一键剪藏**：在移动端系统分享菜单中，直接将微信文章分享到 EdgeEver，自动提取图文排版并转换为可编辑笔记；
  - **微信聊天转发导入**：桌面端支持将微信合并转发的聊天记录一键导入为格式工整的结构化笔记；
  - **一键排版复制**：点击顶部微信图标，即可将笔记转换为内联排版富文本，直接粘贴至微信公众号后台，排版完美保真。
- **离线草稿与弹性同步**：地铁、飞行模式等无网络环境下自由编辑，重新联网后自动入队完成增量同步与冲突协调。

---

## 8. 多媒体管理、无损备份与零成本自建

### 智能本地图片压缩
在笔记中粘贴或拖入高分辨率图片时，前端会在本地自动将其转码压缩为 WebP 格式，在保证视觉无损的前提下**减少 50% - 90% 的体积**，大幅降低云端存储占用并提升跨端加载速度。

![EdgeEver 官方 Logo](/api/v1/resources/res_demo_logo/blob)

### 多类型附件自由挂载
支持在笔记中嵌入 Word 文档、PDF 文档、CSV 表格、压缩包及多媒体资源，点击即可在线预览或下载：
- [📝 会议纪要 Word：edgeever-meeting-notes.docx](/api/v1/resources/res_demo_meeting_notes_docx/blob)
- [📄 产品白皮书 PDF：edgeever-product-brief.pdf](/api/v1/resources/res_demo_product_brief_pdf/blob)
- [📊 功能矩阵 CSV：feature-matrix.csv](/api/v1/resources/res_demo_feature_matrix_csv/blob)
- [📦 示例附件压缩包：edgeever-attachment-demo.zip](/api/v1/resources/res_demo_attachment_bundle_zip/blob)

### 自建部署方案：Serverless 与 Docker
1. **Cloudflare Serverless（推荐，永久 100% 免费）**：基于 Workers + D1 数据库 + R2 对象存储构建，完全处于 Cloudflare 免费额度内，无需采购服务器，免运维、免证书续期。
2. **Docker 一键自建（VPS / NAS / 家用服务器）**：
   \`\`\`sh
   # 官方 GHCR 镜像
   curl -fsSL https://edgeever.org/install.sh | bash
   \`\`\`
   单命令自动配置 Docker Compose 环境，并内置每日定时自动更新。部分中国大陆网络环境可能需要自行配置可用的网络代理或可信的镜像加速服务，才能正常访问 GHCR。

### 绝对的数据自由：无损 ZIP 导入与导出
在**个人中心 → 导入与导出**中，可随时将完整笔记库打包导出为结构清晰的 ZIP 压缩包。解压后即为包含标准 YAML Front Matter、相对路径附件图片与完整修订版本的纯 Markdown 文件树，随时可在 Obsidian、VS Code 等任意工具中无缝打开，永不担心平台绑定！

---

> 💡 **快速体验小贴士**：
> 1. 点击右上角 **\`</>\`** 体验丝滑的双视图切换；
> 2. 浏览侧边栏中的 **AI 信息图**、**多维结构化表格** 与 **视觉排版海报** 示例，感受下一代知识库形态；
> 3. 按下 **\`Cmd/Ctrl + E\`** 试一试阅读保护模式，锁定只读避免误改内容；
> 4. 按下 **\`Cmd/Ctrl + O\`** 呼出快速切换器 (Quick Switcher)；
> 5. 体验知识库发布功能：右键笔记本可一键公开发布为带目录树的独立静态知识库网站；
> 6. 点击顶部 **微信图标**，体验一键带格式排版复制；
> 7. 点击 **“分享为卡片”**，挑选一款你心仪的社交海报风格并导出；
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
      `> **EdgeEver** is an open-source, AI-native, and portable serverless/containerized personal knowledge base that revives the beloved **Evernote-style three-pane layout**. Designed for geeks and content creators, it combines 100% free serverless hosting, absolute data ownership, native cross-platform clients, and seamless AI Agent (MCP) synergy to redefine your digital second brain.

---

## 1. Why Choose EdgeEver?

*Tip: In editor mode, click any table cell to edit text directly, or right-click to insert/delete rows and columns.*

| Dimension | Traditional Cloud Notes (e.g. Evernote) | Local Offline Notes (e.g. Obsidian) | EdgeEver Geek Knowledge Base |
| :--- | :--- | :--- | :--- |
| **Source Code** | Closed source | Closed-source core, open files | **Full-stack open source (AGPL-3.0)** |
| **Hosting Cost** | Costly commercial subscriptions ($10+/mo) | Official cloud sync subscription ($5+/mo) | **100% Free Forever (Cloudflare Free Tier / Docker Self-Hosted)** |
| **Data Ownership** | Proprietary lock-in, hard to export | Local Markdown, cumbersome mobile sync | **Full Ownership (D1 SQLite, R2 Storage, Lossless ZIP Archives)** |
| **Writing & Expressive Matrix** | Rich text only, fragile formatting | Plain Markdown, lacks WYSIWYG flow | **Seamless Dual-View (WYSIWYG ⇄ Source) + Native Architecture/Flowchart/Mind-Map/AI Infographic/Structured Table/Poster Notes** |
| **Publishing Ready** | No typography styling, loses format | Requires 3rd-party plugins or scripts | **One-Click Rich Copy for WeChat, Substack, Medium & WordPress** |
| **Social Poster Cards** | Basic screenshots without styling | Requires external tools or plugins | **8 Built-in Exquisite Poster Themes with Typography Options & PNG/JPEG Export** |
| **Native AI Ecosystem** | Paywalled, limited features | Heavy plugin setup required | **Native MCP Server (\`/mcp\`), Desktop ACP Local Agent Integration & Inline AI** |
| **Cross-Platform Matrix** | Restricts active free devices | Complex setup across platforms | **Web / PWA / Android / iOS / macOS / Windows / Linux AppImage** |

---

## 2. Architectural Overview & Ecosystem

The Mermaid diagram below demonstrates how EdgeEver connects cross-platform clients, zero-cost cloud infrastructure, and AI Agents into a cohesive workflow:

\`\`\`mermaid
flowchart LR
    subgraph ClientsBox["Cross-platform clients & agents"]
        Clients["Cross-Platform Clients<br/>Web · PWA · Desktop Apps<br/>iOS · Android · Web Clipper"]
        Agents["External AI Agents<br/>Claude Code · Cursor · Antigravity"]
    end

    subgraph Platform["EdgeEver Platform Core (Cloudflare Workers / Docker)"]
        API["Unified REST API Entry<br/>Auth · Rate Limiting · Sync Cursor"]
        MCP["Native MCP Endpoint (/mcp)<br/>Context Retrieval · Read/Write Tools"]
    end

    subgraph BackendBox["AI Models & Data Storage"]
        LLMs["LLM Providers (Direct BYOK)<br/>OpenAI · Gemini · DeepSeek"]
        Storage[("Data & Object Storage<br/>Cloudflare D1 / SQLite · R2 / S3 Compatible")]
    end

    Clients <-->|HTTPS Incremental Sync| API
    Clients -->|Direct BYOK · Privacy First| LLMs
    Agents <-->|MCP Tools / SSE Protocol| MCP
    API <--> Storage
    MCP <--> Storage
\`\`\`

---

## 3. Immersive Writing & Typography Aesthetics

EdgeEver is engineered to provide a distraction-free, elegant writing experience:

### Dual-View Editor & Focus Modes
- **Seamless Dual-View**: Click the \`</>\` button in the top-right corner (or use shortcuts) to instantly toggle between **WYSIWYG Rich Text** and **Markdown Source Code** with 100% fidelity.
- **Collapsible Outline Navigation**: Automatically indexes \`H1-H3\` heading hierarchies with smooth jump scrolling, keeping lengthy documents organized.
- **Zen Focus Mode**: Press \`Cmd/Ctrl + Shift + F\` to hide sidebars and distractions, immersing yourself in pure writing flow.
- **Reading Protection Mode**: When reading or reviewing notes, press \`Cmd/Ctrl + E\` to toggle read-only protection, locking the editor to prevent accidental edits while browsing; press it again to seamlessly resume editing.

### Curated Typography Themes & Publishing Export
- **Preset Editor Themes**: Switch effortlessly between \`WeChat Green\`, \`Fresh Mint\`, \`Minimal Jade\`, \`Lined Jade\`, and styles such as Warm Page, Lesson Page, and Navy Draft, with custom Chinese and interface typography.
- **One-Click Publishing Export**: Built for publishers and bloggers. Click the **WeChat Icon** in the top bar to format your note with inline CSS. Paste directly into WeChat Official Account editor, Substack, Medium, or WordPress while preserving layout and syntax highlighting.

### 8 Exquisite Social Poster Themes
Click **"Share as Card"** in the top-right menu to turn any note into an eye-catching poster card:
- **8 Themes**: \`Slate\`, \`Aurora\`, \`Sunset\`, \`Midnight\`, \`Mint\`, \`Notepad\` (skeuomorphic paper), \`Xuan\` (rice paper & Chinese ink), \`Lavender\`.
- **Customizable Typography**: Switch between Sans, Serif (Songti/Ming), and Monospace fonts, select compact, standard, or wide card widths, and export as high-resolution PNG or JPEG.

---

## 4. Visual Richness: Diagrams, AI Infographics & Structured Tables

EdgeEver transcends traditional plain text notes with native visual and structured data canvases:

### Native Diagram Suite
- **System Architecture (Architecture)**: Designed for microservices and cloud topologies with boundaries, icons, and automated layout;
- **Business Workflows (Flowchart)**: Standard terminators, decisions, and process nodes to map workflows cleanly;
- **Second Brain Mind Maps (Mind Map)**: Radial trees and grouped topics for interconnected thoughts.

### AntV AI Infographic Engine (Infographic)
Powered by AntV and AI Agents:
- Select from Timelines, Steps, Quadrants, and Comparison matrices;
- **Conversational Refinement**: Instruct the AI in natural language directly in the infographic editor (e.g. "focus on cross-platform milestones" or "convert to a chronological timeline") to adjust layouts with full history and undo support.

### Multi-Dimensional Structured Tables (Structured Table)
Engineered for roadmaps, asset tracking, and form collection:
- **Rich Field Types**: Native support for Text, Number, Single Select, Date, Checkbox, URL, and **Multi-File Attachments**;
- **Multi-Condition Filtering & Sorting**: Dynamically combine filters and field order;
- **Public Form Collection**: Generate a public link for external input that writes directly back to your table in real time.

---

## 5. Power Productivity Toolbox: Slash Commands, Backlinks & Math

### Slash Commands
Type \`/\` or press \`Space\` on an empty line to invoke the command menu:
- Insert \`H1/H2/H3\` headings, quotes, horizontal rules, code blocks, and rich tables;
- Use \`/date\`, \`/time\`, or \`/now\` to insert current timestamps instantly;
- Attach files, insert images, or summon the inline AI assistant.

### Bi-directional Note Links & Backlinks
Type \`@\` or insert \`#memo=<memoId>\` links to establish bi-directional references across your knowledge base, building an interconnected web of thoughts.

### KaTeX Professional LaTeX Mathematics
Native support for KaTeX renders complex mathematical equations in milliseconds:

- **Inline Math**: For instance, Einstein's mass-energy equivalence $E = mc^2$ or the Gaussian probability density function $f(x) = \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$.
- **Display Block Math**:
$$
\\oint_{\\partial \\Omega} \\mathbf{E} \\cdot d\\mathbf{S} = \\frac{1}{\\varepsilon_0} \\iiint_{\\Omega} \\rho \\, dV, \\quad \\oint_{\\partial \\Omega} \\mathbf{B} \\cdot d\\mathbf{S} = 0
$$

### Interactive Task Lists
- [x] Explore EdgeEver's dual-view editing and outline navigation
- [x] Experiment with 8 editor themes and 8 social poster card styles
- [x] View the new 【AI Infographic】 evolution milestones and 【Structured Table】 delivery tracker
- [ ] Try typing \`/\` on an empty line to insert current timestamp and tables
- [ ] Connect your AI API Key to experience inline summarization and continuation
- [ ] Connect AI Agents via MCP to automate note categorization

---

## 6. Native AI Agent Synergy & MCP Protocol

EdgeEver is architected for the agentic AI era, weaving LLMs directly into the knowledge management lifecycle:

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant User as Creator / Knowledge Worker
    participant Client as EdgeEver Clients
    participant MCP as EdgeEver MCP Endpoint
    participant Agent as AI Agent (Claude / Cursor / Antigravity)
    participant Database as Notion / Feishu Bitable

    User->>Client: Capture quick spark or meeting notes
    Agent->>MCP: tools/call memo_search (Query unprocessed memos)
    MCP-->>Agent: Returns structured Markdown & tags
    Agent->>Agent: Analyzes content, extracts key takeaways & tags
    Agent->>MCP: tools/call memo_update (Writes back summary & tags)
    Agent->>Database: Syncs structured records to master database
    Client-->>User: Sub-second live updates in client UI
\`\`\`

### 1. Inline AI Assistant
Press the **\`Space\` bar** in an empty block, type **\`/ai\`**, use the **\`/\`** slash command menu, or select text and click the **AI button** on the floating toolbar to instantly summon the AI writing assistant:
- **Summarization & Action Items**: Condense documents into key takeaways, conclusions, and actionable todos;
- **Format-Preserving Translation**: Translate accurately into multiple languages while strictly preserving Markdown, math equations, links, and code blocks;
- **Rewriting & Continuation**: Polish phrasing, make writing concise, or continue writing seamlessly;
- **BYOK Direct Key (Bring Your Own Key)**: Direct client-side connection with OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and OpenAI-compatible relays with zero third-party data transit.

### 2. Model Context Protocol (MCP) Integration
Generate an API token in **Settings → MCP Settings** to connect EdgeEver directly with Claude Code, Cursor, Antigravity, OpenClaw, and other agent platforms:
- **Direct Reading & Writing**: Connect via the \`/mcp\` endpoint (supports stateless \`2026-07-28\` protocol and handshake-based 2025 specs);
- **Automated Workflows**: Let AI Agents read, organize, summarize, tag, and synchronize notes with Notion databases and Feishu Bitable.

---

## 7. Multi-Platform Ecosystem, Offline Sync & Smart Clipping

- **Cross-Platform Native Apps**:
  - **Web / PWA**: Full-featured in modern browsers with offline installation support;
  - **Android Native App**: Built with Expo & SQLite, available on Google Play and GitHub Releases;
  - **iOS Native App**: Native Swift / SwiftUI with GRDB local mirror, available on the App Store (requires a non-mainland China Apple ID);
  - **macOS Desktop App**: Electron + Rust Sidecar for Apple Silicon & Intel Mac with silent background updates;
  - **Windows Desktop App**: Official x64 Preview released, featuring auto-launch, global hotkeys, and Windows Explorer context menu integration to send files to notes with one click.
- **Browser Web Clipper**: Available on Chrome, Edge, and Firefox extension stores to extract clean, ad-free Markdown articles, selected text, high-res images, and full X (Twitter) posts directly from context menus.
- **WeChat Ecosystem & External Imports**:
  - **Mobile Article Clipper**: Share any WeChat article to EdgeEver on your phone to automatically extract and format it as an editable note;
  - **WeChat Chat Forward Import**: Import forwarded chat records on the desktop client into cleanly formatted notes;
  - **One-Click Publishing Export**: Click the WeChat icon in the toolbar to copy formatted rich text ready for publishing.
- **Offline Drafts & Sync Queue**: Keep writing seamlessly without network connectivity; changes are queued locally and automatically synced once reconnected.

---

## 8. Rich Media, Lossless Portability & Zero-Cost Hosting

### Smart Client-Side Image Compression
When pasting or dragging images into notes, EdgeEver compresses them to WebP locally in your browser before upload, **reducing file size by 50% - 90%** while preserving visual fidelity.

![EdgeEver Official Logo](/api/v1/resources/res_demo_logo/blob)

### Universal File Attachments
Embed Word documents, PDFs, spreadsheets, archives, and multimedia files directly in notes for preview or download:
- [📝 Meeting notes Word: edgeever-meeting-notes.docx](/api/v1/resources/res_demo_meeting_notes_docx/blob)
- [📄 Product brief PDF: edgeever-product-brief.pdf](/api/v1/resources/res_demo_product_brief_pdf/blob)
- [📊 Feature matrix CSV: feature-matrix.csv](/api/v1/resources/res_demo_feature_matrix_csv/blob)
- [📦 Sample attachment archive: edgeever-attachment-demo.zip](/api/v1/resources/res_demo_attachment_bundle_zip/blob)

### Zero-Cost Serverless & Docker Self-Hosting
1. **Cloudflare Serverless (Recommended, 100% Free Forever)**: Runs entirely within Cloudflare's free tier (Workers + D1 SQLite + R2 Storage). No server bills, no VPS maintenance.
2. **Docker One-Command Deployment (VPS / NAS / Home Server)**:
   \`\`\`sh
   # Official GHCR image
   curl -fsSL https://edgeever.org/install.sh | bash
   \`\`\`
   Configures Docker Compose and automated daily background updates with one command. Some network environments in mainland China may require an available network proxy or a trusted registry mirror to access GHCR.

### Complete Data Freedom: Lossless ZIP Portability
Export your entire library at any time from **Profile → Import and export**. The archive contains pure Markdown files with standard YAML Front Matter, relative media paths, and full revision histories—compatible with Obsidian, VS Code, and any plain text editor.

---

> 💡 **Quick Exploration Tips**:
> 1. Click **\`</>\`** in the top right to try seamless dual-view toggling;
> 2. Explore the new **AI Infographic**, **Structured Table**, and **Visual Poster** examples in the sidebar;
> 3. Press **\`Cmd/Ctrl + E\`** to test reading protection mode against accidental edits;
> 4. Press **\`Cmd/Ctrl + O\`** to summon the Quick Switcher;
> 5. Try Notebook Web Publishing: right-click any notebook to publish it as a standalone knowledge base site;
> 6. Click the **WeChat Icon** to copy formatted rich text ready for publishing;
> 7. Click **"Share as Card"** to export a stunning social poster card;
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
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc"><title id="title">EdgeEver</title><desc id="desc">An open cat face in near-black on the EdgeEver green rounded tile.</desc><rect x="100" y="100" width="824" height="824" rx="188" fill="#16a06e" /><g transform="translate(100 100) scale(0.74234234) translate(-72 -72)"><path fill="#07130b" fill-rule="evenodd" d="M253.5 707.5Q249 678 249.5 655Q250 632 253.5 611.5Q257 591 264.5 568.5Q272 546 281 530Q290 514 287 485Q284 456 283.5 417Q283 378 285 351.5Q287 325 292 299Q297 273 304.5 254.5Q312 236 318.5 227.5Q325 219 336 213Q347 207 358.5 207.5Q370 208 383 213.5Q396 219 407 226.5Q418 234 428 242.5Q438 251 455 268.5Q472 286 485.5 303.5Q499 321 510.5 339Q522 357 528 368.5Q534 380 534 385.5Q534 391 532.5 394.5Q531 398 527.5 401Q524 404 518 405Q512 406 507 404Q502 402 499.5 399.5Q497 397 491.5 386Q486 375 474 357Q462 339 450.5 324.5Q439 310 426 296.5Q413 283 400.5 272.5Q388 262 377 255.5Q366 249 361 248Q356 247 352.5 249.5Q349 252 344.5 261Q340 270 337 280Q334 290 329 325.5Q324 361 323.5 400Q323 439 327 479.5Q331 520 321 538Q311 556 306 568.5Q301 581 297 596Q293 611 291 624.5Q289 638 289 661Q289 684 292 702Q295 720 301 739.5Q307 759 315.5 776.5Q324 794 335 810Q346 826 358 838.5Q370 851 386.5 863.5Q403 876 419.5 884.5Q436 893 456 899.5Q476 906 501 909.5Q526 913 529.5 916Q533 919 534.5 922Q536 925 536 931.5Q536 938 532.5 943Q529 948 524 950Q519 952 505.5 951Q492 950 473 946Q454 942 426 931Q398 920 385.5 912.5Q373 905 359.5 894.5Q346 884 333.5 871.5Q321 859 313 849Q305 839 291 815Q277 791 267.5 764Q258 737 253.5 707.5ZM719 941.5Q716 936 717 929Q718 922 721 918.5Q724 915 727 913.5Q730 912 749 910Q768 908 785 903.5Q802 899 823 889.5Q844 880 860.5 868.5Q877 857 887.5 847Q898 837 911 820Q924 803 932 788.5Q940 774 947.5 753.5Q955 733 959.5 708Q964 683 964 660.5Q964 638 960.5 617.5Q957 597 952.5 582.5Q948 568 943.5 558Q939 548 931 535Q923 522 927 479Q931 436 930.5 400Q930 364 925.5 329Q921 294 917 280Q913 266 909 258.5Q905 251 902 249Q899 247 893 248.5Q887 250 867.5 264Q848 278 835.5 290.5Q823 303 810.5 318Q798 333 783.5 354Q769 375 762 387.5Q755 400 751 402.5Q747 405 742 405.5Q737 406 732 404Q727 402 723.5 397Q720 392 720.5 385Q721 378 736.5 353Q752 328 768 307.5Q784 287 803.5 267Q823 247 834 238Q845 229 858.5 221Q872 213 881 210Q890 207 899.5 207Q909 207 918.5 212Q928 217 935.5 226.5Q943 236 949.5 252Q956 268 960 286Q964 304 967.5 344.5Q971 385 970.5 418Q970 451 967 482.5Q964 514 972 528Q980 542 986 558Q992 574 996 591Q1000 608 1002 624.5Q1004 641 1003.5 667Q1003 693 998 719.5Q993 746 985 768Q977 790 964.5 812Q952 834 940 849Q928 864 915.5 876Q903 888 892.5 896Q882 904 858 917Q834 930 820 935Q806 940 789.5 944Q773 948 753 950Q733 952 727.5 949.5Q722 947 719 941.5ZM378.5 728Q373 718 373 714.5Q373 711 375.5 708Q378 705 387 699Q396 693 405 689Q414 685 426 682.5Q438 680 447.5 680Q457 680 467.5 682Q478 684 490 690Q502 696 512.5 706.5Q523 717 530.5 733Q538 749 539.5 762Q541 775 537 778Q533 781 515.5 784Q498 787 481 786.5Q464 786 451 783Q438 780 428.5 775.5Q419 771 412 766Q405 761 394.5 749.5Q384 738 378.5 728ZM713.5 778Q710 775 710.5 767Q711 759 714 749Q717 739 723.5 727.5Q730 716 740.5 706Q751 696 762 690.5Q773 685 785.5 682.5Q798 680 813 681Q828 682 843.5 688Q859 694 869.5 702.5Q880 711 880 714.5Q880 718 871.5 732Q863 746 853 755.5Q843 765 830.5 772Q818 779 804 782.5Q790 786 772.5 786.5Q755 787 736 784Q717 781 713.5 778ZM406 710Q395 716 398 722.5Q401 729 410 738.5Q419 748 427 753Q435 758 441 760Q447 762 444.5 749.5Q442 737 442.5 726.5Q443 716 445 707.5Q447 699 432 701.5Q417 704 406 710ZM819.5 701Q806 699 808 708.5Q810 718 810 730.5Q810 743 808 750.5Q806 758 806 760Q806 762 807 762Q808 762 815 759Q822 756 830.5 750Q839 744 846 736Q853 728 855.5 722Q858 716 845.5 709.5Q833 703 819.5 701ZM471 759.5Q469 763 469 765Q469 767 472 767.5Q475 768 488.5 768Q502 768 512 766Q522 764 519.5 754Q517 744 511 734Q505 724 498.5 718Q492 712 484.5 708Q477 704 475.5 704Q474 704 475 723Q476 742 474.5 749Q473 756 471 759.5ZM733 750.5Q730 759 730 761.5Q730 764 737 765.5Q744 767 763.5 767Q783 767 779.5 752Q776 737 776 730.5Q776 724 778 714Q780 704 770.5 708Q761 712 753 719.5Q745 727 740.5 734.5Q736 742 733 750.5ZM592.5 848.5Q588 841 588 836.5Q588 832 590 829Q592 826 599.5 822.5Q607 819 613.5 818Q620 817 626.5 817Q633 817 642.5 819Q652 821 655 822.5Q658 824 661.5 828.5Q665 833 664.5 838Q664 843 659.5 850Q655 857 645 867Q635 877 631.5 878.5Q628 880 625 879.5Q622 879 617.5 876Q613 873 605 864.5Q597 856 592.5 848.5Z" />\n  </g>\n</svg>',
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
