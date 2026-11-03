import { createExcerpt, docToText, emptyDoc, type MemoDetail, type TiptapDoc } from "@edgeever/shared";
import { auditStatement } from "./audit";
import type { AppContext, AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { getMemoDetail, getMemoDetailRow } from "./memo-service";
import { upsertMemoSearchDocumentStatement } from "./memo-search-index";
import { notebookExists } from "./notebook-service";
import { resolveObjectStorage } from "./object-storage";
import { inferImageExtension } from "./resource-service";
import { getWorkspaceId } from "./request-auth";

/**
 * Upper bounds for the files copied with one duplicated note. Each file is
 * read into memory before it is written under its new key, and each costs a
 * read and a write against object storage, so these keep one copy within the
 * memory and subrequest limits of a Cloudflare Worker, including external S3
 * storage on the Workers Free plan.
 */
export const MAX_DUPLICATE_RESOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_DUPLICATE_RESOURCE_COUNT = 20;

const COPYABLE_RESOURCE_ID = /^[A-Za-z0-9_-]{8,}$/;

type DuplicateResourceRow = {
  id: string;
  object_key: string;
  storage_config_id: string;
  kind: "image" | "attachment";
  mime_type: string | null;
  filename: string | null;
  byte_size: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  metadata_json: string;
};

const parseDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as TiptapDoc) : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

