import {
  ApiTokenCreateSchema,
  ApiTokenUpdateSchema,
  type ApiToken,
  type CreatedApiToken,
  type TokenNotebookAccess,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { auditStatement } from "./audit";
import type { AppContext, AppEnv } from "./api-context";
import { randomToken } from "./auth-crypto";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { apiError, badRequest, notFound } from "./http-errors";
import { notebookIdsBind, parseNotebookAccessJson, parseNotebookDefaultAccess } from "./token-notebook-access";
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
  notebook_access_json: string | null;
  notebook_default_access: string | null;
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
  notebookAccess: parseNotebookAccessJson(row.notebook_access_json),
  notebookDefaultAccess: parseNotebookDefaultAccess(row.notebook_default_access),
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
  `SELECT id, name, token_value, scopes_json, notebook_access_json, notebook_default_access, last_used_at, expires_at, is_revoked, created_at, workspace_id
   FROM api_tokens
   WHERE id = ? AND workspace_id = ?`,
).bind(id, workspaceId).first<ApiTokenRow>();

/**
 * Validates per-notebook grants against the workspace's live notebooks.
 * Unknown notebook ids are rejected so a typo cannot silently grant nothing;
 * deleting a granted notebook later simply narrows the token at read time.
 * Returns an error response, or null when the grants are valid.
 */
const validateNotebookAccess = async (
  context: AppContext,
  workspaceId: string,
  entries: TokenNotebookAccess[],
): Promise<Response | null> => {
  if (entries.length === 0) return null;
  const ids = Array.from(new Set(entries.map((entry) => entry.notebookId)));
  // One JSON bind through json_each keeps large grant lists within D1's
  // per-statement bound-parameter limit.
  const rows = await context.env.storage.db.prepare(
    `SELECT id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 AND id IN (SELECT value FROM json_each(?))`,
  ).bind(workspaceId, notebookIdsBind(ids)).all<{ id: string }>();
  const known = new Set(rows.results.map((row) => row.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length === 0) return null;
  return apiError(
    context,
    "unknown_notebook",
    `notebookAccess references unknown notebooks: ${unknown.join(", ")}`,
    400,
  );
};

export const registerApiTokenRoutes = (
  app: Hono<AppEnv>,
  dependencies: ApiTokenRouteDependencies,
) => {
  app.get("/api/v1/api-tokens", async (context) => {
    const userOnly = requireUser(context);
    if (userOnly) return userOnly;

    const rows = await context.env.storage.db.prepare(
      `SELECT id, name, token_value, scopes_json, notebook_access_json, notebook_default_access, last_used_at, expires_at, is_revoked, created_at, workspace_id
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

      const notebookDenied = await validateNotebookAccess(
        context,
        getWorkspaceId(context),
        input.notebookAccess ?? [],
      );
      if (notebookDenied) return notebookDenied;

      const id = createId("tok");
      const token = `${API_TOKEN_PREFIX}_${randomToken(API_TOKEN_BYTES)}`;
      const now = isoNow();
      const actor = getAuditActor(context);
      const workspaceId = getWorkspaceId(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `INSERT INTO api_tokens (id, workspace_id, name, token_hash, token_value, scopes_json, notebook_access_json, notebook_default_access, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          workspaceId,
          input.name,
          await dependencies.sha256(token),
          token,
          JSON.stringify(scopes),
          input.notebookAccess ? JSON.stringify(input.notebookAccess) : null,
          input.notebookDefaultAccess ?? null,
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
          { name: input.name, scopes, expiresAt: input.expiresAt ?? null, notebookAccess: input.notebookAccess ?? null, notebookDefaultAccess: input.notebookDefaultAccess ?? null },
        ),
      ]);

      const row = await getApiTokenRow(context.env.storage.db, id, workspaceId);
      if (!row) return notFound(context, "API token not found");
      return context.json({ token, apiToken: mapApiToken(row) } satisfies CreatedApiToken, 201);
    },
  );

  app.patch(
    "/api/v1/api-tokens/:id",
    zValidator("json", ApiTokenUpdateSchema),
    async (context) => {
      const userOnly = requireUser(context);
      if (userOnly) return userOnly;

      const id = context.req.param("id");
      const workspaceId = getWorkspaceId(context);
      const current = await getApiTokenRow(context.env.storage.db, id, workspaceId);
      if (!current) return notFound(context, "API token not found");

      const input = context.req.valid("json");
      const scopes = input.scopes !== undefined
        ? normalizeTokenScopes(input.scopes)
        : parseJsonArray(current.scopes_json) as string[];
      if (!scopes) return badRequest(context, "Token scope is not supported.");

      const notebookAccess = input.notebookAccess !== undefined
        ? input.notebookAccess
        : parseNotebookAccessJson(current.notebook_access_json);

      const notebookDenied = await validateNotebookAccess(context, workspaceId, notebookAccess ?? []);
      if (notebookDenied) return notebookDenied;

      const name = input.name ?? current.name;
      const expiresAt = input.expiresAt !== undefined ? input.expiresAt : current.expires_at;
      const notebookDefaultAccess = input.notebookDefaultAccess !== undefined
        ? input.notebookDefaultAccess
        : parseNotebookDefaultAccess(current.notebook_default_access);
      const actor = getAuditActor(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `UPDATE api_tokens
           SET name = ?, scopes_json = ?, notebook_access_json = ?, notebook_default_access = ?, expires_at = ?
           WHERE id = ? AND workspace_id = ?`,
        ).bind(
          name,
          JSON.stringify(scopes),
          notebookAccess ? JSON.stringify(notebookAccess) : null,
          notebookDefaultAccess,
          expiresAt,
          id,
          workspaceId,
        ),
        auditStatement(
          context.env.storage.db,
          actor.actorType,
          actor.actorId,
          "api_token.update",
          "api_token",
          id,
          {
            name,
            scopes,
            expiresAt,
            notebookAccess: notebookAccess ?? null,
            notebookDefaultAccess,
            previous: {
              name: current.name,
              scopes: parseJsonArray(current.scopes_json),
              expiresAt: current.expires_at,
              notebookAccess: parseNotebookAccessJson(current.notebook_access_json),
              notebookDefaultAccess: parseNotebookDefaultAccess(current.notebook_default_access),
            },
          },
        ),
      ]);

      const row = await getApiTokenRow(context.env.storage.db, id, workspaceId);
      if (!row) return notFound(context, "API token not found");
      return context.json({ apiToken: mapApiToken(row) });
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
