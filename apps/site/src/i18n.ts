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
    },
    hero: {
      slogan: siteTaglines["zh-CN"],
      demo: "在线演示",
      agentInstall: "部署 EdgeEver",
      imageAlt: "EdgeEver product preview",
      badgeText: "💡 支持印象笔记、Notion、Memos 零成本平替，双 MCP 自动搬家",
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
      description: "把最关键的上手路径放到显眼位置：先部署自己的实例，再把旧笔记迁过来，最后用 MCP 接入 AI Agent 整理长期知识库。",
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
        "EdgeEver is an open-source, serverless, 100% free notes workspace with a classic three-pane workflow, rich text, nested notebooks, and remote MCP endpoint.",
      defaultTitle: `EdgeEver - ${siteTaglines["en-US"]}`,
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
    },
    hero: {
      slogan: siteTaglines["en-US"],
      demo: "Live demo",
      agentInstall: "Deploy EdgeEver",
      imageAlt: "EdgeEver product preview",
      badgeText: "💡 Serverless: Migrate from Evernote, Notion & Memos via Dual-MCP",
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
