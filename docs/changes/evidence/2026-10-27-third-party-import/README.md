# Third-party import acceptance conclusions

[简体中文](README.zh-CN.md)

## Actual imports from three sources

The Web Settings entry and earlier isolated native runtimes passed the authored source fixtures below. Paths, bodies, tags, original timestamps and full attachment bytes read back correctly; images and PDFs are readable.

| Source | Source notebooks | Notes | Note-owned resources |
| --- | ---: | ---: | ---: |
| Evernote 11.40.2 ENEX | 1 | 1 | 5 |
| Obsidian 1.14.5 Vault | 4 | 6 | 6 |
| Joplin 3.7.21 JEX | 3 | 5 | 6 |

See the [real-source fixtures](../../../../tests/fixtures/note-import/real-apps/README.md) for provenance. Integration tests also cover Joplin RAW, plain Markdown / Front Matter, directories and ZIP. ENEX retains current task states, code blocks and its two-row table. Obsidian retains root-path precedence, literal percent signs and archive attachments inside directories. Joplin retains included hierarchy, tag associations and valid missing-ancestor boundaries.

- Cancelling preflight writes nothing. Tags beyond the first 24 are ignored in source order with a non-blocking warning.
- Task-local retries do not duplicate notes or attachments; uncertain commits are not blindly replayed. Final link updates do not overwrite concurrent human edits.
- Hiding the dialog or changing Settings categories retains a running task. Actual Web acceptance opens an incomplete note after attachment failure, returns to Settings and completes the same task by retry; explicit result dismissal cleans it up. Success, failure, cancellation and cleanup-error paths release paused sync and refresh committed writes.
- Image outer links, separate titles and resource URL suffixes survive editing, saving, reopening and export; ordinary HTML anchors are unchanged.

## Platform and upgrade coverage

- macOS: Electron 44.7.0 development shell and Rust sidecar with an isolated profile; imports, resource readback and resumed sync pass.
- Linux: Ubuntu 25.10 x86_64 / Xvfb, official v2.16.1 runtime with the import renderer. Three-source imports, failure retry, cancellation and full-restart readback pass; 16 acceptance notes and 22 cached resources persist.
- Cloudflare: an earlier candidate merged with upstream 2.16.1 passed an existing-instance upgrade and actual three-source imports. The `0072` → `0084` upgrade retained four existing notes and one resource, while upstream `0078` cleared factory colors on five default notebooks. The current R27–R30 API/Web and `0085` are now deployed; all pre-upgrade business fields in 18 notes, 19 notebooks, 23 resources and the workspace remain identical. The existing authenticated session, health and OpenAPI probes pass. Deployed Settings imports one additional ENEX note with original timestamps/tags and five matching attachment payloads; PNG/SVG load and the PDF is readable.
- Upgrading the original API against the same database retained existing bodies, tags, timestamps and resource bytes. Driver-level checks do not establish Docker container deployment acceptance.

Earlier native candidates do not cover the latest image/list and R31–R41 repairs. R31–R41 and `0086` are not deployed to Cloudflare. Windows native, physical mobile devices, older-client editing, AppImage installation and cross-version automatic updates remain unverified. Current Cloudflare checks did not repeat password login or complete saving a Web ZIP to the local filesystem; the user can confirm these through the login and export entries.

## Large libraries and quotas

These are local measurements, not production D1 billing or Worker CPU data.

### Native D1 row-count comparison

Real API with local workerd D1, the complete schema through `0085`, and no preceding `ANALYZE`. Authored data includes 4,047 notes, nine notebooks, 42 revisions, 38 resources and six prompts. Add only a candidate `(workspace_id, id)` index to an isolated database copy and compare complete traversal using `meta.rows_read`; both sides exclude session authentication and resource-payload downloads:

| Flow | Current-schema rows read | With candidate index | Reduction |
| --- | ---: | ---: | ---: |
| Complete backup, 164 pages | 1,356,449 | 50,073 | 96.31% |
| Initial sync, 21 pages | 195,818 | 24,412 | 87.53% |

