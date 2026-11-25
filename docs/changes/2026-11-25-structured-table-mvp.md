# Structured table MVP: field types, view layout, record details and CSV import

## Problem and goal

The structured table had a single view (filters + sorts) and 7 field types. Within its row and field limits it worked, but it lacked the minimum needed for everyday office data: grouping by select/checkbox/date, hiding or widening columns, a kanban view of the same records, editing one full record, and importing spreadsheet exports. The goal was to add those without changing how tables are stored (a JSON marker inside the memo body).

## Allowed changes and acceptance

- New field types: multi-select (`multiSelect`), phone (`phone`), email (`email`) and auto-number (`autoNumber`). Multi-select stores an array and serializes as `; `-separated CSV; phone and email validate against patterns and participate in filters; auto-number is never stored, renders the row number, and is hidden from forms and field configuration.
- View documents move to schema 3: `NamedTableView` gains `columns` (visibility, order, width 80–600), `groupBy` (`select`/`checkbox`/`date` only, asc/desc) and `layout` (`grid`/`kanban`). Schema 1/2 documents keep parsing; only configurations v1/v2 cannot express are written as v3, and older clients that cannot read v3 are refused by the server instead of silently dropping the configuration.
- The toolbar gains grid/kanban switching plus "fields" and "group" dialogs. The first field can neither be hidden nor moved up. An empty group clears grouping, kanban groups by a `select` field, and a table without a select field opens the group dialog instead.
- A record detail dialog edits one full record: auto-number and attachments are read-only, checkbox/select/multi-select use checkbox/select/checkbox-group controls, and other fields commit on blur. Both grid rows and kanban cards open it.
- New CSV import maps columns by field name and handles quoted cells, embedded commas/newlines and BOM. Auto-number and attachment columns are skipped and reported; unknown options, unknown columns, duplicate columns and invalid email/phone fail per row with a row number; more than 10M characters or the record limit is refused. CSV export writes only the columns visible in the current view.
- Public forms support multi-select, phone and email, never auto-number, and keep the existing memo update and conflict-retry path.

## Unchanged

Storage stays the base64url JSON marker inside a memo: no new tables, no cross-table relations, formulas, row-level permissions, comments or automation; limits stay at 40 fields / 2,000 records. Filters, sorts and view switching remain client-side. Autosave delay, edit sessions, revisions and the offline queue keep their semantics. Attachment fields and the read-only mobile fallback are untouched.

## Verification

- `bun run typecheck`, `bun run typecheck:mobile`, `bun run lint` and `bun run build:web` pass.
- `bun run test:bulk`: 6,008 pass / 5 fail. All five come from this machine (a non-ASCII working directory that Bun URL-encodes for spawned processes, and no Electron install); the same failures reproduce on a clean `origin/main` worktree.
- Six new shared-model tests in `packages/shared/src/table.test.mjs` (19 total): new field rendering and persistence, v3 layout persistence with older-client rejection, group ordering with empty lanes, CSV import (BOM, quotes, skipped auto-number, invalid email with row number), and CSV unknown-option/unknown-column/duplicate-column errors.
- New browser test `tests/e2e/structured-table-mvp.spec.ts` runs against the real API and Web app: hide a field and widen it, group by status, switch to kanban, open a kanban card to rename the record, switch back to grid, import two CSV rows, and reopen to confirm the configuration persisted. The existing `tests/e2e/structured-table-virtual-grid.spec.ts` (500-row virtualization, attachment upload, view switching) still passes.
- Not covered: Windows installer and the desktop app, a remote Cloudflare D1 instance, and the mobile input experience for the new field types (only type checks and the unchanged read-only fallback were verified).