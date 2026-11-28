import { resolveResourceUploadMimeType } from "@edgeever/shared";
import { audit, auditStatement } from "./audit";
import type { AppContext, AuditActor, AuthContext, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { randomToken } from "./auth-crypto";
import { createId, isoNow } from "./entity-utils";
import { sha256, sha256Bytes } from "./hash-utils";
import { escapeMarkdownImageAlt, escapeMarkdownLinkLabel } from "./mcp-json-rpc";
import { resolveObjectStorage } from "./object-storage";
import {
  inferImageExtension,
  normalizeFilename,
  prepareImageForStorage,
  validateAttachmentUpload,
  validateImageUpload,
} from "./resource-service";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

/**
 * Pending resources let a client upload a file before the memo that will use
 * it exists. An upload credential is bound to one workspace, kind, MIME type
 * and exact size; the bytes travel in a plain HTTP PUT, never through a tool
 * call; the stored file then waits, workspace-scoped, until create_memo or
 * update_memo binds it with an explicit resource id.
 */
export const PENDING_RESOURCE_UPLOAD_PATH = "/api/public/resource-uploads";
export const PENDING_RESOURCE_UPLOAD_TTL_MS = 15 * 60 * 1000;
/** Time allowed to write the bytes once the upload has been claimed. */
export const PENDING_RESOURCE_STORE_GRACE_MS = 10 * 60 * 1000;
/** How long an uploaded file stays bindable before cleanup deletes it. */
export const PENDING_RESOURCE_BIND_TTL_MS = 24 * 60 * 60 * 1000;
/** The PUT body is buffered like the legacy single-request upload route. */
export const PENDING_RESOURCE_MAX_BYTES = 100 * 1024 * 1024;
/** Unused upload credentials per workspace. */
export const PENDING_RESOURCE_OPEN_UPLOAD_LIMIT = 20;
/** Pending files (credentials and unbound uploads) per workspace. */
export const PENDING_RESOURCE_COUNT_LIMIT = 100;
/** Bytes reserved by pending files per workspace. */
export const PENDING_RESOURCE_BYTES_LIMIT = 1024 * 1024 * 1024;
/** Resource ids accepted by one create_memo or update_memo call. */
export const PENDING_RESOURCE_BIND_LIMIT = 20;
const CLEANUP_BATCH_SIZE = 25;
const TOKEN_PREFIX = "eeu_";
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^eeu_[A-Za-z0-9_-]{43}$/;

type PendingResourceRow = {
  id: string;
  workspace_id: string;
  state: "awaiting_upload" | "uploading" | "uploaded";
  kind: "image" | "attachment";
  mime_type: string;
  filename: string;
  byte_size: number;
  label: string | null;
  object_key: string;
  bucket_name: string | null;
  storage_config_id: string | null;
  sha256: string | null;
  metadata_json: string;
  actor_type: "user" | "agent";
  actor_id: string | null;
  api_token_id: string | null;
  session_id: string | null;
  claim_id: string | null;
  upload_expires_at: string;
  uploaded_at: string | null;
  expires_at: string;
};

const PENDING_COLUMNS = `id, workspace_id, state, kind, mime_type, filename, byte_size, label, object_key,
  bucket_name, storage_config_id, sha256, metadata_json, actor_type, actor_id, api_token_id, session_id,
  claim_id, upload_expires_at, uploaded_at, expires_at`;

export type PendingResourceUploadInput = {
  kind: "image" | "attachment";
  mimeType: string;
  filename?: string | null;
  byteSize: number;
  label?: string | null;
};

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const later = (from: number, ms: number) => new Date(from + ms).toISOString();
const resourceUrl = (id: string) => `/api/v1/resources/${id}/blob`;

const describeUploaded = (row: PendingResourceRow) => {
  const url = resourceUrl(row.id);
  const label = row.label ?? (normalizeFilename(row.filename) || row.kind);
  return {
    resourceId: row.id,
    url,
    kind: row.kind,
    mimeType: row.mime_type,
    filename: row.filename,
    byteSize: row.byte_size,
    sha256: row.sha256,
    state: "pending" as const,
    bindBefore: row.expires_at,
    ...(row.kind === "image"
      ? { markdownImage: `![${escapeMarkdownImageAlt(label)}](${url})` }
      : { markdownLink: `[${escapeMarkdownLinkLabel(label)}](${url})` }),
  };
};

/**
 * Deletes at most one batch of expired pending files, oldest first, using the
 * expires_at index. A row is removed before its bytes and only while it is
 * still expired, so a file bound in the meantime is never touched: binding
 * deletes the pending row in the same transaction that creates the resource.
 */
export const cleanupExpiredPendingResources = async (env: Bindings, now = isoNow()) => {
  const db = env.storage.db;
  const expired = await db.prepare(
    `SELECT id, object_key, storage_config_id, state FROM pending_resources
     WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?`,
  ).bind(now, CLEANUP_BATCH_SIZE).all<{ id: string; object_key: string; storage_config_id: string | null; state: string }>();
  let deleted = 0;
  for (const row of expired.results ?? []) {
    const removed = await db.prepare(
      "DELETE FROM pending_resources WHERE id = ? AND expires_at <= ?",
    ).bind(row.id, now).run();
    if (Number(removed.meta.changes) !== 1) continue;
    deleted += 1;
    // No bytes were ever written for a row that was never claimed.
    if (!row.storage_config_id) continue;
    const storage = await resolveObjectStorage(env, row.storage_config_id);
    await storage.store.delete(row.object_key).catch(() => undefined);
  }
  return deleted;
};

export const createPendingResourceUpload = async (
  context: AppContext,
  auth: AuthContext,
  input: PendingResourceUploadInput,
) => {
  const db = context.env.storage.db;
  if (input.kind !== "image" && input.kind !== "attachment") {
    throw new AppError("invalid_params", 'kind must be "image" or "attachment".', 400);
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new AppError("invalid_params", "byteSize must be a positive integer.", 400);
  }
  if (input.byteSize > PENDING_RESOURCE_MAX_BYTES) {
    throw new AppError(
      "upload_too_large",
      "Upload URLs accept files up to 100 MiB. Use the resumable multipart upload API for larger files.",
      413,
    );
  }

  const requestedFilename = normalizeFilename(input.filename ?? "");
  const mimeType = resolveResourceUploadMimeType(requestedFilename, input.mimeType);
  if (input.kind === "image") validateImageUpload(mimeType, input.byteSize);
  else validateAttachmentUpload(input.byteSize);
  const extension = input.kind === "image" ? inferImageExtension(requestedFilename, mimeType) : "";
  const filename = requestedFilename || (input.kind === "image" ? `image${extension}` : "attachment");

  await cleanupExpiredPendingResources(context.env);

  const id = createId("res");
  const token = `${TOKEN_PREFIX}${randomToken(TOKEN_BYTES)}`;
  const startedAt = Date.now();
  const now = new Date(startedAt).toISOString();
  const uploadExpiresAt = later(startedAt, PENDING_RESOURCE_UPLOAD_TTL_MS);
  const label = input.label?.trim() || null;
  const objectKey = `workspaces/${auth.workspaceId}/uploads/${id}${extension}`;

  // One statement checks every workspace limit and inserts, so concurrent
  // requests cannot each pass the check before any of them has inserted.
  const inserted = await db.prepare(
    `INSERT INTO pending_resources (
      id, workspace_id, token_hash, state, kind, mime_type, filename, byte_size, label, object_key,
      actor_type, actor_id, api_token_id, session_id, created_at, upload_expires_at, expires_at
    )
    SELECT ?, ?, ?, 'awaiting_upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM (
      SELECT COUNT(*) AS total_count,
             COALESCE(SUM(byte_size), 0) AS total_bytes,
             COALESCE(SUM(CASE WHEN state <> 'uploaded' THEN 1 ELSE 0 END), 0) AS open_count
      FROM pending_resources WHERE workspace_id = ? AND expires_at > ?
    ) AS usage
    WHERE usage.open_count < ? AND usage.total_count < ? AND usage.total_bytes + ? <= ?`,
  ).bind(
    id,
    auth.workspaceId,
    await sha256(token),
    input.kind,
    mimeType,
    filename,
    input.byteSize,
    label,
    objectKey,
    auth.actorType,
    auth.actorId,
    auth.tokenId ?? null,
    auth.sessionId ?? null,
    now,
    uploadExpiresAt,
    uploadExpiresAt,
    auth.workspaceId,
    now,
    PENDING_RESOURCE_OPEN_UPLOAD_LIMIT,
    PENDING_RESOURCE_COUNT_LIMIT,
    input.byteSize,
    PENDING_RESOURCE_BYTES_LIMIT,
  ).run();
  if (Number(inserted.meta.changes) !== 1) {
    throw new AppError(
      "pending_upload_limit",
      `This workspace has reached its pending upload limit (${PENDING_RESOURCE_OPEN_UPLOAD_LIMIT} unused upload URLs, `
        + `${PENDING_RESOURCE_COUNT_LIMIT} unbound files or 1 GiB). Bind or let pending files expire, then try again.`,
      429,
    );
  }
  // The audit trail records the pending resource, never the secret.
  await audit(db, auth.actorType, auth.actorId, "pending_resource.create", "resource", id, {
    workspaceId: auth.workspaceId,
    kind: input.kind,
    mimeType,
    byteSize: input.byteSize,
    expiresAt: uploadExpiresAt,
  });

  const uploadUrl = `${new URL(context.req.url).origin}${PENDING_RESOURCE_UPLOAD_PATH}`;
  return {
    uploadUrl,
    method: "PUT" as const,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
    expiresAt: uploadExpiresAt,
    kind: input.kind,
    mimeType,
    filename,
    byteSize: input.byteSize,
    curl: [
      "curl --fail-with-body -sS -T <path-to-file>",
      `-H ${shellQuote(`Authorization: Bearer ${token}`)}`,
      `-H ${shellQuote(`Content-Type: ${mimeType}`)}`,
      shellQuote(uploadUrl),
    ].join(" "),
  };
};

const invalidToken = () => new AppError("invalid_upload_token", "Upload token is invalid.", 401);
const tokenUsed = () => new AppError("upload_token_used", "This upload URL has already been used.", 410);
const tokenExpired = () => new AppError("upload_token_expired", "This upload URL has expired. Request a new one.", 410);
const sizeMismatch = (bytes: number) =>
  new AppError("upload_size_mismatch", `This upload URL accepts exactly ${bytes} bytes.`, 400);

const readUploadToken = (authorization: string | undefined) => {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
};

/**
 * SQL condition, on the pending row `p`, that holds while the credential that
 * created it is still valid and allowed to write resources. It is evaluated
 * inside the claiming UPDATE, so expiry and revocation are checked at the same
 * instant as the claim, after the body has been read.
 */
const CREDENTIAL_ACTIVE_SQL = `(
  (p.api_token_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM api_tokens t
    WHERE t.id = p.api_token_id AND t.workspace_id = p.workspace_id AND t.is_revoked = 0
      AND (t.expires_at IS NULL OR t.expires_at > ?3)
      AND EXISTS (SELECT 1 FROM json_each(t.scopes_json) WHERE json_each.value = 'write:resources')
  ))
  OR (p.api_token_id IS NULL AND p.session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM sessions s INNER JOIN users u ON u.id = s.user_id
    WHERE s.id = p.session_id AND s.revoked_at IS NULL AND s.expires_at > ?3 AND u.is_disabled = 0
  ))
  OR (p.api_token_id IS NULL AND p.session_id IS NULL)
)`;

/** Reads at most `limit` bytes and reports whether the body was longer. */
const readBoundedBody = async (body: ReadableStream<Uint8Array>, limit: number) => {
  const reader = body.getReader();
  const bytes = new Uint8Array(limit);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > limit) {
        await reader.cancel().catch(() => undefined);
        return { bytes, length: limit + 1 };
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes, length };
};

