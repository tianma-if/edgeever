// OAuth discovery documents that MCP clients request before they connect.
// EdgeEver authenticates MCP with API tokens and publishes none of them, so
// the app must answer with a JSON 404 instead of the web app shell.
export const OAUTH_DISCOVERY_PATH_PREFIXES = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
] as const;

const matchesPathPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Paths answered by the EdgeEver app rather than by static web assets.
 * Cloudflare declares the same set in `run_worker_first` in wrangler.toml.
 */
export const isEdgeEverAppPath = (pathname: string) =>
  pathname.startsWith("/api/")
  || matchesPathPrefix(pathname, "/mcp")
  || OAUTH_DISCOVERY_PATH_PREFIXES.some((prefix) => matchesPathPrefix(pathname, prefix));
