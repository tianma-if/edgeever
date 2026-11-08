import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isEdgeEverAppPath, OAUTH_DISCOVERY_PATH_PREFIXES } from "./app-paths.ts";

describe("EdgeEver app paths", () => {
  test("routes the API, MCP and OAuth discovery to the app", () => {
    for (const pathname of [
      "/api/v1/memos",
      "/mcp",
      "/mcp/",
      "/mcp/extra",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ]) {
      expect([pathname, isEdgeEverAppPath(pathname)]).toEqual([pathname, true]);
    }
  });

  test("leaves web app pages and look-alike paths to the asset server", () => {
    for (const pathname of ["/", "/settings", "/mcpx", "/api", "/.well-known/security.txt", "/.well-known/oauth-protected-resourcex"]) {
      expect([pathname, isEdgeEverAppPath(pathname)]).toEqual([pathname, false]);
    }
  });

  test("Cloudflare runs the worker first for the same paths", () => {
    const wrangler = readFileSync("wrangler.toml", "utf8");
    const runWorkerFirst = JSON.parse(wrangler.match(/^run_worker_first = (\[.*\])$/m)[1]);
    expect(runWorkerFirst).toEqual(expect.arrayContaining(["/api/*", "/mcp", "/mcp/*"]));
    for (const prefix of OAUTH_DISCOVERY_PATH_PREFIXES) {
      expect(runWorkerFirst).toContain(`${prefix}*`);
    }
  });
});