const contentTypeMatches = (header: string | undefined, row: PendingResourceRow) => {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  if (!type || type === "application/octet-stream") return true;
  return resolveResourceUploadMimeType(row.filename, type) === row.mime_type;
};

const readPendingByToken = (db: DatabaseAdapter, tokenHash: string) =>
  db.prepare(`SELECT ${PENDING_COLUMNS} FROM pending_resources WHERE token_hash = ?`)
    .bind(tokenHash).first<PendingResourceRow>();

const readPendingById = (db: DatabaseAdapter, id: string) =>
  db.prepare(`SELECT ${PENDING_COLUMNS} FROM pending_resources WHERE id = ?`)
    .bind(id).first<PendingResourceRow>();

/**
 * A retry of an upload that already succeeded (for example after a lost
 * response) returns the same pending resource instead of storing a second one.
 */
const replayUploaded = (row: PendingResourceRow, checksum: string) => {
  if (row.state !== "uploaded" || row.sha256 !== checksum || Date.parse(row.expires_at) <= Date.now()) {
    throw tokenUsed();
  }
  return { status: 200 as const, body: describeUploaded(row) };
};

const outcomeUnknown = () => new AppError(
  "upload_outcome_unknown",
  "The upload could not be confirmed. Send the same file to the same URL again to complete it.",
  503,
);

