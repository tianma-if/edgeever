# Desktop scheduled backups: optional WebDAV off-site copy

[简体中文](2026-11-02-desktop-webdav-offsite.zh-CN.md)

Related Issue: #723 (P2 of the backup plan; continues #61 and #650)

## Problem and outcome

Desktop scheduled backups are written to a local folder only. Users without a cloud-drive client, or who keep backups on a NAS or a WebDAV provider, had no automatic off-site copy. After each completed local backup, the desktop app can now copy the archive to a WebDAV server (Nextcloud, Synology/QNAP, Hetzner Storage Box, Koofr, pCloud, 坚果云, Alist and similar). The design is in [section 12 of the scheduled backup design](../desktop-scheduled-backup-design.md).

## Scope

- Desktop main process: new `backup-offsite.mjs`; `backup-manager.mjs` reports off-site status, queues an upload after publication, retries from the hourly check and cancels on account changes; three IPC actions (`offsite-save`, `offsite-test`, `offsite-upload`); `webdav` added to the desktop app dependencies because the main process is not bundled.
- Settings → Import and export → Backup and restore: a collapsible “Off-site copy (WebDAV)” section and a separate status line with **Upload now**.
- Shared IPC types and translations for all five catalogs.
- Unchanged: archive format, local backup results, API, Cloudflare/Docker runtimes, database and migrations, sync, Web WebDAV card.

## Risks and recovery

- **Password disclosure.** Stored only through Electron `safeStorage` in a scope-bound `.secret` file; never in state, renderer status, logs, the archive or the EdgeEver server. No plaintext fallback. The saved password is bound to the address and username, so changing either, or testing another server, requires entering it again. `https://` is required except for local-network hosts.
- **Deleting a good remote copy.** Remote retention deletes only files this backup set recorded as uploaded to the same target, only after a newer copy succeeded.
- **Blocking local backups.** Uploads run outside the local backup queue and never change its result.
- **Rollback.** Turning the option off stops uploads and keeps local and remote files. Older versions ignore `<scope>.offsite.json` and the off-site `.secret` file (verified below).

## Verification

- Unit tests (`backup-offsite.test.mjs`, 15 tests, mocked WebDAV): upload through `.part` and move, size check, `.part` cleanup, cancellation, account switch mid-upload, stall timeout, retention ownership, retry of the latest archive, password handling, explicit `Content-Length`.
- Integration (`bun run test:webdav`, real `rclone serve webdav` 1.69, under Bun and Node): test connection with right and wrong password, plain and encrypted archives byte-for-byte without leftover `.part`, retention that keeps foreign files, wrong saved password, HTTP 413 size limit reported as “file too large” with no `.part`, unreachable server. Docker Desktop was unavailable locally, so rclone ran directly and the size limit was emulated with a 64 KiB proxy instead of the nginx container from `tests/webdav/compose.yml`.
- Desktop app on macOS (Electron, unpackaged, local self-hosted server): connection test; plain backup copied, downloaded back from WebDAV and restored after the note was deleted; encrypted backup copied as-is (`EDGB` header, no plaintext) and restored with its password; a wrong WebDAV password fails only the copy while the local backup succeeds, and **Upload now** recovers it; the password is absent from status and every state file; settings UI renders the section and status line.
- Upgrade: a profile created by the current `main` build with an encrypted local backup opened in the new build with settings, password and history intact; the off-site option started off and, once enabled, uploaded the backup made by the old build. Opening that profile again with the old build ran a new local backup normally.
- Found and fixed during verification: progress counting on the request body dropped the first chunks of larger files, and the `webdav` library sends streams chunked, which some servers reject; uploads now count bytes in a transform and send an explicit `Content-Length`.
- Review follow-up: connection tests and uploads read the password of the account they started in and stop after an account switch; turning the option off cancels a running upload; folder creation, `MOVE`, size check, cleanup, retention and the connection test are bounded by the stall timeout even when a request ignores cancellation. Six regression tests cover these and fail on the previous version.
- `bun run typecheck`, `bun run typecheck:mobile`, `bun run lint`, `bun run build:web`, `bun run test`.
- Not verified: Windows and Linux runtime (no local machines; CI does not run this flow), packaged builds, Nextcloud and commercial providers without test accounts.
