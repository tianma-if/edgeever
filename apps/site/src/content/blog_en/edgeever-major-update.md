---
draft: false
title: "EdgeEver Capability Overview: Cross-Platform Apps, Flexible Deploy, Native AI & Creator Workflows"
snippet: "A comprehensive product overview based on the latest EdgeEver README, architecture docs, and implementation."
image: {
    src: "/images/major-update.jpg",
    alt: "EdgeEver product capability overview"
}
publishDate: "2026-08-28 12:00"
category: "Product"
author: "EdgeEver Team"
tags: [updates, cross-platform, docker, mcp, ai-editor, creator]
---

EdgeEver is a modern, open-source notes workspace. It brings back the familiar, high-efficiency three-pane experience from classic Evernote, while providing an open data architecture, native AI Agent synergy, and flexible self-hosted deployments.

The summary below is based on the latest README, architecture documentation, and codebase structure in the `edgeever` repository.

---

### 1. Flexible Deployment: Cloudflare Serverless & Docker

EdgeEver supports two modern self-hosting options from the same codebase:

- **Cloudflare Serverless Deployment**: 100% free serverless architecture running entirely within Cloudflare Workers, D1, and R2 free tiers (accommodating ~150,000 short notes and ~50,000 images) with zero server bills and zero maintenance.
- **1-Line Docker Self-Hosting**: Official container images hosted on GHCR, deployable via `curl -fsSL https://edgeever.org/install.sh | bash` on your VPS, NAS, or home server with scalable storage for millions of notes and large attachments.

### 2. All-Platform Native Apps & Multi-Device Sync

Break free from commercial "2-device login limits" with a self-hosted API that synchronizes across all your devices:

- **macOS Desktop App**: Electron + Rust sidecar + SQLite local data service for instant local performance, offline editing, and full-screen focus mode.
- **iOS Native App**: Built with pure SwiftUI (iOS 17+), published on the App Store, integrating TipTap EditorBundle and local SQLite sync via GRDB.
- **Android App**: Available on Google Play and signed APKs on GitHub Releases, featuring offline capture and share-sheet clipping.
- **Web Clipper Extension**: Available on Chrome Web Store, Microsoft Edge Add-ons, and Firefox Add-ons for clipping articles, selections, and bookmarks.
- **Web / PWA**: Installable as a Progressive Web App in modern browsers with offline drafts and local synchronization queue.

### 3. Classic Three-Pane Layout, Dual View & Focus Mode

- **Classic Three-Pane**: Notebook tree, note list, and main editor with zero learning curve.
- **Rich Text / Markdown Dual View**: Switch seamlessly between TipTap rich text and Markdown source on desktop.
- **Unlimited Nesting & Batch Operations**: Deeply nested notebooks, drag-and-drop reorganization, and multi-note batch move or merge.
- **Revision History**: Automatic version tracking with instant review and rollback.

### 4. Native AI Agent Synergy & In-Editor Multi-Model Integration

- **Remote MCP Endpoint**: Built-in Model Context Protocol endpoint and stdio bridge authorizing Antigravity, Claude Code, and Codex to read, summarize, and organize notes, connecting seamlessly with Notion databases and Feishu Bitable.
- **In-Editor Multi-Model AI**: Connect OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and custom compatible endpoints for summarization, proofreading, translation, and action item extraction.

### 5. Creator Tools & Rich Media Rendering

- **One-Click Styled Rich Copy**: Converts Markdown into beautifully styled HTML with inline CSS, ready to paste directly into Substack, Medium, or newsletters.
- **Mermaid Diagrams & KaTeX Math**: Native rendering for architecture diagrams, sequence charts, and LaTeX equations while preserving editable source code.
- **PDF Preview & Universal Attachments**: Inline PDF document previews alongside Office files, archives, audio, and video attachments.
- **Single-Note Export**: Export individual notes to Markdown, HTML, or PDF formats in one click.
- **Client-Side Image Compression**: Silently compresses images in the browser before upload (saving 50%-90% storage).

### 6. Data Sovereignty, Multi-Account Workspaces & Lossless Migration

- **Isolated User Workspaces**: Single instance supports multiple independent user accounts with isolated data and MCP tokens.
- **Lossless ZIP Backup & Restore**: One-click export including Markdown, Front Matter, nested hierarchies, attachments, and revision history for cross-instance recovery.
- **Smooth Migration Tools**: Built-in migration scripts and step-by-step guides for Evernote (ENEX / evernote-backup), Memos, Notion, and Flomo.

