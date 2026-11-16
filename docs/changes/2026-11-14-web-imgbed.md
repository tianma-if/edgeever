# CloudFlare ImgBed in the web app

[简体中文](2026-11-14-web-imgbed.zh-CN.md)

The web app now supports configuring, testing and uploading to HTTPS CloudFlare ImgBed sites directly. PicGo / PicList remains desktop-only in this change. Android and iOS native clients are not included.

- The ImgBed site must allow CORS for the EdgeEver origin, including `Authorization` on both `/api/channels` and `/upload`. Preflight must succeed without browser cookies. Redirects are rejected.
- Tokens and preferences stay in the current browser's local storage; they are not synced or sent through EdgeEver's backend.
- Saving an external configuration still requires a successful test. The test writes a small PNG; testing again may create another image.
- A named channel is checked before the test upload, and the test disables ImgBed's server-side retry when a name is set. The upload retry switch still controls ImgBed's own retry policy.
- Network/CORS failures do not cause automatic client retries or silent fallback. The user chooses Retry, Save to EdgeEver or Cancel. Switching notes cancels pending choices.
- Desktop and web share the ImgBed protocol package. Desktop retains its Node transport, DNS/host checks and existing IPC failure queue.
- Externally hosted images remain outside EdgeEver backups. Existing note links are unchanged.

Risk: an image may be uploaded even if its response cannot be read; explicit retries can duplicate it. Rollback: switch back to built-in hosting or restore the web capability gate. No database migration or credential sync is introduced.

Validation is covered by browser-adapter tests and the existing desktop protocol tests, plus type checks and the web build. Real ImgBed deployment/CORS configuration, Safari/Firefox, native mobile and packaged Windows/Linux desktop uploads have not been verified.

Checks completed: 81 related tests; `bun run typecheck`, `bun run typecheck:mobile`, `bun run build:web`; frozen-lockfile installation; Node import of the desktop adapter. Chrome verification confirmed enabled test/channel buttons, the HTTPS validation message, and save remaining disabled after a failed connection. No test configuration was saved. The i18n catalog test has a pre-existing Polish `plugins.restoreFailed` key-order failure, reproduced from HEAD; the added keys are present in all nine locales.
