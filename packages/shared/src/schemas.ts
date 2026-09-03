import { z } from "zod";
import {
  AI_ACTIONS,
  AI_ATTACHMENT_MEDIA_TYPES,
  AI_PROMPT_PARAMETER_KINDS,
  AI_PROMPT_RESULT_MODES,
  AI_TARGET_LANGUAGES,
  AI_TONES,
  MAX_AI_ATTACHMENTS,
  MAX_AI_ATTACHMENTS_TOTAL_BYTES,
  MAX_AI_ATTACHMENT_BYTES,
  MAX_AI_TEXT_ATTACHMENT_BYTES,
  getBase64DecodedByteLength,
  isAiTextAttachment,
} from "./ai-assistant";

export const NotebookCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().trim().min(1).nullable().optional(),
});

export const NotebookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const MemoCreateSchema = z.object({
  notebookId: z.string().trim().min(1),
  title: z.string().trim().max(160).optional(),
  contentMarkdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const MemoUpdateSchema = z.object({
  expectedRevision: z.number().int().min(0).optional(),
  expectedContentHash: z.string().length(64).optional(),
  editSessionId: z.string().trim().min(1).optional(),
  notebookId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(160).optional(),
  isPinned: z.boolean().optional(),
  contentJson: z.unknown().optional(),
  contentMarkdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  allowDestructiveOverwrite: z.boolean().optional(),
});

export const TemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  memoId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(160).nullable().optional(),
  contentMarkdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).refine((input) => input.memoId || input.contentMarkdown !== undefined, {
  message: "memoId or contentMarkdown is required",
});

export const TemplateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  contentMarkdown: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const TemplateUseSchema = z.object({
  notebookId: z.string().trim().min(1),
});

const ScheduledPluginCommandPayloadSchema = z.object({
  pluginId: z.string().trim().min(3).max(200),
  commandId: z.string().trim().min(1).max(200),
});

export const ScheduledTaskCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  taskType: z.literal("plugin-command"),
  taskPayload: ScheduledPluginCommandPayloadSchema,
  cronExpression: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(80),
  executorDeviceId: z.string().trim().min(16).max(160),
  missedRunPolicy: z.enum(["run-once", "skip"]).default("run-once"),
  isEnabled: z.boolean().default(true),
});

export const ScheduledTaskUpdateSchema = ScheduledTaskCreateSchema.omit({
  taskType: true,
  taskPayload: true,
  executorDeviceId: true,
}).partial().extend({
  taskPayload: ScheduledPluginCommandPayloadSchema.optional(),
  executorDeviceId: z.string().trim().min(16).max(160).optional(),
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one field is required.",
});

export const PluginScheduleUpsertSchema = z.object({
  pluginId: z.string().trim().min(3).max(200),
  scheduleKey: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/i).max(120),
  name: z.string().trim().min(1).max(120),
  commandId: z.string().trim().min(1).max(200),
  cronExpression: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(80),
  executorDeviceId: z.string().trim().min(16).max(160),
  missedRunPolicy: z.enum(["run-once", "skip"]).default("run-once"),
  isEnabled: z.boolean().optional(),
});

export const ScheduledTaskClaimSchema = z.object({
  scheduledFor: z.string().datetime(),
  executorDeviceId: z.string().trim().min(16).max(160),
});

export const ScheduledTaskFinishSchema = z.object({
  executorDeviceId: z.string().trim().min(16).max(160),
  status: z.enum(["succeeded", "failed"]),
  errorMessage: z.string().trim().max(2_000).nullable().optional(),
});

export const MoveMemosSchema = z.object({
  memoIds: z.array(z.string().trim().min(1)).min(1).max(100),
  notebookId: z.string().trim().min(1),
});

export const DeleteMemosSchema = z.object({
  memoIds: z.array(z.string().trim().min(1)).min(1).max(100),
  permanent: z.boolean().optional(),
});

export const MergeMemosSchema = z.object({
  memoIds: z.array(z.string().trim().min(1)).min(2).max(50),
  notebookId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(160).optional(),
});

export const LoginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(512),
  deviceId: z.string().trim().min(16).max(160).optional(),
});

export const LoginDeviceSessionUpdateSchema = z.object({
  label: z.string().trim().max(80).nullable(),
});

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(512),
    newPassword: z.string().min(8).max(512),
    confirmPassword: z.string().min(8).max(512),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "New passwords do not match.",
    path: ["confirmPassword"],
  });

export const UserCreateSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().max(80).nullable().optional(),
  password: z.string().min(8).max(512),
});

export const UserUpdateSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    password: z.string().min(8).max(512).optional(),
    isDisabled: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "At least one field is required.");

export const ApiTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string().trim().min(1).max(80)).min(1).max(32),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const TagRenameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const ResourceUpdateSchema = z.object({
  filename: z.string().trim().min(1).max(160),
});

