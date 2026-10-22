// Standalone design experiment. Uses disposable in-memory databases only.
// Run: bun scripts/public-notebook-site-schema-ablation.mjs > docs/public-notebook-site-schema-ablation.json
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const root = fileURLToPath(new URL("../", import.meta.url));
const variants = ["two_tables", "one_table", "json_column"];
const selectedVariants = process.argv.includes("--json-only") ? ["json_column"]
  : process.argv.includes("--relational-only") ? ["two_tables", "one_table"] : variants;
const searchOnly = process.argv.includes("--search-only");
const share = "ab_share_root";
const childShare = "ab_share_child";
const idFor = (index) => `memo_${index.toString(16).padStart(32, "0")}`;
const timestamp = "2026-10-20T00:00:00.000Z";
const commonColumns = [
  "site_title TEXT", "site_description TEXT NOT NULL DEFAULT ''", "site_slug TEXT",
  "home_memo_id TEXT REFERENCES memos(id) ON DELETE SET NULL", "logo_url TEXT",
  "header_links_json TEXT NOT NULL DEFAULT '[]'", "footer_text TEXT NOT NULL DEFAULT ''",
  "allow_indexing INTEGER NOT NULL DEFAULT 0 CHECK(allow_indexing IN (0, 1))",
  "excluded_tags_json TEXT NOT NULL DEFAULT '[]'",
  "notebook_sort_mode TEXT NOT NULL DEFAULT 'existing'", "memo_sort_mode TEXT NOT NULL DEFAULT 'existing'",
];

