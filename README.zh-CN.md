# EdgeEver

[![GitHub Stars](https://img.shields.io/github/stars/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/network/members)

简体中文 | [English](README.md)

> **EdgeEver：无需服务器、0 费用、开源且原生支持 AI 的自托管「印象笔记」替代方案。**

EdgeEver 是一款现代化的开源笔记工作区。它为你找回经典印象笔记的三栏高效体验，同时具备完全开放的数据架构与原生 AI Agent 联动能力，让个人知识沉淀更轻量、更自由。

> 💡 **终身免服务器，100% 免费**
> EdgeEver 采用纯 Serverless（无服务器）架构。自部署时**无需购买云服务器**，也**无需配置复杂的 Docker 或 SSL 证书**。免费运行于 Cloudflare 配额之内，个人日常使用 **100% 免费，零费用、零运维**。

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

- **零服务器、零运维、真正免费**：基于 Cloudflare Serverless 架构，彻底告别服务器租用与运维烦恼。免费配额可轻松容纳 15 万条笔记与 5 万张图片，全球节点带来秒开体验。
- **数据开放，不设围墙**：基于标准 SQLite 存储，提供 REST API、MCP 与 CLI 接口。数据随时可读可导，不再担心被任何特定平台绑定。
- **无损 ZIP 打包与无缝迁移**：一键打包导出包含 Markdown、Front Matter、嵌套目录及附件的完整档案，同时保留历史版本与结构化数据，方便在不同实例间完整还原。
- **原生 AI Agent 智脑联动**：内置 MCP（Model Context Protocol）协议，支持 Claude Code、Codex、Antigravity 等 AI 助手直接读取与整理笔记，也可与 Notion Database、飞书多维表格轻松打通。
- **接入自己的 AI 模型**：支持添加多个 OpenAI、Anthropic、Gemini 兼容服务与第三方中转平台，在编辑器中随时对全文或选区进行智能总结、要点提炼、语法校对、翻译与续写润色。
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
- **全平台多端覆盖**：支持 Web、[Android](https://play.google.com/store/apps/details?id=org.edgeever.mobile) 和 [macOS](https://github.com/tianma-if/edgeever/releases)，iOS 版正在 App Store 审核，Windows 版即将推出；网页裁剪插件支持 [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)、[Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo) 和 [Firefox](https://addons.mozilla.org/zh-CN/firefox/addon/edgeever-web-clipper/)。

## 部署

EdgeEver 采用纯 Serverless 架构，完全运行在 Cloudflare 免费配额内，**无需购买服务器/VPS，也无需配置 Docker 或 SSL 证书**。

您可以选择以下两种方式之一在线部署：

### 方案一：AI Agent 一键部署（推荐）

将下方提示词直接复制发送给 AI Agent（如 Codex、Claude、Cursor、workbuddy、Antigravity、OpenClaw、Hermes Agent 等）。执行过程中，如需访问 GitHub 或 Cloudflare，请确认权限范围并按提示完成授权。

```text
请在线完成 EdgeEver 部署：
1. Fork https://github.com/tianma-if/edgeever。
2. 将这个 Fork 导入 Cloudflare Workers & Pages。
3. 配置 D1、R2、`EDGE_EVER_AUTH_USERNAME`（预填为 `admin`，可自定义）、
   `EDGE_EVER_AUTH_PASSWORD` Worker Secret 和生产环境 `main` 构建。
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
4. **绑定资源与登录凭据**：绑定 D1 数据库（`DB`）、R2 存储桶（`RESOURCES`），设置 `EDGE_EVER_AUTH_USERNAME`（默认为 `admin`，可自定义），并添加 Worker Secret `EDGE_EVER_AUTH_PASSWORD` 作为管理员登录密码。
5. **启动构建与验证**：使用默认构建配置启动首次构建，部署完成后访问 `/api/health` 确认返回 `200` 即可开始使用。

> 📖 包含具体参数与构建命令的详细步骤，请查看 [在线部署完整文档](docs/deploy-cloudflare-button.zh-CN.md)。

---

> 💡 **部署提示（Cloudflare R2 付款方式）**：虽然 Cloudflare R2 存储提供了足够慷慨、在笔记场景中几乎永远不会超量的[免费存储额度](https://developers.cloudflare.com/r2/pricing/#free-tier)，但需先开通 R2 subscription 并绑定付款方式。Cloudflare [官方支持](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) 银联（UnionPay）、Visa、Mastercard 等银行卡，以及 PayPal、Apple Pay、Google Pay 等付款方式。

## 多账号登录

部署完成后，单个实例支持多账号登录。

实例管理员可以在 **个人中心** -> **账号管理** 中创建、停用成员账号或重置密码。每个成员拥有完全隔离的个人空间，包括笔记本、笔记、附件、回收站、导入导出和 MCP Token 等。

## 浏览器网页裁剪插件

网页裁剪插件已在 Chrome、Microsoft Edge 与 Firefox 正式上架。请从对应的浏览器商店安装（Edge 浏览器亦可直接安装 Chrome Web Store 版本）：

- [Chrome Web Store 安装地址](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)
- [Firefox Add-ons 安装地址](https://addons.mozilla.org/zh-CN/firefox/addon/edgeever-web-clipper/)

开发者也可参考[扩展开发说明](apps/extension/README.md)从源码构建并加载插件。

## 关于客户端

原生客户端提供更流畅、稳定的使用体验，以及更完善的系统级集成，并支持本地存储与离线编辑。恢复联网后，内容会自动增量同步，适合高频使用和弱网场景。

Android App 现已上架 [Google Play](https://play.google.com/store/apps/details?id=org.edgeever.mobile)，也可从 [GitHub Releases](https://github.com/tianma-if/edgeever/releases) 下载签名 APK。iOS 客户端为 `apps/ios` 下的原生 SwiftUI 应用，已提交 App Store，目前仍在审核中。

macOS App 可从 [GitHub Releases](https://github.com/tianma-if/edgeever/releases) 下载。Windows 版本正在处理代码签名证书问题，解决后即可发布。

暂无原生客户端的平台，可通过 Chrome 或 Edge 将 EdgeEver 安装为 PWA 使用。

## 社区与反馈

- Bug、功能建议和部署问题请优先提交 [GitHub Issues](https://github.com/tianma-if/edgeever/issues)，方便后续用户检索和复用解决方案。

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
- 后端：Cloudflare Workers、Hono、Zod、D1、R2，提供 REST API、OpenAPI 与 Remote MCP。

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
migrations        D1 数据库迁移
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

## 插件开发预览

独立的插件市场页面支持从已验证索引、公开 GitHub 仓库或 Manifest 地址安装受信任的客户端插件和无代码主题包。插件可以查询与修改笔记、操作编辑器选区、注册命令和自定义面板、使用加密 Secret Storage，并向声明过的域名发起网络请求。桌面端右上角提供统一插件入口和最近使用记录；Cron 与后台任务暂不纳入。详见[插件开发文档](docs/plugin-development.zh-CN.md)。

## MCP

先在 EdgeEver 左下角 **个人中心** 的 **MCP 设置** 中创建 API Token，再将 Token 或完整 MCP 配置发送给 AI Agent。连接后，Agent 即可在你的授权范围内安全地读取、整理和导入笔记。MCP 也开放了完整的笔记模板与 AI 指令管理能力：Agent 可以列出、查看、新建、更新和删除模板与指令，也可以使用模板创建笔记、恢复缺失的内置指令。读取模板和指令需要 `read:memos` 权限，变更需要 `write:memos` 权限；重复执行同一笔记导入任务不会创建重复笔记。

Remote MCP 端点支持无状态的 `2026-07-28` 协议，同时继续兼容现有客户端使用的 2025 握手式协议版本。

> 放飞你的思路，这种情况下是有很多灵活玩法：
比如让AI Agent归纳你随机记录的灵感创意、针对你的笔记做精准的人物画像、构建自己的知识图谱、自动为笔记打标签）
借助 MCP，EdgeEver 还可以与 Notion Database、飞书多维表格等工具联动，把日常笔记中零散的灵感、信息和素材沉淀到结构化数据库中，方便后续整理、检索与管理。

## 接入自己的 AI 模型

进入**个人中心 → AI 集成**，可以使用自己的 Base URL 和 API Key 添加一个或多个 OpenAI 兼容协议、Anthropic Messages 或 Google Gemini 云端服务，也支持第三方中转站。每个服务都能配置多个模型：既可以从服务的模型列表接口自动发现，也可以手动输入模型 ID。服务级开关会让该服务下的全部模型暂时不可用，工作区默认模型则决定笔记 AI 实际使用哪个模型。

当前 Web、Android 与 iOS 内置 6 个常用指令：总结、翻译、润色、精炼表达、转为小红书风格与转为推特风格；更细分的场景可自行添加指令。三个平台的编辑器都可以直接处理选中内容，并只替换对应选区。模型结果会先作为可审查的流式草稿展示，用户可以重试、继续提出调整要求、追加内容，或明确接受后替换原文。翻译使用带默认值的语言下拉框：中文界面默认译为英语，英文界面默认译为简体中文。

AI 请求统一由 EdgeEver 服务端发出，不会由浏览器或原生客户端直接携带模型密钥。模型凭据按个人工作区隔离并加密保存；标准部署会自动从已有的实例认证 Secret 派生 AI 专用加密密钥，不需要增加任何部署变量。Cloudflare Worker 与未来的 Docker/Bun 运行时共用同一套 AI 业务代码。

## 图片压缩规则

图片压缩仅在 Web 端上传前执行，由设置页的“压缩笔记内图片”开关控制。启用后，浏览器会把 PNG、JPEG、WebP、AVIF 尝试压缩为 WebP，并将最长边限制在 `2560px` 以内；如果压缩结果不比原图小，则保留原图。

Cloudflare Worker 侧执行图片处理会消耗计算/图片处理额度，因此 EdgeEver 将图片压缩放在 Web 客户端完成；REST API 或 MCP 上传入口会按客户端提供的文件内容直接入库，不再由服务端自动压缩。

## 高级对象存储

实例 Owner 可以进入**设置 → 高级设置 → OSS 对象存储**，让后续上传的图片和附件写入兼容 S3 API 的阿里云 OSS、腾讯云 COS、AWS S3、MinIO 或 R2。已有资源继续保留在原存储中，因此切换默认存储不会迁移历史附件，也不会让历史附件失效。

在 Cloudflare 部署中保存第三方对象存储凭据前，需要先配置一个至少 32 个字符的随机 `EDGE_EVER_STORAGE_ENCRYPTION_KEY` Worker Secret。EdgeEver 会用这个实例级密钥加密保存在 D1 中的对象存储 Secret。请保持该密钥稳定并妥善备份；更换密钥会导致之前保存的对象存储凭据无法继续使用。

## 导入与迁移 (Migration)

如果你想从其他笔记软件迁移到 EdgeEver，请参考以下极简迁移指引：

- **印象笔记（Evernote）的迁入**：请参考 [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **Memos 笔记的迁入**：请参考 [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion 笔记的迁入**：请参考 [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## Docker 部署规划

> 🐳 面向 VPS、NAS 和家庭服务器的 Docker 私有化部署已纳入规划，但当前还不是正式支持的发行方式。现在已经提供用于适配器开发的实验性 Bun 运行入口，支持 SQLite + 本地文件或 S3 兼容存储；PostgreSQL 目前仍只预留契约。详见[自托管与 Docker 架构预留](docs/self-hosting-architecture.zh-CN.md)。

## 致谢

- “minimal品牌绿”主题排版架构借鉴于 [obsidian-minimal](https://github.com/kepano/obsidian-minimal)。
- “Outline 品牌绿”主题排版架构借鉴于 [Outline](https://github.com/outline/outline)。

## 免责声明

EdgeEver 是一款完全独立的开源笔记软件，由个人和社区自主开发维护。本项目与 Evernote®（印象笔记）及其关联公司不存在任何商业合作、授权、赞助或隶属关系。
