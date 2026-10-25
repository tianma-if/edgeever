<div align="center">
  <h1>
    <img src="assets/brand/edgeever-icon.svg" alt="EdgeEver Logo" width="48" align="absmiddle" /> EdgeEver
  </h1>
  <p>
    <b>AI 原生知识库与印象笔记 / Obsidian 替代方案，支持多端瞬时同步与原生 MCP。Cloudflare 免费托管或 Docker 自托管</b>
  </p>
  <p>
    <a href="https://github.com/tianma-if/edgeever/stargazers"><img src="https://img.shields.io/github/stars/tianma-if/edgeever?style=social" alt="GitHub Stars" /></a>
    <a href="https://github.com/tianma-if/edgeever/network/members"><img src="https://img.shields.io/github/forks/tianma-if/edgeever?style=social" alt="GitHub Forks" /></a>
    <a href="https://github.com/tianma-if/edgeever/pkgs/container/edgeever"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Ftianma-if%2Fedgeever%2Fedgeever&query=downloadCount&style=social&logo=docker&label=Docker%20Pulls" alt="Docker Pulls" /></a>
    <a href="https://www.producthunt.com/products/edgeever?utm_source=other&utm_medium=social"><img src="https://img.shields.io/badge/Product%20Hunt-ea532a?style=social&logo=product-hunt" alt="Product Hunt" /></a>
    <a href="https://hellogithub.com/repository/tianma-if/edgeever" target="_blank"><img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=150fee4403f6433880bda91e9576ac06&claim_uid=TWNAjisURpnhL1l&theme=small" alt="Featured｜HelloGitHub" /></a>
    <a href="#赞助与支持"><img src="https://img.shields.io/badge/Sponsor-支持项目-ea4aaa?logo=github-sponsors" alt="赞助与支持" /></a>
  </p>
  <p>
    <b>简体中文</b> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl-PL.md">Polski</a>
  </p>
  <p>
    <a href="#wechat-group"><img src="assets/readme/community/wechat.svg" alt="WeChat" width="16" height="16" align="absmiddle" /> 微信交流群</a> &nbsp;|&nbsp;
    <a href="https://demo.edgeever.org">🌐 在线演示</a> &nbsp;|&nbsp;
    <a href="#全平台客户端与浏览器插件">📱 客户端与插件下载</a> &nbsp;|&nbsp;
    <a href="#features">核心功能与场景矩阵</a>
  </p>
  <p align="center">
    <img src="assets/readme/edgeever-hero-v6.png" alt="EdgeEver 产品工作区预览" width="800" />
  </p>
</div>

EdgeEver 是一款现代化的开源笔记与个人知识库工作区。它保留经典高效的三栏工作区体验（目录树 · 笔记列表 · 编辑写作），同时具备完全开放的数据架构与原生 AI Agent 联动能力，让个人知识沉淀更轻量、更自由。

> 💡 **终身免服务器，100% 免费**
> EdgeEver 可以免费运行在 Cloudflare 配额内，无需购买或维护服务器；希望使用 VPS、NAS 或家庭服务器的用户，也可以通过 Docker 部署同一套应用。

> ⭐ 如果 EdgeEver 对你有帮助，欢迎点个 Star。你的支持会帮助更多人发现这个项目。

## 为什么做 EdgeEver

很多**笔记与个人知识库**的用户，核心需求只是一个**可靠、开放、响应迅速**的个人知识库。然而，当下的主流方案都各有痛点：

