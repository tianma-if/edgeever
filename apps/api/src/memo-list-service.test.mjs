import { describe, expect, test } from "bun:test";
import { listMemos, toFtsQuery } from "./memo-list-service.ts";

const memoRow = (id, overrides = {}) => ({
  id,
  notebook_id: "nb_1",
  title: `Memo ${id}`,
  excerpt: `Excerpt ${id}`,
  content_text: `Body ${id}`,
  content_markdown: `Body ${id}`,
  tags_json: "[]",
  is_pinned: 0,
  is_archived: 0,
  is_deleted: 0,
  created_at: `2026-08-0${id.slice(-1)}T00:00:00.000Z`,
  updated_at: `2026-08-0${id.slice(-1)}T01:00:00.000Z`,
  deleted_at: null,
  revision: 1,
  ...overrides,
});

const createDatabase = ({ rows = [], totalCount = rows.length } = {}) => {
  const calls = [];
  return {
    calls,
    prepare: (sql) => ({
      bind: (...parameters) => {
        const call = { sql, parameters };
        calls.push(call);
        return {
          all: async () => ({ results: rows }),
          first: async () => ({ count: totalCount }),
        };
      },
    }),
  };
};

describe("memo list service", () => {
  test("paginates with an opaque cursor and reuses its sort position", async () => {
    const firstDatabase = createDatabase({
      rows: [memoRow("memo_1"), memoRow("memo_2"), memoRow("memo_3")],
      totalCount: 3,
    });
    const first = await listMemos(firstDatabase, {
      workspaceId: "ws_1",
      limit: 2,
    });

    expect(first.memos.map((memo) => memo.id)).toEqual(["memo_1", "memo_2"]);
    expect(first.totalCount).toBe(3);
    expect(first.nextCursor).toBeString();

    const secondDatabase = createDatabase({ rows: [memoRow("memo_3")] });
    await listMemos(secondDatabase, {
      workspaceId: "ws_1",
      limit: 2,
      cursor: first.nextCursor,
    });
    const pageQuery = secondDatabase.calls.find((call) => call.sql.includes("SELECT m.id"));
    expect(pageQuery.sql).toContain("m.updated_at < ?");
    expect(pageQuery.parameters).toContain("memo_2");
    expect(pageQuery.parameters.at(-1)).toBe(3);
  });

  test("applies descendant, trash, and tag filters to page and count queries", async () => {
    const database = createDatabase();
    await listMemos(database, {
      workspaceId: "ws_1",
      notebookId: "nb_parent",
      includeNotebookDescendants: true,
      includeTrash: true,
      filter: "tagged",
      sort: "title-asc",
    });

    expect(database.calls).toHaveLength(2);
    for (const call of database.calls) {
      expect(call.sql).toContain("WITH RECURSIVE descendants");
      expect(call.sql).toContain("m.is_deleted = 1");
      expect(call.sql).toContain("m.tags_json <> '[]'");
      expect(call.parameters.slice(0, 4)).toEqual(["ws_1", "ws_1", "nb_parent", "ws_1"]);
    }
  });

  test("filters by one exact tag in page and count queries", async () => {
    const database = createDatabase();
    await listMemos(database, {
      workspaceId: "ws_1",
      tag: "Demo",
    });

    expect(database.calls).toHaveLength(2);
    for (const call of database.calls) {
      expect(call.sql).toContain("FROM memo_tags mt");
      expect(call.sql).toContain("mt.normalized_name = LOWER(?)");
      expect(call.parameters.filter((value) => value === "ws_1").length).toBeGreaterThanOrEqual(2);
      expect(call.parameters).toContain("Demo");
      expect(call.sql).not.toContain("m.tags_json LIKE");
    }
  });

  test("combines FTS and escaped LIKE search for normal text", async () => {
    const database = createDatabase();
    await listMemos(database, {
      workspaceId: "ws_1",
      query: "hello 100%",
    });

    expect(toFtsQuery("hello 100%")).toBe('"hello" "100"');
    expect(database.calls[0].sql).toContain("memos_fts MATCH ?");
    expect(database.calls[0].parameters.slice(0, 4)).toEqual([
      '"hello" "100"',
      "%hello 100\\%%",
      "%hello 100\\%%",
      "%hello 100\\%%",
    ]);
  });

  test("falls back to LIKE when a query has no FTS tokens", async () => {
    const database = createDatabase();
    await listMemos(database, {
      workspaceId: "ws_1",
      query: "---",
    });

    expect(database.calls[0].sql).not.toContain("memos_fts MATCH");
    expect(database.calls[0].sql).toContain("m.title LIKE ?");
    expect(database.calls[0].parameters).toContain("%---%");
  });
});
