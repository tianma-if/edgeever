<div align="center">
  <h1>
    <img src="assets/brand/edgeever-icon.svg" alt="EdgeEver logo" width="48" align="absmiddle" /> EdgeEver
  </h1>
  <p>
    <b>An open-source, AI-native knowledge base & portable Evernote alternative</b>
  </p>
  <p>
    <a href="https://github.com/tianma-if/edgeever/stargazers"><img src="https://img.shields.io/github/stars/tianma-if/edgeever?style=social" alt="GitHub Stars" /></a>
    <a href="https://github.com/tianma-if/edgeever/network/members"><img src="https://img.shields.io/github/forks/tianma-if/edgeever?style=social" alt="GitHub Forks" /></a>
    <a href="https://github.com/tianma-if/edgeever/pkgs/container/edgeever"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Ftianma-if%2Fedgeever%2Fedgeever&query=downloadCount&style=social&logo=docker&label=Docker%20Pulls" alt="Docker Pulls" /></a>
    <a href="https://www.producthunt.com/products/edgeever?utm_source=other&utm_medium=social"><img src="https://img.shields.io/badge/Product%20Hunt-ea532a?style=social&logo=product-hunt" alt="Product Hunt" /></a>
    <a href="https://hellogithub.com/repository/tianma-if/edgeever" target="_blank"><img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=150fee4403f6433880bda91e9576ac06&claim_uid=TWNAjisURpnhL1l&theme=small" alt="Featured｜HelloGitHub" /></a>
    <a href="https://afdian.com/a/tianma-if"><img src="https://img.shields.io/badge/Afdian-946ce6?style=social&logo=github-sponsors" alt="Sponsor on Afdian" /></a>
  </p>
  <p>
    <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <b>English</b> | <a href="README.ja.md">日本語</a>
  </p>
  <p>
    <a href="https://t.me/+wwUx1BYLrIdiZjY1">💬 Telegram Group</a> &nbsp;|&nbsp;
    <a href="https://demo.edgeever.org">🌐 Live Demo</a> &nbsp;|&nbsp;
    <a href="#client-downloads">📱 Client Downloads</a>
  </p>
</div>



EdgeEver is a modern, open-source notes and knowledge base workspace. It revives the beloved Evernote-style three-pane layout while offering an open data architecture and seamless AI Agent integration for complete ownership and smart productivity.

> 💡 **Serverless & 100% Free Forever**
> EdgeEver can run within Cloudflare's free quotas with no server purchase or VPS maintenance. Users who prefer a VPS, NAS, or home server can deploy the same application with Docker.

> ⭐ If EdgeEver is useful to you, consider giving it a Star. Your support helps more people discover the project.

## Why EdgeEver

Many long-time **Evernote** users simply want a **reliable, open, and fast** personal knowledge base. However, existing mainstream solutions all present tradeoffs:

* **Evernote**: It has grown increasingly bloated with commercial ads and unnecessary features, degrading performance. Data export is cumbersome, free tiers are heavily restricted, and AI/MCP features require costly subscriptions.
* **Obsidian**: Open files, closed-source core. Official Sync is paid and third-party sync is tedious; relying entirely on flat local file scanning causes noticeable cold-start and search lag once notes reach thousands or heavy plugins are loaded; storing images and attachments alongside notes quickly bloats vaults, making mobile sync sluggish and leaving orphaned files behind; and it is overly heavy for lightweight, capture-anywhere use.
* **Memos & Stream Notes**: Clean and simple, but their social-timeline layouts differ fundamentally from the structured productivity of a classic three-pane workflow.
* **SiYuan & Block-based PKMs**: Powerful with self-hosting support, but their granular "block-level" architecture imposes noticeable cognitive overhead for quick daily capture and continuous prose writing. Furthermore, they lack a true zero-cost serverless deployment tier, and multi-device sync relies on paid official subscriptions or paying extra to unlock S3/WebDAV sync features with your own storage.

**EdgeEver fills this gap**: The entire stack is open source, including sync and self-hosting. It keeps the three-pane layout you know, stays silky-smooth and lightweight even with 10,000+ notes, and ships native AI agents with zero-cost deployment.

> 💡 **Recommended Workflow:**
> Capture inspiration seamlessly across all devices and organize deeply in the classic three-pane view. Powered by native MCP and ACP, external agents can retrieve and organize your notes seamlessly, while the desktop app lets you collaborate deeply with local AI agents on your machine. Publish anywhere with one-click formatting—100% self-hosted at zero cost, building an open and truly owned second brain.

