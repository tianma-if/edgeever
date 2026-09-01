<h1><img src="assets/brand/edgeever-icon.svg" alt="EdgeEver logo" width="40" align="absmiddle" /> EdgeEver</h1>

[![GitHub Stars](https://img.shields.io/github/stars/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/tianma-if/edgeever?style=social)](https://github.com/tianma-if/edgeever/network/members)

[简体中文](README.zh-CN.md) | English

> **EdgeEver: An open-source, AI-native, and portable self-hosted Evernote alternative.**

EdgeEver is a modern, open-source notes workspace built for effortless knowledge management. It revives the beloved Evernote-style three-pane layout while offering an open data architecture and seamless AI Agent integration for complete ownership and smart productivity.

> 💡 **Serverless & 100% Free Forever**
> EdgeEver can run within Cloudflare's free quotas with no server purchase or VPS maintenance. Users who prefer a VPS, NAS, or home server can deploy the same application with Docker.

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

- **Deploy Your Way**: Run on Cloudflare's free serverless platform or with Docker on a VPS, NAS, or home server. Based on Cloudflare's free storage allowances, a personal deployment can hold roughly 150,000 short notes and 50,000 images; Docker storage scales on demand to easily support millions of notes and a vast image library.
- **Open Data, No Vendor Lock-in**: Built on standard SQLite with complete REST API, MCP, and CLI access. Your knowledge is stored transparently and accessible anytime without being locked to a single app.
- **Lossless ZIP Backup & Portability**: Export your complete library as a clean archive containing Markdown, Front Matter, nested folders, relative attachment links, and version histories for instant restoration anywhere.
- **Native AI Agent Synergy**: Deep integration with Model Context Protocol (MCP) allows AI tools like Claude Code, Codex, and Antigravity to read, organize, and summarize your notes, or sync seamlessly with Notion and Feishu Bitable.
- **Bring Your Own AI Models**: Connect OpenAI, Anthropic, or Gemini-compatible services and third-party API relays to empower your editor with smart note summarization, key point extraction, proofreading, translation, and text continuation on full notes or selected text.
- **Plugin Extensibility**: Install client plugins and themes from the Plugin Marketplace to extend note actions, editor commands, custom panels, and more.
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
- **Universal File Attachments**: Attach and preview PDFs, Office documents, zip files, audio, and video directly within notes. Chunked uploads and streaming safely support files up to 1 GiB.
- **Batch Operations & Flexible Sorting**: Easily merge or relocate multiple notes, with drag-and-drop notebook reordering.
- **Offline Drafts & Queueing**: Draft and edit uninterrupted while offline; changes automatically sync once reconnected.
- **Brute-Force Login Protection**: Server-side account- and IP-based failed-login throttling with automatic cooldowns helps protect private notes against brute-force and password-spraying attacks.
- **Multi-Tenant Account Isolation**: Host multiple user accounts on a single instance with strictly partitioned spaces and clean admin account management.
- **Everywhere You Need It**: Available on the Web, [Android](https://play.google.com/store/apps/details?id=org.edgeever.mobile), [macOS](https://github.com/tianma-if/edgeever/releases), [Windows](https://github.com/tianma-if/edgeever/releases/latest), and [iOS](https://apps.apple.com/us/app/edgeever/id6792625631); the Web Clipper supports [Chrome](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo), [Edge](https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo), and [Firefox](https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/).

## Deployment

Cloudflare is the recommended zero-server deployment. Docker is available for users who prefer a VPS, NAS, or home server.

For Cloudflare, choose either of the following online deployment options:

### Option A: Deploy with an AI Agent (Recommended)

Copy the prompt below directly into an AI Agent (such as Codex, Claude, Cursor, workbuddy, Antigravity, OpenClaw, Hermes Agent, etc.). During execution, if access to GitHub or Cloudflare is required, review the requested permissions and follow the prompts to authorize access.

```text
Deploy EdgeEver online:
1. Fork https://github.com/tianma-if/edgeever.
2. Create D1 `edgeever` and R2 `edgeever-resources` in Cloudflare.
3. Import the Fork into Cloudflare Workers & Pages and use `main` as the production
   branch.
4. Add a Worker Secret named `EDGE_EVER_AUTH_PASSWORD`, using a password chosen by the
   user as its value. Prefer a strong password of at least 32 characters that is unique
   to this instance.
5. Start the first build, verify `/api/health` and `/api/openapi.json`, then verify login
   with username `admin` and the configured password.
6. Enable and manually run the GitHub Actions workflow named `Update deployed EdgeEver`
   once so the Fork can automatically receive the latest EdgeEver features and fixes.
```

> Detailed requirements: [AI Agent Cloudflare Deployment](docs/agent-deploy-cloudflare.md).

### Option B: Manual Online Deployment

Complete setup in 6 web steps:

1. **Fork the Repository**: Click **Fork** at the top right of GitHub to fork EdgeEver into your personal account.
2. **Create Cloudflare Resources**: Create D1 `edgeever` and R2 `edgeever-resources`.
3. **Import & Configure the Project**: Import the Fork into Cloudflare **Workers & Pages** and use `main` as the production branch. The deploy command creates the bindings; do not edit Fork files.
4. **Set the Administrator Password**: Add a Worker Secret named `EDGE_EVER_AUTH_PASSWORD` and set its value to your chosen administrator login password. Prefer a strong password of at least 32 characters that is unique to this instance.
5. **Build & Verify**: Start the initial build. Once deployed, confirm `/api/health` returns `200`, then verify login with username `admin` and the configured password.
6. **Enable Automatic Updates**: Open the Fork's **Actions** tab, click **I understand my workflows, go ahead and enable them**, then manually run **Update deployed EdgeEver** once so the Fork can automatically receive future EdgeEver features and fixes.

> 📖 For full step-by-step instructions and configuration details, see the [Online Deployment Guide](docs/deploy-cloudflare-button.md).

> 💡 **Cloudflare R2 Activation**: Although Cloudflare R2 offers a generous [free storage allowance](https://developers.cloudflare.com/r2/pricing/#free-tier) that note-taking workloads remain completely within, you must first activate an R2 subscription and add a payment method. Cloudflare [officially supports](https://developers.cloudflare.com/billing/get-started/update-billing-info/#supported-payment-methods) UnionPay, Visa, Mastercard, and other cards, as well as PayPal, Apple Pay, Google Pay, and other payment methods.

### Option C: Docker on a VPS or NAS

Use the GitHub-hosted installer and the official GHCR image:

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

The command pulls the latest image, generates an administrator password, starts
EdgeEver with Docker Compose, and schedules daily automatic updates.

The official EdgeEver container image is hosted on GitHub Container Registry
(GHCR). Some network environments in mainland China may experience slow
connections or timeouts. If the image cannot be pulled normally, configure an
available network proxy or a trusted registry mirror before deployment. Users
are responsible for evaluating the availability and security of
third-party network and registry services.

See the [Docker deployment guide](docs/deploy-docker.md) for manual deployment and configuration.

---

## Multi-Account Login

Once deployed, a single instance supports multi-account login.

The instance administrator can create, disable, or reset member accounts in **Profile** -> **User accounts**. Each member gets a fully isolated personal workspace, including notebooks, notes, attachments, Trash, import/export, and MCP tokens.

## Browser Web Clipper

The Web Clipper is officially published for Chrome, Microsoft Edge, and Firefox. Install it from the store for your browser (Microsoft Edge users can install the Chrome Web Store version directly):

<p>
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/chrome/chrome.svg" alt="Install EdgeEver Web Clipper for Google Chrome" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/edge/edge.svg" alt="Install EdgeEver Web Clipper for Microsoft Edge" width="36" height="36" /></a>&nbsp;&nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/"><img src="https://raw.githubusercontent.com/alrra/browser-logos/58881b84c4d73adc03c06fa2c275a7abee02d935/src/firefox/firefox.svg" alt="Install EdgeEver Web Clipper for Firefox" width="36" height="36" /></a>
</p>

## Client Downloads

<p>
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="apps/web/public/icons/platforms/macos.svg" alt="Download EdgeEver for macOS" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://github.com/tianma-if/edgeever/releases/latest"><img src="apps/web/public/icons/platforms/windows.svg" alt="Download EdgeEver for Windows" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://play.google.com/store/apps/details?id=org.edgeever.mobile"><img src="apps/web/public/icons/platforms/google-play.svg" alt="Download EdgeEver for Android from Google Play" width="40" height="40" /></a>&nbsp;&nbsp;
  <a href="https://apps.apple.com/us/app/edgeever/id6792625631"><img src="apps/web/public/icons/platforms/app-store.svg" alt="Download EdgeEver for iOS from the App Store" width="40" height="40" /></a>
</p>

The iOS app requires an Apple ID from outside mainland China.

## Community and Feedback

- Bugs, feature requests, and deployment issues: [GitHub Issues](https://github.com/tianma-if/edgeever/issues)
- Code contributions: read the [Contribution Guide](CONTRIBUTING.md). If your Fork is also used to deploy EdgeEver, keep its `main` branch deployment-only. Create a separate branch from the official `upstream/main` for synchronization, development, and pull requests; do not develop on or Sync fork the deployment `main`.

### Telegram Community

Welcome to the EdgeEver community. Join us to discuss the EdgeEver experience, real-world AI Agent applications, cost-effective or free AI resources, and automation workflows.

👉 [Join the EdgeEver Telegram group](https://t.me/+wwUx1BYLrIdiZjY1)

## Tech Stack

- Bun workspace monorepo with Web, API, official site, and shared type package.
- Official site: Astro static site in `apps/site`, deployable to Cloudflare Pages.
- Frontend: Vite, React, React Router, TanStack Query, Tailwind CSS, shadcn/ui, and Radix UI.
- Editor: TipTap / ProseMirror with Markdown support; PWA uses vite-plugin-pwa, Workbox, and Dexie.
- Android app: Expo + React Native in `apps/mobile`, with SQLite local storage and incremental sync.
- iOS app: Native SwiftUI in `apps/ios` (iOS 17+), with a packaged TipTap EditorBundle, GRDB local mirror/outbox, and Android-aligned shell chrome.
- Native desktop app: Electron + Rust sidecar combines a consistent cross-platform experience with high-performance local data services; SQLite enables offline editing, incremental sync when back online, and local backups.
- Web clipper: Manifest V3, Mozilla Readability, and Turndown for Chrome, Microsoft Edge, and Firefox.
- Backend: one Hono/Zod business application with REST API, OpenAPI, and Remote MCP; Cloudflare uses Workers/D1/R2, while Docker uses Bun/SQLite/local files or S3.

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
migrations        Shared append-only D1/SQLite database migrations
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

## MCP

Create an API token in **Profile** -> **MCP settings** and give it to your AI Agent. The Agent can then securely read, organize, and import notes, manage note templates and AI instructions, and connect your notes with tools such as Notion databases and Feishu Bitable—all within your account permissions.

> Let your ideas run free: ask an AI Agent to organize fleeting thoughts, build a personal knowledge graph, create a profile from your notes, or tag them automatically.

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

- The "Minimal Emerald" theme typography layout is inspired by [obsidian-minimal](https://github.com/kepano/obsidian-minimal).
- The "Outline Emerald" theme typography layout is inspired by [Outline](https://github.com/outline/outline).
- The "Classic Blue & White" theme is inspired by the early [StackEdit](https://github.com/benweet/stackedit)/[Bootstrap](https://github.com/twbs/bootstrap) Markdown typography style, with Chinese typography details informed by [Marxico](https://maxiang.io/).

## Trademark and Brand Use

The EdgeEver name, logo, and other brand identifiers distinguish the official project. Forks and modified versions may state that they are based on EdgeEver, but must not imply official status or mislead users. The open-source license does not grant trademark rights; other uses require prior written permission from the project maintainers.

## Disclaimer

EdgeEver is an independent open-source note-taking application developed and maintained by individuals and the community. It is not affiliated with, authorized, sponsored, or endorsed by Evernote Corporation or its affiliates.

EdgeEver is self-hosted software. Except for official demo instances, project maintainers do not host, control, or review user content. Content stored or displayed by an instance is the responsibility of its users or operators and does not represent the maintainers' views.
