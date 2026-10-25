import type { ImageMetadata } from "astro";
import type { SiteLocale } from "../i18n";

import classThreePaneImg from "../../../../docs/assets/best-practices/original-image/class-three-pane/image.png";
import wechatChatSelectImg from "../../../../docs/assets/best-practices/original-image/wechat-chat-message-import/select-export.png";
import wechatChatNoteImg from "../../../../docs/assets/best-practices/original-image/wechat-chat-message-import/import-as-note.png";
import wechatArticleEnterImg from "../../../../docs/assets/best-practices/original-image/app-share/wechat-article/share-enter.jpg";
import wechatArticleSharingImg from "../../../../docs/assets/best-practices/original-image/app-share/wechat-article/sharing.jpg";
import wechatArticleInNoteImg from "../../../../docs/assets/best-practices/original-image/app-share/wechat-article/in-note.jpg";
import socialImageEnterImg from "../../../../docs/assets/best-practices/original-image/app-share/socia-image/share-enter.jpg";
import socialImageSharingImg from "../../../../docs/assets/best-practices/original-image/app-share/socia-image/sharing.jpg";
import socialImageInNoteImg from "../../../../docs/assets/best-practices/original-image/app-share/socia-image/share-in-note.jpg";
import xhsClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/xiaohongshu/xiaohongshu.png";
import xhsInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/xiaohongshu/xiaohongshu-in-note.png";
import twitterClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/twitter/twitter.png";
import twitterInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/twitter/twitter-in-note.png";
import zhihuClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/zhihu/zhihu.png";
import zhihuInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/zhihu/zhihu-in-note.png";
import redditClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/reddit/reddit.png";
import redditInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/reddit/reddit-in-note.png";
import aiMindmapImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-mindmap.png";
import aiFlowchartImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-flowchart.png";
import aiArchitectureImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-architecture.png";
import aiInfographicRoadmapImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-infographic-ai-roadmap.png";
import aiInfographicBytedanceImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-infographic-bytedance.png";
import databaseHotSelectImg from "../../../../docs/assets/best-practices/original-image/database-note/database-hot-select.png";
import databaseEmployeeImg from "../../../../docs/assets/best-practices/original-image/database-note/database-employee-register.png";
import databaseFormCreateImg from "../../../../docs/assets/best-practices/original-image/database-note/database-form-create.png";
import databaseFormOnlineImg from "../../../../docs/assets/best-practices/original-image/database-note/database-form-online.png";
import acpSupportListImg from "../../../../docs/assets/best-practices/original-image/acp/acp-support-list.png";
import acpSupportDialogImg from "../../../../docs/assets/best-practices/original-image/acp/acp-support-list-dialog.png";
import noteExportClearImg from "../../../../docs/assets/best-practices/original-image/note-export-image/clear-theme.png";
import noteExportCodeImg from "../../../../docs/assets/best-practices/original-image/note-export-image/code-theme.png";
import posterStudioImg from "../../../../docs/assets/best-practices/original-image/poster/ai-generate-poster.png";
import wechatCopyMenuImg from "../../../../docs/assets/best-practices/original-image/wechat-article-copy-to/right-menu.png";
import wechatCopyEditorImg from "../../../../docs/assets/best-practices/original-image/wechat-article-copy-to/show-in-wechat-editor.png";
import pluginOfficialImg from "../../../../docs/assets/best-practices/original-image/plugin/official-in.png";
import pluginApiImg from "../../../../docs/assets/best-practices/original-image/plugin/plugin-api.png";

export type ShowcaseCaseId =
  | "three-pane"
  | "wechat-chat"
  | "wechat-article"
  | "mobile-image"
  | "xiaohongshu"
  | "twitter"
  | "zhihu"
  | "reddit"
  | "ai-diagrams"
  | "ai-infographics"
  | "ai-database"
  | "database-form"
  | "acp-agent"
  | "note-export-image"
  | "poster-studio"
  | "wechat-mp-copy"
  | "plugin-ecosystem";

export type ShowcaseMediaLayout = "stack" | "grid-2" | "grid-3";

export interface ShowcaseCaseAssetConfig {
  layout: ShowcaseMediaLayout;
  images: ImageMetadata[];
}

