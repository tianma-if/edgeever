import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MobileStandaloneTiptapEditor } from "@/components/MobileStandaloneTiptapEditor";
import { initializeTheme } from "@/components/ThemeProvider";
import "./i18n";
import "./styles/mobile-markdown-editor.css";

declare global {
  interface Window {
    edgeeverMobileEditorBootstrap?: {
      markMounted: () => void;
      showFailure: () => void;
    };
  }
}

type MobileEditorErrorBoundaryState = {
  failed: boolean;
};

const returnToPreviousPage = () => {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  const params = new URLSearchParams(window.location.hash.slice(1));
  const returnTo = params.get("returnTo");
  window.location.replace(returnTo?.startsWith("/") ? returnTo : "/");
};

class MobileEditorErrorBoundary extends React.Component<React.PropsWithChildren, MobileEditorErrorBoundaryState> {
  state: MobileEditorErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MobileEditorErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("Mobile editor crashed", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const english = navigator.language.toLowerCase().startsWith("en");
    return (
      <main className="mobile-editor-fatal" role="alert">
        <section className="mobile-editor-fatal-card">
          <h1>{english ? "The editor encountered an error" : "编辑器出现异常"}</h1>
          <p>
            {english
              ? "Your note is safe. Retry the editor or return to the note list."
              : "笔记内容是安全的。你可以重试打开编辑器，或先返回笔记列表。"}
          </p>
          <div className="mobile-editor-fatal-actions">
            <button type="button" onClick={returnToPreviousPage}>
              {english ? "Back" : "返回"}
            </button>
            <button className="primary" type="button" onClick={() => window.location.reload()}>
              {english ? "Retry" : "重试"}
            </button>
          </div>
        </section>
      </main>
    );
  }
}

const root = document.getElementById("mobile-editor-root");

if (!root) {
  throw new Error("Mobile editor root not found");
}

initializeTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 } },
});

const MobileEditorApp = () => {
  React.useEffect(() => {
    window.edgeeverMobileEditorBootstrap?.markMounted();
  }, []);

  return (
    <MobileEditorErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MobileStandaloneTiptapEditor />
      </QueryClientProvider>
    </MobileEditorErrorBoundary>
  );
};

createRoot(root, {
  onUncaughtError(error, errorInfo) {
    console.error("Uncaught mobile editor error", error, errorInfo.componentStack);
  },
}).render(
  <React.StrictMode>
    <MobileEditorApp />
  </React.StrictMode>
);
