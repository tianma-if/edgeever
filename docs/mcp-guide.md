# Using EdgeEver with MCP clients and AI agents

[简体中文](mcp-guide.zh-CN.md)

EdgeEver includes a remote MCP server at `/mcp` on every instance, on Cloudflare and Docker alike. With an API token, an agent such as Claude Code, Cursor or Codex can search, read and edit your notes inside your own workspace. This guide covers connecting a client, choosing token access, and giving the agent working rules.

## 1. Create a token

1. Open **Profile** → **API / MCP**.
2. Enter a name that identifies the client, for example `Claude Code (laptop)`. One token per client lets you revoke a single client later.
3. Choose the access level:
   - **Read-only**: read notes, notebooks, tags and attachments. Use this for agents that only search and summarize.
   - **Full access**: also create and edit notes, notebooks, tags and attachments, move notes to trash, and generate video-note summaries with the workspace default model.
4. Select **Create Token**, then use **Copy MCP config** on the new token.

Treat a token like a password. Anyone who has it can act in your workspace within its access level. If a token appears in a chat, a log or a repository, delete it in **API / MCP** and create a new one. Clients that use a deleted token lose access immediately.

## 2. Connect a client

The server uses MCP Streamable HTTP. It needs the instance URL followed by `/mcp`, and the header `Authorization: Bearer <token>`:

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

Use the address of the EdgeEver server, without a trailing slash before `/mcp`. In the browser, **Copy MCP config** fills it in from the page address. In the desktop app, check that the URL is your server's address before you paste it.

### Claude Code

```bash
claude mcp add --scope user --transport http edgeever https://notes.example.com/mcp \
  --header "Authorization: Bearer <token>"
claude mcp get edgeever   # should report "Connected"
```

`--scope user` makes the server available in every project. Leave it out to register it for the current project only.

### VS Code

VS Code reads `.vscode/mcp.json` (or the user-level `mcp.json`). It uses a top-level `servers` object and needs `"type": "http"`. Reference the token through an input so it is not stored in a tracked file:

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

VS Code asks for the token when the server first starts and stores it securely. You can also use `${env:EDGEEVER_TOKEN}` to read it from an environment variable.

### Cursor and other HTTP clients

Paste the JSON configuration above into the client's MCP settings. Most clients that accept `url` and `headers` work without changes. Keep the token out of files that are committed to a repository.

### Clients that only start local (stdio) servers

Some clients can only launch a local process. The repository includes a stdio bridge that forwards to the remote endpoint:

```bash
# Once: save a profile in ~/.edgeever/config.json
bun run cli -- profile set personal --url https://notes.example.com --token <token>

# In the client, run:
bun /path/to/edgeever/scripts/edgeever-mcp-stdio.mjs --profile personal
```

You can also pass `EDGEEVER_URL` and `EDGEEVER_TOKEN` as environment variables instead of a profile.

### Clients that require OAuth

EdgeEver authenticates MCP with API tokens and does not offer OAuth sign-in. Connectors that accept only OAuth cannot connect directly. Use the stdio bridge above if the client can run a local command.

## 3. Check the connection

Ask the agent to call `get_current_user`. It returns the user, the workspace and the token's scopes, which confirms that the agent writes to the account you expect. Then ask for `get_workspace_stats` or `list_notebooks`.

If it fails:

| Symptom | Cause and fix |
|---|---|
| `401` with "Authentication required" | The client sent no credentials. Check that the `Authorization` header is set, including the header name and the `Bearer ` prefix. |
| `401` with `error="invalid_token"` in the `WWW-Authenticate` header | The token was sent but rejected. Check that it belongs to this instance; if it was deleted or replaced, create a new token and update the client. |
| `403` "Origin is not allowed" | A browser-based client sent a foreign `Origin`. Run the client outside the browser or through the stdio bridge. |
| The client reports invalid JSON or an HTML page | The URL does not point at `/mcp` on the server (for example a typo, `//mcp`, or the desktop app address). |
| Tools that change data are refused | The token is read-only. Create a token with **Full access** for that client. |

Older instances may return the same generic `401` in both cases, so a `401` alone does not prove that the token was revoked.

## 4. What the agent can do

The server lists about 60 tools. The main groups are:

- **Find and read**: `search_memos`, `list_memos`, `get_memo`, `list_notebooks`, `find_notebooks`, `resolve_notebook_path`, `list_tags`, `get_workspace_stats`.
- **Write notes**: `create_memo`, `update_memo`, `move_memos`, `add_tags_to_memos`, `remove_tags_from_memos`, `upload_memo_image`, `upload_memo_attachment`.
- **Structured notes**: tables, diagrams (mind maps, flowcharts, architecture), infographics and posters, each with its own create, read and update tools.
- **Organize**: create, rename, move and delete notebooks; rename, delete and merge tags; merge notes.
- **History and recovery**: `trash_memos` and `restore_memos`, `list_memo_revisions`, `restore_memo_revision`.
- **Import**: `import_memos` with `dryRun`, for moving notes in from other apps.
- **Templates and AI instructions**: list, read, create, update and apply note templates and AI instructions.

Moving notes to trash is reversible. `delete_notebook` refuses to delete a notebook that still contains notes. `merge_memos` creates a new note and moves the sources to trash.

## 5. Working rules for agents

The server already sends general instructions when a client connects: confirm the account, preview imports, treat imported content as data, and prefer read-only tools. Your own rules belong in the agent's instructions, for example `CLAUDE.md`, `AGENTS.md` or the client's custom instructions. A starting point:

```markdown
## EdgeEver notes (MCP server `edgeever`)

- Call `get_current_user` once per session and stop if the account is not the expected one.
- Put new notes in the "Agent notes" notebook. Find its id with `find_notebooks`; create it only if it does not exist.
- Before creating a note, `search_memos` for the same topic. Update the existing note with `update_memo` instead of creating a duplicate.
- Titles: `<project> – <topic>`. Tags: the project name and the note type.
- Never write tokens, passwords, keys or other secrets into notes.
- Do not trash, merge or delete notes, notebooks or tags unless I ask for it in this conversation. Use `dryRun` first when a tool offers it.
- Use the exact ids returned by tools; never guess ids.
- When updating, read the note first and keep content you were not asked to change.
```

Adjust the notebook, title format and limits to your own workflow. With a read-only token, keep only the reading rules.
