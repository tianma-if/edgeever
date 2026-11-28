# Review follow-up: structured base storage guard, view stability, form eligibility and narrow screens

## Problem and goal

The first review of the structured base pull request found four issues, plus a gap the
author reported separately:

1. **Storage guard (P1).** `memo-service` only recognised the single-table marker. A base
   wraps its tables in a new encoded document, so a legacy client that saved back the
   markdown fallback silently replaced the whole base with plain text.
2. **View stability (P2).** `updateTableField` reset a saved kanban whenever the edited
   field id differed from the grouping field, so renaming an unrelated text column threw
   the board away.
3. **Form eligibility (P2).** The public form rendered only submittable fields but the
   submission path skipped just `autoNumber`, so a required `createdTime` / `updatedTime`
   saved in the form settings rejected every submission.
4. **Narrow screens (P2).** The table list was hidden below `md`, leaving multi-table
   bases with no way to reach the other tables.
5. **Mobile reader.** The mobile app treated a base as ordinary rich text, so editing it
   saved the fallback markdown and lost the base.

The goal is to keep all five paths consistent with the single-table behaviour that already
exists and to verify them with tests that fail without the fix.

## Allowed changes and acceptance

- `packages/shared/src/table-base.ts` gains `stripTableBaseDocumentMarker` and
  `listTableBaseAttachmentResourceIds`; only new exports, no schema change.
- `packages/shared/src/table.ts` narrows the kanban reset to "the grouping field is gone or
  is no longer a single select".
- `apps/api/src/memo-service.ts` rejects a save that would drop an existing base
  (`table_base_update_required`, 409) or that carries a broken base marker
  (`invalid_table_base`, 400), and recycles attachments released by removed tables.
- `apps/api/src/mcp-tool-service.ts` refuses to replace base content through `update_memo`.
- `apps/api/src/table-form-service.ts` exports `tableFormFieldIsSubmittable` and both the
  renderer and the submission path use it.
- `apps/web/src/components/base/BaseEditorPane.tsx` adds a compact table picker below `md`.
- `apps/mobile/src/lib/mobile-diagram.ts` projects a base to its per-table markdown and the
  detail screen keeps it read-only, matching single-table notes.

Acceptance: legacy saves cannot destroy a base, unrelated field edits keep the saved view,
a form whose saved field became a system field still submits, a phone viewport can switch
tables, and the mobile reader shows every table without exposing the marker.

## Unchanged

- The single-table marker, its guard, and its public form behaviour.
- The base document schema (`schemaVersion: 4`) and every existing key.
- Base editing stays web-only; mobile remains read-only for structured content, as it
  already was for single-table notes.

## Verification

- `bun run lint` – 0 warnings, 0 errors (1865 files).
- `bun run typecheck`, `bun run typecheck:mobile` – clean.
- `bun run build:web` – success.
- `bun test packages/shared/src/table*.test.mjs apps/api/src/table-form-*.test.mjs apps/api/src/database-write-optimizations.test.mjs apps/mobile/src/lib/mobile-diagram.test.ts packages/shared/src/i18n` – 102 pass / 0 fail.
- `bun run test:bulk` – 6049 pass / 5 fail; the five failures are the pre-existing local
  environment baseline (three web-clipper store checks that depend on the checkout path, one
  English-catalog test that breaks on a non-ASCII workdir, one Electron helper test without
  Electron installed).
- Playwright (Chrome channel): `structured-table-base`, `-base-fields`, `-narrow`,
  `-mvp`, `-option-colors`, `-header-controls`, `-image-preview` and `-virtual-grid` all pass.

Not verified: the reviewer's cross-version edit/upgrade/rollback scenario against a real D1
deployment and the Docker SQLite build; it needs a deployment with both client versions.
