import { z } from "zod";
import type { TiptapDoc } from "./content";
import {
  AI_ACTIONS,
  AI_PROMPT_PARAMETER_KINDS,
  AI_PROMPT_RESULT_MODES,
} from "./ai-assistant";
import type { AiPromptTemplate, MemoDetail, Notebook, Resource } from "./types";

export const EDGEEVER_ZIP_FORMAT = "edgeever-zip";
export const EDGEEVER_ZIP_FORMAT_VERSION = 2;

export type JsonBackupManifest = {
  format: typeof EDGEEVER_ZIP_FORMAT;
  formatVersion: 1 | typeof EDGEEVER_ZIP_FORMAT_VERSION;
  schemaVersion: number;
  edgeeverVersion: string;
  buildId: string;
  exportedAt: string;
  includesTrash: false;
  counts: {
    notebooks: number;
    memos: number;
    revisions: number;
    resources: number;
    prompts?: number;
  };
};

export type JsonBackupNotebook = Omit<Notebook, "memoCount" | "lastMemoUpdatedAt">;

export type JsonBackupRevision = {
  id: string;
  memoId: string;
  revision: number;
  title: string | null;
  tags: string[];
  contentJson: TiptapDoc;
  contentMarkdown: string;
  contentText: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
};

export type JsonBackupResource = Omit<Resource, "url"> & {
  archivePath: string;
};

export type JsonBackupMemo = {
  memo: MemoDetail;
  revisions: JsonBackupRevision[];
  resources: JsonBackupResource[];
};

export type JsonBackupAiPrompt = AiPromptTemplate;

const DateTimeSchema = z.string().datetime();

export const JsonBackupManifestSchema = z.object({
  format: z.literal(EDGEEVER_ZIP_FORMAT),
  formatVersion: z.union([z.literal(1), z.literal(EDGEEVER_ZIP_FORMAT_VERSION)]),
  schemaVersion: z.number().int().positive(),
  edgeeverVersion: z.string().trim().min(1),
  buildId: z.string().trim().min(1),
  exportedAt: DateTimeSchema,
  includesTrash: z.literal(false),
  counts: z.object({
    notebooks: z.number().int().min(0),
    memos: z.number().int().min(0),
    revisions: z.number().int().min(0),
    resources: z.number().int().min(0),
    prompts: z.number().int().min(0).optional(),
  }),
});

export const JsonBackupNotebookSchema = z.object({
  id: z.string().trim().min(1),
  parentId: z.string().trim().min(1).nullable(),
  name: z.string().trim().min(1).max(80),
  slug: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

const JsonBackupRevisionSchema = z.object({
  id: z.string().trim().min(1),
  memoId: z.string().trim().min(1),
  revision: z.number().int().min(0),
  title: z.string().nullable(),
  tags: z.array(z.string()),
  contentJson: z.unknown(),
  contentMarkdown: z.string(),
  contentText: z.string(),
  contentHash: z.string(),
  createdBy: z.string(),
  createdAt: DateTimeSchema,
});

const MemoDetailSchema = z.object({
  id: z.string().trim().min(1),
  notebookId: z.string().trim().min(1),
  title: z.string().nullable(),
  excerpt: z.string(),
  tags: z.array(z.string()),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  isDeleted: z.boolean(),
  revision: z.number().int().min(0),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  deletedAt: DateTimeSchema.nullable(),
  contentJson: z.unknown(),
  contentMarkdown: z.string(),
  contentText: z.string(),
  contentHash: z.string(),
  sourceMemoIds: z.array(z.string()),
  mergeSourceCount: z.number().int().min(0),
  mergedIntoMemoId: z.string().nullable(),
});

export const JsonBackupMemoSchema = z.object({
  memo: MemoDetailSchema,
  revisions: z.array(JsonBackupRevisionSchema),
  resources: z.array(z.object({
    id: z.string().trim().min(1),
    memoId: z.string().trim().min(1),
    originalMemoId: z.string().nullable(),
    kind: z.enum(["image", "attachment"]),
    mimeType: z.string().nullable(),
    filename: z.string().nullable(),
    byteSize: z.number().int().min(0),
    sha256: z.string().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    archivePath: z.string().trim().min(1),
  })),
});

export const RestoreJsonNotebooksSchema = z.object({
  notebooks: z.array(JsonBackupNotebookSchema).min(1).max(100),
});

export const RestoreJsonMemosSchema = z.object({
  memos: z.array(JsonBackupMemoSchema).min(1).max(10),
});

export const JsonBackupAiPromptSchema = z.object({
  id: z.string().trim().min(1).max(200),
  origin: z.enum(["default", "custom"]),
  seedKey: z.enum(AI_ACTIONS.filter((action) => action !== "custom") as [
    Exclude<(typeof AI_ACTIONS)[number], "custom">,
    ...Exclude<(typeof AI_ACTIONS)[number], "custom">[],
  ]).nullable(),
  action: z.enum(AI_ACTIONS),
  parameterKind: z.enum(AI_PROMPT_PARAMETER_KINDS),
  resultMode: z.enum(AI_PROMPT_RESULT_MODES),
  nameCustomized: z.boolean(),
  descriptionCustomized: z.boolean(),
  instructionCustomized: z.boolean(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(200).nullable(),
  instruction: z.string().trim().min(1).max(2_000),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).superRefine((prompt, context) => {
  if (prompt.origin === "default" && !prompt.seedKey) {
    context.addIssue({
      code: "custom",
      path: ["seedKey"],
      message: "A default prompt must include a seed key.",
    });
  }
  if (prompt.origin === "default" && prompt.seedKey && prompt.action !== prompt.seedKey) {
    context.addIssue({
      code: "custom",
      path: ["action"],
      message: "A default prompt action must match its seed key.",
    });
  }
  if (prompt.origin === "custom" && (prompt.seedKey !== null || prompt.action !== "custom")) {
    context.addIssue({
      code: "custom",
      path: ["origin"],
      message: "A custom prompt cannot use factory prompt identity.",
    });
  }
});

export const RestoreJsonAiPromptsSchema = z.object({
  prompts: z.array(JsonBackupAiPromptSchema).max(100),
});

export const JsonBackupResourceMetadataSchema = JsonBackupMemoSchema.shape.resources.element;
