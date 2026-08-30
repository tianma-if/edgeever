import {
  ApiRequestError,
  createEdgeEverClient,
  type EdgeEverClientRequestContext,
} from "@edgeever/client";
import type { AuthSession } from "@edgeever/shared";
import { resolveInstanceUrlInput } from "@edgeever/shared";
import { readAiStreamingPreference } from "./ai-generation-preference";
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

const createWebDeviceId = () => `web-${createClientUuid()}`;

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
      queueMicrotask(() => {
        unauthorizedConfirmPromise = null;
      });
    }
  })();

  return unauthorizedConfirmPromise;
};

const notifyUnauthorized = async (isDesktop: boolean, rejectedDesktopSessionToken?: string) => {
  if (isDesktop && desktopSessionRejected) return;

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

const beforeRequest = ({ path }: EdgeEverClientRequestContext) => {
  const isDesktop = Boolean(typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable);
  if (isDesktop && desktopSessionRejected && !isDesktopPublicRequest(path)) {
    throw new ApiRequestError("Authentication required", 401, "unauthorized");
  }
};

const handleUnauthorized = ({ path, token }: EdgeEverClientRequestContext) => {
  if (path === "/api/v1/auth/login" || typeof window === "undefined") return;
  const isDesktop = Boolean(window.edgeeverDesktop?.isAvailable);
  void notifyUnauthorized(isDesktop, token);
};

const client = createEdgeEverClient({
  baseUrl: getConfiguredDesktopApiBaseUrl,
  token: getDesktopSessionToken,
  beforeRequest,
  shouldAttachToken: (path) => path !== "/api/v1/auth/login",
  onUnauthorized: handleUnauthorized,
});

export const api = {
  ...client,

  getSession: async () => {
    const session = await client.getSession();
    if (
      typeof window !== "undefined"
      && window.edgeeverDesktop?.isAvailable
      && !session.authenticated
      && getDesktopSessionToken()
    ) {
      clearCachedDesktopSession();
      desktopSessionRejected = true;
      window.dispatchEvent(new CustomEvent("edgeever:unauthorized"));
    }
    return session;
  },

  login: async (payload: { username: string; password: string }) => {
    const session = await client.login({ ...payload, deviceId: getOrCreateWebDeviceId() });
    desktopSessionRejected = false;
    return session;
  },

  streamAiGeneration: (
    payload: Parameters<typeof client.streamAiGeneration>[0],
    options: Parameters<typeof client.streamAiGeneration>[1],
  ) => client.streamAiGeneration(
    { ...payload, stream: payload.stream ?? readAiStreamingPreference() },
    options,
  ),
};
