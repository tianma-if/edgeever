# Memos Migration Guide

[简体中文](note-migration-guide.md) | [English](note-migration-guide.en-US.md)

> 💡 **Notice**: All third-party note migration guides have been merged and updated into a unified guide:
> 👉 **[Migrate from Third-Party Notes to EdgeEver: The Complete Guide](note-migration-guide.en-US.md)** (covering native GUI one-click import and AI Agent / MCP migration).

Since EdgeEver natively supports AI Agent (Model Context Protocol, MCP) integration, you don't even need to export any file backups. You can directly use your AI assistant as a bridge by mounting both **Memos MCP** and **EdgeEver MCP** servers to achieve automatic cloud-to-cloud migration.

---

### Migration Steps

#### Step 1: Install and Enable Both MCP Servers in Your AI Assistant

1. **Configure Memos MCP**:
   Set up your old Memos instance's MCP server (using the official or community-provided Memos MCP plugin) in your AI assistant (e.g., Claude Code, Cursor, WorkBuddy).

2. **Configure EdgeEver MCP**:
   - Log in to your EdgeEver instance, and click **Profile** -> **MCP settings**.
   - Generate an API Token, click **Copy full MCP configuration**, and configure it in your AI assistant.

Make sure your AI assistant can access and call both MCP servers simultaneously.

#### Step 2: Prompt the AI Assistant to Start the Migration

Copy and send the following prompt to the AI assistant that has access to both MCPs:

```text
You are my AI assistant. You are currently connected to both my old Memos MCP server and my new EdgeEver MCP server.
Please help me migrate all my notes from Memos to EdgeEver:
1. Call the Memos MCP tools to read all my old Memos (including text, creation time, tags, etc.) in batches.
2. Call the EdgeEver MCP tools to write them into my new EdgeEver instance.
Please report the total number of successfully imported notes when finished.
```

The AI assistant will automatically read data from Memos and write it to EdgeEver, completing the migration through double MCP data bridging.

#### Step 3: Verify in Web Browser
Go back to your EdgeEver web client and refresh the page to confirm that all Memos notes have been successfully recorded, and that their timestamps and tags are synchronized.
