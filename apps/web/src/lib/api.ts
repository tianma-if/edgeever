import {
  ApiRequestError,
  createEdgeEverClient,
  type EdgeEverClientRequestContext,
} from "@edgeever/client";
import type { AuthSession } from "@edgeever/shared";
import { normalizeInstanceUrl } from "@edgeever/shared/public-demo";
import { createClientUuid } from "./client-id";

export { ApiRequestError };
export type {
  AiProviderCreatePayload,
  AiProviderUpdatePayload,
  InstanceHealth,
  InstanceRelease,
  JsonBackupPage,
  MarkdownExportPage,
  MemoShareResponse,
  SyncBootstrapResponse,
  SyncChangesResponse,
} from "@edgeever/client";

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
  if (typeof window === "undefined" || !window.edgeeverDesktop?.isAvailable) return "";

  try {
    const savedUrl = (window.localStorage.getItem(DESKTOP_API_BASE_URL_STORAGE_KEY) ?? "").trim();
    if (savedUrl) return savedUrl.replace(/\/$/, "");
  } catch {}

  const bridgeUrl = (window.edgeeverDesktop.apiBaseUrl ?? "").trim();
  return bridgeUrl.replace(/\/$/, "");
};

export class DesktopInstanceUrlError extends Error {
  constructor() {
    super("Desktop instance URL must use http or https");
    this.name = "DesktopInstanceUrlError";
  }
}

