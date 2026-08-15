import { describe, expect, test } from "bun:test";
import {
  createWorkspaceDefaultSeedStatements,
  ensureUserWorkspace,
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
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("FROM workspace_members WHERE user_id");
  });

  test("builds static template and AI prompt statements for new workspaces", () => {
    const calls = [];
    const db = {
      prepare: (sql) => statement(sql, calls),
    };

    const statements = createWorkspaceDefaultSeedStatements(
      db,
      "ws_new",
      "2026-08-14T00:00:00.000Z",
    );

    expect(statements.length).toBeGreaterThan(1);
    expect(calls[0].sql).toContain("INSERT OR IGNORE INTO memo_templates");
    expect(calls[0].values).toContain("ws_new_template_project_weekly");
    expect(calls.some((call) => call.sql.includes("INSERT OR IGNORE INTO ai_prompt_templates"))).toBe(true);
  });
});
