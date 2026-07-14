import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Home, Search, UserRound, Plus, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { MemoListPane, MemoSelectionActionBar } from "./MemoListPane";
import { AppConfirmDialog, MemoDeleteConfirmDialog, NotebookNameDialog } from "./dialogs/ConfirmDialogs";
import { api } from "@/lib/api";
import { MOBILE_EDITOR_RETURN_PARAM, openStandaloneMobileEditor } from "@/lib/mobile-editor";
import { cn } from "@/lib/utils";
import { createExcerpt, docToText, type Notebook, type AuthUser, type MemoSummary, type MemoDetail } from "@edgeever/shared";
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
  MemoTemplate,
  ShortcutSettings,
  MemoFilterMode,
  MemoSortMode,
} from "@/lib/app-helpers";
import {
  DEFAULT_MEMO_TITLE,
  MIN_MEMO_LIST_WIDTH_PX,
  MAX_MEMO_LIST_WIDTH_PX,
  DEFAULT_MEMO_LIST_WIDTH_PX,
  isTextEntryTarget,
  readImageCompressionPreference,
  writeImageCompressionPreference,
  readShortcutSettingsPreference,
  writeShortcutSettingsPreference,
  getShortcutActionForEvent,
  readMemoListWidthPreference,
  writeMemoListWidthPreference,
  clampMemoListWidth,
  toggleMemoSelection,
  getNotebookDropSortOrder,
  buildNotebookTree,
  notebookTreeContainsId,
  getNotebookAncestorIds,
  getExpandableNotebookIds,
  filterNotebookTree,
  getNotebookMoveOptions,
} from "@/lib/app-helpers";
import { useBrowserBackLayer } from "@/lib/app-hooks";
import type { SyncQueueSummary } from "@/lib/sync-queue";

const isDesktopViewport = () => window.matchMedia("(min-width: 1024px)").matches;
const PULL_TO_REFRESH_TRIGGER_PX = 72;
const PULL_TO_REFRESH_MAX_PX = 96;

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
const NotebookPane = lazy(() => import("./NotebookPane").then((module) => ({ default: module.NotebookPane })));
const EvernoteImportGuidePane = lazy(() =>
  import("./EvernoteImportGuidePane").then((module) => ({ default: module.EvernoteImportGuidePane }))
);
const TagsPane = lazy(() => import("./TagsPane").then((module) => ({ default: module.TagsPane })));
const TemplatesDialog = lazy(() => import("./dialogs/TemplatesDialog").then((module) => ({ default: module.TemplatesDialog })));

const SETTINGS_PATH = "/settings";
const TRASH_VIEW_SEARCH = "?view=trash";
const getMobileEditorReturnMemoId = (search: string) => new URLSearchParams(search).get(MOBILE_EDITOR_RETURN_PARAM);
const emptySyncQueueSummary = (): SyncQueueSummary => ({
  total: 0,
  pending: 0,
  syncing: 0,
  conflict: 0,
  error: 0,
});

const PaneLoadingFallback = ({ label = "Loading" }: { label?: string }) => (
  <div className="flex h-full min-h-0 items-center justify-center bg-white text-sm font-medium text-slate-400" role="status">
    {label}
  </div>
);

const memoDetailQueryKey = (memoId: string, view: MemoView) => ["memo", memoId, view] as const;

type MemoListQueryData = {
  pages: Array<{
    memos: MemoSummary[];
    totalCount: number;
    nextCursor: string | null;
  }>;
  pageParams: unknown[];
};

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