export const showcaseCaseAssets: Record<ShowcaseCaseId, ShowcaseCaseAssetConfig> = {
  "three-pane": {
    layout: "stack",
    images: [classThreePaneImg],
  },
  "wechat-chat": {
    layout: "stack",
    images: [wechatChatSelectImg, wechatChatNoteImg],
  },
  "wechat-article": {
    layout: "grid-3",
    images: [wechatArticleEnterImg, wechatArticleSharingImg, wechatArticleInNoteImg],
  },
  "mobile-image": {
    layout: "grid-3",
    images: [socialImageEnterImg, socialImageSharingImg, socialImageInNoteImg],
  },
  xiaohongshu: {
    layout: "stack",
    images: [xhsClipImg, xhsInNoteImg],
  },
  twitter: {
    layout: "stack",
    images: [twitterClipImg, twitterInNoteImg],
  },
  zhihu: {
    layout: "stack",
    images: [zhihuClipImg, zhihuInNoteImg],
  },
  reddit: {
    layout: "stack",
    images: [redditClipImg, redditInNoteImg],
  },
  "ai-diagrams": {
    layout: "stack",
    images: [aiMindmapImg, aiFlowchartImg, aiArchitectureImg],
  },
  "ai-infographics": {
    layout: "stack",
    images: [aiInfographicRoadmapImg, aiInfographicBytedanceImg],
  },
  "ai-database": {
    layout: "stack",
    images: [databaseHotSelectImg, databaseEmployeeImg],
  },
  "database-form": {
    layout: "stack",
    images: [databaseFormCreateImg, databaseFormOnlineImg],
  },
  "acp-agent": {
    layout: "stack",
    images: [acpSupportListImg, acpSupportDialogImg],
  },
  "note-export-image": {
    layout: "stack",
    images: [noteExportClearImg, noteExportCodeImg],
  },
  "poster-studio": {
    layout: "stack",
    images: [posterStudioImg],
  },
  "wechat-mp-copy": {
    layout: "stack",
    images: [wechatCopyMenuImg, wechatCopyEditorImg],
  },
  "plugin-ecosystem": {
    layout: "stack",
    images: [pluginOfficialImg, pluginApiImg],
  },
};

export interface ShowcaseMediaCopy {
  caption: string;
  alt: string;
}

export interface ShowcaseCaseLink {
  label: string;
  href: string;
}

export interface ShowcaseCaseCopy {
  id: ShowcaseCaseId;
  number: string;
  title: string;
  lead: string;
  bullets: string[];
  links?: ShowcaseCaseLink[];
  media: ShowcaseMediaCopy[];
}

export interface ShowcaseCategoryCopy {
  id: string;
  badge: string;
  title: string;
  description: string;
  cases: ShowcaseCaseCopy[];
}

export interface BestPracticesPageLocaleCopy {
  eyebrow: string;
  title: string;
  description: string;
  zoomHint: string;
  closePreview: string;
  demoCta: string;
  deployCta: string;
  githubDocCta: string;
  githubDocHref: string;
  categories: ShowcaseCategoryCopy[];
}

