# flomo Migration Guide

[简体中文](note-migration-guide.md) | [English](note-migration-guide.en-US.md)

> 💡 **Notice**: All third-party note migration guides have been merged and updated into a unified guide:
> 👉 **[Migrate from Third-Party Notes to EdgeEver: The Complete Guide](note-migration-guide.en-US.md)** (covering native GUI one-click import and AI Agent / MCP migration).

### Step 1: Export flomo

In the flomo Web app or desktop client, click the small arrow next to your username and membership badge in the upper-left corner. Open **Settings → Account details** from the account menu, scroll the Account details pane to the very bottom, and download the full HTML export ZIP.

### Step 2: Configure EdgeEver MCP

Generate a token with memo, notebook, and resource read/write permissions in **EdgeEver Settings → API & MCP authorization**. Click **Copy full MCP config** and configure it in Codex, Claude Code, Cursor, WorkBuddy, or another AI Agent.

### Step 3: Import with one prompt

Replace `/path/to/flomo-export.zip` with the real path, then send the entire prompt below to the Agent connected to EdgeEver MCP:

```text
Using the configured EdgeEver MCP, migrate every note in `/path/to/flomo-export.zip` into the `flomo` notebook while preserving content, tags, creation times, images, and attachments. Verify completeness and report the result when finished.
```

Keep the original flomo ZIP until verification is complete.
