# #787: Compatible table performance checkpoint

## Goal

Keep the already verified grid optimization and isolate the read-path improvements that can be rolled back without rewriting notes. Public forms and MCP table operations currently fetch the unused editor projection; a form page can also normalize the same records twice.

## Changes and acceptance

- Parse a table's field metadata and record count without constructing normalized cell objects when only metadata is needed. Use it for table summaries and public form lookup, upload field checks, and owner form configuration. Retain field, record ID, view and malformed-value validation; compare v1/v2 summaries and rejection behavior against the full parser.
- Use a workspace-scoped, non-deleted source query for these form paths and the initial MCP table read, field preview and mutations. Do not select editor JSON or text. Preserve permissions, field lists, full-form state, paging, revisions and tags; MCP and form writes still use their original path.
- Use native Base64URL for well-formed markers when available. Keep exact marker bytes, whitespace wrapping and the existing decoder for runtimes or inputs that need it. Avoid scanning non-attachment fields when gathering table attachment IDs.

## Unchanged

No schema migration, on-disk encoding, backup or form submission protocol, Worker binding or retry change. Existing Markdown bytes, including bare CR, remain unchanged. Keep existing v1 filters/order, public links, and offline conflict protection for v2 named views. Roll back the source changes to the previous grid checkpoint without a data rewrite. Validate the same data volume from Docker v2.19.0 to this candidate, then verify the original link and stale v1 replay. The separate near-capacity D1 form candidate is outside this checkpoint.

## Acceptance

- A Linux arm64 Docker v2.19.0 data volume upgraded to the candidate at migration 0092. The original v1 bytes and filtered order matched, the original form returned its configured fields and appended a record, and a v1 draft replayed with the current revision returned 409 without changing the two saved views or revision.
- Targeted shared, form and MCP checks passed. The MCP checks capture SQL and verify that record reads and schema previews do not select editor JSON or index text. The Web and self-hosted builds and the main and mobile type checks passed.
- This checkpoint does not change or accept the Cloudflare near-capacity form path. The v2 named-view baseline still requires a server that can read v2; rolling back this performance checkpoint is distinct from rolling back to v2.19.0.
