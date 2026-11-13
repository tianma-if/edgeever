# Notion and SiYuan Markdown imports

[简体中文](2026-11-11-notion-siyuan-import.zh-CN.md)

Related #794. Extends the unified importer used by flomo in #834: the same source picker, Worker/index, preflight, destination selection, chunked upload, progress, cancellation and retry executor. No new import endpoint, database migration or independent import UI.

## Scope and behavior

- Notion: official Markdown & CSV ZIP or extracted directory. Opening headings supply titles; front matter retains precedence. Strip trailing Notion IDs from display names only, preserving path identity for distinct same-name folders. Keep CSV bytes as attachments; unreferenced CSV files receive attachment notes. Do not rebuild database relations, formulas or views.
- SiYuan: official Markdown ZIP or extracted directory, including assets. Resolve `assets/` against the nearest ancestor export directory. Markdown files inside assets remain attachments. Normalize HTML images/audio/video with the shared inert HTML converter, excluding code examples and front matter.
- Original inter-note and SiYuan block links remain unchanged with warnings. Missing attachments warn, preserve the original links and allow confirmation; unreferenced ZIP files other than export parts and .sy sources block preflight. Other unused files are reported as warnings. Exported timestamps are used only when present as supported metadata; absent timestamps use existing import-time behavior.
- New tasks create new notes; retries within one task retain identity and recover unfinished uploads. CSV remains downloadable with original bytes. No server-side export fetching or source account integration.

## Notion archive imports

Both ZIP layers in the same public Notion export pass their CRC checks. The outer ZIP contains one `Export-…-Part-1.zip` with 278 Markdown files, two CSV files and an HTML index. Four local CSV targets referenced by `Home.md` are absent. The original preflight rejected the nested ZIP and blocked the unpacked export on the missing CSV targets.

- Expand one level of root-level Notion `Export-<UUID>-Part-N.zip` or `ExportBlock-<UUID>-Part-N.zip` in the import Worker. Index original relative paths together so exact references can span parts. Reuse ZIP reading, path validation, duplicate detection and cancellation. Corrupt parts block confirmation. Stage part ZIPs in chunks in the task index and read requested ranges for the ZIP central directory and entries. Retain staged parts across same-task retries and clear them with the index on close. A staging failure blocks preflight. Read notes and resources entry by entry.
- Warn for a local Notion or SiYuan attachment link (including CSV, PDF, images and Markdown assets) whose validated path has no matching entry. Show the source path and target, allow confirmation and preserve the original link. Existing CSV files keep their original bytes. Out-of-root paths and ambiguous references still block confirmation.
- Upload the same original ZIP in a macOS browser and in Linux Chrome on `jingwen-mini`. Expect four notebooks, 280 notes, two attachments, zero errors and four missing-CSV warnings. Verify zero preflight writes, actual SQLite counts, downloaded CSV bytes and the original links in `Home`. Cover multiple parts, cross-part references, invalid parts, duplicate paths and ordinary ZIP attachments in regression tests.

## Import fidelity and preflight

- Give root entries a source-named notebook with an identity separate from a real folder of the same name. Verify destination notebook IDs and membership.
- Prefer an explicit front matter title for Notion and SiYuan; otherwise read the opening level-one heading in the body. Ignore indented code and exclude ATX closing hashes. Omit the Notion ID from standalone `_all.csv` note titles while preserving the `_all` marker, original attachment filenames and bytes.
- Convert actual HTML media in Markdown and handle paired audio and video tags. Preserve adjacent Markdown, quote/list structure, code and front matter. Use the existing HTML converter for wrapped media markup.
- Treat Markdown under SiYuan `assets` as attachments and skip note scanning for those entries. A missing referenced Markdown asset warns and preserves its link, just like a missing image. Ordinary page links are preserved with warnings.
- Publish supported formats from the server's input schema and remove the redundant used-entry marker for standalone attachment notes. Preserve the existing sources, blocking preflight behavior, cancellation and same-task retry contracts.

