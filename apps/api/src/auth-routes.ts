import {
  ChangePasswordSchema,
  LoginDeviceSessionUpdateSchema,
  LoginSchema,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { audit, auditStatement } from "./audit";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordLoginFailure,
  resolveLoginRateLimitConfig,
  type LoginAttemptKey,
} from "./auth-login-limiter";
import {
  groupLoginDeviceSessions,
  type LoginDeviceSessionRow,
} from "./auth-session-devices";
import type {
  AppContext,
  AppEnv,
  AuthContext,
  Bindings,
} from "./api-context";
import { hashPassword, verifyPassword } from "./auth-crypto";
import type { InstanceAuthMode } from "./auth-state";
import { isoNow } from "./entity-utils";
import {
  apiError,
  authNotConfigured,
  forbidden,
  notFound,
  unauthorized,
} from "./http-errors";
import type { DatabaseAdapter } from "./storage-contract";

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  is_disabled: number;
};

type LoginSession = {
  id: string;
  token: string;
  maxAge: number;
};

type UserWorkspace = {
  workspaceId: string;
  role: "owner" | "member";
};

type AuthRouteDependencies = {
  authenticateRequest: (context: AppContext, touch: boolean) => Promise<AuthContext | null>;
  authenticateSession: (context: AppContext, touch: boolean) => Promise<AuthContext | null>;
  createSession: (context: AppContext, user: UserRow, requestedDeviceId?: string) => Promise<LoginSession>;
  ensureUserWorkspace: (
    database: DatabaseAdapter,
    userId: string,
    username: string,
    locale?: string | null,
  ) => Promise<UserWorkspace>;
  getBearerToken: (context: AppContext) => string | null;
  getInstanceAuthMode: (environment: Bindings) => Promise<InstanceAuthMode>;
  getLoginAttemptKeys: (context: AppContext, username: string) => Promise<LoginAttemptKey[]>;
  isDemoEnvironment: (environment: Bindings) => boolean;
  isDemoMode: (environment: Bindings) => boolean;
  revokeSession: (database: DatabaseAdapter, token: string) => Promise<void>;
  setSessionCookie: (context: AppContext, token: string, maxAge: number) => void;
  tooManyLoginAttempts: (context: AppContext, retryAfterSeconds: number) => Response;
  verifyLogin: (environment: Bindings, username: string, password: string) => Promise<UserRow | null>;
};

type InteractiveAuthContext = AuthContext & {
  actorId: string;
  sessionId: string;
};

const requireInteractiveSession = async (
  context: AppContext,
  authenticate: AuthRouteDependencies["authenticateRequest"],
): Promise<InteractiveAuthContext | null> => {
  const auth = await authenticate(context, true);
  if (auth?.kind !== "user" || !auth.actorId || !auth.sessionId) return null;
  return { ...auth, actorId: auth.actorId, sessionId: auth.sessionId };
};

