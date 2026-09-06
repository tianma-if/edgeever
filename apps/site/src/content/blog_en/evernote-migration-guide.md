---
draft: false
title: "How to migrate from Evernote to a self-hosted notes app: EdgeEver ENEX guide"
snippet: "Use ENEX, evernote-backup, and EdgeEver MCP to preserve notes, attachments, timestamps, and nested notebooks."
image: {
    src: "/images/evernote-migration.jpg",
    alt: "Migrating from Evernote to EdgeEver"
}
publishDate: "2026-07-02 01:00"
category: "Migration"
author: "EdgeEver Team"
tags: [evernote, migration, self-hosted, mcp]
---

> EdgeEver is not affiliated with, endorsed by, or sponsored by Evernote. This guide only explains how users can migrate data they own into EdgeEver. Evernote is a trademark of its respective owner.

We recommend using an AI coding assistant, such as Antigravity, Claude Code, Cursor, or a similar tool, to automate the migration. The migration guide in the core repository notes that the approach includes streaming memory optimization and empty-text preprocessing, supports very large note libraries, and preserves created/updated timestamps plus nested notebook hierarchy.

---

### Step 1: Configure and install the EdgeEver MCP service

1. Open the **Settings** area from the lower-left corner of the web app.
2. Generate a token from the **API & MCP authorization** card, then click **Copy full MCP config**.
3. Send the copied JSON configuration directly to your AI coding assistant and ask it to add the MCP server to your current AI client:

```text
You are my AI coding assistant. This is my EdgeEver MCP service configuration JSON. Please configure this MCP service directly in the MCP server configuration file for the AI editor/client I am currently using, such as Claude Code, Cursor, Cline, or a similar tool:

<paste the JSON configuration here>
```

---

### Step 2: Let the AI assistant export and import your notes

After the assistant has configured MCP, copy the prompt below and send it to the assistant so it can export your Evernote data and import it into EdgeEver:

```text
You are my AI coding assistant. Please migrate my local Evernote data into my currently deployed EdgeEver instance:
1. Check for and install the backup tool with `pipx install evernote-backup`.
2. Ask me for my Evernote username and password, initialize the database with the China backend if needed, sync the data, and export it to `./evernote-export`.
3. Download the latest migration script from GitHub: `https://raw.githubusercontent.com/tianma-if/edgeever/main/scripts/import-evernote-enex-via-mcp.mjs`.
4. Install the local image compression and XML parsing dependencies required by the script: `sharp` and `fast-xml-parser`.
5. Use the previously configured URL and token to run the script and complete the migration. The script will automatically convert images to WebP:
   - Full migration: `bun import-evernote-enex-via-mcp.mjs --input "./evernote-export" --yes`
   - To import only specific notebooks, append `--include "Notebook A,Notebook B"`.

Tell me what information you need, such as account credentials, and then run the steps concurrently where possible.
```

> Manual fallback: if you do not use an AI assistant, open the [EdgeEver GitHub repository](https://github.com/tianma-if/edgeever), download `scripts/import-evernote-enex-via-mcp.mjs`, and follow the instructions in the script header.

---

### Step 3: Verify the import in the web app

1. After import completes, return to the EdgeEver web app and refresh the page.
2. Check the left sidebar and confirm that the original Evernote notebook stack hierarchy has been restored.
3. Open a few image-heavy notes and confirm that the images load clearly in the editor.
