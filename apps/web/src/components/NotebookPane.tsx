import { lazy, Suspense, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import {
  ChevronLeft,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  LayoutGrid,
  LayoutList,
  LayoutTemplate,
  GitFork,
  Component,
  PieChart,
  Table2,
  BookPlus,
  ArrowDownWideNarrow,
  Notebook as NotebookIcon,
  Tag,
  Paperclip,
  Trash2,
  KeyRound,
  LogOut,
  CloudOff,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  CircleUserRound,
  RotateCcw,
  FileText,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotebookTreeItem } from "./NotebookTreeItem";
import { cn } from "@/lib/utils";
import { useShowDescendantNotesPreference } from "@/lib/descendant-notes-preference";
import { BETA_BADGE_CLASSNAME } from "@/lib/workspace-ui";
import type { Notebook, AuthUser, NoteCreateKind } from "@edgeever/shared";
import type { NotebookNode, NotebookDropPosition, NotebookSortMode } from "@/lib/app-helpers";
import type { SyncQueueSummary } from "@/lib/sync-queue";
import {
  buildNotebookTree,
  getNotebookSortOptions,
  getNotebookSortComparator,
  hasEdgeEverDragData,
  readNotebookTreeCollapsedIdsPreference,
  readNotebookSortPreference,
  writeNotebookTreeCollapsedIdsPreference,
  writeNotebookSortPreference,
} from "@/lib/app-helpers";
import type { EdgeEverRepository } from "@/lib/repository";
import type { EdgeEverPluginHost } from "@/lib/plugins/plugin-host";
import { statusSettleMotion } from "@/lib/motion";
import { DesktopUpdateNotice } from "./DesktopUpdateNotice";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";
import { PluginToolbarMenu } from "./plugins/PluginToolbarMenu";

const DesktopSyncIssuesDialog = lazy(() => import("./DesktopSyncIssuesDialog").then((module) => ({ default: module.DesktopSyncIssuesDialog })));

const NOTEBOOK_SIDEBAR_ID = "edgeever-notebook-sidebar";
const NOTEBOOK_DRAG_SCROLL_EDGE_PX = 56;
const NOTEBOOK_DRAG_SCROLL_MAX_STEP_PX = 18;
const SidebarNavButton = ({
  active = false,
  tone = "default",
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  tone?: "default" | "warning";
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-xs font-medium leading-none transition-all duration-200",
      tone === "warning"
        ? "text-amber-700 hover:bg-amber-50/70 hover:text-amber-800"
        : active
          ? "edgeever-workspace-selection text-slate-950 font-medium"
          : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
    )}
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <span className="flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-200">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

const SidebarShortcutButton = ({
  active = false,
  icon,
  label,
  onClick,
  showTooltip = true,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  showTooltip?: boolean;
}) => {
  const button = (
    <button
      className={cn(
        "flex h-9 min-w-0 w-full items-center justify-center rounded-md px-0 text-xs font-medium transition-colors duration-200",
        active ? "edgeever-workspace-selection text-slate-950" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
      )}
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={onClick}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="sr-only">{label}</span>
    </button>
  );

  return showTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
};

const SidebarTrashShortcut = ({
  active = false,
  onOpenTrash,
  onEmptyTrash,
}: {
  active?: boolean;
  onOpenTrash: () => void;
  onEmptyTrash: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <div className="group relative min-w-0 [container-type:inline-size]">
      <SidebarShortcutButton active={active} icon={<Trash2 className="h-4 w-4" />} label={t("notebookPane.trash")} onClick={onOpenTrash} showTooltip={false} />
      {!active && (
        <div className="pointer-events-none absolute right-0 top-full z-20 w-max pt-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <button
            className="relative flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-card px-2 text-xs font-medium text-rose-700 shadow-lg shadow-slate-900/10 transition-colors before:absolute before:-top-1 before:right-[calc(50cqw-4px)] before:h-2 before:w-2 before:rotate-45 before:border-l before:border-t before:border-rose-200 before:bg-card hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70"
            type="button"
            onClick={onEmptyTrash}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("notebookPane.emptyTrash")}
          </button>
        </div>
      )}
    </div>
  );
};

