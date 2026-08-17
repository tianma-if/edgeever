import {
  DeleteMemosSchema,
  MemoCreateSchema,
  MergeMemosSchema,
  MemoUpdateSchema,
  MoveMemosSchema,
  type MemoDetail,
  type MemoEditSession,
  type MemoRevision,
  type MemoUpdateInput,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv, AuditActor, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { apiError, notFound } from "./http-errors";
import type { ListMemosInput, ListMemosResult } from "./memo-list-service";
import { getActorLabel, getAuditActor, getWorkspaceId, requireScopes } from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";

type MemoRouteDependencies = {
  clampNumber: (value: number, min: number, max: number) => number;
  createMemo: (
    database: DatabaseAdapter,
    workspaceId: string,
    input: {
      notebookId: string;
      title?: string;
      contentMarkdown?: string;
      tags?: string[];
      createdAt?: string;
      updatedAt?: string;
    },
    actor: AuditActor,
    actorLabel: string,
  ) => Promise<MemoDetail>;
  createMemoEditSession: (context: AppContext, memoId: string) => Promise<MemoEditSession | null>;
  deleteMemo: (
    environment: Bindings,
    workspaceId: string,
    memoId: string,
    permanent: boolean,
    actor: AuditActor,
  ) => Promise<void>;
  deleteMemos: (
    environment: Bindings,
    workspaceId: string,
    memoIds: string[],
    permanent: boolean,
    actor: AuditActor,
  ) => Promise<number>;
  emptyTrash: (environment: Bindings, workspaceId: string, actor: AuditActor) => Promise<number>;
  getMemoDetail: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    includeDeleted?: boolean,
  ) => Promise<MemoDetail | null>;
  listMemoRevisions: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    limit: number,
  ) => Promise<MemoRevision[]>;
  listMemos: (database: DatabaseAdapter, input: ListMemosInput) => Promise<ListMemosResult>;
  mergeMemos: (
    database: DatabaseAdapter,
    workspaceId: string,
    input: { memoIds: string[]; notebookId?: string; title?: string },
    actor: AuditActor,
    actorLabel: string,
  ) => Promise<MemoDetail>;
  moveMemos: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoIds: string[],
    notebookId: string,
    actor: AuditActor,
    actorLabel: string,
  ) => Promise<number>;
  restoreMemo: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    actor: AuditActor,
  ) => Promise<MemoDetail>;
  restoreMemoRevision: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    revisionId: string,
    actor: AuditActor,
    actorLabel: string,
  ) => Promise<MemoDetail>;
  updateMemo: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    input: MemoUpdateInput,
    actor: AuditActor,
    actorLabel: string,
    requireEditSession: boolean,
  ) => Promise<
    | { memo: MemoDetail; error?: never; message?: never; status?: never; details?: never }
    | { error: string; message: string; status?: number; details?: Record<string, unknown> }
  >;
};

const handleAppError = (context: AppContext, error: unknown) => {
  if (error instanceof AppError) {
    return apiError(context, error.code, error.message, error.status);
  }
  throw error;
};