export const saveDesktopApiBaseUrl = async (value: string) => {
  const normalized = normalizeInstanceUrl(value);
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

const createWebDeviceId = () => `web-${createClientUuid()}`;

export const getOrCreateClientDeviceId = () => {
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

let desktopSessionRejected = false;
let unauthorizedConfirmPromise: Promise<boolean> | null = null;
let unauthorizedConfirmContext: string | null = null;

const isDesktopPublicRequest = (path: string) =>
  path === "/api/release" || path === "/api/v1/auth/login" || path === "/api/v1/auth/session";

const isAuthSession = (value: unknown): value is AuthSession => {
  if (!value || typeof value !== "object") return false;
  const session = value as AuthSession;
  return typeof session.authRequired === "boolean"
    && typeof session.authenticated === "boolean"
    && typeof session.demoMode === "boolean"
    && (session.authenticated
      ? Boolean(session.user && typeof session.user.id === "string" && session.user.id.trim())
      : session.authRequired && session.user === null);
};

/** Only an explicit authentication rejection confirms that a session is lost. */
const confirmSessionLost = async (): Promise<boolean> => {
  if (typeof window === "undefined") return true;
  const context = JSON.stringify([getConfiguredDesktopApiBaseUrl(), getDesktopSessionToken()]);
  if (unauthorizedConfirmPromise && unauthorizedConfirmContext === context) return unauthorizedConfirmPromise;

  const promise = (async () => {
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
      if (!response.ok) return response.status === 401;
      const session: unknown = await response.json().catch(() => null);
      return isAuthSession(session) && session.authenticated === false;
    } catch {
      return false;
    } finally {
      queueMicrotask(() => {
        if (unauthorizedConfirmPromise === promise) {
          unauthorizedConfirmPromise = null;
          unauthorizedConfirmContext = null;
        }
      });
    }
  })();

  unauthorizedConfirmPromise = promise;
  unauthorizedConfirmContext = context;
  return promise;
};

const notifyUnauthorized = async (isDesktop: boolean, rejectedDesktopSessionToken?: string) => {
  const baseUrl = getConfiguredDesktopApiBaseUrl();
  if (isDesktop && desktopSessionRejected) return;

  if (isDesktop && rejectedDesktopSessionToken) {
    if (getDesktopSessionToken() !== rejectedDesktopSessionToken) return;
    const sessionLost = await confirmSessionLost();
    if (!sessionLost || getConfiguredDesktopApiBaseUrl() !== baseUrl
      || getDesktopSessionToken() !== rejectedDesktopSessionToken) return;
    clearCachedDesktopSession();
    desktopSessionRejected = true;
    window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
    return;
  }

  const sessionLost = await confirmSessionLost();
  if (!sessionLost || getConfiguredDesktopApiBaseUrl() !== baseUrl) return;

  if (isDesktop) {
    clearCachedDesktopSession();
    desktopSessionRejected = true;
  }
  window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
};

const beforeRequest = ({ path }: EdgeEverClientRequestContext) => {
  const isDesktop = Boolean(typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable);
  if (isDesktop && desktopSessionRejected && !isDesktopPublicRequest(path)) {
    throw new ApiRequestError("Authentication required", 401, "unauthorized");
  }
};

const handleUnauthorized = ({ path, token }: EdgeEverClientRequestContext) => {
  if (path === "/api/v1/auth/login" || path.startsWith("/api/public/") || typeof window === "undefined") return;
  // getSession handles its own response. A failed probe is not evidence of
  // rejection and must not launch a second probe that can race a new login.
  if (path === "/api/v1/auth/session") return;
  const isDesktop = Boolean(window.edgeeverDesktop?.isAvailable);
  void notifyUnauthorized(isDesktop, token);
};

const toUint8Array = (bytes: ArrayBuffer | Uint8Array | undefined) => {
  if (!bytes) return new Uint8Array();
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
};

const desktopProviderFetch: typeof fetch = async (input, init) => {
  init?.signal?.throwIfAborted();
  const bridge = window.edgeeverDesktop;
  if (!bridge?.openAiProviderStream || !bridge.onAiProviderStreamChunk) {
    throw new TypeError("Desktop AI transport is unavailable.");
  }
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  let bodyBytes: Uint8Array | undefined;
  if (init?.body instanceof FormData) {
    const multipart = new Request(url, { method: init.method ?? "POST", headers, body: init.body });
    multipart.headers.forEach((value, key) => { headers[key] = value; });
    bodyBytes = new Uint8Array(await multipart.arrayBuffer());
  }
  init?.signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const pending: Array<{ type: "data" | "end" | "error"; bytes?: ArrayBuffer | Uint8Array; message?: string }> = [];
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let cleanup = () => {};
  const stop = bridge.onAiProviderStreamChunk((id, chunk) => {
    if (id !== requestId) return;
    if (!streamController) {
      pending.push(chunk);
      return;
    }
    if (chunk.type === "data") streamController.enqueue(toUint8Array(chunk.bytes));
    else {
      if (chunk.type === "end") streamController.close();
      else streamController.error(new Error(chunk.message || "AI provider request failed."));
      cleanup();
    }
  });
  const abort = () => {
    bridge.cancelAiProviderStream(requestId);
    const reason = init?.signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
    if (streamController) streamController.error(reason);
    else pending.push({ type: "error", message: String(reason) });
    cleanup();
  };
  cleanup = () => {
    stop();
    init?.signal?.removeEventListener("abort", abort);
  };
  init?.signal?.addEventListener("abort", abort, { once: true });
  try {
    const opened = await bridge.openAiProviderStream(requestId, {
      url,
      method: init?.method,
      headers,
      body: typeof init?.body === "string" ? init.body : "",
      ...(bodyBytes ? { bodyBytes } : {}),
    });
    init?.signal?.throwIfAborted();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        for (const chunk of pending) {
          if (chunk.type === "data") controller.enqueue(toUint8Array(chunk.bytes));
          else {
            if (chunk.type === "end") controller.close();
            else controller.error(new Error(chunk.message || "AI provider request failed."));
            cleanup();
            break;
          }
        }
        pending.length = 0;
      },
      cancel() {
        abort();
      },
    });
    return new Response(body, { status: opened.status, headers: opened.headers });
  } catch (error) {
    cleanup();
    throw error;
  }
};

const desktopAiDirectEnabled = Boolean(
  (typeof __EDGEEVER_DESKTOP_BUILD__ !== "undefined" && __EDGEEVER_DESKTOP_BUILD__)
  || (typeof window !== "undefined" && window.edgeeverDesktop?.openAiProviderStream),
);

/** Native clients connect directly; Web can relay initial network/CORS failures. */
export const directProviderFetch: typeof fetch = (input, init) =>
  client.fetchAiProvider(input, init);

