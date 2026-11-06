# Two-line compact note list

[简体中文](2026-11-06-compact-memo-list.zh-CN.md)

Related Issue: #802

## Problem and outcome

The **Compact list** kept three lines per note and was at least 76 px high, because the stacked hover buttons set the row height. It looked almost like the **Preview list** (132 px).

Compact rows now have two lines:

1. Pin and type icon, the title, and the date aligned right.
2. A one-line summary (the excerpt, or the counts for diagrams and tables, or the poster or infographic name), with up to two tags.

The **More actions**, **Restore** and **Delete** buttons appear on hover as a small horizontal toolbar over the right edge of the row and no longer change its height. A compact row is about 52–60 px high. On an 800 px window, the compact list shows 12 notes, compared with 5 in the preview list.

The preview list is unchanged. Only `MemoCard.tsx` changes; the stored preference (`edgeever.memoListDensity`) keeps its values.

## Verification

- New Playwright spec `tests/e2e/memo-list-density.spec.ts`, added to the browser CI job. It checks that:
  - the preview row is at least 120 px high and the compact row at most 60 px;
  - the title and the date share the first line;
  - the excerpt and two of three tags are shown;
  - hovering shows the actions without changing the row height.
- The existing `memo-sort-preference` and `notebook-appearance` specs pass.

## Rollback

Revert `MemoCard.tsx`. No data or settings change.
