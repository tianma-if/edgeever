import { createEdgeEverClient } from "@edgeever/client";
import { resolveInstanceUrlInput, type AuthSession, type AuthUser } from "@edgeever/shared";
import { useQueryClient } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MISSING_MOBILE_SESSION_MESSAGE } from "./login-error";

const SESSION_KEY = "edgeever.mobile.session";
const DEVICE_ID_KEY = "edgeever.mobile.device-id";

const getOrCreateDeviceId = async () => {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;

  const randomPart = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const deviceId = `mobile-${Date.now().toString(36)}-${randomPart}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  return deviceId;
};

export type MobileSession = {
  baseUrl: string;
  token: string;
  user: AuthUser | null;
  /** Signed in with a recovery code: only the forced TOTP rebind screen may show. */
  mfaRebindRequired?: boolean;
};

export type MfaSignInInput = {
  baseUrl: string;
  challengeToken: string;
  code?: string;
  recoveryCode?: string;
  locale?: string;
};

type SessionContextValue = {
  isLoading: boolean;
  session: MobileSession | null;
  client: ReturnType<typeof createEdgeEverClient> | null;
  /** Throws the login error; `getMfaChallenge(error)` tells when a second step is needed. */
  signIn: (input: { baseUrl: string; username: string; password: string; locale?: string }) => Promise<void>;
  /** Second login step. Uses a client without `onUnauthorized`, so a 401 never drops a session. */
  completeMfaSignIn: (input: MfaSignInInput) => Promise<void>;
  /** Replaces the restricted session with the rotated token returned by `confirmTotpSetup`. */
  finishMfaRebind: (sessionToken?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

/** Detects a 403 `mfa_rebind_required` without consuming the body the SDK reads. */
const createRebindAwareFetch = (onRebindRequired: () => void): typeof fetch =>
  (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await expoFetch(input as string, init as Parameters<typeof expoFetch>[1]);
    if (response.status === 403) {
      try {
        const body = await response.clone().json() as { error?: { code?: string } } | null;
        if (body?.error?.code === "mfa_rebind_required") onRebindRequired();
      } catch {
        // Not JSON: an ordinary 403 for the caller to handle.
      }
    }
    return response;
  }) as typeof fetch;

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<MobileSession | null>(null);

  useEffect(() => {
    let mounted = true;

    SecureStore.getItemAsync(SESSION_KEY)
      .then((value) => {
        if (!mounted || !value) {
          return;
        }

        setSession(JSON.parse(value) as MobileSession);
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const sessionRef = useRef<MobileSession | null>(null);
  sessionRef.current = session;

  const persistSession = useCallback(async (nextSession: MobileSession) => {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
  }, []);

  const markRebindRequired = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.mfaRebindRequired) return;
    void persistSession({ ...current, mfaRebindRequired: true });
  }, [persistSession]);

  const client = useMemo(() => {
    if (!session) {
      return null;
    }

    return createEdgeEverClient({
      baseUrl: session.baseUrl,
      token: session.token,
      fetch: createRebindAwareFetch(markRebindRequired),
      directAiGeneration: true,
      onUnauthorized: () => {
        queryClient.clear();
        setSession(null);
        void SecureStore.deleteItemAsync(SESSION_KEY);
      },
    });
  }, [markRebindRequired, queryClient, session]);

  const acceptAuthSession = useCallback(async (baseUrl: string, authSession: AuthSession) => {
    if (!authSession.authenticated || !authSession.sessionToken) {
      throw new Error(MISSING_MOBILE_SESSION_MESSAGE);
    }

    queryClient.clear();
    await persistSession({
      baseUrl,
      token: authSession.sessionToken,
      user: authSession.user,
      ...(authSession.mfaRebindRequired ? { mfaRebindRequired: true } : {}),
    });
  }, [persistSession, queryClient]);

  const signIn = useCallback(async (input: { baseUrl: string; username: string; password: string; locale?: string }) => {
    const baseUrl = normalizeInstanceUrl(resolveInstanceUrlInput(input.baseUrl));
    const deviceId = await getOrCreateDeviceId();
    const loginClient = createEdgeEverClient({ baseUrl, fetch: expoFetch as typeof fetch });
    const authSession = await loginClient.login({
      username: input.username,
      password: input.password,
      deviceId,
      locale: input.locale,
    });

    await acceptAuthSession(baseUrl, authSession);
  }, [acceptAuthSession]);

  const completeMfaSignIn = useCallback(async (input: MfaSignInInput) => {
    const baseUrl = normalizeInstanceUrl(resolveInstanceUrlInput(input.baseUrl));
    // The challenge is bound to the device id sent with the password step.
    const deviceId = await getOrCreateDeviceId();
    const loginClient = createEdgeEverClient({ baseUrl, fetch: expoFetch as typeof fetch });
    const authSession = await loginClient.completeMfaLogin({
      challengeToken: input.challengeToken,
      ...(input.recoveryCode ? { recoveryCode: input.recoveryCode } : { code: input.code }),
      deviceId,
      locale: input.locale,
    });
    await acceptAuthSession(baseUrl, authSession);
  }, [acceptAuthSession]);

  const finishMfaRebind = useCallback(async (sessionToken?: string) => {
    const current = sessionRef.current;
    if (!current) return;
    const token = sessionToken || current.token;
    const refreshClient = createEdgeEverClient({ baseUrl: current.baseUrl, token, fetch: expoFetch as typeof fetch });
    const authSession = await refreshClient.getSession().catch(() => null);
    queryClient.clear();
    await persistSession({
      baseUrl: current.baseUrl,
      token,
      user: authSession?.user ?? current.user,
      ...(authSession?.mfaRebindRequired ? { mfaRebindRequired: true } : {}),
    });
  }, [persistSession, queryClient]);

  const signOut = useCallback(async () => {
    if (client) {
      await client.logout().catch(() => undefined);
    }

    queryClient.clear();
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setSession(null);
  }, [client, queryClient]);

  const value = useMemo(
    () => ({
      isLoading,
      session,
      client,
      signIn,
      completeMfaSignIn,
      finishMfaRebind,
      signOut,
    }),
    [client, completeMfaSignIn, finishMfaRebind, isLoading, session, signIn, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }

  return context;
};

const normalizeInstanceUrl = (value: string) => {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
};
