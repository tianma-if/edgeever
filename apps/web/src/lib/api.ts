import type {
  AuthSession,
  ApiToken,
  CreatedApiToken,
  MemoDetail,
  MemoEditSession,
  MemoRevision,
  MemoSummary,
  Notebook,
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
  TagSummary,
  TiptapDoc,
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

type ListApiTokensResponse = {
  apiTokens: ApiToken[];
  availableScopes: string[];
};

type MemoResponse = {
  memo: MemoDetail;
};

type NotebookResponse = {
  notebook: Notebook;
};

type ResourceResponse = {
  resource: Resource;
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

  const response = await fetch(path, {
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

  login: (payload: { username: string; password: string }) =>
    request<AuthSession>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  changePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    request<{ ok: true }>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  logout: () =>
    request<{ ok: true }>("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  listNotebooks: () => request<ListNotebooksResponse>("/api/v1/notebooks"),

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
};
