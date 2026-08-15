import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app/App";
import "./i18n";
import { emitPwaUpdateNotice, markPwaUpdateReloadPending } from "./lib/pwa-update-notice";
import { initializeTheme, ThemeProvider } from "./components/ThemeProvider";
import "./styles/globals.css";

const PWA_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1_000;
const DEVELOPMENT_PWA_RELOAD_KEY = "edgeever.dev-pwa-reset";

if (import.meta.env.DEV && __EDGEEVER_DEVELOPMENT_PROFILE__) {
  document.documentElement.dataset.edgeeverEnvironment = __EDGEEVER_DEVELOPMENT_PROFILE__;
  const environmentLabel = __EDGEEVER_DEVELOPMENT_PROFILE__ === "demo" ? "LOCAL DEMO" : "LOCAL";
  document.title = `[${environmentLabel}] ${document.title}`;
}

const clearDevelopmentPwaState = async () => {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  const hadController = Boolean(navigator.serviceWorker.controller);

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
    }
  } catch (error) {
    console.warn("Failed to clear development service worker state", error);
  }

  // A still-controlling worker can keep serving a broken HMR shell after a
  // runtime crash. Force one clean reload once the worker is unregistered.
  if (hadController && window.sessionStorage.getItem(DEVELOPMENT_PWA_RELOAD_KEY) !== "1") {
    window.sessionStorage.setItem(DEVELOPMENT_PWA_RELOAD_KEY, "1");
    window.location.reload();
    return true;
  }

  window.sessionStorage.removeItem(DEVELOPMENT_PWA_RELOAD_KEY);
  return false;
};

const registerProductionServiceWorker = () => {
  let updateServiceWorker: ReturnType<typeof registerSW>;

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      emitPwaUpdateNotice({ buildLabel: __EDGEEVER_BUILD_LABEL__, kind: "checking" });
      void updateServiceWorker(true);
    },
    onNeedReload() {
      markPwaUpdateReloadPending();
      window.location.reload();
    },
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) {
        return;
      }

      const checkForUpdate = () => {
        if (document.visibilityState === "visible") {
          void registration.update().catch(() => undefined);
        }
      };

      const updateInterval = window.setInterval(checkForUpdate, PWA_UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener("beforeunload", () => window.clearInterval(updateInterval), { once: true });
      document.addEventListener("visibilitychange", checkForUpdate);
    },
    onRegisterError(error) {
      console.warn("PWA service worker registration failed", error);
    },
  });
};

const mountApp = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 15_000,
      },
    },
  });

  const root = document.getElementById("root");

  if (!root) {
    throw new Error("Root element not found");
  }

  initializeTheme();

  createRoot(root, {
    onUncaughtError(error, errorInfo) {
      console.error("Uncaught React error", error, errorInfo.componentStack);
    },
  }).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
};

const bootstrap = async () => {
  if (import.meta.env.DEV) {
    const reloading = await clearDevelopmentPwaState();
    if (reloading) {
      return;
    }
  } else {
    registerProductionServiceWorker();
  }

  mountApp();
};

void bootstrap();
