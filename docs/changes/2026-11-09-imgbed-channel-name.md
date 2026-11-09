# ImgBed channel name (desktop)

[简体中文](2026-11-09-imgbed-channel-name.zh-CN.md)

## Problem and result

Fixes [Issue #822](https://github.com/tianma-if/edgeever/issues/822). CloudFlare ImgBed can hold several channels of the same upload type (for example two Cloudflare R2 buckets or several S3 providers) and picks one through the `channelName` parameter of its upload API. EdgeEver's built-in ImgBed host only sent `uploadChannel`, so images always went to whichever channel ImgBed chose by default (the first one unless load balancing is on), and users could not pick another. "Settings → Image host → CloudFlare ImgBed" now has an optional "Channel name".

## Behavior

| ID | Behavior | Acceptance |
| --- | --- | --- |
| B01 | "Channel name" is optional text of up to 100 characters; leading and trailing spaces are removed when saving (inner spaces are kept). When set, uploads and the connection test send `channelName=<name>` and `autoRetry=false`, so a failed write on the named channel is reported instead of ImgBed retrying on another channel and returning that storage's link; when empty the parameter is omitted and requests are unchanged. | Desktop `imgbed.test.mjs`. |
| B02 | The settings page flags a name with tabs, line breaks or other control characters and disables the connection test; the main process validates again and rejects a non-string name, one with control characters anywhere (including the edges), or one longer than 100 characters after trimming before any request. Both sides apply the same rule. | Desktop and web `imgbed.test.mjs`. |
| B03 | The channel name is part of the connection target: changing it requires a new connection test before saving; changing only edge spaces does not count. Settings saved by older versions have no such field and read as empty. | Reading old settings: web `picgo.test.mjs`; re-test before saving: manual check. |
| B04 | The settings page explains that the name must match the channel name in the ImgBed admin panel exactly, and that ImgBed chooses the channel itself when it is empty or not found. | Manual check. |
| B05 | When a channel name is set, the connection test first calls ImgBed's `GET /api/channels` with the same token (it shipped in the same ImgBed release as `channelName` and accepts any valid token) and checks that the selected upload channel has an enabled channel with exactly that name (case-sensitive) before uploading the test image. If the name is missing, or ImgBed is too old (the endpoint is missing and returns 404 or a web page instead of JSON; such versions do not support `channelName` either), the test fails with "Channel name not found" and no test image is uploaded, so a name that ImgBed would silently ignore cannot be saved. Other failures (network errors, timeouts, 401/403, 429, 5xx, oversized replies) keep the existing connection or token messages and are not blamed on the channel name. | Desktop `imgbed.test.mjs`. |

## Scope and limits

- With an empty name `autoRetry` is not sent, so ImgBed keeps its default cross-channel retry. `autoRetry=false` only turns off retries after a failed write.
- The name is only checked by the connection test. If the channel is later renamed, disabled or deleted in ImgBed, ImgBed silently falls back to its default channel and the upload response does not say which channel was used; run the connection test again in that case.
- The channel name is typed by hand; there is no dropdown filled from ImgBed yet.

## Risk and rollback

Only the desktop renderer settings, upload parameters and main-process validation change. No server, API, storage or migration changes. With an empty channel name the request is identical to before, and existing ImgBed settings need no migration. Rollback: clear "Channel name", or revert this change.

Not verified: uploads against a real multi-channel ImgBed instance; interactive checks on the Windows and Linux desktop apps; Japanese, Polish, Russian, German, Spanish and French copy has not been reviewed by native speakers.
