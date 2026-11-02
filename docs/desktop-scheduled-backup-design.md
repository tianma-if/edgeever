# Desktop scheduled backups and encrypted recovery

[简体中文](desktop-scheduled-backup-design.zh-CN.md)

Related: [Issue #650](https://github.com/tianma-if/edgeever/issues/650) and [original request #61](https://github.com/tianma-if/edgeever/issues/61). Updated: 2026-10-27. Status: implemented; see the [implementation audit](changes/2026-10-23-desktop-scheduled-backup.md#completion-audit) for evidence and outstanding acceptance.

The desktop app periodically saves the current account's knowledge base as an independent archive, with optional password encryption. Users can choose a folder managed by their existing cloud-drive client to transfer the archive off-site. If the original instance becomes unavailable, they can connect the desktop app to a new instance and restore it.

This delivery includes scheduled backups, manual runs, encryption, and decryption for recovery. It preserves the existing knowledge-base format and packages data in a desktop background task rather than creating large files on the server. A new server-side consistent-read protocol prevents omissions caused by changing data during pagination.

## 1. Backup coverage

The source is the current account's **synchronized knowledge base** on the current instance. It includes undeleted notes, notebook hierarchy, tags, archive and pin states, existing revisions, AI prompts, and active attachments associated with those notes. Both structured content and readable Markdown copies are preserved.

This delivery excludes:

- Changes not yet synchronized to the server, pending offline uploads, and Trash.
- User accounts, sign-in credentials, API keys, deployment settings, object-storage configuration, and publication settings for public shares and forms.
- Files referenced only by external URLs and not registered as EdgeEver resources. Their links remain in the content, but those files still depend on the external service.

The coverage description in Settings should say “Backs up synchronized notes and attachments.” A backup does not push pending local changes or substitute local caches when the network is unavailable. A network failure preserves the last successful result until a retry can run.

Existing SQLite snapshots remain a separate local recovery mechanism. WebDAV and S3 transfers, OS-level scheduling after the app exits, browser-based password export and decryption, and native mobile entry points remain outside this delivery. Existing ordinary ZIP import and export on the Web remain available.

## 2. Defaults and settings

Desktop Settings → Data and backup uses one “Backup and restore” card instead of the standalone ZIP export card. Existing Web import/export remains unchanged.

| Setting | Initial behavior |
| --- | --- |
| Automatic backups | Initially off; enabling a valid configuration schedules the first run |
| Frequency | Weekly or monthly; weekly by default. Existing daily and biweekly settings remain valid and are displayed as a disabled option until changed |
| Destination | `EdgeEver Backups` under the OS Documents directory; change through the native directory picker |
| Keep recent | 1, 3, or 5 archives; 1 by default. Existing 10- and 20-archive settings remain valid and are displayed as a disabled option until changed |
| Backup encryption | Optional and initially off; enabling it requires entering and confirming a separate backup password |

The top actions are “Back up now,” “Restore from file,” and “Open folder.” Below them, show the last actual successful archive, latest check result, and next scheduled check or automatic-off state. Running tasks can be cancelled. Manual runs start immediately with an automatically generated local timestamp filename and the saved encryption, destination, and retention settings; they remain available when scheduling is off. Prompt for a password only when an encryption password is unavailable or an interrupted encrypted backup needs verification. Keep inline progress, success, and failure feedback.

An encryption password must be nonempty and both entries must match exactly. Do not trim whitespace or normalize Unicode. After saving, show only “Password set,” never the saved value. When changing it, explain that the new password applies only to future archives.

Backup settings sit below status and are initially collapsed. The local archive list stays visible with filename, time, size, encryption status, and Restore/Delete actions. Deletion requires confirmation. Save configuration only when no task is running; cancel active work first to keep the displayed and running configuration consistent.

## 3. Background execution and account isolation

### 3.1 Process responsibilities

- **Electron main process** owns configuration, OS-protected credentials, directory authorization, scheduling, and task lifecycle. Narrow IPC methods expose status and actions to Settings.
- **A separate background task** reads data, encodes and decodes ZIPs, encrypts and decrypts, validates, and writes files. It does not depend on Settings being mounted or the renderer staying alive.
- **The Web settings UI** handles configuration, progress, and restore confirmation. It does not receive saved passwords or transfer complete archives over IPC.
- **A shared archive module** owns platform-neutral formats, validation, and ZIP operations. File pickers, browser downloads, Node file streams, and OS credentials stay in their respective adapters.

Reuse existing main-process lifecycle and resume events. Do not register backups as AI scheduled tasks or implement a second ZIP format in the Rust sidecar.

### 3.2 Scheduling rules

Check whether a backup is due at app startup, when sign-in is ready, and on system resume, plus once per hour while the app runs. A newly enabled schedule with no successful backup is due immediately. Multiple missed intervals produce one run, not a backlog.

Anchor the next due time to the last completed archive or no-change check, adding 1, 7, or 14 local calendar days or one calendar month. Clamp month-end dates to the destination month’s last day and recalculate after local timezone changes. Changing frequency preserves the last actual archive-success time.

When source identity/revision, configuration and password generation match, and the previous registered archive remains in the current directory with the expected size, scheduled work records no change without creating or rotating files or advancing archive-success time. Missing comparison metadata or files produce a new archive. Manual runs always produce a new archive.

Run at most one backup at a time, with the same exclusion rule for manual and scheduled runs. Use a low-priority task without locking foreground editing. Track `lastAttemptAt`, `lastSuccessAt`, and `nextDueAt`; failure does not advance the success time. Following a network failure or source change, automatic retries can occur at a check at least one hour later. Manual retries need not wait. If sign-in, directory changes, or secure-store unlocking require user action, show that action without repeated dialogs.

Tasks may run while the window is hidden in the tray. Fully exiting the application cancels the task, and the next startup checks the schedule again. Sleep, crashes, and cancellation never turn an incomplete task into a successful backup.

### 3.3 Isolation rules

Store configuration, credentials, and success records per instance and account. Each local backup set also has a random `backupSetId`; different devices do not share retention ownership.

Capture the instance URL, account, workspace, session credential, configuration, and destination when a task starts. Every request uses that captured context rather than mutable global account settings. Signing out or switching accounts or instances cancels the old task. Late responses cannot publish files, update another account's status, or trigger cleanup.

## 4. Consistent server reads

The existing `/api/v1/backups/json` route uses `OFFSET` pagination. Deletions during an export can skip later records. The existing synchronization cursor covers only some entities, so it cannot represent a complete backup revision that also includes resources and prompts.

Use **workspace revision checks with cursor pagination**. Users can continue editing, but a task becomes a successful backup only when no relevant data changes during the export. Do not hold a transaction across requests or maintain server-side archives or persistent backup jobs.

### 4.1 Workspace backup revision

Add `backup_revision`, defaulting to 0, to `workspaces` through a new numbered SQL migration. Database triggers increment the owning workspace's revision on backup-related inserts, updates, and deletes in the same transaction as the original write.

Coverage includes `notebooks`, `memos`, `memo_contents`, `memo_revisions`, `resources`, and `ai_prompt_templates`. Tables without a workspace field resolve ownership through their note. Resolve ownership before deletion, and cover both affected sides when relationships move. Restore operations, bulk deletion, and background revision cleanup must also advance the revision.

This revision answers only whether data changed. It is not a note count and does not reuse or alter the synchronization cursor. Transmit the database revision as a decimal string in the API.

### 4.2 Read protocol

Introduce a backup read protocol while preserving the old endpoints, parameters, and usage conditions:

1. `GET /api/v1/backups/state` returns the protocol version, current user and workspace, workspace identity, `backupRevision`, and in-scope entity counts.
2. `GET /api/v1/backups/data` accepts a `kind`, cursor, and the workspace identity and revision from step 1. It pages through notebooks, prompts, or notes. Note pages include their revisions and attachment metadata. Use stable-ID cursor pagination, not offsets.
3. Check identity and revision before and after each page. A mismatch returns `backup_source_changed` and fails the entire task. After downloading the attachments, call the state endpoint again for a final comparison.

New endpoints preserve the existing backup authentication and access checks. The server resolves the workspace from the authenticated session; clients cannot select another user's workspace. Disable caching for state and export responses. Revision checks must read the database's primary write view rather than a lagging replica.

Validate attachments against their recorded byte lengths and existing SHA-256 digests. If a record has no digest, compute one while reading and store it in the archive for restore validation. Missing, truncated, or mismatched attachments abort the task rather than being skipped. This protects application-managed data, not direct database or bucket edits that bypass the application.

When a new desktop client connects to an old server without this protocol, request a server upgrade rather than silently using a weaker export path. Existing manual ZIP export remains available under its original contract.

This choice adds revision-update overhead to data writes. A continuously changing workspace may repeatedly postpone a successful backup, so the UI must preserve the actual last-success time. Completing a point-in-time snapshot during continuous writes would require a separate snapshot and object-version retention design, not ignored revision changes.

## 5. Preserve the logical format and support ZIP64

Ordinary archives retain the existing `edgeever-zip` `formatVersion: 2` layout:

- `manifest.json` records the format, app version, export time, and entity counts, retaining `includesTrash: false`.
- `notebooks.json` and `prompts.json` hold the hierarchy and prompts.
- `memos/<id>.json` holds notes, revisions, and resource metadata.
- `notes/` holds notebook-organized Markdown and attachments addressed by relative paths.

Do not introduce the alternative `memos/*.md` and `resources/` layout illustrated in the original proposal. Optional provenance metadata may be added without changing existing field meanings, but account credentials and backup passwords never belong in an archive.

Use a mature ZIP64-capable codec, preferably `@zip.js/zip.js`, to replace the backup path's ZIP64-incompatible reader and writer. Do not replace compression libraries used by unrelated features. It supports ZIP64, streams, browsers, Node.js, and Bun under the BSD-3-Clause license. Pin the version during implementation and retain its license notices. [Features and compatibility](https://gildas-lormeau.github.io/zip.js/) · [License](https://github.com/gildas-lormeau/zip.js/blob/master/LICENSE)

Small archives remain compatible ZIPs; larger archives use ZIP64 as needed. Preserve ZIP v1/v2 reading and existing individual attachment and image size limits. Nullable resource digests in old archives remain nullable, without new required fields. Increasing total archive capacity does not relax upload limits. Clients without ZIP64 or encrypted-container support require a newer desktop app to restore those files.

New desktop backups, large-archive parsing, and attachment restore process chunks with backpressure. Do not first convert an entire ZIP into a `Blob`, `ArrayBuffer`, or base64 string. Read ZIP directories and entries on demand instead of keeping all attachment content in memory. For browsers without streaming file saves, preserve the existing manual Web export path that buffers at most 128 MiB; new desktop capabilities do not become prerequisites for existing usage.

## 6. Encryption container and password handling

### 6.1 One initial password suite

Use Node's native cryptography for `AES-256-GCM` with `PBKDF2-HMAC-SHA256`, deriving a 32-byte key with 600,000 iterations. PBKDF2 reuses platform implementations and supports future cross-platform interoperability. The work factor follows OWASP's PBKDF2 guidance; measure it on target devices during implementation without silently reducing it for speed. [Parameter reference](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2)

Generate an independent random 16-byte salt and 12-byte IV for each file and use a 16-byte authentication tag. Encode the password as UTF-8 without normalization or trimming. Files use the `.edgeever.enc` extension and the following order, with multibyte integers in big-endian encoding:

| Field | Size and value |
| --- | --- |
| Magic | 4 bytes, ASCII `EDGB` |
| Container version | 2 bytes, `1` |
| Cipher ID | 1 byte, `1` for AES-256-GCM |
| KDF ID | 1 byte, `1` for PBKDF2-HMAC-SHA256 |
| Iterations | 4 bytes, `600000` |
| Salt | 16 bytes |
| IV | 12 bytes |
| Payload | Ciphertext of the complete ZIP byte stream |
| Authentication tag | 16 bytes at the end of the file |

Authenticate the first 40 header bytes as GCM AAD. The v1 reader accepts only this suite and these parameters, rather than executing arbitrary KDF costs from a file. Report unsupported versions or parameters. Future parameter changes must define container compatibility explicitly instead of reinterpreting a published version.

The ZIP input to one whole-file GCM operation cannot exceed `2^36 - 32` bytes, or 64 GiB minus 32 bytes. Abort larger encrypted exports and retain previous backups. This is GCM's single-message limit, independent of ZIP64 support. Larger encrypted archives require a new chunk-authenticated container, not reuse of one IV to bypass the limit. [NIST SP 800-38D, section 5.2.1.1](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)

### 6.2 Unattended credentials

Never send the backup password to the EdgeEver server or cloud drive. To run unattended, protect it locally through Electron `safeStorage` and OS credential mechanisms. Bind the saved credential to its instance and account, outside ordinary configuration, `localStorage`, logs, and backup directories.

On Linux, inspect the actual secure-storage backend; `basic_text` cannot store automatic-backup passwords. If secure storage is unavailable or locked, pause encrypted automatic tasks. Users may unlock it or enter a password for one run without saving it. Never fall back to plaintext output or plaintext password persistence. [Electron secure-storage documentation](https://www.electronjs.org/docs/latest/api/safe-storage)

Changing the password affects future archives only; do not re-encrypt old files automatically. Restoring another device's archive requires the file and its original password, not the original computer's OS key. There is no server endpoint to recover or reset an old archive's password.

## 7. File publication and retention

Users select a destination root, and the app creates a `<backupSetId>` subdirectory for the current local backup set. Settings shows the effective destination, and “Open folder” opens it. Automatic filenames use UTC time and a random backup ID, such as `edgeever-backup-20261023T020000Z-<id>.zip`, with `.edgeever.enc` for encrypted files. Manual names use an automatically generated local timestamp without a random ID; append the saved format’s extension. Name conflicts fail without overwriting existing files.

A task performs these steps in order:

1. Validate the account, credentials, destination, and server capability, and record task ownership.
2. Stream the export to a unique `.part` file in the destination. With encryption enabled, ZIP bytes flow directly into encryption without plaintext intermediate files in the synchronized folder.
3. Validate entity counts, attachments, and the final source revision, finalize the ZIP and encryption, and flush the file to disk.
4. Publish atomically within the same directory and persist completion and last-success time. Automatic runs rename random filenames; named manual runs create an exclusive hard link and fail on conflicts or unsupported filesystems.
5. Remove old files beyond the retention count and send one lightweight OS notification.

Any failure before publication cancels the streams and removes the task's temporary file without advancing success or running retention. If publication succeeds but recording completion is interrupted, recovery checks the task record and file integrity before taking further action; it must not simply delete the file as garbage.

Cleanup covers only files recorded locally as complete and owned by the current backup set. Sort by recorded completion time, not filesystem modification times. Do not follow symlinks to delete external files or remove manually placed files or files owned by other devices or accounts.

If a new backup succeeds but retention fails, retain the successful result and separately report “Old backup cleanup failed.” Try cleanup again with the next task. Changing the destination or disabling scheduling does not delete the old directory. A new installation that cannot establish ownership preserves old files and creates a new backup set.

Report only “Local backup complete.” Upload completion, conflict copies, and remaining cloud capacity belong to the cloud-drive client. Do not report unverified cloud-backup success.

## 8. Decryption and restore

“Restore from file” starts in the current backup-set directory and allows other locations; row-level Restore selects that archive directly. Both use one unlock/check/confirmation flow, identifying ordinary ZIPs and `.edgeever.enc` files by header rather than extension alone.

1. Identify the container version and request a password for encrypted files. Cancellation causes no restore writes.
2. Decrypt as a stream to an app-private temporary directory. Only after final GCM authentication may parsing and restore begin. Use `0700` directories and `0600` files on Unix, and the current user's private application-data directory with appropriate ACLs on Windows. Plaintext staging stays outside synchronized folders.
3. Scan the complete ZIP and validate its format, entry paths, CRCs, entity counts, relationships, attachment lengths, and digests. Authentication failure reports “Unable to decrypt: the password is incorrect or the file is damaged.” Report unknown versions separately.
4. Show the target instance, account, and import counts. Explain that matching IDs are overwritten and unrelated data is preserved, then wait for confirmation.
5. Reuse existing prompt, notebook, note, and attachment restore APIs, preserving IDs and workspace access boundaries. Reject a page before writing if a revision ID belongs to another note; same-ID/same-note restore remains repeatable. Refresh the workspace after every part succeeds.

GCM stream output is not trusted until final authentication. Never write records to the database while decryption remains unauthenticated. [Node.js authenticated-decryption documentation](https://nodejs.org/api/crypto.html#decipherupdatedata-inputencoding-outputencoding)

A network failure after import begins may leave completed batches. Show “Restore incomplete,” retain the original file, and allow a retry rather than claiming a workspace-wide rollback. Repeated imports retain existing ID-based restore semantics. Delete plaintext staging after success, failure, or cancellation; following a crash, clean only temporary files recorded as app-created.

Recovery does not contact the original instance. Acceptance must disconnect that instance, import the archive into a fresh one, and open the restored notes and attachments.

## 9. Impact, compatibility, and rollback

This is a high-risk data-protection feature. Worst outcomes include plaintext disclosure, unreadable archives, deletion of the last usable backup, and revision triggers disrupting normal writes. Forgotten passwords and full disks are only part of the risk.

The affected areas are the desktop main process and background task, shared archive module, Web settings and desktop-import adapter, backup read APIs, new migration, and client protocol. Cloudflare and Docker share consistency logic, with runtime differences confined to existing storage adapters.

Preserve these compatibility requirements:

- Existing ordinary manual ZIP export, ZIP v1/v2 import, and local SQLite recovery remain usable.
- The consistency protocol applies only to new automatic backups and their “Back up now” action. Existing callers gain no required parameters or upgrade prerequisite.
- Do not change synchronization cursors, note IDs, access rules, or executed migrations. Validate editing, synchronization, deletion, and restore on real pre-upgrade data after adding the triggers.
- Disabling the feature stops new tasks but preserves completed archives and directories. An application rollback does not delete the additive column or triggers. Correct faulty triggers through a subsequent migration.
- Retain a client capable of reading generated encrypted and ZIP64 archives. Rolling back to an older client does not establish that new archives remain recoverable.

Release the implementation as a feature version. This design does not allocate a version number or change installers, automatic updates, or release workflows.

## 10. Implementation order and acceptance

Before implementation, record confirmed behavior in a bilingual change-scope document under `docs/changes/`. These steps form one delivery; encrypted scheduled backups cannot ship without decryption and recovery:

1. Implement the consistency protocol and migration, validating upgrades and old/new client contracts.
2. Extract the shared archive capabilities and implement ZIP64, container encoding/decoding, and old ZIP compatibility.
3. Implement account isolation, credentials, background tasks, atomic publication, and retention.
4. Connect settings and restore entry points, then exercise actual disaster recovery.

Use the smallest sufficient checks for these behaviors, reusing existing backup and restore tests. Add any necessary new automated checks before their implementation.

| Scenario | Required observation |
| --- | --- |
| Plain and encrypted disaster recovery | With the original instance unavailable, restore through the actual desktop UI into a fresh instance; verify in-scope note structure, revisions, prompts, and attachments, then open content and files |
| Upgrade from the previous version | Editing, sync, deletion, and restore still work after upgrading a real old database; ZIP v1/v2 import works and existing callers need no new parameters |
| Concurrent source changes | Note insertion/deletion, prompt edits, revision cleanup, and attachment changes during export fail the task without rotating old backups; stable data succeeds |
| Background lifecycle | Closing Settings, hiding in the tray, renderer reload, and sleep/resume do not duplicate runs; app exit cancels and missed intervals produce one catch-up run |
| Account and destination isolation | Account/instance switching causes no mixed data or late success; retention preserves other accounts, devices, manual files, and previous directories |
| Passwords and damaged files | Wrong passwords, modified headers/ciphertext, truncation, and unknown suites produce no restore writes; secure-storage failure produces no plaintext backup |
| Large archives | An actual archive over 4 GiB exports and restores, ZIP64 entry-count boundaries are readable, attachment content is not buffered as a whole archive, and the encryption length limit is enforced accurately |
| Filesystem failures and recovery | Full disks, lost permissions, cancellation, interrupted writes, and retention errors preserve success records and history as specified in section 7; plaintext staging never enters a synchronized folder |
| Desktop platforms and servers | Validate directories, credentials, publication, and restore separately on macOS, Windows, and Linux; validate consistent reads and migrations on both Cloudflare and Docker |

Record platform, cross-version, and large-archive evidence separately. A small-file run on one platform does not cover them all. Implementation must run `bun run typecheck`, `bun run typecheck:mobile`, and `bun run build:web` as required by the project; these do not replace recovery acceptance.

## 11. Existing implementation and sources

- [Current ZIP import/export](../apps/web/src/lib/json-backup.ts) and [format definitions](../packages/shared/src/backup.ts): retain logical format and restore semantics while adding ZIP64 and the encrypted container.
- [Backup routes](../apps/api/src/backup-routes.ts), [restore service](../apps/api/src/backup-service.ts), and [sync-change migration](../migrations/0013_mobile_sync_changes.sql): add complete revision coverage without redefining the synchronization cursor.
- [Import/export card](../apps/web/src/components/settings/DataExportCard.tsx), [renderer hibernation](../apps/desktop/src/main/renderer-hibernate.mjs), and [account isolation](../apps/desktop/src/main/account-scope.mjs): retain existing entry points while keeping background work independent of the renderer.
- [Cross-runtime storage contracts](../apps/api/src/storage-contract.ts) and [self-hosting architecture](self-hosting-architecture.md): do not implement consistency logic only in the Cloudflare entry point.
- [Original backup and disaster-recovery proposal](https://github.com/tianma-if/edgeever/blob/main/docs/backup-and-disaster-recovery-plan.zh-CN.md): retain the local-directory approach while specifying Issue #650's delivery boundaries and recovery requirements.
