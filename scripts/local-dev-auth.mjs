import { randomBytes, createHash } from "node:crypto";
import { hashPassword } from "../apps/api/src/auth-crypto.ts";

// Development fixtures only: never imported by either production runtime.
// Reuse the owner of the existing local workspace without changing credentials.
export const createLocalDevelopmentSession = async (database) => {
  const passwordHash = await hashPassword("edgeever-local-dev");
  return database.transaction(() => {
    let user = database.query(`
      SELECT u.id, u.username FROM users u
      JOIN workspace_members wm ON wm.user_id = u.id
      WHERE wm.workspace_id = 'ws_default' AND wm.role = 'owner' AND u.is_disabled = 0
    `).get();
    if (!user) {
      const owner = database.query(`
        SELECT user_id FROM workspace_members WHERE workspace_id = 'ws_default' AND role = 'owner'
      `).get();
      if (owner) throw new Error("The local workspace owner is disabled; refusing to bypass account status.");
      user = database.query("SELECT id, username FROM users WHERE is_disabled = 0 ORDER BY created_at, id LIMIT 1").get();
      if (!user) {
        user = { id: `usr_${crypto.randomUUID()}`, username: "owner" };
        database.query("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)")
          .run(user.id, user.username, passwordHash, "Local Developer");
      }
      database.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws_default', ?, 'owner')")
        .run(user.id);
    }
    const token = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const maxAge = 400 * 24 * 60 * 60;
    database.query(`
      INSERT INTO sessions (id, user_id, token_hash, device_id, user_agent, device_label, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `sess_${crypto.randomUUID()}`, user.id, createHash("sha256").update(token).digest("hex"),
      `local-dev_${crypto.randomUUID()}`, "EdgeEver Local Dev", "Local development",
      new Date(Date.now() + maxAge * 1000).toISOString(), now, now,
    );
    return { token, maxAge, username: user.username };
  })();
};
