import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter";
import {
  registerNotebookShareRoutes,
  registerPublicNotebookShareRoutes,
} from "./notebook-share-routes";
import { hashPassword } from "./auth-crypto";
import { registerPublicShareRoutes } from "./share-routes";
import { renderNotebookSitePage } from "./notebook-site-page";
import { PUBLIC_PAGE_ROBOTS } from "@edgeever/shared/public-page-headers";

const databases = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const token = "n".repeat(43);
const individualToken = "s".repeat(43);
const auth = {
  kind: "user",
  actorType: "user",
  actorId: null,
  workspaceId: "ws_test",
  role: "member",
  scopes: [],
  username: "test",
};
const fixture = (legacyHash) => {
  const db = new Database(":memory:");
  databases.push(db);
  // Populate a real pre-feature schema first, then upgrade it in place.
  const migrations = globSync("migrations/*.sql").sort();
  for (const file of migrations.filter(
    (file) => file < "migrations/0067_notebook_shares.sql",
  ))
    db.exec(readFileSync(file, "utf8"));
  db.run(
    "INSERT INTO workspaces (id, name) VALUES ('ws_test', 'Test'), ('ws_other', 'Other')",
  );
  for (const [id, parent, workspace] of [
    ["root", null, "ws_test"],
    ["child", "root", "ws_test"],
    ["grandchild", "child", "ws_test"],
    ["private", null, "ws_test"],
    ["foreign", "root", "ws_other"],
  ]) {
    db.run(
      "INSERT INTO notebooks (id, parent_id, workspace_id, name) VALUES (?, ?, ?, ?)",
      [id, parent, workspace, id],
    );
  }
  const addMemo = (id, notebookId, workspace = "ws_test") => {
    db.run(
      "INSERT INTO memos (id, notebook_id, workspace_id, title) VALUES (?, ?, ?, ?)",
      [id, notebookId, workspace, id],
    );
    db.run(
      "INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_hash) VALUES (?, ?, ?, ?)",
      [id, '{"type":"doc","content":[]}', id, id],
    );
    db.run(
      "INSERT INTO resources (id, memo_id, object_key, kind, mime_type, byte_size) VALUES (?, ?, ?, 'image', 'image/png', 10)",
      [`res_${id}`, id, id],
    );
  };
  addMemo("memo_root", "root");
  addMemo("memo_child", "child");
  addMemo("memo_grand", "grandchild");
  addMemo("memo_private", "private");
  addMemo("memo_other", "foreign", "ws_other");
  db.run(
    "INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES ('individual', 'memo_child', 'ws_test', ?)",
    [individualToken],
  );
  db.exec(readFileSync("migrations/0067_notebook_shares.sql", "utf8"));
  db.run(
    "INSERT INTO notebook_shares (id, notebook_id, workspace_id, token) VALUES ('shared', 'root', 'ws_test', ?)",
    [token],
  );
  db.exec(readFileSync("migrations/0068_notebook_share_passwords.sql", "utf8"));
  if (legacyHash) db.run("UPDATE notebook_shares SET password_hash = ?", [legacyHash]);
  db.exec(readFileSync("migrations/0069_share_password_encryption.sql", "utf8"));
  for (const file of migrations.filter((file) => file > "migrations/0069_share_password_encryption.sql"))
    db.exec(readFileSync(file, "utf8"));
  const environment = {
    EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "test-share-master-key",
    storage: createSelfHostedStorageAdapter(
      db,
      "/tmp/edgeever-notebook-share-unused",
    ),
  };
  let blobReads = 0;
  environment.storage.resources = {
    get: async (_key, options) => {
      blobReads++;
      return {
        body: new Blob([options ? "2345" : "0123456789"]).stream(),
        size: 10,
        range: options?.range,
        writeHttpMetadata: () => {},
      };
    },
  };
  const app = new Hono();
  app.use("/api/v1/*", async (c, next) => {
    if (c.req.header("test-auth") !== "none")
      c.set(
        "auth",
        c.req.header("test-auth") === "agent"
          ? { ...auth, kind: "agent" }
          : auth,
      );
    await next();
  });
  registerPublicNotebookShareRoutes(app);
  registerNotebookShareRoutes(app);
  registerPublicShareRoutes(app);
  const request = (path = "", init = {}) =>
    app.request(
      `/api/public/notebook-shares/${token}${path}`,
      init,
      environment,
    );
  return { db, app, environment, request, addMemo, blobReads: () => blobReads };
};

const manage = (f, path, body, init = {}) => f.app.request(`/api/v1/notebooks/root/share${path}`, {
  method: body === undefined ? "GET" : "PATCH",
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  ...init,
}, f.environment);

