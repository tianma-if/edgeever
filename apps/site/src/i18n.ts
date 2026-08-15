import { deploymentPrompts } from "./deployment-prompts";

export type SiteLocale = "zh-CN" | "en-US";

export const defaultSiteLocale: SiteLocale = "zh-CN";
export const siteLocaleStorageKey = "edgeever.site.locale";
export const siteLocaleDataAttribute = "data-edgeever-site-locale";
export const siteTaglines = {
  "zh-CN": "无需服务器、零费用、开源且原生支持 AI Agent 的自托管『印象笔记』替代品",
  "en-US": "A serverless, 100% free, open-source, and AI-native self-hosted Evernote alternative on Cloudflare.",
} as const satisfies Record<SiteLocale, string>;

export const getSiteLocale = (pathname: string): SiteLocale => (pathname === "/en" || pathname.startsWith("/en/") ? "en-US" : "zh-CN");

export const getLocalizedPath = (locale: SiteLocale, path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (locale === "zh-CN") {
    return normalizedPath === "/en" ? "/" : normalizedPath.replace(/^\/en(?=\/|$)/, "") || "/";
  }

  if (normalizedPath === "/") {
    return "/en/";
  }

  return normalizedPath.startsWith("/en/") ? normalizedPath : `/en${normalizedPath}`;
};

