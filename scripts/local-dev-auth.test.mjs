import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createLocalDevelopmentSession } from "./local-dev-auth.mjs";
import { verifyPassword } from "../apps/api/src/auth-crypto.ts";

const databases = [];
const createDatabase = () => {
  const db = new Database(":memory:");
  databases.push(db);
  for (const path of globSync("migrations/*.sql").sort()) db.exec(readFileSync(path, "utf8"));
  return db;
};
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("local development real sessions", () => {
  test("creates a real owner, workspace membership and hashed session on a fresh database", async () => {
    const db = createDatabase();
    const session = await createLocalDevelopmentSession(db);
    const user = db.query("SELECT * FROM users").get();
    expect(session.username).toBe("owner");
    expect(await verifyPassword("edgeever-local-dev", user.password_hash)).toBe(true);
    expect(db.query("SELECT * FROM workspace_members WHERE user_id = ?").get(user.id)).toMatchObject({
      workspace_id: "ws_default", role: "owner",
    });
    expect(db.query("SELECT * FROM sessions WHERE user_id = ?").get(user.id)).toMatchObject({
      token_hash: createHash("sha256").update(session.token).digest("hex"), revoked_at: null,
    });
  });

  test("reuses the existing owner without overwriting credentials, data, or previous sessions", async () => {
    const db = createDatabase();
    const first = await createLocalDevelopmentSession(db);
    db.query("UPDATE users SET username = 'existing-owner', password_hash = 'preserve-me'").run();
    const second = await createLocalDevelopmentSession(db);
    expect(second.username).toBe("existing-owner");
    expect(second.token).not.toBe(first.token);
    expect(db.query("SELECT password_hash FROM users").all()).toEqual([{ password_hash: "preserve-me" }]);
    expect(db.query("SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL").get().count).toBe(2);
  });

  test("does not bypass a disabled owner", async () => {
    const db = createDatabase();
    await createLocalDevelopmentSession(db);
    db.query("UPDATE users SET is_disabled = 1").run();
    await expect(createLocalDevelopmentSession(db)).rejects.toThrow("disabled");
    expect(db.query("SELECT COUNT(*) AS count FROM users").get().count).toBe(1);
  });
});