function fixture(variant) {
  const db = new Database(":memory:");
  for (const path of globSync("migrations/*.sql", { cwd: root }).sort()) {
    db.exec(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.run("INSERT INTO workspaces (id, name) VALUES ('ab_ws', 'Experiment'), ('ab_other', 'Other')");
  for (const [id, parent, workspace, rank] of [
    ["ab_root", null, "ab_ws", 0], ["ab_a", "ab_root", "ab_ws", 20],
    ["ab_b", "ab_root", "ab_ws", 10], ["ab_out", null, "ab_ws", 0],
    ["ab_foreign", "ab_root", "ab_other", 0],
  ]) db.run("INSERT INTO notebooks (id, parent_id, workspace_id, name, sort_order) VALUES (?, ?, ?, ?, ?)", [id, parent, workspace, id, rank]);
  db.run("INSERT INTO notebook_shares (id, notebook_id, workspace_id, token, password_hash) VALUES (?, 'ab_root', 'ab_ws', ?, 'legacy-hash-sentinel'), (?, 'ab_a', 'ab_ws', ?, NULL)", [share, "n".repeat(43), childShare, "c".repeat(43)]);
  const legacy = db.query("SELECT token, password_hash FROM notebook_shares WHERE id = ?").get(share);
  for (const column of commonColumns) db.exec(`ALTER TABLE notebook_shares ADD COLUMN ${column}`);
  db.exec("CREATE UNIQUE INDEX ab_site_slug ON notebook_shares(site_slug) WHERE site_slug IS NOT NULL");
  if (variant === "two_tables") {
    db.exec(`CREATE TABLE ab_memo_settings (
      share_id TEXT NOT NULL REFERENCES notebook_shares(id) ON DELETE CASCADE,
      memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
      excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0, 1)),
      sort_order INTEGER CHECK(sort_order >= 0),
      created_at TEXT NOT NULL DEFAULT '${timestamp}', updated_at TEXT NOT NULL DEFAULT '${timestamp}',
      PRIMARY KEY(share_id, memo_id));
      CREATE INDEX ab_memo_target ON ab_memo_settings(memo_id);
      CREATE TABLE ab_notebook_settings (
      share_id TEXT NOT NULL REFERENCES notebook_shares(id) ON DELETE CASCADE,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      sort_order INTEGER CHECK(sort_order >= 0),
      created_at TEXT NOT NULL DEFAULT '${timestamp}', updated_at TEXT NOT NULL DEFAULT '${timestamp}',
      PRIMARY KEY(share_id, notebook_id));
      CREATE INDEX ab_notebook_target ON ab_notebook_settings(notebook_id);`);
  } else if (variant === "one_table") {
    db.exec(`CREATE TABLE ab_item_settings (
      id INTEGER PRIMARY KEY,
      share_id TEXT NOT NULL REFERENCES notebook_shares(id) ON DELETE CASCADE,
      memo_id TEXT REFERENCES memos(id) ON DELETE CASCADE,
      notebook_id TEXT REFERENCES notebooks(id) ON DELETE CASCADE,
      excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0, 1)),
      sort_order INTEGER CHECK(sort_order >= 0),
      created_at TEXT NOT NULL DEFAULT '${timestamp}', updated_at TEXT NOT NULL DEFAULT '${timestamp}',
      CHECK((memo_id IS NOT NULL) <> (notebook_id IS NOT NULL)),
      CHECK(notebook_id IS NULL OR excluded = 0));
      CREATE UNIQUE INDEX ab_item_memo ON ab_item_settings(share_id, memo_id) WHERE memo_id IS NOT NULL;
      CREATE UNIQUE INDEX ab_item_notebook ON ab_item_settings(share_id, notebook_id) WHERE notebook_id IS NOT NULL;
      CREATE INDEX ab_item_memo_target ON ab_item_settings(memo_id) WHERE memo_id IS NOT NULL;
      CREATE INDEX ab_item_notebook_target ON ab_item_settings(notebook_id) WHERE notebook_id IS NOT NULL;`);
  } else {
    db.exec("ALTER TABLE notebook_shares ADD COLUMN content_settings_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(content_settings_json) AND json_type(content_settings_json) = 'object')");
  }
  assert.deepEqual(db.query("SELECT token, password_hash FROM notebook_shares WHERE id = ?").get(share), legacy);

  const addMemo = db.query("INSERT INTO memos (id, notebook_id, workspace_id, title, tags_json) VALUES (?, ?, ?, ?, ?)");
  const addContent = db.query("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash) VALUES (?, ?, ?, ?, ?)");
  const addSearch = db.query("INSERT INTO memo_search_documents (memo_id, title, content_text, tags) VALUES (?, ?, ?, ?)");
  const addResource = db.query("INSERT INTO resources (id, memo_id, object_key, kind) VALUES (?, ?, ?, 'image')");
  function seedMemo(id, notebook = "ab_a", tags = [], workspace = "ab_ws", resource = false) {
    addMemo.run(id, notebook, workspace, id, JSON.stringify(tags));
    addContent.run(id, '{"type":"doc","content":[]}', "ablationword", "ablationword", id);
    addSearch.run(id, id, "ablationword", tags.join(" "));
    if (resource) addResource.run(`res_${id}`, id, id);
  }
  function patch(kind, target, changes, sid = share) {
    if (variant === "json_column") {
      const value = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key === "sort_order" ? "sortOrder" : key, value]));
      const doc = { [kind === "memo" ? "memos" : "notebooks"]: { [target]: value } };
      db.query("UPDATE notebook_shares SET content_settings_json = json_patch(content_settings_json, ?) WHERE id = ?").run(JSON.stringify(doc), sid);
    } else {
      const table = variant === "one_table" ? "ab_item_settings" : kind === "memo" ? "ab_memo_settings" : "ab_notebook_settings";
      const key = kind === "memo" ? "memo_id" : "notebook_id";
      const columns = Object.keys(changes);
      const partial = variant === "one_table" ? ` WHERE ${key} IS NOT NULL` : "";
      db.query(`INSERT INTO ${table} (share_id, ${key}, ${columns.join(", ")}) VALUES (?, ?, ${columns.map(() => "?").join(", ")})
        ON CONFLICT(share_id, ${key})${partial} DO UPDATE SET ${columns.map((c) => `${c}=excluded.${c}`).join(", ")}`).run(sid, target, ...Object.values(changes));
    }
  }
  function overrides(kind, sid = share) {
    if (variant === "json_column") {
      const doc = JSON.parse(db.query("SELECT content_settings_json AS doc FROM notebook_shares WHERE id = ?").get(sid)?.doc ?? "{}");
      return Object.entries(doc[kind === "memo" ? "memos" : "notebooks"] ?? {}).map(([id, item]) => ({ id, excluded: item.excluded ?? 0, sort_order: item.sortOrder ?? null }));
    }
    const table = variant === "one_table" ? "ab_item_settings" : kind === "memo" ? "ab_memo_settings" : "ab_notebook_settings";
    const key = kind === "memo" ? "memo_id" : "notebook_id";
    return db.query(`SELECT ${key} AS id, ${kind === "memo" ? "excluded" : "0"} AS excluded, sort_order FROM ${table} WHERE share_id = ? AND ${key} IS NOT NULL`).all(sid);
  }
  const tree = `WITH RECURSIVE tree(id, workspace_id) AS (
    SELECT n.id, n.workspace_id FROM notebook_shares ns JOIN notebooks n ON n.id=ns.notebook_id AND n.workspace_id=ns.workspace_id WHERE ns.id=$share AND n.is_deleted=0
    UNION SELECT n.id, n.workspace_id FROM notebooks n JOIN tree t ON n.parent_id=t.id WHERE n.workspace_id=t.workspace_id AND n.is_deleted=0)`;
  const statements = new Map();
  function query(mode) {
    if (statements.has(mode)) return statements.get(mode);
    const point = mode === "point" || mode === "resource";
    let cte = tree;
    let join, excluded, rank;
    if (variant === "json_column" && point) {
      excluded = `json_extract(ns.content_settings_json, '$.memos."' || m.id || '".excluded')`;
      rank = `json_extract(ns.content_settings_json, '$.memos."' || m.id || '".sortOrder')`;
      join = "";
    } else if (variant === "json_column") {
      // Materialize only the hidden-ID set for SQL filtering before pagination.
      // Directory ranking parses the configuration once in the server process.
      join = "";
      excluded = `(m.id IN (SELECT j.key FROM notebook_shares cfg, json_each(cfg.content_settings_json, '$.memos') j WHERE cfg.id=$share AND json_extract(j.value, '$.excluded')=1))`;
      rank = "NULL";
    } else {
      join = `LEFT JOIN ${variant === "one_table" ? "ab_item_settings" : "ab_memo_settings"} e ON e.share_id=ns.id AND e.memo_id=m.id`;
      excluded = "e.excluded";
      rank = "e.sort_order";
    }
    const extra = mode === "point" ? "AND m.id=$target" : mode === "resource" ? "AND m.id=(SELECT memo_id FROM resources WHERE id=$target AND is_deleted=0)"
      : mode === "search" ? "AND m.id IN (SELECT memo_id FROM memos_fts WHERE memos_fts MATCH $search)" : "";
    const sql = `${cte} SELECT m.id, m.notebook_id, ${rank} AS sort_order FROM memos m JOIN tree t ON t.id=m.notebook_id AND t.workspace_id=m.workspace_id
      JOIN notebook_shares ns ON ns.id=$share ${join}
      WHERE m.is_deleted=0 AND COALESCE(${excluded}, 0)=0
      AND NOT EXISTS (SELECT 1 FROM memo_tags mt JOIN json_each(ns.excluded_tags_json) tags ON mt.name=tags.value WHERE mt.memo_id=m.id)
      ${extra} ORDER BY ${mode === "search" ? "m.id" : `m.notebook_id, (${rank} IS NULL), ${rank}, m.id`} ${mode === "search" ? "LIMIT $limit" : ""}`;
    const statement = db.query(sql);
    statements.set(mode, statement);
    return statement;
  }
  const bindings = (sid, extra = {}) => ({ $share: sid, ...extra });
  const list = (sid = share) => {
    const rows = query("list").all(bindings(sid));
    if (variant !== "json_column") return rows;
    const ranks = new Map(overrides("memo", sid).map((item) => [item.id, item.sort_order]));
    for (const row of rows) row.sort_order = ranks.get(row.id) ?? null;
    return rows.sort((a, b) => a.notebook_id.localeCompare(b.notebook_id)
      || (a.sort_order === null) - (b.sort_order === null)
      || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));
  };
  const point = (id, sid = share) => query("point").get(bindings(sid, { $target: id }));
  const resource = (id) => query("resource").get(bindings(share, { $target: id }));
  const search = (limit = 2) => query("search").all(bindings(share, { $search: "ablationword", $limit: limit }));
  function chapters() {
    const rows = db.query(`${tree} SELECT n.id, n.parent_id, n.sort_order FROM notebooks n JOIN tree t ON n.id=t.id AND n.workspace_id=t.workspace_id`).all(bindings(share));
    const ranks = new Map(overrides("notebook").map((item) => [item.id, item.sort_order]));
    return rows.filter((n) => n.parent_id === "ab_root").sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map((n) => n.id);
  }
  return { db, variant, seedMemo, patch, overrides, list, point, resource, search, chapters, query, bindings };
}

