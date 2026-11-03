# Real source-app exports

[简体中文](README.zh-CN.md)

Obsidian/Joplin samples were created in isolated local libraries on macOS arm64 on 2026-10-29. The Evernote sample was created separately in a test account and exported on 2026-10-31. All note content and attachment bytes are self-authored; no personal library, account data or application binaries are included.

- **Obsidian 1.14.5:** six notes and five source attachments created through the official CLI and Vault API. `obsidian-1.14.5.zip` packages the native Vault directory with its outer folder and `.obsidian` configuration. Obsidian stores the original Markdown directly; there is no separate Markdown exporter.
- **Joplin 3.7.21:** five notes in three nested notebooks, created through the desktop Data API after in-app authorization. The installed desktop app exported the selected notebook as JEX, RAW, Markdown and Markdown with Front Matter. ZIPs package those unmodified export directories with one outer folder. Default welcome notebooks are excluded.
- **Evernote 11.40.2:** one new test note created in the desktop editor and exported through its note menu as unmodified `evernote-11.40.2.enex`. It includes a heading, table, code block, native checked/unchecked checklist, two tags, and PNG/SVG/PDF/text/ZIP attachments. Author metadata was deselected during export to exclude account details. Original creation/modification times are `2026-10-31T03:38:38Z` / `2026-10-31T03:41:05Z`.

`assets/` contains independent expected bytes shared by all three sources. Obsidian/Joplin each reference five source files, with a PNG reused by two notes, giving six imported note-owned resources per library; the single Evernote note imports five resources. The corpus includes Unicode/spaces/literal percent signs, a ZIP attachment, an empty note, tables, tasks, code, image links and 30 tags. Obsidian/Joplin metadata deliberately sets creation to `2020-01-02T03:04:05Z` and modification to `2021-02-03T04:05:06Z`. Plain Joplin Markdown does not export tags/timestamps; the importer uses its existing defaults for those absent values.

Run the real HTTP/SQLite/resource-readback cases:

```sh
bun test tests/note-import.integration.test.mjs --test-name-pattern 'real desktop-app exports'
```

Existing authored ENEX boundary fixtures remain in the sibling `evernote/` directory.
