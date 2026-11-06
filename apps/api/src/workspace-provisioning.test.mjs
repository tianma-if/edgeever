import { describe, expect, test } from "bun:test";
import {
  createDefaultNotebookRows,
  createWorkspaceDefaultSeedStatements,
  ensureUserWorkspace,
  isInboxNotebook,
  workspaceInboxId,
} from "./workspace-provisioning.ts";

const statement = (sql, calls) => ({
  bind(...values) {
    calls.push({ sql, values });
    return this;
  },
  async first() {
    return sql.includes("FROM workspace_members WHERE user_id")
      ? { workspace_id: "ws_existing", role: "member" }
      : null;
  },
  async run() {
    return { success: true };
  },
});

describe("workspace provisioning", () => {
  test("uses a stable workspace-scoped inbox id", () => {
    expect(workspaceInboxId("ws_1")).toBe("ws_1_inbox");
    expect(createDefaultNotebookRows("ws_1")[0]).toMatchObject({
      id: "ws_1_inbox",
      slug: "inbox",
    });
    expect(isInboxNotebook({ id: "ws_1_inbox", slug: "shou-ji-xiang" }, "ws_1")).toBe(true);
  });

  test("does not restore defaults while resolving an existing workspace", async () => {
    const calls = [];
    let batchCount = 0;
    const db = {
      prepare: (sql) => statement(sql, calls),
      batch: async () => {
        batchCount += 1;
        return [];
      },
    };

    expect(await ensureUserWorkspace(db, "usr_existing", "writer")).toEqual({
      workspaceId: "ws_existing",
      role: "member",
    });
    expect(batchCount).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("FROM workspace_members WHERE user_id");
    expect(calls[1].sql).toContain("FROM workspace_seed_localizations");
  });

  test("builds editable localized template and AI prompt statements for new workspaces", () => {
    const calls = [];
    const db = {
      prepare: (sql) => statement(sql, calls),
    };

    const statements = createWorkspaceDefaultSeedStatements(
      db,
      "ws_new",
      "2026-08-14T00:00:00.000Z",
      "en-US",
    );

    expect(statements.length).toBeGreaterThan(6);
    expect(calls[0].sql).toContain("INSERT OR IGNORE INTO memo_templates");
    expect(calls[0].values).toContain("ws_new_template_quick-note");
    expect(calls[0].values).toContain("Quick Spark");
    expect(calls.filter((call) => call.sql.includes("INSERT OR IGNORE INTO memo_templates"))).toHaveLength(5);
    expect(calls.some((call) => call.sql.includes("INSERT OR IGNORE INTO ai_prompt_templates"))).toBe(true);
  });

  test("seeds Japanese templates when Accept-Language prefers Japanese", () => {
    const calls = [];
    const db = {
      prepare: (sql) => statement(sql, calls),
    };

    createWorkspaceDefaultSeedStatements(
      db,
      "ws_ja",
      "2026-08-14T00:00:00.000Z",
      "ja-JP,ja;q=0.9",
    );

    expect(calls[0].values).toContain("ひらめきメモ");
  });

  test("seeds English templates when Accept-Language is unmatched", () => {
    const calls = [];
    const db = {
      prepare: (sql) => statement(sql, calls),
    };

    createWorkspaceDefaultSeedStatements(
      db,
      "ws_it",
      "2026-08-14T00:00:00.000Z",
      "it-IT,it;q=0.9",
    );

    expect(calls[0].values).toContain("Quick Spark");
  });
});
