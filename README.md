# EdgeEver

[简体中文](README.zh-CN.md) | English

> **EdgeEver: A serverless, 100% free, open-source, and AI-native self-hosted Evernote alternative on Cloudflare.**

EdgeEver is an open-source, self-hosted, Cloudflare-native notes workspace. It keeps the classic Evernote-style three-pane experience while providing a clear data model, REST API, OpenAPI schema, Remote MCP endpoint, and native AI Agent integration.

> 💡 **Serverless & 100% Free Forever**
> EdgeEver uses a pure Serverless architecture. **No server purchase or VPS rental is required**, and there is no need to configure Docker or SSL certificates. By running within Cloudflare's free quotas, personal use is **100% free with zero maintenance**.

## Why EdgeEver

Many long-time Evernote users only need a reliable, open, responsive personal knowledge base. But modern commercial notes apps are often heavier than necessary, harder to migrate away from, and increasingly shaped by subscription and add-on features.

EdgeEver fills that gap: familiar notes interaction, open data, API access, MCP support, and self-hosted deployment that is practical for individuals.

## Online Demo

- Demo: [https://demo.edgeever.org](https://demo.edgeever.org)

The public demo resets daily and restores sample notes. Do not store private content there.

## Deployment

### Deploy with an AI Agent

Copy this prompt into your AI coding assistant, such as Claude Code, Codex, Antigravity, Cursor, or Trae:

**Recommendation:** Before deployment, configure GitHub and Cloudflare MCP servers, plugins, or other supported integrations for your AI Agent. This allows it to fork the repository, create the required Cloudflare resources, and deploy the application.

```text
Please follow these steps:
1. Fork the EdgeEver upstream repository: https://github.com/tianma-if/edgeever
2. Use the forked repository to install and deploy EdgeEver to Cloudflare.
3. Configure a mechanism for the fork to sync updates from the upstream repository, so it can receive the latest product features periodically or on demand.
```

Agents should follow [AI Agent Cloudflare Deployment](docs/agent-deploy-cloudflare.md).

> Common pitfall: Cloudflare R2, D1, and Workers may still require a Visa card during activation or usage, even when you stay within the free quotas.

### Manual Deployment

Please refer to the [Cloudflare Manual Deployment Guide](docs/manual-deploy.md) for step-by-step instructions on manual installation and updating.

The automated helper commands are recommended. If you create the Cloudflare resources manually, finish configuring `.env.local`—including the D1 ID, R2 bucket, password hash, and the 400-day session limit—before running `bun run deploy`.


## Features

- Serverless, 100% free, and zero maintenance: Built on Cloudflare's Serverless architecture, running entirely within free tiers. Store up to 150k notes and 50k images without any hosting fees.
- Open data: notes are stored in Cloudflare D1, based on standard SQLite, and can be read through REST API, MCP, and CLI.
- AI Agent friendly: built-in MCP support lets tools such as Codex, Claude Code, and Antigravity read, organize, and maintain notes, while enabling integrations with Notion databases and Feishu Bitable.
- Uncapped multi-device sync: self-hosted API means no restrictive commercial limits on the number of active login devices, supporting seamless synchronization across PC, tablet, and mobile (via PWA or browser).
- Three-pane layout: notebook tree, note list, and main editor.
- Unlimited nested notebooks.
- Rich text editing.
- Note version history for reviewing previous content changes.
- Local browser-side image compression before upload, often reducing screenshots and large photos by about 50%-90%.
- Batch note merging.
- Batch note moving, notebook drag sorting, and hierarchy editing.
- Offline drafts and local sync queue for existing notes.
- Single-user login with PBKDF2-SHA256 password hashing.
- Chrome/Edge web clipper MVP (pending store publication): extract the current article or selected content and save it to a self-hosted EdgeEver instance.

## PWA Installation

EdgeEver can be installed as a PWA on desktop or mobile home screens. On desktop, open the site in Chrome or Edge and use the install icon in the address bar. On Android, open it in Chrome, use the three-dot menu, and choose **Add to Home screen** or **Install**. Avoid installing from embedded browsers such as WeChat.

> Common pitfall: When installing the PWA on mobile, Chrome or Edge is recommended. Other mobile browsers may encounter compatibility issues or unexpected errors during installation.

## Chrome/Edge Web Clipper

The repository includes a Manifest V3 extension in `apps/extension` for Chrome and Microsoft Edge. It lets users configure their own EdgeEver instance and API Token, then save the selected content or the current article as a searchable memo.

The current MVP extracts article content in the browser with Mozilla Readability and converts it to Markdown with Turndown. It does not yet preserve a complete single-file HTML archive or upload page resources to R2.

Build the extension from the repository root:

```sh
bun run build:extension
```

Then load `apps/extension/dist` as an unpacked extension from `chrome://extensions` or `edge://extensions` with developer mode enabled. The API Token should have `read:notebooks` and `write:memos` scopes.

## Native Clients

Native clients are part of the EdgeEver roadmap. The mobile app is planned to be built with React Native, and the desktop app is planned to be built with Tauri.

The goal is to let users connect these clients to their own self-hosted EdgeEver instance, keeping the same Cloudflare-based backend, open API, and user-owned data model while providing a smoother native experience on mobile and desktop.

## Tech Stack

- Bun workspace monorepo with Web, API, official site, and shared type package.
- Official site: Astro static site in `apps/site`, deployable to Cloudflare Pages.
- Frontend: Vite, React, React Router, TanStack Query, Tailwind CSS, shadcn/ui, and Radix UI.
- Editor: TipTap / ProseMirror with Markdown support; PWA uses vite-plugin-pwa, Workbox, and Dexie.
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

Start local development:

```sh
bun run dev
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

## Disclaimer

EdgeEver is an independent open-source note-taking application developed and maintained by individuals and the community. It is not affiliated with, authorized, sponsored, or endorsed by Evernote Corporation or its affiliates.