describe("public notebook site controls", () => {
  test("old share upgrade preserves scope, token, and password while settings patch is independent", async () => {
    const f = fixture(await hashPassword("old-password"));
    const before = f.db.query("SELECT token, password_hash FROM notebook_shares").get();
    const saved = await manage(f, "/site", { siteSlug: "My-Docs", settings: { footerText: "Example", sortMode: "title" } });
    expect(saved.status).toBe(200);
    expect((await saved.json()).share.siteSlug).toBe("my-docs");
    await manage(f, "/site", { settings: { logoUrl: "https://example.org/logo.png" } });
    const { share } = await (await manage(f, "")).json();
    expect(share.siteSettings.footerText).toBe("Example");
    expect(share.siteSettings.allowIndexing).toBe(false);
    expect(f.db.query("SELECT token, password_hash FROM notebook_shares").get()).toEqual(before);
    expect((await f.request()).status).toBe(403);
    const unlocked = await f.request("/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "old-password" }) });
    const cookie = unlocked.headers.get("set-cookie").split(";")[0];
    const directory = await (await f.request("", { headers: { cookie } })).json();
    expect(directory.share.memos).toHaveLength(3);
  });

  test("exclusion gates every read path, keeps independent shares, and restores idempotently", async () => {
    const f = fixture();
    const child = await f.app.request("/api/v1/notebooks/child/share", { method: "POST" }, f.environment);
    const childToken = (await child.json()).share.token;
    expect((await manage(f, "/memos/memo_child", { excluded: true })).status).toBe(200);
    expect((await manage(f, "/memos/memo_child", { excluded: true })).status).toBe(200);
    const directory = await (await f.request()).json();
    expect(directory.share.memos.map((m) => m.id)).not.toContain("memo_child");
    for (const path of ["/memos/memo_child", "/memos/memo_child/preview", "/resources/res_memo_child/blob"])
      expect((await f.request(path)).status).toBe(404);
    expect(f.blobReads()).toBe(0);
    const search = await (await f.request("/search?q=memo&limit=1")).json();
    expect(search.memos).toHaveLength(1);
    expect(search.memos[0].id).not.toBe("memo_child");
    expect((await f.app.request(`/api/public/notebook-shares/${childToken}/memos/memo_child`, {}, f.environment)).status).toBe(200);
    const excluded = await (await manage(f, "/excluded-memos")).json();
    expect(excluded.memos.map((m) => m.id)).toEqual(["memo_child"]);
    f.db.run("UPDATE memos SET tags_json = '[\"draft\"]' WHERE id = 'memo_child'");
    f.db.run("UPDATE memos SET notebook_id = 'private' WHERE id = 'memo_child'");
    f.db.run("UPDATE memos SET notebook_id = 'child' WHERE id = 'memo_child'");
    expect((await f.request("/memos/memo_child")).status).toBe(404);
    await manage(f, "/memos/memo_child", { excluded: false });
    await manage(f, "/memos/memo_child", { excluded: false });
    expect((await f.request("/memos/memo_child")).status).toBe(200);
    expect((await f.request("/memos/memo_child/preview")).status).toBe(200);
  });

  test("original-note controls list live ancestor sites with independent exclusions and no new shares", async () => {
    const f = fixture();
    await f.app.request("/api/v1/notebooks/child/share", { method: "POST" }, f.environment);
    const sites = (id = "memo_child", init = {}) => f.app.request(`/api/v1/memos/${id}/notebook-sites`, init, f.environment);
    const response = await sites();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).sites).toEqual([
      { notebookId: "child", notebookName: "child", excluded: false },
      { notebookId: "root", notebookName: "root", excluded: false },
    ]);
    await manage(f, "/memos/memo_child", { excluded: true });
    expect((await (await sites()).json()).sites).toEqual([
      { notebookId: "child", notebookName: "child", excluded: false },
      { notebookId: "root", notebookName: "root", excluded: true },
    ]);
    expect((await f.request("/memos/memo_child")).status).toBe(404);
    const childToken = f.db.query("SELECT token FROM notebook_shares WHERE notebook_id = 'child'").get().token;
    expect((await f.app.request(`/api/public/notebook-shares/${childToken}/memos/memo_child`, {}, f.environment)).status).toBe(200);
    expect((await (await sites("memo_grand")).json()).sites).toHaveLength(2);
    expect(f.db.query("SELECT COUNT(*) AS count FROM memo_shares").get().count).toBe(1);
    expect((await (await sites("memo_private")).json()).sites).toEqual([]);
    f.db.run("UPDATE memos SET notebook_id = 'private' WHERE id = 'memo_child'");
    f.db.run("UPDATE notebooks SET parent_id = 'foreign' WHERE id = 'private'");
    expect((await (await sites()).json()).sites).toEqual([]);
    f.db.run("UPDATE notebooks SET is_deleted = 1 WHERE id = 'child'");
    expect((await (await sites("memo_grand")).json()).sites).toEqual([]);
    for (const kind of ["none", "agent"])
      expect((await sites("memo_grand", { headers: { "test-auth": kind } })).status).toBe(403);
    for (const id of ["missing", "memo_other"])
      expect((await sites(id)).status).toBe(404);
    f.db.run("UPDATE memos SET is_deleted = 1 WHERE id = 'memo_grand'");
    expect((await sites("memo_grand")).status).toBe(404);
  });

  test("owner content management filters before paging and reports exclusions beyond the first page", async () => {
    const f = fixture();
    for (let i = 0; i < 105; i++) f.addMemo(`bulk_${String(i).padStart(3, "0")}`, "child");
    await manage(f, "/memos/bulk_075", { excluded: true });
    await manage(f, "/memos/memo_child", { excluded: true });
    const firstResponse = await manage(f, "/memos?limit=20");
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.memos).toHaveLength(20);
    expect(first.nextCursor).toBe("bulk_019");
    expect(first.memos.every((memo) => typeof memo.excluded === "boolean")).toBe(true);
    expect(first.memos[0].contentJson).toBeUndefined();
    const later = await (await manage(f, "/memos?limit=20&cursor=bulk_074")).json();
    expect(later.memos[0]).toMatchObject({ id: "bulk_075", notebookId: "child", notebookName: "child", excluded: true });
    const excluded = await (await manage(f, "/memos?visibility=excluded&limit=1")).json();
    expect(excluded.memos.map((memo) => memo.id)).toEqual(["bulk_075"]);
    const nextExcluded = await (await manage(f, `/memos?visibility=excluded&limit=1&cursor=${excluded.nextCursor}`)).json();
    expect(nextExcluded.memos.map((memo) => memo.id)).toEqual(["memo_child"]);
    expect(nextExcluded.nextCursor).toBeNull();
    f.db.run("UPDATE memo_contents SET content_text = 'OwnerBodyNeedle 中文正文检索' WHERE memo_id = 'bulk_075'");
    for (const q of ["OwnerBodyNeedle", "正文检索"]) {
      const found = await (await manage(f, `/memos?q=${encodeURIComponent(q)}`)).json();
      expect(found.memos.map((memo) => memo.id)).toEqual(["bulk_075"]);
      const picker = await (await manage(f, `/memos?visibility=public&q=${encodeURIComponent(q)}`)).json();
      expect(picker.memos).toHaveLength(0);
    }
    expect((await manage(f, "/memos?visibility=invalid")).status).toBe(400);
    for (const kind of ["none", "agent"])
      expect((await manage(f, "/memos", undefined, { headers: { "test-auth": kind } })).status).toBe(403);
    expect((await f.app.request("/api/v1/notebooks/foreign/share/memos", {}, f.environment)).status).toBe(404);
    f.db.run("UPDATE notebooks SET is_deleted = 1 WHERE id = 'root'");
    expect((await manage(f, "/memos")).status).toBe(404);
  });

  test("body and Chinese search filter before paging and combine with exact tags", async () => {
    const f = fixture();
    for (const id of ["memo_root", "memo_child", "memo_grand"]) {
      f.db.run("UPDATE memo_contents SET content_text = 'OnlyBodyWord 中文检索内容' WHERE memo_id = ?", [id]);
      f.db.run("INSERT OR REPLACE INTO memo_search_documents (memo_id, title, content_text, tags) VALUES (?, ?, 'OnlyBodyWord 中文检索内容', '')", [id, id]);
    }
    f.db.run(`UPDATE memos SET tags_json = '["guide"]' WHERE id = 'memo_root'`);
    await manage(f, "/memos/memo_child", { excluded: true });
    for (const q of ["OnlyBodyWord", "检索"]) {
      const result = await (await f.request(`/search?q=${encodeURIComponent(q)}&limit=1`)).json();
      expect(result.memos).toHaveLength(1);
      expect(result.memos[0].excerpt).toContain(q);
      expect(result.nextCursor).not.toBeNull();
      const page2 = await (await f.request(`/search?q=${encodeURIComponent(q)}&limit=1&cursor=${result.nextCursor}`)).json();
      expect(page2.memos).toHaveLength(1);
      expect(page2.memos[0].id).not.toBe(result.memos[0].id);
      expect(page2.nextCursor).toBeNull();
    }
    const tagged = await (await f.request("/search?q=OnlyBodyWord&tag=guide")).json();
    expect(tagged.memos.map((m) => m.id)).toEqual(["memo_root"]);
    const longBody = "prefix ".repeat(90) + "Alpha different words Omega";
    f.db.run("UPDATE memo_contents SET content_text = ? WHERE memo_id = 'memo_root'", [longBody]);
    f.db.run("UPDATE memo_search_documents SET content_text = ? WHERE memo_id = 'memo_root'", [longBody]);
    const multiword = await (await f.request("/search?q=Alpha%20Omega")).json();
    expect(multiword.memos[0].excerpt).toContain("Alpha");
    expect(multiword.memos[0].excerpt).toContain("Omega");
  });

  test("rejects invalid targets, unknown settings, non-HTTPS URLs and oversized merged settings", async () => {
    const f = fixture();
    for (const id of ["memo_private", "memo_other", "missing"])
      expect((await manage(f, `/memos/${id}`, { excluded: true })).status).toBe(404);
    for (const settings of [{ homeMemoId: "memo_private" }, { excludedTags: ["draft"] }, { logoUrl: "javascript:alert(1)" }, { logoUrl: "broken" }, { headerLinks: [{ label: "x", url: "broken" }] }, { headerLinks: [{ label: "x", url: "http://example.org" }] }, { footerText: "x".repeat(17_000) }])
      expect((await manage(f, "/site", { settings })).status).toBe(400);
    expect((await manage(f, "/site", { settings: { footerText: "ok" } }, { headers: { "content-type": "application/json", "test-auth": "agent" } })).status).toBe(403);
    expect((await manage(f, "/site", { settings: { footerText: "ok" } }, { headers: { "content-type": "application/json", "test-auth": "none" } })).status).toBe(403);
  });

  test("homepages fall back on exclusion and aliases disclose identity only", async () => {
    const f = fixture();
    await manage(f, "/site", { siteSlug: "My-Docs", settings: { homeMemoId: "memo_child" } });
    expect((await (await f.request()).json()).share.settings.homeMemoId).toBe("memo_child");
    await manage(f, "/memos/memo_child", { excluded: true });
    expect((await (await f.request()).json()).share.settings.homeMemoId).toBeNull();
    expect((await manage(f, "/site", { settings: { homeMemoId: "memo_child" } })).status).toBe(400);
    const alias = await f.app.request("/api/public/notebook-sites/my-docs/resolve", {}, f.environment);
    expect(await alias.json()).toEqual({ token });
    const child = await f.app.request("/api/v1/notebooks/child/share", { method: "POST" }, f.environment);
    expect(child.status).toBe(200);
    const collision = await f.app.request("/api/v1/notebooks/child/share/site", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteSlug: "MY-DOCS" }) }, f.environment);
    expect(collision.status).toBe(409);
    await f.app.request("/api/v1/notebooks/root/share", { method: "DELETE" }, f.environment);
    expect((await f.app.request("/api/public/notebook-sites/my-docs/resolve", {}, f.environment)).status).toBe(404);
    expect(f.db.query("SELECT count(*) AS count FROM notebook_share_excluded_memos").get().count).toBe(0);
  });

  test("enabling or rotating passwords disables indexing and clearing does not re-enable it", async () => {
    const f = fixture();
    await manage(f, "/site", { settings: { allowIndexing: true } });
    expect((await (await f.request()).json()).share.settings.allowIndexing).toBe(true);
    await manage(f, "", { passwordProtected: true });
    expect((await manage(f, "/site", { settings: { allowIndexing: true } })).status).toBe(400);
    await manage(f, "", { passwordProtected: false });
    expect((await (await f.request()).json()).share.settings.allowIndexing).toBe(false);
  });

  test("server HTML escapes metadata, preserves protected privacy, and denies excluded aliases", async () => {
    const f = fixture();
    f.db.run("UPDATE memos SET title = ?, excerpt = ? WHERE id = 'memo_child'", ["<script>secret()</script> $& $' $$", 'A & B "quote"']);
    await manage(f, "/site", { siteSlug: "docs", settings: { allowIndexing: true, homeMemoId: "memo_child" } });
    const render = (path) => renderNotebookSitePage(new Request(`https://example.org${path}`), f.environment.storage.db,
      async () => new Response('<html><head><title>Old</title><meta name="description" content="old"></head><body><div id="root"></div></body></html>', { headers: { "content-type": "text/html" } }));
    const visible = await render("/s/docs/memo_child");
    expect(visible.status).toBe(200);
    expect(visible.headers.get("X-Robots-Tag")).toBe("index, follow");
    const html = await visible.text();
    expect(html).toContain("&lt;script&gt;secret()&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;secret()&lt;/script&gt; $&amp; $&#39; $$");
    expect(html).not.toContain("<script>secret()");
    expect(html).toContain('rel="canonical" href="https://example.org/s/docs/memo_child"');
    expect(html).toContain('property="og:description" content="A &amp; B &quot;quote&quot;"');
    for (const suffix of ["", "/memo_child"]) {
      const tokenPage = await render(`/share/notebook/${token}${suffix}`);
      expect(tokenPage.status).toBe(200);
      expect(tokenPage.headers.get("X-Robots-Tag")).toBe(PUBLIC_PAGE_ROBOTS);
      const tokenHtml = await tokenPage.text();
      expect(tokenHtml).toContain(`<meta name="robots" content="${PUBLIC_PAGE_ROBOTS}">`);
      expect(tokenHtml).toContain(`rel="canonical" href="https://example.org/s/docs${suffix}"`);
    }
    await manage(f, "/memos/memo_child", { excluded: true });
    const hidden = await render("/s/docs/memo_child");
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("X-Robots-Tag")).toBe(PUBLIC_PAGE_ROBOTS);
    expect(await hidden.text()).not.toContain("secret()");
    await manage(f, "", { passwordProtected: true });
    const protectedPage = await render("/s/docs");
    expect(protectedPage.headers.get("X-Robots-Tag")).toBe(PUBLIC_PAGE_ROBOTS);
    expect(await protectedPage.text()).not.toContain("secret()");
    expect(await render("/share/individual-token")).toBeNull();
  });

  test("Token pages without an alias remain noindex after opting in", async () => {
    const f = fixture();
    await manage(f, "/site", { settings: { allowIndexing: true } });
    for (const suffix of ["", "/memo_child"]) {
      const url = `https://example.org/share/notebook/${token}${suffix}`;
      const response = await renderNotebookSitePage(new Request(url), f.environment.storage.db,
        async () => new Response("<html><head></head><body></body></html>"));
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Robots-Tag")).toBe(PUBLIC_PAGE_ROBOTS);
      const html = await response.text();
      expect(html).toContain(`<meta name="robots" content="${PUBLIC_PAGE_ROBOTS}">`);
      expect(html).toContain(`rel="canonical" href="${url}"`);
    }
  });
});

