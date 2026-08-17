# EdgeEver

[![GitHub Stars](https://img.shields.io/github/stars/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/network/members)

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

The public demo resets every day at 3:00 AM (China Standard Time) and restores sample notes. Do not store private content there.

## Features

- **Zero Server, Zero Ops, Truly Free**: Powered by Cloudflare Serverless. No cloud servers to rent or maintain. Free tiers easily accommodate up to 150k notes and 50k images with blazing-fast global edge delivery.
- **Open Data, No Vendor Lock-in**: Built on standard SQLite with complete REST API, MCP, and CLI access. Your knowledge is stored transparently and accessible anytime without being locked to a single app.
- **Lossless ZIP Backup & Portability**: Export your complete library as a clean archive containing Markdown, Front Matter, nested folders, relative attachment links, and version histories for instant restoration anywhere.
- **Native AI Agent Synergy**: Deep integration with Model Context Protocol (MCP) allows AI tools like Claude Code, Codex, and Antigravity to read, organize, and summarize your notes, or sync seamlessly with Notion and Feishu Bitable.
- **Bring Your Own AI Models**: Connect OpenAI, Anthropic, or Gemini-compatible services and third-party API relays to empower your editor with smart note summarization, key point extraction, proofreading, translation, and text continuation on full notes or selected text.
- **Unlimited Multi-Device Sync**: No commercial device caps or paywalls. Enjoy seamless synchronization across PC, tablet, and mobile via web, PWA, or browser.
- **Classic Three-Pane Layout & Focus Mode**: Clean navigation featuring notebook trees, note lists, and an expansive editor, with a desktop focus mode to eliminate distractions.
- **Unlimited Nested Notebooks**: Organize your knowledge with arbitrary folder depth.
- **One-Click Rich Copy for Newsletters & Blogs**: Designed for creators to convert notes into beautifully formatted rich text with inline CSS, ready to paste directly into Substack, Medium, WordPress, or newsletter editors without extra tools.
- **Seamless Dual-View Editor**: Switch effortlessly between intuitive rich text editing and Markdown source code on desktop.
- **Convenient Single-Note Export**: Export the current note directly as Markdown, HTML, or PDF for standalone storage, sharing, or publishing.
- **Native Mermaid Diagram Rendering**: Render clear flowcharts, sequence diagrams, and mind maps directly in notes, preserving clean, editable source code across Markdown and rich text views.
- **Revision History**: Inspect and restore previous iterations of your notes with built-in version tracking.
- **Public Note Sharing**: Share a note publicly and stop sharing it at any time.
- **WeChat Article Clipping on Mobile**: Share a WeChat Official Account article to EdgeEver on your phone to extract its content and save it as an editable note.
- **Smart Local Image Compression**: Client-side WebP compression reduces file sizes by 50%-90% before uploading, saving storage and speeding up page loads without extra server costs.
- **Universal File Attachments**: Attach and preview PDFs, Office documents, zip files, audio, and video directly within notes.
- **Batch Operations & Flexible Sorting**: Easily merge or relocate multiple notes, with drag-and-drop notebook reordering.
- **Offline Drafts & Queueing**: Draft and edit uninterrupted while offline; changes automatically sync once reconnected.
- **Multi-Tenant Account Isolation**: Host multiple user accounts on a single instance with strictly partitioned spaces and clean admin account management.
- **Everywhere You Need It**: Available on the Web, [Android](https://play.google.com/store/apps/details?id=org.edgeever.mobile), and [macOS](https://github.com/tianma-if/edgeever/releases), with the iOS app under App Store review and Windows coming soon; the Web Clipper supports [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo), [Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo), and [Firefox](https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/).

## Deployment

EdgeEver uses a pure Serverless architecture that runs entirely within Cloudflare's free tiers. **No VPS or server rental is required, and there is no need to configure Docker or SSL certificates.**

You can deploy online using either of the following two options:

### Option A: Deploy with an AI Agent (Recommended)

Copy the prompt below directly into an AI Agent (such as Codex, Claude, Cursor, workbuddy, Antigravity, OpenClaw, Hermes Agent, etc.). During execution, if access to GitHub or Cloudflare is required, review the requested permissions and follow the prompts to authorize access.

```text
Deploy EdgeEver online:
1. Fork https://github.com/tianma-if/edgeever.
2. Import the Fork into Cloudflare Workers & Pages.
3. Configure D1, R2, `EDGE_EVER_AUTH_USERNAME` (prefilled as `admin`, customizable),
   the `EDGE_EVER_AUTH_PASSWORD` Worker Secret, and the production `main` build.
4. Start the first build and verify `/api/health`, `/api/openapi.json`, and login.
5. Enable and manually run the GitHub Actions workflow named `Update deployed EdgeEver`
   once so the Fork can automatically receive the latest EdgeEver features and fixes.
```

> Detailed requirements: [AI Agent Cloudflare Deployment](docs/agent-deploy-cloudflare.md).

### Option B: Manual Online Deployment

Complete setup in 5 simple web steps:

1. **Fork the Repository**: Click **Fork** at the top right of GitHub to fork EdgeEver into your personal account.
2. **Enable Actions**: Open the Fork's **Actions** tab and click **I understand my workflows, go ahead and enable them** so the GitHub Actions workflow named **Update deployed EdgeEver** can run automatically, keeping you up to date with the latest **EdgeEver** features and fixes.
3. **Import into Cloudflare**: Log into the Cloudflare Dashboard, navigate to **Workers & Pages**, and choose to import your Fork repository.
4. **Bind Resources & Credentials**: Bind the D1 database (`DB`), R2 bucket (`RESOURCES`), set `EDGE_EVER_AUTH_USERNAME` (default `admin`, customizable), and set the Worker Secret `EDGE_EVER_AUTH_PASSWORD` as your admin password.
5. **Build & Verify**: Start the first build with default settings. Once complete, visit `/api/health` to verify a `200` response before logging in.

> 📖 For full step-by-step instructions and configuration details, see the [Online Deployment Guide](docs/deploy-cloudflare-button.md).

---

> 💡 **Deployment Tip (Cloudflare R2 Billing)**: Although Cloudflare R2 offers a generous [free storage allowance](https://developers.cloudflare.com/r2/pricing/#free-tier) that note-taking workloads are unlikely to ever exceed, you must first activate an R2 subscription and add a payment method. Cloudflare [officially supports](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) UnionPay, Visa, Mastercard, and other cards, as well as PayPal, Apple Pay, Google Pay, and other payment methods.

## Multi-Account Login

Once deployed, a single instance supports multi-account login.

The instance administrator can create, disable, or reset member accounts in **Profile** -> **User accounts**. Each member gets a fully isolated personal workspace, including notebooks, notes, attachments, Trash, import/export, and MCP tokens.

## Browser Web Clipper

The Web Clipper is officially published for Chrome, Microsoft Edge, and Firefox. Install it from the store for your browser (Microsoft Edge users can install the Chrome Web Store version directly):

- [Chrome Web Store Link](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo)
- [Firefox Add-ons Link](https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/)

Developers can also use the [extension development guide](apps/extension/README.md) to build and load the extension from source.

## Native Clients

Native clients offer a smoother, more reliable experience with deeper system integration, local storage, and offline editing. Changes sync incrementally when connectivity returns, making them ideal for frequent use and unreliable network conditions.

The Android app is now available on [Google Play](https://play.google.com/store/apps/details?id=org.edgeever.mobile), with signed APKs also available from [GitHub Releases](https://github.com/tianma-if/edgeever/releases). The iOS client is a native SwiftUI app in `apps/ios` and has been submitted for App Store review.

The macOS app is available from [GitHub Releases](https://github.com/tianma-if/edgeever/releases). The Windows version will be released once the code-signing certificate issue is resolved.

On platforms without a native client, EdgeEver can be installed as a PWA using Chrome or Edge.

## Community and Feedback

- Bugs, feature requests, and deployment issues: [GitHub Issues](https://github.com/tianma-if/edgeever/issues)

### WeChat Community Group

Welcome to the EdgeEver AI community group, home to many Vibe Coding builders and AI enthusiasts. Join us to discuss the EdgeEver experience, real-world AI Agent applications, cost-effective or free AI resources, and automation workflows.

> The group QR code is valid for 7 days. If it has expired, add WeChat `m1245207870` and include “EdgeEver group” in your request.

<p align="center">
  <img src="assets/wechat-group-qr.jpg" alt="EdgeEver AI community group QR code" width="260" />
</p>

## Tech Stack

- Bun workspace monorepo with Web, API, official site, and shared type package.
- Official site: Astro static site in `apps/site`, deployable to Cloudflare Pages.
- Frontend: Vite, React, React Router, TanStack Query, Tailwind CSS, shadcn/ui, and Radix UI.
- Editor: TipTap / ProseMirror with Markdown support; PWA uses vite-plugin-pwa, Workbox, and Dexie.
- Android app: Expo + React Native in `apps/mobile`, with SQLite local storage and incremental sync.
- iOS app: Native SwiftUI in `apps/ios` (iOS 17+), with a packaged TipTap EditorBundle, GRDB local mirror/outbox, and Android-aligned shell chrome.
- Native desktop app: Electron + Rust sidecar combines a consistent cross-platform experience with high-performance local data services; SQLite enables offline editing, incremental sync when back online, and local backups.
- Web clipper: Manifest V3, Mozilla Readability, and Turndown for Chrome, Microsoft Edge, and Firefox.
- Backend: Cloudflare Workers, Hono, Zod, D1, and R2, with REST API, OpenAPI, and Remote MCP.

## Quick Start

```sh
bun install
bun run dev
```

## Project Structure

```text
apps/web          Vite + React frontend, PWA, offline drafts, and sync queue
apps/extension    Chrome/Edge/Firefox Manifest V3 web clipper
apps/api          Cloudflare Worker + Hono API, OpenAPI, MCP endpoint
apps/mobile       Expo + React Native Android app
apps/ios          Native SwiftUI iOS app (TipTap EditorBundle, GRDB)
apps/desktop      Electron desktop shell, preload bridge, and native packaging
apps/site         Astro official website, deployable independently
packages/client   Shared API client for web and mobile apps
packages/shared   Shared types, Zod schemas, TipTap / Markdown conversion
crates/desktop-sidecar
                   Rust sidecar for local SQLite, offline data, backups, and resources
scripts           Wrangler wrapper, password hash, CLI, MCP stdio bridge, Evernote ENEX import
migrations        D1 database migrations
docs              OpenAPI schema, architecture, migration, and deployment docs
.github/workflows CI for web, mobile, iOS, desktop packaging, deployment, and releases
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

## Plugin Development Preview

The standalone Plugin Marketplace supports trusted client plugins and code-free theme packages installed from its verified index, a public GitHub repository, or a manifest URL. Plugins can query and update notes, work with editor selections, register commands and custom panels, use encrypted secret storage, and make allowlisted network requests. A unified top-right desktop entry includes recently used actions. Cron and background jobs are intentionally deferred. See [Plugin Development](docs/plugin-development.md).

## MCP

Create an API token in **Profile** -> **MCP settings**, then give the token or full MCP configuration to your AI Agent. Once connected, the Agent can securely read, organize, and import notes within your account permissions. MCP also exposes full management of reusable note templates and AI instructions: agents can list, inspect, create, update, and delete both, create a note from a template, and restore missing built-in AI instructions. Template and instruction reads use the `read:memos` scope, while changes use `write:memos`. Repeating the same memo import will not create duplicate notes.

The Remote MCP endpoint supports the stateless `2026-07-28` protocol while retaining the handshake-based 2025 revisions for existing clients.

With MCP, EdgeEver can also connect to tools such as Notion databases and Feishu Bitable, turning scattered ideas, information, and materials from everyday notes into structured data that is easier to organize, search, and manage.

## Bring Your Own AI Models

Open **Profile → AI Integrations** to add one or more OpenAI-compatible, Anthropic Messages, or Google Gemini services with your own Base URLs and API keys. Third-party API relays are also supported. Each service can contain multiple models: discover them from the provider's model-list endpoint or enter a model ID manually. A service-level switch temporarily makes all of its models unavailable, while the workspace default selects the model used for note AI.

Note AI includes six focused built-in prompts across Web, Android, and iOS: summarize, translate, polish, make concise, convert to Xiaohongshu style, and convert to X (Twitter) style. You can add custom prompts for more specialized workflows. Editors on all three platforms can also run AI directly on selected text and replace only that selection. Results stream into a reviewable draft that you can retry, refine with a follow-up instruction, append, or explicitly accept as a replacement. Translation uses a language picker whose default follows the interface language: Chinese defaults to English, while English defaults to Simplified Chinese.

AI requests are sent by the EdgeEver server rather than directly by the browser or native client. Model credentials are isolated by personal workspace and encrypted before being stored. Standard deployments automatically derive an AI-specific encryption key from the existing instance authentication secret, so no additional deployment variable is required. The same AI business code runs in Cloudflare Workers and the planned Docker/Bun runtime.

## Image Compression

Image compression happens in the Web client before upload and is controlled by the **Compress note images** setting. When enabled, PNG, JPEG, WebP, and AVIF files are converted to WebP when beneficial, with the longest edge limited to `2560px`. If compression does not reduce size, the original file is kept.

EdgeEver avoids Worker-side image processing to reduce compute and image-processing quota usage. REST API and MCP upload paths store the file content provided by the client without additional server-side compression.

## Advanced Object Storage

The instance owner can open **Settings → Advanced → OSS object storage** to send new images and attachments to an S3-compatible service such as Alibaba Cloud OSS, Tencent COS, AWS S3, MinIO, or R2. Existing resources stay in their original store, so changing the default does not migrate or break historical attachments.

Before saving third-party object-storage credentials on a Cloudflare deployment, configure the `EDGE_EVER_STORAGE_ENCRYPTION_KEY` Worker Secret with a random value of at least 32 characters. EdgeEver uses this instance-level key to encrypt the access secret stored in D1. Keep the key stable and backed up; changing it makes previously saved object-storage credentials unusable.

## Migration

If you want to migrate notes from other platforms to EdgeEver, please refer to the following simple migration guides:

- **Evernote Migration**: Please refer to [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **flomo Migration**: Please refer to [docs/flomo-migration-guide.md](docs/flomo-migration-guide.md)
- **Memos Migration**: Please refer to [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion Migration**: Please refer to [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## Docker Deployment Roadmap

> 🐳 Docker-based self-hosting for VPS, NAS, and home servers is planned but is not yet a supported release. An experimental Bun runtime is already available for adapter development, with SQLite + local files or S3-compatible storage; PostgreSQL remains reserved at the contract level. See [Self-hosting and Docker architecture](docs/self-hosting-architecture.md).

## Acknowledgements

- The "Minimal Emerald" theme typography layout is inspired by [obsidian-minimal](https://github.com/kepano/obsidian-minimal).
- The "Outline Emerald" theme typography layout is inspired by [Outline](https://github.com/outline/outline).

## Disclaimer

EdgeEver is an independent open-source note-taking application developed and maintained by individuals and the community. It is not affiliated with, authorized, sponsored, or endorsed by Evernote Corporation or its affiliates.