export const siteCopy = {
  "zh-CN": {
    layout: {
      defaultDescription:
        "EdgeEver 是一个开源、自托管、Cloudflare-native 的现代笔记工作区。保留经典印象笔记的三栏体验，支持富文本、无限嵌套，对 AI Agent 极度友好。采用无服务器架构，日常使用完全免费且无需服务器。",
      defaultTitle: `EdgeEver - ${siteTaglines["zh-CN"]}`,
      imageAlt: "EdgeEver 笔记应用截图",
      ogLocale: "zh_CN",
    },
    nav: {
      homeAria: "EdgeEver 首页",
      features: "功能特性",
      guides: "使用指南",
      deploy: "部署",
      migration: "从印象笔记迁移",
      evernoteMigration: "从印象笔记迁移",
      memosMigration: "从 Memos 迁移",
      notionMigration: "从 Notion 迁移",
      advancedPlay: "搭配AI Agent的玩法",
      blog: "博客",
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
      popHighlight: "印象笔记 0 成本经典平替",
      demo: "在线演示",
      agentInstall: "一键 AI 部署",
      imageAlt: "EdgeEver product preview",
      badgeText: "💡 支持印象笔记、Notion、Memos 零成本平替，双 MCP 自动搬家",
      terminalCmd: "帮我在 Cloudflare 部署 EdgeEver：Fork https://github.com/tianma-if/edgeever 并绑定 D1/R2",
      terminalSub: "Agent 原生 · 复制 Prompt 粘贴给 Cursor / Claude Code / Antigravity 即可自动部署",
      copySuccess: "部署 Prompt 已复制！粘贴给 AI 助手即可部署",
      agentPromptText: deploymentPrompts["zh-CN"],
    },
    bento: {
      eyebrow: "WHY EDGEEVER",
      heading: "重新定义自托管笔记工作区",
      subheading: "告别商业笔记的臃肿广告与设备限制。每一个设计细节，都旨在打造流畅、开放、隐私可控的第二大脑。",
      card1: {
        badge: "经典重现",
        title: "经典三栏，熟悉但更轻快",
        desc: "保留印象笔记式的笔记本树、笔记列表与主编辑区。支持无限层级嵌套与拖拽调整，零学习成本。",
        subBadge: "100% 经典印象笔记体感",
        treeTitle: "笔记本目录",
        folder1: "01_工作收件箱",
        folder2: "02_灵感与草稿",
        folder3: "03_归档笔记",
        folder4: "↳ 2026_阅读精选",
        listTitle: "笔记 (18)",
        note1Title: "EdgeEver 核心架构设计",
        note1Sub: "基于 Cloudflare Worker + D1...",
        note2Title: "Remote MCP 配置指南",
        note2Sub: "Antigravity Token 校验步骤...",
        editorTitle: "EdgeEver 核心架构设计",
        editorBody: "EdgeEver 将印象笔记经典的 3 栏工作区与 100% 免费的 Serverless 架构完美结合。",
        editorSaveTag: "已自动保存至 Cloudflare D1",
      },
      card2: {
        badge: "MCP 原生",
        title: "AI Agent 原生连接",
        desc: "内置 Remote MCP endpoint。直接授权 Antigravity、Claude Code、Codex 读取、生成与整理你的长期知识库。",
        mockupStatus: "MCP 已连接",
        mockupCmd: "> mcp.search_notes(\"EdgeEver\")",
        mockupResult: "已找到 5 条相关笔记，已自动生成摘要与标签关联。",
      },
      card3: {
        badge: "0 成本自托管",
        title: "0 服务器、0 运维、终身完全免费",
        desc: "依托 Cloudflare 架构，可存 15 万条笔记 + 5 万张图片。数据存在你自己的 Cloudflare 账号中，隐私安全无忧。",
        price: "¥0",
        unit: "/ 月",
        sub: "自托管零服务器成本",
        metric: "150,000+",
        metricSub: "免费笔记容量",
      },
      card4: {
        badge: "排版神器",
        title: "创作者一键富文本美化复制",
        desc: "专为创作者打造，Markdown 瞬间转换为带内联 CSS 的优雅排版，可直接粘贴至 Substack、Medium 或公众号。",
        srcTag: "Markdown 源码",
        actionBtn: "一键富文本复制",
        previewTitle: "# 标题一：富文本与 CSS",
        previewBody: "带 CSS 内联排版，瞬间粘贴入公众号或 Substack。",
      },
      card5: {
        badge: "数据主权",
        title: "数据开放，无损 ZIP 备份",
        desc: "基于 SQLite D1 与标准 REST API，支持无损 ZIP 导入导出（含 Markdown、Front Matter、嵌套目录与版本历史）。",
        archiveTitle: "edgeever-backup.zip",
        archiveSub: "包含 Markdown、Front Matter、附件与历史版本",
      },
    },
    marquee: {
      title: "无缝剪藏、多端同步与生态扩展",
      subtitle: "从浏览器剪藏插件、PWA/移动端随手记，到 Remote MCP 与跨平台数据联动",
      items: [
        {
          tag: "剪藏插件",
          title: "Chrome、Edge 与 Firefox",
          desc: "Chrome 官方商店版本与 Firefox 兼容构建，智能剪藏网页全文、选中文本与书签",
          icon: "bx:bx-extension",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "多端同步",
          title: "PWA & 移动端快捷记",
          desc: "桌面 PC、iOS、Android 随开随用，离线草稿自动同步",
          icon: "bx:bx-mobile-alt",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "设备无界",
          title: "不限设备登录数",
          desc: "自建专属 API，彻底打碎商业笔记“限制 2 台设备”枷锁",
          icon: "bx:bx-devices",
          color: "from-emerald-600/10 to-green-500/5",
        },
        {
          tag: "AI 生态",
          title: "Remote MCP 服务端",
          desc: "原生接入 Antigravity、Claude Code、Codex 智能读写与总结",
          icon: "bx:bxs-bot",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "数据联动",
          title: "Notion & 飞书多维表格",
          desc: "通过 MCP 把零散笔记自动归纳转化为结构化数据库",
          icon: "bx:bx-data",
          color: "from-teal-600/10 to-emerald-600/5",
        },
        {
          tag: "创作者高效",
          title: "Substack / 公众号复制",
          desc: "Markdown 瞬间转换为带 CSS 内联的完美富文本排版",
          icon: "bx:bx-copy",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "无损迁移",
          title: "双 MCP & 印象笔记搬家",
          desc: "内置 ENEX 与双 MCP 自动化迁移工具，轻松无痛转场",
          icon: "bx:bx-transfer",
          color: "from-green-600/10 to-teal-500/5",
        },
        {
          tag: "数据主权",
          title: "无损 ZIP 离线归档",
          desc: "SQLite D1 完整打包导出/导入，支持 Markdown 与版本历史",
          icon: "bx:bx-archive",
          color: "from-teal-500/10 to-emerald-500/5",
        },
      ],
    },
    features: {
      heading: "重新定义个人笔记体验",
      items: [
        {
          title: "零服务器，零运维，终身完全免费",
          summary: "彻底告别购买云服务器月租与繁琐维护。利用 Cloudflare 卓越的无服务器架构，个人使用终身免费。",
          points: [
            "完全免服务器：无需配置 Docker、Nginx 或证书，一句话即可直接部署至 Cloudflare。",
            "日常使用完全免费：充分利用 Cloudflare Workers、D1 与 R2 免费级配额（可存 15 万条笔记 + 5 万张图片）。",
            "数据安全尽在掌握：虽然免服务器，但数据并非存在第三方，而是保存在你自己的 Cloudflare 账号中。",
          ],
        },
        {
          title: "AI Agent 原生连接",
          summary: "内置 REST API、OpenAPI schema 与 Remote MCP endpoint，让 AI 助手安全地读取、创建和整理笔记。",
          points: [
            "在应用内生成 MCP Token，就能把 EdgeEver 接入 Codex、Claude Code、Antigravity 等工具。",
            "适合做灵感归纳、自动打标签、知识图谱整理和跨笔记检索。",
            "还可以联动 Notion Database、飞书多维表格等工具，把日常笔记中的零散信息沉淀为结构化数据。",
            "API 与 Agent 能力围绕你的私有实例工作，不依赖封闭笔记平台。",
          ],
        },
        {
          title: "经典三栏，熟悉但更轻快",
          summary: "保留印象笔记式的笔记本树、笔记列表和主编辑区，减少迁移后的学习成本。",
          points: [
            "支持无限级嵌套笔记本，适合长期沉淀的大型知识库。",
            "笔记本可以拖拽排序和调整层级，笔记支持多选移动与多选合并。",
            "基于 TipTap 的富文本编辑器支持查看笔记历史版本，兼顾流畅写作与内容回溯。",
          ],
        },
        {
          title: "数据开放，迁移和导出不被绑架",
          summary: "笔记内容以结构化 JSON、Markdown 与纯文本多形态保存，并支持原生 EdgeEver ZIP 导入导出，兼顾编辑、API、搜索、Agent 与完整恢复。",
          points: [
            "内容存放在基于标准 SQLite 的 Cloudflare D1 中，可通过 API、MCP 或 CLI 按需读取。",
            "支持原生 EdgeEver ZIP 导入导出，归档包含 Markdown、Front Matter、嵌套笔记本结构、附件与历史版本，可跨实例完整恢复。",
            "支持印象笔记数据导入能力，降低从旧笔记库迁移过来的成本。",
            "Markdown 面向导入导出和 Agent 使用，降低未来再次迁移的成本。",
          ],
        },
        {
          title: "多端无缝同步，不限设备数",
          summary: "电脑、手机、平板都能直接同步，自建实例让你彻底摆脱商业笔记平台的登录设备数限制。",
          points: [
            "不限登录设备数：个人独享自建 API，再也不受商业笔记平台的“只允许登录 2 台设备”等限制。",
            "支持 PC 与移动端网页访问，也可以安装成 PWA，随手打开就能记。",
            "已有笔记支持离线编辑草稿和本地同步队列，弱网时也能先写后同步。",
          ],
        },
        {
          title: "一个实例，多账户独立空间",
          summary: "为家人或小团队成员创建账号，每个人都拥有彼此隔离的私人笔记工作区。",
          points: [
            "实例管理员可以创建、停用成员账号或重置密码，实例不开放公众注册。",
            "每个成员的笔记本、笔记、附件、回收站和导入导出数据完全隔离。",
            "MCP Token 也按成员空间隔离，AI Agent 只能访问被明确授权的数据。",
          ],
        },
      ],
    },
    guides: {
      eyebrow: "EdgeEver Guides",
      heading: "从部署、迁移到 AI Agent 玩法",
      description: "快速上手 EdgeEver 的核心路径：部署专属实例、无缝迁移旧笔记，并通过 MCP 接入 AI 助手构建第二大脑。",
      items: [
        {
          title: "两种方式部署 EdgeEver",
          summary: "让 AI Agent 代为完成线上部署，或手动 Fork 后在线配置同一套流程。",
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
        "EdgeEver is a free, open-source, self-hosted Evernote alternative with a familiar three-pane workspace, open data, web clipping, sync, and AI agent support.",
      defaultTitle: "Open-Source, Self-Hosted Evernote Alternative | EdgeEver",
      imageAlt: "EdgeEver notes app screenshot",
      ogLocale: "en_US",
    },
    nav: {
      homeAria: "EdgeEver home",
      features: "Features",
      guides: "Guides",
      deploy: "Deploy",
      migration: "Migrate from Evernote",
      evernoteMigration: "Migrate from Evernote",
      memosMigration: "Migrate from Memos",
      notionMigration: "Migrate from Notion",
      advancedPlay: "AI Agent plays",
      blog: "Blog",
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
      popHighlight: "Free Self-Hosted Evernote Alternative",
      demo: "Live demo",
      agentInstall: "Deploy with AI",
      imageAlt: "EdgeEver product preview",
      badgeText: "💡 Serverless: Migrate from Evernote, Notion & Memos via Dual-MCP",
      terminalCmd: "Deploy EdgeEver on Cloudflare: Fork https://github.com/tianma-if/edgeever & bind D1/R2",
      terminalSub: "Agent Native · Copy prompt to Cursor / Claude Code / Antigravity to deploy automatically",
      copySuccess: "Deployment Prompt copied! Paste into AI Assistant",
      agentPromptText: deploymentPrompts["en-US"],
    },
    bento: {
      eyebrow: "WHY EDGEEVER",
      heading: "Rebuilt for Self-Hosted Knowledge & AI Workflows",
      subheading: "Say goodbye to ads, device caps, and server bills. Every detail is crafted for a fast, open, and private second brain.",
      card1: {
        badge: "Classic UI",
        title: "Classic Three-Pane Layout, Faster & Lighter",
        desc: "Preserves the notebook tree, note list, and main editor. Unlimited nesting depth with zero learning curve.",
        subBadge: "100% Evernote Feel",
        treeTitle: "Notebooks",
        folder1: "01_Work_Inbox",
        folder2: "02_Ideas_Drafts",
        folder3: "03_Archive_Notes",
        folder4: "↳ 2026_Reading",
        listTitle: "Notes (18)",
        note1Title: "EdgeEver Architecture",
        note1Sub: "Serverless Cloudflare Worker & D1...",
        note2Title: "Remote MCP Setup",
        note2Sub: "Antigravity token setup guide...",
        editorTitle: "EdgeEver Architecture",
        editorBody: "EdgeEver combines the classic Evernote 3-pane layout with 100% free serverless infrastructure.",
        editorSaveTag: "Auto-saved to Cloudflare D1",
      },
      card2: {
        badge: "MCP Native",
        title: "Native AI Agent & Remote MCP Synergy",
        desc: "Built-in Remote MCP endpoint. Authorize Antigravity, Claude Code, and Codex to read, summarize, and organize your notes directly.",
        mockupStatus: "MCP Connected",
        mockupCmd: "> mcp.search_notes(\"EdgeEver\")",
        mockupResult: "Found 5 relevant notes. Created summary & tags automatically.",
      },
      card3: {
        badge: "Zero Cost",
        title: "Zero Server, Zero Maintenance, 100% Free",
        desc: "Runs on Cloudflare free tiers (up to 150k notes & 50k images). All data lives securely inside your own Cloudflare account.",
        price: "$0",
        unit: "/ mo",
        sub: "Zero Server Rental",
        metric: "150,000+",
        metricSub: "Free Note Capacity",
      },
      card4: {
        badge: "Rich Copy",
        title: "One-Click Rich Copy for Content Creators",
        desc: "Instantly converts Markdown into styled HTML with inline CSS, ready to paste into Substack, Medium, or newsletters.",
        srcTag: "Markdown Source",
        actionBtn: "One-Click Rich Copy",
        previewTitle: "# Heading 1: Rich Text & CSS",
        previewBody: "With inline CSS, instantly paste into Substack or newsletters.",
      },
      card5: {
        badge: "Data Sovereignty",
        title: "Open Data Architecture & ZIP Backup",
        desc: "Built on standard SQLite D1 & REST API, supporting full ZIP export/import with Markdown, Front Matter, attachments, and version history.",
        archiveTitle: "edgeever-backup.zip",
        archiveSub: "Markdown + Attachments + Revision History",
      },
    },
    marquee: {
      title: "Seamless Clipping, Multi-Device Sync & Ecosystem Synergy",
      subtitle: "From browser web clipping and mobile PWA capture, to Remote MCP and cross-platform workflows.",
      items: [
        {
          tag: "Web Clipper",
          title: "Chrome, Edge & Firefox",
          desc: "Chrome Web Store release and Firefox-compatible build for clipping articles, selections, and bookmarks",
          icon: "bx:bx-extension",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "Multi-Device",
          title: "PWA & Mobile Quick Capture",
          desc: "Instant capture on Desktop, iOS & Android with offline sync queue",
          icon: "bx:bx-mobile-alt",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "Uncapped",
          title: "Unlimited Active Devices",
          desc: "Self-hosted API removes commercial device cap restrictions",
          icon: "bx:bx-devices",
          color: "from-emerald-600/10 to-green-500/5",
        },
        {
          tag: "AI Ecosystem",
          title: "Remote MCP Endpoint",
          desc: "Connect Antigravity, Claude Code & Codex for smart summaries",
          icon: "bx:bxs-bot",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "Data Synergy",
          title: "Notion & Bitable Sync",
          desc: "Transform everyday notes into structured databases via MCP",
          icon: "bx:bx-data",
          color: "from-teal-600/10 to-emerald-600/5",
        },
        {
          tag: "Content Creator",
          title: "Substack & Newsletter Rich Copy",
          desc: "Convert Markdown into styled HTML with inline CSS in 1 click",
          icon: "bx:bx-copy",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "Migration",
          title: "Evernote & Notion Importer",
          desc: "Automated ENEX import script and dual-MCP migration tools",
          icon: "bx:bx-transfer",
          color: "from-green-600/10 to-teal-500/5",
        },
        {
          tag: "Data Sovereignty",
          title: "Lossless ZIP Archive",
          desc: "Full SQLite D1 export and recovery with Markdown & version history",
          icon: "bx:bx-archive",
          color: "from-teal-500/10 to-emerald-500/5",
        },
      ],
    },
    features: {
      heading: "A personal notes workspace rebuilt for self-hosting",
      items: [
        {
          title: "No Server, Zero Maintenance, 100% Free",
          summary: "Say goodbye to server rental fees and complex system management. EdgeEver runs entirely within Cloudflare's free tiers.",
          points: [
            "No Server Required: No need for Docker, Nginx, or SSL configuration. Deploy directly to Cloudflare with one simple tool.",
            "100% Free Forever: Take full advantage of free tiers for Cloudflare Workers, D1, and R2 (supports up to 150k notes and 50k images).",
            "Full Data Ownership: Serverless doesn't mean third-party storage. All your notes live securely within your own Cloudflare account.",
          ],
        },
        {
          title: "AI Agent native",
          summary: "Built-in REST API, OpenAPI schema, and Remote MCP endpoint let AI assistants read, create, and organize notes safely.",
          points: [
            "Generate an MCP token in the app to connect EdgeEver with Codex, Claude Code, Antigravity, and similar tools.",
            "Useful for idea summaries, automatic tagging, knowledge graph cleanup, and cross-note retrieval.",
            "It can also connect to tools such as Notion databases and Feishu Bitable, turning scattered information from everyday notes into structured data.",
            "Agent workflows operate on your private instance instead of a closed notes platform.",
          ],
        },
        {
          title: "Classic three-pane workflow",
          summary: "Notebook tree, note list, and editor stay familiar for Evernote-style migrations.",
          points: [
            "Unlimited nested notebooks support long-lived personal knowledge bases.",
            "Drag notebooks to reorder or change hierarchy, and move or merge notes in batches.",
            "A TipTap-based rich text editor includes note version history for reviewing earlier content.",
          ],
        },
        {
          title: "Open data, easier migration",
          summary: "Notes remain available as structured JSON, Markdown, and plain text, with native EdgeEver ZIP import and export for editing, APIs, search, agents, and complete recovery.",
          points: [
            "Content lives in Cloudflare D1, based on standard SQLite, and can be read via API, MCP, or CLI.",
            "Native EdgeEver ZIP import and export includes Markdown, Front Matter, nested notebooks, attachments, and revision history for complete recovery between instances.",
            "Evernote import support lowers the cost of moving from an existing notes library.",
            "Markdown keeps import, export, and agent workflows portable.",
          ],
        },
        {
          title: "Multi-device sync, uncapped limits",
          summary: "Use EdgeEver from desktop, phone, or tablet with no device limits and a PWA-friendly experience.",
          points: [
            "No device limits: self-hosted API means no commercial restrictions on the number of active login devices.",
            "Open it in the browser or install it as a PWA for quick capture.",
            "Existing notes support offline drafts and a local sync queue for weak network conditions.",
          ],
        },
        {
          title: "One instance, isolated accounts",
          summary: "Create accounts for family or a small team while giving each person a separate private notes workspace.",
          points: [
            "The owner can create or disable member accounts and reset passwords; public registration stays closed.",
            "Each member has isolated notebooks, notes, attachments, Trash, and import/export data.",
            "MCP tokens are isolated by workspace, so AI Agents only access explicitly authorized data.",
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
          title: "Two ways to deploy EdgeEver",
          summary: "Let an AI Agent complete the online deployment, or configure the same flow online from a GitHub Fork.",
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
          title: "AI Agent advanced play",
          summary: "Turn real notes into knowledge maps, tag cleanup plans, and higher-level personal knowledge workflows through MCP.",
          href: "/guides/advanced-play",
          cta: "Explore workflows",
        },
      ],
    },
  },
} as const;
