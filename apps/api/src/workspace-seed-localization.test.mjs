import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { WELCOME_MEMO_REPAIRED_CONTENT_HASH, WELCOME_MEMO_SEED_CONTENT_HASH } from "@edgeever/shared/default-workspace-seeds";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { updateMemoRecord } from "./memo-service.ts";
import {
  DEFAULT_WORKSPACE_ID,
  createDefaultNotebookRows,
  ensureUserWorkspace,
  markWorkspaceSeedLocalizationPendingStatement,
} from "./workspace-provisioning.ts";

const LOCALIZATION_MIGRATION = "0070_workspace_seed_localization.sql";
const migrationFiles = globSync("migrations/*.sql").sort();
const opened = [];
afterEach(() => opened.splice(0).forEach((sqlite) => sqlite.close()));

const migrate = (sqlite, filter = () => true) => {
  for (const file of migrationFiles.filter(filter)) sqlite.exec(readFileSync(file, "utf8"));
};

const openDatabase = () => {
  const sqlite = new Database(":memory:");
  opened.push(sqlite);
  return { sqlite, db: createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-seed-localization-unused").db };
};

const freshInstallation = () => {
  const database = openDatabase();
  migrate(database.sqlite);
  return database;
};

// An installation that ran every migration before this change, then upgraded.
const upgradedInstallation = (prepare) => {
  const database = openDatabase();
  migrate(database.sqlite, (file) => file < `migrations/${LOCALIZATION_MIGRATION}`);
  prepare(database.sqlite);
  migrate(database.sqlite, (file) => file >= `migrations/${LOCALIZATION_MIGRATION}`);
  return database;
};

const addUser = (sqlite, id, username = id) => sqlite
  .query("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, 'unused', ?)")
  .run(id, username, username);

const notebookNames = (sqlite, workspaceId = DEFAULT_WORKSPACE_ID) => Object.fromEntries(
  sqlite.query("SELECT slug, name FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 ORDER BY sort_order")
    .all(workspaceId)
    .map((row) => [row.slug, row.name]),
);

const welcome = (sqlite) => sqlite.query(
  `SELECT m.title, m.excerpt, c.content_markdown, c.content_text, c.content_json, c.content_hash, c.revision,
          s.title AS search_title, s.content_text AS search_text
   FROM memos m
   JOIN memo_contents c ON c.memo_id = m.id
   LEFT JOIN memo_search_documents s ON s.memo_id = m.id
   WHERE m.id = 'memo_welcome'`,
).get();

const pendingWorkspaces = (sqlite) => sqlite
  .query("SELECT workspace_id FROM workspace_seed_localizations ORDER BY workspace_id")
  .all()
  .map((row) => row.workspace_id);

const templateNames = (sqlite, workspaceId) => sqlite
  .query("SELECT name FROM memo_templates WHERE workspace_id = ? ORDER BY id")
  .all(workspaceId)
  .map((row) => row.name);

const searchMatches = (sqlite, query) => sqlite
  .query("SELECT memo_id FROM memos_fts WHERE memos_fts MATCH ?")
  .all(query)
  .map((row) => row.memo_id);

const CHINESE_NOTEBOOKS = {
  inbox: "等待分类",
  "work-projects": "工作项目",
  "learning-resources": "学习资料",
  "creative-ideas": "灵感创作",
  "personal-life": "生活个人",
};

describe("fresh installation", () => {
  test("waits for the first sign-in to localize the default workspace", () => {
    const { sqlite } = freshInstallation();

    expect(pendingWorkspaces(sqlite)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(notebookNames(sqlite)).toEqual(CHINESE_NOTEBOOKS);
  });

  test("localizes notebooks, the welcome note, its search data, and templates to the owner's UI locale", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");

    expect(await ensureUserWorkspace(db, "usr_owner", "admin", "pl")).toEqual({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "owner",
    });

    expect(notebookNames(sqlite)).toEqual({
      inbox: "Skrzynka",
      "work-projects": "Projekty zawodowe",
      "learning-resources": "Materiały do nauki",
      "creative-ideas": "Pomysły i twórczość",
      "personal-life": "Życie prywatne",
    });
    const note = welcome(sqlite);
    expect(note.title).toBe("Witaj w EdgeEver");
    expect(note.search_title).toBe("Witaj w EdgeEver");
    expect(note.excerpt).toStartWith("To Twoja pierwsza notatka");
    expect(note.content_markdown).toStartWith("## Witaj w EdgeEver\n\nTo Twoja pierwsza notatka");
    expect(note.search_text).toBe(note.content_text);
    expect(JSON.parse(note.content_json).content[0]).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Witaj w EdgeEver" }],
    });
    expect(note.content_hash).not.toBe(WELCOME_MEMO_SEED_CONTENT_HASH);
    expect(note.revision).toBe(2);
    expect(searchMatches(sqlite, "Witaj")).toEqual(["memo_welcome"]);
    expect(templateNames(sqlite, DEFAULT_WORKSPACE_ID)).not.toContain("灵感速记");
    expect(searchMatches(sqlite, "Skrzynka")).toEqual([]);
    expect(templateNames(sqlite, DEFAULT_WORKSPACE_ID)).toContain("Szybka notatka");
    expect(pendingWorkspaces(sqlite)).toEqual([]);
  });

  test("runs once: a later sign-in in another language changes nothing", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");

    await ensureUserWorkspace(db, "usr_owner", "admin", "en-US");
    const afterFirst = { notebooks: notebookNames(sqlite), note: welcome(sqlite) };
    await ensureUserWorkspace(db, "usr_owner", "admin", "ja");

    expect(afterFirst.notebooks.inbox).toBe("Inbox");
    expect(afterFirst.note.title).toBe("Welcome to EdgeEver");
    expect({ notebooks: notebookNames(sqlite), note: welcome(sqlite) }).toEqual(afterFirst);
  });

  test("retries on the next sign-in when the first attempt fails after claiming the workspace", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    const batch = db.batch.bind(db);
    db.batch = async () => {
      throw new Error("database unavailable");
    };

    await expect(ensureUserWorkspace(db, "usr_owner", "admin", "ja")).rejects.toThrow("database unavailable");
    expect(sqlite.query("SELECT role FROM workspace_members WHERE user_id = 'usr_owner'").get())
      .toEqual({ role: "owner" });
    expect(pendingWorkspaces(sqlite)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(notebookNames(sqlite)).toEqual(CHINESE_NOTEBOOKS);

    db.batch = batch;
    await ensureUserWorkspace(db, "usr_owner", "admin", "ja");

    expect(notebookNames(sqlite).inbox).toBe("受信トレイ");
    expect(welcome(sqlite).title).toBe("EdgeEver へようこそ");
    expect(templateNames(sqlite, DEFAULT_WORKSPACE_ID)).toContain("ひらめきメモ");
    expect(pendingWorkspaces(sqlite)).toEqual([]);
  });

  test("keeps notebook names and welcome content that no longer match the seed", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    sqlite.exec(`
      UPDATE notebooks SET name = 'My projects' WHERE slug = 'work-projects';
      UPDATE memo_contents SET content_hash = 'edited' WHERE memo_id = 'memo_welcome';
      UPDATE memo_templates SET content_markdown = '## Mine' WHERE id = 'ws_default_template_meeting';
    `);
    const before = welcome(sqlite);

    await ensureUserWorkspace(db, "usr_owner", "admin", "en-US");

    expect(notebookNames(sqlite)).toMatchObject({ inbox: "Inbox", "work-projects": "My projects" });
    expect(welcome(sqlite)).toEqual(before);
    expect(templateNames(sqlite, DEFAULT_WORKSPACE_ID)).toEqual(expect.arrayContaining(["会议纪要", "Quick Spark"]));
    expect(pendingWorkspaces(sqlite)).toEqual([]);
  });

  test("a delayed concurrent first sign-in does not restore seeds removed after the faster one finished", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    const batch = db.batch.bind(db);
    let reachedBatch;
    const delayedReachedBatch = new Promise((resolve) => { reachedBatch = resolve; });
    let releaseBatch;
    const delayedRelease = new Promise((resolve) => { releaseBatch = resolve; });
    let delayed = true;
    db.batch = async (statements) => {
      if (delayed) {
        delayed = false;
        reachedBatch();
        await delayedRelease;
      }
      return batch(statements);
    };

    // The slow sign-in has seen the pending row and holds its batch.
    const slow = ensureUserWorkspace(db, "usr_owner", "admin", "ja");
    await delayedReachedBatch;
    await ensureUserWorkspace(db, "usr_owner", "admin", "en-US");
    sqlite.exec(`
      DELETE FROM memo_templates WHERE workspace_id = 'ws_default' AND name = 'Quick Spark';
      DELETE FROM ai_prompt_templates WHERE workspace_id = 'ws_default';
    `);
    const afterFast = {
      notebooks: notebookNames(sqlite),
      note: welcome(sqlite),
      templates: templateNames(sqlite, DEFAULT_WORKSPACE_ID),
    };
    releaseBatch();
    await slow;

    expect(afterFast.notebooks.inbox).toBe("Inbox");
    expect(afterFast.templates).not.toContain("Quick Spark");
    expect({
      notebooks: notebookNames(sqlite),
      note: welcome(sqlite),
      templates: templateNames(sqlite, DEFAULT_WORKSPACE_ID),
    }).toEqual(afterFast);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM ai_prompt_templates WHERE workspace_id = 'ws_default'").get())
      .toEqual({ count: 0 });
    expect(pendingWorkspaces(sqlite)).toEqual([]);
  });

  test("keeps a welcome note whose title alone was edited before the first sign-in localized it", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    const edited = await updateMemoRecord(
      db,
      DEFAULT_WORKSPACE_ID,
      "memo_welcome",
      { title: "My first note" },
      { actorType: "user", actorId: "usr_owner" },
      "admin",
    );
    expect(edited.error).toBeUndefined();
    const before = welcome(sqlite);
    expect(before.content_hash).toBe(WELCOME_MEMO_REPAIRED_CONTENT_HASH);
    expect(pendingWorkspaces(sqlite)).toEqual([DEFAULT_WORKSPACE_ID]);

    await ensureUserWorkspace(db, "usr_owner", "admin", "en-US");

    expect(welcome(sqlite)).toEqual(before);
    expect(before.title).toBe("My first note");
    expect(notebookNames(sqlite).inbox).toBe("Inbox");
    expect(pendingWorkspaces(sqlite)).toEqual([]);
  });

  test("falls back to English for an unsupported language", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");

    await ensureUserWorkspace(db, "usr_owner", "admin", "it-IT,it;q=0.9");

    expect(notebookNames(sqlite).inbox).toBe("Inbox");
    expect(welcome(sqlite).title).toBe("Welcome to EdgeEver");
  });

  test("keeps the Chinese seed when the client sends no language", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");

    await ensureUserWorkspace(db, "usr_owner", "admin", undefined);

    expect(notebookNames(sqlite)).toEqual(CHINESE_NOTEBOOKS);
    expect(welcome(sqlite).title).toBe("欢迎来到 EdgeEver");
    expect(pendingWorkspaces(sqlite)).toEqual([]);
  });
});

