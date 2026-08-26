import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  docToText,
  emptyDoc,
  markdownToDoc,
  mergeMemoDocs,
  resolveMemoContentDoc,
  resolveMergedMemoTitle,
  isSuspiciousMemoOverwrite,
  isMemoEditBindingValid,
  normalizeTags,
  AiPromptTemplateCreateSchema,
  AiPromptTemplateUpdateSchema,
  TemplateCreateSchema,
  TemplateUpdateSchema,
  type MemoDetail,
  type MemoEditSession,
  type MemoRevision,
  type MemoSummary,
  type MemoUpdateInput,
  type JsonBackupMemo,
  type JsonBackupNotebook,
  type Resource,
  type TiptapDoc,
} from "@edgeever/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import openApiSpec from "../../../docs/openapi.json";
import releaseSummary from "../../../release-summary.json";
import { hasBootstrapCredential, isSupportedPasswordHash, verifyBootstrapPassword } from "./auth-bootstrap";
import {
  isDatabaseNotReadyError,
  isUnauthenticatedAccessEnabled,
  resolveInstanceAuthMode,
  type InstanceAuthMode,
} from "./auth-state";
import {
  isDemoModeEnabled,
  resolveDemoPasswordHash,
  shouldUpsertDemoSeedRecord,
} from "./demo-mode";
import {
  resolveSessionDeviceId,
} from "./auth-session-devices";
import {
  type LoginAttemptKey,
} from "./auth-login-limiter";
import {
  decodeDemoAttachment,
  DEMO_SEED_ATTACHMENT_RESOURCES,
  DEMO_SEED_MEMO_IDS,
  DEMO_SEED_MEMOS,
  DEMO_SEED_NOTEBOOK_IDS,
  DEMO_SEED_NOTEBOOKS,
  DEMO_SEED_REVISIONS,
} from "./demo-seed-data";
import { createCloudflareStorageAdapter } from "./cloudflare-storage-adapter";
import type {
  DatabaseAdapter,
  PreparedStatementAdapter,
} from "./storage-contract";
import type { AppContext, AppEnv, AuditActor, AuthContext, Bindings, WorkerBindings } from "./api-context";
import { AppError } from "./app-error";
import { hashPassword, randomToken, SESSION_TOKEN_BYTES, verifyPassword } from "./auth-crypto";
import {
  apiError,
  authNotConfigured,
  databaseNotReady,
  forbidden,
  notFound,
  unauthorized,
} from "./http-errors";
import {
  decodeBase64Data,
  escapeMarkdownImageAlt,
  escapeMarkdownLinkLabel,
  getOptionalString,
  getOptionalStringArray,
  getRequiredString,
  getRequiredStringArray,
} from "./mcp-json-rpc";
import { audit, auditStatement } from "./audit";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import {
  deleteMemoSearchDocumentsStatement,
  upsertMemoSearchDocumentStatement,
} from "./memo-search-index";
import {
  createNotebookRecord,
  findNotebooks,
  getNotebook,
  listNotebooks,
  mapNotebook,
  notebookSelectSql,
  resolveNotebookPath,
  updateNotebookRecord,
  type NotebookRow,
} from "./notebook-service";
import {
  listTagSummaries,
  previewTagRename,
  updateTagAcrossMemos,
  updateTagsForMemos,
} from "./tag-service";
import {
  assertScope,
  getActorLabel,
  getAuditActor,
  getWorkspaceId,
  hasScopes,
  requireOwner,
  requireScopes,
  requireUser,
  type TokenScope,
} from "./request-auth";
import { registerTagRoutes } from "./tag-routes";
import { getMemoTemplate, listMemoTemplates, registerTemplateRoutes } from "./template-routes";
import { registerAuthRoutes, type UserRow } from "./auth-routes";
import { registerApiTokenRoutes, type ApiTokenRow } from "./api-token-routes";
import { registerObjectStorageRoutes } from "./object-storage-routes";
import { registerAiRoutes } from "./ai-routes";
import { registerAiPromptRoutes } from "./ai-prompt-routes";
import {
  getAiPromptTemplateRow,
  listAiPromptTemplates,
  mapAiPromptTemplateRow,
} from "./ai-prompt-service";
import { restoreMissingDefaultAiPrompts } from "./ai-prompt-seed";
import { registerResourceRoutes } from "./resource-routes";
import { registerPluginDistributionRoutes } from "./plugin-distribution-routes";
import { registerSyncRoutes } from "./sync-routes";
import { registerMemoRoutes } from "./memo-routes";
import { registerBackupRoutes } from "./backup-routes";
import { registerMcpRoutes } from "./mcp-routes";
import {
  escapeLike,
  listMemos,
  mapMemoSummary,
  toFtsQuery,
  type MemoSummaryRow,
} from "./memo-list-service";
import {
  registerUserRoutes,
  type InstanceUserRow,
} from "./user-routes";
import { registerNotebookRoutes } from "./notebook-routes";
import { registerMemoShareRoutes, registerPublicShareRoutes } from "./share-routes";
import {
  deleteStoredObjects,
  resolveObjectStorage,
} from "./object-storage";
import {
  DEFAULT_WORKSPACE_ID,
  ensureUserWorkspace,
} from "./workspace-provisioning";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  inferImageExtension,
  mapResource,
  mapResourceListItem,
  mapResourceStorageSummary,
  normalizeFilename,
  prepareImageForStorage,
  validateAttachmentUpload,
  validateImageUpload,
  type ResourceListRow,
  type ResourceRow,
  type ResourceStatsRow,
} from "./resource-service";

// Compatibility aliases keep the existing SQL-heavy implementation small
// while routing its dependency through the platform-neutral contract above.
// New code should use DatabaseAdapter directly.
type D1Database = DatabaseAdapter;
type D1PreparedStatement = PreparedStatementAdapter;

type MemoDetailRow = MemoSummaryRow & {
  content_json: string;
  content_markdown: string;
  content_text: string;
  source_memo_ids: string;
  merge_source_count: number;
  merged_into_memo_id: string | null;
  content_hash: string;
};

type MemoRevisionRow = {
  id: string;
  memo_id: string;
  revision: number;
  title: string | null;
  tags_json: string;
  content_json: string;
  content_markdown: string;
  content_text: string;
  content_hash: string;
  created_by: string;
  created_at: string;
};

type MemoEditSessionRow = {
  id: string;
  memo_id: string;
  actor_type: "user" | "agent";
  actor_id: string | null;
  base_revision: number;
  base_content_hash: string;
  expires_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  expires_at: string;
  last_seen_at: string | null;
  workspace_id: string | null;
  role: "owner" | "member" | null;
};

type WorkspaceIdentityRow = {
  workspace_id: string;
  workspace_name: string;
  is_personal: number;
  user_id: string;
  username: string;
  display_name: string | null;
  role: "owner" | "member";
};

type MemoImportSourceRow = {
  external_id: string;
  memo_id: string;
  source_updated_at: string | null;
};

const SESSION_COOKIE = "edgeever_session";
const DEFAULT_SESSION_TTL_DAYS = 400;
const MAX_SESSION_TTL_DAYS = 400;
const SESSION_LAST_SEEN_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const DEMO_RESET_LEASE_MS = 5 * 60 * 1000;
const DEMO_RESET_COOLDOWN_MS = 60 * 1000;
const DEFAULT_R2_BUCKET_NAME = "edgeever-resources";
const REVISION_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const app = new Hono<AppEnv>();

app.use(
  "/api/*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173", "null"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(
  "/mcp",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173", "null"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

app.get("/api/release", (c) => c.json(releaseSummary));

app.get("/api/health", async (c) => {
  const authMode = await getInstanceAuthMode(c.env, true);

  if (authMode === "unconfigured") {
    return authNotConfigured(c);
  }

  if (!c.env.storage.resources) {
    return c.json(
      {
        error: {
          code: "object_storage_not_ready",
          message: "Object storage is not configured. Bind RESOURCES and redeploy.",
        },
      },
      503,
    );
  }

  return c.json({
    ok: true,
    name: "edgeever",
    runtime: c.env.EDGE_EVER_RUNTIME ?? "cloudflare-workers",
    authMode,
  });
});

app.get("/api/openapi.json", (c) => c.json(openApiSpec));

registerPublicShareRoutes(app);

registerAuthRoutes(app, {
  authenticateRequest: (...args) => authenticateRequest(...args),
  authenticateSession: (...args) => authenticateSession(...args),
  createSession: (...args) => createSession(...args),
  ensureUserWorkspace: (...args) => ensureUserWorkspace(...args),
  getBearerToken: (...args) => getBearerToken(...args),
  getInstanceAuthMode: (...args) => getInstanceAuthMode(...args),
  getLoginAttemptKeys: (...args) => getLoginAttemptKeys(...args),
  isDemoEnvironment: (environment) => isDemoMode(environment) || isLocalDemoSeedEnabled(environment),
  isDemoMode: (...args) => isDemoMode(...args),
  revokeSession: (...args) => revokeSession(...args),
  setSessionCookie: (...args) => setSessionCookie(...args),
  tooManyLoginAttempts: (...args) => tooManyLoginAttempts(...args),
  verifyLogin: (...args) => verifyLogin(...args),
});
registerUserRoutes(app, {
  authenticateRequest: (...args) => authenticateRequest(...args),
  getInstanceUser: (...args) => getInstanceUser(...args),
});

app.use("/api/v1/*", async (c, next) => {
  if (c.req.path.startsWith("/api/v1/auth/")) {
    await next();
    return;
  }

  const authMode = await getInstanceAuthMode(c.env);

  if (authMode === "unconfigured") {
    return authNotConfigured(c);
  }

  if (authMode === "disabled") {
    c.set("auth", {
      kind: "user",
      actorType: "user",
      actorId: null,
      username: "owner",
      displayName: "Owner",
      scopes: [],
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "owner",
    });
    await next();
    return;
  }

  const auth = await authenticateRequest(c, true);

  if (!auth) {
    return unauthorized(c, "Authentication required.");
  }

  c.set("auth", auth);
  await next();
});

registerObjectStorageRoutes(app, {
  isDemoMode: (...args) => isDemoMode(...args),
});
registerAiRoutes(app, {
  isDemoMode: (...args) => isDemoMode(...args),
});
registerAiPromptRoutes(app, {
  isDemoMode: (...args) => isDemoMode(...args),
});

registerApiTokenRoutes(app, {
  sha256: (...args) => sha256(...args),
});
registerNotebookRoutes(app, async (env) => {
  if (isDemoMode(env)) await ensureDemoSeed(env);
});

registerSyncRoutes(app, {
  clampNumber: (...args) => clampNumber(...args),
  mapMemoDetail: (...args) => mapMemoDetail(...args),
});
registerTagRoutes(app);
registerPluginDistributionRoutes(app);
registerMemoShareRoutes(app);
registerTemplateRoutes(app, {
  createMemoRecord: (...args) => createMemoRecord(...args),
  getMemoDetail: (...args) => getMemoDetail(...args),
});

registerMemoRoutes(app, {
  clampNumber: (...args) => clampNumber(...args),
  createMemo: (...args) => createMemoRecord(...args),
  createMemoEditSession: (...args) => createMemoEditSession(...args),
  deleteMemo: (...args) => deleteMemoRecord(...args),
  deleteMemos: (...args) => deleteMemosRecord(...args),
  emptyTrash: (...args) => emptyTrashMemosRecord(...args),
  getMemoDetail: (...args) => getMemoDetail(...args),
  listMemos: (...args) => listMemos(...args),
  listMemoRevisions: (...args) => listMemoRevisions(...args, false),
  mergeMemos: (...args) => mergeMemosRecord(...args),
  moveMemos: (...args) => moveMemosRecord(...args),
  restoreMemo: (...args) => restoreMemoRecord(...args),
  restoreMemoRevision: (...args) => restoreMemoRevisionRecord(...args),
  updateMemo: (...args) => updateMemoRecord(...args),
});

registerBackupRoutes(app, {
  clampNumber: (...args) => clampNumber(...args),
  getMemoDetail: (...args) => getMemoDetail(...args),
  mapMemoDetail: (...args) => mapMemoDetail(...args),
  restoreJsonMemos: (...args) => restoreJsonMemos(...args),
  restoreJsonNotebooks: (...args) => restoreJsonNotebooks(...args),
  sha256Bytes: (...args) => sha256Bytes(...args),
});

registerMcpRoutes(app, {
  authenticateRequest: (...args) => authenticateRequest(...args),
  callTool: (...args) => callMcpTool(...args),
});


registerResourceRoutes(app, {
  clampNumber: (...args) => clampNumber(...args),
  createAttachmentResource: (...args) => createAttachmentResource(...args),
  createImageResource: (...args) => createImageResource(...args),
  getMemoDetail: (...args) => getMemoDetail(...args),
  getResourceRow: (...args) => getResourceRow(...args),
});

const createImageResource = async (
  c: AppContext,
  input: {
    memoId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    actor: AuditActor;
    source: "upload" | "mcp";
  }
) => {
  validateImageUpload(input.mimeType, input.bytes.byteLength);

  const resourceId = createId("res");
  const now = isoNow();
  const processed = prepareImageForStorage({
    bytes: input.bytes,
    filename: input.filename,
    mimeType: input.mimeType,
    source: input.source,
  });
  const objectKey = `workspaces/${getWorkspaceId(c)}/memos/${input.memoId}/${resourceId}${inferImageExtension(processed.filename, processed.mimeType)}`;
  const destination = await resolveObjectStorage(c.env);
  const filename = normalizeFilename(processed.filename) || `${resourceId}${inferImageExtension(processed.filename, processed.mimeType)}`;
  const checksum = await sha256Bytes(processed.bytes);

  await destination.store.put(objectKey, processed.bytes, {
    httpMetadata: {
      contentType: processed.mimeType,
      cacheControl: "private, max-age=3600",
    },
    customMetadata: {
      memoId: input.memoId,
      resourceId,
      filename,
    },
  });

  try {
    await c.env.storage.db.batch([
      c.env.storage.db.prepare(
        `INSERT INTO resources (
          id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        resourceId,
        input.memoId,
        destination.bucketName,
        objectKey,
        destination.configId,
        processed.mimeType,
        filename,
        processed.bytes.byteLength,
        checksum,
        processed.width,
        processed.height,
        JSON.stringify(processed.metadata),
        now,
        now
      ),
      auditStatement(c.env.storage.db, input.actor.actorType, input.actor.actorId, "resource.create", "resource", resourceId, {
        memoId: input.memoId,
        mimeType: processed.mimeType,
        byteSize: processed.bytes.byteLength,
        compressed: processed.compressed,
      }),
    ]);
  } catch (error) {
    await destination.store.delete(objectKey);
    throw error;
  }

  const resource = await getResourceRow(c.env.storage.db, getWorkspaceId(c), resourceId);

  if (!resource) {
    throw new AppError("not_found", "Resource not found", 404);
  }

  return mapResource(resource);
};

const createAttachmentResource = async (
  c: AppContext,
  input: {
    memoId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    actor: AuditActor;
  }
) => {
  validateAttachmentUpload(input.bytes.byteLength);

  const resourceId = createId("res");
  const now = isoNow();
  const filename = normalizeFilename(input.filename) || resourceId;
  const objectKey = `workspaces/${getWorkspaceId(c)}/memos/${input.memoId}/${resourceId}`;
  const destination = await resolveObjectStorage(c.env);
  const checksum = await sha256Bytes(input.bytes);

  await destination.store.put(objectKey, input.bytes, {
    httpMetadata: {
      contentType: input.mimeType,
      cacheControl: "private, max-age=3600",
    },
    customMetadata: {
      memoId: input.memoId,
      resourceId,
      filename,
    },
  });

  try {
    await c.env.storage.db.batch([
      c.env.storage.db.prepare(
        `INSERT INTO resources (
          id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'attachment', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
      ).bind(
        resourceId,
        input.memoId,
        destination.bucketName,
        objectKey,
        destination.configId,
        input.mimeType,
        filename,
        input.bytes.byteLength,
        checksum,
        JSON.stringify({ originalFilename: filename }),
        now,
        now
      ),
      auditStatement(c.env.storage.db, input.actor.actorType, input.actor.actorId, "resource.create", "resource", resourceId, {
        memoId: input.memoId,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
      }),
    ]);
  } catch (error) {
    await destination.store.delete(objectKey);
    throw error;
  }

  const resource = await getResourceRow(c.env.storage.db, getWorkspaceId(c), resourceId);

  if (!resource) {
    throw new AppError("not_found", "Resource not found", 404);
  }

  return mapResource(resource);
};

app.post("/api/v1/demo/reset", async (c) => {
  if (!isDemoMode(c.env) && !isLocalDemoSeedEnabled(c.env)) {
    return c.json(
      {
        error: {
          code: "demo_mode_disabled",
          message: "Demo reset is only available when demo mode or local demo seed is enabled",
        },
      },
      400
    );
  }

  const reset = await resetDemoData(c.env, Date.now());
  if (!reset) {
    c.header("Retry-After", String(Math.ceil(DEMO_RESET_COOLDOWN_MS / 1000)));
    return c.json(
      {
        error: {
          code: "demo_reset_in_progress",
          message: "Demo reset is already in progress or cooling down",
        },
      },
      409
    );
  }

  return c.json({
    success: true,
    message: "Demo seed data successfully restored",
  });
});

/**
 * Executes the platform-neutral EdgeEver application with an injected storage
 * adapter. Runtime entrypoints must remain thin and call this function rather
 * than introducing platform-specific route or service implementations.
 */
export const fetchEdgeEverApp = async (
  request: Request,
  runtimeEnv: Bindings,
  ctx: ExecutionContext,
) => {
    if (isLocalDemoSeedEnabled(runtimeEnv)) {
      await ensureLocalDemoSeed(runtimeEnv);
    }

    return app.fetch(request, runtimeEnv, ctx);
};

const worker = {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext) {
    return fetchEdgeEverApp(request, {
      ...env,
      storage: createCloudflareStorageAdapter(env),
    }, ctx);
  },
  async scheduled(controller: ScheduledController, env: WorkerBindings, ctx: ExecutionContext) {
    const runtimeEnv = {
      ...env,
      storage: createCloudflareStorageAdapter(env),
    } as Bindings;

    if (!isDemoMode(runtimeEnv)) {
      return;
    }

    ctx.waitUntil(resetDemoData(runtimeEnv, controller.scheduledTime, { resetCredentials: true }));
  },
};

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "Route not found",
      },
    },
    404
  )
);

