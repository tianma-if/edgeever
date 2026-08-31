import React, { type ErrorInfo, type ReactNode } from "react";
import { markRendererRecoveryRequired } from "@/lib/renderer-recovery";
import { reportDesktopRendererReadyAfterPaint } from "@/lib/desktop-renderer-ready";

type RendererErrorDetails = {
  kind: "react-error";
  message: string;
  stack: string;
  componentStack: string;
};

type State = {
  error: RendererErrorDetails | null;
  reporting: boolean;
};

const isChineseInterface = () => navigator.language.toLowerCase().startsWith("zh");

export class DesktopRendererErrorBoundary extends React.Component<{ children: ReactNode }, State> {
  state: State = { error: null, reporting: false };

  static getDerivedStateFromError(error: unknown): Pick<State, "error"> {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
      error: {
        kind: "react-error",
        message: normalized.message,
        stack: normalized.stack ?? "",
        componentStack: "",
      },
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    markRendererRecoveryRequired();
    const details: RendererErrorDetails = {
      kind: "react-error",
      message: error.message,
      stack: error.stack ?? "",
      componentStack: info.componentStack ?? "",
    };
    this.setState({ error: details });
    console.error("Caught React renderer error", error, info.componentStack);
    void window.edgeeverDesktop?.recordRendererError(details).catch(() => undefined);
    reportDesktopRendererReadyAfterPaint();
  }

  private report = async () => {
    const { error } = this.state;
    if (!error || !window.edgeeverDesktop) return;
    this.setState({ reporting: true });
    try {
      await window.edgeeverDesktop.openRendererIssue(error);
    } finally {
      this.setState({ reporting: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const zh = isChineseInterface();
    const desktop = Boolean(window.edgeeverDesktop?.isAvailable);

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" role="alert">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-xl text-rose-700">!</div>
          <h1 className="text-lg font-semibold">{zh ? "EdgeEver 页面出现异常" : "EdgeEver encountered a page error"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {desktop
              ? (zh
                  ? "问题已经记录到这台设备。重新加载后会进入安全启动模式，不再自动打开刚才的笔记。"
                  : "The problem was recorded on this device. Reloading will enter safe startup mode instead of reopening the previous note.")
              : (zh
                  ? "安全重新加载后不会自动打开刚才的笔记。如果问题仍然出现，请检查浏览器控制台。"
                  : "A safe reload will avoid reopening the previous note. If the problem persists, check the browser console.")}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              type="button"
              onClick={() => window.location.reload()}
            >
              {zh ? "安全重新加载" : "Reload safely"}
            </button>
            {desktop ? (
              <button
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                type="button"
                disabled={this.state.reporting}
                onClick={() => void this.report()}
              >
                {this.state.reporting
                  ? (zh ? "正在打开…" : "Opening…")
                  : (zh ? "报告到 GitHub" : "Report to GitHub")}
              </button>
            ) : null}
          </div>
        </section>
      </main>
    );
  }
}