describe("existing installation", () => {
  test("keeps the default workspace unchanged after upgrading", async () => {
    const { sqlite, db } = upgradedInstallation((database) => {
      addUser(database, "usr_owner", "admin");
      database.exec("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws_default', 'usr_owner', 'owner')");
    });
    const before = welcome(sqlite);

    expect(pendingWorkspaces(sqlite)).toEqual([]);
    await ensureUserWorkspace(db, "usr_owner", "admin", "pl");

    expect(notebookNames(sqlite)).toEqual(CHINESE_NOTEBOOKS);
    expect(welcome(sqlite)).toEqual(before);
  });

  test("treats an unclaimed workspace that already holds notes as existing data", async () => {
    const { sqlite, db } = upgradedInstallation((database) => {
      database.exec(`
        INSERT INTO memos (id, notebook_id, title, excerpt, tags_json, created_by, updated_by)
        VALUES ('memo_kept', 'nb_projects', 'Kept', '', '[]', 'system', 'system');
      `);
    });
    addUser(sqlite, "usr_owner", "admin");

    expect(pendingWorkspaces(sqlite)).toEqual([]);
    await ensureUserWorkspace(db, "usr_owner", "admin", "pl");

    expect(notebookNames(sqlite)).toEqual(CHINESE_NOTEBOOKS);
    expect(welcome(sqlite).title).toBe("欢迎来到 EdgeEver");
  });

  test("treats an installation that already has users as existing data", () => {
    const { sqlite } = upgradedInstallation((database) => addUser(database, "usr_previous"));

    expect(pendingWorkspaces(sqlite)).toEqual([]);
  });
});