const zhCnCategories: ShowcaseCategoryCopy[] = [
  {
    id: "workspace",
    badge: "01 · 核心工作区",
    title: "核心工作区与沉浸创作",
    description: "保留经典「目录树 · 笔记列表 · 编辑区」三栏布局，兼顾所见即所得与 Markdown 混写。",
    cases: [
      {
        id: "three-pane",
        number: "01",
        title: "经典三栏工作区与沉浸排版写作",
        lead: "EdgeEver 采用「目录树 · 笔记列表 · 编辑区」三栏布局，兼顾高效检索与沉浸创作。",
        bullets: [
          "专注模式：侧边栏支持拖拽调宽与折叠，随时切换全屏专注写作。",
          "混合编辑：主编辑区支持所见即所得（WYSIWYG）与 Markdown 语法混写。",
        ],
        media: [
          {
            caption: "三栏工作区布局",
            alt: "EdgeEver 经典三栏工作区与沉浸排版编辑效果",
          },
        ],
      },
    ],
  },
  {
    id: "capture",
    badge: "02 · 全渠道剪藏",
    title: "全渠道内容采集与剪藏",
    description: "从手机端系统分享、微信聊天记录归档，到小红书、X (Twitter)、知乎与 Reddit 的结构化网页剪藏。",
    cases: [
      {
        id: "wechat-chat",
        number: "02",
        title: "微信聊天记录归档与整理",
        lead: "在微信中多选对话点击「合并转发」，在「转发到其他应用」中选择 EdgeEver，自动转换为结构化笔记。",
        bullets: [
          "格式解析：解析发言人、时间轴、微信表情与超链接。",
          "资源转存：图片内嵌展示，文档与音视频（如 .xlsx、.pdf、.mp4）转为附件并支持全文检索。",
        ],
        media: [
          {
            caption: "1. 微信合并转发至 EdgeEver",
            alt: "微信转发到其他应用选择 EdgeEver",
          },
          {
            caption: "2. 结构化笔记预览",
            alt: "EdgeEver 导入后的微信聊天记录笔记效果",
          },
        ],
      },
      {
        id: "wechat-article",
        number: "03",
        title: "手机端剪藏微信公众号文章",
        lead: "在微信中阅读文章时，点击右上角菜单选择「用 EdgeEver 打开」即可完成剪藏。",
        bullets: [
          "提取标题、正文结构与配图，自动转换为清晰的 Markdown 笔记。",
        ],
        media: [
          {
            caption: "1. 选择「用 EdgeEver 打开」",
            alt: "微信文章分享菜单选择用 EdgeEver 打开",
          },
          {
            caption: "2. 内容提取中",
            alt: "EdgeEver 正在剪藏文章提取中",
          },
          {
            caption: "3. 剪藏生成的 Markdown 笔记",
            alt: "生成排版工整的微信文章笔记",
          },
        ],
      },
      {
        id: "mobile-image",
        number: "04",
        title: "移动端图片分享转存笔记",
        lead: "在任意手机应用中通过系统分享面板选择 EdgeEver，后台自动上传原图并创建以「分享的图片」为标题的笔记。",
        bullets: [
          "无需切换打断当前浏览流，系统级分享面板一键静默入库。",
        ],
        media: [
          {
            caption: "1. 分享图片",
            alt: "社媒 App 点击图片分享",
          },
          {
            caption: "2. 选择 EdgeEver",
            alt: "系统分享面板选择 EdgeEver",
          },
          {
            caption: "3. 生成图片笔记",
            alt: "自动生成笔记并上传图片",
          },
        ],
      },
      {
        id: "xiaohongshu",
        number: "05",
        title: "小红书图文笔记剪藏",
        lead: "使用 EdgeEver Web Clipper 插件在小红书笔记页面右键点击「保存笔记到 EdgeEver」。",
        bullets: [
          "提取标题、话题标签、正文、发布时间与原文链接。",
          "多图内容自动排版为多栏画廊。",
        ],
        media: [
          {
            caption: "1. 右键菜单剪藏",
            alt: "右键保存小红书笔记到 EdgeEver",
          },
          {
            caption: "2. 多栏画廊笔记效果",
            alt: "EdgeEver 剪藏后的小红书笔记多栏画廊效果",
          },
        ],
      },
      {
        id: "twitter",
        number: "06",
        title: "X (Twitter) 推文与引用剪藏",
        lead: "使用 EdgeEver Web Clipper 插件在推文上右键点击「保存推文到 EdgeEver」。",
        bullets: [
          "提取作者、推文正文、外链、引用推文（Quote Tweet）及附带图集。",
          "自动渲染为多栏画廊排版。",
        ],
        media: [
          {
            caption: "1. 右键保存推文",
            alt: "右键保存推文到 EdgeEver",
          },
          {
            caption: "2. 包含引用与图集的笔记效果",
            alt: "EdgeEver 剪藏后的 X 推文笔记效果",
          },
        ],
      },
      {
        id: "zhihu",
        number: "07",
        title: "知乎回答与文章剪藏",
        lead: "在知乎目标回答或文章处右键点击「保存回答/文章到 EdgeEver」。",
        bullets: [
          "解析问题标题、作者、正文、发布时间与原始链接，生成问答结构笔记。",
        ],
        media: [
          {
            caption: "1. 右键保存回答/文章",
            alt: "右键保存知乎回答到 EdgeEver",
          },
          {
            caption: "2. 问答结构笔记预览",
            alt: "EdgeEver 剪藏后的知乎回答笔记效果",
          },
        ],
      },
      {
        id: "reddit",
        number: "08",
        title: "Reddit 讨论帖剪藏",
        lead: "在 Reddit 帖子处右键点击「保存所选内容到 EdgeEver」。",
        bullets: [
          "捕获帖子标题、所属版块（Subreddit，如 r/AskReddit）、作者、时间戳及链接，保留社区元数据。",
        ],
        media: [
          {
            caption: "1. 右键保存帖子",
            alt: "右键保存 Reddit 帖子到 EdgeEver",
          },
          {
            caption: "2. 包含社区元数据的笔记预览",
            alt: "EdgeEver 剪藏后的 Reddit 帖子笔记效果",
          },
        ],
      },
    ],
  },
  {
    id: "ai-data",
    badge: "03 · AI 与多维数据",
    title: "AI 增强与多维数据组织",
    description: "一句话生成可交互思维导图、流程图、架构图、结构化信息图与多维表格，并支持 ACP 直连本机 Agent。",
    cases: [
      {
        id: "ai-diagrams",
        number: "09",
        title: "AI 对话生成思维导图、流程图与架构图",
        lead: "在 AI 伴随助手（或连接的本地 Agent）中输入自然语言指令，在笔记内直接生成可交互图表。",
        bullets: [
          "支持节点拖拽编辑、自动布局、条件分支与系统拓扑展示。",
        ],
        media: [
          {
            caption: "1. 交互式思维导图",
            alt: "AI 对话生成可编辑思维导图",
          },
          {
            caption: "2. 标准流程图",
            alt: "AI 对话生成可编辑流程图",
          },
          {
            caption: "3. 系统架构图",
            alt: "AI 对话生成可编辑系统架构图",
          },
        ],
      },
      {
        id: "ai-infographics",
        number: "10",
        title: "AI 生成结构化信息图（时间线、对比矩阵、象限图等）",
        lead: "利用内置模板库，在 AI 助手对话中描述要呈现的主题与重点，快速生成结构化视觉笔记。",
        bullets: [
          "涵盖时间线、对比矩阵、四象限、层级图等模板。",
          "支持对话微调内容，或直接导出为矢量图。",
        ],
        media: [
          {
            caption: "1. 技术演进路线信息图",
            alt: "AI 生成大模型技术演进路线信息图",
          },
          {
            caption: "2. 发展历程时间线信息图",
            alt: "AI 生成字节跳动发展历程时间线信息图",
          },
        ],
      },
      {
        id: "ai-database",
        number: "11",
        title: "AI 对话构建多维表格",
        lead: "在 AI 助手中发送自然语言指令（如“生成自媒体选题库”或“生成员工信息登记表”），自动搭建多维数据表。",
        bullets: [
          "自动配置单选标签、文本、日期、链接等字段类型。",
          "自动填充初始示例数据，支持视图切换、筛选排序与 CSV 导出。",
        ],
        media: [
          {
            caption: "1. 选题库多维表格",
            alt: "AI 生成自媒体选题库多维表格",
          },
          {
            caption: "2. 员工信息多维表格",
            alt: "AI 生成员工信息登记多维表格",
          },
        ],
      },
      {
        id: "database-form",
        number: "12",
        title: "多维表格生成公开收集表单",
        lead: "在多维表格顶部点击「表单收集」，将当前数据表转为公开在线表单。",
        bullets: [
          "填写者无需登录即可通过浏览器提交。",
          "提交的数据实时同步写入对应多维表格。",
        ],
        media: [
          {
            caption: "1. 开启「表单收集」",
            alt: "多维表格顶部点击表单收集按钮",
          },
          {
            caption: "2. 在线表单填报页面",
            alt: "对外公开的在线表单填报界面",
          },
        ],
      },
      {
        id: "acp-agent",
        number: "13",
        title: "连接本机 Agent (ACP) 实现笔记协同",
        lead: "EdgeEver 支持 ACP (Agent Client Protocol) 协议，允许桌面端连接本机运行的各类 AI Agent（如 Codex、Claude Code、DeepSeek Harness、Antigravity 等）。",
        bullets: [
          "本地授权：授予本地 Agent 当前账号笔记的安全读写权限。",
          "伴随对话：在笔记右侧栏直接协同，执行代码推理、长文总结与知识库检索。",
        ],
        media: [
          {
            caption: "1. 设置中心连接本地 Agent (ACP)",
            alt: "设置中心连接本机 Agent (ACP) 列表",
          },
          {
            caption: "2. 笔记侧边栏协同交互",
            alt: "右侧 AI 伴随助手与本机 Agent 协同问答",
          },
        ],
      },
    ],
  },
  {
    id: "publishing",
    badge: "04 · 排版与分发",
    title: "排版与多渠道分发",
    description: "一键导出多主题长图与代码卡片、40+ 模板海报设计工作台，以及微信公众号富文本直粘排版。",
    cases: [
      {
        id: "note-export-image",
        number: "14",
        title: "笔记导出多主题长图与代码卡片",
        lead: "使用「分享为图片」功能，将笔记排版为高分辨率长图或卡片。",
        bullets: [
          "多款卡片样式：内置 8 款卡片主题（透明质感、金句、书摘、备忘录等），支持字体与版式微调，一键导出高清长图或复制至剪贴板。",
          "技术代码卡片：专属代码主题内置 macOS 窗口控件、行号与等宽代码排版。",
        ],
        media: [
          {
            caption: "1. 「透明」等多款卡片主题预览",
            alt: "EdgeEver 分享为图片透明主题卡片预览",
          },
          {
            caption: "2. 字体风格与排版微调",
            alt: "EdgeEver 分享为图片字体与主题排版调整",
          },
        ],
      },
      {
        id: "poster-studio",
        number: "15",
        title: "笔记制作社交媒体海报与封面",
        lead: "在笔记操作菜单中选择「制作海报」（或通过「新建 → 海报」），将笔记标题与要点导入海报设计工作台。",
        bullets: [
          "提供 40+ 款设计模板，支持小红书 3:4、朋友圈 1:1 及横版等画幅。",
          "画布中可自由调整排版、配色与装饰元素，支持导出高分辨率图片。",
        ],
        media: [
          {
            caption: "海报设计工作台与模板库",
            alt: "EdgeEver 海报设计工作台与丰富设计模板",
          },
        ],
      },
      {
        id: "wechat-mp-copy",
        number: "16",
        title: "复制笔记至微信公众号排版",
        lead: "在笔记菜单中选择「复制到公众号 / 博客」，将笔记转换为内联 CSS 样式的富文本。",
        bullets: [
          "粘贴至微信公众号后台，完整保留表格、引用块、代码块、列表及字体样式。",
        ],
        media: [
          {
            caption: "1. 复制到公众号 / 博客",
            alt: "EdgeEver 笔记菜单点击复制到公众号",
          },
          {
            caption: "2. 公众号后台编辑器粘贴效果",
            alt: "微信公众号后台粘贴后的排版效果",
          },
        ],
      },
    ],
  },
  {
    id: "ecosystem",
    badge: "05 · 插件生态",
    title: "开放生态与插件扩展",
    description: "内置插件扩展中心与开放 API，支持通过 GitHub 仓库或 Manifest 一键安装并跨端隔离同步。",
    cases: [
      {
        id: "plugin-ecosystem",
        number: "17",
        title: "开放插件 API 与自定义插件开发",
        lead: "EdgeEver 内置插件扩展管理，支持通过 GitHub 仓库或 Manifest 地址一键安装，配置在 Web 与桌面端跨设备隔离同步。",
        bullets: [
          "核心 API 能力：提供文档双向读写、自定义 DOM 面板/嵌入块、统一设置、隔离存储以及调用工作区已配置的 AI 模型。",
          "官方开源插件范式：待办任务汇总（EdgeEver Tasks）与 AI RSS 每日简报助手（EdgeEver AI RSS）。",
        ],
        links: [
          {
            label: "EdgeEver Tasks 仓库",
            href: "https://github.com/tianma-if/edgeever-tasks",
          },
          {
            label: "EdgeEver AI RSS 仓库",
            href: "https://github.com/tianma-if/edgeever-ai-rss",
          },
          {
            label: "插件开发指南",
            href: "https://github.com/tianma-if/edgeever/blob/main/docs/plugin-development.zh-CN.md",
          },
        ],
        media: [
          {
            caption: "1. 插件与主题管理中心",
            alt: "EdgeEver 插件市场与官方插件管理",
          },
          {
            caption: "2. 插件 API 体系与开发文档",
            alt: "EdgeEver 插件开发 API 命名空间与规范文档",
          },
        ],
      },
    ],
  },
];

