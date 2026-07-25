# EdgeEver

[简体中文](README.zh-CN.md) | English

> **EdgeEver: A serverless, 100% free, open-source, and AI-native self-hosted Evernote alternative.**

EdgeEver is a modern, open-source notes workspace built for effortless knowledge management. It revives the beloved Evernote-style three-pane layout while offering an open data architecture and seamless AI Agent integration for complete ownership and smart productivity.

> 💡 **Serverless & 100% Free Forever**
> EdgeEver uses a pure Serverless architecture. **No server purchase or VPS rental is required**, and there is no need to configure Docker or SSL certificates. By running within Cloudflare's free quotas, personal use is **100% free with zero maintenance**.

> ⭐ If EdgeEver is useful to you, consider giving it a Star. Your support helps more people discover the project.

## Why EdgeEver

Many long-time **Evernote** users simply want a **reliable, open, and fast** personal knowledge base. However, existing mainstream solutions all present tradeoffs:

* **Evernote**: It has grown increasingly bloated with commercial ads and unnecessary features, degrading performance. Data export is cumbersome, free tiers are heavily restricted, and AI/MCP features require costly subscriptions.
* **Obsidian**: Exceptionally powerful and open, yet feels a bit heavy for quick, friction-free captures on the go. Official sync is subscription-based, while third-party sync setups demand significant effort.
* **Memos & Stream Notes**: Clean and simple, but their social-timeline layouts differ fundamentally from the structured productivity of a classic three-pane workflow.

**EdgeEver fills this gap**: It preserves the refined three-pane layout you know and love, while unlocking complete data ownership, native AI capabilities, and zero-cost self-hosted deployment.

> 💡 **Recommended Workflow:**
> Use **EdgeEver** as your central inbox to quickly capture ideas and notes on any device. When it's time to curate and publish, leverage **MCP** to let your AI assistant distill, tag, and sync them into **Obsidian**, **Notion**, or **Feishu Bitable**, or copy beautifully styled posts directly into **Substack**, **Medium**, or newsletters with a single click.

## Online Demo

