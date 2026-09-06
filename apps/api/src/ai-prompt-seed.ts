import { DEFAULT_AI_PROMPT_SEEDS, defaultAiPromptId } from "@edgeever/shared";
import type { DatabaseAdapter } from "./storage-contract";
import { isoNow } from "./entity-utils";

/**
 * Insert any missing factory-default prompts for a workspace.
 * Uses explicit seed keys plus deterministic ids so:
 * - deleted defaults are re-created
 * - user-edited defaults (same id) are left alone
 * - user-created prompts (random ids) are never touched
 */
export const restoreMissingDefaultAiPrompts = async (
  db: DatabaseAdapter,
  workspaceId: string,
): Promise<{ restoredCount: number; restoredIds: string[] }> => {
  const existing = await db.prepare(
    `SELECT id, seed_key FROM ai_prompt_templates
     WHERE workspace_id = ? AND seed_key IS NOT NULL`,
  ).bind(workspaceId).all<{ id: string; seed_key: string }>();

  const existingSeedKeys = new Set((existing.results ?? []).map((row) => row.seed_key));
  const missing = DEFAULT_AI_PROMPT_SEEDS.filter(
    (seed) => !existingSeedKeys.has(seed.key),
  );

  if (missing.length === 0) {
    return { restoredCount: 0, restoredIds: [] };
  }

  const now = isoNow();
  for (const seed of missing) {
    await db.prepare(
      `INSERT OR IGNORE INTO ai_prompt_templates (
         id, workspace_id, seed_key, action, parameter_kind, result_mode,
         name, description, instruction,
         name_customized, description_customized, instruction_customized,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
    ).bind(
      defaultAiPromptId(workspaceId, seed.key),
      workspaceId,
      seed.key,
      seed.action,
      seed.parameterKind,
      seed.resultMode,
      seed.name,
      seed.description,
      seed.instruction,
      now,
      now,
    ).run();
  }

  const restored = await db.prepare(
    `SELECT id, seed_key FROM ai_prompt_templates
     WHERE workspace_id = ? AND seed_key IS NOT NULL`,
  ).bind(workspaceId).all<{ id: string; seed_key: string }>();
  const missingSeedKeys = new Set<string>(missing.map((seed) => seed.key));
  const restoredIds = (restored.results ?? [])
    .filter((row) => missingSeedKeys.has(row.seed_key))
    .map((row) => row.id);

  return { restoredCount: restoredIds.length, restoredIds };
};

/** Alias used when claiming / creating a workspace. */
export const ensureWorkspaceAiPromptSeed = restoreMissingDefaultAiPrompts;
