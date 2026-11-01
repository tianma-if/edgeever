# Expiry and open counter for single-note share links

[简体中文](2026-11-01-memo-share-expiry-views.zh-CN.md)

## Problem and outcome

Implements [Issue #607](https://github.com/tianma-if/edgeever/issues/607). A single-note share link stayed public until the owner remembered to revoke it, and the owner could not tell whether the link had been opened. The owner can now give a link an optional expiry and see how often it was opened. Shares without an expiry behave exactly as before.

## Behavior

| ID | Behavior | Acceptance |
| --- | --- | --- |
| E01 | Migration `0087` adds `memo_shares.expires_at` (UTC ISO, `NULL` = never), `view_count` (default 0) and `last_viewed_at`. Existing rows keep their token, password, address and presentation settings. | Migration test compares rows before and after. A self-hosted data directory and a local D1 database created on the previous version, each with a password-protected share, upgrade without changes to the share. |
| E02 | `PATCH /api/v1/memos/:id/share` accepts `expiresAt` (ISO instant with an offset, or `null`) next to the existing fields. It is normalized to UTC; a past instant returns 400 `share_expiry_invalid`. An expiry-only request does not touch the password. Older clients that send only `{ passwordProtected }` keep working. | API tests cover set, normalize, extend, remove, past, malformed and empty payloads, and a password kept across expiry changes. |
| E03 | The server alone decides expiry. After it, note content (`GET /api/public/shares/:token`), password unlock and shared attachments answer `410 share_expired` without the title or content, distinct from `404` for revoked or unknown links. `/share/<link>.md` answers 410 with a short message, and the server-rendered page leaves the note out. An expired note is not linked from other shared notes. | API and share-page tests cover all four paths, the 404 case and linked notes. |
| E04 | The owner still sees an expired share: reopening the dialog shows the expired state and does not create a new link. The owner can extend the expiry, remove it or revoke the share. | API test reads and re-posts an expired share; manual check in the running app. |
| E05 | `view_count` and `last_viewed_at` grow only when note content is served: the share API after the password gate, and the `.md` alternate. Password prompts, failed unlocks, expired links, attachment downloads, `HEAD` requests and the HTML shell (a browser counts once through the share API) do not count. No visitor data is stored. A view does not change `updated_at`, so the share list order is unaffected. A failed counter write never blocks reading. | API and share-page tests count each path. |
| E06 | The web share dialog has a "Link expiry" picker: no expiry, 1, 7 or 30 days, or a custom date that lasts until the end of that day in the owner's time zone. It shows the expiry, an expired notice, and "Opened N times · last on …". Settings → Shared notes shows the expiry or an "Expired" mark and the open count. The public page shows "This shared link has expired". Copy is in all shipped locales. | Rendering and unit tests; type check and web build; manual check of every state on the self-hosted server. |

Android and iOS ignore the new fields and keep working. Notebook shares are out of scope.

## Risk and rollback

Worst case: an owner relies on an expiry, and the application is rolled back to a version before this change. Older code ignores `expires_at`, so expired links become reachable again until this version is redeployed. The counter is approximate: two visitors opening the link at the same moment are both counted, while reloads and automated readers of the `.md` alternate also count. Rolling back leaves the additive columns in place; older code keeps working with them, which was checked with the previous version on migrated data. No existing migration is modified.
