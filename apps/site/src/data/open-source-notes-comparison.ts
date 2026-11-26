import type { SiteLocale } from "../i18n";

export const notesComparisonPath = "/guides/open-source-note-taking-apps/";
export const notesComparisonLocales = ["zh-CN", "en-US"] as const;

export const notesComparisonCopy = {
  "zh-CN": {
    title: "支持手机和电脑同步的开源笔记软件",
    description: "按同步方式、部署成本、网页剪藏和导出比较 EdgeEver、Joplin、思源笔记和 Memos，附三项可自行复测的操作。",
    intro: "选开源笔记软件时，先看手机和电脑通过什么同步，以及以后如何导出。EdgeEver 适合想自己托管、同时需要手机和电脑客户端、经常剪藏网页的人。看重自选同步后端、块引用或时间线速记，可以从下面的对应选项开始。",
    disclosure: "本文由 EdgeEver 维护者撰写。对照表基于各项目的公开文档，文末附可自行复测的步骤。",
    linkLabel: "比较支持跨端同步的开源笔记软件",
    comparison: "同步、剪藏与导出对照",
    headers: ["软件", "同步与部署", "网页剪藏或采集", "导出"],
    products: [
      {
        name: "EdgeEver",
        sources: [{ label: "项目文档", href: "https://github.com/tianma-if/edgeever/blob/main/README.zh-CN.md" }],
        cells: [
          "桌面端、手机端和网页端连接同一实例。在自己的 Cloudflare 账号部署，或用 Docker 自建。Cloudflare 免费额度内可零费用运行，开通 R2 需要绑定付款方式。",
          "浏览器扩展可剪藏全文或选区，手机端也可通过系统分享采集。",
          "Markdown 导出和含附件的 ZIP 备份。",
        ],
      },
      {
        name: "Joplin",
        sources: [
          { label: "同步", href: "https://joplinapp.org/help/apps/sync/" },
          { label: "剪藏", href: "https://joplinapp.org/help/apps/clipper/" },
          { label: "导出", href: "https://joplinapp.org/help/apps/import_export/" },
        ],
        cells: [
          "桌面与移动端可通过 WebDAV、Nextcloud、OneDrive 等同步，也可选付费 Joplin Cloud。是否需要自建取决于所选同步服务。",
          "浏览器 Web Clipper 通过桌面端的剪藏服务保存网页。",
          "Markdown 或 JEX 备份。",
        ],
      },
      {
        name: "思源笔记",
        sources: [
          { label: "功能", href: "https://github.com/siyuan-note/siyuan" },
          { label: "同步定价", href: "https://b3log.org/siyuan/pricing.html" },
        ],
        cells: [
          "桌面端和手机端均可本地使用。内置的官方云同步和第三方 WebDAV／S3 同步功能付费，也可用 Docker 部署后通过浏览器访问同一实例。",
          "提供网页剪藏扩展，并支持块引用和双向链接。",
          "可导出带资源文件的标准 Markdown。",
        ],
      },
      {
        name: "Memos",
        sources: [
          { label: "项目文档", href: "https://github.com/usememos/memos" },
          { label: "导出", href: "https://usememos.com/docs/usage/export-import" },
        ],
        cells: [
          "通过手机和电脑浏览器访问同一个自托管实例。可用 Docker 部署。",
          "时间线便于随手记文字和链接，支持通过 API 接入自定义采集流程。",
          "管理员可导出包含 Markdown 正文、JSON 元数据与附件的 ZIP。",
        ],
      },
    ],
    testTitle: "在自己的设备上做三项检查",
    checks: [
      "手机离线记一条。创建样例笔记，加一个标签和一张图片，再断网追加一行。重新打开笔记，检查追加的文字是否保留，然后恢复联网。",
      "在电脑上续写。检查同一条笔记的正文、标签和图片是否到齐，记录需要等待多久或是否要手动刷新。电脑追加一行后，在手机上确认。",
      "剪藏并导出。用支持的剪藏方式保存一篇带小标题和图片的公开网页，核对原链接、正文和图片。再导出笔记，解压并用其他编辑器打开 Markdown。",
    ],
    sampleLabel: "用于复测的中文 MDN 样文",
    fitTitle: "按你的工作方式选",
    choices: [
      "想自己托管，同时要桌面和手机客户端及网页剪藏，可以试 EdgeEver。跨端同步前需要准备一个实例。",
      "已有 WebDAV 或 Nextcloud，并想沿用当前存储方式，可以试 Joplin。",
      "重视块引用和双链，可以试思源笔记。以时间线随手记为主，可以试 Memos。",
    ],
    demo: "打开 EdgeEver 公开演示",
    docs: "查看 EdgeEver 部署指南",
    migration: "从印象笔记迁移",
  },
  "en-US": {
    title: "Open-source note-taking apps that sync across phone and desktop",
    description: "Compare EdgeEver, Joplin, SiYuan, and Memos on sync, setup, web clipping, and export. Three practical checks help you try them on your own devices.",
    intro: "Start with how your phone and computer share notes, then check how you can take the data with you. EdgeEver fits readers who want self-hosted sync, desktop and mobile apps, and web clipping. Other workflows favour a choice of sync providers, block references, or a lightweight timeline.",
    disclosure: "Written by the EdgeEver maintainers. The comparison draws on each project’s public documentation. Use the checks below to evaluate the tools on your own devices.",
    linkLabel: "Compare open-source notes apps with cross-device sync",
    comparison: "Sync, web capture, and export",
    headers: ["App", "Sync and setup", "Web capture", "Export"],
    products: [
      {
        name: "EdgeEver",
        sources: [{ label: "Project docs", href: "https://github.com/tianma-if/edgeever" }],
        cells: [
          "Desktop, mobile, and web clients connect to one instance. Deploy to your Cloudflare account or run it with Docker. Cloudflare usage within the free allowances can cost $0. Activating R2 requires a payment method.",
          "The browser extension captures full pages or selections. The mobile apps also accept content from the system share sheet.",
          "Markdown export and ZIP backups with attachments.",
        ],
      },
      {
        name: "Joplin",
        sources: [
          { label: "Sync", href: "https://joplinapp.org/help/apps/sync/" },
          { label: "Clipper", href: "https://joplinapp.org/help/apps/clipper/" },
          { label: "Export", href: "https://joplinapp.org/help/apps/import_export/" },
        ],
        cells: [
          "Desktop and mobile apps sync through targets such as WebDAV, Nextcloud, or OneDrive. Paid Joplin Cloud is also available. Setup depends on the sync target you pick.",
          "The browser extension saves pages through the clipper service in the desktop app.",
          "Markdown export or a JEX backup.",
        ],
      },
      {
        name: "SiYuan",
        sources: [
          { label: "Features", href: "https://github.com/siyuan-note/siyuan" },
          { label: "Sync pricing", href: "https://b3log.org/siyuan/en/pricing.html" },
        ],
        cells: [
          "Desktop and mobile apps support local use. Built-in cloud sync and third-party WebDAV or S3 sync are paid features. You can also run a Docker instance and open it in a browser.",
          "A browser extension handles web clipping. The editor supports block references and bidirectional links.",
          "Standard Markdown export with assets.",
        ],
      },
      {
        name: "Memos",
        sources: [
          { label: "Project docs", href: "https://github.com/usememos/memos" },
          { label: "Export", href: "https://usememos.com/docs/usage/export-import" },
        ],
        cells: [
          "Open the same self-hosted instance in your phone and desktop browsers. Docker deployment is supported.",
          "Use the timeline to jot down text and links, or connect your own capture workflow through the API.",
          "An administrator can export a ZIP with Markdown content, JSON metadata, and attachments.",
        ],
      },
    ],
    testTitle: "Three checks to run on your own devices",
    checks: [
      "Capture offline on your phone. Create a sample note with a tag and an image, then disconnect and add a line. Reopen the note to check that the edit persisted before you reconnect.",
      "Continue on your computer. Check for the body, tag, and image. Record the wait and any manual refresh. Add a line on desktop and look for it on your phone.",
      "Clip and export. Save a public article with headings and an image using the app’s supported capture method. Check what happens to the source link, text, and image. Export a note, unpack the archive if needed, and open the Markdown in another editor.",
    ],
    sampleLabel: "Chinese-language MDN sample article for the clipping check",
    fitTitle: "Pick the workflow that fits",
    choices: [
      "Try EdgeEver for self-hosted sync with desktop and mobile apps and a web clipper. Set up an instance before testing sync.",
      "Try Joplin if you already have a WebDAV or Nextcloud sync target and want to keep using it.",
      "Try SiYuan for block references and backlinks. Try Memos for quick notes in a timeline you can open from a browser.",
    ],
    demo: "Open the EdgeEver public demo",
    docs: "Read the EdgeEver deployment guide",
    migration: "Migrate from Evernote",
  },
};

export const getNotesComparisonCopy = (locale: SiteLocale) =>
  locale === "zh-CN" || locale === "en-US" ? notesComparisonCopy[locale] : undefined;