- For HTML media with a closing container, convert only the actual container, leaving adjacent Markdown links, images and formatting outside the HTML converter even without a blank line. Reuse Markdown tokens to locate non-code regions and the existing htmlparser2 library to find real element boundaries without misreading raw script text as closing tags. Cover adjacent/nested containers, indented media, quotes and lists. Verify attachment discovery, full import link rewriting and downloaded bytes for both Notion and SiYuan. Other sources and recovery behavior remain unchanged.

The former Notion-only missing-CSV exception is superseded by a consistent missing-attachment policy: file type no longer determines whether import is blocked. Preflight shows the source note and missing target before the user confirms. This applies only to the Notion/SiYuan sources in this PR; other formats, path validation and runtime resource read/upload failure recovery remain unchanged.

## Risk and rollback

Import can lose unsupported source semantics; warnings and documentation must remain explicit. Shared-session changes may regress existing sources. Revert the feature to stop new imports; a code rollback cannot remove already imported data. Existing imports must not be overwritten. No production deployment is part of this change.

## Validation

- HTML container regressions cover adjacent Markdown links, images and bold text, nested containers, attributes containing `>`, multiline quotes/lists and CRLF. Both sources pass ZIP preflight, real API import, attachment-link rewriting and byte comparisons for all three downloaded attachments. All 147 local import-related tests, lint, Web/API and mobile type checks, the production Web build and performance budgets passed. Additional cases cover adjacent containers, script raw text, indented media, code/escaped-tag isolation and implicit EOF closing offsets. Manual tag pairing was removed in favor of the existing HTML parser; Markdown source maps and literal masking prevent code samples from participating in HTML parsing.

- Web and desktop renderers share `ThirdPartyImportDialog`, `NoteImportController`, `BrowserImportReader`, `NoteImportSession`, and the task-scoped `BrowserImportIndex`. Format-specific behavior stays in source reading, title and attachment parsing, and preflight messages. `executeNoteImport` handles writes, uploads and retry with the existing instance and account guard. The desktop renderer keeps the existing sync pause and refresh sequence.
- macOS ARM64 and Ubuntu 25.10 x86_64 on `jingwen-mini` each passed 133 import-related tests, web and mobile type checks, and the production web build. Regression coverage includes reading multipart ZIPs across staged chunks, attachment retry and index cleanup, root folder identity, titles and HTML media fidelity, and missing SiYuan Markdown attachments.
- SiYuan uses a case-sensitive string prefix check for `assets/` and searches ancestors for the nearest exact match. `bun run lint` and all seven unified import integration tests passed.
- The original public multipart Notion ZIP, an actual Notion database ZIP, and an official SiYuan 3.8.10 ZIP imported 280, 1,032 and two notes, respectively, through Settings on both environments. Linux browser requests showed zero import writes during preflight and the same memo import, chunked upload, edit session and version-guarded update APIs after confirmation. All 1,030 Markdown bodies in the actual database ZIP, the public sample's `Home` Markdown, and six attachments across the three archives matched the source bytes in both environments.
- The packaged macOS ARM64 app and the Linux x64 AppImage on `jingwen-mini` imported all three original archives from desktop Settings. Preflight performed no import writes, the added counts matched the browser runs, all notes synced to the local sidecar, and all six attachment SHA-256 hashes matched the originals.
- Both desktop packages also passed with the same reproducible 1.25 GiB Notion-format fixture containing two inner ZIP files and cross-part attachment references. Preflight performed no import writes. Confirmation added one notebook, two notes and four attachments. Both notes synced to the sidecar, all four attachment SHA-256 hashes matched, and closing the import dialog removed all 1,282 staged chunks. Local Chrome against an isolated self-hosted instance produced the same preflight, write, attachment and staged-chunk cleanup results with the same fixture.

Official format references: [Notion exports](https://www.notion.com/help/export-your-content), [SiYuan workspace assets](https://github.com/siyuan-note/siyuan/blob/master/docs/WORKSPACE.md), [SiYuan API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md).
