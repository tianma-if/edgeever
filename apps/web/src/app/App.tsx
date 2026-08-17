import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PwaUpdateNotice } from "@/components/PwaUpdateNotice";
import { ReleaseUpdateNotice } from "@/components/ReleaseUpdateNotice";
import { PwaInstallProvider } from "@/components/PwaInstallContext";
import { PwaIosPrompt } from "@/components/PwaIosPrompt";
import { Button } from "@/components/ui/button";
import {
  api,
  cacheDesktopSession,
  clearCachedDesktopSession,
  getConfiguredDesktopApiBaseUrl,
  getCachedDesktopSession,
  saveDesktopApiBaseUrl,
} from "@/lib/api";
import { classifyLoginError, getLoginProblemMessageKey } from "@/lib/login-error";
import { EVERNOTE_MIGRATION_PATH } from "@/lib/routes";
import { isBrowserOffline } from "@/lib/network-status";
import type { AuthSession } from "@edgeever/shared";

const EvernoteImportGuidePane = lazy(() =>
  import("@/components/EvernoteImportGuidePane").then((module) => ({ default: module.EvernoteImportGuidePane }))
);
const LoginScreen = lazy(() => import("@/components/LoginScreen").then((module) => ({ default: module.LoginScreen })));
const WorkspaceApp = lazy(() => import("@/components/WorkspaceApp").then((module) => ({ default: module.WorkspaceApp })));
const PublicSharePage = lazy(() => import("@/components/PublicSharePage").then((module) => ({ default: module.PublicSharePage })));

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

const AuthenticatedWorkspace = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const desktopBridge = window.edgeeverDesktop;
  const [desktopScopeReady, setDesktopScopeReady] = useState(() => !desktopBridge?.isAvailable);
  const [desktopScopeError, setDesktopScopeError] = useState<Error | null>(null);
  const [desktopScopeAttempt, setDesktopScopeAttempt] = useState(0);
  const configuredDesktopApiBaseUrl = getConfiguredDesktopApiBaseUrl();

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      try {
        const session = await api.getSession();
        await cacheDesktopSession(session);
        return session;
      } catch (error) {
        const cached = getCachedDesktopSession();
        if (cached?.authenticated && isBrowserOffline()) return cached;
        throw error;
      }
    },
    enabled: !desktopBridge?.isAvailable || Boolean(configuredDesktopApiBaseUrl),
    retry: false,
  });

  const desktopAccountId = sessionQuery.data?.authenticated ? sessionQuery.data.user?.id ?? null : null;

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

  const loginMutation = useMutation({
    mutationFn: async (payload: { instanceUrl?: string; username: string; password: string }) => {
      if (desktopBridge?.isAvailable && payload.instanceUrl !== undefined) {
        await saveDesktopApiBaseUrl(payload.instanceUrl);
      }
      const session = await api.login({ username: payload.username, password: payload.password });
      await cacheDesktopSession(session);
      return session;
    },
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(["auth", "session"], session);
    },
  });

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
      queryClient.clear();
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
  const problem = loginMutation.error
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
    : null;

  if (desktopBridge?.isAvailable && !desktopScopeReady) {
    if (desktopScopeError) {
      return (
        <main className="flex h-[100dvh] items-center justify-center bg-slate-50 px-4 text-slate-900">
          <section className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
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
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      <>
        <WorkspaceApp
          authRequired={session.authRequired}
          demoMode={session.demoMode}
          isLoggingOut={logoutMutation.isPending}
          user={session.user}
          onLogout={() => logoutMutation.mutate()}
        />
        <ReleaseUpdateNotice />
      </>
    </Suspense>
  );
};

export const App = () => {
  useEffect(() => {
    const bridge = window.edgeeverDesktop;
    const baseUrl = getConfiguredDesktopApiBaseUrl();
    if (bridge?.isAvailable && baseUrl) void bridge.setApiBaseUrl(baseUrl);
  }, []);

  return (
    <PwaInstallProvider>
      <Routes>
        <Route path="/share/:token" element={<Suspense fallback={<AuthLoadingScreen />}><PublicSharePage /></Suspense>} />
        <Route path={EVERNOTE_MIGRATION_PATH} element={<EvernoteMigrationRoute />} />
        <Route path="/" element={<AuthenticatedWorkspace />} />
        <Route path="/settings" element={<AuthenticatedWorkspace />} />
        <Route path="/plugins" element={<AuthenticatedWorkspace />} />
        <Route path="/plugins/:pluginId" element={<AuthenticatedWorkspace />} />
        <Route path="/templates" element={<AuthenticatedWorkspace />} />
        <Route path="/ai-prompts" element={<AuthenticatedWorkspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PwaUpdateNotice />
      <PwaIosPrompt />
    </PwaInstallProvider>
  );
};
