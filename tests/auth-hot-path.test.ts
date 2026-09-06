import { describe, expect, test } from "bun:test";
import worker from "../apps/api/src/index";

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
  props: {},
} as unknown as ExecutionContext;

const createDatabase = (
  statements: string[],
  { lastSeenAt = new Date().toISOString() }: { lastSeenAt?: string } = {},
) => ({
  prepare(sql: string) {
    statements.push(sql);
    return {
      bind() {
        return this;
      },
      async first() {
        if (sql.includes("SELECT id FROM users")) return { id: "usr_owner" };
        if (sql.includes("FROM sessions s")) {
          return {
            id: "sess_owner",
            user_id: "usr_owner",
            username: "owner",
            display_name: "Owner",
            expires_at: "2027-08-14T00:00:00.000Z",
            last_seen_at: lastSeenAt,
            workspace_id: "ws_default",
            role: "owner",
          };
        }
        if (sql.includes("FROM memo_shares")) return null;
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return { success: true };
      },
    };
  },
}) as unknown as D1Database;

describe("authentication hot path", () => {
  test("reads an authenticated session without provisioning or seeding its workspace", async () => {
    const statements: string[] = [];
    const response = await worker.fetch(
      new Request("https://edgeever.test/api/v1/auth/session", {
        headers: { Authorization: "Bearer desktop-session-token" },
      }),
      { DB: createDatabase(statements), EDGE_EVER_AUTH_PASSWORD: "configured-secret" } as never,
      executionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      user: { id: "usr_owner", role: "owner" },
    });
    const sessionQueries = statements.filter((sql) => sql.includes("FROM sessions s"));
    expect(sessionQueries).toHaveLength(1);
    expect(sessionQueries[0]).toContain("LEFT JOIN workspace_members");
    expect(statements.some((sql) => sql.includes("SELECT id FROM users"))).toBe(false);
    expect(statements.some((sql) => sql.includes("memo_templates"))).toBe(false);
    expect(statements.some((sql) => sql.includes("ai_prompt_templates"))).toBe(false);
  });

  test("does not rewrite a recently touched session on a protected request", async () => {
    const statements: string[] = [];
    const response = await worker.fetch(
      new Request("https://edgeever.test/api/v1/memos/memo_1/share", {
        headers: { Authorization: "Bearer desktop-session-token" },
      }),
      { DB: createDatabase(statements), EDGE_EVER_AUTH_PASSWORD: "configured-secret" } as never,
      executionContext,
    );

    expect(response.status).toBe(200);
    expect(statements.some((sql) => /UPDATE sessions\s+SET last_seen_at/.test(sql))).toBe(false);
    expect(statements.some((sql) => sql.includes("SELECT id FROM users"))).toBe(false);
    expect(statements.some((sql) => sql.includes("memo_templates"))).toBe(false);
    expect(statements.some((sql) => sql.includes("ai_prompt_templates"))).toBe(false);
  });

  test("touches a stale session once on a protected request", async () => {
    const statements: string[] = [];
    const response = await worker.fetch(
      new Request("https://edgeever.test/api/v1/memos/memo_1/share", {
        headers: { Authorization: "Bearer desktop-session-token" },
      }),
      {
        DB: createDatabase(statements, { lastSeenAt: "2026-08-14T00:00:00.000Z" }),
        EDGE_EVER_AUTH_PASSWORD: "configured-secret",
      } as never,
      executionContext,
    );

    expect(response.status).toBe(200);
    expect(statements.filter((sql) => /UPDATE sessions\s+SET last_seen_at/.test(sql))).toHaveLength(1);
  });
});