const memoToSummary = (memo: MemoDetail): MemoSummary => ({
  id: memo.id,
  notebookId: memo.notebookId,
  title: memo.title,
  excerpt: memo.excerpt || createExcerpt(memo.contentText || docToText(memo.contentJson) || memo.contentMarkdown),
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

const memoMatchesFilter = (memo: MemoSummary, filterMode: unknown) => {
  if (filterMode === "tagged") {
    return memo.tags.length > 0;
  }

  if (filterMode === "untagged") {
    return memo.tags.length === 0;
  }

  if (filterMode === "pinned") {
    return memo.isPinned;
  }

  return true;
};

const memoBelongsInList = (memo: MemoSummary, queryKey: readonly unknown[]) => {
  const [, view, notebookId, search, filterMode] = queryKey;
  const memoView = view === "trash" ? "trash" : "notebook";

  if (memoView === "trash" !== memo.isDeleted) {
    return false;
  }

  if (memoView === "notebook" && typeof notebookId === "string" && notebookId && memo.notebookId !== notebookId) {
    return false;
  }

  if (typeof search === "string" && search.trim()) {
    return false;
  }

  return memoMatchesFilter(memo, filterMode);
};

const sortMemoSummariesForList = (memos: MemoSummary[], queryKey: readonly unknown[]) => {
  const sortMode = queryKey[5];
  const sorted = [...memos];

  if (sortMode === "title-asc") {
    return sorted.sort((left, right) => {
      const leftTitle = left.title?.trim() || left.excerpt || DEFAULT_MEMO_TITLE;
      const rightTitle = right.title?.trim() || right.excerpt || DEFAULT_MEMO_TITLE;
      return leftTitle.localeCompare(rightTitle, "zh-CN") || left.id.localeCompare(right.id);
    });
  }

  if (sortMode === "created-desc") {
    return sorted.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id));
  }

  return sorted.sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.id.localeCompare(left.id);
  });
};

const reflowMemoListPages = (current: MemoListQueryData, memos: MemoSummary[], totalCount: number) => {
  let offset = 0;

  return {
    ...current,
    pages: current.pages.map((page) => {
      const pageSize = page.memos.length;
      const nextPageMemos = memos.slice(offset, offset + pageSize);
      offset += pageSize;

      return {
        ...page,
        memos: nextPageMemos,
        totalCount,
      };
    }),
  };
};

