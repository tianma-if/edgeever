import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";

const migrationPaths = globSync("migrations/*.sql").sort();

describe("external-content memo search migration", () => {
  test("rebuilds only active memos and keeps FTS synchronized", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");

    for (const path of migrationPaths.filter((path) => path < "migrations/0034")) {
      sqlite.exec(readFileSync(path, "utf8"));
    }

    const workspace = sqlite.query("SELECT id FROM workspaces ORDER BY id LIMIT 1").get();
    const notebook = sqlite.query(
      "SELECT id FROM notebooks WHERE workspace_id = ? ORDER BY id LIMIT 1",
    ).get(workspace.id);

    sqlite.query(
      `INSERT INTO memos (id, workspace_id, notebook_id, title, excerpt, tags_json)
       VALUES ('memo_search_active', ?, ?, 'Search title', '', '["indexed"]')`,
    ).run(workspace.id, notebook.id);
    sqlite.query(
      `INSERT INTO memo_contents (
         memo_id, content_json, content_markdown, content_text, content_hash
       ) VALUES ('memo_search_active', '{"type":"doc","content":[]}', '', 'uniqueneedle', 'hash')`,
    ).run();
    sqlite.query(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES ('memo_orphan', 'Orphan', 'stalevalue', '')`,
    ).run();

    sqlite.exec(readFileSync("migrations/0034_search_documents_and_maintenance_leases.sql", "utf8"));

    const activeCount = sqlite.query("SELECT COUNT(*) AS count FROM memos WHERE is_deleted = 0").get().count;
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memo_search_documents").get().count).toBe(activeCount);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memo_search_documents WHERE memo_id = 'memo_orphan'").get().count).toBe(0);
    expect(sqlite.query("SELECT memo_id FROM memos_fts WHERE memos_fts MATCH 'uniqueneedle'").get()).toEqual({
      memo_id: "memo_search_active",
    });

    sqlite.query(
      `UPDATE memo_search_documents
       SET content_text = 'replacementneedle'
       WHERE memo_id = 'memo_search_active'`,
    ).run();
    expect(sqlite.query("SELECT memo_id FROM memos_fts WHERE memos_fts MATCH 'uniqueneedle'").get()).toBeNull();
    expect(sqlite.query("SELECT memo_id FROM memos_fts WHERE memos_fts MATCH 'replacementneedle'").get()).toEqual({
      memo_id: "memo_search_active",
    });

    sqlite.query("DELETE FROM memo_search_documents WHERE memo_id = 'memo_search_active'").run();
    expect(sqlite.query("SELECT memo_id FROM memos_fts WHERE memos_fts MATCH 'replacementneedle'").get()).toBeNull();
    expect(sqlite.query("SELECT name FROM sqlite_master WHERE name = 'maintenance_leases'").get()).toEqual({
      name: "maintenance_leases",
    });

    sqlite.close();
  });
});