export const registerMemoRoutes = (
  app: Hono<AppEnv>,
  dependencies: MemoRouteDependencies,
) => {
  app.get("/api/v1/memos", async (context) => {
    const denied = requireScopes(context, "read:memos");
    if (denied) return denied;

    return context.json(await dependencies.listMemos(context.env.storage.db, {
      workspaceId: getWorkspaceId(context),
      notebookId: context.req.query("notebookId"),
      includeNotebookDescendants: context.req.query("includeDescendants") === "1",
      query: context.req.query("q"),
      tag: context.req.query("tag"),
      includeTrash: context.req.query("trash") === "1",
      sort: context.req.query("sort"),
      filter: context.req.query("filter"),
      limit: Number(context.req.query("limit") ?? 100),
      cursor: context.req.query("cursor"),
    }));
  });

  app.post("/api/v1/memos", zValidator("json", MemoCreateSchema), async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    try {
      const memo = await dependencies.createMemo(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.valid("json"),
        getAuditActor(context),
        getActorLabel(context),
      );
      return context.json({ memo }, 201);
    } catch (error) {
      return handleAppError(context, error);
    }
  });

  app.get("/api/v1/memos/:id", async (context) => {
    const denied = requireScopes(context, "read:memos");
    if (denied) return denied;

    const memo = await dependencies.getMemoDetail(
      context.env.storage.db,
      getWorkspaceId(context),
      context.req.param("id"),
      context.req.query("includeDeleted") === "1",
    );
    return memo ? context.json({ memo }) : notFound(context, "Memo not found");
  });

  app.post("/api/v1/memos/:id/edit-sessions", async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    const editSession = await dependencies.createMemoEditSession(context, context.req.param("id"));
    return editSession
      ? context.json({ editSession })
      : notFound(context, "Memo not found");
  });

  app.post("/api/v1/memos/batch/move", zValidator("json", MoveMemosSchema), async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    const input = context.req.valid("json");
    try {
      const moved = await dependencies.moveMemos(
        context.env.storage.db,
        getWorkspaceId(context),
        input.memoIds,
        input.notebookId,
        getAuditActor(context),
        getActorLabel(context),
      );
      return context.json({ ok: true, moved });
    } catch (error) {
      return handleAppError(context, error);
    }
  });

  app.post("/api/v1/memos/batch/delete", zValidator("json", DeleteMemosSchema), async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    const input = context.req.valid("json");
    try {
      const deleted = await dependencies.deleteMemos(
        context.env,
        getWorkspaceId(context),
        input.memoIds,
        Boolean(input.permanent),
        getAuditActor(context),
      );
      return context.json({ ok: true, deleted });
    } catch (error) {
      return handleAppError(context, error);
    }
  });

  app.delete("/api/v1/memos/trash/empty", async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    const deleted = await dependencies.emptyTrash(
      context.env,
      getWorkspaceId(context),
      getAuditActor(context),
    );
    return context.json({ ok: true, deleted });
  });

  app.get("/api/v1/memos/:id/revisions", async (context) => {
    const denied = requireScopes(context, "read:memos");
    if (denied) return denied;

    try {
      const revisions = await dependencies.listMemoRevisions(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.param("id"),
        dependencies.clampNumber(Number(context.req.query("limit") ?? 50), 1, 100),
      );
      return context.json({ revisions });
    } catch (error) {
      return handleAppError(context, error);
    }
  });

  app.post("/api/v1/memos/:id/revisions/:revisionId/restore", async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    try {
      const memo = await dependencies.restoreMemoRevision(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.param("id"),
        context.req.param("revisionId"),
        getAuditActor(context),
        getActorLabel(context),
      );
      return context.json({ memo });
    } catch (error) {
      return handleAppError(context, error);
    }
  });

  const updateMemo = async (context: AppContext, memoId: string, input: MemoUpdateInput) => {
    const result = await dependencies.updateMemo(
      context.env.storage.db,
      getWorkspaceId(context),
      memoId,
      input,
      getAuditActor(context),
      getActorLabel(context),
      true,
    );
    if ("error" in result) {
      return context.json(
        {
          error: {
            code: result.error,
            message: result.message,
            ...(result.details ? { details: result.details } : {}),
          },
        },
        (result.status ?? (result.error === "not_found" ? 404 : 409)) as 400,
      );
    }
    return context.json({ memo: result.memo });
  };

  app.patch("/api/v1/memos/:id", zValidator("json", MemoUpdateSchema), async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;
    return updateMemo(context, context.req.param("id"), context.req.valid("json"));
  });

  app.post("/api/v1/memos/:id/save", zValidator("json", MemoUpdateSchema), async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;
    return updateMemo(context, context.req.param("id"), context.req.valid("json"));
  });

  app.delete("/api/v1/memos/:id", async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    try {
      await dependencies.deleteMemo(
        context.env,
        getWorkspaceId(context),
        context.req.param("id"),
        context.req.query("permanent") === "1",
        getAuditActor(context),
      );
      return context.json({ ok: true });
    } catch (error) {
      return handleAppError(context, error);
    }
  });

  app.post("/api/v1/memos/:id/restore", async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    try {
      const memo = await dependencies.restoreMemo(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.param("id"),
        getAuditActor(context),
      );
      return context.json({ memo });
    } catch (error) {
      return handleAppError(context, error);
    }
  });

  app.post("/api/v1/memos/merge", zValidator("json", MergeMemosSchema), async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;

    try {
      const memo = await dependencies.mergeMemos(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.valid("json"),
        getAuditActor(context),
        getActorLabel(context),
      );
      return context.json({ memo }, 201);
    } catch (error) {
      return handleAppError(context, error);
    }
  });
};
