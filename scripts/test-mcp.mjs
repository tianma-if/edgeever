import { strict as assert } from "node:assert";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import worker from "../apps/api/src/index.ts";
import { createMcpHttpHeaders } from "./mcp-http-headers.mjs";

class SqliteD1PreparedStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqliteD1PreparedStatement(this.db, this.sql, bindings);
  }

  async all() {
    return { results: this.db.query(this.sql).all(...this.bindings), success: true, meta: {} };
  }

  async first() {
    return this.db.query(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    this.db.query(this.sql).run(...this.bindings);
    return { success: true, meta: {} };
  }
}

class SqliteD1Database {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SqliteD1PreparedStatement(this.db, sql);
  }

  async batch(statements) {
    return this.db.transaction(() =>
      statements.map((statement) => this.db.query(statement.sql).run(...statement.bindings)))();
  }
}

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA foreign_keys = ON");
for (const file of globSync("migrations/*.sql").sort()) {
  sqlite.exec(readFileSync(file, "utf8"));
}

sqlite.run(
  "INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)",
  ["usr_zack", "zack42", "test", "Zack"],
);
sqlite.run(
  "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)",
  ["ws_default", "usr_zack", "owner"],
);
sqlite.run(
  "INSERT INTO notebooks (id, workspace_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, ?)",
  ["nb_imports", "ws_default", "Imports", 100],
);
sqlite.run(
  "INSERT INTO notebooks (id, workspace_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)",
  ["nb_flomo", "ws_default", "nb_imports", "Flomo", 10],
);

sqlite.run(
  "INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)",
  ["usr_other", "other", "test", "Other"],
);
sqlite.run("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)", ["ws_other", "Other workspace"]);
sqlite.run(
  "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)",
  ["ws_other", "usr_other", "member"],
);
sqlite.run(
  "INSERT INTO notebooks (id, workspace_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, ?)",
  ["nb_other", "ws_other", "Private", 10],
);

// Simulate a token created before migration 0007 began retaining token plaintext.
// Upgraded rows have a valid hash and their original granular scopes, while
// token_value remains NULL and therefore cannot be copied again from the UI.
const legacyToken = "edgeever_mcp_test_token";
const legacyTokenHash = new Bun.CryptoHasher("sha256").update(legacyToken).digest("hex");
const legacyScopes = [
  "read:notebooks",
  "write:notebooks",
  "read:memos",
  "write:memos",
  "read:resources",
  "read:tags",
];
sqlite.run(
  "INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json) VALUES (?, ?, ?, ?, ?)",
  [
    "tok_test",
    "ws_default",
    "MCP Token 1",
    legacyTokenHash,
    JSON.stringify(legacyScopes),
  ],
);
const storedLegacyToken = sqlite
  .query("SELECT token_value, scopes_json FROM api_tokens WHERE id = ?")
  .get("tok_test");
assert.equal(storedLegacyToken.token_value, null);
assert.deepEqual(JSON.parse(storedLegacyToken.scopes_json), legacyScopes);

const env = {
  DB: new SqliteD1Database(sqlite),
  RESOURCES: { delete: async () => undefined, get: async () => null, put: async () => undefined },
};
const executionContext = { waitUntil: () => undefined, passThroughOnException: () => undefined };

const fetchMcp = (payload, options = {}) =>
  worker.fetch(
    new Request("https://edgeever.test/mcp", {
      method: options.method ?? "POST",
      headers: {
        ...(options.auth === false ? {} : { Authorization: `Bearer ${legacyToken}` }),
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      ...(options.method === "GET" ? {} : { body: JSON.stringify(payload) }),
    }),
    env,
    executionContext,
  );

const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
const modernRpc = (id, method, params = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params: {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "edgeever-integration-test", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
});
const fetchModernMcp = (payload, options = {}) =>
  fetchMcp(payload, {
    ...options,
    headers: { ...createMcpHttpHeaders(payload), ...(options.headers ?? {}) },
  });
const callTool = async (id, name, args = {}) => {
  const response = await fetchMcp(rpc(id, "tools/call", { name, arguments: args }));
  assert.equal(response.status, 200);
  return response.json();
};

let response = await fetchMcp(rpc(1, "initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0.0" },
}), { auth: false });
assert.equal(response.status, 401);
assert.match(response.headers.get("WWW-Authenticate") ?? "", /^Bearer /);

