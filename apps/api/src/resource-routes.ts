import { isPdfAttachment, ResourceUpdateSchema, type MemoDetail, type Resource } from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { auditStatement } from "./audit";
import type { AppContext, AppEnv, AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { parseByteRange, rangeNotSatisfiable } from "./byte-range";
import { isoNow } from "./entity-utils";
import { apiError, badRequest, notFound } from "./http-errors";
import { resolveObjectStorage } from "./object-storage";
import {
  SUPPORTED_IMAGE_MIME_TYPES,
  contentDispositionAttachment,
  contentDispositionInline,
  mapResource,
  mapResourceListItem,
  mapResourceStorageSummary,
  normalizeFilename,
  type ResourceListRow,
  type ResourceRow,
  type ResourceStatsRow,
} from "./resource-service";
import type { initiateResourceUpload as initiateResourceUploadService } from "./resource-upload-service";
import { getAuditActor, getWorkspaceId, requireScopes } from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";

type ResourceRouteDependencies = {
  clampNumber: (value: number, min: number, max: number) => number;
  createAttachmentResource: (context: AppContext, input: {
    memoId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    actor: AuditActor;
  }) => Promise<Resource>;
  createImageResource: (context: AppContext, input: {
    memoId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    actor: AuditActor;
    source: "upload" | "mcp";
  }) => Promise<Resource>;
  getMemoDetail: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
  ) => Promise<MemoDetail | null>;
  getResourceRow: (
    database: DatabaseAdapter,
    workspaceId: string,
    resourceId: string,
    includeDeleted?: boolean,
  ) => Promise<ResourceRow | null>;
  initiateResourceUpload: typeof initiateResourceUploadService;
  uploadResourcePart: (
    context: AppContext,
    uploadId: string,
    partNumber: number,
    body: ReadableStream<Uint8Array>,
    byteSize: number,
  ) => Promise<{ partNumber: number; byteSize: number }>;
  completeResourceUpload: (
    context: AppContext,
    uploadId: string,
    actor: AuditActor,
  ) => Promise<Resource>;
  abortResourceUpload: (context: AppContext, uploadId: string) => Promise<void>;
};

const MAX_LEGACY_RESOURCE_UPLOAD_BYTES = 100 * 1024 * 1024;

const appErrorResponse = (context: AppContext, error: unknown) => {
  if (error instanceof AppError) {
    return apiError(context, error.code, error.message, error.status);
  }
  throw error;
};

