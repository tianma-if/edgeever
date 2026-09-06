import {
  AiPromptTemplateCreateSchema,
  AiPromptTemplateUpdateSchema,
  TemplateCreateSchema,
  TemplateUpdateSchema,
  markdownToDoc,
  type MemoDetail,
  type MemoSummary,
  type MemoUpdateInput,
} from "@edgeever/shared";
import { audit, auditStatement } from "./audit";
import type { AppContext, AuditActor, AuthContext, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { isDemoModeEnabled } from "./demo-mode";
import { createId, isoNow } from "./entity-utils";
import {
  decodeBase64Data,
  escapeMarkdownImageAlt,
  escapeMarkdownLinkLabel,
  getOptionalString,
  getOptionalStringArray,
  getRequiredString,
  getRequiredStringArray,
} from "./mcp-json-rpc";
import {
    getMemoRevisionRow as getMemoRevisionRowService,
    listMemoRevisions as listMemoRevisionsService,
    mapMemoRevision as mapMemoRevisionService,
    restoreMemoRevision as restoreMemoRevisionService,
  type MemoRevisionSourceRow,
} from "./memo-revision-service";
import {
  createNotebookRecord,
  findNotebooks,
  getNotebook,
  listNotebooks,
  resolveNotebookPath,
  updateNotebookRecord,
} from "./notebook-service";
import {
    createAttachmentResource,
    createImageResource,
    inferImageExtension,
    listResourcesForMcp,
    listResourcesForMemo,
    normalizeFilename,
  } from "./resource-service";
import { assertScope, getActorLabel, getAuditActor } from "./request-auth";
import { restoreMissingDefaultAiPrompts } from "./ai-prompt-seed";
import {
  getAiPromptTemplateRow,
  listAiPromptTemplates,
  mapAiPromptTemplateRow,
} from "./ai-prompt-service";
import { getMemoTemplate, listMemoTemplates } from "./template-routes";
import {
  listTagSummaries,
  previewTagRename,
  updateTagAcrossMemos,
  updateTagsForMemos,
} from "./tag-service";
  import type { DatabaseAdapter } from "./storage-contract";
  import { getWorkspaceStats } from "./workspace-stats-service";

type MemoUpdateResult =
  | { memo: MemoDetail; error?: never; message?: never; status?: never; details?: never }
  | { error: string; message: string; status?: number; details?: Record<string, unknown> };

export type McpToolDependencies = {
  clampNumber: (value: number, min: number, max: number) => number;
  createMemoRecord: (
    database: DatabaseAdapter,
    workspaceId: string,
    input: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[]; createdAt?: string; updatedAt?: string },
    actor: AuditActor,
    actorLabel: string,
  ) => Promise<MemoDetail>;
  deleteMemosRecord: (
    environment: Bindings,
    workspaceId: string,
    memoIds: string[],
    permanent: boolean,
    actor: AuditActor,
  ) => Promise<number>;
  getCurrentWorkspaceIdentity: (database: DatabaseAdapter, auth: AuthContext) => Promise<unknown>;
  getMemoDetail: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    includeDeleted?: boolean,
  ) => Promise<MemoDetail | null>;
  getMemoDetailRow: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
  ) => Promise<MemoRevisionSourceRow | null>;
  getMemosForBulkAction: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoIds: string[],
    deletedState: 0 | 1,
  ) => Promise<unknown[]>;
  importMemosRecord: (
    database: DatabaseAdapter,
    workspaceId: string,
    input: {
      source: string;
      notebookId: string;
      items: unknown;
      dryRun: boolean;
      actor: AuditActor;
      actorLabel: string;
    },
  ) => Promise<unknown>;
  listMemosForMcp: (
    database: DatabaseAdapter,
    options: {
      workspaceId: string;
      notebookId?: string | null;
      limit: number;
      offset: number;
      includeContent: boolean;
      includeDeleted: boolean;
    },
  ) => Promise<unknown>;
  mergeMemosRecord: (
    database: DatabaseAdapter,
    workspaceId: string,
    input: { memoIds: string[]; notebookId?: string; title?: string },
    actor: AuditActor,
    actorLabel: string,
  ) => Promise<MemoDetail>;
  moveMemosToNotebook: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoIds: string[],
    notebookId: string,
    actor: AuditActor,
    actorLabel: string,
  ) => Promise<number>;
  restoreMemosRecord: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoIds: string[],
    actor: AuditActor,
  ) => Promise<number>;
  searchMemoSummaries: (
    database: DatabaseAdapter,
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
    },
  ) => Promise<MemoSummary[]>;
  updateMemoRecord: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    input: MemoUpdateInput,
    actor: AuditActor,
    actorLabel: string,
    requireEditSession?: boolean,
  ) => Promise<MemoUpdateResult>;
};

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
  if (isDemoModeEnabled(environment.EDGE_EVER_DEMO_MODE)) {
    throw new AppError("forbidden", "Templates and AI instructions cannot be changed in demo mode.", 403);
  }
};

export const callMcpTool = async (
  c: AppContext,
  auth: AuthContext,
  name: string,
  args: Record<string, unknown>,
  dependencies: McpToolDependencies,
) => {
  const {
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
  } = dependencies;

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
        revisions: await listMemoRevisionsService(
          c.env.storage.db,
          auth.workspaceId,
          getRequiredString(args.memoId, "memoId"),
          clampNumber(Number(args.limit ?? 50), 1, 100),
          getMemoDetail,
        ),
      };
    }
    case "restore_memo_revision": {
      assertScope(auth, "write:memos");
      const memoId = getRequiredString(args.memoId, "memoId");
      const revisionId = getRequiredString(args.revisionId, "revisionId");
      const revision = await getMemoRevisionRowService(c.env.storage.db, auth.workspaceId, memoId, revisionId);

      if (!revision) {
        throw new AppError("not_found", "Memo revision not found", 404);
      }

      if (args.dryRun === true) {
        return { dryRun: true, revision: mapMemoRevisionService(revision) };
      }

      return {
        memo: await restoreMemoRevisionService(
          c.env.storage.db,
          auth.workspaceId,
          memoId,
          revisionId,
          getAuditActor(c),
          getActorLabel(c),
          { getMemoDetail, getMemoDetailRow },
        ),
      };
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
