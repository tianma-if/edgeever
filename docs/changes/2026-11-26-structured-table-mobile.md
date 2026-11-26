# Mobile layout for the structured base

## Problem and goal

Below `md` the web client switches to the phone shell, but the base editor kept its desktop
chrome. The header row and the view toolbar were both `overflow-x-auto`, so on a 390px
screen the title, save state, filters and field tools slid out of view; row actions only
appeared on hover, so a touch user could not open the record panel; dialogs could grow
past the viewport and clip their own buttons.

Feishu's mobile Base keeps a single-line title bar and moves every tool into menus and
sheets. The goal is the same rule for us: **basic controls must always fit the screen**,
and only the table body may scroll sideways.

## Allowed changes and acceptance

- New `apps/web/src/hooks/useCompactViewport.ts` exposes `useCompactViewport()` for the
  `(max-width: 767px)` media query. No global CSS changes.
- `apps/web/src/components/base/BaseEditorPane.tsx` renders a two-row compact header below
  `md`: back, title and a `⋯` menu (add field, add record, export/import CSV, refresh,
  undo/redo); then the table picker, the view picker, the save state or record count, the
  filter toggle and the tools button. The desktop header is untouched.
- The tools button opens a bottom sheet with the five layouts and the four field tools
  (fields, filter, group, sort). `TableViewControls` accepts `compact` and then renders only
  its dialogs, so no second toolbar can scroll.
- `ViewDialog` and `BaseFieldDialog` are capped with `max-h-[calc(100dvh-…)]` and scroll
  their own content on small screens.
- `BaseTableGrid` / `BaseKanban` accept `compact`: the row number becomes a button that opens
  the record panel, the row actions stop being hover-only, and tapping anywhere on a kanban
  card opens the record. `BaseRecordPanel` gains `overlay` and covers the grid below `md`.
- `structuredTable.more` and `structuredTable.tools` are added to all nine catalogs.
- `tests/e2e/structured-table-narrow.spec.ts` gains a phone test that asserts no element
  outside the grid body scrolls horizontally, walks the tools sheet, edits a field and
  returns to the fields panel, switches to kanban, and opens the record panel from both a
  card and a row number.

Acceptance: at 390px the header and every toolbar fit without sideways scrolling, every
desktop action has a touch entry point, and the desktop layout does not change.

## Unchanged

- The desktop header, toolbar, keyboard shortcuts and save pipeline.
- The grid body keeps horizontal scrolling on phones, matching the Feishu mobile app.
- The base schema (`schemaVersion: 4`), every stored key, and the single-table editor.
- Field permissions, guards and API behaviour.

## Verification

- `bun run typecheck`, `bun run typecheck:mobile` – clean.
- `bun run lint` – 0 warnings, 0 errors (1866 files).
- `bun run build:web` – success (`dist/sw.js` generated).
- `bun run test:bulk` – 6049 pass / 5 fail; the five failures are the pre-existing local
  environment baseline (three web-clipper store checks that depend on the checkout path, one
  English-catalog test that breaks on a non-ASCII workdir, one Electron helper test without
  Electron installed).
- Playwright (Chrome channel): `structured-table-base`, `-base-fields`, `-narrow` (2 tests),
  `-mvp`, `-option-colors`, `-header-controls`, `-image-preview` and `-virtual-grid` pass.

Not verified: physical iOS/Android browsers and the React Native app; the change is scoped to
the web client's compact layout.
