# Native flomo import

[简体中文](2026-11-10-flomo-import.zh-CN.md)

## Goal and scope

Related to [#794](https://github.com/tianma-if/edgeever/issues/794). Implement flomo only without closing the multi-source issue. Add official HTML ZIP exports to the existing third-party import framework, reusing its worker, index, preflight, multipart uploads, progress, cancellation and retry instead of a separate entry point or executor.

## Allowed changes and current decisions

- Read content, tags, creation times, images, audio/video and local attachments from official HTML ZIPs (or extracted files/folders through the unified picker). Parse HTML only in an inert DOM, never as a page. Preserve inline, adjacent and full hierarchical tags; trim trailing slashes, exclude URL fragments/keycap emoji and do not derive parent tags.
- Interpret export times in the current system timezone without an option. Exports have no modification time; keep the framework's missing-time warning and import-time behavior.
- Selecting the same ZIP again creates a new task and new notes. Retrying within a task resumes unfinished steps using its existing identity, without overwriting external edits.
- Adopt the unified flow completely: preflight errors block the batch; runtime failure stops at that item and retains written data for manual retry; hiding the dialog lets work continue and progress can be reopened; explicit cancellation uses the framework. Create a `flomo` notebook under the selected destination.
- Reuse current metadata, tag-count, attachment-size and account/instance consistency contracts without changing other sources. Add the format to existing capability and request validation; no new backend protocol or database migration.
- Reuse the existing HTML-to-Markdown converter, extracting it into a shared module with already-used DOM/conversion dependencies where necessary. Scan and convert in the worker, index note bodies individually, use module-worker splitting and on-demand source parsing without raising resource budgets, and use existing chunked resource reads/uploads rather than main-thread whole-export conversion or retaining all attachments.
- Update both migration guides and import catalog copy. Validate real exports, new-task duplicates, same-task retries, preflight blocking, media integrity and large-export responsiveness. Keep screenshots and detailed evidence out of Git; embed key screenshots in the PR using GitHub attachments.

The former separate flow (continue valid items, delete failed partial notes, stop when leaving, write directly into the selected notebook) is superseded by the unified behavior. The main branch now has a mature import framework; sharing interaction and recovery avoids a second implementation. Earlier standalone results are parser fixtures, not acceptance of this integration.

## Boundaries and risks

No Notion/SiYuan implementation, changes to other import formats, automatic retries, schema changes or production release/deployment. Risks include missing content/resources, timestamp errors, recovery differences and import regressions. Reverting code stops the feature but cannot undo written data. Validate on isolated local storage; real cloud quotas and large remote throughput remain unverified. Follow the project's pre-commit understanding check; do not auto-merge the PR.

## Completion review

Implementation now follows the unified framework and matches the scope above. All 88 import-related tests passed, along with Web/API and mobile type checks, the Web build, locale checks and Web performance budgets. A real flomo export imported five notes and two attachments per task; repeated new tasks created additional copies. Import continued after hiding the dialog, and results could be reopened. Downloaded image/video hashes matched the export and video playback worked. A complex 37-note fixture produced two preflight errors and blocked the batch. Integration tests cover retaining partial writes and resuming the same failed task.

The production worker scanned 5,000 notes in approximately 5.9 seconds; the maximum interval of a 16ms main-thread timer was 17.3ms. Initial module preloads totaled 782,805 bytes against an 819,200-byte budget. Image compression was also verified after changing module-worker output. HTML is still parsed as a complete DOM inside the worker; arbitrary single-file memory bounds are not established. Real Cloudflare quotas and large remote throughput remain unverified; local results do not substitute for cloud acceptance. Screenshots and detailed reports stay local, outside Git.
