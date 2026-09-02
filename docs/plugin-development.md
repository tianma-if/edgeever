# EdgeEver Plugin Development (P0 Preview)

EdgeEver's P0 extension API supports trusted client plugins and no-code theme packages. Users can install extensions from the verified marketplace, a public GitHub repository, or a manifest URL. Extensions are installed per device and run only while EdgeEver is open. Scheduled/background jobs, webhooks, unrestricted TipTap extensions, and a hard JavaScript sandbox are not part of this preview.

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

Updates use a rollback-capable switch. Old and new package versions are cached separately. If the new version cannot activate, EdgeEver restores the previous manifest, enabled state, and package instead of leaving the plugin broken or disabled.

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

Marketplace installs display a Verified badge. GitHub and manifest sideloads clearly display their unverified source, but EdgeEver does not block them. Uninstalling also deletes all device-local cached package versions, ordinary plugin storage for the current workspace, and Secret Storage.

Supported permissions:

- `notes:read`
- `notes:write`
- `notes:delete`
- `templates:read`
- `templates:write`
- `metadata:read`
- `metadata:write`
- `resources:read`
- `resources:write`
- `network`
- `storage`
- `secrets`
- `editor:read`
- `editor:write`
- `ui:commands`
- `ui:navigation`
- `ui:notices`
- `ui:panels`
- `ui:embeds`

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

### SDK package

`@edgeever/plugin-api` is a publish-ready ESM package with generated JavaScript and TypeScript declarations. In the EdgeEver repository, rebuild it after changing public contracts:

```sh
bun run build:plugin-api
```

Maintainers can inspect the exact public package without publishing it:

```sh
cd packages/plugin-api
npm pack --dry-run
```

The package build contains only `dist/index.js`, `dist/index.d.ts`, its README, and package metadata. Plugin projects should bundle SDK runtime helpers into their single-file `main.js`; they must not leave a runtime import of `@edgeever/plugin-api` in the distributed bundle.

## Notes API

```ts
context.notes.query({ text, notebookId, tags, sort, limit, offset });
context.notes.queryContent({ text, notebookId, tags, sort, limit, offset });
context.notes.get(noteId);
context.notes.editMarkdown(noteId, { expectedRevision, expectedContentHash, edits });
context.notes.create({ notebookId, title, contentMarkdown, tags });
context.notes.update(noteId, { title, contentMarkdown, tags });
context.notes.delete(noteId, { permanent: false });
context.notes.move([noteId], notebookId);
context.notes.pin([noteId], true);
context.notes.restore(noteId);
context.notes.revisions.list(noteId);
context.notes.revisions.restore(noteId, revisionId);
context.notebooks.list();
context.notebooks.create({ name, parentId });
context.notebooks.update(notebookId, { name, parentId, sortOrder });
context.notebooks.delete(notebookId);
context.tags.list();
context.tags.rename("old", "new");
context.tags.delete("unused");
```

`notes.query()` returns lightweight summaries. Use `notes.queryContent()` when a plugin must scan Markdown across many notes, such as a Tasks index, Calendar, Kanban board, or Linter. Both APIs accept at most 200 notes per page; follow `nextOffset` until it is `null`. Prefer the summary query whenever full content is unnecessary.

All writes go through EdgeEver's shared repository/business layer, including offline queueing and desktop adapters. Plugins do not access a storage implementation directly.
`notes.update()` requires both `notes:write` and `notes:read` because the update flow reads the current revision and returns the complete updated note. This prevents write access from becoming an indirect note-content read capability.
`notes.editMarkdown()` requires the same permissions and performs optimistic concurrency checks with the `revision` and `contentHash` returned by `notes.get()`. It is intended for plugins such as task togglers, linters, and index maintainers that change only specific Markdown ranges:

```ts
const note = await context.notes.get(noteId);
await context.notes.editMarkdown(noteId, {
  expectedRevision: note.revision,
  expectedContentHash: note.contentHash,
  edits: [
    { from: 2, to: 3, insert: "x" },
    { from: note.contentMarkdown.length, to: note.contentMarkdown.length, insert: "\nAppended text" }
  ]
});
```

Edit ranges use JavaScript UTF-16 string offsets and half-open ranges `[from, to)`. Ranges in one call must not overlap, exceed the note, or split a Unicode surrogate pair. The host rejects writes with an error carrying `code: "NOTE_CONFLICT"` when the note baseline changed or the active editor has unsaved changes; plugins should reload and ask the user to retry. Invalid ranges use `code: "INVALID_MARKDOWN_EDIT"`. The SDK exports `PluginApiError` and `PluginApiErrorCode` for TypeScript error narrowing.
Notebook and tag reads require `metadata:read`; notebook and tag changes require `metadata:write`.

Attachments use their own permissions and still flow through the same Web/Desktop repository adapters:

```ts
context.resources.list(noteId); // resources:read
const blob = await context.resources.read(resourceId); // resources:read
context.resources.upload(noteId, file); // resources:write
context.resources.update(resourceId, { file, expectedContentHash });
context.resources.rename(resourceId, filename);
context.resources.delete(resourceId);
```

`resources.update()` requires both resource permissions and uses the `contentHash` returned by `resources.list()` as an optimistic-concurrency baseline. A stale baseline throws `PluginApiError` with `code: "RESOURCE_CONFLICT"`. Replacements are currently limited to 100 MiB and require the resource to be synchronized and online. The host stores new bytes under a new object key and switches the database pointer conditionally, so a rejected update does not damage the previous object.

