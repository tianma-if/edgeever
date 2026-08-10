import {
  ApiTokenCreateSchema,
  type ApiToken,
  type CreatedApiToken,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { auditStatement } from "./audit";
import type { AppEnv } from "./api-context";
import { randomToken } from "./auth-crypto";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { badRequest, notFound } from "./http-errors";
import {
  ALL_TOKEN_SCOPES,
  getAuditActor,
  getWorkspaceId,
  normalizeTokenScopes,
  requireUser,
} from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";

const API_TOKEN_BYTES = 32;
const API_TOKEN_PREFIX = "eev";

export type ApiTokenRow = {
  id: string;
  name: string;
  token_value: string | null;
  scopes_json: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_revoked: number;
  created_at: string;
  workspace_id: string;
};

type ApiTokenRouteDependencies = {
  sha256: (value: string) => Promise<string>;
};

export const mapApiToken = (row: ApiTokenRow): ApiToken => ({
  id: row.id,
  name: row.name,
  token: row.token_value,
  scopes: parseJsonArray(row.scopes_json),
  lastUsedAt: row.last_used_at,
  expiresAt: row.expires_at,
  isRevoked: Boolean(row.is_revoked),
  createdAt: row.created_at,
});

const getApiTokenRow = (
  database: DatabaseAdapter,
  id: string,
  workspaceId: string,
) => database.prepare(
  `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at, workspace_id
   FROM api_tokens
   WHERE id = ? AND workspace_id = ?`,
).bind(id, workspaceId).first<ApiTokenRow>();

export const registerApiTokenRoutes = (
  app: Hono<AppEnv>,
  dependencies: ApiTokenRouteDependencies,
) => {
  app.get("/api/v1/api-tokens", async (context) => {
    const userOnly = requireUser(context);
    if (userOnly) return userOnly;

    const rows = await context.env.storage.db.prepare(
      `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at, workspace_id
       FROM api_tokens
       WHERE workspace_id = ?
       ORDER BY is_revoked ASC, created_at DESC
       LIMIT 200`,
    ).bind(getWorkspaceId(context)).all<ApiTokenRow>();

    return context.json({
      apiTokens: rows.results.map(mapApiToken),
      availableScopes: ALL_TOKEN_SCOPES,
    });
  });

  app.post(
    "/api/v1/api-tokens",
    zValidator("json", ApiTokenCreateSchema),
    async (context) => {
      const userOnly = requireUser(context);
      if (userOnly) return userOnly;

      const input = context.req.valid("json");
      const scopes = normalizeTokenScopes(input.scopes);
      if (!scopes) return badRequest(context, "Token scope is not supported.");

      const id = createId("tok");
      const token = `${API_TOKEN_PREFIX}_${randomToken(API_TOKEN_BYTES)}`;
      const now = isoNow();
      const actor = getAuditActor(context);
      const workspaceId = getWorkspaceId(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `INSERT INTO api_tokens (id, workspace_id, name, token_hash, token_value, scopes_json, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          workspaceId,
          input.name,
          await dependencies.sha256(token),
          token,
          JSON.stringify(scopes),
          input.expiresAt ?? null,
          now,
        ),
        auditStatement(
          context.env.storage.db,
          actor.actorType,
          actor.actorId,
          "api_token.create",
          "api_token",
          id,
          { name: input.name, scopes, expiresAt: input.expiresAt ?? null },
        ),
      ]);

      const row = await getApiTokenRow(context.env.storage.db, id, workspaceId);
      if (!row) return notFound(context, "API token not found");
      return context.json({ token, apiToken: mapApiToken(row) } satisfies CreatedApiToken, 201);
    },
  );

  app.delete("/api/v1/api-tokens/:id", async (context) => {
    const userOnly = requireUser(context);
    if (userOnly) return userOnly;

    const id = context.req.param("id");
    const actor = getAuditActor(context);
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `DELETE FROM api_tokens WHERE id = ? AND workspace_id = ?`,
      ).bind(id, getWorkspaceId(context)),
      auditStatement(
        context.env.storage.db,
        actor.actorType,
        actor.actorId,
        "api_token.delete",
        "api_token",
        id,
        {},
      ),
    ]);
    return context.json({ ok: true });
  });
};
