import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginPanelOpenOptions } from "@edgeever/plugin-api";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import { Button } from "@/components/ui/button";
import { MemoListPane, MemoSelectionActionBar } from "./MemoListPane";
import { MobileBottomNav, MobileNotebookPicker } from "./WorkspaceMobileChrome";
import { QuickMemoSwitcher } from "./QuickMemoSwitcher";
import { AppConfirmDialog, MemoDeleteConfirmDialog, NotebookNameDialog } from "./dialogs/ConfirmDialogs";
import { PluginPanelDialog } from "./plugins/PluginPanelDialog";
import { shouldDiscardPluginNoteSearchRequest } from "./editor/note-search";
import { api, getOrCreateClientDeviceId } from "@/lib/api";
import { useShowDescendantNotesPreference } from "@/lib/descendant-notes-preference";
import { MarkdownExportMemoryLimitError, type MarkdownExportProgress } from "@/lib/markdown-export";
import { exportSelectedMemosAsMarkdownZip } from "@/lib/selected-markdown-export";
import { createPluginScheduleAdapter } from "@/lib/plugins/plugin-schedule-adapter";
import { createPluginCatalogAdapter } from "@/lib/plugins/plugin-catalog-sync";
import {
  acknowledgePluginTrustWarning,
  hasAcknowledgedPluginTrustWarning,
  PLUGIN_TRUST_WARNING_COPY,
} from "@/lib/plugins/plugin-trust";
import {
  clearMobileEditorReturnPreview,
  consumeStandaloneMobileEditorReturn,
  getStandaloneMobileEditorReturningMemoId,
  openStandaloneMobileEditor,
  readMobileEditorReturnPreview,
  requiresRemoteMemoForStandaloneMobileEditor,
  type MobileEditorReturnPreview,
} from "@/lib/mobile-editor";
import { cn } from "@/lib/utils";
import { isBrowserOffline, isBrowserOnline } from "@/lib/network-status";
import { createDefaultDiagramDocument, createDefaultInfographicDocument, createDefaultTableDocument, diagramFallbackMarkdown, getNotebookScopeIds, hasTableDocumentMarker, infographicFallbackMarkdown, markdownToDoc, parseDiagramDocument, parseInfographicDocument, parseTableDocument, serializeDiagramDocument, serializeInfographicDocument, serializeTableDocument, tableFallbackMarkdown, type NoteCreateKind, type Notebook, type AuthUser, type MemoSummary, type MemoDetail, type MemoTemplate as SavedMemoTemplate } from "@edgeever/shared";
import { toggleMobileMemoSelection } from "@edgeever/shared/mobile-ui";
import type {
  Pane,
  MemoView,
  MemoDeleteConfirmation,
  NotebookNameDialogState,
  AppNoticeDialogState,
  MobileBottomNavItem,
  NotebookDropPosition,
  NotebookMoveOption,
  MemoFilterMode,
  MemoSortMode,
  MemoDocumentAction,
  MemoDocumentActionRequest,
} from "@/lib/app-helpers";
import {
  MIN_MEMO_LIST_WIDTH_PX,
  MAX_MEMO_LIST_WIDTH_PX,
  DEFAULT_MEMO_LIST_WIDTH_PX,
  EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY,
  isTextEntryTarget,
  getSearchShortcutScope,
  getShortcutActionForEvent,
  getNotebookDropSortOrder,
  getNotebookMoveOptions,
  getMemoIdsNeedingMove,
  resolveSelectionMoveTargetNotebookId,
} from "@/lib/app-helpers";
import { useBrowserBackLayer } from "@/lib/app-hooks";
import { updateMemoSummaryInLists } from "@/lib/memo-list-cache";
import {
  cacheMemoDetail,
  evictIdleMemoDetails,
  memoDetailQueryKey,
  memoToSummary,
} from "@/lib/workspace-memo-cache";
import {
  getVerticalScrollContainer,
  isDesktopViewport,
  isStandaloneApp,
  PULL_TO_REFRESH_MAX_PX,
  PULL_TO_REFRESH_TRIGGER_PX,
  runWorkspaceViewTransition,
} from "@/lib/workspace-shell";
import { shouldAcceptRemoteMemoDetail } from "@/lib/memo-detail-freshness";
import {
  clearLocalScope,
  createLocalDataScope,
  putLocalMemo,
  putLocalNotebook,
} from "@/lib/local-mirror";
import { isNotebookNotEmptyError } from "@/lib/notebook-delete";
import { getPersistentDataScopeOrigin } from "@/lib/app-page-path";
import { createRepository } from "@/lib/repository";
import { notifyRepositoryMutation } from "@/lib/repository-events";
import {
  refreshWorkspaceData,
  shouldNavigateHomeWhenOpeningMemo,
  type WorkspaceRefreshMode,
} from "@/lib/workspace-refresh";
import { useWorkspaceSyncLifecycle } from "@/hooks/useWorkspaceSyncLifecycle";
import { paneEnterMotion } from "@/lib/motion";
import { WorkspaceMotionProvider } from "./WorkspaceMotionProvider";
import { useWorkspaceRoute } from "@/hooks/useWorkspaceRoute";
import { useNoteProse } from "@/hooks/useNoteProse";
import { useWorkspacePreferences } from "@/hooks/useWorkspacePreferences";
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";
import { useWorkspaceQueuedSync } from "@/hooks/useWorkspaceQueuedSync";
import { useWorkspaceMemoRemoval } from "@/hooks/useWorkspaceMemoRemoval";
import { EdgeEverPluginHost, type RegisteredPluginPanel } from "@/lib/plugins/plugin-host";
import { loadResolvedPluginMarketplace } from "@/lib/plugins/plugin-marketplace";
import { updateOfficialMarketplacePlugins } from "@/lib/plugins/plugin-updates";
import { createPublicNetworkAdapter } from "@/lib/plugins/public-network-adapter";
import { clearRendererRecoveryRequired, isRendererRecoveryRequired } from "@/lib/renderer-recovery";
import {
  readDesktopWorkspaceRestoreState,
  shouldRestoreDesktopWorkspace,
  writeDesktopWorkspaceRestoreState,
} from "@/lib/desktop-workspace-restore";
import { EditorPaneErrorBoundary, EditorRecoveryPane } from "./EditorPaneErrorBoundary";
import { isMarkdownFile, readMarkdownFile } from "@/lib/markdown-file-import";
import { compressImageForUpload } from "@/lib/image-compression";
import { createScreenshotMemo, screenshotFileFromImportPayload, screenshotImportDedupeKey, screenshotImportGate } from "@/lib/screenshot-import";
import { createSharedFileMemo, sharedFileTitle } from "@/lib/shared-file-import";
import { createWeChatChatMemo } from "@/lib/wechat-chat-import";
import { copyMarkdownToWeChat } from "@/lib/wechat-copy";
import { isDesktopResourceRuntime, stageDesktopResource, toDesktopResourceUrl } from "@/lib/desktop-resources";
import { findMatchingMemoResource } from "@/lib/staged-resource-repair";

const EditorPane = lazy(() => import("./EditorPane").then((module) => ({ default: module.EditorPane })));
const DiagramEditorPane = lazy(() => import("./DiagramEditorPane"));
const TableEditorPane = lazy(() => import("./TableEditorPane"));
const InfographicEditorPane = lazy(() => import("./InfographicEditorPane"));
const AssetsPane = lazy(() => import("./AssetsPane").then((module) => ({ default: module.AssetsPane })));
const SettingsPane = lazy(() => import("./SettingsPane").then((module) => ({ default: module.SettingsPane })));
const PluginMarketplacePane = lazy(() => import("./PluginMarketplacePane").then((module) => ({ default: module.PluginMarketplacePane })));
const NotebookPane = lazy(() => import("./NotebookPane").then((module) => ({ default: module.NotebookPane })));
const EvernoteImportGuidePane = lazy(() =>
  import("./EvernoteImportGuidePane").then((module) => ({ default: module.EvernoteImportGuidePane }))
);
const TagsPane = lazy(() => import("./TagsPane").then((module) => ({ default: module.TagsPane })));
const TemplatesPane = lazy(() => import("./TemplatesPane").then((module) => ({ default: module.TemplatesPane })));
const AiPromptsPane = lazy(() => import("./AiPromptsPane").then((module) => ({ default: module.AiPromptsPane })));
const ExecutionCenterPane = lazy(() =>
  import("./execution/ExecutionCenterPane").then((module) => ({ default: module.ExecutionCenterPane }))
);

const PaneLoadingFallback = ({ label = "Loading" }: { label?: string }) => (
  <div className="flex h-full min-h-0 items-center justify-center bg-card text-sm font-medium text-slate-400" role="status">
    {label}
  </div>
);

