# @edgeever/plugin-api

Public TypeScript contracts and runtime manifest helpers for EdgeEver client plugins and code-free themes.

```ts
import { definePlugin } from "@edgeever/plugin-api";

export default definePlugin({
  activate(context) {
    return context.commands.register({
      id: "hello",
      title: "Hello",
      run: () => context.ui.showNotice("Hello from EdgeEver"),
    });
  },
});
```

The package ships ESM JavaScript and TypeScript declarations. Plugin bundles must produce a single `main.js` file without relative imports before distribution. See the EdgeEver plugin development guide for the Manifest format, permissions, settings Schema, release assets, and marketplace verification rules.

Desktop plugins can declare the `schedules` permission and idempotently schedule one of their own registered commands:

```ts
context.commands.register({ id: "refresh", title: "Refresh", run: refresh });
await context.schedules.upsert({
  key: "hourly-refresh",
  name: "Hourly refresh",
  commandId: "refresh",
  cronExpression: "0 * * * *",
});
```

Conflict-safe Markdown edits use the note baseline returned by `context.notes.get()`:

```ts
const note = await context.notes.get(noteId);
await context.notes.editMarkdown(noteId, {
  expectedRevision: note.revision,
  expectedContentHash: note.contentHash,
  edits: [{ from: 0, to: 0, insert: "- [ ] New task\n" }],
});
await context.ui.openNote(noteId, { search: "New task" }); // requires ui:navigation
```

Bulk-indexing plugins can page through `context.notes.queryContent()`. The API also exposes workspace templates, full live-editor reads and range edits, template mutation events, and programmatic opening of a plugin's own registered panels.

Canvas-style plugins can read and conflict-safely replace resource bytes, open full-screen guarded panels with JSON state, and register constrained block embed renderers:

```ts
const [resource] = await context.resources.list(noteId);
const scene = await context.resources.read(resource.id);
await context.resources.update(resource.id, {
  file: new File([scene], "drawing.excalidraw"),
  expectedContentHash: resource.contentHash!,
});

context.editor.embeds.register({ type: "drawing", mount(container, embed) {} });
await context.editor.insertEmbed({ type: "drawing", resourceId: resource.id, title: "Drawing" });
```
