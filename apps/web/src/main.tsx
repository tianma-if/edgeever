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

createRoot(root).render(
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
