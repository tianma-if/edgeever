import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";
import { DEMO_SEED_MEMOS, DEMO_SEED_ATTACHMENT_RESOURCES } from "../apps/api/src/demo-seed-data.ts";
import { createLocalDevelopmentSession } from "./local-dev-auth.mjs";
import { assertLocalResetPath, restoreLocalDemoData } from "./reset-local-demo.mjs";

const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "edgeever-demo-reset-"));
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const path of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(path, "utf8"));
  return {
    sqlite,
    storage: createSelfHostedStorageAdapter(sqlite, directory),
    dispose() { sqlite.close(); rmSync(directory, { recursive: true, force: true }); },
  };
};

describe("local DEV Demo reset", () => {
  test("replaces dirty data and blobs with the exact seed while retaining login and AI settings", async () => {
    const { sqlite, storage, dispose } = fixture();
    try {
      await createLocalDevelopmentSession(sqlite);
      sqlite.exec("INSERT INTO ai_provider_configs (id, workspace_id, provider, display_name, base_url, api_key_encrypted) VALUES ('keep-provider', 'ws_default', 'openai-compatible', 'Local AI', 'https://example.com', 'encrypted-local-key')");
      const users = sqlite.query("SELECT * FROM users").all();
      const sessions = sqlite.query("SELECT * FROM sessions").all();
      const providers = sqlite.query("SELECT * FROM ai_provider_configs").all();
      await restoreLocalDemoData(storage);
      sqlite.exec("INSERT INTO notebooks (id, name, workspace_id) VALUES ('junk-book', 'Screenshot junk', 'ws_default')");
      sqlite.exec("INSERT INTO memos (id, notebook_id, title, workspace_id) VALUES ('junk-note', 'junk-book', 'Junk note', 'ws_default')");
      sqlite.query("UPDATE memos SET title = 'Modified demo' WHERE id = ?").run(DEMO_SEED_MEMOS[0].id);
      await storage.resources.put("junk-blob", new TextEncoder().encode("junk"));
      sqlite.exec("INSERT INTO resources (id, memo_id, bucket_name, object_key, kind, mime_type, filename, byte_size, sha256) VALUES ('junk-file', 'junk-note', 'local', 'junk-blob', 'attachment', 'text/plain', 'junk.txt', 4, 'unused')");
      const oldIdentity = sqlite.query("SELECT created_at FROM workspaces WHERE id = 'ws_default'").get().created_at;
      sqlite.exec("UPDATE maintenance_leases SET expires_at = '2000-01-01T00:00:00.000Z'");

      expect(await restoreLocalDemoData(storage)).toMatchObject({ memoCount: DEMO_SEED_MEMOS.length });
      expect(sqlite.query("SELECT id FROM memos WHERE id = 'junk-note'").get()).toBeNull();
      expect(sqlite.query("SELECT id FROM notebooks WHERE id = 'junk-book'").get()).toBeNull();
      expect(await storage.resources.get("junk-blob")).toBeNull();
      expect(sqlite.query("SELECT * FROM users").all()).toEqual(users);
      expect(sqlite.query("SELECT * FROM sessions").all()).toEqual(sessions);
      expect(sqlite.query("SELECT * FROM ai_provider_configs").all()).toEqual(providers);
      expect(sqlite.query("SELECT created_at FROM workspaces WHERE id = 'ws_default'").get().created_at).not.toBe(oldIdentity);
      for (const memo of DEMO_SEED_MEMOS) {
        expect(sqlite.query("SELECT title FROM memos WHERE id = ?").get(memo.id).title).toBe(memo.title);
        expect(sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(memo.id).content_markdown).toBe(memo.markdown);
      }
      const resources = sqlite.query("SELECT object_key FROM resources").all();
      expect(resources).toHaveLength(DEMO_SEED_ATTACHMENT_RESOURCES.length);
      for (const resource of resources) expect(await storage.resources.get(resource.object_key)).not.toBeNull();
      await expect(restoreLocalDemoData(storage)).rejects.toThrow("cooling down");
    } finally { dispose(); }
  });

  test("refuses external object storage before mutating any notes", async () => {
    const { sqlite, storage, dispose } = fixture();
    try {
      sqlite.exec("INSERT INTO object_storage_configs (id, provider, display_name) VALUES ('external', 's3', 'Remote bucket')");
      const before = sqlite.query("SELECT * FROM memos").all();
      await expect(restoreLocalDemoData(storage)).rejects.toThrow("external storage");
      expect(sqlite.query("SELECT * FROM memos").all()).toEqual(before);
      expect(sqlite.query("SELECT * FROM maintenance_leases").all()).toEqual([]);
    } finally { dispose(); }
  });

  test("rejects symlinks outside the local state directory", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "edgeever-reset-path-")));
    try {
      mkdirSync(join(root, ".wrangler"));
      expect(assertLocalResetPath(root)).toBe(join(root, ".wrangler/state"));
      symlinkSync(tmpdir(), join(root, ".wrangler/state"));
      expect(() => assertLocalResetPath(root)).toThrow("symlinked");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