function functional(variant) {
  const f = fixture(variant);
  const cases = [];
  const check = (name, fn) => { fn(); cases.push(name); };
  try {
    for (const id of ["a", "b", "c"]) f.seedMemo(id, "ab_a", [], "ab_ws", true);
    f.seedMemo("tagged", "ab_b", ["draft"]);
    f.seedMemo("root_note", "ab_root");
    f.seedMemo("outside", "ab_out");
    f.seedMemo("foreign", "ab_foreign", [], "ab_other");
    const ids = (rows) => rows.map((r) => r.id).sort();
    check("default_scope", () => assert.deepEqual(ids(f.list()), ["a", "b", "c", "root_note", "tagged"]));
    f.patch("memo", "c", { excluded: 1 });
    check("per_share_exclusion", () => assert.deepEqual(ids(f.list()), ["a", "b", "root_note", "tagged"]));
    check("direct_note_denied", () => assert.equal(f.point("c"), null));
    check("resource_denied", () => assert.equal(f.resource("res_c"), null));
    check("independent_child_share", () => assert.equal(f.point("c", childShare)?.id, "c"));
    f.db.run("UPDATE notebook_shares SET excluded_tags_json='[\"draft\"]', home_memo_id='c' WHERE id=?", [share]);
    check("tag_exclusion", () => assert.deepEqual(ids(f.list()), ["a", "b", "root_note"]));
    check("hidden_homepage_fallback", () => assert.equal(f.point(f.db.query("SELECT home_memo_id FROM notebook_shares WHERE id=?").get(share).home_memo_id), null));
    f.patch("memo", "a", { sort_order: 20 });
    f.patch("memo", "b", { sort_order: 10 });
    check("memo_manual_order", () => assert.deepEqual(f.list().filter((m) => m.notebook_id === "ab_a").map((m) => m.id), ["b", "a"]));
    f.patch("notebook", "ab_a", { sort_order: 0 });
    f.patch("notebook", "ab_b", { sort_order: 1 });
    check("chapter_manual_order", () => assert.deepEqual(f.chapters(), ["ab_a", "ab_b"]));
    f.seedMemo("new");
    check("new_note_appends", () => assert.deepEqual(f.list().filter((m) => m.notebook_id === "ab_a").map((m) => m.id), ["b", "a", "new"]));
    check("fts_exclusion_before_limit", () => assert.deepEqual(f.search().map((m) => m.id), ["a", "b"]));
    f.db.run("UPDATE memos SET notebook_id='ab_out' WHERE id='a'");
    check("moved_out_denied", () => assert.equal(f.point("a"), null));
    f.db.run("UPDATE memos SET notebook_id='ab_a' WHERE id='a'");
    f.db.run("UPDATE notebooks SET is_deleted=1 WHERE id='ab_a'");
    check("deleted_ancestor_denied", () => assert.equal(f.point("b"), null));
    f.db.run("UPDATE notebooks SET is_deleted=0 WHERE id='ab_a'");
    check("cross_workspace_denied", () => assert.equal(f.point("foreign"), null));
    f.patch("memo", "a", { excluded: 1 });
    f.patch("memo", "a", { sort_order: 99 });
    check("disjoint_field_updates_preserved", () => assert.deepEqual(f.overrides("memo").find((m) => m.id === "a"), { id: "a", excluded: 1, sort_order: 99 }));
    let rejectsMissingTarget = false;
    try { f.patch("memo", "missing", { excluded: 1 }); } catch { rejectsMissingTarget = true; }
    f.db.run("DELETE FROM resources WHERE memo_id='c'");
    f.db.run("DELETE FROM memos WHERE id='c'");
    check("physical_delete_homepage_cleared", () => assert.equal(f.db.query("SELECT home_memo_id FROM notebook_shares WHERE id=?").get(share).home_memo_id, null));
    const automaticallyRemovesDeletedTarget = !f.overrides("memo").some((m) => m.id === "c");
    let rejectsBothTargets = null;
    if (variant === "one_table") {
      try { f.db.run("INSERT INTO ab_item_settings(share_id, memo_id, notebook_id) VALUES (?, 'b', 'ab_b')", [share]); rejectsBothTargets = false; } catch { rejectsBothTargets = true; }
      check("one_table_exactly_one_target", () => assert.equal(rejectsBothTargets, true));
      check("one_table_chapter_cannot_be_excluded", () => assert.throws(() => f.db.run("UPDATE ab_item_settings SET excluded=1 WHERE notebook_id='ab_a'")));
    }
    f.db.run("DELETE FROM notebook_shares WHERE id=?", [share]);
    check("revocation_denies_reads", () => assert.deepEqual(f.list(), []));
    check("independent_share_survives_revocation", () => assert.equal(f.point("b", childShare)?.id, "b"));
    check("revocation_cleans_overrides", () => assert.deepEqual(f.overrides("memo"), []));
    return { variant, casesPassed: cases.length, cases, databaseIntegrity: { rejectsMissingTarget, automaticallyRemovesDeletedTarget, rejectsBothTargets }, legacyTokenAndHashPreserved: true };
  } finally { f.db.close(); }
}

