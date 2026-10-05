<div align="center">
  <h1>
    <img src="assets/brand/edgeever-icon.svg" alt="EdgeEver Logo" width="48" align="absmiddle" /> EdgeEver
  </h1>
  <p>
    <b>开源、原生支持 AI、可自由部署的自托管知识库与「印象笔记」替代方案</b>
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
    <b>简体中文</b> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.md">English</a> | <a href="README.ja.md">日本語</a>
  </p>
  <p>
    <a href="#wechat-group"><img src="assets/readme/community/wechat.svg" alt="WeChat" width="16" height="16" align="absmiddle" /> 微信交流群</a> &nbsp;|&nbsp;
    <a href="https://demo.edgeever.org">🌐 在线演示</a> &nbsp;|&nbsp;
    <a href="#客户端下载">📱 客户端下载</a> &nbsp;|&nbsp;
    <a href="docs/best-practices.zh-CN.md">✨ 场景与最佳实践</a>
  </p>
</div>



EdgeEver 是一款现代化的开源笔记与个人知识库工作区。它为你找回经典印象笔记的三栏高效体验，同时具备完全开放的数据架构与原生 AI Agent 联动能力，让个人知识沉淀更轻量、更自由。

> 💡 **终身免服务器，100% 免费**
> EdgeEver 可以免费运行在 Cloudflare 配额内，无需购买或维护服务器；希望使用 VPS、NAS 或家庭服务器的用户，也可以通过 Docker 部署同一套应用。

> ⭐ 如果 EdgeEver 对你有帮助，欢迎点个 Star。你的支持会帮助更多人发现这个项目。

## 为什么做 EdgeEver

很多长期使用**印象笔记**的用户，核心需求只是一个**可靠、开放、响应迅速**的个人知识库。然而，当下的主流方案都各有痛点：

* **印象笔记**：功能日益臃肿，商业广告与繁杂附加功能充斥，性能与内存占用居高不下；且数据相对封闭难以导出，免费版限制重重，支持 AI/MCP 的套餐订阅成本高昂。
* **Obsidian**：Markdown 开放，核心闭源；官方同步收费，第三方同步繁琐；纯本地文件依赖遍历扫描，当笔记积累到数千上万条或加载复杂插件后，冷启动与全库检索明显卡顿迟缓；图片与附件与文本混存，仓库体积极易膨胀导致移动端同步缓慢，且删笔记后残留附件难清理；对于“随时随地随手记”的轻量场景来说偏重。
* **Memos / Flomo 等轻量笔记**：虽然简单好用，但流式卡片布局与习惯了经典“三栏工作流”的用户有着天然的交互习惯差异。
* **思源笔记等块级知识库**：功能深厚且支持开源自托管，但全面的“块级（Block）”架构使得日常随手记录与连续排版书写的心智负担偏重；且缺少零服务器成本的 Serverless 部署形态，多端同步主要依赖官方付费订阅，或需额外付费解锁 S3/WebDAV 同步特性并自备存储。

**EdgeEver 恰好填补了这一空白**：整栈开源，云同步与自托管都可自行部署；同时保留经典三栏布局与流畅排版，万条笔记常驻依然轻盈丝滑，原生支持接入 AI Agent，部署维护零门槛、零费用。

> 💡 **最佳实践推荐：**
> 全端随时捕捉灵感与素材，在经典三栏中深度整理沉淀；借助原生 MCP 与 ACP 协议，既能让外部 Agent 随时检索与整理笔记，也可在桌面端直接调用本机 AI Agent 深度协同；对外一键排版发布，全量数据 0 成本自托管，打造开放互联、真正属于你的智能第二大脑。

## 在线演示

