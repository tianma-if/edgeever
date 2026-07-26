import { lazy, Suspense, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PwaUpdateNotice } from "@/components/PwaUpdateNotice";
import { ReleaseUpdateNotice } from "@/components/ReleaseUpdateNotice";
import { PwaInstallProvider } from "@/components/PwaInstallContext";
import { PwaIosPrompt } from "@/components/PwaIosPrompt";
import { api, ApiRequestError } from "@/lib/api";
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

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => api.getSession(),
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: api.login,
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(["auth", "session"], session);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
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

export const App = () => (
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