const SidebarSectionLabel = ({ icon, label }: { icon: ReactNode; label: string }) => (
  <div className="flex h-9 items-center gap-3 px-3 text-xs font-medium leading-none tracking-wide text-slate-500">
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </div>
);

const SidebarCollapseButton = ({
  collapsed,
  onToggle,
  className,
  tooltipSide = "bottom",
  shortcutLabel,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  shortcutLabel?: string;
}) => {
  const { t } = useTranslation();
  const label = t(collapsed ? "notebookPane.expandSidebar" : "notebookPane.collapseSidebar");
  const tooltipLabel = shortcutLabel ? `${label} (${shortcutLabel})` : label;

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
              className
            )}
            aria-label={label}
            aria-expanded={!collapsed}
            aria-controls={NOTEBOOK_SIDEBAR_ID}
            onClick={onToggle}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const SidebarRailButton = ({
  active = false,
  icon,
  label,
  notice = false,
  onClick,
  disabled = false,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  notice?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        disabled={disabled}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        onClick={onClick}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-50",
          active && "edgeever-workspace-selection text-slate-950"
        )}
      >
        {icon}
        {notice ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-[var(--workspace-sidebar)]" /> : null}
      </button>
    </TooltipTrigger>
    <TooltipContent side="right">{label}</TooltipContent>
  </Tooltip>
);

const CreateMemoTypeItems = ({ onCreateMemo }: { onCreateMemo: (kind?: NoteCreateKind) => void }) => {
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo()}>
        <FileText className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("diagram.normalNote")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("mind-map")}>
        <GitFork className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("diagram.mindMap")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("flowchart")}>
        <Workflow className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("diagram.flowchart")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("architecture")}>
        <Component className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("diagram.architecture")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("infographic")}>
        <PieChart className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("infographic.name")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("poster")}>
        <FileText className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("poster.name")}</span>
        <span className={BETA_BADGE_CLASSNAME}>Beta</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 text-xs leading-5" onSelect={() => onCreateMemo("table")}>
        <Table2 className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("structuredTable.name")}</span>
      </DropdownMenuItem>
    </>
  );
};

const getSyncStatusLabel = (summary: SyncQueueSummary, isOnline: boolean, isSyncing: boolean, t: ReturnType<typeof useTranslation>["t"]) => {
  if (!isOnline) {
    return summary.total > 0 ? t("notebookPane.sync.offlineWithPending", { count: summary.total }) : t("notebookPane.sync.offline");
  }

  if (isSyncing || summary.syncing > 0) {
    return t("notebookPane.sync.syncing");
  }

  if (summary.conflict > 0) {
    return t("notebookPane.sync.conflicts", { count: summary.conflict });
  }

  if (summary.error > 0) {
    return t("notebookPane.sync.retry", { count: summary.error });
  }

  if (summary.pending > 0) {
    return t("notebookPane.sync.pending", { count: summary.pending });
  }

  return t("notebookPane.sync.synced");
};

