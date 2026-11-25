# Bitable Base: custom option colors and a working Gantt view

## Problem and goal

In Feishu Bitable every single-select / multi-select option can carry its own color, and kanban lanes plus group headers reuse that color as a visual anchor. EdgeEver's Base rendered every option with the same gray pill, so statuses were indistinguishable at a glance. The Gantt view was also broken: the body printed the raw i18n key `structuredTable.emptyGrid`, and records without a date simply disappeared.

The goal is to add option colors as a detail that stays consistent across grid, kanban, group headers and the record panel, and to make the Gantt view usable.

## Allowed changes and acceptance

- Shared model (`packages/shared/src/table.ts`): `TABLE_OPTION_COLORS` (blue / teal / green / yellow / orange / red / pink / purple / gray), `TableOptionColor`, `TableField.optionColors`. `tableOptionColor(field, option)` prefers the stored color and otherwise hashes the option name to a stable color, so **existing documents need no migration** and immediately gain variety.
- Write-side validation: `normalizeTableField` and `parseField` drop keys that are not in `options` and reject unknown colors; `TableFieldPatch` accepts `optionColors`, and switching a field to another type drops the configuration.
- Field dialog (`apps/web/src/components/base/BaseFieldDialog.tsx`): the comma-separated option textbox became a row editor — swatch button with a nine-color palette, option name input, remove button, and an "Add option" footer. New options rotate through the palette by default.
- One palette everywhere: `apps/web/src/components/table/option-pill.tsx` exports `OptionPill` and `optionDotClassName`; grid cells, the multi-select dropdown, kanban cards, grid group-header dots, kanban lane dots and the record panel all read the same `OPTION_TONES`.
- The record panel single-select became a pill button with a dropdown menu (color dot per option, plus a clear item); multi-select keeps checkboxes but renders colored pills.
- In the Base editor the field header menu now only offers "Configure field" and "Delete field"; name, type, options and colors live in the dialog. The single-table editor (`TableEditorPane`) keeps inline editing because it has no color configuration.
- Gantt fixes (`apps/web/src/components/base/BaseViews.tsx`): empty state uses `structuredTable.noCards`; every record is listed and undated ones are tagged "Not scheduled" instead of vanishing; a hint explains how records get scheduled; month headers read `2026-11`; the day width dropped from 32px to 24px so a narrow editor still shows two more weeks.
- i18n gained `optionColor`, `optionColors.*` (nine names), `addOption`, `optionName`, `removeOption`, `editOptions`, `clearValue`, `selectPlaceholder`, `ganttDays`, `ganttUnscheduled`, `ganttHint` in all nine languages, and `fieldOptionsLabel` no longer says "comma separated".

## Unchanged

Storage is still the base64url marker inside memo content (`edgeever-base-v1:` / `edgeever-table-v1:`) with no new D1 tables or migrations, and `schemaVersion` stays 4. Five view layouts, column visibility and widths, filters/sorts/groups, record panel, row context menu, undo/redo, CSV import/export and the cover-preview cache are unchanged; saves still go through revision / contentHash / editSession protection and the local-first queue.

## Verification

- `bun run typecheck`, `bun run typecheck:mobile`, `bun run lint` (0 warnings / 0 errors, 1864 files), `bun run build:web` all pass.
- Shared tests: `table.test.mjs` gained four "select option colors" cases (round-trip, hash fallback with explicit override, cleared on type change, malformed stored data dropped) — 32 pass / 153 expect; i18n 8 pass.
- New E2E `tests/e2e/structured-table-option-colors.spec.ts`: grid pills render stored colors (purple / orange), recoloring through the field dialog to blue survives a reload, the three kanban lanes use purple / orange / blue dots, and the Gantt view shows one scheduled plus two unscheduled rows with the "Not scheduled" tag.
- Regression E2E: `structured-table-base` (26.8s), `structured-table-base-fields` (12.3s), `structured-table-mvp` (24.5s) pass; `structured-table-virtual-grid` and `structured-table-image-preview` pass separately.
- Not covered: the public form page and the mobile read-only view do not render option colors yet; the palette has no contrast validation; the per-field option limit remains 50.
