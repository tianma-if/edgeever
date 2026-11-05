import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PwaUpdateNotice } from "@/components/PwaUpdateNotice";
import { PwaInstallProvider } from "@/components/PwaInstallContext";
import { PwaIosPrompt } from "@/components/PwaIosPrompt";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  api,
  cacheDesktopSession,
  clearCachedDesktopSession,
  getConfiguredDesktopApiBaseUrl,
  getWorkspaceSession,
  saveDesktopApiBaseUrl,
} from "@/lib/api";
import { classifyLoginError, getLoginProblemMessageKey } from "@/lib/login-error";
import { EVERNOTE_MIGRATION_PATH } from "@/lib/routes";
import { syncPublishedNoteBodyFont } from "@/lib/published-note-body-font";
import { getNoteWindowMemoId } from "@/lib/desktop-note-windows";
import { ApiRequestError, getMfaChallenge } from "@edgeever/client";
import type { AuthSession, MfaChallenge } from "@edgeever/shared";
import { twoFactorErrorKey } from "@/components/two-factor/TwoFactorSteps";

const EvernoteImportGuidePane = lazy(() =>
  import("@/components/EvernoteImportGuidePane").then((module) => ({ default: module.EvernoteImportGuidePane }))
);
const TotpRebindScreen = lazy(() => import("@/components/TotpRebindScreen").then((module) => ({ default: module.TotpRebindScreen })));
const LoginScreen = lazy(() => import("@/components/LoginScreen").then((module) => ({ default: module.LoginScreen })));
const WorkspaceApp = lazy(() => import("@/components/WorkspaceApp").then((module) => ({ default: module.WorkspaceApp })));
const PublicNotebookSharePage = lazy(() => import("@/components/PublicNotebookSharePage").then(module => ({ default: module.PublicNotebookSharePage })));
const PublicSharePage = lazy(() => import("@/components/PublicSharePage").then((module) => ({ default: module.PublicSharePage })));
const PublicTableFormPage = lazy(() => import("@/components/PublicTableFormPage").then((module) => ({ default: module.PublicTableFormPage })));
const NoteWindowApp = lazy(() => import("@/components/NoteWindowApp").then((module) => ({ default: module.NoteWindowApp })));
const NotebookSiteManagementPage = lazy(() => import("@/components/NotebookSiteManagementPage").then((module) => ({ default: module.NotebookSiteManagementPage })));

const AuthLoadingScreen = ({ title = "EdgeEver", detail }: { title?: string; detail?: string }) => (
  <div className="flex h-[100dvh] items-center justify-center bg-slate-50 px-6 text-center text-slate-700">
    <div role="status" aria-live="polite">
      <div className="text-sm font-semibold">{title}</div>
      {detail && <div className="mt-2 text-xs text-slate-500">{detail}</div>}
    </div>
  </div>
);

const EvernoteMigrationRoute = () => {
  const navigate = useNavigate();

  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      <EvernoteImportGuidePane
        onClose={() => {
          if (window.opener) {
            window.close();
            return;
          }

          navigate("/");
        }}
      />
    </Suspense>
  );
};

