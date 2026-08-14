#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createMcpHttpHeaders } from "./mcp-http-headers.mjs";

const CONFIG_PATH = process.env.EDGEEVER_CONFIG || join(homedir(), ".edgeever", "config.json");
const DEFAULT_URL = "http://127.0.0.1:8787";
const options = parseOptions(process.argv.slice(2));

const usage = `EdgeEver MCP stdio adapter

Usage:
  EDGEEVER_URL=https://your.edgeever.host EDGEEVER_TOKEN=... bun scripts/edgeever-mcp-stdio.mjs
  bun scripts/edgeever-mcp-stdio.mjs --profile prod

The adapter bridges local stdio MCP clients to the remote EdgeEver /mcp endpoint.
`;

if (options.help || options.h) {
  process.stdout.write(usage);
  process.exit(0);
}

let client;

try {
  client = await createClient(options.profile);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

let inputBuffer = Buffer.alloc(0);
let transportMode = null;
let negotiatedProtocolVersion = null;

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainInput();
});

process.stdin.on("error", (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

process.stdin.resume();

function drainInput() {
  while (inputBuffer.length > 0) {
    const framed = readFramedMessage(inputBuffer);

    if (framed) {
      transportMode = "framed";
      inputBuffer = inputBuffer.subarray(framed.consumedBytes);
      void handleMessage(framed.payload);
      continue;
    }

    if (looksLikeFramedMessage(inputBuffer)) {
      return;
    }

    const newlineIndex = inputBuffer.indexOf(0x0a);

    if (newlineIndex === -1) {
      return;
    }

    const line = inputBuffer.subarray(0, newlineIndex).toString("utf8").trim();
    inputBuffer = inputBuffer.subarray(newlineIndex + 1);

    if (!line) {
      continue;
    }

    transportMode = transportMode || "line";
    void handleMessage(line);
  }
}

async function handleMessage(payload) {
  let request;

  try {
    request = JSON.parse(payload);
  } catch {
    writeMessage(jsonRpcError(null, -32700, "Parse error"));
    return;
  }

  try {
    const response = await forwardToEdgeEver(request);

    if (response !== null) {
      writeMessage(response);
    }
  } catch (error) {
    writeMessage(
      jsonRpcError(getJsonRpcId(request), -32000, error instanceof Error ? error.message : "MCP bridge failed")
    );
  }
}

async function forwardToEdgeEver(request) {
  if (request?.method === "initialize") {
    negotiatedProtocolVersion = request?.params?.protocolVersion || "2025-11-25";
  }

  const requestHeaders = createMcpHttpHeaders(request, negotiatedProtocolVersion);

  const response = await fetch(`${client.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...requestHeaders,
    },
    body: JSON.stringify(request),
  });

  if (response.status === 202 || response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => null);

  if (!body) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  if (request?.method === "initialize" && body?.result?.protocolVersion) {
    negotiatedProtocolVersion = body.result.protocolVersion;
  }

  return body;
}

async function createClient(profileName) {
  const config = await readConfig();
  const profile = profileName ? config.profiles?.[profileName] : undefined;
  const baseUrl = (process.env.EDGEEVER_URL || profile?.url || DEFAULT_URL).replace(/\/+$/, "");
  const token = process.env.EDGEEVER_TOKEN || profile?.token;

  if (!token) {
    throw new Error("EDGEEVER_TOKEN is required, or configure a profile with `bun run cli -- profile set`.");
  }

  return { baseUrl, token };
}

async function readConfig() {
  try {
    const value = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function readFramedMessage(buffer) {
  const headerEnd = findHeaderEnd(buffer);

  if (!headerEnd) {
    return null;
  }

  const header = buffer.subarray(0, headerEnd.index).toString("utf8");
  const match = /^content-length:\s*(\d+)\s*$/im.exec(header);

  if (!match) {
    return null;
  }

  const contentLength = Number(match[1]);
  const bodyStart = headerEnd.index + headerEnd.length;
  const bodyEnd = bodyStart + contentLength;

  if (!Number.isInteger(contentLength) || contentLength < 0 || buffer.length < bodyEnd) {
    return null;
  }

  return {
    payload: buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
    consumedBytes: bodyEnd,
  };
}

function findHeaderEnd(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");

  if (crlf !== -1) {
    return { index: crlf, length: 4 };
  }

  const lf = buffer.indexOf("\n\n");
  return lf === -1 ? null : { index: lf, length: 2 };
}

function looksLikeFramedMessage(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 32)).toString("utf8").toLowerCase().startsWith("content-length:");
}

function writeMessage(message) {
  const payload = `${JSON.stringify(message)}\n`;

  if (transportMode === "framed") {
    const content = payload.trimEnd();
    process.stdout.write(`Content-Length: ${Buffer.byteLength(content, "utf8")}\r\n\r\n${content}`);
    return;
  }

  process.stdout.write(payload);
}

function parseOptions(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function getJsonRpcId(request) {
  if (!request || typeof request !== "object" || !("id" in request)) {
    return null;
  }

  const id = request.id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}