app.onError((error, c) => {
  if (error instanceof AppError) {
    return apiError(c, error.code, error.message, error.status);
  }

  if (isDatabaseNotReadyError(error)) {
    console.error("EdgeEver database readiness check failed", error);
    return databaseNotReady(c);
  }

  console.error("Unhandled EdgeEver API error", error);
  return apiError(c, "internal_error", "An unexpected server error occurred.", 500);
});

export default worker;

type McpInputSchema<T> = {
  safeParse: (input: unknown) =>
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
};

const parseMcpInput = <T>(schema: McpInputSchema<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
    .join("; ");
  throw new AppError("invalid_params", message, 400);
};

const assertMcpMutationAllowed = (environment: Bindings) => {
  if (isDemoMode(environment)) {
    throw new AppError("forbidden", "Templates and AI instructions cannot be changed in demo mode.", 403);
  }
};

export const callMcpTool = async (
  c: AppContext,
  auth: AuthContext,
  name: string,
  args: Record<string, unknown>
) => {
  switch (name) {
    case "get_current_user": {
      return await getCurrentWorkspaceIdentity(c.env.storage.db, auth);
    }
    case "search_memos": {
      assertScope(auth, "read:memos");
      return {
        memos: await searchMemoSummaries(c.env.storage.db, {
          workspaceId: auth.workspaceId,
          query: getOptionalString(args.query),
          notebookId: getOptionalString(args.notebookId),
          tags: getOptionalStringArray(args.tags),
          createdAfter: getOptionalString(args.createdAfter),
          createdBefore: getOptionalString(args.createdBefore),
          updatedAfter: getOptionalString(args.updatedAfter),
          updatedBefore: getOptionalString(args.updatedBefore),
          isPinned: typeof args.isPinned === "boolean" ? args.isPinned : null,
          hasResources: typeof args.hasResources === "boolean" ? args.hasResources : null,
          limit: clampNumber(Number(args.limit ?? 20), 1, 50),
        }),
      };
    }
    case "list_memos": {
      assertScope(auth, "read:memos");
      return await listMemosForMcp(c.env.storage.db, {
        workspaceId: auth.workspaceId,
        notebookId: getOptionalString(args.notebookId),
        limit: clampNumber(Number(args.limit ?? 50), 1, 100),
        offset: clampNumber(Number(args.offset ?? 0), 0, 100_000),
        includeContent: args.includeContent === true,
        includeDeleted: args.includeDeleted === true,
      });
    }
    case "get_memo": {
      assertScope(auth, "read:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId, args.includeDeleted === true);

      if (!memo) {
        throw new Error("Memo not found");
      }

      return { memo };
    }
    case "create_memo": {
      assertScope(auth, "write:memos");
      const notebookId = getRequiredString(args.notebookId, "notebookId");
      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const memo = await createMemoRecord(c.env.storage.db, auth.workspaceId, {
        notebookId,
        title: getOptionalString(args.title) ?? undefined,
        contentMarkdown: getOptionalString(args.contentMarkdown) ?? "",
        tags: getOptionalStringArray(args.tags),
        createdAt: getOptionalString(args.createdAt) ?? undefined,
        updatedAt: getOptionalString(args.updatedAt) ?? undefined,
      }, actor, actorLabel);

      return { memo };
    }
    case "import_memos": {
      assertScope(auth, "write:memos");
      return await importMemosRecord(c.env.storage.db, auth.workspaceId, {
        source: getRequiredString(args.source, "source"),
        notebookId: getRequiredString(args.notebookId, "notebookId"),
        items: args.items,
        dryRun: args.dryRun === true,
        actor: getAuditActor(c),
        actorLabel: getActorLabel(c),
      });
    }
    case "update_memo": {
      assertScope(auth, "write:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const result = await updateMemoRecord(
        c.env.storage.db,
        auth.workspaceId,
        memoId,
        {
          expectedRevision:
            typeof args.expectedRevision === "number" && Number.isInteger(args.expectedRevision)
              ? args.expectedRevision
              : undefined,
          notebookId: getOptionalString(args.notebookId) ?? undefined,
          title: getOptionalString(args.title) ?? undefined,
          isPinned: typeof args.isPinned === "boolean" ? args.isPinned : undefined,
          contentMarkdown: getOptionalString(args.contentMarkdown) ?? undefined,
          tags: Array.isArray(args.tags) ? getOptionalStringArray(args.tags) : undefined,
          createdAt: getOptionalString(args.createdAt) ?? undefined,
          updatedAt: getOptionalString(args.updatedAt) ?? undefined,
        },
        actor,
        actorLabel
      );

      if ("error" in result) {
        throw new Error(result.message);
      }

      return { memo: result.memo };
    }
    case "trash_memos": {
      assertScope(auth, "write:memos");
      const memoIds = getRequiredStringArray(args.memoIds, "memoIds");

      if (args.dryRun === true) {
        return { dryRun: true, memos: await getMemosForBulkAction(c.env.storage.db, auth.workspaceId, memoIds, 0) };
      }

      const deleted = await deleteMemosRecord(c.env, auth.workspaceId, memoIds, false, getAuditActor(c));
      return { ok: true, deleted };
    }
    case "restore_memos": {
      assertScope(auth, "write:memos");
      const memoIds = getRequiredStringArray(args.memoIds, "memoIds");

      if (args.dryRun === true) {
        return { dryRun: true, memos: await getMemosForBulkAction(c.env.storage.db, auth.workspaceId, memoIds, 1) };
      }

      const restored = await restoreMemosRecord(c.env.storage.db, auth.workspaceId, memoIds, getAuditActor(c));
      return { ok: true, restored };
    }
    case "upload_memo_image": {
      assertScope(auth, "write:resources");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId);

      if (!memo) {
        throw new AppError("not_found", "Memo not found", 404);
      }

      const mimeType = getRequiredString(args.mimeType, "mimeType");
      const filename = getOptionalString(args.filename) ?? `image${inferImageExtension("", mimeType)}`;
      const bytes = await decodeBase64Data(getRequiredString(args.dataBase64, "dataBase64"));
      const resource = await createImageResource(c, {
        memoId,
        filename,
        mimeType,
        bytes,
        actor: getAuditActor(c),
        source: "mcp",
      });
      const alt = getOptionalString(args.alt) ?? normalizeFilename(filename) ?? "image";

      return {
        resource,
        markdownImage: `![${escapeMarkdownImageAlt(alt)}](${resource.url})`,
      };
    }
    case "move_memos": {
      assertScope(auth, "write:memos");
      const notebookId = getRequiredString(args.notebookId, "notebookId");
      const memoIds = getRequiredStringArray(args.memoIds, "memoIds");
      const target = await getNotebook(c.env.storage.db, auth.workspaceId, notebookId);

      if (!target) {
        throw new AppError("not_found", "Target notebook not found", 404);
      }

      if (args.dryRun === true) {
        return { dryRun: true, targetNotebook: target, memos: await getMemosForBulkAction(c.env.storage.db, auth.workspaceId, memoIds, 0) };
      }

      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const moved = await moveMemosToNotebook(c.env.storage.db, auth.workspaceId, memoIds, notebookId, actor, actorLabel);

      return { ok: true, moved };
    }
    case "add_tags_to_memos": {
      assertScope(auth, "write:tags");
      return await updateTagsForMemos(c.env.storage.db, {
        workspaceId: auth.workspaceId,
        memoIds: getRequiredStringArray(args.memoIds, "memoIds"),
        tags: getRequiredStringArray(args.tags, "tags"),
        mode: "add",
        dryRun: args.dryRun === true,
        actor: getAuditActor(c),
        actorLabel: getActorLabel(c),
      });
    }
    case "remove_tags_from_memos": {
      assertScope(auth, "write:tags");
      return await updateTagsForMemos(c.env.storage.db, {
        workspaceId: auth.workspaceId,
        memoIds: getRequiredStringArray(args.memoIds, "memoIds"),
        tags: getRequiredStringArray(args.tags, "tags"),
        mode: "remove",
        dryRun: args.dryRun === true,
        actor: getAuditActor(c),
        actorLabel: getActorLabel(c),
      });
    }
    case "rename_tag": {
      assertScope(auth, "write:tags");
      const from = getRequiredString(args.from, "from");
      const to = getRequiredString(args.to, "to");

      if (args.dryRun === true) {
        return await previewTagRename(c.env.storage.db, auth.workspaceId, from, to);
      }

      const updated = await updateTagAcrossMemos(c.env.storage.db, auth.workspaceId, from, to, getAuditActor(c), getActorLabel(c));
      return { ok: true, updated };
    }
    case "delete_tag": {
      assertScope(auth, "write:tags");
      const tag = getRequiredString(args.tag, "tag");

      if (args.dryRun === true) {
        return await previewTagRename(c.env.storage.db, auth.workspaceId, tag, null);
      }

      const updated = await updateTagAcrossMemos(c.env.storage.db, auth.workspaceId, tag, null, getAuditActor(c), getActorLabel(c));
      return { ok: true, updated };
    }
    case "merge_memos": {
      assertScope(auth, "write:memos");
      const actor = getAuditActor(c);
      const actorLabel = getActorLabel(c);
      const memo = await mergeMemosRecord(
        c.env.storage.db,
        auth.workspaceId,
        {
          memoIds: getRequiredStringArray(args.memoIds, "memoIds"),
          notebookId: getOptionalString(args.notebookId) ?? undefined,
          title: getOptionalString(args.title) ?? undefined,
        },
        actor,
        actorLabel
      );

      return { memo };
    }
    case "upload_memo_attachment": {
      assertScope(auth, "write:resources");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId);

      if (!memo) {
        throw new AppError("not_found", "Memo not found", 404);
      }

      const filename = getRequiredString(args.filename, "filename");
      const bytes = await decodeBase64Data(getRequiredString(args.dataBase64, "dataBase64"));
      const resource = await createAttachmentResource(c, {
        memoId,
        filename,
        mimeType: getRequiredString(args.mimeType, "mimeType"),
        bytes,
        actor: getAuditActor(c),
      });
      const label = getOptionalString(args.label) ?? normalizeFilename(filename) ?? "attachment";

      return {
        resource,
        markdownLink: `[${escapeMarkdownLinkLabel(label)}](${resource.url})`,
      };
    }
    case "list_memo_resources": {
      assertScope(auth, "read:resources");
      const memoId = getRequiredString(args.memoId, "memoId");
      const memo = await getMemoDetail(c.env.storage.db, auth.workspaceId, memoId, true);

      if (!memo) {
        throw new AppError("not_found", "Memo not found", 404);
      }

      return { resources: await listResourcesForMemo(c.env.storage.db, auth.workspaceId, memoId) };
    }
    case "list_resources": {
      assertScope(auth, "read:resources");
      return await listResourcesForMcp(c.env.storage.db, auth.workspaceId, clampNumber(Number(args.limit ?? 100), 1, 500));
    }
    case "list_memo_revisions": {
      assertScope(auth, "read:memos");
      return {
        revisions: await listMemoRevisions(
          c.env.storage.db,
          auth.workspaceId,
          getRequiredString(args.memoId, "memoId"),
          clampNumber(Number(args.limit ?? 50), 1, 100)
        ),
      };
    }
    case "restore_memo_revision": {
      assertScope(auth, "write:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const revisionId = getRequiredString(args.revisionId, "revisionId");
      const revision = await getMemoRevisionRow(c.env.storage.db, auth.workspaceId, memoId, revisionId);

      if (!revision) {
        throw new AppError("not_found", "Memo revision not found", 404);
      }

      if (args.dryRun === true) {
        return { dryRun: true, revision: mapMemoRevision(revision) };
      }

      return { memo: await restoreMemoRevisionRecord(c.env.storage.db, auth.workspaceId, memoId, revisionId, getAuditActor(c), getActorLabel(c)) };
    }
    case "move_notebook": {
      assertScope(auth, "write:notebooks");
      const actor = getAuditActor(c);
      const notebook = await updateNotebookRecord(
        c.env.storage.db,
        auth.workspaceId,
        getRequiredString(args.notebookId, "notebookId"),
        {
          parentId: args.parentId === null ? null : getOptionalString(args.parentId) ?? undefined,
          sortOrder: typeof args.sortOrder === "number" && Number.isInteger(args.sortOrder) ? args.sortOrder : undefined,
        },
        actor
      );

      return { notebook };
    }
    case "create_notebook": {
      assertScope(auth, "write:notebooks");
      const actor = getAuditActor(c);
      const name = getRequiredString(args.name, "name");

      if (name.length > 80) {
        throw new AppError("invalid_params", "name must be at most 80 characters", 400);
      }

      const notebook = await createNotebookRecord(
        c.env.storage.db,
        auth.workspaceId,
        {
          name,
          parentId: args.parentId === null ? null : getOptionalString(args.parentId) ?? undefined,
          sortOrder: typeof args.sortOrder === "number" && Number.isInteger(args.sortOrder) ? args.sortOrder : undefined,
        },
        actor
      );

      return { notebook };
    }
    case "rename_notebook": {
      assertScope(auth, "write:notebooks");
      const name = getRequiredString(args.name, "name");

      if (name.length > 80) {
        throw new AppError("invalid_params", "name must be at most 80 characters", 400);
      }

      const notebook = await updateNotebookRecord(
        c.env.storage.db,
        auth.workspaceId,
        getRequiredString(args.notebookId, "notebookId"),
        { name },
        getAuditActor(c)
      );

      return { notebook };
    }
    case "get_notebook": {
      assertScope(auth, "read:notebooks");
      const notebook = await getNotebook(c.env.storage.db, auth.workspaceId, getRequiredString(args.notebookId, "notebookId"));
      if (!notebook) {
        throw new AppError("not_found", "Notebook not found in the authenticated user's workspace.", 404);
      }
      return { notebook };
    }
    case "find_notebooks": {
      assertScope(auth, "read:notebooks");
      return {
        notebooks: await findNotebooks(c.env.storage.db, auth.workspaceId, {
          name: getRequiredString(args.name, "name"),
          parentId: Object.hasOwn(args, "parentId")
            ? args.parentId === null
              ? null
              : getRequiredString(args.parentId, "parentId")
            : undefined,
          exact: args.exact === true,
          limit: clampNumber(Number(args.limit ?? 20), 1, 50),
        }),
      };
    }
    case "resolve_notebook_path": {
      assertScope(auth, "read:notebooks");
      return await resolveNotebookPath(c.env.storage.db, auth.workspaceId, getRequiredString(args.path, "path"));
    }
    case "list_notebooks": {
      assertScope(auth, "read:notebooks");
      return { notebooks: await listNotebooks(c.env.storage.db, auth.workspaceId) };
    }
    case "list_tags": {
      assertScope(auth, "read:tags");
      return { tags: await listTagSummaries(c.env.storage.db, auth.workspaceId) };
    }
    case "get_workspace_stats": {
      assertScope(auth, "read:memos");
      return await getWorkspaceStats(c.env.storage.db, auth.workspaceId);
    }
    case "list_note_templates": {
      assertScope(auth, "read:memos");
      return { templates: await listMemoTemplates(c.env.storage.db, auth.workspaceId) };
    }
    case "get_note_template": {
      assertScope(auth, "read:memos");
      const template = await getMemoTemplate(
        c.env.storage.db,
        auth.workspaceId,
        getRequiredString(args.templateId, "templateId"),
      );
      if (!template) throw new AppError("not_found", "Template not found", 404);
      return { template };
    }
    case "create_note_template": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const input = parseMcpInput(TemplateCreateSchema, args);
      const memo = input.memoId
        ? await getMemoDetail(c.env.storage.db, auth.workspaceId, input.memoId)
        : null;
      if (input.memoId && !memo) throw new AppError("not_found", "Memo not found", 404);

      const id = createId("template");
      const now = isoNow();
      const title = memo?.title ?? (input.title?.trim() || null);
      const contentMarkdown = memo?.contentMarkdown ?? input.contentMarkdown ?? "";
      const tags = memo?.tags ?? input.tags ?? [];
      const contentJson = memo?.contentJson ?? markdownToDoc(contentMarkdown);
      await c.env.storage.db.prepare(
        `INSERT INTO memo_templates (
           id, workspace_id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        auth.workspaceId,
        input.name.trim(),
        input.description?.trim() || null,
        title,
        JSON.stringify(contentJson),
        contentMarkdown,
        JSON.stringify(tags),
        now,
        now,
      ).run();
      const actor = getAuditActor(c);
      await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.create", "template", id, {
        memoId: input.memoId ?? null,
      });
      return { template: await getMemoTemplate(c.env.storage.db, auth.workspaceId, id) };
    }
    case "update_note_template": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const templateId = getRequiredString(args.templateId, "templateId");
      const input = parseMcpInput(TemplateUpdateSchema, args);
      if (Object.keys(input).length === 0) {
        throw new AppError("invalid_params", "At least one template field is required.", 400);
      }
      const current = await getMemoTemplate(c.env.storage.db, auth.workspaceId, templateId);
      if (!current) throw new AppError("not_found", "Template not found", 404);

      const contentMarkdown = input.contentMarkdown ?? current.contentMarkdown;
      const contentJson = input.contentMarkdown !== undefined
        ? markdownToDoc(contentMarkdown)
        : current.contentJson;
      const now = isoNow();
      await c.env.storage.db.prepare(
        `UPDATE memo_templates
         SET name = ?, description = ?, title = ?, content_json = ?, content_markdown = ?, tags_json = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      ).bind(
        input.name ?? current.name,
        input.description !== undefined ? input.description?.trim() || null : current.description,
        input.title !== undefined ? input.title?.trim() || null : current.title,
        JSON.stringify(contentJson),
        contentMarkdown,
        JSON.stringify(input.tags ?? current.tags),
        now,
        templateId,
        auth.workspaceId,
      ).run();
      const actor = getAuditActor(c);
      await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.update", "template", templateId, {});
      return { template: await getMemoTemplate(c.env.storage.db, auth.workspaceId, templateId) };
    }
    case "delete_note_template": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const templateId = getRequiredString(args.templateId, "templateId");
      const current = await getMemoTemplate(c.env.storage.db, auth.workspaceId, templateId);
      if (!current) throw new AppError("not_found", "Template not found", 404);
      await c.env.storage.db.prepare(
        `DELETE FROM memo_templates WHERE id = ? AND workspace_id = ?`,
      ).bind(templateId, auth.workspaceId).run();
      const actor = getAuditActor(c);
      await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.delete", "template", templateId, {});
      return { ok: true };
    }
    case "use_note_template": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const templateId = getRequiredString(args.templateId, "templateId");
      const template = await getMemoTemplate(c.env.storage.db, auth.workspaceId, templateId);
      if (!template) throw new AppError("not_found", "Template not found", 404);
      const memo = await createMemoRecord(c.env.storage.db, auth.workspaceId, {
        notebookId: getRequiredString(args.notebookId, "notebookId"),
        title: template.title ?? undefined,
        contentMarkdown: template.contentMarkdown,
        tags: template.tags,
      }, getAuditActor(c), getActorLabel(c));
      const actor = getAuditActor(c);
      await audit(c.env.storage.db, actor.actorType, actor.actorId, "template.use", "template", templateId, { memoId: memo.id });
      return { memo };
    }
    case "list_ai_instructions": {
      assertScope(auth, "read:memos");
      return {
        instructions: await listAiPromptTemplates(
          c.env.storage.db,
          auth.workspaceId,
          getOptionalString(args.locale),
        ),
      };
    }
    case "get_ai_instruction": {
      assertScope(auth, "read:memos");
      const row = await getAiPromptTemplateRow(
        c.env.storage.db,
        auth.workspaceId,
        getRequiredString(args.instructionId, "instructionId"),
      );
      if (!row) throw new AppError("not_found", "AI instruction not found", 404);
      return { instruction: mapAiPromptTemplateRow(row, getOptionalString(args.locale)) };
    }
    case "create_ai_instruction": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const input = parseMcpInput(AiPromptTemplateCreateSchema, args);
      const id = createId("aiprompt");
      const now = isoNow();
      const actor = getAuditActor(c);
      await c.env.storage.db.batch([
        c.env.storage.db.prepare(
          `INSERT INTO ai_prompt_templates (
             id, workspace_id, seed_key, action, parameter_kind, result_mode,
             name, description, instruction,
             name_customized, description_customized, instruction_customized,
             created_at, updated_at
           ) VALUES (?, ?, NULL, 'custom', ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)`,
        ).bind(
          id,
          auth.workspaceId,
          input.parameterKind,
          input.resultMode,
          input.name.trim(),
          input.description?.trim() || null,
          input.instruction.trim(),
          now,
          now,
        ),
        auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "ai_prompt.create", "ai_prompt", id, {}),
      ]);
      const row = await getAiPromptTemplateRow(c.env.storage.db, auth.workspaceId, id);
      return { instruction: mapAiPromptTemplateRow(row!, getOptionalString(args.locale)) };
    }
    case "update_ai_instruction": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const instructionId = getRequiredString(args.instructionId, "instructionId");
      const input = parseMcpInput(AiPromptTemplateUpdateSchema, args);
      const current = await getAiPromptTemplateRow(c.env.storage.db, auth.workspaceId, instructionId);
      if (!current) throw new AppError("not_found", "AI instruction not found", 404);

      const now = isoNow();
      const actor = getAuditActor(c);
      await c.env.storage.db.batch([
        c.env.storage.db.prepare(
          `UPDATE ai_prompt_templates
           SET name = ?, description = ?, instruction = ?,
               parameter_kind = ?, result_mode = ?,
               name_customized = ?, description_customized = ?, instruction_customized = ?,
               updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        ).bind(
          input.name?.trim() ?? current.name,
          input.description !== undefined ? input.description?.trim() || null : current.description,
          input.instruction?.trim() ?? current.instruction,
          input.parameterKind ?? current.parameter_kind,
          input.resultMode ?? current.result_mode,
          input.name !== undefined ? 1 : current.name_customized,
          input.description !== undefined ? 1 : current.description_customized,
          input.instruction !== undefined ? 1 : current.instruction_customized,
          now,
          instructionId,
          auth.workspaceId,
        ),
        auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "ai_prompt.update", "ai_prompt", instructionId, {}),
      ]);
      const row = await getAiPromptTemplateRow(c.env.storage.db, auth.workspaceId, instructionId);
      return { instruction: mapAiPromptTemplateRow(row!, getOptionalString(args.locale)) };
    }
    case "delete_ai_instruction": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const instructionId = getRequiredString(args.instructionId, "instructionId");
      const current = await getAiPromptTemplateRow(c.env.storage.db, auth.workspaceId, instructionId);
      if (!current) throw new AppError("not_found", "AI instruction not found", 404);
      const actor = getAuditActor(c);
      await c.env.storage.db.batch([
        c.env.storage.db.prepare(
          `DELETE FROM ai_prompt_templates WHERE id = ? AND workspace_id = ?`,
        ).bind(instructionId, auth.workspaceId),
        auditStatement(c.env.storage.db, actor.actorType, actor.actorId, "ai_prompt.delete", "ai_prompt", instructionId, {}),
      ]);
      return { ok: true };
    }
    case "restore_default_ai_instructions": {
      assertScope(auth, "write:memos");
      assertMcpMutationAllowed(c.env);
      const result = await restoreMissingDefaultAiPrompts(c.env.storage.db, auth.workspaceId);
      if (result.restoredCount > 0) {
        const actor = getAuditActor(c);
        await audit(c.env.storage.db, actor.actorType, actor.actorId, "ai_prompt.restore_defaults", "workspace", auth.workspaceId, result);
      }
      return {
        ...result,
        instructions: await listAiPromptTemplates(
          c.env.storage.db,
          auth.workspaceId,
          getOptionalString(args.locale),
        ),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const getInstanceAuthMode = async (
  env: Bindings,
  verifyDatabase = false,
): Promise<InstanceAuthMode> => {
  if (!env.storage.db || typeof env.storage.db.prepare !== "function") {
    throw new AppError(
      "database_not_ready",
      "Database is not ready. Bind the D1 database as DB and apply the remote migrations.",
      503,
    );
  }

  const allowUnauthenticated = isUnauthenticatedAccessEnabled(env.EDGE_EVER_ALLOW_UNAUTHENTICATED);
  const bootstrapCredentialConfigured = hasBootstrapCredential(
    env.EDGE_EVER_AUTH_PASSWORD,
    env.EDGE_EVER_AUTH_PASSWORD_HASH,
  );

  if (!verifyDatabase) {
    if (allowUnauthenticated) return "disabled";
    if (bootstrapCredentialConfigured) return "required";
  }

  let user: { id: string } | null;
  try {
    user = await env.storage.db.prepare(`SELECT id FROM users WHERE is_disabled = 0 LIMIT 1`).first<{ id: string }>();
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      throw new AppError(
        "database_not_ready",
        "Database is not ready. Bind the D1 database as DB and apply the remote migrations.",
        503,
      );
    }
    throw error;
  }

  return resolveInstanceAuthMode({
    allowUnauthenticated,
    hasBootstrapCredential: bootstrapCredentialConfigured,
    hasEnabledUser: Boolean(user),
  });
};

const getLoginAttemptKeys = async (c: AppContext, username: string): Promise<LoginAttemptKey[]> => {
  const keys: LoginAttemptKey[] = [{ scope: "username", key: await sha256(username.trim()) }];
  const clientIp = getClientIp(c);

  if (clientIp) {
    keys.push({ scope: "ip", key: await sha256(clientIp) });
  }

  return keys;
};

const getClientIp = (c: Context) => {
  const cloudflareIp = c.req.header("CF-Connecting-IP")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const realIp = c.req.header("X-Real-IP")?.trim();
  if (realIp) return realIp;

  const forwardedIp = c.req.header("X-Forwarded-For")?.split(",", 1)[0]?.trim();
  return forwardedIp || null;
};

const tooManyLoginAttempts = (c: Context, retryAfterSeconds: number) => {
  c.header("Retry-After", String(retryAfterSeconds));
  return apiError(c, "login_rate_limited", "Too many login attempts. Try again later.", 429);
};

const verifyLogin = async (env: Bindings, username: string, password: string): Promise<UserRow | null> => {
  const normalizedUsername = username.trim();
  const existingUser = await getUserByUsername(env.storage.db, normalizedUsername);

  if (existingUser) {
    if (await verifyPassword(password, existingUser.password_hash)) {
      return existingUser;
    }

    if (!isSupportedPasswordHash(existingUser.password_hash)) {
      throw new AppError(
        "password_hash_invalid",
        "This account has an invalid password hash. Reset it with the EdgeEver password reset command.",
        503,
      );
    }

    return null;
  }

  const configuredHash = env.EDGE_EVER_AUTH_PASSWORD_HASH?.trim();
  const configuredPassword = env.EDGE_EVER_AUTH_PASSWORD;

  if (!configuredHash && !configuredPassword) {
    return null;
  }

  const configuredUsername = env.EDGE_EVER_AUTH_USERNAME?.trim() || "admin";

  if (normalizedUsername !== configuredUsername) {
    return null;
  }

  const passwordMatches = await verifyBootstrapPassword(
    password,
    configuredPassword,
    configuredHash,
    verifyPassword,
  );

  if (!passwordMatches) {
    return null;
  }

  const now = isoNow();
  const userId = createId("usr");
  const passwordHash = await hashPassword(password);

  await env.storage.db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, normalizedUsername, passwordHash, normalizedUsername, now, now)
    .run();

  return getUserByUsername(env.storage.db, normalizedUsername);
};

const getUserByUsername = async (db: DatabaseAdapter, username: string) =>
  db
    .prepare(
      `SELECT id, username, password_hash, display_name, is_disabled
       FROM users
       WHERE username = ? AND is_disabled = 0`
    )
    .bind(username)
    .first<UserRow>();

const getInstanceUser = (db: D1Database, userId: string) =>
  db.prepare(
    `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_disabled,
            u.last_login_at, u.created_at, wm.role
     FROM users u
     INNER JOIN workspace_members wm ON wm.user_id = u.id
     WHERE u.id = ?`
  ).bind(userId).first<InstanceUserRow>();

const createSession = async (c: AppContext, user: UserRow, requestedDeviceId?: string) => {
  const token = randomToken(SESSION_TOKEN_BYTES);
  const id = createId("sess");
  const now = isoNow();
  const maxAge = getSessionMaxAge(c.env);
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
  const userAgent = c.req.header("User-Agent") ?? null;
  const deviceId = resolveSessionDeviceId(requestedDeviceId, userAgent, id);
  const ip = c.req.header("CF-Connecting-IP");
  const ipHash = ip ? await sha256(ip) : null;
  const cf = c.req.raw.cf as { country?: string; region?: string } | undefined;
  const ipCountry = c.req.header("CF-IPCountry") ?? cf?.country ?? null;
  const ipRegion = cf?.region ?? null;

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`
    ).bind(now, user.id, deviceId),
    c.env.storage.db.prepare(
      `INSERT INTO sessions (
        id, user_id, token_hash, device_id, user_agent, ip_hash, device_label, ip_address, ip_country, ip_region, expires_at, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, await sha256(token), deviceId, userAgent, ipHash, null, ip ?? null, ipCountry, ipRegion, expiresAt, now, now),
  ]);

  return { id, token, maxAge };
};

const setSessionCookie = (c: AppContext, token: string, maxAge: number) => {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
};

const revokeSession = async (db: D1Database, token: string) => {
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(isoNow(), await sha256(token))
    .run();
};

const authenticateRequest = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const bearerAuth = await authenticateBearerToken(c, touch);

  if (bearerAuth) {
    return bearerAuth;
  }

  return authenticateSession(c, touch);
};

const authenticateBearerToken = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const token = getBearerToken(c);

  if (!token) {
    return null;
  }

  const sessionAuth = await authenticateSessionToken(c, token, touch);

  if (sessionAuth) {
    return sessionAuth;
  }

  const row = await c.env.storage.db.prepare(
    `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at, workspace_id
     FROM api_tokens
     WHERE token_hash = ?
       AND is_revoked = 0
       AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(await sha256(token), isoNow())
    .first<ApiTokenRow>();

  if (!row) {
    return null;
  }

  const lastUsedAt = row.last_used_at ? Date.parse(row.last_used_at) : Number.NaN;
  if (
    touch
    && (!Number.isFinite(lastUsedAt) || lastUsedAt <= Date.now() - API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS)
  ) {
    const now = isoNow();
    const cutoff = new Date(Date.now() - API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS).toISOString();
    await c.env.storage.db.prepare(
      `UPDATE api_tokens
       SET last_used_at = ?
       WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)`,
    ).bind(now, row.id, cutoff).run();
  }

  return {
    kind: "agent",
    actorType: "agent",
    actorId: row.id,
    username: row.name,
    displayName: row.name,
    scopes: parseJsonArray(row.scopes_json),
    workspaceId: row.workspace_id,
    role: "member",
    tokenId: row.id,
  };
};

const authenticateSessionToken = async (c: AppContext, token: string, touch: boolean): Promise<AuthContext | null> => {
  const now = isoNow();
  const row = await c.env.storage.db.prepare(
    `SELECT s.id, s.user_id, u.username, u.display_name, s.expires_at, s.last_seen_at,
            wm.workspace_id, wm.role
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN workspace_members wm ON wm.user_id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.is_disabled = 0`
  )
    .bind(await sha256(token), now)
    .first<SessionRow>();

  if (!row) {
    return null;
  }

  const lastSeenAt = row.last_seen_at ? Date.parse(row.last_seen_at) : Number.NaN;
  if (
    touch
    && (!Number.isFinite(lastSeenAt) || lastSeenAt <= Date.now() - SESSION_LAST_SEEN_UPDATE_INTERVAL_MS)
  ) {
    const cutoff = new Date(Date.now() - SESSION_LAST_SEEN_UPDATE_INTERVAL_MS).toISOString();
    await c.env.storage.db.prepare(
      `UPDATE sessions
       SET last_seen_at = ?
       WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)`,
    ).bind(now, row.id, cutoff).run();
  }

  const workspace = row.workspace_id && row.role
    ? { workspaceId: row.workspace_id, role: row.role }
    : await ensureUserWorkspace(c.env.storage.db, row.user_id, row.username, c.req.header("accept-language"));

  return {
    kind: "user",
    actorType: "user",
    actorId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    scopes: [],
    workspaceId: workspace.workspaceId,
    role: workspace.role,
    sessionId: row.id,
  };
};

const authenticateSession = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  return authenticateSessionToken(c, token, touch);
};

const getBearerToken = (c: AppContext) => {
  const authorization = c.req.header("Authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme.toLowerCase() === "bearer" && token ? token : null;
};

const getSessionMaxAge = (env: Bindings) => {
  const days = clampNumber(Number(env.EDGE_EVER_SESSION_TTL_DAYS ?? DEFAULT_SESSION_TTL_DAYS), 1, MAX_SESSION_TTL_DAYS);
  return days * 24 * 60 * 60;
};

const mapMemoDetail = (row: MemoDetailRow): MemoDetail => ({
  ...mapMemoSummary(row),
  contentJson: parseDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  sourceMemoIds: parseJsonArray(row.source_memo_ids),
  mergeSourceCount: row.merge_source_count,
  mergedIntoMemoId: row.merged_into_memo_id,
});

const mapMemoRevision = (row: MemoRevisionRow): MemoRevision => ({
  id: row.id,
  memoId: row.memo_id,
  revision: row.revision,
  title: row.title,
  tags: parseJsonArray(row.tags_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const restoreJsonNotebooks = async (db: D1Database, workspaceId: string, notebooks: JsonBackupNotebook[]) => {
  await assertIdsAvailableInWorkspace(db, "notebooks", workspaceId, notebooks.map((notebook) => notebook.id));
  const importedIds = new Set(notebooks.map((notebook) => notebook.id));
  const externalParentIds = notebooks
    .map((notebook) => notebook.parentId)
    .filter((id): id is string => Boolean(id) && !importedIds.has(id as string));
  await assertNotebookIdsInWorkspace(db, workspaceId, externalParentIds);
  const statements = notebooks.map((notebook) =>
    db.prepare(
      `INSERT INTO notebooks (
        id, workspace_id, parent_id, name, slug, icon, color, sort_order, is_deleted, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        name = excluded.name,
        slug = excluded.slug,
        icon = excluded.icon,
        color = excluded.color,
        sort_order = excluded.sort_order,
        is_deleted = 0,
        updated_at = excluded.updated_at,
        deleted_at = NULL`
    ).bind(
      notebook.id,
      workspaceId,
      notebook.parentId,
      notebook.name,
      notebook.slug,
      notebook.icon,
      notebook.color,
      notebook.sortOrder,
      notebook.createdAt,
      notebook.updatedAt
    )
  );

  await db.batch(statements);
};

const restoreJsonMemos = async (db: D1Database, workspaceId: string, backups: JsonBackupMemo[]) => {
  await assertIdsAvailableInWorkspace(db, "memos", workspaceId, backups.map((backup) => backup.memo.id));
  await assertNotebookIdsInWorkspace(db, workspaceId, backups.map((backup) => backup.memo.notebookId));
  for (const backup of backups) {
    const memo = backup.memo;
    const contentJson = parseDoc(JSON.stringify(memo.contentJson));
    const contentMarkdown = memo.contentMarkdown || docToMarkdown(contentJson);
    const contentText = docToText(contentJson);
    const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
    const title = normalizeMemoTitle(memo.title);
    const tags = normalizeTags(memo.tags);

    if (backup.revisions.some((revision) => revision.memoId !== memo.id)) {
      throw new AppError("invalid_backup", "A backup revision belongs to a different memo.", 400);
    }

    await db.batch([
      db.prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted,
          source_memo_ids, merge_source_count, merged_into_memo_id,
          created_by, updated_by, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 'restore', 'restore', ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          notebook_id = excluded.notebook_id,
          title = excluded.title,
          excerpt = excluded.excerpt,
          tags_json = excluded.tags_json,
          is_pinned = excluded.is_pinned,
          is_archived = excluded.is_archived,
          is_deleted = 0,
          source_memo_ids = excluded.source_memo_ids,
          merge_source_count = excluded.merge_source_count,
          merged_into_memo_id = NULL,
          updated_by = 'restore',
          updated_at = excluded.updated_at,
          deleted_at = NULL`
      ).bind(
        memo.id,
        workspaceId,
        memo.notebookId,
        title,
        createExcerpt(contentText),
        JSON.stringify(tags),
        memo.isPinned ? 1 : 0,
        memo.isArchived ? 1 : 0,
        JSON.stringify(memo.sourceMemoIds),
        memo.mergeSourceCount,
        memo.createdAt,
        memo.updatedAt
      ),
      db.prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memo_id) DO UPDATE SET
          content_json = excluded.content_json,
          content_markdown = excluded.content_markdown,
          content_text = excluded.content_text,
          content_hash = excluded.content_hash,
          revision = excluded.revision,
          updated_at = excluded.updated_at`
      ).bind(
        memo.id,
        JSON.stringify(contentJson),
        contentMarkdown,
        contentText,
        contentHash,
        memo.revision,
        memo.createdAt,
        memo.updatedAt
      ),
      upsertMemoSearchDocumentStatement(db, memo.id, title, contentText, tags.join(" ")),
      db.prepare(`DELETE FROM memo_revisions WHERE memo_id = ?`).bind(memo.id),
    ]);

    for (let index = 0; index < backup.revisions.length; index += 50) {
      const statements = backup.revisions.slice(index, index + 50).map((revision) => {
        const revisionJson = parseDoc(JSON.stringify(revision.contentJson));
        const revisionMarkdown = revision.contentMarkdown || docToMarkdown(revisionJson);
        const revisionText = docToText(revisionJson);
        return db.prepare(
          `INSERT INTO memo_revisions (
            id, memo_id, revision, title, content_json, content_markdown,
            content_hash, created_by, created_at, tags_json, content_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            revision = excluded.revision,
            title = excluded.title,
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_hash = excluded.content_hash,
            created_by = excluded.created_by,
            created_at = excluded.created_at,
            tags_json = excluded.tags_json,
            content_text = excluded.content_text`
        ).bind(
          revision.id,
          memo.id,
          revision.revision,
          normalizeMemoTitle(revision.title),
          JSON.stringify(revisionJson),
          revisionMarkdown,
          revision.contentHash || "",
          revision.createdBy,
          revision.createdAt,
          JSON.stringify(normalizeTags(revision.tags)),
          revisionText
        );
      });
      await db.batch(statements);
    }
  }

  await audit(db, "user", null, "backup.restore", "backup", createId("restore"), {
    memoCount: backups.length,
  });
};

const assertIdsAvailableInWorkspace = async (
  db: D1Database,
  table: "notebooks" | "memos",
  workspaceId: string,
  ids: string[],
) => {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  const collision = await db.prepare(
    `SELECT id FROM ${table} WHERE workspace_id <> ? AND id IN (${placeholders}) LIMIT 1`
  ).bind(workspaceId, ...ids).first<{ id: string }>();
  if (collision) {
    throw new AppError("cross_workspace_id_conflict", "Backup contains an ID already used by another user.", 409);
  }
};

const assertNotebookIdsInWorkspace = async (db: D1Database, workspaceId: string, ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return;
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT id FROM notebooks WHERE workspace_id = ? AND id IN (${placeholders})`
  ).bind(workspaceId, ...uniqueIds).all<{ id: string }>();
  if (rows.results.length !== uniqueIds.length) {
    throw new AppError("invalid_backup_workspace", "Backup references a notebook outside the current workspace.", 400);
  }
};

const getCurrentWorkspaceIdentity = async (db: D1Database, auth: AuthContext) => {
  const row = await db.prepare(
    `SELECT w.id AS workspace_id, w.name AS workspace_name, w.is_personal,
            u.id AS user_id, u.username, u.display_name, wm.role
     FROM workspaces w
     INNER JOIN workspace_members wm ON wm.workspace_id = w.id
     INNER JOIN users u ON u.id = wm.user_id
     WHERE w.id = ?
     ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, wm.created_at ASC
     LIMIT 1`
  ).bind(auth.workspaceId, auth.kind === "user" ? auth.actorId : null).first<WorkspaceIdentityRow>();

  if (!row) {
    throw new AppError("workspace_identity_not_found", "The authenticated workspace has no associated user.", 404);
  }

  return {
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      isPersonal: row.is_personal === 1,
    },
    authorization: {
      kind: auth.kind === "agent" ? "api_token" : "user_session",
      ...(auth.kind === "agent" ? { tokenName: auth.username, scopes: auth.scopes } : {}),
    },
    dataIsolation: {
      workspaceScoped: true,
      statement:
        "Every notebook and memo returned by this MCP server belongs to this workspace; data from other users is excluded.",
    },
  };
};

const searchMemoSummaries = async (
  db: D1Database,
  options: {
    workspaceId: string;
    query?: string | null;
    notebookId?: string | null;
    tags?: string[];
    createdAfter?: string | null;
    createdBefore?: string | null;
    updatedAfter?: string | null;
    updatedBefore?: string | null;
    isPinned?: boolean | null;
    hasResources?: boolean | null;
    limit: number;
  }
): Promise<MemoSummary[]> => {
  const q = options.query?.trim();
  const notebookId = options.notebookId?.trim() || null;
  const tags = normalizeTags(options.tags ?? []);
  const limit = clampNumber(options.limit, 1, 100);
  const filters = ["m.workspace_id = ?", "m.is_deleted = 0"];
  const binds: unknown[] = [options.workspaceId];

  if (notebookId) {
    filters.push("m.notebook_id = ?");
    binds.push(notebookId);
  }

  for (const tag of tags) {
    filters.push("EXISTS (SELECT 1 FROM memo_tags mt WHERE mt.memo_id = m.id AND mt.workspace_id = ? AND mt.name = ?)");
    binds.push(options.workspaceId, tag);
  }

  if (options.createdAfter) {
    filters.push("m.created_at >= ?");
    binds.push(options.createdAfter);
  }

  if (options.createdBefore) {
    filters.push("m.created_at <= ?");
    binds.push(options.createdBefore);
  }

  if (options.updatedAfter) {
    filters.push("m.updated_at >= ?");
    binds.push(options.updatedAfter);
  }

  if (options.updatedBefore) {
    filters.push("m.updated_at <= ?");
    binds.push(options.updatedBefore);
  }

  if (options.isPinned !== null && options.isPinned !== undefined) {
    filters.push("m.is_pinned = ?");
    binds.push(options.isPinned ? 1 : 0);
  }

  if (options.hasResources !== null && options.hasResources !== undefined) {
    filters.push(
      options.hasResources
        ? "EXISTS (SELECT 1 FROM resources r WHERE r.memo_id = m.id AND r.is_deleted = 0)"
        : "NOT EXISTS (SELECT 1 FROM resources r WHERE r.memo_id = m.id AND r.is_deleted = 0)"
    );
  }

  if (q) {
    const ftsQuery = toFtsQuery(q);
    const likeQuery = `%${escapeLike(q)}%`;

    if (ftsQuery) {
      const rows = await db
        .prepare(
          `WITH raw_matches(memo_id, rank) AS (
             SELECT memo_id, bm25(memos_fts)
             FROM memos_fts
             WHERE memos_fts MATCH ?

             UNION ALL

             SELECT m.id, 100.0
             FROM memos m
             INNER JOIN memo_contents c ON c.memo_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\'
                OR c.content_text LIKE ? ESCAPE '\\'
                OR m.tags_json LIKE ? ESCAPE '\\'
           ),
           search_matches AS (
             SELECT memo_id, MIN(rank) AS rank
             FROM raw_matches
             GROUP BY memo_id
           )
           SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                  m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
                  c.content_text
           FROM search_matches s
           INNER JOIN memos m ON m.id = s.memo_id
           INNER JOIN memo_contents c ON c.memo_id = m.id
           WHERE ${filters.join(" AND ")}
           ORDER BY s.rank ASC, m.is_pinned DESC, m.updated_at DESC
           LIMIT ?`
        )
        .bind(ftsQuery, likeQuery, likeQuery, likeQuery, ...binds, limit)
        .all<MemoSummaryRow>();

      return rows.results.map(mapMemoSummary);
    }
  }

  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE ${filters.join(" AND ")}
       ORDER BY m.is_pinned DESC, m.updated_at DESC
       LIMIT ?`
    )
    .bind(...binds, limit)
    .all<MemoSummaryRow>();

  return rows.results.map(mapMemoSummary);
};

const listMemosForMcp = async (
  db: D1Database,
  options: { workspaceId: string; notebookId?: string | null; limit: number; offset: number; includeContent: boolean; includeDeleted: boolean }
) => {
  const notebookId = options.notebookId?.trim() || null;
  const limit = clampNumber(options.limit, 1, 100);
  const offset = clampNumber(options.offset, 0, 100_000);
  const pageSize = limit + 1;
  const deletedFilter = options.includeDeleted ? "1 = 1" : "m.is_deleted = 0";

  if (options.includeContent) {
    const rows = await db
      .prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
                c.content_json, c.content_markdown, c.content_text, c.content_hash,
                m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
         FROM memos m
         INNER JOIN memo_contents c ON c.memo_id = m.id
         WHERE m.workspace_id = ? AND ${deletedFilter}
           AND (? IS NULL OR m.notebook_id = ?)
         ORDER BY m.updated_at DESC, m.id ASC
         LIMIT ? OFFSET ?`
      )
      .bind(options.workspaceId, notebookId, notebookId, pageSize, offset)
      .all<MemoDetailRow>();
    const page = rows.results.slice(0, limit).map(mapMemoDetail);

    return {
      memos: page,
      limit,
      offset,
      nextOffset: rows.results.length > limit ? offset + limit : null,
      hasMore: rows.results.length > limit,
    };
  }

  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND ${deletedFilter}
         AND (? IS NULL OR m.notebook_id = ?)
       ORDER BY m.updated_at DESC, m.id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(options.workspaceId, notebookId, notebookId, pageSize, offset)
    .all<MemoSummaryRow>();
  const page = rows.results.slice(0, limit).map(mapMemoSummary);

  return {
    memos: page,
    limit,
    offset,
    nextOffset: rows.results.length > limit ? offset + limit : null,
    hasMore: rows.results.length > limit,
  };
};

const getMemoDetailRow = async (
  db: D1Database,
  workspaceId: string,
  id: string,
  includeDeleted = false
): Promise<MemoDetailRow | null> =>
  db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.id = ? AND m.workspace_id = ? AND (? = 1 OR m.is_deleted = 0)`
    )
    .bind(id, workspaceId, includeDeleted ? 1 : 0)
    .first<MemoDetailRow>();

const getMemoDetail = async (db: D1Database, workspaceId: string, id: string, includeDeleted = false): Promise<MemoDetail | null> => {
  const row = await getMemoDetailRow(db, workspaceId, id, includeDeleted);
  return row ? mapMemoDetail(row) : null;
};

export const createMemoEditSession = async (c: AppContext, memoId: string): Promise<MemoEditSession | null> => {
  const current = await getMemoDetailRow(c.env.storage.db, getWorkspaceId(c), memoId);
  if (!current) return null;

  const actor = getAuditActor(c);
  const now = isoNow();
  const existing = await c.env.storage.db.prepare(
    `SELECT id, memo_id, base_revision, base_content_hash, expires_at
     FROM memo_edit_sessions
     WHERE memo_id = ? AND actor_type = ? AND actor_id IS ?
       AND base_revision = ? AND base_content_hash = ? AND expires_at > ?
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).bind(
    memoId,
    actor.actorType,
    actor.actorId,
    current.revision,
    current.content_hash,
    now,
  ).first<{
    id: string;
    memo_id: string;
    base_revision: number;
    base_content_hash: string;
    expires_at: string;
  }>();

  if (existing) {
    return {
      id: existing.id,
      memoId: existing.memo_id,
      baseRevision: existing.base_revision,
      baseContentHash: existing.base_content_hash,
      expiresAt: existing.expires_at,
    };
  }

  const session: MemoEditSession = {
    id: createId("edit"),
    memoId,
    baseRevision: current.revision,
    baseContentHash: current.content_hash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  };

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(`DELETE FROM memo_edit_sessions WHERE expires_at <= ?`).bind(now),
    c.env.storage.db.prepare(
      `INSERT INTO memo_edit_sessions (
         id, memo_id, actor_type, actor_id, base_revision, base_content_hash,
         expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      memoId,
      actor.actorType,
      actor.actorId,
      session.baseRevision,
      session.baseContentHash,
      session.expiresAt,
      now,
      now,
    ),
  ]);

  return session;
};

const deleteMemosRecord = async (
  env: Bindings,
  workspaceId: string,
  memoIds: string[],
  permanent: boolean,
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const db = env.storage.db;
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const expectedDeletedState = permanent ? 1 : 0;
  const rows = await db
    .prepare(
      `SELECT id
       FROM memos
       WHERE workspace_id = ? AND is_deleted = ? AND id IN (${placeholders})`
    )
    .bind(workspaceId, expectedDeletedState, ...uniqueMemoIds)
    .all<{ id: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError(
      "missing_memos",
      permanent ? "One or more memos cannot be permanently deleted." : "One or more memos cannot be deleted.",
      400
    );
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [];

  if (permanent) {
    const resourceRows = await db
      .prepare(
        `SELECT object_key, storage_config_id
         FROM resources
         WHERE memo_id IN (${placeholders})`
      )
      .bind(...uniqueMemoIds)
      .all<{ object_key: string; storage_config_id: string }>();

    if (resourceRows.results.length > 0) {
      await deleteStoredObjects(env, resourceRows.results);
    }

    statements.push(
      db.prepare(`DELETE FROM resources WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memo_revisions WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memo_contents WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memos WHERE workspace_id = ? AND is_deleted = 1 AND id IN (${placeholders})`).bind(workspaceId, ...uniqueMemoIds)
    );

    for (const memoId of uniqueMemoIds) {
      statements.push(auditStatement(db, actor.actorType, actor.actorId, "memo.delete_permanent", "memo", memoId, {}));
    }
  } else {
    statements.push(
      db.prepare(`DELETE FROM memo_shares WHERE workspace_id = ? AND memo_id IN (${placeholders})`).bind(workspaceId, ...uniqueMemoIds),
      db
        .prepare(
          `UPDATE memos
           SET is_deleted = 1, deleted_at = ?, updated_at = ?
           WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
        )
        .bind(now, now, workspaceId, ...uniqueMemoIds),
      db
        .prepare(
          `UPDATE resources
           SET is_deleted = 1, deleted_at = ?, updated_at = ?
           WHERE is_deleted = 0 AND memo_id IN (${placeholders})`
        )
        .bind(now, now, ...uniqueMemoIds),
      deleteMemoSearchDocumentsStatement(db, uniqueMemoIds)
    );

    for (const memoId of uniqueMemoIds) {
      statements.push(auditStatement(db, actor.actorType, actor.actorId, "memo.delete", "memo", memoId, {}));
    }
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

const deleteMemoRecord = async (
  env: Bindings,
  workspaceId: string,
  memoId: string,
  permanent: boolean,
  actor: AuditActor,
) => {
  const current = await getMemoDetailRow(env.storage.db, workspaceId, memoId, permanent);

  if (permanent && (!current || current.is_deleted === 0)) {
    throw new AppError("not_found", "Memo not found in trash", 404);
  }

  // Soft deletion historically treats an unknown/already-deleted memo as an idempotent no-op.
  if (!permanent && !current) return;

  await deleteMemosRecord(env, workspaceId, [memoId], permanent, actor);
};

const getMemosForBulkAction = async (db: D1Database, workspaceId: string, memoIds: string[], deletedState: 0 | 1) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return [];
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = ?
         AND m.id IN (${placeholders})
       ORDER BY m.updated_at DESC, m.id ASC`
    )
    .bind(workspaceId, deletedState, ...uniqueMemoIds)
    .all<MemoSummaryRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be found for this action in the expected state.", 400);
  }

  return rows.results.map(mapMemoSummary);
};

const restoreMemosRecord = async (
  db: D1Database,
  workspaceId: string,
  memoIds: string[],
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.tags_json, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = 1 AND m.id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<{ id: string; notebook_id: string; title: string | null; tags_json: string; content_text: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be restored.", 400);
  }

  const notebookIds = Array.from(new Set(rows.results.map((row) => row.notebook_id)));
  const notebookPlaceholders = notebookIds.map(() => "?").join(", ");
  const notebookRows = await db
    .prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${notebookPlaceholders})`)
    .bind(workspaceId, ...notebookIds)
    .all<{ id: string }>();
  const activeNotebookIds = new Set(notebookRows.results.map((row) => row.id));

  const needsInbox = rows.results.some((row) => !activeNotebookIds.has(row.notebook_id));

  const inbox = needsInbox
    ? await db.prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND slug = 'inbox' AND is_deleted = 0 LIMIT 1`).bind(workspaceId).first<{ id: string }>()
    : null;
  if (needsInbox && !inbox) {
    throw new AppError("restore_notebook_missing", "Original notebooks were deleted and the default inbox is unavailable.", 409);
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [];

  for (const row of rows.results) {
    const restoreNotebookId = activeNotebookIds.has(row.notebook_id) ? row.notebook_id : inbox!.id;
    const tags = parseJsonArray(row.tags_json);

    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET notebook_id = ?, is_deleted = 0, deleted_at = NULL, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND is_deleted = 1`
        )
        .bind(restoreNotebookId, now, row.id, workspaceId),
      db
        .prepare(
          `UPDATE resources
           SET is_deleted = 0, deleted_at = NULL, updated_at = ?
           WHERE memo_id = ? AND is_deleted = 1`
        )
        .bind(now, row.id),
      upsertMemoSearchDocumentStatement(db, row.id, row.title, row.content_text, tags.join(" ")),
      auditStatement(db, actor.actorType, actor.actorId, "memo.restore", "memo", row.id, {
        fromNotebookId: row.notebook_id,
        toNotebookId: restoreNotebookId,
      })
    );
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

const restoreMemoRecord = async (
  db: D1Database,
  workspaceId: string,
  memoId: string,
  actor: AuditActor,
): Promise<MemoDetail> => {
  const current = await getMemoDetailRow(db, workspaceId, memoId, true);
  if (!current || current.is_deleted === 0) {
    throw new AppError("not_found", "Memo not found in trash", 404);
  }

  await restoreMemosRecord(db, workspaceId, [memoId], actor);
  const memo = await getMemoDetail(db, workspaceId, memoId);
  if (!memo) throw new AppError("not_found", "Memo not found after restore", 404);
  return memo;
};

const emptyTrashMemosRecord = async (
  env: Bindings,
  workspaceId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const db = env.storage.db;
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 1`
    )
    .bind(workspaceId).first<{ count: number }>();
  const deleted = countRow?.count ?? 0;

  if (deleted === 0) {
    return 0;
  }

  const resourceRows = await db
    .prepare(
      `SELECT r.object_key, r.storage_config_id
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND m.is_deleted = 1`
    )
    .bind(workspaceId).all<{ object_key: string; storage_config_id: string }>();

  if (resourceRows.results.length > 0) {
    await deleteStoredObjects(env, resourceRows.results);
  }

  await db.batch([
    db.prepare(`UPDATE resources SET original_memo_id = NULL WHERE original_memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM resources WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memo_revisions WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memos WHERE workspace_id = ? AND is_deleted = 1`).bind(workspaceId),
    auditStatement(db, actor.actorType, actor.actorId, "memo.trash_empty", "trash", "memos", { deleted }),
  ]);

  return deleted;
};

const isDemoMode = (env: Bindings) => isDemoModeEnabled(env.EDGE_EVER_DEMO_MODE);
const isLocalDemoSeedEnabled = (env: Bindings) =>
  env.EDGE_EVER_LOCAL_DEMO_SEED?.trim().toLowerCase() === "true";

let localDemoSeedPromise: Promise<void> | null = null;

const ensureLocalDemoSeed = (env: Bindings) => {
  localDemoSeedPromise ??= (async () => {
    const memoPlaceholders = DEMO_SEED_MEMO_IDS.map(() => "?").join(", ");
    await env.storage.db.batch([
      env.storage.db.prepare(`DELETE FROM mobile_sync_changes`),
      env.storage.db.prepare(`DELETE FROM memo_search_documents`),
      env.storage.db.prepare(`DELETE FROM resources`),
      env.storage.db.prepare(`DELETE FROM memo_revisions`),
      env.storage.db.prepare(`DELETE FROM memo_contents WHERE memo_id NOT IN (${memoPlaceholders})`).bind(...DEMO_SEED_MEMO_IDS),
      env.storage.db.prepare(`DELETE FROM memos WHERE id NOT IN (${memoPlaceholders})`).bind(...DEMO_SEED_MEMO_IDS),
    ]);

    await ensureDemoSeed(env, { overwriteExisting: true, refreshResources: true });
    await audit(env.storage.db, "system", null, "demo.local_seed", "demo", "edgeever-local", {
      seedMemoCount: DEMO_SEED_MEMOS.length,
      mode: "sync-seed",
    });
  })().catch((error) => {
    localDemoSeedPromise = null;
    throw error;
  });

  return localDemoSeedPromise;
};

const ensureDemoSeed = async (
  env: Bindings,
  options: { overwriteExisting?: boolean; refreshResources?: boolean } = {},
) => {
  const db = env.storage.db;
  const now = isoNow();
  const statements: D1PreparedStatement[] = [];
  const bucketName = env.EDGE_EVER_R2_BUCKET_NAME?.trim() || DEFAULT_R2_BUCKET_NAME;
  const overwriteExisting = options.overwriteExisting === true;
  const existingNotebookIds = overwriteExisting
    ? new Set<string>()
    : new Set(
        (
          await db
            .prepare(`SELECT id FROM notebooks WHERE id IN (${DEMO_SEED_NOTEBOOK_IDS.map(() => "?").join(", ")})`)
            .bind(...DEMO_SEED_NOTEBOOK_IDS)
            .all<{ id: string }>()
        ).results.map((notebook) => notebook.id),
      );
  const existingMemoIds = overwriteExisting
    ? new Set<string>()
    : new Set(
        (
          await db
            .prepare(`SELECT id FROM memos WHERE id IN (${DEMO_SEED_MEMO_IDS.map(() => "?").join(", ")})`)
            .bind(...DEMO_SEED_MEMO_IDS)
            .all<{ id: string }>()
        ).results.map((memo) => memo.id),
      );

  for (const notebook of DEMO_SEED_NOTEBOOKS) {
    if (!shouldUpsertDemoSeedRecord(existingNotebookIds, notebook.id, overwriteExisting)) {
      continue;
    }

    statements.push(
      db
        .prepare(
          `INSERT INTO notebooks (
            id, parent_id, name, slug, icon, color, sort_order, is_deleted, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            parent_id = excluded.parent_id,
            name = excluded.name,
            slug = excluded.slug,
            icon = excluded.icon,
            color = excluded.color,
            sort_order = excluded.sort_order,
            is_deleted = 0,
            updated_at = excluded.updated_at,
            deleted_at = NULL`
        )
        .bind(
          notebook.id,
          notebook.parentId,
          notebook.name,
          notebook.slug,
          notebook.icon,
          notebook.color,
          notebook.sortOrder,
          now,
          now
        )
    );
  }

  for (const memo of DEMO_SEED_MEMOS) {
    const isOverviewSeedMemo = memo.id === "memo_demo_overview" || memo.id === "memo_demo_overview_en";
    if (!overwriteExisting && !isOverviewSeedMemo && existingMemoIds.has(memo.id)) {
      continue;
    }

    const contentJson = markdownToDoc(memo.markdown);
    const applyDemoImageWidths = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.type === "image") {
          node.attrs = { ...node.attrs, width: 35 };
        }
        if (Array.isArray(node.content)) {
          applyDemoImageWidths(node.content);
        }
      }
    };
    if (Array.isArray(contentJson.content)) {
      applyDemoImageWidths(contentJson.content);
    }
    const contentText = docToText(contentJson);
    const contentHash = await sha256(memo.markdown + JSON.stringify(contentJson));

    statements.push(
      db
        .prepare(
          `INSERT INTO memos (
            id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted,
            created_by, updated_by, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'system', 'system', ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            notebook_id = excluded.notebook_id,
            title = excluded.title,
            excerpt = excluded.excerpt,
            tags_json = excluded.tags_json,
            is_pinned = excluded.is_pinned,
            is_archived = 0,
            is_deleted = 0,
            updated_by = 'system',
            updated_at = excluded.updated_at,
            deleted_at = NULL`
        )
        .bind(
          memo.id,
          memo.notebookId,
          memo.title,
          createExcerpt(contentText),
          JSON.stringify(normalizeTags(memo.tags)),
          memo.isPinned ? 1 : 0,
          now,
          now
        ),
      db
        .prepare(
          `INSERT INTO memo_contents (
            memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(memo_id) DO UPDATE SET
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_text = excluded.content_text,
            content_hash = excluded.content_hash,
            revision = excluded.revision,
            updated_at = excluded.updated_at`
        )
        .bind(
          memo.id,
          JSON.stringify(contentJson),
          memo.markdown,
          contentText,
          contentHash,
          "revision" in memo ? memo.revision : 0,
          now,
          now,
        ),
      upsertMemoSearchDocumentStatement(db, memo.id, memo.title, contentText, memo.tags.join(" "))
    );
  }

  for (const revision of DEMO_SEED_REVISIONS) {
    const contentJson = markdownToDoc(revision.markdown);
    const contentHash = await sha256(revision.markdown + JSON.stringify(contentJson));

    statements.push(
      db
        .prepare(
          `INSERT INTO memo_revisions (
            id, memo_id, revision, title, content_json, content_markdown, content_hash,
            created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'system', ?)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            revision = excluded.revision,
            title = excluded.title,
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_hash = excluded.content_hash`
        )
        .bind(
          revision.id,
          revision.memoId,
          revision.revision,
          revision.title,
          JSON.stringify(contentJson),
          revision.markdown,
          contentHash,
          now,
        ),
    );
  }

  const existingResourceIds = options.refreshResources || overwriteExisting
    ? new Set<string>()
    : new Set(
        (
          await db
            .prepare(`SELECT id FROM resources WHERE id IN (${DEMO_SEED_ATTACHMENT_RESOURCES.map(() => "?").join(", ")})`)
            .bind(...DEMO_SEED_ATTACHMENT_RESOURCES.map((resource) => resource.id))
            .all<{ id: string }>()
        ).results.map((resource) => resource.id)
      );

  for (const resource of DEMO_SEED_ATTACHMENT_RESOURCES) {
    if (!shouldUpsertDemoSeedRecord(existingResourceIds, resource.id, overwriteExisting)) {
      continue;
    }

    const isImageSeed = "svg" in resource;
    const bytes = isImageSeed ? new TextEncoder().encode(resource.svg) : decodeDemoAttachment(resource);
    const extension = isImageSeed ? "svg" : resource.filename.split(".").pop() || "bin";
    const objectKey = `demo/${resource.memoId}/${resource.id}.${extension}`;

    if (options.refreshResources || !existingResourceIds.has(resource.id)) {
      await env.storage.resources.put(objectKey, bytes, {
        httpMetadata: {
          contentType: resource.mimeType,
          cacheControl: "private, max-age=3600",
        },
        customMetadata: {
          memoId: resource.memoId,
          resourceId: resource.id,
          filename: resource.filename,
          demoSeed: "true",
        },
      });
    }

    statements.push(
      db
        .prepare(
          `INSERT INTO resources (
            id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
            byte_size, sha256, width, height, metadata_json, is_deleted, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, 'builtin', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            bucket_name = excluded.bucket_name,
            object_key = excluded.object_key,
            storage_config_id = excluded.storage_config_id,
            kind = excluded.kind,
            mime_type = excluded.mime_type,
            filename = excluded.filename,
            byte_size = excluded.byte_size,
            sha256 = excluded.sha256,
            width = excluded.width,
            height = excluded.height,
            metadata_json = excluded.metadata_json,
            is_deleted = 0,
            updated_at = excluded.updated_at,
            deleted_at = NULL`
        )
        .bind(
          resource.id,
          resource.memoId,
          bucketName,
          objectKey,
          isImageSeed ? "image" : "attachment",
          resource.mimeType,
          resource.filename,
          bytes.byteLength,
          await sha256Bytes(bytes),
          isImageSeed ? resource.width : null,
          isImageSeed ? resource.height : null,
          JSON.stringify({ source: "demo-seed" }),
          now,
          now
        )
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
};

export const acquireMaintenanceLease = async (
  db: D1Database,
  name: string,
  leaseMs: number,
) => {
  const ownerId = createId("lease");
  const acquiredAt = isoNow();
  const expiresAt = new Date(Date.now() + leaseMs).toISOString();
  const acquired = await db.prepare(
    `INSERT INTO maintenance_leases (name, owner_id, acquired_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       owner_id = excluded.owner_id,
       acquired_at = excluded.acquired_at,
       expires_at = excluded.expires_at
     WHERE maintenance_leases.expires_at <= excluded.acquired_at
     RETURNING owner_id`,
  ).bind(name, ownerId, acquiredAt, expiresAt).first<{ owner_id: string }>();

  return acquired?.owner_id === ownerId ? ownerId : null;
};

const resetDemoData = async (
  env: Bindings,
  scheduledTime: number,
  options: { resetCredentials?: boolean } = {}
) => {
  const db = env.storage.db;
  const leaseOwnerId = await acquireMaintenanceLease(db, "demo-reset", DEMO_RESET_LEASE_MS);
  if (!leaseOwnerId) return false;

  const now = isoNow();
  try {
    const demoUsername = env.EDGE_EVER_AUTH_USERNAME?.trim() || "admin";
    const demoPasswordHash = await resolveDemoPasswordHash(
      env.EDGE_EVER_AUTH_PASSWORD,
      env.EDGE_EVER_AUTH_PASSWORD_HASH,
      hashPassword,
    );
    const resourceRows = await db.prepare(`SELECT object_key, storage_config_id FROM resources`).all<{ object_key: string; storage_config_id: string }>();
    await deleteStoredObjects(env, resourceRows.results);

    const resetStatements: D1PreparedStatement[] = [
      db.prepare(`DELETE FROM mobile_sync_changes`),
      db.prepare(`DELETE FROM memo_search_documents`),
      db.prepare(`DELETE FROM resources`),
      db.prepare(`DELETE FROM memo_revisions`),
      db.prepare(`DELETE FROM memo_contents`),
      db.prepare(`DELETE FROM memos`),
      db.prepare(`UPDATE notebooks SET parent_id = NULL`),
      db.prepare(`DELETE FROM notebooks`),
      db.prepare(`DELETE FROM api_tokens`),
      db.prepare(`DELETE FROM audit_events`),
    ];

    if (options.resetCredentials && demoPasswordHash) {
      resetStatements.push(
        db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ? AND is_disabled = 0`)
          .bind(demoPasswordHash, now, demoUsername),
        db.prepare(
          `UPDATE sessions SET revoked_at = ?
           WHERE user_id IN (SELECT id FROM users WHERE username = ? AND is_disabled = 0)
             AND revoked_at IS NULL`
        ).bind(now, demoUsername),
      );
    }

    await db.batch(resetStatements);

    await ensureDemoSeed(env, { overwriteExisting: true, refreshResources: true });
    await audit(db, "system", null, "demo.reset", "demo", "edgeever-demo", {
      scheduledTime: new Date(scheduledTime).toISOString(),
      seedMemoCount: DEMO_SEED_MEMOS.length,
    });

    await db.prepare(
      `UPDATE maintenance_leases SET expires_at = ? WHERE name = 'demo-reset' AND owner_id = ?`,
    ).bind(new Date(Date.now() + DEMO_RESET_COOLDOWN_MS).toISOString(), leaseOwnerId).run();
    return true;
  } catch (error) {
    await db.prepare(
      `DELETE FROM maintenance_leases WHERE name = 'demo-reset' AND owner_id = ?`,
    ).bind(leaseOwnerId).run();
    throw error;
  }
};

const moveMemosToNotebook = async (
  db: D1Database,
  workspaceId: string,
  memoIds: string[],
  notebookId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT id, notebook_id
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<{ id: string; notebook_id: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be moved.", 400);
  }

  const now = isoNow();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE memos
         SET notebook_id = ?, updated_by = ?, updated_at = ?
         WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
      )
      .bind(notebookId, actorLabel, now, workspaceId, ...uniqueMemoIds),
  ];

  for (const row of rows.results) {
    statements.push(
      auditStatement(db, actor.actorType, actor.actorId, "memo.move", "memo", row.id, {
        fromNotebookId: row.notebook_id,
        toNotebookId: notebookId,
      })
    );
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

const moveMemosRecord = async (
  db: D1Database,
  workspaceId: string,
  memoIds: string[],
  notebookId: string,
  actor: AuditActor,
  actorLabel: string,
) => {
  if (!(await getNotebook(db, workspaceId, notebookId))) {
    throw new AppError("not_found", "Target notebook not found", 404);
  }
  return moveMemosToNotebook(db, workspaceId, memoIds, notebookId, actor, actorLabel);
};

export const mergeMemosRecord = async (
  db: D1Database,
  workspaceId: string,
  input: { memoIds: string[]; notebookId?: string; title?: string },
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const uniqueMemoIds = Array.from(new Set(input.memoIds));

  if (uniqueMemoIds.length < 2) {
    throw new AppError("bad_request", "At least two memos are required to merge.", 400);
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<MemoDetailRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be merged.", 400);
  }

  const activeRows = rows.results.filter((row) => !row.is_deleted);
  if (activeRows.length !== uniqueMemoIds.length) {
    // A desktop outbox retry can arrive after the first merge committed but
    // before the client acknowledged its local placeholder. When every source
    // now points at the same live merge result, return that result instead of
    // treating the retry as a new merge. This makes the operation recoverable
    // after a lost response without ever creating a second server-side memo.
    const mergedTargetIds = new Set(
      rows.results
        .filter((row) => row.is_deleted && row.merged_into_memo_id)
        .map((row) => row.merged_into_memo_id as string),
    );
    if (activeRows.length === 0 && mergedTargetIds.size === 1) {
      const [mergedTargetId] = mergedTargetIds;
      const completedMerge = await getMemoDetail(db, workspaceId, mergedTargetId);
      const completedSourceIds = new Set(completedMerge?.sourceMemoIds ?? []);
      if (
        completedMerge
        && completedMerge.sourceMemoIds.length === uniqueMemoIds.length
        && uniqueMemoIds.every((memoId) => completedSourceIds.has(memoId))
      ) {
        return completedMerge;
      }
    }
    throw new AppError("missing_memos", "One or more memos cannot be merged.", 400);
  }

  if (input.notebookId && !(await getNotebook(db, workspaceId, input.notebookId))) {
    throw new AppError("not_found", "Target notebook not found", 404);
  }

  const ordered = uniqueMemoIds
    .map((memoId) => rows.results.find((row) => row.id === memoId))
    .filter((row): row is MemoDetailRow => Boolean(row));
  const notebookId = input.notebookId ?? ordered[0].notebook_id;
  const title = resolveMergedMemoTitle(input.title, ordered);
  const sourceDocs = ordered.map((memo) => {
    const contentJson = parseDoc(memo.content_json);
    const doc = resolveMemoContentDoc(contentJson, memo.content_markdown);
    if (!docToText(doc).trim() && memo.content_text.trim()) {
      throw new AppError("merge_content_unavailable", "One or more memo bodies could not be recovered safely.", 409);
    }
    return doc;
  });
  const contentJson = mergeMemoDocs(sourceDocs);
  const mergedMarkdown = docToMarkdown(contentJson);
  const contentText = docToText(contentJson);
  const tags = Array.from(new Set(ordered.flatMap((memo) => parseJsonArray(memo.tags_json))));
  const excerpt = createExcerpt(contentText || title);
  const contentHash = await sha256(mergedMarkdown + JSON.stringify(contentJson));
  const newMemoId = createId("memo");
  const now = isoNow();

  await db.batch([
    db
      .prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, source_memo_ids, merge_source_count,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newMemoId,
        workspaceId,
        notebookId,
        title,
        excerpt,
        JSON.stringify(tags),
        JSON.stringify(uniqueMemoIds),
        uniqueMemoIds.length,
        actorLabel,
        actorLabel,
        now,
        now
      ),
    db
      .prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(newMemoId, JSON.stringify(contentJson), mergedMarkdown, contentText, contentHash, now, now),
    upsertMemoSearchDocumentStatement(db, newMemoId, title, contentText, tags.join(" ")),
    db
      .prepare(
        `UPDATE memos
         SET is_deleted = 1, deleted_at = ?, merged_into_memo_id = ?, merged_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id IN (${placeholders})`
      )
      .bind(now, newMemoId, now, now, workspaceId, ...uniqueMemoIds),
    db.prepare(`DELETE FROM memo_shares WHERE workspace_id = ? AND memo_id IN (${placeholders})`).bind(workspaceId, ...uniqueMemoIds),
    deleteMemoSearchDocumentsStatement(db, uniqueMemoIds),
    db
      .prepare(
        `UPDATE resources
         SET original_memo_id = COALESCE(original_memo_id, memo_id),
             memo_id = ?,
             updated_at = ?
         WHERE memo_id IN (${placeholders})`
      )
      .bind(newMemoId, now, ...uniqueMemoIds),
    auditStatement(db, actor.actorType, actor.actorId, "memo.merge", "memo", newMemoId, {
      sourceMemoIds: uniqueMemoIds,
    }),
  ]);

  const memo = await getMemoDetail(db, workspaceId, newMemoId);

  if (!memo) {
    throw new AppError("not_found", "Merged memo not found after create.", 404);
  }

  return memo;
};

const createMemoRecord = async (
  db: D1Database,
  workspaceId: string,
  input: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[]; createdAt?: string; updatedAt?: string },
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
): Promise<MemoDetail> => {
  const tags = normalizeTags(input.tags);
  const contentMarkdown = input.contentMarkdown ?? "";
  const contentJson = markdownToDoc(contentMarkdown);
  const contentText = docToText(contentJson);
  const title = normalizeMemoTitle(input.title);
  const excerpt = createExcerpt(contentText);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const id = createId("memo");
  const now = isoNow();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;

  await db.batch([
    db
      .prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
        ) SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ? FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
      )
      .bind(id, workspaceId, title, excerpt, JSON.stringify(tags), actorLabel, actorLabel, createdAt, updatedAt, input.notebookId, workspaceId),
    db
      .prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(id, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, createdAt, updatedAt),
    upsertMemoSearchDocumentStatement(db, id, title, contentText, tags.join(" ")),
    auditStatement(db, actor.actorType, actor.actorId, "memo.create", "memo", id, {
      notebookId: input.notebookId,
    }),
  ]);

  const memo = await getMemoDetail(db, workspaceId, id);

  if (!memo) {
    throw new Error("Memo was created but could not be read.");
  }

  return memo;
};

const normalizeImportSource = (value: string) => {
  const source = value.trim().toLocaleLowerCase("en-US");
  if (source.length > 80 || !/^[a-z0-9._-]+$/.test(source)) {
    throw new AppError(
      "invalid_import_source",
      "source must contain only letters, numbers, dots, underscores, or hyphens and be at most 80 characters",
      400,
    );
  }
  return source;
};

const parseImportDateTime = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a valid ISO 8601 date-time`);
  }
  return value.trim();
};

const parseMemoImportItem = (value: unknown, index: number) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`items[${index}] must be an object`);
  }

  const item = value as Record<string, unknown>;
  const externalId = getRequiredString(item.externalId, `items[${index}].externalId`);
  if (externalId.length > 512) {
    throw new Error(`items[${index}].externalId must be at most 512 characters`);
  }
  if (item.title !== undefined && typeof item.title !== "string") {
    throw new Error(`items[${index}].title must be a string`);
  }
  const title = typeof item.title === "string" ? item.title.trim() : undefined;
  if (title && title.length > 160) {
    throw new Error(`items[${index}].title must be at most 160 characters`);
  }
  if (item.contentMarkdown !== undefined && typeof item.contentMarkdown !== "string") {
    throw new Error(`items[${index}].contentMarkdown must be a string`);
  }
  if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string"))) {
    throw new Error(`items[${index}].tags must be an array of strings`);
  }
  if (Array.isArray(item.tags) && item.tags.length > 100) {
    throw new Error(`items[${index}].tags must contain at most 100 items`);
  }

  return {
    externalId,
    title: title || undefined,
    contentMarkdown: typeof item.contentMarkdown === "string" ? item.contentMarkdown : "",
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
    createdAt: parseImportDateTime(item.createdAt, `items[${index}].createdAt`),
    updatedAt: parseImportDateTime(item.updatedAt, `items[${index}].updatedAt`),
  };
};

