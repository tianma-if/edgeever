# EdgeEver Plugin Development (P0 Preview)

EdgeEver's P0 extension API supports trusted client plugins and no-code theme packages. Users can install extensions from the verified marketplace, a public GitHub repository, or a manifest URL. Extensions are installed per device and run only while EdgeEver is open. Scheduled/background jobs, webhooks, custom editor blocks, and a hard JavaScript sandbox are not part of this preview.

## Security model

Theme packages contain only a validated manifest and documented design tokens. They do not execute JavaScript.

Client plugins use an Obsidian-style trusted-code model. Their declared permissions gate calls made through the EdgeEver plugin context, but the plugin module itself runs in the client JavaScript environment. Users must install plugins only from developers they trust.

Plugins never receive EdgeEver's repository, IndexedDB database, Cloudflare bindings, or internal React state through the public API.

## Plugin manifest

```json
{
  "type": "plugin",
  "id": "com.example.recent-notes",
  "name": "Recent Notes",
  "version": "1.0.0",
  "apiVersion": "1",
  "description": "Adds a command for recent notes.",
  "entry": "./main.js",
  "platforms": ["web", "desktop"],
  "permissions": ["notes:read", "editor:read", "ui:commands", "ui:notices", "ui:panels"]
}
```

The manifest and JavaScript module must be served with CORS headers that permit the EdgeEver origin. Relative `entry` paths resolve against the manifest URL.

## GitHub distribution

Developers can share a public GitHub repository URL directly with users. The default branch must contain the latest `manifest.json` at its root, and every version is published as a GitHub Release. The Release tag may be the manifest version or its `v`-prefixed form, such as `1.2.0` or `v1.2.0`.

Attach these files to the Release:

```text
manifest.json
main.js
styles.css (optional)
```

GitHub plugins must use `./main.js` as `entry`, and `main.js` must be a single-file bundle without relative module imports. EdgeEver reads the default-branch manifest, locates the matching Release, downloads assets in parallel, verifies GitHub's SHA-256 digest when present, and caches the verified package in device-local IndexedDB. `main.js` is limited to 5 MB and `styles.css` to 1 MB.

EdgeEver checks for updates when the Plugin Marketplace opens, when the window regains focus, and every 30 minutes, but never installs silently. The user must click Update and confirm. If a new version adds plugin permissions or network hosts, the confirmation lists the additional access. For GitHub distribution, the Release `manifest.json` must exactly match the default-branch manifest used for the update prompt or installation is rejected. Marketplace installs only follow newer versions verified in the Registry.

Users can freely install without marketplace admission by pasting this into the standalone Plugin Marketplace page:

```text
https://github.com/owner/edgeever-plugin
```

Only public GitHub repositories are supported for now; private-repository tokens are not exposed.

## Verified plugin marketplace

The marketplace is a verified Registry and does not take ownership of plugin files. For each version, the Registry pins the plugin ID, GitHub repository, version, and SHA-256 hashes for `manifest.json`, `main.js`, and optional `styles.css`. Installation still downloads from the developer's GitHub Release or registered public URL and verifies those hashes again.

Registry format:

```json
{
  "registryVersion": "1",
  "updatedAt": "2026-08-16T00:00:00.000Z",
  "entries": [{
    "id": "com.example.recent-notes",
    "name": "Recent Notes",
    "description": "Shows recently updated notes.",
    "author": "Example",
    "category": "Productivity",
    "repositoryUrl": "https://github.com/example/edgeever-recent-notes",
    "distribution": {
      "type": "github",
      "repositoryUrl": "https://github.com/example/edgeever-recent-notes"
    },
    "verification": {
      "version": "1.0.0",
      "checksums": {
        "manifestJson": "<64-character SHA-256>",
        "mainJs": "<64-character SHA-256>"
      }
    }
  }]
}
```

Marketplace installs display a Verified badge. GitHub and manifest sideloads clearly display their unverified source, but EdgeEver does not block them. Uninstalling also deletes the device-local cached package.

Supported permissions:

- `notes:read`
- `notes:write`
- `notes:delete`
- `metadata:read`
- `metadata:write`
- `network`
- `storage`
- `secrets`
- `editor:read`
- `editor:write`
- `ui:commands`
- `ui:notices`
- `ui:panels`

Network access through `context.network.fetch()` also requires a `networkHosts` allowlist in the manifest.

## Plugin entry

```js
export default {
  activate(context) {
    return context.commands.register({
      id: "count-recent-notes",
      title: "Count recent notes",
      async run() {
        const result = await context.notes.query({
          sort: "updated-desc",
          limit: 10
        });
        context.ui.showNotice(`${result.notes.length} recent notes`);
      }
    });
  }
};
```

For TypeScript projects, import contracts and helpers from `@edgeever/plugin-api`:

```ts
import { definePlugin } from "@edgeever/plugin-api";

export default definePlugin({
  activate(context) {
    // Register commands and event listeners here.
  }
});
```

Every registration returns a disposer. The host also disposes registered commands and events automatically when a plugin is disabled.

## Notes API

```ts
context.notes.query({ text, notebookId, tags, sort, limit, offset });
context.notes.get(noteId);
context.notes.create({ notebookId, title, contentMarkdown, tags });
context.notes.update(noteId, { title, contentMarkdown, tags });
context.notes.delete(noteId, { permanent: false });
context.notebooks.list();
context.tags.list();
context.tags.rename("old", "new");
context.tags.delete("unused");
```

All writes go through EdgeEver's shared repository/business layer, including offline queueing and desktop adapters. Plugins do not access a storage implementation directly.
Notebook and tag reads require `metadata:read`; tag changes require `metadata:write`.

## Storage and network

Plugin storage is namespaced by EdgeEver workspace and plugin ID:

```ts
await context.storage.set("cursor", "next-page");
const cursor = await context.storage.get<string>("cursor");
```

Requests are limited to HTTPS, except localhost development, and to declared hosts:

```json
{
  "permissions": ["network"],
  "networkHosts": ["api.example.com", "*.trusted.example.com"]
}
```

```ts
await context.network.fetch("https://api.example.com/items");
```

Use regular `storage` for cursors and preferences. Sensitive strings such as API keys belong in `secrets`:

```ts
await context.secrets.set("api-token", token);
const token = await context.secrets.get("api-token");
await context.secrets.remove("api-token");
```

The web host namespaces secrets by workspace and plugin ID, encrypts them with AES-GCM using a device-local, non-exportable WebCrypto key, and stores ciphertext in IndexedDB. This prevents plaintext storage, but P0 plugins are trusted same-page code and the mechanism cannot defend against a malicious plugin reading live data.

## Editor selection API

`editor:read` reads the active editor selection. `editor:write` replaces it or inserts Markdown at the cursor:

```ts
const selection = await context.editor.getSelection();
if (selection && !selection.empty) {
  await context.editor.replaceSelection(selection.text.toUpperCase());
}
await context.editor.insertAtCursor("**Inserted by plugin**");
```

Reading returns `null` when no editable note is open; writes throw an error. Plugin edits use normal editor transactions and the autosave flow.

## Custom panels

Plugins can register framework-independent DOM panels. Users open them from the Plugin Marketplace's installed-plugin section; the host runs the disposer when the panel closes or the plugin is disabled or uninstalled:

```ts
context.ui.panels.register({
  id: "dashboard",
  title: "Dashboard",
  mount(container) {
    const heading = document.createElement("h2");
    heading.textContent = "Plugin dashboard";
    container.append(heading);
    return () => heading.remove();
  }
});
```

## Desktop plugin entry

After a plugin is enabled, a unified puzzle button appears in the desktop workspace shortcuts on the left. Its menu groups commands and panels by plugin, keeps recently used actions at the top, and links directly to extension management. Individual plugins do not each consume a toolbar icon.

## Theme manifest

Themes are code-free extension packages:

```json
{
  "type": "theme",
  "id": "com.example.theme",
  "name": "Example Theme",
  "version": "1.0.0",
  "themeApiVersion": "1",
  "modes": ["light", "dark"],
  "light": {
    "color.background": "#f8fafc",
    "color.surface": "#ffffff",
    "color.text": "#0f172a",
    "color.accent": "#16a06e"
  },
  "dark": {
    "color.background": "#0f172a",
    "color.surface": "#1e293b",
    "color.text": "#f8fafc",
    "color.accent": "#4ade80"
  }
}
```

Supported token names are exported as `THEME_TOKEN_NAMES` by `@edgeever/plugin-api`. Unknown tokens are rejected so themes do not depend on private DOM selectors.
Color tokens accept only `#RRGGBB` or `#RRGGBBAA`; font and size tokens also use restricted formats. Theme values cannot contain selectors, remote assets, or CSS functions.

## Bundled examples

When developing EdgeEver locally, install these URLs from the standalone **Plugin Marketplace** page:

- `/extensions/recent-notes/manifest.json`
- `/extensions/nord-emerald/manifest.json`

The first demonstrates note queries, selection replacement, commands, and a custom panel. The second demonstrates the code-free theme token API.

## Current limits

- Plugins are installed on one device and are not synchronized.
- Plugins run only while the app is open.
- There is no Cron, webhook receiver, background runtime, marketplace submission backend, or automated review pipeline.
- Declared permissions are API capability checks, not a hard sandbox for trusted JavaScript.
- Custom panels open from the unified desktop plugin menu or extension settings and cannot yet be pinned to the main navigation or editor sidebar.
- Secret storage is device-local and does not sync to other devices.
