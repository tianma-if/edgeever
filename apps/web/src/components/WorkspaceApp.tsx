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
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { PluginPanelOpenOptions } from "@edgeever/plugin-api";
import { Home, Search, UserRound, Plus, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { MemoListPane, MemoSelectionActionBar } from "./MemoListPane";
import { QuickMemoSwitcher } from "./QuickMemoSwitcher";
import { AppConfirmDialog, MemoDeleteConfirmDialog, NotebookNameDialog } from "./dialogs/ConfirmDialogs";
import { PluginPanelDialog } from "./plugins/PluginPanelDialog";
import { api, getOrCreateClientDeviceId } from "@/lib/api";
import { createPluginScheduleAdapter } from "@/lib/plugins/plugin-schedule-adapter";
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
import { createExcerpt, docToText, getNotebookDescendantIds, resolveMemoContentDoc, type Notebook, type AuthUser, type MemoSummary, type MemoDetail, type MemoTemplate as SavedMemoTemplate } from "@edgeever/shared";
import { toggleMobileMemoSelection } from "@edgeever/shared/mobile-ui";
import type {
  Pane,
  MemoView,
  MemoDeleteConfirmation,
  NotebookNameDialogState,
  AppNoticeDialogState,
  MobileBottomNavItem,
  NotebookNode,
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
  isTextEntryTarget,
  getSearchShortcutScope,
  getShortcutActionForEvent,
  getNotebookDropSortOrder,
  buildNotebookTree,
  notebookTreeContainsId,
  getNotebookAncestorIds,
  getExpandableNotebookIds,
  filterNotebookTree,
  getNotebookMoveOptions,
} from "@/lib/app-helpers";
import { useBrowserBackLayer } from "@/lib/app-hooks";
import { updateMemoSummaryInLists, type MemoListQueryData } from "@/lib/memo-list-cache";
import { shouldAcceptRemoteMemoDetail } from "@/lib/memo-detail-freshness";
import {
  clearLocalScope,
  createLocalDataScope,
  putLocalMemo,
  putLocalNotebook,
} from "@/lib/local-mirror";
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
import { useWorkspacePreferences } from "@/hooks/useWorkspacePreferences";
import { useWorkspaceSelection } from "@/hooks/useWorkspaceSelection";
import { useWorkspaceQueuedSync } from "@/hooks/useWorkspaceQueuedSync";
import { EdgeEverPluginHost, type RegisteredPluginPanel } from "@/lib/plugins/plugin-host";
import { createPublicNetworkAdapter } from "@/lib/plugins/public-network-adapter";
import { clearRendererRecoveryRequired, isRendererRecoveryRequired } from "@/lib/renderer-recovery";
import { EditorPaneErrorBoundary, EditorRecoveryPane } from "./EditorPaneErrorBoundary";

const isDesktopViewport = () => window.matchMedia("(min-width: 1024px)").matches;
const PULL_TO_REFRESH_TRIGGER_PX = 72;
const PULL_TO_REFRESH_MAX_PX = 96;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

const runWorkspaceViewTransition = (update: () => void) => {
  const viewTransitionDocument = document as ViewTransitionDocument;

  if (
    !viewTransitionDocument.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }

  viewTransitionDocument.startViewTransition(update);
};

const isStandaloneApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

const getVerticalScrollContainer = (target: EventTarget | null) => {
  let element = target instanceof HTMLElement ? target : null;

  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    const canScroll = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;

    if (canScroll) {
      return element;
    }

    element = element.parentElement;
  }

  return null;
};

const EditorPane = lazy(() => import("./EditorPane").then((module) => ({ default: module.EditorPane })));
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
const CompanionPane = lazy(() => import("./CompanionPane"));
const CompanionDiscoveryHub = lazy(() => import("./CompanionDiscoveryHub"));
const ExecutionCenterPane = lazy(() =>
  import("./execution/ExecutionCenterPane").then((module) => ({ default: module.ExecutionCenterPane }))
);

const PaneLoadingFallback = ({ label = "Loading" }: { label?: string }) => (
  <div className="flex h-full min-h-0 items-center justify-center bg-white text-sm font-medium text-slate-400" role="status">
    {label}
  </div>
);

const memoDetailQueryKey = (memoId: string, view: MemoView) => ["memo", memoId, view] as const;

type ListNotebooksQueryData = {
  notebooks: Notebook[];
};

type MemoDeleteOptimisticContext = {
  previousMemoLists: Array<[readonly unknown[], MemoListQueryData | undefined]>;
  previousMemoDetails: Array<[readonly unknown[], { memo: MemoDetail } | undefined]>;
  previousNotebooks: ListNotebooksQueryData | undefined;
  previousActivePane: Pane;
  previousSelectedMemoId: string | null;
};

type EmptyTrashOptimisticContext = {
  previousMemoLists: Array<[readonly unknown[], MemoListQueryData | undefined]>;
  previousMemoDetails: Array<[readonly unknown[], { memo: MemoDetail } | undefined]>;
  previousActivePane: Pane;
  previousSelectedMemoId: string | null;
};

const memoToSummary = (memo: MemoDetail): MemoSummary => ({
  id: memo.id,
  notebookId: memo.notebookId,
  title: memo.title,
  excerpt: memo.excerpt || createExcerpt(memo.contentText || docToText(resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown))),
  tags: memo.tags,
  isPinned: memo.isPinned,
  isArchived: memo.isArchived,
  isDeleted: memo.isDeleted,
  revision: memo.revision,
  createdAt: memo.createdAt,
  updatedAt: memo.updatedAt,
  deletedAt: memo.deletedAt,
});