const getMemoImportSource = async (db: D1Database, workspaceId: string, source: string, externalId: string) =>
  db.prepare(
    `SELECT external_id, memo_id, source_updated_at
     FROM memo_import_sources
     WHERE workspace_id = ? AND source = ? AND external_id = ?`
  ).bind(workspaceId, source, externalId).first<MemoImportSourceRow>();

const discardUnlinkedImportedMemo = async (db: D1Database, workspaceId: string, memoId: string) => {
  await db.batch([
    db.prepare(`DELETE FROM memo_revisions WHERE memo_id = ?`).bind(memoId),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id = ?`).bind(memoId),
    db.prepare(`DELETE FROM memos WHERE id = ? AND workspace_id = ?`).bind(memoId, workspaceId),
  ]);
};

const importMemosRecord = async (
  db: D1Database,
  workspaceId: string,
  input: {
    source: string;
    notebookId: string;
    items: unknown;
    dryRun: boolean;
    actor: { actorType: "user" | "agent"; actorId: string | null };
    actorLabel: string;
  },
) => {
  const source = normalizeImportSource(input.source);
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 25) {
    throw new AppError("invalid_import_items", "items must contain between 1 and 25 memos", 400);
  }
  const notebook = await getNotebook(db, workspaceId, input.notebookId);
  if (!notebook) {
    throw new AppError("not_found", "Import destination notebook not found in the authenticated user's workspace.", 404);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const [index, rawItem] of input.items.entries()) {
    let externalId: string | null = null;
    let createdMemoId: string | null = null;

    try {
      const item = parseMemoImportItem(rawItem, index);
      externalId = item.externalId;
      const existing = await getMemoImportSource(db, workspaceId, source, externalId);
      if (existing) {
        results.push({
          index,
          externalId,
          status: "skipped",
          reason: "already_imported",
          memo: await getMemoDetail(db, workspaceId, existing.memo_id, true),
          sourceUpdatedAt: existing.source_updated_at,
        });
        continue;
      }

      if (input.dryRun) {
        results.push({ index, externalId, status: "would_create" });
        continue;
      }

      const memo = await createMemoRecord(db, workspaceId, {
        notebookId: notebook.id,
        title: item.title,
        contentMarkdown: item.contentMarkdown,
        tags: item.tags,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }, input.actor, input.actorLabel);
      createdMemoId = memo.id;
      const now = isoNow();
      await db.batch([
        db.prepare(
          `INSERT INTO memo_import_sources (
             workspace_id, source, external_id, memo_id, source_updated_at, content_hash, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(workspaceId, source, externalId, memo.id, item.updatedAt ?? null, memo.contentHash, now, now),
        auditStatement(db, input.actor.actorType, input.actor.actorId, "memo.import", "memo", memo.id, {
          source,
          externalId,
          notebookId: notebook.id,
        }),
      ]);
      results.push({ index, externalId, status: "created", memo });
    } catch (error) {
      if (createdMemoId) {
        await discardUnlinkedImportedMemo(db, workspaceId, createdMemoId);
        const winner = externalId ? await getMemoImportSource(db, workspaceId, source, externalId) : null;
        if (winner) {
          results.push({
            index,
            externalId,
            status: "skipped",
            reason: "already_imported",
            memo: await getMemoDetail(db, workspaceId, winner.memo_id, true),
            sourceUpdatedAt: winner.source_updated_at,
          });
          continue;
        }
      }

      results.push({
        index,
        externalId,
        status: "failed",
        error: error instanceof Error ? error.message : "Import failed",
      });
    }
  }

  const count = (status: string) => results.filter((result) => result.status === status).length;
  return {
    dryRun: input.dryRun,
    source,
    notebookId: notebook.id,
    total: results.length,
    created: count("created"),
    skipped: count("skipped"),
    failed: count("failed"),
    wouldCreate: count("would_create"),
    results,
  };
};

