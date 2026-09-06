import { z } from "zod";

export const CompanionIdSchema = z.string().uuid();
export const CompanionMemoryInputSchema = z.object({
  content: z.string().trim().min(1).max(500),
  sourceTurnId: CompanionIdSchema.optional(),
}).strict();
export const CompanionMemoryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(500),
  version: z.number().int().positive(),
}).strict();
export const CompanionTurnInputSchema = z.object({
  id: CompanionIdSchema,
  threadId: CompanionIdSchema,
  message: z.string().trim().min(1).max(4000),
  useMemory: z.boolean().default(true),
  allowNotes: z.boolean().default(false),
  locale: z.enum(["zh-CN", "en-US"]).default("en-US"),
}).strict();
export type CompanionTurnInput = z.infer<typeof CompanionTurnInputSchema>;
export type CompanionMemory = {
  id: string;
  content: string;
  sourceTurnId: string | null;
  kind?: "explicit" | "inferred";
  state?: "active" | "candidate" | "conflicted";
  scopeNotebookId?: string | null;
  ruleKey?: string | null;
  scopeNotebookName?: string | null;
  evidence?: { memoId: string; createdAt: string; title?: string; notebookId?: string }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type CompanionSource = { id: string; title: string; revision: number };

export const CompanionDiscoverySettingsInputSchema = z.object({
  enabled: z.boolean(),
  learningEnabled: z.boolean().optional(),
  useMemory: z.boolean().optional(),
  version: z.number().int().nonnegative(),
}).strict();
export type CompanionDiscoverySettingsInput = z.infer<typeof CompanionDiscoverySettingsInputSchema>;
export type CompanionDiscoverySettings = CompanionDiscoverySettingsInput & {
  lastCheckAt: string | null;
  lastStatus: "quiet" | "ready" | "failed" | "running";
};
const compactDiscoveryBody = z.string().trim().min(1).max(180).refine(
  value => value.split(/\r?\n/).length <= 3,
  "Discovery body must contain at most 3 lines.",
);
export const CompanionDiscoveryOutputSchema = z.object({
  suggestion: z.object({
    kind: z.enum(["insight", "merge", "append", "move", "tag"]),
    title: z.string().trim().min(1).max(60),
    body: compactDiscoveryBody,
    sourceIds: z.array(z.string().min(1).max(100)).min(1).max(5),
    memoryIds: z.array(z.string().max(100)).max(8).optional(),
    notebookId: z.string().max(100).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(5).optional(),
    targetId: z.string().max(100).nullable(),
  }).nullable(),
});
export type CompanionDiscoveryOutput = z.infer<typeof CompanionDiscoveryOutputSchema>;
export type CompanionDiscoveryItem = {
  id: string; kind: "insight" | "merge" | "append" | "move" | "tag"; title: string; body: string;
  sources: (CompanionSource & { notebookId: string })[];
  memories?: CompanionMemory[];
  action: CompanionAction | null; seen: boolean; createdAt: string;
};

const actionReason = z.string().trim().min(1).max(400);
const noteId = z.string().trim().min(1).max(100);
export const CompanionMergePlanSchema = z.object({
  kind: z.literal("merge"),
  memoIds: z.array(noteId).min(2).max(5),
  title: z.string().trim().min(1).max(160),
  reason: actionReason,
}).strict();
export const CompanionTagPlanSchema = z.object({
  kind: z.literal("tag"),
  memoId: noteId,
  tags: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  reason: actionReason,
}).strict();
export const CompanionToolPlanSchema = z.object({
  kind: z.literal("tool"),
  toolName: z.string().min(1).max(80),
  arguments: z.record(z.string(), z.unknown()),
  reason: actionReason,
}).strict();
export const CompanionActionPlanSchema = z.discriminatedUnion("kind", [CompanionMergePlanSchema, CompanionTagPlanSchema, CompanionToolPlanSchema]);
export type CompanionActionPlan = z.infer<typeof CompanionActionPlanSchema>;
export type CompanionActionNote = CompanionSource & { notebookId: string; updatedAt: string; tags: string[]; excerpt: string };
export type CompanionAction = {
  id: string;
  turnId: string;
  plan: CompanionActionPlan;
  notes: CompanionActionNote[];
  status: "pending" | "applied" | "dismissed" | "unavailable" | "uncertain";
  resultMemoId: string | null;
  resultNotebookId?: string | null;
  result?: unknown;
  preview?: { notebooks: Array<{ id: string; name: string }>; affectedCount?: number };
  createdAt: string;
};
export type CompanionTurn = {
  id: string;
  threadId: string;
  message: string;
  response: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  sources: CompanionSource[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
};
export type CompanionEvent =
  | { type: "start"; id: string }
  | { type: "text-delta"; text: string }
  | { type: "done"; turn: CompanionTurn }
  | { type: "error"; code: string };

export const CompanionMemoryImportSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  memories: z.array(z.object({ content: z.string().trim().min(1).max(500), kind: z.enum(["explicit", "inferred"]).optional() })).max(50),
  controls: z.object({ useMemory: z.boolean(), learningEnabled: z.boolean() }).optional(),
}).strict();