const SyncStatusBar = ({
  summary,
  isOnline,
  isSyncing,
  onSyncNow,
  onDiscardConflicts,
  notebooks,
}: {
  summary: SyncQueueSummary;
  isOnline: boolean;
  isSyncing: boolean;
  onSyncNow: () => void;
  onDiscardConflicts: () => void;
  notebooks: Notebook[];
}) => {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasQueuedWork = summary.total > 0;
  const label = getSyncStatusLabel(summary, isOnline, isSyncing, t);
  const statusClassName = !isOnline
    ? "border-slate-200 bg-slate-50 text-slate-600"
    : summary.conflict > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : hasQueuedWork
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-slate-200 bg-card text-slate-500";

  return (
    <div
      className={cn("flex h-8 items-center gap-2 rounded-md border px-3 transition-all duration-200", statusClassName)}
      role="status"
      aria-live="polite"
    >
      <m.span
        key={label}
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        aria-hidden="true"
        {...statusSettleMotion}
      >
        {!isOnline ? (
          <CloudOff className="h-4 w-4" />
        ) : summary.conflict > 0 ? (
          <AlertTriangle className="h-4 w-4" />
        ) : hasQueuedWork || isSyncing ? (
          <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
      </m.span>
      <button
        className="min-w-0 flex-1 truncate text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/15"
        type="button"
        onClick={() => setDetailsOpen(true)}
      >
        {label}
      </button>
      {summary.conflict > 0 && (
        <button
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold leading-none text-amber-800 transition-colors hover:bg-card/70 disabled:opacity-50"
          type="button"
          disabled={!isOnline || isSyncing}
          onClick={onDiscardConflicts}
        >
          {t("notebookPane.sync.discardConflicts")}
        </button>
      )}
      {hasQueuedWork && (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-card/70 disabled:opacity-50 transition-colors"
                type="button"
                aria-label={t("notebookPane.syncNow")}
                disabled={!isOnline || isSyncing}
                onClick={onSyncNow}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("notebookPane.syncNow")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {detailsOpen && (
        <Suspense fallback={null}>
          <DesktopSyncIssuesDialog
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            notebooks={notebooks}
            onSyncNow={onSyncNow}
          />
        </Suspense>
      )}
    </div>
  );
};

export const NotebookPane = ({
  repository,
  user,
  view,
  selectedNotebookId,
  onSelect,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onMoveNotebook,
  onMoveMemos,
  onBackToList,
  onOpenTags,
  onOpenAssets,
  onOpenTemplates,
  pluginHost,
  onOpenPluginManager,
  onOpenTrash,
  onEmptyTrash,
  onOpenSettings,
  onCreateMemo,
  canCreateMemo,
  isCreatingMemo,
  syncSummary,
  isOnline,
  isSyncingQueuedChanges,
  onSyncQueuedChanges,
  onDiscardConflicts,
  imageCompressionEnabled,
  onImageCompressionChange,
  authRequired,
  onLogout,
  isLoggingOut,
  demoMode = false,
  onResetDemo,
  isResettingDemo = false,
  collapsed = false,
  onToggleCollapsed,
  collapseShortcutLabel,
}: {
  repository: EdgeEverRepository;
  user: AuthUser | null;
  view: string;
  selectedNotebookId: string | null;
  onSelect: (notebookId: string) => void;
  onCreateNotebook: (parentId?: string | null) => void;
  onRenameNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
  onMoveNotebook: (notebookId: string, targetNotebookId: string, position: NotebookDropPosition) => void;
  onMoveMemos: (memoIds: string[], targetNotebookId: string) => void;
  onBackToList: () => void;
  onOpenTags: () => void;
  onOpenAssets: () => void;
  onOpenTemplates: () => void;
  pluginHost: EdgeEverPluginHost;
  onOpenPluginManager: () => void;
  onOpenTrash: () => void;
  onEmptyTrash: () => void;
  onOpenSettings: () => void;
  onCreateMemo: (kind?: NoteCreateKind) => void;
  canCreateMemo: boolean;
  isCreatingMemo: boolean;
  syncSummary: SyncQueueSummary;
  isOnline: boolean;
  isSyncingQueuedChanges: boolean;
  onSyncQueuedChanges: () => void;
  onDiscardConflicts: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  authRequired: boolean;
  onLogout: () => void;
  isLoggingOut: boolean;
  demoMode?: boolean;
  onResetDemo?: () => void;
  isResettingDemo?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  collapseShortcutLabel?: string;
}) => {
  const { t } = useTranslation();
  const showDescendantNotes = useShowDescendantNotesPreference();
  const { unseen: deployedUpdateUnseen } = useDeployedUpdateNotice();
  // Temporarily keep template actions out of the primary workspace navigation.
  const showTemplateEntry = true;
  const notebookScrollRef = useRef<HTMLDivElement | null>(null);
  const notebookDragScrollFrameRef = useRef<number | null>(null);
  const [expandSiblingsRequest, setExpandSiblingsRequest] = useState<{ parentId: string | null; token: number } | null>(null);
  const [notebookSortMode, setNotebookSortMode] = useState<NotebookSortMode>(readNotebookSortPreference);
  const [collapsedNotebookIds, setCollapsedNotebookIds] = useState<Set<string>>(readNotebookTreeCollapsedIdsPreference);

  const handleMoveNotebook = useCallback((notebookId: string, targetNotebookId: string, position: NotebookDropPosition) => {
    setNotebookSortMode("custom");
    onMoveNotebook(notebookId, targetNotebookId, position);
  }, [onMoveNotebook]);

  const stopNotebookDragAutoScroll = useCallback(() => {
    if (notebookDragScrollFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(notebookDragScrollFrameRef.current);
    notebookDragScrollFrameRef.current = null;
  }, []);

  useEffect(() => () => stopNotebookDragAutoScroll(), [stopNotebookDragAutoScroll]);

  const handleExpandNotebookSiblings = useCallback((parentId: string | null) => {
    setExpandSiblingsRequest((current: { parentId: string | null; token: number } | null) => ({ parentId, token: (current?.token ?? 0) + 1 }));
  }, []);

  const handleNotebookScrollDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasEdgeEverDragData(event.dataTransfer)) {
      stopNotebookDragAutoScroll();
      return;
    }

    const scrollContainer = notebookScrollRef.current;

    if (!scrollContainer) {
      return;
    }

    const rect = scrollContainer.getBoundingClientRect();
    const distanceToTop = event.clientY - rect.top;
    const distanceToBottom = rect.bottom - event.clientY;
    const topPressure = Math.max(0, NOTEBOOK_DRAG_SCROLL_EDGE_PX - distanceToTop);
    const bottomPressure = Math.max(0, NOTEBOOK_DRAG_SCROLL_EDGE_PX - distanceToBottom);
    const direction = bottomPressure > 0 ? 1 : topPressure > 0 ? -1 : 0;

    if (direction === 0) {
      stopNotebookDragAutoScroll();
      return;
    }

    event.preventDefault();

    const pressure = Math.max(topPressure, bottomPressure) / NOTEBOOK_DRAG_SCROLL_EDGE_PX;
    const scrollStep = Math.max(4, Math.ceil(pressure * NOTEBOOK_DRAG_SCROLL_MAX_STEP_PX)) * direction;
    const tick = () => {
      scrollContainer.scrollTop += scrollStep;
      notebookDragScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    if (notebookDragScrollFrameRef.current !== null) {
      return;
    }

    notebookDragScrollFrameRef.current = window.requestAnimationFrame(tick);
  };

  const notebooksQuery = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => repository.listNotebooks(),
  });

  const notebooks = notebooksQuery.data?.notebooks ?? [];
  const notebookSortOptions = useMemo(() => getNotebookSortOptions(t), [t]);
  const tree = useMemo(() => buildNotebookTree(notebooks, getNotebookSortComparator(notebookSortMode)), [notebooks, notebookSortMode]);
  const isLoading = notebooksQuery.isLoading;
  const activeNotebookSortLabel = notebookSortOptions.find((option) => option.value === notebookSortMode)?.label ?? t("options.notebookSort.nameAsc");

  useEffect(() => {
    writeNotebookSortPreference(notebookSortMode);
  }, [notebookSortMode]);

  useEffect(() => {
    writeNotebookTreeCollapsedIdsPreference(collapsedNotebookIds);
  }, [collapsedNotebookIds]);

  const handleNotebookOpenChange = useCallback((notebookId: string, open: boolean) => {
    setCollapsedNotebookIds((current) => {
      if (current.has(notebookId) === !open) {
        return current;
      }

      const next = new Set(current);
      if (open) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selectedNotebookId) {
      return;
    }

    window.setTimeout(() => {
      const selectedNode = notebookScrollRef.current?.querySelector<HTMLElement>(
        `[data-notebook-id="${CSS.escape(selectedNotebookId)}"]`
      );

      selectedNode?.scrollIntoView({ block: "nearest" });
    }, 0);
  }, [selectedNotebookId, tree]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-notebook-sidebar-collapsed={collapsed ? "true" : "false"}>
      <div className={cn("flex min-h-0 flex-1 flex-col", collapsed && "hidden")}>
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 px-4 pb-3 pt-[env(safe-area-inset-top)] lg:hidden">
        <div>
          <div className="text-base font-semibold tracking-normal">{t("notebookPane.notebooks")}</div>
          <div className="text-xs text-slate-500">{user?.username ?? t("notebookPane.workspaceFallback")}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" title={t("notebookPane.backToList")} aria-label={t("notebookPane.backToList")} onClick={onBackToList}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title={t("notebookPane.newNotebook")} aria-label={t("notebookPane.newNotebook")} onClick={() => onCreateNotebook(null)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <nav className="grid shrink-0 grid-cols-2 gap-0.5 border-b border-slate-100 px-2 py-1.5 sm:grid-cols-3 lg:grid-cols-5" aria-label={t("notebookPane.secondaryEntries")}>
          <SidebarShortcutButton icon={<Tag className="h-4 w-4" />} label={t("mobileSheets.tags")} onClick={onOpenTags} />
          <SidebarShortcutButton icon={<Paperclip className="h-4 w-4" />} label={t("mobileSheets.assets")} onClick={onOpenAssets} />
          {showTemplateEntry && <SidebarShortcutButton icon={<LayoutTemplate className="h-4 w-4" />} label={t("nav.templates")} onClick={onOpenTemplates} />}
          <PluginToolbarMenu
            host={pluginHost}
            onManage={onOpenPluginManager}
            align="start"
            className="h-9 w-full rounded-md px-0 text-slate-600 hover:bg-slate-50 hover:text-slate-950"
          />
          <SidebarTrashShortcut active={view === "trash"} onOpenTrash={onOpenTrash} onEmptyTrash={onEmptyTrash} />
        </nav>
      </TooltipProvider>

      {window.edgeeverDesktop?.isAvailable && (
        <div className="px-3 pt-1.5">
          <SyncStatusBar
            summary={syncSummary}
            isOnline={isOnline}
            isSyncing={isSyncingQueuedChanges}
            onSyncNow={onSyncQueuedChanges}
            onDiscardConflicts={onDiscardConflicts}
            notebooks={notebooks}
          />
        </div>
      )}

      <div className="hidden shrink-0 px-3 pb-2 pt-2 lg:block">
        <div className="edgeever-create-memo-split flex overflow-hidden rounded-2xl border border-slate-200/90 bg-card shadow-[0_5px_16px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_7px_20px_rgba(15,23,42,0.09)]">
          <button
            className="group flex h-12 max-w-[calc(100%-2.25rem)] shrink-0 items-center gap-2 px-2.5 text-left transition-colors duration-150 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            aria-label={t("notebookPane.newMemo")}
            onClick={() => onCreateMemo()}
            disabled={!canCreateMemo || isCreatingMemo}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_5px_12px_rgb(var(--brand-green-rgb)/0.22)] transition-transform duration-150 group-hover:scale-[1.03] group-focus-visible:ring-2 group-focus-visible:ring-slate-900/20 group-focus-visible:ring-offset-2">
              <Plus className="h-5 w-5" />
            </span>
            <span className="whitespace-nowrap text-sm font-semibold text-slate-950">{t("notebookPane.newMemo")}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="group relative flex h-12 min-w-9 flex-1 items-center justify-center gap-0.5 px-1.5 text-xs font-medium text-slate-600 transition-colors before:absolute before:inset-y-2.5 before:left-0 before:w-px before:bg-[var(--workspace-divider)] hover:bg-workspace-hover hover:text-slate-950 focus-visible:bg-workspace-hover focus-visible:text-slate-950 focus-visible:outline-none data-[state=open]:bg-workspace-selection data-[state=open]:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                aria-label={t("diagram.createType")}
                disabled={!canCreateMemo || isCreatingMemo}
              >
                <span className="edgeever-create-memo-split__more-label min-w-0 truncate">{t("diagram.moreTypes")}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8} className="w-52">
              <CreateMemoTypeItems onCreateMemo={onCreateMemo} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        ref={notebookScrollRef}
        className="flex-1 overflow-y-auto px-3 py-4 lg:pt-0"
        onDragEnd={stopNotebookDragAutoScroll}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            stopNotebookDragAutoScroll();
          }
        }}
        onDragOver={handleNotebookScrollDragOver}
        onDrop={stopNotebookDragAutoScroll}
      >
        {showTemplateEntry && (
          <button
            className="mb-1 hidden h-8 w-full items-center justify-start gap-2 rounded-md px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 lg:flex"
            type="button"
            onClick={onOpenTemplates}
            disabled={isCreatingMemo}
          >
            <LayoutTemplate className="h-4 w-4" />
            {t("templates.useTemplate")}
          </button>
        )}

        <nav className="mb-1 space-y-1" aria-label={t("notebookPane.entries")}>
          <SidebarNavButton
            active={view === "notebook" && selectedNotebookId === null}
            icon={<LayoutList className="h-4 w-4" />}
            label={t("notebookPane.allMemos")}
            onClick={onBackToList}
          />
          {demoMode && onResetDemo && (
            <SidebarNavButton
              tone="warning"
              icon={<RotateCcw className={cn("h-4 w-4 text-amber-600", isResettingDemo && "animate-spin")} />}
              label={isResettingDemo ? t("demo.resetting") : t("demo.resetButton")}
              onClick={onResetDemo}
            />
          )}
        </nav>

        <div className="group mb-2 flex items-center justify-between gap-2">
          <SidebarSectionLabel icon={<NotebookIcon className="h-4 w-4" />} label={t("notebookPane.notebooks")} />
          <div className="flex items-center gap-1 opacity-100 transition-opacity duration-200 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
              type="button"
              title={t("notebookPane.newNotebook")}
              aria-label={t("notebookPane.newNotebook")}
              onClick={() => onCreateNotebook(null)}
            >
              <BookPlus className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
                        type="button"
                        aria-label={t("notebookPane.sortTitle", { label: activeNotebookSortLabel })}
                      >
                        <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("notebookPane.sortTitle", { label: activeNotebookSortLabel })}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DropdownMenuContent align="end" className="w-36">
                {notebookSortOptions.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={notebookSortMode === option.value}
                    onSelect={() => setNotebookSortMode(option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isLoading ? (
          <div className="mb-4 px-2 py-3 text-sm text-slate-500">{t("notebookPane.loading")}</div>
        ) : (
          <div className="mb-4 space-y-1" data-notebook-tree>
            {tree.map((node) => (
              <NotebookTreeItem
                key={node.id}
                node={node}
                depth={0}
                selectedNotebookId={selectedNotebookId}
                onSelect={onSelect}
                onCreateNotebook={onCreateNotebook}
                onRenameNotebook={onRenameNotebook}
                onDeleteNotebook={onDeleteNotebook}
                onMoveNotebook={handleMoveNotebook}
                onMoveMemos={onMoveMemos}
                onDragScroll={handleNotebookScrollDragOver}
                collapsedNotebookIds={collapsedNotebookIds}
                onOpenChange={handleNotebookOpenChange}
                expandSiblingsRequest={expandSiblingsRequest}
                onExpandSiblings={handleExpandNotebookSiblings}
                showDescendantNotes={showDescendantNotes}
              />
            ))}
          </div>
        )}

      </div>
      </div>

      {collapsed && onToggleCollapsed ? (
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <div className="flex min-h-0 flex-1 flex-col items-center px-1.5 pt-4" data-notebook-sidebar-rail>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_3px_8px_rgb(var(--brand-green-rgb)/0.24)] transition-transform duration-150 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t("notebookPane.newMemo")}
                    onClick={() => onCreateMemo()}
                    disabled={!canCreateMemo || isCreatingMemo}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("notebookPane.newMemo")}</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t("diagram.createType")}
                        disabled={!canCreateMemo || isCreatingMemo}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t("diagram.createType")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-52">
                  <CreateMemoTypeItems onCreateMemo={onCreateMemo} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <nav className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1" aria-label={t("notebookPane.entries")}>
              <SidebarRailButton
                active={view === "notebook" && selectedNotebookId === null}
                icon={<LayoutList className="h-4 w-4" />}
                label={t("notebookPane.allMemos")}
                onClick={onBackToList}
              />
              <SidebarRailButton
                active={view === "notebook" && selectedNotebookId !== null}
                icon={<NotebookIcon className="h-4 w-4" />}
                label={t("notebookPane.notebooks")}
                onClick={onToggleCollapsed}
              />
              <SidebarRailButton icon={<Tag className="h-4 w-4" />} label={t("mobileSheets.tags")} onClick={onOpenTags} />
              <SidebarRailButton icon={<Paperclip className="h-4 w-4" />} label={t("mobileSheets.assets")} onClick={onOpenAssets} />
              {showTemplateEntry ? (
                <SidebarRailButton icon={<LayoutTemplate className="h-4 w-4" />} label={t("nav.templates")} onClick={onOpenTemplates} />
              ) : null}
              <PluginToolbarMenu
                host={pluginHost}
                onManage={onOpenPluginManager}
                align="start"
                side="right"
                tooltipSide="right"
                className="h-9 w-9 text-slate-600"
              />
              <div className="mt-auto flex flex-col items-center gap-1 border-t border-slate-200/80 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
                <SidebarRailButton
                  active={view === "trash"}
                  icon={<Trash2 className="h-4 w-4" />}
                  label={t("notebookPane.trash")}
                  onClick={onOpenTrash}
                />
                <SidebarRailButton
                  icon={<CircleUserRound className="h-4 w-4" />}
                  label={t("notebookPane.profile")}
                  notice={deployedUpdateUnseen}
                  onClick={onOpenSettings}
                />
                <SidebarCollapseButton collapsed onToggle={onToggleCollapsed} className="h-9 w-9" tooltipSide="right" shortcutLabel={collapseShortcutLabel} />
              </div>
            </nav>
          </div>
        </TooltipProvider>
      ) : (
      <footer className="edgeever-workspace-sidebar-footer border-t border-[var(--workspace-divider)] px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenSettings}
              className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-md px-3 text-left text-xs font-medium leading-5 text-slate-700 transition-colors duration-200 hover:bg-workspace-hover hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
              type="button"
              aria-label={t("notebookPane.profile")}
            >
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <CircleUserRound className="h-4 w-4" />
                {deployedUpdateUnseen ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-[var(--workspace-sidebar)]" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{t("notebookPane.profile")}</span>
            </button>
            <DesktopUpdateNotice />
            {onToggleCollapsed ? (
              <SidebarCollapseButton collapsed={collapsed} onToggle={onToggleCollapsed} className="hidden lg:inline-flex" shortcutLabel={collapseShortcutLabel} />
            ) : null}
          </div>
        </div>
      </footer>
      )}
    </div>
  );
};