export const updateMemoRecord = async (
  db: D1Database,
  workspaceId: string,
  id: string,
  input: MemoUpdateInput,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string,
  requireEditSession = false,
): Promise<
  | { memo: MemoDetail; error?: never; message?: never; status?: never; details?: never }
  | { error: string; message: string; status?: number; details?: Record<string, unknown> }
> => {
  const current = await getMemoDetailRow(db, workspaceId, id);

  if (!current) {
    return { error: "not_found", message: "Memo not found" };
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return {
      error: "revision_conflict",
      message: "Memo was updated elsewhere. Reload before saving.",
      status: 409,
      details: {
        expectedRevision: input.expectedRevision,
        currentRevision: current.revision,
      },
    };
  }

  const hasDocumentUpdate = input.contentJson !== undefined || input.contentMarkdown !== undefined;
  let editSession: MemoEditSessionRow | null = null;

  if (requireEditSession && hasDocumentUpdate) {
    if (!input.editSessionId || !input.expectedContentHash || input.expectedRevision === undefined) {
      return {
        error: "edit_session_required",
        message: "A bound edit session is required to save note content.",
        status: 428,
      };
    }

    if (input.expectedContentHash !== current.content_hash) {
      return {
        error: "content_conflict",
        message: "Note content changed after this edit session started.",
        status: 409,
      };
    }

    editSession = await db.prepare(
      `SELECT id, memo_id, actor_type, actor_id, base_revision, base_content_hash, expires_at
       FROM memo_edit_sessions
       WHERE id = ? AND memo_id = ? AND actor_type = ? AND actor_id IS ? AND expires_at > ?`,
    )
      .bind(input.editSessionId, id, actor.actorType, actor.actorId, isoNow())
      .first<MemoEditSessionRow>();

    if (
      !editSession ||
      !isMemoEditBindingValid(
        { memoId: id, revision: current.revision, contentHash: current.content_hash },
        {
          id: editSession.id,
          memoId: editSession.memo_id,
          baseRevision: editSession.base_revision,
          baseContentHash: editSession.base_content_hash,
        },
        {
          editSessionId: input.editSessionId,
          memoId: id,
          expectedRevision: input.expectedRevision,
          expectedContentHash: input.expectedContentHash,
        },
      )
    ) {
      return {
        error: "edit_session_conflict",
        message: "The edit session is stale or belongs to another note.",
        status: 409,
      };
    }
  }

  const isPinned = input.isPinned ?? Boolean(current.is_pinned);
  const hasContentUpdate =
    input.notebookId !== undefined ||
    input.title !== undefined ||
    input.contentJson !== undefined ||
    input.contentMarkdown !== undefined ||
    input.tags !== undefined ||
    input.createdAt !== undefined ||
    input.updatedAt !== undefined;
  const now = isoNow();
  const updatedAt = input.updatedAt ?? now;

  if (!hasContentUpdate) {
    if (input.isPinned === undefined || isPinned === Boolean(current.is_pinned)) {
      const memo = await getMemoDetail(db, workspaceId, id);

      if (!memo) {
        return { error: "not_found", message: "Memo not found after update" };
      }

      return { memo };
    }

    await db.batch([
      db
        .prepare(
          `UPDATE memos
           SET is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
           WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
        )
        .bind(isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id, workspaceId),
      auditStatement(db, actor.actorType, actor.actorId, isPinned ? "memo.pin" : "memo.unpin", "memo", id, {}),
    ]);

    const memo = await getMemoDetail(db, workspaceId, id);

    if (!memo) {
      return { error: "not_found", message: "Memo not found after update" };
    }

    return { memo };
  }

  const currentContentJson = parseDoc(current.content_json);
  const contentJson =
    input.contentJson !== undefined
      ? input.contentJson
      : input.contentMarkdown !== undefined
        ? markdownToDoc(input.contentMarkdown)
        : currentContentJson;
  const contentMarkdown =
    input.contentMarkdown !== undefined
      ? input.contentMarkdown
      : input.contentJson !== undefined
        ? docToMarkdown(contentJson)
        : current.content_markdown;
  const contentText = hasDocumentUpdate ? docToText(contentJson) : current.content_text;
  const title =
    input.title !== undefined ? normalizeMemoTitle(input.title) : normalizeMemoTitle(current.title);
  if (
    !input.allowDestructiveOverwrite &&
    isSuspiciousMemoOverwrite(current.title, current.content_text, title, contentText)
  ) {
    return {
      error: "suspicious_memo_overwrite",
      message: "Save blocked because the title changed while most of the note content disappeared.",
    };
  }
  const tags = input.tags === undefined ? parseJsonArray(current.tags_json) : normalizeTags(input.tags);
  const excerpt = createExcerpt(contentText);
  const notebookId = input.notebookId ?? current.notebook_id;
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const unchanged =
    notebookId === current.notebook_id
    && title === normalizeMemoTitle(current.title)
    && JSON.stringify(tags) === current.tags_json
    && isPinned === Boolean(current.is_pinned)
    && contentHash === current.content_hash
    && input.createdAt === undefined
    && input.updatedAt === undefined;

  if (unchanged) {
    return { memo: mapMemoDetail(current) };
  }

  const nextRevision = current.revision + 1;
  const revisionStatements = (await shouldSnapshotMemoRevision(db, current, title, JSON.stringify(tags), contentHash, updatedAt))
    ? [createMemoRevisionStatement(db, current, actorLabel, updatedAt)]
    : [];
  const editSessionStatements = editSession
    ? [
        db.prepare(
          `UPDATE memo_edit_sessions
           SET base_revision = ?, base_content_hash = ?, updated_at = ?
           WHERE id = ? AND memo_id = ? AND base_revision = ? AND base_content_hash = ?`,
        ).bind(nextRevision, contentHash, updatedAt, editSession.id, id, current.revision, current.content_hash),
      ]
    : requireEditSession
      ? [
          db.prepare(
            `UPDATE memo_edit_sessions
             SET base_revision = ?, base_content_hash = ?, updated_at = ?
             WHERE memo_id = ? AND actor_type = ? AND actor_id IS ?
               AND base_revision = ? AND base_content_hash = ? AND expires_at > ?`,
          ).bind(
            nextRevision,
            contentHash,
            updatedAt,
            id,
            actor.actorType,
            actor.actorId,
            current.revision,
            current.content_hash,
            updatedAt,
          ),
        ]
      : [];

  await db.batch([
    ...revisionStatements,
    db
      .prepare(
        `UPDATE memos
         SET notebook_id = ?, title = ?, excerpt = ?, tags_json = ?, is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE id = ? AND workspace_id = ? AND is_deleted = 0
           AND EXISTS (SELECT 1 FROM notebooks n WHERE n.id = ? AND n.workspace_id = ? AND n.is_deleted = 0)`
      )
      .bind(notebookId, title, excerpt, JSON.stringify(tags), isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id, workspaceId, notebookId, workspaceId),
    db
      .prepare(
        `UPDATE memo_contents
         SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
             revision = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE memo_id = ?`
      )
      .bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, updatedAt, input.createdAt ?? null, id),
    upsertMemoSearchDocumentStatement(db, id, title, contentText, tags.join(" ")),
    ...editSessionStatements,
    auditStatement(db, actor.actorType, actor.actorId, "memo.update", "memo", id, {
      revision: nextRevision,
    }),
  ]);

  const memo = await getMemoDetail(db, workspaceId, id);

  if (!memo) {
    return { error: "not_found", message: "Memo not found after update" };
  }

  return { memo };
};

const getMemoRevisionRow = async (
  db: D1Database,
  workspaceId: string,
  memoId: string,
  revisionId: string
): Promise<MemoRevisionRow | null> =>
  db
    .prepare(
      `SELECT mr.id, mr.memo_id, mr.revision, mr.title, mr.tags_json, mr.content_json, mr.content_markdown,
              mr.content_text, mr.content_hash, mr.created_by, mr.created_at
       FROM memo_revisions mr
       INNER JOIN memos m ON m.id = mr.memo_id
       WHERE mr.id = ? AND mr.memo_id = ? AND m.workspace_id = ?`
    )
    .bind(revisionId, memoId, workspaceId)
    .first<MemoRevisionRow>();

const listMemoRevisions = async (
  db: D1Database,
  workspaceId: string,
  memoId: string,
  limit: number,
  includeDeleted = true,
): Promise<MemoRevision[]> => {
  const memo = await getMemoDetail(db, workspaceId, memoId, includeDeleted);

  if (!memo) {
    throw new AppError("not_found", "Memo not found", 404);
  }

  const rows = await db
    .prepare(
      `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
              content_text, content_hash, created_by, created_at
       FROM memo_revisions
       WHERE memo_id = ?
       ORDER BY revision DESC, created_at DESC
       LIMIT ?`
    )
    .bind(memoId, limit)
    .all<MemoRevisionRow>();

  return rows.results.map(mapMemoRevision);
};

const restoreMemoRevisionRecord = async (
  db: D1Database,
  workspaceId: string,
  memoId: string,
  revisionId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const current = await getMemoDetailRow(db, workspaceId, memoId);

  if (!current) {
    throw new AppError("not_found", "Memo not found", 404);
  }

  const revision = await getMemoRevisionRow(db, workspaceId, memoId, revisionId);

  if (!revision) {
    throw new AppError("not_found", "Memo revision not found", 404);
  }

  const tags = parseJsonArray(revision.tags_json);
  const contentJson = parseDoc(revision.content_json);
  const contentMarkdown = revision.content_markdown || docToMarkdown(contentJson);
  const contentText = revision.content_text || docToText(contentJson);
  const title = normalizeMemoTitle(revision.title);
  const excerpt = createExcerpt(contentText);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const nextRevision = current.revision + 1;
  const now = isoNow();

  await db.batch([
    createMemoRevisionStatement(db, current, actorLabel, now),
    db
      .prepare(
        `UPDATE memos
         SET title = ?, excerpt = ?, tags_json = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
      )
      .bind(title, excerpt, JSON.stringify(tags), actorLabel, now, memoId, workspaceId),
    db
      .prepare(
        `UPDATE memo_contents
         SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
             revision = ?, updated_at = ?
         WHERE memo_id = ?`
      )
      .bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, now, memoId),
    upsertMemoSearchDocumentStatement(db, memoId, title, contentText, tags.join(" ")),
    auditStatement(db, actor.actorType, actor.actorId, "memo.revision_restore", "memo", memoId, {
      revisionId,
      restoredRevision: revision.revision,
      revision: nextRevision,
    }),
  ]);

  const memo = await getMemoDetail(db, workspaceId, memoId);

  if (!memo) {
    throw new AppError("not_found", "Memo not found after revision restore", 404);
  }

  return memo;
};

