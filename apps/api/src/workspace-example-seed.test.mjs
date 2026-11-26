import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { SharedTableMigration } from "./table-storage-migration.ts";
import { SharedTableStore } from "./shared-table-store.ts";
import { ensureUserWorkspace } from "./workspace-provisioning.ts";
import {
  ensureWorkspaceExampleSeed,
  omitInstanceUnavailableExampleTips,
} from "./workspace-example-seed.ts";

const MIGRATION = "0079_workspace_example_seeds.sql";
const migrationFiles = globSync("migrations/*.sql").sort();
const opened = [];
afterEach(() => opened.splice(0).forEach((sqlite) => sqlite.close()));

const migrate = (sqlite, filter = () => true) => {
  for (const file of migrationFiles.filter(filter)) sqlite.exec(readFileSync(file, "utf8"));
};

const openDatabase = () => {
  const sqlite = new Database(":memory:");
  opened.push(sqlite);
  const puts = [];
  const { db } = createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-example-seed-unused");
  const env = {
    storage: {
      db,
      resources: {
        put: async (key) => {
          puts.push(key);
        },
      },
    },
  };
  return { sqlite, env, puts };
};

const freshInstallation = () => {
  const database = openDatabase();
  migrate(database.sqlite);
  return database;
};

const upgradedInstallation = (prepare) => {
  const database = openDatabase();
  migrate(database.sqlite, (file) => file < `migrations/${MIGRATION}`);
  prepare(database.sqlite);
  migrate(database.sqlite, (file) => file >= `migrations/${MIGRATION}`);
  return database;
};

const addUser = (sqlite, id, username = id) => sqlite
  .query("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, 'unused', ?)")
  .run(id, username, username);

const pending = (sqlite) => sqlite
  .query("SELECT workspace_id FROM workspace_example_seeds ORDER BY workspace_id")
  .all()
  .map((row) => row.workspace_id);

const exampleCounts = (sqlite, workspaceId = "ws_default") => Object.fromEntries(
  sqlite.query(
    `SELECT n.slug, COUNT(m.id) AS count
     FROM notebooks n
     LEFT JOIN memos m ON m.notebook_id = n.id AND m.is_deleted = 0
     WHERE n.workspace_id = ? AND n.slug IN ('demo-features', 'feature-demos')
     GROUP BY n.slug
     ORDER BY n.slug`,
  ).all(workspaceId).map((row) => [row.slug, row.count]),
);

const overviewMarkdown = (sqlite, memoId = "memo_demo_overview") => sqlite
  .query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?")
  .get(memoId)?.content_markdown ?? "";

