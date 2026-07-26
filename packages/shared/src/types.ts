import type { TiptapDoc } from "./content";

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
