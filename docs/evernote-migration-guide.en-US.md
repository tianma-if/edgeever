# Minimal Evernote Migration Guide

[简体中文](evernote-migration-guide.md) | [English](evernote-migration-guide.en-US.md)

We strongly recommend using an AI coding assistant, such as Codex, Antigravity, Claude Code, Cursor, OpenClaw, or Hermes Agent, to run the migration automatically. The current migration flow is optimized for streaming large archives and preprocessing empty text, and can handle multi-GB note libraries while preserving created/updated timestamps and nested notebook hierarchy.

---

### Step 1: Configure and install the EdgeEver MCP service

1. Open EdgeEver and click **Profile / Settings** in the lower-left corner.
2. In the **API & MCP authorization** card, generate a token and click **Copy full MCP config**.
3. Paste the copied JSON into your AI coding assistant and ask it to install the MCP service in your current AI client:

```sh
You are an AI coding assistant. This is my EdgeEver MCP service configuration JSON. Please configure this MCP service directly in the MCP server configuration file for my current AI editor/client, such as Codex, Claude Code, Cursor, or Cline:

<paste the copied JSON configuration here>
```

---

### Step 2: Let the AI assistant import and migrate your notes

After the assistant has configured MCP, send it this prompt:

```sh
You are an AI coding assistant. Please migrate my local Evernote data into my deployed EdgeEver instance:
1. Check for and install the backup tool with `pipx install evernote-backup`.
2. Ask me for my Evernote username and password, initialize the database with the China backend if needed, sync the data, and export it to `./evernote-export`.
3. Download the latest migration script from GitHub: `https://raw.githubusercontent.com/tianma-if/edgeever/main/scripts/import-evernote-enex-via-mcp.mjs`.
4. Install the local dependencies required by the script: `sharp` and `fast-xml-parser`.
5. Run the script with the previously configured URL and token to complete the migration. The script performs WebP image conversion automatically:
   - Full migration: `bun import-evernote-enex-via-mcp.mjs --input "./evernote-export" --yes`
   - Selected notebooks only: add `--include "NotebookA,NotebookB"`.

Tell me what information you need, such as account credentials, then run the steps automatically and in parallel where possible.
```

> Manual fallback: If you do not use an AI assistant, download `scripts/import-evernote-enex-via-mcp.mjs` from the [EdgeEver GitHub repository](https://github.com/tianma-if/edgeever) and follow the comments at the top of the script.

---

### Step 3: Verify the result in the Web app

1. After import completes, refresh the EdgeEver Web app.
2. Check the left sidebar and confirm the original Evernote notebook stack hierarchy is restored.
3. Open several notes with images and verify that images load and display clearly in the editor.