const getLatestMemoRevisionRow = async (db: D1Database, memoId: string): Promise<MemoRevisionRow | null> =>
  db
    .prepare(
      `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
              content_text, content_hash, created_by, created_at
       FROM memo_revisions
       WHERE memo_id = ?
       ORDER BY created_at DESC, revision DESC
       LIMIT 1`
    )
    .bind(memoId)
    .first<MemoRevisionRow>();

const createMemoRevisionStatement = (
  db: D1Database,
  current: MemoDetailRow,
  actorLabel: string,
  createdAt: string
) =>
  db
    .prepare(
      `INSERT INTO memo_revisions (
        id, memo_id, revision, title, content_json, content_markdown,
        content_hash, created_by, created_at, tags_json, content_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      createId("rev"),
      current.id,
      current.revision,
      current.title,
      current.content_json,
      current.content_markdown,
      current.content_hash,
      actorLabel,
      createdAt,
      current.tags_json,
      current.content_text
    );

const shouldSnapshotMemoRevision = async (
  db: D1Database,
  current: MemoDetailRow,
  nextTitle: string | null,
  nextTagsJson: string,
  nextContentHash: string,
  now: string
) => {
  const changed =
    (current.title ?? "") !== (nextTitle ?? "") ||
    current.tags_json !== nextTagsJson ||
    current.content_hash !== nextContentHash;

  if (!changed) {
    return false;
  }

  const latest = await getLatestMemoRevisionRow(db, current.id);

  if (!latest) {
    return true;
  }

  const alreadyCapturedCurrent =
    (latest.title ?? "") === (current.title ?? "") &&
    latest.tags_json === current.tags_json &&
    latest.content_hash === current.content_hash;

  if (alreadyCapturedCurrent) {
    return false;
  }

  return Date.parse(now) - Date.parse(latest.created_at) >= REVISION_SNAPSHOT_INTERVAL_MS;
};

const getResourceRow = async (db: D1Database, workspaceId: string, id: string): Promise<ResourceRow | null> =>
  db
    .prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.id = ? AND m.workspace_id = ? AND r.is_deleted = 0`
    )
    .bind(id, workspaceId)
    .first<ResourceRow>();

