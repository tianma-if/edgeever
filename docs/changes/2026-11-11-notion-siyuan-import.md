# Notion and SiYuan Markdown imports

[简体中文](2026-11-11-notion-siyuan-import.zh-CN.md)

Related #794. Extends the unified importer used by flomo in #834: the same source picker, Worker/index, preflight, destination selection, chunked upload, progress, cancellation and retry executor. No new import endpoint, database migration or independent import UI.

## Scope and behavior

- Notion: official Markdown & CSV ZIP or extracted directory. Opening headings supply titles; front matter retains precedence. Strip trailing Notion IDs from display names only, preserving path identity for distinct same-name folders. Keep CSV bytes as attachments; unreferenced CSV files receive attachment notes. Do not rebuild database relations, formulas or views.
- SiYuan: official Markdown ZIP or extracted directory, including assets. Resolve `assets/` against the nearest ancestor export directory. Markdown files inside assets remain attachments. Normalize HTML images/audio/video with the shared inert HTML converter, excluding code examples and front matter.
- Original inter-note and SiYuan block links remain unchanged with warnings. Missing attachments and unreferenced nested ZIP/.sy sources block preflight. Other unused files are reported as warnings. Exported timestamps are used only when present as supported metadata; absent timestamps use existing import-time behavior.
- New tasks create new notes; retries within one task retain identity and recover unfinished uploads. CSV remains downloadable with original bytes. No server-side export fetching or source account integration.

## Risk and rollback

Import can lose unsupported source semantics; warnings and documentation must remain explicit. Shared-session changes may regress existing sources. Revert the feature to stop new imports; a code rollback cannot remove already imported data. Existing imports must not be overwritten. No production deployment is part of this change.

## Validation

Based on upstream `94813fe7e7685eae94b662414248f72be8a307fa` text snapshots, SHA-verified through the GitHub connector because local Git networking was unavailable.

- `bun test packages/shared/src/note-import apps/web/src/lib/note-import tests/markdown-export-import.integration.test.mjs`: 49 passing tests. Includes real API handlers, temporary SQLite and filesystem attachments; verifies ZIP scanning, CSV bytes, HTML media, missing-attachment preflight, unsupported servers, failed upload recovery, same-task deduplication and new-task duplication.
- Existing `tests/note-import.integration.test.mjs`: 78 passing cases using a temporary harness replacing only the listening HTTP server with direct API dispatch and transport Content-Length handling. Covers existing sources and bundled real-export fixtures. The unchanged HTTP suite could not run because localhost listen is unavailable; do not treat the harness as browser or network validation.
- `bun run typecheck` and `bun run typecheck:mobile`: passed.
- `bun run build:web`: blocked by missing upstream `apps/web/src/assets/import-logos/flomo.png` in the local snapshot. The connector cannot retrieve this binary and local network access is unavailable. The PR does not change or delete this asset.
- Not verified: browser UI/production Worker build, real Notion and SiYuan account exports, remote throughput and arbitrary large exports. Keep the PR in draft until those gaps are addressed.

Official format references: [Notion exports](https://www.notion.com/help/export-your-content), [SiYuan workspace assets](https://github.com/siyuan-note/siyuan/blob/master/docs/WORKSPACE.md), [SiYuan API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md).
