import { resolveResourceUploadMimeType, type Resource } from "@edgeever/shared";
import { audit } from "./audit";
import type { AppContext, AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { randomToken } from "./auth-crypto";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { escapeMarkdownImageAlt, escapeMarkdownLinkLabel } from "./mcp-json-rpc";
import { getMemoDetail } from "./memo-service";
import {
  createAttachmentResource,
  createImageResource,
  inferImageExtension,
  normalizeFilename,
  validateAttachmentUpload,
  validateImageUpload,
} from "./resource-service";

/**
 * Single-use upload URLs let an MCP agent send a local file with a plain HTTP
 * PUT instead of embedding it as base64 in a tool call. The URL carries no
 * credential: the secret travels in the Authorization header of the PUT and is
 * only stored as a SHA-256 hash.
 */
export const RESOURCE_UPLOAD_TICKET_PATH = "/api/public/resource-uploads";
export const RESOURCE_UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000;
/** The PUT body is buffered like the legacy single-request upload route. */
export const RESOURCE_UPLOAD_TICKET_MAX_BYTES = 100 * 1024 * 1024;
export const RESOURCE_UPLOAD_TICKET_ACTIVE_LIMIT = 20;
const TOKEN_PREFIX = "eeu_";
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^eeu_[A-Za-z0-9_-]{43}$/;

type ResourceUploadTicketRow = {
  id: string;
  workspace_id: string;
  memo_id: string;
  kind: "image" | "attachment";
  mime_type: string;
  filename: string;
  byte_size: number;
  label: string | null;
  actor_type: "user" | "agent";
  actor_id: string | null;
  api_token_id: string | null;
  session_id: string | null;
  expires_at: string;
  used_at: string | null;
};

export type ResourceUploadTicketInput = {
  memoId: string;
  kind: "image" | "attachment";
  mimeType: string;
  filename?: string | null;
  byteSize: number;
  label?: string | null;
};

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const markdownFor = (resource: Resource, kind: "image" | "attachment", label: string) => kind === "image"
  ? { markdownImage: `![${escapeMarkdownImageAlt(label)}](${resource.url})` }
  : { markdownLink: `[${escapeMarkdownLinkLabel(label)}](${resource.url})` };

export const createResourceUploadTicket = async (
  context: AppContext,
  auth: AuthContext,
  input: ResourceUploadTicketInput,
) => {
  const db = context.env.storage.db;
  if (input.kind !== "image" && input.kind !== "attachment") {
    throw new AppError("invalid_params", 'kind must be "image" or "attachment".', 400);
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new AppError("invalid_params", "byteSize must be a positive integer.", 400);
  }
  if (input.byteSize > RESOURCE_UPLOAD_TICKET_MAX_BYTES) {
    throw new AppError(
      "upload_too_large",
      "Upload URLs accept files up to 100 MiB. Use the resumable multipart upload API for larger files.",
      413,
    );
  }

  const memo = await getMemoDetail(db, auth.workspaceId, input.memoId);
  if (!memo) throw new AppError("not_found", "Memo not found", 404);

  const requestedFilename = normalizeFilename(input.filename ?? "");
  const mimeType = resolveResourceUploadMimeType(requestedFilename, input.mimeType);
  if (input.kind === "image") validateImageUpload(mimeType, input.byteSize);
  else validateAttachmentUpload(input.byteSize);
  const filename = requestedFilename
    || (input.kind === "image" ? `image${inferImageExtension("", mimeType)}` : "attachment");

  const now = isoNow();
  // Used and expired tickets are never valid again; drop them so the table
  // stays bounded by the active limit below.
  await db.prepare(
    `DELETE FROM resource_upload_tickets
     WHERE workspace_id = ? AND (used_at IS NOT NULL OR expires_at <= ?)`,
  ).bind(auth.workspaceId, now).run();
  const active = await db.prepare(
    "SELECT COUNT(*) AS count FROM resource_upload_tickets WHERE workspace_id = ?",
  ).bind(auth.workspaceId).first<{ count: number }>();
  if ((active?.count ?? 0) >= RESOURCE_UPLOAD_TICKET_ACTIVE_LIMIT) {
    throw new AppError(
      "upload_ticket_limit",
      "Too many unused upload URLs. Use or let the existing ones expire, then try again.",
      429,
    );
  }

  const ticketId = createId("uplt");
  const token = `${TOKEN_PREFIX}${randomToken(TOKEN_BYTES)}`;
  const expiresAt = new Date(Date.now() + RESOURCE_UPLOAD_TICKET_TTL_MS).toISOString();
  const label = input.label?.trim() || null;

  await db.prepare(
    `INSERT INTO resource_upload_tickets (
      id, workspace_id, memo_id, token_hash, kind, mime_type, filename, byte_size, label,
      actor_type, actor_id, api_token_id, session_id, created_at, expires_at, used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(
    ticketId,
    auth.workspaceId,
    input.memoId,
    await sha256(token),
    input.kind,
    mimeType,
    filename,
    input.byteSize,
    label,
    auth.actorType,
    auth.actorId,
    auth.tokenId ?? null,
    auth.sessionId ?? null,
    now,
    expiresAt,
  ).run();
  // The audit trail records the ticket, never the secret.
  await audit(db, auth.actorType, auth.actorId, "resource_upload_ticket.create", "memo", input.memoId, {
    ticketId,
    kind: input.kind,
    mimeType,
    byteSize: input.byteSize,
    expiresAt,
  });

  const uploadUrl = `${new URL(context.req.url).origin}${RESOURCE_UPLOAD_TICKET_PATH}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": mimeType };
  return {
    uploadUrl,
    method: "PUT" as const,
    headers,
    expiresAt,
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

const invalidTicket = () => new AppError("invalid_upload_token", "Upload token is invalid.", 401);

const readTicketToken = (authorization: string | undefined) => {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
};

/** The credential that created the URL must still be valid and allowed to write resources. */
const isTicketCredentialActive = async (context: AppContext, ticket: ResourceUploadTicketRow, now: string) => {
  const db = context.env.storage.db;
  if (ticket.api_token_id) {
    const token = await db.prepare(
      `SELECT scopes_json FROM api_tokens
       WHERE id = ? AND workspace_id = ? AND is_revoked = 0 AND (expires_at IS NULL OR expires_at > ?)`,
    ).bind(ticket.api_token_id, ticket.workspace_id, now).first<{ scopes_json: string }>();
    return Boolean(token && parseJsonArray(token.scopes_json).includes("write:resources"));
  }
  if (ticket.session_id) {
    const session = await db.prepare(
      `SELECT s.id FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_disabled = 0`,
    ).bind(ticket.session_id, now).first<{ id: string }>();
    return Boolean(session);
  }
  // Instances running without authentication have no credential to recheck.
  return true;
};

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

const contentTypeMatches = (header: string | undefined, ticket: ResourceUploadTicketRow) => {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  if (!type || type === "application/octet-stream") return true;
  return resolveResourceUploadMimeType(ticket.filename, type) === ticket.mime_type;
};

export const consumeResourceUploadTicket = async (
  context: AppContext,
  request: {
    authorization: string | undefined;
    contentType: string | undefined;
    contentLength: string | undefined;
    body: ReadableStream<Uint8Array> | null;
  },
) => {
  const db = context.env.storage.db;
  const token = readTicketToken(request.authorization);
  if (!token) throw invalidTicket();
  const ticket = await db.prepare(
    `SELECT id, workspace_id, memo_id, kind, mime_type, filename, byte_size, label,
            actor_type, actor_id, api_token_id, session_id, expires_at, used_at
     FROM resource_upload_tickets WHERE token_hash = ?`,
  ).bind(await sha256(token)).first<ResourceUploadTicketRow>();
  if (!ticket) throw invalidTicket();
  if (ticket.used_at) throw new AppError("upload_token_used", "This upload URL has already been used.", 410);
  const now = isoNow();
  if (Date.parse(ticket.expires_at) <= Date.now()) {
    throw new AppError("upload_token_expired", "This upload URL has expired. Request a new one.", 410);
  }

  // Reject a mismatched request before reading or consuming anything, so the
  // agent can retry the same URL with the right file.
  const declaredBytes = Number(request.contentLength);
  if (!request.body || !Number.isSafeInteger(declaredBytes) || declaredBytes <= 0) {
    throw new AppError("length_required", "Send the file with a Content-Length header.", 411);
  }
  if (declaredBytes !== ticket.byte_size) {
    throw new AppError(
      "upload_size_mismatch",
      `This upload URL accepts exactly ${ticket.byte_size} bytes.`,
      400,
    );
  }
  if (!contentTypeMatches(request.contentType, ticket)) {
    throw new AppError(
      "upload_type_mismatch",
      `This upload URL accepts ${ticket.mime_type} content only.`,
      415,
    );
  }
  if (!(await isTicketCredentialActive(context, ticket, now))) throw invalidTicket();

  const body = await readBoundedBody(request.body, ticket.byte_size);
  if (body.length !== ticket.byte_size) {
    throw new AppError(
      "upload_size_mismatch",
      `This upload URL accepts exactly ${ticket.byte_size} bytes.`,
      400,
    );
  }

  // Claim atomically: of concurrent requests with the same token, one wins.
  const claim = await db.prepare(
    `UPDATE resource_upload_tickets SET used_at = ?
     WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
  ).bind(now, ticket.id, now).run();
  if (Number(claim.meta.changes) !== 1) {
    throw new AppError("upload_token_used", "This upload URL has already been used.", 410);
  }

  try {
    const memo = await getMemoDetail(db, ticket.workspace_id, ticket.memo_id);
    if (!memo) throw new AppError("not_found", "Memo not found", 404);
    const input = {
      // Like public table forms, the request has no signed-in user: the
      // workspace and actor come from the ticket.
      workspaceId: ticket.workspace_id,
      memoId: ticket.memo_id,
      filename: ticket.filename,
      mimeType: ticket.mime_type,
      bytes: body.bytes,
      actor: { actorType: ticket.actor_type, actorId: ticket.actor_id },
    };
    const resource = ticket.kind === "image"
      ? await createImageResource(context, { ...input, source: "mcp" })
      : await createAttachmentResource(context, input);
    const label = ticket.label ?? (normalizeFilename(ticket.filename) || ticket.kind);
    return { resource, ...markdownFor(resource, ticket.kind, label) };
  } catch (error) {
    // Nothing was stored, so the URL stays usable until it expires.
    await db.prepare("UPDATE resource_upload_tickets SET used_at = NULL WHERE id = ?")
      .bind(ticket.id).run().catch(() => undefined);
    throw error;
  }
};
