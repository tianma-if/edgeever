import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError } from "./app-error.ts";
import { isAllowedMcpOrigin, registerMcpRoutes } from "./mcp-routes.ts";

const auth = {
  kind: "agent",
  actorType: "agent",
  actorId: "tok_mcp",
  username: "mcp-agent",
  displayName: null,
  scopes: ["read:memos"],
  workspaceId: "ws_1",
  role: "member",
};

const createApp = (overrides = {}) => {
  const app = new Hono();
  registerMcpRoutes(app, {
    authenticateRequest: async () => auth,
    callTool: async (_context, _auth, name, arguments_) => ({ name, arguments: arguments_ }),
    ...overrides,
  });
  return app;
};

const mcpRequest = (payload, headers = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers,
  },
  body: JSON.stringify(payload),
});

describe("MCP HTTP routes", () => {
  test("accepts only same-origin browser requests", async () => {
    expect(isAllowedMcpOrigin("https://notes.example.com/mcp", "https://notes.example.com")).toBe(true);
    expect(isAllowedMcpOrigin("https://notes.example.com/mcp", "https://evil.example.com")).toBe(false);

    const response = await createApp().request(
      "https://notes.example.com/mcp",
      mcpRequest(
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        { Origin: "https://evil.example.com" },
      ),
    );
    expect(response.status).toBe(403);
  });

  test("returns initialization metadata with a supported protocol", async () => {
    const response = await createApp().request(
      "/mcp",
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "edgeever" },
        capabilities: { tools: { listChanged: false } },
      },
    });
  });

  test("returns an authentication challenge when credentials are missing", async () => {
    const response = await createApp({ authenticateRequest: async () => null }).request(
      "/mcp",
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="EdgeEver MCP"');
    expect(await response.json()).toMatchObject({ error: { code: -32001 } });
  });

  test("delegates known tool calls and preserves structured output", async () => {
    let received;
    const response = await createApp({
      callTool: async (...args) => {
        received = args;
        return { username: "owner" };
      },
    }).request(
      "/mcp",
      mcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_current_user", arguments: {} },
      }),
    );

    expect(response.status).toBe(200);
    expect(received[2]).toBe("get_current_user");
    expect(await response.json()).toMatchObject({
      result: { structuredContent: { username: "owner" }, isError: false },
    });
  });

  test("maps application failures into MCP tool results", async () => {
    const response = await createApp({
      callTool: async () => {
        throw new AppError("forbidden", "Write scope required", 403);
      },
    }).request(
      "/mcp",
      mcpRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "create_memo", arguments: {} },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: "forbidden", message: "Write scope required" } },
      },
    });
  });
});