describe("member workspaces", () => {
  // Mirrors POST /api/v1/users: the owner creates the workspace in the
  // owner's language, before the member has ever signed in.
  const createMember = async (sqlite, db, ownerLocale) => {
    addUser(sqlite, "usr_member", "member");
    sqlite.exec(`
      INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_member', 'Member', 1);
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws_member', 'usr_member', 'member');
    `);
    await db.batch([
      ...createDefaultNotebookRows("ws_member", ownerLocale).map((notebook) => db.prepare(
        `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, icon, color, sort_order)
         VALUES (?, 'ws_member', NULL, ?, ?, 'notebook', ?, ?)`,
      ).bind(notebook.id, notebook.name, notebook.slug, notebook.color, notebook.sortOrder)),
      markWorkspaceSeedLocalizationPendingStatement(db, "ws_member"),
    ]);
  };

  test("uses the member's language, not the owner's", async () => {
    const { sqlite, db } = freshInstallation();
    await createMember(sqlite, db, "en-US");
    expect(notebookNames(sqlite, "ws_member").inbox).toBe("Inbox");
    expect(templateNames(sqlite, "ws_member")).toEqual([]);

    expect(await ensureUserWorkspace(db, "usr_member", "member", "ja")).toEqual({
      workspaceId: "ws_member",
      role: "member",
    });

    expect(notebookNames(sqlite, "ws_member")).toEqual({
      inbox: "受信トレイ",
      "work-projects": "仕事のプロジェクト",
      "learning-resources": "学習資料",
      "creative-ideas": "アイデアと創作",
      "personal-life": "暮らしと個人",
    });
    expect(templateNames(sqlite, "ws_member")).toContain("ひらめきメモ");
    expect(pendingWorkspaces(sqlite)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(notebookNames(sqlite)).toEqual(CHINESE_NOTEBOOKS);
  });

  test("creates a self-provisioned workspace directly in the user's language", async () => {
    const { sqlite, db } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    addUser(sqlite, "usr_writer", "writer");
    await ensureUserWorkspace(db, "usr_owner", "admin", "zh-CN");

    const workspace = await ensureUserWorkspace(db, "usr_writer", "writer", "pl-PL,pl;q=0.9");

    expect(workspace.role).toBe("member");
    expect(notebookNames(sqlite, workspace.workspaceId).inbox).toBe("Skrzynka");
    expect(templateNames(sqlite, workspace.workspaceId)).toContain("Szybka notatka");
  });
});
