# Creation date for untitled notes

[简体中文](2026-11-06-untitled-note-date.zh-CN.md)

Related Issue: #813

## Problem and outcome

Every note without a title was labelled **Untitled note**, so several quick notes looked identical in the note list, the quick switcher and the note link pickers.

In the private workspace on web and desktop, untitled notes are now labelled with their creation date and time, for example `Untitled note · Nov 6, 2026, 2:32 PM`. The date follows the viewer's language and time zone. Where it appears:

- the note list (preview and compact);
- the quick switcher (search results);
- the note link picker and the `@` note suggestions.

The date is part of the label only. The stored title does not change, and a link inserted from a picker keeps the plain untitled text. When the creation time is missing or invalid, the plain label is shown.

**Settings → General → Date for untitled notes** chooses the format: Default, Short, Long, ISO 8601 (`2026-11-06 14:32`), Date only, or Off (the plain label). Each option shows an example. The choice is stored in this browser or desktop app (`edgeever.untitledMemoDateFormat`) and is not synced.

Public share pages, notebook sites and Companion cards are unchanged.

## Verification

- Unit tests `apps/web/src/lib/untitled-memo-label.test.mjs` cover:
  - each format, in several languages and time zones;
  - missing and invalid timestamps;
  - real and default titles;
  - storing the preference, including when storage is blocked.
- `NoteLinkSuggestion.test.mjs` checks that an inserted link does not contain the date.
- New Playwright spec `tests/e2e/untitled-memo-date.spec.ts`, added to the browser CI job. It checks:
  - the list label in the default, ISO and Off formats;
  - the quick switcher label;
  - that the stored title is unchanged.

## Rollback

Revert the change. No data, migration or server change is involved; the stored preference is ignored by older versions.
