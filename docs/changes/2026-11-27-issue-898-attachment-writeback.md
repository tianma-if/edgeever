# #898 Slow attachment writebacks and retries

[简体中文](2026-11-27-issue-898-attachment-writeback.zh-CN.md) · [Issue #898](https://github.com/tianma-if/edgeever/issues/898)

Windows desktop 2.31.2 interrupted a 38 MB writeback to a NAS running instance 2.28.0. The initial upload, conflict check and confirmation upload share a 120-second deadline. If the server commits but confirmation fails, desktop never reaches cache publication. A late Retry click can also revert a successful background acknowledgement to pending. The baseline is upstream main at 7c97ef4a. Desktop 2.31.2 uses the same writeback implementation.

## Scope and acceptance

- Budget each desktop writeback request independently. Keep the 120-second capability check. Electron’s `net.fetch` does not expose upload progress. Allow twice the transfer time estimated at 256 KiB/s, with a 120-second minimum per request (304 seconds for 38 MiB). Retain timeout recovery and account-switch cancellation. Exercise a 38 MiB upload lasting 184 seconds and a reconciliation involving several slow requests.
- Allow manual retry to reschedule records still in error or conflict. Exercise a stale click after background success and verify competing edits survive a real conflict. Recover records already persisted as pending by the old client when the local file still matches the acknowledged signature.
- Exercise a server commit with a lost response, then check offline bytes, length and SHA-256 after acknowledgement. Retain conditional writes, the account cache format and compatibility with instance 2.28.0. Chunked uploads, migrations and catalog-wide cache checks are outside this change.

Short deadlines can prevent confirmation from finishing. Long deadlines can delay the next attachment in the serial queue. Verify the pending hash before accepting a remote version as locally saved. Reverting the desktop change retains the existing pending record and snapshot formats. The reporter's Windows client, tunnel and NAS combination needs separate verification.

## Verification

- Run `bun test ./apps/desktop/src/main/attachment-writeback.test.mjs -t 'stale retry|transfer deadlines'`. On the baseline, the 184-second upload and slow reconciliation ended in `error`. The stale click and restored legacy record ended in `pending`. All five cases passed after the fix, including automatic recovery from a timeout.
- A macOS Electron 44.10.2 development client used an isolated profile and a local SQLite / filesystem server built from v2.28.0. The desktop open action created an XLS copy, then the test wrote 39,845,888 bytes. A proxy throttled the first PUT to 184.004 seconds and returned 502 to desktop after receiving 200 from the server. An independent download confirmed the commit before a manual retry through the desktop bridge.
- With this server version, the original-baseline PUT returned 409, a GET verified the bytes, and a conditional PUT returned 200 with authoritative metadata. Reconciliation still transfers the full file. A second stale click retained `saved`. Reopening via the same entry point with the network disabled produced the same SHA-256 as the server, disk cache and its metadata, `fe5a8f2d9f08241db4ab59eaf2734187c29e68b48c5b6f2894059b56ae5eb1ba`.
- All 64 targeted desktop and real API checks passed. The desktop main-process suite passed 644 tests and skipped one Windows-only directory-lock test. Root typecheck and desktop renderer and sidecar builds passed. The report has no timing trace for the original 184 seconds. The run reproduces stale bytes after a lost acknowledgement, but cannot attribute every reported stale file to that sequence.
