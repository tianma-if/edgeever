import type {
  AuthSession,
  LoginDeviceSession,
  InstanceUser,
  ApiToken,
  CreatedApiToken,
  JsonBackupMemo,
  JsonBackupNotebook,
  JsonBackupAiPrompt,
  JsonBackupRevision,
  MemoDetail,
  MemoTemplate,
  MemoEditSession,
  MemoRevision,
  MemoSummary,
  MemoShare,
  Notebook,
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
  ObjectStorageSettings,
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
  PublicMemoShare,
  TagSummary,
  TiptapDoc,
  SyncBootstrapResponse,
  SyncChangesResponse,
} from "@edgeever/shared";
import { resolveInstanceUrlInput } from "@edgeever/shared";
import type { MemoFilterMode, MemoSortMode } from "./app-helpers";
import { readAiStreamingPreference } from "./ai-generation-preference";
import { createClientUuid } from "./client-id";

type ListNotebooksResponse = {
  notebooks: Notebook[];
};

export type InstanceRelease = {
  version: string;
  changes: Record<string, string[]>;
};

export type InstanceHealth = {
  ok: true;
  name: string;
  runtime: string;
  authMode: string;
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
type ObjectStorageSettingsResponse = {
  settings: ObjectStorageSettings;
  externalSettings?: ObjectStorageSettings | null;
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

const WEB_DEVICE_ID_STORAGE_KEY = "edgeever.web.device-id";
export const DESKTOP_API_BASE_URL_STORAGE_KEY = "edgeever.desktop.api-base-url";
const DESKTOP_SESSION_STORAGE_KEY = "edgeever.desktop.session";
let desktopSessionToken: string | null | undefined;

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

const getDesktopSessionToken = () => {
  if (typeof window === "undefined" || !window.edgeeverDesktop?.isAvailable) return undefined;
  if (desktopSessionToken) return desktopSessionToken;

  const storedToken = window.edgeeverDesktop.getSessionToken().trim();
  const legacyToken = getCachedDesktopSession()?.sessionToken?.trim() ?? "";
  // A legacy token remains only when secure persistence has not completed,
  // so it must win over a possibly stale encrypted file from an earlier login.
  desktopSessionToken = legacyToken || storedToken || null;
  return desktopSessionToken ?? undefined;
};

const setDesktopSessionToken = async (value: string) => {
  desktopSessionToken = value;
  try {
    await window.edgeeverDesktop?.setSessionToken(value);
    return true;
  } catch {
    return false;
  }
};

const clearDesktopSessionToken = () => {
  desktopSessionToken = null;
  void window.edgeeverDesktop?.clearSessionToken().catch(() => {});
};

export const cacheDesktopSession = async (session: AuthSession) => {
  if (typeof window === "undefined" || !window.edgeeverDesktop?.isAvailable) return;
  try {
    const cached = getCachedDesktopSession();
    const candidateToken = session.authenticated
      ? session.sessionToken ?? cached?.sessionToken
      : undefined;
    let tokenStoredSecurely = true;
    if (candidateToken) {
      tokenStoredSecurely = await setDesktopSessionToken(candidateToken);
    } else if (
      session.authenticated &&
      cached?.authenticated &&
      cached.user?.id !== session.user?.id
    ) {
      clearDesktopSessionToken();
    }
    const { sessionToken: _sessionToken, ...cachedSession } = session;
    window.localStorage.setItem(
      DESKTOP_SESSION_STORAGE_KEY,
      JSON.stringify(candidateToken && !tokenStoredSecurely ? { ...cachedSession, sessionToken: candidateToken } : cachedSession),
    );
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
  clearDesktopSessionToken();
};

export const getConfiguredDesktopApiBaseUrl = () => {
  if (typeof window === "undefined") return "";

  try {
    const savedUrl = (window.localStorage.getItem(DESKTOP_API_BASE_URL_STORAGE_KEY) ?? "").trim();
    if (savedUrl) return savedUrl.replace(/\/$/, "");
  } catch {}

  const bridgeUrl = (window.edgeeverDesktop?.apiBaseUrl ?? "").trim();
  return bridgeUrl.replace(/\/$/, "");
};

export class DesktopInstanceUrlError extends Error {
  constructor() {
    super("Desktop instance URL must use http or https");
    this.name = "DesktopInstanceUrlError";
  }
}

export const saveDesktopApiBaseUrl = async (value: string) => {
  const normalized = resolveInstanceUrlInput(value).replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new DesktopInstanceUrlError();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DesktopInstanceUrlError();
  }

  if (getConfiguredDesktopApiBaseUrl() !== normalized) {
    clearCachedDesktopSession();
  }
  await window.edgeeverDesktop?.setApiBaseUrl(normalized);
  window.localStorage.setItem(DESKTOP_API_BASE_URL_STORAGE_KEY, normalized);
  return normalized;
};

const createWebDeviceId = () => {
  return `web-${createClientUuid()}`;
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

export type MemoShareResponse = { share: MemoShare | null };

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

let desktopSessionRejected = false;
let unauthorizedConfirmPromise: Promise<boolean> | null = null;

const isDesktopPublicRequest = (path: string) =>
  path === "/api/release" || path === "/api/v1/auth/login" || path === "/api/v1/auth/session";

/**
 * Confirm the browser is actually logged out before forcing the login screen.
 * A single flaky 401 (or a mid-session local-dev auth mode flip) should not
 * wipe the whole workspace if the session cookie is still valid.
 */
const confirmSessionLost = async (): Promise<boolean> => {
  if (typeof window === "undefined") return true;
  if (unauthorizedConfirmPromise) return unauthorizedConfirmPromise;

  unauthorizedConfirmPromise = (async () => {
    try {
      const headers = new Headers();
      const isDesktop = Boolean(window.edgeeverDesktop?.isAvailable);
      const sessionToken = isDesktop ? getDesktopSessionToken() : undefined;
      if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
      const baseUrl = getConfiguredDesktopApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
        credentials: "include",
        headers,
      });
      if (!response.ok) return true;
      const session = await response.json().catch(() => null) as AuthSession | null;
      return !session?.authenticated;
    } catch {
      return true;
    } finally {
      // Allow a later 401 to re-check after this round finishes.
      queueMicrotask(() => {
        unauthorizedConfirmPromise = null;
      });
    }
  })();

  return unauthorizedConfirmPromise;
};

const notifyUnauthorized = async (isDesktop: boolean, rejectedDesktopSessionToken?: string) => {
  if (isDesktop && desktopSessionRejected) return;

  // A desktop API request authenticates with one explicit bearer token. A 401
  // therefore rejects that exact credential and does not need a second
  // /auth/session request. Compare against the current token first so a late
  // response from an older request cannot clear a freshly logged-in session.
  if (isDesktop && rejectedDesktopSessionToken) {
    if (getDesktopSessionToken() !== rejectedDesktopSessionToken) return;
    clearCachedDesktopSession();
    desktopSessionRejected = true;
    window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
    return;
  }

  const sessionLost = await confirmSessionLost();
  if (!sessionLost) return;

  if (isDesktop) {
    clearCachedDesktopSession();
    desktopSessionRejected = true;
  }
  window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  const isDesktop = Boolean(typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable);
  const sessionToken = isDesktop ? getDesktopSessionToken() : undefined;

  if (isDesktop && desktopSessionRejected && !isDesktopPublicRequest(path)) {
    throw new ApiRequestError("Authentication required", 401, "unauthorized");
  }

  if (sessionToken && !headers.has("Authorization") && path !== "/api/v1/auth/login") {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }

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
    const rayId = response.headers.get("cf-ray")?.trim();
    const error = body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: string; message?: string; details?: unknown } }).error
      : undefined;
    const isEdgeEverApiError = Boolean(error && typeof error === "object");
    const message =
      body && typeof body === "object" && "error" in body
        ? error?.message
        : response.statusText;
    const responseDiagnostics: ApiResponseDiagnostics = {
      cloudflareMitigated: response.headers.get("cf-mitigated") === "challenge",
      isEdgeEverApiError,
      ...(rayId ? { rayId } : {}),
    };

    if (response.status === 401 && path !== "/api/v1/auth/login") {
      void notifyUnauthorized(isDesktop, sessionToken);
    }

    throw new ApiRequestError(
      message || "Request failed",
      response.status,
      error?.code,
      error?.details,
      responseDiagnostics,
    );
  }

  const body = await response.json() as T;
  if (
    isDesktop &&
    path === "/api/v1/auth/session" &&
    sessionToken &&
    body &&
    typeof body === "object" &&
    "authenticated" in body &&
    body.authenticated === false
  ) {
    clearCachedDesktopSession();
    desktopSessionRejected = true;
    window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
  }
  if (path === "/api/v1/auth/login") {
    desktopSessionRejected = false;
  }
  return body;
};

