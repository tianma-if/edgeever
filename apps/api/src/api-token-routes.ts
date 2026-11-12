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
import { notebookIdsBind, parseNotebookAccessJson, parseNotebookAccessLevel } from "./token-notebook-access";
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
  notebook_access_level: string | null;
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
  notebookAccessLevel: parseNotebookAccessLevel(row.notebook_access_level),
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
  `SELECT id, name, token_value, scopes_json, notebook_access_json, notebook_access_level, last_used_at, expires_at, is_revoked, created_at, workspace_id
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
      `SELECT id, name, token_value, scopes_json, notebook_access_json, notebook_access_level, last_used_at, expires_at, is_revoked, created_at, workspace_id
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
          `INSERT INTO api_tokens (id, workspace_id, name, token_hash, token_value, scopes_json, notebook_access_json, notebook_access_level, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          workspaceId,
          input.name,
          await dependencies.sha256(token),
          token,
          JSON.stringify(scopes),
          input.notebookAccess ? JSON.stringify(input.notebookAccess) : null,
          input.notebookAccessLevel ?? null,
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
          { name: input.name, scopes, expiresAt: input.expiresAt ?? null, notebookAccess: input.notebookAccess ?? null, notebookAccessLevel: input.notebookAccessLevel ?? null },
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
      // Only the fields the request explicitly changes are updated, so a
      // metadata-only PATCH can never overwrite a concurrent permission
      // change, and unchanged grants referencing deleted notebooks are not
      // re-validated (only newly set grants are).
      const scopes = input.scopes !== undefined
        ? normalizeTokenScopes(input.scopes)
        : null;
      if (input.scopes !== undefined && !scopes) {
        return badRequest(context, "Token scope is not supported.");
      }

      // Grant field semantics: omitted = keep the stored JSON verbatim
      // (re-serializing a corrupted record would silently rewrite it to "[]"
      // and reopen access); an array = set it; null = remove the restriction.
      const notebookAccessJson = Object.hasOwn(input, "notebookAccess")
        ? (input.notebookAccess === null ? "__UNRESTRICT__" : JSON.stringify(input.notebookAccess))
        : null;

      if (notebookAccessJson !== null && notebookAccessJson !== "__UNRESTRICT__") {
        const notebookDenied = await validateNotebookAccess(context, workspaceId, input.notebookAccess ?? []);
        if (notebookDenied) return notebookDenied;
      }

      const name = input.name ?? current.name;
      // expires_at only changes when the request carries the field; a
      // metadata-only PATCH must not null out a concurrently set expiry.
      const expiresAt = input.expiresAt !== undefined ? input.expiresAt : null;
      const expiresAtChanged = input.expiresAt !== undefined;
      // The default policy follows the grant field: it changes when the
      // request carries it, when grants are set, or when the restriction is
      // removed. A grant-only PATCH keeps the stored default.
      const notebookAccessLevel = input.notebookAccessLevel !== undefined
        ? input.notebookAccessLevel
        : null;
      const actor = getAuditActor(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `UPDATE api_tokens
           SET name = ?,
               scopes_json = CASE WHEN ? IS NULL THEN scopes_json ELSE ? END,
               notebook_access_json = CASE
                 WHEN ? = '__UNRESTRICT__' THEN NULL
                 WHEN ? IS NULL THEN notebook_access_json
                 ELSE ?
               END,
               notebook_access_level = CASE
                 WHEN ? = '__UNRESTRICT__' THEN NULL
                 WHEN ? IS NOT NULL THEN ?
                 ELSE notebook_access_level
               END,
               expires_at = CASE WHEN ? THEN ? ELSE expires_at END
           WHERE id = ? AND workspace_id = ?`,
        ).bind(
          name,
          scopes ? JSON.stringify(scopes) : null,
          scopes ? JSON.stringify(scopes) : null,
          notebookAccessJson,
          notebookAccessJson,
          notebookAccessJson,
          notebookAccessJson,
          notebookAccessLevel,
          notebookAccessLevel,
          expiresAtChanged ? 1 : 0,
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
            scopes: scopes ?? parseJsonArray(current.scopes_json),
            expiresAt: expiresAtChanged ? expiresAt : current.expires_at,
            notebookAccess: parseNotebookAccessJson(
              notebookAccessJson === "__UNRESTRICT__"
                ? null
                : notebookAccessJson ?? current.notebook_access_json,
            ),
            notebookAccessLevel: notebookAccessLevel
              ?? (notebookAccessJson === "__UNRESTRICT__"
                ? null
                : parseNotebookAccessLevel(current.notebook_access_level)),
            previous: {
              name: current.name,
              scopes: parseJsonArray(current.scopes_json),
              expiresAt: current.expires_at,
              notebookAccess: parseNotebookAccessJson(current.notebook_access_json),
              notebookAccessLevel: parseNotebookAccessLevel(current.notebook_access_level),
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