const ObjectStorageEndpointSchema = z.string().trim().url().max(500).refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "Object storage endpoint must use HTTP or HTTPS.",
);

export const ObjectStorageSettingsUpdateSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("builtin") }),
  z.object({
    provider: z.literal("s3"),
    displayName: z.string().trim().min(1).max(80),
    endpoint: ObjectStorageEndpointSchema,
    region: z.string().trim().min(1).max(80),
    bucket: z.string().trim().min(1).max(255),
    accessKeyId: z.string().trim().min(1).max(256),
    secretAccessKey: z.string().min(1).max(1024).optional(),
    forcePathStyle: z.boolean().default(true),
    objectPrefix: z.string().trim().max(500).default(""),
  }),
]);

export const ObjectStorageConnectionTestSchema = z.object({
  endpoint: ObjectStorageEndpointSchema,
  region: z.string().trim().min(1).max(80),
  bucket: z.string().trim().min(1).max(255),
  accessKeyId: z.string().trim().min(1).max(256),
  secretAccessKey: z.string().min(1).max(1024).optional(),
  forcePathStyle: z.boolean().default(true),
  objectPrefix: z.string().trim().max(500).default(""),
});

export const AiProviderSchema = z.enum(["openai-compatible", "anthropic", "google"]);

const AiBaseUrlSchema = z.string().trim().url().max(500).superRefine((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "AI Base URL must use HTTP or HTTPS." });
  }
  if (url.username || url.password) {
    context.addIssue({ code: "custom", message: "AI Base URL must not contain credentials." });
  }
});

const AiProviderConfigFieldsSchema = z.object({
  provider: AiProviderSchema,
  displayName: z.string().trim().min(1).max(80),
  baseUrl: AiBaseUrlSchema,
  isEnabled: z.boolean().default(true),
});

export const AiProviderConfigCreateSchema = AiProviderConfigFieldsSchema.extend({
  apiKey: z.string().min(1).max(4096),
  initialModelId: z.string().trim().min(1).max(200).optional(),
});

export const AiProviderConfigUpdateSchema = AiProviderConfigFieldsSchema.extend({
  apiKey: z.string().min(1).max(4096).optional(),
});

export const AiProviderConnectionTestSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  provider: AiProviderSchema.optional(),
  baseUrl: AiBaseUrlSchema.optional(),
  apiKey: z.string().min(1).max(4096).optional(),
});

export const AiModelConfigCreateSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200).optional(),
});

export const AiDefaultModelUpdateSchema = z.object({
  modelConfigId: z.string().trim().min(1).nullable(),
});

export const AiAttachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255).regex(/^[^\u0000-\u001F\u007F]+$/),
  mediaType: z.enum(AI_ATTACHMENT_MEDIA_TYPES),
  base64Data: z.string().min(1).max(Math.ceil(MAX_AI_ATTACHMENT_BYTES / 3) * 4),
}).superRefine((attachment, context) => {
  const byteLength = getBase64DecodedByteLength(attachment.base64Data);
  if (byteLength === null) {
    context.addIssue({ code: "custom", path: ["base64Data"], message: "Attachment data must be valid base64." });
    return;
  }
  const limit = isAiTextAttachment(attachment.mediaType)
    ? MAX_AI_TEXT_ATTACHMENT_BYTES
    : MAX_AI_ATTACHMENT_BYTES;
  if (byteLength > limit) {
    context.addIssue({ code: "custom", path: ["base64Data"], message: "The attachment is too large." });
  }
});

export const AiGenerateSchema = z.object({
  action: z.enum(AI_ACTIONS),
  promptId: z.string().trim().min(1).max(200).optional(),
  locale: z.string().trim().min(2).max(35).optional(),
  title: z.string().trim().max(160).default(""),
  contentMarkdown: z.string().max(300_000),
  stream: z.boolean().default(false),
  targetLanguage: z.enum(AI_TARGET_LANGUAGES).optional(),
  tone: z.enum(AI_TONES).optional(),
  instruction: z.string().trim().min(1).max(2_000).optional(),
  attachments: z.array(AiAttachmentSchema).max(MAX_AI_ATTACHMENTS).default([]),
}).superRefine((input, context) => {
  if (!input.promptId && input.action === "translate" && !input.targetLanguage) {
    context.addIssue({ code: "custom", path: ["targetLanguage"], message: "A target language is required for translation." });
  }
  if (!input.promptId && input.action === "change-tone" && !input.tone) {
    context.addIssue({ code: "custom", path: ["tone"], message: "A tone is required when changing tone." });
  }
  if (!input.promptId && input.action === "custom" && !input.instruction) {
    context.addIssue({ code: "custom", path: ["instruction"], message: "An instruction is required for a custom action." });
  }
  const canGenerateWithoutSource = input.action === "custom" && Boolean(input.instruction || input.promptId);
  if (!input.title && !input.contentMarkdown.trim() && input.attachments.length === 0 && !canGenerateWithoutSource) {
    context.addIssue({ code: "custom", path: ["contentMarkdown"], message: "Note content is required." });
  }
  const totalAttachmentBytes = input.attachments.reduce(
    (total, attachment) => total + (getBase64DecodedByteLength(attachment.base64Data) ?? 0),
    0,
  );
  if (totalAttachmentBytes > MAX_AI_ATTACHMENTS_TOTAL_BYTES) {
    context.addIssue({ code: "custom", path: ["attachments"], message: "The attachments are too large in total." });
  }
});

