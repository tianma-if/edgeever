# Markdown note properties

Text notes support a leading YAML Front Matter header. In Web and desktop rich-text view, it appears as a collapsible **Note properties** panel. The panel appears only in documents that already contain a header; ordinary notes have no additional properties entry point. A header can be added directly in Markdown source. The panel supports text, string lists (one value per line), numbers, checkboxes and dates. Nested values remain readable and can be edited in YAML source. The source button and Markdown editor both edit the same document data.

```markdown
---
title: Research note
tags: [archive, research]
source: https://example.com/article
author: [Alice, Bob]
published: 2026-10-10
description: A short summary
custom:
  reviewed: true
---

The note body starts here.
```

Importing a `.md` or `.markdown` file reads `title` and `tags` from the header. When no valid title is provided, the filename is used. Other properties, comments and nested values are retained in the document. Property edits to `title` and `tags` update the existing note fields; edits to those fields also update matching properties when present. Removing a property removes it from the document, without deleting the corresponding application field.

Single-note exports (including the card context menu) export only the body for ordinary notes, without adding a header. Existing headers retain their properties and update title and tags only when those keys already exist; no additional system fields are added. Selected-note and full ZIP exports produce one header containing custom properties and current note metadata. The application's title, tags, notebook, creation/update timestamps, pinned state and ID take precedence over imported copies. These system properties (except title and tags) are read-only in the panel; editing their YAML copies does not change application state. `published` is an independent date and is editable. Importing an `edgeever_id` does not overwrite an existing note.

Invalid YAML, duplicate keys, unknown YAML tags, oversized headers (over 64 KiB) and excessive alias expansion show an error with the original YAML available for correction. An invalid header is exported unchanged rather than losing its source. No replacement metadata is added until the header is valid. Plain Markdown separators, ordinary YAML code examples and unclosed headers are not interpreted as properties. Properties are excluded from body excerpts and character counts.

## Compatibility and rollback

Properties use the existing `codeBlock` document node with the `edgeever-frontmatter` language. No database migration is required. Older clients display the YAML as a code block; older codecs may serialize it as a fenced code block, which the new codec recognizes and exports as Front Matter again. Removing the panel or rolling back the client retains that readable representation.

The codec has been checked against the actual `v1.105.0` source with new → old edit → new round trips. This does not replace packaged macOS, Windows, Linux, Android USB-device or iOS cross-version tests. Complete application-level cross-version validation remains required before release. Native Android/iOS editors currently display the property code block rather than the Web property panel.

This feature does not implement Obsidian vault synchronization, property-specific search, a vault-wide property type registry or full support for Obsidian-specific Markdown extensions.
