# ImgBed channel picker (desktop)

[简体中文](2026-11-09-imgbed-channel-list.zh-CN.md)

## Problem and result

Follows up [Issue #822](https://github.com/tianma-if/edgeever/issues/822) and [#823](https://github.com/tianma-if/edgeever/pull/823). The "Channel name" added in #823 had to be typed by hand and match the ImgBed admin panel exactly, which is easy to get wrong. The channel name is now a field you can type in or pick from, with a "Load channels" button next to it that reads the channel list from ImgBed. Typing a name by hand always works.

## Behavior

| ID | Behavior | Acceptance |
| --- | --- | --- |
| B01 | With the ImgBed address and API token filled in, the "Load channels" button next to the channel name (on the same row as the field) makes the desktop main process call `GET /api/channels` with that token, reusing the existing address validation, host safety check, timeout, no-redirect rule and response-size limit. Only the address and token are forwarded. | Desktop `imgbed.test.mjs`. |
| B02 | The channel name uses the same type-or-pick component as "Model ID" in "Add model" (the generic `ComboboxInput`, extracted from `AiModelIdInput`). After loading, focusing the field lists every enabled channel under the selected upload channel in ImgBed's order; the current value is highlighted (the first option when empty) so pressing Enter right away keeps an existing name, typing filters it and reopening after filtering restores ImgBed's order; only the input confirms an option, so Enter or Space on the toggle button just opens the list without changing the field; and a typed name missing from the list stays as the last item. Leaving it empty lets ImgBed decide. Switching the upload channel reuses the loaded list; while the list loads, every setting except the channel name, plus test and save, is disabled, and the channel name stays editable so it keeps focus; addresses are parsed like the main process, so case, a default port, a trailing slash or `/upload` alone does not count as a change. | Manual check (local web with a mocked bridge). |
| B03 | Only names EdgeEver can send back unchanged are listed: duplicates are removed, and names with edge spaces, control characters or more than 100 characters are left out; the number left out is returned so the settings page asks the user to rename them in ImgBed instead of saying there are no channels. | Desktop `imgbed.test.mjs`. |
| B04 | A saved name missing from the list prompts the user to pick again (judged only while the list is closed, so typing does not trigger it); names left out for edge spaces, control characters or length are counted alongside; an upload channel with no enabled channels is explained. | Manual check. |
| B05 | If loading fails, the text field and the typed name stay (a failed reload keeps the list loaded earlier), with the cause: the ImgBed version cannot list channels (404 or a web page), the token was rejected (401/403, the same message as in the connection test), or another failure (check the address and network). | Desktop `imgbed.test.mjs`; copy checked manually. |
| B06 | The connection test checks the name as in #823 and still writes the test image with `autoRetry=false`. Old ImgBed versions send both `IMGBED_CHANNELS_UNSUPPORTED:` and the earlier `IMGBED_CHANNEL_NAME:` marker, so a desktop app loading a web build of another version still recognizes them, and the new settings page also recognizes the unsupported error a #823 desktop host sends with only `IMGBED_CHANNEL_NAME:`; token rejection uses `IMGBED_TOKEN_REJECTED:`; the connection test then says "This ImgBed version does not support channel names", while a missing name still shows "Channel name not found". | Desktop `imgbed.test.mjs`. |

## Scope and limits

- Desktop only. The web app has no desktop bridge, so it hides "Load channels" and keeps manual entry.
- The list is read once per click and does not refresh itself; click "Load channels" again after adding or removing channels in ImgBed.
- The stored channel name is unchanged, so existing settings need no migration.
- `AiModelIdInput` is replaced by the generic `ComboboxInput`, which "Model ID" in "Add model" now uses. Behavior is the same apart from three small improvements: opening the list shows every option first, an empty list box no longer appears when there is nothing to show, and the wheel no longer scrolls the page once the list ends (`overscroll-contain`).

## Risk and rollback

The desktop ImgBed settings page, preload and main process (plus one read-only IPC handler), and the component behind "Model ID" in "Add model". No changes to the upload path, server, API, storage or migrations. Rollback: revert this change; the channel name goes back to manual entry.

Not verified: reading the list from a real multi-channel ImgBed instance; the interaction inside the desktop (Electron) app, since layout and states were only checked in the local web app with a mocked bridge, and "Add model" was checked locally with a mocked model list for discovery, scrolling, picking and Enter not submitting; German, Spanish, French, Japanese, Polish and Russian copy has not been reviewed by native speakers.