export const registerResourceRoutes = (
  app: Hono<AppEnv>,
  dependencies: ResourceRouteDependencies,
) => {
  app.get("/api/v1/resources", async (context) => {
    const denied = requireScopes(context, "read:resources");
    if (denied) return denied;

    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 500), 1, 500);
    const workspaceId = getWorkspaceId(context);
    const [rows, stats] = await Promise.all([
      context.env.storage.db.prepare(
        `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind,
                r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height,
                r.created_at, r.updated_at, m.title AS memo_title, m.excerpt AS memo_excerpt,
                m.is_deleted AS memo_is_deleted
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0
         ORDER BY r.created_at DESC
         LIMIT ?`,
      ).bind(workspaceId, limit).all<ResourceListRow>(),
      context.env.storage.db.prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE m.workspace_id = ? AND r.is_deleted = 0`,
      ).bind(workspaceId).first<ResourceStatsRow>(),
    ]);

    return context.json({
      resources: rows.results.map(mapResourceListItem),
      summary: mapResourceStorageSummary(stats),
    });
  });

  app.post("/api/v1/memos/:id/resources", async (context) => {
    const denied = requireScopes(context, "write:resources");
    if (denied) return denied;

    const declaredRequestBytes = Number(context.req.header("Content-Length"));
    if (
      Number.isFinite(declaredRequestBytes)
      && declaredRequestBytes > MAX_LEGACY_RESOURCE_UPLOAD_BYTES + 1024 * 1024
    ) {
      return apiError(
        context,
        "multipart_upload_required",
        "Files larger than 100 MiB must use the resumable multipart upload API.",
        413,
      );
    }

    const memoId = context.req.param("id");
    const memo = await dependencies.getMemoDetail(
      context.env.storage.db,
      getWorkspaceId(context),
      memoId,
    );
    if (!memo) return notFound(context, "Memo not found");

    const form = await context.req.raw.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return badRequest(context, "Expected multipart form field named file.");
    }
    if (file.size > MAX_LEGACY_RESOURCE_UPLOAD_BYTES) {
      return apiError(
        context,
        "multipart_upload_required",
        "Files larger than 100 MiB must use the resumable multipart upload API.",
        413,
      );
    }

    const input = {
      memoId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor: getAuditActor(context),
    };
    let resource: Resource;
    try {
      resource = SUPPORTED_IMAGE_MIME_TYPES.has(input.mimeType)
        ? await dependencies.createImageResource(context, { ...input, source: "upload" })
        : await dependencies.createAttachmentResource(context, input);
    } catch (error) {
      return appErrorResponse(context, error);
    }

    return context.json({ resource }, 201);
  });

  app.post("/api/v1/memos/:id/resource-uploads", async (context) => {
    const denied = requireScopes(context, "write:resources");
    if (denied) return denied;

    const memoId = context.req.param("id");
    const memo = await dependencies.getMemoDetail(
      context.env.storage.db,
      getWorkspaceId(context),
      memoId,
    );
    if (!memo) return notFound(context, "Memo not found");

    const payload = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const filename = typeof payload?.filename === "string" ? payload.filename : "";
    const mimeType = typeof payload?.mimeType === "string" && payload.mimeType.trim()
      ? payload.mimeType.trim()
      : "application/octet-stream";
    const byteSize = Number(payload?.byteSize);
    if (!filename.trim() || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
      return badRequest(context, "filename and a positive integer byteSize are required.");
    }

    try {
      const upload = await dependencies.initiateResourceUpload(context, {
        memoId,
        filename,
        mimeType,
        byteSize,
      });
      return context.json({ upload }, 201);
    } catch (error) {
      return appErrorResponse(context, error);
    }
  });

  app.put("/api/v1/resource-uploads/:id/parts/:partNumber", async (context) => {
    const denied = requireScopes(context, "write:resources");
    if (denied) return denied;

    const body = context.req.raw.body;
    const byteSize = Number(context.req.header("Content-Length"));
    if (!body || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
      return apiError(
        context,
        "invalid_upload_part",
        "Multipart upload parts require a positive Content-Length header.",
        411,
      );
    }
    try {
      const part = await dependencies.uploadResourcePart(
        context,
        context.req.param("id"),
        Number(context.req.param("partNumber")),
        body,
        byteSize,
      );
      return context.json({ part });
    } catch (error) {
      return appErrorResponse(context, error);
    }
  });

  app.post("/api/v1/resource-uploads/:id/complete", async (context) => {
    const denied = requireScopes(context, "write:resources");
    if (denied) return denied;
    try {
      const resource = await dependencies.completeResourceUpload(
        context,
        context.req.param("id"),
        getAuditActor(context),
      );
      return context.json({ resource }, 201);
    } catch (error) {
      return appErrorResponse(context, error);
    }
  });

  app.delete("/api/v1/resource-uploads/:id", async (context) => {
    const denied = requireScopes(context, "write:resources");
    if (denied) return denied;
    try {
      await dependencies.abortResourceUpload(context, context.req.param("id"));
      return context.json({ ok: true });
    } catch (error) {
      return appErrorResponse(context, error);
    }
  });

  app.get("/api/v1/resources/:id/blob", async (context) => {
    const denied = requireScopes(context, "read:resources");
    if (denied) return denied;

    const resource = await dependencies.getResourceRow(
      context.env.storage.db,
      getWorkspaceId(context),
      context.req.param("id"),
    );
    if (!resource) return notFound(context, "Resource not found");

    const byteRange = parseByteRange(context.req.header("Range"), resource.byte_size);
    if (byteRange.kind === "invalid") return rangeNotSatisfiable(resource.byte_size);

    const source = await resolveObjectStorage(context.env, resource.storage_config_id);
    const object = await source.store.get(
      resource.object_key,
      byteRange.kind === "range" ? { range: byteRange.range } : undefined,
    );
    if (!object) return notFound(context, "Resource object not found");

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set(
      "Content-Type",
      isPdfAttachment(resource.mime_type, resource.filename)
        ? "application/pdf"
        : resource.mime_type ?? headers.get("Content-Type") ?? "application/octet-stream",
    );
    headers.set("Cache-Control", headers.get("Cache-Control") ?? "private, max-age=3600");
    headers.set("Accept-Ranges", "bytes");
    if (byteRange.kind === "range") {
      const length = object.range?.length ?? byteRange.range.length;
      headers.set("Content-Length", String(length));
      headers.set(
        "Content-Range",
        `bytes ${byteRange.range.offset}-${byteRange.range.offset + length - 1}/${resource.byte_size}`,
      );
    } else {
      headers.set("Content-Length", String(resource.byte_size));
    }
    headers.set(
      "Content-Disposition",
      resource.kind === "image" || isPdfAttachment(resource.mime_type, resource.filename)
        ? contentDispositionInline(resource.filename)
        : contentDispositionAttachment(resource.filename),
    );
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers, status: byteRange.kind === "range" ? 206 : 200 });
  });

  app.patch(
    "/api/v1/resources/:id",
    zValidator("json", ResourceUpdateSchema),
    async (context) => {
      const denied = requireScopes(context, "write:resources");
      if (denied) return denied;

      const resourceId = context.req.param("id");
      const workspaceId = getWorkspaceId(context);
      const resource = await dependencies.getResourceRow(
        context.env.storage.db,
        workspaceId,
        resourceId,
      );
      if (!resource) return notFound(context, "Resource not found");

      const filename = normalizeFilename(context.req.valid("json").filename);
      if (!filename) return badRequest(context, "Resource filename is required.");

      const now = isoNow();
      const actor = getAuditActor(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `UPDATE resources SET filename = ?, updated_at = ? WHERE id = ?`,
        ).bind(filename, now, resourceId),
        auditStatement(context.env.storage.db, actor.actorType, actor.actorId, "resource.rename", "resource", resourceId, {
          memoId: resource.memo_id,
          previousFilename: resource.filename,
          filename,
        }),
      ]);

      const updated = await dependencies.getResourceRow(
        context.env.storage.db,
        workspaceId,
        resourceId,
      );
      if (!updated) return notFound(context, "Resource not found");
      return context.json({ resource: mapResource(updated) });
    },
  );

  app.delete("/api/v1/resources/:id", async (context) => {
    const denied = requireScopes(context, "write:resources");
    if (denied) return denied;

    const resourceId = context.req.param("id");
    const resource = await dependencies.getResourceRow(
      context.env.storage.db,
      getWorkspaceId(context),
      resourceId,
      true,
    );
    if (!resource) return notFound(context, "Resource not found");

    const source = await resolveObjectStorage(context.env, resource.storage_config_id);
    await source.store.delete(resource.object_key);

    if (!resource.is_deleted) {
      const now = isoNow();
      const actor = getAuditActor(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `UPDATE resources SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?`,
        ).bind(now, now, resourceId),
        auditStatement(context.env.storage.db, actor.actorType, actor.actorId, "resource.delete", "resource", resourceId, {
          memoId: resource.memo_id,
          filename: resource.filename,
          byteSize: resource.byte_size,
        }),
      ]);
    }
    return context.json({ ok: true });
  });
};
