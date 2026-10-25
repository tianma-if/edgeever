import { jaSiteCopy, jaSiteTagline } from "./i18n-ja";
import { plSiteCopy, plSiteTagline } from "./i18n-pl";

export const siteLocales = ["zh-CN", "en-US", "ja", "pl"] as const;
export type SiteLocale = (typeof siteLocales)[number];

export const defaultSiteLocale: SiteLocale = "zh-CN";
export const unmatchedSiteLocale: SiteLocale = "en-US";
export const siteLocaleStorageKey = "edgeever.site.locale";
export const siteLocaleDataAttribute = "data-edgeever-site-locale";

export const siteLocalePrefixes: Record<SiteLocale, string> = {
  "zh-CN": "",
  "en-US": "/en",
  ja: "/ja",
  pl: "/pl",
};

export const siteLocaleLabels: Record<SiteLocale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  ja: "日本語",
  pl: "Polski",
};

export const siteTaglines = {
  "zh-CN": "AI 原生知识库与印象笔记 / Obsidian 替代方案，支持多端瞬时同步与原生 MCP。Cloudflare 免费托管或 Docker 自托管",
  "en-US": "AI-native knowledge base & Evernote/Obsidian alternative with instant sync & native MCP. Free on Cloudflare or self-hosted via Docker.",
  ja: jaSiteTagline,
  pl: plSiteTagline,
} as const satisfies Record<SiteLocale, string>;

const localePrefixPattern = /^\/(en|ja|pl)(?=\/|$)/;

export const stripSiteLocalePrefix = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedPath.replace(localePrefixPattern, "") || "/";
};

export const matchSiteLocale = (locale: string | null | undefined): SiteLocale | null => {
  if (!locale) {
    return null;
  }

  const normalized = locale.trim().replaceAll("_", "-").toLowerCase();

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en-US";
  }

  if (normalized === "ja" || normalized.startsWith("ja-")) {
    return "ja";
  }

  if (normalized === "pl" || normalized.startsWith("pl-")) {
    return "pl";
  }

  return null;
};

export const getSiteLocale = (pathname: string): SiteLocale => {
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    return "en-US";
  }

  if (pathname === "/ja" || pathname.startsWith("/ja/")) {
    return "ja";
  }

  if (pathname === "/pl" || pathname.startsWith("/pl/")) {
    return "pl";
  }

  return "zh-CN";
};

export const getLocalizedPath = (locale: SiteLocale, path: string) => {
  const barePath = stripSiteLocalePrefix(path);
  const prefix = siteLocalePrefixes[locale];

  if (!prefix) {
    return barePath;
  }

  return barePath === "/" ? `${prefix}/` : `${prefix}${barePath}`;
};

export const isExplicitSiteLocalePath = (pathname: string) => localePrefixPattern.test(pathname);

