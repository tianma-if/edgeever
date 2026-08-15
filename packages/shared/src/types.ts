import type { TiptapDoc } from "./content";
import type { AiAction, AiPromptParameterKind, AiPromptResultMode } from "./ai-assistant";

export type Notebook = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  memoCount: number;
  lastMemoUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoSummary = {
  id: string;
  notebookId: string;
  title: string | null;
  excerpt: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MemoDetail = MemoSummary & {
  contentJson: TiptapDoc;
  contentMarkdown: string;
  contentText: string;
  contentHash: string;
  sourceMemoIds: string[];
  mergeSourceCount: number;
  mergedIntoMemoId: string | null;
};

export type MemoTemplate = {
  id: string;
  name: string;
  description: string | null;
  title: string | null;
  contentJson: TiptapDoc;
  contentMarkdown: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type MemoEditSession = {
  id: string;
  memoId: string;
  baseRevision: number;
  baseContentHash: string;
  expiresAt: string;
};

export type MemoRevision = {
  id: string;
  memoId: string;
  revision: number;
  title: string | null;
  tags: string[];
  contentMarkdown: string;
  contentText: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
};

export type ResourceKind = "image" | "attachment";

export type Resource = {
  id: string;
  memoId: string;
  originalMemoId: string | null;
  kind: ResourceKind;
  mimeType: string | null;
  filename: string | null;
  byteSize: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type ResourceListItem = Resource & {
  memoTitle: string | null;
  memoExcerpt: string | null;
  memoDeleted: boolean;
};

export type ResourceStorageSummary = {
  totalCount: number;
  totalBytes: number;
  imageCount: number;
  attachmentCount: number;
};

export type ObjectStorageSettings = {
  provider: "builtin" | "s3";
  displayName: string;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  accessKeyId: string | null;
  hasSecretAccessKey: boolean;
  forcePathStyle: boolean;
  objectPrefix: string;
  encryptionConfigured: boolean;
};

export type AiProvider = "openai-compatible" | "anthropic" | "google";

export type AiModelConfig = {
  id: string;
  providerConfigId: string;
  modelId: string;
  displayName: string;
};

export type AiProviderConfig = {
  id: string;
  provider: AiProvider;
  displayName: string;
  baseUrl: string;
  isEnabled: boolean;
  hasApiKey: boolean;
  models: AiModelConfig[];
};

export type AiSettings = {
  providers: AiProviderConfig[];
  defaultModelId: string | null;
  encryptionConfigured: boolean;
  readOnly: boolean;
};

export type AiPromptTemplate = {
  id: string;
  origin: "default" | "custom";
  seedKey: Exclude<AiAction, "custom"> | null;
  action: AiAction;
  parameterKind: AiPromptParameterKind;
  resultMode: AiPromptResultMode;
  nameCustomized: boolean;
  descriptionCustomized: boolean;
  instructionCustomized: boolean;
  name: string;
  description: string | null;
  instruction: string;
  createdAt: string;
  updatedAt: string;
};

export type AiDiscoveredModel = {
  modelId: string;
  displayName: string;
};

export type AiStreamEvent =
  | { type: "start" }
  | { type: "text-delta"; text: string }
  | { type: "finish"; finishReason?: string; inputTokens?: number; outputTokens?: number }
  | { type: "error"; code: string; message: string };

export type ApiToken = {
  id: string;
  name: string;
  token: string | null;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  isRevoked: boolean;
  createdAt: string;
};

export type CreatedApiToken = {
  token: string;
  apiToken: ApiToken;
};

export type TagSummary = {
  name: string;
  memoCount: number;
  updatedAt: string | null;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: "owner" | "member";
};

export type InstanceUser = AuthUser & {
  isDisabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AuthSession = {
  authRequired: boolean;
  authenticated: boolean;
  demoMode: boolean;
  user: AuthUser | null;
  sessionToken?: string;
};

export type LoginDeviceSession = {
  id: string;
  userAgent: string | null;
  label: string | null;
  ipAddress: string | null;
  ipCountry: string | null;
  ipRegion: string | null;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
