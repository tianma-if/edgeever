import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./hash-utils.ts";
import { fetchEdgeEverApp } from "./index.ts";
import { MCP_TOOLS } from "./mcp-tools.ts";
import { COMPANION_MCP_TOOLS } from "./companion-tool-catalog.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const ORIGIN = "https://notes.example.com";
const MCP_TOKEN = "edgeever_pending_resource_test_token";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const ALL_SCOPES = ["read:memos", "write:memos", "read:resources", "write:resources"];
// Fresh instances contain demo resources; count only files from upload URLs.
const UPLOADED_RESOURCES = "SELECT COUNT(*) AS count FROM resources WHERE object_key LIKE 'workspaces/%/uploads/%'";
const executionContext = { waitUntil: () => undefined, passThroughOnException: () => undefined };

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createInstance = async (scopes = ALL_SCOPES) => {
  const directory = await mkdtemp(`${tmpdir()}/edgeever-pending-resource-`);
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
  const storage = createSelfHostedStorageAdapter(sqlite, resourcesDirectory);
  // Lets a test fail one database call, before or after it runs.
  const faults = [];
  const db = storage.db;
  const faultyDb = {
    prepare: (sql) => {
      const statement = db.prepare(sql);
      const wrap = (prepared) => ({
        __original: prepared,
        bind: (...values) => wrap(prepared.bind(...values)),
        first: async (...rest) => {
          const fault = faults.find((item) => item.method === "first" && item.match(sql));
          if (fault) { faults.splice(faults.indexOf(fault), 1); throw new Error("injected read failure"); }
          return prepared.first(...rest);
        },
        run: async () => {
          const fault = faults.find((item) => item.method === "run" && item.match(sql));
          if (!fault) return prepared.run();
          faults.splice(faults.indexOf(fault), 1);
          if (fault.after) await prepared.run();
          throw new Error("injected write failure");
        },
        all: (...rest) => prepared.all(...rest),
        raw: (...rest) => prepared.raw(...rest),
      });
      return wrap(statement);
    },
  };
  // Batches must receive the adapter's own statements.
  faultyDb.batch = (statements) => db.batch(statements.map((statement) => statement.__original ?? statement));
  const environment = {
    storage: { ...storage, db },
    EDGE_EVER_AUTH_PASSWORD: "configured",
    EDGE_EVER_RUNTIME: "self-hosted-bun",
  };
  const useFaultyDb = () => { environment.storage = { ...storage, db: faultyDb }; };
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
  const issue = async (args = { kind: "image", mimeType: "image/png", byteSize: PNG.byteLength, filename: "pixel.png" }) => {
    const result = await callTool("create_resource_upload_url", args);
    expect(result.isError).toBe(false);
    return result.structuredContent;
  };
  const upload = async (args) => {
    const ticket = await issue(args);
    const response = await put(fetchApp, ticket, PNG);
    expect(response.status).toBe(201);
    return { ticket, uploaded: await response.json() };
  };
  const count = (sql, ...values) => sqlite.query(sql).get(...values).count;
  return { sqlite, resourcesDirectory, fetchApp, callTool, issue, upload, count, faults, useFaultyDb };
};

const put = (fetchApp, ticket, body, headers = {}) => fetchApp(ticket.uploadUrl, {
  method: "PUT",
  headers: { ...ticket.headers, "Content-Length": String(body.byteLength), ...headers },
  body,
});