response = await fetchMcp(rpc(2, "initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0.0" },
}));
assert.equal(response.status, 200);
let body = await response.json();
assert.equal(body.result.protocolVersion, "2025-11-25");
assert.equal(body.result.serverInfo.name, "edgeever");
assert.notEqual(body.result.serverInfo.version, "0.1.0");

response = await fetchModernMcp(modernRpc(201, "server/discover"));
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.result.resultType, "complete");
assert.deepEqual(body.result.supportedVersions, ["2026-07-28"]);
assert.equal(body.result.capabilities.tools.listChanged, false);
assert.equal(body.result.cacheScope, "public");
assert.equal(body.result._meta["io.modelcontextprotocol/serverInfo"].name, "edgeever");
assert.equal(body.result.serverInfo, undefined);

response = await fetchModernMcp(modernRpc(202, "tools/call", {
  name: "get_current_user",
  arguments: {},
}));
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.result.resultType, "complete");
assert.equal(body.result.structuredContent.user.username, "zack42");
assert.equal(body.result._meta["io.modelcontextprotocol/serverInfo"].name, "edgeever");

response = await fetchMcp(rpc(3, "tools/list"));
body = await response.json();
const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
for (const name of ["get_current_user", "get_notebook", "find_notebooks", "resolve_notebook_path"]) {
  assert.ok(tools.has(name), `Missing MCP tool ${name}`);
  assert.equal(tools.get(name).annotations.readOnlyHint, true);
  assert.equal(tools.get(name).annotations.openWorldHint, false);
  assert.equal(tools.get(name).outputSchema.type, "object");
}
assert.equal(tools.get("trash_memos").annotations.destructiveHint, true);
assert.equal(tools.get("create_memo").annotations.destructiveHint, false);
assert.equal(tools.get("import_memos").annotations.idempotentHint, true);
assert.equal(tools.get("import_memos").annotations.destructiveHint, false);
assert.equal(tools.get("rename_notebook").annotations.readOnlyHint, false);
assert.equal(tools.get("rename_notebook").annotations.destructiveHint, false);
assert.equal(tools.get("rename_notebook").annotations.idempotentHint, true);

body = await callTool(4, "get_current_user");
assert.equal(body.result.structuredContent.user.username, "zack42");
assert.deepEqual(JSON.parse(body.result.content[0].text), body.result.structuredContent);

body = await callTool(5, "get_notebook", { notebookId: "nb_flomo" });
assert.equal(body.result.structuredContent.notebook.name, "Flomo");

body = await callTool(6, "find_notebooks", { name: "flo", parentId: "nb_imports" });
assert.deepEqual(body.result.structuredContent.notebooks.map((notebook) => notebook.id), ["nb_flomo"]);

body = await callTool(7, "resolve_notebook_path", { path: "Imports/Flomo" });
assert.equal(body.result.structuredContent.resolved, true);
assert.equal(body.result.structuredContent.notebook.id, "nb_flomo");

body = await callTool(8, "resolve_notebook_path", { path: "Imports/Missing" });
assert.equal(body.result.structuredContent.resolved, false);
assert.equal(body.result.structuredContent.failedSegment, "Missing");

body = await callTool(9, "get_notebook", { notebookId: "nb_other" });
assert.equal(body.result.isError, true);
assert.equal(body.result.structuredContent.error.code, "not_found");

body = await callTool(10, "list_notebooks");
assert.ok(!body.result.structuredContent.notebooks.some((notebook) => notebook.id === "nb_other"));

