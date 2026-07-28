import type {
  AuthSession,
  LoginDeviceSession,
  InstanceUser,
  ApiToken,
  CreatedApiToken,
  JsonBackupMemo,
  JsonBackupNotebook,
  JsonBackupRevision,
  MemoDetail,
  MemoTemplate,
  MemoEditSession,
  MemoRevision,
  MemoSummary,
  Notebook,
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
  TagSummary,
  TiptapDoc,
  SyncBootstrapResponse,
  SyncChangesResponse,
} from "@edgeever/shared";
import type { MemoFilterMode, MemoSortMode } from "./app-helpers";

type ListNotebooksResponse = {
  notebooks: Notebook[];
};

type ListMemosResponse = {
  memos: MemoSummary[];
  totalCount: number;
  nextCursor: string | null;
};

type ListMemoRevisionsResponse = {
  revisions: MemoRevision[];
};

type ListResourcesResponse = {
  resources: ResourceListItem[];
  summary: ResourceStorageSummary;
};

type ListTagsResponse = {
  tags: TagSummary[];
};

export type { SyncBootstrapResponse, SyncChangesResponse };

type ListApiTokensResponse = {
  apiTokens: ApiToken[];
  availableScopes: string[];
};

type ListUsersResponse = { users: InstanceUser[] };
type UserResponse = { user: InstanceUser };
type ListLoginDeviceSessionsResponse = { sessions: LoginDeviceSession[] };

const WEB_DEVICE_ID_STORAGE_KEY = "edgeever.web.device-id";
export const DESKTOP_API_BASE_URL_STORAGE_KEY = "edgeever.desktop.api-base-url";
const DESKTOP_SESSION_STORAGE_KEY = "edgeever.desktop.session";

export const getCachedDesktopSession = (): AuthSession | null => {
  if (typeof window === "undefined" || !window.edgeeverDesktop?.isAvailable) return null;
  try {
    const value = window.localStorage.getItem(DESKTOP_SESSION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as AuthSession;
    return parsed && typeof parsed === "object" && "authenticated" in parsed ? parsed : null;
  } catch {
    return null;
  }
};

export const cacheDesktopSession = (session: AuthSession) => {
  if (typeof window === "undefined" || !window.edgeeverDesktop?.isAvailable) return;
  try {
    window.localStorage.setItem(DESKTOP_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A session cache is an offline convenience and must never block login.
  }
};

export const clearCachedDesktopSession = () => {
  if (typeof window === "undefined" || !window.edgeeverDesktop?.isAvailable) return;
  try {
    window.localStorage.removeItem(DESKTOP_SESSION_STORAGE_KEY);
  } catch {
    // Ignore restricted storage contexts.
  }
};

export const getConfiguredDesktopApiBaseUrl = () => {
  if (typeof window === "undefined") return "";
  const bridgeUrl = (window.edgeeverDesktop?.apiBaseUrl ?? "").trim();
  if (bridgeUrl) return bridgeUrl.replace(/\/$/, "");

  try {
    return (window.localStorage.getItem(DESKTOP_API_BASE_URL_STORAGE_KEY) ?? "").trim().replace(/\/$/, "");
  } catch {
    return "";
  }
};

export const isDesktopInstanceConfigurationRequired = () =>
  typeof window !== "undefined" &&
  Boolean(window.edgeeverDesktop?.isAvailable) &&
  window.location.protocol === "file:" &&
  !getConfiguredDesktopApiBaseUrl();

export const saveDesktopApiBaseUrl = (value: string) => {
  const normalized = value.trim().replace(/\/$/, "");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Desktop instance URL must use http or https");
  }

  window.localStorage.setItem(DESKTOP_API_BASE_URL_STORAGE_KEY, normalized);
  void window.edgeeverDesktop?.setApiBaseUrl(normalized);
  return normalized;
};

const createWebDeviceId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `web-${uuid}`
    : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

const getOrCreateWebDeviceId = () => {
  try {
    const existing = window.localStorage.getItem(WEB_DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;

    const deviceId = createWebDeviceId();
    window.localStorage.setItem(WEB_DEVICE_ID_STORAGE_KEY, deviceId);
    return deviceId;
  } catch {
    return createWebDeviceId();
  }
};

type MemoResponse = {
  memo: MemoDetail;
};

type TemplateResponse = {
  template: MemoTemplate;
};

type NotebookResponse = {
  notebook: Notebook;
};

type ResourceResponse = {
  resource: Resource;
};

export type MarkdownExportPage = {
  memos: MemoDetail[];
  resources: Resource[];
  totalCount: number;
  nextOffset: number | null;
};

export type JsonBackupPage = MarkdownExportPage & {
  revisions: JsonBackupRevision[];
};

export class ApiRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);

  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const baseUrl = getConfiguredDesktopApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = body && typeof body === "object" && "error" in body ? (body as { error?: { code?: string; message?: string } }).error : undefined;
    const message =
      body && typeof body === "object" && "error" in body
        ? error?.message
        : response.statusText;

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
    }

    throw new ApiRequestError(message || "Request failed", response.status, error?.code);
  }

  return response.json() as Promise<T>;
};