export const AiTagSuggestionsRequestSchema = z.object({
  title: z.string().trim().max(160).default(""),
  contentMarkdown: z.string().max(300_000),
  currentTags: z.array(z.string().trim().min(1).max(200)).max(24).default([]),
  locale: z.string().trim().min(2).max(35).optional(),
}).superRefine((input, context) => {
  if (!input.title && !input.contentMarkdown.trim()) {
    context.addIssue({
      code: "custom",
      path: ["contentMarkdown"],
      message: "Note content is required.",
    });
  }
});

export const AiTagSuggestionPromptUpdateSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000).nullable(),
});

export const AiPromptTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  instruction: z.string().trim().min(1).max(2_000),
  parameterKind: z.enum(AI_PROMPT_PARAMETER_KINDS).default("none"),
  resultMode: z.enum(AI_PROMPT_RESULT_MODES).default("both"),
});

export const AiPromptTemplateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  instruction: z.string().trim().min(1).max(2_000).optional(),
  parameterKind: z.enum(AI_PROMPT_PARAMETER_KINDS).optional(),
  resultMode: z.enum(AI_PROMPT_RESULT_MODES).optional(),
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one field is required.",
});

export type NotebookCreateInput = z.infer<typeof NotebookCreateSchema>;
export type NotebookUpdateInput = z.infer<typeof NotebookUpdateSchema>;
export type MemoCreateInput = z.infer<typeof MemoCreateSchema>;
export type MemoUpdateInput = z.infer<typeof MemoUpdateSchema>;
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;
export type ScheduledTaskCreateInput = z.input<typeof ScheduledTaskCreateSchema>;
export type ScheduledTaskUpdateInput = z.infer<typeof ScheduledTaskUpdateSchema>;
export type PluginScheduleUpsertInput = z.input<typeof PluginScheduleUpsertSchema>;
export type ScheduledTaskClaimInput = z.infer<typeof ScheduledTaskClaimSchema>;
export type ScheduledTaskFinishInput = z.infer<typeof ScheduledTaskFinishSchema>;
export type MoveMemosInput = z.infer<typeof MoveMemosSchema>;
export type DeleteMemosInput = z.infer<typeof DeleteMemosSchema>;
export type MergeMemosInput = z.infer<typeof MergeMemosSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type LoginDeviceSessionUpdateInput = z.infer<typeof LoginDeviceSessionUpdateSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type UserCreateInput = z.infer<typeof UserCreateSchema>;
export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;
export type ApiTokenCreateInput = z.infer<typeof ApiTokenCreateSchema>;
export type TagRenameInput = z.infer<typeof TagRenameSchema>;
export type ResourceUpdateInput = z.infer<typeof ResourceUpdateSchema>;
export type ObjectStorageSettingsUpdateInput = z.infer<typeof ObjectStorageSettingsUpdateSchema>;
export type ObjectStorageConnectionTestInput = z.infer<typeof ObjectStorageConnectionTestSchema>;
export type AiProviderConfigCreateInput = z.infer<typeof AiProviderConfigCreateSchema>;
export type AiProviderConfigUpdateInput = z.infer<typeof AiProviderConfigUpdateSchema>;
export type AiProviderConnectionTestInput = z.infer<typeof AiProviderConnectionTestSchema>;
export type AiModelConfigCreateInput = z.infer<typeof AiModelConfigCreateSchema>;
export type AiDefaultModelUpdateInput = z.infer<typeof AiDefaultModelUpdateSchema>;
export type AiGenerateInput = z.input<typeof AiGenerateSchema>;
export type AiAttachmentInput = z.infer<typeof AiAttachmentSchema>;
export type AiTagSuggestionsRequestInput = z.infer<typeof AiTagSuggestionsRequestSchema>;
export type AiTagSuggestionPromptUpdateInput = z.infer<typeof AiTagSuggestionPromptUpdateSchema>;
export type AiPromptTemplateCreateInput = z.input<typeof AiPromptTemplateCreateSchema>;
export type AiPromptTemplateUpdateInput = z.infer<typeof AiPromptTemplateUpdateSchema>;
