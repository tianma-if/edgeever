# Compact document outline

## Problem and goal

Nested outline entries consume about 25px per level in a 300px panel. Deep headings lose too much text space. Reduce the indentation to 12px per level while keeping the existing outline interactions.

## Allowed changes and acceptance

- Use one 12px depth offset for outline rows and position hierarchy guides independently of layout, without cumulative margins or negative-margin/width compensation.
- Preserve full-width active and hover backgrounds, aligned disclosure controls and leaf placeholders, and text truncation within the panel. Guides must stay centered under disclosure controls when the existing theme `font.size` token changes the root font size; depth indentation remains 12px.
- Verify H1–H6 headings, long heading text, sibling and skipped heading levels in the rendered local app. Exercise collapse/expand and heading navigation, and confirm the active row remains correct after scrolling.
- Run `bun run typecheck`, `bun run typecheck:mobile`, and `bun run build:web`. Reuse the passing hierarchy tests because the parser is unchanged.

## Unchanged boundaries

Do not change heading extraction, tree construction, note data, saving, synchronization, panel width, visibility preferences, or native mobile implementations. No new dependency, input restriction, default, retry, or fallback is introduced. Web and desktop share the changed presentation component.

## Risk and rollback

The main risk is misaligned guides or row backgrounds. Inspect the actual render and interactions before delivery. Revert the `EditorOutline.tsx` layout change to restore the previous presentation. Packaged desktop verification is not part of this local preview.

## Completion check

- Only the outline presentation component changed. Rows now use `depth * 12`; decorative guides no longer consume horizontal space and follow the existing disclosure control width across theme font sizes. The diff introduces no behavior outside the allowed list.
- Local browser checks passed: H1–H6 offsets are 0/12/24/36/48/60px, all row backgrounds are 292px wide in the unchanged 300px panel, and the long H6 title has 200px of text space with ellipsis. Sibling and skipped-level entries remain aligned. Collapse/expand, heading selection/navigation, and scroll tracking were exercised.
- Light and dark renders were inspected. A 20px theme root font reproduced a 3px guide offset; using half the existing rem-based control width corrected it to 0px, with 0px error also at the default 16px root font. The 12px depth offsets stayed unchanged.
- On contribution base `c80645f8`, focused lint, `bun run typecheck:mobile`, the outline hierarchy tests, and `bun run build:web` passed. Root `bun run typecheck` is blocked by existing errors at `apps/web/src/lib/note-print-pdf.ts:22` and `apps/web/src/note-print.ts:172`; the same errors were reproduced without this patch and appear in the [upstream baseline CI](https://github.com/tianma-if/edgeever/actions/runs/39724860542). These unrelated printing errors are not changed by this fix.

To reproduce the browser checks, run `bun run dev`, open a note containing nested H1–H6 headings, a long H6 title, and sibling/skipped-level headings, and expand the document outline. Check indentation, full-row backgrounds, truncation, collapse/expand, and navigation. Compare guide alignment at default and 20px theme root font sizes. Packaged desktop verification was not performed.