/**
 * True only when nothing can ever reference the object: the pending row is
 * gone (cleanup removed it) and no resource was created from it. A pending row
 * cannot come back and binding requires one, so the answer cannot change
 * afterwards. Any read failure answers false and the bytes are kept.
 */
const isObjectUnreferenced = async (db: DatabaseAdapter, id: string) => {
  try {
    const [pending, bound] = await Promise.all([
      db.prepare("SELECT id FROM pending_resources WHERE id = ?").bind(id).first<{ id: string }>(),
      db.prepare("SELECT id FROM resources WHERE id = ?").bind(id).first<{ id: string }>(),
    ]);
    return !pending && !bound;
  } catch {
    return false;
  }
};

export const consumePendingResourceUpload = async (
  context: AppContext,
  request: {
    authorization: string | undefined;
    contentType: string | undefined;
    contentLength: string | undefined;
    body: ReadableStream<Uint8Array> | null;
  },
) => {
  const db = context.env.storage.db;
  const token = readUploadToken(request.authorization);
  if (!token) throw invalidToken();
  const row = await readPendingByToken(db, await sha256(token));
  if (!row) throw invalidToken();
  if (row.state === "awaiting_upload" && Date.parse(row.upload_expires_at) <= Date.now()) throw tokenExpired();

  // Reject a mismatched request before reading or claiming anything, so the
  // client can retry the same URL with the right file.
  const declaredBytes = Number(request.contentLength);
  if (!request.body || !Number.isSafeInteger(declaredBytes) || declaredBytes <= 0) {
    throw new AppError("length_required", "Send the file with a Content-Length header.", 411);
  }
  if (declaredBytes !== row.byte_size) throw sizeMismatch(row.byte_size);
  if (!contentTypeMatches(request.contentType, row)) {
    throw new AppError("upload_type_mismatch", `This upload URL accepts ${row.mime_type} content only.`, 415);
  }

  const body = await readBoundedBody(request.body, row.byte_size);
  if (body.length !== row.byte_size) throw sizeMismatch(row.byte_size);
  const bytes = body.bytes;
  const checksum = await sha256Bytes(bytes);
  if (row.state === "uploaded") return replayUploaded(row, checksum);

  let claimId: string | null = null;
  let destination: Awaited<ReturnType<typeof resolveObjectStorage>>;
  if (row.state === "uploading") {
    // A claimed upload whose outcome was not confirmed. The claim recorded the
    // checksum, so only the same file can complete it, and writing identical
    // bytes again to the same key is harmless even if the first write is
    // still in flight.
    if (row.sha256 !== checksum || !row.storage_config_id) throw tokenUsed();
    destination = await resolveObjectStorage(context.env, row.storage_config_id);
  } else {
    // Claim with a fresh timestamp, after the body has been read: the upload
    // deadline and the creating credential are both checked by this statement.
    destination = await resolveObjectStorage(context.env);
    claimId = createId("claim");
    const claimedAt = Date.now();
    const claim = await db.prepare(
      `UPDATE pending_resources AS p
       SET state = 'uploading', claim_id = ?1, expires_at = ?2, bucket_name = ?5, storage_config_id = ?6, sha256 = ?7
       WHERE p.id = ?4 AND p.state = 'awaiting_upload' AND p.upload_expires_at > ?3
         AND ${CREDENTIAL_ACTIVE_SQL}`,
    ).bind(
      claimId,
      later(claimedAt, PENDING_RESOURCE_STORE_GRACE_MS),
      new Date(claimedAt).toISOString(),
      row.id,
      destination.bucketName,
      destination.configId,
      checksum,
    ).run();
    if (Number(claim.meta.changes) !== 1) {
      const current = await readPendingById(db, row.id);
      if (current?.state === "uploaded") return replayUploaded(current, checksum);
      if (current?.state === "uploading") throw tokenUsed();
      if (!current || Date.parse(current.upload_expires_at) <= claimedAt) throw tokenExpired();
      // Still awaiting and not expired: the creating credential was revoked.
      throw invalidToken();
    }
  }

  // Returns the URL to the client after a confirmed failure. It never deletes
  // bytes: the object key belongs to this pending row only, so a later upload
  // overwrites it and cleanup deletes it with the row.
  const release = async () => {
    if (!claimId) return;
    await db.prepare(
      `UPDATE pending_resources
       SET state = 'awaiting_upload', claim_id = NULL, sha256 = NULL, expires_at = upload_expires_at
       WHERE id = ? AND claim_id = ? AND state = 'uploading'`,
    ).bind(row.id, claimId).run().catch(() => undefined);
  };

  try {
    await destination.store.put(row.object_key, bytes, {
      httpMetadata: { contentType: row.mime_type, cacheControl: "private, max-age=3600" },
      customMetadata: { resourceId: row.id, filename: row.filename },
    });
  } catch (error) {
    // Nothing was committed: the URL stays usable until it expires.
    await release();
    throw error;
  }

  // The commit is the single persistence point. The resource id was fixed when
  // the URL was issued, so no path can produce a second resource for it.
  const prepared = row.kind === "image"
    ? prepareImageForStorage({ bytes, filename: row.filename, mimeType: row.mime_type, source: "mcp" })
    : null;
  const metadata = prepared?.metadata ?? { originalFilename: row.filename };
  const uploadedAt = Date.now();
  const bindBefore = later(uploadedAt, PENDING_RESOURCE_BIND_TTL_MS);
  const uploaded: PendingResourceRow = {
    ...row,
    state: "uploaded",
    sha256: checksum,
    claim_id: null,
    bucket_name: destination.bucketName,
    storage_config_id: destination.configId,
    metadata_json: JSON.stringify(metadata),
    uploaded_at: new Date(uploadedAt).toISOString(),
    expires_at: bindBefore,
  };
  let changes: number;
  try {
    const commit = await db.prepare(
      `UPDATE pending_resources
       SET state = 'uploaded', claim_id = NULL, metadata_json = ?, uploaded_at = ?, expires_at = ?
       WHERE id = ? AND state = 'uploading' AND sha256 = ?`,
    ).bind(uploaded.metadata_json, uploaded.uploaded_at, bindBefore, row.id, checksum).run();
    changes = Number(commit.meta.changes);
  } catch {
    // A failed response does not prove the write failed. Only a successful
    // read can settle the outcome; until then the bytes and the claim stay.
    let current: PendingResourceRow | null;
    try {
      current = await readPendingById(db, row.id);
    } catch {
      throw outcomeUnknown();
    }
    if (current?.state === "uploaded" && current.sha256 === checksum) {
      return { status: 201 as const, body: describeUploaded(current) };
    }
    if (current?.state === "uploading" && current.claim_id === claimId) {
      // Confirmed not committed (the commit is one statement).
      await release();
    }
    throw outcomeUnknown();
  }

  if (changes !== 1) {
    // Another request completed the same file, or cleanup removed the row.
    const current = await readPendingById(db, row.id).catch(() => null);
    if (current?.state === "uploaded" && current.sha256 === checksum) return replayUploaded(current, checksum);
    if (await isObjectUnreferenced(db, row.id)) {
      await destination.store.delete(row.object_key).catch(() => undefined);
      throw tokenExpired();
    }
    throw tokenUsed();
  }

  await audit(db, row.actor_type, row.actor_id, "pending_resource.upload", "resource", row.id, {
    workspaceId: row.workspace_id,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
  }).catch((error) => console.error("EdgeEver pending resource audit failed", error));
  return { status: 201 as const, body: describeUploaded(uploaded) };
};

