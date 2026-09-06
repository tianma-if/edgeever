import { createPluginCapabilities } from './plugin-capabilities';
import type {
  CompanionMemory,
  CompanionDiscoverySettings,
  CompanionDiscoverySettingsInput,
  CompanionDiscoveryItem,
  CompanionAction,
  CompanionTurn,
  CompanionTurnInput,
  CompanionEvent,
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
  ScheduledTask,
  ScheduledTaskRun,
  Notebook,
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
  ObjectStorageSettings,
  PublicMemoShare,
  TagSummary,
  TiptapDoc,
  AiSettings,
  AiDiscoveredModel,
  AiProvider,
  AiPromptTemplate,
  AiPromptTemplateCreateInput,
  AiPromptTemplateUpdateInput,
  AiStreamEvent,
  AiGenerateInput,
  AiTagSuggestionPromptUpdateInput,
  AiTagSuggestionsRequestInput,
  AiTagSuggestionsResponse,
  SyncBootstrapResponse,
  SyncChange,
  SyncChangesResponse,
  DeploymentMetadata,
  PluginPublicFetchRequest,
  PluginPublicFetchResponse,
} from "@edgeever/shared";

const MAX_SINGLE_REQUEST_UPLOAD_BYTES = 5 * 1024 * 1024;

async function consumeEventStream<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (frame: string) => {
    const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
    if (data) onEvent(JSON.parse(data) as T);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) emit(frame);
      if (done) break;
    }
    if (buffer) emit(buffer);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export type EdgeEverClientRequestContext = {
  path: string;
  token?: string;
};

export type EdgeEverClientOptions = {
  baseUrl?: string | (() => string);
  token?: string | null | (() => string | null | undefined);
  fetch?: typeof fetch;
  beforeRequest?: (context: EdgeEverClientRequestContext) => void | Promise<void>;
  shouldAttachToken?: (path: string) => boolean;
  onUnauthorized?: (context: EdgeEverClientRequestContext) => void | Promise<void>;
};

export type MultipartResourceUploadSource = {
  filename: string;
  mimeType: string;
  byteSize: number;
  readPart: (start: number, end: number) => Promise<Blob>;
};

export type InstanceHealth = {
  ok: true;
  name: string;
  runtime?: string | null;
  containerImageSource?: "official-ghcr" | "official-cn-mirror" | "custom" | "unknown" | string | null;
  authMode?: string | null;
  build?: string | null;
  deployment?: DeploymentMetadata | null;
  migration?: string | null;
  storage?: {
    database?: "d1" | "sqlite" | string | null;
    resources?: "r2" | "filesystem" | "s3" | string | null;
  } | null;
  objectStorageProvider?: "builtin" | "s3" | "unknown" | string | null;
};