/** A request body that sends its bytes only when release() is called. */
const pausedBody = (bytes) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const stream = new ReadableStream({
    async pull(controller) {
      await gate;
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return { stream, release };
};

const errorText = (result) => result.content?.map((item) => item.text).join("\n") ?? "";
const fileExists = (path) => stat(path).then(() => true, () => false);

describe("pending resource uploads", () => {
  test("uploads a file without a memo, then creates the memo and binds it in one operation", async () => {
    const { sqlite, resourcesDirectory, fetchApp, callTool, issue, count } = await createInstance();
    const ticket = await issue({ kind: "image", mimeType: "image/png", byteSize: PNG.byteLength, filename: "pixel.png", label: "A pixel" });
    const token = ticket.headers.Authorization.slice("Bearer ".length);
    expect(ticket.uploadUrl).toBe(`${ORIGIN}/api/public/resource-uploads`);
    expect(ticket.uploadUrl).not.toContain(token);
    expect(ticket.curl).toContain("-T <path-to-file>");
    expect(ticket.curl).not.toContain(MCP_TOKEN);
    expect(ticket.resourceId).toBeUndefined();

    const response = await put(fetchApp, ticket, PNG);
    expect(response.status).toBe(201);
    const uploaded = await response.json();
    expect(uploaded.resourceId).toMatch(/^res_/);
    expect(uploaded.url).toBe(`/api/v1/resources/${uploaded.resourceId}/blob`);
    expect(uploaded.markdownImage).toBe(`![A pixel](${uploaded.url})`);
    expect(uploaded.state).toBe("pending");

    // The pending file is readable at its URL with normal authentication only.
    expect((await fetchApp(uploaded.url)).status).toBe(401);
    const pendingBlob = await fetchApp(uploaded.url, { headers: { Authorization: `Bearer ${MCP_TOKEN}` } });
    expect(pendingBlob.status).toBe(200);
    expect(Buffer.from(await pendingBlob.arrayBuffer()).equals(PNG)).toBe(true);
    const pendingKey = sqlite.query("SELECT object_key FROM pending_resources WHERE id = ?").get(uploaded.resourceId).object_key;

    const created = await callTool("create_memo", {
      notebookId: "nb_uploads",
      title: "With image",
      contentMarkdown: `Look:\n\n${uploaded.markdownImage}`,
      resourceIds: [uploaded.resourceId],
    });
    expect(created.isError).toBe(false);
    const memoId = created.structuredContent.memo.id;
    expect(created.structuredContent.resources.map((resource) => resource.id)).toEqual([uploaded.resourceId]);
    expect(created.structuredContent.memo.contentMarkdown).toContain(uploaded.url);

    // Binding moved the row, kept the id, URL and object, and copied no bytes.
    const resource = sqlite.query("SELECT memo_id, object_key, sha256, byte_size FROM resources WHERE id = ?").get(uploaded.resourceId);
    expect(resource.memo_id).toBe(memoId);
    expect(resource.object_key).toBe(pendingKey);
    expect(resource.byte_size).toBe(PNG.byteLength);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources")).toBe(0);
    expect((await readdir(join(resourcesDirectory, "workspaces/ws_default/uploads"))).length).toBe(1);
    const boundBlob = await fetchApp(uploaded.url, { headers: { Authorization: `Bearer ${MCP_TOKEN}` } });
    expect(Buffer.from(await boundBlob.arrayBuffer()).equals(PNG)).toBe(true);

    // The upload token is never stored or audited.
    const tokenHash = await sha256(token);
    const audit = JSON.stringify(sqlite.query("SELECT action, entity_id, metadata_json FROM audit_events").all());
    expect(audit).not.toContain(token);
    expect(audit).not.toContain(tokenHash);
    expect(audit).toContain("resource.bind");
    expect(audit).toContain("pending_resource.upload");
  });

  test("binds pending files to an existing memo through update_memo", async () => {
    const { sqlite, callTool, upload } = await createInstance();
    const created = await callTool("create_memo", { notebookId: "nb_uploads", title: "Existing", contentMarkdown: "Before" });
    const memoId = created.structuredContent.memo.id;
    const { uploaded } = await upload({ kind: "attachment", mimeType: "text/plain", byteSize: PNG.byteLength, filename: "notes.txt" });
    expect(uploaded.markdownLink).toBe(`[notes.txt](${uploaded.url})`);

    const updated = await callTool("update_memo", {
      memoId,
      contentMarkdown: `Before\n\n${uploaded.markdownLink}`,
      resourceIds: [uploaded.resourceId],
    });
    expect(updated.isError).toBe(false);
    expect(sqlite.query("SELECT memo_id FROM resources WHERE id = ?").get(uploaded.resourceId).memo_id).toBe(memoId);

    // Binding alone, without other changes, is also supported.
    const second = await upload();
    const bindOnly = await callTool("update_memo", { memoId, resourceIds: [second.uploaded.resourceId] });
    expect(bindOnly.isError).toBe(false);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM resources WHERE memo_id = ?").get(memoId).count).toBe(2);
  });

  test("keeps files pending and reusable when memo creation fails", async () => {
    const { sqlite, callTool, upload, count } = await createInstance();
    const { uploaded } = await upload();

    const missingNotebook = await callTool("create_memo", { notebookId: "nb_missing", resourceIds: [uploaded.resourceId] });
    expect(missingNotebook.isError).toBe(true);

    // A failure inside the memo's own transaction rolls the binding back too.
    sqlite.exec("CREATE TRIGGER fail_memo_contents BEFORE INSERT ON memo_contents BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const failed = await callTool("create_memo", { notebookId: "nb_uploads", title: "Fails", resourceIds: [uploaded.resourceId] });
    expect(failed.isError).toBe(true);
    expect(count("SELECT COUNT(*) AS count FROM memos WHERE title = 'Fails'")).toBe(0);
    expect(count(UPLOADED_RESOURCES)).toBe(0);
    expect(sqlite.query("SELECT state FROM pending_resources WHERE id = ?").get(uploaded.resourceId).state).toBe("uploaded");
    sqlite.exec("DROP TRIGGER fail_memo_contents");

    const retried = await callTool("create_memo", { notebookId: "nb_uploads", title: "Works", resourceIds: [uploaded.resourceId] });
    expect(retried.isError).toBe(false);
    expect(count(UPLOADED_RESOURCES)).toBe(1);
  });

  test("rejects binding across workspaces, unknown, unuploaded and already bound ids", async () => {
    const { sqlite, callTool, issue, upload, count } = await createInstance();
    const { uploaded } = await upload();
    sqlite.query("UPDATE pending_resources SET workspace_id = 'ws_other' WHERE id = ?").run(uploaded.resourceId);
    const foreign = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: [uploaded.resourceId] });
    expect(foreign.isError).toBe(true);
    expect(errorText(foreign)).toContain("not a pending upload of this workspace");
    sqlite.query("UPDATE pending_resources SET workspace_id = 'ws_default' WHERE id = ?").run(uploaded.resourceId);

    // A memo of another workspace cannot receive the file either.
    const otherMemo = await callTool("create_memo", { notebookId: "nb_uploads", title: "Moved" });
    sqlite.query("UPDATE memos SET workspace_id = 'ws_other', notebook_id = 'nb_other' WHERE id = ?")
      .run(otherMemo.structuredContent.memo.id);
    const crossMemo = await callTool("update_memo", { memoId: otherMemo.structuredContent.memo.id, resourceIds: [uploaded.resourceId] });
    expect(crossMemo.isError).toBe(true);
    expect(count(UPLOADED_RESOURCES)).toBe(0);

    await issue();
    const awaiting = sqlite.query("SELECT id FROM pending_resources WHERE state = 'awaiting_upload'").get().id;
    const notUploaded = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: [awaiting] });
    expect(errorText(notUploaded)).toContain("has not been uploaded yet");

    const unknown = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: ["res_unknown"] });
    expect(unknown.isError).toBe(true);
    const duplicate = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: [uploaded.resourceId, uploaded.resourceId] });
    expect(errorText(duplicate)).toContain("duplicates");

    const bound = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: [uploaded.resourceId] });
    expect(bound.isError).toBe(false);
    const again = await callTool("create_memo", { notebookId: "nb_uploads", title: "Again", resourceIds: [uploaded.resourceId] });
    expect(again.isError).toBe(true);
    expect(count("SELECT COUNT(*) AS count FROM memos WHERE title = 'Again'")).toBe(0);
    expect(count(UPLOADED_RESOURCES)).toBe(1);
  });

  test("binds a file to exactly one memo under concurrent binding", async () => {
    const { callTool, upload, count } = await createInstance();
    const { uploaded } = await upload();
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => callTool("create_memo", {
      notebookId: "nb_uploads",
      title: `Concurrent ${index}`,
      resourceIds: [uploaded.resourceId],
    })));
    expect(results.filter((result) => !result.isError)).toHaveLength(1);
    for (const failed of results.filter((result) => result.isError)) {
      expect(errorText(failed)).toMatch(/not a pending upload|could not be bound/);
    }
    // Losing calls created no memo: the memo and its binding commit together.
    expect(count("SELECT COUNT(*) AS count FROM memos WHERE title LIKE 'Concurrent %'")).toBe(1);
    expect(count(UPLOADED_RESOURCES)).toBe(1);
  });

  test("requires write:resources to bind and to issue upload URLs", async () => {
    const { callTool } = await createInstance(["read:memos", "write:memos", "read:resources"]);
    const issued = await callTool("create_resource_upload_url", { kind: "image", mimeType: "image/png", byteSize: 10 });
    expect(issued.isError).toBe(true);
    const bound = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: ["res_any"] });
    expect(bound.isError).toBe(true);
    expect(errorText(bound)).toContain("write:resources");
  });

  test("cleanup deletes expired pending files and their bytes but never bound resources", async () => {
    const { sqlite, resourcesDirectory, callTool, issue, upload, count } = await createInstance();
    const kept = await upload();
    const bound = await upload();
    await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: [bound.uploaded.resourceId] });
    const boundKey = sqlite.query("SELECT object_key FROM resources WHERE id = ?").get(bound.uploaded.resourceId).object_key;
    const expired = await upload();
    const expiredKey = sqlite.query("SELECT object_key FROM pending_resources WHERE id = ?").get(expired.uploaded.resourceId).object_key;
    await issue();
    sqlite.query("UPDATE pending_resources SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ? OR state = 'awaiting_upload'")
      .run(expired.uploaded.resourceId);
    expect(await fileExists(join(resourcesDirectory, expiredKey))).toBe(true);

    // Cleanup runs, bounded and through the expires_at index, when a URL is issued.
    await issue();
    expect(sqlite.query("SELECT id FROM pending_resources WHERE id = ?").get(expired.uploaded.resourceId)).toBeNull();
    expect(await fileExists(join(resourcesDirectory, expiredKey))).toBe(false);
    expect(await fileExists(join(resourcesDirectory, boundKey))).toBe(true);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources WHERE id = ?", kept.uploaded.resourceId)).toBe(1);
    expect(count(UPLOADED_RESOURCES)).toBe(1);
    const plan = JSON.stringify(sqlite.query(
      "EXPLAIN QUERY PLAN SELECT id FROM pending_resources WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT 25",
    ).all("2030-01-01"));
    expect(plan).toContain("idx_pending_resources_expires_at");

    // An expired pending file can no longer be bound or read.
    const late = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: [expired.uploaded.resourceId] });
    expect(late.isError).toBe(true);
  });
});

