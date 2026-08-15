import { UserCreateSchema, UserUpdateSchema, type InstanceUser } from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { auditStatement } from "./audit";
import type { AppContext, AppEnv, AuthContext } from "./api-context";
import { hashPassword } from "./auth-crypto";
import { isProtectedDemoAccount } from "./demo-mode";
import { createId, isoNow } from "./entity-utils";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "./http-errors";
import { requireOwner } from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";
import {
  createDefaultNotebookRows,
  createWorkspaceDefaultSeedStatements,
} from "./workspace-provisioning";

export type InstanceUserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  is_disabled: number;
  last_login_at: string | null;
  created_at: string;
  role: "owner" | "member";
};

type UserRouteDependencies = {
  authenticateRequest: (context: AppContext, touch: boolean) => Promise<AuthContext | null>;
  getInstanceUser: (database: DatabaseAdapter, userId: string) => Promise<InstanceUserRow | null>;
};

export const mapInstanceUser = (row: InstanceUserRow): InstanceUser => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  role: row.role,
  isDisabled: Boolean(row.is_disabled),
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

const requireOwnerRequest = async (
  context: AppContext,
  authenticateRequest: UserRouteDependencies["authenticateRequest"],
) => {
  const auth = await authenticateRequest(context, true);
  if (!auth) return unauthorized(context, "Authentication required.");
  context.set("auth", auth);
  return requireOwner(context);
};

export const registerUserRoutes = (
  app: Hono<AppEnv>,
  dependencies: UserRouteDependencies,
) => {
  app.get("/api/v1/users", async (context) => {
    const denied = await requireOwnerRequest(context, dependencies.authenticateRequest);
    if (denied) return denied;

    const rows = await context.env.storage.db.prepare(
      `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_disabled,
              u.last_login_at, u.created_at, wm.role
       FROM users u
       INNER JOIN workspace_members wm ON wm.user_id = u.id
       ORDER BY wm.role = 'owner' DESC, u.created_at ASC`,
    ).all<InstanceUserRow>();

    return context.json({ users: rows.results.map(mapInstanceUser) });
  });

  app.post("/api/v1/users", zValidator("json", UserCreateSchema), async (context) => {
    const denied = await requireOwnerRequest(context, dependencies.authenticateRequest);
    if (denied) return denied;

    const input = context.req.valid("json");
    const existing = await context.env.storage.db.prepare(`SELECT id FROM users WHERE username = ?`)
      .bind(input.username)
      .first();
    if (existing) return conflict(context, "username_exists", "Username already exists.");

    const userId = createId("usr");
    const workspaceId = createId("ws");
    const now = isoNow();
    const passwordHash = await hashPassword(input.password);
    const notebooks = createDefaultNotebookRows(workspaceId);
    const statements = [
      context.env.storage.db.prepare(
        `INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(userId, input.username, passwordHash, input.displayName ?? input.username, now, now),
      context.env.storage.db.prepare(
        `INSERT INTO workspaces (id, name, is_personal, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
      ).bind(workspaceId, `${input.displayName ?? input.username}'s workspace`, now, now),
      context.env.storage.db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`,
      ).bind(workspaceId, userId, now),
      ...notebooks.map((notebook) => context.env.storage.db.prepare(
        `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 'notebook', ?, ?, ?, ?)`,
      ).bind(notebook.id, workspaceId, notebook.name, notebook.slug, notebook.color, notebook.sortOrder, now, now)),
      ...createWorkspaceDefaultSeedStatements(context.env.storage.db, workspaceId, now),
      auditStatement(context.env.storage.db, "user", context.get("auth").actorId, "user.create", "user", userId, {
        username: input.username,
      }),
    ];
    await context.env.storage.db.batch(statements);

    const user = await dependencies.getInstanceUser(context.env.storage.db, userId);
    return context.json({ user: user ? mapInstanceUser(user) : null }, 201);
  });

  app.patch("/api/v1/users/:id", zValidator("json", UserUpdateSchema), async (context) => {
    const denied = await requireOwnerRequest(context, dependencies.authenticateRequest);
    if (denied) return denied;

    const userId = context.req.param("id");
    const input = context.req.valid("json");
    const current = await dependencies.getInstanceUser(context.env.storage.db, userId);
    if (!current) return notFound(context, "User not found");
    if (
      isProtectedDemoAccount(
        context.env.EDGE_EVER_DEMO_MODE,
        context.env.EDGE_EVER_AUTH_USERNAME,
        current.username,
      ) && (input.password !== undefined || input.isDisabled !== undefined)
    ) {
      return forbidden(context, "The demo owner account uses fixed credentials and cannot be modified.");
    }
    if (current.role === "owner" && input.isDisabled === true) {
      return badRequest(context, "The instance owner cannot be disabled.");
    }

    const updates: string[] = [];
    const binds: unknown[] = [];
    if (input.displayName !== undefined) {
      updates.push("display_name = ?");
      binds.push(input.displayName);
    }
    if (input.password !== undefined) {
      updates.push("password_hash = ?");
      binds.push(await hashPassword(input.password));
    }
    if (input.isDisabled !== undefined) {
      updates.push("is_disabled = ?");
      binds.push(input.isDisabled ? 1 : 0);
    }
    updates.push("updated_at = ?");
    binds.push(isoNow(), userId);

    const statements = [
      context.env.storage.db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...binds),
      auditStatement(context.env.storage.db, "user", context.get("auth").actorId, "user.update", "user", userId, {
        passwordReset: input.password !== undefined,
        isDisabled: input.isDisabled,
      }),
    ];
    if (input.password !== undefined || input.isDisabled === true) {
      statements.push(
        context.env.storage.db.prepare(
          `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
        ).bind(isoNow(), userId),
      );
    }
    await context.env.storage.db.batch(statements);

    const user = await dependencies.getInstanceUser(context.env.storage.db, userId);
    return context.json({ user: user ? mapInstanceUser(user) : null });
  });
};