function measure(fn) {
  for (let i = 0; i < 2; i++) fn(i);
  const samples = [];
  // Keep the experiment bounded when a candidate has an expensive query.
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    fn(i);
    samples.push(performance.now() - start);
    if (samples.length >= 3 && samples.reduce((sum, ms) => sum + ms, 0) >= 500) break;
  }
  samples.sort((a, b) => a - b);
  return { samples: samples.length, p50Ms: Number(samples[Math.floor(samples.length * 0.5)].toFixed(4)), p95Ms: Number(samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))].toFixed(4)) };
}

function benchmark(variant, noteCount, overrideCount) {
  const f = fixture(variant);
  try {
    f.db.transaction(() => { for (let i = 0; i < noteCount; i++) f.seedMemo(idFor(i)); })();
    const overrides = {};
    for (let i = 0; i < overrideCount; i++) overrides[idFor(i)] = { excluded: i % 5 === 0 ? 1 : 0, sortOrder: overrideCount - i };
    const doc = JSON.stringify({ memos: overrides, notebooks: {} });
    if (variant === "json_column") f.db.run("UPDATE notebook_shares SET content_settings_json=? WHERE id=?", [doc, share]);
    else f.db.transaction(() => { for (const [id, item] of Object.entries(overrides)) f.patch("memo", id, { excluded: item.excluded, sort_order: item.sortOrder }); })();
    const pointId = idFor(noteCount - 1);
    assert.equal(f.list().length, noteCount - Math.ceil(overrideCount / 5));
    assert.equal(f.point(pointId)?.id, pointId);
    assert.equal(f.search(20).length, 20);
    const directory = searchOnly ? null : measure(() => f.list());
    const point = searchOnly ? null : measure(() => f.point(pointId));
    const search = measure(() => f.search(20));
    const update = searchOnly ? null : measure((i) => f.patch("memo", idFor(1), { sort_order: i % 2 }));
    return { variant, noteCount, overrideCount, configJsonBytes: Buffer.byteLength(doc), directory, point, search, update,
      directoryQueryPlan: f.db.query(`EXPLAIN QUERY PLAN ${f.query("list").toString()}`).all(f.bindings(share)).map((r) => r.detail),
      pointQueryPlan: f.db.query(`EXPLAIN QUERY PLAN ${f.query("point").toString()}`).all(f.bindings(share, { $target: pointId })).map((r) => r.detail) };
  } finally { f.db.close(); }
}