const enUsCategories: ShowcaseCategoryCopy[] = [
  {
    id: "workspace",
    badge: "01 · Core Workspace",
    title: "Core Workspace & Focused Writing",
    description: "A classic three-pane structure (Notebook Tree · Note Stream · Editor Canvas) with hybrid WYSIWYG and Markdown editing.",
    cases: [
      {
        id: "three-pane",
        number: "01",
        title: "Classic Three-Pane Workspace & Distraction-Free Editing",
        lead: "EdgeEver features a classic three-pane structure (Notebook Tree · Note Stream · Editor Canvas):",
        bullets: [
          "Focus Mode: Resizable and collapsible sidebars allow instant toggling into full-screen writing mode.",
          "Hybrid Editing: The main editor supports both WYSIWYG rich text and Markdown syntax.",
        ],
        media: [
          {
            caption: "Three-Pane Workspace Layout",
            alt: "EdgeEver classic three-pane workspace with rich editor",
          },
        ],
      },
    ],
  },
  {
    id: "capture",
    badge: "02 · Omnichannel Capture",
    title: "Omnichannel Capture & Ingestion",
    description: "From mobile system share sheets and chat history archiving to structured Web Clipper capture across X, Reddit, Xiaohongshu, and Zhihu.",
    cases: [
      {
        id: "wechat-chat",
        number: "02",
        title: "WeChat Chat History Archiving",
        lead: "Select messages in WeChat, tap \"Combine and Forward\", and choose EdgeEver under \"Forward to Other Apps\" to convert conversations into structured notes.",
        bullets: [
          "Format Parsing: Parses senders, timestamps, emojis, and links into clean layouts.",
          "Media Preservation: Images are embedded inline; documents and media files (.xlsx, .pdf, .mp4) are saved as attachments with full-text search support.",
        ],
        media: [
          {
            caption: "1. Forward to EdgeEver",
            alt: "WeChat share to EdgeEver",
          },
          {
            caption: "2. Structured Note Preview",
            alt: "WeChat chat history imported into EdgeEver note",
          },
        ],
      },
      {
        id: "wechat-article",
        number: "03",
        title: "WeChat Article Clipping on Mobile",
        lead: "When reading WeChat Official Account articles on mobile, select \"Open in EdgeEver\" from the top-right menu.",
        bullets: [
          "Automatically extracts the title, body structure, and embedded images into clean Markdown.",
        ],
        media: [
          {
            caption: "1. Select \"Open in EdgeEver\"",
            alt: "WeChat article share menu select open in EdgeEver",
          },
          {
            caption: "2. Extracting Content",
            alt: "EdgeEver clipping modal extracting article",
          },
          {
            caption: "3. Generated Markdown Note",
            alt: "WeChat article clipped into neat note",
          },
        ],
      },
      {
        id: "mobile-image",
        number: "04",
        title: "Mobile Image Sharing to Notes",
        lead: "Select EdgeEver in the mobile system share sheet from any app to upload images and create notes titled \"Shared Image\" in the background.",
        bullets: [
          "Capture visual inspiration from any mobile app without interrupting your reading flow.",
        ],
        media: [
          {
            caption: "1. Share Image",
            alt: "Mobile app tap image share",
          },
          {
            caption: "2. Choose EdgeEver",
            alt: "System share sheet choose EdgeEver",
          },
          {
            caption: "3. Generated Image Note",
            alt: "Auto-created note with uploaded image",
          },
        ],
      },
      {
        id: "xiaohongshu",
        number: "05",
        title: "Xiaohongshu (RED) Note Clipping",
        lead: "Right-click any note page and select \"Save Note to EdgeEver\" using the EdgeEver Web Clipper extension.",
        bullets: [
          "Captures title, topic tags, body text, publish timestamp, and source URL.",
          "Automatically formats multi-image sets into multi-column gallery layouts.",
        ],
        media: [
          {
            caption: "1. Right-Click Clipper Menu",
            alt: "Right-click save Xiaohongshu note to EdgeEver",
          },
          {
            caption: "2. Multi-Column Gallery Note",
            alt: "Xiaohongshu note clipped into multi-column gallery",
          },
        ],
      },
      {
        id: "twitter",
        number: "06",
        title: "X (Twitter) Post & Quote Clipping",
        lead: "Right-click any post and select \"Save Tweet to EdgeEver\" with the EdgeEver Web Clipper extension.",
        bullets: [
          "Extracts author info, tweet content, external links, quote tweets, and multi-image attachments.",
          "Formats content into a multi-column gallery layout.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Tweet",
            alt: "Right-click save tweet to EdgeEver",
          },
          {
            caption: "2. Note with Quotes & Gallery",
            alt: "X tweet clipped into EdgeEver note with quote",
          },
        ],
      },
      {
        id: "zhihu",
        number: "07",
        title: "Zhihu Answer & Column Article Clipping",
        lead: "Right-click any specific answer or article and select \"Save Answer/Article to EdgeEver\".",
        bullets: [
          "Parses question title, author, body, timestamp, and permalink into a structured Q&A note.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Answer/Article",
            alt: "Right-click save Zhihu answer to EdgeEver",
          },
          {
            caption: "2. Structured Q&A Note Preview",
            alt: "Zhihu answer clipped into EdgeEver note",
          },
        ],
      },
      {
        id: "reddit",
        number: "08",
        title: "Reddit Discussion Post Clipping",
        lead: "Right-click on the post title or body and select \"Save Selection to EdgeEver\".",
        bullets: [
          "Captures thread title, subreddit (e.g. r/AskReddit), author handle, timestamp, and permalink to preserve community metadata.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Post",
            alt: "Right-click save Reddit post to EdgeEver",
          },
          {
            caption: "2. Note with Community Metadata",
            alt: "Reddit post clipped into EdgeEver note",
          },
        ],
      },
    ],
  },
  {
    id: "ai-data",
    badge: "03 · AI & Structured Data",
    title: "AI-Powered Structuring & Multi-Dimensional Data",
    description: "Generate editable mind maps, flowcharts, architecture diagrams, infographics, and database tables from natural language, or connect local agents via ACP.",
    cases: [
      {
        id: "ai-diagrams",
        number: "09",
        title: "AI Conversational Generation of Mind Maps, Flowcharts & Architecture Diagrams",
        lead: "Prompt the AI Co-pilot (or connected local Agent) with natural language to create editable diagrams directly in notes.",
        bullets: [
          "Supports drag-and-drop node editing, auto-layout, conditional branches, and system topologies.",
        ],
        media: [
          {
            caption: "1. Interactive Mind Map",
            alt: "AI chat generates editable mind map",
          },
          {
            caption: "2. Standard Flowchart",
            alt: "AI chat generates editable flowchart",
          },
          {
            caption: "3. System Architecture Diagram",
            alt: "AI chat generates editable architecture diagram",
          },
        ],
      },
      {
        id: "ai-infographics",
        number: "10",
        title: "AI Generation of Structured Infographics (Timelines, Matrices & Quadrants)",
        lead: "Use built-in infographic templates (timelines, comparison matrices, quadrants, and hierarchy charts) by prompting the AI Co-pilot with your topic.",
        bullets: [
          "Organizes key facts and milestones into structured visual infographic notes.",
          "Refine through conversational follow-ups or export directly to vector graphics.",
        ],
        media: [
          {
            caption: "1. Technology Roadmap Infographic",
            alt: "AI generated LLM technology roadmap infographic",
          },
          {
            caption: "2. Milestone Timeline Infographic",
            alt: "AI generated ByteDance milestone timeline",
          },
        ],
      },
      {
        id: "ai-database",
        number: "11",
        title: "AI Conversational Database Table Generation",
        lead: "Send a prompt to the AI Co-pilot (e.g., \"Create a database table for social media content planning\" or \"Generate an employee onboarding tracker\") to construct complete data tables.",
        bullets: [
          "Infers column types (tags, text, dates, links) with initial sample rows.",
          "Supports views, filtering, sorting, and CSV export.",
        ],
        media: [
          {
            caption: "1. Content Planning Table",
            alt: "AI generated media topic tracker table",
          },
          {
            caption: "2. Employee Directory Table",
            alt: "AI generated employee directory database table",
          },
        ],
      },
      {
        id: "database-form",
        number: "12",
        title: "Public Online Form Collection from Database Tables",
        lead: "Click \"Form Collection\" at the top of any database table to generate a public online data entry form.",
        bullets: [
          "External respondents can submit information via browser without logging in.",
          "Submissions sync directly to the database table in real time.",
        ],
        media: [
          {
            caption: "1. Open \"Form Collection\"",
            alt: "Click form collection button in database",
          },
          {
            caption: "2. Public Form Page",
            alt: "Public online form submission interface",
          },
        ],
      },
      {
        id: "acp-agent",
        number: "13",
        title: "Connecting Local Agents via ACP for Note Interaction",
        lead: "EdgeEver natively supports ACP (Agent Client Protocol), allowing desktop clients to connect with local AI agent environments (such as Codex, Claude Code, DeepSeek Harness, Antigravity, etc.).",
        bullets: [
          "Local Authorization: Grants local agents secure read/write access to user notes.",
          "In-Editor Chat: Converse directly with local agents from the note sidebar for code reasoning, document synthesis, and knowledge retrieval.",
        ],
        media: [
          {
            caption: "1. Connect Local Agents via ACP in Settings",
            alt: "ACP client support list in settings",
          },
          {
            caption: "2. Note Sidebar Interaction",
            alt: "Sidebar chat with local ACP Agent",
          },
        ],
      },
    ],
  },
  {
    id: "publishing",
    badge: "04 · Styling & Publishing",
    title: "Visual Styling & Omnichannel Publishing",
    description: "Render notes into multi-theme share cards, design social media covers with 40+ templates, and copy inline-styled HTML for newsletters and blogs.",
    cases: [
      {
        id: "note-export-image",
        number: "14",
        title: "Note Export to Long Image & Code Cards",
        lead: "Use the \"Share as Image\" feature to render notes into high-resolution long images or cards.",
        bullets: [
          "Multiple Card Themes: Choose from 8 curated card themes (Transparent, Quote, Book Excerpt, Memo, Dark, and more) with customizable typography and layout.",
          "Technical Code Cards: A dedicated \"Code\" theme features macOS-style window controls, line numbers, and monospace syntax highlighting.",
        ],
        media: [
          {
            caption: "1. Card Theme Previews (e.g. Transparent)",
            alt: "EdgeEver share as image transparent theme preview",
          },
          {
            caption: "2. Font & Layout Customization",
            alt: "EdgeEver share as image font and typography settings",
          },
        ],
      },
      {
        id: "poster-studio",
        number: "15",
        title: "Social Media Poster & Cover Design from Notes",
        lead: "Click \"Create Poster\" in any note's action menu (or via \"New → Poster\") to load key takeaways and titles into the Poster Design Studio.",
        bullets: [
          "Offers 40+ design templates supporting 3:4, 1:1, and landscape aspect ratios.",
          "Customize layout, colors, and design elements on the canvas, then export high-resolution PNGs.",
        ],
        media: [
          {
            caption: "Poster Design Studio & Templates",
            alt: "EdgeEver poster studio with rich design templates",
          },
        ],
      },
      {
        id: "wechat-mp-copy",
        number: "16",
        title: "Copying Notes to WeChat Official Account & Blogs",
        lead: "Select \"Copy to Official Account / Blog\" from the note menu to convert notes into rich text with inline CSS.",
        bullets: [
          "Paste directly into WeChat Official Account or blog editors while preserving tables, callouts, code blocks, lists, and typography styles.",
        ],
        media: [
          {
            caption: "1. Copy to Official Account / Blog",
            alt: "EdgeEver note menu copy to WeChat MP",
          },
          {
            caption: "2. Rich Text Editor Paste Result",
            alt: "Note pasted into WeChat MP editor layout",
          },
        ],
      },
    ],
  },
  {
    id: "ecosystem",
    badge: "05 · Open Ecosystem",
    title: "Open Ecosystem & Extensibility",
    description: "Built-in extension manager and open Plugin API with one-click GitHub or Manifest installation and cross-device workspace sync.",
    cases: [
      {
        id: "plugin-ecosystem",
        number: "17",
        title: "Open Plugin API & Custom Plugin Development",
        lead: "EdgeEver features an extension manager supporting one-click installation via GitHub repository URLs or Manifest links, with cross-device workspace synchronization between Web and Desktop.",
        bullets: [
          "Core API Capabilities: Bidirectional note read/write, custom DOM panels/embed blocks, unified settings, isolated storage, and direct invocation of workspace-configured AI models.",
          "Official Reference Plugins: Task Aggregation (EdgeEver Tasks) and AI RSS Feed Assistant (EdgeEver AI RSS).",
        ],
        links: [
          {
            label: "EdgeEver Tasks Repo",
            href: "https://github.com/tianma-if/edgeever-tasks",
          },
          {
            label: "EdgeEver AI RSS Repo",
            href: "https://github.com/tianma-if/edgeever-ai-rss",
          },
          {
            label: "Plugin Development Guide",
            href: "https://github.com/tianma-if/edgeever/blob/main/docs/plugin-development.md",
          },
        ],
        media: [
          {
            caption: "1. Extension & Plugin Management Center",
            alt: "EdgeEver plugin marketplace and official extension management",
          },
          {
            caption: "2. Plugin API Namespaces & Documentation",
            alt: "EdgeEver plugin development API reference and documentation",
          },
        ],
      },
    ],
  },
];

