# CloudFlare ImgBed image host (desktop)

[简体中文](2026-10-30-desktop-imgbed-image-host.zh-CN.md)

## Problem and outcome

Implements [Issue #734](https://github.com/tianma-if/edgeever/issues/734). Desktop users who run their own [CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) had to put PicList in between to use it. "CloudFlare ImgBed" is now a third choice in Settings → Image hosting, next to the built-in storage and PicGo / PicList. Like PicGo, the desktop app uploads new images and writes the returned link into the note. The PicGo / PicList address rule is also relaxed: it must end with `/upload` instead of being exactly `/upload`, so a PicList behind a reverse proxy (`https://nas.example.com/piclist/upload`) works.

## Behavior

| ID | Behavior | Acceptance |
| --- | --- | --- |
| B01 | Settings take the ImgBed address (site root or `…/upload`), an API token with the `upload` permission, an optional upload folder, the ImgBed file naming mode (`default`, `index`, `origin`, `short`), the upload channel (`telegram`, `cfr2`, `s3`, `discord`, `huggingface`, `webdav`) and server-side compression. Channel and compression default to the ImgBed API defaults: `telegram` with compression on. Saving requires a successful connection test, as for PicGo. | `imgbed.test.mjs` (desktop): address and token normalization. |
| B02 | The upload folder accepts PicList placeholders `{Y}` `{y}` `{m}` `{d}` `{h}` `{i}` `{s}` `{ms}` `{timestamp}` `{timestampS}` `{uuid}` `{str-N}` plus EdgeEver's `{memoId}` (the note receiving the image). Dates use the uploader's local time zone. Unknown placeholders, stray braces and unsafe characters are rejected before saving, as is a folder whose longest possible expansion exceeds the 200-character limit the main process enforces (each placeholder at its maximum length, `{memoId}` capped at 64 characters), so a folder that passes the connection test cannot fail later with a real note ID; the settings show an expanded preview. | `imgbed.test.mjs` (web). |
| B03 | Uploads send `POST {address}/upload?uploadChannel=…&serverCompress=…&uploadNameType=…&uploadFolder=…` with `Authorization: Bearer <token>` and the image in `file`. The note gets `publicUrl` when ImgBed returns it, otherwise `src` resolved against the ImgBed address. Only a single http(s) link without credentials is accepted. | `imgbed.test.mjs` (desktop). |
| B04 | The connection test uploads a 1×1 transparent PNG named `edgeever-connection-test.png` to the configured folder, because ImgBed has no heartbeat endpoint. The settings say so. | `imgbed.test.mjs` (desktop). |
| B05 | ImgBed and PicGo share one upload queue and the existing failure dialog (Retry / Save to EdgeEver / Cancel), with ImgBed-specific wording. A rejected token (HTTP 401/403) is reported without echoing the token. | `imgbed.test.mjs`, `picgo.test.mjs` (desktop). |
| B06 | The PicGo / PicList address may have any path ending in `/upload`; the connection test calls the sibling `…/heartbeat`. Other address rules (no query, fragment, credentials, link-local or metadata hosts) are unchanged. | `picgo.test.mjs` (desktop). |

## Scope and limits

- Desktop only, like PicGo. The web app shows "Available on desktop only."
- Deleting images from ImgBed is not supported: once the link is in a note, EdgeEver cannot tell whether another note still uses it.
- The token is stored in the renderer's local storage, like the PicGo server key, and is sent with every upload; use an HTTPS address.
- Images on ImgBed are not part of EdgeEver backups.

## Risk and rollback

Desktop renderer and main process only: no server, API, storage or migration changes. Users who keep "Built-in image hosting" are unaffected. The PicGo address rule is more permissive but keeps its host checks. Rollback: switch Settings → Image hosting back to the built-in option, or revert the change.

Not verified: uploads against a real ImgBed instance and a reverse-proxied PicList; interactive checks on Windows and Linux desktop; Japanese, Polish and Russian wording without native-speaker review.
