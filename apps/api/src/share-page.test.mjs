import { PUBLIC_PAGE_ROBOTS } from "@edgeever/shared/public-page-headers";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { isPublicMemoSharePagePath, parsePublicMemoSharePagePath, renderPublicMemoSharePage } from "./share-page.ts";

class SqliteD1PreparedStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqliteD1PreparedStatement(this.db, this.sql, bindings);
  }

  async all() {
    return { results: this.db.query(this.sql).all(...this.bindings), success: true, meta: {} };
  }

  async first() {
    return this.db.query(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    this.db.query(this.sql).run(...this.bindings);
    return { success: true, meta: {} };
  }
}

const token = "s".repeat(43);
const shell = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="old description" />
    <title>EdgeEver</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

const createDatabase = () => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_member", "Member workspace");
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)").run("nb_member", "ws_member", "Inbox");
  sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES (?, ?, ?, ?)")
    .run("memo_source", "ws_member", "nb_member", "A $& $' $$ <script>");
  sqlite.query("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_hash) VALUES (?, ?, ?, ?)")
    .run("memo_source", "{}", "# A $& $' $$ <script>\n\nHello <script>secret()</script>\n", "hash");
  sqlite.query("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES (?, ?, ?, ?)")
    .run("share_source", "memo_source", "ws_member", token);
  return sqlite;
};

const dbOf = (sqlite) => ({ prepare: (sql) => new SqliteD1PreparedStatement(sqlite, sql) });

const render = (sqlite, path, accept) => renderPublicMemoSharePage(
  new Request(`https://note.example${path}`, accept ? { headers: { accept } } : undefined),
  dbOf(sqlite),
  async () => new Response(shell, { headers: { "content-type": "text/html", etag: "shell" } }),
);

