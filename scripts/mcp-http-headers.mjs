export function createMcpHttpHeaders(request, fallbackProtocolVersion) {
  const protocolVersion =
    request?.params?._meta?.["io.modelcontextprotocol/protocolVersion"] ||
    request?.params?.protocolVersion ||
    fallbackProtocolVersion;
  const headers = {
    ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
    ...(typeof request?.method === "string" ? { "Mcp-Method": request.method } : {}),
  };

  if (["tools/call", "prompts/get", "resources/read"].includes(request?.method)) {
    const name = request.method === "resources/read" ? request?.params?.uri : request?.params?.name;
    if (typeof name === "string" && name) {
      headers["Mcp-Name"] = encodeMirroredHeader(name);
    }
  }

  return headers;
}

export function encodeMirroredHeader(value) {
  const isPlainAscii = /^[\x20-\x7e]+$/.test(value) && value === value.trim();
  const matchesSentinel = value.startsWith("=?base64?") && value.endsWith("?=");
  return isPlainAscii && !matchesSentinel
    ? value
    : `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
