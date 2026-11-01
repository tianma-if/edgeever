# Third-party note import implementation plan

[简体中文](third-party-import-plan.zh-CN.md)

Related: [Issue #657](https://github.com/tianma-if/edgeever/issues/657). Sections 1–8 describe the implemented contract; section 9 describes the implemented D1 optimization and acceptance. [Acceptance scope and results](changes/evidence/2026-10-27-third-party-import/README.md).

## 1. Approach and first-release boundaries

Add one “Import from other apps” entry under Settings → Import & Export. All three sources share file access, preflight, destination selection, execution, and results, with separate format parsers. Users do not configure MCP, API keys, or command-line tools.

The first release covers **Web and Electron desktop, importing online into the current instance and account**. Local scanning works without a connection; confirmed writes require the instance. Desktop pauses background sync during writes, then resumes and pulls the results. Android and iOS receive imported notes through existing sync; native file-import entry points are outside this release.

Imports are additive: create source folders and notes without name-based merging or overwriting existing content. A selected parent notebook changes only where new folders are attached. Each new import creates a new set of data. Retries within one task reuse its created notes; automatic merging across separate imports and resume after closing the app are not included.

All three sources and all file, directory, and archive forms requested by the Issue remain in the first release; implementation stages do not reduce the final deliverable.

## 2. Reuse and architecture choices

| Location | Reusable capability | Integration |
| --- | --- | --- |
| `apps/web/src/components/SettingsPane.tsx` | Web uses `DataExportCard`; desktop uses `DesktopScheduledBackupCard` | Keep both backup entries; replace the guide card with third-party import and retain its guide link |
| `packages/shared/src/backup-archive.ts` | Uses `@zip.js/zip.js` 2.24.0 for ZIP64, entry reads, and streaming restore | Reuse the dependency and reading approach without requiring an EdgeEver manifest or changing the backup format |
| `apps/api/src/memo-service.ts::importMemosRecord` | Batches of 1–25 notes, per-item results, imported timestamps, and `source + externalId` idempotency through the database adapter | Add a thin REST entry that reuses this service; retain existing MCP semantics |
| `packages/client/src/index.ts` | Creation accepts timestamps; resources support multipart uploads; document updates require edit sessions and version protection | Add import methods and the optional update timestamp fields already supported by the server |
| `apps/web/src/lib/desktop-sync.ts` | `pauseDesktopSyncForImport()` waits for active sync and returns a release function | Hold it after confirmation, release on every exit path, and refresh only after releasing |
| `crates/desktop-sidecar/src/memo.rs::create_memo` | Ordinary local creation uses database-generated times rather than imported timestamp parameters | Do not route this import through ordinary local creation or extend Rust storage and offline queue protocols |
| `scripts/import-evernote-enex-via-mcp.mjs` | ENML conversion, resource matching, and metadata mappings | Reuse format knowledge, not whole-file reads, last-parent-only paths, 400,000-character truncation, or automatic image compression |

Use **client-side parsing with shared server-side writes**, rather than separate offline import implementations for Web and desktop. Cloudflare and Docker continue running the same API business logic. The original archive is not uploaded wholesale.

## 3. Input, metadata, and link rules

### Evernote

- Accept one or multiple `.enex` files, nested directories containing ENEX, and ZIPs containing them. Preserve the full directory path; each ENEX filename becomes a leaf notebook. Multiple selected files without relative paths become sibling notebooks. Do not infer source hierarchy absent from the export.
- For `.notes`, explicitly ask users to export `.enex` from Evernote and try again; do not guess that it is XML or ZIP.
- Scan XML in chunks for titles, tags, `created`, `updated`, ENML, and resource descriptors. Import one note at a time, decoding resource base64 incrementally. A SAX text callback must not rebuild an entire attachment in memory.
- Use Turndown for ENML conversion, covering tables, tasks, images, and attachments. Keep linked images inline to preserve outer URLs/titles; ordinary media retains existing block layout. Incremental MD5 is used only to match ENEX `en-media` identifiers, not as a security check.
- Upload resources attached to a note even when its body does not reference them, appending attachment links. Retain encrypted source content as plain text with a notice rather than discarding it behind a placeholder.

### Obsidian Vault

- Accept a directory or ZIP and reconstruct folders from Markdown paths. Ignore `.obsidian`, `.git`, `.trash`, and OS index files. Do not execute plugins or scripts.
- Reuse Front Matter parsing and valid `title` / `tags` mappings. Add import-specific timestamp mappings for `created` / `createdAt` and `updated` / `updatedAt`; preserve other properties and original Front Matter. Conflicting synonyms are reported at preflight rather than arbitrarily resolved.
- Resolve ordinary Markdown local image/attachment links and `![[image-or-attachment]]`. Follow Vault path rules for Unicode, spaces, relative paths, and root-relative paths, staying within the selected Vault. Report ambiguous duplicate names rather than guessing. [Obsidian link rules](https://obsidian.md/help/links)
- Do not translate inter-note wikilinks, block references, note embeds, Canvas, or Dataview in this release. Retain source text and warn about references that will not work. Image and attachment embeds remain required resource migration, not exclusions.

### Joplin

- Explicitly support RAW export directories, Markdown export directories with or without Front Matter, ZIPs containing those exports, and `.jex`. Detect entry structure rather than relying solely on extensions.
- JEX is TAR; RAW is the equivalent directory representation. Parse notebook parent relationships, notes, tag associations, and resources before resolving body resource IDs. Not every `.md` entry represents a user note. [Joplin export documentation](https://joplinapp.org/help/apps/import_export/#exporting)
- A resource-folder/32-character filename is only a resource candidate. Confirm Markdown payloads through a valid RAW resource descriptor from another entry before reading them as text; unconfirmed Markdown remains eligible as a note.
- Markdown exports use paths and available metadata. Times and tags absent from an export cannot be reconstructed; preflight distinguishes absent source data from parsing failures.

### Shared rules

- Preserve valid source instants as timezone-qualified ISO timestamps. Retain and warn about missing or timezone-ambiguous values rather than presenting invented times as original. Omitted fields retain the existing creation API default of the import time.
- Whether `_resources`, `assets`, or similar directories become notebooks depends on whether they contain notes or ancestors of notes—not their name alone. Resource-only directories do not become empty notebooks.
- Repeated references to one attachment in one note create one upload. Across notes, upload separately under existing resource ownership rules. Preflight attachment counts mean planned EdgeEver resources, not unique source files. Resources unrelated to any note are listed as not imported.
- Rewrite actual image/link targets, not code blocks, inline code, or matching plain text.
- Preserve external URIs in standard Markdown, including HTTP(S), FTP and Obsidian app links, without local-attachment lookup, target reads or new preflight warnings. Existing link-opening and rendering-safety policies remain unchanged.
- Normalized paths must stay within the selected root. Continue rejecting `file:` URIs and Windows drive forms, including drive-relative paths, under existing local-path rules; Wiki targets remain literal filenames. Do not follow archive symlinks or extract archives to arbitrary user directories. Report multiple entries mapping to one normalized path as ambiguous.
- Convert only static HTML content; do not execute scripts or event handlers. XML processing does not fetch DTDs or resolve external entities, while still accepting ordinary ENEX format declarations.
- Retain existing limits: notebook names of 80 characters, note titles of 160, images up to 100 MiB, and other attachments up to 1 GiB. Normalize tags in source order, remove empty/duplicate values and keep the first 24. Ignore extras with a non-blocking preflight warning showing the ignored count; ordinary editing retains its existing tag persistence rules. Preflight reports violations; it does not truncate text/titles or compress images to claim success. Errors preventing faithful import must be fixed first; warnings such as absent optional metadata may be acknowledged.

## 4. Modules and memory model

Add `packages/shared/src/note-import/` for platform-neutral source descriptors, directory plans, parsers, reference resolution, and result types. Export it through a subpath so the shared root entry does not pull in parsing dependencies. Module responsibilities:

- `types.ts`: `ImportFile`, `ImportNote`, `ImportSummary`, resource descriptors, and phase-specific results.
- `sources.ts`: a common directory/ZIP/TAR reader returning entry metadata and lazily opened byte streams.
- `session.ts` and `metadata.ts`: format scanning, folder/resource mapping, metadata and per-note reading; `evernote.ts` handles streaming ENEX. Inject ENML conversion so the Worker does not depend on a DOM.
- `references.ts`: parse actual image/link positions and rewrite target URLs precisely.

Add `apps/web/src/lib/note-import/` for file selection, Web Workers, temporary storage, execution, and task state. Web and Electron renderers share it. File and directory inputs preserve relative paths; the first release does not introduce Electron IPC accepting arbitrary filesystem paths.

The task index stores the import ID, source format, folders, note metadata, resource descriptors, issues, and reading locators—not the library's bodies or attachment base64. Page large indexes into task-scoped IndexedDB and read previews by page. Completed results store only note location/version/timestamps and resource mappings; keep intended commit content only while the current note is incomplete.

Run scanning and decompression in a Worker. Reuse `@zip.js/zip.js`; prefer `sax` for XML and async-iterable `it-tar` for TAR, validating browser builds and large-field behavior before pinning versions and licenses. Do not use archived `saxes` or write custom XML/TAR codecs. [SAX](https://github.com/isaacs/sax-js) · [it-tar](https://github.com/alanshaw/it-tar)

The first ENEX pass scans metadata and resource sizes. After confirmation, a second pass processes each file sequentially rather than rescanning it for every note. ZIP/TAR readers honor backpressure rather than extracting all entries at once. Stage a note's decoded resources in chunks in app-private storage and connect them to the existing `uploadMemoResourceParts` `readPart` interface. Perform DOM conversion one note at a time, yielding to the event loop.

Process only one note's body and attachments at a time, releasing its bytes afterward. Insufficient temporary space stops the task explicitly rather than falling back to whole-archive memory buffering. Clean decoded resource chunks on completion or cancellation. Retain the indexes and ID mappings needed for incomplete results until those results close, allowing task-local retries to reread source files on demand. Opening a result note hides the dialog and retains this task for retry; explicit result dismissal or selecting another export clears its indexes. Never modify source directories.

## 5. Writes and failure handling

### API additions

Add `apps/api/src/import-routes.ts` with:

- `GET /api/v1/imports/capabilities`: protocol version and the existing batch limit, checked before any writes. An unsupported older server prompts an upgrade for this entry only; existing editing, sync, and backups remain usable.
- `POST /api/v1/imports/memos`: accepts `importId`, format, destination notebook, items, and `dryRun`, validates them, and calls `importMemosRecord`. The server constructs `third-party-<format>-<importId>` as the source; each note uses a fixed preflight item ID, respecting existing source/external-ID limits of 80/512 characters. Return per-item created, skipped, and failed outcomes.

Keep session authentication, workspace isolation, and existing note read/write permissions. Do not require MCP tokens or introduce authorization scopes. Use existing APIs for notebook creation, attachments, edit sessions, and document updates. Add corresponding client methods and optional `createdAt` / `updatedAt` update fields; existing callers gain no required arguments. Import needs no persistent import-task table. The companion large-library export repair adds the `0085` memo index described in the [change scope](changes/2026-10-27-third-party-import.md#large-library-reads-and-exports).

### Execution order

1. Select the source format and files. After scanning, show the target instance/account, planned notebook/note/resource counts, the folder tree, and issues. Scanning and dismissing preflight do not write remotely.
2. Choose top-level notebooks or an existing parent. Read destinations from the server; locally pending parents become selectable after ordinary sync. Show the actual new tree without imposing an extra source wrapper. Create no notebooks before confirmation.
3. On confirmation, fix the instance, account, workspace, destination, and request context, then verify API availability. Desktop obtains the sync pause handle and waits for in-flight sync before creating notebooks in parent-first order. Persist a pending-confirmation marker before creating each folder, then retain its source-to-target ID mapping. If local mapping persistence fails after the server creates the folder, keep it unconfirmed rather than blindly creating again.
4. Create notes by destination one at a time, using batches of one within the server's existing 1–25-item contract without imposing a new limit. Complete the next step before processing another note. Retain source body and times, recording the returned ID, `revision`, and `contentHash` as the import baseline. `skipped` means creation already occurred, not that attachments and the final document are complete.
5. Upload resources note by note and retain source-resource-to-URL mappings. When required resources are ready, obtain an edit session, verify that current revision/content still match the task's saved import baseline, and submit protected rewritten content with source or initial creation timestamps. A fresh session must not authorize overwriting intervening user edits; report any baseline mismatch as a conflict. Resource uploads and rewriting must not turn the original modification time into the migration time. Advance the task baseline after a successful commit.
6. Count a note as successful only after its body, required resources, and final commit are complete. Release the desktop pause handle before refreshing the workspace: existing sync skips work while paused. If import succeeded but local pulling failed, separately show “imported” and “sync pending”; do not import again.

### Failure, cancellation, and retries

- A failed attachment or final commit retains the created note and task-local mappings as incomplete, allowing retries within this task. Retry missing steps without creating another note. Results link to incomplete notes and identify failed attachments instead of showing only an aggregate success count.
- Add no blind retries for batch POSTs, notebook creation, or final document updates. Resolve/replay uncertain note creation with its fixed import key. If uncertain notebook creation or attachment completion cannot be reconciled to an owned result, stop and report rather than assuming failure and creating again.
- Preserve the existing multipart PUT retry behavior. A new task does not scan existing notes for title-based duplicates or pretend to resume an earlier run.
- Cancellation stops new writes and aborts cancellable reads/uploads, retaining completed results and explicitly listed incomplete items. It does not delete existing data or promise a whole-library transaction rollback. Report submitted requests without known outcomes as “result pending confirmation.”
- Logout or account/instance changes cancel the old task; late results cannot update a different workspace. Run one foreground import per workspace, with a workspace-level controller surviving settings-card unmounts. Fully exiting the app ends execution.
- Release the sync pause in `finally` on every termination path. Keep pre-existing local edits in their original queue; do not clear, overwrite, or forcibly migrate them for import.

## 6. Show only what the operation needs

Add `ThirdPartyImportCard` and a shared `ThirdPartyImportDialog`, using existing shadcn/ui Dialog, selection, progress, and Tooltip components. The entry shows source selection, file/folder selection, and the migration-guide link.

Preflight emphasizes three counts, destination, and the folder tree. Expand warnings beside affected files/notes and make blocking errors locatable. During execution, show the phase, current file, and completed/total counts; do not fabricate percentages while scan totals are unknown. Separate successful, incomplete, cancelled, and unconfirmed results, with actions to open the destination and retry failed steps.

Update existing locale catalogs for import text. Retain other settings groups, backup/encrypted restore, single-file Markdown drag import, and the command-line guide's existing usage.

## 7. Acceptance

Acceptance follows real user flows:

- Operate every source from Settings. Preflight counts match actual new data; cancelling preflight leaves databases and object storage unchanged. Use lawful sanitized exports or exports created for testing, not personal libraries.
- Run the same core flows through Cloudflare local D1/R2 and Docker SQLite/object-storage adapters. Read back full paths, titles, tags, original creation/modification times, and resource associations. Create existing data in the baseline version, upgrade to the version with the new API, then import and confirm existing data and old editing/backup entries retain their contracts.
- Reopen imported notes after making source directories unavailable; images and attachments must load from EdgeEver resources. Check actual content and link positions, not merely HTTP 200. Reuse applicable evidence for unchanged guide, EdgeEver ZIP v1/v2, and encrypted desktop restore behavior.
- Use a first-note-success, second-note-resource-failure, third-note-not-started flow. Check accurate results, task-local retries without duplicate first/second notes, and no overwrite after concurrent edits. Desktop sync must resume after success, failure, and cancellation; local timestamp readback must match the server after refresh.
- Fix note counts and body sizes, then compare multi-attachment archives totaling about 1 GiB and 4 GiB, keeping each file within current upload limits. Record browser/desktop versions, peak heap/RSS, active buffers, and temporary disk use. Memory must not grow roughly in proportion to total attachment bytes; the UI must remain cancellable without whole-archive memory copies. Separately cover a single large ENEX base64 field, not only Vaults containing many small files.
- Compare real Worker/IndexedDB preflight as note count grows, and import multiple large bodies through the real API. Result pages must retain baselines without full Markdown/JSON/text, while retries and concurrent-edit protection still work.
- Cover `.notes`, missing resources, ambiguous references, root escapes, resource-only directories, absent metadata, and existing limits; check feedback and final counts. Add isolated parsing tests only for distinctions not effectively covered end to end.

Required checks are `bun run typecheck`, `bun run typecheck:mobile` and `bun run build:web`, alongside the affected actual flows. Any later Android entry requires USB-device acceptance.

## 8. Risks, rollback, and remaining validation

This is a high-risk data-writing feature. Worst outcomes include partially created folders/notes with incomplete resources, duplicate imports, or incorrect timestamps/link conversions. Write only to newly created objects, retain source files and per-item outcomes, avoid overwriting existing notes, and protect final writes with edit sessions. Import changes the workspace backup revision under existing rules; automatic backups may retry after source changes. Do not alter scheduling or weaken backup consistency checks.

Feature rollback can remove the new entry and REST routes without changing old editing, sync, or backup protocols; imported data remains ordinary usable notes. Code rollback does not undo data already written. Any cleanup must be confirmed using actual IDs recorded for that import, not bulk deletion by name.

The [acceptance conclusions](changes/evidence/2026-10-27-third-party-import/README.md) distinguish the current Web/API candidate, earlier macOS/Linux native flows, existing-instance Cloudflare upgrades and large-library measurements. Real Evernote 11.40.2 ENEX, Obsidian 1.14.5 Vault and Joplin 3.7.21 RAW/JEX/both Markdown exports preserve declared bodies, hierarchy, source timestamps and original resource bytes.

R27–R30 and the `0085` index are deployed to the existing Cloudflare instance. R31–R39 and `0086` are verified locally and are not deployed; earlier native acceptance does not cover these latest repairs. Windows native, physical mobile devices, older-client editing, AppImage installation/cross-version updates and Docker container deployment remain unverified. Fresh password login and saving a Web ZIP to the local filesystem were not covered by the latest Cloudflare acceptance; they require checks through those entries when that deployment is accepted.

## 9. D1 quota optimization

### Add the paging index first

Limit this iteration to a `(workspace_id, id)` memo index supporting consistent-backup memo pages and initial sync. It offers the largest measured benefit without API, client or backup-protocol changes. Treat unchanged-backup probing and search-index deduplication as separate follow-ups rather than changing these established paths together.

Both endpoints continue by `id` without an index matching the workspace and ID range. Local D1 chooses the creation-time index's workspace prefix for backup and the archive index's workspace prefix for bootstrap, then repeatedly scans and sorts. Earlier SQLite VM measurements do not establish D1 row consumption in this environment; the [native row-count comparison](changes/evidence/2026-10-27-third-party-import/README.md#native-d1-row-count-comparison) supplements them.

For 4,047 notes, adding only the candidate index reduces full-backup reads from 1,356,449 to 50,073 and initial-sync reads from 195,818 to 24,412. Complete returned data and ordering match. These are local workerd D1 `meta.rows_read` values; equivalent production-scale validation remains outstanding.

### Implementation scope and choices

Add incrementally numbered migration `0086_memo_id_paging_index.sql`. Its only statement is:

```sql
CREATE INDEX idx_memos_workspace_id ON memos(workspace_id, id);
```

- Retain executed migration `0085` and its creation-time index: Web JSON/Markdown exports still order by creation time and ID.
- Choose `(workspace_id, id)`, not `(workspace_id, is_deleted, id)`: bootstrap includes deleted notes and does not constrain `is_deleted`, so the latter cannot serve both endpoints with a contiguous ID-range lookup. Backup retains its existing deleted-note filter.
- Retain queries, cursors, page sizes, response fields and ordering. Cloudflare D1 and self-hosted SQLite use the same migration; existing clients need no new parameters.
- Do not force `INDEXED BY` or substitute periodic `ANALYZE` for the missing index: neither an incompatible index order nor changing statistics should be required for this access path.
- Add no import limits, quota configuration, retries, scheduling delays or fallback reads. Retain idempotency records, audit events and concurrency protection.

### Read/write costs and risks

Building the candidate index on this dataset reads 8,203 rows, writes 4,048 and increases database size by 224 KiB. With the actual migration, create-service writes increase from 25 to 26 rows while ordinary body updates remain at 26. Deletion and workspace/ID changes also maintain the index. Import write budgets must still account for existing tags, resources, audits and the additional index maintenance.

This is a high-risk storage migration. Risks include database queuing during construction, insufficient space or remaining daily reads/writes, and other queries choosing a worse plan with the new index. Record database size and remaining usage before migration; stop subsequent deployment steps if migration fails. The migration adds only an index, without rewriting business fields or triggers.

### Acceptance and rollback

1. Reuse the complete-schema fixture in `backup-consistency.test.mjs` to exercise backup and sync routes in the same workspace context. Reproduce repeated scanning/sorting in the old schema before applying the migration, and retain existing `sync-routes.test.mjs` contract checks. Do not run `ANALYZE` beforehand and mask the defect.
2. Upgrade existing data and compare complete backup, bootstrap and legacy default calls: notes, notebooks, bodies, tags, timestamps, resource metadata, revisions and order must match. Cover multiple workspaces with interleaved IDs, deleted notes and page boundaries. Retain authorization, consistency-version checks and rejection when the source changes.
3. Reuse the valid 4,047-note isolated comparison and check only affected premises against the final migration. Add a scale regression with fixed-size content at 1,000/4,000 notes: cumulative memo-page reads should be approximately linear, with four times the notes consuming at most five times the reads. Plans should seek by workspace and ID range instead of rescanning on every page. Check the paging query itself, not legitimate sorting inside existing fallback subqueries. Measure actual `rows_read` / `rows_written`, including new writes and creation-time exports to detect regressions.
4. Deployment acceptance distinguishes prior-instance migration, API data readback and D1 usage observation. Local prior-schema upgrade, API contracts and the actual migration’s scale/write-cost checks pass; deployed construction costs, plans and complete-flow row counts remain to be recorded. Reuse applicable native archive-compatibility evidence for unchanged behavior.

Application rollback does not remove the index. If the index causes a regression, add a later migration dropping it while retaining business data. Do not edit executed migrations or remove the existing creation-time index. Retain the previous Worker version, database backup and independent recovery entry before deployment.

### Follow-up candidates outside this iteration

| Scenario | Candidate and evidence | Reason to defer |
| --- | --- | --- |
| Unchanged scheduled backup | Compare workspace identity and backup revision cheaply before reading full counts when changed. The current unchanged check still reads 12,313 rows at 4,047 notes. Retain old endpoint responses and pre/post-page consistency checks. | Saves one due check rather than repeated page scans. Backup API/native Worker compatibility needs its own design and acceptance. |
| Updates with unchanged searchable content | Compare title, plain text and tags before updating an existing search document, while still inserting missing documents. An isolated SQL guard reduces four written rows to one, not zero because of autoincrement-sequence maintenance. | Smaller benefit than the paging index; the shared helper also serves ordinary editing, restoration and tag operations. Validate those consumers separately rather than changing global behavior for a local import gain. |