* **印象笔记**：拥有最无感、最丝滑的多端云同步体验。然而随着它演进为全功能商业套件，广告与附加功能渐多，系统开销也随之走高；加之免费版配额收紧、高级 AI 订阅昂贵，且难以灵活接入现代自托管与私有 AI 工作流。
* **Obsidian**：Markdown 开放，核心闭源；官方同步收费，第三方同步繁琐；纯本地文件依赖遍历扫描，当笔记积累到数千上万条或加载复杂插件后，冷启动与全库检索明显卡顿迟缓；图片与附件与文本混存，仓库体积极易膨胀导致移动端同步缓慢，且删笔记后残留附件难清理；对于“随时随地随手记”的轻量场景来说偏重。
* **Memos / Flomo 等轻量笔记**：虽然简单好用，但流式卡片布局与习惯了经典“三栏工作流”的用户有着天然的交互习惯差异。
* **思源笔记等块级知识库**：功能深厚且支持开源自托管，但全面的“块级（Block）”架构使得日常随手记录与连续排版书写的心智负担偏重；且缺少零服务器成本的 Serverless 部署形态，多端同步主要依赖官方付费订阅，或需额外付费解锁 S3/WebDAV 同步特性并自备存储。

**EdgeEver 恰好填补了这一空白**：整栈开源，提供真正**零感知、低延迟的多端瞬时云同步**，且全部服务均可免费自托管；同时保留经典三栏布局与流畅排版，万条笔记常驻依然轻盈丝滑，原生支持接入 AI Agent，部署维护零门槛、零费用。

## 在线演示