describe("live recursive notebook sharing", () => {
  test("upgrades existing data without creating individual shares; exposes only the live workspace subtree", async () => {
    const { db, request } = fixture();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const { share } = await response.json();
    expect(share.notebooks.map((n) => n.id).sort()).toEqual([
      "child",
      "grandchild",
      "root",
    ]);
    expect(share.notebooks.find((n) => n.id === "root").parentId).toBeNull();
    expect(share.memos.map((m) => m.id).sort()).toEqual([
      "memo_child",
      "memo_grand",
      "memo_root",
    ]);
    expect(
      db.query("SELECT COUNT(*) AS total FROM memo_shares").get().total,
    ).toBe(1);
    expect(
      db
        .query(
          "SELECT content_markdown FROM memo_contents WHERE memo_id = 'memo_private'",
        )
        .get().content_markdown,
    ).toBe("memo_private");
    for (const id of ["memo_private", "memo_other"]) {
      expect((await request(`/memos/${id}`)).status).toBe(404);
      expect((await request(`/resources/res_${id}/blob`)).status).toBe(404);
    }
  });

  test("publishes new and moved-in notes, edits, and moved-in subtrees without changing the token", async () => {
    const { db, request, addMemo } = fixture();
    addMemo("new_note", "grandchild");
    db.run("UPDATE memos SET notebook_id = 'child' WHERE id = 'memo_private'");
    db.run(
      "UPDATE memo_contents SET content_markdown = 'edited live' WHERE memo_id = 'memo_child'",
    );
    const { share } = await (await request()).json();
    expect(share.memos.some((m) => m.id === "new_note")).toBe(true);
    expect(share.memos.some((m) => m.id === "memo_private")).toBe(true);
    expect(
      (await (await request("/memos/memo_child")).json()).share.contentMarkdown,
    ).toBe("edited live");
    db.run("UPDATE notebooks SET parent_id = 'root' WHERE id = 'private'");
    addMemo("new_private_child", "private");
    expect((await request("/memos/new_private_child")).status).toBe(200);
  });

  test("moving a note or subtree out immediately denies its note and resource endpoints", async () => {
    const { db, request, blobReads } = fixture();
    expect((await request("/resources/res_memo_child/blob")).status).toBe(200);
    db.run("UPDATE memos SET notebook_id = 'private' WHERE id = 'memo_child'");
    db.run(
      "UPDATE notebooks SET parent_id = 'private' WHERE id = 'grandchild'",
    );
    for (const id of ["memo_child", "memo_grand"]) {
      expect((await request(`/memos/${id}`)).status).toBe(404);
      expect((await request(`/resources/res_${id}/blob`)).status).toBe(404);
    }
    expect(blobReads()).toBe(1);
  });

  test("deleted notes, resources, ancestors, and roots cannot be read", async () => {
    const { db, request } = fixture();
    db.run("UPDATE memos SET is_deleted = 1 WHERE id = 'memo_root'");
    expect((await request("/memos/memo_root")).status).toBe(404);
    expect((await request("/resources/res_memo_root/blob")).status).toBe(404);
    db.run("UPDATE resources SET is_deleted = 1 WHERE id = 'res_memo_child'");
    expect((await request("/resources/res_memo_child/blob")).status).toBe(404);
    db.run("UPDATE notebooks SET is_deleted = 1 WHERE id = 'child'");
    expect((await request("/memos/memo_grand")).status).toBe(404);
    expect((await request("/resources/res_memo_grand/blob")).status).toBe(404);
    db.run("UPDATE notebooks SET is_deleted = 1 WHERE id = 'root'");
    expect((await request()).status).toBe(404);
  });

  test("revocation closes every endpoint, keeps independent shares, and recreation gets a fresh token", async () => {
    const { db, app, environment, request } = fixture();
    const revoke = await app.request(
      "/api/v1/notebooks/root/share",
      { method: "DELETE" },
      environment,
    );
    expect(revoke.status).toBe(200);
    for (const path of [
      "",
      "/memos/memo_child",
      "/resources/res_memo_child/blob",
    ])
      expect((await request(path)).status).toBe(404);
    expect(
      (
        await app.request(
          `/api/public/shares/${individualToken}`,
          {},
          environment,
        )
      ).status,
    ).toBe(200);
    expect(
      db.query("SELECT COUNT(*) AS total FROM memo_shares").get().total,
    ).toBe(1);
    const created = await (
      await app.request(
        "/api/v1/notebooks/root/share",
        { method: "POST" },
        environment,
      )
    ).json();
    expect(created.share.token).not.toBe(token);
    expect(created.share.token).toHaveLength(43);
    const again = await (
      await app.request(
        "/api/v1/notebooks/root/share",
        { method: "POST" },
        environment,
      )
    ).json();
    expect(again.share.token).toBe(created.share.token);
  });

  test("interactive management is workspace scoped and rejects anonymous and API-token callers", async () => {
    const { app, environment, db } = fixture();
    for (const kind of ["none", "agent"]) {
      for (const method of ["GET", "POST", "DELETE"])
        expect(
          (
            await app.request(
              "/api/v1/notebooks/root/share",
              { method, headers: { "test-auth": kind } },
              environment,
            )
          ).status,
        ).toBe(403);
    }
    expect(
      (
        await app.request(
          "/api/v1/notebooks/foreign/share",
          { method: "POST" },
          environment,
        )
      ).status,
    ).toBe(404);
    await app.request(
      "/api/v1/notebooks/foreign/share",
      { method: "DELETE" },
      environment,
    );
    const response = await app.request(
      "/api/v1/notebook-shares",
      {},
      environment,
    );
    expect((await response.json()).shares.map((s) => s.notebookId)).toEqual([
      "root",
    ]);
    expect(
      db.query("SELECT COUNT(*) AS total FROM notebook_shares").get().total,
    ).toBe(1);
  });

  test("internal links resolve only within the shared tree, even if an outside note has an independent share", async () => {
    const { db, request } = fixture();
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: ["memo_child", "memo_private", "memo_other"].map((id) => ({
            type: "text",
            text: id,
            marks: [{ type: "link", attrs: { href: `#memo=${id}` } }],
          })),
        },
      ],
    };
    db.run(
      "UPDATE memo_contents SET content_json = ? WHERE memo_id = 'memo_root'",
      [JSON.stringify(doc)],
    );
    const response = await (await request("/memos/memo_root")).json();
    expect(response.memoUrls).toEqual({
      memo_child: `/share/notebook/${token}/memo_child`,
    });
    expect(response.share.memoShareTokens).toEqual({});
  });

  test("resource streaming keeps range, MIME, and no-store behavior", async () => {
    const { request } = fixture();
    const response = await request("/resources/res_memo_child/blob", {
      headers: { Range: "bytes=2-5" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("2345");
  });
  test("independent child notebook shares survive parent revocation", async () => {
    const { app, environment, request } = fixture();
    const created = await (
      await app.request(
        "/api/v1/notebooks/child/share",
        { method: "POST" },
        environment,
      )
    ).json();
    await app.request(
      "/api/v1/notebooks/root/share",
      { method: "DELETE" },
      environment,
    );
    expect((await request("/memos/memo_child")).status).toBe(404);
    const base = `/api/public/notebook-shares/${created.share.token}`;
    expect((await app.request(base, {}, environment)).status).toBe(200);
    expect(
      (await app.request(`${base}/memos/memo_grand`, {}, environment)).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `${base}/resources/res_memo_grand/blob`,
          {},
          environment,
        )
      ).status,
    ).toBe(200);
  });

  test("even inconsistent cross-workspace notebook references do not grant access", async () => {
    const { db, request } = fixture();
    db.run("UPDATE memos SET notebook_id = 'root' WHERE id = 'memo_other'");
    expect((await request("/memos/memo_other")).status).toBe(404);
    expect((await request("/resources/res_memo_other/blob")).status).toBe(404);
    const { share } = await (await request()).json();
    expect(share.memos.some((memo) => memo.id === "memo_other")).toBe(false);
  });
});

