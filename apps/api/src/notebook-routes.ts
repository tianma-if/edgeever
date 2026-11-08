import { NotebookCreateSchema, NotebookUpdateSchema } from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { apiError } from "./http-errors";
import {
  createNotebookRecord,
  deleteNotebookRecord,
  listNotebooks,
  restoreNotebookRecord,
  updateNotebookRecord,
} from "./notebook-service";
import { getAuditActor, getWorkspaceId, requireScopes } from "./request-auth";
import {
  assertNotebookAccess,
  resolveRequestNotebookAccess,
} from "./token-notebook-access";

const respondWithAppError = (c: Parameters<typeof apiError>[0], error: unknown) => {
  if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
  throw error;
};

export const registerNotebookRoutes = (
  app: Hono<AppEnv>,
  prepareDemoData: (env: Bindings) => Promise<void>
) => {
  app.get("/api/v1/notebooks", async (c) => {
    const denied = requireScopes(c, "read:notebooks");
    if (denied) return denied;

    await prepareDemoData(c.env);
    return c.json({
      notebooks: await listNotebooks(
        c.env.storage.db,
        getWorkspaceId(c),
        await resolveRequestNotebookAccess(c),
      ),
    });
  });

  app.post("/api/v1/notebooks", zValidator("json", NotebookCreateSchema), async (c) => {
    const denied = requireScopes(c, "write:notebooks");
    if (denied) return denied;

    try {
      const input = c.req.valid("json");
      const notebookAccess = await resolveRequestNotebookAccess(c);
      if (notebookAccess.restricted) {
        if (input.parentId) {
          assertNotebookAccess(notebookAccess, "write", input.parentId, "create a notebook under this parent");
        } else if (!notebookAccess.defaultWrite) {
          // A token whose default policy is "write" may create top-level
          // notebooks (it can immediately write to them); everyone else gets
          // a clear 403 instead of a silent success.
          assertNotebookAccess(notebookAccess, "write", "", "create a top-level notebook");
        }
      }
      const notebook = await createNotebookRecord(
        c.env.storage.db,
        getWorkspaceId(c),
        input,
        getAuditActor(c)
      );
      return c.json({ notebook }, 201);
    } catch (error) {
      return respondWithAppError(c, error);
    }
  });

  app.patch("/api/v1/notebooks/:id", zValidator("json", NotebookUpdateSchema), async (c) => {
    const denied = requireScopes(c, "write:notebooks");
    if (denied) return denied;

    try {
      const input = c.req.valid("json");
      const notebookAccess = await resolveRequestNotebookAccess(c);
      assertNotebookAccess(notebookAccess, "write", c.req.param("id"), "update this notebook");
      if (input.parentId) {
        assertNotebookAccess(notebookAccess, "write", input.parentId, "move a notebook under this parent");
      }
      const notebook = await updateNotebookRecord(
        c.env.storage.db,
        getWorkspaceId(c),
        c.req.param("id"),
        input,
        getAuditActor(c)
      );
      return c.json({ notebook });
    } catch (error) {
      return respondWithAppError(c, error);
    }
  });

  app.delete("/api/v1/notebooks/:id", async (c) => {
    const denied = requireScopes(c, "write:notebooks");
    if (denied) return denied;

    try {
      assertNotebookAccess(
        await resolveRequestNotebookAccess(c),
        "write",
        c.req.param("id"),
        "delete this notebook",
      );
      await deleteNotebookRecord(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), getAuditActor(c));
      return c.json({ ok: true });
    } catch (error) {
      return respondWithAppError(c, error);
    }
  });

  app.post("/api/v1/notebooks/:id/restore", async (c) => {
    const denied = requireScopes(c, "write:notebooks");
    if (denied) return denied;

    try {
      assertNotebookAccess(
        await resolveRequestNotebookAccess(c),
        "write",
        c.req.param("id"),
        "restore this notebook",
      );
      const notebook = await restoreNotebookRecord(
        c.env.storage.db,
        getWorkspaceId(c),
        c.req.param("id"),
        getAuditActor(c)
      );
      return c.json({ notebook });
    } catch (error) {
      return respondWithAppError(c, error);
    }
  });
};