const client = createEdgeEverClient({
  baseUrl: getConfiguredDesktopApiBaseUrl,
  token: getDesktopSessionToken,
  beforeRequest,
  shouldAttachToken: (path) => path !== "/api/v1/auth/login",
  onUnauthorized: handleUnauthorized,
  directAiGeneration: desktopAiDirectEnabled,
  allowAiServerFallback: !desktopAiDirectEnabled,
  providerFetch: desktopAiDirectEnabled ? desktopProviderFetch : undefined,
});

export const api = {
  ...client,

  getSession: async () => {
    const baseUrl = getConfiguredDesktopApiBaseUrl();
    const token = getDesktopSessionToken();
    let session: AuthSession;
    try {
      session = await client.getSession();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401
        && getConfiguredDesktopApiBaseUrl() === baseUrl && getDesktopSessionToken() === token) {
        if (typeof window !== "undefined") {
          if (window.edgeeverDesktop?.isAvailable) {
            clearCachedDesktopSession();
            desktopSessionRejected = true;
          }
        }
      }
      throw error;
    }
    if (!isAuthSession(session)) throw new SyntaxError("Invalid authentication session response");
    if (getConfiguredDesktopApiBaseUrl() !== baseUrl || getDesktopSessionToken() !== token) {
      throw new Error("Authentication context changed while checking the session");
    }
    if (
      typeof window !== "undefined"
      && window.edgeeverDesktop?.isAvailable
      && !session.authenticated
      && getDesktopSessionToken()
    ) {
      clearCachedDesktopSession();
      desktopSessionRejected = true;
    }
    return session;
  },

  login: async (payload: { username: string; password: string; locale?: string }) => {
    const session = await client.login({ ...payload, deviceId: getOrCreateClientDeviceId() });
    desktopSessionRejected = false;
    return session;
  },
};

/** Freeze destination/authentication for this foreground import, not other callers. */
export const createNoteImportClient = (signal: AbortSignal, accountId: string | null, isCurrent: () => boolean) => {
  const baseUrl = getConfiguredDesktopApiBaseUrl();
  const token = getDesktopSessionToken();
  let importContext: string | undefined;
  return createEdgeEverClient({
    baseUrl,
    token,
    fetch: async (url, init) => {
      if (!isCurrent() || getConfiguredDesktopApiBaseUrl() !== baseUrl || getDesktopSessionToken() !== token) {
        throw new DOMException("importIdentityChanged", "AbortError");
      }
      const headers = new Headers(init?.headers);
      if (importContext) headers.set("x-edgeever-import-context", importContext);
      const response = await fetch(url, { ...init, headers, signal: init?.method === "DELETE" ? undefined : signal });
      if (String(url).split("?")[0].endsWith("/api/v1/imports/capabilities") && response.ok) {
        const capability = await response.clone().json() as { importContext?: string; accountId?: string | null };
        if (capability.accountId !== accountId || !capability.importContext) throw new Error("importIdentityChanged");
        importContext = capability.importContext;
      }
      return response;
    },
  });
};

/** Keep an established desktop account usable when its server is unavailable. */
export const getWorkspaceSession = async (): Promise<AuthSession> => {
  const baseUrl = getConfiguredDesktopApiBaseUrl();
  const token = getDesktopSessionToken();
  try {
    const session = await api.getSession();
    if (session.authenticated) await cacheDesktopSession(session);
    else clearCachedDesktopSession();
    return session;
  } catch (error) {
    const cached = getCachedDesktopSession();
    // Let the session query finish normally on an explicit rejection instead
    // of clearing the very query that is resolving it.
    if (error instanceof ApiRequestError && error.status === 401
      && baseUrl === getConfiguredDesktopApiBaseUrl() && !getDesktopSessionToken()) {
      return { authRequired: true, authenticated: false, demoMode: false, user: null };
    }
    const unavailable = error instanceof TypeError || error instanceof SyntaxError
      || (error instanceof ApiRequestError && (error.status >= 500 || error.status === 408 || error.status === 429));
    if (unavailable && cached?.authenticated && isAuthSession(cached)
      && baseUrl === getConfiguredDesktopApiBaseUrl() && token === getDesktopSessionToken()) {
      return cached;
    }
    throw error;
  }
};
