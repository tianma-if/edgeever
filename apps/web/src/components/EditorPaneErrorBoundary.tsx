import React, { type ErrorInfo, type ReactNode } from "react";
import { clearRendererRecoveryRequired, markRendererRecoveryRequired } from "@/lib/renderer-recovery";

type Props = {
  children: ReactNode;
  resetKey: string | null;
  onBackToList: () => void;
};

type State = {
  error: Error | null;
};

const isChineseInterface = () => navigator.language.toLowerCase().startsWith("zh");

export class EditorPaneErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    markRendererRecoveryRequired();
    const details = {
      kind: "react-error" as const,
      message: error.message,
      stack: error.stack ?? "",
      componentStack: info.componentStack ?? "",
    };
    console.error("Caught note editor error", error, info.componentStack);
    void window.edgeeverDesktop?.recordRendererError(details).catch(() => undefined);
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      clearRendererRecoveryRequired();
      this.setState({ error: null });
    }
  }

  private retry = () => {
    clearRendererRecoveryRequired();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const zh = isChineseInterface();

    return (
      <main className="flex h-full min-h-0 items-center justify-center bg-slate-50 p-6 text-slate-900">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" role="alert">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-xl text-amber-700">!</div>
          <h1 className="text-lg font-semibold">{zh ? "这条笔记暂时无法显示" : "This note cannot be displayed"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {zh
              ? "异常已被限制在当前笔记，笔记列表和应用其他功能仍可继续使用。请选择另一条笔记，或重试当前笔记。"
              : "The failure was isolated to this note. The note list and the rest of the app remain available. Choose another note or retry this one."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              type="button"
              onClick={this.props.onBackToList}
            >
              {zh ? "返回笔记列表" : "Back to note list"}
            </button>
            <button
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              type="button"
              onClick={this.retry}
            >
              {zh ? "重试当前笔记" : "Retry this note"}
            </button>
          </div>
        </section>
      </main>
    );
  }
}

export const EditorRecoveryPane = () => {
  const zh = isChineseInterface();
  return (
    <main className="flex h-full min-h-0 items-center justify-center bg-slate-50 p-6 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" role="status">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-xl text-emerald-700">✓</div>
        <h1 className="text-lg font-semibold">{zh ? "已进入安全启动模式" : "Safe startup mode is active"}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {zh
            ? "EdgeEver 没有重新打开上次出错的笔记。请从左侧列表选择其他笔记继续使用；选择后会自动退出安全模式。"
            : "EdgeEver did not reopen the note that failed last time. Choose another note from the list to continue; safe mode will then turn off automatically."}
        </p>
      </section>
    </main>
  );
};