- Demo 地址：[https://demo.edgeever.org](https://demo.edgeever.org)

公开演示环境会在每天凌晨 3:00（北京时间）自动重置并恢复示例笔记，请不要保存私密内容。

## 全平台客户端与浏览器插件

### 客户端下载

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/macos.svg" alt="下载 macOS 客户端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/windows.svg" alt="下载 Windows 客户端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/tux.svg" alt="下载 Linux x86_64 AppImage 预览版" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile"><img src="assets/readme/platforms/google-play.svg" alt="从 Google Play 下载 Android 客户端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/us/app/edgeever/id6792625631"><img src="assets/readme/platforms/app-store.svg" alt="从 App Store 下载 iOS 客户端" width="40" height="40" /></a>
</p>

> iOS 客户端需要使用非中国大陆区 Apple ID 下载。

### 浏览器网页裁剪插件

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="为 Google Chrome 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="为 Microsoft Edge 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/zh-CN/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="为 Firefox 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>
</p>

- 支持提取网页正文为纯净 Markdown，或划选文字与图片精准保存，直传自托管实例。
- 深度适配 20+ 主流平台的结构化剪藏：覆盖社交（X、小红书、微信公众号、即刻、豆瓣、Threads、Bluesky）、社区与资讯（知乎、Reddit、GitHub、V2EX、Hacker News、Medium、Substack）、音视频与播客（Bilibili、YouTube、小宇宙）等。

<a id="features"></a>
## 核心功能与场景矩阵

一站式连接「灵感捕获 · 深度创作 · 知识沉淀」的全能工作区（👉 **[查看 17 个实机案例演示与最佳实践](docs/best-practices.zh-CN.md)**）：

| 模块 | 基础功能 | 进阶特性 |
| :--- | :--- | :--- |
| **写作与编辑** | • 经典三栏工作区，面板宽度自由调节<br>• 富文本所见即所得与 Markdown 双视图切换<br>• 代码高亮、数学公式、任务列表与沉浸专注模式<br>• 秒级自动保存、多端瞬时同步与版本历史回溯 | • **原生海报笔记**：画布级图文排版与视觉卡片，双击即改<br>• **微信公众号一键排版**：一键转内联样式富文本直粘后台<br>• **高颜值长图分享**：质感主题海报与 Monogram 头像，支持 MD/HTML/PDF 导出 |
| **组织与检索** | • 无限层级笔记本与目录树导航<br>• 标签体系（Tags）与笔记拖拽排序、批量合并/移动<br>• 毫秒级即时全文搜索与历史记录过滤 | • **独立知识库网站发布**：一键将整个笔记本公开发布为带目录树导航的独立静态站点（支持密码保护）<br>• 多账号与工作区多空间数据物理隔离 |
| **剪藏与附件** | • 桌面与移动端全格式附件上传（PDF、Office、音视频等）<br>• 浏览器划选网页文字与图片精准抓取<br>• 手机系统分享一键转存全网图片与微信文章 | • **全渠道结构化剪藏**：深度适配小红书、X (Twitter)、知乎、Reddit、GitHub 等 20+ 平台<br>• **微信聊天记录一键归档**：整段对话转笔记，保留时间轴、引用、表情与附件<br>• **端侧静默压缩**：图片上传前压缩 50%–90%；分片流式上传安全支持最大 1 GiB 附件 |
| **数据与可视化** | • 原生表格编辑与 Markdown 表格渲染<br>• 原生 Mermaid 流程图、时序图与架构图渲染 | • **AI 多维表格**：自然语言一句话生成业务数据库（含标签、日期等字段）<br>• **在线公开收集表单**：多维表格一键生成免登录外链表单，填报数据实时入库<br>• **AI 智能信息图与导图**：一键生成时间线、对比图、象限矩阵及思维导图 |
| **AI 与生态** | • 侧边伴随式 AI 助手，选区/全文一键总结、翻译与润色<br>• BYOK（自带模型）：兼容 OpenAI、Anthropic、Gemini 等主流协议 | • **原生 Agent 协议互联**：内置 MCP（外部 Agent 读写笔记）与 ACP（桌面端直接唤起本机 Agent 协作创作）<br>• **AI RSS 智能订阅日报**：定时聚合资讯源，AI 自动过滤噪音并生成精炼日报<br>• 开放插件开发 API 自由扩展 |
| **多端同步与底座** | • 电脑、手机全端秒级无感同步，无设备数量限制<br>• 官方覆盖 Web / macOS / Windows / Linux / iOS / Android 全平台<br>• 离线优先与同步队列：断网流畅写作，联网自动恢复并增量同步<br>• 标准 SQLite 存储，无损 ZIP 档案与 Markdown 导出导入 | • **终身零服务器成本**：100% 运行于 Cloudflare 免费配额（容量约 15 万条短笔记与 5 万张图片）<br>• **灵活 Docker 自托管**：私有 VPS/NAS 一键部署，轻松承载百万级笔记与瞬时同步<br>• 服务端防暴力破解限流保护与安全数据隔离 |

## 部署

Cloudflare 是推荐的零服务器部署方式；希望使用 VPS、NAS 或家庭服务器的用户也可以选择 Docker。

Cloudflare 在线部署可以选择以下两种方式之一：

### 方案一：交给 AI Agent 部署（推荐）

将下方提示词直接复制发送给 AI Agent（如 Codex、Claude、Cursor、WorkBuddy、Antigravity、OpenClaw、Hermes Agent 等）。执行过程中，如需访问 GitHub 或 Cloudflare，请确认权限范围并按提示完成授权。

```text
请全程通过 GitHub 和 Cloudflare 在线部署 EdgeEver：
1. Fork https://github.com/tianma-if/edgeever。
2. 在 Cloudflare 中创建 D1 `edgeever` 与 R2 `edgeever-resources`。
3. 在 Workers & Pages 中从 Fork 的 `main` 分支创建名为 `edgeever` 的 Worker。
   使用仓库根目录，保留 Cloudflare Workers Builds 的默认部署命令，确认其 API Token
   具备 D1 读取和编辑权限，然后保存并部署。
4. Worker 创建后，设置运行时 Secret `EDGE_EVER_AUTH_PASSWORD`，值为用户指定的密码
   （建议至少 32 个字符）。管理员用户名默认为 `admin`；如需自定义，请在再次构建前
   设置 Workers Builds 构建变量 `EDGE_EVER_AUTH_USERNAME`。
5. 再次构建，验证 `/api/health` 和 `/api/openapi.json`，再用该管理员
   用户名和密码验证登录。
6. 启用并手动运行一次名为 `Update deployed EdgeEver` 的 GitHub Actions 工作流，
   以便后续自动同步正式版本，持续获得 EdgeEver 的功能更新和问题修复。
```

> 详细约定与要求请查看：[AI Agent 在线部署约定](docs/agent-deploy-cloudflare.zh-CN.md)。

### 方案二：手动在线部署

<details>
<summary>📖 展开查看：网页端 6 步手动部署流程</summary>

仅需在网页端完成 6 步配置：

1. **Fork 仓库**：在 GitHub 点击右上角 **Fork**，将项目 Fork 到您的个人账户下。
2. **创建 Cloudflare 资源**：创建 D1 `edgeever` 与 R2 `edgeever-resources`。
3. **导入并配置项目**：在 Cloudflare **Workers & Pages** 中从 Fork 的 `main` 分支创建名为 `edgeever` 的 Worker。使用仓库根目录，保留由 Cloudflare 在线执行的 Workers Builds 默认部署命令，并确认其 API Token 具备 D1 读取和编辑权限。binding 由部署命令生成，不要修改 Fork 中的文件。
4. **准备管理员密码**：准备管理员登录密码，建议至少 32 个字符。Worker 创建后，将它保存为运行时 Secret `EDGE_EVER_AUTH_PASSWORD`。
5. **首次构建与验证**：保存并部署会创建 Worker 并启动构建。首次构建主要用于初始化 Worker 实例，若因尚未配置管理员 Secret 而报错属于预期行为，只需在第 4 步添加运行时 Secret `EDGE_EVER_AUTH_PASSWORD` 后点击重试构建即可通过。管理员用户名默认为 `admin`；如需使用其他用户名，请在重试构建前设置 Workers Builds 构建变量 `EDGE_EVER_AUTH_USERNAME`。部署完成后访问 `/api/health`，确认返回 `200`，再用配置的管理员用户名和密码登录。
6. **启用自动更新**：进入 Fork 的 **Actions** 标签页，点击 **I understand my workflows, go ahead and enable them**，然后手动运行一次 **Update deployed EdgeEver**，确保后续能够自动获得正式版本的功能更新与修复。

> 📖 包含具体参数与构建命令的详细步骤，请查看 [在线部署完整文档](docs/deploy-cloudflare-button.zh-CN.md)。

</details>

<details>
<summary>📌 查看 Cloudflare 部署须知（自定义域名绑定与 R2 免费额度）</summary>

> **域名与访问**：实例部署完成后，可以直接使用 Cloudflare 默认分配的 `*.workers.dev` 域名访问，也可以在 Worker 的 **Settings → Domains & Routes** 中绑定自己的自定义域名（强烈建议绑定自定义域名以保障国内直连稳定性并提升访问速度）。
>
> **Cloudflare R2 开通**：虽然 Cloudflare R2 存储提供了足够慷慨、在笔记场景中完全不会超量的[免费存储额度](https://developers.cloudflare.com/r2/pricing/#free-tier)，但需先开通 R2 subscription 并绑定付款方式。Cloudflare [官方支持](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) 银联（UnionPay）、Visa、Mastercard 等银行卡，以及 PayPal、Apple Pay、Google Pay 等付款方式。

</details>

### 方案三：在 VPS 或 NAS 上使用 Docker

Docker 与 Cloudflare 共用同一套前端、API 路由、业务服务、鉴权、MCP 实现和 migration。容器使用 SQLite，并支持本地文件或 S3 兼容附件存储，提供 `amd64` 与 `arm64` 镜像。详见[使用 Docker 部署 EdgeEver](docs/deploy-docker.zh-CN.md)和[自托管与 Docker 架构](docs/self-hosting-architecture.zh-CN.md)。

使用 GitHub 托管的安装脚本和官方 GHCR 镜像：

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

该命令会自动拉取最新镜像、生成管理员密码，并使用 Docker Compose 启动 EdgeEver。手动部署与配置说明见 [Docker 部署文档](docs/deploy-docker.zh-CN.md)。

安装后默认每日自动更新。如需手动更新，请在部署服务器上运行 `~/edgeever/update.sh`。

> 💡 **网络提示**：官方镜像托管于 GitHub（GHCR）。若在部分网络环境下遇到拉取缓慢或超时，请在部署前自行配置可用的网络代理或可信的镜像加速服务。

---

## 进阶配置与管理

### 数据导入导出与备份

无论是日常数据备份、跨实例无缝迁移，还是从已有笔记平台迁入，EdgeEver 均提供完整可靠的数据流转方案：

- **EdgeEver 原生备份与还原**：在应用内进入 **个人中心** -> **导入与导出**，可随时导出或导入 EdgeEver ZIP 档案包。解压后的 `notes/` 目录保留清晰的纯文本 Markdown 文件与附件，可直接用于本地归档或独立阅读；内部结构化元数据则支持在不同 EdgeEver 实例间无损全量还原。导入时保留目标实例的既有数据，同 ID 内容自动覆盖更新。
- **第三方笔记平滑迁入**：
  - **印象笔记（Evernote）迁入**：请参考 [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
  - **flomo 笔记迁入**：请参考 [docs/flomo-migration-guide.md](docs/flomo-migration-guide.md)
  - **Memos 笔记迁入**：请参考 [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
  - **Notion 笔记迁入**：请参考 [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

### AI 与 MCP 协议互联

在 **个人中心** -> **API / MCP** 中创建 API Token 并一键复制 Remote MCP 配置，即可让 Claude Code、Cursor、Antigravity、OpenClaw 等 AI Agent 在账号授权范围内安全管理你的知识库。系统支持文本笔记、图表笔记（思维导图、流程图与架构图）、多维表格笔记与原生海报笔记的完整增删改查，Agent 还可管理笔记本目录、标签、附件、历史版本、笔记模板与 AI 指令。

> 💡 **场景启发：**
> 让 AI 真正成为你的知识管家与创作外脑——不仅能将方案秒级生成为可交互的思维导图、流程图、架构图与多维表格，还能为 AI Agent 提供私有知识上下文。依托 EdgeEver 强大的富文本编辑与精美排版能力，AI 协同沉淀的不再是冰冷文本，而是结构工整、排版优雅、随时可一键分发的高品质知识资产。

### 多账号登录与存储管理

部署完成后，单个实例支持多账号登录。

实例管理员可以在 **个人中心** -> **账号管理** 中创建、停用成员账号或重置密码。每个成员拥有完全隔离的个人空间，包括笔记本、笔记、附件、回收站、导入导出和 MCP Token 等。系统同时提供直观的存储用量面板，可实时掌握实例整体与各账号的附件存储占用明细。

### 存储扩展与第三方图床

- **OSS 对象存储**：实例 Owner 可在**设置 → 高级设置 → OSS 对象存储**中配置兼容 S3 API 的对象存储。切换存储不会迁移或影响已有附件。
- **桌面端 PicGo 图床**：桌面端可以把新插入的图片交给本机或你信任的远程 PicGo、PicList 服务（例如 NAS），再由它上传到 GitHub、SM.MS、又拍云、七牛云或自建图床。

### 插件与个性化主题

Web 与桌面端支持功能插件与个性化主题，可从官方市场、GitHub 或 Manifest 地址一键安装，并随工作区跨端同步。开发者可使用 `@edgeever/plugin-api` 扩展能力，详见[插件开发文档](docs/plugin-development.zh-CN.md)与[官方插件市场上架政策](docs/plugin-marketplace-policy.zh-CN.md)。

---

## 开发者指南与贡献

### 快速开始

```sh
bun install
bun run dev
```

本地开发默认自动登录，首次账号为 `owner` / `edgeever-local-dev`；测试登录页可主动退出登录。

### 架构设计与技术栈

#### 技术栈选型

- Bun workspace monorepo，包含 Web、API、官网与共享类型包。
- 前端：Vite、React、React Router、TanStack Query，UI 基于 Tailwind CSS、shadcn/ui、Radix UI。
- 编辑器：TipTap / ProseMirror，支持 Markdown；PWA 使用 vite-plugin-pwa、Workbox、Dexie。
- Android App：`apps/mobile` 中的 Expo + React Native，采用 SQLite 本地存储与增量同步。
- iOS App：`apps/ios` 中的原生 SwiftUI（iOS 17+），内置 TipTap EditorBundle、GRDB 本地镜像/outbox，界面与 Android 壳层对齐。
- 原生桌面端：Electron + Rust sidecar，兼顾跨平台一致体验与高性能本地数据服务；基于 SQLite 支持离线编辑、联网后增量同步与本地备份。
- 网页裁剪：Manifest V3、Mozilla Readability、Turndown，支持 Chrome、Microsoft Edge 与 Firefox。
- 后端：一套基于 Hono/Zod 的业务应用，提供 REST API 与 Remote MCP；Cloudflare 使用 Workers/D1/R2，Docker 使用 Bun/SQLite/本地文件或 S3。
- 官网：Astro 静态站点，位于 `apps/site`，可独立构建并部署到 Cloudflare Pages。

#### 目录结构

<details>
<summary>📁 展开查看：Monorepo 项目目录结构</summary>

```text
apps/web          Vite + React 前端、PWA、离线草稿与同步队列
apps/extension    Chrome/Edge/Firefox Manifest V3 网页裁剪插件
apps/api          Cloudflare Worker + Hono API、MCP endpoint
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
docs              架构、迁移与部署文档
.github/workflows Web、移动端、iOS、桌面端打包、部署与 Release 的 CI
wrangler.toml     Cloudflare Workers、Assets、D1、R2 配置
```

</details>

#### 数据存储模型

EdgeEver 在数据库中同时保存三种内容形态，以兼顾编辑性能、开放性与全库检索效率：

```text
content_json      TipTap/ProseMirror 文档，编辑器权威格式
content_markdown  API、Agent、导入导出与外部生态消费格式
content_text      全文搜索、摘要与快速索引使用
```

### 核心机制与设计决策

- **端侧静默压缩**：为避免在 Serverless（如 Cloudflare Worker）上执行图片转码消耗宝贵的计算额度，图片压缩全部放在 Web 客户端上传前完成（PNG/JPEG/WebP/AVIF 转 WebP，最大边限制 2560px；不减小体积则保留原图）。服务端 REST API 与 MCP 接口直接入库客户端传输的原始内容。
- **离线优先与同步时序**：Web、PWA 与桌面端会在用户停止编辑 30 秒后自动上传增量，并在前台页面可见时每 5 分钟拉取一次云端变更；窗口重聚焦或手动刷新时立即同步。开发者可在 [`apps/web/src/lib/workspace-refresh.ts`](apps/web/src/lib/workspace-refresh.ts) 中调整相关时序常量（`DEFERRED_MEMO_SYNC_DELAY_MS` 与 `BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS`）。

### 参与代码贡献

我们非常欢迎社区贡献！贡献前请留意以下约定：

- 提交代码前请仔细阅读 [贡献代码须知](CONTRIBUTING.zh-CN.md)。
- **分支与部署隔离**：如果您的 GitHub Fork 同时用于在线部署 EdgeEver，请将 `main` 分支严格保留为只读部署分支；请从官方 `upstream/main` 创建新分支进行功能开发并提交 Pull Request，严禁在部署用的 `main` 分支上直接修改代码或执行 Sync fork。

---

## 社区与反馈

- **问题反馈与功能建议**：遇到 Bug、功能建议或部署疑问，请优先提交 [GitHub Issues](https://github.com/tianma-if/edgeever/issues)，方便社区沉淀并检索解决方案。

<hr>

<h3 id="wechat-group">微信交流群</h3>

欢迎加入 EdgeEver AI 交流群，这里聚集了大量 Vibe Coding 与 AI 玩家。一起交流前沿 AI 生产力与个人知识库的最佳实践。

> 扫描下方二维码或添加微信 `m1245207870`（备注“EdgeEver 进群”），群主将手动邀请入群。

<p align="center">
  <img src="assets/wechat-group-qr.jpg" alt="微信联系人二维码" width="260" />
</p>

## 友情链接

- [LINUX DO](https://linux.do/) —— 技术交流与开源项目分享社区。

## 赞助与支持

EdgeEver 是免费开源项目。保持跨平台客户端（macOS、Windows、Linux、iOS、Android）的持续演进、真机测试、证书签名以及多运行时生态建设，都需要长期的精力与资源投入。

- [支持 EdgeEver](docs/sponsor.zh-CN.md) —— 通过微信支付或支付宝自愿赞助
- [赞助商与合作伙伴](docs/partners.zh-CN.md) —— 支持基础设施、开发工具、服务或社区合作

## 致谢

- EdgeEver 的笔记产品设计也参考了 [Evernote（印象笔记）](https://evernote.com/)、[Notion](https://www.notion.com/) 等成熟笔记工具的公开产品体验。相关功能由 EdgeEver 独立设计与实现。
- 思维导图与可视化图表笔记的产品设计参考了 [XMind](https://xmind.com/) 和 [ProcessOn](https://www.processon.com/) 等图表工具的公开产品体验。相关功能由 EdgeEver 独立设计与实现。
- EdgeEver 的海报设计工作台借鉴了向阳乔木（joeseesun）的 [Qiaomu Design](https://github.com/joeseesun/qiaomu-cover-design)，并基于其 MIT 开源许可改编了模板与字体排版引擎。
- EdgeEver 图片分享卡片的主题视觉与排版参考了 [流光卡片](https://fireflycard.shushiai.com/)，感谢其设计带来的启发。

## 商标与品牌使用

EdgeEver 名称、Logo 及其他品牌标识用于识别官方项目。Fork 或修改版可以说明其“基于 EdgeEver”，但不得暗示官方身份或误导用户。开源许可不授予商标权利；其他使用须事先取得项目维护者的书面许可。

## 免责声明

EdgeEver 是一款完全独立的开源笔记软件，由个人和社区自主开发维护。本项目与 Evernote®（印象笔记）及其关联公司不存在任何商业合作、授权、赞助或隶属关系。

EdgeEver 是自托管软件。除官方演示实例外，项目维护者不托管、控制或审核用户内容。实例中存储或展示的内容由用户或实例运营者负责，不代表项目维护者的立场。

## 贡献者

<!-- readme-contributors:start -->
<p align="left">
  <a href="https://github.com/tianma-if"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/5895871?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@tianma-if" /></a>
  <a href="https://github.com/sivdead"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/27731043?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@sivdead" /></a>
  <a href="https://github.com/thorufur"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/55167?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@thorufur" /></a>
  <a href="https://github.com/yulei666"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/7358439?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@yulei666" /></a>
  <a href="https://github.com/arsaboo"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/18319734?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@arsaboo" /></a>
  <a href="https://github.com/alyyasser"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/16476111?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@alyyasser" /></a>
  <a href="https://github.com/MadlyFX"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/4896705?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@MadlyFX" /></a>
  <a href="https://github.com/claude"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/81847?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@claude" /></a>
  <a href="https://github.com/Crowszzz"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/75199133?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Crowszzz" /></a>
  <a href="https://github.com/Z-DDV"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/122068983?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Z-DDV" /></a>
  <a href="https://github.com/0xfelixli"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/81979996?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@0xfelixli" /></a>
  <a href="https://github.com/Sergmay911"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/304439776?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Sergmay911" /></a>
  <a href="https://github.com/X77seven"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/171017641?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@X77seven" /></a>
  <a href="https://github.com/mookim-eth"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/97934198?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@mookim-eth" /></a>
  <a href="https://github.com/nzhdotme"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/9588882?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@nzhdotme" /></a>
  <a href="https://github.com/Shunamxiao"><img src="https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/92215296?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d" width="48" height="48" alt="@Shunamxiao" /></a>
</p>
<!-- readme-contributors:end -->
