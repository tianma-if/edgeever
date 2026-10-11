# Poster notes

[简体中文](poster-notes.zh-CN.md)

Choose **More types → Poster (Beta)** to create an editable poster. In an ordinary note, choose **Create poster** from the note actions to create a separate poster using the title and selected text (or the first 240 characters of the body). The original note remains intact.

Web and desktop open a dedicated design workspace with 46 real templates adapted from Qiaomu Design's MIT-licensed layout engine, 12 platform presets, bundled licensed Chinese and Latin fonts, headline/subtitle/badge reflow, and actual rendered template previews. The template renderer and its attribution are in `apps/web/src/lib/poster-design`; font licenses ship alongside the font files. Generated raster grain is omitted when adapting vector templates.

The canvas supports text, badges, shapes, paths, freehand drawing and images; multi-selection, grouping, alignment, snapping, zoom and pan; layers, visibility and locking; typography, outlines, shadows, gradients and image fit/crop/flip. Export PNG, JPEG or WebP at 1×–3× (up to 8192 pixels per side), copy a PNG, or insert an exported image into the source note. Edit text directly on the canvas; the template panel has no separate copy form. Applying a template rebuilds its layout from the current canvas copy and retains separately added elements; undo restores the previous layout. Editing individual elements preserves the existing layout.

AI uses the shared assistant sidebar, with no separate AI panel in the poster workspace. The `get_poster` and `update_poster` tools let agents read the canvas and edit text, colors, typography and element positions through the existing agent action flow. Edits preserve unmentioned and locked elements and reject stale revisions. The editor regenerates the preview after an agent edit. This feature does not generate images.

## Source and persistence

`PosterDocument` is validated, versioned source, separate from Fabric.js state. An `edgeever-poster-v1` Markdown comment carries it; readable text and a PNG preview provide a portable fallback. Image elements reference existing workspace attachment IDs; arbitrary URLs and arbitrary Fabric object JSON are not accepted. The rendering engine loads only when entering the poster editor.

Saving uses the existing note revision, content hash and edit session checks. Each artwork version gets an immutable preview up to 480 pixels wide; metadata-only changes reuse it. Historical previews are retained for revision restores. This increases attachment usage with the number of saved artwork versions. Failed source saves remove only the newly uploaded, uncommitted preview.

Drafts are backed up on the current device. A draft based on a different note version must be downloaded and reconciled rather than silently overwriting the current note. Uploading images and saving a new preview require a network connection; offline edits remain local drafts. Inserting into the source note checks its current revision and creates an attachment owned by that note.

## Compatibility and rollout

Android and iOS show the readable preview and text and disable ordinary rich-text editing of poster notes. The API also rejects legacy saves that would strip a poster envelope. This guard requires the updated server. Earlier clients connected to an earlier server do not have that protection. Generic MCP `update_memo` cannot replace poster content.

No database migration or authentication/update configuration is needed. To roll back the UI, remove the create/edit entries while retaining source, attachments and reader protection. Do not convert posters into ordinary notes or delete the source marker.

Verification covers source round trips, format validation, preview save failures, revision conflicts and legacy contentJSON overwrite attempts in SQLite, native reader policy, and local Web creation/edit/save/reopen/export and source-note insertion. Native hardware, installed desktop cross-version flows and paid AI image generation require separate release validation; this feature does not implement image generation.

For the browser rendering regression harness, run `bun run dev` and open `/tests/poster-design.html`. It checks every template on all 12 platform presets, source round trips, multi-selection geometry and AI text contrast.
