import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getMemoDisplayTitle, hasTableDocumentMarker, parseDiagramDocument, type MemoDetail } from "@edgeever/shared";
import { EditorPane } from "@/components/EditorPane";
import { EditorPaneErrorBoundary } from "@/components/EditorPaneErrorBoundary";
import { Button } from "@/components/ui/button";
import { api, getCachedDesktopSession } from "@/lib/api";
import { getPersistentDataScopeOrigin } from "@/lib/app-page-path";
import { getShortcutActionForEvent, readImageCompressionPreference, readShortcutSettingsPreference } from "@/lib/app-helpers";
import { noteWindowSyncCompletedDetail } from "@/lib/desktop-note-windows";
import { createLocalDataScope, putLocalMemo } from "@/lib/local-mirror";
import { updateMemoSummaryInLists } from "@/lib/memo-list-cache";
import { EdgeEverPluginHost } from "@/lib/plugins/plugin-host";
import { createRepository } from "@/lib/repository";
import { cacheMemoDetail, memoDetailQueryKey, memoToSummary } from "@/lib/workspace-memo-cache";
import { useNoteProse } from "@/hooks/useNoteProse";

const noop = () => undefined;

/**
 * A desktop window that shows a single note. Loading, sync and plugins stay in
 * the main window; this window only edits the note, saves through the same
 * repository, and hands everything else back to the main window. The main
 * window forwards each sync result here so this editor tracks acknowledgements,
 * remote changes and conflicts like the main editor does.
 */