Complete returned data and ordering match. Backup originally reads the creation-time index's workspace prefix and sorts; bootstrap reads the archive index's workspace prefix and sorts. The candidate lets the memo paging query seek directly by workspace and ID range. Index construction reads 8,203 rows, writes 4,048 and increases database size by 224 KiB.

Migration `0086_memo_id_paging_index.sql` is implemented. A separate scale check runs the real backup/sync routes with local D1 and 1,000/4,000 fixed-body notes in each of the target and foreign workspaces. This dataset has no resources or revisions and likewise excludes authentication and resource-payload downloads:

| Flow | 1,000 notes before migration | 1,000 notes after migration | 4,000 notes after migration |
| --- | ---: | ---: | ---: |
| Full-backup rows read | 91,226 | 12,265 | 48,985 |
| Initial-sync rows read | 15,030 | 6,034 | 24,109 |

Four times the notes consumes 3.99/4.00 times the reads. Complete pre/post-migration responses match and exclude foreign-workspace data. A create-service comparison changes from 25 to 26 written rows; ordinary body updates remain at 26. The index adds only the expected new-memo maintenance cost. Schema-upgrade regression also covers interleaved workspace IDs, deleted notes, resources/revisions and legacy default responses. All 32 backup-consistency, creation-time export and sync-contract checks pass.

