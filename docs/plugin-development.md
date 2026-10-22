# EdgeEver Plugin Development Guide

[简体中文](plugin-development.zh-CN.md)

EdgeEver provides client plugin and no-code theme extension capabilities. Users can install extensions from the official marketplace, public GitHub repositories, or manifest URLs. Installed extensions sync across Web and desktop platforms with the current workspace and run while EdgeEver is open; Android and iOS native apps do not run plugins.

> [!NOTE]
> **Security Model**: Client plugins use a trusted-code model (similar to Obsidian). Enabling a plugin grants it trust to run within the client JavaScript environment and invoke plugin APIs. Capability declarations (`permissions`) in the manifest disclose the functional scope to users and do not enforce a hard sandbox. The same applies to `networkHosts`: it describes intended destinations rather than restricting plugin code. Desktop plugins can also reach login credentials, local data and Agent capabilities through the client bridge. Theme packages are purely declarative JSON and execute no JavaScript.

---

## Table of Contents

- [Plugin Manifest](#plugin-manifest)
  - [Fields](#fields)
  - [Available Permissions](#available-permissions)
- [Plugin Entry & Lifecycle](#plugin-entry--lifecycle)
- [API Reference](#api-reference)
  - [API Namespace Quick Reference](#api-namespace-quick-reference)
  - [1. Notes & Notebooks](#1-notes--notebooks)
  - [2. Templates](#2-templates)
  - [3. Resources & Attachments](#3-resources--attachments)
  - [4. Editor & Embeds](#4-editor--embeds)
  - [5. Commands](#5-commands)
  - [6. UI & Notices](#6-ui--notices)
  - [7. Panels](#7-panels)
  - [8. Settings](#8-settings)
  - [9. Storage & Secrets](#9-storage--secrets)
  - [10. Network Requests](#10-network-requests)
  - [11. Schedules (Desktop Only)](#11-schedules-desktop-only)
  - [12. Events](#12-events)
  - [13. AI Capabilities](#13-ai-capabilities)
- [Themes (No-Code Extensions)](#themes-no-code-extensions)
- [Packaging, Distribution & Local Testing](#packaging-distribution--local-testing)
  - [Packaging Rules](#packaging-rules)
  - [GitHub Distribution](#github-distribution)
  - [Local Testing](#local-testing)

---

## Plugin Manifest

Every plugin must supply a `manifest.json` at its root:

```json
{
  "type": "plugin",
  "id": "com.example.recent-notes",
  "name": "Recent Notes",
  "version": "1.0.0",
  "apiVersion": "2",
  "settingsUi": "host",
  "description": "Shows recently updated notes.",
  "locales": {
    "zh-CN": {
      "name": "最近笔记",
      "description": "查看最近更新的笔记。"
    }
  },
  "entry": "./main.js",
  "platforms": ["web", "desktop"],
  "permissions": ["notes:read", "editor:read", "ui:commands", "ui:notices", "ui:panels"]
}
```

### Fields

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `type` | `"plugin"` | Yes | Fixed value: `"plugin"`. |
| `id` | `string` | Yes | Globally unique plugin ID. Reverse-domain format recommended (e.g. `com.example.plugin`). |
| `name` | `string` | Yes | Default display name. |
| `version` | `string` | Yes | SemVer-compliant version string (e.g. `1.0.0`). |
| `apiVersion` | `"2"` | Yes | Plugin API version; currently `"2"`. |
| `settingsUi` | `"host"` | Yes | Settings UI renderer; currently `"host"` (rendered by host). |
| `entry` | `string` | Yes | Entry script path; fixed to `./main.js` for GitHub distribution. |
| `description` | `string` | No | Default description. |
| `locales` | `object` | No | Localized metadata keyed by BCP 47 language tags (e.g. `zh-CN`, `en-US`), overriding `name` and `description`. |
| `platforms` | `string[]` | No | Supported platforms: `"web"`, `"desktop"`. |
| `permissions` | `string[]` | No | Declared capabilities disclosed to users during install and update. |
| `settings` | `object` | No | Declarative settings schema rendered by host (detailed below). |

### Available Permissions

Permissions are declared to transparently inform users of plugin capabilities:
- **Notes & Content**: `notes:read`, `notes:write`, `notes:delete`, `templates:read`, `templates:write`, `metadata:read`, `metadata:write`, `resources:read`, `resources:write`
- **Editor**: `editor:read`, `editor:write`
- **UI & Interaction**: `ui:commands`, `ui:navigation`, `ui:notices`, `ui:panels`, `ui:embeds`
- **Storage & System**: `storage`, `secrets`, `network`, `network:public`, `schedules`
- **AI Capabilities**: `ai:generate`

---

## Plugin Entry & Lifecycle

The plugin entry script (`main.js`) exports a default object containing an `activate` lifecycle function:

```js
export default {
  activate(context) {
    // Register commands
    const disposeCommand = context.commands.register({
      id: "hello-world",
      title: "Say Hello",
      run() {
        context.ui.showNotice("Hello from EdgeEver Plugin!");
      }
    });

    // Return cleanup callback (invoked on deactivation)
    return () => {
      disposeCommand();
    };
  }
};
```

TypeScript projects can use `@edgeever/plugin-api`:

```ts
import { definePlugin } from "@edgeever/plugin-api";

export default definePlugin({
  activate(context) {
    return context.commands.register({
      id: "hello-world",
      title: "Say Hello",
      run: () => context.ui.showNotice("Hello!")
    });
  }
});
```

> [!TIP]
> Registration methods (commands, panels, events) return cleanup functions. When a plugin is deactivated, the host also automatically cleans up registered commands and event listeners.

---

## API Reference

### API Namespace Quick Reference

The plugin context object (`context`) exposes these capability interfaces:

| Namespace | Permission (Disclosure) | Core Methods | Description |
| :--- | :--- | :--- | :--- |
| **`context.notes`** | `notes:read`<br>`notes:write`<br>`notes:delete` | `query()`, `queryContent()`, `get()`, `create()`, `update()`, `editMarkdown()`, `delete()`, `move()`, `pin()`, `restore()`, `revisions` | Query notes, retrieve bodies, optimistic concurrent edits, and revision history |
| **`context.diagrams`** | `notes:read`<br>`notes:write` | `get()`, `edit()` | Read diagram graphs/layouts and edit nodes and edges in batches |
| **`context.tables`** | `notes:read`<br>`notes:write` | `get()`, `edit()` | Read complete tables and edit fields, records, and cells in batches |
| **`context.posters`** | `notes:read`<br>`notes:write` | `capabilities()`, `get()`, `edit()` | Edit poster elements, layers, groups, styles, and canvas |
| **`context.infographics`** | `notes:read`<br>`notes:write` | `capabilities()`, `get()`, `edit()` | Edit nested infographic data, templates, and themes |
| **`context.notebooks`** | `metadata:read`<br>`metadata:write` | `list()`, `create()`, `update()`, `delete()` | Manage notebook trees, hierarchy, and CRUD operations |
| **`context.tags`** | `metadata:read`<br>`metadata:write` | `list()`, `rename()`, `delete()` | Global tag listing, renaming, and removal |
| **`context.templates`** | `templates:read`<br>`templates:write` | `list()`, `create()`, `update()`, `delete()`, `use()` | Template management and one-click note creation |
| **`context.resources`** | `resources:read`<br>`resources:write` | `list()`, `read()`, `upload()`, `update()`, `rename()`, `delete()` | Upload, read, update, and manage note media/file attachments |
| **`context.editor`** | `editor:read`<br>`editor:write`<br>`ui:embeds` | `getSelection()`, `replaceSelection()`, `insertAtCursor()`, `getDocument()`, `editMarkdown()`, `insertEmbed()`, `embeds.register()` | Active editor manipulation, live document edits, and custom block embeds |
| **`context.ui`** | `ui:navigation`<br>`ui:notices`<br>`ui:panels` | `showNotice()`, `openNote()`, `panels.register()`, `panels.open()` | Host notifications, precise note navigation, and custom DOM panels |
| **`context.commands`** | `ui:commands` | `register()` | Register global or editor commands for command palette and menus |
| **`context.settings`** | *(None)* | `get()`, `set()`, `remove()` | Read and update the plugin's host-rendered settings |
| **`context.storage`** | `storage` | `get()`, `set()`, `remove()` | Device-local lightweight key-value storage (per workspace & plugin) |
| **`context.secrets`** | `secrets` | `get()`, `set()`, `remove()` | Device-local encrypted secret storage (API keys, tokens) |
| **`context.network`** | `network`<br>`network:public` | `fetch(url, options)` | Network requests (standard requests or public anonymous read-only) |
| **`context.schedules`** | `schedules` | `upsert()`, `list()`, `remove()` | Desktop-only persistent scheduled tasks running while EdgeEver is open |
| **`context.events`** | *(None)* | `on(event, handler)` | Subscribe to workspace note, tag, template, and sync completion events |
| **`context.ai`** | `ai:generate` | `status()`, `generate()`, `transcribeResource()`, `transcribeMedia()` | Invoke workspace-configured AI models for text generation & media transcription |

---

### 1. Notes & Notebooks

#### Querying Notes

```ts
// 1. Lightweight summaries (ideal for lists and sidebars; max 200 items per page)
const result = await context.notes.query({
  notebookId: "optional-notebook-id",
  text: "keyword",
  tags: ["todo"],
  sort: "updated-desc", // "updated-desc" | "created-desc" | "title-asc" | "title-desc"
  limit: 50,
  offset: 0
});
// Returns { notes: PluginNoteSummary[], totalCount: number, nextOffset: number | null }

// 2. Query notes with full Markdown content (for linters, indexers, etc.)
const fullNotes = await context.notes.queryContent({
  tags: ["task"],
  limit: 20
});
```

#### Note Operations

```ts
// Get single note details
const note = await context.notes.get(noteId);

// Create note
const newNote = await context.notes.create({
  notebookId: "target-notebook-id",
  title: "New Note",
  contentMarkdown: "# Title\nBody text",
  tags: ["tag1"]
});

// Update entire note
await context.notes.update(noteId, {
  title: "Updated Title",
  contentMarkdown: "New body",
  tags: ["updated"]
});

// Partial optimistic edit with concurrency check (revision & contentHash)
await context.notes.editMarkdown(noteId, {
  expectedRevision: note.revision,
  expectedContentHash: note.contentHash,
  edits: [
    { from: 0, to: 0, insert: "> Prepend quote\n\n" } // UTF-16 offsets, half-open interval [from, to)
  ]
});

// Move, pin, and delete
await context.notes.move([noteId], targetNotebookId);
await context.notes.pin([noteId], true);
await context.notes.delete(noteId, { permanent: false }); // Move to trash
await context.notes.restore(noteId); // Restore from trash

// Note revisions
const revisions = await context.notes.revisions.list(noteId);
await context.notes.revisions.restore(noteId, revisionId);
```

#### Notebooks & Tags

```ts
// Notebooks
const notebooks = await context.notebooks.list();
const nb = await context.notebooks.create({ name: "New Notebook", parentId: null });
await context.notebooks.update(nb.id, { name: "New Name" });
await context.notebooks.delete(nb.id);

// Tags
const tags = await context.tags.list();
await context.tags.rename("old-tag", "new-tag");
await context.tags.delete("unused-tag");
```

---

#### Reading and editing structured notes

`notes.query()` / `queryContent()` / `get()` return `kind` (`text`, `mind-map`, `flowchart`, `architecture`, `table`, `poster`, `infographic`, or `video`). Full notes also include a detached `contentJson` copy. The full persisted special-note payload remains available in `contentMarkdown`; reading these fields does not mutate the note.

Read a diagram, table, poster, or infographic through its dedicated `get()` before calling `edit()` with the returned `note.revision`, `note.contentHash`, and `editToken`. The snapshot token also detects unsynced local changes whose cloud revision has not advanced. A batch is fully validated before one repository write. `dryRun: true` returns a preview without saving or emitting a note mutation event; its `note` and `editToken` still refer to the saved baseline.

```ts
const snapshot = await context.diagrams.get(noteId, { includeLayout: true });
const result = await context.diagrams.edit(noteId, {
  expectedRevision: snapshot.note.revision,
  expectedContentHash: snapshot.note.contentHash,
  expectedEditToken: snapshot.editToken,
  reflow: "preserve",
  operations: [{ op: "update_node", nodeId: "root", changes: { label: "Updated" } }],
});

const table = await context.tables.get(tableNoteId);
await context.tables.edit(tableNoteId, {
  expectedRevision: table.note.revision,
  expectedContentHash: table.note.contentHash,
  expectedEditToken: table.editToken,
  operations: [
    { op: "update_record", recordId: "row-1", cells: { "field-1": "Updated" } },
    { op: "add_record", recordId: "row-2", cells: { "field-1": "New" } },
  ],
});
```

- Diagram operations: `add_node`, `update_node`, `remove_node`, `add_edge`, `update_edge`, `remove_edge`; 1–100 per batch. Removing a node with children requires `cascade: true`. Existing layout is preserved by default; `reflow: "all"` recomputes it. Theme and structure remain unchanged.
- Table operations: `add_field`, `update_field`, `remove_field`, `add_record`, `update_record`, `remove_record`; 1–100 per batch. Cells are keyed by field ID. Attachment writes use resource ID arrays; the host checks note ownership and resolves metadata. New records may specify a unique `recordId`; omitted IDs are generated.
- When schema changes convert or remove populated cells, preview `changedCellCount` / `removedAttachmentCount` with `dryRun`, then explicitly pass `allowDataChanges: true`. Record deletion executes directly; plugins should provide appropriate user interaction.
- Posters accept `edits: [{ id, patch }]` and `operations`: `add`, `remove`, `duplicate`, `reorder`, `group`, `ungroup`, `align`, `lock`, `apply_template`. Element patches run first, ordered operations second, canvas/platform resizing last. Array order is back to front. Discover editable fields, platforms, and fonts with `posters.capabilities()`. Locked elements must be explicitly unlocked before editing/removal. `apply_template` replaces all elements; use only for a requested layout replacement. Images must belong to the note. Changes clear the old preview reference but do not render a new image.
- Infographics support `set_data` / `remove_data` / `insert_data` at nested paths of field names and array indexes; insertions have a separate `index`. Batches contain 1–100 operations. `set_template` / `set_theme` explicitly change template/theme names from `infographics.capabilities()`. Ordinary data edits preserve templates, theme overrides, canvas configuration, and conversation history. The note title is unchanged; use `notes.update()` separately if needed. The existing AntV parser validates changes. The data section may be reformatted, but unrequested parsed values and styles must remain equal. Values that cannot round-trip (such as unsupported arrays or multiline scalars) throw `INVALID_STRUCTURED_EDIT` instead of being truncated or silently dropped. Theme changes replace only the theme name and preserve explicit color/style overrides.

```ts
const poster = await context.posters.get(posterNoteId);
await context.posters.edit(posterNoteId, {
  expectedRevision: poster.note.revision,
  expectedContentHash: poster.note.contentHash,
  expectedEditToken: poster.editToken,
  edits: [{ id: "heading", patch: { text: "Updated", fill: "#16A06E" } }],
});

const infographic = await context.infographics.get(infographicNoteId);
await context.infographics.edit(infographicNoteId, {
  expectedRevision: infographic.note.revision,
  expectedContentHash: infographic.note.contentHash,
  expectedEditToken: infographic.editToken,
  operations: [{ op: "set_data", path: ["lists", 0, "label"], value: "Updated" }],
});
```

**Compatibility and errors**: Updating title/tags through `notes.update()` preserves the original body. Supplying `contentMarkdown` for a special note, using `notes.editMarkdown()`, or writing to its body through editor Markdown/embed methods throws `STRUCTURED_NOTE_REQUIRED`. Generic Markdown creation/writes also reject special-note markers. Existing plugins must select the API based on `kind`. Wrong note types throw `NOTE_TYPE_MISMATCH`; invalid batches throw `INVALID_STRUCTURED_EDIT`; schema data changes require `TABLE_DATA_CHANGES_REQUIRED`; stale snapshots or unsaved editor changes throw `NOTE_CONFLICT` and require saving/reloading. Dedicated writes use the host repository's existing sync, revision history, and refresh mechanisms. An offline result does not confirm cloud synchronization.

Plugin saves also compare the local snapshot inside the repository transaction, preventing multiple windows from overwriting each other after host validation. Unresolved sync conflicts block further plugin writes and preserve the queued draft and diagnostics. Desktop plugin saves use a dedicated native method that commits content, history, and outbox together. Older hosts without that method throw `HOST_UPGRADE_REQUIRED`; no unguarded fallback is attempted. Ordinary editor save behavior is unchanged. Server history retains the existing five-minute snapshot policy, so each plugin write is not guaranteed a separate cloud revision.

After building the sidecar, maintainers can run `bun run test:plugin-sync` to verify an isolated Web IndexedDB → local API/SQLite → native sidecar → Web round trip, offline persistence, restart, and conflict recovery. `test:desktop:sidecar` includes this check. Set `EDGE_EVER_LEGACY_SIDECAR_PATH` and optionally `EDGE_EVER_LEGACY_MIGRATIONS_PATH` to also verify data created by an older native service upgrading to the current build. All native processes use temporary test directories; the installed desktop application is not launched and real account data is not read. This verifies the native service on the current host and does not replace device or in-app acceptance on other platforms.


### 2. Templates

Manage workspace-shared templates and apply them to create new notes:

```ts
// List all available templates
const templates = await context.templates.list();

// Create a template (directly or from an existing noteId)
const template = await context.templates.create({
  name: "Meeting Notes",
  description: "Standard team sync meeting template",
  contentMarkdown: "## Attendees\n\n## Agenda\n\n## Action Items\n",
  tags: ["meeting"]
});

// Update a template
await context.templates.update(template.id, {
  name: "Weekly Sync",
  description: "Weekly team sync notes"
});

// Apply template to create a new note in target notebook
const note = await context.templates.use(template.id, targetNotebookId);

// Delete template
await context.templates.delete(template.id);
```

---

### 3. Resources & Attachments

Manage images and file attachments associated with notes:

```ts
// List note attachments
const resources = await context.resources.list(noteId);

// Read attachment Blob
const blob = await context.resources.read(resourceId);

// Upload new attachment
const uploaded = await context.resources.upload(noteId, file);

// Concurrency-checked update (file limit: 100 MiB)
await context.resources.update(resourceId, {
  file: newFile,
  expectedContentHash: currentResource.contentHash
});

// Rename and delete
await context.resources.rename(resourceId, "document.pdf");
await context.resources.delete(resourceId);
```

---

### 4. Editor & Embeds

Interact with active editor sessions:

```ts
// Get and replace selection
const selection = await context.editor.getSelection();
if (selection && !selection.empty) {
  await context.editor.replaceSelection(selection.text.toUpperCase());
}

// Insert at cursor
await context.editor.insertAtCursor("- [ ] New task\n");

// Live edit in-memory document without losing unsaved changes
const doc = await context.editor.getDocument();
if (doc) {
  await context.editor.editMarkdown([
    { from: 0, to: 0, insert: "<!-- inserted header -->\n" }
  ]);
}
```

#### Custom Block Embeds

Register custom block-level embed renderers (serialized in Markdown as `edgeever-plugin-embed` code fences):

```ts
// 1. Register embed renderer
context.editor.embeds.register({
  type: "my-diagram",
  async mount(container, embed) {
    const data = embed.data;
    container.innerHTML = `<div>Diagram: ${data.title}</div>`;
    return () => container.replaceChildren(); // Cleanup on unmount
  }
});

// 2. Insert embed into document
await context.editor.insertEmbed({
  type: "my-diagram",
  title: "Architecture",
  data: { mode: "preview", version: 1 } // JSON-compatible object, max 64 KiB
});
```

---

### 5. Commands

```ts
context.commands.register({
  id: "quick-action",
  title: "Quick Action",
  listed: true, // Display on marketplace card (default: true; false for contextual commands)
  menu: true,   // Show in desktop shortcut menu (default: true)
  async run() {
    context.ui.showNotice("Action executed");
  }
});
```

---

### 6. UI & Notices

```ts
// Global host notice
context.ui.showNotice("Action executed");

// Open note and optionally jump to exact search term
await context.ui.openNote(noteId, { search: "search term" });
```

---

### 7. Panels

Register native DOM panels presented as dialogs or full-screen views:

```ts
context.ui.panels.register({
  id: "task-dashboard",
  title: "Task Dashboard",
  purpose: "dashboard", // "workflow" | "dashboard" | "preview" | "onboarding"
  presentation: "dialog", // "dialog" | "fullscreen"
  mount(container, { shell, requestClose, state }) {
    // 1. Use standard host shell controls (header, toolbar, search, tabs)
    shell.set({
      header: {
        title: "Tasks",
        description: "View pending and active tasks",
        actions: [{ id: "refresh", label: "Refresh" }]
      },
      toolbar: [
        {
          type: "tabs",
          key: "filter",
          value: "all",
          options: [{ value: "all", label: "All" }, { value: "done", label: "Done" }]
        },
        { type: "search", key: "q", placeholder: "Search tasks" }
      ],
      onAction(actionId) { /* Handle action button clicks */ },
      onChange(key, value) { /* Handle filter / search changes */ }
    });

    // 2. Render custom DOM
    const content = document.createElement("div");
    content.textContent = "Dashboard content";
    container.append(content);

    return () => content.remove(); // Cleanup
  },
  beforeClose() {
    // Guard unsaved state: return true to close, false to keep open, or confirmation options
    return true;
  }
});

// Open panel
await context.ui.panels.open("task-dashboard", { state: { initialTab: "all" } });
```

---

### 8. Settings

Declare settings fields in `manifest.json`; EdgeEver renders the settings UI automatically:

```json
{
  "settings": {
    "fields": [
      { "key": "endpoint", "type": "text", "label": "API Endpoint", "required": true },
      { "key": "token", "type": "secret", "label": "API Token", "required": true },
      { "key": "autoSync", "type": "boolean", "label": "Auto Sync", "default": true },
      {
        "key": "mode",
        "type": "select",
        "label": "Sync Mode",
        "default": "fast",
        "options": [
          { "value": "fast", "label": "Fast" },
          { "value": "full", "label": "Full" }
        ]
      }
    ]
  }
}
```

#### Accessing and Listening to Settings

```ts
// Read setting values
const endpoint = await context.settings.get<string>("endpoint");
const token = await context.settings.get<string>("token");

// Listen for setting changes
context.events.on("settings.changed", async ({ key }) => {
  if (key === "autoSync") {
    const autoSync = await context.settings.get<boolean>("autoSync");
    // Update logic
  }
});
```

> [!NOTE]
> `type: "secret"` values are encrypted locally and never echoed back into form markup. Settings are stored locally per device and do not sync across devices.

---

### 9. Storage & Secrets

Isolated per workspace and plugin ID on the current device:

```ts
// Ordinary key-value store (ideal for cursors and caches)
await context.storage.set("last_sync_time", Date.now());
const lastSync = await context.storage.get<number>("last_sync_time");
await context.storage.remove("last_sync_time");

// Secret storage (API keys, tokens; encrypted locally)
await context.secrets.set("api_key", "sk-xxx");
const apiKey = await context.secrets.get("api_key");
await context.secrets.remove("api_key");
```

---

### 10. Network Requests

```ts
// 1. Standard request (arbitrary HTTP/HTTPS; subject to host CORS policies)
const response = await context.network.fetch("https://api.example.com/data", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "example" })
});
const data = await response.json();

// 2. Public read-only request (anonymous, read-only cross-origin GET/HEAD on port 443)
const publicRes = await context.network.fetch("https://example.org/feed.xml", {
  transport: "public",
  headers: { Accept: "application/rss+xml" }
});
const xml = await publicRes.text();
```

---

### 11. Schedules (Desktop Only)

Desktop plugins can persist scheduled execution of registered commands while EdgeEver is running:

```ts
// Register command
context.commands.register({
  id: "sync-feed",
  title: "Sync Feeds",
  run: async () => { /* Long-running sync task */ }
});

// Configure schedule (idempotent; keyed by "pluginId + key")
await context.schedules.upsert({
  key: "hourly-sync",
  name: "Hourly Feed Sync",
  commandId: "sync-feed",
  cronExpression: "0 * * * *",
  missedRunPolicy: "run-once" // "run-once" | "skip"
});

// List or remove
const schedules = await context.schedules.list();
await context.schedules.remove("hourly-sync");
```

---

### 12. Events

Subscribe to workspace data changes:

```ts
// Note events
context.events.on("note.created", ({ note }) => console.log("Created", note.id));
context.events.on("note.updated", ({ note }) => console.log("Updated", note.id));
context.events.on("note.deleted", ({ noteId }) => console.log("Deleted", noteId));

// Other events
context.events.on("tag.changed", () => { /* Tag updated */ });
context.events.on("workspace.synced", () => { /* Workspace sync completed */ });
```

---

### 13. AI Capabilities

Invoke workspace-configured AI models for text generation and media transcription (credentials are managed securely by the host; plugins never touch user API keys):

```ts
// 1. Check AI configuration status
const status = await context.ai.status();
// { configured: boolean, modelName?: string }

if (status.configured) {
  // 2. Text generation
  const result = await context.ai.generate({
    system: "You are a writing assistant.",
    prompt: "Refine this paragraph: ...",
    maxOutputTokens: 2000,
    signal: abortController.signal
  });
  console.log("Output:", result.text);

  // 3. Transcribe audio/video attachments already in the note
  const transcript = await context.ai.transcribeResource(noteId, resourceId);
  // { text: string, resourceId: string, filename: string }

  // 4. Transcribe standalone Blob / File held by the plugin
  const ownMedia = new File([audioBytes], "recording.mp3", { type: "audio/mpeg" });
  const mediaTranscript = await context.ai.transcribeMedia(ownMedia, {
    signal: abortController.signal
  });
  console.log("Transcription:", mediaTranscript.text);
}
```

---

## Themes (No-Code Extensions)

Themes are declarative extensions requiring only a `manifest.json`:

```json
{
  "type": "theme",
  "id": "com.example.theme",
  "name": "Nord Emerald",
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

Supported tokens:
- Colors: `color.background`, `color.surface`, `color.surfaceMuted`, `color.text`, `color.textMuted`, `color.border`, `color.accent`, `color.accentForeground`, `color.success`, `color.warning`, `color.danger` (format: `#RRGGBB` or `#RRGGBBAA`)
- Typography & Layout: `font.body`, `font.mono`, `font.size`, `lineHeight.body`, `radius.medium`, `density.scale`, `editor.contentWidth`

---

## Packaging, Distribution & Local Testing

### Packaging Rules

A plugin distribution bundle must be self-contained:
- `manifest.json`: Plugin manifest
- `main.js`: Single-file JavaScript bundle (max 5 MB)
- `styles.css`: Optional stylesheet (max 1 MB)

If using `@edgeever/plugin-api`, inline it into `main.js` during build.

### GitHub Distribution

1. Host a repository containing `manifest.json` on GitHub (public repository).
2. Create a GitHub Release with a tag matching the manifest version (e.g. `1.0.0` or `v1.0.0`).
3. Attach `manifest.json`, `main.js`, and optional `styles.css` as Release assets.
4. Users install it directly via the Plugin Marketplace page:
   ```text
   https://github.com/owner/edgeever-plugin
   ```

### Local Testing

While developing EdgeEver, install local extension manifests in the Plugin Marketplace:
- `/extensions/recent-notes/manifest.json` (Official example plugin)
- `/extensions/nord-emerald/manifest.json` (Official example theme)

To submit to the official verified marketplace, see the [Plugin Marketplace Policy](plugin-marketplace-policy.md).
