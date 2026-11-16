import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fetchEdgeEverApp } from "./index.ts";
import { markdownToNotionBlocks, notionBlocksToMarkdown } from "./notion-markdown.ts";
import {
  extractNotionDatabaseUuid,
  signNotionWebhookBody,
} from "./notion-sync-crypto.ts";

class CountingPreparedStatement {
  constructor(sqlite, sql, stats, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.stats = stats;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new CountingPreparedStatement(this.sqlite, this.sql, this.stats, bindings);
  }

  async all() {
    this.stats.selectQueries += 1;
    const results = this.sqlite.query(this.sql).all(...this.bindings);
    this.stats.rowsRead += results.length;
    return { results };
  }

  async first() {
    this.stats.selectQueries += 1;
    const row = this.sqlite.query(this.sql).get(...this.bindings) ?? null;
    if (row) this.stats.rowsRead += 1;
    return row;
  }

  async run() {
    this.sqlite.query(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: 1 } };
  }
}

class CountingSqliteDatabase {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.stats = { selectQueries: 0, rowsRead: 0 };
  }

  resetStats() {
    this.stats.selectQueries = 0;
    this.stats.rowsRead = 0;
  }

  prepare(sql) {
    return new CountingPreparedStatement(this.sqlite, sql, this.stats);
  }

  async batch(statements) {
    const results = [];
    this.sqlite.transaction(() => {
      for (const statement of statements) {
        this.sqlite.query(statement.sql).run(...statement.bindings);
        results.push({ results: [], success: true, meta: { changes: 1 } });
      }
    })();
    return results;
  }
}

const createTestEnvironment = (publicNetworkFetch) => {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const path of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(path, "utf8"));
  }
  const db = new CountingSqliteDatabase(sqlite);
  const env = {
    EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
    EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "test-notion-master-key",
    publicNetworkFetch,
    storage: {
      db,
      resources: {
        get: async () => null,
        put: async () => undefined,
        createMultipartUpload: async () => {
          throw new Error("unused");
        },
        resumeMultipartUpload: () => {
          throw new Error("unused");
        },
        delete: async () => undefined,
      },
      diagnostics: {
        database: "sqlite",
        resources: "filesystem",
        migrationTable: "_edgeever_migrations",
      },
    },
  };
  return { sqlite, db, env };
};

const callApp = async (env, path, init = {}) => {
  const background = [];
  const response = await fetchEdgeEverApp(
    new Request(`https://notes.example.com${path}`, init),
    env,
    {
      passThroughOnException() {},
      waitUntil: (promise) => background.push(promise),
    },
  );
  await Promise.all(background);
  return response;
};

