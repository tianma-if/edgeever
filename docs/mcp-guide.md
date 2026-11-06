# Using EdgeEver with MCP clients and AI agents

[简体中文](mcp-guide.zh-CN.md)

## 1. Connect a client

Open **Profile** → **API / MCP**, create a separate token for each client, then select **Copy MCP config**. Choose **Read-only** for search and summaries or **Full access** if the client needs to create or edit notes. If a token leaks, delete it here and create a replacement.

Remote clients connect over Streamable HTTP. Use your instance URL followed by `/mcp`, such as `https://notes.example.com/mcp`, and send `Authorization: Bearer <token>`. Check that the copied URL points to your EdgeEver instance.

### Cursor and other clients that use `mcpServers`

Paste the JSON from **Copy MCP config** into your client's MCP settings. The example below shows the `mcpServers` format. Keep the actual token in local settings outside version control.

```json
{
  "mcpServers": {
    "edgeever": {
      "url": "https://notes.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --scope user --transport http edgeever https://notes.example.com/mcp \
  --header "Authorization: Bearer <token>"
claude mcp get edgeever   # should report "Connected"
```

Omit `--scope user` to register the server for the current project only.

### VS Code

Use `servers` and `type: "http"` in `.vscode/mcp.json` or your user-level `mcp.json`. This example prompts for the token. You can also use `${env:EDGEEVER_TOKEN}` to read it from the environment.

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "edgeever-token",
      "description": "EdgeEver API token",
      "password": true
    }
  ],
  "servers": {
    "edgeever": {
      "type": "http",
      "url": "https://notes.example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:edgeever-token}" }
    }
  }
}
```

### Clients that only support stdio

Install Bun, save a connection profile from the repository root, then configure the client to launch the bridge. Replace the example path with the script's absolute path.

```bash
# Once: save a profile in ~/.edgeever/config.json
bun run cli -- profile set personal --url https://notes.example.com --token "<token>"

# In the client, run:
bun /path/to/edgeever/scripts/edgeever-mcp-stdio.mjs --profile personal
```

You can use the `EDGEEVER_URL` and `EDGEEVER_TOKEN` environment variables instead of `--profile`. OAuth-only connectors cannot connect directly. Use the bridge if your client can launch a local command.

## 2. Verify the connection

Ask the agent to call `get_current_user` and check the account, workspace and token scopes. Then ask it to call `list_notebooks` to confirm read access.

Add a rule in your client's custom instructions, `AGENTS.md` or `CLAUDE.md`. For example, “Put new notes in Agent notes and search for an existing note on the topic first. Ask me before deleting or merging notes.”

## 3. Troubleshoot

| Symptom | Cause and fix |
|---|---|
| `401` with "Authentication required" | The client sent no credentials. Check that the `Authorization` header is set, including the header name and the `Bearer ` prefix. |
| `401` with `error="invalid_token"` in the `WWW-Authenticate` header | The token was sent but rejected. Check that it belongs to this instance; if it was deleted or replaced, create a new token and update the client. |
| `403` "Origin is not allowed" | A browser-based client sent a foreign `Origin`. Run the client outside the browser or through the stdio bridge. |
| The client reports invalid JSON or an HTML page | The URL does not point at `/mcp` on the server (for example a typo, `//mcp`, or the desktop app address). |
| Tools that change data are refused | The token is read-only. Use **Full access** only if the client needs to write. |

Older instances may return the same generic `401` for missing and rejected credentials. Check the instance URL, header and token first.