const getResourceRowsForMemo = async (db: D1Database, workspaceId: string, memoId: string): Promise<ResourceRow[]> => {
  const rows = await db
    .prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.memo_id = ? AND m.workspace_id = ?`
    )
    .bind(memoId, workspaceId)
    .all<ResourceRow>();

  return rows.results;
};

const listResourcesForMemo = async (db: D1Database, workspaceId: string, memoId: string): Promise<Resource[]> => {
  const rows = await db
    .prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.memo_id = ? AND m.workspace_id = ? AND r.is_deleted = 0
       ORDER BY r.created_at ASC, r.id ASC`
    )
    .bind(memoId, workspaceId)
    .all<ResourceRow>();

  return rows.results.map(mapResource);
};

const listResourcesForMcp = async (db: D1Database, workspaceId: string, limit: number) => {
  const [rows, stats] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind,
                r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height,
                r.created_at, r.updated_at, m.title AS memo_title, m.excerpt AS memo_excerpt,
                m.is_deleted AS memo_is_deleted
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0
         ORDER BY r.created_at DESC
         LIMIT ?`
      )
      .bind(workspaceId, limit)
      .all<ResourceListRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0`
      )
      .bind(workspaceId).first<ResourceStatsRow>(),
  ]);

  return {
    resources: rows.results.map(mapResourceListItem),
    summary: mapResourceStorageSummary(stats),
  };
};