export const bestPracticesPageCopy: Record<SiteLocale, BestPracticesPageLocaleCopy> = {
  "zh-CN": {
    eyebrow: "BEST PRACTICES & SHOWCASE",
    title: "EdgeEver 17 个真机场景与实操指南",
    description:
      "涵盖三栏沉浸写作、微信与全渠道结构化剪藏、AI 对话生成导图/信息图/多维表格、本机 ACP Agent 协同、海报与长图分享及开放插件生态的完整实机演示。",
    zoomHint: "点击任意截图可放大查看高清细节",
    closePreview: "关闭预览",
    demoCta: "打开在线演示",
    deployCta: "一键 AI 部署",
    githubDocCta: "在 GitHub 查看原文档",
    githubDocHref: "https://github.com/tianma-if/edgeever/blob/main/docs/best-practices.zh-CN.md",
    categories: zhCnCategories,
  },
  "en-US": {
    eyebrow: "BEST PRACTICES & SHOWCASE",
    title: "17 Real-World EdgeEver Workflows & Showcase",
    description:
      "A visual walkthrough of core EdgeEver workflows across desktop and mobile: three-pane writing, omnichannel clipping, AI diagrams & databases, local ACP agents, poster studio, and open plugins.",
    zoomHint: "Click any screenshot to inspect full-resolution details",
    closePreview: "Close preview",
    demoCta: "Open Live Demo",
    deployCta: "Deploy with AI",
    githubDocCta: "View Document on GitHub",
    githubDocHref: "https://github.com/tianma-if/edgeever/blob/main/docs/best-practices.md",
    categories: enUsCategories,
  },
  ja: {
    eyebrow: "BEST PRACTICES & SHOWCASE",
    title: "EdgeEver 17 の実機デモとベストプラクティス",
    description:
      "クラシックな三ペイン執筆、マルチチャネル Web クリッピング、AI による図解・インフォグラフィック・多次元テーブル生成、ローカル ACP Agent 連携、ポスター作成、プラグイン拡張までの実機ワークフロー集です。",
    zoomHint: "スクリーンショットをクリックすると拡大表示できます",
    closePreview: "プレビューを閉じる",
    demoCta: "ライブデモを開く",
    deployCta: "AI で導入",
    githubDocCta: "GitHub でドキュメントを見る",
    githubDocHref: "https://github.com/tianma-if/edgeever/blob/main/docs/best-practices.md",
    categories: enUsCategories,
  },
  pl: {
    eyebrow: "BEST PRACTICES & SHOWCASE",
    title: "17 praktycznych scenariuszy i prezentacja EdgeEver",
    description:
      "Wizualny przewodnik po najważniejszych przepływach pracy w EdgeEver na komputerze i telefonie: pisanie w trzech panelach, wycinanie treści z sieci, diagramy i bazy danych AI, lokalni agenci ACP, studio plakatów i wtyczki.",
    zoomHint: "Kliknij dowolny zrzut ekranu, aby powiększyć",
    closePreview: "Zamknij podgląd",
    demoCta: "Otwórz demo na żywo",
    deployCta: "Wdróż z AI",
    githubDocCta: "Zobacz dokument na GitHub",
    githubDocHref: "https://github.com/tianma-if/edgeever/blob/main/docs/best-practices.md",
    categories: enUsCategories,
  },
};