describe("password-protected notebook shares", () => {
  const changePassword = async (fixture, enabled = true, id = "root", headers = {}) => {
    const response = await fixture.app.request(`/api/v1/notebooks/${id}/share`, {
      method: "PATCH", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ passwordProtected: enabled }),
    }, fixture.environment);
    return { response, data: await response.json() };
  };
  const unlock = (fixture, password) => fixture.request("/unlock", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
  });
  const cookieFrom = (response) => response.headers.get("set-cookie").split(";")[0];
  const paths = ["", "/memos/memo_child", "/memos/memo_grand", "/resources/res_memo_grand/blob"];

  test("migrates an existing live link in place and protects directory, descendants and blobs", async () => {
    const f = fixture();
    expect((await f.request()).status).toBe(200);
    const { response, data } = await changePassword(f);
    expect(response.status).toBe(200);
    expect(data.share.token).toBe(token);
    expect(data.share.passwordProtected).toBe(true);
    expect(data.share.password.length).toBeGreaterThan(0);
    expect(f.db.query("SELECT password_hash FROM notebook_shares").get().password_hash).not.toBe(data.share.password);
    for (const path of paths) {
      const denied = await f.request(path, { headers: { Range: "bytes=2-5" } });
      expect(denied.status).toBe(403);
      expect((await denied.json()).error.code).toBe("share_password_required");
      expect(denied.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(f.blobReads()).toBe(0);
    const listing = await f.app.request("/api/v1/notebook-shares", {}, f.environment);
    const shares = (await listing.json()).shares;
    expect(shares[0].passwordProtected).toBe(true);
    expect(shares[0].password).toBeUndefined();
    expect(shares[0].password_hash).toBeUndefined();
    const wrong = await unlock(f, "wrong");
    expect((await wrong.json()).error.code).toBe("share_password_invalid");
    const ok = await unlock(f, data.share.password);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(`Path=/api/public/notebook-shares/${token}`);
    expect(ok.headers.get("set-cookie")).toContain("HttpOnly");
    const headers = { Cookie: cookieFrom(ok) };
    for (const path of paths) expect((await f.request(path, { headers })).status).toBe(200);
    const range = await f.request(paths[3], { headers: { ...headers, Range: "bytes=2-5" } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe("2345");
  });

  test("rotating rejects previous passwords and cookies; clearing restores the same public link", async () => {
    const f = fixture();
    const first = (await changePassword(f)).data.share;
    const cookie = cookieFrom(await unlock(f, first.password));
    const second = (await changePassword(f)).data.share;
    expect(second.token).toBe(first.token);
    expect(second.password).not.toBe(first.password);
    expect((await unlock(f, first.password)).status).toBe(403);
    for (const path of paths) expect((await f.request(path, { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await unlock(f, second.password)).status).toBe(200);
    const cleared = (await changePassword(f, false)).data.share;
    expect(cleared.token).toBe(token);
    expect(cleared.passwordProtected).toBe(false);
    expect(cleared.password).toBeUndefined();
    for (const path of paths) expect((await f.request(path)).status).toBe(200);
    expect((await unlock(f, second.password)).status).toBe(400);
  });

  test("limits wrong attempts and resets attempt state when regenerating", async () => {
    const f = fixture();
    const share = (await changePassword(f)).data.share;
    for (let i = 0; i < 7; i++) expect((await unlock(f, "wrong")).status).toBe(403);
    expect((await unlock(f, "wrong")).status).toBe(429);
    expect((await unlock(f, share.password)).status).toBe(429);
    const regenerated = (await changePassword(f)).data.share;
    expect((await unlock(f, regenerated.password)).status).toBe(200);
    expect(f.db.query("SELECT unlock_failed_count FROM notebook_shares").get().unlock_failed_count).toBe(0);
  });

  test("management requires a live share in the interactive user's workspace", async () => {
    const f = fixture();
    for (const [kind, status] of [["none", 403], ["agent", 403]]) expect((await changePassword(f, true, "root", { "test-auth": kind })).response.status).toBe(status);
    expect((await changePassword(f, true, "foreign")).response.status).toBe(404);
    expect((await changePassword(f, true, "private")).response.status).toBe(404);
    f.db.run("UPDATE notebooks SET is_deleted = 1 WHERE id = 'root'");
    expect((await changePassword(f)).response.status).toBe(404);
    expect((await unlock(f, "wrong")).status).toBe(404);
  });

  test("other share links have independent passwords and grants; revocation invalidates all reads", async () => {
    const f = fixture();
    const parent = (await changePassword(f)).data.share;
    const parentCookie = cookieFrom(await unlock(f, parent.password));
    const created = await f.app.request("/api/v1/notebooks/child/share", { method: "POST" }, f.environment);
    const child = (await created.json()).share;
    // Another public link still grants access independently.
    expect((await f.app.request(`/api/public/notebook-shares/${child.token}`, {}, f.environment)).status).toBe(200);
    expect((await f.app.request(`/api/public/shares/${individualToken}`, {}, f.environment)).status).toBe(200);
    const protectedChild = (await changePassword(f, true, "child")).data.share;
    const childBase = `/api/public/notebook-shares/${child.token}`;
    expect((await f.app.request(childBase, { headers: { Cookie: parentCookie } }, f.environment)).status).toBe(403);
    const childUnlock = await f.app.request(`${childBase}/unlock`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: protectedChild.password }),
    }, f.environment);
    expect(childUnlock.status).toBe(200);
    expect((await f.request("", { headers: { Cookie: cookieFrom(childUnlock) } })).status).toBe(403);
    await f.app.request("/api/v1/notebooks/root/share", { method: "DELETE" }, f.environment);
    for (const path of [...paths, "/unlock"]) expect((await f.request(path, { headers: { Cookie: parentCookie } })).status).toBe(404);
    expect((await f.app.request(childBase, { headers: { Cookie: cookieFrom(childUnlock) } }, f.environment)).status).toBe(200);
  });
});

test("workspace login cannot bypass the notebook password; an unlock grant is still required", async () => {
  const { createHash } = await import("node:crypto");
  const f = fixture();
  const enabled = await f.app.request("/api/v1/notebooks/root/share", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ passwordProtected: true }),
  }, f.environment);
  for (const [user, workspace] of [["owner", "ws_test"], ["other", "ws_other"]]) {
    f.db.run("INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'unused')", [user, user]);
    f.db.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')", [workspace, user]);
    f.db.run("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      [user, user, createHash("sha256").update(user).digest("hex"), new Date(Date.now()+3600000).toISOString()]);
  }
  for (const path of ["", "/memos/memo_child", "/resources/res_memo_child/blob"]) {
    expect((await f.request(path, { headers: { Cookie: "edgeever_session=owner" } })).status).toBe(403);
    expect((await f.request(path, { headers: { Cookie: "edgeever_session=other" } })).status).toBe(403);
    expect((await f.request(path, { headers: { Authorization: "Bearer owner" } })).status).toBe(403);
  }
  const password = (await enabled.json()).share.password;
  const unlocked = await f.request("/unlock", {
    method: "POST", headers: { "content-type": "application/json", Cookie: "edgeever_session=owner" },
    body: JSON.stringify({ password }),
  });
  expect(unlocked.status).toBe(200);
  const cookie = unlocked.headers.get("set-cookie").split(";")[0];
  for (const path of ["", "/memos/memo_child", "/resources/res_memo_child/blob"]) {
    expect((await f.request(path, { headers: { Cookie: `edgeever_session=owner; ${cookie}` } })).status).toBe(200);
  }
});