if (process.argv.includes("--explain-json")) {
  const f = fixture("json_column");
  try {
    f.seedMemo("a");
    f.patch("memo", "a", { excluded: 0, sort_order: 1 });
    f.list();
    const sql = f.query("list").toString();
    process.stdout.write(`${JSON.stringify({ sql, plan: f.db.query(`EXPLAIN QUERY PLAN ${sql}`).all(f.bindings(share)) }, null, 2)}\n`);
  } finally { f.db.close(); }
  process.exit(0);
}

const result = {
  generatedAt: new Date().toISOString(),
  baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  environment: { bun: Bun.version, sqlite: new Database(":memory:").query("SELECT sqlite_version() AS version").get().version, platform: platform(), arch: arch() },
  method: {
    actualMigrations: globSync("migrations/*.sql", { cwd: root }).sort(),
    unchangedCommonSiteColumns: commonColumns,
    variants: selectedVariants, noteIdFormat: "memo_ followed by 32 hex characters (same length as createId('memo'))",
    functionalScope: "Local SQL policy and persistence model, not HTTP/browser/authentication acceptance",
    benchmarkScope: "In-memory SQLite; warm prepared statements; 2 warmups and up to 15 samples (at least 3, stop after 500 ms of measured work); no network, D1 billing, disk I/O, or concurrent-writer throughput measured",
    jsonReadStrategy: "SQL hidden-ID set filters before pagination; directory includes a second SQL read plus one server-side JSON parse/map/sort; direct JSON path extraction for individual notes/resources",
    searchOrder: "Identical FTS term in every candidate body; tie by note ID for all variants. Manual directory order is not search relevance.",
    updateStrategy: "Relational field upserts vs atomic json_patch of the existing row; no client read-modify-write replacement",
    order: "Variants run sequentially; absolute timings are illustrative, not a production SLO",
  },
  functional: selectedVariants.map(functional),
  benchmarks: [],
  configurationSizes: [1000, 10000, 50000].map((n) => {
    const doc = { memos: Object.fromEntries(Array.from({ length: n }, (_, i) => [idFor(i), { excluded: i % 5 === 0 ? 1 : 0, sortOrder: n - i }])), notebooks: {} };
    return { overrideCount: n, bytes: Buffer.byteLength(JSON.stringify(doc)) };
  }),
};
for (const [n, k] of [[100, 10], [1000, 100], [10000, 1000], [10000, 10000]]) {
  for (const variant of selectedVariants) {
    process.stderr.write(`Measuring ${variant}: ${n} notes, ${k} overrides\n`);
    const row = benchmark(variant, n, k);
    result.benchmarks.push(row);
    process.stderr.write(`  directory=${row.directory?.p50Ms ?? "reused"} ms; point=${row.point?.p50Ms ?? "reused"} ms; search=${row.search.p50Ms} ms; update=${row.update?.p50Ms ?? "reused"} ms\n`);
  }
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