// Replaces whole resource ids only, so an id that is a prefix of another id,
// or ordinary text that contains an id, is never rewritten.
const replaceResourceIds = (value: string, replacements: ReadonlyMap<string, string>) => {
  if (replacements.size === 0) return value;
  const ids = [...replacements.keys()].sort((left, right) => right.length - left.length);
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(?:${ids.join("|")})(?![A-Za-z0-9_-])`, "g");
  return value.replace(pattern, (id) => replacements.get(id) ?? id);
};

// Public table-form uploads stay pending until the form is submitted; the
// copy must not keep them or their link to the source note's form.
const copiedMetadataJson = (value: string) => {
  try {
    const metadata = JSON.parse(value);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "{}";
    const { tableFormId: _tableFormId, pending: _pending, ...rest } = metadata as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return "{}";
  }
};

/**
 * Creates a new note with the source note's title, content, and tags in the
 * same or another notebook. Its images and attachments are copied to new
 * resources with their own stored objects, and the content is rewritten to
 * reference the copies, so editing or deleting either note never affects the
 * other. Shares, revisions, public forms and the pinned state are not copied.
 */
export const duplicateMemoRecord = async (
  context: AppContext,
  memoId: string,
  input: { notebookId?: string; title?: string },
  actor: AuditActor,
  actorLabel: string,
): Promise<MemoDetail> => {
  const db = context.env.storage.db;
  const workspaceId = getWorkspaceId(context);
  const source = await getMemoDetailRow(db, workspaceId, memoId);
  if (!source) throw new AppError("not_found", "Memo not found", 404);

  const notebookId = input.notebookId ?? source.notebook_id;
  if (!(await notebookExists(db, workspaceId, notebookId))) {
    throw new AppError("not_found", "Notebook not found", 404);
  }

  const resources = (await db.prepare(
    `SELECT id, object_key, storage_config_id, kind, mime_type, filename, byte_size, sha256, width, height, metadata_json
     FROM resources
     WHERE memo_id = ? AND is_deleted = 0
       AND COALESCE(json_extract(metadata_json, '$.pending'), 0) <> 1
     ORDER BY created_at ASC, id ASC`,
  ).bind(memoId).all<DuplicateResourceRow>()).results;
  const totalBytes = resources.reduce((sum, resource) => sum + resource.byte_size, 0);
  if (totalBytes > MAX_DUPLICATE_RESOURCE_BYTES || resources.length > MAX_DUPLICATE_RESOURCE_COUNT) {
    throw new AppError(
      "duplicate_too_large",
      "The note has too many or too large files to duplicate. Duplicate notes with at most 20 files totaling at most 64 MiB.",
      413,
    );
  }
  if (resources.some((resource) => !COPYABLE_RESOURCE_ID.test(resource.id))) {
    throw new AppError("duplicate_unsupported", "This note references files that cannot be duplicated.", 409);
  }

  const newMemoId = createId("memo");
  const now = isoNow();
  const destination = await resolveObjectStorage(context.env);
  const copies: (DuplicateResourceRow & { newId: string; newObjectKey: string })[] = [];
  const writtenKeys: string[] = [];
  const deleteWrittenObjects = async () => {
    if (!writtenKeys.length) return;
    try {
      await destination.store.delete(writtenKeys);
    } catch (error) {
      console.error("Failed to remove the files of an unfinished note duplicate.", { objectKeys: writtenKeys, error });
    }
  };

  let copiedBytes = 0;
  try {
    for (const resource of resources) {
      const origin = await resolveObjectStorage(context.env, resource.storage_config_id);
      const object = await origin.store.get(resource.object_key);
      if (!object) {
        throw new AppError("duplicate_resource_missing", "A file of this note is missing from storage.", 409);
      }
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
      // Older rows may record no size, so the limit is also checked on the bytes read.
      copiedBytes += bytes.byteLength;
      if (copiedBytes > MAX_DUPLICATE_RESOURCE_BYTES) {
        throw new AppError(
          "duplicate_too_large",
          "The note has too many or too large files to duplicate. Duplicate notes with at most 20 files totaling at most 64 MiB.",
          413,
        );
      }
      const newId = createId("res");
      const extension = resource.kind === "image"
        ? inferImageExtension(resource.filename ?? "", resource.mime_type ?? "")
        : "";
      const newObjectKey = `workspaces/${workspaceId}/memos/${newMemoId}/${newId}${extension}`;
      await destination.store.put(newObjectKey, bytes, {
        httpMetadata: {
          contentType: resource.mime_type ?? "application/octet-stream",
          cacheControl: "private, max-age=3600",
        },
        customMetadata: { memoId: newMemoId, resourceId: newId, filename: resource.filename ?? newId },
      });
      writtenKeys.push(newObjectKey);
      copies.push({ ...resource, newId, newObjectKey });
    }

    const idReplacements = new Map(copies.map((copy) => [copy.id, copy.newId]));
    const contentMarkdown = replaceResourceIds(source.content_markdown, idReplacements);
    const contentJson = parseDoc(replaceResourceIds(source.content_json, idReplacements));
    const contentText = docToText(contentJson);
    const title = input.title?.trim() || source.title;
    const tags = parseJsonArray(source.tags_json);
    const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));

    await db.batch([
      db.prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
        ) SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ? FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0`,
      ).bind(
        newMemoId,
        workspaceId,
        title,
        createExcerpt(contentText),
        JSON.stringify(tags),
        actorLabel,
        actorLabel,
        now,
        now,
        notebookId,
        workspaceId,
      ),
      db.prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      ).bind(newMemoId, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, now, now),
      upsertMemoSearchDocumentStatement(db, newMemoId, title, contentText, tags.join(" ")),
      ...copies.map((copy) => db.prepare(
        `INSERT INTO resources (
          id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        copy.newId,
        newMemoId,
        destination.bucketName,
        copy.newObjectKey,
        destination.configId,
        copy.kind,
        copy.mime_type,
        copy.filename,
        copy.byte_size,
        copy.sha256,
        copy.width,
        copy.height,
        copiedMetadataJson(copy.metadata_json),
        now,
        now,
      )),
      auditStatement(db, actor.actorType, actor.actorId, "memo.duplicate", "memo", newMemoId, {
        sourceMemoId: memoId,
        notebookId,
        resourceCount: copies.length,
      }),
    ]);
  } catch (error) {
    // Nothing references the copied objects until the batch commits.
    await deleteWrittenObjects();
    throw error;
  }

  // From here on the committed rows reference the copied objects, so a failed
  // read must never remove them.
  const memo = await getMemoDetail(db, workspaceId, newMemoId);
  if (memo) return memo;
  // The notebook was removed between the check and the write, so the memo
  // row was not inserted. Remove the rows written for it first, then the
  // objects they referenced.
  await db.batch([
    db.prepare(`DELETE FROM resources WHERE memo_id = ?`).bind(newMemoId),
    db.prepare(`DELETE FROM memo_search_documents WHERE memo_id = ?`).bind(newMemoId),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id = ?`).bind(newMemoId),
  ]);
  await deleteWrittenObjects();
  throw new AppError("not_found", "Notebook not found", 404);
};