export const NoteWindowApp = ({ memoId }: { memoId: string }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bridge = window.edgeeverDesktop;
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      try {
        return await api.getSession();
      } catch (error) {
        const cached = getCachedDesktopSession();
        if (cached?.authenticated) return cached;
        throw error;
      }
    },
    initialData: () => getCachedDesktopSession() ?? undefined,
    retry: false,
  });
  const userId = sessionQuery.data?.authenticated ? sessionQuery.data.user?.id ?? null : null;
  const localDataScope = useMemo(
    () => createLocalDataScope(getPersistentDataScopeOrigin(window.location.origin), userId),
    [userId],
  );
  const repository = useMemo(() => createRepository(localDataScope), [localDataScope]);
  // Plugins are never activated here, so no plugin code runs twice.
  const pluginHost = useMemo(() => new EdgeEverPluginHost({
    repository,
    scope: localDataScope,
    aiAdapter: api.pluginAi,
    onWorkspaceChanged: async () => undefined,
  }), [localDataScope, repository]);
  const memoQuery = useQuery({
    networkMode: "offlineFirst",
    queryKey: memoDetailQueryKey(memoId, "notebook"),
    queryFn: () => repository.getMemo(memoId),
    enabled: Boolean(sessionQuery.data),
    retry: false,
  });
  const notebooksQuery = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => repository.listNotebooks(),
    networkMode: "offlineFirst",
    enabled: Boolean(sessionQuery.data),
  });
  const { noteProse } = useNoteProse();
  const [shortcutSettings] = useState(readShortcutSettingsPreference);
  const [imageCompressionEnabled] = useState(readImageCompressionPreference);
  const [focusMode, setFocusMode] = useState(false);
  const [tokens, setTokens] = useState({ search: 0, replace: 0, ai: 0, saveAndSync: 0, readingProtection: 0, editorMode: 0, outline: 0, title: 0, body: 0 });
  const [closeError, setCloseError] = useState(false);
  const pendingSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const closeFailedRef = useRef(false);
  const deletedRef = useRef(false);
  const memo = memoQuery.data?.memo ?? null;
  const unsupported = Boolean(memo && (memo.isDeleted || parseDiagramDocument(memo.contentMarkdown) || hasTableDocumentMarker(memo.contentMarkdown)));
  // A failed reload after a sync keeps the note it already shows; only a
  // note that never loaded, or is gone or unsupported, leaves the editor.
  const unavailable = (sessionQuery.isError && !sessionQuery.data) || (memoQuery.isError && !memo) || unsupported;

  // The main window counts the move as done only once this window shows the
  // note. If it cannot, the main process closes this window and the main
  // window shows the note again.
  const handoffReportedRef = useRef(false);
  useEffect(() => {
    if (handoffReportedRef.current || (!unavailable && !memo)) return;
    handoffReportedRef.current = true;
    if (unavailable) bridge?.notifyNoteWindowLoadFailed?.();
    else bridge?.notifyNoteWindowReady?.();
  }, [bridge, memo, unavailable]);

  useEffect(() => bridge?.onNoteWindowSync?.((update) => {
    // Same order as the main window: advance the editor's sync state, then
    // reload the note so remote changes reach it.
    window.dispatchEvent(new CustomEvent("edgeever:sync-completed", { detail: noteWindowSyncCompletedDetail(memoId, update) }));
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["memo", memoId] }),
      queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
    ]);
  }), [bridge, memoId, queryClient]);

  useEffect(() => {
    document.title = memo ? `${getMemoDisplayTitle(memo.title, t("common.untitledMemo"))} · EdgeEver` : "EdgeEver";
  }, [memo, t]);

  const registerPendingSave = useCallback((save: (() => Promise<boolean>) | null) => {
    pendingSaveRef.current = save;
  }, []);

  // Closing the window waits for pending edits. If they cannot be saved, the
  // window stays open with an explanation; closing again closes it, and the
  // edits stay in this device's local draft for the main window to recover.
  useEffect(() => bridge?.onNoteWindowCloseRequest?.(() => {
    void (async () => {
      if (deletedRef.current || closeFailedRef.current) {
        bridge.resolveNoteWindowClose?.(true);
        return;
      }
      const saved = pendingSaveRef.current ? await pendingSaveRef.current().catch(() => false) : true;
      if (!saved) {
        closeFailedRef.current = true;
        setCloseError(true);
      }
      bridge.resolveNoteWindowClose?.(saved);
    })();
  }), [bridge]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = getShortcutActionForEvent(event, shortcutSettings);
      const key = action === "focusSearch" ? "search"
        : action === "focusReplace" ? "replace"
          : action === "openAiAssistant" ? "ai"
            : action === "saveAndSync" ? "saveAndSync"
              : action === "toggleReadingProtection" ? "readingProtection"
                : action === "toggleEditorMode" ? "editorMode"
                  : action === "toggleOutline" ? "outline"
                    : action === "focusTitle" ? "title"
                      : action === "focusBody" ? "body"
                        : null;
      if (!key) return;
      event.preventDefault();
      setTokens((current) => ({ ...current, [key]: current[key] + 1 }));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutSettings]);

  const handleSaved = useCallback(async (saved: MemoDetail) => {
    await putLocalMemo(localDataScope, saved);
    cacheMemoDetail(queryClient, saved, "notebook");
    updateMemoSummaryInLists(queryClient, memoToSummary(saved));
    closeFailedRef.current = false;
    setCloseError(false);
    bridge?.notifyNoteWindowSaved?.();
  }, [bridge, localDataScope, queryClient]);

  const openInMainWindow = useCallback((targetMemoId: string) => {
    void bridge?.openMemoInMainWindow?.(targetMemoId);
  }, [bridge]);

  const handleDeleted = useCallback(async (deletedMemoId: string) => {
    await repository.deleteMemo(deletedMemoId);
    deletedRef.current = true;
    bridge?.notifyNoteWindowSaved?.();
    window.close();
  }, [bridge, repository]);

  if (unavailable) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-background px-6 text-center">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <p className="text-sm leading-6 text-slate-600">{t("editor.noteWindowUnavailable")}</p>
          <Button variant="outline" size="sm" onClick={() => {
            deletedRef.current = true;
            window.close();
          }}>
            {t("editor.closeNoteWindow")}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[100dvh] min-h-0 flex-col bg-background">
      {closeError && (
        <div role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs leading-5 text-rose-800">
          {t("editor.noteWindowCloseSaveFailed")}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <EditorPaneErrorBoundary resetKey={memoId} onBackToList={noop}>
          <EditorPane
            key={memoId}
            memo={memo}
            repository={repository}
            pluginHost={pluginHost}
            desktopFocusMode={focusMode}
            onToggleDesktopFocusMode={() => setFocusMode((value) => !value)}
            noteProse={noteProse}
            mobileDefaultEditMemoId={null}
            isTrashView={false}
            notebooks={notebooksQuery.data?.notebooks ?? []}
            isLoading={memoQuery.isLoading || sessionQuery.isLoading}
            imageCompressionEnabled={imageCompressionEnabled}
            shortcutSettings={shortcutSettings}
            searchFocusToken={tokens.search}
            replaceFocusToken={tokens.replace}
            aiAssistantOpenToken={tokens.ai}
            saveAndSyncToken={tokens.saveAndSync}
            readingProtectionToggleToken={tokens.readingProtection}
            editorModeToggleToken={tokens.editorMode}
            outlineToggleToken={tokens.outline}
            titleFocusToken={tokens.title}
            bodyFocusToken={tokens.body}
            onSyncRequested={async () => bridge?.notifyNoteWindowSaved?.()}
            onOpenMemo={openInMainWindow}
            onOpenCompanionNote={openInMainWindow}
            onOpenExecutionCenter={noop}
            onBackToList={noop}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onPermanentDeleted={handleDeleted}
            onRestored={async () => undefined}
            onMobileDefaultEditConsumed={noop}
            onSaveAsTemplate={async (source, name) => {
              await repository.createTemplate({ name, memoId: source.id });
            }}
            onRegisterPendingSave={registerPendingSave}
          />
        </EditorPaneErrorBoundary>
      </div>
    </main>
  );
};
