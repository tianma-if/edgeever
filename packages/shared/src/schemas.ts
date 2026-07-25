import { z } from "zod";

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

export type NotebookCreateInput = z.infer<typeof NotebookCreateSchema>;
export type NotebookUpdateInput = z.infer<typeof NotebookUpdateSchema>;
export type MemoCreateInput = z.infer<typeof MemoCreateSchema>;
export type MemoUpdateInput = z.infer<typeof MemoUpdateSchema>;
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;
export type MoveMemosInput = z.infer<typeof MoveMemosSchema>;
export type DeleteMemosInput = z.infer<typeof DeleteMemosSchema>;
export type MergeMemosInput = z.infer<typeof MergeMemosSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type UserCreateInput = z.infer<typeof UserCreateSchema>;
export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;
export type ApiTokenCreateInput = z.infer<typeof ApiTokenCreateSchema>;
export type TagRenameInput = z.infer<typeof TagRenameSchema>;