const AuthenticatedWorkspace = ({ siteManagement = false }: { siteManagement?: boolean }) => {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const desktopBridge = window.edgeeverDesktop;
  const [desktopScopeReady, setDesktopScopeReady] = useState(() => !desktopBridge?.isAvailable);
  const [desktopScopeError, setDesktopScopeError] = useState<Error | null>(null);
  const [desktopScopeAttempt, setDesktopScopeAttempt] = useState(0);
  const configuredDesktopApiBaseUrl = getConfiguredDesktopApiBaseUrl();

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: getWorkspaceSession,
    enabled: !desktopBridge?.isAvailable || Boolean(configuredDesktopApiBaseUrl),
    retry: false,
  });

  const desktopAccountId = sessionQuery.data?.authenticated ? sessionQuery.data.user?.id ?? null : null;

  useEffect(() => {
    if (!desktopAccountId) return;
    void syncPublishedNoteBodyFont();
  }, [desktopAccountId]);

  useEffect(() => {
    if (!desktopBridge?.isAvailable || sessionQuery.isLoading) return;
    let active = true;
    setDesktopScopeReady(false);
    setDesktopScopeError(null);
    void desktopBridge.setAccountScope(desktopAccountId).then(
      () => {
        if (active) setDesktopScopeReady(true);
      },
      (error) => {
        console.error("Failed to switch desktop account scope", error);
        if (active) setDesktopScopeError(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [desktopAccountId, desktopBridge, desktopScopeAttempt, sessionQuery.isLoading]);

  const [mfaLogin, setMfaLogin] = useState<{ challenge: MfaChallenge; username: string } | null>(null);
  const [mfaExpired, setMfaExpired] = useState(false);

  const loginMutation = useMutation({
    mutationFn: async (payload: { instanceUrl?: string; username: string; password: string }) => {
      setMfaExpired(false);
      if (desktopBridge?.isAvailable && payload.instanceUrl !== undefined) {
        await saveDesktopApiBaseUrl(payload.instanceUrl);
      }
      const session = await api.login({
        username: payload.username,
        password: payload.password,
        locale: i18n.resolvedLanguage,
      });
      await cacheDesktopSession(session);
      return session;
    },
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(["auth", "session"], session);
    },
    onError: (error, payload) => {
      const challenge = getMfaChallenge(error);
      if (challenge) setMfaLogin({ challenge, username: payload.username });
    },
  });

  const mfaMutation = useMutation({
    mutationFn: async (payload: { code: string } | { recoveryCode: string }) => {
      if (!mfaLogin) throw new Error("No pending sign-in challenge");
      const session = await api.completeMfaLogin({
        challengeToken: mfaLogin.challenge.challengeToken,
        ...payload,
        locale: i18n.resolvedLanguage,
      });
      await cacheDesktopSession(session);
      return session;
    },
    onSuccess: (session) => {
      setMfaLogin(null);
      loginMutation.reset();
      queryClient.clear();
      queryClient.setQueryData(["auth", "session"], session);
    },
    onError: (error) => {
      // A spent or expired challenge cannot be retried: ask for the password again.
      if (error instanceof ApiRequestError && error.code === "mfa_challenge_expired") {
        setMfaLogin(null);
        loginMutation.reset();
        mfaMutation.reset();
        setMfaExpired(true);
      }
    },
  });

  const completeRebind = async (sessionToken: string | undefined) => {
    const current = queryClient.getQueryData<AuthSession>(["auth", "session"]);
    if (sessionToken && current) {
      await cacheDesktopSession({ ...current, mfaRebindRequired: undefined, sessionToken });
    }
    const session = await getWorkspaceSession();
    // Keep the observed session query (clearing it would detach the observer)
    // and drop everything cached under the restricted session.
    queryClient.removeQueries({
      predicate: ({ queryKey }) => queryKey[0] !== "auth" || queryKey[1] !== "session",
    });
    queryClient.setQueryData(["auth", "session"], session);
  };

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      clearCachedDesktopSession();
      queryClient.clear();
      queryClient.setQueryData<AuthSession>(["auth", "session"], {
        authRequired: true,
        authenticated: false,
        demoMode: sessionQuery.data?.demoMode ?? false,
        user: null,
      });
    },
  });

  useEffect(() => {
    const handleUnauthorized = () => {
      const current = queryClient.getQueryData<AuthSession>(["auth", "session"]);
      clearCachedDesktopSession();
      // Keep the observed session query alive so this transition is delivered
      // even when a background request discovers that the session was revoked.
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] !== "auth" || queryKey[1] !== "session",
      });
      queryClient.setQueryData<AuthSession>(["auth", "session"], {
        authRequired: current?.authRequired ?? true,
        authenticated: false,
        demoMode: current?.demoMode ?? false,
        user: null,
      });
    };

    window.addEventListener("edgeever:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("edgeever:unauthorized", handleUnauthorized);
  }, [queryClient]);

  if (sessionQuery.isLoading) {
    return desktopBridge?.isAvailable
      ? <AuthLoadingScreen title={t("login.desktopStarting")} detail={t("login.desktopStartingDescription")} />
      : <AuthLoadingScreen />;
  }

  const session = sessionQuery.data;
  const problem = loginMutation.error && !getMfaChallenge(loginMutation.error)
    ? classifyLoginError(loginMutation.error, "login")
    : sessionQuery.error
      ? classifyLoginError(sessionQuery.error, "session")
      : null;
  const loginError = problem
    ? {
        message: t(getLoginProblemMessageKey(problem), "status" in problem ? { status: problem.status } : undefined),
        diagnosticCode: problem.diagnosticCode,
        rayId: problem.rayId,
      }
    : mfaExpired
      ? { message: t("twoFactor.loginExpired"), diagnosticCode: "mfa_challenge_expired" }
      : null;

  if (desktopBridge?.isAvailable && !desktopScopeReady) {
    if (desktopScopeError) {
      return (
        <main className="flex h-[100dvh] items-center justify-center bg-slate-50 px-4 text-slate-900">
          <section className="w-full max-w-md rounded-xl border border-rose-200 bg-card p-6 shadow-sm">
            <p className="text-sm leading-6 text-rose-800">{t("login.desktopScopeUnavailable")}</p>
            <Button className="mt-4" variant="outline" onClick={() => setDesktopScopeAttempt((value) => value + 1)}>
              {t("login.desktopScopeRetry")}
            </Button>
          </section>
        </main>
      );
    }
    return <AuthLoadingScreen title={t("login.desktopPreparingData")} detail={t("login.desktopPreparingDataDescription")} />;
  }

  if (!session?.authenticated) {
    return (
      <Suspense fallback={<AuthLoadingScreen />}>
        <LoginScreen
          error={loginError}
          instanceUrl={desktopBridge?.isAvailable ? configuredDesktopApiBaseUrl : undefined}
          isSubmitting={loginMutation.isPending}
          onSubmit={(payload) => loginMutation.mutate(payload)}
          mfa={mfaLogin ? {
            username: mfaLogin.username,
            isSubmitting: mfaMutation.isPending,
            error: mfaMutation.error && !(mfaMutation.error instanceof ApiRequestError && mfaMutation.error.code === "mfa_challenge_expired")
              ? (mfaMutation.error instanceof ApiRequestError && mfaMutation.error.status === 401
                ? t(mfaMutation.error.code === "invalid_recovery_code" ? "twoFactor.errorInvalidRecoveryCode" : "twoFactor.errorInvalidCode")
                : t(twoFactorErrorKey(mfaMutation.error)))
              : null,
            onSubmit: (payload) => mfaMutation.mutate(payload),
            onBack: () => {
              setMfaLogin(null);
              loginMutation.reset();
              mfaMutation.reset();
            },
          } : null}
        />
      </Suspense>
    );
  }

  if (session.mfaRebindRequired) {
    return (
      <Suspense fallback={<AuthLoadingScreen />}>
        <TotpRebindScreen
          isLoggingOut={logoutMutation.isPending}
          onLogout={() => logoutMutation.mutate()}
          onComplete={completeRebind}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      {siteManagement ? <NotebookSiteManagementPage /> : <WorkspaceApp
        authRequired={session.authRequired}
        demoMode={session.demoMode}
        isLoggingOut={logoutMutation.isPending}
        user={session.user}
        onLogout={() => logoutMutation.mutate()}
      />}
    </Suspense>
  );
};

