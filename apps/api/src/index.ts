import {
  createExcerpt,
  docToText,
  markdownToDoc,
  normalizeTags,
} from "@edgeever/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolveContainerImageSource } from "./container-image-source";
import openApiSpec from "../../../docs/openapi.json";
import releaseSummary from "../../../release-summary.json";
import {
  authenticateRequest,
  authenticateSession,
  createSession,
  getBearerToken,
  getInstanceAuthMode,
  getInstanceUser,
  getLoginAttemptKeys,
  revokeSession,
  setSessionCookie,
  tooManyLoginAttempts,
  verifyLogin,
} from "./auth-service";
import {
  isDatabaseNotReadyError,
} from "./auth-state";
import {
  isDemoModeEnabled,
  resolveDemoPasswordHash,
  shouldUpsertDemoSeedRecord,
} from "./demo-mode";
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
import {
  restoreJsonMemos as restoreJsonMemosService,
  restoreJsonNotebooks as restoreJsonNotebooksService,
} from "./backup-service";
import { sha256, sha256Bytes } from "./hash-utils";
import { INSTANCE_BUILD_ID } from "./instance-build";
import type {
  DatabaseAdapter,
  PreparedStatementAdapter,
} from "./storage-contract";
import type { AppContext, AppEnv, AuthContext, Bindings, WorkerBindings } from "./api-context";
import { AppError } from "./app-error";
import { hashPassword } from "./auth-crypto";
import {
  apiError,
  authNotConfigured,
  databaseNotReady,
  unauthorized,
} from "./http-errors";
import { audit } from "./audit";
import { createId, isoNow } from "./entity-utils";
import {
  upsertMemoSearchDocumentStatement,
} from "./memo-search-index";
import {
  listMemoRevisions as listMemoRevisionsService,
  restoreMemoRevision as restoreMemoRevisionService,
} from "./memo-revision-service";
import { registerTagRoutes } from "./tag-routes";
import { registerTemplateRoutes } from "./template-routes";
import { registerAuthRoutes } from "./auth-routes";
import { registerApiTokenRoutes } from "./api-token-routes";
import { registerObjectStorageRoutes } from "./object-storage-routes";
import { registerAiRoutes } from "./ai-routes";
import { registerAiPromptRoutes } from "./ai-prompt-routes";
import { registerResourceRoutes } from "./resource-routes";
import {
  abortResourceUpload,
  completeResourceUpload,
  initiateResourceRestoreUpload,
  initiateResourceUpload,
  uploadResourcePart,
} from "./resource-upload-service";
import { registerPluginDistributionRoutes } from "./plugin-distribution-routes";
import { registerSyncRoutes } from "./sync-routes";
import { registerMemoRoutes } from "./memo-routes";
import { registerBackupRoutes } from "./backup-routes";
import { registerMcpRoutes } from "./mcp-routes";
import { callMcpTool as callMcpToolService } from "./mcp-tool-service";
import {
  createMemoEditSession,
  createMemoRecord,
  deleteMemoRecord,
  deleteMemosRecord,
  emptyTrashMemosRecord,
  getCurrentWorkspaceIdentity,
  getMemoDetail,
  getMemoDetailRow,
  getMemosForBulkAction,
  importMemosRecord,
  listMemosForMcp,
  mapMemoDetail,
  mergeMemosRecord,
  moveMemosRecord,
  moveMemosToNotebook,
  restoreMemoRecord,
  restoreMemosRecord,
  searchMemoSummaries,
  updateMemoRecord,
} from "./memo-service";

export { createMemoEditSession, mergeMemosRecord, updateMemoRecord };
import { listMemos } from "./memo-list-service";
import {
  registerUserRoutes,
} from "./user-routes";
import { registerNotebookRoutes } from "./notebook-routes";
import { registerMemoShareRoutes, registerPublicShareRoutes } from "./share-routes";
import {
  deleteStoredObjects,
  getActiveObjectStorageConfig,
} from "./object-storage";
import {
  DEFAULT_WORKSPACE_ID,
  ensureUserWorkspace,
} from "./workspace-provisioning";
import {
  createAttachmentResource,
  createImageResource,
  getResourceRow,
} from "./resource-service";

// Compatibility aliases keep the existing SQL-heavy implementation small
// while routing its dependency through the platform-neutral contract above.
// New code should use DatabaseAdapter directly.
type D1Database = DatabaseAdapter;
type D1PreparedStatement = PreparedStatementAdapter;

const DEMO_RESET_LEASE_MS = 5 * 60 * 1000;
const DEMO_RESET_COOLDOWN_MS = 60 * 1000;
const DEFAULT_R2_BUCKET_NAME = "edgeever-resources";
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

const getAppliedMigration = async (env: Bindings) => {
  try {
    const row = await env.storage.db
      .prepare(`SELECT name FROM ${env.storage.diagnostics.migrationTable} ORDER BY name DESC LIMIT 1`)
      .first<{ name?: string }>();
    return row?.name?.match(/^(\d+)/)?.[1] ?? row?.name ?? "unknown";
  } catch {
    return "unknown";
  }
};

