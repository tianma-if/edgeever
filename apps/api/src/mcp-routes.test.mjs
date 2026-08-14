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

const modernMcpRequest = (payload, headers = {}) => {
  const params = {
    ...(payload.params ?? {}),
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "edgeever-test", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
      ...(payload.params?._meta ?? {}),
    },
  };
  const name = payload.method === "resources/read" ? params.uri : params.name;

  return mcpRequest(
    { ...payload, params },
    {
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": payload.method,
      ...(["tools/call", "resources/read", "prompts/get"].includes(payload.method) && name
        ? { "Mcp-Name": name }
        : {}),
      ...headers,
    },
  );
};

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
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "edgeever" },
        capabilities: { tools: { listChanged: false } },
      },
    });
    expect(body.result.resultType).toBeUndefined();
  });

  test("discovers and serves the stateless 2026 protocol without changing legacy responses", async () => {
    let response = await createApp().request(
      "/mcp",
      modernMcpRequest({ jsonrpc: "2.0", id: "discover", method: "server/discover" }),
    );

    expect(response.status).toBe(200);
    let body = await response.json();
    expect(body).toMatchObject({
      id: "discover",
      result: {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: { listChanged: false } },
        ttlMs: 3_600_000,
        cacheScope: "public",
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: "edgeever" },
        },
      },
    });
    expect(body.result.serverInfo).toBeUndefined();

    response = await createApp().request(
      "/mcp",
      modernMcpRequest({ jsonrpc: "2.0", id: "tools", method: "tools/list" }),
    );
    body = await response.json();
    expect(body.result).toMatchObject({
      resultType: "complete",
      ttlMs: 3_600_000,
      cacheScope: "public",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "edgeever" } },
    });
    expect(body.result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "get_current_user" })]));
  });

  test("requires matching 2026 transport headers and per-request metadata", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "get_current_user",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    };
    let response = await createApp().request(
      "/mcp",
      mcpRequest(payload, {
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32020 } });

    response = await createApp().request(
      "/mcp",
      modernMcpRequest(payload, { "Mcp-Method": "tools/list" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32020 } });

    response = await createApp().request(
      "/mcp",
      modernMcpRequest({
        ...payload,
        params: {
          ...payload.params,
          _meta: { "io.modelcontextprotocol/clientCapabilities": [] },
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32602 } });
  });

  test("reports unsupported protocol versions with the modern negotiation error", async () => {
    const response = await createApp().request(
      "/mcp",
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 21,
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "1900-01-01",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        },
        { "MCP-Protocol-Version": "1900-01-01", "Mcp-Method": "server/discover" },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: -32022,
        data: { requested: "1900-01-01", supported: expect.arrayContaining(["2026-07-28", "2025-11-25"]) },
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

  test("adds the modern result envelope to 2026 tool calls", async () => {
    const response = await createApp().request(
      "/mcp",
      modernMcpRequest({
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: { name: "get_current_user", arguments: {} },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        resultType: "complete",
        structuredContent: { name: "get_current_user" },
        isError: false,
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "edgeever" } },
      },
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
