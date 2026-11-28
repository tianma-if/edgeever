# Bitable base: several tables, five view layouts and 17 field types in one note

## Problem and goal

The single structured table covers lightweight entry, but a real Bitable-style workflow needs several tables in one document, one dataset rendered as grid/kanban/calendar/gallery/gantt, field types that cover progress/rating/currency style data, and per-view column visibility, widths and grouping. This adds a separate "base" document and editor for that, without touching the existing single-table `TableDocument` storage path, so shipped table notes cannot regress.

## Allowed changes and acceptance

- New base document model (`packages/shared/src/table-base.ts`): `schemaVersion: 4`, marker `edgeever-base-v1:` (marker first, readable Markdown after), up to 20 tables. Each table's `content` is an existing `edgeever-table-v1:` marker, so single-table parsing, serialization, CSV, views and view upgrades are reused instead of duplicated. Unparsable or mismatched versions return `null` and callers fall back to the single-table editor or Markdown.
- New web base editor (`apps/web/src/components/base/`): table list on the left (create/rename/delete, limit 20, collapsible to give the grid the width), title and save state, CSV export/import, add field, add record; the main pane reuses `TableViewControls` for view tabs plus filter/sort/fields/group dialogs. Layouts: grid, kanban, calendar, gallery, gantt — each view persists its column visibility and widths, grouping field and direction, and layout.
- Record interaction: virtualized grid (32px rows, index and action columns pinned, no wrapping status labels — a narrow pane scrolls horizontally instead), double-click or the row action opens a right-side record panel; the row context menu inserts a row above/below, duplicates a record, opens details and deletes. Undo/redo keeps 50 steps and binds `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z` and `Ctrl+Y`, leaving native input undo alone.
- Field types grow from 11 to 17: `createdTime`, `updatedTime`, `progress` (0–100), `rating` (0–5), `currency`, `percent` (stored 0–1, displayed as a percentage). The field dialog lists all 17 types grouped as standard/business/advanced with a search box, group headings and field-type icons, and filters as you type. Select and multiSelect options carry custom colours (`TABLE_OPTION_COLORS`, nine tones, persisted in `optionColors`; options without an explicit colour fall back to a stable hash).
- System time fields are computed in the shared layer (`packages/shared/src/table-base-compute.ts`): `computeTableBase(base)` fills read-only `createdTime`/`updatedTime` cells from `createdAt`/`updatedAt` and renders them as `YYYY-MM-DD HH:mm` in the browser's local timezone. Computed cells are never persisted — writes are rejected — and the editor renders them read-only in the grid and in the record panel.
- Compatibility: single-table notes still open in `TableEditorPane`; only `hasTableBaseDocumentMarker` notes open the base editor. "New table" now creates a base holding one default table. The public form API whitelists field types so system fields such as auto-number, created time and updated time never leak to anonymous forms. Plugin API types were extended for the new field types and `/api/health` reports the current table schema version.

## Unchanged

Storage is still a base64url JSON marker inside memo content: no new D1 tables, no row-level permissions, comments, automations or collaboration; tables never reference each other and each base stays inside one memo. Limits stay at 40 fields / 2,000 records per table and 20 tables per base. Saving keeps the revision/contentHash/editSession conflict protection and the 30-second local-first queue. Mobile still degrades structured tables to read-only tables.

## Verification

- `bun run typecheck`, `bun run typecheck:mobile`, `bun run lint` (0 warnings / 0 errors) and `bun run build:web` all pass.
- Shared tests: `table.test.mjs`, `table-base.test.mjs` and `table-base-compute.test.mjs` — 44 tests / 262 assertions, all pass; the i18n catalog suite (8 tests, nine locales, order-sensitive) passes.
- Browser E2E (seven specs, all pass): `structured-table-base.spec.ts` (table switching, create/rename, grouping, kanban, record panel, row menu CRUD with undo/redo, reload persistence), `structured-table-base-fields.spec.ts` (currency/progress/rating/percent/time rendering, field dialog retyping and field creation), `structured-table-option-colors.spec.ts` (option colours persist and match the kanban lane dots), `structured-table-header-controls.spec.ts` (fields panel drag reorder, tap to edit, hide a column, header-edge resize), `structured-table-image-preview.spec.ts` (covers and thumbnails go through the downscaled preview), `structured-table-mvp.spec.ts` and `structured-table-virtual-grid.spec.ts`.
- Not covered: Windows installer and desktop shell, remote Cloudflare D1, mobile read-only base rendering, option colours on the public form, the 180-day record-history policy.

## 后续修复 / Follow-up fixes

- 2026-11-25: kanban/gallery covers and grid thumbnails now render a downscaled preview (`apps/web/src/lib/image-preview.ts` + `apps/web/src/components/table/ResourceImage.tsx`), which removes the long tasks a 20 MB cover caused on hover; see `2026-11-25-structured-table-image-preview.md`.
- 2026-11-25: removed relation/lookup/formula fields and the whole dashboard set on user feedback and switched system time fields to the local timezone; see `2026-11-25-structured-table-simplify.md`.
- 2026-11-25: custom option colours and a working Gantt view (records no longer disappear when they have no date); see `2026-11-25-structured-table-option-colors.md`.
- 2026-11-25: column order moved into the fields panel (drag a row, click a name to edit) while the header keeps only the edge-resize handle; see `2026-11-25-structured-table-header-controls.md`.