describe("pending resource upload requests", () => {
  test("rejects an upload whose URL expires while the body is being sent", async () => {
    const { sqlite, fetchApp, issue, count } = await createInstance();
    const ticket = await issue();
    const body = pausedBody(PNG);
    const pending = fetchApp(ticket.uploadUrl, {
      method: "PUT",
      headers: { ...ticket.headers, "Content-Length": String(PNG.byteLength) },
      body: body.stream,
      duplex: "half",
    });
    await Bun.sleep(20);
    sqlite.query("UPDATE pending_resources SET upload_expires_at = '2000-01-01T00:00:00.000Z'").run();
    body.release();
    const response = await pending;
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe("upload_token_expired");
    expect(count("SELECT COUNT(*) AS count FROM pending_resources WHERE state = 'uploaded'")).toBe(0);
  });

  test("rejects an upload whose creating token is revoked while the body is being sent", async () => {
    const { sqlite, fetchApp, issue, count } = await createInstance();
    const ticket = await issue();
    const body = pausedBody(PNG);
    const pending = fetchApp(ticket.uploadUrl, {
      method: "PUT",
      headers: { ...ticket.headers, "Content-Length": String(PNG.byteLength) },
      body: body.stream,
      duplex: "half",
    });
    await Bun.sleep(20);
    sqlite.query("UPDATE api_tokens SET is_revoked = 1 WHERE id = 'tok_agent'").run();
    body.release();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources WHERE state = 'uploaded'")).toBe(0);
  });

  test("rejects a token that loses write:resources before the upload", async () => {
    const { sqlite, fetchApp, issue } = await createInstance();
    const ticket = await issue();
    sqlite.query("UPDATE api_tokens SET scopes_json = ? WHERE id = 'tok_agent'").run(JSON.stringify(["read:resources"]));
    expect((await put(fetchApp, ticket, PNG)).status).toBe(401);
  });

  test("a lost commit response is recovered from the row and a replay returns the same resource", async () => {
    const { fetchApp, issue, count, faults, useFaultyDb } = await createInstance();
    const ticket = await issue();
    useFaultyDb();
    // The commit is applied, then its response is lost; the recovery read succeeds.
    faults.push({ method: "run", after: true, match: (sql) => sql.includes("SET state = 'uploaded'") });
    const first = await put(fetchApp, ticket, PNG);
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const replay = await put(fetchApp, ticket, PNG);
    expect(replay.status).toBe(200);
    expect((await replay.json()).resourceId).toBe(firstBody.resourceId);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources")).toBe(1);
    // A different file on a used URL is refused.
    const other = Buffer.from(PNG);
    other[other.length - 1] ^= 1;
    expect((await put(fetchApp, ticket, other)).status).toBe(410);
    expect(count(UPLOADED_RESOURCES)).toBe(0);
  });

  test("keeps the bytes when both the commit response and the recovery read fail", async () => {
    const { sqlite, resourcesDirectory, fetchApp, callTool, issue, count, faults, useFaultyDb } = await createInstance();
    const ticket = await issue();
    useFaultyDb();
    faults.push({ method: "run", after: true, match: (sql) => sql.includes("SET state = 'uploaded'") });
    faults.push({ method: "first", match: (sql) => sql.includes("FROM pending_resources WHERE id = ?") });

    const first = await put(fetchApp, ticket, PNG);
    expect(first.status).toBe(503);
    expect((await first.json()).error.code).toBe("upload_outcome_unknown");
    const row = sqlite.query("SELECT id, state, object_key FROM pending_resources").get();
    expect(row.state).toBe("uploaded");
    const objectPath = join(resourcesDirectory, row.object_key);
    expect(Buffer.from(await readFile(objectPath)).equals(PNG)).toBe(true);

    // The retry returns the same resource without storing another object.
    const retried = await put(fetchApp, ticket, PNG);
    expect(retried.status).toBe(200);
    const retriedBody = await retried.json();
    expect(retriedBody.resourceId).toBe(row.id);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources")).toBe(1);
    expect(await readdir(join(resourcesDirectory, "workspaces/ws_default/uploads"))).toHaveLength(1);

    const readBlob = async () => {
      const response = await fetchApp(retriedBody.url, { headers: { Authorization: `Bearer ${MCP_TOKEN}` } });
      expect(response.status).toBe(200);
      return Buffer.from(await response.arrayBuffer());
    };
    expect((await readBlob()).equals(PNG)).toBe(true);
    const bound = await callTool("create_memo", { notebookId: "nb_uploads", resourceIds: [row.id] });
    expect(bound.isError).toBe(false);
    expect((await readBlob()).equals(PNG)).toBe(true);
    expect(count(UPLOADED_RESOURCES)).toBe(1);
  });

  test("an unconfirmed commit that did not apply is completed by a retry with the same file only", async () => {
    const { sqlite, resourcesDirectory, fetchApp, issue, count, faults, useFaultyDb } = await createInstance();
    const ticket = await issue();
    useFaultyDb();
    // The commit fails without applying and the recovery read fails too.
    faults.push({ method: "run", after: false, match: (sql) => sql.includes("SET state = 'uploaded'") });
    faults.push({ method: "first", match: (sql) => sql.includes("FROM pending_resources WHERE id = ?") });
    expect((await put(fetchApp, ticket, PNG)).status).toBe(503);
    const row = sqlite.query("SELECT id, state, object_key FROM pending_resources").get();
    expect(row.state).toBe("uploading");
    expect(await fileExists(join(resourcesDirectory, row.object_key))).toBe(true);

    const other = Buffer.from(PNG);
    other[other.length - 1] ^= 1;
    expect((await put(fetchApp, ticket, other)).status).toBe(410);
    const retried = await put(fetchApp, ticket, PNG);
    expect(retried.status).toBe(201);
    expect((await retried.json()).resourceId).toBe(row.id);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources WHERE state = 'uploaded'")).toBe(1);
    expect(Buffer.from(await readFile(join(resourcesDirectory, row.object_key))).equals(PNG)).toBe(true);
  });

  test("a confirmed failure before the commit releases the URL for a retry", async () => {
    const { fetchApp, issue, count, faults, useFaultyDb } = await createInstance();
    const ticket = await issue();
    useFaultyDb();
    faults.push({ method: "run", after: false, match: (sql) => sql.includes("SET state = 'uploaded'") });
    expect((await put(fetchApp, ticket, PNG)).status).toBe(503);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources WHERE state = 'awaiting_upload'")).toBe(1);
    expect((await put(fetchApp, ticket, PNG)).status).toBe(201);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources WHERE state = 'uploaded'")).toBe(1);
  });

  test("concurrent issuance cannot exceed the workspace limit", async () => {
    const { callTool, count } = await createInstance();
    const results = await Promise.all(Array.from({ length: 40 }, () => callTool("create_resource_upload_url", {
      kind: "image",
      mimeType: "image/png",
      byteSize: PNG.byteLength,
    })));
    expect(results.filter((result) => !result.isError)).toHaveLength(20);
    expect(results.filter((result) => result.isError).every((result) => errorText(result).includes("pending upload limit"))).toBe(true);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources")).toBe(20);
  });

  test("concurrent uploads with one URL store exactly one file", async () => {
    const { fetchApp, issue, count } = await createInstance();
    const ticket = await issue();
    const statuses = (await Promise.all(Array.from({ length: 5 }, () => put(fetchApp, ticket, PNG)))).map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.every((status) => status === 201 || status === 200 || status === 410)).toBe(true);
    expect(count("SELECT COUNT(*) AS count FROM pending_resources WHERE state = 'uploaded'")).toBe(1);
  });

  test("refuses missing, forged and MCP tokens and mismatched requests without consuming the URL", async () => {
    const { fetchApp, issue } = await createInstance();
    const ticket = await issue();
    const withoutToken = { ...ticket, headers: { "Content-Type": "image/png" } };
    expect((await put(fetchApp, withoutToken, PNG)).status).toBe(401);
    const forged = { ...ticket, headers: { ...ticket.headers, Authorization: `Bearer eeu_${"A".repeat(43)}` } };
    expect((await put(fetchApp, forged, PNG)).status).toBe(401);
    const mcp = { ...ticket, headers: { ...ticket.headers, Authorization: `Bearer ${MCP_TOKEN}` } };
    expect((await put(fetchApp, mcp, PNG)).status).toBe(401);
    expect((await put(fetchApp, ticket, Buffer.concat([PNG, PNG]))).status).toBe(400);
    expect((await put(fetchApp, ticket, PNG, { "Content-Type": "image/jpeg" })).status).toBe(415);
    expect((await put(fetchApp, ticket, PNG)).status).toBe(201);
  });

  test("validates tool arguments", async () => {
    const { callTool } = await createInstance();
    for (const args of [
      { kind: "video", mimeType: "image/png", byteSize: 10 },
      { kind: "image", mimeType: "image/bmp", byteSize: 10 },
      { kind: "image", mimeType: "image/png", byteSize: 0 },
      { kind: "image", mimeType: "image/png", byteSize: 104857601 },
    ]) {
      expect((await callTool("create_resource_upload_url", args)).isError).toBe(true);
    }
  });

  test("is a non-destructive MCP tool and is not offered to the in-app companion", () => {
    const tool = MCP_TOOLS.find((item) => item.name === "create_resource_upload_url");
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(tool.annotations.destructiveHint).toBe(false);
    expect(COMPANION_MCP_TOOLS.some((item) => item.name === "create_resource_upload_url")).toBe(false);
  });
});
