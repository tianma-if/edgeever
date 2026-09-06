import {
  getDefaultAiPromptSeed,
  localizeAiPromptSeed,
  type AiAction,
  type AiPromptParameterKind,
  type AiPromptResultMode,
  type AiPromptTemplate,
} from "@edgeever/shared";
import type { DatabaseAdapter } from "./storage-contract";

export type AiPromptTemplateRow = {
  id: string;
  workspace_id: string;
  seed_key: string | null;
  action: AiAction;
  parameter_kind: AiPromptParameterKind;
  result_mode: AiPromptResultMode;
  name: string;
  description: string | null;
  instruction: string;
  name_customized: number;
  description_customized: number;
  instruction_customized: number;
  created_at: string;
  updated_at: string;
};

export const AI_PROMPT_SELECT_COLUMNS = `id, workspace_id, seed_key, action,
  parameter_kind, result_mode, name, description, instruction,
  name_customized, description_customized, instruction_customized, created_at, updated_at`;

export const mapAiPromptTemplateRow = (
  row: AiPromptTemplateRow,
  locale?: string | null,
): AiPromptTemplate => {
  const promptSeed = row.seed_key ? getDefaultAiPromptSeed(row.seed_key) : null;
  const localized = promptSeed ? localizeAiPromptSeed(promptSeed, locale) : null;

  return {
    id: row.id,
    origin: promptSeed ? "default" : "custom",
    seedKey: promptSeed?.key ?? null,
    action: promptSeed?.action ?? row.action,
    parameterKind: row.parameter_kind,
    resultMode: row.result_mode,
    nameCustomized: Boolean(row.name_customized),
    descriptionCustomized: Boolean(row.description_customized),
    instructionCustomized: Boolean(row.instruction_customized),
    name: localized && !row.name_customized ? localized.name : row.name,
    description: localized && !row.description_customized
      ? localized.description
      : row.description,
    instruction: localized && !row.instruction_customized
      ? localized.instruction
      : row.instruction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const getAiPromptTemplateRow = (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
) => db.prepare(
  `SELECT ${AI_PROMPT_SELECT_COLUMNS}
   FROM ai_prompt_templates
   WHERE id = ? AND workspace_id = ?`,
).bind(id, workspaceId).first<AiPromptTemplateRow>();

export const getAiPromptTemplate = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  locale?: string | null,
) => {
  const row = await getAiPromptTemplateRow(db, workspaceId, id);
  return row ? mapAiPromptTemplateRow(row, locale) : null;
};

export const listAiPromptTemplates = async (
  db: DatabaseAdapter,
  workspaceId: string,
  locale?: string | null,
) => {
  const rows = await db.prepare(
    `SELECT ${AI_PROMPT_SELECT_COLUMNS}
     FROM ai_prompt_templates
     WHERE workspace_id = ?
     ORDER BY updated_at DESC, name ASC`,
  ).bind(workspaceId).all<AiPromptTemplateRow>();
  return rows.results.map((row) => mapAiPromptTemplateRow(row, locale));
};

export const resolveWorkspaceActionInstruction = async (
  db: DatabaseAdapter,
  workspaceId: string,
  action: AiAction,
  locale?: string | null,
): Promise<string | undefined> => {
  if (action === "custom") return undefined;
  const promptSeed = getDefaultAiPromptSeed(action);
  if (!promptSeed) return undefined;

  const row = await db.prepare(
    `SELECT ${AI_PROMPT_SELECT_COLUMNS}
     FROM ai_prompt_templates
     WHERE workspace_id = ? AND seed_key = ?`,
  ).bind(workspaceId, promptSeed.key).first<AiPromptTemplateRow>();

  const instruction = row
    ? mapAiPromptTemplateRow(row, locale).instruction
    : localizeAiPromptSeed(promptSeed, locale).instruction;
  return instruction.trim() || undefined;
};