`0086` has not run in production; deployed construction costs and complete-flow usage remain unverified. See the [optimization scope and rollback](../../../third-party-import-plan.md#9-d1-quota-optimization). Aggregate-row contributions and SQLite VM instructions below retain their own definitions rather than substituting for D1 row counts.

| Notes imported into one notebook | Pre-repair memo-row aggregate contributions | After R27 |
| --- | ---: | ---: |
| 100 | 9,900 | 0 |
| 1,000 | 999,000 | 0 |
| 2,000 | 3,998,000 | 0 |

A newly created empty notebook returns its full statistics once; existence checks no longer aggregate its notes. The same read amplification in parent and duplicate-note checks is also removed.

| Notes in complete export | Pre-repair OFFSET SQL VM instructions | Legacy OFFSET after R28 | New cursor after R28 |
| --- | ---: | ---: | ---: |
| 1,015 | 1,152,000 | 239,000 | 37,000 |
| 4,015 | 16,032,000 | 2,700,000 | 138,000 |

SQL VM counts are approximate. Cursors use the `(workspace_id, is_deleted, created_at, id)` index; legacy OFFSET still incurs cumulative offset skipping. Real HTTP → client → JSON ZIP / Markdown ZIP exports contain 79 notes, nine resources and 13 revisions. Bodies, tags, timestamps and independent attachment bytes match after the source server stops. Plain/encrypted backup, offline restoration and unchanged scheduled backup checks pass. The API/Web and `0085` are now deployed to the existing Cloudflare instance. Live JSON and Markdown exports each traverse three pages containing 19 notes and 28 resources, with no omissions or duplicates and no repeated total on continuation pages.

### Current-candidate browser scale checks

Actual Worker/IndexedDB preflight on macOS arm64, Ego Browser Chromium 156 and the development Web build, using separate small Markdown files with timestamps and no remote writes:

| Source | 1,000 notes | 4,000 notes |
| --- | ---: | ---: |
| Obsidian | 2.6 s | 9.9 s |
| Joplin Markdown | 2.4 s | 12.2 s |

Counts match the inputs, with no errors/warnings or remaining resource chunks. Four times the notes takes approximately 3.8/5.1 times as long. These are preflight measurements, not production per-note write throughput.

Actual Worker → IndexedDB → local D1 API import completes 96 bodies of 256 KiB each (24 MiB total) in 17.5 s. All 96 results serialize to approximately 36.7 KiB, with no full Markdown, JSON, text or intended-commit bodies and zero resource chunks. Separate SQLite API regressions pass multiple 1 MiB bodies, lost-response confirmation and concurrent human-edit protection.

Single large bodies remain subject to backend storage limits: [D1 limits a string, BLOB or row to 2,000,000 bytes](https://developers.cloudflare.com/d1/platform/limits/). Current content rows store Markdown, JSON and plain text together. A local D1 import and the existing ordinary-create entry both reject a single 1 MiB plain-text body; import returns `SQLITE_TOOBIG`. This existing storage boundary is unchanged. Large-library tests do not establish arbitrary per-note size support; oversized sources remain in the original files rather than being truncated and counted as successes.

### Implementation-baseline large resources

Implementation-baseline large-resource measurements use a separate profile per case. RSS includes the same-process Worker; heap covers only the main page. Test bytes are highly compressible, and storage estimates reflect browser-reported physical usage.

| Total input resources | Duration | Peak RSS | Peak heap | Peak estimated storage |
| --- | ---: | ---: | ---: | ---: |
| ZIP 1 GiB | 31.7 s | 1322.9 MiB | 131.7 MiB | 13.7 MiB |
| ZIP 4 GiB | 119.8 s | 1412.6 MiB | 154.7 MiB | 47.6 MiB |
| ENEX 192 MiB | 14.2 s | 1198.3 MiB | 135.4 MiB | 4.7 MiB |

All three cases end with zero temporary resource chunks. Generate large fixtures when needed rather than committing them:

```sh
bun tests/fixtures/note-import/generate-large.mjs /tmp/edgeever-note-import-large
```

## Reproduce affected checks

```sh
bun install --frozen-lockfile
bun test tests/note-import.integration.test.mjs packages/shared/src/image-link.test.mjs packages/shared/src/content.test.mjs
bun run typecheck
bun run typecheck:mobile
bun run build:web
```

Screenshots, request captures, installation details and one-off scripts are excluded from the product repository; this directory retains acceptance conclusions only.

## Image lists and special labels

Production Web imports a test ENEX with unmatched brackets, line breaks and literal `&copy;` through Settings. Labels and images survive editing, saving and reopening, all five resource payloads match independent originals, and the PDF opens for reading. Uploaded filenames retain existing API normalization; visible label line breaks become spaces.

Bullet, ordered, task and nested lists retain four images in their list items after Markdown/rich-text editing, saving and reopening, preserving outer links, starting numbers and checked states. Real-source, shared-content, related image/editor and lifecycle checks, both typechecks, the Web build and targeted lint pass. Dependencies retain locked `marked@17`; no parser upgrade is needed.

ENML uses Turndown’s asterisk emphasis delimiter so Chinese italics adjacent to surrounding text remain italic, verified in the real Evernote export’s saved JSON and Web render.

Images inside ENML links remain inline. Real-API checks cover both directly linked images and images nested in inline elements: saved JSON, Markdown round-trips and editing/reopening retain outer URLs/titles, image targets and labels. Production Web imports through actual Worker/IndexedDB, edits text in the editor, waits for saving and reopens the note after switching away. Both images and their outer links remain, with original image bytes unchanged.

FTP and Obsidian app URIs in Obsidian/Joplin pass preflight and real-API import with unchanged source text and zero resource uploads. The production Web Settings entry also completes preflight and import. Traversal, `file:`, Windows drive forms and invalid local encoding remain rejected. The new cases fail before repair; afterwards all 24 affected checks, both typechecks, the Web build and targeted lint pass.

## Task state and cleanup

Local-space failure before folder creation writes nothing remotely; failure to save a mapping after creation retains uncertainty without duplicate folders. Confirmed RAW Markdown attachments are not fully scanned as notes, while unconfirmed resource-folder notes remain supported. Same-note duplicate ENEX resources are cleaned per note; unreadable encrypted ZIPs and initialization cancellation settle promptly. Legal prototype-property attachment names upload and retry without duplicate resources or changed bytes.
