<h1><img src="assets/brand/edgeever-icon.svg" alt="EdgeEver Logo" width="40" align="absmiddle" /> EdgeEver</h1>

[![GitHub Stars](https://img.shields.io/github/stars/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/network/members)

简体中文 | [English](README.md)

> **EdgeEver：开源、原生支持 AI、可自由部署的自托管「印象笔记」替代方案。**

EdgeEver 是一款现代化的开源笔记工作区。它为你找回经典印象笔记的三栏高效体验，同时具备完全开放的数据架构与原生 AI Agent 联动能力，让个人知识沉淀更轻量、更自由。

> 💡 **终身免服务器，100% 免费**
> EdgeEver 可以免费运行在 Cloudflare 配额内，无需购买或维护服务器；希望使用 VPS、NAS 或家庭服务器的用户，也可以通过 Docker 部署同一套应用。

> ⭐ 如果 EdgeEver 对你有帮助，欢迎点个 Star。你的支持会帮助更多人发现这个项目。

## 为什么做 EdgeEver

很多长期使用**印象笔记**的用户，核心需求只是一个**可靠、开放、响应迅速**的个人知识库。然而，当下的主流方案都各有痛点：

* **印象笔记**：功能日益臃肿，商业广告与繁杂附加功能充斥，性能与内存占用居高不下；且数据相对封闭难以导出，免费版限制重重，支持 AI/MCP 的套餐订阅成本高昂。
* **Obsidian**：功能强大且高度开放，但对于“随时随地随手记”的轻量场景来说偏重；官方同步费用昂贵，第三方同步配置繁琐。
* **Memos 等轻量笔记**：虽然简单好用，但流式卡片布局与习惯了经典“三栏工作流”的用户有着天然的交互习惯差异。

**EdgeEver 恰好填补了这一空白**：在保留你最熟悉的经典三栏布局与流畅排版的同时，赋予数据完全的自由度，原生支持接入 AI Agent，且部署维护零门槛、零费用。

> 💡 **最佳实践推荐：**
> 用 **EdgeEver** 随时捕捉灵感与备忘，作为知识的“原料库”；当需要结构化整理或创作发布时，既能通过 **MCP** 唤醒 AI 助手智能归纳并同步至 **Obsidian**、**Notion** 或**飞书多维表格**，也能一键将文章精美排版并复制到**微信公众号**直接发布。

## 在线演示

- Demo 地址：[https://demo.edgeever.org](https://demo.edgeever.org)

公开演示环境会在每天凌晨 3:00（北京时间）自动重置并恢复示例笔记，请不要保存私密内容。

## 功能

- **自由选择部署方式**：同一套应用既可免费运行于 Cloudflare Serverless，也可通过 Docker 部署到 VPS、NAS 或家庭服务器。按 Cloudflare 免费存储额度估算，个人部署可容纳约 15 万条短笔记和约 5 万张图片；Docker 存储可按需扩展，轻松承载百万级笔记与海量图片。
- **数据开放，不设围墙**：基于标准 SQLite 存储，提供 REST API、MCP 与 CLI 接口。数据随时可读可导，不再担心被任何特定平台绑定。
- **无损 ZIP 打包与无缝迁移**：一键打包导出包含 Markdown、Front Matter、嵌套目录及附件的完整档案，同时保留历史版本与结构化数据，方便在不同实例间完整还原。
- **原生 AI Agent 智脑联动**：内置 MCP（Model Context Protocol）协议，支持 Claude Code、Codex、Antigravity 等 AI 助手直接读取与整理笔记，也可与 Notion Database、飞书多维表格轻松打通。
- **接入自己的 AI 模型**：支持添加多个 OpenAI、Anthropic、Gemini 兼容服务与第三方中转平台，在编辑器中随时对全文或选区进行智能总结、要点提炼、语法校对、翻译与续写润色。
- **插件扩展能力**：支持从插件市场安装客户端插件与主题，扩展笔记操作、编辑器命令和自定义面板等能力。
- **多端无缝同步，无设备限制**：自托管数据无商业限制，摆脱免费账号仅限 2 台设备的束缚，在 PC、平板与手机上随心同步。
- **经典三栏布局与专注模式**：笔记本树、笔记列表与编辑区一目了然；桌面端一键开启专注模式，让思绪尽情铺满屏幕。
- **无限层级笔记本**：轻松构建清晰的多级目录结构。
- **微信公众号一键排版与复制**：专为中文创作者设计，支持将笔记一键转换为带行内样式的公众号美化格式，直接复制粘贴至微信公众号后台，告别复杂的第三方排版工具。
- **优雅的双视图编辑**：桌面端支持在富文本与 Markdown 源码视图之间自由切换。
- **单篇笔记便捷导出**：可将当前笔记直接导出为 Markdown、HTML 或 PDF，方便独立保存、分享与发布。
- **Mermaid 架构图与流程图渲染**：原生支持 Mermaid 代码块渲染，视图切换时完整保留可编辑源码，让绘制逻辑图表更直观。
- **笔记历史版本回溯**：自动记录修改历史，随时查阅与还原过往版本。
- **公开笔记分享**：支持公开分享笔记，并可随时取消分享。
- **移动 App 微信公众号文章剪藏**：在手机上将微信公众号文章分享至 EdgeEver，即可提取正文并保存为可继续编辑的笔记。
- **智能前端图片压缩**：图片上传前在浏览器端静默完成压缩，常见截图与大图精简 50%-90% 体积，加载更迅速、存储更省心。
- **通用文件附件支持**：支持轻松上传并插入 PDF、Office 文档、压缩包及音视频等各种附件。
- **高效多选与批量操作**：支持笔记批量合并、批量移动，以及笔记本拖拽排序与层级调整。
- **离线草稿与同步队列**：网络不稳定时自动保存离线草稿，恢复连线后自动入队同步。
- **多账号与个人空间隔离**：单实例支持创建多个独立账号，用户数据相互隔离，配备直观的管理员账号管理与安全加密机制。
- **全平台多端覆盖**：支持 Web、[Android](https://play.google.com/store/apps/details?id=org.edgeever.mobile)、[macOS](https://github.com/tianma-if/edgeever/releases)、[Windows x64 预览版](https://github.com/tianma-if/edgeever/releases/latest) 和 [iOS](https://apps.apple.com/us/app/edgeever/id6792625631)；网页裁剪插件支持 [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)、[Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo) 和 [Firefox](https://addons.mozilla.org/zh-CN/firefox/addon/edgeever-web-clipper/)。

## 部署

Cloudflare 是推荐的零服务器部署方式；希望使用 VPS、NAS 或家庭服务器的用户也可以选择 Docker。

Cloudflare 在线部署可以选择以下两种方式之一：

### 方案一：AI Agent 一键部署（推荐）

将下方提示词直接复制发送给 AI Agent（如 Codex、Claude、Cursor、workbuddy、Antigravity、OpenClaw、Hermes Agent 等）。执行过程中，如需访问 GitHub 或 Cloudflare，请确认权限范围并按提示完成授权。

```text
请在线完成 EdgeEver 部署：
1. Fork https://github.com/tianma-if/edgeever。
2. 将这个 Fork 导入 Cloudflare Workers & Pages。
3. 创建 D1 `edgeever` 与 R2 `edgeever-resources`，设置
   `EDGE_EVER_AUTH_PASSWORD` Worker Secret，并配置生产环境 `main` 构建。
4. 启动首次构建，验证 `/api/health`、`/api/openapi.json` 和登录。
5. 启用并手动运行一次名为 `Update deployed EdgeEver` 的 GitHub Actions 工作流，
   以便后续自动同步更新，持续获得 EdgeEver 最新的产品特性和问题修复。
```

> 详细约定与要求请查看：[AI Agent 在线部署约定](docs/agent-deploy-cloudflare.zh-CN.md)。

### 方案二：手动在线部署

仅需在网页端完成 5 步极简配置：

1. **Fork 仓库**：在 GitHub 点击右上角 **Fork**，将项目 Fork 到您的个人账户下。
2. **启用 Actions**：进入 Fork 的 **Actions** 标签页，点击 **I understand my workflows, go ahead and enable them**，确保名为 **Update deployed EdgeEver** 的 GitHub Actions 工作流能够自动运行，从而持续获得 **EdgeEver** 最新的产品特性和问题修复。
3. **导入 Cloudflare**：登录 Cloudflare 控制台，进入 **Workers & Pages**，选择导入该 Fork 仓库。
4. **创建资源与登录凭据**：创建 D1 `edgeever` 与 R2 `edgeever-resources`，并添加 Worker Secret `EDGE_EVER_AUTH_PASSWORD` 作为管理员登录密码。binding 由部署命令生成，不要修改 Fork 中的文件。
5. **启动构建与验证**：导入仓库后直接启动首次构建。部署完成后访问 `/api/health`，确认返回 `200` 即可开始使用。

> 📖 包含具体参数与构建命令的详细步骤，请查看 [在线部署完整文档](docs/deploy-cloudflare-button.zh-CN.md)。

> 💡 **Cloudflare R2 开通**：虽然 Cloudflare R2 存储提供了足够慷慨、在笔记场景中完全不会超量的[免费存储额度](https://developers.cloudflare.com/r2/pricing/#free-tier)，但需先开通 R2 subscription 并绑定付款方式。Cloudflare [官方支持](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) 银联（UnionPay）、Visa、Mastercard 等银行卡，以及 PayPal、Apple Pay、Google Pay 等付款方式。

### 方案三：在 VPS 或 NAS 上使用 Docker

使用 GitHub 托管的安装脚本和官方 GHCR 镜像：

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

该命令会自动拉取最新镜像、生成管理员密码、使用 Docker Compose 启动
EdgeEver，并设置每日自动更新。手动部署与配置说明见 [Docker 部署文档](docs/deploy-docker.zh-CN.md)。

EdgeEver 官方容器镜像托管于 GitHub Container Registry（GHCR）。部分中国大陆
网络环境可能出现连接缓慢或超时。如果无法正常拉取，请在部署前自行配置可用的
网络代理或可信的镜像加速服务。第三方网络及镜像服务的可用性和安全性由
用户自行评估。

---

## 多账号登录

部署完成后，单个实例支持多账号登录。

实例管理员可以在 **个人中心** -> **账号管理** 中创建、停用成员账号或重置密码。每个成员拥有完全隔离的个人空间，包括笔记本、笔记、附件、回收站、导入导出和 MCP Token 等。

## 浏览器网页裁剪插件

网页裁剪插件已在 Chrome、Microsoft Edge 与 Firefox 正式上架。请从对应的浏览器商店安装（Edge 浏览器亦可直接安装 Chrome Web Store 版本）：

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="为 Google Chrome 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="为 Microsoft Edge 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/zh-CN/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="为 Firefox 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>
</p>

## 关于客户端

原生客户端提供更流畅、稳定的使用体验，以及更完善的系统级集成，并支持本地存储与离线编辑。恢复联网后，内容会自动增量同步，适合高频使用和弱网场景。

Android App 现已上架 [Google Play](https://play.google.com/store/apps/details?id=org.edgeever.mobile)，也可从 [GitHub Releases](https://github.com/tianma-if/edgeever/releases) 下载签名 APK。iOS App 现已上架 [App Store](https://apps.apple.com/us/app/edgeever/id6792625631)，可使用非大陆区的 Apple ID 下载。

macOS App 与未签名的 [Windows x64 预览版](https://github.com/tianma-if/edgeever/releases/latest) 均可从 GitHub Releases 下载。Windows 预览版尚未使用 Authenticode 签名，系统或组织策略可能显示警告或阻止安装；请仅从 EdgeEver 官方 Release 下载。不要为安装 EdgeEver 降低 Windows 安全设置；如策略阻止安装，请继续使用 Web/PWA 客户端。

安装后，Windows 预览版仍保留正常的自动更新体验：EdgeEver 发现新 Release 后，会在下载前验证独立 Ed25519 签名的更新清单，下载完成后再次验证安装包，再提示重启安装（选择稍后则在退出 EdgeEver 时自动安装）；清单缺失、签名错误或文件不一致都会停止更新。详见 [Windows 预览版安全与更新说明](docs/windows-preview.zh-CN.md)。

暂无原生客户端的平台，可通过 Chrome 或 Edge 将 EdgeEver 安装为 PWA 使用。

## 社区与反馈

- Bug、功能建议和部署问题请优先提交 [GitHub Issues](https://github.com/tianma-if/edgeever/issues)，方便后续用户检索和复用解决方案。
- 贡献代码前请阅读[贡献代码须知](CONTRIBUTING.zh-CN.md)。如果您的 Fork 同时用于部署 EdgeEver，请将 `main` 分支仅用于部署；从官方 `upstream/main` 新建独立分支，在该分支中同步上游、开发并提交 Pull Request，不要在部署用的 `main` 上开发或执行 Sync fork。

### 微信交流群

欢迎加入 EdgeEver AI 交流群，这里聚集了大量 Vibe Coding 与 AI 玩家。一起交流 EdgeEver 体验、AI Agent 实战落地、高性价比/免费 AI 资源及自动化工作流。

> 群二维码 7 天内有效。如果二维码过期，请添加微信 `m1245207870`，并备注“EdgeEver 进群”。

<p align="center">
  <img src="assets/wechat-group-qr.jpg" alt="EdgeEver AI 交流群二维码" width="260" />
</p>

## 技术栈

- Bun workspace monorepo，包含 Web、API、官网与共享类型包。
- 官网：Astro 静态站点，位于 `apps/site`，可独立构建并部署到 Cloudflare Pages。
- 前端：Vite、React、React Router、TanStack Query，UI 基于 Tailwind CSS、shadcn/ui、Radix UI。
- 编辑器：TipTap / ProseMirror，支持 Markdown；PWA 使用 vite-plugin-pwa、Workbox、Dexie。
- Android App：`apps/mobile` 中的 Expo + React Native，采用 SQLite 本地存储与增量同步。
- iOS App：`apps/ios` 中的原生 SwiftUI（iOS 17+），内置 TipTap EditorBundle、GRDB 本地镜像/outbox，界面与 Android 壳层对齐。
- 原生桌面端：Electron + Rust sidecar，兼顾跨平台一致体验与高性能本地数据服务；基于 SQLite 支持离线编辑、联网后增量同步与本地备份。
- 网页裁剪：Manifest V3、Mozilla Readability、Turndown，支持 Chrome、Microsoft Edge 与 Firefox。
- 后端：一套基于 Hono/Zod 的业务应用，提供 REST API、OpenAPI 与 Remote MCP；Cloudflare 使用 Workers/D1/R2，Docker 使用 Bun/SQLite/本地文件或 S3。

## 快速开始

```sh
bun install
bun run dev
```

## 目录结构

```text
apps/web          Vite + React 前端、PWA、离线草稿与同步队列
apps/extension    Chrome/Edge/Firefox Manifest V3 网页裁剪插件
apps/api          Cloudflare Worker + Hono API、OpenAPI、MCP endpoint
apps/mobile       Expo + React Native Android App
apps/ios          原生 SwiftUI iOS App（TipTap EditorBundle、GRDB）
apps/desktop      Electron 桌面端壳层、preload bridge 与原生打包配置
apps/site         Astro 官方网站，可独立部署
packages/client   Web 与移动端共享的 API Client
packages/shared   共享类型、Zod schema、TipTap / Markdown 内容转换
crates/desktop-sidecar
                   Rust sidecar，负责本地 SQLite、离线数据、备份与资源服务
scripts           Wrangler 封装、密码 hash、CLI、MCP stdio bridge、Evernote ENEX 导入
migrations        D1/SQLite 共用、只增不改的数据库 migration
docs              OpenAPI schema、架构、迁移与部署文档
.github/workflows Web、移动端、iOS、桌面端打包、部署与 Release 的 CI
wrangler.toml     Cloudflare Workers、Assets、D1、R2 配置
```

## 内容格式

EdgeEver 同时保存三种内容形态：

```text
content_json      TipTap/ProseMirror 文档，编辑器权威格式
content_markdown  API、Agent、导入导出使用
content_text      搜索、摘要和索引使用
```

请打开 **我的** -> **导入与导出**，导出或导入 EdgeEver ZIP。压缩包中的 `notes/` 目录可直接作为 Markdown 阅读和迁移，结构化数据则用于在 EdgeEver 实例之间完整恢复；导入时目标实例中的无关数据会保留，相同 EdgeEver ID 的内容会被覆盖。

## API 文档

OpenAPI schema：

```text
https://你的域名/api/openapi.json
```

仓库内文件：[docs/openapi.json](docs/openapi.json)。

## MCP

在 **个人中心** -> **MCP 设置** 中创建 API Token 并交给 AI Agent，即可让 Agent 在账号授权范围内安全地读取、整理和导入笔记，管理笔记模板与 AI 指令，并与 Notion Database、飞书多维表格等工具联动。

> 放飞你的想法：让 AI Agent 归纳随手记录的灵感、构建个人知识图谱、根据笔记生成用户画像，或自动为笔记打标签。

## 图片压缩规则

图片压缩仅在 Web 端上传前执行，由设置页的“压缩笔记内图片”开关控制。启用后，浏览器会把 PNG、JPEG、WebP、AVIF 尝试压缩为 WebP，并将最长边限制在 `2560px` 以内；如果压缩结果不比原图小，则保留原图。

Cloudflare Worker 侧执行图片处理会消耗计算/图片处理额度，因此 EdgeEver 将图片压缩放在 Web 客户端完成；REST API 或 MCP 上传入口会按客户端提供的文件内容直接入库，不再由服务端自动压缩。

## 高级对象存储

实例 Owner 可在**设置 → 高级设置 → OSS 对象存储**中配置兼容 S3 API 的对象存储。切换存储不会迁移或影响已有附件。

## 导入与迁移 (Migration)

如果你想从其他笔记软件迁移到 EdgeEver，请参考以下极简迁移指引：

- **印象笔记（Evernote）的迁入**：请参考 [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **Memos 笔记的迁入**：请参考 [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion 笔记的迁入**：请参考 [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## Docker 部署

Docker 与 Cloudflare 共用同一套前端、API 路由、业务服务、鉴权、MCP 实现和 migration。容器使用 SQLite，并支持本地文件或 S3 兼容附件存储，提供 `amd64` 与 `arm64` 镜像。详见[使用 Docker 部署 EdgeEver](docs/deploy-docker.zh-CN.md)和[自托管与 Docker 架构](docs/self-hosting-architecture.zh-CN.md)。

## 同步时序

Web、PWA 与桌面端会在停止编辑 30 秒后上传笔记，并在页面可见时每 5 分钟检查云端变更；窗口聚焦与手动刷新仍会立即拉取。可在 [`apps/web/src/lib/workspace-refresh.ts`](apps/web/src/lib/workspace-refresh.ts) 中调整 `DEFERRED_MEMO_SYNC_DELAY_MS` 和 `BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS`。

## 致谢

- “minimal品牌绿”主题排版架构借鉴于 [obsidian-minimal](https://github.com/kepano/obsidian-minimal)。
- “Outline 品牌绿”主题排版架构借鉴于 [Outline](https://github.com/outline/outline)。
- “经典蓝白”主题借鉴了早期 [StackEdit](https://github.com/benweet/stackedit)/[Bootstrap](https://github.com/twbs/bootstrap) 系 Markdown 排版风格，并参考[马克飞象](https://maxiang.io/)完善中文排版细节。

## 商标与品牌使用

EdgeEver 名称、Logo 及其他品牌标识用于识别官方项目。Fork 或修改版可以说明其“基于 EdgeEver”，但不得暗示官方身份或误导用户。开源许可不授予商标权利；其他使用须事先取得项目维护者的书面许可。

## 免责声明

EdgeEver 是一款完全独立的开源笔记软件，由个人和社区自主开发维护。本项目与 Evernote®（印象笔记）及其关联公司不存在任何商业合作、授权、赞助或隶属关系。

EdgeEver 是自托管软件。除官方演示实例外，项目维护者不托管、控制或审核用户内容。实例中存储或展示的内容由用户或实例运营者负责，不代表项目维护者的立场。