export type InstanceRelease = {
  version: string;
  changes: Record<string, readonly string[]>;
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

export type ObjectStorageSettingsResponse = {
  settings: ObjectStorageSettings;
  externalSettings?: ObjectStorageSettings | null;
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

export type ListScheduledTasksResponse = {
  tasks: ScheduledTask[];
};

export type ScheduledTaskResponse = {
  task: ScheduledTask;
};

export type ScheduledTaskRunResponse = {
  run: ScheduledTaskRun;
};

export type ScheduledTaskRunsResponse = {
  runs: ScheduledTaskRun[];
  totalCount: number;
  nextOffset: number | null;
};

export type ScheduledTaskRunHistoryItem = ScheduledTaskRun & {
  taskName: string;
  pluginId: string;
  ownerPluginId: string | null;
  pluginScheduleKey: string | null;
};

export type ScheduledTaskRunHistoryResponse = {
  runs: ScheduledTaskRunHistoryItem[];
  totalCount: number;
  nextOffset: number | null;
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

export type ResourceUploadResponse = {
  upload: {
    id: string;
    resourceId: string;
    partSize: number;
    partCount: number;
    byteSize: number;
    expiresAt: string;
  };
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

/** @deprecated Use SyncBootstrapResponse; kept for mobile source compatibility. */
export type MobileSyncBootstrapPage = SyncBootstrapResponse;

/** @deprecated Use SyncChange; kept for mobile source compatibility. */
export type MobileSyncChange = SyncChange;

/** @deprecated Use SyncChangesResponse; kept for mobile source compatibility. */
export type MobileSyncChangesPage = SyncChangesResponse;

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  responseDiagnostics?: ApiResponseDiagnostics;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    responseDiagnostics?: ApiResponseDiagnostics,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.responseDiagnostics = responseDiagnostics;
  }
}

export type ApiResponseDiagnostics = {
  cloudflareMitigated: boolean;
  isEdgeEverApiError: boolean;
  rayId?: string;
};

export type { SyncBootstrapResponse, SyncChangesResponse };

export const createEdgeEverClient = (options: EdgeEverClientOptions = {}) => {
  const getFetch = () => options.fetch ?? globalThis.fetch;
  const getBaseUrl = () => normalizeBaseUrl(
    typeof options.baseUrl === "function" ? options.baseUrl() : options.baseUrl,
  );
  const getToken = () => {
    const token = typeof options.token === "function" ? options.token() : options.token;
    return token || undefined;
  };

  const send = async (
    path: string,
    init?: RequestInit,
    requestOptions?: { attachToken?: boolean; setJsonContentType?: boolean },
  ) => {
    const token = getToken();
    const context: EdgeEverClientRequestContext = { path, ...(token ? { token } : {}) };
    await options.beforeRequest?.(context);

    const headers = new Headers(init?.headers);
    const attachToken = requestOptions?.attachToken
      ?? options.shouldAttachToken?.(path)
      ?? true;

    if (token && attachToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (
      requestOptions?.setJsonContentType !== false
      && !(init?.body instanceof FormData)
      && !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    const requestUrl = isAbsoluteHttpUrl(path) ? path : `${getBaseUrl()}${path}`;
    const response = await getFetch()(requestUrl, {
      credentials: "include",
      ...init,
      headers,
    });

    return { context, response };
  };

  const throwRequestError = async (
    context: EdgeEverClientRequestContext,
    response: Response,
    fallbackMessage = "Request failed",
  ): Promise<never> => {
    const body = await response.json().catch(() => null);
    const rayId = response.headers.get("cf-ray")?.trim();
    const error =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { code?: string; message?: string; details?: unknown } }).error
        : undefined;
    const responseDiagnostics: ApiResponseDiagnostics = {
      cloudflareMitigated: response.headers.get("cf-mitigated") === "challenge",
      isEdgeEverApiError: Boolean(error && typeof error === "object"),
      ...(rayId ? { rayId } : {}),
    };

    if (response.status === 401) {
      void options.onUnauthorized?.(context);
    }

    throw new ApiRequestError(
      error?.message || response.statusText || fallbackMessage,
      response.status,
      error?.code,
      error?.details,
      responseDiagnostics,
    );
  };

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const { context, response } = await send(path, init);

    if (!response.ok) {
      await throwRequestError(context, response);
    }

    return response.json() as Promise<T>;
  };

  const requestPluginPublic = async (input: PluginPublicFetchRequest, signal?: AbortSignal): Promise<PluginPublicFetchResponse> => {
    const { context, response } = await send("/api/v1/plugins/network/fetch", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
    const upstreamStatus = response.headers.get("x-edgeever-upstream-status");
    if (!response.ok || !upstreamStatus) await throwRequestError(context, response, "Public network request failed");
    const status = Number(upstreamStatus);
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("Invalid public network response status");
    const headers: Record<string, string> = {};
    for (const [key, value] of response.headers) {
      const prefix = "x-edgeever-upstream-header-";
      if (key.startsWith(prefix)) headers[key.slice(prefix.length)] = value;
    }
    return {
      url: input.url,
      status,
      statusText: decodeURIComponent(response.headers.get("x-edgeever-upstream-status-text") ?? ""),
      headers,
      body: await response.arrayBuffer(),
    };
  };

  const requestResourceResponse = async (path: string, init?: RequestInit) => {
    const isAbsolute = isAbsoluteHttpUrl(path);
    const { context, response } = await send(path, init, {
      attachToken: !isAbsolute,
      setJsonContentType: false,
    });
    if (!response.ok) await throwRequestError(context, response, "Resource download failed");
    return response;
  };

  const requestBlob = async (path: string) => (await requestResourceResponse(path)).blob();

  const requestArrayBuffer = async (path: string) => {
    const { context, response } = await send(path, undefined, { setJsonContentType: false });
    if (!response.ok) await throwRequestError(context, response, "Binary download failed");
    return response.arrayBuffer();
  };

  const uploadMemoResourceParts = async (memoId: string, source: MultipartResourceUploadSource) => {
    const filename = source.filename.trim() || "attachment";
    const mimeType = source.mimeType || "application/octet-stream";
    const { upload } = await request<ResourceUploadResponse>(
      `/api/v1/memos/${encodeURIComponent(memoId)}/resource-uploads`,
      {
        method: "POST",
        body: JSON.stringify({ filename, mimeType, byteSize: source.byteSize }),
      },
    );

    try {
      for (let partNumber = 1; partNumber <= upload.partCount; partNumber += 1) {
        const start = (partNumber - 1) * upload.partSize;
        const chunk = await source.readPart(start, Math.min(start + upload.partSize, source.byteSize));
        let attempt = 0;
        while (true) {
          try {
            await request<{ part: { partNumber: number; byteSize: number } }>(
              `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/parts/${partNumber}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: chunk,
              },
            );
            break;
          } catch (error) {
            attempt += 1;
            const retryable = !(error instanceof ApiRequestError)
              || error.status === 408
              || error.status === 429
              || error.status >= 500;
            if (!retryable || attempt >= 3) throw error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 250));
          }
        }
      }
      return await request<ResourceResponse>(
        `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/complete`,
        { method: "POST", body: JSON.stringify({}) },
      );
    } catch (error) {
      await request<{ ok: true }>(`/api/v1/resource-uploads/${encodeURIComponent(upload.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    }
  };

  const uploadMemoResourceMultipart = (memoId: string, file: Blob) =>
    uploadMemoResourceParts(memoId, {
      filename: "name" in file && typeof file.name === "string" && file.name.trim()
        ? file.name
        : "attachment",
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      readPart: async (start, end) => file.slice(start, end),
    });

  const createResourceMultipartSink = (upload: ResourceUploadResponse["upload"]) => {
    let partNumber = 1;
    let bufferedBytes = 0;
    let receivedBytes = 0;
    let chunks: ArrayBuffer[] = [];
    let closed = false;

    const abort = async () => {
      if (closed) return;
      closed = true;
      chunks = [];
      bufferedBytes = 0;
      await request<{ ok: true }>(`/api/v1/resource-uploads/${encodeURIComponent(upload.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    };

    const sendPart = async () => {
      if (bufferedBytes === 0) return;
      const body = new Blob(chunks, { type: "application/octet-stream" });
      const currentPart = partNumber;
      chunks = [];
      bufferedBytes = 0;
      let attempt = 0;
      while (true) {
        try {
          await request<{ part: { partNumber: number; byteSize: number } }>(
            `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/parts/${currentPart}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body,
            },
          );
          partNumber += 1;
          return;
        } catch (error) {
          attempt += 1;
          const retryable = !(error instanceof ApiRequestError)
            || error.status === 408
            || error.status === 429
            || error.status >= 500;
          if (!retryable || attempt >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    };

    return {
      write: async (chunk: Uint8Array) => {
        if (closed) throw new Error("Resource restore upload is closed");
        let offset = 0;
        while (offset < chunk.byteLength) {
          const available = upload.partSize - bufferedBytes;
          const length = Math.min(available, chunk.byteLength - offset);
          const copy = new Uint8Array(length);
          copy.set(chunk.subarray(offset, offset + length));
          chunks.push(copy.buffer);
          bufferedBytes += length;
          receivedBytes += length;
          offset += length;
          if (bufferedBytes === upload.partSize) await sendPart();
        }
      },
      close: async () => {
        if (closed) throw new Error("Resource restore upload is closed");
        if (receivedBytes !== upload.byteSize) {
          await abort();
          throw new Error(`Resource restore size mismatch: expected ${upload.byteSize}, received ${receivedBytes}`);
        }
        try {
          await sendPart();
          const result = await request<ResourceResponse>(
            `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/complete`,
            { method: "POST", body: JSON.stringify({}) },
          );
          closed = true;
          return result;
        } catch (error) {
          await abort();
          throw error;
        }
      },
      abort,
    };
  };

  const createJsonResourceRestoreSink = async (
    resourceId: string,
    metadata: JsonBackupMemo["resources"][number],
  ) => {
    const { upload } = await request<ResourceUploadResponse>(
      `/api/v1/restores/json/resources/${encodeURIComponent(resourceId)}/uploads`,
      { method: "POST", body: JSON.stringify(metadata) },
    );
    return createResourceMultipartSink(upload);
  };

  return {
    getInstanceHealth: () => request<InstanceHealth>("/api/health"),
    ...createPluginCapabilities(request, requestPluginPublic),

    getInstanceRelease: () => request<InstanceRelease>("/api/release"),

    getSession: () => request<AuthSession>("/api/v1/auth/session"),

    getPublicMemoShare: (token: string) =>
      request<PublicMemoShareResponse>(`/api/public/shares/${encodeURIComponent(token)}`),

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

    getObjectStorageSettings: () =>
      request<ObjectStorageSettingsResponse>("/api/v1/instance/object-storage"),

    testObjectStorageConnection: (payload: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey?: string;
      forcePathStyle: boolean;
      objectPrefix: string;
    }) => request<{ ok: true }>("/api/v1/instance/object-storage/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    updateObjectStorageSettings: (payload:
      | { provider: "builtin" }
      | {
          provider: "s3";
          displayName: string;
          endpoint: string;
          region: string;
          bucket: string;
          accessKeyId: string;
          secretAccessKey?: string;
          forcePathStyle: boolean;
          objectPrefix: string;
        }) => request<ObjectStorageSettingsResponse>("/api/v1/instance/object-storage", {
      method: "PUT",
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

    testAiProvider: (providerConfigId: string, payload: {
      modelId: string;
      provider?: AiProvider;
      baseUrl?: string;
      apiKey?: string;
    }) =>
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

    listCompanionMemories: () => request<{ memories: CompanionMemory[] }>("/api/v1/companion/memories"),
    getCompanionDiscoverySettings: () => request<{ settings: CompanionDiscoverySettings }>("/api/v1/companion/discovery/settings"),
    saveCompanionDiscoverySettings: (input: CompanionDiscoverySettingsInput) => request<{ settings: CompanionDiscoverySettings }>("/api/v1/companion/discovery/settings", { method: "PUT", body: JSON.stringify(input) }),
    listCompanionDiscoveries: () => request<{ items: CompanionDiscoveryItem[] }>("/api/v1/companion/discovery"),
    checkCompanionDiscoveries: (locale: string, signal?: AbortSignal) => request<{ items: CompanionDiscoveryItem[] }>(`/api/v1/companion/discovery/check?locale=${encodeURIComponent(locale)}`, { method: "POST", body: "{}", signal }),
    acknowledgeCompanionDiscovery: (id: string, dismiss = false) => request<{ ok: true }>(`/api/v1/companion/discovery/${encodeURIComponent(id)}/${dismiss ? "dismiss" : "seen"}`, { method: "POST", body: "{}" }),
    rememberCompanionDiscoveryFeedback: (id: string) => request<{ ok: true }>(`/api/v1/companion/discovery/${encodeURIComponent(id)}/feedback`, { method: "POST", body: "{}" }),
    listCompanionActions: () => request<{ actions: CompanionAction[] }>("/api/v1/companion/actions"),
    applyCompanionAction: (id: string) => request<{ action: CompanionAction }>(`/api/v1/companion/actions/${encodeURIComponent(id)}/apply`, { method: "POST", body: "{}" }),
    dismissCompanionAction: (id: string) => request<{ action: CompanionAction }>(`/api/v1/companion/actions/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: "{}" }),
    saveCompanionMemory: (content: string, sourceTurnId?: string) => request<{ memory: CompanionMemory }>("/api/v1/companion/memories", {
      method: "POST", body: JSON.stringify({ content, sourceTurnId }),
    }),
    updateCompanionMemory: (memory: CompanionMemory, content: string) => request<{ memory: CompanionMemory }>(`/api/v1/companion/memories/${encodeURIComponent(memory.id)}`, {
      method: "PATCH", body: JSON.stringify({ content, version: memory.version }),
    }),
    forgetCompanionMemory: (memory: CompanionMemory) => request<{ ok: true }>(`/api/v1/companion/memories/${encodeURIComponent(memory.id)}?version=${memory.version}`, { method: "DELETE" }),
    listCompanionTurns: () => request<{ turns: CompanionTurn[] }>("/api/v1/companion/turns"),
    getCompanionTurn: (id: string) => request<{ turn: CompanionTurn }>(`/api/v1/companion/turns/${encodeURIComponent(id)}`),
    cancelCompanionTurn: (id: string) => request<{ ok: true }>(`/api/v1/companion/turns/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
    clearCompanionHistory: () => request<{ ok: true }>("/api/v1/companion/history", { method: "DELETE" }),
    exportCompanion: () => request<{ version: 2; controls: { useMemory: boolean; learningEnabled: boolean }; exportedAt: string; memories: CompanionMemory[]; turns: CompanionTurn[]; actions: CompanionAction[] }>("/api/v1/companion/export"),
    importCompanionMemories: (memories: { content: string; kind?: "explicit" | "inferred" }[], controls?: { useMemory: boolean; learningEnabled: boolean }) => request<{ memories: CompanionMemory[] }>("/api/v1/companion/import-memories", {
      method: "POST", body: JSON.stringify({ version: 2, memories, controls }),
    }),
    streamCompanion: async (payload: CompanionTurnInput, options: { signal?: AbortSignal; onEvent: (event: CompanionEvent) => void }) => {
      const { context, response } = await send("/api/v1/companion/turns", {
        method: "POST", body: JSON.stringify(payload), signal: options.signal,
      });
      if (!response.ok) await throwRequestError(context, response);
      if (!response.body) throw new ApiRequestError("Stream unavailable", 502, "companion_failed");
      await consumeEventStream(response.body, options.onEvent);
    },

    streamAiGeneration: async (
      payload: AiGenerateInput,
      streamOptions: { signal?: AbortSignal; onEvent: (event: AiStreamEvent) => void },
    ) => {
      const path = "/api/v1/ai/generate";
      const { context, response } = await send(path, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: streamOptions.signal,
      });
      if (!response.ok) {
        await throwRequestError(context, response);
      }
      if (!response.body) throw new ApiRequestError("Streaming response is unavailable", 502, "ai_stream_unavailable");
      await consumeEventStream(response.body, streamOptions.onEvent);
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
      contentJson?: TiptapDoc;
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

    createTemplate: (payload: {
      name: string;
      description?: string | null;
      memoId?: string;
      title?: string | null;
      contentMarkdown?: string;
      tags?: string[];
    }) => request<TemplateResponse>("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    updateTemplate: (templateId: string, payload: {
      name?: string;
      description?: string | null;
      title?: string | null;
      contentMarkdown?: string;
      tags?: string[];
    }) => request<TemplateResponse>(`/api/v1/templates/${templateId}`, {
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

    listScheduledTasks: (executorDeviceId?: string) => {
      const search = new URLSearchParams();
      if (executorDeviceId) search.set("executorDeviceId", executorDeviceId);
      const suffix = search.size > 0 ? `?${search.toString()}` : "";
      return request<ListScheduledTasksResponse>(`/api/v1/scheduled-tasks${suffix}`);
    },

    listScheduledTaskRunHistory: (offset = 0, limit = 50) => {
      const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      return request<ScheduledTaskRunHistoryResponse>(`/api/v1/scheduled-task-runs?${search.toString()}`);
    },

    listPluginScheduledTasks: (pluginId: string) => request<ListScheduledTasksResponse>(
      `/api/v1/scheduled-tasks/plugin/${encodeURIComponent(pluginId)}`,
    ),

    upsertPluginScheduledTask: (payload: {
      pluginId: string;
      scheduleKey: string;
      name: string;
      commandId: string;
      cronExpression: string;
      timezone: string;
      executorDeviceId: string;
      missedRunPolicy?: "run-once" | "skip";
      isEnabled?: boolean;
    }) => request<ScheduledTaskResponse>("/api/v1/scheduled-tasks/plugin-upsert", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    deletePluginScheduledTask: (pluginId: string, scheduleKey: string) => request<{ ok: true }>(
      `/api/v1/scheduled-tasks/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(scheduleKey)}`,
      { method: "DELETE" },
    ),

    createScheduledTask: (payload: {
      name: string;
      taskType: "plugin-command";
      taskPayload: { pluginId: string; commandId: string };
      cronExpression: string;
      timezone: string;
      executorDeviceId: string;
      missedRunPolicy?: "run-once" | "skip";
      isEnabled?: boolean;
    }) => request<ScheduledTaskResponse>("/api/v1/scheduled-tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    updateScheduledTask: (taskId: string, payload: {
      name?: string;
      taskPayload?: { pluginId: string; commandId: string };
      cronExpression?: string;
      timezone?: string;
      executorDeviceId?: string;
      missedRunPolicy?: "run-once" | "skip";
      isEnabled?: boolean;
    }) => request<ScheduledTaskResponse>(`/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

    deleteScheduledTask: (taskId: string) => request<{ ok: true }>(
      `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    ),

    listScheduledTaskRuns: (taskId: string, offset = 0, limit = 50) => {
      const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      return request<ScheduledTaskRunsResponse>(
        `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/runs?${search.toString()}`,
      );
    },

    claimScheduledTaskRun: (taskId: string, payload: {
      scheduledFor: string;
      executorDeviceId: string;
    }) => request<ScheduledTaskRunResponse>(
      `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/runs/claim`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

    finishScheduledTaskRun: (taskId: string, runId: string, payload: {
      executorDeviceId: string;
      status: "succeeded" | "failed";
      errorMessage?: string | null;
    }) => request<ScheduledTaskRunResponse>(
      `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}/finish`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

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

    updateResourceContent: (resourceId: string, file: Blob, expectedContentHash: string) => {
      const form = new FormData();
      form.append("file", file);
      form.append("expectedContentHash", expectedContentHash);
      form.append("mimeType", file.type || "application/octet-stream");
      if (file instanceof File) form.append("filename", file.name);
      return request<ResourceResponse>(`/api/v1/resources/${encodeURIComponent(resourceId)}/blob`, {
        method: "PUT",
        body: form,
      });
    },

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

    createJsonResourceRestoreSink,

    restoreJsonResource: async (resourceId: string, metadata: JsonBackupMemo["resources"][number], file: Blob) => {
      const sink = await createJsonResourceRestoreSink(resourceId, metadata);
      const reader = file.stream().getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          await sink.write(next.value);
        }
        await sink.close();
        return { ok: true as const };
      } catch (error) {
        await sink.abort();
        throw error;
      } finally {
        reader.releaseLock();
      }
    },

    getResourceResponse: (resourceUrl: string, init?: RequestInit) =>
      requestResourceResponse(resourceUrl, init),

    getResourceBlob: (resourceUrl: string) => requestBlob(resourceUrl),

    downloadGithubPluginAsset: (
      owner: string,
      repository: string,
      releaseTag: string,
      assetName: "manifest.json" | "main.js" | "styles.css",
    ) => requestArrayBuffer(
      `/api/v1/plugins/github/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases/${encodeURIComponent(releaseTag)}/assets/${encodeURIComponent(assetName)}`,
    ),

    uploadMemoResource: (memoId: string, file: Blob | FormData) => {
      // Small files do not benefit from an upload session's three round trips.
      // Keep large attachments on the bounded-memory, resumable path.
      if (!(file instanceof FormData) && file.size > MAX_SINGLE_REQUEST_UPLOAD_BYTES) {
        return uploadMemoResourceMultipart(memoId, file);
      }
      const form = file instanceof FormData ? file : new FormData();
      if (!(file instanceof FormData)) {
        const filename = "name" in file && typeof file.name === "string" && file.name.trim()
          ? file.name
          : "attachment";
        form.append("file", file, filename);
      }
      return request<ResourceResponse>(`/api/v1/memos/${encodeURIComponent(memoId)}/resources`, {
        method: "POST",
        body: form,
      });
    },

    uploadMemoResourceParts,

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
};

const normalizeBaseUrl = (value?: string) => {
  if (!value) {
    return "";
  }

  return value.replace(/\/+$/, "");
};

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value);
