import {
  AiPromptTemplateCreateSchema,
  AiPromptTemplateUpdateSchema,
  RestoreJsonAiPromptsSchema,
  type JsonBackupAiPrompt,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import {
  getAiPromptTemplateRow,
  listAiPromptTemplates,
  mapAiPromptTemplateRow,
} from "./ai-prompt-service";
import { restoreMissingDefaultAiPrompts } from "./ai-prompt-seed";
import { audit, auditStatement } from "./audit";
import { createId, isoNow } from "./entity-utils";
import { forbidden, notFound } from "./http-errors";
import { getAuditActor, getWorkspaceId, requireUser } from "./request-auth";

type AiPromptRouteDependencies = {
  isDemoMode: (environment: Bindings) => boolean;
};

const getRequestLocale = (context: AppContext) =>
  context.req.query("locale")?.trim()
  || context.req.header("Accept-Language")?.split(",")[0]?.trim()
  || undefined;

const denyMutation = (context: AppContext, dependencies: AiPromptRouteDependencies) => {
  const denied = requireUser(context);
  if (denied) return denied;
  if (dependencies.isDemoMode(context.env)) {
    return forbidden(context, "Custom prompts cannot be changed in demo mode.");
  }
  return null;
};

export const registerAiPromptRoutes = (
  app: Hono<AppEnv>,
  dependencies: AiPromptRouteDependencies,
) => {
  app.get("/api/v1/ai/prompts", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;

    const prompts = await listAiPromptTemplates(
      context.env.storage.db,
      getWorkspaceId(context),
      getRequestLocale(context),
    );
    return context.json({ prompts });
  });

  app.post(
    "/api/v1/ai/prompts",
    zValidator("json", AiPromptTemplateCreateSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;

      const input = context.req.valid("json");
      const workspaceId = getWorkspaceId(context);
      const id = createId("aiprompt");
      const now = isoNow();
      const name = input.name.trim();
      const description = input.description?.trim() || null;
      const instruction = input.instruction.trim();

      const actor = getAuditActor(context);
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
        `INSERT INTO ai_prompt_templates (
           id, workspace_id, seed_key, action, parameter_kind, result_mode,
           name, description, instruction,
           name_customized, description_customized, instruction_customized,
           created_at, updated_at
         ) VALUES (?, ?, NULL, 'custom', ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)`,
        ).bind(
          id,
          workspaceId,
          input.parameterKind,
          input.resultMode,
          name,
          description,
          instruction,
          now,
          now,
        ),
        auditStatement(
          context.env.storage.db,
          actor.actorType,
          actor.actorId,
          "ai_prompt.create",
          "ai_prompt",
          id,
          {},
        ),
      ]);

      const row = await getAiPromptTemplateRow(context.env.storage.db, workspaceId, id);
      return context.json({ prompt: mapAiPromptTemplateRow(row!, getRequestLocale(context)) }, 201);
    },
  );

  app.patch(
    "/api/v1/ai/prompts/:id",
    zValidator("json", AiPromptTemplateUpdateSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;

      const id = context.req.param("id");
      const input = context.req.valid("json");
      const workspaceId = getWorkspaceId(context);
      const current = await getAiPromptTemplateRow(context.env.storage.db, workspaceId, id);
      if (!current) return notFound(context, "Prompt not found");

      const name = input.name?.trim() ?? current.name;
      const description = input.description !== undefined
        ? (input.description?.trim() || null)
        : current.description;
      const instruction = input.instruction?.trim() ?? current.instruction;
      const now = isoNow();
      const actor = getAuditActor(context);

      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `UPDATE ai_prompt_templates
           SET name = ?, description = ?, instruction = ?,
               parameter_kind = ?, result_mode = ?,
               name_customized = ?, description_customized = ?, instruction_customized = ?,
               updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        ).bind(
          name,
          description,
          instruction,
          input.parameterKind ?? current.parameter_kind,
          input.resultMode ?? current.result_mode,
          input.name !== undefined ? 1 : current.name_customized,
          input.description !== undefined ? 1 : current.description_customized,
          input.instruction !== undefined ? 1 : current.instruction_customized,
          now,
          id,
          workspaceId,
        ),
        auditStatement(
          context.env.storage.db,
          actor.actorType,
          actor.actorId,
          "ai_prompt.update",
          "ai_prompt",
          id,
          {},
        ),
      ]);

      const row = await getAiPromptTemplateRow(context.env.storage.db, workspaceId, id);
      return context.json({ prompt: mapAiPromptTemplateRow(row!, getRequestLocale(context)) });
    },
  );

  app.delete("/api/v1/ai/prompts/:id", async (context) => {
    const denied = denyMutation(context, dependencies);
    if (denied) return denied;

    const id = context.req.param("id");
    const workspaceId = getWorkspaceId(context);
    const current = await getAiPromptTemplateRow(context.env.storage.db, workspaceId, id);
    if (!current) return notFound(context, "Prompt not found");

    const actor = getAuditActor(context);
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `DELETE FROM ai_prompt_templates WHERE id = ? AND workspace_id = ?`,
      ).bind(id, workspaceId),
      auditStatement(
        context.env.storage.db,
        actor.actorType,
        actor.actorId,
        "ai_prompt.delete",
        "ai_prompt",
        id,
        {},
      ),
    ]);
    return context.json({ ok: true });
  });

  /** Re-insert any factory defaults that were deleted. Does not overwrite edited defaults. */
  app.post("/api/v1/ai/prompts/restore-defaults", async (context) => {
    const denied = denyMutation(context, dependencies);
    if (denied) return denied;

    const workspaceId = getWorkspaceId(context);
    const { restoredCount, restoredIds } = await restoreMissingDefaultAiPrompts(
      context.env.storage.db,
      workspaceId,
    );

    const prompts = await listAiPromptTemplates(
      context.env.storage.db,
      workspaceId,
      getRequestLocale(context),
    );

    if (restoredCount > 0) {
      const actor = getAuditActor(context);
      await audit(
        context.env.storage.db,
        actor.actorType,
        actor.actorId,
        "ai_prompt.restore_defaults",
        "workspace",
        workspaceId,
        { restoredCount, restoredIds },
      );
    }

    return context.json({
      prompts,
      restoredCount,
    });
  });

  app.post(
    "/api/v1/restores/json/ai-prompts",
    zValidator("json", RestoreJsonAiPromptsSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;

      const workspaceId = getWorkspaceId(context);
      const input = context.req.valid("json");
      await restoreMissingDefaultAiPrompts(context.env.storage.db, workspaceId);
      const statements = [];
      const factoryRows = await context.env.storage.db.prepare(
        `SELECT seed_key, name, description, instruction
         FROM ai_prompt_templates
         WHERE workspace_id = ? AND seed_key IS NOT NULL`,
      ).bind(workspaceId).all<{
        seed_key: string;
        name: string;
        description: string | null;
        instruction: string;
      }>();
      const factoryRowsBySeed = new Map(
        factoryRows.results.map((row) => [row.seed_key, row]),
      );
      const customPromptIds = (input.prompts as JsonBackupAiPrompt[])
        .filter((prompt) => prompt.origin === "custom")
        .map((prompt) => prompt.id);
      const existingRows = customPromptIds.length > 0
        ? await context.env.storage.db.prepare(
          `SELECT id, workspace_id, seed_key FROM ai_prompt_templates
           WHERE id IN (${customPromptIds.map(() => "?").join(", ")})`,
        ).bind(...customPromptIds).all<{
          id: string;
          workspace_id: string;
          seed_key: string | null;
        }>()
        : { results: [] };
      const existingRowsById = new Map(existingRows.results.map((row) => [row.id, row]));

      for (const prompt of input.prompts as JsonBackupAiPrompt[]) {
        if (prompt.origin === "default" && prompt.seedKey) {
          const catalogPrompt = factoryRowsBySeed.get(prompt.seedKey);
          statements.push(context.env.storage.db.prepare(
            `UPDATE ai_prompt_templates
             SET action = ?, parameter_kind = ?, result_mode = ?,
                 name = ?, description = ?, instruction = ?,
                 name_customized = ?, description_customized = ?, instruction_customized = ?,
                 created_at = ?, updated_at = ?
             WHERE workspace_id = ? AND seed_key = ?`,
          ).bind(
            prompt.action,
            prompt.parameterKind,
            prompt.resultMode,
            prompt.nameCustomized ? prompt.name : catalogPrompt?.name ?? prompt.name,
            prompt.descriptionCustomized
              ? prompt.description
              : catalogPrompt?.description ?? prompt.description,
            prompt.instructionCustomized
              ? prompt.instruction
              : catalogPrompt?.instruction ?? prompt.instruction,
            prompt.nameCustomized ? 1 : 0,
            prompt.descriptionCustomized ? 1 : 0,
            prompt.instructionCustomized ? 1 : 0,
            prompt.createdAt,
            prompt.updatedAt,
            workspaceId,
            prompt.seedKey,
          ));
          continue;
        }

        const existing = existingRowsById.get(prompt.id);
        const id = existing && (existing.workspace_id !== workspaceId || existing.seed_key)
          ? createId("aiprompt")
          : prompt.id;
        statements.push(context.env.storage.db.prepare(
          `INSERT INTO ai_prompt_templates (
             id, workspace_id, seed_key, action, parameter_kind, result_mode,
             name, description, instruction,
             name_customized, description_customized, instruction_customized,
             created_at, updated_at
           ) VALUES (?, ?, NULL, 'custom', ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             parameter_kind = excluded.parameter_kind,
             result_mode = excluded.result_mode,
             name = excluded.name,
             description = excluded.description,
             instruction = excluded.instruction,
             name_customized = 1,
             description_customized = 1,
             instruction_customized = 1,
             updated_at = excluded.updated_at
           WHERE ai_prompt_templates.workspace_id = excluded.workspace_id`,
        ).bind(
          id,
          workspaceId,
          prompt.parameterKind,
          prompt.resultMode,
          prompt.name,
          prompt.description,
          prompt.instruction,
          prompt.createdAt,
          prompt.updatedAt,
        ));
      }

      const actor = getAuditActor(context);
      statements.push(auditStatement(
        context.env.storage.db,
        actor.actorType,
        actor.actorId,
        "ai_prompt.restore_backup",
        "workspace",
        workspaceId,
        { count: input.prompts.length },
      ));
      await context.env.storage.db.batch(statements);
      return context.json({ ok: true });
    },
  );
};