const cacheMemoDetail = (queryClient: QueryClient, memo: MemoDetail, view: MemoView = memo.isDeleted ? "trash" : "notebook") => {
  queryClient.setQueryData(memoDetailQueryKey(memo.id, view), { memo });
};

const collectMemoSummariesFromCache = (queryClient: QueryClient, memoIds: Set<string>) => {
  const summaries = new Map<string, MemoSummary>();

  for (const [, current] of queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] })) {
    for (const page of current?.pages ?? []) {
      for (const memo of page.memos) {
        if (memoIds.has(memo.id) && !summaries.has(memo.id)) {
          summaries.set(memo.id, memo);
        }
      }
    }
  }

  for (const [, current] of queryClient.getQueriesData<{ memo: MemoDetail }>({ queryKey: ["memo"] })) {
    if (current?.memo && memoIds.has(current.memo.id) && !summaries.has(current.memo.id)) {
      summaries.set(current.memo.id, memoToSummary(current.memo));
    }
  }

  return Array.from(summaries.values());
};

const removeMemoSummariesFromLists = (queryClient: QueryClient, memoIds: Set<string>) => {
  queryClient.setQueriesData<MemoListQueryData>({ queryKey: ["memos"] }, (current) => {
    if (!current) {
      return current;
    }

    let changed = false;
    const pages = current.pages.map((page) => {
      const memos = page.memos.filter((memo) => !memoIds.has(memo.id));

      if (memos.length === page.memos.length) {
        return page;
      }

      changed = true;
      return {
        ...page,
        memos,
        totalCount: Math.max(0, page.totalCount - (page.memos.length - memos.length)),
      };
    });

    return changed ? { ...current, pages } : current;
  });
};

const clearTrashMemoLists = (queryClient: QueryClient) => {
  for (const [queryKey, current] of queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos", "trash"] })) {
    if (!current) {
      continue;
    }

    queryClient.setQueryData(queryKey, {
      ...current,
      pages: current.pages.map((page) => ({ ...page, memos: [], totalCount: 0, nextCursor: null })),
    });
  }
};

const decrementNotebookMemoCounts = (queryClient: QueryClient, removedMemos: MemoSummary[]) => {
  if (removedMemos.length === 0) {
    return;
  }

  const countsByNotebook = new Map<string, number>();

  for (const memo of removedMemos) {
    if (memo.isDeleted) {
      continue;
    }

    countsByNotebook.set(memo.notebookId, (countsByNotebook.get(memo.notebookId) ?? 0) + 1);
  }

  if (countsByNotebook.size === 0) {
    return;
  }

  queryClient.setQueryData<ListNotebooksQueryData>(["notebooks"], (current) =>
    current
      ? {
          notebooks: current.notebooks.map((notebook) => {
            const removedCount = countsByNotebook.get(notebook.id) ?? 0;
            return removedCount > 0 ? { ...notebook, memoCount: Math.max(0, notebook.memoCount - removedCount) } : notebook;
          }),
        }
      : current
  );
};

const getAdjacentMemoIdAfterRemoval = (memos: MemoSummary[], removedMemoIds: Set<string>, anchorMemoId: string) => {
  const anchorIndex = memos.findIndex((memo) => memo.id === anchorMemoId);

  if (anchorIndex < 0) {
    return null;
  }

  for (let index = anchorIndex + 1; index < memos.length; index++) {
    const memoId = memos[index]?.id;
    if (memoId && !removedMemoIds.has(memoId)) {
      return memoId;
    }
  }

  for (let index = anchorIndex - 1; index >= 0; index--) {
    const memoId = memos[index]?.id;
    if (memoId && !removedMemoIds.has(memoId)) {
      return memoId;
    }
  }

  return null;
};

const MobileBottomNavButton = ({
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
      "flex h-mobile-touch flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium transition-all duration-200",
      active ? "text-slate-950" : "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
    )}
    type="button"
    aria-current={active ? "page" : undefined}
    aria-label={label}
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const MobileBottomNav = ({
  activeItem,
  canCreateMemo,
  isCreating,
  onCreateMemo,
  onHome,
  onOpenSettings,
}: {
  activeItem: MobileBottomNavItem;
  canCreateMemo: boolean;
  isCreating: boolean;
  onCreateMemo: () => void;
  onHome: () => void;
  onOpenSettings: () => void;
}) => {
  const { t } = useTranslation();
  const createMemoLabel = !canCreateMemo ? t("nav.createDisabled") : isCreating ? t("nav.creating") : t("nav.createMemo");

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-5 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-0 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
      aria-label={t("nav.mobileMain")}
    >
      <div className="relative grid h-mobile-bottom-nav grid-cols-3 items-center">
        <MobileBottomNavButton active={activeItem === "home"} icon={<Home className="h-5 w-5" />} label={t("nav.home")} onClick={onHome} />
        <button
          className="flex h-mobile-touch flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          aria-label={createMemoLabel}
          disabled={!canCreateMemo || isCreating}
          onClick={onCreateMemo}
        >
          <Plus className="h-5 w-5" />
          <span>{t("nav.createMemo")}</span>
        </button>
        <MobileBottomNavButton active={activeItem === "settings"} icon={<UserRound className="h-5 w-5" />} label={t("nav.mine")} onClick={onOpenSettings} />
      </div>
    </nav>
  );
};

