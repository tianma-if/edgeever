import { describe, expect, test } from "bun:test";
import {
  listMemoRevisions,
  mapMemoRevision,
  restoreMemoRevision,
  shouldSnapshotMemoRevision,
} from "./memo-revision-service.ts";

const current = {
  id: "memo_1",
  revision: 3,
  title: "Current",
  tags_json: '["tag"]',
  content_json: '{"type":"doc","content":[]}',
  content_markdown: "Current body",
  content_text: "Current body",
  content_hash: "current-hash",
};

const revision = {
  id: "revision_1",
  memo_id: "memo_1",
  revision: 2,
  title: "Previous",
  tags_json: '["old"]',
  content_json: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Previous body"}]}]}',
  content_markdown: "Previous body",
  content_text: "Previous body",
  content_hash: "previous-hash",
  created_by: "Owner",
  created_at: "2026-08-29T00:00:00.000Z",
};

const createStatement = (sql, firstValue = null, allResults = []) => ({
  sql,
  bindings: [],
  bind(...bindings) {
    this.bindings = bindings;
    return this;
  },
  async first() {
    return firstValue;
  },
  async all() {
    return { success: true, meta: {}, results: allResults };
  },
  async run() {
    return { success: true, meta: {}, results: [] };
  },
});

describe("memo revision service", () => {
  test("maps stored revision rows into the public contract", () => {
    expect(mapMemoRevision(revision)).toEqual({
      id: "revision_1",
      memoId: "memo_1",
      revision: 2,
      title: "Previous",
      tags: ["old"],
      contentMarkdown: "Previous body",
      contentText: "Previous body",
      contentHash: "previous-hash",
      createdBy: "Owner",
      createdAt: "2026-08-29T00:00:00.000Z",
    });
  });

  test("does not query revision history when the memo is unchanged", async () => {
    const database = {
      prepare: () => {
        throw new Error("Revision history should not be queried");
      },
    };

    await expect(shouldSnapshotMemoRevision(
      database,
      current,
      current.title,
      current.tags_json,
      current.content_hash,
      "2026-08-29T01:00:00.000Z",
    )).resolves.toBe(false);
  });

  test("lists revisions only after confirming memo visibility", async () => {
    const statement = createStatement("SELECT revisions", null, [revision]);
    const database = { prepare: () => statement };
    const visibilityChecks = [];

    const result = await listMemoRevisions(
      database,
      "workspace_1",
      "memo_1",
      25,
      async (_db, workspaceId, memoId, includeDeleted) => {
        visibilityChecks.push({ workspaceId, memoId, includeDeleted });
        return { id: memoId };
      },
      false,
    );

    expect(result).toEqual([mapMemoRevision(revision)]);
    expect(visibilityChecks).toEqual([{
      workspaceId: "workspace_1",
      memoId: "memo_1",
      includeDeleted: false,
    }]);
    expect(statement.bindings).toEqual(["memo_1", 25]);
  });

  test("restores a revision through one service-owned batch", async () => {
    const prepared = [];
    let batch = [];
    const database = {
      prepare: (sql) => {
        const statement = createStatement(sql, sql.includes("FROM memo_revisions mr") ? revision : null);
        prepared.push(statement);
        return statement;
      },
      batch: async (statements) => {
        batch = statements;
        return statements.map(() => ({ success: true, meta: {}, results: [] }));
      },
    };
    const restoredMemo = { id: "memo_1", revision: 4, title: "Previous" };

    const result = await restoreMemoRevision(
      database,
      "workspace_1",
      "memo_1",
      "revision_1",
      { actorType: "user", actorId: "user_1" },
      "Owner",
      {
        getMemoDetailRow: async () => current,
        getMemoDetail: async () => restoredMemo,
      },
    );

    expect(result).toBe(restoredMemo);
    expect(batch).toHaveLength(5);
    expect(prepared.some(({ sql }) => sql.includes("INSERT INTO memo_revisions"))).toBe(true);
    expect(prepared.some(({ sql }) => sql.includes("UPDATE memo_contents"))).toBe(true);
  });
});
