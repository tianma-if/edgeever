# EdgeEver

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

公开演示环境会在每周一凌晨 1:00（北京时间）自动重置并恢复示例笔记，请不要保存私密内容。

## 功能

- **零服务器、零运维、真正免费**：基于 Cloudflare Serverless 架构，彻底告别服务器租用与运维烦恼。免费配额可轻松容纳 15 万条笔记与 5 万张图片，全球节点带来秒开体验。
- **数据开放，不设围墙**：基于标准 SQLite 存储，提供 REST API、MCP 与 CLI 接口。数据随时可读可导，不再担心被任何特定平台绑定。
- **无损 ZIP 打包与无缝迁移**：一键打包导出包含 Markdown、Front Matter、嵌套目录及附件的完整档案，同时保留历史版本与结构化数据，方便在不同实例间完整还原。
- **原生 AI Agent 智脑联动**：内置 MCP（Model Context Protocol）协议，支持 Claude Code、Codex、Antigravity 等 AI 助手直接读取与整理笔记，也可与 Notion Database、飞书多维表格轻松打通。
- **多端无缝同步，无设备限制**：自托管数据无商业限制，摆脱免费账号仅限 2 台设备的束缚，在 PC、平板与手机上随心同步。
- **经典三栏布局与专注模式**：笔记本树、笔记列表与编辑区一目了然；桌面端一键开启专注模式，让思绪尽情铺满屏幕。
- **无限层级笔记本**：轻松构建清晰的多级目录结构。
- **微信公众号一键排版与复制**：专为中文创作者设计，支持将笔记一键转换为带行内样式的公众号美化格式，直接复制粘贴至微信公众号后台，告别复杂的第三方排版工具。
- **优雅的双视图编辑**：桌面端支持在富文本与 Markdown 源码视图之间自由切换。
- **Mermaid 架构图与流程图渲染**：原生支持 Mermaid 代码块渲染，视图切换时完整保留可编辑源码，让绘制逻辑图表更直观。
- **笔记历史版本回溯**：自动记录修改历史，随时查阅与还原过往版本。
- **智能前端图片压缩**：图片上传前在浏览器端静默完成压缩，常见截图与大图精简 50%-90% 体积，加载更迅速、存储更省心。
- **通用文件附件支持**：支持轻松上传并插入 PDF、Office 文档、压缩包及音视频等各种附件。
- **高效多选与批量操作**：支持笔记批量合并、批量移动，以及笔记本拖拽排序与层级调整。
- **离线草稿与同步队列**：网络不稳定时自动保存离线草稿，恢复连线后自动入队同步。
- **多账号与个人空间隔离**：单实例支持创建多个独立账号，用户数据相互隔离，配备直观的管理员账号管理与安全加密机制。
- **全平台多端覆盖**：已上架 Chrome/Edge 网页裁剪插件；支持安装为 PWA 应用；原生移动端 App（iOS/Android）即将上线，Android APK 可在 Release 页面即刻下载体验。

## 部署

EdgeEver 采用纯 Serverless 架构，完全运行在 Cloudflare 免费配额内，**无需购买服务器/VPS，也无需配置 Docker 或 SSL 证书**。

您可以选择以下两种方式之一在线部署：

### 方案一：AI Agent 一键部署（推荐）

将下方提示词直接复制发送给已配置 GitHub、Cloudflare MCP/插件或其他可用集成的 AI Agent（如 Codex, Claude, Cursor, Antigravity, OpenClaw, Hermes Agent 等）：

```text
请在线完成 EdgeEver 部署：
1. Fork https://github.com/tianma-if/edgeever。
2. 将这个 Fork 导入 Cloudflare Workers & Pages。
3. 配置 D1、R2、`EDGE_EVER_AUTH_PASSWORD` Worker Secret 和生产环境 `main` 构建。
4. 启动首次构建，验证 `/api/health`、`/api/openapi.json` 和登录。
5. 启用并手动运行一次 `Update deployed EdgeEver`。
```

> 详细约定与要求请查看：[AI Agent 在线部署约定](docs/agent-deploy-cloudflare.zh-CN.md)。

### 方案二：手动在线部署

仅需在网页端完成 4 步极简配置：

1. **Fork 仓库**：在 GitHub 点击右上角 **Fork**，将项目 Fork 到您的个人账户下。
2. **导入 Cloudflare**：登录 Cloudflare 控制台，进入 **Workers & Pages**，选择导入该 Fork 仓库。
3. **绑定资源与密码**：绑定 D1 数据库（`DB`）、R2 存储桶（`RESOURCES`），并添加 Worker Secret `EDGE_EVER_AUTH_PASSWORD` 作为登录密码。
4. **启动构建与验证**：使用默认构建配置启动首次构建，部署完成后访问 `/api/health` 确认返回 `200` 即可开始使用。

> 📖 包含具体参数与构建命令的详细步骤，请查看 [在线部署完整文档](docs/deploy-cloudflare-button.zh-CN.md)。

## 多账号登录

部署完成后，单个实例支持多账号登录。

实例管理员可以在 **个人中心** -> **账号管理** 中创建、停用成员账号或重置密码。每个成员拥有完全隔离的个人空间，包括笔记本、笔记、附件、回收站、导入导出和 MCP Token 等。


## PWA 安装说明

PWA 可以把 EdgeEver 像普通应用一样安装到桌面或手机主屏幕，打开更方便，也能配合浏览器能力提供更接近原生 App 的使用体验。

PC 端请使用 Chrome/Edge 打开站点，点击地址栏右侧的“安装”图标并确认。Android 建议用 Chrome 打开站点，点右上角三点菜单，选择“添加到主屏幕”，再点“安装”。Edge 可尝试菜单中的“添加到手机 / 添加到主屏幕 / 安装应用”，不同版本可能只创建快捷方式。请不要从微信等 App 内置浏览器安装。

