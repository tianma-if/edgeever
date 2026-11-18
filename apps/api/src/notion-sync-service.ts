import type {
  Notebook,
  NotionSyncBatchResponse,
  NotionSyncSettings,
  NotionSyncSettingsUpdateInput,
} from "@edgeever/shared";
import type { AuditActor, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { isDemoModeEnabled } from "./demo-mode";
import { isoNow, parseJsonArray } from "./entity-utils";
import {
  createMemoRecord,
  deleteMemoRecord,
  getMemoDetail,
  restoreMemoRecord,
  updateMemoRecord,
} from "./memo-service";
import { createNotebookRecord, listNotebooks } from "./notebook-service";
import { NotionApiClient, type NotionTransport } from "./notion-api-client";
import { hasStructuredNoteMarker, stripStructuredNoteMarker } from "./notion-markdown";
import {
  computeNotionSnapshotHash,
  createNotionWebhookChannelToken,
  decryptNotionSecret,
  encryptNotionSecret,
  extractNotionDatabaseUuid,
  normalizeNotionUuid,
  resolvePrimaryNotionEncryptionKey,
} from "./notion-sync-crypto";
import type {
  DatabaseAdapter,
  DatabaseQueryResult,
  PreparedStatementAdapter,
} from "./storage-contract";

export const NOTION_SYNC_ACTOR_ID = "notion-sync";
const NOTION_SYNC_ACTOR: AuditActor = {
  actorType: "agent",
  actorId: NOTION_SYNC_ACTOR_ID,
};
const NOTION_SYNC_ACTOR_LABEL = "agent:notion-sync";

const RAW_STATEMENT = Symbol("edgeever.notionSync.rawStatement");
const TRACKED_MEMO_MUTATION = Symbol("edgeever.notionSync.memoMutation");
const AUDIT_INSERT_REGEX = /\bINSERT\s+INTO\s+audit_events\b/i;

const MAX_REMOTE_MUTATIONS_PER_BATCH = 8;
const MEMO_SCAN_PAGE_SIZE = 25;

type NotionSyncConfigRow = {
  workspace_id: string;
  is_enabled: number;
  database_id: string;
  database_title: string | null;
  api_token_encrypted: string;
  webhook_channel_token: string;
  webhook_secret_encrypted: string | null;
  pending_verification_token_encrypted: string | null;
  tag_filter_json: string;
  notebook_filter_json: string;
  default_notebook_id: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type NotionSyncMappingRow = {
  workspace_id: string;
  memo_id: string;
  notion_page_id: string;
  content_hash: string;
  notebook_name: string | null;
  is_deleted: number;
  last_direction: string;
  updated_at: string;
};

type TrackedStatement = PreparedStatementAdapter & {
  [RAW_STATEMENT]: PreparedStatementAdapter;
  [TRACKED_MEMO_MUTATION]?: string;
};

const isTrackedStatement = (
  statement: PreparedStatementAdapter,
): statement is TrackedStatement => RAW_STATEMENT in statement;

const isSyncableMemoAuditAction = (action: string): boolean =>
  action.startsWith("memo.") && !action.startsWith("memo.share_");

const parseMemoIdFromAuditBindings = (bindings: unknown[]): string | undefined => {
  if (bindings.length !== 8) return undefined;
  const [, , actorId, action, entityType, entityId] = bindings;
  if (actorId === NOTION_SYNC_ACTOR_ID) return undefined;
  if (entityType !== "memo" || typeof entityId !== "string" || typeof action !== "string") {
    return undefined;
  }
  return isSyncableMemoAuditAction(action) ? entityId : undefined;
};

const wrapAuditStatement = (
  inner: PreparedStatementAdapter,
  onCommittedMemo: (memoId: string) => void,
  trackedMemoId?: string,
): TrackedStatement => ({
  [RAW_STATEMENT]: inner,
  ...(trackedMemoId ? { [TRACKED_MEMO_MUTATION]: trackedMemoId } : {}),
  bind(...values: unknown[]) {
    const bound = inner.bind(...values);
    return wrapAuditStatement(bound, onCommittedMemo, parseMemoIdFromAuditBindings(values));
  },
  first: inner.first.bind(inner),
  all: inner.all.bind(inner),
  async run<T = Record<string, unknown>>() {
    const result: DatabaseQueryResult<T> = await inner.run<T>();
    if (trackedMemoId) onCommittedMemo(trackedMemoId);
    return result;
  },
});

export const wrapDatabaseForNotionSync = (
  db: DatabaseAdapter,
  onCommittedMemo: (memoId: string) => void,
): DatabaseAdapter => ({
  prepare(query: string) {
    const inner = db.prepare(query);
    if (!AUDIT_INSERT_REGEX.test(query)) return inner;
    return wrapAuditStatement(inner, onCommittedMemo);
  },
  async batch<T = unknown>(statements: PreparedStatementAdapter[]) {
    const rawStatements = statements.map((stmt) =>
      isTrackedStatement(stmt) ? stmt[RAW_STATEMENT] : stmt,
    );
    const results = await db.batch<T>(rawStatements);
    for (const stmt of statements) {
      const memoId = isTrackedStatement(stmt) ? stmt[TRACKED_MEMO_MUTATION] : undefined;
      if (memoId) onCommittedMemo(memoId);
    }
    return results;
  },
});

const resolveNotionTransport = (env: Bindings): NotionTransport =>
  env.publicNetworkFetch ?? ((url, init) => fetch(url, init));

const isMissingNotionTableError = (error: unknown): boolean =>
  error instanceof Error && /no such table:\s*notion_sync_/i.test(error.message);

const getConfigRow = async (db: DatabaseAdapter, workspaceId: string) => {
  try {
    return await db
      .prepare(
        `SELECT workspace_id, is_enabled, database_id, database_title, api_token_encrypted,
                webhook_channel_token, webhook_secret_encrypted, pending_verification_token_encrypted,
                tag_filter_json, notebook_filter_json, default_notebook_id,
                last_synced_at, last_error, created_at, updated_at
         FROM notion_sync_configs
         WHERE workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<NotionSyncConfigRow>();
  } catch (error) {
    if (isMissingNotionTableError(error)) return null;
    throw error;
  }
};

export const getConfigRowByWebhookChannelToken = (
  db: DatabaseAdapter,
  channelToken: string,
) =>
  db
    .prepare(
      `SELECT workspace_id, is_enabled, database_id, database_title, api_token_encrypted,
              webhook_channel_token, webhook_secret_encrypted, pending_verification_token_encrypted,
              tag_filter_json, notebook_filter_json, default_notebook_id,
              last_synced_at, last_error, created_at, updated_at
       FROM notion_sync_configs
       WHERE webhook_channel_token = ?`,
    )
    .bind(channelToken)
    .first<NotionSyncConfigRow>();

const recordSyncStatus = async (
  db: DatabaseAdapter,
  workspaceId: string,
  error: string | null,
) => {
  const now = isoNow();
  await db
    .prepare(
      `UPDATE notion_sync_configs
       SET last_synced_at = CASE WHEN ? IS NULL THEN ? ELSE last_synced_at END,
           last_error = ?,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(error, now, error ? error.slice(0, 500) : null, now, workspaceId)
    .run();
};

export const getNotionSyncSettings = async (
  db: DatabaseAdapter,
  workspaceId: string,
  env: Bindings,
): Promise<NotionSyncSettings> => {
  const encryptionConfigured = Boolean(resolvePrimaryNotionEncryptionKey(env, workspaceId));
  const row = await getConfigRow(db, workspaceId);
  if (!row) {
    return {
      configured: false,
      encryptionConfigured,
      isEnabled: false,
      databaseId: "",
      databaseTitle: null,
      hasApiToken: false,
      hasWebhookSecret: false,
      pendingVerificationToken: null,
      webhookPath: null,
      tagFilter: [],
      notebookFilter: [],
      defaultNotebookId: null,
      lastSyncedAt: null,
      lastError: null,
    };
  }

  const pendingDecrypted = await decryptNotionSecret(
    row.pending_verification_token_encrypted,
    workspaceId,
    env,
  );
  const apiTokenDecrypted = await decryptNotionSecret(row.api_token_encrypted, workspaceId, env);
  const webhookSecretDecrypted = await decryptNotionSecret(
    row.webhook_secret_encrypted,
    workspaceId,
    env,
  );

  return {
    configured: true,
    encryptionConfigured,
    isEnabled: Boolean(row.is_enabled),
    databaseId: row.database_id,
    databaseTitle: row.database_title,
    hasApiToken: Boolean(apiTokenDecrypted?.value),
    hasWebhookSecret: Boolean(webhookSecretDecrypted?.value),
    pendingVerificationToken: pendingDecrypted?.value ?? null,
    webhookPath: `/api/public/webhooks/notion/${row.webhook_channel_token}`,
    tagFilter: parseJsonArray(row.tag_filter_json),
    notebookFilter: parseJsonArray(row.notebook_filter_json),
    defaultNotebookId: row.default_notebook_id,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
};

export const testNotionSyncConnection = async (
  db: DatabaseAdapter,
  workspaceId: string,
  env: Bindings,
  input: { databaseId: string; apiToken?: string },
): Promise<{ databaseId: string; databaseTitle: string }> => {
  const databaseId = extractNotionDatabaseUuid(input.databaseId);
  if (!databaseId) {
    throw new AppError(
      "notion_invalid_database_id",
      "Enter a valid 32-character Notion database ID or full Notion database URL.",
      400,
    );
  }

  let apiToken = input.apiToken?.trim() ?? "";
  if (!apiToken) {
    const existing = await getConfigRow(db, workspaceId);
    const saved = await decryptNotionSecret(existing?.api_token_encrypted, workspaceId, env);
    apiToken = saved?.value ?? "";
  }
  if (!apiToken) {
    throw new AppError(
      "notion_token_required",
      "Enter a Notion integration secret to test the connection.",
      400,
    );
  }

  const client = new NotionApiClient({
    apiToken,
    databaseId,
    transport: resolveNotionTransport(env),
  });
  const { databaseTitle } = await client.ensureDatabaseSchema();
  return { databaseId, databaseTitle };
};

const normalizeFilterList = (items: string[] | undefined): string[] =>
  Array.from(
    new Set((items ?? []).map((item) => item.trim().replace(/^#+/, "")).filter(Boolean)),
  ).slice(0, 50);

export const upsertNotionSyncSettings = async (
  db: DatabaseAdapter,
  workspaceId: string,
  env: Bindings,
  input: NotionSyncSettingsUpdateInput,
): Promise<NotionSyncSettings> => {
  const databaseId = extractNotionDatabaseUuid(input.databaseId);
  if (!databaseId) {
    throw new AppError(
      "notion_invalid_database_id",
      "Enter a valid 32-character Notion database ID or full Notion database URL.",
      400,
    );
  }

  const existing = await getConfigRow(db, workspaceId);
  let plaintextApiToken = input.apiToken?.trim() ?? "";
  if (!plaintextApiToken && existing) {
    const decrypted = await decryptNotionSecret(existing.api_token_encrypted, workspaceId, env);
    plaintextApiToken = decrypted?.value ?? "";
  }
  if (!plaintextApiToken) {
    throw new AppError(
      "notion_token_required",
      "Notion integration secret is required.",
      400,
    );
  }

  // Verify database access and ensure required properties exist before saving enabled config.
  const client = new NotionApiClient({
    apiToken: plaintextApiToken,
    databaseId,
    transport: resolveNotionTransport(env),
  });
  const { databaseTitle } = await client.ensureDatabaseSchema();

  const encryptedApiToken = await encryptNotionSecret(plaintextApiToken, workspaceId, env);

  let encryptedWebhookSecret = existing?.webhook_secret_encrypted ?? null;
  let pendingEncrypted = existing?.pending_verification_token_encrypted ?? null;
  if (input.webhookSecret !== undefined) {
    const trimmed = input.webhookSecret.trim();
    encryptedWebhookSecret = trimmed
      ? await encryptNotionSecret(trimmed, workspaceId, env)
      : null;
    if (trimmed) {
      pendingEncrypted = null;
    }
  } else if (!encryptedWebhookSecret && pendingEncrypted) {
    // Re-encrypt under primary key if needed while keeping pending token available.
    const pendingVal = await decryptNotionSecret(pendingEncrypted, workspaceId, env);
    if (pendingVal?.needsMigration) {
      pendingEncrypted = await encryptNotionSecret(pendingVal.value, workspaceId, env);
    }
  }

  const channelToken = existing?.webhook_channel_token ?? createNotionWebhookChannelToken();
  const tagFilterJson = JSON.stringify(normalizeFilterList(input.tagFilter));
  const notebookFilterJson = JSON.stringify(normalizeFilterList(input.notebookFilter));
  const now = isoNow();

  await db
    .prepare(
      `INSERT INTO notion_sync_configs (
         workspace_id, is_enabled, database_id, database_title, api_token_encrypted,
         webhook_channel_token, webhook_secret_encrypted, pending_verification_token_encrypted,
         tag_filter_json, notebook_filter_json, default_notebook_id,
         last_synced_at, last_error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         is_enabled = excluded.is_enabled,
         database_id = excluded.database_id,
         database_title = excluded.database_title,
         api_token_encrypted = excluded.api_token_encrypted,
         webhook_secret_encrypted = excluded.webhook_secret_encrypted,
         pending_verification_token_encrypted = excluded.pending_verification_token_encrypted,
         tag_filter_json = excluded.tag_filter_json,
         notebook_filter_json = excluded.notebook_filter_json,
         default_notebook_id = excluded.default_notebook_id,
         last_error = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      workspaceId,
      input.isEnabled ? 1 : 0,
      databaseId,
      databaseTitle,
      encryptedApiToken,
      channelToken,
      encryptedWebhookSecret,
      pendingEncrypted,
      tagFilterJson,
      notebookFilterJson,
      input.defaultNotebookId ?? null,
      now,
      now,
    )
    .run();

  return getNotionSyncSettings(db, workspaceId, env);
};

export const rotateNotionWebhookChannel = async (
  db: DatabaseAdapter,
  workspaceId: string,
  env: Bindings,
): Promise<NotionSyncSettings> => {
  const existing = await getConfigRow(db, workspaceId);
  if (!existing) {
    throw new AppError("not_found", "Notion sync is not configured.", 404);
  }
  await db
    .prepare(
      `UPDATE notion_sync_configs
       SET webhook_channel_token = ?,
           webhook_secret_encrypted = NULL,
           pending_verification_token_encrypted = NULL,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(createNotionWebhookChannelToken(), isoNow(), workspaceId)
    .run();

  return getNotionSyncSettings(db, workspaceId, env);
};

export const deleteNotionSyncSettings = async (
  db: DatabaseAdapter,
  workspaceId: string,
): Promise<void> => {
  await db.batch([
    db.prepare("DELETE FROM notion_sync_configs WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM notion_sync_mappings WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM notion_webhook_deliveries WHERE workspace_id = ?").bind(workspaceId),
  ]);
};

export const storePendingNotionVerificationToken = async (
  db: DatabaseAdapter,
  workspaceId: string,
  verificationToken: string,
  env: Bindings,
): Promise<void> => {
  const encrypted = await encryptNotionSecret(verificationToken.trim(), workspaceId, env);
  await db
    .prepare(
      `UPDATE notion_sync_configs
       SET pending_verification_token_encrypted = ?, updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(encrypted, isoNow(), workspaceId)
    .run();
};

export const promotePendingNotionVerificationToken = async (
  db: DatabaseAdapter,
  workspaceId: string,
  verifiedSecret: string,
  env: Bindings,
): Promise<void> => {
  const encrypted = await encryptNotionSecret(verifiedSecret, workspaceId, env);
  await db
    .prepare(
      `UPDATE notion_sync_configs
       SET webhook_secret_encrypted = ?,
           pending_verification_token_encrypted = NULL,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(encrypted, isoNow(), workspaceId)
    .run();
};

export const claimNotionWebhookDelivery = async (
  db: DatabaseAdapter,
  workspaceId: string,
  deliveryId: string | undefined,
): Promise<boolean> => {
  if (!deliveryId) return true;
  const existing = await db
    .prepare(
      `SELECT delivery_id FROM notion_webhook_deliveries
       WHERE workspace_id = ? AND delivery_id = ?`,
    )
    .bind(workspaceId, deliveryId)
    .first<{ delivery_id: string }>();
  if (existing) return false;

  const now = new Date();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO notion_webhook_deliveries (workspace_id, delivery_id, received_at)
         VALUES (?, ?, ?)`,
      )
      .bind(workspaceId, deliveryId, now.toISOString()),
    db
      .prepare(
        `DELETE FROM notion_webhook_deliveries
         WHERE rowid IN (
           SELECT rowid FROM notion_webhook_deliveries WHERE received_at < ? LIMIT 100
         )`,
      )
      .bind(cutoff),
  ]);
  return true;
};

const matchesConfiguredScope = (
  row: NotionSyncConfigRow,
  tags: string[],
  notebookName: string,
): boolean => {
  const tagFilters = parseJsonArray(row.tag_filter_json).map((t) => t.toLowerCase());
  if (tagFilters.length > 0) {
    const lowerTags = new Set(tags.map((t) => t.trim().replace(/^#+/, "").toLowerCase()));
    if (!tagFilters.some((filter) => lowerTags.has(filter))) return false;
  }

  const notebookFilters = parseJsonArray(row.notebook_filter_json).map((n) => n.toLowerCase());
  if (notebookFilters.length > 0) {
    if (!notebookFilters.includes(notebookName.trim().toLowerCase())) return false;
  }

  return true;
};

const getMappingByMemo = (db: DatabaseAdapter, workspaceId: string, memoId: string) =>
  db
    .prepare(
      `SELECT workspace_id, memo_id, notion_page_id, content_hash, notebook_name, is_deleted, last_direction, updated_at
       FROM notion_sync_mappings
       WHERE workspace_id = ? AND memo_id = ?`,
    )
    .bind(workspaceId, memoId)
    .first<NotionSyncMappingRow>();

const getMappingByPage = (db: DatabaseAdapter, workspaceId: string, pageId: string) =>
  db
    .prepare(
      `SELECT workspace_id, memo_id, notion_page_id, content_hash, notebook_name, is_deleted, last_direction, updated_at
       FROM notion_sync_mappings
       WHERE workspace_id = ? AND notion_page_id = ?`,
    )
    .bind(workspaceId, normalizeNotionUuid(pageId))
    .first<NotionSyncMappingRow>();

const upsertMapping = async (
  db: DatabaseAdapter,
  input: {
    workspaceId: string;
    memoId: string;
    notionPageId: string;
    contentHash: string;
    notebookName: string;
    isDeleted: boolean;
    direction: "ee_to_notion" | "notion_to_ee";
  },
) => {
  await db
    .prepare(
      `INSERT INTO notion_sync_mappings (
         workspace_id, memo_id, notion_page_id, content_hash, notebook_name, is_deleted, last_direction, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, memo_id) DO UPDATE SET
         notion_page_id = excluded.notion_page_id,
         content_hash = excluded.content_hash,
         notebook_name = excluded.notebook_name,
         is_deleted = excluded.is_deleted,
         last_direction = excluded.last_direction,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.workspaceId,
      input.memoId,
      normalizeNotionUuid(input.notionPageId),
      input.contentHash,
      input.notebookName,
      input.isDeleted ? 1 : 0,
      input.direction,
      isoNow(),
    )
    .run();
};

const createConfiguredNotionClient = async (
  row: NotionSyncConfigRow,
  env: Bindings,
): Promise<NotionApiClient | null> => {
  const token = await decryptNotionSecret(row.api_token_encrypted, row.workspace_id, env);
  if (!token?.value) return null;
  return new NotionApiClient({
    apiToken: token.value,
    databaseId: row.database_id,
    transport: resolveNotionTransport(env),
  });
};

export const syncSingleMemoToNotion = async (
  env: Bindings,
  configRow: NotionSyncConfigRow,
  notion: NotionApiClient,
  memoId: string,
  notebooksById: Map<string, Notebook>,
): Promise<"created" | "updated" | "archived" | "skipped"> => {
  const db = env.storage.db;
  const workspaceId = configRow.workspace_id;
  const memo = await getMemoDetail(db, workspaceId, memoId, true);
  const existing = await getMappingByMemo(db, workspaceId, memoId);

  if (!memo || memo.isDeleted) {
    if (existing && existing.is_deleted === 0) {
      await notion.archivePage(existing.notion_page_id, true);
      await upsertMapping(db, {
        workspaceId,
        memoId,
        notionPageId: existing.notion_page_id,
        contentHash: existing.content_hash,
        notebookName: existing.notebook_name ?? "Inbox",
        isDeleted: true,
        direction: "ee_to_notion",
      });
      return "archived";
    }
    return "skipped";
  }

  const notebookName = notebooksById.get(memo.notebookId)?.name ?? "Inbox";
  if (!matchesConfiguredScope(configRow, memo.tags, notebookName)) {
    if (existing && existing.is_deleted === 0) {
      await notion.archivePage(existing.notion_page_id, true);
      await upsertMapping(db, {
        workspaceId,
        memoId,
        notionPageId: existing.notion_page_id,
        contentHash: existing.content_hash,
        notebookName,
        isDeleted: true,
        direction: "ee_to_notion",
      });
      return "archived";
    }
    return "skipped";
  }

  const exportMarkdown = hasStructuredNoteMarker(memo.contentMarkdown)
    ? stripStructuredNoteMarker(memo.contentMarkdown)
    : memo.contentMarkdown;

  const snapshot = {
    title: memo.title || "Untitled",
    markdown: exportMarkdown,
    tags: memo.tags,
    notebookName,
    isPinned: memo.isPinned,
  };
  const nextHash = await computeNotionSnapshotHash(snapshot);

  if (existing && existing.is_deleted === 0 && existing.content_hash === nextHash) {
    return "skipped";
  }

  let pageId = existing?.notion_page_id ?? null;
  if (!pageId) {
    pageId = await notion.findPageByEdgeEverId(memo.id);
  }

  if (pageId) {
    await notion.updateNotePage(pageId, {
      ...snapshot,
      edgeEverId: memo.id,
    });
    await upsertMapping(db, {
      workspaceId,
      memoId: memo.id,
      notionPageId: pageId,
      contentHash: nextHash,
      notebookName,
      isDeleted: false,
      direction: "ee_to_notion",
    });
    return "updated";
  }

  const createdPageId = await notion.createNotePage({
    ...snapshot,
    edgeEverId: memo.id,
  });
  await upsertMapping(db, {
    workspaceId,
    memoId: memo.id,
    notionPageId: createdPageId,
    contentHash: nextHash,
    notebookName,
    isDeleted: false,
    direction: "ee_to_notion",
  });
  return "created";
};

const resolveWorkspaceIdForMemo = async (
  db: DatabaseAdapter,
  memoId: string,
): Promise<string | null> => {
  const memoRow = await db
    .prepare("SELECT workspace_id FROM memos WHERE id = ?")
    .bind(memoId)
    .first<{ workspace_id: string }>();
  if (memoRow?.workspace_id) return memoRow.workspace_id;

  try {
    const mappingRow = await db
      .prepare("SELECT workspace_id FROM notion_sync_mappings WHERE memo_id = ? LIMIT 1")
      .bind(memoId)
      .first<{ workspace_id: string }>();
    return mappingRow?.workspace_id ?? null;
  } catch (error) {
    if (isMissingNotionTableError(error)) return null;
    throw error;
  }
};

export const syncCommittedMemosToNotion = async (
  env: Bindings,
  memoIds: string[],
): Promise<void> => {
  const db = env.storage.db;
  const byWorkspace = new Map<string, string[]>();

  for (const memoId of new Set(memoIds)) {
    const workspaceId = await resolveWorkspaceIdForMemo(db, memoId);
    if (!workspaceId) continue;
    const group = byWorkspace.get(workspaceId) ?? [];
    group.push(memoId);
    byWorkspace.set(workspaceId, group);
  }

  for (const [workspaceId, ids] of byWorkspace.entries()) {
    const configRow = await getConfigRow(db, workspaceId);
    if (!configRow || !configRow.is_enabled) continue;

    const notion = await createConfiguredNotionClient(configRow, env);
    if (!notion) continue;

    try {
      const notebooks = await listNotebooks(db, workspaceId);
      const notebooksById = new Map(notebooks.map((nb) => [nb.id, nb]));
      for (const memoId of ids) {
        await syncSingleMemoToNotion(env, configRow, notion, memoId, notebooksById);
      }
      await recordSyncStatus(db, workspaceId, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordSyncStatus(db, workspaceId, message).catch(() => undefined);
    }
  }
};

const resolveOrCreateTargetNotebook = async (
  db: DatabaseAdapter,
  workspaceId: string,
  preferredName: string,
  defaultNotebookId: string | null,
): Promise<{ id: string; name: string }> => {
  const notebooks = await listNotebooks(db, workspaceId);
  const trimmed = preferredName.trim();
  if (trimmed) {
    const lower = trimmed.toLowerCase();
    const matched = notebooks.find(
      (nb) =>
        nb.name.toLowerCase() === lower
        || nb.slug?.toLowerCase() === lower
        || (lower === "inbox" && (nb.id.endsWith("_inbox") || nb.id === "nb_inbox")),
    );
    if (matched) return { id: matched.id, name: matched.name };
    const created = await createNotebookRecord(
      db,
      workspaceId,
      { name: trimmed.slice(0, 80) },
      NOTION_SYNC_ACTOR,
    );
    return { id: created.id, name: created.name };
  }

  if (defaultNotebookId) {
    const configured = notebooks.find((nb) => nb.id === defaultNotebookId);
    if (configured) return { id: configured.id, name: configured.name };
  }

  const inbox =
    notebooks.find((nb) => nb.slug === "inbox" || nb.id.endsWith("_inbox") || nb.id === "nb_inbox")
    ?? notebooks[0];
  if (inbox) return { id: inbox.id, name: inbox.name };

  const created = await createNotebookRecord(
    db,
    workspaceId,
    { name: "Inbox" },
    NOTION_SYNC_ACTOR,
  );
  return { id: created.id, name: created.name };
};

export const syncSinglePageFromNotionToEdgeEver = async (
  env: Bindings,
  configRow: NotionSyncConfigRow,
  notion: NotionApiClient,
  rawPageId: string,
  forceDelete = false,
): Promise<"created" | "updated" | "archived" | "skipped"> => {
  const db = env.storage.db;
  const workspaceId = configRow.workspace_id;
  const pageId = normalizeNotionUuid(rawPageId);
  const existing = await getMappingByPage(db, workspaceId, pageId);

  if (forceDelete) {
    if (existing && existing.is_deleted === 0) {
      await deleteMemoRecord(env, workspaceId, existing.memo_id, false, NOTION_SYNC_ACTOR).catch(
        () => undefined,
      );
      await upsertMapping(db, {
        workspaceId,
        memoId: existing.memo_id,
        notionPageId: pageId,
        contentHash: existing.content_hash,
        notebookName: existing.notebook_name ?? "Inbox",
        isDeleted: true,
        direction: "notion_to_ee",
      });
      return "archived";
    }
    return "skipped";
  }

  const snapshot = await notion.getPageSnapshot(pageId);
  if (!snapshot || snapshot.archived || snapshot.inTrash) {
    if (existing && existing.is_deleted === 0) {
      await deleteMemoRecord(env, workspaceId, existing.memo_id, false, NOTION_SYNC_ACTOR).catch(
        () => undefined,
      );
      await upsertMapping(db, {
        workspaceId,
        memoId: existing.memo_id,
        notionPageId: pageId,
        contentHash: existing.content_hash,
        notebookName: existing.notebook_name ?? "Inbox",
        isDeleted: true,
        direction: "notion_to_ee",
      });
      return "archived";
    }
    return "skipped";
  }

  if (snapshot.parentDatabaseId !== notion.databaseId) {
    return "skipped";
  }

  const targetNotebook = await resolveOrCreateTargetNotebook(
    db,
    workspaceId,
    snapshot.notebookName || existing?.notebook_name || "",
    configRow.default_notebook_id,
  );

  if (!matchesConfiguredScope(configRow, snapshot.tags, targetNotebook.name)) {
    return "skipped";
  }

  const nextHash = await computeNotionSnapshotHash({
    title: snapshot.title,
    markdown: snapshot.markdown,
    tags: snapshot.tags,
    notebookName: targetNotebook.name,
    isPinned: snapshot.isPinned,
  });

  if (existing && existing.is_deleted === 0 && existing.content_hash === nextHash) {
    return "skipped";
  }

  const candidateMemoId = existing?.memo_id ?? snapshot.edgeEverId;
  if (candidateMemoId) {
    let current = await getMemoDetail(db, workspaceId, candidateMemoId, true);
    if (current?.isDeleted) {
      current = await restoreMemoRecord(db, workspaceId, candidateMemoId, NOTION_SYNC_ACTOR);
    }

    if (current) {
      const structured = hasStructuredNoteMarker(current.contentMarkdown);
      await updateMemoRecord(
        db,
        workspaceId,
        candidateMemoId,
        {
          notebookId: targetNotebook.id,
          title: snapshot.title,
          tags: snapshot.tags,
          isPinned: snapshot.isPinned,
          allowDestructiveOverwrite: true,
          ...(structured ? {} : { contentMarkdown: snapshot.markdown }),
        },
        NOTION_SYNC_ACTOR,
        NOTION_SYNC_ACTOR_LABEL,
        false,
      );

      if (!snapshot.edgeEverId) {
        await notion.setEdgeEverIdOnPage(pageId, candidateMemoId);
      }

      await upsertMapping(db, {
        workspaceId,
        memoId: candidateMemoId,
        notionPageId: pageId,
        contentHash: nextHash,
        notebookName: targetNotebook.name,
        isDeleted: false,
        direction: "notion_to_ee",
      });
      return "updated";
    }
  }

  const created = await createMemoRecord(
    db,
    workspaceId,
    {
      notebookId: targetNotebook.id,
      title: snapshot.title,
      contentMarkdown: snapshot.markdown,
      tags: snapshot.tags,
    },
    NOTION_SYNC_ACTOR,
    NOTION_SYNC_ACTOR_LABEL,
  );

  if (snapshot.isPinned) {
    await updateMemoRecord(
      db,
      workspaceId,
      created.id,
      { isPinned: true },
      NOTION_SYNC_ACTOR,
      NOTION_SYNC_ACTOR_LABEL,
      false,
    );
  }

  await notion.setEdgeEverIdOnPage(pageId, created.id);
  await upsertMapping(db, {
    workspaceId,
    memoId: created.id,
    notionPageId: pageId,
    contentHash: nextHash,
    notebookName: targetNotebook.name,
    isDeleted: false,
    direction: "notion_to_ee",
  });
  return "created";
};

export const handleIncomingNotionWebhookEvent = async (
  env: Bindings,
  configRow: NotionSyncConfigRow,
  payload: {
    id?: string;
    type?: string;
    authors?: Array<{ id?: string; type?: string }>;
    entity?: { id?: string; type?: string };
  },
): Promise<void> => {
  if (!configRow.is_enabled) return;

  const db = env.storage.db;
  const claimed = await claimNotionWebhookDelivery(db, configRow.workspace_id, payload.id);
  if (!claimed) return;

  const authors = payload.authors ?? [];
  if (authors.length > 0 && authors.every((author) => author.type === "bot")) {
    return;
  }

  if (payload.entity?.type !== "page" || !payload.entity.id) {
    return;
  }

  const notion = await createConfiguredNotionClient(configRow, env);
  if (!notion) return;

  try {
    if (payload.type === "page.deleted") {
      await syncSinglePageFromNotionToEdgeEver(env, configRow, notion, payload.entity.id, true);
    } else if (
      payload.type === "page.created"
      || payload.type === "page.content_updated"
      || payload.type === "page.properties_updated"
      || payload.type === "page.moved"
      || payload.type === "page.undeleted"
    ) {
      await syncSinglePageFromNotionToEdgeEver(env, configRow, notion, payload.entity.id, false);
    }
    await recordSyncStatus(db, configRow.workspace_id, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordSyncStatus(db, configRow.workspace_id, message).catch(() => undefined);
  }
};

type KeysetMemoSyncRow = {
  id: string;
  notebook_id: string;
  title: string | null;
  tags_json: string;
  is_pinned: number;
  content_markdown: string;
  mapped_page_id: string | null;
  mapped_hash: string | null;
  mapped_deleted: number | null;
};

/**
 * Runs a bounded keyset-paginated synchronization step (`O(batch)` DB reads,
 * zero `COUNT(*)`, zero repeated table rescans).
 */
export const runNotionSyncBatch = async (
  env: Bindings,
  workspaceId: string,
  input: { cursor?: string | null; phase?: "ee_to_notion" | "notion_to_ee" },
): Promise<NotionSyncBatchResponse> => {
  const db = env.storage.db;
  const configRow = await getConfigRow(db, workspaceId);
  if (!configRow) {
    throw new AppError("not_found", "Configure Notion sync before running synchronization.", 404);
  }

  const notion = await createConfiguredNotionClient(configRow, env);
  if (!notion) {
    throw new AppError("notion_token_required", "Saved Notion credentials could not be decrypted.", 400);
  }

  await notion.ensureDatabaseSchema();
  const phase = input.phase ?? "ee_to_notion";
  const summary = {
    phase,
    created: 0,
    updated: 0,
    archived: 0,
    skipped: 0,
    failed: 0,
    errors: {} as Record<string, string>,
  };

  if (phase === "ee_to_notion") {
    const notebooks = await listNotebooks(db, workspaceId);
    const notebooksById = new Map(notebooks.map((nb) => [nb.id, nb]));

    const rowsResult = await db
      .prepare(
        `SELECT m.id, m.notebook_id, m.title, m.tags_json, m.is_pinned,
                c.content_markdown,
                s.notion_page_id AS mapped_page_id,
                s.content_hash AS mapped_hash,
                s.is_deleted AS mapped_deleted
         FROM memos m
         INNER JOIN memo_contents c ON c.memo_id = m.id
         LEFT JOIN notion_sync_mappings s
           ON s.workspace_id = m.workspace_id AND s.memo_id = m.id
         WHERE m.workspace_id = ?
           AND m.is_deleted = 0
           AND (? IS NULL OR m.id > ?)
         ORDER BY m.id ASC
         LIMIT ?`,
      )
      .bind(workspaceId, input.cursor ?? null, input.cursor ?? null, MEMO_SCAN_PAGE_SIZE + 1)
      .all<KeysetMemoSyncRow>();

    const hasNextMemoPage = rowsResult.results.length > MEMO_SCAN_PAGE_SIZE;
    const rows = rowsResult.results.slice(0, MEMO_SCAN_PAGE_SIZE);
    let remoteMutations = 0;
    let lastProcessedId: string | null = null;
    let stoppedEarly = false;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const notebookName = notebooksById.get(row.notebook_id)?.name ?? "Inbox";
      const tags = parseJsonArray(row.tags_json);

      if (!matchesConfiguredScope(configRow, tags, notebookName)) {
        summary.skipped += 1;
        lastProcessedId = row.id;
        continue;
      }

      const exportMarkdown = hasStructuredNoteMarker(row.content_markdown)
        ? stripStructuredNoteMarker(row.content_markdown)
        : row.content_markdown;
      const expectedHash = await computeNotionSnapshotHash({
        title: row.title || "Untitled",
        markdown: exportMarkdown,
        tags,
        notebookName,
        isPinned: Boolean(row.is_pinned),
      });

      if (row.mapped_page_id && row.mapped_deleted === 0 && row.mapped_hash === expectedHash) {
        summary.skipped += 1;
        lastProcessedId = row.id;
        continue;
      }

      if (remoteMutations >= MAX_REMOTE_MUTATIONS_PER_BATCH) {
        stoppedEarly = true;
        break;
      }

      remoteMutations += 1;
      lastProcessedId = row.id;
      try {
        const outcome = await syncSingleMemoToNotion(env, configRow, notion, row.id, notebooksById);
        summary[outcome] += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors[row.id] = error instanceof Error ? error.message : String(error);
      }
    }

    if (stoppedEarly || hasNextMemoPage) {
      return {
        ok: true,
        hasMore: true,
        nextPhase: "ee_to_notion",
        nextCursor: lastProcessedId,
        summary,
      };
    }

    return {
      ok: true,
      hasMore: true,
      nextPhase: "notion_to_ee",
      nextCursor: null,
      summary,
    };
  }

  // Phase 2: Notion -> EdgeEver paginated query
  const pageResult = await notion.queryDatabasePage(input.cursor ?? null, MAX_REMOTE_MUTATIONS_PER_BATCH);
  for (const item of pageResult.pages) {
    const existing = await getMappingByPage(db, workspaceId, item.id);
    if (existing && existing.is_deleted === 0) {
      summary.skipped += 1;
      continue;
    }
    try {
      const outcome = await syncSinglePageFromNotionToEdgeEver(env, configRow, notion, item.id, false);
      summary[outcome] += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors[item.id] = error instanceof Error ? error.message : String(error);
    }
  }

  if (!pageResult.hasMore) {
    await recordSyncStatus(
      db,
      workspaceId,
      summary.failed > 0 ? `${summary.failed} item(s) failed during sync.` : null,
    );
  }

  return {
    ok: true,
    hasMore: pageResult.hasMore,
    nextPhase: pageResult.hasMore ? "notion_to_ee" : null,
    nextCursor: pageResult.nextCursor,
    summary,
  };
};

export const createNotionSyncObserverSession = (
  runtimeEnv: Bindings,
): {
  env: Bindings;
  flush: (ctx: { waitUntil: (promise: Promise<unknown>) => void }, status: number) => void;
} => {
  if (isDemoModeEnabled(runtimeEnv.EDGE_EVER_DEMO_MODE) || !runtimeEnv.storage?.db) {
    return { env: runtimeEnv, flush: () => undefined };
  }

  const committedMemoIds: string[] = [];
  const wrappedEnv: Bindings = {
    ...runtimeEnv,
    storage: {
      ...runtimeEnv.storage,
      db: wrapDatabaseForNotionSync(runtimeEnv.storage.db, (memoId) => {
        committedMemoIds.push(memoId);
      }),
    },
  };

  return {
    env: wrappedEnv,
    flush(ctx, status) {
      if (status >= 400 || committedMemoIds.length === 0) return;
      ctx.waitUntil(
        syncCommittedMemosToNotion(runtimeEnv, committedMemoIds).catch((error) => {
          console.warn("[notion-sync] background memo push failed", error);
        }),
      );
    },
  };
};
