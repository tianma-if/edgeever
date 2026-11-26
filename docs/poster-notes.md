# Poster notes

[简体中文](poster-notes.zh-CN.md)

Choose **More types → Poster (Beta)** to create an editable poster. In an ordinary note, choose **Create poster** from the note actions to create a separate poster using the title and selected text (or the first 240 characters of the body). The original note remains intact.

Web and desktop open a dedicated design workspace with 40 selectable templates adapted from Qiaomu Design's MIT-licensed layout engine, 12 platform presets, bundled licensed Chinese and Latin fonts, headline/subtitle/badge reflow, and actual rendered template previews. The template renderer and its attribution are in `apps/web/src/lib/poster-design`; font licenses ship alongside the font files. Generated raster grain is omitted when adapting vector templates.

The canvas supports text, badges, shapes, paths, freehand drawing and images; multi-selection, grouping, alignment, snapping, zoom and pan; layers, visibility and locking; typography, outlines, shadows, gradients and image fit/crop/flip. Export PNG, JPEG or WebP at 1×–3× (up to 8192 pixels per side), copy a PNG, or insert an exported image into the source note. Edit text directly on the canvas; the template panel has no separate copy form. Applying a template rebuilds its layout from the current canvas copy and retains separately added elements; undo restores the previous layout. Editing individual elements preserves the existing layout.

AI uses the shared assistant sidebar, with no separate AI panel in the poster workspace. ACP, external MCP and the built-in assistant share the poster tools. This feature does not generate AI images.

## AI design tools

- `get_poster_capabilities` discovers the editor's shared font and platform catalogs, selectable browser design templates, supported server templates, editable fields, operation limits and rendering availability. Browser template IDs and the four basic server template IDs are separate capabilities; their layouts are not interchangeable.
- `create_poster_memo` creates valid editable source from concise copy and a basic template. `list_memos` and `search_memos` accept `poster: true`; `get_poster` returns canvas geometry and element IDs.
- `update_poster` requires the revision returned by `get_poster` and supports `dryRun`. `edits` includes font family/style, underline, line height, character spacing, visibility, image crop/flip, shapes, strokes, shadows and gradients. Set optional shadow, gradient, crop or badge to `null` to remove it. Image references must be active image resources belonging to this same note.
- Ordered `operations` add, remove or duplicate elements; reorder layers; group/ungroup; align unrotated elements to the canvas; and explicitly lock/unlock elements. Edits run before operations, so unlock in an earlier call before patching a locked element. Operations can explicitly unlock before a later operation in the same call. `canvas` optionally scales elements; `platform` uses a shared platform preset. Scaling locked elements is rejected.
- `operations: [{op: "apply_template", template: "bold"}]` replaces **all** elements with a basic server template, preserving the main copy. It requires an explicit template-change request and rejects locked elements. Unlike the browser editor's template application, this operation does not retain separately added decorations.
- `get_poster_preview` returns the current saved preview as actual image content for MCP and multimodal assistant tools. Edits invalidate its reference. Missing previews report `browser_render_required`; the tool does not render a new image. `export_poster` exports editable JSON source or the current saved preview, not a full-resolution re-render. Preview reads require `read:resources` as well as `read:memos` and are limited to 4 MiB. Fresh rendering is delegated to online desktop/Web clients with their bundled fonts; the server never runs Fabric.
- `request_poster_render` queues a fresh PNG preview (long edge up to 1600 px, at most 4 MiB); optional `templateId` applies a full design template and retains separately added decorations, matching the editor. Requires `write:memos` and `write:resources`; pass the revision from `get_poster`. The server notifies signed-in desktop/Web workspaces over WebSocket. Clients check the queue on connection and reconnection and render without opening the poster. `get_poster_render_job` reports pending/rendering/completed/failed; only completion confirms rendering. No online client means waiting, with pending expiry at 10 minutes and claimed expiry at 2 minutes. Claims are exclusive across clients; saving checks both the lease and memo revision atomically. Conflicts never overwrite newer source. Locked elements prevent template changes. Completed/failed tasks are retained for seven days and cleaned when new tasks are requested. Full-resolution PNG/JPEG/WebP export remains available in the editor.
- `trash_memos` moves exact queried IDs into the recycle bin; `restore_memos` restores them. Ordinary `update_memo` can update metadata but cannot replace poster content.

## Source and persistence

`PosterDocument` is validated, versioned source, separate from Fabric.js state. An `edgeever-poster-v1` Markdown comment carries it; readable text and a PNG preview provide a portable fallback. Image elements reference existing workspace attachment IDs; arbitrary URLs and arbitrary Fabric object JSON are not accepted. The rendering engine loads only when entering the poster editor.

Saving uses the existing note revision, content hash and edit session checks. Each artwork version gets an immutable preview up to 480 pixels wide; metadata-only changes reuse it. Historical previews are retained for revision restores. This increases attachment usage with the number of saved artwork versions. Failed source saves remove only the newly uploaded, uncommitted preview.

Drafts are backed up on the current device. A draft based on a different note version must be downloaded and reconciled rather than silently overwriting the current note. Uploading images and saving a new preview require a network connection; offline edits remain local drafts. Inserting into the source note checks its current revision and creates an attachment owned by that note.

## Compatibility and rollout

Android and iOS show the readable preview and text and disable ordinary rich-text editing of poster notes. The API also rejects legacy saves that would strip a poster envelope. This guard requires the updated server. Earlier clients connected to an earlier server do not have that protection. Generic MCP `update_memo` cannot replace poster content.

No database migration or authentication/update configuration is needed. To roll back the UI, remove the create/edit entries while retaining source, attachments and reader protection. Do not convert posters into ordinary notes or delete the source marker.

Deploy the updated server before updating desktop clients. Cloudflare deployment creates the poster notification Durable Object through the tracked Wrangler migration. Docker reverse proxies must forward WebSocket upgrades for `/api/v1/poster-render/events`.

Verification covers source round trips, format validation, preview save failures, revision conflicts and legacy contentJSON overwrite attempts in SQLite, native reader policy, and local Web creation/edit/save/reopen/export and source-note insertion. Native hardware, installed desktop cross-version flows and paid AI image generation require separate release validation; this feature does not implement image generation.

For the browser rendering regression harness, run `bun run dev` and open `/tests/poster-design.html`. It checks every template on all 12 platform presets, source round trips, multi-selection geometry and AI text contrast.