export const siteCopy = {
  "zh-CN": {
    layout: {
      defaultDescription:
        "EdgeEver 是开源、原生支持 AI 的自托管笔记与知识库工作区。保留经典三栏高效体验，支持 ACP 本机 Agent 深度协同、AI 伴侣侧边栏、可视化图表笔记与多端同步，覆盖 macOS、Windows、Linux、iOS、Android 与浏览器剪藏，支持在 Cloudflare 免费额度内运行或使用 Docker 一键自托管。",
      defaultTitle: `EdgeEver - ${siteTaglines["zh-CN"]}`,
      imageAlt: "EdgeEver 笔记应用截图",
      ogLocale: "zh_CN",
    },
    nav: {
      homeAria: "EdgeEver 首页",
      features: "功能特性",
      guides: "使用指南",
      deploy: "部署",
      cloudflareDeploy: "Cloudflare 部署",
      dockerDeploy: "Docker 部署",
      selfHostedAlternative: "印象笔记替代",
      migration: "从印象笔记迁移",
      evernoteMigration: "从印象笔记迁移",
      memosMigration: "从 Memos 迁移",
      notionMigration: "从 Notion 迁移",
      flomoMigration: "从 Flomo 迁移",
      bestPractices: "真机演示",
      advancedPlay: "搭配AI Agent的玩法",
      blog: "博客",
      backToBlog: "返回博客",
      contact: "联系我们",
      privacy: "隐私政策",
      demo: "在线演示",
      language: "语言",
      languageMenu: "切换语言",
      tagAll: "全部",
      tagMigration: "迁移教程",
      tagMcp: "AI 协同 (MCP)",
      tagSelfHosted: "部署自托管",
      openSource: "开源",
    },
    hero: {
      slogan: siteTaglines["zh-CN"],
      popHighlight: "经典三栏现代化知识库 · 原生 AI 协同 · 全平台客户端覆盖",
      demo: "在线演示",
      agentInstall: "一键 AI 部署",
      getApps: "获取客户端：",
      clipper: "剪藏插件",
      windows: "Windows",
      linux: "Linux",
      imageAlt: "EdgeEver product preview",
      badgeText: "💡 全平台覆盖：macOS、Windows、Linux、iOS、Android、剪藏插件 · 原生 MCP / ACP 协同 · Cloudflare 免费额度 & Docker 一键安装",
    },
    bento: {
      eyebrow: "WHY EDGEEVER",
      heading: "重新定义自托管知识工作区",
      subheading: "告别商业笔记的臃肿广告、设备限制与昂贵订阅。每一个设计细节，都旨在打造流畅、开放、隐私可控且原生支持 AI 的第二大脑。",
      showcaseCta: "查看 17 个真机案例演示与最佳实践",
      card1: {
        badge: "经典重现",
        title: "经典三栏与专注模式，熟悉更轻快",
        desc: "保留经典高效的三栏工作区体验（目录树 · 笔记列表 · 编辑写作）。支持富文本与 Markdown 源码双视图自由切换、无限层级嵌套、全屏专注模式与明暗自定义 CSS 样式预设。",
        subBadge: "双视图 / 专注模式 / 自定义 CSS",
        treeTitle: "笔记本目录",
        folder1: "01_工作收件箱",
        folder2: "02_灵感与草稿",
        folder3: "03_归档笔记",
        folder4: "↳ 2026_阅读精选",
        listTitle: "笔记 (18)",
        note1Title: "EdgeEver 核心架构设计",
        note1Sub: "基于 Cloudflare Worker / Docker 与 SQLite...",
        note2Title: "本机 ACP Agent 接入",
        note2Sub: "Codex / Antigravity 本地协同...",
        editorTitle: "EdgeEver 核心架构设计",
        editorBody: "EdgeEver 将经典的 3 栏工作区、原生 AI Agent 联动与自由部署架构完美结合。",
        editorSaveTag: "已自动保存至 SQLite",
      },
      card2: {
        badge: "AI 原生",
        title: "伴侣侧边栏与本机 ACP 协同",
        desc: "常驻伴侣侧边栏支持多会话与选区即时提炼；桌面端通过 ACP 协议直连本机 Agent（Codex、Antigravity、Claude Code 等）；内置 Remote MCP 支持外部助手远程读写。",
        subBadge: "ACP + Remote MCP",
        mockupStatus: "ACP 本机 Agent & 伴侣侧边栏就绪",
        mockupCmd: "> 智能分析选中文本并扩写思维导图",
        mockupResult: "已提炼核心论点，并在笔记中生成结构化思维导图分支。",
      },
      card3: {
        badge: "自由部署",
        title: "Cloudflare 免费额度，或一键 Docker 自托管",
        desc: "个人使用通常可运行在 Cloudflare 免费额度内（约 15 万笔记 + 5 万图片）；也可一键脚本部署至 VPS、NAS 或家庭服务器，存储按需扩展。",
        subBadge: "Cloudflare Native / Docker",
        price: "¥0",
        unit: "/ 月",
        sub: "Cloudflare 免费额度内运行",
        metric: "150,000+",
        metricSub: "免费笔记容量 (可Docker扩展)",
      },
      card4: {
        badge: "创作利器",
        title: "可视化图表笔记与公众号一键排版",
        desc: "笔记内原生绘制思维导图、流程图与架构图，支持 AI 一句话生成与自动布局；Markdown 一键转换为带内联样式的公众号精美排版，原生渲染 Mermaid 与数学公式。",
        subBadge: "思维导图 / 流程图 / 微信排版",
        srcTag: "可视化图表 / 公众号排版",
        actionBtn: "AI 一键生成与排版",
        previewTitle: "# 思维导图、流程图与公众号排版",
        previewBody: "结构化图表全端同步与矢量导出，富文本一键复制至微信公众号后台或 Substack。",
      },
      card5: {
        badge: "全端主权",
        title: "全平台客户端覆盖与无损 ZIP 归档",
        desc: "覆盖 macOS、Windows、Linux、原生 iOS（SwiftUI）、Android 及全功能剪藏插件；基于标准 SQLite 与无损 ZIP 导出，数据完全自主掌控。",
        subBadge: "全平台客户端 + ZIP",
        archiveTitle: "edgeever-backup.zip",
        archiveSub: "包含 Markdown、Front Matter、附件与历史版本",
      },
    },
    marquee: {
      title: "全平台客户端覆盖、自由部署与 AI 智脑生态",
      subtitle: "从 macOS、原生 iOS、Android 客户端，到 Docker 一键自托管、微信公众号排版与 Remote MCP 协同",
      items: [
        {
          tag: "macOS 桌面端",
          title: "Electron + Rust + SQLite",
          desc: "本地 SQLite 镜像，支持 ACP 本机 Agent、专注模式与离线秒开",
          icon: "bx:bxl-apple",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "iOS 原生 App",
          title: "SwiftUI 原生架构",
          desc: "已上架 App Store，支持微信文章剪藏、撤销重做与离线 SQLite 同步",
          icon: "bx:bx-mobile",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "Android App",
          title: "Google Play & 签名 APK",
          desc: "已上架 Google Play，支持本地离线编辑、撤销重做与微信文章剪藏",
          icon: "bx:bxl-android",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "剪藏插件",
          title: "Chrome、Edge 与 Firefox",
          desc: "商店全上架，支持网页全文、右键图片、X 推文与选中文本剪藏",
          icon: "bx:bx-extension",
          color: "from-emerald-600/10 to-green-500/5",
        },
        {
          tag: "可视化图表",
          title: "思维导图、流程图与架构图",
          desc: "笔记内原生绘制与自动布局，支持 AI 一句话生成与矢量导出",
          icon: "bx:bx-sitemap",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "本机 ACP 协同",
          title: "直连本机 AI Agent",
          desc: "桌面端通过 ACP 直连 Codex、Antigravity、Claude Code、WorkBuddy、DeepSeek",
          icon: "bx:bxs-bot",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "AI 伴侣侧边栏",
          title: "常驻侧边栏与划词提炼",
          desc: "多会话随时切换，支持选区一键解释、翻译、语法校对与智能润色",
          icon: "bx:bxs-brain",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "Docker 部署",
          title: "VPS & NAS 一键安装",
          desc: "单行 curl 脚本极速启动，存储按需扩展，支持本地与 S3 兼容对象存储",
          icon: "bx:bxl-docker",
          color: "from-teal-600/10 to-emerald-600/5",
        },
        {
          tag: "创作者排版",
          title: "公众号一键美化与自定义 CSS",
          desc: "公众号一键排版复制，支持单篇笔记字号行高与明暗 CSS 预设预览",
          icon: "bx:bx-copy",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "数据主权",
          title: "无损 ZIP 离线归档",
          desc: "标准 SQLite 存储，完整打包导出 Markdown、附件与历史版本",
          icon: "bx:bx-archive",
          color: "from-green-600/10 to-teal-500/5",
        },
      ],
    },
    features: {
      heading: "重新定义个人笔记体验",
      items: [
        {
          title: "自由选择部署方式：Cloudflare Serverless 与 Docker",
          summary: "同一套现代应用，既可免费运行于 Cloudflare Serverless，也可通过 Docker 一键部署到 VPS、NAS 或家庭服务器。",
          points: [
            "Cloudflare 免费额度自托管：无需购买云服务器与维护 SSL 证书，个人使用通常可容纳约 15 万条短笔记和 5 万张图片。",
            "Docker 一键脚本部署：单行 curl 命令极速启动，存储按需随心扩展，轻松承载百万级笔记与海量附件。",
            "数据安全尽在掌握：无论选择哪种部署形态，所有数据均保存在您自己的账号或私有设备中，安全无忧。",
          ],
        },
        {
          title: "双协议 AI 协同：AI 伴侣侧边栏、本机 ACP Agent 与 Remote MCP",
          summary: "内置 REST API、Remote MCP endpoint 与桌面端 ACP 协议，常驻伴侣侧边栏让 AI 真正成为个人知识库的智能副驾驶。",
          points: [
            "桌面端 ACP 直连本机 Agent：直接调用本地运行的 Codex、Antigravity、Claude Code、WorkBuddy、DeepSeek Harness 等，零延迟深度协同。",
            "常驻 AI 伴侣侧边栏：多会话随时切换，支持对笔记全文或选区进行一键总结、解释、翻译、语法校对与续写润色。",
            "内置 Remote MCP endpoint：直接授权外部 AI 助手安全读取、生成与整理笔记，无缝打通外部知识生态。",
            "接入自己的 AI 模型：无缝配置 OpenAI、Anthropic Claude、Google Gemini、DeepSeek 及自定义兼容端点。",
          ],
        },
        {
          title: "经典三栏布局、专注模式与外观定制",
          summary: "保留经典高效的三栏工作区（目录树 · 笔记列表 · 编辑写作），兼顾流畅富文本写作、Markdown 源码与个性化外观。",
          points: [
            "支持无限级嵌套笔记本，适合长期沉淀与结构化分类的大型个人知识库。",
            "桌面端一键开启全屏专注模式，笔记本拖拽排序，笔记支持多选批量移动与合并。",
            "支持单篇笔记字号、行高与调色板独立设置，支持明暗模式自定义 CSS 预设与一览同屏预览。",
          ],
        },
        {
          title: "可视化图表笔记与创作者排版",
          summary: "笔记内原生支持思维导图、流程图与架构图，配合微信公众号一键排版、Mermaid 与数学公式，创作图文更自如。",
          points: [
            "可视化图表笔记：笔记内原生绘制思维导图、流程图与架构图，支持 AI 一句话生成与自动布局，支持矢量导出。",
            "微信公众号一键排版复制：将 Markdown 瞬间转换为带优雅内联样式的公众号格式，直接粘贴发布。",
            "Mermaid 与 KaTeX 原生渲染：在笔记中流畅绘制架构图、时序图与数学公式，视图切换时保留源码。",
            "PDF 预览与通用附件：支持直观预览 PDF 文档，并可轻松插入 Office、压缩包及多媒体附件。",
          ],
        },
        {
          title: "全平台客户端与多端同步",
          summary: "覆盖 macOS、Windows、iOS、Android、浏览器剪藏插件与 Web/PWA，摆脱商业软件的设备数限制。",
          points: [
            "不限设备登录数：自建专属 API，彻底打碎商业笔记“免费版仅限 2 台设备”的枷锁。",
            "macOS 桌面端：基于 Electron + Rust sidecar + SQLite，兼顾极致本地性能、ACP 本机协同与离线编辑同步。",
            "Windows x64：提供本地 SQLite、资源管理器右键“发送到 EdgeEver”与自动更新。",
            "移动原生端：iOS 原生 SwiftUI App（已上架 App Store）与 Android App（Google Play / APK），支持撤销重做与微信文章剪藏。",
            "全能浏览器剪藏：Chrome、Microsoft Edge 与 Firefox 全上架，支持网页全文、右键图片、X 推文与选中文本剪藏。",
          ],
        },
        {
          title: "数据开放、多账号空间与无损迁移",
          summary: "基于标准 SQLite 存储，单实例支持多账号隔离，并提供无损 ZIP 打包归档与多平台一键迁入。",
          points: [
            "多账号隔离空间：单实例支持创建多个独立成员账号，笔记本、笔记、附件与 MCP Token 相互隔离。",
            "无损 ZIP 打包导出：一键打包包含 Markdown、Front Matter、嵌套目录及附件的完整档案，支持跨实例还原。",
            "极简搬家迁移：内置印象笔记（Evernote ENEX）、Memos、Notion、Flomo 等平台的平滑迁移工具与指南。",
            "前端智能图片压缩：浏览器端静默压缩大图（精简 50%-90% 体积），加载更轻快、存储更省心。",
          ],
        },
      ],
    },
    guides: {
      eyebrow: "EdgeEver Guides",
      heading: "从部署、迁移到 AI Agent 玩法",
      description: "快速上手 EdgeEver 的核心路径：自由部署专属实例、无缝迁移旧笔记，并通过 MCP 接入 AI 助手构建第二大脑。",
      items: [
        {
          title: "选择 EdgeEver 部署方式",
          summary: "让 AI Agent 辅助或手动完成 Cloudflare 部署，也可使用单行脚本在 VPS/NAS 上 Docker 自托管。",
          href: "/blog/ai-agent-deploy-cloudflare",
          cta: "查看部署指南",
        },
        {
          title: "从印象笔记迁移",
          summary: "通过 EdgeEver MCP、evernote-backup 和 ENEX 导入脚本，把旧笔记库迁移到自托管实例。",
          href: "/blog/evernote-migration-guide",
          cta: "查看迁移指南",
        },
        {
          title: "17 个真机场景与实操指南",
          summary: "浏览三栏写作、微信与全渠道剪藏、AI 导图/信息图/多维表格、本机 ACP 协同及海报排版实机演示。",
          href: "/guides/best-practices",
          cta: "查看实机案例",
        },
        {
          title: "AI Agent 进阶玩法",
          summary: "用 MCP 读取真实笔记，生成知识地图、标签建议和个人资料整理工作流。",
          href: "/guides/advanced-play",
          cta: "查看玩法",
        },
      ],
    },
  },
  "en-US": {
    layout: {
      defaultDescription:
        "EdgeEver is an open-source, AI-native knowledge base and modern notes workspace. Enjoy a classic three-pane productivity workflow (Tree View · Note List · Editor) across macOS, Windows, Linux, iOS, Android, and Web Clipper, with native ACP local agent synergy, companion sidebar, and visual diagram notes, running within Cloudflare's free tier or on Docker.",
      defaultTitle: `EdgeEver - ${siteTaglines["en-US"]}`,
      imageAlt: "EdgeEver notes app screenshot",
      ogLocale: "en_US",
    },
    nav: {
      homeAria: "EdgeEver home",
      features: "Features",
      guides: "Guides",
      deploy: "Deploy",
      cloudflareDeploy: "Cloudflare",
      dockerDeploy: "Docker",
      selfHostedAlternative: "Evernote alternative",
      migration: "Migrate from Evernote",
      evernoteMigration: "Migrate from Evernote",
      memosMigration: "Migrate from Memos",
      notionMigration: "Migrate from Notion",
      flomoMigration: "Migrate from Flomo",
      bestPractices: "Showcase",
      advancedPlay: "AI Agent plays",
      blog: "Blog",
      backToBlog: "Back to blog",
      contact: "Contact",
      privacy: "Privacy",
      demo: "Demo",
      language: "Language",
      languageMenu: "Change language",
      tagAll: "All",
      tagMigration: "Migration",
      tagMcp: "AI & MCP",
      tagSelfHosted: "Deployment",
      openSource: "Open Source",
    },
    hero: {
      slogan: siteTaglines["en-US"],
      popHighlight: "Classic Three-Pane AI Workspace · Native AI Synergy · Multi-Platform Apps",
      demo: "Live demo",
      agentInstall: "Deploy with AI",
      getApps: "Get Apps:",
      clipper: "Clipper",
      windows: "Windows",
      linux: "Linux",
      imageAlt: "EdgeEver product preview",
      badgeText: "💡 All Platforms: macOS, Windows, Linux, iOS, Android, Web Clipper · Native MCP & ACP Synergy · Cloudflare Free Tier & Docker",
    },
    bento: {
      eyebrow: "WHY EDGEEVER",
      heading: "Rebuilt for Self-Hosted Knowledge & AI Workflows",
      subheading: "Say goodbye to ads, device caps, and expensive subscriptions. Every detail is crafted for a fast, open, and private second brain.",
      showcaseCta: "Explore 17 real-world workflows & screenshots",
      card1: {
        badge: "Classic UI",
        title: "Classic Three-Pane Layout, Faster & Lighter",
        desc: "Preserves the classic three-pane productivity workflow (Tree View · Note List · Editor). Switch freely between rich text and Markdown source, with unlimited nesting depth, focus mode, and light/dark custom CSS presets.",
        subBadge: "Dual View / Focus Mode / Custom CSS",
        treeTitle: "Notebooks",
        folder1: "01_Work_Inbox",
        folder2: "02_Ideas_Drafts",
        folder3: "03_Archive_Notes",
        folder4: "↳ 2026_Reading",
        listTitle: "Notes (18)",
        note1Title: "EdgeEver Architecture",
        note1Sub: "Cloudflare Workers / Docker & SQLite...",
        note2Title: "Local ACP Agent Connection",
        note2Sub: "Codex / Antigravity local synergy...",
        editorTitle: "EdgeEver Architecture",
        editorBody: "EdgeEver combines the classic 3-pane layout with AI Agent synergy and flexible deployment options.",
        editorSaveTag: "Auto-saved to SQLite",
      },
      card2: {
        badge: "AI Native",
        title: "Companion Sidebar & Local ACP Synergy",
        desc: "The persistent companion sidebar supports multi-chat threads and instant text selection actions. Desktop connects directly to local coding agents via ACP (Codex, Antigravity, Claude Code, WorkBuddy), while Remote MCP allows external agents to read and organize notes.",
        subBadge: "ACP + Remote MCP",
        mockupStatus: "ACP Local Agent & Sidebar Ready",
        mockupCmd: "> Analyze selected text & expand mind map",
        mockupResult: "Core insights extracted. Structured mind map branches created in the note.",
      },
      card3: {
        badge: "Flexible Deploy",
        title: "Cloudflare Free Tier, or 1-Line Docker Deploy",
        desc: "Personal use typically fits within Cloudflare's free tier (about 150k notes & 50k images), or deploy with Docker on your VPS, NAS, or private server and scale storage as needed.",
        subBadge: "Cloudflare Native / Docker",
        price: "$0",
        unit: "/ mo",
        sub: "Within Cloudflare's Free Tier",
        metric: "150,000+",
        metricSub: "Free Note Capacity (Scalable with Docker)",
      },
      card4: {
        badge: "Creator Tools",
        title: "Visual Diagram Notes & One-Click Styled Copy",
        desc: "Create native mind maps, flowcharts, and architecture diagrams directly in notes with one-prompt AI generation and auto-layout. One-click Markdown conversion to styled HTML for Substack, Medium, or WeChat, plus native Mermaid & LaTeX.",
        subBadge: "Diagrams / Flowcharts / Styled Copy",
        srcTag: "Visual Diagrams / Styled Copy",
        actionBtn: "Generate & Copy",
        previewTitle: "# Mind Maps, Flowcharts & Styled Copy",
        previewBody: "Structured diagrams sync across devices with vector export; rich text pastes cleanly into Substack or newsletter editors.",
      },
      card5: {
        badge: "Data Sovereignty",
        title: "Apps Across Platforms & Lossless ZIP Backup",
        desc: "Available on macOS, Windows, Linux, native iOS (SwiftUI), Android, and full-featured Web Clipper. Lossless ZIP export and standard SQLite ensure total ownership.",
        subBadge: "Multi-Platform + ZIP",
        archiveTitle: "edgeever-backup.zip",
        archiveSub: "Markdown + Attachments + Revision History",
      },
    },
    marquee: {
      title: "Apps Across Platforms, Flexible Deploy & AI Synergy",
      subtitle: "From macOS, native iOS & Android apps to Docker self-hosting, styled creator copying, and Remote MCP collaboration.",
      items: [
        {
          tag: "macOS Desktop",
          title: "Electron + Rust + SQLite",
          desc: "Local SQLite mirror with ACP local agent support, focus mode & instant offline capture",
          icon: "bx:bxl-apple",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "iOS Native App",
          title: "Native SwiftUI Architecture",
          desc: "Published on App Store with share-sheet clipping, undo/redo & offline SQLite sync",
          icon: "bx:bx-mobile",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "Android App",
          title: "Google Play & Signed APK",
          desc: "Available on Google Play with offline editing, undo/redo & share-sheet clipping",
          icon: "bx:bxl-android",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "Web Clipper",
          title: "Chrome, Edge & Firefox",
          desc: "Published on all stores: clip full pages, right-click images, X posts & selections",
          icon: "bx:bx-extension",
          color: "from-emerald-600/10 to-green-500/5",
        },
        {
          tag: "Visual Diagrams",
          title: "Mind Maps, Flowcharts & Architectures",
          desc: "Native diagramming in notes with auto-layout, 1-prompt AI generation & vector export",
          icon: "bx:bx-sitemap",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "Local ACP Synergy",
          title: "Direct Local Agent Connection",
          desc: "Desktop connects directly via ACP to Codex, Antigravity, Claude Code, WorkBuddy, DeepSeek",
          icon: "bx:bxs-bot",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "Companion Sidebar",
          title: "Persistent Sidebar & Text Selection Actions",
          desc: "Multi-chat switching with instant explain, translate, proofread & rewrite for selections",
          icon: "bx:bxs-brain",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "Docker Deploy",
          title: "VPS & NAS 1-Line Install",
          desc: "Fast curl deployment with scalable storage, supporting local disks and S3 buckets",
          icon: "bx:bxl-docker",
          color: "from-teal-600/10 to-emerald-600/5",
        },
        {
          tag: "Creator Styling",
          title: "Styled Copy & Custom Note CSS",
          desc: "One-click styled copy for newsletters; customize font size, line height & light/dark CSS",
          icon: "bx:bx-copy",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "Data Sovereignty",
          title: "Lossless ZIP Archive",
          desc: "Standard SQLite with lossless export of Markdown, attachments & revision history",
          icon: "bx:bx-archive",
          color: "from-green-600/10 to-teal-500/5",
        },
      ],
    },
    features: {
      heading: "A personal notes workspace rebuilt for self-hosting",
      items: [
        {
          title: "Flexible Deployment: Cloudflare Serverless & Docker",
          summary: "The same modern application runs seamlessly on Cloudflare Serverless or on a VPS, NAS, or home server via Docker.",
          points: [
            "Cloudflare Free-Tier Self-Hosting: No VPS rental or SSL certificates required. Personal use typically supports about 150k notes and 50k images.",
            "1-Line Docker Deployment: Quick deployment with a single curl command, scaling easily to millions of notes and large files.",
            "Complete Data Privacy: Regardless of deployment method, all your data lives strictly within your own account or private hardware.",
          ],
        },
        {
          title: "Dual AI Synergy: Companion Sidebar, Local ACP Agents & Remote MCP",
          summary: "Built-in REST API, Remote MCP endpoint, and desktop ACP protocol turn AI into a true copilot for your knowledge base.",
          points: [
            "Desktop ACP Local Agent Connection: Connect directly to local agents such as Codex, Antigravity, Claude Code, WorkBuddy, DeepSeek Harness with zero latency.",
            "Persistent AI Companion Sidebar: Switch between multiple chat threads and instantly explain, translate, proofread, and polish selected text.",
            "Built-in Remote MCP Endpoint: Authorize external AI assistants to safely read, create, and organize notes across your workflows.",
            "Connect Your Own AI Models: Support for OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and custom compatible endpoints.",
          ],
        },
        {
          title: "Classic Three-Pane Workflow, Focus Mode & Appearance",
          summary: "Preserves the classic three-pane productivity workflow (Tree View · Note List · Editor) while supporting rich text, Markdown source, and custom appearance presets.",
          points: [
            "Unlimited nested notebooks for long-term personal knowledge bases.",
            "Full-screen focus mode on desktop, drag-and-drop notebook reordering, and multi-note batch move or merge.",
            "Independent font size, line height, and palette settings with light/dark custom CSS presets and side-by-side preview.",
          ],
        },
        {
          title: "Visual Diagram Notes & Creator Tools",
          summary: "Native mind maps, flowcharts, and architecture diagrams inside notes, combined with styled rich copy, Mermaid, and math formulas.",
          points: [
            "Visual Diagram Notes: Create mind maps, flowcharts, and architecture diagrams natively with one-prompt AI generation and vector export.",
            "One-Click Styled Copy: Instantly converts Markdown into styled HTML with inline CSS for Substack, Medium, or newsletters.",
            "Native Mermaid & KaTeX: Render architecture diagrams, flowcharts, and mathematical equations with editable source code.",
            "PDF Preview & Universal Attachments: Preview PDF documents inline, and attach Office files, archives, and multimedia easily.",
          ],
        },
        {
          title: "Apps Across Platforms & Multi-Device Sync",
          summary: "Available across macOS, Windows, iOS, Android, browser Web Clipper, and Web/PWA, freeing you from commercial device caps.",
          points: [
            "Unlimited Devices: Self-hosted API eliminates commercial restrictions like the '2-device login limit'.",
            "macOS Desktop App: Electron + Rust sidecar + SQLite for blazing fast local performance, ACP synergy, and offline sync.",
            "Windows x64: Local SQLite, Explorer right-click 'Send to EdgeEver', and automatic updates.",
            "Mobile Native Apps: Native SwiftUI iOS App (on App Store) and Android App (on Google Play & GitHub APK) with undo/redo and WeChat clipping.",
            "Web Clipper Extension: Official extensions on Chrome, Edge, and Firefox for full articles, right-click images, X posts, and selections.",
          ],
        },
        {
          title: "Open Data, Multi-Account Isolation & Lossless Migration",
          summary: "Standard SQLite storage, multi-account isolation per instance, lossless ZIP archives, and easy migration tools.",
          points: [
            "Multi-Account Workspaces: Single instance supports multiple isolated user spaces for family or small teams.",
            "Lossless ZIP Backup: One-click export including Markdown, Front Matter, nested notebooks, attachments, and revision history.",
            "Seamless Migration: Built-in migration scripts and guides for Evernote (ENEX), Memos, Notion, and Flomo.",
            "Client-Side Image Compression: Compresses images before upload (50%-90% size reduction) for faster loading and storage savings.",
          ],
        },
      ],
    },
    guides: {
      eyebrow: "EdgeEver Guides",
      heading: "Deploy, migrate, and put AI agents to work",
      description: "The fastest paths into EdgeEver: deploy your own instance, move an existing Evernote archive, then connect MCP-powered AI workflows.",
      items: [
        {
          title: "Choose how to deploy EdgeEver",
          summary: "Use an AI Agent or manual setup for Cloudflare, or run a one-line Docker installer on a VPS or NAS.",
          href: "/blog/ai-agent-deploy-cloudflare",
          cta: "Read deployment guide",
        },
        {
          title: "Migrate from Evernote",
          summary: "Use EdgeEver MCP, evernote-backup, and the ENEX import script to migrate an old notes library into your self-hosted instance.",
          href: "/blog/evernote-migration-guide",
          cta: "Read migration guide",
        },
        {
          title: "17 Real-World Workflows",
          summary: "Visual walkthrough of three-pane editing, omnichannel clipping, AI diagrams & databases, local ACP agents, and poster design.",
          href: "/guides/best-practices",
          cta: "View showcase",
        },
        {
          title: "AI Agent advanced play",
          summary: "Turn real notes into knowledge maps, tag cleanup plans, and higher-level personal knowledge workflows through MCP.",
          href: "/guides/advanced-play",
          cta: "Explore workflows",
        },
      ],
    },
  },
  ja: jaSiteCopy,
  pl: plSiteCopy,
} as const;