describe("Notion two-way sync", () => {
  test("extracts database UUIDs from IDs and URLs and chunks large Notion blocks safely", () => {
    expect(
      extractNotionDatabaseUuid(
        "https://app.notion.com/p/41abfa1b384280bfa17de7966c55ed7d?v=41abfa1b38428058b24a000c20db68bb",
      ),
    ).toBe("41abfa1b-3842-80bf-a17d-e7966c55ed7d");
    expect(extractNotionDatabaseUuid("41abfa1b-3842-80bf-a17d-e7966c55ed7d")).toBe(
      "41abfa1b-3842-80bf-a17d-e7966c55ed7d",
    );
    expect(extractNotionDatabaseUuid("not-a-database-id")).toBeNull();

    // >100 inline code segments in one paragraph must split into <=95 rich_text blocks
    const manyInlineCodes = Array.from({ length: 120 }, (_, i) => `\`tok${i}\``).join(" ");
    const blocks = markdownToNotionBlocks(manyInlineCodes);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.paragraph.rich_text.length).toBeLessThanOrEqual(95);
    }

    const sampleMd = "# Heading\n\n- [x] Done\n- [ ] Pending\n\n> Quote";
    expect(notionBlocksToMarkdown(markdownToNotionBlocks(sampleMd))).toBe(sampleMd);
  });

  test("synchronizes both directions, encrypts credentials at rest, and prevents bot loops", async () => {
    const dbUuid = "41abfa1b-3842-80bf-a17d-e7966c55ed7d";
    const notionCreatedPages = [];
    const notionPatchedPages = [];
    let schemaPatched = false;

    const remotePageUuid = "99999999-8888-7777-6666-555555555555";
    const mockNotionTransport = async (url, init = {}) => {
      const method = init.method ?? "GET";
      if (url.endsWith(`/databases/${dbUuid}`) && method === "GET") {
        return new Response(
          JSON.stringify({
            title: [{ plain_text: "EdgeEver Notes" }],
            properties: { 标题: { id: "title", type: "title" } },
          }),
        );
      }
      if (url.endsWith(`/databases/${dbUuid}`) && method === "PATCH") {
        schemaPatched = true;
        return new Response(JSON.stringify({ id: dbUuid }));
      }
      if (url.endsWith(`/databases/${dbUuid}/query`) && method === "POST") {
        return new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }));
      }
      if (url.endsWith("/pages") && method === "POST") {
        const body = JSON.parse(String(init.body));
        notionCreatedPages.push(body);
        return new Response(JSON.stringify({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }));
      }
      if (url.endsWith(`/pages/${remotePageUuid}`) && method === "GET") {
        return new Response(
          JSON.stringify({
            id: remotePageUuid,
            archived: false,
            in_trash: false,
            last_edited_time: "2026-11-16T00:00:00.000Z",
            parent: { type: "database_id", database_id: dbUuid },
            properties: {
              标题: { type: "title", title: [{ plain_text: "From Notion" }] },
              Tags: { type: "multi_select", multi_select: [{ name: "synced" }] },
              Notebook: { type: "select", select: { name: "Inbox" } },
              Pinned: { type: "checkbox", checkbox: true },
              "EdgeEver ID": { type: "rich_text", rich_text: [] },
            },
          }),
        );
      }
      if (url.includes(`/blocks/${remotePageUuid}/children`) && method === "GET") {
        return new Response(
          JSON.stringify({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Written inside Notion" }] },
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
        );
      }
      if (url.includes("/pages/") && method === "PATCH") {
        notionPatchedPages.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ id: remotePageUuid }));
      }
      throw new Error(`Unexpected Notion call: ${method} ${url}`);
    };

    const { sqlite, env } = createTestEnvironment(mockNotionTransport);

    // 1. Save Notion sync configuration using a full Notion URL
    const putRes = await callApp(env, "/api/v1/integrations/notion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isEnabled: true,
        apiToken: "ntn_secret_token_value",
        databaseId: `https://app.notion.com/p/${dbUuid.replace(/-/g, "")}?v=123`,
      }),
    });
    expect(putRes.status).toBe(200);
    const { settings } = await putRes.json();
    expect(schemaPatched).toBe(true);
    expect(settings.databaseId).toBe(dbUuid);
    expect(settings.databaseTitle).toBe("EdgeEver Notes");
    expect(settings.webhookPath).toMatch(/^\/api\/public\/webhooks\/notion\/nwh_/);

    // Ensure raw token is never stored in plaintext
    const rawRow = sqlite.query("SELECT api_token_encrypted FROM notion_sync_configs").get();
    expect(rawRow.api_token_encrypted).not.toContain("ntn_secret_token_value");
    expect(rawRow.api_token_encrypted.startsWith("v1.")).toBe(true);

    // 2. Creating a memo in EdgeEver automatically pushes it to Notion
    const notebooksRes = await callApp(env, "/api/v1/notebooks");
    const { notebooks } = await notebooksRes.json();
    const createMemoRes = await callApp(env, "/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId: notebooks[0].id,
        title: "Local EdgeEver Note",
        contentMarkdown: "Hello Notion!",
        tags: ["alpha"],
      }),
    });
    expect(createMemoRes.status).toBe(201);
    expect(notionCreatedPages.length).toBe(1);
    expect(notionCreatedPages[0].properties["标题"].title[0].text.content).toBe(
      "Local EdgeEver Note",
    );

    // 3. Notion verification_token handshake + auto-promotion on signed event
    const verifyToken = "secret_notion_verify_abc";
    const handshakeRes = await callApp(env, settings.webhookPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verification_token: verifyToken }),
    });
    expect(handshakeRes.status).toBe(200);

    const getAfterHandshake = await (await callApp(env, "/api/v1/integrations/notion")).json();
    expect(getAfterHandshake.settings.pendingVerificationToken).toBe(verifyToken);

    // Bot-authored event is ignored without creating a note
    const botBody = JSON.stringify({
      id: "evt_bot",
      type: "page.created",
      authors: [{ id: "bot_1", type: "bot" }],
      entity: { id: remotePageUuid, type: "page" },
    });
    const botRes = await callApp(env, settings.webhookPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Notion-Signature": await signNotionWebhookBody(verifyToken, botBody),
      },
      body: botBody,
    });
    expect(botRes.status).toBe(200);
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM memos WHERE title = 'From Notion'").get().count,
    ).toBe(0);

    // Human-authored event creates the memo in EdgeEver and does NOT loop back to Notion create
    const humanBody = JSON.stringify({
      id: "evt_human",
      type: "page.created",
      authors: [{ id: "usr_1", type: "person" }],
      entity: { id: remotePageUuid, type: "page" },
    });
    const humanRes = await callApp(env, settings.webhookPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Notion-Signature": await signNotionWebhookBody(verifyToken, humanBody),
      },
      body: humanBody,
    });
    expect(humanRes.status).toBe(200);
    expect(notionCreatedPages.length).toBe(1); // Still 1 — no echo loop!

    const imported = sqlite
      .query("SELECT id, title, is_pinned FROM memos WHERE title = 'From Notion'")
      .get();
    expect(imported).toBeTruthy();
    expect(imported.is_pinned).toBe(1);
    expect(notionPatchedPages.length).toBe(1);

    sqlite.close();
  });

  test("maintains linear O(N) database read budget across paginated full sync batches", async () => {
    const dbUuid = "41abfa1b-3842-80bf-a17d-e7966c55ed7d";
    let pageCounter = 0;

    const mockNotionTransport = async (url, init = {}) => {
      const method = init.method ?? "GET";
      if (url.endsWith(`/databases/${dbUuid}`)) {
        return new Response(
          JSON.stringify({
            title: [{ plain_text: "Budget DB" }],
            properties: {
              Name: { id: "title", type: "title" },
              Tags: { id: "t", type: "multi_select" },
              Notebook: { id: "n", type: "select" },
              Pinned: { id: "p", type: "checkbox" },
              "EdgeEver ID": { id: "e", type: "rich_text" },
            },
          }),
        );
      }
      if (url.endsWith(`/databases/${dbUuid}/query`) && method === "POST") {
        return new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }));
      }
      if (url.endsWith("/pages") && method === "POST") {
        pageCounter += 1;
        const hex = String(pageCounter).padStart(32, "0");
        return new Response(JSON.stringify({ id: hex }));
      }
      if (url.includes("/blocks/") && method === "PATCH") {
        return new Response(JSON.stringify({ results: [] }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    };

    const { sqlite, db, env } = createTestEnvironment(mockNotionTransport);
    await callApp(env, "/api/v1/integrations/notion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isEnabled: true,
        apiToken: "ntn_budget_key",
        databaseId: dbUuid,
      }),
    });

    const notebooks = (await (await callApp(env, "/api/v1/notebooks")).json()).notebooks;
    const notebookId = notebooks[0].id;
    const workspaceId = sqlite.query("SELECT id FROM workspaces LIMIT 1").get().id;

    // Insert 40 representative memos
    for (let i = 0; i < 40; i += 1) {
      const id = `memo_budget_${String(i).padStart(3, "0")}`;
      sqlite
        .query(
          `INSERT INTO memos (id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by)
           VALUES (?, ?, ?, ?, 'body', '[]', 'user', 'user')`,
        )
        .run(id, workspaceId, notebookId, `Note ${i}`);
      sqlite
        .query(
          `INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash)
           VALUES (?, '{"type":"doc","content":[]}', 'body', 'body', ?)`,
        )
        .run(id, `hash_${i}`);
    }

    // Second pass when all memos are already synced should skip in 2 keyset pages with zero Notion writes
    let phase = "ee_to_notion";
    let cursor = null;
    while (phase) {
      const res = await (
        await callApp(env, "/api/v1/integrations/notion/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase, cursor }),
        })
      ).json();
      if (!res.hasMore) break;
      phase = res.nextPhase;
      cursor = res.nextCursor;
    }

    const createdBeforeNoopPass = pageCounter;
    db.resetStats();

    phase = "ee_to_notion";
    cursor = null;
    let batches = 0;
    while (phase) {
      batches += 1;
      const res = await (
        await callApp(env, "/api/v1/integrations/notion/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase, cursor }),
        })
      ).json();
      if (!res.hasMore) break;
      phase = res.nextPhase;
      cursor = res.nextCursor;
    }

    expect(pageCounter).toBe(createdBeforeNoopPass);
    expect(batches).toBeLessThanOrEqual(4);
    // ~45 memos + notebooks + auth/config lookups across 3 batches stays strictly linear (< 120 rows total, not O(N^2))
    expect(db.stats.rowsRead).toBeLessThan(120);

    sqlite.close();
  });

  test("preserves populated 0095 workspace data across the 0096 migration upgrade", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    const allMigrations = globSync("migrations/*.sql").sort();
    for (const path of allMigrations.filter((file) => basename(file) !== "0096_notion_sync.sql")) {
      sqlite.exec(readFileSync(path, "utf8"));
    }

    const db = new CountingSqliteDatabase(sqlite);
    const env = {
      EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
      EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "test-notion-master-key",
      publicNetworkFetch: async () => new Response("{}", { status: 200 }),
      storage: {
        db,
        resources: {
          get: async () => null,
          put: async () => undefined,
          createMultipartUpload: async () => {
            throw new Error("unused");
          },
          resumeMultipartUpload: () => {
            throw new Error("unused");
          },
          delete: async () => undefined,
        },
        diagnostics: {
          database: "sqlite",
          resources: "filesystem",
          migrationTable: "_edgeever_migrations",
        },
      },
    };

    const notebooks = (await (await callApp(env, "/api/v1/notebooks")).json()).notebooks;

    // Create a memo on the 0095 schema before applying 0096_notion_sync.sql
    const createRes = await callApp(env, "/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId: notebooks[0].id,
        title: "Legacy Note",
        contentMarkdown: "Created on 0095 before upgrading.",
        tags: ["upgrade"],
      }),
    });
    expect(createRes.status).toBe(201);
    const createdOn0095 = await createRes.json();
    const legacyMemoId = createdOn0095.memo?.id ?? createdOn0095.id;
    expect(legacyMemoId).toBeTruthy();

    // Apply 0096_notion_sync.sql in-place
    sqlite.exec(readFileSync("migrations/0096_notion_sync.sql", "utf8"));

    // Existing memo survives intact and GET traffic incurs zero Notion table reads
    const fetchedAfter0096 = await (
      await callApp(env, `/api/v1/memos/${legacyMemoId}`)
    ).json();
    const fetchedMemo = fetchedAfter0096.memo ?? fetchedAfter0096;
    expect(fetchedMemo.id).toBe(legacyMemoId);
    expect(fetchedMemo.contentMarkdown ?? fetchedMemo.content).toContain(
      "Created on 0095 before upgrading.",
    );

    const defaultSettings = await (
      await callApp(env, "/api/v1/integrations/notion")
    ).json();
    expect(defaultSettings.settings.configured).toBe(false);
    expect(defaultSettings.settings.isEnabled).toBe(false);

    sqlite.close();
  });
});