const updateMemoSummaryInLists = (queryClient: QueryClient, memo: MemoDetail) => {
  const summary = memoToSummary(memo);

  for (const [queryKey, current] of queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] })) {
    if (!current) {
      continue;
    }

    const flatMemos = current.pages.flatMap((page) => page.memos);
    const existingIndex = flatMemos.findIndex((item) => item.id === summary.id);
    const belongsInList = memoBelongsInList(summary, queryKey);
    const currentTotalCount = current.pages[0]?.totalCount ?? flatMemos.length;

    if (existingIndex >= 0) {
      const nextMemos = belongsInList
        ? flatMemos.map((item) => (item.id === summary.id ? { ...item, ...summary } : item))
        : flatMemos.filter((item) => item.id !== summary.id);
      const totalCount = belongsInList ? currentTotalCount : Math.max(0, currentTotalCount - 1);

      queryClient.setQueryData(queryKey, reflowMemoListPages(current, sortMemoSummariesForList(nextMemos, queryKey), totalCount));
      continue;
    }

    if (belongsInList) {
      const [firstPage, ...restPages] = current.pages;
      const nextFirstPage = firstPage
        ? {
            ...firstPage,
            memos: sortMemoSummariesForList([summary, ...firstPage.memos], queryKey),
            totalCount: firstPage.totalCount + 1,
          }
        : { memos: [summary], totalCount: 1, nextCursor: null };

      queryClient.setQueryData(queryKey, { ...current, pages: [nextFirstPage, ...restPages] });
    }
  }
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
      "flex h-11 flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium transition-all duration-200",
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
      <div className="relative grid h-12 grid-cols-3 items-center">
        <MobileBottomNavButton active={activeItem === "home"} icon={<Home className="h-5 w-5" />} label={t("nav.home")} onClick={onHome} />
        <div aria-hidden="true" />
        <MobileBottomNavButton active={activeItem === "settings"} icon={<UserRound className="h-5 w-5" />} label={t("nav.mine")} onClick={onOpenSettings} />
        <button
          className="absolute left-1/2 top-[-0.8rem] flex h-[3.25rem] w-[3.25rem] -translate-x-1/2 items-center justify-center rounded-full border-[5px] border-white bg-emerald-500 text-white shadow-[0_12px_26px_rgb(var(--brand-green-rgb)/0.32)] transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-200 disabled:opacity-70 disabled:hover:bg-emerald-200"
          type="button"
          title={createMemoLabel}
          aria-label={createMemoLabel}
          disabled={!canCreateMemo || isCreating}
          onClick={onCreateMemo}
        >
          <Plus className="h-7 w-7" />
        </button>
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
  const { t } = useTranslation();
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
  user,
  isLoggingOut,
  onLogout,
}: {
  authRequired: boolean;
  user: AuthUser | null;
  isLoggingOut: boolean;
  onLogout: () => void;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const isInitialSettingsRoute = location.pathname === SETTINGS_PATH;
  const isInitialMobileEditorReturn = Boolean(getMobileEditorReturnMemoId(location.search));
  const isTrashRoute = location.pathname === "/" && location.search === TRASH_VIEW_SEARCH;
  const [activePane, setActivePane] = useState<Pane>(() => (isInitialSettingsRoute && !isInitialMobileEditorReturn ? "editor" : "memos"));
  const [memoView, setMemoView] = useState<MemoView>(() => (isTrashRoute ? "trash" : "notebook"));
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);
  const [createdMemoEditId, setCreatedMemoEditId] = useState<string | null>(null);
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(new Set());
  const [memoSelectionMode, setMemoSelectionMode] = useState(false);
  const [selectionMoveTargetNotebookId, setSelectionMoveTargetNotebookId] = useState("");
  const [memoDeleteConfirmation, setMemoDeleteConfirmation] = useState<MemoDeleteConfirmation | null>(null);
  const [emptyTrashConfirmationOpen, setEmptyTrashConfirmationOpen] = useState(false);
  const [notebookNameDialog, setNotebookNameDialog] = useState<NotebookNameDialogState | null>(null);
  const [notebookDeleteConfirmation, setNotebookDeleteConfirmation] = useState<Notebook | null>(null);
  const [appNoticeDialog, setAppNoticeDialog] = useState<AppNoticeDialogState | null>(null);
  const [multiSelectKeyDown, setMultiSelectKeyDown] = useState(false);
  const [imageCompressionEnabled, setImageCompressionEnabled] = useState(readImageCompressionPreference);
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(readShortcutSettingsPreference);
  const [rightView, setRightView] = useState<"editor" | "settings" | "assets" | "tags" | "evernote-migration">(() =>
    isInitialSettingsRoute ? "settings" : "editor"
  );
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [mobileNotebookPickerOpen, setMobileNotebookPickerOpen] = useState(false);
  const [mobileBottomNavActive, setMobileBottomNavActive] = useState<MobileBottomNavItem>(() =>
    isInitialSettingsRoute && !isInitialMobileEditorReturn ? "settings" : "home"
  );
  const [mobileSearchFocusToken, setMobileSearchFocusToken] = useState(0);
  const [noteSearchFocusToken, setNoteSearchFocusToken] = useState(0);
  const [noteReplaceFocusToken, setNoteReplaceFocusToken] = useState(0);
  const [memoListWidth, setMemoListWidth] = useState(readMemoListWidthPreference);
  const [search, setSearch] = useState("");
  const [memoFilterMode, setMemoFilterMode] = useState<MemoFilterMode>("all");
  const [memoSortMode, setMemoSortMode] = useState<MemoSortMode>("updated-desc");
  const [syncSummary, setSyncSummary] = useState<SyncQueueSummary>(emptySyncQueueSummary);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [isDesktop, setIsDesktop] = useState(isDesktopViewport);
  const [isSyncingQueuedChanges, setIsSyncingQueuedChanges] = useState(false);
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

  const navigateWorkspaceHome = () => {
    if (location.pathname !== "/" || location.search) {
      navigate("/");
    }
  };

  const navigateWorkspaceTrash = () => {
    if (location.pathname !== "/" || location.search !== TRASH_VIEW_SEARCH) {
      navigate(`/${TRASH_VIEW_SEARCH}`);
    }
  };

  const navigateWorkspaceSettings = () => {
    if (location.pathname !== SETTINGS_PATH) {
      navigate(SETTINGS_PATH);
    }
  };

  const runQueuedSync = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      return;
    }

    setIsSyncingQueuedChanges(true);

    try {
      const { syncQueuedChanges } = await import("@/lib/sync-queue");
      await syncQueuedChanges({
        onSynced: async (memo) => {
          cacheMemoDetail(queryClient, memo);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["memos"] }),
            queryClient.invalidateQueries({ queryKey: ["memo", memo.id] }),
          ]);
        },
      });
    } finally {
      setIsSyncingQueuedChanges(false);
    }
  }, [queryClient]);

  const refreshLatestMemos = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      setPullToRefreshDistance(0);
      return;
    }

    setIsPullRefreshing(true);

    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      ]);
    } finally {
      setIsPullRefreshing(false);
      setPullToRefreshDistance(0);
    }
  }, [queryClient]);

  const syncMemosManually = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      return;
    }

    setIsManualMemoSyncing(true);

    try {
      await runQueuedSync();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: "all" }),
      ]);
    } finally {
      setIsManualMemoSyncing(false);
    }
  }, [queryClient, runQueuedSync]);

  const notebooksQuery = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => api.listNotebooks(),
  });

  const notebooks = notebooksQuery.data?.notebooks ?? [];
  const mobileEditorReturnMemoId = getMobileEditorReturnMemoId(location.search);
  const visibleActivePane: Pane = mobileEditorReturnMemoId ? "memos" : activePane;
  const defaultMemoNotebookId =
    notebooks.find(
      (notebook) => notebook.id === "nb_inbox" || notebook.slug === "inbox" || notebook.name === "等待分类"
    )?.id ?? null;
  const canCreateMemo = Boolean(defaultMemoNotebookId && memoView !== "trash");
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
      rightView !== "editor" ||
      memoSelectionModeActive ||
      visibleActivePane === "editor" ||
      visibleActivePane === "notebooks"
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

  const clearMemoSelection = useCallback(() => {
    setSelectedMemoIds(new Set());
    setMemoSelectionMode(false);
  }, []);

  const clearPendingCreatedMemo = useCallback(() => {}, []);

  useEffect(() => {
    const returnedMemoId = getMobileEditorReturnMemoId(location.search);
    if (!returnedMemoId) {
      return;
    }

    skipNextHomeRouteSyncRef.current = false;
    setRightView("editor");
    setMobileBottomNavActive("home");
    setActivePane("memos");
    setSelectedMemoId(null);
    setCreatedMemoEditId(null);
    clearMemoSelection();

    if (location.pathname !== "/" || location.search) {
      navigate("/", { replace: true });
    }
  }, [clearMemoSelection, location.pathname, location.search, navigate]);

  const replaceMemoSelection = useCallback((memoIds: string[]) => {
    setSelectedMemoIds(new Set(memoIds));
    setMemoSelectionMode(true);
  }, []);

  const enterMemoSelectionMode = useCallback(() => {
    setMemoSelectionMode(true);
    setActivePane("memos");
  }, []);

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
    writeImageCompressionPreference(imageCompressionEnabled);
  }, [imageCompressionEnabled]);

  useEffect(() => {
    writeShortcutSettingsPreference(shortcutSettings);
  }, [shortcutSettings]);

  useEffect(() => {
    void import("./EditorPane");
  }, []);

  useEffect(() => {
    if (location.pathname === SETTINGS_PATH) {
      skipNextHomeRouteSyncRef.current = false;
      setRightView("settings");
      setMobileBottomNavActive("settings");
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
  }, [isTrashRoute, location.pathname]);

  useEffect(() => {
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
        if (isStandaloneRuntime) {
          void refreshLatestMemos();
          return;
        }

        setIsPullRefreshing(true);
        window.location.reload();
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
  }, [isStandaloneRuntime, mobilePullToRefreshActive, refreshLatestMemos]);

  useEffect(() => {
    const updateOnlineState = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (online) {
        void runQueuedSync();
      }
    };

    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    updateOnlineState();

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, [runQueuedSync]);

  useEffect(() => {
    if (!isStandaloneRuntime) {
      return;
    }

    const refreshWorkspaceQueries = () => {
      if (document.visibilityState === "hidden" || (typeof navigator !== "undefined" && !navigator.onLine)) {
        return;
      }

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      ]);
    };

    window.addEventListener("pageshow", refreshWorkspaceQueries);
    document.addEventListener("visibilitychange", refreshWorkspaceQueries);

    return () => {
      window.removeEventListener("pageshow", refreshWorkspaceQueries);
      document.removeEventListener("visibilitychange", refreshWorkspaceQueries);
    };
  }, [isStandaloneRuntime, queryClient]);

  useEffect(() => {
    if (syncSummary.total === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void runQueuedSync();
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [runQueuedSync, syncSummary.total]);

  const memosQuery = useInfiniteQuery({
    queryKey: ["memos", memoView, selectedNotebookId, search, memoFilterMode, memoSortMode],
    queryFn: ({ pageParam }) =>
      api.listMemos({
        notebookId: memoView === "notebook" ? selectedNotebookId : null,
        q: search,
        trash: memoView === "trash",
        filter: memoFilterMode,
        sort: memoSortMode,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const memos = useMemo(() => {
    const memoMap = new Map<string, MemoSummary>();

    for (const page of memosQuery.data?.pages ?? []) {
      for (const memo of page.memos) {
        memoMap.set(memo.id, memo);
      }
    }

    return Array.from(memoMap.values());
  }, [memosQuery.data?.pages]);
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

  useEffect(() => {
    const selectedMemoInList = selectedMemoId ? memos.some((memo) => memo.id === selectedMemoId) : false;

    if (memos.length === 0) {
      setSelectedMemoId(null);
      return;
    }

    if (!selectedMemoId || !selectedMemoInList) {
      setSelectedMemoId(memos[0].id);
    }
  }, [memos, selectedMemoId]);

  const memoQuery = useQuery({
    queryKey: selectedMemoId ? memoDetailQueryKey(selectedMemoId, memoView) : ["memo", selectedMemoId, memoView],
    queryFn: () => api.getMemo(selectedMemoId as string, { includeDeleted: memoView === "trash" }),
    enabled: Boolean(selectedMemoId),
  });

  const createNotebookMutation = useMutation({
    mutationFn: api.createNotebook,
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
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
    }) => api.updateNotebook(notebookId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
    },
  });

  const deleteNotebookMutation = useMutation({
    mutationFn: api.deleteNotebook,
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
    mutationFn: api.createMemo,
    onSuccess: (data) => {
      const targetNotebookId = data.memo.notebookId;

      setMemoView("notebook");
      setSearch("");
      if (targetNotebookId !== selectedNotebookId) {
        setSelectedNotebookId(targetNotebookId);
      }
      cacheMemoDetail(queryClient, data.memo, "notebook");
      updateMemoSummaryInLists(queryClient, data.memo);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType: "inactive" }),
      ]);
      navigateWorkspaceHome();
      setRightView("editor");
      setCreatedMemoEditId(data.memo.id);
      setSelectedMemoId(data.memo.id);
      setActivePane("editor");

      if (!isDesktopViewport()) {
        openStandaloneMobileEditor(data.memo.id);
      }
    },
  });

  const mergeMutation = useMutation({
    mutationFn: api.mergeMemos,
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
    mutationFn: api.moveMemos,
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
    mutationFn: async ({ memoIds, isPinned }: { memoIds: string[]; isPinned: boolean }) =>
      Promise.all(memoIds.map((memoId) => api.updateMemo(memoId, { isPinned }))),
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
    mutationFn: api.deleteMemos,
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
    mutationFn: ({ memoId, permanent }: { memoId: string; permanent?: boolean }) =>
      api.deleteMemo(memoId, { permanent }),
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
    mutationFn: api.emptyTrash,
    onSuccess: async () => {
      setEmptyTrashConfirmationOpen(false);
      clearMemoSelection();
      setSelectedMemoId(null);
      setActivePane("memos");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
        queryClient.invalidateQueries({ queryKey: ["resources"] }),
      ]);
    },
  });

  const restoreMemoMutation = useMutation({
    mutationFn: api.restoreMemo,
    onSuccess: (data) => {
      setMemoView("notebook");
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
  const cachedSelectedMemo = selectedMemoId
    ? queryClient.getQueryData<{ memo: MemoDetail }>(memoDetailQueryKey(selectedMemoId, memoView))?.memo ?? null
    : null;
  const selectedMemo = memoQuery.data?.memo ?? cachedSelectedMemo;
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

  const handleCreateMemo = (template?: MemoTemplate) => {
    if (!defaultMemoNotebookId || memoView === "trash") {
      return;
    }

    setTemplatesOpen(false);
    setMobileBottomNavActive("home");
    createMemoMutation.mutate({
      notebookId: defaultMemoNotebookId,
      title: template?.title ?? DEFAULT_MEMO_TITLE,
      contentMarkdown: template?.contentMarkdown ?? "",
      tags: template?.tags ?? [],
    });
  };

  const handleMobileDefaultEditConsumed = useCallback(() => {
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
    setSelectedNotebookId(null);
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
    setSelectedNotebookId(null);
    setSearch("");
    clearMemoSelection();
    clearPendingCreatedMemo();
    setCreatedMemoEditId(null);
    setActivePane("memos");
  };

  const handleMobileSearch = () => {
    setMobileBottomNavActive("search");
    setActivePane("memos");
    setMobileSearchFocusToken((value) => value + 1);
  };

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
    skipNextHomeRouteSyncRef.current = location.pathname !== "/";
    navigateWorkspaceHome();
    setRightView("assets");
    setActivePane("editor");
  };

  const handleOpenTags = () => {
    clearHiddenMobileSearch();
    skipNextHomeRouteSyncRef.current = location.pathname !== "/";
    navigateWorkspaceHome();
    setRightView("tags");
    setActivePane("editor");
  };

  const handleOpenTemplates = () => {
    clearHiddenMobileSearch();
    setMobileBottomNavActive("templates");
    setTemplatesOpen(true);
  };

  const handleOpenSettings = () => {
    clearHiddenMobileSearch();
    navigateWorkspaceSettings();
    setRightView("settings");
    setMobileBottomNavActive("settings");
    setActivePane("editor");
  };

  const handleCloseAssets = () => {
    navigateWorkspaceHome();
    setRightView("editor");
    setMobileBottomNavActive("home");
  };

  const handleCloseTemplates = () => {
    setTemplatesOpen(false);
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

    if (rightView === "settings") {
      handleCloseSettings();
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
    handleCloseTemplates,
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

      const targetElement = event.target instanceof Element ? event.target : null;
      const isEditorTextTarget = Boolean(targetElement?.closest(".ProseMirror"));

      if ((action === "focusSearch" || action === "focusReplace") && isTextEntryTarget(event.target) && !isEditorTextTarget) {
        return;
      }

      const transientLayerOpen = Boolean(
        appNoticeDialog ||
          rightView !== "editor" ||
          memoDeleteConfirmation ||
          emptyTrashConfirmationOpen ||
          mobileNotebookPickerOpen ||
          notebookDeleteConfirmation ||
          notebookNameDialog ||
          templatesOpen
      );

      if (transientLayerOpen) {
        return;
      }

      if (action === "focusSearch") {
        event.preventDefault();
        if (event.shiftKey || !selectedMemoId || !isDesktopViewport()) {
          if (event.shiftKey) {
            setSearch("");
          }
          clearMemoSelection();
          handleMobileSearch();
          return;
        }

        setNoteSearchFocusToken((value) => value + 1);
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
    clearMemoSelection,
    createNotebookMutation.isPending,
    createMemoMutation.isPending,
    handleCreateNotebook,
    handleCreateMemo,
    handleMobileSearch,
    shortcutSettings,
    emptyTrashConfirmationOpen,
    memoDeleteConfirmation,
    memoView,
    mobileNotebookPickerOpen,
    notebookDeleteConfirmation,
    notebookNameDialog,
    selectedMemoId,
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
      const nextWidth = clampMemoListWidth(startWidth + moveEvent.clientX - startX);
      setMemoListWidth(nextWidth);
      writeMemoListWidthPreference(nextWidth);
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
    setMemoListWidth(DEFAULT_MEMO_LIST_WIDTH_PX);
    writeMemoListWidthPreference(DEFAULT_MEMO_LIST_WIDTH_PX);
  };

  const updateMemoListWidth = (width: number) => {
    const nextWidth = clampMemoListWidth(width);
    setMemoListWidth(nextWidth);
    writeMemoListWidthPreference(nextWidth);
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
      : rightView === "assets"
        ? t("workspace.loading.assets")
        : rightView === "tags"
          ? t("workspace.loading.tags")
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
    <div className="flex h-[100dvh] overflow-hidden bg-slate-50 text-slate-950">
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
            "grid h-[100dvh] min-h-0 grid-cols-[minmax(0,1fr)]",
            rightView === "editor"
              ? "lg:grid-cols-[260px_var(--memo-list-width)_minmax(0,1fr)]"
              : "lg:grid-cols-[260px_1fr]"
          )}
          style={{ "--memo-list-width": `${memoListWidth}px` } as CSSProperties}
        >
          <aside
            className={cn(
              "min-h-0 border-r border-slate-200 bg-white/75 backdrop-blur-lg lg:block",
              visibleActivePane === "notebooks" ? "block" : "hidden"
            )}
          >
            {(isDesktop || visibleActivePane === "notebooks") && (
              <Suspense fallback={<PaneLoadingFallback label={t("workspace.loading.notebooks")} />}>
                <NotebookPane
                  authRequired={authRequired}
                  user={user}
                  selectedNotebookId={selectedNotebookId}
                  view={memoView}
                  canCreateMemo={canCreateMemo}
                  isCreatingMemo={createMemoMutation.isPending}
                  onSelect={(notebookId) => {
                    navigateWorkspaceHome();
                    setMemoView("notebook");
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
                  onOpenAssets={handleOpenAssets}
                  onOpenTags={handleOpenTags}
                  onOpenSettings={handleOpenSettings}
                  onOpenTrash={() => {
                    navigateWorkspaceTrash();
                    setMemoView("trash");
                    setSelectedNotebookId(null);
                    setMobileBottomNavActive("home");
                    clearMemoSelection();
                    setSelectedMemoId(null);
                    setActivePane("memos");
                  }}
                  onEmptyTrash={handleEmptyTrash}
                />
              </Suspense>
            )}
          </aside>

          <section
            className={cn(
              "relative min-w-0 overflow-hidden border-r border-slate-200 bg-slate-50",
              rightView === "editor"
                ? (visibleActivePane === "memos" ? "block lg:block lg:bg-white/75 lg:backdrop-blur-lg" : "hidden lg:block lg:bg-white/75 lg:backdrop-blur-lg")
                : (visibleActivePane === "memos" ? "block lg:hidden" : "hidden lg:hidden")
            )}
          >
            <MemoListPane
              notebook={selectedNotebook}
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
                setSelectedNotebookId(null);
                setMobileBottomNavActive("home");
                clearMemoSelection();
                clearPendingCreatedMemo();
                setCreatedMemoEditId(null);
                setSelectedMemoId(null);
                setActivePane("memos");
              }}
              onBackFromTrash={handleSelectAllMemos}
              onOpenMemo={(memoId) => {
                navigateWorkspaceHome();
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
                    return toggleMemoSelection(current, memoId);
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

          <section className={cn("min-h-0 min-w-0 bg-white lg:block", visibleActivePane === "editor" ? "block" : "hidden")}>
            {shouldRenderRightPane && (
              <Suspense fallback={<PaneLoadingFallback label={rightPaneLoadingLabel} />}>
                {rightView === "settings" ? (
                  <SettingsPane
                    onClose={handleCloseSettings}
                    imageCompressionEnabled={imageCompressionEnabled}
                    onImageCompressionChange={setImageCompressionEnabled}
                    shortcutSettings={shortcutSettings}
                    onShortcutSettingsChange={setShortcutSettings}
                    onLogout={onLogout}
                    isLoggingOut={isLoggingOut}
                    authRequired={authRequired}
                    onShowGuide={() => setRightView("evernote-migration")}
                  />
                ) : rightView === "assets" ? (
                  <AssetsPane onClose={handleCloseAssets} activeMemo={selectedMemo} />
                ) : rightView === "tags" ? (
                  <TagsPane onClose={handleCloseAssets} />
                ) : rightView === "evernote-migration" ? (
                  <EvernoteImportGuidePane onClose={() => setRightView("settings")} />
                ) : (
                  <EditorPane
                    memo={selectedMemo}
                    mobileDefaultEditMemoId={createdMemoEditId}
                    isTrashView={memoView === "trash"}
                    notebooks={notebooks}
                    isLoading={memoQuery.isLoading}
                    searchFocusToken={noteSearchFocusToken}
                    replaceFocusToken={noteReplaceFocusToken}
                    imageCompressionEnabled={imageCompressionEnabled}
                    selectionActionBar={memoSelectionActionBar}
                    hasNextMemo={Boolean(nextMemoId)}
                    hasPreviousMemo={Boolean(previousMemoId)}
                    onBackToList={() => {
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
                      cacheMemoDetail(queryClient, memo, memoView);
                      updateMemoSummaryInLists(queryClient, memo);
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "inactive" }),
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
                  />
                )}
              </Suspense>
            )}
          </section>
        </main>
      </div>

      {templatesOpen && (
        <Suspense fallback={null}>
          <TemplatesDialog
            canCreateMemo={canCreateMemo}
            isCreating={createMemoMutation.isPending}
            onClose={handleCloseTemplates}
            onCreateMemo={handleCreateMemo}
          />
        </Suspense>
      )}
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
          currentLabel={memoView === "trash" ? t("notebookPane.trash") : undefined}
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
          onClose={() => setMobileNotebookPickerOpen(false)}
          onSelectAll={handleSelectAllMemos}
          onSelect={handleSelectNotebook}
        />
      )}
    </div>
  );
};
export default WorkspaceApp;