const MobileNotebookPicker = ({
  currentLabel,
  notebooks,
  selectedNotebookId,
  onClose,
  onSelectAll,
  onSelect,
}: {
  currentLabel?: string;
  notebooks: Notebook[];
  selectedNotebookId: string | null;
  onClose: () => void;
  onSelectAll: () => void;
  onSelect: (notebookId: string) => void;
}) => {
  const { t, i18n } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [notebookSearch, setNotebookSearch] = useState("");
  const tree = useMemo(() => buildNotebookTree(notebooks), [notebooks]);
  const filteredTree = useMemo(() => filterNotebookTree(tree, notebookSearch), [notebookSearch, tree]);
  const selectedAncestorIds = useMemo(
    () => (selectedNotebookId ? getNotebookAncestorIds(tree, selectedNotebookId) : []),
    [selectedNotebookId, tree]
  );
  const expandableNotebookIds = useMemo(() => getExpandableNotebookIds(tree), [tree]);
  const [expandedNotebookIds, setExpandedNotebookIds] = useState<Set<string>>(() => new Set(selectedAncestorIds));
  const allSelected = !currentLabel && selectedNotebookId === null;
  const selectedNotebookName =
    currentLabel ?? (allSelected ? t("mobileNotebookPicker.allMemos") : notebooks.find((item) => item.id === selectedNotebookId)?.name ?? t("mobileNotebookPicker.notebookFallback"));
  const searchQuery = notebookSearch.trim();
  const searchActive = Boolean(searchQuery);
  const allNotebookBranchesExpanded =
    expandableNotebookIds.length > 0 && expandableNotebookIds.every((notebookId) => expandedNotebookIds.has(notebookId));

  useEffect(() => {
    if (selectedAncestorIds.length === 0) {
      return;
    }
    setExpandedNotebookIds((current) => {
      const next = new Set(current);
      for (const notebookId of selectedAncestorIds) {
        next.add(notebookId);
      }
      return next;
    });
  }, [selectedAncestorIds]);

  useEffect(() => {
    if (searchActive) {
      return;
    }
    window.setTimeout(() => {
      const listNode = listRef.current;
      const targetNotebookId = selectedNotebookId ?? "__all__";
      const selectedNode = listNode?.querySelector<HTMLElement>(`[data-mobile-notebook-id="${CSS.escape(targetNotebookId)}"]`);
      selectedNode?.scrollIntoView({ block: "center" });
    }, 0);
  }, [searchActive, selectedNotebookId]);

  const handleToggleNotebookExpanded = (notebookId: string) => {
    setExpandedNotebookIds((current) => {
      const next = new Set(current);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      return next;
    });
  };

  const handleToggleAllNotebookBranches = () => {
    setExpandedNotebookIds(allNotebookBranchesExpanded ? new Set() : new Set(expandableNotebookIds));
  };

  return (
    <Drawer open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent className="inset-x-0 max-h-[82dvh] overflow-hidden border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <DrawerHeader className="min-w-0 p-0">
            <DrawerTitle className="text-base">{t("mobileNotebookPicker.title")}</DrawerTitle>
            <DrawerDescription className="truncate">{t("mobileNotebookPicker.current", { name: selectedNotebookName })}</DrawerDescription>
          </DrawerHeader>
          <Button size="icon" variant="ghost" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="border-b border-slate-100 px-4 py-2">
          <div className="flex h-9 items-center gap-2 rounded-md bg-slate-100 px-3 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <input
              className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
              value={notebookSearch}
              placeholder={t("mobileNotebookPicker.searchPlaceholder")}
              aria-label={t("mobileNotebookPicker.searchPlaceholder")}
              onChange={(event) => setNotebookSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && notebookSearch) {
                  event.preventDefault();
                  setNotebookSearch("");
                }
              }}
            />
            {notebookSearch && (
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-700"
                type="button"
                title={t("mobileNotebookPicker.clearSearch")}
                aria-label={t("mobileNotebookPicker.clearSearch")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setNotebookSearch("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div ref={listRef} className="max-h-[calc(82dvh_-_8.25rem_-_env(safe-area-inset-bottom))] overflow-y-auto p-2">
          <button
            className={cn(
              "mb-1 flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition",
              allSelected ? "bg-slate-100 font-semibold text-slate-950" : "text-slate-800 hover:bg-slate-50"
            )}
            type="button"
            data-mobile-notebook-id="__all__"
            aria-label={allSelected ? t("mobileNotebookPicker.currentAll") : t("mobileNotebookPicker.switchAll")}
            aria-current={allSelected ? "page" : undefined}
            onClick={onSelectAll}
          >
            <span className="min-w-0 flex-1 truncate text-base">{t("mobileNotebookPicker.allMemos")}</span>
          </button>
          {filteredTree.length > 0 ? (
            <>
              <div className="mb-1 flex h-8 items-center justify-between px-3 text-xs font-semibold text-slate-400">
                <span>{searchActive ? t("mobileNotebookPicker.matchedNotebooks") : t("mobileNotebookPicker.notebooks")}</span>
                {!searchActive && expandableNotebookIds.length > 0 && (
                  <button
                    className="rounded-md px-2 py-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    aria-label={allNotebookBranchesExpanded ? t("mobileNotebookPicker.collapseAllAria") : t("mobileNotebookPicker.expandAllAria")}
                    aria-pressed={allNotebookBranchesExpanded}
                    onClick={handleToggleAllNotebookBranches}
                  >
                    {allNotebookBranchesExpanded ? t("mobileNotebookPicker.collapseAll") : t("mobileNotebookPicker.expandAll")}
                  </button>
                )}
              </div>
              {filteredTree.map((node) => (
                <MobileNotebookPickerItem
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedNotebookIds={expandedNotebookIds}
                  searchActive={searchActive}
                  selectedNotebookId={selectedNotebookId}
                  onSelect={onSelect}
                  onToggleExpanded={handleToggleNotebookExpanded}
                />
              ))}
            </>
          ) : (
            <div className="px-3 py-8 text-center">
              <div className="text-sm font-medium text-slate-700">
                {searchQuery ? t("mobileNotebookPicker.noSearchResult", { query: searchQuery }) : t("mobileNotebookPicker.noNotebook")}
              </div>
              {searchQuery && (
                <button
                  className="mt-3 text-sm font-semibold text-slate-600"
                  type="button"
                  onClick={() => setNotebookSearch("")}
                >
                  {t("mobileNotebookPicker.showAll")}
                </button>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};

const MobileNotebookPickerItem = ({
  node,
  depth,
  expandedNotebookIds,
  searchActive,
  selectedNotebookId,
  onSelect,
  onToggleExpanded,
}: {
  node: NotebookNode;
  depth: number;
  expandedNotebookIds: Set<string>;
  searchActive: boolean;
  selectedNotebookId: string | null;
  onSelect: (notebookId: string) => void;
  onToggleExpanded: (notebookId: string) => void;
}) => {
  const { t } = useTranslation();
  const selected = node.id === selectedNotebookId;
  const hasChildren = node.children.length > 0;
  const hasSelectedDescendant = selectedNotebookId ? notebookTreeContainsId(node.children, selectedNotebookId) : false;
  const expanded = searchActive || expandedNotebookIds.has(node.id);

  return (
    <div>
      <div
        data-mobile-notebook-id={node.id}
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition",
          selected
            ? "bg-slate-100 font-semibold text-slate-950"
            : hasSelectedDescendant
              ? "bg-slate-50 text-slate-900 hover:bg-slate-100"
              : "text-slate-800 hover:bg-slate-50"
        )}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        {hasChildren ? (
          <button
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition",
              searchActive ? "cursor-default" : "hover:bg-slate-100 hover:text-slate-700"
            )}
            type="button"
            disabled={searchActive}
            aria-label={expanded ? t("mobileNotebookPicker.collapse", { name: node.name }) : t("mobileNotebookPicker.expand", { name: node.name })}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(node.id);
            }}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        )}
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          type="button"
          aria-label={selected ? t("mobileNotebookPicker.currentNotebook", { name: node.name }) : t("mobileNotebookPicker.switchToNotebook", { name: node.name })}
          aria-current={selected ? "page" : undefined}
          onClick={() => onSelect(node.id)}
        >
          <span className="min-w-0 flex-1 truncate text-base">{node.name}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <div className="mt-1 border-l border-slate-100 pl-1">
          {node.children.map((child) => (
            <MobileNotebookPickerItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedNotebookIds={expandedNotebookIds}
              searchActive={searchActive}
              selectedNotebookId={selectedNotebookId}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

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
    navigateCompanion: navigateWorkspaceCompanion,
    navigateExecutionCenter: navigateWorkspaceExecutionCenter,
  } = useWorkspaceRoute();
  const localDataScope = useMemo(
    () => createLocalDataScope(window.location.origin, user?.id),
    [user?.id]
  );
  const repository = useMemo(() => createRepository(localDataScope), [localDataScope]);
  const isInitialSettingsRoute = route.isSettings;
  const isInitialPluginsRoute = route.isPlugins;
  const isInitialTemplatesRoute = route.isTemplates;
  const isInitialAiPromptsRoute = route.isAiPrompts;
  const isInitialCompanionRoute = route.isCompanion;
  const previousRouteWasCompanion = useRef(route.isCompanion);
  const isInitialExecutionCenterRoute = route.isExecutionCenter;
  const isInitialMobileEditorReturn = Boolean(route.mobileEditorReturnMemoId);
  const isTrashRoute = route.isTrash;
  const [rendererRecoveryMode, setRendererRecoveryMode] = useState(() =>
    Boolean(window.edgeeverDesktop?.recoveredAfterAbnormalExit) || isRendererRecoveryRequired()
  );
  const [activePane, setActivePane] = useState<Pane>(() => ((isInitialSettingsRoute || isInitialPluginsRoute || isInitialTemplatesRoute || isInitialAiPromptsRoute || isInitialCompanionRoute || isInitialExecutionCenterRoute) && !isInitialMobileEditorReturn ? "editor" : "memos"));
  const [memoView, setMemoView] = useState<MemoView>(() => (isTrashRoute ? "trash" : "notebook"));
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
  } = useWorkspaceSelection();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const autoSelectedDemoNotebookRef = useRef(false);
  const [createdMemoEditId, setCreatedMemoEditId] = useState<string | null>(null);
  const pendingCreatedMemoIdRef = useRef<string | null>(null);
  const pendingQuickSwitcherMemoIdRef = useRef<string | null>(null);
  const creatingMemoSelectionRef = useRef(false);
  const memoDocumentActionIdRef = useRef(0);
  const [memoDocumentActionRequest, setMemoDocumentActionRequest] = useState<MemoDocumentActionRequest | null>(null);
  const [memoDeleteConfirmation, setMemoDeleteConfirmation] = useState<MemoDeleteConfirmation | null>(null);
  const [emptyTrashConfirmationOpen, setEmptyTrashConfirmationOpen] = useState(false);
  const [notebookNameDialog, setNotebookNameDialog] = useState<NotebookNameDialogState | null>(null);
  const [notebookDeleteConfirmation, setNotebookDeleteConfirmation] = useState<Notebook | null>(null);
  const [appNoticeDialog, setAppNoticeDialog] = useState<AppNoticeDialogState | null>(null);
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
  const pluginHost = useMemo(() => new EdgeEverPluginHost({
    repository,
    scope: localDataScope,
    aiAdapter: api.pluginAi,
    publicNetworkAdapter: pluginPublicNetworkAdapter,
    onNotice: (message) => setAppNoticeDialog({ title: t("plugins.noticeTitle"), description: message }),
    scheduleAdapter: pluginScheduleAdapter,
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
  }), [localDataScope, pluginPublicNetworkAdapter, pluginScheduleAdapter, queryClient, repository, t]);
  const [pluginHostReady, setPluginHostReady] = useState(false);
  const pluginHostSnapshot = useSyncExternalStore(pluginHost.subscribe, pluginHost.getSnapshot, pluginHost.getSnapshot);
  useEffect(() => {
    let active = true;
    setPluginHostReady(false);
    void pluginHost.activateEnabled().then(() => {
      if (active) setPluginHostReady(true);
    }).catch(() => {
      if (active) setPluginHostReady(false);
    });
    return () => {
      active = false;
      void pluginHost.dispose();
    };
  }, [pluginHost]);
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
    editorContentAlignment,
    imageCompressionEnabled,
    memoListWidth,
    resetMemoListWidth,
    setDesktopFocusMode,
    setEditorContentAlignment,
    setImageCompressionEnabled,
    setMemoListWidth,
    setShortcutSettings,
    shortcutSettings,
  } = useWorkspacePreferences();
  const [rightView, setRightView] = useState<"editor" | "settings" | "plugins" | "assets" | "tags" | "templates" | "ai-prompts" | "companion" | "execution-center" | "evernote-migration">(() =>
    isInitialSettingsRoute
      ? "settings"
      : isInitialPluginsRoute
        ? "plugins"
      : isInitialTemplatesRoute
        ? "templates"
        : isInitialAiPromptsRoute
          ? "ai-prompts"
          : isInitialCompanionRoute
            ? "companion"
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
        : isInitialCompanionRoute && !isInitialMobileEditorReturn
          ? "companion"
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
      (!route.isCompanion && rightView !== "companion" && (
        rightView !== "editor" || visibleActivePane === "editor" || visibleActivePane === "notebooks"
      ))
  );
  const mobilePullToRefreshActive = Boolean(
    !isDesktop &&
      visibleActivePane === "memos" &&
      !appNoticeDialog &&
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
    const returningFromCompanion = previousRouteWasCompanion.current;
    previousRouteWasCompanion.current = route.isCompanion;
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

    if (route.isCompanion) {
      skipNextHomeRouteSyncRef.current = false;
      setRightView("companion");
      setMobileBottomNavActive("companion");
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
    if (returningFromCompanion) setActivePane("memos");
  }, [isTrashRoute, route.isSettings, route.isPlugins, route.isTemplates, route.isAiPrompts, route.isCompanion, route.isExecutionCenter]);

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

  const selectedNotebookDescendantIds = useMemo(
    () => (selectedNotebookId && !selectedTag ? getNotebookDescendantIds(notebooks, selectedNotebookId) : []),
    [notebooks, selectedNotebookId, selectedTag]
  );
  const memosQuery = useInfiniteQuery({
    queryKey: ["memos", memoView, selectedNotebookId, search, memoFilterMode, memoSortMode, selectedNotebookDescendantIds, selectedTag],
    queryFn: ({ pageParam }) => repository.listMemos({
        notebookId: memoView === "notebook" && !selectedTag ? selectedNotebookId : null,
        notebookIds: memoView === "notebook" && !selectedTag ? selectedNotebookDescendantIds : undefined,
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
  });

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
      const targetNotebookId = data.memo.notebookId;

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
      cacheMemoDetail(queryClient, data.memo, "notebook");
      updateMemoSummaryInLists(queryClient, memoToSummary(data.memo));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType: "inactive" }),
      ]);
      navigateWorkspaceHome();
      setRightView("editor");
      pendingCreatedMemoIdRef.current = data.memo.id;
      setCreatedMemoEditId(data.memo.id);
      setSelectedMemoId(data.memo.id);
      setActivePane("editor");

      if (!isDesktopViewport()) {
        openStandaloneMobileEditor(data.memo.id);
      }
    },
    onError: () => {
      clearPendingCreatedMemo();
      setCreatedMemoEditId(null);
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

  const deleteMemosMutation = useMutation({
    mutationFn: repository.deleteMemos,
    onMutate: async (variables): Promise<MemoDeleteOptimisticContext> => {
      const deletedMemoIds = new Set(variables.memoIds);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["memos"] }),
        queryClient.cancelQueries({ queryKey: ["memo"] }),
        queryClient.cancelQueries({ queryKey: ["notebooks"] }),
      ]);

      const previousMemoLists = queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] });
      const previousMemoDetails = queryClient.getQueriesData<{ memo: MemoDetail }>({ queryKey: ["memo"] });
      const previousNotebooks = queryClient.getQueryData<ListNotebooksQueryData>(["notebooks"]);
      const removedMemos = collectMemoSummariesFromCache(queryClient, deletedMemoIds);

      clearMemoSelection();

      if (selectedMemoId && deletedMemoIds.has(selectedMemoId)) {
        setSelectedMemoId(getAdjacentMemoIdAfterRemoval(memos, deletedMemoIds, selectedMemoId));
        setActivePane("memos");
      }

      removeMemoSummariesFromLists(queryClient, deletedMemoIds);
      decrementNotebookMemoCounts(queryClient, removedMemos);

      return { previousMemoLists, previousMemoDetails, previousNotebooks, previousActivePane: activePane, previousSelectedMemoId: selectedMemoId };
    },
    onError: (_error, _variables, context) => {
      context?.previousMemoLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousMemoDetails.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      queryClient.setQueryData(["notebooks"], context?.previousNotebooks);
      setSelectedMemoId(context?.previousSelectedMemoId ?? null);
      setActivePane(context?.previousActivePane ?? "memos");
    },
    onSettled: (_data, _error, variables) => {
      const refetchType = _error ? "active" : "inactive";
      const deletedMemoIds = new Set(variables?.memoIds ?? []);

      if (!_error) {
        for (const memoId of deletedMemoIds) {
          queryClient.removeQueries({ queryKey: ["memo", memoId] });
        }
      }

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["memo"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: _error ? "active" : "all" }),
      ]);
    },
  });

  const deleteMemoMutation = useMutation({
    mutationFn: async ({ memoId, permanent }: { memoId: string; permanent?: boolean }) => {
      return repository.deleteMemo(memoId, Boolean(permanent));
    },
    onMutate: async (variables): Promise<MemoDeleteOptimisticContext> => {
      const deletedMemoIds = new Set([variables.memoId]);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["memos"] }),
        queryClient.cancelQueries({ queryKey: ["memo", variables.memoId] }),
        queryClient.cancelQueries({ queryKey: ["notebooks"] }),
      ]);

      const previousMemoLists = queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] });
      const previousMemoDetails = queryClient.getQueriesData<{ memo: MemoDetail }>({ queryKey: ["memo", variables.memoId] });
      const previousNotebooks = queryClient.getQueryData<ListNotebooksQueryData>(["notebooks"]);
      const removedMemos = collectMemoSummariesFromCache(queryClient, deletedMemoIds);

      if (selectedMemoId === variables.memoId) {
        setSelectedMemoId(getAdjacentMemoIdAfterRemoval(memos, deletedMemoIds, variables.memoId));
        setActivePane("memos");
      }

      removeMemoSummariesFromLists(queryClient, deletedMemoIds);
      decrementNotebookMemoCounts(queryClient, removedMemos);

      return { previousMemoLists, previousMemoDetails, previousNotebooks, previousActivePane: activePane, previousSelectedMemoId: selectedMemoId };
    },
    onError: (_error, _variables, context) => {
      context?.previousMemoLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousMemoDetails.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      queryClient.setQueryData(["notebooks"], context?.previousNotebooks);
      setSelectedMemoId(context?.previousSelectedMemoId ?? null);
      setActivePane(context?.previousActivePane ?? "memos");
    },
    onSettled: (_data, _error, variables) => {
      const refetchType = _error ? "active" : "inactive";

      if (!_error) {
        queryClient.removeQueries({ queryKey: ["memo", variables?.memoId] });
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: _error ? "active" : "all" }),
      ]);
    },
  });

  const emptyTrashMutation = useMutation({
    mutationFn: repository.emptyTrash,
    onMutate: async (): Promise<EmptyTrashOptimisticContext> => {
      const previousActivePane = activePane;
      const previousSelectedMemoId = selectedMemoId;

      // Leave the editor before cancelling/refetching its detail query. On a
      // desktop layout the editor remains mounted even when the memo pane is
      // visible, so keeping a trashed memo selected while its query is being
      // invalidated can render a deleted detail and repeatedly re-select it.
      setEmptyTrashConfirmationOpen(false);
      clearMemoSelection();
      setSelectedMemoId(null);
      setActivePane("memos");

      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["memos"] }),
        queryClient.cancelQueries({ queryKey: ["memo"] }),
        queryClient.cancelQueries({ queryKey: ["resources"] }),
      ]);

      const previousMemoLists = queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] });
      const previousMemoDetails = queryClient.getQueriesData<{ memo: MemoDetail }>({ queryKey: ["memo"] });

      // Keep the optimistic update limited to list data. Removing the active
      // memo detail query here can make the editor render with a missing memo
      // during the same React update and blank the whole workspace.
      clearTrashMemoLists(queryClient);

      return { previousMemoLists, previousMemoDetails, previousActivePane, previousSelectedMemoId };
    },
    onError: (_error, _variables, context) => {
      context?.previousMemoLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousMemoDetails.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      setSelectedMemoId(context?.previousSelectedMemoId ?? null);
      setActivePane(context?.previousActivePane ?? "memos");
      setAppNoticeDialog({
        title: t("workspaceDialogs.emptyTrashFailedTitle"),
        description: t("workspaceDialogs.emptyTrashFailedDescription"),
      });
    },
    onSuccess: () => {
      // The trash detail queries are no longer valid after a successful
      // permanent delete. Remove them before invalidating the remaining
      // active queries so an editor cannot briefly observe a 404 detail.
      queryClient.removeQueries({
        queryKey: ["memo"],
        predicate: (query) => {
          const data = query.state.data as { memo?: { isDeleted?: boolean } } | undefined;
          return data?.memo?.isDeleted === true;
        },
      });
      setSelectedMemoId(null);
      setActivePane("memos");
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["memo"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: "active" }),
      ]);
    },
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
  const desktopFocusModeActive = Boolean(
    isDesktop && desktopFocusMode && rightView === "editor" && selectedMemo && !memoSelectionModeActive
  );
  const selectionMoveNotebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const selectedMemosInCurrentList = useMemo(
    () => memos.filter((memo) => selectedMemoIds.has(memo.id)),
    [memos, selectedMemoIds]
  );

  useEffect(() => {
    if (selectedNotebook?.id) {
      setSelectionMoveTargetNotebookId(selectedNotebook.id);
      return;
    }

    if (!selectionMoveTargetNotebookId && selectionMoveNotebookOptions[0]?.id) {
      setSelectionMoveTargetNotebookId(selectionMoveNotebookOptions[0].id);
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

  const handleCreateMemo = () => {
    const targetNotebookId = createMemoNotebookId;

    if (!targetNotebookId || memoView === "trash") {
      return;
    }

    setTemplatesOpen(false);
    setMobileBottomNavActive("home");
    creatingMemoSelectionRef.current = true;
    createMemoMutation.mutate({
      notebookId: targetNotebookId,
      title: "",
      contentMarkdown: "",
      tags: [],
    });
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

  const getMemoIdsNeedingMove = (memoIds: string[], targetNotebookId: string) => {
    const memoNotebookMap = new Map(memos.map((memo) => [memo.id, memo.notebookId]));
    return Array.from(new Set(memoIds.filter(Boolean))).filter((memoId) => memoNotebookMap.get(memoId) !== targetNotebookId);
  };

  const handleMoveSelectedMemos = (targetNotebookId: string) => {
    if (selectedMemoIds.size === 0 || memoView === "trash") {
      return;
    }

    const memoIds = getMemoIdsNeedingMove(Array.from(selectedMemoIds), targetNotebookId);
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

    const movableMemoIds = getMemoIdsNeedingMove(memoIds, targetNotebookId);
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

    const memoIds = getMemoIdsNeedingMove([memoId], targetNotebookId);
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
  const selectionMoveTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : memoView === "trash"
        ? t("workspace.selection.trashCannotMove")
        : notebooks.length === 0
          ? t("workspace.selection.noMovableNotebook")
          : moveMemosMutation.isPending
            ? t("workspace.selection.moving")
            : t("workspace.selection.move");
  const selectionMergeTitle =
    selectedMemoIds.size < 2
      ? t("workspace.selection.needTwoMemos")
      : memoView === "trash"
        ? t("workspace.selection.trashCannotMerge")
        : mergeMutation.isPending
          ? t("workspace.selection.merging")
          : t("workspace.selection.merge");
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
      deleteTitle={selectionDeleteTitle}
      isDeleting={deleteMemosMutation.isPending || deleteMemoMutation.isPending}
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
    setSelectedNotebookId(notebookId);
    setSearch("");
    setMemoFilterMode("all");
    setRightView("editor");
    setMobileBottomNavActive("home");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
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

  const handleOpenCompanion = () => {
    clearHiddenMobileSearch();
    navigateWorkspaceCompanion();
    setRightView("companion");
    setMobileBottomNavActive("companion");
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
    const removeMarkdownListener = bridge.onImportMarkdown((payload) => {
      const notebookId = selectedNotebookId && notebooks.some((notebook) => notebook.id === selectedNotebookId)
        ? selectedNotebookId
        : defaultMemoNotebookId;
      if (!notebookId) return;
      const title = payload.name.replace(/\.(?:md|markdown)$/i, "").trim();
      createMemoMutation.mutate({ notebookId, title, contentMarkdown: payload.content, tags: [] });
    });
    return () => {
      removeCommandListener();
      removeMarkdownListener();
    };
  }, [createMemoMutation, defaultMemoNotebookId, handleCreateMemo, handleCreateNotebook, handleGlobalSearch, notebooks, selectedNotebookId, toggleDesktopFocusMode]);

  const handleWorkspaceBackRequest = useCallback(() => {
    if (appNoticeDialog) {
      setAppNoticeDialog(null);
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

    if (rightView === "companion") {
      handleSelectAllMemos();
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
        : rightView === "companion"
          ? t("companion.title")
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

  return (
    <WorkspaceMotionProvider>
      <div className="edgeever-workspace-shell flex h-[100dvh] overflow-hidden text-slate-950">
      {pullToRefreshVisible && (
        <div
          className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex justify-center lg:hidden"
          style={{ transform: `translateY(${Math.max(0, pullToRefreshDistance - 24)}px)` }}
          aria-hidden="true"
        >
          <div className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 text-xs font-semibold text-slate-600 shadow-[0_10px_28px_rgba(15,23,42,0.12)] backdrop-blur">
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
                : "edgeever-workspace-grid--single-right"
          )}
          style={{ "--memo-list-width": `${memoListWidth}px` } as CSSProperties}
        >
          <aside
            className={cn(
              "edgeever-workspace-sidebar min-h-0 border-r",
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
                  companionActive={rightView === "companion"}
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
              isMoving={moveMemosMutation.isPending}
              isPinning={pinMemosMutation.isPending}
              isDeleting={deleteMemosMutation.isPending || deleteMemoMutation.isPending}
              multiSelectKeyDown={multiSelectKeyDown}
              onRetry={() => void memosQuery.refetch()}
              onOpenNotebookPicker={() => setMobileNotebookPickerOpen(true)}
              onSearch={setSearch}
              onCancelMobileSearch={handleCancelMobileSearch}
              onCreateMemo={handleCreateMemo}
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
              onTogglePinMemo={handleToggleMemoPinned}
              onPinSelectedMemos={handlePinSelectedMemos}
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

          <section className={cn("edgeever-workspace-editor min-h-0 min-w-0 lg:block", visibleActivePane === "editor" ? "block" : "hidden")}>
            {shouldRenderRightPane && (
              <Suspense fallback={<PaneLoadingFallback label={rightPaneLoadingLabel} />}>
                <m.div key={rightView} className="h-full min-h-0 min-w-0" {...paneEnterMotion}>
                  {rightView === "settings" ? (
                    <SettingsPane
                    companionScope={localDataScope}
                    onOpenCompanion={handleOpenCompanion}
                    onOpenExecutionCenter={handleOpenExecutionCenter}
                    onClose={handleCloseSettings}
                    onOpenTemplates={handleOpenTemplates}
                  onOpenAiPrompts={handleOpenAiPrompts}
                    imageCompressionEnabled={imageCompressionEnabled}
                    onImageCompressionChange={setImageCompressionEnabled}
                    shortcutSettings={shortcutSettings}
                    onShortcutSettingsChange={setShortcutSettings}
                    editorContentAlignment={editorContentAlignment}
                    onEditorContentAlignmentChange={setEditorContentAlignment}
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
                  ) : rightView === "companion" ? (
                    <CompanionPane key={localDataScope} available={authRequired && Boolean(user) && !demoMode} onBack={handleSelectAllMemos} onOpenSettings={handleOpenSettings}
                      beforeApply={async () => {
                        const { assertCompanionChangesSynced } = await import("@/lib/companion-actions");
                        await assertCompanionChangesSynced(localDataScope);
                      }}
                      onNotesChanged={async () => {
                        const result = await refreshWorkspaceFromServer("manual");
                        if ("skipped" in result && result.skipped) throw new Error("Workspace refresh was skipped.");
                      }}
                      onOpenNote={handleOpenPluginNote}
                    />
                  ) : rightView === "execution-center" ? (
                    <ExecutionCenterPane currentDeviceId={scheduledTaskDeviceId} onClose={handleCloseExecutionCenter} />
                  ) : rightView === "evernote-migration" ? (
                    <EvernoteImportGuidePane onClose={() => setRightView("settings")} onOpenExecutionCenter={handleOpenExecutionCenter} />
                  ) : rendererRecoveryMode ? (
                    <EditorRecoveryPane />
                  ) : (
                    <EditorPaneErrorBoundary
                      resetKey={selectedMemo?.id ?? selectedMemoId}
                      onBackToList={() => {
                        setRendererRecoveryMode(true);
                        setSelectedMemoId(null);
                        setActivePane("memos");
                      }}
                    >
                      <EditorPane
                      onOpenExecutionCenter={handleOpenExecutionCenter}
                      companionDiscoveryHub={authRequired && Boolean(user) && !demoMode ? (
                        <Suspense fallback={null}>
                          <CompanionDiscoveryHub key={localDataScope} scope={localDataScope} onOpenNote={handleOpenPluginNote} onOpenSettings={handleOpenSettings}
                            onNotesChanged={async () => {
                              const result = await refreshWorkspaceFromServer("manual");
                              if ("skipped" in result && result.skipped) throw new Error("Workspace refresh was skipped.");
                            }} />
                        </Suspense>
                      ) : null}
                      memo={selectedMemo}
                      repository={repository}
                      pluginHost={pluginHost}
                      pluginNavigationRequest={pluginNavigationRequest}
                    onOpenAiPrompts={handleOpenAiPrompts}
                    desktopFocusMode={desktopFocusModeActive}
                    onToggleDesktopFocusMode={toggleDesktopFocusMode}
                    editorContentAlignment={editorContentAlignment}
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
                    hasNextMemo={Boolean(nextMemoId)}
                    hasPreviousMemo={Boolean(previousMemoId)}
                    onBackToList={() => {
                      applyMobileEditorReturnPreview(selectedMemo?.id ?? selectedMemoId);
                      clearPendingCreatedMemo();
                      setActivePane("memos");
                    }}
                    onOpenNextMemo={() => {
                      if (nextMemoId) {
                        clearPendingCreatedMemo();
                        setCreatedMemoEditId(null);
                        setSelectedMemoId(nextMemoId);
                      }
                    }}
                    onOpenPreviousMemo={() => {
                      if (previousMemoId) {
                        clearPendingCreatedMemo();
                        setCreatedMemoEditId(null);
                        setSelectedMemoId(previousMemoId);
                      }
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
                                  selectedNotebookDescendantIds,
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
      {visibleActivePane !== "editor" && !memoSelectionModeActive && (
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
