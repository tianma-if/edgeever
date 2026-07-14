import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  Plus,
  LayoutList,
  BookPlus,
  ArrowDownWideNarrow,
  Notebook as NotebookIcon,
  Tags,
  Archive,
  Trash2,
  KeyRound,
  LogOut,
  CloudOff,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  CircleUserRound,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotebookTreeItem } from "./NotebookTreeItem";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Notebook, AuthUser } from "@edgeever/shared";
import type { NotebookNode, NotebookDropPosition, NotebookSortMode } from "@/lib/app-helpers";
import type { SyncQueueSummary } from "@/lib/sync-queue";
import {
  buildNotebookTree,
  getNotebookSortOptions,
  getNotebookSortComparator,
  hasEdgeEverDragData,
  readNotebookSortPreference,
  writeNotebookSortPreference,
} from "@/lib/app-helpers";
import { usePwaInstall } from "./PwaInstallContext";

const NOTEBOOK_DRAG_SCROLL_EDGE_PX = 56;
const NOTEBOOK_DRAG_SCROLL_MAX_STEP_PX = 18;

const SidebarNavButton = ({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium leading-none transition-all duration-200",
      active ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
    )}
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

const SidebarShortcutButton = ({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition-colors duration-200",
      active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
    )}
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 truncate">{label}</span>
  </button>
);

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
    <div className="group relative min-w-0">
      <SidebarShortcutButton active={active} icon={<Trash2 className="h-4 w-4" />} label={t("notebookPane.trash")} onClick={onOpenTrash} />
      {!active && (
        <div className="pointer-events-none absolute right-0 top-full z-20 w-max pt-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            className="relative flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-2 text-xs font-medium text-rose-700 shadow-lg shadow-slate-900/10 transition-colors before:absolute before:-top-1 before:right-16 before:h-2 before:w-2 before:rotate-45 before:border-l before:border-t before:border-rose-200 before:bg-white hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70"
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
}: {
  summary: SyncQueueSummary;
  isOnline: boolean;
  isSyncing: boolean;
  onSyncNow: () => void;
}) => {
  const { t } = useTranslation();
  const hasQueuedWork = summary.total > 0;
  const label = getSyncStatusLabel(summary, isOnline, isSyncing, t);
  const statusClassName = !isOnline
    ? "border-slate-200 bg-slate-50 text-slate-600"
    : summary.conflict > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : hasQueuedWork
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-slate-200 bg-white text-slate-500";

  return (
    <div className={cn("mb-3 flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 transition-all duration-200", statusClassName)}>
      {!isOnline ? (
        <CloudOff className="h-4 w-4 shrink-0" />
      ) : summary.conflict > 0 ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : hasQueuedWork || isSyncing ? (
        <RefreshCw className={cn("h-4 w-4 shrink-0", isSyncing && "animate-spin")} />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      {hasQueuedWork && (
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/70 disabled:opacity-50 transition-colors"
          type="button"
          title={t("notebookPane.syncNow")}
          aria-label={t("notebookPane.syncNow")}
          disabled={!isOnline || isSyncing}
          onClick={onSyncNow}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export const NotebookPane = ({
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
  imageCompressionEnabled,
  onImageCompressionChange,
  authRequired,
  onLogout,
  isLoggingOut,
}: {
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
  onOpenTrash: () => void;
  onEmptyTrash: () => void;
  onOpenSettings: () => void;
  onCreateMemo: () => void;
  canCreateMemo: boolean;
  isCreatingMemo: boolean;
  syncSummary: SyncQueueSummary;
  isOnline: boolean;
  isSyncingQueuedChanges: boolean;
  onSyncQueuedChanges: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  authRequired: boolean;
  onLogout: () => void;
  isLoggingOut: boolean;
}) => {
  const { t } = useTranslation();
  const { isInstallable, install } = usePwaInstall();
  const notebookScrollRef = useRef<HTMLDivElement | null>(null);
  const notebookDragScrollFrameRef = useRef<number | null>(null);
  const [expandSiblingsRequest, setExpandSiblingsRequest] = useState<{ parentId: string | null; token: number } | null>(null);
  const [notebookSortMode, setNotebookSortMode] = useState<NotebookSortMode>(readNotebookSortPreference);

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
    queryFn: () => api.listNotebooks(),
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
    <div className="flex h-full min-h-0 flex-col">
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

      <nav className="grid shrink-0 grid-cols-3 gap-1 border-b border-slate-100 px-3 py-2" aria-label={t("notebookPane.secondaryEntries")}>
        <SidebarShortcutButton icon={<Tags className="h-4 w-4" />} label={t("mobileSheets.tags")} onClick={onOpenTags} />
        <SidebarShortcutButton icon={<Archive className="h-4 w-4" />} label={t("mobileSheets.assets")} onClick={onOpenAssets} />
        <SidebarTrashShortcut active={view === "trash"} onOpenTrash={onOpenTrash} onEmptyTrash={onEmptyTrash} />
      </nav>

      <div
        ref={notebookScrollRef}
        className="flex-1 overflow-y-auto px-3 py-4"
        onDragEnd={stopNotebookDragAutoScroll}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            stopNotebookDragAutoScroll();
          }
        }}
        onDragOver={handleNotebookScrollDragOver}
        onDrop={stopNotebookDragAutoScroll}
      >
        <div className="mb-4 hidden overflow-hidden rounded-full border border-slate-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.06)] lg:flex">
          <button
            className="flex h-14 min-w-0 flex-1 items-center gap-3 px-3 text-left transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            title={t("notebookPane.newMemo")}
            onClick={onCreateMemo}
            disabled={!canCreateMemo || isCreatingMemo}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_8px_18px_rgb(var(--brand-green-rgb)/0.28)] transition-transform duration-200 group-hover:scale-105">
              <Plus className="h-6 w-6" />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold text-slate-950">{t("notebookPane.newMemo")}</span>
          </button>
        </div>

        <nav className="mb-3 space-y-1" aria-label={t("notebookPane.entries")}>
          <SidebarNavButton
            active={view === "notebook" && selectedNotebookId === null}
            icon={<LayoutList className="h-4 w-4" />}
            label={t("notebookPane.allMemos")}
            onClick={onBackToList}
          />
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
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
                  type="button"
                  title={t("notebookPane.sortTitle", { label: activeNotebookSortLabel })}
                  aria-label={t("notebookPane.sortTitle", { label: activeNotebookSortLabel })}
                >
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
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
                onMoveNotebook={onMoveNotebook}
                onMoveMemos={onMoveMemos}
                onDragScroll={handleNotebookScrollDragOver}
                expandSiblingsRequest={expandSiblingsRequest}
                onExpandSiblings={handleExpandNotebookSiblings}
              />
            ))}
          </div>
        )}

      </div>

      <footer className="border-t border-slate-200 bg-white/80 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm">
        <div className="space-y-1">
          {isInstallable && (
            <button
              onClick={install}
              className="flex h-8 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold leading-none text-emerald-700 hover:bg-emerald-50 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              type="button"
              title={t("pwa.sidebarInstallTitle") || "安装桌面客户端"}
              aria-label={t("pwa.sidebarInstallTitle") || "安装桌面客户端"}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <Download className="h-4 w-4 text-emerald-600" />
              </span>
              <span className="min-w-0 flex-1 truncate">{t("pwa.sidebarInstall") || "安装桌面客户端"}</span>
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="flex h-8 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium leading-none text-slate-700 transition-colors duration-200 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
            type="button"
            title={t("notebookPane.profile")}
            aria-label={t("notebookPane.profile")}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <CircleUserRound className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">{t("notebookPane.profile")}</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
