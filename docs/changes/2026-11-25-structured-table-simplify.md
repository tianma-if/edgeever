# Base tables: drop link/lookup/formula fields and dashboards

## Problem and goal

The previous iteration brought relational power into the Base editor: single-direction links, lookups, formula fields, and a dashboard with aggregated charts. In practice that meant users had to learn cross-table references, lookup semantics, and a formula syntax before they could enter a single row. The feedback was to cut the complexity: one Base, simple fields, fast views.

The goal is a subtraction pass: remove links, lookups, formulas, and the whole dashboard, leaving a Base of several independent tables with five views, without breaking existing notes.

## Allowed changes and acceptance

- Field types drop from 20 to 17: `link`, `lookup`, and `formula` are gone; `text`, `number`, `checkbox`, `date`, `select`, `multiSelect`, `url`, `phone`, `email`, `attachment`, `autoNumber`, `createdTime`, `updatedTime`, `progress`, `rating`, `currency`, and `percent` stay. The advanced group of the add-field picker now only offers created/updated time.
- Shared layer: `packages/shared/src/table-formula.ts` and its test are deleted; `table-base-compute.ts` shrinks to filling the system time fields while keeping `computeTableBase(base)` / `computeTableRecords(base, tableId)` and the `{ tables, errors }` shape.
- `packages/shared/src/table.ts` drops `TableFieldLink`/`TableFieldLookup`/`TableFieldFormula`, `TABLE_LINK_LIMIT`, `TABLE_FORMULA_EXPRESSION_LIMIT`, the three cleaners, `cleanLinkValues`, `computedCellDisplayText`, and every type branch; `TABLE_COMPUTED_FIELD_TYPES` keeps only `createdTime`/`updatedTime`; `TableFieldPatch` narrows to `name`/`type`/`options`.
- `TABLE_VIEW_OPERATORS` loses the three empty-value operators, `table-operations.ts` loses the link cell validation, and the plugin API's `PluginTableFieldType` narrows accordingly.
- Dashboards are removed end to end: `table-dashboard.ts`, `BaseDashboard.tsx`, and `structured-table-dashboard.spec.ts` are deleted; `TableBaseDocument` no longer has `dashboards`, and old documents containing it still parse (the key is ignored); the sidebar lists tables only.
- System time fields now render in the viewer's local timezone as `YYYY-MM-DD HH:mm`. Previously the ISO UTC digits were shown verbatim, which is 8 hours off for users in China. Unparsable values fall back to the raw text.
- All nine i18n catalogs drop the matching keys (relation/lookup/formula labels and errors, the three type names, and the 29 dashboard keys) while keeping the same key order as en-US.
- Compatibility: notes that already contain `link`/`lookup`/`formula` fields lose those fields on parse (unknown types are dropped), other fields and records are untouched, and a stored `dashboards` key is ignored. Single-table notes (`edgeever-table-v1:`) are unaffected.

## Unchanged

Storage remains a base64url JSON marker inside the memo, with no new D1 table or migration. The five views, column visibility and widths, filter/sort/group, record panel, row context menu, 50-step undo/redo, CSV import/export, and the downscaled cover previews all stay. Saving still uses revision/contentHash/editSession protection with the local-first queue.

## Verification

- `bun run typecheck`, `bun run typecheck:mobile`, `bun run lint` (0 warnings / 0 errors across 1863 files), and `bun run build:web` pass.
- Shared tests pass: `table.test.mjs`, `table-base.test.mjs`, `table-base-compute.test.mjs`, and the i18n catalog suite (including new cases for "system time values are never persisted" and local-timezone rendering).
- Playwright: `structured-table-base-fields.spec.ts` was rewritten to cover currency/progress/rating/percent/created-time rendering, the absence of link/lookup/formula in the type picker, adding a rating field, converting a percent field to currency, and persistence after reopening; `structured-table-base.spec.ts`, `structured-table-mvp.spec.ts`, `structured-table-virtual-grid.spec.ts`, and `structured-table-image-preview.spec.ts` also pass.
- Not covered: Windows installer and desktop builds, remote Cloudflare D1, mobile read-only Base rendering, and a migration hint for notes that still contain the removed field types.