Subscribing to `note.*` events requires `notes:read`, subscribing to `tag.changed` requires `metadata:read`, subscribing to `template.*` requires `templates:read`, and subscribing to `resource.*` requires `resources:read`. The sync-queue status event carries no note or metadata content and requires no additional read permission.

Successful note, tag, template, and resource changes made through EdgeEver's normal repository layer—including user actions and plugin actions—feed the same plugin event stream. `workspace.synced` reports completed repository sync passes. Failed mutations do not emit success events.

## Templates API

Templates are shared workspace data rather than plugin-local settings. Reading them requires `templates:read`; creating and deleting require `templates:write`; updating requires both. Applying a template also requires `notes:write` because it creates a note:

```ts
const template = await context.templates.create({
  name: "Daily stand-up",
  contentMarkdown: "## Done\n\n## Next\n",
  tags: ["daily"]
});
await context.templates.update(template.id, { description: "Team check-in" });
const note = await context.templates.use(template.id, notebookId);
context.events.on("template.updated", ({ template }) => console.log(template.name));
```

`templates.create({ noteId })` can capture an existing note and additionally requires `notes:read`. Plugins can also call `templates.list()` and `templates.delete(templateId)`.

## Host-rendered settings

Plugins can declare settings that EdgeEver renders consistently in plugin details. Supported field types are `text`, `secret`, `number`, `boolean`, and `select`:

```json
{
  "settings": {
    "fields": [
      { "key": "endpoint", "type": "text", "label": "API endpoint", "required": true },
      { "key": "token", "type": "secret", "label": "API token", "required": true },
      { "key": "format", "type": "select", "label": "Format", "default": "md", "options": [
        { "value": "md", "label": "Markdown" },
        { "value": "html", "label": "HTML" }
      ] }
    ]
  }
}
```

Plugins read the validated values through `context.settings`. Secret values are encrypted in the device-local Secret Storage, are never embedded as Manifest defaults, and are not filled back into the settings form:

```ts
const endpoint = await context.settings.get("endpoint");
const token = await context.settings.get("token");
await context.settings.set("format", "html");
await context.settings.remove("token");
```

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

## Editor API

`editor:read` reads the active editor selection or full live document. `editor:write` replaces the selection, inserts Markdown at the cursor, or applies validated UTF-16 range edits to the live document:

```ts
const selection = await context.editor.getSelection();
if (selection && !selection.empty) {
  await context.editor.replaceSelection(selection.text.toUpperCase());
}
await context.editor.insertAtCursor("**Inserted by plugin**");

const document = await context.editor.getDocument();
if (document) {
  await context.editor.editMarkdown([
    { from: 0, to: 0, insert: "<!-- checked by linter -->\n" }
  ]);
}
```

Reading returns `null` when no editable note is open; writes throw an error. `editor.editMarkdown()` uses the same range validation as `notes.editMarkdown()`, but operates on the current in-memory document so it can safely include unsaved user changes. Plugin edits use normal editor transactions and the autosave flow.

### Plugin embeds

`ui:embeds` allows a plugin to register a renderer for its own constrained, block-level embed type. Inserting an embed additionally requires `editor:write`:

```ts
const disposeEmbed = context.editor.embeds.register({
  type: "drawing",
  async mount(container, embed) {
    const scene = await context.resources.read(embed.resourceId);
    // Render a framework-independent preview into container.
    return () => container.replaceChildren();
  }
});

await context.editor.insertEmbed({
  type: "drawing",
  resourceId: sceneResource.id,
  previewResourceId: previewResource.id,
  title: "Architecture",
  data: { mode: "view" }
});
```

The host assigns the embed ID and plugin ID, so a plugin cannot impersonate another renderer. Embed metadata is limited to JSON-compatible values and 64 KiB. EdgeEver persists the generic node as an `edgeever-plugin-embed` fenced block in Markdown. When the plugin is disabled or unavailable, Web and public-share views show a stable fallback, while native editors preserve the original node through their unsupported-content compatibility path. Plugins do not receive the raw TipTap editor or schema.

## Note navigation

With `ui:navigation` declared, a plugin can open an existing note from a task, calendar, index, or search panel:

```ts
await context.ui.openNote(noteId, { search: "- [ ] Ship release" });
```

The host verifies that the note exists and is not deleted, then switches to its notebook and editor. When `search` is supplied, EdgeEver opens in-note search and reveals its first exact match. Plugins do not need and cannot access private routes or React state.

## Custom panels

Plugins can register framework-independent DOM panels. Users open them from the Plugin Marketplace's installed-plugin section; the host runs the disposer when the panel closes or the plugin is disabled or uninstalled:

```ts
context.ui.panels.register({
  id: "dashboard",
  title: "Dashboard",
  presentation: "fullscreen",
  mount(container, { state, requestClose }) {
    const heading = document.createElement("h2");
    heading.textContent = "Plugin dashboard";
    container.append(heading);
    return () => heading.remove();
  },
  beforeClose() {
    return hasUnsavedDrawing
      ? { title: "Unsaved drawing", message: "Close without saving?", confirmLabel: "Close drawing" }
      : true;
  }
});

await context.ui.panels.open("dashboard", { state: { resourceId } });
```

`presentation` accepts `dialog` (the default) or `fullscreen`. `panels.open()` can only open a panel registered by the calling plugin; its optional JSON state is limited to 64 KiB and is delivered through the mount context. `beforeClose()` may return `true` to close, `false` to stay open, or confirmation copy for a host-rendered dialog. The mount context's `requestClose()` follows the same guard.

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