- Demo 地址：[https://demo.edgeever.org](https://demo.edgeever.org)

公开演示环境会在每天凌晨 3:00（北京时间）自动重置并恢复示例笔记，请不要保存私密内容。

## 客户端下载

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/macos.svg" alt="下载 macOS 客户端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/windows.svg" alt="下载 Windows 客户端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/tux.svg" alt="下载 Linux x86_64 AppImage 预览版" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile"><img src="assets/readme/platforms/google-play.svg" alt="从 Google Play 下载 Android 客户端" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/us/app/edgeever/id6792625631"><img src="assets/readme/platforms/app-store.svg" alt="从 App Store 下载 iOS 客户端" width="40" height="40" /></a>
</p>

> iOS 客户端需要使用非中国大陆区 Apple ID 下载。

## 功能

- **自由选择部署方式**：既可免费运行于 Cloudflare Serverless，也可通过 Docker 部署到 VPS、NAS 或家庭服务器。按 Cloudflare 免费存储额度估算，个人部署可容纳约 15 万条短笔记和约 5 万张图片；Docker 存储可按需扩展，轻松承载百万级笔记与海量图片。
- **数据开放，不设围墙**：基于标准 SQLite 存储，提供 REST API、MCP 与 CLI 接口。数据随时可读可导，不再担心被任何特定平台绑定。
- **无损 ZIP 打包与无缝迁移**：一键打包导出包含 Markdown、Front Matter、嵌套目录及附件的完整档案，同时保留历史版本与结构化数据，方便在不同实例间完整还原。
- **原生 AI Agent 智脑联动**：内置 MCP（Model Context Protocol）协议，支持外部 AI Agent 直接读取与整理笔记；同时桌面端支持通过 ACP（Agent Client Protocol）协议直接调用本机运行的 AI Agent（如 Codex、Antigravity、Claude Code、WorkBuddy 等）协同创作。
- **接入自己的 AI 模型**：支持添加多个 OpenAI、Anthropic、Gemini 兼容服务与第三方中转平台，驱动内置 Agent，在伴侣侧边栏与编辑器中随时对全文或选区进行智能总结、要点提炼、语法校对、翻译与续写润色。
- **丰富的插件 API**：可通过[插件开发文档](docs/plugin-development.zh-CN.md)扩展 EdgeEver。
- **多端无缝同步，无设备限制**：自托管数据无商业限制，摆脱免费账号仅限 2 台设备的束缚，在 PC、平板与手机上随心同步。
- **经典三栏布局与专注模式**：笔记本树、笔记列表与编辑区一目了然；桌面端一键开启专注模式，让思绪尽情铺满屏幕。
- **桌面端轻快省内存**：切笔记不会堆积旧图和旧文档，长时间挂在后台也保持流畅。
- **无限层级笔记本**：轻松构建清晰的多级目录结构。
- **微信公众号一键排版与复制**：专为中文创作者设计，支持将笔记一键转换为带行内样式的公众号美化格式，直接复制粘贴至微信公众号后台，告别复杂的第三方排版工具。
- **优雅的双视图编辑**：桌面端支持在富文本与 Markdown 源码视图之间自由切换。
- **单篇笔记便捷导出**：可将当前笔记直接导出为 Markdown、HTML 或 PDF，方便独立保存、分享与发布。
- **Mermaid 架构图与流程图渲染**：原生支持 Mermaid 代码块渲染，视图切换时完整保留可编辑源码，让绘制逻辑图表更直观。
- **可视化图表笔记**：告别外部绘图软件，在笔记内即可直观绘制思维导图、流程图与架构图；基于结构化 IR，内置助手与外部 AI Agent 可一句话智能生成与修改图表，支持自动布局、全端同步及矢量导出。详见[可视化图表笔记设计说明](docs/visual-diagram-notes.zh-CN.md)。
- **笔记历史版本回溯**：自动记录修改历史，随时查阅与还原过往版本。
- **公开笔记分享**：支持公开分享笔记，并可随时取消分享；需要时可为分享链接开启自动生成的访问密码。
- **微信公众号文章剪藏**：在手机上将微信公众号文章分享至 EdgeEver，即可提取正文并保存为可继续编辑的笔记。
- **微信聊天记录导入**：macOS 端支持在微信中将聊天记录「转发到其他应用 → EdgeEver」，一键整段导入为结构化笔记，完整保留发言人、时间轴、引用回复及微信表情，图片自动内嵌，视频与文件自动转为笔记附件。详见[最佳实践示例](docs/best-practices.zh-CN.md)。
- **智能前端图片压缩**：图片上传前在浏览器端静默完成压缩，常见截图与大图精简 50%-90% 体积，加载更迅速、存储更省心。
- **通用文件附件支持**：支持轻松上传并插入 PDF、Office 文档、压缩包及音视频等各种附件；通过分片上传与流式处理，安全支持最大 1 GiB 附件。
- **高效多选与批量操作**：支持笔记批量合并、批量移动，以及笔记本拖拽排序与层级调整。
- **离线草稿与同步队列**：网络不稳定时自动保存离线草稿，恢复连线后自动入队同步。
- **登录防暴力破解保护**：服务端按账号与 IP 记录失败登录并自动限流、冷却，降低暴力破解与密码喷洒攻击风险，守护私密笔记数据。
- **多账号与个人空间隔离**：单实例支持创建多个独立账号，用户数据相互隔离，配备直观的管理员账号管理与安全加密机制。
- **全平台多端覆盖**：支持 Web、[Android](https://play.google.com/store/apps/details?id=org.edgeever.mobile)、[macOS](https://github.com/tianma-if/edgeever/releases)、[Windows](https://github.com/tianma-if/edgeever/releases/latest)、[Linux](https://github.com/tianma-if/edgeever/releases/latest) 和 [iOS](https://apps.apple.com/us/app/edgeever/id6792625631)；网页裁剪插件支持 [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)、[Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo) 和 [Firefox](https://addons.mozilla.org/zh-CN/firefox/addon/edgeever-web-clipper/)。

## 部署

Cloudflare 是推荐的零服务器部署方式；希望使用 VPS、NAS 或家庭服务器的用户也可以选择 Docker。

Cloudflare 在线部署可以选择以下两种方式之一：

### 方案一：AI Agent 一键部署（推荐）

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

仅需在网页端完成 6 步配置：

1. **Fork 仓库**：在 GitHub 点击右上角 **Fork**，将项目 Fork 到您的个人账户下。
2. **创建 Cloudflare 资源**：创建 D1 `edgeever` 与 R2 `edgeever-resources`。
3. **导入并配置项目**：在 Cloudflare **Workers & Pages** 中从 Fork 的 `main` 分支创建名为 `edgeever` 的 Worker。使用仓库根目录，保留由 Cloudflare 在线执行的 Workers Builds 默认部署命令，并确认其 API Token 具备 D1 读取和编辑权限。binding 由部署命令生成，不要修改 Fork 中的文件。
4. **准备管理员密码**：准备管理员登录密码，建议至少 32 个字符。Worker 创建后，将它保存为运行时 Secret `EDGE_EVER_AUTH_PASSWORD`。
5. **首次构建与验证**：保存并部署会创建 Worker 并启动构建。如因缺少管理员 Secret 而失败，添加第 4 步的运行时 Secret 后重试。管理员用户名默认为 `admin`；如需使用其他用户名，请在重试构建前设置 Workers Builds 构建变量 `EDGE_EVER_AUTH_USERNAME`。部署完成后访问 `/api/health`，确认返回 `200`，再用配置的管理员用户名和密码登录。
6. **启用自动更新**：进入 Fork 的 **Actions** 标签页，点击 **I understand my workflows, go ahead and enable them**，然后手动运行一次 **Update deployed EdgeEver**，确保后续能够自动获得正式版本的功能更新与修复。

> 📖 包含具体参数与构建命令的详细步骤，请查看 [在线部署完整文档](docs/deploy-cloudflare-button.zh-CN.md)。

> 💡 **域名与访问**：实例部署完成后，可以直接使用 Cloudflare 默认分配的 `*.workers.dev` 域名访问，也可以在 Worker 的 **Settings → Domains & Routes** 中绑定自己的自定义域名（强烈建议绑定自定义域名以保障国内直连稳定性并提升访问速度）。

> 💡 **Cloudflare R2 开通**：虽然 Cloudflare R2 存储提供了足够慷慨、在笔记场景中完全不会超量的[免费存储额度](https://developers.cloudflare.com/r2/pricing/#free-tier)，但需先开通 R2 subscription 并绑定付款方式。Cloudflare [官方支持](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) 银联（UnionPay）、Visa、Mastercard 等银行卡，以及 PayPal、Apple Pay、Google Pay 等付款方式。

### 方案三：在 VPS 或 NAS 上使用 Docker

使用 GitHub 托管的安装脚本和官方 GHCR 镜像：

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

该命令会自动拉取最新镜像、生成管理员密码，并使用 Docker Compose 启动 EdgeEver。手动部署与配置说明见 [Docker 部署文档](docs/deploy-docker.zh-CN.md)。

安装后默认每日自动更新。如需手动更新，请在部署服务器上运行 `~/edgeever/update.sh`。

> 💡 **网络提示**：官方镜像托管于 GitHub（GHCR）。若在部分网络环境下遇到拉取缓慢或超时，请在部署前自行配置可用的网络代理或可信的镜像加速服务。

---

## 多账号登录

部署完成后，单个实例支持多账号登录。

实例管理员可以在 **个人中心** -> **账号管理** 中创建、停用成员账号或重置密码。每个成员拥有完全隔离的个人空间，包括笔记本、笔记、附件、回收站、导入导出和 MCP Token 等。

## 浏览器网页裁剪插件

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="为 Google Chrome 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="为 Microsoft Edge 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/zh-CN/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="为 Firefox 安装 EdgeEver 网页裁剪插件" width="36" height="36" /></a>
</p>

- **智能正文提取**：自动提取网页文章正文并转为纯净 Markdown，自动保留来源网址与剪藏时间。
- **划选与右键剪藏**：选中局部文字或右键任意图片直接存为独立笔记，无需抓取整页冗余内容。
- **社媒与社区深度剪藏**：深度适配 X (Twitter)、小红书、知乎、Reddit 与 GitHub，一键发送。
- **自托管隐私直连**：剪藏内容直传个人自托管实例，不经过任何第三方服务器中转。

## 社区与反馈

- Bug、功能建议和部署问题请优先提交 [GitHub Issues](https://github.com/tianma-if/edgeever/issues)，方便后续用户检索和复用解决方案。
- 贡献代码前请阅读[贡献代码须知](CONTRIBUTING.zh-CN.md)。如果您的 Fork 同时用于部署 EdgeEver，请将 `main` 分支仅用于部署；从官方 `upstream/main` 新建独立分支，在该分支中同步上游、开发并提交 Pull Request，不要在部署用的 `main` 上开发或执行 Sync fork。

<hr>

<h3 id="wechat-group">微信交流群</h3>

欢迎加入 EdgeEver AI 交流群，这里聚集了大量 Vibe Coding 与 AI 玩家。一起交流 EdgeEver 体验、AI Agent 实战落地、高性价比/免费 AI 资源及自动化工作流。

> 当前交流群人数已满 200 人，无法直接扫码进群。请扫描下方二维码或添加微信 `m1245207870`，并备注“EdgeEver 进群”，群主将手动邀请您加入。

<p align="center">
  <img src="assets/wechat-group-qr.jpg" alt="微信联系人二维码" width="260" />
</p>

## 插件与主题

Web 与桌面端支持功能插件与个性化主题，可从官方市场、GitHub 或 Manifest 地址一键安装，并随工作区跨端同步。开发者可使用 `@edgeever/plugin-api` 扩展能力，详见[插件开发文档](docs/plugin-development.zh-CN.md)与[官方插件市场上架政策](docs/plugin-marketplace-policy.zh-CN.md)。

## 技术栈

- Bun workspace monorepo，包含 Web、API、官网与共享类型包。
- 前端：Vite、React、React Router、TanStack Query，UI 基于 Tailwind CSS、shadcn/ui、Radix UI。
- 编辑器：TipTap / ProseMirror，支持 Markdown；PWA 使用 vite-plugin-pwa、Workbox、Dexie。
- Android App：`apps/mobile` 中的 Expo + React Native，采用 SQLite 本地存储与增量同步。
- iOS App：`apps/ios` 中的原生 SwiftUI（iOS 17+），内置 TipTap EditorBundle、GRDB 本地镜像/outbox，界面与 Android 壳层对齐。
- 原生桌面端：Electron + Rust sidecar，兼顾跨平台一致体验与高性能本地数据服务；基于 SQLite 支持离线编辑、联网后增量同步与本地备份。
- 网页裁剪：Manifest V3、Mozilla Readability、Turndown，支持 Chrome、Microsoft Edge 与 Firefox。
- 后端：一套基于 Hono/Zod 的业务应用，提供 REST API 与 Remote MCP；Cloudflare 使用 Workers/D1/R2，Docker 使用 Bun/SQLite/本地文件或 S3。
- 官网：Astro 静态站点，位于 `apps/site`，可独立构建并部署到 Cloudflare Pages。

## 快速开始

```sh
bun install
bun run dev
```

本地开发默认自动登录，首次账号为 `owner` / `edgeever-local-dev`；测试登录页可主动退出登录。

## 目录结构

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

## 内容格式

EdgeEver 同时保存三种内容形态：

```text
content_json      TipTap/ProseMirror 文档，编辑器权威格式
content_markdown  API、Agent、导入导出使用
content_text      搜索、摘要和索引使用
```

请打开 **我的** -> **导入与导出**，导出或导入 EdgeEver ZIP。压缩包中的 `notes/` 目录可直接作为 Markdown 阅读和迁移，结构化数据则用于在 EdgeEver 实例之间完整恢复；导入时目标实例中的无关数据会保留，相同 EdgeEver ID 的内容会被覆盖。

## MCP

在 **个人中心** -> **API / MCP** 中创建 API Token 并一键复制 Remote MCP 配置，即可让 Claude Code、Cursor、Antigravity、OpenClaw 等 AI Agent 在账号授权范围内安全管理你的知识库。系统支持文本笔记、图表笔记（思维导图、流程图与架构图）和多维表格笔记的完整增删改查，Agent 还可管理笔记本目录、标签、附件、历史版本、笔记模板与 AI 指令。

> 💡 **场景启发：**
> 让 AI 真正成为你的知识管家与创作外脑——不仅能将方案秒级生成为可交互的思维导图、流程图、架构图与多维表格，还能为 AI Agent 提供私有知识上下文。依托 EdgeEver 强大的富文本编辑与精美排版能力，AI 协同沉淀的不再是冰冷文本，而是结构工整、排版优雅、随时可一键分发的高品质知识资产。

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

## 赞助与支持

EdgeEver 是免费开源项目。保持跨平台客户端（macOS、Windows、Linux、iOS、Android）的持续演进、真机测试、证书签名以及多运行时生态建设，都需要长期的精力与资源投入。

- [支持 EdgeEver](docs/sponsor.zh-CN.md) —— 通过微信支付或支付宝自愿赞助
- [赞助商与合作伙伴](docs/partners.zh-CN.md) —— 支持基础设施、开发工具、服务或社区合作

## 致谢

- EdgeEver 的笔记产品设计也参考了 [Evernote（印象笔记）](https://evernote.com/)、[Notion](https://www.notion.com/) 等成熟笔记工具的公开产品体验。相关功能由 EdgeEver 独立设计与实现。
- 思维导图与可视化图表笔记的产品设计参考了 [XMind](https://xmind.com/) 和 [ProcessOn](https://www.processon.com/) 等图表工具的公开产品体验。相关功能由 EdgeEver 独立设计与实现。

## 商标与品牌使用

EdgeEver 名称、Logo 及其他品牌标识用于识别官方项目。Fork 或修改版可以说明其“基于 EdgeEver”，但不得暗示官方身份或误导用户。开源许可不授予商标权利；其他使用须事先取得项目维护者的书面许可。

## 免责声明

EdgeEver 是一款完全独立的开源笔记软件，由个人和社区自主开发维护。本项目与 Evernote®（印象笔记）及其关联公司不存在任何商业合作、授权、赞助或隶属关系。

EdgeEver 是自托管软件。除官方演示实例外，项目维护者不托管、控制或审核用户内容。实例中存储或展示的内容由用户或实例运营者负责，不代表项目维护者的立场。
