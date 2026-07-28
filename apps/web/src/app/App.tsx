import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PwaUpdateNotice } from "@/components/PwaUpdateNotice";
import { ReleaseUpdateNotice } from "@/components/ReleaseUpdateNotice";
import { PwaInstallProvider } from "@/components/PwaInstallContext";
import { PwaIosPrompt } from "@/components/PwaIosPrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  api,
  ApiRequestError,
  cacheDesktopSession,
  clearCachedDesktopSession,
  getConfiguredDesktopApiBaseUrl,
  getCachedDesktopSession,
  isDesktopInstanceConfigurationRequired,
  saveDesktopApiBaseUrl,
} from "@/lib/api";
import { EVERNOTE_MIGRATION_PATH } from "@/lib/routes";
import type { AuthSession } from "@edgeever/shared";

const EvernoteImportGuidePane = lazy(() =>
  import("@/components/EvernoteImportGuidePane").then((module) => ({ default: module.EvernoteImportGuidePane }))
);
const LoginScreen = lazy(() => import("@/components/LoginScreen").then((module) => ({ default: module.LoginScreen })));
const WorkspaceApp = lazy(() => import("@/components/WorkspaceApp").then((module) => ({ default: module.WorkspaceApp })));

const AuthLoadingScreen = () => (
  <div className="flex h-[100dvh] items-center justify-center bg-slate-50 text-sm font-medium text-slate-600">
    EdgeEver
  </div>
);

const DesktopInstanceSetup = () => {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      saveDesktopApiBaseUrl(value);
      window.location.reload();
    } catch {
      setError(t("login.desktopInstanceUrlInvalid"));
    }
  };

  return (
    <main className="flex h-[100dvh] items-center justify-center bg-gradient-to-tr from-emerald-50/70 via-emerald-50 to-emerald-100 px-4 py-8 text-slate-950">
      <section className="w-full max-w-[440px] rounded-2xl border border-emerald-500/15 bg-white/95 p-8 shadow-[0_20px_50px_rgb(var(--brand-green-rgb)/0.08)]">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{t("login.desktopInstanceTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t("login.desktopInstanceDescription")}</p>
        <form className="mt-6 space-y-4" onSubmit={save}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">{t("login.desktopInstanceUrl")}</span>
            <Input
              autoFocus
              className="h-11 rounded-lg bg-slate-50/50 px-3.5 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-emerald-500/10"
              placeholder="https://notes.example.com"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <Button className="h-11 w-full justify-center rounded-lg bg-emerald-500 font-semibold text-white transition hover:bg-emerald-600" type="submit" variant="solid">
            {t("login.desktopInstanceContinue")}
          </Button>
        </form>
      </section>
    </main>
  );
};

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

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      try {
        const session = await api.getSession();
        cacheDesktopSession(session);
        return session;
      } catch (error) {
        const cached = getCachedDesktopSession();
        if (cached?.authenticated && typeof navigator !== "undefined" && !navigator.onLine) return cached;
        throw error;
      }
    },
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
    mutationFn: api.login,
    onSuccess: (session) => {
      cacheDesktopSession(session);
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
    return <AuthLoadingScreen />;
  }

  const session = sessionQuery.data;
  const configurationError =
    sessionQuery.error instanceof ApiRequestError
      ? sessionQuery.error.code === "auth_not_configured"
        ? t("login.authNotConfigured")
        : sessionQuery.error.code === "database_not_ready"
          ? t("login.databaseNotReady")
          : t("login.instanceUnavailable")
      : sessionQuery.error
        ? t("login.instanceUnavailable")
        : null;
  const loginError =
    loginMutation.error instanceof ApiRequestError && loginMutation.error.code === "password_hash_invalid"
      ? t("login.passwordHashInvalid")
      : loginMutation.error instanceof Error
        ? loginMutation.error.message
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
    return <AuthLoadingScreen />;
  }

  if (!session?.authenticated) {
    return (
      <Suspense fallback={<AuthLoadingScreen />}>
        <LoginScreen
          configurationError={configurationError}
          error={loginError}
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

  if (isDesktopInstanceConfigurationRequired()) return <DesktopInstanceSetup />;

  return (
    <PwaInstallProvider>
      <Routes>
        <Route path={EVERNOTE_MIGRATION_PATH} element={<EvernoteMigrationRoute />} />
        <Route path="/" element={<AuthenticatedWorkspace />} />
        <Route path="/settings" element={<AuthenticatedWorkspace />} />
        <Route path="/templates" element={<AuthenticatedWorkspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PwaUpdateNotice />
      <PwaIosPrompt />
    </PwaInstallProvider>
  );
};