describe("public memo share pages", () => {
  test("recognizes only a single-note share path", () => {
    expect(parsePublicMemoSharePagePath(`/share/${token}`)).toEqual({ segment: token, markdown: false });
    expect(parsePublicMemoSharePagePath(`/share/${token}.md`)).toEqual({ segment: token, markdown: true });
    expect(parsePublicMemoSharePagePath(`/share/${token}/`)).toEqual({ segment: token, markdown: false });
    expect(parsePublicMemoSharePagePath("/share/Meeting-Notes.md")).toEqual({ segment: "meeting-notes", markdown: true });
    expect(isPublicMemoSharePagePath(`/share/notebook/${token}`)).toBe(false);
    expect(isPublicMemoSharePagePath("/share/notebook")).toBe(false);
    expect(isPublicMemoSharePagePath("/share/not_a_token")).toBe(false);
    expect(parsePublicMemoSharePagePath("/share/%2e%2e/secret")).toBeNull();
  });

  test("puts the note in the first HTML response and keeps the app shell", async () => {
    const response = await render(createDatabase(), `/share/${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-robots-tag")).toBe(PUBLIC_PAGE_ROBOTS);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("link")).toBe(`<https://note.example/share/${token}.md>; rel="alternate"; type="text/markdown"`);
    expect(response.headers.get("etag")).toBeNull();
    const html = await response.text();
    expect(html).toContain(`<title>A $&amp; $&#39; $$ &lt;script&gt; · EdgeEver</title>`);
    expect(html).toContain(`<meta name="robots" content="${PUBLIC_PAGE_ROBOTS}">`);
    expect(html).toContain(`rel="canonical" href="https://note.example/share/${token}"`);
    expect(html).toContain(`rel="alternate" type="text/markdown" href="https://note.example/share/${token}.md"`);
    expect(html).toContain("Hello &lt;script&gt;secret()&lt;/script&gt;");
    expect(html).not.toContain("<script>secret()");
    expect(html).toContain('<div id="root"><article id="edgeever-shared-note"');
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(html).not.toContain("old description");
  });

  test.each([[true, true], [true, false], [false, true], [false, false]])(
    "independently renders update time (%s) and footer branding (%s) in the first HTML response",
    async (showUpdatedAt, showBranding) => {
      const sqlite = createDatabase();
      try {
        sqlite.query("UPDATE memo_shares SET show_updated_at = ?, show_branding = ? WHERE token = ?")
          .run(Number(showUpdatedAt), Number(showBranding), token);
        const html = await (await render(sqlite, `/share/${token}`)).text();
        expect(html.includes("<time ")).toBe(showUpdatedAt);
        expect(html.includes("Published with EdgeEver</a>")).toBe(showBranding);
        if (showBranding) {
          expect(html).toContain('<footer style="');
          expect(html).toContain('href="https://edgeever.org/"');
          expect(html.indexOf("<footer ")).toBeGreaterThan(html.indexOf("</pre>"));
        }
        expect(html).not.toContain("Read-only share");
        expect(html).toContain("Hello &lt;script&gt;secret()&lt;/script&gt;");
        const markdown = await (await render(sqlite, `/share/${token}.md`)).text();
        expect(markdown).toBe("# A $& $' $$ <script>\n\nHello <script>secret()</script>\n");
      } finally {
        sqlite.close();
      }
    },
  );

  test("returns markdown for the direct link and for an explicit markdown accept", async () => {
    const sqlite = createDatabase();
    const direct = await render(sqlite, `/share/${token}.md`, "text/html");
    expect(direct.status).toBe(200);
    expect(direct.headers.get("content-type")).toContain("text/markdown");
    expect(direct.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await direct.text()).toBe("# A $& $' $$ <script>\n\nHello <script>secret()</script>\n");

    const negotiated = await render(sqlite, `/share/${token}`, "text/markdown, */*");
    expect(negotiated.headers.get("content-type")).toContain("text/markdown");
    expect(await negotiated.text()).toContain("Hello <script>secret()</script>");

    const browser = await render(sqlite, `/share/${token}`, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    expect(browser.headers.get("content-type")).toContain("text/html");
    expect(await browser.text()).toContain("edgeever-shared-note");
  });

  test("omits the body when the share is missing, deleted, or password protected", async () => {
    const sqlite = createDatabase();
    const missing = await render(sqlite, `/share/${"m".repeat(43)}`);
    expect(missing.status).toBe(200);
    const missingHtml = await missing.text();
    expect(missingHtml).not.toContain("edgeever-shared-note");
    expect(missingHtml).not.toContain("secret()");
    expect(missingHtml).toContain('<script type="module" src="/src/main.tsx"></script>');

    const missingMarkdown = await render(sqlite, `/share/${"m".repeat(43)}.md`);
    expect(missingMarkdown.status).toBe(404);
    expect(await missingMarkdown.text()).not.toContain("secret()");

    sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = 'memo_source'").run();
    expect(await (await render(sqlite, `/share/${token}`)).text()).not.toContain("secret()");
    sqlite.query("UPDATE memos SET is_deleted = 0 WHERE id = 'memo_source'").run();

    sqlite.query("UPDATE memo_shares SET password_hash = ? WHERE token = ?").run("hash", token);
    const locked = await render(sqlite, `/share/${token}`);
    const lockedHtml = await locked.text();
    expect(lockedHtml).not.toContain("secret()");
    expect(lockedHtml).not.toContain("Hello");
    expect(lockedHtml).not.toContain("$&");
    expect(lockedHtml).not.toContain("rel=\"alternate\"");
    expect(lockedHtml).toContain("This shared note requires a password.");
    expect(locked.headers.get("link")).toBeNull();

    const lockedMarkdown = await render(sqlite, `/share/${token}.md`);
    expect(lockedMarkdown.status).toBe(403);
    expect(await lockedMarkdown.text()).toBe("This shared note requires a password.\n");
  });

  test("serves a custom address like the token and keeps password-protected notes out", async () => {
    const sqlite = createDatabase();
    sqlite.query("UPDATE memo_shares SET slug = ? WHERE token = ?").run("meeting-notes", token);

    const page = await render(sqlite, "/share/Meeting-Notes");
    const html = await page.text();
    expect(html).toContain("Hello &lt;script&gt;secret()&lt;/script&gt;");
    expect(html).toContain('rel="canonical" href="https://note.example/share/meeting-notes"');
    expect(page.headers.get("link")).toBe('<https://note.example/share/meeting-notes.md>; rel="alternate"; type="text/markdown"');

    const markdown = await render(sqlite, "/share/meeting-notes.md");
    expect(markdown.status).toBe(200);
    expect(await markdown.text()).toContain("Hello <script>secret()</script>");

    const missing = await render(sqlite, "/share/other-notes.md");
    expect(missing.status).toBe(404);

    sqlite.query("UPDATE memo_shares SET password_hash = ? WHERE token = ?").run("hash", token);
    const lockedHtml = await (await render(sqlite, "/share/meeting-notes")).text();
    expect(lockedHtml).not.toContain("secret()");
    expect(lockedHtml).toContain("This shared note requires a password.");
    const lockedMarkdown = await render(sqlite, "/share/meeting-notes.md");
    expect(lockedMarkdown.status).toBe(403);
    expect(await lockedMarkdown.text()).not.toContain("secret()");
  });

  test("treats the stored default title as untitled in metadata and markdown", async () => {
    const sqlite = createDatabase();
    sqlite.query("UPDATE memos SET title = ? WHERE id = 'memo_source'").run("无标题笔记");
    sqlite.query("UPDATE memo_contents SET content_markdown = ? WHERE memo_id = 'memo_source'").run("Body text\n");
    const html = await (await render(sqlite, `/share/${token}`)).text();
    expect(html).not.toContain("无标题笔记");
    expect(html).toContain("<title>Shared note · EdgeEver</title>");
    expect(html).toContain('<meta property="og:title" content="Shared note">');
    expect(html).toContain('<meta name="twitter:title" content="Shared note">');
    expect(html).toContain("Body text");
    expect(await (await render(sqlite, `/share/${token}.md`)).text()).toBe("Body text\n");
  });

  test("HEAD keeps the headers and omits the body", async () => {
    const response = await renderPublicMemoSharePage(
      new Request(`https://note.example/share/${token}.md`, { method: "HEAD" }),
      dbOf(createDatabase()),
      async () => new Response(shell),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  test("production entrypoints serve the share page from the worker", () => {
    const worker = readFileSync("apps/api/src/index.ts", "utf8");
    const selfHosted = readFileSync("scripts/self-hosted-server.mjs", "utf8");
    const wrangler = readFileSync("wrangler.toml", "utf8");
    const webConfig = readFileSync("apps/web/vite.config.ts", "utf8");
    expect(worker).toContain("renderPublicMemoSharePage");
    expect(worker).toContain('pathname.startsWith("/share/")');
    expect(selfHosted).toContain("renderPublicMemoSharePage");
    expect(wrangler).toContain('"/share/*"');
    expect(webConfig).toContain("!/^\\/(?:share|s)\\//.test(url.pathname)");
  });
});

describe("expiring and counted share pages", () => {
  const viewCount = (sqlite) => sqlite.query("SELECT view_count FROM memo_shares WHERE token = ?").get(token).view_count;

  test("an expired link serves neither markdown nor the note in HTML", async () => {
    const sqlite = createDatabase();
    try {
      sqlite.query("UPDATE memo_shares SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token = ?").run(token);
      const markdown = await render(sqlite, `/share/${token}.md`);
      expect(markdown.status).toBe(410);
      expect(await markdown.text()).toBe("This shared link has expired.\n");

      const html = await render(sqlite, `/share/${token}`);
      const page = await html.text();
      expect(page).not.toContain("Hello");
      expect(page).not.toContain("edgeever-shared-note");
      expect(page).toContain("This shared link has expired.");
      expect(html.headers.get("Link")).toBeNull();
      expect(viewCount(sqlite)).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  test("a future expiry keeps the page readable", async () => {
    const sqlite = createDatabase();
    try {
      sqlite.query("UPDATE memo_shares SET expires_at = '2999-01-01T00:00:00.000Z' WHERE token = ?").run(token);
      expect((await render(sqlite, `/share/${token}.md`)).status).toBe(200);
      expect(await (await render(sqlite, `/share/${token}`)).text()).toContain("edgeever-shared-note");
    } finally {
      sqlite.close();
    }
  });

  test("counts markdown reads but not the HTML shell or HEAD requests", async () => {
    const sqlite = createDatabase();
    try {
      await render(sqlite, `/share/${token}`);
      expect(viewCount(sqlite)).toBe(0);
      await renderPublicMemoSharePage(new Request(`https://note.example/share/${token}.md`, { method: "HEAD" }), dbOf(sqlite), async () => new Response(shell));
      expect(viewCount(sqlite)).toBe(0);
      expect((await render(sqlite, `/share/${token}.md`)).status).toBe(200);
      expect(viewCount(sqlite)).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