describe("workspace example seed", () => {
  test("drops the demo-only reset tip from copied notes", () => {
    const source = [
      "> 7. 点击 **“分享为卡片”**，挑选一款你心仪的社交海报风格并导出；",
      "> 8. 随时在侧边栏或设置中点击 **“恢复 Demo 数据”**，一键重置演示工作区。",
      "> 8. Click **\"Reset Demo Data\"** in settings or the sidebar anytime to restore the demo workspace.",
    ].join("\n");

    expect(omitInstanceUnavailableExampleTips(source)).toBe(
      "> 7. 点击 **“分享为卡片”**，挑选一款你心仪的社交海报风格并导出；",
    );
  });

  test("gives a fresh installation both example notebooks and leaves the welcome note", async () => {
    const { sqlite, env, puts } = freshInstallation();
    expect(pending(sqlite)).toEqual(["ws_default"]);

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual([]);
    expect(exampleCounts(sqlite)).toEqual({ "demo-features": 7, "feature-demos": 7 });
    expect(sqlite.query("SELECT id FROM memos WHERE id = 'memo_welcome'").get()).toEqual({ id: "memo_welcome" });
    expect(sqlite.query("SELECT parent_id FROM notebooks WHERE id = 'nb_demo_features'").get())
      .toEqual({ parent_id: "nb_projects" });
    expect(overviewMarkdown(sqlite)).toContain("/api/v1/resources/res_demo_logo/blob");
    expect(overviewMarkdown(sqlite)).not.toContain("恢复 Demo 数据");
    expect(overviewMarkdown(sqlite, "memo_demo_overview_en")).not.toContain("Reset Demo Data");
    expect(sqlite.query("SELECT COUNT(*) AS count FROM resources WHERE id = 'res_demo_logo'").get()).toEqual({ count: 1 });
    expect(puts.some((key) => key.includes("res_demo_logo"))).toBe(true);

    const memoCount = sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count;
    await ensureWorkspaceExampleSeed(env, "ws_default");
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count).toBe(memoCount);
  });

  test("still seeds a welcome note that was only localized", async () => {
    const { sqlite, env } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    await ensureUserWorkspace(env.storage.db, "usr_owner", "admin", "pl");

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(sqlite.query("SELECT title FROM memos WHERE id = 'memo_welcome'").get()).toEqual({ title: "Witaj w EdgeEver" });
    expect(exampleCounts(sqlite)).toEqual({ "demo-features": 7, "feature-demos": 7 });
  });

  test("does not backfill an installation that already has another note", async () => {
    const { sqlite, env } = upgradedInstallation((existing) => {
      existing.query(
        `INSERT INTO memos (id, notebook_id, title, created_by, updated_by)
         VALUES ('memo_user', 'nb_inbox', '自己的笔记', 'usr_owner', 'usr_owner')`,
      ).run();
    });

    expect(pending(sqlite)).toEqual([]);
    await ensureWorkspaceExampleSeed(env, "ws_default");
    expect(exampleCounts(sqlite)).toEqual({});
  });

  test("does not backfill a welcome note the user has edited", async () => {
    const { sqlite, env } = upgradedInstallation((existing) => {
      existing.query("UPDATE memos SET updated_by = 'usr_owner' WHERE id = 'memo_welcome'").run();
    });

    expect(pending(sqlite)).toEqual([]);
    await ensureWorkspaceExampleSeed(env, "ws_default");
    expect(exampleCounts(sqlite)).toEqual({});
  });

  test("drops a pending seed when the welcome body no longer matches a system translation", async () => {
    const { sqlite, env } = freshInstallation();
    sqlite.query("UPDATE memo_contents SET content_hash = 'edited' WHERE memo_id = 'memo_welcome'").run();

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual([]);
    expect(exampleCounts(sqlite)).toEqual({});
  });

  test("gives a newly created workspace its own copy with distinct ids", async () => {
    const { sqlite, env } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    addUser(sqlite, "usr_writer", "writer");
    await ensureUserWorkspace(env.storage.db, "usr_owner", "admin", "zh-CN");
    const workspace = await ensureUserWorkspace(env.storage.db, "usr_writer", "writer", "ja");
    expect(pending(sqlite)).toContain(workspace.workspaceId);

    await ensureWorkspaceExampleSeed(env, workspace.workspaceId);

    expect(pending(sqlite)).not.toContain(workspace.workspaceId);
    expect(exampleCounts(sqlite, workspace.workspaceId)).toEqual({ "demo-features": 7, "feature-demos": 7 });
    const notebook = sqlite.query(
      "SELECT id, parent_id FROM notebooks WHERE workspace_id = ? AND slug = 'demo-features'",
    ).get(workspace.workspaceId);
    expect(notebook.id).toBe(`${workspace.workspaceId}_nb_demo_features`);
    expect(notebook.parent_id).toBe(`${workspace.workspaceId}_projects`);
    const markdown = sqlite.query(
      `SELECT c.content_markdown
       FROM memo_contents c
       INNER JOIN memos m ON m.id = c.memo_id
       WHERE m.workspace_id = ? AND m.title LIKE '欢迎使用 EdgeEver%'`,
    ).get(workspace.workspaceId).content_markdown;
    expect(markdown).toContain(`/api/v1/resources/${workspace.workspaceId}_res_demo_logo/blob`);
    expect(markdown).not.toContain("/api/v1/resources/res_demo_logo/blob");
    expect(sqlite.query("SELECT id FROM memos WHERE id = 'memo_demo_overview'").get()).toBeNull();
  });

  test("waits to seed until object storage can store the example files", async () => {
    const { sqlite, env } = freshInstallation();
    env.storage.resources = {};

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual(["ws_default"]);
    expect(exampleCounts(sqlite)).toEqual({});
  });

  test("seeds tables and their workspace-scoped attachments after storage activation", async () => {
    const { sqlite, env } = freshInstallation();
    const db = env.storage.db;
    const migration = new SharedTableMigration(db);
    await migration.start();
    while ((await migration.advance()).phase !== "ready") {}
    await migration.activate();

    addUser(sqlite, "usr_owner", "admin");
    addUser(sqlite, "usr_writer", "writer");
    await ensureUserWorkspace(db, "usr_owner", "admin", "zh-CN");
    const { workspaceId } = await ensureUserWorkspace(db, "usr_writer", "writer", "en");
    await ensureWorkspaceExampleSeed(env, workspaceId);

    const id = `${workspaceId}_memo_demo_table`;
    expect(pending(sqlite)).not.toContain(workspaceId);
    expect(exampleCounts(sqlite, workspaceId)).toEqual({ "demo-features": 7, "feature-demos": 7 });
    expect(sqlite.query("SELECT shared_table_revision FROM memo_contents WHERE memo_id = ?").get(id)).toEqual({ shared_table_revision: 1 });
    const table = await new SharedTableStore(db).memoSnapshot(workspaceId, id, 1, false);
    const attachments = table.records.flatMap((record) => record.cells.fld_docs ?? []);
    expect(attachments.map((item) => item.resourceId)).toContain(`${workspaceId}_res_demo_attachment_bundle_zip`);
    expect(sqlite.query("SELECT memo_id FROM resources WHERE id = ?").get(`${workspaceId}_res_demo_attachment_bundle_zip`)).not.toBeNull();
  });

  test("leaves the catalog to demo mode", async () => {
    const { sqlite, env } = freshInstallation();
    env.EDGE_EVER_DEMO_MODE = "true";

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual([]);
    expect(exampleCounts(sqlite)).toEqual({});
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memos").get()).toEqual({ count: 1 });
  });
});