body = await callTool(101, "rename_notebook", { notebookId: "nb_flomo", name: "Flomo Archive" });
assert.equal(body.result.isError, false);
assert.equal(body.result.structuredContent.notebook.name, "Flomo Archive");
assert.equal(sqlite.query("SELECT name FROM notebooks WHERE id = ?").get("nb_flomo").name, "Flomo Archive");

body = await callTool(102, "rename_notebook", { notebookId: "nb_other", name: "Leaked" });
assert.equal(body.result.isError, true);
assert.equal(body.result.structuredContent.error.code, "not_found");

body = await callTool(11, "import_memos", {
  source: "Flomo",
  notebookId: "nb_flomo",
  items: [
    {
      externalId: "flomo-1",
      title: "Imported once",
      contentMarkdown: "First import",
      tags: ["migration"],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
    { externalId: "flomo-invalid", title: "Invalid", createdAt: "not-a-date" },
  ],
});
assert.equal(body.result.structuredContent.source, "flomo");
assert.equal(body.result.structuredContent.created, 1);
assert.equal(body.result.structuredContent.failed, 1);
assert.equal(body.result.structuredContent.results[0].status, "created");
const importedMemoId = body.result.structuredContent.results[0].memo.id;

body = await callTool(12, "import_memos", {
  source: "flomo",
  notebookId: "nb_flomo",
  items: [{ externalId: "flomo-1", title: "A retry must not duplicate this memo" }],
});
assert.equal(body.result.structuredContent.created, 0);
assert.equal(body.result.structuredContent.skipped, 1);
assert.equal(body.result.structuredContent.results[0].memo.id, importedMemoId);

body = await callTool(13, "import_memos", {
  source: "flomo",
  notebookId: "nb_flomo",
  dryRun: true,
  items: [{ externalId: "flomo-2", title: "Preview only" }],
});
assert.equal(body.result.structuredContent.wouldCreate, 1);
assert.equal(body.result.structuredContent.results[0].status, "would_create");
assert.equal(sqlite.query("SELECT COUNT(*) AS count FROM memo_import_sources").get().count, 1);
assert.equal(sqlite.query("SELECT COUNT(*) AS count FROM memos WHERE id = ?").get(importedMemoId).count, 1);

sqlite.run(
  `INSERT INTO resources (id, memo_id, bucket_name, object_key, kind, mime_type, filename, byte_size)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ["res_imported", importedMemoId, "test-resources", "mcp/imported.txt", "attachment", "text/plain", "imported.txt", 12],
);
body = await callTool(14, "list_memo_resources", { memoId: importedMemoId });
assert.equal(body.result.isError, false);
assert.deepEqual(body.result.structuredContent.resources.map((resource) => resource.id), ["res_imported"]);

response = await fetchMcp(rpc(15, "tools/call", { name: "unknown_tool", arguments: {} }));
assert.equal(response.status, 400);
body = await response.json();
assert.equal(body.error.code, -32602);

response = await fetchMcp([rpc(16, "tools/list")]);
assert.equal(response.status, 400);

response = await fetchMcp(rpc(17, "tools/list"), {
  headers: { "MCP-Protocol-Version": "2099-01-01" },
});
assert.equal(response.status, 400);

response = await fetchMcp(rpc(18, "tools/list"), { headers: { Origin: "https://attacker.example" } });
assert.equal(response.status, 403);

response = await fetchMcp(rpc(19, "tools/list"), { headers: { Accept: "application/json" } });
assert.equal(response.status, 406);

response = await fetchMcp(rpc(20, "tools/list"), { headers: { "Content-Type": "text/plain" } });
assert.equal(response.status, 415);

response = await fetchMcp({ jsonrpc: "2.0", method: "notifications/initialized" });
assert.equal(response.status, 202);

response = await fetchMcp(null, { method: "GET" });
assert.equal(response.status, 405);

console.log("MCP 2026/2025 protocol, identity, notebook lookup and rename, and idempotent import regression passed");