const requestArrayBuffer = async (path: string) => {
  const isDesktop = Boolean(typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable);
  const sessionToken = isDesktop ? getDesktopSessionToken() : undefined;
  const headers = new Headers();
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  const response = await fetch(`${getConfiguredDesktopApiBaseUrl()}${path}`, {
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (response.status === 401) void notifyUnauthorized(isDesktop, sessionToken);
    throw new ApiRequestError(body?.error?.message || response.statusText || "Binary download failed", response.status);
  }
  return response.arrayBuffer();
};

export const api = {
  getInstanceHealth: () => request<InstanceHealth>("/api/health"),

  getInstanceRelease: () => request<InstanceRelease>("/api/release"),

  getSession: () => request<AuthSession>("/api/v1/auth/session"),

  getPublicMemoShare: (token: string) =>
    request<{ share: PublicMemoShare }>(`/api/public/shares/${encodeURIComponent(token)}`),

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

  streamAiGeneration: async (
    payload: AiGenerateInput,
    options: { signal?: AbortSignal; onEvent: (event: AiStreamEvent) => void },
  ) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    const sessionToken = typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable
      ? getDesktopSessionToken()
      : undefined;
    if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
    const response = await fetch(`${getConfiguredDesktopApiBaseUrl()}/api/v1/ai/generate`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        ...payload,
        stream: payload.stream ?? readAiStreamingPreference(),
      }),
      signal: options.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
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
        if (data) options.onEvent(JSON.parse(data) as AiStreamEvent);
      }
      if (done) break;
    }
    const trailingData = buffer.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (trailingData) options.onEvent(JSON.parse(trailingData) as AiStreamEvent);
  },

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

  listMemoRevisions: (memoId: string) =>
    request<ListMemoRevisionsResponse>(`/api/v1/memos/${memoId}/revisions`),

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
    const baseUrl = getConfiguredDesktopApiBaseUrl();
    const response = await fetch(resourceUrl.startsWith("/") ? `${baseUrl}${resourceUrl}` : resourceUrl, { credentials: "include" });

    if (!response.ok) {
      if (response.status === 401) {
        void notifyUnauthorized(Boolean(window.edgeeverDesktop?.isAvailable));
      }

      throw new ApiRequestError(response.statusText || "Resource download failed", response.status);
    }

    return response.blob();
  },

  downloadGithubPluginAsset: (
    owner: string,
    repository: string,
    assetId: number,
    assetName: "manifest.json" | "main.js" | "styles.css",
  ) => requestArrayBuffer(
    `/api/v1/plugins/github/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/assets/${assetId}/${encodeURIComponent(assetName)}`,
  ),

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