- Demo: [https://demo.edgeever.org](https://demo.edgeever.org)

The public demo resets every Monday at 1:00 AM (China Standard Time) and restores sample notes. Do not store private content there.

## Features

- **Zero Server, Zero Ops, Truly Free**: Powered by Cloudflare Serverless. No cloud servers to rent or maintain. Free tiers easily accommodate up to 150k notes and 50k images with blazing-fast global edge delivery.
- **Open Data, No Vendor Lock-in**: Built on standard SQLite with complete REST API, MCP, and CLI access. Your knowledge is stored transparently and accessible anytime without being locked to a single app.
- **Lossless ZIP Backup & Portability**: Export your complete library as a clean archive containing Markdown, Front Matter, nested folders, relative attachment links, and version histories for instant restoration anywhere.
- **Native AI Agent Synergy**: Deep integration with Model Context Protocol (MCP) allows AI tools like Claude Code, Codex, and Antigravity to read, organize, and summarize your notes, or sync seamlessly with Notion and Feishu Bitable.
- **Unlimited Multi-Device Sync**: No commercial device caps or paywalls. Enjoy seamless synchronization across PC, tablet, and mobile via web, PWA, or browser.
- **Classic Three-Pane Layout & Focus Mode**: Clean navigation featuring notebook trees, note lists, and an expansive editor, with a desktop focus mode to eliminate distractions.
- **Unlimited Nested Notebooks**: Organize your knowledge with arbitrary folder depth.
- **One-Click Rich Copy for Newsletters & Blogs**: Designed for creators to convert notes into beautifully formatted rich text with inline CSS, ready to paste directly into Substack, Medium, WordPress, or newsletter editors without extra tools.
- **Seamless Dual-View Editor**: Switch effortlessly between intuitive rich text editing and Markdown source code on desktop.
- **Native Mermaid Diagram Rendering**: Render clear flowcharts, sequence diagrams, and mind maps directly in notes, preserving clean, editable source code across Markdown and rich text views.
- **Revision History**: Inspect and restore previous iterations of your notes with built-in version tracking.
- **Smart Local Image Compression**: Client-side WebP compression reduces file sizes by 50%-90% before uploading, saving storage and speeding up page loads without extra server costs.
- **Universal File Attachments**: Attach and preview PDFs, Office documents, zip files, audio, and video directly within notes.
- **Batch Operations & Flexible Sorting**: Easily merge or relocate multiple notes, with drag-and-drop notebook reordering.
- **Offline Drafts & Queueing**: Draft and edit uninterrupted while offline; changes automatically sync once reconnected.
- **Multi-Tenant Account Isolation**: Host multiple user accounts on a single instance with strictly partitioned spaces and clean admin account management.
- **Everywhere You Need It**: Chrome/Edge Web Clipper published on Chrome Web Store; installable as a PWA; native mobile apps (iOS/Android) arriving soon with Android APK downloadable on GitHub Releases.

## Deployment

EdgeEver uses a pure Serverless architecture that runs entirely within Cloudflare's free tiers. **No VPS or server rental is required, and there is no need to configure Docker or SSL certificates.**

You can deploy online using either of the following two options:

### Option A: Deploy with an AI Agent (Recommended)

Copy this prompt into an AI Agent configured with GitHub and Cloudflare MCP servers, plugins, or other integrations (such as Codex, Claude, Cursor, Antigravity, OpenClaw, Hermes Agent, etc.):

```text
Deploy EdgeEver online:
1. Fork https://github.com/tianma-if/edgeever.
2. Import the Fork into Cloudflare Workers & Pages.
3. Configure D1, R2, the `EDGE_EVER_AUTH_PASSWORD` Worker Secret, and the production `main` build.
4. Start the first build and verify `/api/health`, `/api/openapi.json`, and login.
5. Enable and run `Update deployed EdgeEver` once.
```

> Detailed requirements: [AI Agent Cloudflare Deployment](docs/agent-deploy-cloudflare.md).

### Option B: Manual Online Deployment

Complete setup in 4 simple web steps:

1. **Fork the Repository**: Click **Fork** at the top right of GitHub to fork EdgeEver into your personal account.
2. **Import into Cloudflare**: Log into the Cloudflare Dashboard, navigate to **Workers & Pages**, and choose to import your Fork repository.
3. **Bind Resources & Password**: Bind the D1 database (`DB`), R2 bucket (`RESOURCES`), and set the Worker Secret `EDGE_EVER_AUTH_PASSWORD` as your admin password.
4. **Build & Verify**: Start the first build with default settings. Once complete, visit `/api/health` to verify a `200` response before logging in.

> 📖 For full step-by-step instructions and configuration details, see the [Online Deployment Guide](docs/deploy-cloudflare-button.md).

## Multi-Account Login

Once deployed, a single instance supports multi-account login.

The instance administrator can create, disable, or reset member accounts in **Profile** -> **User accounts**. Each member gets a fully isolated personal workspace, including notebooks, notes, attachments, Trash, import/export, and MCP tokens.


## PWA Installation

EdgeEver can be installed as a PWA on desktop or mobile home screens. On desktop, open the site in Chrome or Edge and use the install icon in the address bar. On Android, open it in Chrome, use the three-dot menu, and choose **Add to Home screen** or **Install**. Avoid installing from embedded browsers such as WeChat.

> Common pitfall: When installing the PWA on mobile, Chrome or Edge is recommended. Other mobile browsers may encounter compatibility issues or unexpected errors during installation.

## Chrome/Edge Web Clipper

The Chrome/Edge web clipper is officially published. You can install it directly from the link below (Microsoft Edge users can also install directly from the Chrome Web Store):

- [Chrome Web Store Link](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)

## Native Clients

The initial app version is complete and currently under store review.

The desktop app remains on the roadmap and is planned to use Tauri.

## Tech Stack

- Bun workspace monorepo with Web, API, official site, and shared type package.
- Official site: Astro static site in `apps/site`, deployable to Cloudflare Pages.
- Frontend: Vite, React, React Router, TanStack Query, Tailwind CSS, shadcn/ui, and Radix UI.
- Editor: TipTap / ProseMirror with Markdown support; PWA uses vite-plugin-pwa, Workbox, and Dexie.
- Mobile app: Expo + React Native, with SQLite local storage and incremental sync.
- Web clipper: Manifest V3, Mozilla Readability, and Turndown for Chrome and Microsoft Edge.
- Backend: Cloudflare Workers, Hono, Zod, D1, and R2, with REST API, OpenAPI, and Remote MCP.

## Quick Start

Install dependencies:

```sh
bun install
```

Apply local D1 migrations:

```sh
bun run db:migrate:local
```

Start the default development environment. It applies pending local migrations and initializes local D1/R2 stores once with the repository's fixed demo seed. Existing local changes are preserved on later restarts, and no remote instance is contacted.

```sh
bun run dev
```

To intentionally develop against a configured remote instance, select it explicitly:

```sh
EDGE_EVER_INSTANCE=<name> bun run dev:remote
```

Checks:

```sh
bun run typecheck
bun run build
```

## Project Structure

```text
apps/web          Vite + React frontend, PWA, offline drafts, and sync queue
apps/extension    Chrome/Edge Manifest V3 web clipper
apps/api          Cloudflare Worker + Hono API, OpenAPI, MCP endpoint
apps/mobile       Expo + React Native mobile app
apps/site         Astro official website, deployable independently
packages/client   Shared API client for web and mobile apps
packages/shared   Shared types, Zod schemas, TipTap / Markdown conversion
scripts           Wrangler wrapper, password hash, CLI, MCP stdio bridge, Evernote ENEX import
migrations        D1 database migrations
docs              OpenAPI schema, migration guides, and deployment docs
wrangler.toml     Cloudflare Workers, Assets, D1, R2 configuration
```

## Content Formats

EdgeEver stores note content in three forms:

```text
content_json      TipTap/ProseMirror document, the editor source of truth
content_markdown  API, Agent, import, and export format
content_text      Search, summary, and indexing text
```

Open **Profile** -> **Import and export** to export or import an EdgeEver ZIP. Its `notes/` directory is directly readable and portable as Markdown, while its structured data supports complete recovery between EdgeEver instances. Import preserves unrelated target data and overwrites records with matching EdgeEver IDs.

## API

OpenAPI schema:

```text
https://your-domain/api/openapi.json
```

Repository file: [docs/openapi.json](docs/openapi.json).

## MCP

Create an API token in **Profile** -> **MCP settings**, then copy either the token or full MCP configuration into your AI Agent so it can install the MCP server and read or organize notes with permission.

With MCP, EdgeEver can also connect to tools such as Notion databases and Feishu Bitable, turning scattered ideas, information, and materials from everyday notes into structured data that is easier to organize, search, and manage.

## Image Compression

Image compression happens in the Web client before upload and is controlled by the **Compress note images** setting. When enabled, PNG, JPEG, WebP, and AVIF files are converted to WebP when beneficial, with the longest edge limited to `2560px`. If compression does not reduce size, the original file is kept.

EdgeEver avoids Worker-side image processing to reduce compute and image-processing quota usage. REST API and MCP upload paths store the file content provided by the client without additional server-side compression.

## Migration

If you want to migrate notes from other platforms to EdgeEver, please refer to the following simple migration guides:

- **Evernote Migration**: Please refer to [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **Memos Migration**: Please refer to [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion Migration**: Please refer to [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## Community and Feedback

- Bugs, feature requests, and deployment issues: [GitHub Issues](https://github.com/tianma-if/edgeever/issues)

## Docker Deployment Roadmap

> 🐳 Docker-based self-hosting for VPS, NAS, and home servers is on the roadmap and will follow once the core features are stable. It is not yet available in current releases.

## Acknowledgements

- The visual design of the editor themes is inspired by [gzh-design-skill](https://github.com/isjiamu/gzh-design-skill), whose themes were originally created by Jiamu (甲木) × Moyu Xiaoli (摸鱼小李). Thanks for their open-source work.

## Disclaimer

EdgeEver is an independent open-source note-taking application developed and maintained by individuals and the community. It is not affiliated with, authorized, sponsored, or endorsed by Evernote Corporation or its affiliates.