export const registerAuthRoutes = (
  app: Hono<AppEnv>,
  dependencies: AuthRouteDependencies,
) => {
  app.get("/api/v1/auth/session", async (context) => {
    const authMode = await dependencies.getInstanceAuthMode(context.env);

    if (authMode === "unconfigured") return authNotConfigured(context);
    if (authMode === "disabled") {
      return context.json({
        authRequired: false,
        authenticated: true,
        demoMode: dependencies.isDemoEnvironment(context.env),
        user: {
          id: "local",
          username: "owner",
          displayName: "Owner",
          role: "owner",
        },
      });
    }

    const auth = await dependencies.authenticateRequest(context, false);
    return context.json({
      authRequired: true,
      authenticated: Boolean(auth && auth.kind === "user"),
      demoMode: dependencies.isDemoEnvironment(context.env),
      user: auth?.kind === "user" ? {
        id: auth.actorId,
        username: auth.username,
        displayName: auth.displayName,
        role: auth.role,
      } : null,
    });
  });

  app.get("/api/v1/auth/sessions", async (context) => {
    const auth = await requireInteractiveSession(context, dependencies.authenticateRequest);
    if (!auth) return unauthorized(context, "An interactive user session is required.");

    const now = isoNow();
    const rows = await context.env.storage.db.prepare(
      `SELECT id, device_id, user_agent, device_label, ip_address, ip_country, ip_region, expires_at, created_at, last_seen_at
       FROM sessions
       WHERE user_id = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY COALESCE(last_seen_at, created_at) DESC
       LIMIT 200`,
    ).bind(auth.actorId, now).all<LoginDeviceSessionRow>();

    return context.json({
      sessions: groupLoginDeviceSessions(rows.results, auth.sessionId).slice(0, 50),
    });
  });

  app.patch(
    "/api/v1/auth/sessions/:sessionId",
    zValidator("json", LoginDeviceSessionUpdateSchema),
    async (context) => {
      const auth = await requireInteractiveSession(context, dependencies.authenticateRequest);
      if (!auth) return unauthorized(context, "An interactive user session is required.");

      const sessionId = context.req.param("sessionId");
      const input = context.req.valid("json");
      const now = isoNow();
      const session = await context.env.storage.db.prepare(
        `SELECT id, device_id FROM sessions
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      ).bind(sessionId, auth.actorId, now).first<{ id: string; device_id: string | null }>();

      if (!session) return notFound(context, "Login session not found.");

      const statement = session.device_id
        ? context.env.storage.db.prepare(
          `UPDATE sessions SET device_label = ?
           WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`,
        ).bind(input.label || null, auth.actorId, session.device_id)
        : context.env.storage.db.prepare(
          `UPDATE sessions SET device_label = ? WHERE id = ?`,
        ).bind(input.label || null, session.id);

      await context.env.storage.db.batch([
        statement,
        auditStatement(context.env.storage.db, "user", auth.actorId, "auth.session_label_update", "session", session.id, {
          label: input.label || null,
        }),
      ]);
      return context.json({ ok: true });
    },
  );

  app.delete("/api/v1/auth/sessions", async (context) => {
    const auth = await requireInteractiveSession(context, dependencies.authenticateRequest);
    if (!auth) return unauthorized(context, "An interactive user session is required.");

    const now = isoNow();
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `UPDATE sessions
         SET revoked_at = ?
         WHERE user_id = ? AND id != ? AND revoked_at IS NULL AND expires_at > ?`,
      ).bind(now, auth.actorId, auth.sessionId, now),
      auditStatement(context.env.storage.db, "user", auth.actorId, "auth.sessions_revoke_others", "session", auth.sessionId, {}),
    ]);
    return context.json({ ok: true });
  });

  app.delete("/api/v1/auth/sessions/:sessionId", async (context) => {
    const auth = await requireInteractiveSession(context, dependencies.authenticateRequest);
    if (!auth) return unauthorized(context, "An interactive user session is required.");

    const sessionId = context.req.param("sessionId");
    if (sessionId === auth.sessionId) {
      return apiError(context, "current_session_cannot_be_revoked", "The current session cannot be revoked here.", 400);
    }

    const now = isoNow();
    const session = await context.env.storage.db.prepare(
      `SELECT id, device_id FROM sessions
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    ).bind(sessionId, auth.actorId, now).first<{ id: string; device_id: string | null }>();
    if (!session) return notFound(context, "Login session not found.");

    const currentSession = await context.env.storage.db.prepare(
      `SELECT device_id FROM sessions WHERE id = ? AND user_id = ?`,
    ).bind(auth.sessionId, auth.actorId).first<{ device_id: string | null }>();
    if (session.device_id && currentSession?.device_id === session.device_id) {
      return apiError(context, "current_session_cannot_be_revoked", "The current device cannot be revoked here.", 400);
    }

    await context.env.storage.db.batch([
      session.device_id
        ? context.env.storage.db.prepare(
          `UPDATE sessions SET revoked_at = ?
           WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`,
        ).bind(now, auth.actorId, session.device_id)
        : context.env.storage.db.prepare(
          `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
        ).bind(now, session.id),
      auditStatement(context.env.storage.db, "user", auth.actorId, "auth.session_revoke", "session", session.id, {}),
    ]);
    return context.json({ ok: true });
  });

  app.post("/api/v1/auth/login", zValidator("json", LoginSchema), async (context) => {
    const authMode = await dependencies.getInstanceAuthMode(context.env);
    if (authMode === "unconfigured") return authNotConfigured(context);

    const input = context.req.valid("json");
    const loginAttemptKeys = await dependencies.getLoginAttemptKeys(context, input.username);
    const rateLimitConfig = resolveLoginRateLimitConfig(context.env);
    const currentRateLimit = await checkLoginRateLimit(
      context.env.storage.db,
      loginAttemptKeys,
      rateLimitConfig,
    );
    if (currentRateLimit.retryAfterSeconds > 0) {
      return dependencies.tooManyLoginAttempts(context, currentRateLimit.retryAfterSeconds);
    }

    const user = await dependencies.verifyLogin(context.env, input.username, input.password);
    if (!user) {
      const updatedRateLimit = await recordLoginFailure(
        context.env.storage.db,
        loginAttemptKeys,
        rateLimitConfig,
      );
      if (updatedRateLimit.retryAfterSeconds > 0) {
        await audit(
          context.env.storage.db,
          "system",
          null,
          "auth.login_rate_limited",
          "auth",
          loginAttemptKeys[0]?.key ?? "unknown",
          { retryAfterSeconds: updatedRateLimit.retryAfterSeconds },
        );
        return dependencies.tooManyLoginAttempts(context, updatedRateLimit.retryAfterSeconds);
      }
      return unauthorized(context, "Username or password is incorrect.");
    }

    await clearLoginAttempts(context.env.storage.db, loginAttemptKeys);
    const workspace = await dependencies.ensureUserWorkspace(
      context.env.storage.db,
      user.id,
      user.username,
      context.req.header("accept-language"),
    );
    const session = await dependencies.createSession(context, user, input.deviceId);
    dependencies.setSessionCookie(context, session.token, session.maxAge);

    const now = isoNow();
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(now, now, user.id),
      auditStatement(context.env.storage.db, "user", user.id, "auth.login", "session", session.id, {
        username: user.username,
      }),
    ]);

    return context.json({
      authRequired: true,
      authenticated: true,
      demoMode: dependencies.isDemoEnvironment(context.env),
      sessionToken: session.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: workspace.role,
      },
    });
  });

  app.post(
    "/api/v1/auth/change-password",
    zValidator("json", ChangePasswordSchema),
    async (context) => {
      const auth = await requireInteractiveSession(context, dependencies.authenticateSession);
      if (!auth) return unauthorized(context, "An interactive user session is required.");
      if (dependencies.isDemoMode(context.env)) {
        return forbidden(context, "The demo environment does not allow changing login passwords.");
      }

      const input = context.req.valid("json");
      const user = await context.env.storage.db.prepare(
        `SELECT id, username, password_hash, display_name, is_disabled
         FROM users
         WHERE id = ? AND is_disabled = 0`,
      ).bind(auth.actorId).first<UserRow>();
      if (!user || !(await verifyPassword(input.currentPassword, user.password_hash))) {
        return apiError(context, "invalid_current_password", "Current password is incorrect.", 400);
      }

      const now = isoNow();
      const passwordHash = await hashPassword(input.newPassword);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
        ).bind(passwordHash, now, user.id),
        context.env.storage.db.prepare(
          `UPDATE sessions SET revoked_at = ?
           WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
        ).bind(now, user.id, auth.sessionId),
        auditStatement(context.env.storage.db, "user", user.id, "auth.password_change", "user", user.id, {}),
      ]);
      return context.json({ ok: true });
    },
  );

  app.post("/api/v1/auth/logout", async (context) => {
    const token = getCookie(context, "edgeever_session") ?? dependencies.getBearerToken(context);
    if (token) await dependencies.revokeSession(context.env.storage.db, token);

    deleteCookie(context, "edgeever_session", { path: "/" });
    return context.json({ ok: true });
  });
};