/** Pending upload readable through the authenticated resource URL. */
export const getPendingResourceBlobRow = (db: DatabaseAdapter, workspaceId: string, id: string) =>
  db.prepare(
    `SELECT id, kind, mime_type, filename, byte_size, object_key, storage_config_id
     FROM pending_resources
     WHERE id = ? AND workspace_id = ? AND state = 'uploaded' AND expires_at > ?`,
  ).bind(id, workspaceId, isoNow()).first<{
    id: string;
    kind: "image" | "attachment";
    mime_type: string;
    filename: string;
    byte_size: number;
    object_key: string;
    storage_config_id: string;
  }>();

export const parseResourceIds = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new AppError("invalid_params", "resourceIds must be an array of resource id strings.", 400);
  }
  const ids = value.map((item: string) => item.trim());
  if (new Set(ids).size !== ids.length) {
    throw new AppError("invalid_params", "resourceIds must not contain duplicates.", 400);
  }
  if (ids.length > PENDING_RESOURCE_BIND_LIMIT) {
    throw new AppError("invalid_params", `resourceIds accepts at most ${PENDING_RESOURCE_BIND_LIMIT} ids.`, 400);
  }
  return ids;
};

/**
 * Checks that every id is an uploaded, unexpired pending file of the caller's
 * workspace, then returns statements that move them into `resources` for the
 * memo being created or updated. They run in the memo's own batch, so the memo
 * and its resources commit together or not at all; on failure the files stay
 * pending and can be bound by a retry.
 */
