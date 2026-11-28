# Base: reorder columns in the fields panel, resize by dragging the header edge

## Problem and goal

Reordering columns used to require opening the "Fields" dialog and nudging rows with the up/down buttons; column width could only be typed into a number input.

After comparing with Feishu the split is: **column order, visibility and editing live in the fields panel** (drag a row to reorder, click a name to edit, untick to hide) and the **header does not drag to reorder**; width is changed by dragging the header's right edge, which is what the Feishu grid does too, so the panel no longer carries a width input for the base editor.

## Allowed changes and acceptance

- The `fields` mode of `apps/web/src/components/TableViewControls.tsx` is now a row list: drag grip (`data-testid="field-panel-grip"`), visibility checkbox (labelled with the field name, disabled on the primary field), field-type icon, field name, and - only for the single-table editor - the width input.
- The grip and the trailing pencil stay invisible until the row is hovered (`opacity-0` -> group hover), and the whole row uses `cursor-grab`.
- Anywhere on a row starts a drag: empty space, the icon or the name (checkbox, width input and pencil are excluded). `pointerdown` attaches `pointermove` / `pointerup` on `window`, the drop row is resolved from each row's vertical centre, and the source column is spliced in on release. The primary field always stays first.
- A press that moves less than 4px counts as a tap: the native click is swallowed by `preventDefault`, so `pointerup` decides between reorder and edit and a tap opens the field dialog (rename, type, option colours). Keyboard activation of the name still works.
- A field dialog opened from the panel returns to the panel on both cancel and confirm (`BaseEditorPane` bumps `fieldsPanelSignal`) instead of dropping the user back on the grid.
- `apps/web/src/components/base/BaseTableGrid.tsx` loses the drag handle and `dragstart`/`drop` wiring. The right-edge resize handle stays (`role="separator"`, `aria-label="Resize the {{name}} column"`, `data-testid="column-resize-handle"`), previewing during the drag and committing once on release.
- `packages/shared/src/table-view.ts` keeps `setTableViewColumnWidth(fields, view, fieldId, width)` (rounded, clamped to 80-600, returns the input object for invalid values) and drops `moveTableViewColumn`; ordering now happens in the dialog's draft array and is committed when "Apply" is pressed.
- i18n gains `fieldsHint`, `resizeColumn`, `tableErrors`, `editField` and loses `moveColumnLeft`, `moveColumnRight`, `moveUp`, `moveDown` in all nine catalogs.
- Column order and width are still stored per view in `columns` (`BaseEditorPane.commitActiveView` -> `saveTableViews`), behind the local-first queue and the revision/contentHash/editSession conflict guard.

## Unchanged

The stored format is untouched (`edgeever-base-v1:` with nested `edgeever-table-v1:`), there is no new D1 table or migration, and `schemaVersion` stays 4. Filters, sorts, grouping, the five layouts, the record panel, CSV, undo/redo and option colours are untouched. The single-table editor keeps its width input and inline header editing.

## Verification

- `bun run typecheck`, `bun run typecheck:mobile`, `bun run lint` (0 warnings / 0 errors) and `bun run build:web` pass.
- Shared tests: `table.test.mjs` `describe("view column width")` covers clamping and unknown fields; i18n 8 pass.
- `tests/e2e/structured-table-header-controls.spec.ts` asserts there is no header drag handle, drags "Tags" to the front inside the fields panel with a real mouse, applies it, and checks the header order and `view.columns` on the server, then renames "Due" through the panel, hides "Tags", drags a header edge to 220px, and verifies order/name/hidden/width after a reload.
- Regression: `structured-table-base`, `structured-table-base-fields`, `structured-table-mvp`, `structured-table-virtual-grid`, `structured-table-image-preview` and `structured-table-option-colors` all pass.
- Not covered: touch dragging on mobile, auto-scroll while dragging past the list edge, bulk hiding.
