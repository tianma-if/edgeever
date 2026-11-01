import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { apiError } from "./http-errors";
import { importMemosRecord } from "./memo-service";
import { getActorLabel, getAuditActor, getWorkspaceId, requireScopes } from "./request-auth";

const importSchema = z.object({
  importId: z.uuid(),
  format: z.enum(["evernote", "obsidian", "joplin"]),
  notebookId: z.string().trim().min(1),
  items: z.array(z.unknown()).min(1).max(25),
  dryRun: z.boolean().default(false),
});

const importContext = (context: AppContext) => {
  const auth = context.get("auth");
  return JSON.stringify([auth.workspaceId, auth.actorType, auth.actorId]);
};

/** Opt-in guard for import requests, including ordinary folder/resource writes. */
export const registerImportContextGuard = (app: Hono<AppEnv>) => {
  app.use("/api/v1/*", async (context, next) => {
    const expected = context.req.header("x-edgeever-import-context");
    if (expected !== undefined && expected !== importContext(context)) {
      return apiError(context, "import_identity_changed", "The import account or workspace changed.", 409);
    }
    return next();
  });
};

/** Native import uses the same business service and permissions as MCP. */
export const registerImportRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/imports/capabilities", (context) => {
    const denied = requireScopes(context, "read:memos");
    if (denied) return denied;
    context.header("Cache-Control", "no-store");
    return context.json({ protocolVersion: 1, maxBatchSize: 25, formats: ["evernote", "obsidian", "joplin"], importContext: importContext(context), accountId: context.get("auth").actorId });
  });
  app.post("/api/v1/imports/memos", zValidator("json", importSchema), async (context) => {
    const denied = requireScopes(context, "write:memos");
    if (denied) return denied;
    const input = context.req.valid("json");
    try {
      return context.json(await importMemosRecord(context.env.storage.db, getWorkspaceId(context), {
        source: `third-party-${input.format}-${input.importId}`,
        notebookId: input.notebookId,
        items: input.items,
        dryRun: input.dryRun,
        actor: getAuditActor(context),
        actorLabel: getActorLabel(context),
      }));
    } catch (error) {
      if (error instanceof AppError) return apiError(context, error.code, error.message, error.status);
      throw error;
    }
  });
};
