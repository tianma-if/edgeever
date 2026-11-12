import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./hash-utils.ts";
import { fetchEdgeEverApp } from "./index.ts";
import { MCP_TOOLS } from "./mcp-tools.ts";
import { COMPANION_MCP_TOOLS } from "./companion-tool-catalog.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const ORIGIN = "https://notes.example.com";
const MCP_TOKEN = "edgeever_upload_ticket_test_token";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const executionContext = { waitUntil: () => undefined, passThroughOnException: () => undefined };

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createInstance = async (scopes = ["read:memos", "write:memos", "read:resources", "write:resources"]) => {
  const directory = await mkdtemp(`${tmpdir()}/edgeever-upload-ticket-`);
  temporaryDirectories.push(directory);
  const sqlite = new Database(join(directory, "edgeever.sqlite"), { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = new URL("../../../migrations/", import.meta.url);
  for (const name of (await readdir(migrationDirectory)).filter((value) => value.endsWith(".sql")).sort()) {
    sqlite.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
  }
  sqlite.query("INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)").run();
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_other', 'Other', 1)").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_uploads', 'ws_default', 'Uploads')").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_other', 'ws_other', 'Other')").run();
  sqlite.query(
    `INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json)
     VALUES ('tok_agent', 'ws_default', 'Agent', ?, ?)`,
  ).run(await sha256(MCP_TOKEN), JSON.stringify(scopes));

  const resourcesDirectory = join(directory, "resources");
  const environment = {
    storage: createSelfHostedStorageAdapter(sqlite, resourcesDirectory),
    EDGE_EVER_AUTH_PASSWORD: "configured",
    EDGE_EVER_RUNTIME: "self-hosted-bun",
  };
  const fetchApp = (path, init) => fetchEdgeEverApp(
    new Request(path.startsWith("http") ? path : `${ORIGIN}${path}`, init),
    environment,
    executionContext,
  );
  let rpcId = 0;
  const callTool = async (name, args) => {
    const response = await fetchApp("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MCP_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).result;
  };
  const createMemo = async (workspaceId = "ws_default") => {
    const created = await callTool("create_memo", { notebookId: "nb_uploads", title: "Target", contentMarkdown: "" });
    expect(created.isError).toBe(false);
    if (workspaceId !== "ws_default") {
      sqlite.query("UPDATE memos SET workspace_id = ?, notebook_id = 'nb_other' WHERE id = ?")
        .run(workspaceId, created.structuredContent.memo.id);
    }
    return created.structuredContent.memo.id;
  };
  const countResources = (memoId) =>
    sqlite.query("SELECT COUNT(*) AS count FROM resources WHERE memo_id = ?").get(memoId).count;
  return { sqlite, resourcesDirectory, fetchApp, callTool, createMemo, countResources };
};

const put = (fetchApp, ticket, body, headers = {}) => fetchApp(ticket.uploadUrl, {
  method: "PUT",
  headers: {
    ...ticket.headers,
    "Content-Length": String(body.byteLength),
    ...headers,
  },
  body,
});

describe("create_memo_upload_url", () => {
  test("uploads a file through a single-use URL without base64 in the tool call", async () => {
    const instance = await createInstance();
    const memoId = await instance.createMemo();
    const created = await instance.callTool("create_memo_upload_url", {
      memoId, kind: "image", mimeType: "image/png", filename: "pixel.png", byteSize: PNG.byteLength, label: "A pixel",
    });
    expect(created.isError).toBe(false);
    const ticket = created.structuredContent;
    expect(ticket).toMatchObject({
      uploadUrl: `${ORIGIN}/api/public/resource-uploads`,
      method: "PUT",
      kind: "image",
      mimeType: "image/png",
      filename: "pixel.png",
      byteSize: PNG.byteLength,
    });
    // The upload credential is a dedicated token, never the MCP token, and
    // it is not part of the URL.
    const uploadToken = ticket.headers.Authorization.replace(/^Bearer /, "");
    expect(uploadToken).toStartWith("eeu_");
    expect(uploadToken).not.toBe(MCP_TOKEN);
    expect(ticket.uploadUrl).not.toContain(uploadToken);
    expect(ticket.curl).toContain("-T <path-to-file>");
    expect(ticket.curl).not.toContain(MCP_TOKEN);
    expect(Date.parse(ticket.expiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);

    const response = await put(instance.fetchApp, ticket, PNG);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const uploaded = await response.json();
    expect(uploaded.resource).toMatchObject({ memoId, kind: "image", mimeType: "image/png", filename: "pixel.png", byteSize: PNG.byteLength });
    expect(uploaded.markdownImage).toBe(`![A pixel](/api/v1/resources/${uploaded.resource.id}/blob)`);
    const row = instance.sqlite.query("SELECT object_key FROM resources WHERE id = ?").get(uploaded.resource.id);
    expect(await readFile(join(instance.resourcesDirectory, row.object_key))).toEqual(PNG);
    const audit = instance.sqlite.query(
      "SELECT actor_type, actor_id FROM audit_events WHERE action = 'resource.create' AND entity_id = ?",
    ).get(uploaded.resource.id);
    expect(audit).toEqual({ actor_type: "agent", actor_id: "tok_agent" });

    // Single use: replaying the same request is refused and stores nothing.
    const replay = await put(instance.fetchApp, ticket, PNG);
    expect(replay.status).toBe(410);
    expect((await replay.json()).error.code).toBe("upload_token_used");
    expect(instance.countResources(memoId)).toBe(1);

    // The secret is stored only as a hash and never written to the audit log.
    const stored = JSON.stringify(instance.sqlite.query("SELECT * FROM resource_upload_tickets").all());
    const audits = JSON.stringify(instance.sqlite.query("SELECT * FROM audit_events").all());
    expect(stored).not.toContain(uploadToken);
    expect(audits).not.toContain(uploadToken);
  });

  test("attachments return a Markdown link", async () => {
    const instance = await createInstance();
    const memoId = await instance.createMemo();
    const body = Buffer.from("%PDF-1.4\n% test\n");
    const ticket = (await instance.callTool("create_memo_upload_url", {
      memoId, kind: "attachment", mimeType: "application/pdf", filename: "brief.pdf", byteSize: body.byteLength,
    })).structuredContent;
    const response = await put(instance.fetchApp, ticket, body, { "Content-Type": "application/octet-stream" });
    expect(response.status).toBe(201);
    const uploaded = await response.json();
    expect(uploaded.resource).toMatchObject({ kind: "attachment", mimeType: "application/pdf", filename: "brief.pdf" });
    expect(uploaded.markdownLink).toBe(`[brief.pdf](/api/v1/resources/${uploaded.resource.id}/blob)`);
  });

  test("rejects a wrong token, a mismatched size or type, and an expired URL", async () => {
    const instance = await createInstance();
    const memoId = await instance.createMemo();
    const ticket = (await instance.callTool("create_memo_upload_url", {
      memoId, kind: "image", mimeType: "image/png", byteSize: PNG.byteLength,
    })).structuredContent;
    const codeOf = async (response) => [response.status, (await response.json()).error.code];

    const noAuth = await instance.fetchApp(ticket.uploadUrl, { method: "PUT", body: PNG, headers: { "Content-Length": String(PNG.byteLength) } });
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get("www-authenticate")).toContain("invalid_token");
    const forged = `eeu_${"A".repeat(43)}`;
    expect(await codeOf(await put(instance.fetchApp, ticket, PNG, { Authorization: `Bearer ${forged}` }))).toEqual([401, "invalid_upload_token"]);
    // The MCP token does not work as an upload token.
    expect(await codeOf(await put(instance.fetchApp, ticket, PNG, { Authorization: `Bearer ${MCP_TOKEN}` }))).toEqual([401, "invalid_upload_token"]);

    const larger = Buffer.concat([PNG, Buffer.from([0])]);
    expect(await codeOf(await put(instance.fetchApp, ticket, larger))).toEqual([400, "upload_size_mismatch"]);
    // A Content-Length that lies about a longer body is caught while reading.
    expect(await codeOf(await put(instance.fetchApp, ticket, larger, { "Content-Length": String(PNG.byteLength) })))
      .toEqual([400, "upload_size_mismatch"]);
    expect(await codeOf(await put(instance.fetchApp, ticket, PNG, { "Content-Type": "image/jpeg" }))).toEqual([415, "upload_type_mismatch"]);

    // Rejected requests do not consume the URL.
    expect((await put(instance.fetchApp, ticket, PNG)).status).toBe(201);

    const expiring = (await instance.callTool("create_memo_upload_url", {
      memoId, kind: "image", mimeType: "image/png", byteSize: PNG.byteLength,
    })).structuredContent;
    instance.sqlite.query("UPDATE resource_upload_tickets SET expires_at = ? WHERE used_at IS NULL")
      .run(new Date(Date.now() - 1000).toISOString());
    expect(await codeOf(await put(instance.fetchApp, expiring, PNG))).toEqual([410, "upload_token_expired"]);
    expect(instance.countResources(memoId)).toBe(1);
  });

  test("stores one file when the same URL is used concurrently", async () => {
    const instance = await createInstance();
    const memoId = await instance.createMemo();
    const ticket = (await instance.callTool("create_memo_upload_url", {
      memoId, kind: "image", mimeType: "image/png", byteSize: PNG.byteLength,
    })).structuredContent;
    const responses = await Promise.all([0, 1, 2].map(() => put(instance.fetchApp, ticket, PNG)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 410, 410]);
    expect(instance.countResources(memoId)).toBe(1);
  });

  test("stops working when the creating API token is revoked", async () => {
    const instance = await createInstance();
    const memoId = await instance.createMemo();
    const ticket = (await instance.callTool("create_memo_upload_url", {
      memoId, kind: "image", mimeType: "image/png", byteSize: PNG.byteLength,
    })).structuredContent;
    instance.sqlite.query("UPDATE api_tokens SET is_revoked = 1 WHERE id = 'tok_agent'").run();
    const response = await put(instance.fetchApp, ticket, PNG);
    expect(response.status).toBe(401);
    expect(instance.countResources(memoId)).toBe(0);
  });

  test("validates scope, memo, kind, type and size before issuing a URL", async () => {
    const readOnly = await createInstance(["read:memos", "write:memos", "read:resources"]);
    const readOnlyMemo = await readOnly.createMemo();
    const denied = await readOnly.callTool("create_memo_upload_url", {
      memoId: readOnlyMemo, kind: "image", mimeType: "image/png", byteSize: PNG.byteLength,
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent.error.code).toBe("forbidden");

    const instance = await createInstance();
    const memoId = await instance.createMemo();
    const foreignMemo = await instance.createMemo("ws_other");
    const errorCode = async (args) => {
      const result = await instance.callTool("create_memo_upload_url", args);
      expect(result.isError).toBe(true);
      return result.structuredContent.error.code;
    };
    expect(await errorCode({ memoId: foreignMemo, kind: "image", mimeType: "image/png", byteSize: 10 })).toBe("not_found");
    expect(await errorCode({ memoId, kind: "video", mimeType: "image/png", byteSize: 10 })).toBe("invalid_params");
    expect(await errorCode({ memoId, kind: "image", mimeType: "text/html", byteSize: 10 })).toBe("unsupported_media_type");
    expect(await errorCode({ memoId, kind: "image", mimeType: "image/png", byteSize: 0 })).toBe("invalid_params");
    expect(await errorCode({ memoId, kind: "image", mimeType: "image/png", byteSize: "10" })).toBe("invalid_params");
    expect(await errorCode({ memoId, kind: "attachment", mimeType: "application/zip", byteSize: 100 * 1024 * 1024 + 1 }))
      .toBe("upload_too_large");
    expect(instance.sqlite.query("SELECT COUNT(*) AS count FROM resource_upload_tickets").get().count).toBe(0);
  });

  test("limits unused URLs per workspace and drops spent ones", async () => {
    const instance = await createInstance();
    const memoId = await instance.createMemo();
    const issue = () => instance.callTool("create_memo_upload_url", {
      memoId, kind: "image", mimeType: "image/png", byteSize: PNG.byteLength,
    });
    const tickets = [];
    for (let index = 0; index < 20; index += 1) tickets.push((await issue()).structuredContent);
    const limited = await issue();
    expect(limited.isError).toBe(true);
    expect(limited.structuredContent.error.code).toBe("upload_ticket_limit");

    expect((await put(instance.fetchApp, tickets[0], PNG)).status).toBe(201);
    expect((await issue()).isError).toBe(false);
    expect(instance.sqlite.query("SELECT COUNT(*) AS count FROM resource_upload_tickets").get().count).toBe(20);
  });

  test("is a non-destructive write tool that the companion cannot call", () => {
    const tool = MCP_TOOLS.find((definition) => definition.name === "create_memo_upload_url");
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(COMPANION_MCP_TOOLS.some((definition) => definition.name === "create_memo_upload_url")).toBe(false);
  });
});
