# #879 Shared storage for structured table records

[Issue](https://github.com/tianma-if/edgeever/issues/879) · Baseline `18720460` · [Storage candidate](https://github.com/sivdead/edgeever/commit/1558f1e9037fc2f17a4d56ad4819d1625b112769)

## Scope and risk

- Move current records from memo bodies to a shared JSON row table on D1 and Docker SQLite. Scope queries by workspace, table and row order. Update only the affected row and necessary history and indexes. Preserve fields, views, permissions, sort semantics and attachment references.
- Back up first and pause table writes during maintenance, including public forms and sync. Commit bounded record batches and their progress together. Verify all tables before switching. Resume legacy reads and writes if the cutover is canceled. After cutover, roll back to a verified service version that reads and writes shared records.
- Send and receive revision-based changes with deletions. Keep stale drafts and replay the original receipt for a repeated request. Keep legacy formats readable and verify history and default backup restoration across storage and field types, including attachments.
- Missing records, cross-table access, overwritten changes and lost writes on rollback are the main risks. Exercise local D1 and a Docker upgrade on the same volume using synthetic data and v1/v2 tables produced by real old releases. Verify interruption, reconciliation and rollback. Production cutover has separate acceptance.
- Use keyset pagination, one filtered count, metadata totals and bounded indexes for saved views. Measure cumulative work for pagination, sync, current snapshots, history and migration. Report SQLite measurements separately from D1 billing. Budget for both copies, index maintenance and ongoing usage before migration. Preserve progress and report quota exhaustion explicitly.

## Local implementation and evidence

- `0100_shared_table_records.sql` adds current records, revisions and migration state. `SharedTableMigration` scans by memo ID and copies at most 25 records per step. It commits records with the checkpoint. The old body remains readable before and after staging. Writes to table bodies during maintenance return `409 table_migration_in_progress`.
- `SharedTableStore` updates records independently and stores field and view metadata, deletions and historical versions. Revision checks protect stale drafts, and a repeated submission returns the persisted original receipt. Changes are paged by revision and record ID. The editor still uses `localeCompare` for text ordering. The candidate SQL text ordering is pending editor integration.
- `table-storage-migration.integration.test.mjs` uses Bun SQLite and the Miniflare bundled with the pinned Wrangler. It covers concurrent and resumed migration steps, adding, removing and converting fields, revision conflicts, submission replay, deletion deltas, history restoration, view pagination and legacy write-back. The 2,000-row current snapshot takes one head query and 40 position-indexed page queries. It issues no history queries or repeated counts. Query counts are distinct from [D1 billable rows read and written](https://developers.cloudflare.com/d1/platform/pricing/#definitions).
- The official old `ghcr.io/tianma-if/edgeever:v2.31.2` service created v1 and v2 tables and real attachments via the API. The current service bundle started on the same test volume and applied `0100`. After stopping the copy process at 25 rows, a new process resumed and copied 202 rows across four tables, including two built-in examples. During maintenance, ordinary notes remained writable and table writes returned 409. Shared storage edited both test tables and deleted one row in each. Rollback ran across two processes. After restart on the same volume, the old image read the new values, deletions, views, earlier revisions and actual attachment bytes through its API.
- 67 targeted tests passed, covering storage and existing table, public-form, backup-restore, sync and database-error behavior. `bun run typecheck`, `bun run typecheck:mobile` and `bun run build:web` passed. Tests used local synthetic data.

## Rollback boundary

- In Miniflare, 1,100 rows each containing one valid 2,000-character text cell fit separately in shared storage. Reconstructing the legacy Markdown, rich-text JSON and plain text takes about 9.7 MB and fails with `SQLITE_TOOBIG`. D1 limits a single row to 2 MB, so rollback after cutover requires a service that supports shared records and can continue reading and writing the same database. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## Integrating application reads and writes

- Switch an instance only after verification, in an atomic transaction. Keep pre-migration bodies and histories readable. After cutover, memo bodies and history may reference shared revisions. Existing APIs project those revisions as compatible documents. First verify the shared write path used by memo saves, field changes, public forms and history.
- Preserve bound edit sessions, memo revisions and resource handling. Compare complete documents by record ID and write the affected records. Commit record changes, memo revision and compatibility reference together. List, sharing, sync and backup should read the same source. Verify the new capacity and rollback target before enabling the cutover.
- A stale read, exposed internal reference or overwritten concurrent save is the main risk. Test single-row writes, races and history with legacy data and existing APIs before validating every compatibility reader. Local tests are the only callers of cutover until compatibility verification is complete.

- `0101_shared_table_memo_references.sql` adds atomic cutover state and shared revision references for current memo bodies and history. Existing edit session checks still apply. The last pre-cutover table state remains restorable. Attachments removed from the current table stay available for history. Public forms read field metadata and the record count, then append one row.
- Existing editor, sharing, sync and backup endpoints return compatible documents. The default backup restores current tables and history. `/api/v1/memos/:id/table/query` pages views and `/api/v1/memos/:id/table/changes` returns revision deltas and deletions. Both use `read:memos` and notebook access checks. Existing clients still use their existing sync protocol.
- `bun test apps/api/src/table-storage-migration.integration.test.mjs` covers migration, cutover and the ordinary single-row edit in local D1, and forms, compatibility sync, backup and history restoration in SQLite. The real `v2.31.2` image created old v1 and v2 fixtures with attachments and public forms. The current service bundle applied `0101` on the same volume. Migration resumed after stopping at 25 rows and completed 140 rows across four tables. After cutover, HTTP verified existing edit sessions, public forms, row revisions, view pagination, list search, public sharing, sync and backup. Historical references and attachment bytes remained readable after removing the attachment from the current table.
- `bun test apps/api/src` passed 1,069 tests. `bun run typecheck`, `bun run typecheck:mobile`, `bun run build:web` and the local `bun run build:self-hosted` passed.

## Record sync and cutover acceptance

- Reuse the durable Web and desktop queues and bound edit sessions. Compute row changes and deletions against the acknowledged table. Commit the rows, memo revision, history and receipt atomically. Replaying the same request as the same actor returns its receipt. Stale drafts retain the existing conflict handling. Changes to fields, views, row order or title use the compatibility edit path, which also supports older servers.
- Chrome ran `tests/e2e/shared-table-record-sync.spec.ts` through the actual Web editor. The offline edit entered the durable queue. After the server committed the first PATCH, the test dropped the response. The retry reused the mutation ID and produced one recorded change. Reconnect fetched a remote revision incrementally, and a conflicting edit remained in IndexedDB. The integration test used the native Rust sidecar to persist an offline desktop edit across restart, upload one row and read it back in the Web mirror.
- The isolated Docker upgrade from `v2.31.2` applied migrations through `0102` on the same volume. The owner estimated and migrated four tables with 172 rows, paused with a low write budget, then resumed and activated. Row PATCHes added 800 rows and deleted the seed row. Their compatible Markdown was 3,621,705 bytes. A service bundle from the `0101` implementation started on the same volume, read all records, revision 21 and its deletion delta, and saved and read back an edit to a migrated v2 table. The rollback bundle was a local verification build.
- New workspace example tables and demo resets use shared records after cutover. Workspace examples retain their scoped attachment mappings.
- The tested rollback bundle is retained locally at `dist/issue-879-rollback/self-hosted-server.js`. Its SHA-256 is `6d7853e3cc070864915fb50ddcf2cf464b5bac46b23effa273e54bd7c6a6a474`.
- Final checks passed for 1,074 API tests, 93 Web sync tests, 17 Rust sidecar unit tests, cross-client sidecar sync, Web and mobile type checks, and Web and Docker server builds.

## Maintenance window procedure

1. As the instance owner, call `GET /api/v1/admin/table-storage`. POST `{ "action": "estimate" }` to the same path and send each `estimate.next` as the next request's `cursor`. Sum `readRows`, `writeRows` and `extraBytes` and allow for normal use when comparing the totals with available instance and account capacity. Keep a verified rollback build that reads and writes shared records.
2. Back up during the maintenance window. Confirm capacity, then submit `{ "action": "start", "backupConfirmed": true }`. Table writes return `409 table_migration_in_progress`. Call `advance` with the available `readRows`, `writeRows` and `extraBytes` in `budget`. Check `progress` after each call and continue until `ready`. An insufficient budget returns `paused` and preserves the checkpoint. A depleted daily D1 quota returns `503 database_daily_quota_exceeded`. Resume once capacity returns.
3. Reconcile table and row counts and verify representative samples. Call `activate`, confirm `active`, and verify existing tables, edits, sync and backups. To cancel before activation, call `abort` and then `advance` until `legacy`. After activation, keep the database and shared records and roll back to the compatible build.

## Cumulative local D1 measurements

Each table had 10 fields and a saved numeric filter and sort. The history fixture had eight memo revisions. The local regression test sums Miniflare's per-statement `rows_read` and `rows_written` and tracks peak `size_after`. Use the Cloudflare account's own usage for its actual limits.

| Operation | 250 rows | 500 rows |
| --- | ---: | ---: |
| Migration reads / writes | 850 / 2,273 | 1,671 / 4,533 |
| Peak additional migration bytes | 352,256 | 724,992 |
| Cumulative saved-view page reads | 479 (4 pages) | 961 (8 pages) |
| Current snapshot reads, unchanged as history grew | 786 | 1,571 |
| Reads to pull one row change | 5 | 5 |
| Reads to fetch a specific historical revision | 520 | 1,024 |
| Reads / writes to restore that historical revision | 2,109 / 38 | 4,141 / 38 |
| Reads for backup state, current data and all eight histories | 9,366 | 18,616 |

Pre-cutover history retains its original format. New memo history follows the existing snapshot cadence. Shared row revisions and deletions remain with the table, with no automated expiration. Full archive costs grow with retained history. Document projections continue to support legacy clients and offline export. Production deployment and instance cutover have separate acceptance.

## Review fixes and evidence

- Preserve memo merge and notebook site search. Verify that a merge retains table rows, site owners and visitors can find current cells, and visitor search retains site visibility restrictions.
- Cover the lifetime of saved-view indexes. Verify that permanent deletion, emptying trash, and Demo reset reclaim the affected tables' indexes and preserve other tables' indexes.
- Verify that migrated tables read from shared revisions immediately after activation. Preserve checkpoints when budgets run short, discard only staged copies on pre-activation cancellation, and retain shared records when rolling back the service after activation.
- Verify that edits made during a lost response can still sync, archive reads avoid repeated full history scans, and record search preserves substring and multi-row keyword matching.

- Migration `0103` makes shared revisions visible at activation and retains the locked pre-cutover body. Cancellation before activation removes staged records and indexes, with the same budget check. The prototype legacy write-back and duplicate receipt paths were removed.
- Memo merge reads the current table projection. Memo lists and notebook sites use the same shared-table search for substrings and keywords spanning multiple rows, with site exclusions intact. Permanent deletion, emptying trash, and Demo reset remove saved-view indexes in the existing deletion transaction.
- The Web and desktop queues retain a sent row edit while its result is unknown. They replay that request and rebase the successor before sending it. The Web editor can save locally without a separate server edit session. The queue acquires the bound session when syncing. Chrome and the restarted Rust sidecar both passed the successor replay regression.
- On the same one-row fixture, exporting 20, 40, or 80 shared revisions took 234, 468, or 936 Miniflare row reads. The old query took 6,520, 13,040, or 26,080. The table above gives the updated measurements for 250 and 500 records with eight histories.
- The real `v2.31.2` Docker image upgraded through `0103` on the same volume. The migration paused, resumed, and activated after copying 172 rows. After rolling back to the compatible service, the 3,613,568-byte table still had 799 rows and returned revision 21 and its deletion. The rollback service also saved an edit to the migrated v1 table.
- Verification passed for 1,076 API tests, 94 Web sync tests, 17 Rust unit tests, the sidecar integration suite, Web and mobile type checks, and builds. All data was isolated and local.

## Chunked backups

- One query returned about 60 MB of cells for 500 rows, 10 long text fields, and six histories. The default backup reads current records and history in bounded chunks and validates the source version per request. Verify that manual Web exports, WebDAV, and desktop backups share the chunked support. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Retain the old client endpoints and v1/v2 ZIP import. New archives separate row chunks and histories and keep readable Markdown and streamed attachments. Stage the table and all of its histories, verify completeness, and publish them in one transaction. An interruption before commit or detected concurrent edit leaves the destination table intact. Oversized archive restore requires activated shared storage at the destination and follows the existing maintenance procedure.
- Exercise a local archive larger than the D1 result limit, retries and cancellation, source edits, and target edits during restore. Verify revision contents, fields, row order, attachment references, and cumulative reads. Production cutover has separate acceptance.

- Migration `0104` adds restore staging tables and a history cursor index. Activated instances advertise chunk support in backup state. Archives containing shared revisions use ZIP v3 with up to 25 records per chunk. Existing backup endpoints still serve older clients, and new clients accept ZIP v1/v2. Sources without activated shared storage keep the ordinary export. Desktop, manual Web, and WebDAV backups share the ZIP implementation.
- Restore publishes the current records and all history for one table together. Repeated chunks and finalization are idempotent. The publish transaction checks completeness and the destination snapshot. Cancellation clears staging, and later restores reclaim abandoned jobs idle for more than 24 hours in bounded batches. Attachments use the existing streaming transport.
- The Miniflare fixture exported 70,206,495 cell bytes from 500 records, 10 long text fields and six histories in 140 row chunks. The largest response was 503,239 bytes and the largest restore request was 502,588 bytes. Export read 17,093 rows. Restore read 57,371 rows, wrote 30,472, and peaked at about 197 MB in the isolated target database. Verification covered cursor boundaries with unusual IDs, historical revisions, missing chunks, cancellation, and concurrent source and destination edits.
- Chrome exported and imported ZIP v3 through the default settings UI across two isolated Docker `0104` instances, verifying current rows, history and attachment bytes. The desktop backup worker round-tripped ZIP v3 in an Electron utility process. A ZIP v2 export from the real `v2.31.2` server restored onto `0104`. All 1,085 API and ZIP tests, eight Electron backup network tests, 67 desktop backup unit tests, Web and mobile type checks, and Web, Docker and desktop backup worker builds passed.

### Chunked backup follow-up review

- ZIP v3 must round-trip legacy tables that already exceed 2,000 rows. Keep per-chunk and completeness checks, and verify a legacy table with 2,001 rows after migration.
- The readable Markdown copy keeps attachment links and is generated in row batches. ZIP v3 stores the recoverable table in structured entries. Measure the cumulative cost of the additional bounded pass over current records and verify historical page counts.
- Restore reads only attachment entries during the attachment phase and retains archive preflight and attachment validation. WebDAV export also removes its temporary file when the source fails before the ZIP stream is created.
- Browsers on trusted HTTP LAN origins reuse the app's UUID generator. Restored legacy records remain editable, with the existing editor and public form limits on adding records.
- Unchanged records in adjacent snapshots do not create duplicate permanent versions. Staging reuses identical cell payloads within the job. Verify version count and peak staging space with six one-row edits. Split current-record uploads by byte size to reduce projection CPU per request. Cancellation protects the table before its publish transaction commits, and attachments retain separate transfer.

- Migration `0105` deduplicates staged cells by content. The same 500-row Miniflare export with six histories produced 140 archive chunks containing about 70.2 MB of cells. Historical pagination remained at 120 requests. The readable Markdown stream added 20 current pages, for 17,732 total export row reads. Restore read 43,518 rows, wrote 23,554 rows, and peaked at about 74.6 MB. The resulting 506 permanent row versions match the source. The largest restore request was 502,588 bytes, and the largest current-record request was 261,364 bytes.
- A separate table with 2,000 rows and 40 long-text fields exported and read back 480,244,818 bytes of readable Markdown and 80 structured row chunks. SQLite verified migration, restore, and subsequent edits for a 2,001-row legacy table. Chrome round-tripped the default backup UI between isolated Docker `0105` instances and restored current values, history, and attachment bytes with `crypto.randomUUID` disabled on the destination page to simulate an HTTP LAN origin.
- The Web uploader transferred the Chrome ZIP v3 to a local Apache WebDAV server. The downloaded file matched byte-for-byte and parsed successfully. A regression test covers removal of the temporary upload file when the backup state request fails. Cloud D1 and production cutover have separate acceptance.
- All 1,110 API, ZIP64, and Web backup checks passed, along with 37 shared table, ZIP, and Node backup worker tests and 67 desktop backup unit tests. Web and mobile type checks and the Web, self-hosted server, and desktop backup worker builds passed.

## PR base update

- Integrate upstream `1a1a71af` while retaining notebook subtree trash and Inbox recovery, public share sorting, and shared-table record sync. Verify the combined cross-client integration and associated API and offline queue regressions.
- On the updated base, 1,114 API, ZIP64, and Web backup tests, 182 Web sync and notebook tests, 17 Rust unit tests, and the sidecar cross-client integration passed. Chrome passed the default ZIP round trip and the lost-receipt replay and offline conflict draft scenario against isolated Docker services. Web and mobile type checks and the Web and self-hosted server builds passed.
