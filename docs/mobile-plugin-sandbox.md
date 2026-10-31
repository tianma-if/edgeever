# Mobile plugin sandbox (foundation)

Status: **P1 foundation**, not wired into Android or iOS yet. This document describes the shared
runtime that native hosts will embed in a WebView.

## Why a WebView sandbox

Plugins are ES modules that render panels with DOM APIs. React Native (Hermes) cannot import or
evaluate downloaded modules and has no DOM, and SwiftUI cannot run plugin JavaScript. The Android
and iOS clients already embed web content with a native bridge (`'use dom'` components and the
WKWebView Tips editor bundle), so plugins run inside a dedicated WebView document while the native
side keeps authentication, storage, and native UI.

## Package layout

`packages/plugin-sandbox` is platform agnostic and has no React, Expo, or Swift dependencies:

| Module | Responsibility |
| --- | --- |
| `protocol.ts` | Versioned host ↔ sandbox messages, serialization of panel chrome, platform gating. |
| `bridge.ts` | Request/response correlation, timeouts, host-initiated queries, notices, error mapping. |
| `context.ts` | Builds a `PluginContext` (from `@edgeever/plugin-api`) on top of the bridge. Unsupported APIs reject with `SandboxUnsupportedError`. |
| `panel.ts` | Mounts plugin panels in the sandbox DOM; mirrors host-owned chrome and dispatches host actions to plugin callbacks. |
| `runtime.ts` | Boot sequence: waits for `init`, loads and activates the plugin, forwards events/commands, handles disposal. |
| `transfer.ts` | JSON-safe transfer of bytes, headers, multipart bodies, `Response`, and `Blob`. |

## Message flow

1. Sandbox → host: `ready`.
2. Host → sandbox: `init` with manifest, `platform` (`android`/`ios`), locale, and the settings snapshot.
3. Sandbox loads the plugin entry, calls `activate(context)`, then sends `activated` with the
   registered command/panel summaries.
4. Runtime traffic:
   - Sandbox → host `request` (`notes.*`, `network.fetch`, `storage.*`, `settings.*`, `panel.open`, …)
     with a host `response`.
   - Host → sandbox `request` (currently `panel.beforeClose`) answered with `query-result`.
   - Host → sandbox notifications: `event`, `settings.changed`, `command.run`, `panel.*`.
   - Sandbox → host notifications: `notice`, `panel.chrome`, `panel.close-request`, `error`.

Wire values are JSON; binary payloads use base64 (`transfer.ts`). Both sides must reject messages
whose `v` does not match `PLUGIN_SANDBOX_PROTOCOL_VERSION`.

## API support in this foundation

Supported (bridge-backed): `notes` (query/get/create/update/delete/move/pin/restore/editMarkdown and
revisions), `notebooks`, `tags`, `templates` (list/create/update/delete/use), `resources.list`,
`resources.read`, `storage`, `secrets`, `settings`, `network.fetch` (direct transport; request bodies
include text and `FormData` for uploads), `ui.showNotice`, `ui.openNote`, `ui.panels`, `events`,
`commands`.

Deliberately unsupported for now (rejects with a readable error so plugins can branch): `editor`,
`ai`, `schedules`, diagrams/tables/posters/infographics, resource write APIs, embed renderers.

## Native host responsibilities

- Sync the workspace extension catalog, download plugin packages through the instance distribution
  routes, verify sizes/hashes, and cache them.
- Keep the PAT/token out of the sandbox; answer bridge requests from native code.
- Persist settings, storage, and secrets in per-plugin namespaces (Keychain/Keystore for secrets).
- Render panel chrome (header actions, search, tabs, empty states, close confirmation) natively.
- Only load the downloaded bundle in the sandbox WebView; block external navigation.

## Testing

`bun test packages/plugin-sandbox` covers the bridge, context mapping, panel lifecycle, and runtime
boot with a fake transport, so the contract can be verified in CI without devices. Native wiring is
verified per platform on real devices in follow-up changes.