> 常见踩坑：移动端安装 PWA 时，建议优先使用 Chrome 或 Edge。其他移动浏览器在安装过程中可能出现兼容性问题或异常报错。

## Chrome/Edge 网页裁剪插件

Chrome/Edge 网页裁剪插件已正式上架，您可以通过以下链接直接安装使用（Edge 浏览器亦可直接在 Chrome 应用商店中安装）：

- [Chrome Web Store 安装地址](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)

## 关于客户端

APP端初版已开发完成，上架审核中。

桌面端 App 仍在规划中，计划基于 Tauri 构建。

## 技术栈

- Bun workspace monorepo，包含 Web、API、官网与共享类型包。
- 官网：Astro 静态站点，位于 `apps/site`，可独立构建并部署到 Cloudflare Pages。
- 前端：Vite、React、React Router、TanStack Query，UI 基于 Tailwind CSS、shadcn/ui、Radix UI。
- 编辑器：TipTap / ProseMirror，支持 Markdown；PWA 使用 vite-plugin-pwa、Workbox、Dexie。
- 移动 App：Expo + React Native，采用 SQLite 本地存储与增量同步。
- 网页裁剪：Manifest V3、Mozilla Readability、Turndown，支持 Chrome 与 Microsoft Edge。
- 后端：Cloudflare Workers、Hono、Zod、D1、R2，提供 REST API、OpenAPI 与 Remote MCP。

## 快速开始

安装依赖：

```sh
bun install
```

应用本地 D1 迁移：

```sh
bun run db:migrate:local
```

启动默认开发环境。它会先应用本地迁移，并在首次启动时使用仓库内固定的 Demo 种子初始化本地 D1/R2；后续重启会保留本地修改，且不会连接任何远程实例。

```sh
bun run dev
```

如需明确连接已配置的远程实例，必须显式指定实例名：

```sh
EDGE_EVER_INSTANCE=<实例名> bun run dev:remote
```

常用检查：

```sh
bun run typecheck
bun run build
```

## 目录结构

```text
apps/web          Vite + React 前端、PWA、离线草稿与同步队列
apps/extension    Chrome/Edge Manifest V3 网页裁剪插件
apps/api          Cloudflare Worker + Hono API、OpenAPI、MCP endpoint
apps/mobile       Expo + React Native 移动端 App
apps/site         Astro 官方网站，可独立部署
packages/client   Web 与移动端共享的 API Client
packages/shared   共享类型、Zod schema、TipTap / Markdown 内容转换
scripts           Wrangler 封装、密码 hash、CLI、MCP stdio bridge、Evernote ENEX 导入
migrations        D1 数据库迁移
docs              OpenAPI schema、迁移指南等文档
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

先在 EdgeEver 左下角 **个人中心** 的 **MCP 设置** 里创建 API Token，然后复制API Token或者复制整个MCP配置，发送给AI Agent，让他安装此MCP。
然后即可授权AI Agent读取和整理笔记。
> 放飞你的思路，这种情况下是有很多灵活玩法：
比如让AI Agent归纳你随机记录的灵感创意、针对你的笔记做精准的人物画像、构建自己的知识图谱、自动为笔记打标签）
借助 MCP，EdgeEver 还可以与 Notion Database、飞书多维表格等工具联动，把日常笔记中零散的灵感、信息和素材沉淀到结构化数据库中，方便后续整理、检索与管理。
## 图片压缩规则

图片压缩仅在 Web 端上传前执行，由设置页的“压缩笔记内图片”开关控制。启用后，浏览器会把 PNG、JPEG、WebP、AVIF 尝试压缩为 WebP，并将最长边限制在 `2560px` 以内；如果压缩结果不比原图小，则保留原图。

Cloudflare Worker 侧执行图片处理会消耗计算/图片处理额度，因此 EdgeEver 将图片压缩放在 Web 客户端完成；REST API 或 MCP 上传入口会按客户端提供的文件内容直接入库，不再由服务端自动压缩。

## 导入与迁移 (Migration)

如果你想从其他笔记软件迁移到 EdgeEver，请参考以下极简迁移指引：

- **印象笔记（Evernote）的迁入**：请参考 [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **Memos 笔记的迁入**：请参考 [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion 笔记的迁入**：请参考 [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## 社区与反馈

- Bug、功能建议和部署问题请优先提交 [GitHub Issues](https://github.com/tianma-if/edgeever/issues)，方便后续用户检索和复用解决方案。
- 微信：`m1245207870`（请备注 EdgeEver）

### 微信交流群

欢迎加入 EdgeEver AI 交流群，讨论 EdgeEver 使用、AI 工具、智能体、工作流和其他 AI 话题。

> 群二维码 7 天内有效。如果二维码过期，请添加微信 `m1245207870`，并备注“EdgeEver 进群”。

<p align="center">
  <img src="assets/wechat-group-qr.jpg" alt="EdgeEver AI 交流群二维码" width="360" />
</p>

## Docker 部署规划

> 🐳 面向 VPS、NAS 和家庭服务器的 Docker 私有化部署已纳入规划，待核心功能稳定后提供；当前版本尚不支持。

## 致谢

- 编辑器主题的视觉设计参考自 [gzh-design-skill](https://github.com/isjiamu/gzh-design-skill)，相关主题由甲木 × 摸鱼小李原创。感谢作者的开源工作。

## 免责声明

EdgeEver 是一款完全独立的开源笔记软件，由个人和社区自主开发维护。本项目与 Evernote®（印象笔记）及其关联公司不存在任何商业合作、授权、赞助或隶属关系。
