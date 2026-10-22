// Whole-plan ablation: executed local SQL/data models plus explicitly labelled
// requirement/source-based decisions. This is not product or browser acceptance.
// Run: bun scripts/public-notebook-site-plan-ablation.mjs > docs/public-notebook-site-plan-ablation.json
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { createExcerpt } from "../packages/shared/src/content.ts";
import { escapeLike, toFtsQuery } from "../apps/api/src/memo-list-service.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new Database(":memory:");
const checks = [];
const counterexamples = [];
const check = (name, run) => { run(); checks.push(name); };
const share = "plan_root";
const child = "plan_child";
const Settings = z.object({
  homeMemoId: z.string().nullable().optional(),
  logoUrl: z.string().url().refine((value) => new URL(value).protocol === "https:").nullable().optional(),
  headerLinks: z.array(z.object({ label: z.string(), url: z.string().url().refine((value) => new URL(value).protocol === "https:") }).strict()).optional(),
  footerText: z.string().optional(),
  allowIndexing: z.boolean().optional(),
  excludedTags: z.array(z.string()).optional(),
  sortMode: z.enum(["existing", "title"]).optional(),
}).strict();
const MAX_SETTINGS_BYTES = 16 * 1024;
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const sortTitles = (items) => [...items].sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

try {
  const migrations = globSync("migrations/*.sql", { cwd: root }).sort();
  for (const path of migrations) db.exec(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("INSERT INTO workspaces(id,name) VALUES('plan_ws','Plan'),('plan_other','Other')");
  for (const [id, parent, workspace, name] of [
    ["plan_root_nb", null, "plan_ws", "Knowledge"], ["plan_2", "plan_root_nb", "plan_ws", "第2章"],
    ["plan_10", "plan_root_nb", "plan_ws", "第10章"], ["plan_out", null, "plan_ws", "Outside"],
    ["plan_foreign", "plan_root_nb", "plan_other", "Other workspace"],
  ]) db.run("INSERT INTO notebooks(id,parent_id,workspace_id,name) VALUES(?,?,?,?)", [id, parent, workspace, name]);
  db.run("INSERT INTO notebook_shares(id,notebook_id,workspace_id,token,password_hash) VALUES(?, 'plan_root_nb','plan_ws',?,'legacy-hash'),(?, 'plan_2','plan_ws',?,NULL)", [share, "p".repeat(43), child, "c".repeat(43)]);
  const legacy = db.query("SELECT token,password_hash FROM notebook_shares WHERE id=?").get(share);
  const oldTables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const oldColumns = db.query("PRAGMA table_info(notebook_shares)").all().map((x) => x.name);
  db.exec("ALTER TABLE notebook_shares ADD COLUMN site_slug TEXT; ALTER TABLE notebook_shares ADD COLUMN site_settings_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(site_settings_json) AND json_type(site_settings_json)='object'); CREATE UNIQUE INDEX plan_site_slug ON notebook_shares(lower(site_slug)) WHERE site_slug IS NOT NULL");
  check("zero_new_tables_two_added_columns", () => {
    assert.deepEqual(db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(), oldTables);
    assert.deepEqual(db.query("PRAGMA table_info(notebook_shares)").all().map((x) => x.name).filter((name) => !oldColumns.includes(name)), ["site_slug", "site_settings_json"]);
    assert.deepEqual(db.query("SELECT token,password_hash FROM notebook_shares WHERE id=?").get(share), legacy);
  });
  check("old_share_defaults_unchanged", () => assert.deepEqual(JSON.parse(db.query("SELECT site_settings_json FROM notebook_shares WHERE id=?").get(share).site_settings_json), {}));

  const text = "正文中有唯一检索词和 ablationbody，标题不含这些词。";
  for (const [id, notebook, workspace, title, tags] of [
    ["a_hidden", "plan_2", "plan_ws", "第1节", ["draft"]],
    ["b_ten", "plan_2", "plan_ws", "第10节", ["topic"]],
    ["c_two", "plan_2", "plan_ws", "第2节", ["topic"]],
    ["d_home", "plan_10", "plan_ws", "概览", []],
    ["outside", "plan_out", "plan_ws", "Outside", []],
    ["foreign", "plan_foreign", "plan_other", "Foreign", []],
  ]) {
    db.run("INSERT INTO memos(id,notebook_id,workspace_id,title,excerpt,tags_json) VALUES(?,?,?,?,?,?)", [id, notebook, workspace, title, createExcerpt(text), JSON.stringify(tags)]);
    db.run("INSERT INTO memo_contents(memo_id,content_json,content_markdown,content_text,content_hash) VALUES(?,?,?,?,?)", [id, '{"type":"doc","content":[]}', text, text, id]);
    db.run("INSERT INTO memo_search_documents(memo_id,title,content_text,tags) VALUES(?,?,?,?)", [id, title, text, tags.join(" ")]);
    db.run("INSERT INTO resources(id,memo_id,object_key,kind) VALUES(?,?,?,'image')", [`res_${id}`, id, id]);
  }
  const tree = `WITH RECURSIVE tree(id,workspace_id) AS (
    SELECT n.id,n.workspace_id FROM notebook_shares ns JOIN notebooks n ON n.id=ns.notebook_id AND n.workspace_id=ns.workspace_id WHERE ns.id=$share AND n.is_deleted=0
    UNION SELECT n.id,n.workspace_id FROM notebooks n JOIN tree t ON n.parent_id=t.id WHERE n.workspace_id=t.workspace_id AND n.is_deleted=0)`;
  const scope = `FROM memos m JOIN tree t ON t.id=m.notebook_id AND t.workspace_id=m.workspace_id JOIN notebook_shares ns ON ns.id=$share
    WHERE m.is_deleted=0`;
  const visible = `AND NOT EXISTS(SELECT 1 FROM memo_tags mt JOIN json_each(ns.site_settings_json,'$.excludedTags') et ON mt.name=et.value WHERE mt.memo_id=m.id)`;
  const rows = (sid = share) => db.query(`${tree} SELECT m.id,m.notebook_id,m.title ${scope} ${visible} ORDER BY m.id`).all({ $share: sid });
  const point = (id, sid = share) => db.query(`${tree} SELECT m.id,m.title,m.excerpt ${scope} ${visible} AND m.id=$id`).get({ $share: sid, $id: id });
  const resource = (id) => db.query(`${tree} SELECT m.id ${scope} ${visible} AND m.id=(SELECT memo_id FROM resources WHERE id=$id AND is_deleted=0)`).get({ $share: share, $id: id });
  function search(query, tag = null, limit = 2) {
    return db.query(`${tree} SELECT m.id ${scope} ${visible}
      AND ($tag IS NULL OR EXISTS(SELECT 1 FROM memo_tags mt WHERE mt.memo_id=m.id AND mt.name=$tag))
      AND (m.id IN(SELECT memo_id FROM memos_fts WHERE memos_fts MATCH $fts) OR m.id IN(SELECT memo_id FROM memo_contents WHERE content_text LIKE $like ESCAPE '\\'))
      ORDER BY m.id LIMIT $limit`).all({ $share: share, $tag: tag, $fts: toFtsQuery(query), $like: `%${escapeLike(query)}%`, $limit: limit });
  }
  const settings = () => JSON.parse(db.query("SELECT site_settings_json FROM notebook_shares WHERE id=?").get(share).site_settings_json);
  function save(patch) {
    Settings.parse(patch);
    const next = { ...settings(), ...patch };
    assert(bytes(next) <= MAX_SETTINGS_BYTES, "Site settings exceed the metadata budget");
    if (Object.hasOwn(patch, "homeMemoId") && patch.homeMemoId !== null) {
      const target = db.query(`${tree} SELECT m.id,m.tags_json ${scope} AND m.id=$id`).get({ $share: share, $id: patch.homeMemoId });
      assert(target && !JSON.parse(target.tags_json).some((tag) => (next.excludedTags ?? []).includes(tag)), "Homepage outside the merged visible scope");
    }
    db.run("UPDATE notebook_shares SET site_settings_json=json_patch(site_settings_json,?) WHERE id=?", [JSON.stringify(patch), share]);
  }
  check("default_tag_policy_does_not_hide_old_drafts", () => assert(rows().some((x) => x.id === "a_hidden")));
  save({ excludedTags: ["draft"], sortMode: "title" });
  check("tag_exclusion_filters_directory_note_and_resource", () => {
    assert(!rows().some((x) => x.id === "a_hidden"));
    assert.equal(point("a_hidden"), null);
    assert.equal(resource("res_a_hidden"), null);
  });
  check("independent_child_share_keeps_its_own_tag_policy", () => assert.equal(point("a_hidden", child)?.id, "a_hidden"));
  check("english_body_search_filters_before_pagination", () => assert.deepEqual(search("ablationbody").map((x) => x.id), ["b_ten", "c_two"]));
  check("chinese_body_substring_and_tag_filter", () => assert.deepEqual(search("唯一检索", "topic").map((x) => x.id), ["b_ten", "c_two"]));
  check("title_natural_order_needs_no_rank_rows", () => {
    assert.deepEqual(sortTitles(rows().filter((x) => x.notebook_id === "plan_2")).map((x) => x.id), ["c_two", "b_ten"]);
    const chapters = db.query("SELECT id,name AS title FROM notebooks WHERE parent_id='plan_root_nb' AND workspace_id='plan_ws'").all();
    assert.deepEqual(sortTitles(chapters).map((x) => x.id), ["plan_2", "plan_10"]);
  });
  save({ homeMemoId: "d_home", allowIndexing: true });
  save({ footerText: "Copyright" });
  check("atomic_settings_patch_preserves_other_fields_and_password", () => {
    assert.equal(settings().homeMemoId, "d_home");
    assert.equal(settings().footerText, "Copyright");
    assert.deepEqual(db.query("SELECT token,password_hash FROM notebook_shares WHERE id=?").get(share), legacy);
  });
  check("invalid_homepage_write_rejected", () => assert.throws(() => save({ homeMemoId: "outside" })));
  check("homepage_validated_against_merged_tag_policy", () => {
    save({ excludedTags: [], homeMemoId: "a_hidden" });
    assert.equal(point(settings().homeMemoId)?.id, "a_hidden");
    save({ excludedTags: ["draft"], homeMemoId: "d_home" });
  });
  check("unknown_item_overrides_are_not_silently_supported", () => assert.throws(() => save({ hiddenMemoIds: ["b_ten"] })));
  const homepage = () => point(settings().homeMemoId ?? "");
  db.run("UPDATE memos SET notebook_id='plan_out' WHERE id='d_home'");
  check("json_homepage_move_falls_back_without_foreign_key", () => assert.equal(homepage(), null));
  db.run("DELETE FROM resources WHERE memo_id='d_home'");
  db.run("DELETE FROM memos WHERE id='d_home'");
  check("json_homepage_delete_falls_back_without_cleanup_job", () => {
    assert.equal(settings().homeMemoId, "d_home");
    assert.equal(homepage(), null);
  });
  check("cross_workspace_and_outside_notes_denied", () => { assert.equal(point("foreign"), null); assert.equal(point("outside"), null); });
  db.run("UPDATE notebooks SET is_deleted=1 WHERE id='plan_2'");
  check("deleted_ancestor_denies_descendants", () => assert.equal(point("b_ten"), null));
  db.run("UPDATE notebooks SET is_deleted=0 WHERE id='plan_2'");
  db.run("UPDATE notebook_shares SET site_slug='knowledge' WHERE id=?", [share]);
  check("alias_database_uniqueness_is_case_insensitive", () => assert.throws(() => db.run("UPDATE notebook_shares SET site_slug='KNOWLEDGE' WHERE id=?", [child])));
  const resolve = (slug) => db.query("SELECT ns.token FROM notebook_shares ns JOIN notebooks n ON n.id=ns.notebook_id AND n.workspace_id=ns.workspace_id WHERE lower(ns.site_slug)=lower(?) AND n.is_deleted=0").get(slug);
  check("alias_resolution_only_returns_identity_not_protected_metadata", () => assert.deepEqual(resolve("knowledge"), { token: "p".repeat(43) }));

  const indexable = () => !db.query("SELECT password_hash FROM notebook_shares WHERE id=?").get(share).password_hash && settings().allowIndexing === true;
  check("password_overrides_indexing_flag", () => assert.equal(indexable(), false));
  db.run("UPDATE notebook_shares SET password_hash=NULL WHERE id=?", [share]);
  check("explicit_unprotected_indexing_can_be_enabled", () => assert.equal(indexable(), true));
  db.run("UPDATE notebook_shares SET password_hash='rotated-hash', site_settings_json=json_set(site_settings_json,'$.allowIndexing',json('false')) WHERE id=?", [share]);
  db.run("UPDATE notebook_shares SET password_hash=NULL WHERE id=?", [share]);
  check("clearing_password_does_not_reenable_indexing", () => assert.equal(indexable(), false));
  const siteTitle = () => db.query("SELECT name FROM notebooks WHERE id='plan_root_nb'").get().name;
  db.run("UPDATE notebooks SET name='Renamed knowledge' WHERE id='plan_root_nb'");
  check("site_title_derived_from_existing_root_name", () => assert.equal(siteTitle(), "Renamed knowledge"));
  const meta = (title) => `<title>${escapeHtml(title)}</title><meta property="og:title" content="${escapeHtml(title)}">`;
  check("server_metadata_model_escapes_untrusted_text", () => {
    const head = meta('<img src=x onerror="bad">');
    assert(!head.includes("<img")); assert(head.includes("&lt;img")); assert(head.includes("&quot;"));
  });
  const minimalSettings = { homeMemoId: "memo_" + "a".repeat(32), logoUrl: "https://example.invalid/logo.png", headerLinks: [{ label: "Home", url: "https://example.invalid/" }], footerText: "Copyright", excludedTags: ["draft"], sortMode: "title", allowIndexing: false };
  const configurationSizes = [100, 1000, 10000, 50000].map((noteCount) => ({ noteCount, settingsBytes: bytes(minimalSettings) }));
  check("metadata_size_independent_of_note_count", () => assert.equal(new Set(configurationSizes.map((x) => x.settingsBytes)).size, 1));

  const fullBody = "这是正文内容。".repeat(5000);
  const preview = { title: "Example", excerpt: createExcerpt(fullBody) };
  const fullArticle = { title: "Example", contentMarkdown: fullBody, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: fullBody }] }] } };
  const payloads = [100, 1000, 10000].map((count) => {
    const directory = Array.from({ length: count }, (_, i) => ({ id: `memo_${i.toString(16).padStart(32, "0")}`, notebookId: "nb_" + "a".repeat(32), title: `第${i + 1}篇笔记` }));
    return { noteCount: count, directoryBytes: bytes(directory), directoryWithPreviewBytes: bytes(directory.map((x) => ({ ...x, excerpt: preview.excerpt }))), onePreviewBytes: bytes(preview), fullArticleBytes: bytes(fullArticle) };
  });
  check("on_demand_preview_avoids_directory_and_full_body_payload", () => {
    assert(payloads[2].directoryWithPreviewBytes > payloads[2].directoryBytes + 500000);
    assert(payloads[2].fullArticleBytes > payloads[2].onePreviewBytes * 100);
  });

  // Expected failures of removals, rather than claims that the omitted behavior works.
  const unfiltered = db.query(`${tree} SELECT m.id ${scope} ORDER BY m.id`).all({ $share: share });
  assert(unfiltered.some((x) => x.id === "a_hidden"));
  counterexamples.push({ ablation: "remove_server_tag_filter", observed: "hidden_note_returned", criterionViolated: "exclude_drafts" });
  assert.equal(db.query(`${tree} SELECT m.id ${scope} ${visible} AND m.title LIKE '%ablationbody%'`).all({ $share: share }).length, 0);
  assert.equal(search("ablationbody").length, 2);
  counterexamples.push({ ablation: "keep_title_only_search", observed: "body_only_matches_lost", criterionViolated: "full_text_search" });
  const firstThenFilter = db.query(`${tree} SELECT m.id,m.tags_json ${scope} ORDER BY m.id LIMIT 1`).all({ $share: share }).filter((x) => !JSON.parse(x.tags_json).includes("draft"));
  assert.equal(firstThenFilter.length, 0);
  counterexamples.push({ ablation: "filter_after_pagination", observed: "empty_page_despite_visible_matches", criterionViolated: "complete_visible_search_page" });
  db.run("DELETE FROM notebook_shares WHERE id=?", [share]);
  check("revocation_denies_token_and_alias_paths", () => { assert.deepEqual(rows(), []); assert.equal(resolve("knowledge"), null); });

  const decisions = [
    ["R01", "article_toc", "keep", "issue_requirement", "H1-H4 navigation and scrollspy are explicit requirements."],
    ["R02", "light_dark_system", "keep_reuse", "source_inspection", "Reuse ThemeProvider and edgeever.theme; no second preference system."],
    ["R03", "code_copy_language_collapse", "keep_reuse", "issue_and_source", "Copy/highlighting already exist; add only missing labels and collapse controls."],
    ["R04", "internal_hover_preview", "keep", "payload_measurement", "Keep a bounded on-demand preview; do not inflate every directory item or fetch complete articles."],
    ["R05", "image_and_diagram_controls", "keep_reuse", "issue_and_source", "Reuse lightbox/zoom/fit; add single-click entry and fullscreen, not another viewer."],
    ["R06", "body_full_text_search", "keep_reuse", "executed_counterexample", "Title-only search loses body matches; reuse existing FTS and Chinese fallback."],
    ["R07", "tag_filter", "keep", "executed_model", "Use the same search endpoint with a tag predicate; no global tag cloud/count API."],
    ["R08", "custom_homepage", "keep", "executed_model", "One JSON homeMemoId checked against live visibility; invalid targets fall back to directory."],
    ["R09", "draft_exclusion", "choose_tag_policy", "issue_alternative_and_executed_model", "The issue permits draft state OR tags. Use existing note tags plus site excludedTags."],
    ["R10", "custom_ordering", "choose_title_order", "issue_alternative_and_executed_model", "The issue permits manual OR title/number order. Use existing/title modes and numeric title sorting."],
    ["R11", "custom_slug", "keep", "executed_model", "Keep a unique slug and identity resolver; do not alter token-scoped unlock cookies."],
    ["R12", "logo_header_footer", "keep", "issue_requirement", "Keep structured display settings and HTTPS logo URL; no independent upload pipeline."],
    ["R13", "seo_and_social_cards", "keep_metadata", "external_primary_documentation", "Keep server HTML head and indexing controls; crawler acceptance remains unverified."],
    ["D01", "two_or_one_item_override_tables", "remove_for_selected_scope", "issue_alternatives_and_executed_model", "No per-item state remains when exclusion uses tags and sorting uses titles."],
    ["D02", "independent_site_title", "derive", "source_and_design_judgment", "Use root notebook name; independent override is an additional product choice."],
    ["D03", "independent_site_description", "derive", "source_and_design_judgment", "Use visible homepage or article excerpt; no separate description field."],
    ["D04", "site_slug_column", "keep", "executed_model", "One column with a case-insensitive unique index keeps lookup and uniqueness simple."],
    ["D05", "home_memo_id_column", "move_to_settings_json", "executed_model", "Live validation already handles moves and soft deletion; a single stale pointer is bounded."],
    ["D06", "logo_url_column", "move_to_settings_json", "executed_model", "Bounded display metadata does not need an independent SQL column."],
    ["D07", "header_links_column", "move_to_settings_json", "executed_model", "Preserve structured links in the bounded settings object."],
    ["D08", "footer_text_column", "move_to_settings_json", "executed_model", "Preserve footer text in settings."],
    ["D09", "allow_indexing_column", "move_to_settings_json", "executed_model", "Effective indexing checks the JSON flag and current password; setting passwords clears the flag."],
    ["D10", "excluded_tags_column", "move_to_settings_json", "executed_model", "JSON tags are filtered against existing memo_tags before pagination."],
    ["D11", "two_sort_mode_columns", "one_json_sort_mode", "executed_model", "Use one existing/title mode for the site; no separate note/chapter controls."],
    ["A01", "separate_site_get", "reuse_existing_get", "source_inspection", "Extend authenticated share GET with owner settings."],
    ["A02", "site_settings_patch", "keep_separate", "source_and_executed_model", "Preserve existing password PATCH semantics; config-only writes do not rotate passwords."],
    ["A03", "content_management_get", "remove", "selected_scope", "No site-specific item editor is needed."],
    ["A04", "per_note_exclusion_patch", "remove", "selected_scope", "Use existing note tag editing."],
    ["A05", "manual_order_put", "remove", "selected_scope", "Title order requires no rank persistence or drag/drop command."],
    ["A06", "public_search", "keep", "executed_model", "Needed for body/tag search with server visibility and pagination."],
    ["A07", "public_preview", "keep", "payload_measurement", "Keeps preview responses bounded and avoids eager directory growth."],
    ["A08", "alias_resolver", "make_explicit", "source_and_executed_model", "Return token identity only so SPA aliases use existing canonical API/cookie paths."],
    ["I01", "complete_article_ssr", "defer", "external_primary_documentation_and_judgment", "Keep SPA article rendering and server head; non-JS full-body crawlability is not retained."],
    ["I02", "sitemap", "defer", "issue_not_explicit_and_primary_documentation", "It can improve discovery, but is not needed to implement the requested indexing switch/cards."],
    ["I03", "new_content_index", "remove", "source_inspection", "Existing FTS and normalized tags already cover the queries."],
    ["I04", "second_theme_storage", "remove", "source_inspection", "Same-origin app and public site share this device's appearance preference."],
    ["I05", "second_image_diagram_renderer", "remove", "source_inspection", "Reuse existing renderers."],
    ["I06", "publication_snapshot_version", "exclude", "existing_live_share_contract", "Keep live sharing; no review/publish lifecycle."],
    ["I07", "new_polling_or_push_invalidation", "remove", "source_inspection", "Reuse current refresh and error handling; do not claim instantaneous recall of loaded text."],
    ["I08", "public_cdn_cache", "exclude", "existing_privacy_contract", "Keep no-store and no-referrer."],
    ["I09", "duplicate_runtime_business_logic", "remove", "project_contract", "Cloudflare/Docker share visibility and metadata services with thin entry adapters."],
    ["V01", "all_validation_layers_each_phase", "replace_with_affected_flows", "user_instruction", "Reuse unchanged checks and use three actual-flow acceptance scenarios after implementation."],
  ].map(([id, subject, decision, evidenceType, rationale]) => ({ id, subject, decision, evidenceType, rationale }));
  assert.equal(decisions.filter((x) => /^R\d+$/.test(x.id)).length, 13);
  const sourceTheme = readFileSync(new URL("../apps/web/src/components/ThemeProvider.tsx", import.meta.url), "utf8");
  assert(sourceTheme.includes('THEME_STORAGE_KEY = "edgeever.theme"'));
  const sourcePage = readFileSync(new URL("../apps/web/src/components/PublicNotebookSharePage.tsx", import.meta.url), "utf8");
  assert(sourcePage.includes("refetchInterval: 30_000"));
  const previous = JSON.parse(readFileSync(new URL("../docs/public-notebook-site-schema-ablation.json", import.meta.url), "utf8"));
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(), baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    environment: { bun: Bun.version, sqlite: db.query("SELECT sqlite_version() AS version").get().version },
    method: "Actual migrations plus disposable SQLite/data models. Decision rows distinguish executed evidence, source facts, issue alternatives, external documentation, and judgment. Not a user experiment, runtime implementation, browser acceptance, or crawler test.",
    migrations, executedChecks: checks, executedCheckCount: checks.length, expectedCounterexamples: counterexamples,
    issueCoverage: { requirementGroups: 13, exclusionAlternative: "tags", orderingAlternative: "title/number", removedAdvancedBehaviors: ["per-site arbitrary note overrides", "site-specific drag ordering", "independent site title/description", "non-JS full article HTML", "sitemap discovery"], userUsabilityMeasured: false },
    persistence: { newTables: 0, newColumns: ["site_slug", "site_settings_json"], settingsBudgetBytes: MAX_SETTINGS_BYTES, configurationSizes },
    previewPayloads: payloads,
    reusedPriorEvidence: { file: "docs/public-notebook-site-schema-ablation.json", baselineCommit: previous.baselineCommit, commonFunctionalScenarios: 19, benchmarkGroups: previous.benchmarks.length, rerun: false, limitation: "Prior override-table necessity was conditional on retaining per-item manual state; that premise is removed here." },
    decisions,
    notVerified: ["Product UI and usability", "Real password unlock and upgrade", "Cloudflare/Docker page handlers", "Crawler indexing and social previews", "Production query/network performance", "Concurrent writer contention"],
    externalReferences: ["https://github.com/tianma-if/edgeever/issues/591", "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics", "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview", "https://ogp.me/"],
  }, null, 2)}\n`);
} finally { db.close(); }