export const App = () => {
  const [noteWindowMemoId] = useState(() => getNoteWindowMemoId());
  useEffect(() => {
    const bridge = window.edgeeverDesktop;
    const baseUrl = getConfiguredDesktopApiBaseUrl();
    // The main window owns the instance; a note window only edits its note.
    if (bridge?.isAvailable && baseUrl && !noteWindowMemoId) void bridge.setApiBaseUrl(baseUrl);
  }, [noteWindowMemoId]);

  if (noteWindowMemoId) {
    return (
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Suspense fallback={<AuthLoadingScreen />}>
          <NoteWindowApp memoId={noteWindowMemoId} />
        </Suspense>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <PwaInstallProvider>
        <Routes>
          <Route path="/share/notebook/:token/:memoId?" element={<Suspense fallback={<AuthLoadingScreen />}><PublicNotebookSharePage /></Suspense>} />
          <Route path="/s/:slug/:memoId?" element={<Suspense fallback={<AuthLoadingScreen />}><PublicNotebookSharePage /></Suspense>} />
          <Route path="/share/:token" element={<Suspense fallback={<AuthLoadingScreen />}><PublicSharePage /></Suspense>} />
          <Route path="/form/:token" element={<Suspense fallback={<AuthLoadingScreen />}><PublicTableFormPage /></Suspense>} />
          <Route path={EVERNOTE_MIGRATION_PATH} element={<EvernoteMigrationRoute />} />
          <Route path="/" element={<AuthenticatedWorkspace />} />
          <Route path="/settings" element={<AuthenticatedWorkspace />} />
          <Route path="/notebooks/:notebookId/site" element={<AuthenticatedWorkspace siteManagement />} />
          <Route path="/plugins" element={<AuthenticatedWorkspace />} />
          <Route path="/plugins/:pluginId" element={<AuthenticatedWorkspace />} />
          <Route path="/templates" element={<AuthenticatedWorkspace />} />
          <Route path="/ai-prompts" element={<AuthenticatedWorkspace />} />
          <Route path="/execution-center" element={<AuthenticatedWorkspace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <PwaUpdateNotice />
        <PwaIosPrompt />
      </PwaInstallProvider>
    </TooltipProvider>
  );
};