export const preparePendingResourceBinding = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  resourceIds: string[],
  actor: AuditActor,
): Promise<((memoId: string) => PreparedStatementAdapter[]) | null> => {
  if (!resourceIds.length) return null;
  if (!auth.scopes.includes("write:resources")) {
    throw new AppError("insufficient_scope", "Binding resources requires the write:resources scope.", 403);
  }
  const placeholders = resourceIds.map(() => "?").join(", ");
  const now = isoNow();
  const rows = await db.prepare(
    `SELECT id, state, expires_at FROM pending_resources
     WHERE workspace_id = ? AND id IN (${placeholders})`,
  ).bind(auth.workspaceId, ...resourceIds).all<{ id: string; state: string; expires_at: string }>();
  const byId = new Map((rows.results ?? []).map((row) => [row.id, row]));
  for (const id of resourceIds) {
    const row = byId.get(id);
    if (!row || row.expires_at <= now) {
      throw new AppError(
        "pending_resource_not_found",
        `Resource ${id} is not a pending upload of this workspace. It may have expired or already been bound.`,
        404,
      );
    }
    if (row.state !== "uploaded") {
      throw new AppError("pending_resource_not_uploaded", `Resource ${id} has not been uploaded yet.`, 409);
    }
  }

  return (memoId) => resourceIds.flatMap((id) => [
    // Exactly one row is always selected. If the pending file is gone, expired
    // or of another workspace, or the memo is not this workspace's, the NOT
    // NULL columns receive NULL and the whole batch rolls back. A file already
    // bound by a concurrent call fails on the primary key.
    db.prepare(
      `INSERT INTO resources (
        id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
        byte_size, sha256, width, height, metadata_json, created_at, updated_at
      )
      SELECT ?, m.id, p.bucket_name, p.object_key, p.storage_config_id, p.kind, p.mime_type, p.filename,
             p.byte_size, p.sha256, NULL, NULL, p.metadata_json, ?, ?
      FROM (SELECT 1) AS one
      LEFT JOIN pending_resources p
        ON p.id = ? AND p.workspace_id = ? AND p.state = 'uploaded' AND p.expires_at > ?
      LEFT JOIN memos m ON m.id = ? AND m.workspace_id = ? AND m.is_deleted = 0`,
    ).bind(id, now, now, id, auth.workspaceId, now, memoId, auth.workspaceId),
    db.prepare("DELETE FROM pending_resources WHERE id = ? AND workspace_id = ?").bind(id, auth.workspaceId),
    auditStatement(db, actor.actorType, actor.actorId, "resource.bind", "resource", id, { memoId }),
  ]);
};
