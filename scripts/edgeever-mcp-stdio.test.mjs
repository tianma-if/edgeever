import { describe, expect, test } from "bun:test";
import { createMcpHttpHeaders, encodeMirroredHeader } from "./mcp-http-headers.mjs";

const modernRequest = (method, params = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
});

describe("EdgeEver MCP stdio adapter headers", () => {
  test("mirrors modern protocol routing fields into HTTP headers", () => {
    expect(createMcpHttpHeaders(modernRequest("server/discover"), null)).toEqual({
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "server/discover",
    });

    expect(
      createMcpHttpHeaders(modernRequest("tools/call", { name: "get_current_user", arguments: {} }), null),
    ).toEqual({
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "get_current_user",
    });
  });

  test("keeps legacy negotiation and safely encodes mirrored names", () => {
    expect(
      createMcpHttpHeaders(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        "2025-11-25",
      ),
    ).toEqual({
      "MCP-Protocol-Version": "2025-11-25",
      "Mcp-Method": "tools/list",
    });
    expect(encodeMirroredHeader("笔记/今天")).toBe(
      `=?base64?${Buffer.from("笔记/今天", "utf8").toString("base64")}?=`,
    );
    expect(encodeMirroredHeader("=?base64?literal?=")).toBe(
      `=?base64?${Buffer.from("=?base64?literal?=", "utf8").toString("base64")}?=`,
    );
  });
});