export const api = {
  getSession: () => request<AuthSession>("/api/v1/auth/session"),

  listLoginDeviceSessions: () =>
    request<ListLoginDeviceSessionsResponse>("/api/v1/auth/sessions"),

  revokeLoginDeviceSession: (sessionId: string) =>
    request<{ ok: true }>(`/api/v1/auth/sessions/${sessionId}`, { method: "DELETE" }),

  updateLoginDeviceSession: (sessionId: string, payload: { label: string | null }) =>
    request<{ ok: true }>(`/api/v1/auth/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  revokeOtherLoginDeviceSessions: () =>
    request<{ ok: true }>("/api/v1/auth/sessions", { method: "DELETE" }),

  login: (payload: { username: string; password: string }) =>
    request<AuthSession>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ ...payload, deviceId: getOrCreateWebDeviceId() }),
    }),

  changePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    request<{ ok: true }>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listUsers: () => request<ListUsersResponse>("/api/v1/users"),

  createUser: (payload: { username: string; displayName?: string | null; password: string }) =>
    request<UserResponse>("/api/v1/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateUser: (userId: string, payload: { displayName?: string | null; password?: string; isDisabled?: boolean }) =>
    request<UserResponse>(`/api/v1/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  logout: () =>
    request<{ ok: true }>("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  listNotebooks: () => request<ListNotebooksResponse>("/api/v1/notebooks"),

  syncBootstrap: (params?: { afterId?: string | null; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.afterId) search.set("afterId", params.afterId);
    if (params?.limit) search.set("limit", String(params.limit));
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return request<SyncBootstrapResponse>(`/api/v1/sync/bootstrap${suffix}`);
  },

  syncChanges: (params: { cursor: number; limit?: number }) => {
    const search = new URLSearchParams({ cursor: String(params.cursor) });
    if (params.limit) search.set("limit", String(params.limit));
    return request<SyncChangesResponse>(`/api/v1/sync/changes?${search.toString()}`);
  },

  createNotebook: (payload: { name: string; parentId?: string | null }) =>
    request<NotebookResponse>("/api/v1/notebooks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateNotebook: (notebookId: string, payload: { name?: string; parentId?: string | null; sortOrder?: number }) =>
    request<NotebookResponse>(`/api/v1/notebooks/${notebookId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteNotebook: (notebookId: string) =>
    request<{ ok: true }>(`/api/v1/notebooks/${notebookId}`, {
      method: "DELETE",
    }),

  restoreNotebook: (notebookId: string) =>
    request<NotebookResponse>(`/api/v1/notebooks/${notebookId}/restore`, {
      method: "POST",
    }),

  listTags: () => request<ListTagsResponse>("/api/v1/tags"),

  renameTag: (tag: string, name: string) =>
    request<{ ok: true; updated: number }>(`/api/v1/tags/${encodeURIComponent(tag)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  deleteTag: (tag: string) =>
    request<{ ok: true; updated: number }>(`/api/v1/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    }),

  listApiTokens: () => request<ListApiTokensResponse>("/api/v1/api-tokens"),

  createApiToken: (payload: { name: string; scopes: string[]; expiresAt?: string | null }) =>
    request<CreatedApiToken>("/api/v1/api-tokens", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  revokeApiToken: (tokenId: string) =>
    request<{ ok: true }>(`/api/v1/api-tokens/${tokenId}`, {
      method: "DELETE",
    }),

  listMemos: (params: {
    notebookId?: string | null;
    includeDescendants?: boolean;
    q?: string;
    trash?: boolean;
    sort?: MemoSortMode;
    filter?: MemoFilterMode;
    cursor?: string | null;
    limit?: number;
  }) => {
    const search = new URLSearchParams();

    if (params.notebookId) {
      search.set("notebookId", params.notebookId);
    }

    if (params.includeDescendants) {
      search.set("includeDescendants", "1");
    }

    if (params.q?.trim()) {
      search.set("q", params.q.trim());
    }

    if (params.trash) {
      search.set("trash", "1");
    }

    if (params.sort) {
      search.set("sort", params.sort);
    }

    if (params.filter && params.filter !== "all") {
      search.set("filter", params.filter);
    }

    if (params.cursor) {
      search.set("cursor", params.cursor);
    }

    if (params.limit) {
      search.set("limit", String(params.limit));
    }

    return request<ListMemosResponse>(`/api/v1/memos?${search.toString()}`);
  },

  createMemo: (payload: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[]; createdAt?: string; updatedAt?: string }) =>
    request<MemoResponse>("/api/v1/memos", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listTemplates: () => request<{ templates: MemoTemplate[] }>("/api/v1/templates"),

  createTemplate: (payload: { name: string; description?: string | null; memoId?: string; title?: string | null; contentMarkdown?: string; tags?: string[] }) =>
    request<TemplateResponse>("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateTemplate: (templateId: string, payload: { name?: string; description?: string | null; title?: string | null; contentMarkdown?: string; tags?: string[] }) =>
    request<TemplateResponse>(`/api/v1/templates/${templateId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  useTemplate: (templateId: string, notebookId: string) =>
    request<MemoResponse>(`/api/v1/templates/${templateId}/use`, {
      method: "POST",
      body: JSON.stringify({ notebookId }),
    }),

  deleteTemplate: (templateId: string) =>
    request<{ ok: true }>(`/api/v1/templates/${templateId}`, { method: "DELETE" }),

  moveMemos: (payload: { memoIds: string[]; notebookId: string }) =>
    request<{ ok: true; moved: number }>("/api/v1/memos/batch/move", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteMemos: (payload: { memoIds: string[]; permanent?: boolean }) =>
    request<{ ok: true; deleted: number }>("/api/v1/memos/batch/delete", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  emptyTrash: () =>
    request<{ ok: true; deleted: number }>("/api/v1/memos/trash/empty", {
      method: "DELETE",
    }),

  getMemo: (memoId: string, options?: { includeDeleted?: boolean }) => {
    const search = new URLSearchParams();

    if (options?.includeDeleted) {
      search.set("includeDeleted", "1");
    }

    const suffix = search.toString() ? `?${search.toString()}` : "";
    return request<MemoResponse>(`/api/v1/memos/${memoId}${suffix}`);
  },

  createMemoEditSession: (memoId: string) =>
    request<{ editSession: MemoEditSession }>(`/api/v1/memos/${memoId}/edit-sessions`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  listMemoRevisions: (memoId: string) =>
    request<ListMemoRevisionsResponse>(`/api/v1/memos/${memoId}/revisions`),

  restoreMemoRevision: (memoId: string, revisionId: string) =>
    request<MemoResponse>(`/api/v1/memos/${memoId}/revisions/${revisionId}/restore`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  listResources: () => request<ListResourcesResponse>("/api/v1/resources"),

  getMarkdownExportPage: (offset = 0, limit = 50) =>
    request<MarkdownExportPage>(`/api/v1/exports/markdown?offset=${offset}&limit=${limit}`),

  getJsonBackupPage: (offset = 0, limit = 25) =>
    request<JsonBackupPage>(`/api/v1/backups/json?offset=${offset}&limit=${limit}`),

  restoreJsonNotebooks: (notebooks: JsonBackupNotebook[]) =>
    request<{ ok: true }>("/api/v1/restores/json/notebooks", {
      method: "POST",
      body: JSON.stringify({ notebooks }),
    }),

  restoreJsonMemos: (memos: JsonBackupMemo[]) =>
    request<{ ok: true }>("/api/v1/restores/json/memos", {
      method: "POST",
      body: JSON.stringify({ memos }),
    }),

  restoreJsonResource: (resourceId: string, metadata: JsonBackupMemo["resources"][number], file: Blob) => {
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    form.append("file", file, metadata.filename || metadata.id);
    return request<{ ok: true }>(`/api/v1/restores/json/resources/${encodeURIComponent(resourceId)}`, {
      method: "PUT",
      body: form,
    });
  },

  getResourceBlob: async (resourceUrl: string) => {
    const baseUrl = getConfiguredDesktopApiBaseUrl();
    const response = await fetch(resourceUrl.startsWith("/") ? `${baseUrl}${resourceUrl}` : resourceUrl, { credentials: "include" });

    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
      }

      throw new ApiRequestError(response.statusText || "Resource download failed", response.status);
    }

    return response.blob();
  },

  uploadMemoResource: (memoId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);

    return request<ResourceResponse>(`/api/v1/memos/${memoId}/resources`, {
      method: "POST",
      body: form,
    });
  },

  updateMemo: (
    memoId: string,
    payload: {
      expectedRevision?: number;
      expectedContentHash?: string;
      editSessionId?: string;
      notebookId?: string;
      title?: string;
      isPinned?: boolean;
      contentJson?: TiptapDoc;
      contentMarkdown?: string;
      tags?: string[];
      allowDestructiveOverwrite?: boolean;
    }
  ) =>
    request<MemoResponse>(`/api/v1/memos/${memoId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteMemo: (memoId: string, options?: { permanent?: boolean }) => {
    const search = new URLSearchParams();

    if (options?.permanent) {
      search.set("permanent", "1");
    }

    const suffix = search.toString() ? `?${search.toString()}` : "";
    return request<{ ok: true }>(`/api/v1/memos/${memoId}${suffix}`, {
      method: "DELETE",
    });
  },

  restoreMemo: (memoId: string) =>
    request<MemoResponse>(`/api/v1/memos/${memoId}/restore`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  mergeMemos: (payload: { memoIds: string[]; notebookId?: string; title?: string }) =>
    request<MemoResponse>("/api/v1/memos/merge", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  resetDemo: () =>
    request<{ success: true }>("/api/v1/demo/reset", {
      method: "POST",
    }),
};