const getWorkspaceStats = async (db: D1Database, workspaceId: string) => {
  const [memoCounts, notebookCount, tagCount, resourceStats] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END), 0) AS active,
           COALESCE(SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END), 0) AS trashed,
           COALESCE(SUM(CASE WHEN is_deleted = 0 AND is_pinned = 1 THEN 1 ELSE 0 END), 0) AS pinned,
           COALESCE(SUM(CASE WHEN is_deleted = 0 AND tags_json = '[]' THEN 1 ELSE 0 END), 0) AS untagged
         FROM memos WHERE workspace_id = ?`
      )
      .bind(workspaceId).first<{ total: number; active: number; trashed: number; pinned: number; untagged: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM notebooks WHERE workspace_id = ? AND is_deleted = 0`).bind(workspaceId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT mt.name) AS count
         FROM memo_tags mt
         INNER JOIN memos m ON m.id = mt.memo_id AND m.workspace_id = mt.workspace_id
         WHERE mt.workspace_id = ? AND m.is_deleted = 0`
      )
      .bind(workspaceId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0`
      )
      .bind(workspaceId).first<ResourceStatsRow>(),
  ]);

  return {
    memos: {
      total: memoCounts?.total ?? 0,
      active: memoCounts?.active ?? 0,
      trashed: memoCounts?.trashed ?? 0,
      pinned: memoCounts?.pinned ?? 0,
      untagged: memoCounts?.untagged ?? 0,
    },
    notebooks: {
      active: notebookCount?.count ?? 0,
    },
    tags: {
      active: tagCount?.count ?? 0,
    },
    resources: mapResourceStorageSummary(resourceStats),
  };
};

const parseDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as TiptapDoc) : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

const normalizeMemoTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || DEFAULT_MEMO_TITLE;
};

const clampNumber = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return sha256Bytes(bytes);
};

const sha256Bytes = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  const hashArray = new Uint8Array(digest);
  let hexString = "";
  for (let i = 0; i < hashArray.length; i++) {
    const hex = hashArray[i].toString(16);
    hexString += hex.length === 1 ? "0" + hex : hex;
  }
  return hexString;
};
