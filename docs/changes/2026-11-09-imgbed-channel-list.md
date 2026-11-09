# ImgBed channel picker (desktop)

[简体中文](2026-11-09-imgbed-channel-list.zh-CN.md)

## Problem and result

Follows up [Issue #822](https://github.com/tianma-if/edgeever/issues/822) and [#823](https://github.com/tianma-if/edgeever/pull/823). The "Channel name" added in #823 had to be typed by hand and match the ImgBed admin panel exactly, which is easy to get wrong. A "Load channels" button now sits next to the channel name; it reads the channel list from ImgBed so a channel can be picked from a dropdown. Manual entry still works when the list cannot be read.

## Behavior

| ID | Behavior | Acceptance |
| --- | --- | --- |
| B01 | With the ImgBed address and API token filled in, the "Load channels" button next to the channel name (on the same row as the field) makes the desktop main process call `GET /api/channels` with that token, reusing the existing address validation, host safety check, timeout, no-redirect rule and response-size limit. Only the address and token are forwarded. | Desktop `imgbed.test.mjs`. |
| B02 | After loading, the field becomes a dropdown: "Not specified (ImgBed decides)" first, then the enabled channels under the selected upload channel in ImgBed's order, and a final "Type a name…" option switches to the text field at any time, keeping the current name; the loaded list is kept and the button becomes "Pick from list", so switching back makes no request. Switching the upload channel reuses the loaded list without another request. Changing the address or token discards the list and restores the text field; the address is parsed the way the main process does, so case, a default port, a trailing slash or `/upload` alone does not count as a change. While the list loads, the address, token, channel name, test and save are disabled, and a result is dropped if the address or token changed meanwhile. | Manual check (local web with a mocked bridge). |
| B03 | Only names EdgeEver can send back unchanged are listed: duplicates are removed, and names with edge spaces, control characters or more than 100 characters are left out; the number left out is returned so the settings page asks the user to rename them in ImgBed instead of saying there are no channels. | Desktop `imgbed.test.mjs`. |
| B04 | A saved name missing from the list shows as "<name> (not found)" with a prompt to pick again; an upload channel with no enabled channels is explained. | Manual check. |
| B05 | If loading fails, the text field and the typed name stay (a failed reload keeps the list loaded earlier), with the cause: the ImgBed version cannot list channels (404 or a web page), the token was rejected (401/403, the same message as in the connection test), or another failure (check the address and network). | Desktop `imgbed.test.mjs`; copy checked manually. |
| B06 | The connection test checks the name as in #823 and still writes the test image with `autoRetry=false`. Old ImgBed versions send both `IMGBED_CHANNELS_UNSUPPORTED:` and the earlier `IMGBED_CHANNEL_NAME:` marker, so a desktop app loading a web build of another version still recognizes them, and the new settings page also recognizes the unsupported error a #823 desktop host sends with only `IMGBED_CHANNEL_NAME:`; token rejection uses `IMGBED_TOKEN_REJECTED:`; the connection test then says "This ImgBed version does not support channel names", while a missing name still shows "Channel name not found". | Desktop `imgbed.test.mjs`. |

## Scope and limits

- Desktop only. The web app has no desktop bridge, so it hides "Load channels" and keeps manual entry.
- The list is read once per click and does not refresh itself; click "Load channels" again after adding or removing channels in ImgBed.
- The stored channel name is unchanged, so existing settings need no migration.

## Risk and rollback

Desktop settings page, preload and main process only, plus one read-only IPC handler. No changes to the upload path, server, API, storage or migrations. Rollback: revert this change; the channel name goes back to manual entry.

Not verified: reading the list from a real multi-channel ImgBed instance; the interaction inside the desktop (Electron) app, since layout and states were only checked in the local web app with a mocked bridge; German, Spanish, French, Japanese, Polish and Russian copy has not been reviewed by native speakers.
