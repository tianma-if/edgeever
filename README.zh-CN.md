# EdgeEver

简体中文 | [English](README.md)

> **EdgeEver：无需服务器、0 费用、开源且原生支持 AI Agent 的自托管『印象笔记』替代品。**

EdgeEver 是一个开源、自托管、Cloudflare-native 的现代笔记工作区。它保留经典印象笔记的三栏体验，同时提供清晰的数据模型、REST API、OpenAPI schema 和 MCP endpoint，原生支持 AI Agent 接入。
> 💡 **终身免服务器，100% 免费**
> EdgeEver 采用纯 Serverless（无服务器）架构。自部署时**你不需要购买任何云服务器**，也**不需要折腾复杂的 Docker 或 SSL 证书**。直接运行在 Cloudflare 的免费额度内，个人日常使用 **完全免费，0 费用，0 运维**。

## 为什么做 EdgeEver

很多长期使用印象笔记的人需要的只是一个可靠、开放、响应足够快的个人知识库。但现在的印象笔记越来越臃肿，商业化和附加功能不断增加，性能和内存占用也越来越难让人满意。

更麻烦的是数据开放性：笔记很难直接导出为开放格式，迁移常常依赖可能失效的第三方插件；国内版不原生支持 MCP，国际版价格又不适合很多个人用户。

Memos 等轻量笔记产品更开放，但交互体验和经典印象笔记式三栏工作流仍有明显距离。
EdgeEver 想填补这个空白：保留熟悉的笔记体验，同时提供开放数据、REST API、MCP 和零成本自托管部署。

## 在线演示

- Demo 地址：[https://demo.edgeever.org](https://demo.edgeever.org)

公开演示环境会每天自动重置并恢复示例笔记，请不要保存私密内容。

## 部署

### 通过AI Agent 一句话部署
 
将下方提示词复制给你的 AI 助手（Claude Code、Codex、Antigravity、Cursor、Trae 等），它会自动完成安装

**建议：** 开始部署前，请先为 AI Agent 配置 GitHub 和 Cloudflare 的 MCP、插件或其他可用集成，以便 Agent 完成仓库 Fork、Cloudflare 资源创建与应用部署。

```text
请按以下流程操作：
1. Fork EdgeEver 上游仓库：https://github.com/tianma-if/edgeever
2. 使用 Fork 后的仓库，将 EdgeEver 安装并部署到 Cloudflare。
3. 为 Fork 仓库配置从上游仓库同步更新的机制，使其能够定期或按需获取上游仓库的最新代码与产品特性。
```

Agent 应优先按 [AI Agent Cloudflare Deployment](docs/agent-deploy-cloudflare.md) 执行 

> 常见踩坑：Cloudflare 的 R2、D1 和 Worker 即使使用免费额度，在开通或使用过程中也可能要求绑定一张 Visa 卡。国内用户可以考虑办理招商银行多币种卡，拿到 Visa 卡后绑定到 Cloudflare 账号即可。

### 手动部署

关于手动安装和更新的详细步骤，请参考 [Cloudflare 手动部署指南](docs/manual-deploy.zh-CN.md)。

推荐优先使用自动化辅助命令。如果选择完全手动创建 Cloudflare 资源，必须先在 `.env.local` 中完成 D1 ID、R2 bucket、密码 hash 和 400 天会话期限等配置，再执行 `bun run deploy`。


## 功能

- 零服务器，零运维，终身完全免费：基于 Cloudflare 无服务器架构与免费级配额，短笔记可达 15 万条，200KB 图片约可存放 5 万张，彻底免去云服务器租用和维护成本。
- 数据完全开放：笔记内容存放在基于标准 SQLite 的 Cloudflare D1 中，可通过 REST API、MCP 和 CLI 按需读取、迁移或导出，不用担心被单一笔记产品绑定。
- AI Agent 友好：原生支持 MCP，可让 Codex、Claude Code、Antigravity 等工具读取、整理和维护笔记，并可借助 MCP 与 Notion Database、飞书多维表格进行联动。
- 多端无缝同步且不限设备数：基于自建的 API 个人独享数据，摆脱商业笔记平台对登录设备数量的强制限制（如免费版只允许登录 2 台设备等），支持 PC、平板与手机无缝多端同步。
- 三栏布局：笔记本树、笔记列表、主编辑区。
- 无限级嵌套笔记本。
- 支持富文本编辑。
- 支持查看笔记历史版本，便于回溯内容变化。
- 笔记图片上传前支持 Web 端本地压缩，常见截图和大尺寸照片通常可减少约 50%-90% 体积，减少资源占用且不消耗 Cloudflare Images 额度。
- 多选合并笔记。
- 多选移动笔记，笔记本支持拖拽排序和调整层级。
- 已有笔记支持离线编辑草稿和本地同步队列。
- 单用户登录，密码使用 PBKDF2-SHA256 hash。

## PWA 安装说明

PWA 可以把 EdgeEver 像普通应用一样安装到桌面或手机主屏幕，打开更方便，也能配合浏览器能力提供更接近原生 App 的使用体验。

PC 端请使用 Chrome/Edge 打开站点，点击地址栏右侧的“安装”图标并确认。Android 建议用 Chrome 打开站点，点右上角三点菜单，选择“添加到主屏幕”，再点“安装”。Edge 可尝试菜单中的“添加到手机 / 添加到主屏幕 / 安装应用”，不同版本可能只创建快捷方式。请不要从微信等 App 内置浏览器安装。

> 常见踩坑：移动端安装 PWA 时，建议优先使用 Chrome 或 Edge。其他移动浏览器在安装过程中可能出现兼容性问题或异常报错。

## 关于客户端

原生客户端已纳入 EdgeEver 的开发计划。移动端 App 计划基于 React Native 构建，桌面端 App 计划基于 Tauri 构建。

目标是让用户可以将这些客户端连接到自己的自托管 EdgeEver 实例，在继续保持 Cloudflare 后端、开放 API 和用户自有数据模型的同时，获得更顺滑的移动端与桌面端原生体验。

## 技术栈

- Bun workspace monorepo，包含 Web、API、官网与共享类型包。
- 官网：Astro 静态站点，位于 `apps/site`，可独立构建并部署到 Cloudflare Pages。
- 前端：Vite、React、React Router、TanStack Query，UI 基于 Tailwind CSS、shadcn/ui、Radix UI。
- 编辑器：TipTap / ProseMirror，支持 Markdown；PWA 使用 vite-plugin-pwa、Workbox、Dexie。
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

启动本地开发：

```sh
bun run dev
```

常用检查：

```sh
bun run typecheck
bun run build
```

## 目录结构

```text
apps/web          Vite + React 前端、PWA、离线草稿与同步队列
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
