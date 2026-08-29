---
draft: false
title: "EdgeEver 产品全景能力概览：全平台客户端、自由部署、原生 AI 与创作者工作流"
snippet: "基于核心仓库 README、文档与代码实现，全面整理 EdgeEver 当前的全平台、多部署、原生 AI 与开放数据能力。"
image: {
    src: "/images/major-update.jpg",
    alt: "EdgeEver 产品全景概览"
}
publishDate: "2026-08-28 12:00"
category: "Product"
author: "EdgeEver Team"
tags: [updates, cross-platform, docker, mcp, ai-editor, creator]
---

EdgeEver 是一款现代化的开源笔记工作区。它为你找回经典印象笔记的三栏高效体验，同时具备完全开放的数据架构、原生 AI Agent 联动与自由部署能力，让个人知识沉淀更轻量、更自由。

以下内容基于 `edgeever` 仓库的最新 README、架构文档和代码实现进行系统梳理。

---

### 1. 自由选择部署方式：Cloudflare Serverless 与 Docker

EdgeEver 同一套应用完美支持两种自托管形态：

- **Cloudflare Serverless 部署**：终身免服务器，完全运行在 Cloudflare Workers、D1 与 R2 免费额度内（可容纳约 15 万条短笔记和 5 万张图片），零月租、零运维。
- **Docker 一键脚本自托管**：官方容器镜像托管于 GHCR，支持单行命令 `curl -fsSL https://edgeever.org/install.sh | bash` 在 VPS、NAS 或家庭服务器快速启动，存储按需扩展，轻松承载百万级笔记与海量附件。

### 2. 全平台原生客户端与多端同步

摆脱商业笔记“免费版仅限 2 台设备”的束缚，自建专属 API 支持多端无缝协同：

- **macOS 桌面端**：基于 Electron + Rust sidecar + SQLite 本地数据服务，兼顾极速本地响应、离线编辑与一键全屏专注模式。
- **iOS 原生 App**：基于原生 SwiftUI（iOS 17+）构建，已上架 App Store，集成 TipTap EditorBundle 与本地 SQLite 镜像。
- **Android App**：已上架 Google Play，同时在 GitHub Releases 提供签名 APK，支持离线记录与微信文章分享剪藏。
- **浏览器剪藏插件**：已在 Chrome Web Store、Microsoft Edge 与 Firefox Add-ons 全面上架，智能捕获网页全文、选区与书签。
- **Web / PWA**：支持现代浏览器直接访问并安装为 PWA，内置离线草稿与本地同步队列。

### 3. 经典三栏布局、双视图与专注模式

- **经典三栏**：笔记本树、笔记列表与主编辑区一目了然，零迁移学习成本。
- **富文本 / Markdown 双视图**：桌面端支持在 TipTap 富文本与 Markdown 源码视图之间自由切换。
- **无限层级与批量操作**：支持无限多级笔记本嵌套、拖拽重排与笔记批量移动/合并。
- **历史版本回溯**：自动记录修改历史，随时查阅与还原过往版本。

### 4. 原生 AI Agent 智脑与内置多模型

- **Remote MCP 协议**：内置 Model Context Protocol endpoint 与 stdio bridge，直接授权 Antigravity、Claude Code、Codex 等 AI 助手安全读写与整理笔记，也可与 Notion Database、飞书多维表格轻松打通。
- **编辑器内置 AI 模型**：支持接入 OpenAI、Anthropic Claude、Google Gemini、DeepSeek 及自定义兼容服务，在编辑器中一键进行智能总结、语法校对、翻译、续写润色与提炼行动项。

### 5. 创作者排版与富媒体渲染

- **微信公众号一键排版复制**：专为中文创作者设计，Markdown 瞬间转换为带内联样式的公众号精美排版，一键复制粘贴直接发布。
- **Mermaid 架构图与 KaTeX 公式**：原生渲染架构图、流程图、时序图与数学公式，切换视图时保留可编辑源码。
- **PDF 预览与通用附件**：支持直观预览 PDF 文档，无缝插入 Office、压缩包及音视频等多媒体附件。
- **单篇笔记便捷导出**：支持将单篇笔记一键导出为 Markdown、HTML 或 PDF 格式。
- **前端智能图片压缩**：上传前在浏览器端静默压缩大图（精简 50%-90% 体积），加载更迅速、存储更省心。

### 6. 数据主权、多账号空间与无损迁移

- **多账号独立空间**：单实例支持创建多个独立成员账号，用户数据与 MCP Token 完全物理隔离。
- **无损 ZIP 打包导出**：一键打包包含 Markdown、Front Matter、嵌套目录及附件的完整档案，支持跨实例完整还原。
- **平滑迁入工具**：提供针对印象笔记（Evernote ENEX / evernote-backup）、Memos、Notion 与 Flomo 的自动化迁移工具与指南。

