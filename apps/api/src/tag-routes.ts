import { TagRenameSchema } from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import {
  getActorLabel,
  getAuditActor,
  getWorkspaceId,
  requireScopes,
} from "./request-auth";
import {
  listTagSummaries,
  updateTagAcrossMemos,
} from "./tag-service";
import { resolveRequestNotebookAccess } from "./token-notebook-access";

const decodeTagParam = (value: string) => {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

export const registerTagRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/tags", async (c) => {
    const denied = requireScopes(c, "read:tags");
    if (denied) return denied;

    return c.json({
      tags: await listTagSummaries(
        c.env.storage.db,
        getWorkspaceId(c),
        await resolveRequestNotebookAccess(c),
      ),
    });
  });

  app.patch("/api/v1/tags/:tag", zValidator("json", TagRenameSchema), async (c) => {
    const denied = requireScopes(c, "write:tags");
    if (denied) return denied;

    const updated = await updateTagAcrossMemos(
      c.env.storage.db,
      getWorkspaceId(c),
      decodeTagParam(c.req.param("tag")),
      c.req.valid("json").name,
      getAuditActor(c),
      getActorLabel(c),
      await resolveRequestNotebookAccess(c),
    );
    return c.json({ ok: true, updated });
  });

  app.delete("/api/v1/tags/:tag", async (c) => {
    const denied = requireScopes(c, "write:tags");
    if (denied) return denied;

    const updated = await updateTagAcrossMemos(
      c.env.storage.db,
      getWorkspaceId(c),
      decodeTagParam(c.req.param("tag")),
      null,
      getAuditActor(c),
      getActorLabel(c),
      await resolveRequestNotebookAccess(c),
    );
    return c.json({ ok: true, updated });
  });
};
