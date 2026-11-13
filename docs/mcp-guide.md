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

When reading a prose memo with `get_memo` or listing full bodies with `list_memos` and `includeContent: true`, the response includes `contentMarkdown` as the only full body, alongside memo metadata. If an existing integration reads `contentJson` or `contentText`, pass `format: "all"` to retain the previous response.

Keyword searches with `search_memos` also return a `snippet` of up to 200 characters when the query or its terms can be located in the body. The original `excerpt` is retained. Results without a located body match, including title-only or tag-only matches, use the existing summary. Read the memo when the answer depends on context outside the snippet.

## 3. Attach local files

`upload_memo_image` and `upload_memo_attachment` take the file as base64 inside the tool call, which is impractical for anything but very small files. When the agent can run shell commands, upload the file first, then create or update the memo with it:

1. Call `create_resource_upload_url` with `kind` (`image` or `attachment`), `mimeType`, the exact `byteSize`, and optionally `filename` and `label` (alt text or link label). No memo is needed.
2. Run the returned `curl` command after replacing `<path-to-file>`. It sends the file with `PUT` to `/api/public/resource-uploads` and carries a dedicated upload token in the `Authorization` header. The MCP token is never part of the command. The `201` response contains `resourceId`, the authenticated `url` and the `markdownImage` or `markdownLink` to insert.
3. Call `create_memo` with that Markdown in `contentMarkdown` and the ids in `resourceIds`. The memo and its files are saved together; if the call fails, nothing is saved and the files stay available for a retry. For an existing memo, pass `resourceIds` to `update_memo`.

Each URL accepts one file of exactly the declared size and type, up to 100 MiB, for 15 minutes. A request with the wrong size or type is rejected without using up the URL, and repeating a successful upload returns the same `resourceId`. The URL also stops working when the token that created it is revoked or loses `write:resources`. An uploaded file that is not bound to a memo within 24 hours is deleted. A workspace can hold up to 20 unused URLs and 100 unbound files (1 GiB) at a time. Binding requires `write:resources`.

## 4. Troubleshoot

| Symptom | Cause and fix |
|---|---|
| `401` with "Authentication required" | The client sent no credentials. Check that the `Authorization` header is set, including the header name and the `Bearer ` prefix. |
| `401` with `error="invalid_token"` in the `WWW-Authenticate` header | The token was sent but rejected. Check that it belongs to this instance; if it was deleted or replaced, create a new token and update the client. |
| `403` "Origin is not allowed" | A browser-based client sent a foreign `Origin`. Run the client outside the browser or through the stdio bridge. |
| The client reports invalid JSON or an HTML page | The URL does not point at `/mcp` on the server (for example a typo, `//mcp`, or the desktop app address). |
| Tools that change data are refused | The token is read-only. Use **Full access** only if the client needs to write. |
| An upload URL returns `410` | It was already used for another file or has expired. Call `create_resource_upload_url` again. |
| An upload URL returns `400` or `415` | The file does not match the declared `byteSize` or `mimeType`. Check the size with `wc -c` and send the same file again. |
| `create_memo` reports a resource is not a pending upload | The id is wrong, already bound, or the file was not bound within 24 hours. Upload it again. |

Older instances may return the same generic `401` for missing and rejected credentials. Check the instance URL, header and token first.
