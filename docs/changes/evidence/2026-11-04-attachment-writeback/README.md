# Desktop attachment writeback acceptance

[简体中文](README.zh-CN.md) · [Change scope](../../2026-11-04-attachment-writeback.md)

## Verified paths

The test uses an isolated macOS Electron profile, the real Rust sidecar, shared API, SQLite and local object storage. Attachments are synthetic TXT files. OS open/reveal operations record their paths; actual filesystem writes/replacement simulate external saves, and a test transport simulates network loss.

- Open from the attachment card → save → read new bytes at the original resource ID → refresh desktop bytes and displayed file size → reopen fresh content → reveal the corresponding local copy.
- Save during an outage → persist a pending snapshot → actually close/restart Electron → automatically write back and show the updated file size in the remounted card.
- A separate HTTP client replaces the attachment first → edit locally → show a conflict while retaining both versions; Retry does not force replacement.

[Results](results.json) · [Saved UI](saved.png) · [Conflict UI](conflict.png)

## Reproduce automation

Run from the repository root using existing dependencies, without production instances or the installed Applications copy of EdgeEver:

```sh
bun test apps/desktop/src/main/attachment-open.test.mjs apps/desktop/src/main/attachment-writeback.test.mjs apps/desktop/src/main/attachment-writeback-ipc.test.mjs apps/desktop/src/main/resource-protocol.test.mjs tests/attachment-writeback.integration.test.mjs apps/api/src/resource-routes.test.mjs apps/api/src/resource-service.test.mjs apps/api/src/resource-upload-integration.test.mjs
EDGE_EVER_DESKTOP_BUILD=1 bun run build:web
bun run build:desktop:sidecar
bun apps/desktop/scripts/build-backup-worker.mjs
node tests/desktop-attachment-writeback.integration.mjs
```

Desktop automation uses the supported `file:` renderer and a separate temporary profile; existing Web/API services need not stop or change ports. On exit the script closes its test application/API and removes temporary profiles/databases. Screenshots/results remain here. Focused regressions also cover Excel-style replacement, edits during uploads, lost success responses, staged-resource mapping, restored authentication, account switching, retention and the existing replacement-size limit.

Failure-recovery regressions inject faults into real filesystem calls in isolated Node processes, without production test hooks. They cover DOM `AbortError`, file replacement during snapshot reading, temporary internal pending-file locks, late older retry commits, same-account session recovery during acknowledgement, failed acknowledgement commits and post-acknowledgement cleanup failures. Each failing case was reproduced before verifying recovery or retained success. IPC regressions also cover sender invalidation and account changes; status-list regression checks distinguish numbered local names without changing upload names.

## Server filename and storage acceptance

Attachment opening, writeback, IPC, cache protocol, real API and existing resource route/service/upload integration checks total 72 passing tests. Another 15 resource request/URL, locale-loading and shared translation-key tests pass. The real API verifies that `preserveFilename=true` retains the cloud name across differing display labels, prior renames, concurrent renames during upload and retries after lost successful responses. Omitted/disabled flags retain existing submitted-filename replacement behavior.

Object keys retain constant length across 12 consecutive saves; latest content remains readable and old objects are removed. Failed competing candidates and objects written before a put throws are cleaned up without losing the acknowledged version. Lost database commit responses with unavailable confirmation also retain potentially live objects: the original resource remains readable and writeback retries reconcile success. The original resource API/service from baseline `6be20cfc` was also executed against the same SQLite/filesystem storage for old write → new write → old read/write → new write; see the [storage compatibility record](storage-compatibility.json). This does not establish native package upgrades, live Cloudflare or S3 acceptance.

Desktop probes capabilities before actual writes, using the dedicated name-preserving route for writes and lost-response retries. A regression reproduced older servers ignoring the optional field: after the fix, older servers and post-probe downgrades never reach ordinary replacement, retaining cloud names/content. Missing capabilities retain snapshots without repeated automatic probing; manual Retry writeback resumes after upgrading.

Real isolated Electron, Rust sidecar and local API acceptance simulated the older capability route with 404: one capability request, zero writes, unchanged cloud bytes and a UI warning retaining local edits. After switching to the updated server, clicking Retry writeback produced two total capability requests and one write, with local edits readable from the cloud and Saved to original attachment in the UI. See the [capability/UI record](server-capability-ui.json). This does not establish packaged app upgrade acceptance.

Cache regressions verify current-account cached opening on 502/503 with error-body cancellation, but no fallback on 401/403/404. Cache misses preserve 503 without reading another account’s directory. Account changes during the request or after creating a cached response reject the operation and close abandoned file streams. Existing Range reads, cache refresh and network-error fallback still pass.

## Real macOS WPS acceptance

WPS Office **12.1.29182**, using synthetic workbooks, isolated Electron profiles and the real local API. EdgeEver's external-open action invoked the actual OS association, followed by editing and `⌘S` in WPS; opening and saving were not mocked. See the [WPS acceptance record](wps-results.json).

- **Consecutive XLSX saves:** change `B4` from 100 to 200, then 300. Downloaded server `B6` values were 220 and 320, retaining `SUM(B4:B5)` and the corresponding `B8` save markers. Close and reopen from EdgeEver showed 300, 320 and the second marker in WPS.
- **Original-path XLS save:** create a genuine Excel 97–2003 OLE file in WPS, upload it as a separate attachment and open it from EdgeEver. After saving `B4=400`, downloaded server bytes exactly matched the managed WPS-saved file (19,968 bytes). WPS showed result 420, the save marker and original formula after saving and reopening. XLS was not read with an independent parser.
- **Repeated-open repair:** WPS rejected same-named documents in different directories. After the repair, `WPS-771.xlsx` and `WPS-771 (2).xlsx` opened simultaneously. Saving `B4=500` in the second copy produced 500, 520 and the original formula when downloading the original resource ID; its download filename remained `WPS-771.xlsx`. A further local opening used `(3)` and showed 500 in WPS. Naming regressions also cover concurrent different-resource opens and case/Unicode-equivalent names.

WPS screenshots contained unrelated user document tabs and were not retained in the repository; the record contains only synthetic workbook data and acceptance findings.

## Platform acceptance still needed

Microsoft Excel is not installed here and requires separate acceptance in an installed, licensed environment. On Windows 11, exercise real Excel/WPS with test attachments: ordinary and consecutive saves, close/reopen, offline save/restart, and conflict after another device saves first. Old-to-new upgrade acceptance must check existing notes/attachments and old opened copies remain accessible, without automatically adopting old copies. Linux, actual two-device UI behavior and a live Cloudflare instance have not been exercised.

The existing server replacement limit is 100 MiB; larger attachments still open, but oversized edits stay local with an error. Save As to another path is not tracked. Reverting code does not restore server attachment content already replaced; copy unsynced local files elsewhere before downgrading to avoid older temporary-file cleanup.