## Online Demo

- Demo: [https://demo.edgeever.org](https://demo.edgeever.org)

The public demo resets every day at 3:00 AM (China Standard Time) and restores sample notes. Do not store private content there.

## Client Downloads

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/macos.svg" alt="Download EdgeEver for macOS" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/windows.svg" alt="Download EdgeEver for Windows" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="assets/readme/platforms/tux.svg" alt="Download the EdgeEver Linux x86_64 AppImage Preview" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile"><img src="assets/readme/platforms/google-play.svg" alt="Download EdgeEver for Android from Google Play" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/us/app/edgeever/id6792625631"><img src="assets/readme/platforms/app-store.svg" alt="Download EdgeEver for iOS from the App Store" width="40" height="40" /></a>
</p>

> The iOS app requires an Apple ID from outside mainland China.

## Features

- **Deploy Your Way**: Run on Cloudflare's free serverless platform or with Docker on a VPS, NAS, or home server. Based on Cloudflare's free storage allowances, a personal deployment can hold roughly 150,000 short notes and 50,000 images; Docker storage scales on demand to easily support millions of notes and a vast image library.
- **Open Data, No Vendor Lock-in**: Built on standard SQLite with complete REST API, MCP, and CLI access. Your knowledge is stored transparently and accessible anytime without being locked to a single app.
- **Lossless ZIP Backup & Portability**: Export your complete library as a clean archive containing Markdown, Front Matter, nested folders, relative attachment links, and version histories for instant restoration anywhere.
- **Native AI Agent Synergy**: Built-in Model Context Protocol (MCP) support allows external AI Agents to directly read, organize, and summarize notes; the desktop app also connects directly to local AI Agents running on your machine (such as Codex, Antigravity, Claude Code, and WorkBuddy) via Agent Client Protocol (ACP) for collaborative writing.
- **Bring Your Own AI Models**: Connect OpenAI, Anthropic, or Gemini-compatible services and third-party API relays to power the built-in Agent and companion sidebar, bringing smart note summarization, key point extraction, proofreading, translation, and text continuation to full notes or selected text.
- **Rich Plugin API**: Extend EdgeEver with the [Plugin API](docs/plugin-development.md).
- **Unlimited Multi-Device Sync**: No commercial device caps or paywalls. Enjoy seamless synchronization across PC, tablet, and mobile via web, PWA, or browser.
- **Classic Three-Pane Layout & Focus Mode**: Clean navigation featuring notebook trees, note lists, and an expansive editor, with a desktop focus mode to eliminate distractions.
- **Light, Lasting Desktop Performance**: Switching notes does not keep old images and documents in memory, and the desktop app stays responsive after sitting in the background.
- **Unlimited Nested Notebooks**: Organize your knowledge with arbitrary folder depth.
- **One-Click Rich Copy for Newsletters & Blogs**: Designed for creators to convert notes into beautifully formatted rich text with inline CSS, ready to paste directly into Substack, Medium, WordPress, or newsletter editors without extra tools.
- **Seamless Dual-View Editor**: Switch effortlessly between intuitive rich text editing and Markdown source code on desktop.
- **Convenient Single-Note Export**: Export the current note directly as Markdown, HTML, or PDF for standalone storage, sharing, or publishing.
- **Native Mermaid Diagram Rendering**: Render clear flowcharts, sequence diagrams, and mind maps directly in notes, preserving clean, editable source code across Markdown and rich text views.
- **Visual Diagram Notes**: Ditch external drawing tools and sketch mind maps, flowcharts, and architecture diagrams directly in notes. Backed by a structured IR, the built-in assistant and external AI agents can generate and refine diagrams from a single prompt, complete with smart auto-layout, cross-device sync, and vector export. See the [visual diagram notes design](docs/visual-diagram-notes.md).
- **Revision History**: Inspect and restore previous iterations of your notes with built-in version tracking.
- **Public Note Sharing**: Share a note publicly and stop sharing it at any time. Optionally protect the link with an auto-generated access password.
- **WeChat Article Clipping on Mobile**: Share a WeChat Official Account article to EdgeEver on your phone to extract its content and save it as an editable note.
- **Smart Local Image Compression**: Client-side WebP compression reduces file sizes by 50%-90% before uploading, saving storage and speeding up page loads without extra server costs.
- **Universal File Attachments**: Attach and preview PDFs, Office documents, zip files, audio, and video directly within notes. Chunked uploads and streaming safely support files up to 1 GiB.
- **Batch Operations & Flexible Sorting**: Easily merge or relocate multiple notes, with drag-and-drop notebook reordering.
- **Offline Drafts & Queueing**: Draft and edit uninterrupted while offline; changes automatically sync once reconnected.
- **Brute-Force Login Protection**: Server-side account- and IP-based failed-login throttling with automatic cooldowns helps protect private notes against brute-force and password-spraying attacks.
- **Multi-Tenant Account Isolation**: Host multiple user accounts on a single instance with strictly partitioned spaces and clean admin account management.
- **Everywhere You Need It**: Available on the Web, [Android](https://play.google.com/store/apps/details?id=org.edgeever.mobile), [macOS](https://github.com/tianma-if/edgeever/releases), [Windows](https://github.com/tianma-if/edgeever/releases/latest), [Linux](https://github.com/tianma-if/edgeever/releases/latest), and [iOS](https://apps.apple.com/us/app/edgeever/id6792625631); the Web Clipper supports [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo), [Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo), and [Firefox](https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/).

## Deployment

Cloudflare is the recommended zero-server deployment. Docker is available for users who prefer a VPS, NAS, or home server.

For Cloudflare, choose either of the following online deployment options:

### Option A: Deploy with an AI Agent (Recommended)

Copy the prompt below directly into an AI Agent (such as Codex, Claude, Cursor, WorkBuddy, Antigravity, OpenClaw, Hermes Agent, etc.). During execution, if access to GitHub or Cloudflare is required, review the requested permissions and follow the prompts to authorize access.

```text
Deploy EdgeEver entirely through GitHub and Cloudflare:
1. Fork https://github.com/tianma-if/edgeever.
2. Create D1 `edgeever` and R2 `edgeever-resources` in Cloudflare.
3. In Workers & Pages, create a Worker named `edgeever` from the Fork's `main` branch.
   Use the repository root, keep Cloudflare's default Workers Builds deploy command,
   and ensure its API token can read and edit D1. Select Save and Deploy.
4. After the Worker is created, add the user's chosen password as the runtime Secret
   `EDGE_EVER_AUTH_PASSWORD` (preferably at least 32 characters).
   The username defaults to `admin`.
   If the user specifies another, set `EDGE_EVER_AUTH_USERNAME` as a Workers Builds
   variable before the next build.
5. Run the build again, verify `/api/health` and `/api/openapi.json`, then log in
   with that administrator username and password.
6. Enable and manually run the GitHub Actions workflow named `Update deployed EdgeEver`
   once so the Fork can automatically receive future stable releases and fixes.
```

> Detailed requirements: [AI Agent Cloudflare Deployment](docs/agent-deploy-cloudflare.md).

### Option B: Manual Online Deployment

Complete setup in 6 web steps:

1. **Fork the Repository**: Click **Fork** at the top right of GitHub to fork EdgeEver into your personal account.
2. **Create Cloudflare Resources**: Create D1 `edgeever` and R2 `edgeever-resources`.
3. **Import & Configure the Project**: Create a Worker named `edgeever` from the Fork's `main` branch in Cloudflare **Workers & Pages**. Use the repository root and keep Cloudflare's default Workers Builds deploy command, which runs in Cloudflare. Ensure its API token can read and edit D1. The deploy command creates the bindings; do not edit Fork files.
4. **Choose the Administrator Password**: Choose an administrator password, preferably at least 32 characters. Once the Worker is created, save it as the runtime Secret `EDGE_EVER_AUTH_PASSWORD`.
5. **Build & Verify**: Save and Deploy creates the Worker and starts a build. If it fails because the administrator Secret is missing, add the runtime Secret from step 4 and retry. The username defaults to `admin`; to use another, set the `EDGE_EVER_AUTH_USERNAME` Workers Builds variable before retrying. Once deployed, confirm `/api/health` returns `200`, then log in with the configured username and password.
6. **Enable Automatic Updates**: Open the Fork's **Actions** tab, click **I understand my workflows, go ahead and enable them**, then manually run **Update deployed EdgeEver** once so the Fork can automatically receive future stable releases and fixes.

> 📖 For full step-by-step instructions and configuration details, see the [Online Deployment Guide](docs/deploy-cloudflare-button.md).

> 💡 **Custom Domain & Access**: After deployment, you can directly use the default `*.workers.dev` domain assigned by Cloudflare, or attach your own custom domain in the Worker settings under **Settings → Domains & Routes**.

> 💡 **Cloudflare R2 Activation**: Although Cloudflare R2 offers a generous [free storage allowance](https://developers.cloudflare.com/r2/pricing/#free-tier) that note-taking workloads remain completely within, you must first activate an R2 subscription and add a payment method. Cloudflare [officially supports](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) UnionPay, Visa, Mastercard, and other cards, as well as PayPal, Apple Pay, Google Pay, and other payment methods.

### Option C: Docker on a VPS or NAS

Use the GitHub-hosted installer and the official GHCR image:

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

The command pulls the latest image, generates an administrator password, and starts EdgeEver with Docker Compose.

See the [Docker deployment guide](docs/deploy-docker.md) for manual deployment and configuration.

After installation, updates run automatically each day by default. To update manually, run `~/edgeever/update.sh` on the deployment server.

---

## Multi-Account Login

Once deployed, a single instance supports multi-account login.

The instance administrator can create, disable, or reset member accounts in **Profile** -> **User accounts**. Each member gets a fully isolated personal workspace, including notebooks, notes, attachments, Trash, import/export, and MCP tokens.

## Browser Web Clipper

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="Install EdgeEver Web Clipper for Google Chrome" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="Install EdgeEver Web Clipper for Microsoft Edge" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="Install EdgeEver Web Clipper for Firefox" width="36" height="36" /></a>
</p>

- **Smart Article Extraction**: Automatically extracts article content and converts it into clean Markdown, preserving the source URL and clipping timestamp.
- **Selection & Context Menu Clipping**: Save selected text or right-clicked images directly as notes without capturing the entire page.
- **Deep Social & Community Clipping**: Native support for X (Twitter), Xiaohongshu, Zhihu, Reddit, and GitHub with one-click sending.
- **Private Self-Hosted Direct Connection**: Sends clipped content directly to your personal EdgeEver instance without third-party relays.

## Community and Feedback

- Bugs, feature requests, and deployment issues: [GitHub Issues](https://github.com/tianma-if/edgeever/issues)
- Code contributions: read the [Contribution Guide](CONTRIBUTING.md). If your Fork is also used to deploy EdgeEver, keep its `main` branch deployment-only. Create a separate branch from the official `upstream/main` for synchronization, development, and pull requests; do not develop on or Sync fork the deployment `main`.

### Telegram Community

Welcome to the EdgeEver community. Join us to discuss the EdgeEver experience, real-world AI Agent applications, cost-effective or free AI resources, and automation workflows.

👉 [Join the EdgeEver Telegram group](https://t.me/+wwUx1BYLrIdiZjY1)

## Plugins and Themes

Web and desktop apps support functional plugins and custom themes, installable from the official marketplace, GitHub, or a Manifest URL, with seamless sync across your workspace. Developers can extend capabilities using `@edgeever/plugin-api`; see the [plugin development guide](docs/plugin-development.md) and [marketplace submission policy](docs/plugin-marketplace-policy.md).

## Tech Stack

- Bun workspace monorepo with Web, API, official site, and shared type package.
- Frontend: Vite, React, React Router, TanStack Query, Tailwind CSS, shadcn/ui, and Radix UI.
- Editor: TipTap / ProseMirror with Markdown support; PWA uses vite-plugin-pwa, Workbox, and Dexie.
- Android app: Expo + React Native in `apps/mobile`, with SQLite local storage and incremental sync.
- iOS app: Native SwiftUI in `apps/ios` (iOS 17+), with a packaged TipTap EditorBundle, GRDB local mirror/outbox, and Android-aligned shell chrome.
- Native desktop app: Electron + Rust sidecar combines a consistent cross-platform experience with high-performance local data services; SQLite enables offline editing, incremental sync when back online, and local backups.
- Web clipper: Manifest V3, Mozilla Readability, and Turndown for Chrome, Microsoft Edge, and Firefox.
- Backend: one Hono/Zod business application with REST API and Remote MCP; Cloudflare uses Workers/D1/R2, while Docker uses Bun/SQLite/local files or S3.
- Official site: Astro static site in `apps/site`, deployable to Cloudflare Pages.

## Quick Start

```sh
bun install
bun run dev
```

Local development signs in automatically; fresh databases use `owner` / `edgeever-local-dev`. Log out to test the login screen.

## Project Structure

```text
apps/web          Vite + React frontend, PWA, offline drafts, and sync queue
apps/extension    Chrome/Edge/Firefox Manifest V3 web clipper
apps/api          Cloudflare Worker + Hono API, MCP endpoint
apps/mobile       Expo + React Native Android app
apps/ios          Native SwiftUI iOS app (TipTap EditorBundle, GRDB)
apps/desktop      Electron desktop shell, preload bridge, and native packaging
apps/site         Astro official website, deployable independently
packages/client   Shared API client for web and mobile apps
packages/shared   Shared types, Zod schemas, TipTap / Markdown conversion
crates/desktop-sidecar
                   Rust sidecar for local SQLite, offline data, backups, and resources
scripts           Wrangler wrapper, password hash, CLI, MCP stdio bridge, Evernote ENEX import
migrations        Shared append-only D1/SQLite database migrations
docs              Architecture, migration, and deployment docs
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

## MCP

Create an API token in **Profile** -> **API / MCP** and copy the Remote MCP configuration in one click to let AI Agents such as Claude Code, Cursor, Antigravity, and OpenClaw securely manage your knowledge base within account permissions. EdgeEver supports full CRUD for text notes, visual diagram notes (mind maps, flowcharts, and architecture diagrams), and structured table notes. Agents can also manage notebook hierarchies, tags, attachments, revision history, note templates, and AI instructions.

> 💡 **Inspiration:**
> Make AI your true knowledge orchestrator and creative co-pilot—instantly turn concepts into interactive mind maps, flowcharts, architecture diagrams, and structured tables, while supplying private context to your AI Agents. Paired with EdgeEver’s powerful rich-text editing and elegant typography, AI-assisted content becomes beautifully structured, polished, and publication-ready knowledge assets.

## Image Compression

Image compression happens in the Web client before upload and is controlled by the **Compress note images** setting. When enabled, PNG, JPEG, WebP, and AVIF files are converted to WebP when beneficial, with the longest edge limited to `2560px`. If compression does not reduce size, the original file is kept.

EdgeEver avoids Worker-side image processing to reduce compute and image-processing quota usage. REST API and MCP upload paths store the file content provided by the client without additional server-side compression.

## Advanced Object Storage

The instance owner can configure S3-compatible object storage under **Settings → Advanced → OSS object storage**. Changing storage does not migrate or affect existing attachments.

## Migration

If you want to migrate notes from other platforms to EdgeEver, please refer to the following simple migration guides:

- **Evernote Migration**: Please refer to [docs/evernote-migration-guide.md](docs/evernote-migration-guide.md)
- **flomo Migration**: Please refer to [docs/flomo-migration-guide.md](docs/flomo-migration-guide.md)
- **Memos Migration**: Please refer to [docs/memos-migration-guide.md](docs/memos-migration-guide.md)
- **Notion Migration**: Please refer to [docs/notion-migration-guide.md](docs/notion-migration-guide.md)

## Docker Deployment

Docker runs the same frontend, API routes, services, authentication, MCP implementation, and migrations as Cloudflare. The container uses SQLite with local files or S3-compatible attachment storage and supports `amd64` and `arm64`. See [Deploy EdgeEver with Docker](docs/deploy-docker.md) and [Self-hosting and Docker architecture](docs/self-hosting-architecture.md).

## Sync Timing

Web, PWA, and desktop upload memo edits after 30 seconds of inactivity and check for remote changes every 5 minutes while visible; focus and manual refresh remain immediate. Adjust `DEFERRED_MEMO_SYNC_DELAY_MS` and `BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS` in [`apps/web/src/lib/workspace-refresh.ts`](apps/web/src/lib/workspace-refresh.ts).

## Acknowledgements

- EdgeEver's note-taking product design was also informed by the publicly available product experiences of mature note-taking tools such as [Evernote](https://evernote.com/) and [Notion](https://www.notion.com/). The related features were independently designed and implemented by EdgeEver.
- The product design of mind-map and visual-diagram notes was informed by the publicly available product experiences of [XMind](https://xmind.com/) and [ProcessOn](https://www.processon.com/). These features were independently designed and implemented by EdgeEver.

## Trademark and Brand Use

The EdgeEver name, logo, and other brand identifiers distinguish the official project. Forks and modified versions may state that they are based on EdgeEver, but must not imply official status or mislead users. The open-source license does not grant trademark rights; other uses require prior written permission from the project maintainers.

## Disclaimer

EdgeEver is an independent open-source note-taking application developed and maintained by individuals and the community. It is not affiliated with, authorized, sponsored, or endorsed by Evernote Corporation or its affiliates.

EdgeEver is self-hosted software. Except for official demo instances, project maintainers do not host, control, or review user content. Content stored or displayed by an instance is the responsibility of its users or operators and does not represent the maintainers' views.
