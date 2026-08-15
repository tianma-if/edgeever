import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MobileStandaloneTiptapEditor } from "@/components/MobileStandaloneTiptapEditor";
import { initializeTheme } from "@/components/ThemeProvider";
import "./i18n";
import "./styles/mobile-markdown-editor.css";

const root = document.getElementById("mobile-editor-root");

if (!root) {
  throw new Error("Mobile editor root not found");
}

initializeTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 } },
});

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MobileStandaloneTiptapEditor />
    </QueryClientProvider>
  </React.StrictMode>
);