export const WorkspaceApp = ({
  authRequired,
  demoMode,
  user,
  isLoggingOut,
  onLogout,
}: {
  authRequired: boolean;
  demoMode: boolean;
  user: AuthUser | null;
  isLoggingOut: boolean;
  onLogout: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const {
    route,
    navigateHome: navigateWorkspaceHome,
    navigateTrash: navigateWorkspaceTrash,
    navigateSettings: navigateWorkspaceSettings,
    navigatePlugins: navigateWorkspacePlugins,
    navigateTemplates: navigateWorkspaceTemplates,
    navigateAiPrompts: navigateWorkspaceAiPrompts,
    navigateExecutionCenter: navigateWorkspaceExecutionCenter,
  } = useWorkspaceRoute();
  const localDataScope = useMemo(
    () => createLocalDataScope(getPersistentDataScopeOrigin(window.location.origin), user?.id),
    [user?.id]
  );
  const repository = useMemo(() => createRepository(localDataScope), [localDataScope]);
  const isInitialSettingsRoute = route.isSettings;
  const isInitialPluginsRoute = route.isPlugins;
  const isInitialTemplatesRoute = route.isTemplates;
  const isInitialAiPromptsRoute = route.isAiPrompts;
  const isInitialExecutionCenterRoute = route.isExecutionCenter;
  const isInitialMobileEditorReturn = Boolean(route.mobileEditorReturnMemoId);
  const isTrashRoute = route.isTrash;
  const [rendererRecoveryMode, setRendererRecoveryMode] = useState(() =>
    Boolean(window.edgeeverDesktop?.recoveredAfterAbnormalExit) || isRendererRecoveryRequired()
  );
  const [desktopWorkspaceRestore] = useState(() => (
    shouldRestoreDesktopWorkspace() && !isRendererRecoveryRequired()
      ? readDesktopWorkspaceRestoreState()
      : null
  ));
  const [activePane, setActivePane] = useState<Pane>(() => ((isInitialSettingsRoute || isInitialPluginsRoute || isInitialTemplatesRoute || isInitialAiPromptsRoute || isInitialExecutionCenterRoute) && !isInitialMobileEditorReturn ? "editor" : "memos"));
  const [memoView, setMemoView] = useState<MemoView>(() => (
    isTrashRoute ? "trash" : desktopWorkspaceRestore?.memoView ?? "notebook"
  ));
  const {
    beginMemoSelection,
    clearMemoSelection,
    memoSelectionMode,
    replaceMemoSelection,
    selectedMemoId,
    selectedMemoIdRef,
    selectedMemoIds,
    selectedNotebookId,
    selectionMoveTargetNotebookId,
    setMemoSelectionMode,
    setSelectedMemoId,
    setSelectedMemoIds,
    setSelectedNotebookId,
    setSelectionMoveTargetNotebookId,
  } = useWorkspaceSelection(desktopWorkspaceRestore);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const autoSelectedDemoNotebookRef = useRef(false);
  const [createdMemoEditId, setCreatedMemoEditId] = useState<string | null>(null);
  const pendingCreatedMemoIdRef = useRef<string | null>(null);
  const pendingQuickSwitcherMemoIdRef = useRef<string | null>(desktopWorkspaceRestore?.selectedMemoId ?? null); // also companion/plugin opens not yet in the list
  useEffect(() => {
    if (!window.edgeeverDesktop?.isAvailable) return;
    writeDesktopWorkspaceRestoreState({
      selectedMemoId,
      selectedNotebookId,
      memoView,
    });
  }, [memoView, selectedMemoId, selectedNotebookId]);
  const creatingMemoSelectionRef = useRef(false);
  const createMemoInFlightRef = useRef(false);
  const memoDocumentActionIdRef = useRef(0);
  const [memoDocumentActionRequest, setMemoDocumentActionRequest] = useState<MemoDocumentActionRequest | null>(null);
  const [memoDeleteConfirmation, setMemoDeleteConfirmation] = useState<MemoDeleteConfirmation | null>(null);
  const [emptyTrashConfirmationOpen, setEmptyTrashConfirmationOpen] = useState(false);
  const [notebookNameDialog, setNotebookNameDialog] = useState<NotebookNameDialogState | null>(null);
  const [notebookDeleteConfirmation, setNotebookDeleteConfirmation] = useState<Notebook | null>(null);
  const [appNoticeDialog, setAppNoticeDialog] = useState<AppNoticeDialogState | null>(null);
  const [wechatImportFailureId, setWeChatImportFailureId] = useState<string | null>(null);
  const [wechatImportsInProgress, setWeChatImportsInProgress] = useState(0);
  const [sharedFileImportsInProgress, setSharedFileImportsInProgress] = useState(0);
  const [pendingCatalogTrustPluginIds, setPendingCatalogTrustPluginIds] = useState<string[]>([]);
  const [isExportingSelectedMemos, setIsExportingSelectedMemos] = useState(false);
  const [selectedMarkdownExportProgress, setSelectedMarkdownExportProgress] = useState<MarkdownExportProgress>({
    completed: 0,
    total: 0,
  });
  const [demoResetConfirmationOpen, setDemoResetConfirmationOpen] = useState(false);
  const scheduledTaskDeviceId = useMemo(
    () => window.edgeeverDesktop?.isAvailable ? getOrCreateClientDeviceId() : null,
    [],
  );
  const pluginScheduleAdapter = useMemo(() => scheduledTaskDeviceId
    ? createPluginScheduleAdapter(scheduledTaskDeviceId, () =>
        queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] }))
    : undefined, [queryClient, scheduledTaskDeviceId]);
  const pluginPublicNetworkAdapter = useMemo(() => createPublicNetworkAdapter(api.pluginNetwork, {
    desktop: window.edgeeverDesktop?.isAvailable ? window.edgeeverDesktop : undefined,
  }), []);
  const pluginCatalogAdapter = useMemo(() => demoMode ? undefined : createPluginCatalogAdapter(), [demoMode]);
  const pluginHost = useMemo(() => new EdgeEverPluginHost({
    repository,
    scope: localDataScope,
    aiAdapter: api.pluginAi,
    publicNetworkAdapter: pluginPublicNetworkAdapter,
    onNotice: (message) => setAppNoticeDialog({ title: t("plugins.noticeTitle"), description: message }),
    scheduleAdapter: pluginScheduleAdapter,
    catalogAdapter: pluginCatalogAdapter,
    onWorkspaceChanged: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
        queryClient.invalidateQueries({ queryKey: ["tags"] }),
        queryClient.invalidateQueries({ queryKey: ["templates"] }),
        queryClient.invalidateQueries({ queryKey: ["resources"] }),
      ]);
    },
  }), [localDataScope, pluginCatalogAdapter, pluginPublicNetworkAdapter, pluginScheduleAdapter, queryClient, repository, t]);
  const [pluginHostReady, setPluginHostReady] = useState(false);
  const pluginHostSnapshot = useSyncExternalStore(pluginHost.subscribe, pluginHost.getSnapshot, pluginHost.getSnapshot);
  useEffect(() => {
    let active = true;
    setPluginHostReady(false);
    void pluginHost.activateEnabled().then((pendingTrustPluginIds) => {
      if (!active) return;
      setPluginHostReady(true);
      if (pendingTrustPluginIds.length > 0) setPendingCatalogTrustPluginIds(pendingTrustPluginIds);
    }).catch(() => {
      if (active) setPluginHostReady(false);
    });
    return () => {
      active = false;
      void pluginHost.dispose();
    };
  }, [pluginHost]);
  useEffect(() => {
    if (!pluginHostReady) return;
    let active = true;
    let running = false;
    const updateOfficialPlugins = async () => {
      if (!active || running) return;
      running = true;
      try {
        const pendingTrustPluginIds = await pluginHost.syncFromCatalog();
        if (active && pendingTrustPluginIds.length > 0 && !hasAcknowledgedPluginTrustWarning()) {
          setPendingCatalogTrustPluginIds(pendingTrustPluginIds);
        }
        const marketplace = await loadResolvedPluginMarketplace();
        await updateOfficialMarketplacePlugins(pluginHost, marketplace.entries);
        const firstResolutionError = Object.entries(marketplace.resolutionErrors)[0];
        if (firstResolutionError) {
          console.error(`Official plugin ${firstResolutionError[0]} update resolution failed.`, firstResolutionError[1]);
        }
      } catch (error) {
        console.error("Official plugin update check failed.", error);
      } finally {
        running = false;
      }
    };
    const handleFocus = () => { void updateOfficialPlugins(); };
    const intervalId = window.setInterval(() => void updateOfficialPlugins(), 30 * 60_000);
    window.addEventListener("focus", handleFocus);
    void updateOfficialPlugins();
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [pluginHost, pluginHostReady]);
  const scheduledTasksQuery = useQuery({
    queryKey: ["scheduled-tasks", scheduledTaskDeviceId],
    queryFn: () => api.listScheduledTasks(scheduledTaskDeviceId ?? undefined),
    enabled: Boolean(scheduledTaskDeviceId && pluginHostReady),
    refetchInterval: 60_000,
  });
  const runningScheduledTaskIdsRef = useRef(new Set<string>());
  const runnableScheduledTasks = useMemo(() => {
    const commandKeys = new Set(pluginHostSnapshot.commands.map((command) => `${command.pluginId}\0${command.id}`));
    return (scheduledTasksQuery.data?.tasks ?? []).filter((task) =>
      commandKeys.has(`${task.taskPayload.pluginId}\0${task.taskPayload.commandId}`));
  }, [pluginHostSnapshot.commands, scheduledTasksQuery.data?.tasks]);

  useEffect(() => {
    if (!scheduledTaskDeviceId || !scheduledTasksQuery.data?.tasks) return;
    const interrupted = scheduledTasksQuery.data.tasks.filter((task) =>
      task.lastRun?.status === "running" && !runningScheduledTaskIdsRef.current.has(task.id));
    if (interrupted.length === 0) return;
    void Promise.all(interrupted.map((task) => api.finishScheduledTaskRun(task.id, task.lastRun!.id, {
      executorDeviceId: scheduledTaskDeviceId,
      status: "failed",
      errorMessage: "The desktop app stopped before the scheduled task completed.",
    }).catch(() => null))).then(() => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["scheduled-task-run-history"] }),
      ]);
    });
  }, [queryClient, scheduledTaskDeviceId, scheduledTasksQuery.data?.tasks]);

  useEffect(() => {
    const bridge = window.edgeeverDesktop;
    if (!bridge?.isAvailable || !scheduledTaskDeviceId || !pluginHostReady) return;
    void bridge.syncScheduledTasks(runnableScheduledTasks).catch(() => {});
  }, [pluginHostReady, runnableScheduledTasks, scheduledTaskDeviceId]);

  useEffect(() => () => {
    void window.edgeeverDesktop?.syncScheduledTasks([]).catch(() => {});
  }, []);

  useEffect(() => {
    const bridge = window.edgeeverDesktop;
    if (!bridge?.isAvailable || !scheduledTaskDeviceId || !pluginHostReady) return;
    return bridge.onScheduledTask(async ({ task, scheduledFor }) => {
      if (task.executorDeviceId !== scheduledTaskDeviceId || runningScheduledTaskIdsRef.current.has(task.id)) return;
      runningScheduledTaskIdsRef.current.add(task.id);
      let runId: string | null = null;
      try {
        const claimed = await api.claimScheduledTaskRun(task.id, {
          scheduledFor,
          executorDeviceId: scheduledTaskDeviceId,
        });
        runId = claimed.run.id;
        if (task.taskType !== "plugin-command") throw new Error("Unsupported scheduled task type.");
        await pluginHost.runCommand(task.taskPayload.pluginId, task.taskPayload.commandId);
        await api.finishScheduledTaskRun(task.id, runId, {
          executorDeviceId: scheduledTaskDeviceId,
          status: "succeeded",
        });
      } catch (error) {
        if (runId) {
          await api.finishScheduledTaskRun(task.id, runId, {
            executorDeviceId: scheduledTaskDeviceId,
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
          }).catch(() => {});
        }
      } finally {
        runningScheduledTaskIdsRef.current.delete(task.id);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] }),
          queryClient.invalidateQueries({ queryKey: ["scheduled-task-run-history"] }),
        ]);
      }
    });
  }, [pluginHost, pluginHostReady, queryClient, scheduledTaskDeviceId]);
  const [requestedPluginPanel, setRequestedPluginPanel] = useState<{
    panel: RegisteredPluginPanel;
    options?: PluginPanelOpenOptions;
  } | null>(null);
  const pluginNavigationRequestIdRef = useRef(0);
  const [pluginNavigationRequest, setPluginNavigationRequest] = useState<{ id: number; noteId: string; search: string } | null>(null);

  useEffect(() => pluginHost.setPanelAdapter({
    openPanel(pluginId, panelId, options) {
      const panel = pluginHost.getSnapshot().panels.find((candidate) =>
        candidate.pluginId === pluginId && candidate.id === panelId);
      if (!panel) throw new Error("Plugin panel is not registered.");
      setRequestedPluginPanel({ panel, options });
    },
  }), [pluginHost]);

  useEffect(() => {
    const unsubscribe = pluginHost.subscribe(() => {
      setRequestedPluginPanel((current) => current && pluginHost.getSnapshot().panels.some(
        (panel) => panel.pluginId === current.panel.pluginId && panel.id === current.panel.id,
      ) ? current : null);
    });
    return () => {
      unsubscribe();
    };
  }, [pluginHost]);

  const resetDemoMutation = useMutation({
    mutationFn: async () => {
      await api.resetDemo();
      await clearLocalScope(localDataScope);
      await repository.sync();
    },
    onMutate: () => {
      const previousSelectedMemoId = selectedMemoIdRef.current;
      setSelectedMemoId(null);
      setCreatedMemoEditId(null);
      pendingCreatedMemoIdRef.current = null;
      pendingQuickSwitcherMemoIdRef.current = null;
      return { previousSelectedMemoId };
    },
    onSuccess: async () => {
      try {
        window.localStorage.removeItem(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY);
      } catch {
        // Local storage can be unavailable in private or restricted browser contexts.
      }
      setDemoResetConfirmationOpen(false);
      queryClient.removeQueries({ queryKey: ["memo"] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
        queryClient.invalidateQueries({ queryKey: ["templates"] }),
        queryClient.invalidateQueries({ queryKey: ["resources"] }),
        queryClient.invalidateQueries({ queryKey: ["tags"] }),
      ]);
      setAppNoticeDialog({
        title: t("demo.resetSuccess"),
        description: t("demo.resetSuccess"),
      });
    },
    onError: (_error, _variables, context) => {
      setDemoResetConfirmationOpen(false);
      if (context?.previousSelectedMemoId) {
        setSelectedMemoId(context.previousSelectedMemoId);
      }
      setAppNoticeDialog({
        title: t("demo.resetFailed"),
        description: t("demo.resetFailed"),
      });
    },
  });
  const [multiSelectKeyDown, setMultiSelectKeyDown] = useState(false);
  const {
    desktopFocusMode,
    editorContentWidth,
    imageCompressionEnabled,
    memoListWidth,
    notebookSidebarCollapsed,
    resetMemoListWidth,
    setDesktopFocusMode,
    setEditorContentWidth,
    setImageCompressionEnabled,
    setMemoListWidth,
    setNotebookSidebarCollapsed,
    setShortcutSettings,
    shortcutSettings,
  } = useWorkspacePreferences();
  const { noteProse, updateNoteProse } = useNoteProse();
  const [rightView, setRightView] = useState<"editor" | "settings" | "plugins" | "assets" | "tags" | "templates" | "ai-prompts" | "execution-center" | "evernote-migration">(() =>
    isInitialSettingsRoute
      ? "settings"
      : isInitialPluginsRoute
        ? "plugins"
      : isInitialTemplatesRoute
        ? "templates"
        : isInitialAiPromptsRoute
          ? "ai-prompts"
          : isInitialExecutionCenterRoute
            ? "execution-center"
          : "editor"
  );
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [mobileNotebookPickerOpen, setMobileNotebookPickerOpen] = useState(false);
  const [mobileBottomNavActive, setMobileBottomNavActive] = useState<MobileBottomNavItem>(() =>
    isInitialSettingsRoute && !isInitialMobileEditorReturn
      ? "settings"
      : isInitialTemplatesRoute || isInitialAiPromptsRoute
        ? "templates"
        : "home"
  );
  const [mobileSearchFocusToken, setMobileSearchFocusToken] = useState(0);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [quickSwitcherQuery, setQuickSwitcherQuery] = useState("");
  const [noteSearchFocusToken, setNoteSearchFocusToken] = useState(0);
  const [noteReplaceFocusToken, setNoteReplaceFocusToken] = useState(0);
  const [noteAiAssistantOpenToken, setNoteAiAssistantOpenToken] = useState(0);
  const [noteSaveAndSyncToken, setNoteSaveAndSyncToken] = useState(0);
  const [noteReadingProtectionToggleToken, setNoteReadingProtectionToggleToken] = useState(0);
  const [noteEditorModeToggleToken, setNoteEditorModeToggleToken] = useState(0);
  const [noteOutlineToggleToken, setNoteOutlineToggleToken] = useState(0);
  const [search, setSearch] = useState("");
  const [memoFilterMode, setMemoFilterMode] = useState<MemoFilterMode>("all");
  const [memoSortMode, setMemoSortMode] = useState<MemoSortMode>("updated-desc");
  const [mobileEditorReturnPreview, setMobileEditorReturnPreview] = useState<MobileEditorReturnPreview | null>(() =>
    readMobileEditorReturnPreview(route.mobileEditorReturnMemoId)
  );
  const [isOnline, setIsOnline] = useState(isBrowserOnline);
  const [isDesktop, setIsDesktop] = useState(isDesktopViewport);
  const [isManualMemoSyncing, setIsManualMemoSyncing] = useState(false);
  const [isStandaloneRuntime] = useState(isStandaloneApp);
  const [pullToRefreshDistance, setPullToRefreshDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const isPullRefreshingRef = useRef(false);
  const skipNextHomeRouteSyncRef = useRef(false);

  const [mobileListActionsOpen, setMobileListActionsOpen] = useState(false);
  const [mobileMoveOpen, setMobileMoveOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [desktopFilterOpen, setDesktopFilterOpen] = useState(false);
  const [desktopSortOpen, setDesktopSortOpen] = useState(false);
  const [desktopActionsOpen, setDesktopActionsOpen] = useState(false);

  const {
    discardConflictsNow,
    isSyncingQueuedChanges,
    runQueuedSync,
    setSyncSummary,
    syncSummary,
  } = useWorkspaceQueuedSync({
    isOnline,
    localDataScope,
    pendingCreatedMemoIdRef,
    queryClient,
    selectedMemoIdRef,
    setCreatedMemoEditId,
    setOnline: setIsOnline,
    setSelectedMemoId,
  });

  const invalidateWorkspaceQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["memos"] }),
      queryClient.invalidateQueries({ queryKey: ["memo"] }),
      queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["tags"] }),
      queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: "all" }),
    ]);
  }, [queryClient]);

  const refreshWorkspaceFromServer = useCallback(async (mode: WorkspaceRefreshMode) => {
    if (isBrowserOffline()) {
      setIsOnline(false);
      return { changed: 0, skipped: true };
    }

    const isDesktopRuntime = Boolean(window.edgeeverDesktop?.isAvailable);

    return refreshWorkspaceData({
      mode,
      hasPendingLocalChanges: syncSummary.total > 0,
      // Desktop sync already pushes the outbox and pulls remote changes in
      // one operation. The web repository keeps those phases separate.
      pushLocalChanges: isDesktopRuntime ? async () => undefined : runQueuedSync,
      pullRemoteChanges: isDesktopRuntime
        ? async () => {
            await runQueuedSync();
            return { changed: 0 };
          }
        : repository.sync,
      invalidateWorkspaceQueries,
    });
  }, [invalidateWorkspaceQueries, repository, runQueuedSync, syncSummary.total]);

  const refreshLatestMemos = useCallback(async () => {
    if (isBrowserOffline()) {
      setIsOnline(false);
      setPullToRefreshDistance(0);
      return;
    }

    setIsPullRefreshing(true);

    try {
      await refreshWorkspaceFromServer("manual");
    } finally {
      setIsPullRefreshing(false);
      setPullToRefreshDistance(0);
    }
  }, [refreshWorkspaceFromServer]);

  const syncMemosManually = useCallback(async () => {
    if (isBrowserOffline()) {
      setIsOnline(false);
      return;
    }

    setIsManualMemoSyncing(true);

    try {
      await refreshWorkspaceFromServer("manual");
    } finally {
      setIsManualMemoSyncing(false);
    }
  }, [refreshWorkspaceFromServer]);

  const notebooksQuery = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => repository.listNotebooks(),
  });

  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: () => repository.listTemplates(),
    enabled: rightView === "templates",
  });

  const savedTemplates = templatesQuery.data?.templates ?? [];

  const notebooks = notebooksQuery.data?.notebooks ?? [];
  useEffect(() => {
    const english = i18n.resolvedLanguage === "en-US";
    const preferredNotebookId = english ? "nb_demo_features_en" : "nb_demo_features";

    if (!notebooks.some((notebook) => notebook.id === preferredNotebookId)) {
      return;
    }

    if (!autoSelectedDemoNotebookRef.current && selectedNotebookId === null && selectedTag === null) {
      autoSelectedDemoNotebookRef.current = true;
      setSelectedNotebookId(preferredNotebookId);
    }
  }, [i18n.resolvedLanguage, notebooks, selectedNotebookId, selectedTag]);

  const mobileEditorReturnMemoId = route.mobileEditorReturnMemoId;
  const visibleActivePane: Pane = mobileEditorReturnMemoId ? "memos" : activePane;
  const defaultMemoNotebookId =
    notebooks.find(
      (notebook) => notebook.id === "nb_inbox" || notebook.slug === "inbox" || notebook.name === "等待分类"
    )?.id ?? null;
  const createMemoNotebookId =
    (selectedNotebookId && notebooks.some((notebook) => notebook.id === selectedNotebookId) ? selectedNotebookId : null) ??
    defaultMemoNotebookId;
  const canCreateMemo = Boolean(createMemoNotebookId && memoView !== "trash");
  const memoSelectionModeActive = memoSelectionMode || selectedMemoIds.size > 0;
  const mobileSearchActive = mobileBottomNavActive === "search";
  const workspaceBackTargetActive = Boolean(
    appNoticeDialog ||
      pendingCatalogTrustPluginIds.length > 0 ||
      notebookDeleteConfirmation ||
      notebookNameDialog ||
      memoDeleteConfirmation ||
      emptyTrashConfirmationOpen ||
      mobileNotebookPickerOpen ||
      mobileListActionsOpen ||
      mobileMoveOpen ||
      mobileMoreOpen ||
      mobileSearchActive ||
      templatesOpen ||
      memoSelectionModeActive ||
      // A routed workspace uses browser history, not a synthetic modal back layer.
      (rightView !== "editor" || visibleActivePane === "editor" || visibleActivePane === "notebooks")
  );
  const mobilePullToRefreshActive = Boolean(
    !isDesktop &&
      visibleActivePane === "memos" &&
      !appNoticeDialog &&
      pendingCatalogTrustPluginIds.length === 0 &&
      !notebookDeleteConfirmation &&
      !notebookNameDialog &&
      !memoDeleteConfirmation &&
      !emptyTrashConfirmationOpen &&
      !mobileNotebookPickerOpen &&
      !mobileListActionsOpen &&
      !mobileMoveOpen &&
      !mobileMoreOpen &&
      !templatesOpen
  );

  const clearPendingCreatedMemo = useCallback(() => {
    pendingCreatedMemoIdRef.current = null;
    creatingMemoSelectionRef.current = false;
  }, []);

  const applyMobileEditorReturnPreview = useCallback((memoId: string | null) => {
    const returnPreview = readMobileEditorReturnPreview(memoId);
    if (!returnPreview) {
      return;
    }

    setMobileEditorReturnPreview(returnPreview);
    clearMobileEditorReturnPreview(memoId);
  }, []);

  useEffect(() => {
    const handleStandaloneMobileEditorReturn = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const returnedMemoId = getStandaloneMobileEditorReturningMemoId();
      if (!returnedMemoId) {
        return;
      }

      applyMobileEditorReturnPreview(returnedMemoId);
      consumeStandaloneMobileEditorReturn(returnedMemoId);
      setRightView("editor");
      setMobileBottomNavActive("home");
      setActivePane("memos");
      setSelectedMemoId(null);
      setCreatedMemoEditId(null);
      clearMemoSelection();
    };

    handleStandaloneMobileEditorReturn();
    window.addEventListener("pageshow", handleStandaloneMobileEditorReturn);
    document.addEventListener("visibilitychange", handleStandaloneMobileEditorReturn);

    return () => {
      window.removeEventListener("pageshow", handleStandaloneMobileEditorReturn);
      document.removeEventListener("visibilitychange", handleStandaloneMobileEditorReturn);
    };
  }, [applyMobileEditorReturnPreview, clearMemoSelection]);

  useEffect(() => {
    const returnedMemoId = route.mobileEditorReturnMemoId;
    if (!returnedMemoId) {
      return;
    }

    applyMobileEditorReturnPreview(returnedMemoId);

    skipNextHomeRouteSyncRef.current = false;
    setRightView("editor");
    setMobileBottomNavActive("home");
    setActivePane("memos");
    setSelectedMemoId(null);
    setCreatedMemoEditId(null);
    clearMemoSelection();

    navigateWorkspaceHome({ replace: true });
  }, [applyMobileEditorReturnPreview, clearMemoSelection, navigateWorkspaceHome, route.mobileEditorReturnMemoId]);

  const enterMemoSelectionMode = useCallback(() => {
    beginMemoSelection();
    setActivePane("memos");
  }, [beginMemoSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMultiSelectKeyDown(false);
        return;
      }

      if (isTextEntryTarget(event.target)) {
        setMultiSelectKeyDown(false);
        return;
      }

      if (event.ctrlKey || event.metaKey || event.key === "Control" || event.key === "Meta") {
        setMultiSelectKeyDown(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        setMultiSelectKeyDown(false);
        return;
      }
      setMultiSelectKeyDown(event.ctrlKey || event.metaKey);
    };

    const handleBlur = () => setMultiSelectKeyDown(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const prefetchEditor = () => {
      void import("./EditorPane");
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(prefetchEditor, { timeout: 2500 });
    } else {
      timeoutId = window.setTimeout(prefetchEditor, 1200);
    }
    return () => {
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (route.isSettings) {
      skipNextHomeRouteSyncRef.current = false;
      setRightView("settings");
      setMobileBottomNavActive("settings");
      setActivePane("editor");
      return;
    }

    if (route.isPlugins) {
      skipNextHomeRouteSyncRef.current = false;
      setRightView("plugins");
      setMobileBottomNavActive("home");
      setActivePane("editor");
      return;
    }

    if (route.isTemplates) {
      skipNextHomeRouteSyncRef.current = false;
      setRightView("templates");
      setMobileBottomNavActive("templates");
      setActivePane("editor");
      return;
    }

    if (route.isAiPrompts) {
      skipNextHomeRouteSyncRef.current = false;
      setRightView("ai-prompts");
      setMobileBottomNavActive("templates");
      setActivePane("editor");
      return;
    }

    if (route.isExecutionCenter) {
      skipNextHomeRouteSyncRef.current = false;
      setRightView("execution-center");
      setMobileBottomNavActive("home");
      setActivePane("editor");
      return;
    }

    if (skipNextHomeRouteSyncRef.current) {
      skipNextHomeRouteSyncRef.current = false;
      return;
    }

    setMemoView(isTrashRoute ? "trash" : "notebook");
    setRightView("editor");
    setMobileBottomNavActive("home");
  }, [isTrashRoute, route.isSettings, route.isPlugins, route.isTemplates, route.isAiPrompts, route.isExecutionCenter]);

  useEffect(() => {
    if (window.edgeeverDesktop?.isAvailable) {
      let active = true;
      const update = async () => {
        const { getDesktopSyncSummary } = await import("@/lib/desktop-sync");
        if (active) setSyncSummary(await getDesktopSyncSummary());
      };
      void update();
      return () => { active = false; };
    }
    let unsubscribe: (() => void) | undefined;
    let active = true;

    void import("@/lib/sync-queue").then(({ observeSyncQueue }) => {
      if (!active) {
        return;
      }
      unsubscribe = observeSyncQueue(setSyncSummary);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateDesktopState = () => setIsDesktop(mediaQuery.matches);

    updateDesktopState();
    mediaQuery.addEventListener("change", updateDesktopState);

    return () => mediaQuery.removeEventListener("change", updateDesktopState);
  }, []);

  useEffect(() => {
    isPullRefreshingRef.current = isPullRefreshing;
  }, [isPullRefreshing]);

  useEffect(() => {
    if (!mobilePullToRefreshActive) {
      setPullToRefreshDistance(0);
      return;
    }

    let tracking = false;
    let startX = 0;
    let startY = 0;
    let currentDistance = 0;
    let scrollContainer: HTMLElement | null = null;

    const reset = () => {
      tracking = false;
      startX = 0;
      startY = 0;
      currentDistance = 0;
      scrollContainer = null;
      setPullToRefreshDistance(0);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isPullRefreshingRef.current || isTextEntryTarget(event.target)) {
        return;
      }

      scrollContainer = getVerticalScrollContainer(event.target);

      if ((scrollContainer && scrollContainer.scrollTop > 0) || (!scrollContainer && window.scrollY > 0)) {
        return;
      }

      const touch = event.touches[0];
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) {
        return;
      }

      if ((scrollContainer && scrollContainer.scrollTop > 0) || (!scrollContainer && window.scrollY > 0)) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const deltaY = touch.clientY - startY;
      const deltaX = Math.abs(touch.clientX - startX);

      if (deltaY <= 0 || deltaX > deltaY) {
        reset();
        return;
      }

      currentDistance = Math.min(PULL_TO_REFRESH_MAX_PX, deltaY * 0.55);

      if (currentDistance > 8) {
        event.preventDefault();
        setPullToRefreshDistance(currentDistance);
      }
    };

    const handleTouchEnd = () => {
      if (!tracking) {
        return;
      }

      const shouldRefresh = currentDistance >= PULL_TO_REFRESH_TRIGGER_PX;
      reset();

      if (shouldRefresh) {
        setPullToRefreshDistance(PULL_TO_REFRESH_TRIGGER_PX);
        void refreshLatestMemos();
      }
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, [mobilePullToRefreshActive, refreshLatestMemos]);

  useWorkspaceSyncLifecycle({
    failedSyncCount: syncSummary.error,
    backgroundRefreshKey: localDataScope,
    refreshWorkspace: refreshWorkspaceFromServer,
    runQueuedSync,
    setOnline: setIsOnline,
  });

  const showDescendantNotes = useShowDescendantNotesPreference();
  useEffect(() => {
    // A changed scope must not retain hidden notes in bulk actions.
    clearMemoSelection();
  }, [showDescendantNotes, clearMemoSelection]);
  const selectedNotebookScopeIds = useMemo(
    () => (selectedNotebookId && !selectedTag ? getNotebookScopeIds(notebooks, selectedNotebookId, showDescendantNotes) : []),
    [notebooks, selectedNotebookId, selectedTag, showDescendantNotes]
  );
  const memosQuery = useInfiniteQuery({
    queryKey: ["memos", memoView, selectedNotebookId, search, memoFilterMode, memoSortMode, selectedNotebookScopeIds, selectedTag],
    queryFn: ({ pageParam }) => repository.listMemos({
        notebookId: memoView === "notebook" && !selectedTag ? selectedNotebookId : null,
        notebookIds: memoView === "notebook" && !selectedTag ? selectedNotebookScopeIds : undefined,
        q: search,
        tag: memoView === "notebook" ? selectedTag ?? undefined : undefined,
        trash: memoView === "trash",
        filter: memoFilterMode,
        sort: memoSortMode,
        offset: pageParam ? Number(pageParam) : 0,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const memos = useMemo(() => {
    const memoMap = new Map<string, MemoSummary>();

    for (const page of memosQuery.data?.pages ?? []) {
      for (const memo of page.memos) {
        const shouldUseReturnPreview =
          mobileEditorReturnPreview?.memoId === memo.id && memo.revision <= mobileEditorReturnPreview.baseRevision;

        memoMap.set(
          memo.id,
          shouldUseReturnPreview
            ? {
                ...memo,
                title: mobileEditorReturnPreview.title,
                excerpt: mobileEditorReturnPreview.excerpt,
                tags: mobileEditorReturnPreview.tags,
                updatedAt: mobileEditorReturnPreview.updatedAt,
              }
            : memo
        );
      }
    }

    return Array.from(memoMap.values());
  }, [memosQuery.data?.pages, mobileEditorReturnPreview]);
  const totalMemoCount = memosQuery.data?.pages[0]?.totalCount ?? memos.length;
  const handleLoadMoreMemos = useCallback(() => {
    if (!memosQuery.hasNextPage || memosQuery.isFetchingNextPage) {
      return;
    }

    void memosQuery.fetchNextPage();
  }, [memosQuery]);
  const selectedMemoIndex = selectedMemoId ? memos.findIndex((memo) => memo.id === selectedMemoId) : -1;
  const previousMemoId = selectedMemoIndex > 0 ? memos[selectedMemoIndex - 1]?.id : null;
  const nextMemoId =
    selectedMemoIndex >= 0 && selectedMemoIndex < memos.length - 1 ? memos[selectedMemoIndex + 1]?.id : null;
  const detailMemoId = rendererRecoveryMode ? null : selectedMemoId ?? memos[0]?.id ?? null;

  useEffect(() => {
    const selectedMemoInList = selectedMemoId ? memos.some((memo) => memo.id === selectedMemoId) : false;

    if (rendererRecoveryMode) {
      return;
    }

    if (creatingMemoSelectionRef.current || pendingCreatedMemoIdRef.current) {
      return;
    }

    if (pendingQuickSwitcherMemoIdRef.current) {
      if (!memos.some((memo) => memo.id === pendingQuickSwitcherMemoIdRef.current)) {
        return;
      }
      pendingQuickSwitcherMemoIdRef.current = null;
    }

    if (createdMemoEditId && selectedMemoId === createdMemoEditId) {
      // Keep the create request alive until the editor consumes it. The new
      // memo can appear in the list before its detail query has mounted the
      // editor, and clearing it here would lose the autofocus request.
      return;
    }

    if (memos.length === 0) {
      setSelectedMemoId(null);
      return;
    }

    if (!selectedMemoId || !selectedMemoInList) {
      setSelectedMemoId(memos[0].id);
    }
  }, [createdMemoEditId, memos, rendererRecoveryMode, selectedMemoId]);

  useEffect(() => {
    if (!rendererRecoveryMode || !selectedMemoId) return;
    clearRendererRecoveryRequired();
    setRendererRecoveryMode(false);
  }, [rendererRecoveryMode, selectedMemoId]);

  const memoQuery = useQuery({
    queryKey: detailMemoId ? memoDetailQueryKey(detailMemoId, memoView) : ["memo", detailMemoId, memoView],
    queryFn: () => repository.getMemo(detailMemoId as string, memoView === "trash"),
    enabled: Boolean(detailMemoId),
  });
  const prefetchMemoDetail = useCallback((memoId: string) => {
    void queryClient.prefetchQuery({
      queryKey: memoDetailQueryKey(memoId, memoView),
      queryFn: () => repository.getMemo(memoId, memoView === "trash"),
    });
  }, [memoView, queryClient, repository]);
  useEffect(() => {
    evictIdleMemoDetails(queryClient, detailMemoId);
  }, [detailMemoId, queryClient]);

  useEffect(() => {
    const handleMemoDetailRefreshed = (event: Event) => {
      const memo = (event as CustomEvent<MemoDetail>).detail;
      if (!memo?.id) return;

      // Repository already filters stale remotes; still refuse to regress the
      // in-memory query cache if a newer local snapshot is already present.
      let accepted = false;
      for (const view of ["notebook", "trash"] as const) {
        const key = memoDetailQueryKey(memo.id, view);
        const current = queryClient.getQueryData<{ memo: MemoDetail }>(key)?.memo;
        if (current && !shouldAcceptRemoteMemoDetail(current, memo)) {
          continue;
        }
        queryClient.setQueryData(key, { memo });
        accepted = true;
      }
      if (accepted) {
        updateMemoSummaryInLists(queryClient, memoToSummary(memo));
      }
    };

    window.addEventListener("edgeever:memo-detail-refreshed", handleMemoDetailRefreshed);
    return () => window.removeEventListener("edgeever:memo-detail-refreshed", handleMemoDetailRefreshed);
  }, [queryClient]);

  const createNotebookMutation = useMutation({
    mutationFn: repository.createNotebook,
    onSuccess: async (data) => {
      await putLocalNotebook(localDataScope, data.notebook);
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      setSelectedTag(null);
      setSelectedNotebookId(data.notebook.id);
      setActivePane("memos");
    },
  });

  const updateNotebookMutation = useMutation({
    mutationFn: ({
      notebookId,
      payload,
    }: {
      notebookId: string;
      payload: { name?: string; parentId?: string | null; sortOrder?: number };
    }) => repository.updateNotebook(notebookId, payload),
    onSuccess: async (data) => {
      if (data?.notebook) {
        await putLocalNotebook(localDataScope, data.notebook);
      }
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
    },
  });

  const deleteNotebookMutation = useMutation({
    mutationFn: repository.deleteNotebook,
    onSuccess: async (_data, notebookId) => {
      if (selectedNotebookId === notebookId) {
        setSelectedNotebookId(null);
        setSelectedMemoId(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      await queryClient.invalidateQueries({ queryKey: ["memos"] });
    },
    onError: (error) => {
      setNotebookDeleteConfirmation(null);
      setAppNoticeDialog({
        title: t("workspaceDialogs.deleteNotebookFailedTitle"),
        description: isNotebookNotEmptyError(error)
          ? t("workspaceDialogs.deleteNotebookNotEmpty")
          : t("workspaceDialogs.deleteNotebookFailed"),
      });
    },
  });

  const revealCreatedMemo = (memo: MemoDetail) => {
    const targetNotebookId = memo.notebookId;
    const isStructuredNote = Boolean(parseDiagramDocument(memo.contentMarkdown) || parseTableDocument(memo.contentMarkdown) || parseInfographicDocument(memo.contentMarkdown));

    setMemoView("notebook");
    setSearch("");
    setSelectedTag(null);
    // A newly created memo is not pinned or otherwise guaranteed to match
    // the active list filter. Leave filtered views so the selected memo
    // remains visible instead of the list effect falling back to its first
    // item (for example, the currently pinned memo).
    setMemoFilterMode("all");
    if (targetNotebookId !== selectedNotebookId) {
      setSelectedNotebookId(targetNotebookId);
    }
    cacheMemoDetail(queryClient, memo, "notebook");
    updateMemoSummaryInLists(queryClient, memoToSummary(memo));
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
      queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType: "inactive" }),
    ]);
    navigateWorkspaceHome();
    setRightView("editor");
    pendingCreatedMemoIdRef.current = memo.id;
    setCreatedMemoEditId(isStructuredNote ? null : memo.id);
    setSelectedMemoId(memo.id);
    setActivePane("editor");

    if (!isDesktopViewport() && !isStructuredNote) {
      openStandaloneMobileEditor(memo.id);
    }
  };

  const createMemoMutation = useMutation({
    mutationFn: async (input: Parameters<typeof repository.createMemo>[0]) => {
      const requiresRemoteMemo = requiresRemoteMemoForStandaloneMobileEditor({
        mobileViewport: !isDesktopViewport(),
        desktopRuntime: Boolean(window.edgeeverDesktop?.isAvailable),
      });
      const data = requiresRemoteMemo ? await api.createMemo(input) : await repository.createMemo(input);
      if (requiresRemoteMemo) notifyRepositoryMutation(localDataScope, { type: "note.created", note: data.memo });
      await putLocalMemo(localDataScope, data.memo);
      return data;
    },
    onSuccess: (data) => {
      revealCreatedMemo(data.memo);
    },
    onError: () => {
      clearPendingCreatedMemo();
      setCreatedMemoEditId(null);
    },
    onSettled: () => {
      createMemoInFlightRef.current = false;
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (input: { name: string; memoId: string }) => repository.createTemplate(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      setAppNoticeDialog({ title: t("templates.templateSaved"), description: t("templates.templateSaved") });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: (input: { name: string; description: string | null; title: string | null; contentMarkdown: string; tags: string[] }) =>
      repository.createTemplate(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      setAppNoticeDialog({ title: t("templates.templateCreated"), description: t("templates.templateCreated") });
    },
  });

  const useTemplateMutation = useMutation({
    mutationFn: async (input: { templateId: string; notebookId: string }) => {
      const requiresRemoteMemo = requiresRemoteMemoForStandaloneMobileEditor({
        mobileViewport: !isDesktopViewport(),
        desktopRuntime: Boolean(window.edgeeverDesktop?.isAvailable),
      });
      const data = requiresRemoteMemo
        ? await api.useTemplate(input.templateId, input.notebookId)
        : await repository.useTemplate(input.templateId, input.notebookId);
      if (requiresRemoteMemo) notifyRepositoryMutation(localDataScope, { type: "note.created", note: data.memo });
      await putLocalMemo(localDataScope, data.memo);
      return data;
    },
    onSuccess: (data) => {
      const targetNotebookId = data.memo.notebookId;
      setTemplatesOpen(false);
      setMemoView("notebook");
      setSearch("");
      setSelectedTag(null);
      setSelectedNotebookId(targetNotebookId);
      cacheMemoDetail(queryClient, data.memo, "notebook");
      updateMemoSummaryInLists(queryClient, memoToSummary(data.memo));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      ]);
      navigateWorkspaceHome();
      setRightView("editor");
      setCreatedMemoEditId(data.memo.id);
      setSelectedMemoId(data.memo.id);
      setActivePane("editor");
      if (!isDesktopViewport()) openStandaloneMobileEditor(data.memo.id);
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId: string) => repository.deleteTemplate(templateId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: (input: {
      templateId: string;
      payload: { name: string; description: string | null; title: string | null; contentMarkdown: string; tags: string[] };
    }) => repository.updateTemplate(input.templateId, input.payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: repository.mergeMemos,
    onSuccess: async (data) => {
      clearMemoSelection();
      cacheMemoDetail(queryClient, data.memo, "notebook");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      ]);
      navigateWorkspaceHome();
      setRightView("editor");
      setSelectedMemoId(data.memo.id);
      setActivePane("editor");
    },
  });

  const moveMemosMutation = useMutation({
    mutationFn: repository.moveMemos,
    onSuccess: async () => {
      clearMemoSelection();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      ]);
    },
  });

  const pinMemosMutation = useMutation({
    mutationFn: repository.pinMemos,
    onMutate: async ({ memoIds, isPinned }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["memos"] }),
        queryClient.cancelQueries({ queryKey: ["memo"] }),
      ]);

      const memoIdSet = new Set(memoIds);
      const previousMemoDetailQueries = queryClient.getQueriesData<{ memo: MemoDetail }>({ queryKey: ["memo"] });

      queryClient.setQueriesData<{ memo: MemoDetail }>({ queryKey: ["memo"] }, (current) =>
        current && memoIdSet.has(current.memo.id)
          ? {
              memo: { ...current.memo, isPinned },
            }
          : current
      );

      return { previousMemoDetailQueries };
    },
    onError: (_error, _variables, context) => {
      context?.previousMemoDetailQueries.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      ]);
    },
  });

  const { deleteMemosMutation, deleteMemoMutation, emptyTrashMutation } = useWorkspaceMemoRemoval({
    activePane,
    clearMemoSelection,
    memos,
    queryClient,
    repository,
    selectedMemoId,
    setActivePane,
    setAppNoticeDialog,
    setEmptyTrashConfirmationOpen,
    setSelectedMemoId,
    t,
  });

  const restoreMemoMutation = useMutation({
    mutationFn: repository.restoreMemo,
    onSuccess: (data) => {
      setMemoView("notebook");
      setSelectedTag(null);
      cacheMemoDetail(queryClient, data.memo, "notebook");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: "all" }),
      ]);
      setSelectedNotebookId(data.memo.notebookId);
      navigateWorkspaceHome();
      setRightView("editor");
      setSelectedMemoId(data.memo.id);
      setActivePane("editor");
    },
  });

  const selectedNotebook = notebooks.find((notebook) => notebook.id === selectedNotebookId) ?? null;
  const cachedSelectedMemo = detailMemoId
    ? queryClient.getQueryData<{ memo: MemoDetail }>(memoDetailQueryKey(detailMemoId, memoView))?.memo ?? null
    : null;
  const selectedMemo = memoQuery.data?.memo ?? cachedSelectedMemo;
  const selectedDiagram = parseDiagramDocument(selectedMemo?.contentMarkdown);
  const selectedTableNote = hasTableDocumentMarker(selectedMemo?.contentMarkdown);
  const selectedInfographicNote = Boolean(parseInfographicDocument(selectedMemo?.contentMarkdown));
  const desktopNotebookSidebarCollapsed = Boolean(isDesktop && notebookSidebarCollapsed);
  const desktopFocusModeActive = Boolean(
    isDesktop && desktopFocusMode && rightView === "editor" && selectedMemo && !memoSelectionModeActive
  );
  const selectionMoveNotebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const selectedMemosInCurrentList = useMemo(
    () => memos.filter((memo) => selectedMemoIds.has(memo.id)),
    [memos, selectedMemoIds]
  );

  useEffect(() => {
    const nextTargetId = resolveSelectionMoveTargetNotebookId(
      selectionMoveTargetNotebookId,
      selectionMoveNotebookOptions.map((option) => option.id),
      selectedNotebook?.id
    );

    if (nextTargetId !== selectionMoveTargetNotebookId) {
      setSelectionMoveTargetNotebookId(nextTargetId);
    }
  }, [selectedNotebook?.id, selectionMoveNotebookOptions, selectionMoveTargetNotebookId]);

  const handleCreateNotebook = (parentId?: string | null) => {
    setNotebookNameDialog({ mode: "create", parentId: parentId ?? null });
  };

  const handleRenameNotebook = (notebook: Notebook) => {
    setNotebookNameDialog({ mode: "rename", notebook });
  };

  const handleSubmitNotebookName = (name: string) => {
    if (!notebookNameDialog) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    if (notebookNameDialog.mode === "create") {
      createNotebookMutation.mutate(
        { name: trimmedName, parentId: notebookNameDialog.parentId },
        { onSuccess: () => setNotebookNameDialog(null) }
      );
      return;
    }

    if (trimmedName === notebookNameDialog.notebook.name) {
      setNotebookNameDialog(null);
      return;
    }

    updateNotebookMutation.mutate(
      { notebookId: notebookNameDialog.notebook.id, payload: { name: trimmedName } },
      { onSuccess: () => setNotebookNameDialog(null) }
    );
  };

  const handleDeleteNotebook = (notebook: Notebook) => {
    if (notebook.id === "nb_inbox" || notebook.slug === "inbox" || notebook.name === "等待分类") {
      setAppNoticeDialog({
        title: t("workspace.inboxDeleteTitle"),
        description: t("workspace.inboxDeleteDescription"),
      });
      return;
    }
    setNotebookDeleteConfirmation(notebook);
  };

  const handleImportScreenshot = useCallback(async (payload: { captureId?: string; name: string; type: string; title?: string; bytes: Uint8Array }) => {
    const importKey = screenshotImportDedupeKey(payload);
    if (!screenshotImportGate.tryBegin(importKey)) return;

    const notebookId = selectedNotebookId && notebooks.some((notebook) => notebook.id === selectedNotebookId) && memoView !== "trash"
      ? selectedNotebookId
      : defaultMemoNotebookId;
    if (!notebookId) {
      screenshotImportGate.fail();
      return;
    }

    const file = screenshotFileFromImportPayload(payload);
    if (file.size === 0) {
      screenshotImportGate.fail();
      setAppNoticeDialog({
        title: t("memoList.importScreenshotFailedTitle"),
        description: t("memoList.importScreenshotEmpty"),
      });
      return;
    }
    setTemplatesOpen(false);
    setMobileBottomNavActive("home");
    creatingMemoSelectionRef.current = true;
    let resumeDesktopSync: (() => void) | null = null;
    try {
      if (isDesktopResourceRuntime()) {
        resumeDesktopSync = await (await import("@/lib/desktop-sync")).pauseDesktopSyncForImport();
      }
      const preparedFile = imageCompressionEnabled ? (await compressImageForUpload(file)).file : file;
      const memo = await createScreenshotMemo({
        notebookId,
        title: payload.title?.trim() || "",
        file: preparedFile,
        createMemo: (input) => repository.createMemo(input),
        uploadResource: async (memoId, uploadFile) => {
          try {
            const { resource } = await repository.uploadMemoResource(memoId, uploadFile);
            return { url: toDesktopResourceUrl(resource.url), filename: resource.filename };
          } catch (error) {
            if (!isDesktopResourceRuntime()) throw error;
            const listed = await repository.listResources().catch(() => ({ resources: [] as Array<{ memoId?: string; url: string; filename?: string | null; kind?: string | null }> }));
            const existing = findMatchingMemoResource(
              listed.resources.filter((resource) => resource.memoId === memoId),
              uploadFile.name,
              "image",
            );
            if (existing) return { url: toDesktopResourceUrl(existing.url), filename: existing.filename || uploadFile.name };
            const staged = await stageDesktopResource(memoId, uploadFile);
            if (!staged) throw error;
            return { url: `edgeever-staged://${staged.id}`, filename: uploadFile.name };
          }
        },
        updateMemo: (created, content) => repository.updateMemo(created, {
          expectedRevision: created.revision,
          expectedContentHash: created.contentHash,
          editSessionId: `screenshot:${created.id}`,
          title: created.title ?? "",
          contentJson: content.contentJson,
          contentMarkdown: content.contentMarkdown,
          tags: created.tags,
        }),
        deleteMemo: (memoId) => isDesktopResourceRuntime()
          ? import("@/lib/desktop-repository").then(({ cancelPendingDesktopImportMemo }) => cancelPendingDesktopImportMemo(memoId))
          : repository.deleteMemo(memoId, true),
      });
      await putLocalMemo(localDataScope, memo);
      revealCreatedMemo(memo);
      screenshotImportGate.finish(importKey);
    } catch {
      screenshotImportGate.fail();
      creatingMemoSelectionRef.current = false;
      setAppNoticeDialog({
        title: t("memoList.importScreenshotFailedTitle"),
        description: t("memoList.importScreenshotFailed"),
      });
    } finally {
      resumeDesktopSync?.();
    }
  }, [defaultMemoNotebookId, imageCompressionEnabled, localDataScope, memoView, notebooks, repository, selectedNotebookId, t]);

  const handleImportScreenshotRef = useRef(handleImportScreenshot);
  handleImportScreenshotRef.current = handleImportScreenshot;

  const pendingWeChatImportsRef = useRef<Array<{
    ok: boolean;
    kind?: "file";
    reason?: string;
    importId?: string;
    title?: string;
    filename?: string;
    mimeType?: string;
    byteSize?: number;
    markdown?: string;
    media?: Array<{ id: string; filename: string; mimeType: string; byteSize: number }>;
  }>>([]);

  const handleImportSharedFile = useCallback(async (payload: {
    ok: boolean;
    reason?: string;
    importId?: string;
    filename?: string;
    mimeType?: string;
  }) => {
    const bridge = window.edgeeverDesktop;
    if (!payload.ok || !payload.importId || !payload.filename) {
      setAppNoticeDialog({
        title: t("memoList.importSharedFileFailedTitle"),
        description: payload.reason === "too-large"
          ? t("memoList.importSharedFileTooLarge")
          : payload.reason === "unreadable"
            ? t("memoList.importSharedFileUnreadable")
            : t("memoList.importSharedFileFailed"),
      });
      return;
    }
    const notebookId = selectedNotebookId && notebooks.some((notebook) => notebook.id === selectedNotebookId) && memoView !== "trash"
      ? selectedNotebookId
      : defaultMemoNotebookId;
    if (!notebookId) {
      pendingWeChatImportsRef.current.push({ ...payload, kind: "file" });
      return;
    }
    const importId = payload.importId;
    const filename = payload.filename;
    setTemplatesOpen(false);
    setMobileBottomNavActive("home");
    creatingMemoSelectionRef.current = true;
    setSharedFileImportsInProgress((count) => count + 1);
    let savedMemo: MemoDetail | null = null;
    let resumeDesktopSync: (() => void) | null = null;
    try {
      if (isDesktopResourceRuntime()) {
        resumeDesktopSync = await (await import("@/lib/desktop-sync")).pauseDesktopSyncForImport();
      }
      const memo = await createSharedFileMemo({
        notebookId,
        filename,
        file: await (async () => {
          const shared = await bridge?.readWeChatImportMedia?.(importId, "file");
          if (!shared?.bytes?.byteLength) throw new Error("Missing shared file");
          const bytes = shared.bytes;
          const copy = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copy).set(bytes);
          return new File([copy], shared.filename || filename, { type: shared.mimeType || payload.mimeType || "application/octet-stream" });
        })(),
        createMemo: (input) => repository.createMemo(input),
        prepareFile: async (file) => (imageCompressionEnabled && file.type.startsWith("image/")
          ? (await compressImageForUpload(file)).file
          : file),
        uploadResource: async (memoId, uploadFile) => {
          try {
            const { resource } = await repository.uploadMemoResource(memoId, uploadFile);
            return { url: toDesktopResourceUrl(resource.url), filename: resource.filename };
          } catch (error) {
            if (!isDesktopResourceRuntime()) throw error;
            const listed = await repository.listResources().catch(() => ({ resources: [] as Array<{ memoId?: string; url: string; filename?: string | null; kind?: string | null }> }));
            const existing = findMatchingMemoResource(
              listed.resources.filter((resource) => resource.memoId === memoId),
              uploadFile.name,
              uploadFile.type.startsWith("image/") ? "image" : "attachment",
            );
            if (existing) return { url: toDesktopResourceUrl(existing.url), filename: existing.filename };
            const staged = await stageDesktopResource(memoId, uploadFile);
            if (!staged) throw error;
            return { url: `edgeever-staged://${staged.id}`, filename: uploadFile.name };
          }
        },
        updateMemo: (created, content) => repository.updateMemo(created, {
          expectedRevision: created.revision,
          expectedContentHash: created.contentHash,
          editSessionId: `share:${created.id}`,
          title: created.title ?? sharedFileTitle(filename),
          contentJson: content.contentJson,
          contentMarkdown: content.contentMarkdown,
          tags: created.tags,
        }),
        deleteMemo: (memoId) => isDesktopResourceRuntime()
          ? import("@/lib/desktop-repository").then(({ cancelPendingDesktopImportMemo }) => cancelPendingDesktopImportMemo(memoId))
          : repository.deleteMemo(memoId, true),
      });
      savedMemo = memo;
      await bridge?.finishWeChatImport?.(importId, true).catch(() => undefined);
      await putLocalMemo(localDataScope, memo).catch(() => undefined);
      revealCreatedMemo(memo);
    } catch {
      if (!savedMemo) {
        await bridge?.finishWeChatImport?.(importId, false).catch(() => undefined);
        setAppNoticeDialog({
          title: t("memoList.importSharedFileFailedTitle"),
          description: t("memoList.importSharedFileFailed"),
        });
      }
      creatingMemoSelectionRef.current = false;
    } finally {
      resumeDesktopSync?.();
      setSharedFileImportsInProgress((count) => Math.max(0, count - 1));
    }
  }, [defaultMemoNotebookId, imageCompressionEnabled, localDataScope, memoView, notebooks, repository, selectedNotebookId, t]);

  const handleImportWeChatChat = useCallback(async (payload: {
    ok: boolean;
    kind?: "file";
    reason?: string;
    importId?: string;
    title?: string;
    filename?: string;
    mimeType?: string;
    markdown?: string;
    media?: Array<{ id: string; filename: string; mimeType: string; byteSize: number }>;
  }) => {
    if (payload.kind === "file") {
      await handleImportSharedFile(payload);
      return;
    }
    const bridge = window.edgeeverDesktop;
    if (!payload.ok || !payload.importId || !payload.markdown) {
      setAppNoticeDialog({
        title: t("memoList.importWeChatFailedTitle"),
        description: payload.reason === "unrecognized"
          ? t("memoList.importWeChatUnrecognized")
          : t("memoList.importWeChatFailed"),
      });
      return;
    }
    const notebookId = selectedNotebookId && notebooks.some((notebook) => notebook.id === selectedNotebookId) && memoView !== "trash"
      ? selectedNotebookId
      : defaultMemoNotebookId;
    if (!notebookId) {
      pendingWeChatImportsRef.current.push(payload);
      return;
    }
    const importId = payload.importId;
    const markdown = payload.markdown;
    setTemplatesOpen(false);
    setMobileBottomNavActive("home");
    creatingMemoSelectionRef.current = true;
    setWeChatImportsInProgress((count) => count + 1);
    let savedMemo: MemoDetail | null = null;
    let resumeDesktopSync: (() => void) | null = null;
    try {
      if (isDesktopResourceRuntime()) {
        resumeDesktopSync = await (await import("@/lib/desktop-sync")).pauseDesktopSyncForImport();
      }
      const memo = await createWeChatChatMemo({
        notebookId,
        title: payload.title?.trim() || "",
        markdown,
        media: payload.media ?? [],
        createMemo: (input) => repository.createMemo(input),
        readMedia: async (item) => {
          const file = await bridge?.readWeChatImportMedia?.(importId, item.id);
          if (!file?.bytes?.byteLength) throw new Error("Missing WeChat attachment");
          const bytes = file.bytes;
          const copy = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copy).set(bytes);
          return new File([copy], file.filename || item.filename, { type: file.mimeType || item.mimeType });
        },
        prepareFile: async (file) => (imageCompressionEnabled && file.type.startsWith("image/")
          ? (await compressImageForUpload(file)).file
          : file),
        uploadResource: async (memoId, uploadFile) => {
          try {
            const { resource } = await repository.uploadMemoResource(memoId, uploadFile);
            return { url: toDesktopResourceUrl(resource.url) };
          } catch (error) {
            if (!isDesktopResourceRuntime()) throw error;
            const listed = await repository.listResources().catch(() => ({ resources: [] as Array<{ memoId?: string; url: string; filename?: string | null; kind?: string | null }> }));
            const existing = findMatchingMemoResource(
              listed.resources.filter((resource) => resource.memoId === memoId),
              uploadFile.name,
              uploadFile.type.startsWith("image/") ? "image" : "attachment",
            );
            if (existing) return { url: toDesktopResourceUrl(existing.url) };
            const staged = await stageDesktopResource(memoId, uploadFile);
            if (!staged) throw error;
            return { url: `edgeever-staged://${staged.id}` };
          }
        },
        updateMemo: (created, content) => repository.updateMemo(created, {
          expectedRevision: created.revision,
          expectedContentHash: created.contentHash,
          editSessionId: `wechat:${created.id}`,
          title: created.title ?? payload.title ?? "",
          contentJson: content.contentJson,
          contentMarkdown: content.contentMarkdown,
          tags: created.tags,
        }),
        deleteMemo: (memoId) => isDesktopResourceRuntime()
          ? import("@/lib/desktop-repository").then(({ cancelPendingDesktopImportMemo }) => cancelPendingDesktopImportMemo(memoId))
          : repository.deleteMemo(memoId, true),
      });
      savedMemo = memo;
      await bridge?.finishWeChatImport?.(importId, true).catch(() => undefined);
      await putLocalMemo(localDataScope, memo).catch(() => undefined);
      revealCreatedMemo(memo);
    } catch {
      if (!savedMemo) {
        await bridge?.finishWeChatImport?.(importId, false).catch(() => undefined);
        setWeChatImportFailureId(importId);
      }
      creatingMemoSelectionRef.current = false;
    } finally {
      resumeDesktopSync?.();
      setWeChatImportsInProgress((count) => Math.max(0, count - 1));
    }
  }, [defaultMemoNotebookId, handleImportSharedFile, imageCompressionEnabled, localDataScope, memoView, notebooks, repository, selectedNotebookId, t]);

  const handleImportWeChatChatRef = useRef(handleImportWeChatChat);
  handleImportWeChatChatRef.current = handleImportWeChatChat;

  useEffect(() => {
    const pending = pendingWeChatImportsRef.current.splice(0);
    for (const payload of pending) void handleImportWeChatChat(payload);
  }, [handleImportWeChatChat]);

  const handleCreateMemo = (kind?: NoteCreateKind) => {
    const targetNotebookId = createMemoNotebookId;

    if (!targetNotebookId || memoView === "trash") {
      return;
    }

    // Desktop Cmd+N is handled by both the native menu and the in-app shortcut.
    // A second click can also land before React Query flips `isPending`.
    if (createMemoInFlightRef.current || createMemoMutation.isPending) {
      return;
    }
    createMemoInFlightRef.current = true;

    setTemplatesOpen(false);
    setMobileBottomNavActive("home");
    creatingMemoSelectionRef.current = true;
    if (kind === "infographic") {
      const infographic = createDefaultInfographicDocument();
      createMemoMutation.mutate({
        notebookId: targetNotebookId,
        title: t("infographic.name"),
        contentJson: markdownToDoc(infographicFallbackMarkdown(infographic)),
        contentMarkdown: serializeInfographicDocument(infographic),
        tags: [],
      });
      return;
    }
    if (kind === "table") {
      const table = createDefaultTableDocument({
        name: t("structuredTable.defaultFields.name"),
        status: t("structuredTable.defaultFields.status"),
        date: t("structuredTable.defaultFields.date"),
        sample: t("structuredTable.defaultFields.sample"),
        notStarted: t("structuredTable.defaultFields.notStarted"),
        inProgress: t("structuredTable.defaultFields.inProgress"),
        done: t("structuredTable.defaultFields.done"),
      });
      createMemoMutation.mutate({
        notebookId: targetNotebookId,
        title: t("structuredTable.name"),
        contentJson: markdownToDoc(tableFallbackMarkdown(table)),
        contentMarkdown: serializeTableDocument(table),
        tags: [],
      });
      return;
    }
    const diagram = kind ? createDefaultDiagramDocument(kind) : null;
    createMemoMutation.mutate({
      notebookId: targetNotebookId,
      title: diagram ? (kind === "mind-map" ? t("diagram.mindMap") : kind === "architecture" ? t("diagram.architecture") : t("diagram.flowchart")) : "",
      contentJson: diagram ? markdownToDoc(diagramFallbackMarkdown(diagram)) : undefined,
      contentMarkdown: diagram ? serializeDiagramDocument(diagram) : "",
      tags: [],
    });
  };

  const handleImportMarkdownFiles = async (files: File[]) => {
    const targetNotebookId = createMemoNotebookId;

    if (!targetNotebookId || memoView === "trash") return;
    if (files.length !== 1) {
      setAppNoticeDialog({
        title: t("memoList.importMarkdownFailedTitle"),
        description: t("memoList.importMarkdownSingleFile"),
      });
      return;
    }

    const [file] = files;
    if (!isMarkdownFile(file)) {
      setAppNoticeDialog({
        title: t("memoList.importMarkdownFailedTitle"),
        description: t("memoList.importMarkdownUnsupported"),
      });
      return;
    }

    try {
      const payload = await readMarkdownFile(file);
      setTemplatesOpen(false);
      setMobileBottomNavActive("home");
      creatingMemoSelectionRef.current = true;
      await createMemoMutation.mutateAsync({
        notebookId: targetNotebookId,
        title: payload.title,
        contentMarkdown: payload.contentMarkdown,
        tags: [],
      });
    } catch {
      setAppNoticeDialog({
        title: t("memoList.importMarkdownFailedTitle"),
        description: t("memoList.importMarkdownReadFailed"),
      });
    }
  };

  const handleSaveAsTemplate = async (memo: MemoDetail, name: string) => {
    await saveTemplateMutation.mutateAsync({ name, memoId: memo.id });
  };

  const handleUseSavedTemplate = (template: SavedMemoTemplate) => {
    if (!createMemoNotebookId || memoView === "trash") return;
    useTemplateMutation.mutate({ templateId: template.id, notebookId: createMemoNotebookId });
  };

  const handleMobileDefaultEditConsumed = useCallback(() => {
    pendingCreatedMemoIdRef.current = null;
    setCreatedMemoEditId(null);
  }, []);

  const handleMoveNotebook = (
    notebookId: string,
    targetNotebookId: string,
    position: NotebookDropPosition
  ) => {
    if (notebookId === targetNotebookId) {
      return;
    }

    const target = notebooks.find((notebook) => notebook.id === targetNotebookId);
    if (!target) {
      return;
    }

    updateNotebookMutation.mutate({
      notebookId,
      payload: {
        parentId: position === "inside" ? target.id : target.parentId,
        sortOrder: position === "inside" ? Date.now() : getNotebookDropSortOrder(notebooks, target, position),
      },
    });
  };

  const handleMoveSelectedMemos = (targetNotebookId: string) => {
    if (selectedMemoIds.size === 0 || memoView === "trash") {
      return;
    }

    const memoIds = getMemoIdsNeedingMove(memos, Array.from(selectedMemoIds), targetNotebookId);
    if (memoIds.length === 0) {
      return;
    }

    moveMemosMutation.mutate({
      memoIds,
      notebookId: targetNotebookId,
    });
  };

  const handleMoveDraggedMemos = (memoIds: string[], targetNotebookId: string) => {
    if (memoView === "trash" || moveMemosMutation.isPending) {
      return;
    }

    const movableMemoIds = getMemoIdsNeedingMove(memos, memoIds, targetNotebookId);
    if (movableMemoIds.length === 0) {
      return;
    }

    moveMemosMutation.mutate({
      memoIds: movableMemoIds,
      notebookId: targetNotebookId,
    });
  };

  const handleMoveMemoFromList = (memoId: string, targetNotebookId: string) => {
    if (memoView === "trash") {
      return;
    }

    const memoIds = getMemoIdsNeedingMove(memos, [memoId], targetNotebookId);
    if (memoIds.length === 0) {
      return;
    }

    moveMemosMutation.mutate({
      memoIds,
      notebookId: targetNotebookId,
    });
  };

  const handleToggleMemoPinned = (memo: MemoSummary) => {
    if (memoView === "trash") {
      return;
    }

    pinMemosMutation.mutate({
      memoIds: [memo.id],
      isPinned: !memo.isPinned,
    });
  };

  const handlePinSelectedMemos = (isPinned: boolean) => {
    if (selectedMemoIds.size === 0 || memoView === "trash") {
      return;
    }

    pinMemosMutation.mutate(
      {
        memoIds: Array.from(selectedMemoIds),
        isPinned,
      },
      {
        onSuccess: clearMemoSelection,
      }
    );
  };

  const handleMerge = () => {
    if (selectedMemoIds.size < 2 || memoView === "trash") {
      return;
    }

    mergeMutation.mutate({
      memoIds: Array.from(selectedMemoIds),
      notebookId: selectedNotebookId ?? undefined,
    });
  };

  const handleExportSelectedMemos = () => {
    if (selectedMemoIds.size === 0 || memoView === "trash" || isExportingSelectedMemos) {
      return;
    }

    setIsExportingSelectedMemos(true);
    setSelectedMarkdownExportProgress({ completed: 0, total: selectedMemoIds.size });
    void exportSelectedMemosAsMarkdownZip({
      memoIds: Array.from(selectedMemoIds),
      listNotebooks: api.listNotebooks,
      getPage: api.getMarkdownExportPage,
      getResourceBlob: api.getResourceBlob,
      onProgress: setSelectedMarkdownExportProgress,
    }).then((result) => {
      if (result.status === "too-many") {
        setAppNoticeDialog({
          title: t("workspace.selection.export"),
          description: t("workspace.selection.exportTooMany", { max: result.max }),
        });
        return;
      }
      if (result.status === "local-only") {
        setAppNoticeDialog({
          title: t("workspace.selection.export"),
          description: t("workspace.selection.exportLocalOnly"),
        });
        return;
      }
      if (result.status === "empty") {
        setAppNoticeDialog({
          title: t("workspace.selection.export"),
          description: t("workspace.selection.exportEmpty"),
        });
        return;
      }
      if (result.skippedLocal > 0) {
        setAppNoticeDialog({
          title: t("workspace.selection.export"),
          description: t("workspace.selection.exportCompleteWithSkipped", { count: result.skippedLocal }),
        });
      }
    }).catch((error: unknown) => {
      console.error("Failed to export selected notes as Markdown ZIP", error);
      setAppNoticeDialog({
        title: t("workspace.selection.export"),
        description: error instanceof MarkdownExportMemoryLimitError
          ? t("dataExport.largeBackupRequiresStreaming")
          : t("workspace.selection.exportError"),
      });
    }).finally(() => {
      setIsExportingSelectedMemos(false);
    });
  };

  const handleDeleteSelectedMemos = () => {
    if (selectedMemoIds.size === 0) {
      return;
    }

    if (memoView !== "trash") {
      deleteMemosMutation.mutate({
        memoIds: Array.from(selectedMemoIds),
        permanent: false,
      });
      return;
    }

    setMemoDeleteConfirmation({
      kind: "bulk",
      memoIds: Array.from(selectedMemoIds),
      permanent: true,
    });
  };

  const allSelectedMemosPinned =
    selectedMemosInCurrentList.length > 0 && selectedMemosInCurrentList.every((memo) => memo.isPinned);
  const selectedPinTarget = !allSelectedMemosPinned;
  const selectionPinLabel = allSelectedMemosPinned ? t("workspace.selection.unpin") : t("workspace.selection.pin");
  const selectionPinTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : memoView === "trash"
        ? t("workspace.selection.trashCannotPin")
        : pinMemosMutation.isPending
          ? t("workspace.selection.updatingPin")
          : selectionPinLabel;
  const selectedMemosNeedingMove = getMemoIdsNeedingMove(
    memos,
    Array.from(selectedMemoIds),
    selectionMoveTargetNotebookId
  );
  const canMoveSelectedMemos = selectedMemosNeedingMove.length > 0;
  const selectionMoveTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : memoView === "trash"
        ? t("workspace.selection.trashCannotMove")
        : notebooks.length === 0
          ? t("workspace.selection.noMovableNotebook")
          : moveMemosMutation.isPending
            ? t("workspace.selection.moving")
            : !canMoveSelectedMemos
              ? t("workspace.selection.alreadyInNotebook")
              : t("workspace.selection.move");
  const selectionMergeTitle =
    selectedMemoIds.size < 2
      ? t("workspace.selection.needTwoMemos")
      : memoView === "trash"
        ? t("workspace.selection.trashCannotMerge")
        : mergeMutation.isPending
          ? t("workspace.selection.merging")
          : t("workspace.selection.merge");
  const selectionExportTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : memoView === "trash"
        ? t("workspace.selection.trashCannotExport")
        : isExportingSelectedMemos
          ? t("workspace.selection.exportProgress", {
            completed: selectedMarkdownExportProgress.completed,
            total: selectedMarkdownExportProgress.total,
          })
          : t("workspace.selection.exportHint");
  const selectionDeleteTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : deleteMemosMutation.isPending || deleteMemoMutation.isPending
        ? t("workspace.selection.deleting")
        : memoView === "trash"
          ? t("workspace.selection.permanentDelete")
          : t("workspace.selection.delete");
  const memoSelectionActionBar = memoSelectionModeActive ? (
    <MemoSelectionActionBar
      canMove={canMoveSelectedMemos}
      deleteTitle={selectionDeleteTitle}
      exportTitle={selectionExportTitle}
      isDeleting={deleteMemosMutation.isPending || deleteMemoMutation.isPending}
      isExporting={isExportingSelectedMemos}
      isMerging={mergeMutation.isPending}
      isMoving={moveMemosMutation.isPending}
      isPinning={pinMemosMutation.isPending}
      isTrashView={memoView === "trash"}
      mergeTitle={selectionMergeTitle}
      moveNotebookOptions={selectionMoveNotebookOptions}
      moveTargetNotebookId={selectionMoveTargetNotebookId}
      moveTitle={selectionMoveTitle}
      onClearSelection={clearMemoSelection}
      onDelete={handleDeleteSelectedMemos}
      onExport={handleExportSelectedMemos}
      onMerge={handleMerge}
      onMove={() => handleMoveSelectedMemos(selectionMoveTargetNotebookId)}
      onMoveTargetChange={setSelectionMoveTargetNotebookId}
      onPin={() => handlePinSelectedMemos(selectedPinTarget)}
      pinLabel={selectionPinLabel}
      pinTarget={selectedPinTarget}
      pinTitle={selectionPinTitle}
      selectedCount={selectedMemoIds.size}
    />
  ) : null;

  const handleDeleteMemoFromList = (memoId: string) => {
    if (memoView !== "trash") {
      deleteMemoMutation.mutate({ memoId, permanent: false });
      return;
    }
    setMemoDeleteConfirmation({ kind: "single", memoIds: [memoId], permanent: true });
  };

  const handleConfirmMemoDeletion = () => {
    if (!memoDeleteConfirmation) {
      return;
    }

    const { kind, memoIds, permanent } = memoDeleteConfirmation;
    setMemoDeleteConfirmation(null);

    if (kind === "bulk") {
      deleteMemosMutation.mutate({ memoIds, permanent });
      return;
    }

    const [memoId] = memoIds;
    if (memoId) {
      deleteMemoMutation.mutate({ memoId, permanent });
    }
  };

  const handleRestoreMemoFromList = (memoId: string) => {
    restoreMemoMutation.mutate(memoId);
  };

  const handleEmptyTrash = () => {
    setEmptyTrashConfirmationOpen(true);
  };

  const handleConfirmEmptyTrash = () => {
    emptyTrashMutation.mutate();
  };

  const handleSelectNotebook = (notebookId: string) => {
    navigateWorkspaceHome();
    setMemoView("notebook");
    setSelectedTag(null);
    setSelectedNotebookId(notebookId);
    setMobileBottomNavActive("home");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
    setMobileNotebookPickerOpen(false);
    setActivePane("memos");
  };

  const handleSelectAllMemos = () => {
    navigateWorkspaceHome();
    setMemoView("notebook");
    setSelectedTag(null);
    setSelectedNotebookId(null);
    setRightView("editor");
    setMobileBottomNavActive("home");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
    setMobileNotebookPickerOpen(false);
    setActivePane("memos");
  };

  const handleMobileHome = () => {
    navigateWorkspaceHome();
    if (memoView === "trash") {
      setMemoView("notebook");
    }
    setMobileBottomNavActive("home");
    setSelectedTag(null);
    setSelectedNotebookId(null);
    setSearch("");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
    setActivePane("memos");
  };

  const handleSelectTag = (tag: string) => {
    navigateWorkspaceHome();
    setMemoView("notebook");
    setSelectedTag(tag);
    setSelectedNotebookId(null);
    setRightView("editor");
    setMobileBottomNavActive("home");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
    setSelectedMemoId(null);
    setActivePane("memos");
  };

  const handleMobileSearch = useCallback(() => {
    setMobileBottomNavActive("search");
    setActivePane("memos");
    setMobileSearchFocusToken((value) => value + 1);
  }, []);

  const handleGlobalSearch = useCallback(() => {
    navigateWorkspaceHome();
    setMemoView("notebook");
    setSelectedTag(null);
    setSelectedNotebookId(null);
    setMemoFilterMode("all");
    setRightView("editor");
    clearMemoSelection();
    handleMobileSearch();
  }, [clearMemoSelection, handleMobileSearch, navigateWorkspaceHome, setSelectedNotebookId]);

  const handleOpenQuickSwitcherMemo = useCallback((memo: MemoSummary) => {
    pendingQuickSwitcherMemoIdRef.current = memo.id;
    setQuickSwitcherOpen(false);
    setQuickSwitcherQuery("");
    navigateWorkspaceHome();
    setMemoView("notebook");
    setSelectedTag(null);
    setSelectedNotebookId(memo.notebookId);
    setSearch("");
    setMemoFilterMode("all");
    setRightView("editor");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
    setSelectedMemoId(memo.id);
    setActivePane("editor");
  }, [clearMemoSelection, clearPendingCreatedMemo, navigateWorkspaceHome, setSelectedMemoId, setSelectedNotebookId]);

  const handleOpenPluginNote = useCallback((memoId: string, notebookId: string, options?: { search?: string }) => {
    setRequestedPluginPanel(null);
    navigateWorkspaceHome();
    setMemoView("notebook");
    setSelectedTag(null);
    if (notebookId) setSelectedNotebookId(notebookId);
    setSearch("");
    setMemoFilterMode("all");
    setRightView("editor");
    setMobileBottomNavActive("home");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
    pendingQuickSwitcherMemoIdRef.current = memoId;
    setSelectedMemoId(memoId);
    setActivePane("editor");
    if (options?.search) {
      pluginNavigationRequestIdRef.current += 1;
      setPluginNavigationRequest({ id: pluginNavigationRequestIdRef.current, noteId: memoId, search: options.search });
    } else {
      setPluginNavigationRequest(null);
    }
  }, [clearMemoSelection, clearPendingCreatedMemo, navigateWorkspaceHome, setSelectedMemoId, setSelectedNotebookId]);

  useEffect(() => pluginHost.setNavigationAdapter({ openNote: handleOpenPluginNote }), [handleOpenPluginNote, pluginHost]);

  useEffect(() => {
    if (shouldDiscardPluginNoteSearchRequest(pluginNavigationRequest, selectedMemoId)) {
      setPluginNavigationRequest(null);
    }
  }, [pluginNavigationRequest, selectedMemoId]);

  const handleCancelMobileSearch = () => {
    setSearch("");
    setMobileBottomNavActive("home");
    clearMemoSelection();
    setActivePane("memos");
  };

  const clearHiddenMobileSearch = () => {
    if (!isDesktopViewport()) {
      setSearch("");
    }
  };

  const handleOpenAssets = () => {
    clearHiddenMobileSearch();
    skipNextHomeRouteSyncRef.current = route.pathname !== "/";
    navigateWorkspaceHome();
    setRightView("assets");
    setActivePane("editor");
  };

  const handleOpenTags = () => {
    clearHiddenMobileSearch();
    skipNextHomeRouteSyncRef.current = route.pathname !== "/";
    navigateWorkspaceHome();
    setRightView("tags");
    setActivePane("editor");
  };

  const handleOpenTemplates = () => {
    clearHiddenMobileSearch();
    navigateWorkspaceTemplates();
    setRightView("templates");
    setMobileBottomNavActive("templates");
    setActivePane("editor");
  };

  const handleOpenAiPrompts = () => {
    clearHiddenMobileSearch();
    navigateWorkspaceAiPrompts();
    setRightView("ai-prompts");
    setMobileBottomNavActive("templates");
    setActivePane("editor");
  };

  const handleOpenSettings = () => {
    clearHiddenMobileSearch();
    navigateWorkspaceSettings();
    setRightView("settings");
    setMobileBottomNavActive("settings");
    setActivePane("editor");
  };

  const handleOpenPluginManager = () => {
    clearHiddenMobileSearch();
    navigateWorkspacePlugins();
    setRightView("plugins");
    setMobileBottomNavActive("home");
    setActivePane("editor");
  };

  const handleOpenExecutionCenter = () => {
    clearHiddenMobileSearch();
    navigateWorkspaceExecutionCenter();
    setRightView("execution-center");
    setMobileBottomNavActive("home");
    setActivePane("editor");
  };

  const handleCloseExecutionCenter = () => {
    navigateWorkspaceHome();
    setRightView("editor");
    setMobileBottomNavActive("home");
    if (!isDesktopViewport()) {
      setActivePane("memos");
    }
  };

  const handleCloseAssets = () => {
    navigateWorkspaceHome();
    setRightView("editor");
    setMobileBottomNavActive("home");
  };

  const handleCloseTemplates = () => {
    setTemplatesOpen(false);
    navigateWorkspaceHome();
    setRightView("editor");
    setMobileBottomNavActive("home");
  };

  const handleCloseAiPrompts = () => {
    navigateWorkspaceHome();
    setRightView("editor");
    setMobileBottomNavActive("home");
  };

  const handleCloseSettings = () => {
    navigateWorkspaceHome();
    setRightView("editor");
    setMobileBottomNavActive("home");
    if (!isDesktopViewport()) {
      setActivePane("memos");
    }
  };

  const handleClosePluginMarketplace = () => {
    navigateWorkspaceHome();
    setRightView("editor");
    setMobileBottomNavActive("home");
    if (!isDesktopViewport()) {
      setActivePane("memos");
    }
  };

  const updateDesktopFocusMode = useCallback((enabled: boolean) => {
    runWorkspaceViewTransition(() => {
      setDesktopFocusMode(enabled);
    });
  }, []);

  const toggleDesktopFocusMode = useCallback(() => {
    updateDesktopFocusMode(!desktopFocusModeActive);
  }, [desktopFocusModeActive, updateDesktopFocusMode]);

  useEffect(() => {
    const bridge = window.edgeeverDesktop;
    if (!bridge?.isAvailable) return;
    const removeCommandListener = bridge.onCommand((command) => {
      if (command === "new-memo") handleCreateMemo();
      if (command === "new-notebook") handleCreateNotebook();
      if (command === "focus-search") handleGlobalSearch();
      if (command === "toggle-focus-mode") toggleDesktopFocusMode();
      if (command === "sync-now") {
        void runQueuedSync();
      }
      if (command === "backup-now") {
        void bridge.sidecarRequest("storage.backup", {});
      }
      if (command.startsWith("open-memo:")) {
        const memoId = command.slice("open-memo:".length);
        if (memoId) {
          navigateWorkspaceHome();
          setMemoView("notebook");
          setSelectedMemoId(memoId);
          setActivePane("editor");
        }
      }
    });
    // The Markdown listener is what marks the renderer ready, so register this first.
    const removeWeChatListener = bridge.onImportWeChatChat?.((payload) => {
      void handleImportWeChatChatRef.current(payload);
    }) ?? (() => {});
    const removeMarkdownListener = bridge.onImportMarkdown((payload) => {
      const notebookId = selectedNotebookId && notebooks.some((notebook) => notebook.id === selectedNotebookId)
        ? selectedNotebookId
        : defaultMemoNotebookId;
      if (!notebookId) return;
      const title = payload.name.replace(/\.(?:md|markdown)$/i, "").trim();
      createMemoMutation.mutate({ notebookId, title, contentMarkdown: payload.content, tags: [] });
    });
    const removeScreenshotListener = bridge.onImportScreenshot?.((payload) => {
      void handleImportScreenshotRef.current(payload);
    }) ?? (() => {});
    return () => {
      removeCommandListener();
      removeWeChatListener();
      removeMarkdownListener();
      removeScreenshotListener();
    };
  }, [createMemoMutation, defaultMemoNotebookId, handleCreateMemo, handleCreateNotebook, handleGlobalSearch, notebooks, selectedNotebookId, toggleDesktopFocusMode]);

  const handleWorkspaceBackRequest = useCallback(() => {
    if (appNoticeDialog) {
      setAppNoticeDialog(null);
      return true;
    }

    if (pendingCatalogTrustPluginIds.length > 0) {
      setPendingCatalogTrustPluginIds([]);
      return true;
    }

    if (notebookDeleteConfirmation) {
      if (!deleteNotebookMutation.isPending) {
        setNotebookDeleteConfirmation(null);
      }
      return true;
    }

    if (notebookNameDialog) {
      if (!createNotebookMutation.isPending && !updateNotebookMutation.isPending) {
        setNotebookNameDialog(null);
      }
      return true;
    }

    if (memoDeleteConfirmation) {
      if (!deleteMemosMutation.isPending && !deleteMemoMutation.isPending) {
        setMemoDeleteConfirmation(null);
      }
      return true;
    }

    if (emptyTrashConfirmationOpen) {
      if (!emptyTrashMutation.isPending) {
        setEmptyTrashConfirmationOpen(false);
      }
      return true;
    }

	    if (mobileNotebookPickerOpen) {
	      setMobileNotebookPickerOpen(false);
	      return true;
	    }

	    if (mobileListActionsOpen) {
	      setMobileListActionsOpen(false);
	      return true;
	    }

	    if (mobileMoveOpen) {
	      setMobileMoveOpen(false);
	      return true;
	    }

	    if (mobileMoreOpen) {
	      setMobileMoreOpen(false);
	      return true;
	    }

	    if (mobileSearchActive) {
	      handleCancelMobileSearch();
      return true;
    }

    if (templatesOpen) {
      handleCloseTemplates();
      return true;
    }

    if (desktopFocusModeActive) {
      updateDesktopFocusMode(false);
      return true;
    }

    if (rightView === "settings") {
      handleCloseSettings();
      return true;
    }

    if (rightView === "plugins") {
      handleClosePluginMarketplace();
      return true;
    }

    if (rightView === "execution-center") {
      handleCloseExecutionCenter();
      return true;
    }

    if (rightView === "tags") {
      handleCloseAssets();
      return true;
    }

    if (rightView === "assets") {
      handleCloseAssets();
      return true;
    }

    if (memoSelectionModeActive) {
      clearMemoSelection();
      return true;
    }

    if (visibleActivePane === "editor" || visibleActivePane === "notebooks") {
      clearPendingCreatedMemo();
      setActivePane("memos");
      return true;
    }

    return false;
  }, [
    visibleActivePane,
    desktopFocusModeActive,
    appNoticeDialog,
    pendingCatalogTrustPluginIds,
    rightView,
    clearMemoSelection,
    createNotebookMutation.isPending,
    deleteMemoMutation.isPending,
    deleteMemosMutation.isPending,
    deleteNotebookMutation.isPending,
    emptyTrashConfirmationOpen,
    emptyTrashMutation.isPending,
    handleCloseAssets,
    handleCloseSettings,
    handleCloseExecutionCenter,
    handleCloseTemplates,
    handleSelectAllMemos,
    handleCancelMobileSearch,
	    memoDeleteConfirmation,
	    memoSelectionModeActive,
	    mobileListActionsOpen,
	    mobileNotebookPickerOpen,
	    mobileMoveOpen,
	    mobileMoreOpen,
	    mobileSearchActive,
    notebookDeleteConfirmation,
    notebookNameDialog,
    templatesOpen,
    updateNotebookMutation.isPending,
    updateDesktopFocusMode,
  ]);

  useBrowserBackLayer(workspaceBackTargetActive, handleWorkspaceBackRequest);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isBackShortcut =
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        (!event.ctrlKey && !event.metaKey && event.altKey && event.key === "ArrowLeft");

      if (!isBackShortcut || event.defaultPrevented || isTextEntryTarget(event.target)) {
        return;
      }

      if (!handleWorkspaceBackRequest()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleWorkspaceBackRequest]);

  useEffect(() => {
    const handleWorkspaceShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const action = getShortcutActionForEvent(event, shortcutSettings);
      if (!action) {
        return;
      }

      if (action === "openQuickSwitcher") {
        event.preventDefault();
        if (event.repeat || event.isComposing) {
          return;
        }
        setQuickSwitcherQuery("");
        setQuickSwitcherOpen(true);
        return;
      }

      const targetElement = event.target instanceof Element ? event.target : null;
      const isEditorTextTarget = Boolean(targetElement?.closest(".ProseMirror"));

      const transientLayerOpen = Boolean(
        appNoticeDialog ||
          pendingCatalogTrustPluginIds.length > 0 ||
          rightView !== "editor" ||
          memoDeleteConfirmation ||
          emptyTrashConfirmationOpen ||
          mobileNotebookPickerOpen ||
          notebookDeleteConfirmation ||
          notebookNameDialog ||
          templatesOpen ||
          quickSwitcherOpen
      );

      if (
        action === "openAiAssistant"
        || action === "saveAndSync"
        || action === "toggleReadingProtection"
        || action === "toggleEditorMode"
        || action === "toggleOutline"
        || action === "openPreviousMemo"
        || action === "openNextMemo"
      ) {
        // These replace browser-level commands, so consume them throughout the
        // workspace even when the current editor cannot perform the action.
        event.preventDefault();

        if (event.repeat || event.isComposing || transientLayerOpen || !selectedMemoId || memoView === "trash") {
          return;
        }

        if (action === "openAiAssistant") {
          setNoteAiAssistantOpenToken((value) => value + 1);
        } else if (action === "saveAndSync") {
          setNoteSaveAndSyncToken((value) => value + 1);
        } else if (action === "toggleReadingProtection") {
          setNoteReadingProtectionToggleToken((value) => value + 1);
        } else if (action === "toggleEditorMode") {
          setNoteEditorModeToggleToken((value) => value + 1);
        } else if (action === "toggleOutline") {
          setNoteOutlineToggleToken((value) => value + 1);
        } else {
          const targetMemoId = action === "openPreviousMemo" ? previousMemoId : nextMemoId;
          if (targetMemoId) {
            clearPendingCreatedMemo();
            setCreatedMemoEditId(null);
            setSelectedMemoId(targetMemoId);
          }
        }
        return;
      }

      if ((action === "focusSearch" || action === "focusReplace") && isTextEntryTarget(event.target) && !isEditorTextTarget) {
        return;
      }

      if (transientLayerOpen) {
        return;
      }

      if (action === "focusSearch") {
        event.preventDefault();
        if (getSearchShortcutScope(selectedMemoId) === "memo-list") {
          clearMemoSelection();
          handleMobileSearch();
          return;
        }

        setNoteSearchFocusToken((value) => value + 1);
        return;
      }

      if (action === "focusGlobalSearch") {
        event.preventDefault();
        handleGlobalSearch();
        return;
      }

      if (action === "focusReplace") {
        if (!selectedMemoId || memoView === "trash" || !isDesktopViewport()) {
          return;
        }

        event.preventDefault();
        setNoteReplaceFocusToken((value) => value + 1);
        return;
      }

      event.preventDefault();

      if (action === "createNotebook") {
        if (!createNotebookMutation.isPending) {
          handleCreateNotebook(null);
        }
        return;
      }

      if (action === "createMemo" && canCreateMemo && !createMemoMutation.isPending) {
        handleCreateMemo();
      }
    };

    window.addEventListener("keydown", handleWorkspaceShortcut);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcut);
  }, [
    rightView,
    appNoticeDialog,
    pendingCatalogTrustPluginIds,
    canCreateMemo,
    clearPendingCreatedMemo,
    clearMemoSelection,
    createNotebookMutation.isPending,
    createMemoMutation.isPending,
    handleCreateNotebook,
    handleCreateMemo,
    handleGlobalSearch,
    handleMobileSearch,
    shortcutSettings,
    emptyTrashConfirmationOpen,
    memoDeleteConfirmation,
    memoView,
    mobileNotebookPickerOpen,
    notebookDeleteConfirmation,
    notebookNameDialog,
    nextMemoId,
    previousMemoId,
    quickSwitcherOpen,
    selectedMemoId,
    setSelectedMemoId,
    templatesOpen,
  ]);

  const handleMemoListResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDesktopViewport()) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const startX = event.clientX;
    const startWidth = memoListWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setMemoListWidth(startWidth + moveEvent.clientX - startX);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleResetMemoListWidth = () => {
    resetMemoListWidth();
  };

  const updateMemoListWidth = (width: number) => {
    setMemoListWidth(width);
  };

  const handleMemoListResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isDesktopViewport()) {
      return;
    }

    const step = event.shiftKey ? 48 : 16;
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") {
      nextWidth = memoListWidth - step;
    } else if (event.key === "ArrowRight") {
      nextWidth = memoListWidth + step;
    } else if (event.key === "Home") {
      nextWidth = MIN_MEMO_LIST_WIDTH_PX;
    } else if (event.key === "End") {
      nextWidth = MAX_MEMO_LIST_WIDTH_PX;
    } else if (event.key === "Enter" || event.key === " ") {
      nextWidth = DEFAULT_MEMO_LIST_WIDTH_PX;
    }

    if (nextWidth === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateMemoListWidth(nextWidth);
  };

  const shouldRenderRightPane = isDesktop || visibleActivePane === "editor";
  const rightPaneLoadingLabel =
    rightView === "settings"
      ? t("workspace.loading.settings")
      : rightView === "plugins"
        ? t("plugins.marketplace.loading")
      : rightView === "assets"
        ? t("workspace.loading.assets")
        : rightView === "tags"
          ? t("workspace.loading.tags")
        : rightView === "templates"
          ? t("templates.title")
        : rightView === "ai-prompts"
          ? t("aiPrompts.title")
        : rightView === "execution-center"
          ? t("executionHistory.centerTitle")
        : rightView === "evernote-migration"
          ? t("workspace.loading.migration")
          : t("workspace.loading.editor");
  const pullToRefreshVisible = pullToRefreshDistance > 0 || isPullRefreshing;
  const pullToRefreshReady = pullToRefreshDistance >= PULL_TO_REFRESH_TRIGGER_PX;
  const pullToRefreshLabel = isPullRefreshing
    ? isStandaloneRuntime
      ? t("workspace.pullToRefresh.refreshingNotes")
      : t("workspace.pullToRefresh.refreshingPage")
    : pullToRefreshReady
      ? isStandaloneRuntime
        ? t("workspace.pullToRefresh.releaseNotes")
        : t("workspace.pullToRefresh.releasePage")
      : isStandaloneRuntime
        ? t("workspace.pullToRefresh.pullNotes")
        : t("workspace.pullToRefresh.pullPage");
  const showMobileSettingsNav = visibleActivePane === "editor" && rightView === "settings";

  return (
    <WorkspaceMotionProvider>
      <div className="edgeever-workspace-shell flex h-[100dvh] overflow-hidden text-slate-950">
      {(wechatImportsInProgress > 0 || sharedFileImportsInProgress > 0) && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center" role="status" aria-live="polite">
          <div className="rounded-full border border-slate-200 bg-card px-4 py-2 text-sm font-medium text-slate-700 shadow-lg">
            {wechatImportsInProgress > 0 ? t("memoList.importWeChatInProgress") : t("memoList.importSharedFileInProgress")}
          </div>
        </div>
      )}
      {pullToRefreshVisible && (
        <div
          className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex justify-center lg:hidden"
          style={{ transform: `translateY(${Math.max(0, pullToRefreshDistance - 24)}px)` }}
          aria-hidden="true"
        >
          <div className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-card/95 px-3 text-xs font-semibold text-slate-600 shadow-[0_10px_28px_rgba(15,23,42,0.12)] backdrop-blur">
            <RefreshCw className={cn("h-4 w-4 text-slate-500", (isPullRefreshing || pullToRefreshReady) && "animate-spin")} />
            <span>{pullToRefreshLabel}</span>
          </div>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <main
          className={cn(
            "edgeever-workspace-grid grid h-[100dvh] min-h-0 grid-cols-[minmax(0,1fr)]",
            desktopFocusModeActive
              ? "edgeever-workspace-grid--focus"
              : rightView === "editor"
                ? "edgeever-workspace-grid--editor"
                : "edgeever-workspace-grid--single-right",
            !desktopFocusModeActive && desktopNotebookSidebarCollapsed && "edgeever-workspace-grid--sidebar-collapsed"
          )}
          style={{ "--memo-list-width": `${memoListWidth}px` } as CSSProperties}
        >
          <aside
            id="edgeever-notebook-sidebar"
            className={cn(
              "edgeever-workspace-sidebar min-h-0 overflow-hidden border-r",
              desktopFocusModeActive
                ? "hidden"
                : visibleActivePane === "notebooks"
                  ? "block lg:block"
                  : "hidden lg:block"
            )}
          >
            {(isDesktop || visibleActivePane === "notebooks") && (
              <Suspense fallback={<PaneLoadingFallback label={t("workspace.loading.notebooks")} />}>
                <NotebookPane
                  repository={repository}
                  authRequired={authRequired}
                  user={user}
                  selectedNotebookId={selectedNotebookId}
                  view={memoView}
                  canCreateMemo={canCreateMemo}
                  isCreatingMemo={createMemoMutation.isPending}
                  onSelect={(notebookId) => {
                    navigateWorkspaceHome();
                    setMemoView("notebook");
                    setSelectedTag(null);
                    setSelectedNotebookId(notebookId);
                    clearMemoSelection();
                    setRightView("editor");
                    setActivePane("memos");
                  }}
                  onCreateMemo={handleCreateMemo}
                  onCreateNotebook={handleCreateNotebook}
                  onRenameNotebook={handleRenameNotebook}
                  onDeleteNotebook={handleDeleteNotebook}
                  onMoveNotebook={handleMoveNotebook}
                  onMoveMemos={handleMoveDraggedMemos}
                  onBackToList={handleSelectAllMemos}
                  onLogout={onLogout}
                  isLoggingOut={isLoggingOut}
                  imageCompressionEnabled={imageCompressionEnabled}
                  onImageCompressionChange={setImageCompressionEnabled}
                  syncSummary={syncSummary}
                  isOnline={isOnline}
                  isSyncingQueuedChanges={isSyncingQueuedChanges}
                  onSyncQueuedChanges={() => void runQueuedSync()}
                  onDiscardConflicts={() => void discardConflictsNow()}
                  onOpenAssets={handleOpenAssets}
                  onOpenTags={handleOpenTags}
                  onOpenTemplates={handleOpenTemplates}
                  pluginHost={pluginHost}
                  onOpenPluginManager={handleOpenPluginManager}
                  onOpenSettings={handleOpenSettings}
                  onOpenTrash={() => {
                    navigateWorkspaceTrash();
                    setMemoView("trash");
                    setSelectedTag(null);
                    setSelectedNotebookId(null);
                    setMobileBottomNavActive("home");
                    clearMemoSelection();
                    setSelectedMemoId(null);
                    setActivePane("memos");
                  }}
                  onEmptyTrash={handleEmptyTrash}
                  demoMode={demoMode}
                  onResetDemo={() => setDemoResetConfirmationOpen(true)}
                  isResettingDemo={resetDemoMutation.isPending}
                  collapsed={desktopNotebookSidebarCollapsed}
                  onToggleCollapsed={() => setNotebookSidebarCollapsed(!notebookSidebarCollapsed)}
                />
              </Suspense>
            )}
          </aside>

          <section
            className={cn(
              "edgeever-workspace-memo-list relative min-w-0 overflow-hidden border-r",
              desktopFocusModeActive
                ? "hidden"
                : rightView === "editor"
                  ? (visibleActivePane === "memos" ? "block lg:block" : "hidden lg:block")
                  : (visibleActivePane === "memos" ? "block lg:hidden" : "hidden lg:hidden")
            )}
          >
            <MemoListPane
              notebook={selectedTag ? null : selectedNotebook}
              selectedTag={selectedTag}
              notebooks={notebooks}
              view={memoView}
              memos={memos}
              totalMemoCount={totalMemoCount}
              hasMoreMemos={Boolean(memosQuery.hasNextPage)}
              isLoadingMoreMemos={memosQuery.isFetchingNextPage}
              selectedMemoId={selectedMemoId}
              selectedMemoIds={selectedMemoIds}
              selectionMode={memoSelectionModeActive}
              search={search}
              filterMode={memoFilterMode}
              sortMode={memoSortMode}
              mobileSearchActive={mobileSearchActive}
              searchFocusToken={mobileSearchFocusToken}
              onFilterModeChange={setMemoFilterMode}
              onSortModeChange={setMemoSortMode}
              onLoadMoreMemos={handleLoadMoreMemos}
              canCreateMemo={canCreateMemo}
              isLoading={memosQuery.isLoading}
              isRefreshing={memosQuery.isFetching}
              isError={memosQuery.isError}
              isCreating={createMemoMutation.isPending}
              isMerging={mergeMutation.isPending}
              isExporting={isExportingSelectedMemos}
              isMoving={moveMemosMutation.isPending}
              isPinning={pinMemosMutation.isPending}
              isDeleting={deleteMemosMutation.isPending || deleteMemoMutation.isPending}
              multiSelectKeyDown={multiSelectKeyDown}
              onRetry={() => void memosQuery.refetch()}
              onOpenNotebookPicker={() => setMobileNotebookPickerOpen(true)}
              onSearch={setSearch}
              onCancelMobileSearch={handleCancelMobileSearch}
              onCreateMemo={handleCreateMemo}
              onImportMarkdownFiles={(files) => void handleImportMarkdownFiles(files)}
              onClearSelection={clearMemoSelection}
              onEnterSelectionMode={enterMemoSelectionMode}
              onReplaceSelection={replaceMemoSelection}
              onOpenAssets={handleOpenAssets}
              onOpenTags={handleOpenTags}
              onOpenSettings={handleOpenSettings}
              onSyncMemos={() => void syncMemosManually()}
              isSyncingMemos={isManualMemoSyncing || isSyncingQueuedChanges || isPullRefreshing || memosQuery.isRefetching}
              canSyncMemos={isOnline}
              onOpenTrash={() => {
                navigateWorkspaceTrash();
                setMemoView("trash");
                setSelectedTag(null);
                setSelectedNotebookId(null);
                setMobileBottomNavActive("home");
                clearMemoSelection();
                clearPendingCreatedMemo();
                setCreatedMemoEditId(null);
                setSelectedMemoId(null);
                setActivePane("memos");
              }}
              onBackFromTrash={handleSelectAllMemos}
              onClearTag={handleSelectAllMemos}
              onOpenMemo={(memoId) => {
                if (shouldNavigateHomeWhenOpeningMemo(memoView)) {
                  navigateWorkspaceHome();
                }
                setRightView("editor");
                clearPendingCreatedMemo();
                setCreatedMemoEditId(null);
                setSelectedMemoId(memoId);
                setActivePane("editor");
              }}
              onPrefetchMemo={prefetchMemoDetail}
              onToggleMemo={(memoId, rangeMemoIds) => {
                setMemoSelectionMode(true);
                setSelectedMemoIds((current) => {
                  if (!rangeMemoIds?.length) {
                    return toggleMobileMemoSelection(current, memoId);
                  }
                  const next = new Set(current);
                  for (const rangeMemoId of rangeMemoIds) {
                    next.add(rangeMemoId);
                  }
                  return next;
                });
              }}
              onMerge={handleMerge}
              onDeleteMemo={handleDeleteMemoFromList}
              onEmptyTrash={handleEmptyTrash}
              onRestoreMemo={handleRestoreMemoFromList}
              onMoveMemo={handleMoveMemoFromList}
              onRequestDocumentAction={(memoId: string, action: MemoDocumentAction, printWindow?: Window | null) => {
                if (shouldNavigateHomeWhenOpeningMemo(memoView)) {
                  navigateWorkspaceHome();
                }
                setRightView("editor");
                clearPendingCreatedMemo();
                setCreatedMemoEditId(null);
                setSelectedMemoId(memoId);
                setActivePane("editor");
                memoDocumentActionIdRef.current += 1;
                setMemoDocumentActionRequest({
                  id: memoDocumentActionIdRef.current,
                  memoId,
                  action,
                  printWindow,
                });
              }}
              onCopyMemoToWeChat={async (memoId) => {
                const openTextNote = selectedMemo?.id === memoId
                  && !selectedDiagram
                  && !selectedTableNote
                  && !selectedInfographicNote;
                if (openTextNote) {
                  memoDocumentActionIdRef.current += 1;
                  setMemoDocumentActionRequest({
                    id: memoDocumentActionIdRef.current,
                    memoId,
                    action: "copy-wechat",
                  });
                  return "editor";
                }

                try {
                  const { memo } = await repository.getMemo(memoId, memoView === "trash");
                  await copyMarkdownToWeChat(memo.contentMarkdown);
                  return "copied";
                } catch {
                  return "error";
                }
              }}
              onTogglePinMemo={handleToggleMemoPinned}
              onPinSelectedMemos={handlePinSelectedMemos}
              onExportSelectedMemos={handleExportSelectedMemos}
              onDeleteSelectedMemos={handleDeleteSelectedMemos}
              onMoveSelectedMemos={handleMoveSelectedMemos}
              mobileListActionsOpen={mobileListActionsOpen}
              setMobileListActionsOpen={setMobileListActionsOpen}
              mobileMoveOpen={mobileMoveOpen}
              setMobileMoveOpen={setMobileMoveOpen}
              mobileMoreOpen={mobileMoreOpen}
              setMobileMoreOpen={setMobileMoreOpen}
              desktopFilterOpen={desktopFilterOpen}
              setDesktopFilterOpen={setDesktopFilterOpen}
              desktopSortOpen={desktopSortOpen}
              setDesktopSortOpen={setDesktopSortOpen}
              desktopActionsOpen={desktopActionsOpen}
              setDesktopActionsOpen={setDesktopActionsOpen}
            />
            <div
              className="absolute inset-y-0 right-[-3px] z-20 hidden w-1.5 cursor-col-resize transition hover:bg-slate-300/70 focus-visible:bg-slate-400/80 focus-visible:outline-none lg:block"
              role="separator"
              aria-orientation="vertical"
              aria-valuemin={MIN_MEMO_LIST_WIDTH_PX}
              aria-valuemax={MAX_MEMO_LIST_WIDTH_PX}
              aria-valuenow={memoListWidth}
              aria-label={t("workspaceDialogs.resizeMemoList")}
              tabIndex={0}
              title={t("workspaceDialogs.resizeMemoListHint")}
              onDoubleClick={handleResetMemoListWidth}
              onKeyDown={handleMemoListResizeKeyDown}
              onPointerDown={handleMemoListResizePointerDown}
            />
          </section>

          <section className={cn("edgeever-workspace-editor min-h-0 min-w-0 lg:block", visibleActivePane === "editor" ? "block" : "hidden", showMobileSettingsNav && "pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0")}>
            {shouldRenderRightPane && (
              <Suspense fallback={<PaneLoadingFallback label={rightPaneLoadingLabel} />}>
                <m.div key={rightView} className="h-full min-h-0 min-w-0" {...paneEnterMotion}>
                  {rightView === "settings" ? (
                    <SettingsPane
                    onOpenExecutionCenter={handleOpenExecutionCenter}
                    onClose={handleCloseSettings}
                    onOpenTemplates={handleOpenTemplates}
                  onOpenAiPrompts={handleOpenAiPrompts}
                    imageCompressionEnabled={imageCompressionEnabled}
                    onImageCompressionChange={setImageCompressionEnabled}
                    shortcutSettings={shortcutSettings}
                    onShortcutSettingsChange={setShortcutSettings}
                    editorContentWidth={editorContentWidth}
                    onEditorContentWidthChange={setEditorContentWidth}
                    noteProse={noteProse}
                    onNoteProseChange={updateNoteProse}
                    onLogout={onLogout}
                    isLoggingOut={isLoggingOut}
                    authRequired={authRequired}
                    demoMode={demoMode}
                    isOwner={authRequired && user?.role === "owner"}
                    user={user}
                    refreshWorkspaceAfterImport={async () => {
                      await refreshWorkspaceFromServer("manual");
                    }}
                  />
                  ) : rightView === "plugins" ? (
                    <PluginMarketplacePane host={pluginHost} onClose={handleClosePluginMarketplace} onOpenExecutionCenter={handleOpenExecutionCenter} />
                  ) : rightView === "assets" ? (
                    <AssetsPane onClose={handleCloseAssets} repository={repository} onOpenExecutionCenter={handleOpenExecutionCenter} />
                  ) : rightView === "tags" ? (
                    <TagsPane onClose={handleCloseAssets} onSelectTag={handleSelectTag} repository={repository} onOpenExecutionCenter={handleOpenExecutionCenter} />
                  ) : rightView === "templates" ? (
                    <TemplatesPane
                    canCreateMemo={canCreateMemo}
                    isCreating={createMemoMutation.isPending || createTemplateMutation.isPending}
                    onClose={handleCloseTemplates}
                    onCreateSavedTemplate={async (payload) => {
                      await createTemplateMutation.mutateAsync(payload);
                    }}
                    savedTemplates={savedTemplates}
                    onUseSavedTemplate={handleUseSavedTemplate}
                    onDeleteSavedTemplate={(template) => deleteTemplateMutation.mutate(template.id)}
                    onUpdateSavedTemplate={async (templateId, payload) => {
                      await updateTemplateMutation.mutateAsync({ templateId, payload });
                    }}
                    onOpenExecutionCenter={handleOpenExecutionCenter}
                  />
                  ) : rightView === "ai-prompts" ? (
                    <AiPromptsPane key={localDataScope} onClose={handleCloseAiPrompts} onOpenExecutionCenter={handleOpenExecutionCenter} />
                  ) : rightView === "execution-center" ? (
                    <ExecutionCenterPane currentDeviceId={scheduledTaskDeviceId} onClose={handleCloseExecutionCenter} />
                  ) : rightView === "evernote-migration" ? (
                    <EvernoteImportGuidePane onClose={() => setRightView("settings")} onOpenExecutionCenter={handleOpenExecutionCenter} />
                  ) : rendererRecoveryMode ? (
                    <EditorRecoveryPane />
                  ) : memoSelectionModeActive ? (
                    <div className="flex h-full min-w-0 flex-col bg-transparent">
                      {memoSelectionActionBar}
                    </div>
                  ) : (
                    <EditorPaneErrorBoundary
                      resetKey={selectedMemo?.id ?? selectedMemoId}
                      onBackToList={() => {
                        setRendererRecoveryMode(true);
                        setSelectedMemoId(null);
                        setActivePane("memos");
                      }}
                    >
                      {selectedMemo && selectedDiagram ? (
                        <DiagramEditorPane
                          memo={selectedMemo}
                          notebooks={notebooks}
                          repository={repository}
                          readOnly={memoView === "trash" || selectedMemo.isDeleted}
                          desktopFocusMode={desktopFocusModeActive}
                          onBackToList={() => {
                            clearPendingCreatedMemo();
                            setActivePane("memos");
                          }}
                          onDeleted={async (memoId) => {
                            deleteMemoMutation.mutate({ memoId, permanent: false });
                          }}
                          onPermanentDeleted={async (memoId) => {
                            setMemoDeleteConfirmation({ kind: "single", memoIds: [memoId], permanent: true });
                          }}
                          onRestored={async (memoId) => {
                            await restoreMemoMutation.mutateAsync(memoId);
                          }}
                          onSaved={async (memo) => {
                            await putLocalMemo(localDataScope, memo);
                            cacheMemoDetail(queryClient, memo, memoView);
                            updateMemoSummaryInLists(queryClient, memoToSummary(memo));
                            await Promise.all([
                              queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
                              queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType: "inactive" }),
                            ]);
                          }}
                          onSaveAsTemplate={handleSaveAsTemplate}
                          onToggleDesktopFocusMode={toggleDesktopFocusMode}
                          onOpenExecutionCenter={handleOpenExecutionCenter}
                          aiAssistantOpenToken={noteAiAssistantOpenToken}
                          shortcutSettings={shortcutSettings}
                          companionAvailable={authRequired && Boolean(user) && !demoMode}
                          beforeCompanionApply={async () => {
                            const { assertCompanionChangesSynced } = await import("@/lib/companion-actions");
                            await assertCompanionChangesSynced(localDataScope);
                          }}
                          onCompanionNotesChanged={async () => {
                            const result = await refreshWorkspaceFromServer("manual");
                            if ("skipped" in result && result.skipped) throw new Error("Workspace refresh was skipped.");
                          }}
                          onOpenCompanionNote={handleOpenPluginNote}
                        />
                      ) : selectedMemo && selectedInfographicNote ? (
                        <InfographicEditorPane
                          key={selectedMemo.id}
                          memo={selectedMemo}
                          notebooks={notebooks}
                          repository={repository}
                          readOnly={memoView === "trash" || selectedMemo.isDeleted}
                          desktopFocusMode={desktopFocusModeActive}
                          onBackToList={() => {
                            clearPendingCreatedMemo();
                            setActivePane("memos");
                          }}
                          onOpenExecutionCenter={handleOpenExecutionCenter}
                          onToggleDesktopFocusMode={toggleDesktopFocusMode}
                          aiAssistantOpenToken={noteAiAssistantOpenToken}
                          shortcutSettings={shortcutSettings}
                          onOpenCompanionNote={handleOpenPluginNote}
                          onSaved={async (memo) => {
                            await putLocalMemo(localDataScope, memo);
                            cacheMemoDetail(queryClient, memo, memoView);
                            updateMemoSummaryInLists(queryClient, memoToSummary(memo));
                            await Promise.all([
                              queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
                              queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType: "inactive" }),
                            ]);
                          }}
                        />
                      ) : selectedMemo && selectedTableNote ? (
                        <TableEditorPane
                          key={selectedMemo.id}
                          memo={selectedMemo}
                          notebooks={notebooks}
                          repository={repository}
                          readOnly={memoView === "trash" || selectedMemo.isDeleted}
                          aiAssistantOpenToken={noteAiAssistantOpenToken}
                          shortcutSettings={shortcutSettings}
                          companionAvailable={authRequired && Boolean(user) && !demoMode}
                          beforeCompanionApply={async () => {
                            const { assertCompanionChangesSynced } = await import("@/lib/companion-actions");
                            await assertCompanionChangesSynced(localDataScope);
                          }}
                          onCompanionNotesChanged={async () => {
                            const result = await refreshWorkspaceFromServer("manual");
                            if ("skipped" in result && result.skipped) throw new Error("Workspace refresh was skipped.");
                          }}
                          onOpenCompanionNote={handleOpenPluginNote}
                          onBackToList={() => {
                            clearPendingCreatedMemo();
                            setActivePane("memos");
                          }}
                          onSaved={async (memo) => {
                            await putLocalMemo(localDataScope, memo);
                            cacheMemoDetail(queryClient, memo, memoView);
                            updateMemoSummaryInLists(queryClient, memoToSummary(memo));
                            await Promise.all([
                              queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
                              queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType: "inactive" }),
                            ]);
                          }}
                        />
                      ) : (
                      <EditorPane
                      demoMode={demoMode}
                      onOpenExecutionCenter={handleOpenExecutionCenter}
                      memo={selectedMemo}
                      repository={repository}
                      pluginHost={pluginHost}
                      pluginNavigationRequest={pluginNavigationRequest}
                    onOpenAiPrompts={handleOpenAiPrompts}
                    companionAvailable={authRequired && Boolean(user) && !demoMode}
                    beforeCompanionApply={async () => {
                      const { assertCompanionChangesSynced } = await import("@/lib/companion-actions");
                      await assertCompanionChangesSynced(localDataScope);
                    }}
                    onCompanionNotesChanged={async () => {
                      const result = await refreshWorkspaceFromServer("manual");
                      if ("skipped" in result && result.skipped) throw new Error("Workspace refresh was skipped.");
                    }}
                    onOpenCompanionNote={handleOpenPluginNote}
                    desktopFocusMode={desktopFocusModeActive}
                    onToggleDesktopFocusMode={toggleDesktopFocusMode}
                    editorContentWidth={editorContentWidth}
                    noteProse={noteProse}
                    mobileDefaultEditMemoId={createdMemoEditId}
                    isTrashView={memoView === "trash"}
                    notebooks={notebooks}
                    isLoading={memoQuery.isLoading}
                    contentSearchQuery={search}
                    searchFocusToken={noteSearchFocusToken}
                    replaceFocusToken={noteReplaceFocusToken}
                    aiAssistantOpenToken={noteAiAssistantOpenToken}
                    saveAndSyncToken={noteSaveAndSyncToken}
                    readingProtectionToggleToken={noteReadingProtectionToggleToken}
                    editorModeToggleToken={noteEditorModeToggleToken}
                    outlineToggleToken={noteOutlineToggleToken}
                    shortcutSettings={shortcutSettings}
                    onSyncRequested={syncMemosManually}
                    documentActionRequest={memoDocumentActionRequest}
                    onDocumentActionConsumed={(requestId) => {
                      setMemoDocumentActionRequest((current) => current?.id === requestId ? null : current);
                    }}
                    onOpenMemo={(memoId) => {
                      clearPendingCreatedMemo();
                      setMemoView("notebook");
                      setSelectedMemoId(memoId);
                      setActivePane("editor");
                    }}
                    imageCompressionEnabled={imageCompressionEnabled}
                    selectionActionBar={memoSelectionActionBar}
                    onBackToList={() => {
                      applyMobileEditorReturnPreview(selectedMemo?.id ?? selectedMemoId);
                      clearPendingCreatedMemo();
                      setActivePane("memos");
                    }}
                    onSaved={async (memo) => {
                      await putLocalMemo(localDataScope, memo);
                      cacheMemoDetail(queryClient, memo, memoView);
                      updateMemoSummaryInLists(queryClient, memoToSummary(memo));
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
                        ...(search.trim()
                          ? [
                              queryClient.invalidateQueries({
                                queryKey: [
                                  "memos",
                                  memoView,
                                  selectedNotebookId,
                                  search,
                                  memoFilterMode,
                                  memoSortMode,
                                  selectedNotebookScopeIds,
                                  selectedTag,
                                ],
                                exact: true,
                                refetchType: "active",
                              }),
                            ]
                          : []),
                        queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType: "inactive" }),
                      ]);
                    }}
                    onDeleted={async (memoId) => {
                      deleteMemoMutation.mutate({ memoId, permanent: false });
                    }}
                    onPermanentDeleted={async (memoId) => {
                      setMemoDeleteConfirmation({ kind: "single", memoIds: [memoId], permanent: true });
                    }}
                    onRestored={async (memoId) => {
                      await restoreMemoMutation.mutateAsync(memoId);
                    }}
                    onMobileDefaultEditConsumed={handleMobileDefaultEditConsumed}
                    onSaveAsTemplate={handleSaveAsTemplate}
                    />
                      )}
                    </EditorPaneErrorBoundary>
                  )}
                </m.div>
              </Suspense>
            )}
          </section>
        </main>
      </div>

      <QuickMemoSwitcher
        open={quickSwitcherOpen}
        query={quickSwitcherQuery}
        repository={repository}
        onOpenChange={(open) => {
          setQuickSwitcherOpen(open);
          if (!open) {
            setQuickSwitcherQuery("");
          }
        }}
        onQueryChange={setQuickSwitcherQuery}
        onOpenMemo={handleOpenQuickSwitcherMemo}
      />

      {memoDeleteConfirmation && (
        <MemoDeleteConfirmDialog
          confirmation={memoDeleteConfirmation}
          isDeleting={deleteMemosMutation.isPending || deleteMemoMutation.isPending}
          onCancel={() => setMemoDeleteConfirmation(null)}
          onConfirm={handleConfirmMemoDeletion}
        />
      )}
      {emptyTrashConfirmationOpen && (
        <AppConfirmDialog
          title={t("workspaceDialogs.emptyTrashTitle")}
          description={t("workspaceDialogs.emptyTrashDescription")}
          confirmLabel={t("workspaceDialogs.emptyTrashConfirm")}
          closeOnBrowserBack={false}
          isWorking={emptyTrashMutation.isPending}
          tone="danger"
          onCancel={() => setEmptyTrashConfirmationOpen(false)}
          onConfirm={handleConfirmEmptyTrash}
        />
      )}
      {notebookNameDialog && (
        <NotebookNameDialog
          dialog={notebookNameDialog}
          isSaving={createNotebookMutation.isPending || updateNotebookMutation.isPending}
          onCancel={() => setNotebookNameDialog(null)}
          onSubmit={handleSubmitNotebookName}
        />
      )}
      {notebookDeleteConfirmation && (
        <AppConfirmDialog
          title={t("workspaceDialogs.deleteNotebookTitle", { name: notebookDeleteConfirmation.name })}
          description={t("workspaceDialogs.deleteNotebookDescription")}
          confirmLabel={t("common.delete")}
          closeOnBrowserBack={false}
          isWorking={deleteNotebookMutation.isPending}
          tone="danger"
          onCancel={() => setNotebookDeleteConfirmation(null)}
          onConfirm={() => {
            deleteNotebookMutation.mutate(notebookDeleteConfirmation.id, {
              onSuccess: () => setNotebookDeleteConfirmation(null),
            });
          }}
        />
      )}
      {appNoticeDialog && (
        <AppConfirmDialog
          title={appNoticeDialog.title}
          description={appNoticeDialog.description}
          confirmLabel={t("workspaceDialogs.ok")}
          closeOnBrowserBack={false}
          hideCancel
          tone="neutral"
          onCancel={() => setAppNoticeDialog(null)}
          onConfirm={() => setAppNoticeDialog(null)}
        />
      )}
      {wechatImportFailureId && (
        <AppConfirmDialog
          title={t("memoList.importWeChatFailedTitle")}
          description={t("memoList.importWeChatRetryHint")}
          confirmLabel={t("memoList.importWeChatRetry")}
          closeOnBrowserBack={false}
          tone="neutral"
          onCancel={() => setWeChatImportFailureId(null)}
          onConfirm={() => {
            const importId = wechatImportFailureId;
            setWeChatImportFailureId(null);
            void Promise.resolve(window.edgeeverDesktop?.retryWeChatImport?.(importId) ?? false).then((retried) => {
              if (!retried) setAppNoticeDialog({
                title: t("memoList.importWeChatFailedTitle"),
                description: t("memoList.importWeChatFailed"),
              });
            }).catch(() => setAppNoticeDialog({
              title: t("memoList.importWeChatFailedTitle"),
              description: t("memoList.importWeChatFailed"),
            }));
          }}
        />
      )}
      {pendingCatalogTrustPluginIds.length > 0 ? (
        <AppConfirmDialog
          title={t(PLUGIN_TRUST_WARNING_COPY.titleKey)}
          description={t(PLUGIN_TRUST_WARNING_COPY.descriptionKey)}
          confirmLabel={t(PLUGIN_TRUST_WARNING_COPY.confirmLabelKey)}
          closeOnBrowserBack={false}
          tone="neutral"
          onCancel={() => setPendingCatalogTrustPluginIds([])}
          onConfirm={() => {
            const pluginIds = pendingCatalogTrustPluginIds;
            acknowledgePluginTrustWarning();
            setPendingCatalogTrustPluginIds([]);
            void Promise.all(pluginIds.map((pluginId) => pluginHost.setEnabled(pluginId, true).catch(() => undefined)));
          }}
        />
      ) : null}
      {demoResetConfirmationOpen && (
        <AppConfirmDialog
          title={t("demo.resetTitle")}
          description={t("demo.resetDescription")}
          confirmLabel={t("demo.resetConfirm")}
          cancelLabel={t("common.cancel")}
          isWorking={resetDemoMutation.isPending}
          tone="primary"
          onCancel={() => setDemoResetConfirmationOpen(false)}
          onConfirm={() => resetDemoMutation.mutate()}
        />
      )}
      <PluginPanelDialog
        host={pluginHost}
        panel={requestedPluginPanel?.panel ?? null}
        options={requestedPluginPanel?.options}
        onClose={() => setRequestedPluginPanel(null)}
      />
      {(visibleActivePane !== "editor" || showMobileSettingsNav) && !memoSelectionModeActive && (
        <MobileBottomNav
          activeItem={mobileBottomNavActive}
          canCreateMemo={canCreateMemo && memoView !== "trash"}
          isCreating={createMemoMutation.isPending}
          onCreateMemo={handleCreateMemo}
          onHome={handleMobileHome}
          onOpenSettings={handleOpenSettings}
        />
      )}
      {mobileNotebookPickerOpen && (
        <MobileNotebookPicker
          currentLabel={memoView === "trash" ? t("notebookPane.trash") : selectedTag ? `#${selectedTag}` : undefined}
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
          onClose={() => setMobileNotebookPickerOpen(false)}
          onSelectAll={handleSelectAllMemos}
          onSelect={handleSelectNotebook}
        />
      )}
      </div>
    </WorkspaceMotionProvider>
  );
};
export default WorkspaceApp;
