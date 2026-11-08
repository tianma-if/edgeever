# MCP server address, discovery responses and client path encoding

[简体中文](2026-11-05-mcp-endpoint-addressing.zh-CN.md)

Related Issue: #798

## Problem and outcome

- **Desktop MCP configuration**: **Copy configuration** and **Example configuration** under API / MCP used the page origin. On desktop that is `edgeever-app://app`, so the copied URL was `edgeever-app://app/mcp` and no MCP client could connect. Desktop now uses the configured instance URL, without trailing slashes, and shows `https://your-edgeever-server/mcp` until a server is set. The browser still uses the page origin.
- **OAuth discovery**: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` (with any suffix), plus `/mcp/*`, are now answered by the app with a JSON 404 instead of the web app shell. MCP clients that probe for OAuth learn that it is not offered, instead of failing to parse HTML. Cloudflare lists them in `run_worker_first` (the `wrangler.toml` guard hash is updated). Docker uses the shared `isEdgeEverAppPath` helper in `apps/api/src/app-paths.ts`.
- **MCP 401**: without a bearer token the error explains how to send one. With a rejected token the response carries `WWW-Authenticate: Bearer realm="EdgeEver MCP", error="invalid_token"` (RFC 6750) and says that the token is invalid or revoked.
- **API client**: ids in path segments (sessions, users, notebooks, API tokens, templates, memos, shares, revisions) are encoded with `encodeURIComponent`, like the other methods.
- **Test**: the multi-model provider test no longer depends on two models being created in different milliseconds.

## Unchanged boundaries, risks and recovery

- No storage, migration, sign-in or token format changes. Valid tokens behave as before, and the 401 status and JSON-RPC code `-32001` are unchanged; only the message text and the `error` attribute for rejected tokens are new.
- `wrangler.toml` only gains `run_worker_first` patterns. The worker answers those paths with its existing JSON 404; other pages still go to the asset server. Rollback: revert this change and the guard hash.
- A double slash in a hand-typed URL such as `https://host//mcp` is still served by the asset server on Cloudflare. The app no longer produces such URLs.
- Not verified: a packaged desktop build and a Cloudflare deployment. The desktop logic is covered by unit tests; routing was checked against a local self-hosted server.
