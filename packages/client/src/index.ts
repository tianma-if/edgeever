import type {
  ApiToken,
  AuthSession,
  LoginInput,
  LoginDeviceSession,
  InstanceUser,
  CreatedApiToken,
  JsonBackupMemo,
  JsonBackupNotebook,
  JsonBackupAiPrompt,
  JsonBackupRevision,
  MemoDetail,
  MemoEditSession,
  MemoRevision,
  MemoSummary,
  MemoShare,
  MemoTemplate,
  Notebook,
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
  PublicMemoShare,
  TagSummary,
  TiptapDoc,
  AiAction,
  AiTargetLanguage,
  AiTone,
  AiSettings,
  AiDiscoveredModel,
  AiProvider,
  AiPromptTemplate,
  AiPromptTemplateCreateInput,
  AiPromptTemplateUpdateInput,
  AiStreamEvent,
  AiTagSuggestionPromptUpdateInput,
  AiTagSuggestionsRequestInput,
  AiTagSuggestionsResponse,
} from "@edgeever/shared";

export type EdgeEverClientOptions = {
  baseUrl?: string;
  token?: string | null;
  fetch?: typeof fetch;
  onUnauthorized?: () => void;
};

export type MemoFilterMode = "all" | "tagged" | "untagged" | "pinned";
export type MemoSortMode = "updated-desc" | "created-desc" | "title-asc";

export type ListNotebooksResponse = {
  notebooks: Notebook[];
};

export type ListMemosResponse = {
  memos: MemoSummary[];
  totalCount: number;
  nextCursor: string | null;
};

export type ListMemoRevisionsResponse = {
  revisions: MemoRevision[];
};

export type ListResourcesResponse = {
  resources: ResourceListItem[];
  summary: ResourceStorageSummary;
};

export type ListTagsResponse = {
  tags: TagSummary[];
};

export type ListApiTokensResponse = {
  apiTokens: ApiToken[];
  availableScopes: string[];
};

export type ListUsersResponse = {
  users: InstanceUser[];
};

export type UserResponse = {
  user: InstanceUser;
};

export type ListLoginDeviceSessionsResponse = {
  sessions: LoginDeviceSession[];
};

export type MemoResponse = {
  memo: MemoDetail;
};

export type ListTemplatesResponse = {
  templates: MemoTemplate[];
};

export type TemplateResponse = {
  template: MemoTemplate;
};

export type MemoShareResponse = {
  share: MemoShare | null;
};

export type PublicMemoShareResponse = {
  share: PublicMemoShare;
};

export type NotebookResponse = {
  notebook: Notebook;
};