describe("notebook share password recovery", () => {
  const ownerPath = "/api/v1/notebooks/root/share";
  const change = (f, protectedValue = true) => f.app.request(ownerPath, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passwordProtected: protectedValue }),
  }, f.environment);

  test("upgrades a hash-only share in place without invalidating the old password", async () => {
    const f = fixture(await hashPassword("legacy12"));
    const owner = await f.app.request(ownerPath, {}, f.environment);
    expect((await owner.json()).share.password).toBeUndefined();
    expect(f.db.query("SELECT password_encrypted FROM notebook_shares").get().password_encrypted).toBeNull();
    const unlock = await f.request("/unlock", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "legacy12" }),
    });
    expect(unlock.status).toBe(200);
    const cookie = unlock.headers.get("set-cookie").split(";")[0];
    expect((await f.request("", { headers: { Cookie: cookie } })).status).toBe(200);
    const next = (await (await change(f)).json()).share;
    expect(next.token).toBe(token);
    expect((await (await f.app.request(ownerPath, {}, f.environment)).json()).share.password).toBe(next.password);
    expect((await f.request("", { headers: { Cookie: cookie } })).status).toBe(403);
  });

  test("recovers on a fresh read, hides from other workspaces/agents, and clears ciphertext", async () => {
    const f = fixture();
    const share = (await (await change(f)).json()).share;
    const ciphertext = f.db.query("SELECT password_encrypted FROM notebook_shares").get().password_encrypted;
    expect(ciphertext).toStartWith("v1.");
    expect(ciphertext).not.toContain(share.password);
    const fresh = await f.app.request(ownerPath, {}, f.environment);
    expect(fresh.headers.get("cache-control")).toBe("private, no-store");
    expect((await fresh.json()).share.password).toBe(share.password);
    for (const authKind of ["none", "agent"]) {
      expect((await f.app.request(ownerPath, { headers: { "test-auth": authKind } }, f.environment)).status).toBe(403);
    }
    expect((await (await f.app.request("/api/v1/notebooks/foreign/share", {}, f.environment)).json()).share).toBeNull();
    // Lost key prevents recovery, but hash-based access is still usable.
    const previous = f.environment.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY;
    f.environment.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY = "different-key";
    expect((await (await f.app.request(ownerPath, {}, f.environment)).json()).share.password).toBeUndefined();
    expect((await f.request("/unlock", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: share.password }),
    })).status).toBe(200);
    f.environment.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS = previous;
    expect((await (await f.app.request(ownerPath, {}, f.environment)).json()).share.password).toBe(share.password);
    await change(f, false);
    expect(f.db.query("SELECT password_encrypted FROM notebook_shares").get().password_encrypted).toBeNull();
    expect((await (await f.app.request(ownerPath, {}, f.environment)).json()).share.password).toBeUndefined();
  });
});

 test("an older server rotating only the hash cannot display stale ciphertext", async () => {
    const f = fixture();
    const response = await f.app.request("/api/v1/notebooks/root/share", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwordProtected: true }),
    }, f.environment);
    expect(response.status).toBe(200);
    // Simulate a rollback: the previous server writes only the hash.
    f.db.run("UPDATE notebook_shares SET password_hash = ?", [await hashPassword("old-server12")]);
    const read = await f.app.request("/api/v1/notebooks/root/share", {}, f.environment);
    expect((await read.json()).share.password).toBeUndefined();
    const unlock = await f.request("/unlock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "old-server12" }),
    });
    expect(unlock.status).toBe(200);
  });

test("missing deployment keys reject regeneration without changing the existing password", async () => {
  const f = fixture(await hashPassword("existing12"));
  delete f.environment.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY;
  f.app.onError((error, c) => c.json({ error: { code: error.code } }, error.status ?? 500));
  const before = f.db.query("SELECT password_hash, password_encrypted FROM notebook_shares").get();
  const response = await f.app.request("/api/v1/notebooks/root/share", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passwordProtected: true }),
  }, f.environment);
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("share_encryption_unavailable");
  expect(f.db.query("SELECT password_hash, password_encrypted FROM notebook_shares").get()).toEqual(before);
  expect((await f.request("/unlock", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "existing12" }),
  })).status).toBe(200);
});