const getActiveObjectStorageProvider = async (env: Bindings) => {
  try {
    const active = await getActiveObjectStorageConfig(env.storage.db);
    return active?.provider === "builtin" || active?.provider === "s3"
      ? active.provider
      : "unknown";
  } catch {
    return "unknown";
  }
};

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

  const runtime = c.env.EDGE_EVER_RUNTIME ?? "cloudflare-workers";

  return c.json({
    ok: true,
    name: "edgeever",
    runtime,
    ...(runtime === "self-hosted-bun"
      ? { containerImageSource: resolveContainerImageSource(c.env.EDGE_EVER_CONTAINER_IMAGE) }
      : {}),
    authMode,
    build: INSTANCE_BUILD_ID.slice(0, 12),
    migration: await getAppliedMigration(c.env),
    storage: {
      database: c.env.storage.diagnostics.database,
      resources: c.env.storage.diagnostics.resources,
    },
    objectStorageProvider: await getActiveObjectStorageProvider(c.env),
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
  listMemoRevisions: (...args) => listMemoRevisionsService(...args, getMemoDetail, false),
  mergeMemos: (...args) => mergeMemosRecord(...args),
  moveMemos: (...args) => moveMemosRecord(...args),
  restoreMemo: (...args) => restoreMemoRecord(...args),
  restoreMemoRevision: (...args) => restoreMemoRevisionService(...args, { getMemoDetail, getMemoDetailRow }),
  updateMemo: (...args) => updateMemoRecord(...args),
});

registerBackupRoutes(app, {
  clampNumber: (...args) => clampNumber(...args),
  getMemoDetail: (...args) => getMemoDetail(...args),
  mapMemoDetail: (...args) => mapMemoDetail(...args),
  restoreJsonMemos: restoreJsonMemosService,
  restoreJsonNotebooks: restoreJsonNotebooksService,
  sha256Bytes,
  initiateResourceRestoreUpload: (...args) => initiateResourceRestoreUpload(...args),
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
  initiateResourceUpload: (...args) => initiateResourceUpload(...args),
  uploadResourcePart: (...args) => uploadResourcePart(...args),
  completeResourceUpload: (...args) => completeResourceUpload(...args),
  abortResourceUpload: (...args) => abortResourceUpload(...args),
});

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

export const callMcpTool = (
  context: AppContext,
  auth: AuthContext,
  name: string,
  args: Record<string, unknown>,
) => callMcpToolService(context, auth, name, args, {
  clampNumber,
  createMemoRecord,
  deleteMemosRecord,
  getCurrentWorkspaceIdentity,
  getMemoDetail,
  getMemoDetailRow,
  getMemosForBulkAction,
  importMemosRecord,
  listMemosForMcp,
  mergeMemosRecord,
  moveMemosToNotebook,
  restoreMemosRecord,
  searchMemoSummaries,
  updateMemoRecord,
});

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
  const existingMemoRows = overwriteExisting
    ? []
    : (
        await db
          .prepare(
            `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                    m.is_archived, m.is_deleted, c.content_hash, c.revision,
                    s.title AS search_title, s.content_text AS search_content_text, s.tags AS search_tags
             FROM memos m
             LEFT JOIN memo_contents c ON c.memo_id = m.id
             LEFT JOIN memo_search_documents s ON s.memo_id = m.id
             WHERE m.id IN (${DEMO_SEED_MEMO_IDS.map(() => "?").join(", ")})`,
          )
          .bind(...DEMO_SEED_MEMO_IDS)
          .all<{
            id: string;
            notebook_id: string;
            title: string;
            excerpt: string;
            tags_json: string;
            is_pinned: number;
            is_archived: number;
            is_deleted: number;
            content_hash: string | null;
            revision: number | null;
            search_title: string | null;
            search_content_text: string | null;
            search_tags: string | null;
          }>()
      ).results;
  const existingMemosById = new Map(existingMemoRows.map((memo) => [memo.id, memo]));

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
    const excerpt = createExcerpt(contentText);
    const tagsJson = JSON.stringify(normalizeTags(memo.tags));
    const searchTags = memo.tags.join(" ");
    const revision = "revision" in memo ? memo.revision : 0;
    const existing = existingMemosById.get(memo.id);
    const seedIsCurrent = existing
      && existing.notebook_id === memo.notebookId
      && existing.title === memo.title
      && existing.excerpt === excerpt
      && existing.tags_json === tagsJson
      && existing.is_pinned === (memo.isPinned ? 1 : 0)
      && existing.is_archived === 0
      && existing.is_deleted === 0
      && existing.content_hash === contentHash
      && existing.revision === revision
      && existing.search_title === memo.title
      && existing.search_content_text === contentText
      && existing.search_tags === searchTags;
    if (!overwriteExisting && seedIsCurrent) continue;

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
          excerpt,
          tagsJson,
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
          revision,
          now,
          now,
        ),
      upsertMemoSearchDocumentStatement(db, memo.id, memo.title, contentText, searchTags)
    );
  }

  const existingRevisionRows = overwriteExisting
    ? []
    : (
        await db
          .prepare(
            `SELECT id, memo_id, revision, title, content_hash
             FROM memo_revisions
             WHERE id IN (${DEMO_SEED_REVISIONS.map(() => "?").join(", ")})`,
          )
          .bind(...DEMO_SEED_REVISIONS.map((revision) => revision.id))
          .all<{
            id: string;
            memo_id: string;
            revision: number;
            title: string | null;
            content_hash: string;
          }>()
      ).results;
  const existingRevisionsById = new Map(existingRevisionRows.map((revision) => [revision.id, revision]));

  for (const revision of DEMO_SEED_REVISIONS) {
    const contentJson = markdownToDoc(revision.markdown);
    const contentHash = await sha256(revision.markdown + JSON.stringify(contentJson));
    const existing = existingRevisionsById.get(revision.id);
    const seedIsCurrent = existing
      && existing.memo_id === revision.memoId
      && existing.revision === revision.revision
      && existing.title === revision.title
      && existing.content_hash === contentHash;
    if (!overwriteExisting && seedIsCurrent) continue;

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

const clampNumber = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
};