export type ResourceResponse = {
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

export type AiProviderCreatePayload = {
  provider: AiProvider;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  isEnabled: boolean;
  initialModelId?: string;
};

export type AiProviderUpdatePayload = {
  provider: AiProvider;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  isEnabled: boolean;
};

export type MobileSyncBootstrapPage = {
  notebooks: Notebook[];
  memos: MemoDetail[];
  snapshotCursor: number;
  syncIdentity?: string;
  totalCount: number;
  nextAfterId: string | null;
};

export type MobileSyncChange = {
  cursor: number;
  entityType: "notebook" | "memo";
  entityId: string;
  operation: "upsert" | "delete";
  notebook: Notebook | null;
  memo: MemoDetail | null;
};

export type MobileSyncChangesPage = {
  changes: MobileSyncChange[];
  cursor: number;
  hasMore: boolean;
  serverCursor?: number;
  syncIdentity?: string;
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

export const createEdgeEverClient = (options: EdgeEverClientOptions = {}) => {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);

    if (options.token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${options.token}`);
    }

    if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: "include",
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const error =
        body && typeof body === "object" && "error" in body
          ? (body as { error?: { code?: string; message?: string } }).error
          : undefined;
      const message = error?.message ?? response.statusText;

      if (response.status === 401) {
        options.onUnauthorized?.();
      }

      throw new ApiRequestError(message || "Request failed", response.status, error?.code);
    }

    return response.json() as Promise<T>;
  };

  return {
    getSession: () => request<AuthSession>("/api/v1/auth/session"),

    getPublicMemoShare: (token: string) =>
      request<PublicMemoShareResponse>(`/api/public/shares/${encodeURIComponent(token)}`),

    listLoginDeviceSessions: () =>
      request<ListLoginDeviceSessionsResponse>("/api/v1/auth/sessions"),

    revokeLoginDeviceSession: (sessionId: string) =>
      request<{ ok: true }>(`/api/v1/auth/sessions/${sessionId}`, { method: "DELETE" }),

    revokeOtherLoginDeviceSessions: () =>
      request<{ ok: true }>("/api/v1/auth/sessions", { method: "DELETE" }),

    login: (payload: LoginInput) =>
      request<AuthSession>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    changePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      request<{ ok: true }>("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getAiSettings: (locale?: string) => {
      const search = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      return request<AiSettings>(`/api/v1/ai/settings${search}`);
    },

    createAiProvider: (payload: AiProviderCreatePayload) =>
      request<AiSettings>("/api/v1/ai/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateAiProvider: (providerConfigId: string, payload: AiProviderUpdatePayload) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    deleteAiProvider: (providerConfigId: string) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}`, {
        method: "DELETE",
      }),

    testAiProvider: (providerConfigId: string, payload: { modelId: string }) =>
      request<{ ok: true; response: string }>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/test`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    discoverAiProviderModels: (providerConfigId: string) =>
      request<{ models: AiDiscoveredModel[] }>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/discover-models`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    addAiModel: (providerConfigId: string, payload: { modelId: string; displayName?: string }) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/models`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    deleteAiModel: (providerConfigId: string, modelConfigId: string) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/models/${encodeURIComponent(modelConfigId)}`, {
        method: "DELETE",
      }),

    updateDefaultAiModel: (modelConfigId: string | null) =>
      request<AiSettings>("/api/v1/ai/default-model", {
        method: "PUT",
        body: JSON.stringify({ modelConfigId }),
      }),

    updateAiTagSuggestionPrompt: (payload: AiTagSuggestionPromptUpdateInput, locale?: string) =>
      request<AiSettings>(`/api/v1/ai/tag-suggestion-prompt${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    listAiPrompts: (locale?: string) => {
      const search = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      return request<{ prompts: AiPromptTemplate[] }>(`/api/v1/ai/prompts${search}`);
    },

    createAiPrompt: (payload: AiPromptTemplateCreateInput) =>
      request<{ prompt: AiPromptTemplate }>("/api/v1/ai/prompts", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateAiPrompt: (
      promptId: string,
      payload: AiPromptTemplateUpdateInput,
    ) =>
      request<{ prompt: AiPromptTemplate }>(`/api/v1/ai/prompts/${encodeURIComponent(promptId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    deleteAiPrompt: (promptId: string) =>
      request<{ ok: true }>(`/api/v1/ai/prompts/${encodeURIComponent(promptId)}`, {
        method: "DELETE",
      }),

    restoreDefaultAiPrompts: (locale?: string) => {
      const search = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      return request<{ prompts: AiPromptTemplate[]; restoredCount: number }>(`/api/v1/ai/prompts/restore-defaults${search}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },

    suggestAiTags: (payload: AiTagSuggestionsRequestInput, signal?: AbortSignal) =>
      request<AiTagSuggestionsResponse>("/api/v1/ai/tag-suggestions", {
        method: "POST",
        body: JSON.stringify(payload),
        signal,
      }),

    streamAiGeneration: async (
      payload: {
        action: AiAction;
        promptId?: string;
        locale?: string;
        title: string;
        contentMarkdown: string;
        stream?: boolean;
        targetLanguage?: AiTargetLanguage;
        tone?: AiTone;
        instruction?: string;
      },
      streamOptions: { signal?: AbortSignal; onEvent: (event: AiStreamEvent) => void },
    ) => {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
      const response = await fetchImpl(`${baseUrl}/api/v1/ai/generate`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(payload),
        signal: streamOptions.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        if (response.status === 401) options.onUnauthorized?.();
        throw new ApiRequestError(body?.error?.message || response.statusText, response.status, body?.error?.code);
      }
      if (!response.body) throw new ApiRequestError("Streaming response is unavailable", 502, "ai_stream_unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (data) streamOptions.onEvent(JSON.parse(data) as AiStreamEvent);
        }
        if (done) break;
      }
      const trailingData = buffer.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (trailingData) streamOptions.onEvent(JSON.parse(trailingData) as AiStreamEvent);
    },

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

    getMobileSyncBootstrapPage: (afterId: string | null = null, limit = 100) => {
      const search = new URLSearchParams({ limit: String(limit) });
      if (afterId) {
        search.set("afterId", afterId);
      }
      return request<MobileSyncBootstrapPage>(`/api/v1/sync/bootstrap?${search.toString()}`);
    },

    getMobileSyncChanges: (cursor: number, limit = 100) =>
      request<MobileSyncChangesPage>(`/api/v1/sync/changes?cursor=${cursor}&limit=${limit}`),

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
      includeDescendants?: boolean;
      q?: string;
      tag?: string;
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

      if (params.tag?.trim()) {
        search.set("tag", params.tag.trim());
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

    createMemo: (payload: {
      notebookId: string;
      title?: string;
      contentMarkdown?: string;
      tags?: string[];
      createdAt?: string;
      updatedAt?: string;
    }) =>
      request<MemoResponse>("/api/v1/memos", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    listTemplates: () => request<ListTemplatesResponse>("/api/v1/templates"),

    useTemplate: (templateId: string, notebookId: string) =>
      request<MemoResponse>(`/api/v1/templates/${templateId}/use`, {
        method: "POST",
        body: JSON.stringify({ notebookId }),
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

    getMemoShare: (memoId: string) =>
      request<MemoShareResponse>(`/api/v1/memos/${memoId}/share`),

    createMemoShare: (memoId: string) =>
      request<{ share: MemoShare }>(`/api/v1/memos/${memoId}/share`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    revokeMemoShare: (memoId: string) =>
      request<{ ok: true }>(`/api/v1/memos/${memoId}/share`, { method: "DELETE" }),

    createMemoEditSession: (memoId: string) =>
      request<{ editSession: MemoEditSession }>(`/api/v1/memos/${memoId}/edit-sessions`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    listMemoRevisions: (memoId: string) => request<ListMemoRevisionsResponse>(`/api/v1/memos/${memoId}/revisions`),

    restoreMemoRevision: (memoId: string, revisionId: string) =>
      request<MemoResponse>(`/api/v1/memos/${memoId}/revisions/${revisionId}/restore`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    listResources: () => request<ListResourcesResponse>("/api/v1/resources"),

    renameResource: (resourceId: string, filename: string) =>
      request<ResourceResponse>(`/api/v1/resources/${encodeURIComponent(resourceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ filename }),
      }),

    deleteResource: (resourceId: string) =>
      request<{ ok: true }>(`/api/v1/resources/${encodeURIComponent(resourceId)}`, {
        method: "DELETE",
      }),

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

    restoreJsonAiPrompts: (prompts: JsonBackupAiPrompt[]) =>
      request<{ ok: true }>("/api/v1/restores/json/ai-prompts", {
        method: "POST",
        body: JSON.stringify({ prompts }),
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
      const headers = new Headers();

      if (options.token) {
        headers.set("Authorization", `Bearer ${options.token}`);
      }

      const response = await fetchImpl(`${baseUrl}${resourceUrl}`, {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          options.onUnauthorized?.();
        }

        throw new ApiRequestError(response.statusText || "Resource download failed", response.status);
      }

      return response.blob();
    },

    uploadMemoResource: (memoId: string, file: FormData) =>
      request<ResourceResponse>(`/api/v1/memos/${memoId}/resources`, {
        method: "POST",
        body: file,
      }),

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
};

const normalizeBaseUrl = (value?: string) => {
  if (!value) {
    return "";
  }

  return value.replace(/\/+$/, "");
};
