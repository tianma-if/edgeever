import {
  lazy,
  Suspense,
  useState,
  useMemo,
  useRef,
  useEffect,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  MoreHorizontal,
  Tags,
  Archive,
  Trash2,
  KeyRound,
  CheckSquare,
  ArrowDownWideNarrow,
  LayoutList,
  List,
  FileText as FileIcon,
  Star,
  RotateCcw,
  RefreshCw,
  Folder,
  Merge,
  FilePlus2,
  Compass,
  Layers,
  Settings,
  MoreVertical,
  CheckCircle2,
  TagX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { MemoCard } from "./MemoCard";
import { cn } from "@/lib/utils";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import type { Notebook, MemoSummary } from "@edgeever/shared";
import type {
  MemoFilterMode,
  MemoSortMode,
  MemoListDensity,
  MemoContextMenuState,
  NotebookMoveOption,
} from "@/lib/app-helpers";
import type { SyncQueueSummary } from "@/lib/sync-queue";
import {
  getMemoFilterOptions,
  getMemoSortOptions,
  getNotebookMoveOptions,
  readMemoListDensityPreference,
  writeMemoListDensityPreference,
} from "@/lib/app-helpers";

const isDesktopViewport = () => window.matchMedia("(min-width: 1024px)").matches;

const MobileListActionsSheet = lazy(() =>
  import("./MemoListMobileSheets").then((module) => ({ default: module.MobileListActionsSheet }))
);
const MobileMoveSheet = lazy(() =>
  import("./MemoListMobileSheets").then((module) => ({ default: module.MobileMoveSheet }))
);
const MobileSelectionMoreSheet = lazy(() =>
  import("./MemoListMobileSheets").then((module) => ({ default: module.MobileSelectionMoreSheet }))
);

const getSelectionCountLabel = (count: number, t: ReturnType<typeof useTranslation>["t"]) =>
  count > 0 ? t("memoList.selectionCount", { count }) : t("memoList.selectMemo");

export const MemoSelectionActionBar = ({
  deleteTitle,
  isDeleting,
  isMerging,
  isMoving,
  isPinning,
  isTrashView,
  mergeTitle,
  moveNotebookOptions,
  moveTargetNotebookId,
  moveTitle,
  onClearSelection,
  onDelete,
  onMerge,
  onMove,
  onPin,
  pinLabel,
  pinTarget,
  pinTitle,
  selectedCount,
  onMoveTargetChange,
}: {
  deleteTitle: string;
  isDeleting: boolean;
  isMerging: boolean;
  isMoving: boolean;
  isPinning: boolean;
  isTrashView: boolean;
  mergeTitle: string;
  moveNotebookOptions: NotebookMoveOption[];
  moveTargetNotebookId: string;
  moveTitle: string;
  onClearSelection: () => void;
  onDelete: () => void;
  onMerge: () => void;
  onMove: () => void;
  onPin: () => void;
  pinLabel: string;
  pinTarget: boolean;
  pinTitle: string;
  selectedCount: number;
  onMoveTargetChange: (notebookId: string) => void;
}) => {
  const { t } = useTranslation();

  return (
    <div className="hidden h-full min-h-0 flex-1 items-center justify-center bg-white px-16 py-10 lg:flex xl:px-24">
      <div className="w-72 -translate-x-20 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg xl:-translate-x-28">
        <div className="flex h-9 items-center gap-2 px-3 text-xs font-semibold text-slate-400">
          <CheckSquare className="h-4 w-4" />
          {getSelectionCountLabel(selectedCount, t)}
        </div>
        {!isTrashView && moveNotebookOptions.length > 0 && (
          <div className="border-t border-slate-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <Select value={moveTargetNotebookId} disabled={isMoving} onValueChange={onMoveTargetChange}>
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs text-slate-700 border-slate-200">
                  <SelectValue placeholder={t("memoList.chooseNotebook")} />
                </SelectTrigger>
                <SelectContent className="max-h-60 bg-white border border-slate-200 rounded-md py-1 shadow-md">
                  {moveNotebookOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.selectLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="soft"
                title={moveTitle}
                onClick={onMove}
                disabled={selectedCount === 0 || !moveTargetNotebookId || isMoving || isTrashView}
              >
                <Folder className="h-4 w-4" />
                {t("memoList.move")}
              </Button>
            </div>
          </div>
        )}
        <Button
          className="h-11 w-full justify-start rounded-none px-3 text-slate-700 hover:bg-slate-50"
          variant="ghost"
          title={pinTitle}
          onClick={onPin}
          disabled={selectedCount === 0 || isPinning || isTrashView}
        >
          <Star className={cn("h-4 w-4", !pinTarget && "fill-current text-slate-700")} />
          {pinLabel}
        </Button>
        <Button
          className="h-11 w-full justify-start rounded-none px-3 text-slate-700 hover:bg-slate-50"
          variant="ghost"
          title={mergeTitle}
          onClick={onMerge}
          disabled={selectedCount < 2 || isMerging || isTrashView}
        >
          <Merge className="h-4 w-4" />
          {t("memoList.mergeMemos")}
        </Button>
        <div className="h-px bg-slate-100" />
        <Button
          className="h-11 w-full justify-start rounded-none px-3 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
          variant="ghost"
          title={deleteTitle}
          onClick={onDelete}
          disabled={selectedCount === 0 || isDeleting}
        >
          <Trash2 className="h-4 w-4" />
          {isTrashView ? t("memoList.permanentDelete") : t("common.delete")}
        </Button>
        <div className="h-px bg-slate-100" />
        <Button
          className="h-11 w-full justify-start rounded-none px-3 text-slate-700 hover:bg-slate-50"
          variant="ghost"
          title={t("memoList.clearSelection")}
          onClick={onClearSelection}
        >
          <X className="h-4 w-4" />
          {t("memoList.clearSelection")}
        </Button>
      </div>
    </div>
  );
};

const getMobileFilterIcon = (filterMode: MemoFilterMode) => {
  if (filterMode === "tagged") {
    return <Tags className="h-4 w-4" />;
  }
  if (filterMode === "untagged") {
    return <TagX className="h-4 w-4" />;
  }
  if (filterMode === "pinned") {
    return <Star className="h-4 w-4" />;
  }
  return <LayoutList className="h-4 w-4" />;
};

const MobileSelectionActionButton = ({
  disabled = false,
  icon,
  label,
  title = label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
}) => (
  <button
    className="flex h-12 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-300 disabled:opacity-100 disabled:hover:bg-transparent"
    type="button"
    disabled={disabled}
    title={title}
    aria-label={title}
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const MobileSelectionActionBar = ({
  canDelete,
  canMove,
  deleteTitle,
  isTrashView,
  moveTitle,
  onDelete,
  onOpenMore,
  onOpenMove,
}: {
  canDelete: boolean;
  canMove: boolean;
  deleteTitle: string;
  isTrashView: boolean;
  moveTitle: string;
  onDelete: () => void;
  onOpenMore: () => void;
  onOpenMove: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-8 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
      aria-label={t("mobileSheets.bulkActions")}
    >
      <div className="grid h-14 grid-cols-3 items-center">
        <MobileSelectionActionButton
          disabled={!canMove}
          icon={<Folder className="h-5 w-5" />}
          label={t("workspace.selection.move")}
          title={moveTitle}
          onClick={onOpenMove}
        />
        <MobileSelectionActionButton
          disabled={!canDelete}
          icon={<Trash2 className="h-5 w-5" />}
          label={isTrashView ? t("workspace.selection.permanentDelete") : t("workspace.selection.delete")}
          title={deleteTitle}
          onClick={onDelete}
        />
        <MobileSelectionActionButton icon={<MoreVertical className="h-5 w-5" />} label={t("mobileSheets.more")} onClick={onOpenMore} />
      </div>
    </nav>
  );
};

const CheckCircleCheck = ({ className }: { className?: string }) => (
  <svg
    className={cn("h-4 w-4 fill-current", className)}
    viewBox="0 0 20 20"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
      clipRule="evenodd"
    />
  </svg>
);

export const MemoListPane = ({
  notebooks,
  notebook,
  memos,
  totalMemoCount,
  hasMoreMemos,
  isLoadingMoreMemos,
  selectedMemoId,
  selectedMemoIds,
  selectionMode,
  isCreating,
  canCreateMemo,
  isPinning,
  isMoving,
  isMerging,
  isDeleting,
  view,
  search,
  searchFocusToken,
  mobileSearchActive,
  filterMode,
  sortMode,
  onFilterModeChange,
  onSortModeChange,
  onLoadMoreMemos,
  onOpenMemo,
  onDeleteMemo,
  onRestoreMemo,
  onTogglePinMemo,
  onMoveMemo,
  onMoveSelectedMemos,
  onPinSelectedMemos,
  onDeleteSelectedMemos,
  onEmptyTrash,
  onMerge,
  onEnterSelectionMode,
  onClearSelection,
  onToggleMemo,
  onReplaceSelection,
  onSearch,
  onCancelMobileSearch,
  onOpenNotebookPicker,
  onOpenTags,
  onOpenAssets,
  onOpenTrash,
  onBackFromTrash,
  onOpenSettings,
  onSyncMemos,
  onCreateMemo,
  isSyncingMemos,
  canSyncMemos,
  mobileListActionsOpen,
  setMobileListActionsOpen,
  mobileMoveOpen,
  setMobileMoveOpen,
  mobileMoreOpen,
  setMobileMoreOpen,
  desktopFilterOpen,
  setDesktopFilterOpen,
  desktopSortOpen,
  setDesktopSortOpen,
  desktopActionsOpen,
  setDesktopActionsOpen,
  isLoading,
  isRefreshing,
  isError,
  onRetry,
  multiSelectKeyDown,
}: {
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
  multiSelectKeyDown: boolean;
  notebooks: Notebook[];
  notebook: Notebook | null;
  memos: MemoSummary[];
  totalMemoCount: number;
  hasMoreMemos: boolean;
  isLoadingMoreMemos: boolean;
  selectedMemoId: string | null;
  selectedMemoIds: Set<string>;
  selectionMode: boolean;
  isCreating: boolean;
  canCreateMemo: boolean;
  isPinning: boolean;
  isMoving: boolean;
  isMerging: boolean;
  isDeleting: boolean;
  view: string;
  search: string;
  searchFocusToken: number;
  mobileSearchActive: boolean;
  filterMode: MemoFilterMode;
  sortMode: MemoSortMode;
  onFilterModeChange: (filterMode: MemoFilterMode) => void;
  onSortModeChange: (sortMode: MemoSortMode) => void;
  onLoadMoreMemos: () => void;
  onOpenMemo: (memoId: string) => void;
  onDeleteMemo: (memoId: string) => void;
  onRestoreMemo: (memoId: string) => void;
  onTogglePinMemo: (memo: MemoSummary) => void;
  onMoveMemo: (memoId: string, notebookId: string) => void;
  onMoveSelectedMemos: (notebookId: string) => void;
  onPinSelectedMemos: (pinned: boolean) => void;
  onDeleteSelectedMemos: () => void;
  onEmptyTrash: () => void;
  onMerge: () => void;
  onEnterSelectionMode: () => void;
  onClearSelection: () => void;
  onToggleMemo: (memoId: string, rangeIds?: string[]) => void;
  onReplaceSelection: (memoIds: string[]) => void;
  onSearch: (query: string) => void;
  onCancelMobileSearch: () => void;
  onOpenNotebookPicker: () => void;
  onOpenTags: () => void;
  onOpenAssets: () => void;
  onOpenTrash: () => void;
  onBackFromTrash: () => void;
  onOpenSettings: () => void;
  onSyncMemos: () => void;
  onCreateMemo: () => void;
  isSyncingMemos: boolean;
  canSyncMemos: boolean;
  mobileListActionsOpen: boolean;
  setMobileListActionsOpen: (open: boolean) => void;
  mobileMoveOpen: boolean;
  setMobileMoveOpen: (open: boolean) => void;
  mobileMoreOpen: boolean;
  setMobileMoreOpen: (open: boolean) => void;
  desktopFilterOpen: boolean;
  setDesktopFilterOpen: (open: boolean) => void;
  desktopSortOpen: boolean;
  setDesktopSortOpen: (open: boolean) => void;
  desktopActionsOpen: boolean;
  setDesktopActionsOpen: (open: boolean) => void;
  onRetry: () => void;
}) => {
  const { t } = useTranslation();
  const [memoContextMenu, setMemoContextMenu] = useState<MemoContextMenuState | null>(null);
  const [contextMoveOpen, setContextMoveOpen] = useState(false);
  const [listDensity, setListDensity] = useState<MemoListDensity>(() => readMemoListDensityPreference());
  const [lastSelectedMemoId, setLastSelectedMemoId] = useState<string | null>(null);
  const [moveTargetNotebookId, setMoveTargetNotebookId] = useState("");

  const filterOptions = useMemo(() => getMemoFilterOptions(t), [t]);
  const memoSortOptions = useMemo(() => getMemoSortOptions(t), [t]);
  const mobileFilterOptions = useMemo(() => filterOptions.filter((option: any) => option.value !== "all"), [filterOptions]);
  const visibleMemoIds = useMemo(() => memos.map((memo) => memo.id), [memos]);
  const moveNotebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const selectedMemosInList = useMemo(() => memos.filter((memo) => selectedMemoIds.has(memo.id)), [memos, selectedMemoIds]);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const listRootRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const moveTargetSelectRef = useRef<HTMLSelectElement | null>(null);
  const previousSelectionModeRef = useRef(selectionMode);
  const skipSelectedMemoAutoScrollRef = useRef(false);

  const canEnterSelectionMode = visibleMemoIds.length > 0;
  const selectedVisibleMemoCount = visibleMemoIds.filter((memoId) => selectedMemoIds.has(memoId)).length;
  const allVisibleMemosSelected = visibleMemoIds.length > 0 && selectedVisibleMemoCount === visibleMemoIds.length;
  const canToggleVisibleMemoSelection = visibleMemoIds.length > 0;
  const visibleSelectionToggleLabel = allVisibleMemosSelected ? t("memoList.selectedListNone") : t("memoList.selectedListAll");

  const listTitle = view === "trash" ? t("memoList.trash") : notebook?.name ?? t("memoList.allMemos");
  const listContextLabel = view === "trash" ? t("memoList.deletedMemos") : notebook ? t("memoList.currentNotebook") : t("memoList.allNotebooks");
  const visibleCount = `${memos.length}${memos.length !== totalMemoCount ? ` / ${totalMemoCount}` : ""}`;
  const listCountLabel = view === "trash"
    ? t("memoList.deletedCount", { count: visibleCount })
    : t("memoList.memoCount", { count: visibleCount });
  const selectionCountLabel = getSelectionCountLabel(selectedMemoIds.size, t);

  const selectionMoveTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : view === "trash"
        ? t("workspace.selection.trashCannotMove")
        : notebooks.length === 0
          ? t("workspace.selection.noMovableNotebook")
          : isMoving
            ? t("workspace.selection.moving")
            : t("workspace.selection.move");
  const selectionDeleteTitle =
    selectedMemoIds.size === 0 ? t("workspace.selection.chooseMemo") : isDeleting ? t("workspace.selection.deleting") : view === "trash" ? t("workspace.selection.permanentDelete") : t("workspace.selection.delete");
  const selectionMergeTitle =
    selectedMemoIds.size < 2 ? t("workspace.selection.needTwoMemos") : view === "trash" ? t("workspace.selection.trashCannotMerge") : isMerging ? t("workspace.selection.merging") : t("workspace.selection.merge");
  const allSelectedMemosPinned = selectedMemosInList.length > 0 && selectedMemosInList.every((memo) => memo.isPinned);
  const selectedPinTarget = !allSelectedMemosPinned;
  const selectionPinLabel = allSelectedMemosPinned ? t("workspace.selection.unpin") : t("workspace.selection.pin");
  const selectionPinTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : view === "trash"
        ? t("workspace.selection.trashCannotPin")
        : isPinning
          ? t("workspace.selection.updatingPin")
          : selectionPinLabel;
  const selectionToggleTitle = canToggleVisibleMemoSelection ? visibleSelectionToggleLabel : t("memoList.noSelectableInList");
  const moveTargetTitle =
    view === "trash" ? t("workspace.selection.trashCannotMove") : notebooks.length === 0 ? t("workspace.selection.noMovableNotebook") : isMoving ? t("workspace.selection.moving") : t("memoList.moveToNotebook");
  const hasListConstraint = Boolean(search.trim()) || filterMode !== "all";
  const activeFilterLabel = filterOptions.find((option) => option.value === filterMode)?.label ?? t("options.memoFilter.all");
  const activeSortLabel = memoSortOptions.find((option) => option.value === sortMode)?.label ?? t("options.memoSort.updatedDesc");
  const syncMemosTitle = !canSyncMemos
    ? t("memoList.manualSyncOffline")
    : isSyncingMemos
      ? t("memoList.manualSyncing")
      : t("memoList.manualSync");

  useEffect(() => {
    if (notebook?.id) {
      setMoveTargetNotebookId(notebook.id);
      return;
    }

    if (!moveTargetNotebookId && moveNotebookOptions[0]?.id) {
      setMoveTargetNotebookId(moveNotebookOptions[0].id);
    }
  }, [moveNotebookOptions, moveTargetNotebookId, notebook?.id]);

  useEffect(() => {
    if (searchFocusToken === 0) {
      return;
    }

    if (mobileSearchActive && !isDesktopViewport()) {
      mobileSearchInputRef.current?.focus();
      return;
    }

    searchInputRef.current?.focus();
  }, [mobileSearchActive, searchFocusToken]);

  useEffect(() => {
    if (!filterOptions.some((option) => option.value === filterMode)) {
      onFilterModeChange("all");
    }
  }, [filterMode, filterOptions, onFilterModeChange]);

  useEffect(() => {
    if (!hasMoreMemos || isLoadingMoreMemos) {
      return;
    }

    const scrollContainer = listScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      const remaining = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;

      if (remaining < 480) {
        onLoadMoreMemos();
      }
    };

    handleScroll();
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [hasMoreMemos, isLoadingMoreMemos, onLoadMoreMemos]);

  useEffect(() => {
    const scrollContainer = listScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    skipSelectedMemoAutoScrollRef.current = true;
    scrollContainer.scrollTo({ top: 0, behavior: "auto" });

    const resetSkipTimer = window.setTimeout(() => {
      skipSelectedMemoAutoScrollRef.current = false;
    }, 0);

    return () => window.clearTimeout(resetSkipTimer);
  }, [filterMode, notebook?.id, search, sortMode, view]);

  useEffect(() => {
    if (!selectionMode || selectedMemoIds.size === 0) {
      return;
    }

    const visibleMemoIdSet = new Set(visibleMemoIds);
    const nextSelectedMemoIds = Array.from(selectedMemoIds).filter((memoId) => visibleMemoIdSet.has(memoId));

    if (nextSelectedMemoIds.length === selectedMemoIds.size) {
      return;
    }

    if (nextSelectedMemoIds.length === 0) {
      onClearSelection();
      return;
    }

    onReplaceSelection(nextSelectedMemoIds);
  }, [onClearSelection, onReplaceSelection, selectedMemoIds, selectionMode, visibleMemoIds]);

  useEffect(() => {
    if (!selectedMemoId || !visibleMemoIds.includes(selectedMemoId) || !isDesktopViewport()) {
      return;
    }

    if (skipSelectedMemoAutoScrollRef.current) {
      skipSelectedMemoAutoScrollRef.current = false;
      return;
    }

    const scrollContainer = listScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const escapedMemoId = CSS.escape(selectedMemoId);
    const selectedNode = scrollContainer.querySelector<HTMLElement>(`[data-memo-id="${escapedMemoId}"]`);

    if (!selectedNode) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const selectedRect = selectedNode.getBoundingClientRect();
    const stickyHeaderOffset = 40;

    if (selectedRect.top < containerRect.top + stickyHeaderOffset) {
      scrollContainer.scrollTop -= containerRect.top + stickyHeaderOffset - selectedRect.top;
      return;
    }

    if (selectedRect.bottom > containerRect.bottom) {
      scrollContainer.scrollTop += selectedRect.bottom - containerRect.bottom;
    }
  }, [selectedMemoId, visibleMemoIds]);

  useEffect(() => {
    const wasSelectionMode = previousSelectionModeRef.current;
    previousSelectionModeRef.current = selectionMode;

    if (!wasSelectionMode || selectionMode || !isDesktopViewport()) {
      return;
    }

    const activeElement = document.activeElement;
    const listRoot = listRootRef.current;
    const shouldRestoreFocus =
      !activeElement ||
      activeElement === document.body ||
      (activeElement instanceof HTMLElement && Boolean(listRoot?.contains(activeElement)));

    if (!shouldRestoreFocus) {
      return;
    }

    const memoIdToFocus = lastSelectedMemoId ?? selectedMemoId ?? visibleMemoIds[0];

    if (!memoIdToFocus) {
      return;
    }

    window.setTimeout(() => {
      const scrollContainer = listScrollRef.current;
      if (!scrollContainer) {
        return;
      }

      const escapedMemoId = CSS.escape(memoIdToFocus);
      const memoButton = scrollContainer.querySelector<HTMLButtonElement>(
        `[data-memo-id="${escapedMemoId}"] button[title^="Ctrl/Cmd"]`
      );
      memoButton?.focus({ preventScroll: true });
    }, 0);
  }, [lastSelectedMemoId, selectedMemoId, selectionMode, visibleMemoIds]);

  useEffect(() => {
    if (!selectionMode) {
      setMobileMoveOpen(false);
      setMobileMoreOpen(false);
      return;
    }

    setDesktopActionsOpen(false);
    setDesktopFilterOpen(false);
    setDesktopSortOpen(false);
    setContextMoveOpen(false);
    setMemoContextMenu(null);
    setMobileListActionsOpen(false);
    setMobileMoveOpen(false);
    setMobileMoreOpen(false);
  }, [selectionMode, setDesktopActionsOpen, setDesktopFilterOpen, setDesktopSortOpen, setMobileListActionsOpen, setMobileMoreOpen, setMobileMoveOpen]);

  const handleToggleMemo = (memoId: string, event?: MouseEvent<HTMLElement>) => {
    const currentIndex = visibleMemoIds.indexOf(memoId);
    const anchorIndex = lastSelectedMemoId ? visibleMemoIds.indexOf(lastSelectedMemoId) : -1;

    if (event?.shiftKey && currentIndex >= 0 && anchorIndex >= 0) {
      const start = Math.min(currentIndex, anchorIndex);
      const end = Math.max(currentIndex, anchorIndex);
      onToggleMemo(memoId, visibleMemoIds.slice(start, end + 1));
    } else {
      onToggleMemo(memoId);
    }

    setLastSelectedMemoId(memoId);
  };

  const handleSelectAllVisibleMemos = () => {
    if (visibleMemoIds.length === 0) {
      return;
    }

    onReplaceSelection(visibleMemoIds);
    setLastSelectedMemoId(visibleMemoIds.at(-1) ?? visibleMemoIds[0]);
  };

  const handleClearVisibleMemos = () => {
    const nextSelectedMemoIds = Array.from(selectedMemoIds).filter((memoId) => !visibleMemoIds.includes(memoId));
    onReplaceSelection(nextSelectedMemoIds);
    setLastSelectedMemoId(null);
  };

  const openMemoContextMenuAt = (memo: MemoSummary, clientX: number, clientY: number) => {
    const menuWidth = 224;
    // Keep enough room for the full action list. Radix can still adjust the
    // final position, but this prevents the initial placement from starting
    // below the viewport on short or zoomed desktop viewports.
    const menuHeight = view === "trash" ? 180 : 320;
    const x = Math.min(clientX, Math.max(12, window.innerWidth - menuWidth - 12));
    const y = Math.min(clientY, Math.max(12, window.innerHeight - menuHeight - 12));

    setContextMoveOpen(false);
    setMemoContextMenu({ memo, x, y });
  };

  const handleOpenMemoContextMenu = (memo: MemoSummary, event: MouseEvent<HTMLElement>) => {
    openMemoContextMenuAt(memo, event.clientX, event.clientY);
  };

  const handleOpenSelectionContextMenu = (memo: MemoSummary, event: MouseEvent<HTMLElement>) => {
    if (!isDesktopViewport()) {
      return;
    }

    if (!selectedMemoIds.has(memo.id)) {
      handleToggleMemo(memo.id, event);
    }

    event.preventDefault();
    setContextMoveOpen(false);
    setMemoContextMenu(null);
  };

  const handleOpenSelectionKeyboardContextMenu = (memo: MemoSummary, target: HTMLElement) => {
    if (!isDesktopViewport()) {
      return;
    }

    if (!selectedMemoIds.has(memo.id)) {
      handleToggleMemo(memo.id);
    }

    setContextMoveOpen(false);
    setMemoContextMenu(null);
  };

  const handleOpenMemoKeyboardContextMenu = (memo: MemoSummary, target: HTMLElement) => {
    if (!isDesktopViewport()) {
      return;
    }

    const rect = target.getBoundingClientRect();
    openMemoContextMenuAt(memo, rect.left + Math.min(rect.width, 224), rect.top + Math.min(rect.height, 96));
  };

  const focusSearchInput = () => {
    if (mobileSearchActive && !isDesktopViewport()) {
      mobileSearchInputRef.current?.focus();
      return;
    }

    searchInputRef.current?.focus();
  };

  const handleClearSearch = () => {
    onClearSelection();
    onSearch("");
    focusSearchInput();
  };

  const handleSearchChange = (value: string) => {
    if (value !== search) {
      onClearSelection();
    }
    onSearch(value);
  };

  const handleResetListConstraints = () => {
    onClearSelection();
    onFilterModeChange("all");
    onSearch("");
    focusSearchInput();
  };

  const handleFilterModeChange = (value: MemoFilterMode) => {
    onClearSelection();
    onFilterModeChange(value);
  };

  const handleListDensityChange = (value: MemoListDensity) => {
    setListDensity(value);
    writeMemoListDensityPreference(value);
  };

  const handleMoveTargetSelectKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      listRootRef.current?.focus();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    if (selectedMemoIds.size === 0 || !moveTargetNotebookId || isMoving || view === "trash") {
      return;
    }

    event.preventDefault();
    onMoveSelectedMemos(moveTargetNotebookId);
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isDesktopViewport()) {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;

    if (target?.closest("input, textarea, select, [contenteditable='true']")) {
      return;
    }

    if (event.key === "Escape" && selectionMode) {
      event.preventDefault();
      event.stopPropagation();
      setMemoContextMenu(null);
      onClearSelection();
      setLastSelectedMemoId(null);
      return;
    }

    if (!event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      if (visibleMemoIds.length === 0) {
        return;
      }
      event.preventDefault();
      setMemoContextMenu(null);
      handleSelectAllVisibleMemos();
      return;
    }

    const isDeleteSelectedShortcut =
      !event.altKey &&
      (event.key === "Delete" || ((event.ctrlKey || event.metaKey) && event.key === "Backspace"));

    if (isDeleteSelectedShortcut) {
      if (selectionMode && selectedMemoIds.size > 0) {
        event.preventDefault();
        setMemoContextMenu(null);
        onDeleteSelectedMemos();
        return;
      }

      if (!selectedMemoId || !visibleMemoIds.includes(selectedMemoId)) {
        return;
      }

      event.preventDefault();
      setMemoContextMenu(null);
      onDeleteMemo(selectedMemoId);
      return;
    }
  };

  return (
    <div
      ref={listRootRef}
      className="relative flex h-full min-h-0 flex-col outline-none"
      tabIndex={0}
      onKeyDown={handleListKeyDown}
    >
      <header className="border-b border-slate-200 bg-slate-50 px-4 pb-2 pt-[max(0.375rem,env(safe-area-inset-bottom))] lg:bg-white lg:py-3 lg:pt-3">
        {selectionMode ? (
          <div className="mb-3 flex h-10 min-w-0 items-center gap-3 lg:hidden">
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              type="button"
              title={t("memoList.clearSelection")}
              aria-label={t("memoList.clearSelection")}
              onClick={onClearSelection}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="min-w-0 truncate text-lg font-semibold text-slate-900">{selectionCountLabel}</div>
          </div>
        ) : mobileSearchActive ? (
          <div className="mb-3 flex h-10 min-w-0 items-center gap-2 lg:hidden">
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              type="button"
              title={t("memoList.cancelSearch")}
              aria-label={t("memoList.cancelSearch")}
              onClick={onCancelMobileSearch}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
              <Search className="h-4 w-4 shrink-0" />
              <input
                ref={mobileSearchInputRef}
                type="search"
                value={search}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                enterKeyHint="search"
                spellCheck={false}
                onChange={(event) => handleSearchChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") {
                    return;
                  }

                  event.preventDefault();
                  if (search) {
                    handleClearSearch();
                    return;
                  }
                  onCancelMobileSearch();
                }}
                className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                placeholder={t("memoList.searchPlaceholder")}
              />
              {search && (
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  type="button"
                  title={t("memoList.clearSearch")}
                  aria-label={t("memoList.clearSearch")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleClearSearch}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              className="h-9 shrink-0 rounded-md px-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              type="button"
              onClick={onCancelMobileSearch}
            >
              {t("memoList.cancel")}
            </button>
          </div>
        ) : null}

        {!mobileSearchActive && (
          <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
            <div className="flex min-w-0 items-center gap-2">
              {view === "trash" && (
                <button
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  type="button"
                  title={t("notebookPane.backToList")}
                  aria-label={t("notebookPane.backToList")}
                  onClick={onBackFromTrash}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <button
                className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 text-left transition hover:bg-slate-100 lg:hidden"
                type="button"
                title={t("memoList.switchNotebook")}
                aria-label={t("memoList.switchNotebook")}
                onClick={onOpenNotebookPicker}
              >
                <span className={`max-w-[190px] truncate ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>{listTitle}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
              </button>
            </div>
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              type="button"
              title={selectionMode ? t("memoList.bulkActions") : t("memoList.listOptions")}
              aria-label={selectionMode ? t("memoList.bulkActions") : t("memoList.listOptions")}
              aria-expanded={selectionMode ? mobileMoreOpen : mobileListActionsOpen}
              onClick={() => {
                if (selectionMode) {
                  setMobileMoreOpen(true);
                  return;
                }
                setMobileListActionsOpen(true);
              }}
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="mb-3 hidden min-w-0 lg:flex items-start gap-1">
          {view === "trash" && (
            <Button
              className="-ml-2 mt-0.5 shrink-0"
              size="icon"
              variant="ghost"
              title={t("notebookPane.backToList")}
              aria-label={t("notebookPane.backToList")}
              onClick={onBackFromTrash}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <div className={`truncate ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>{listTitle}</div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {listContextLabel} · {listCountLabel}
            </div>
          </div>
        </div>

        <div className="mb-3 hidden flex-wrap items-center justify-between gap-2 lg:flex">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              title={t("memoList.selectMemo")}
              aria-label={t("memoList.selectMemo")}
              onClick={onEnterSelectionMode}
              disabled={!canEnterSelectionMode}
            >
              <CheckSquare className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-medium transition-all duration-200 outline-none",
                    filterMode === "all"
                      ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      : "border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200"
                  )}
                  title={t("memoList.filterTitle", { label: activeFilterLabel })}
                >
                  {getMobileFilterIcon(filterMode)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44 bg-white border border-slate-200 rounded-md py-1 shadow-md">
                {filterOptions.map((option: any) => (
                  <DropdownMenuItem
                    key={option.value}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 px-3 text-left text-sm cursor-pointer outline-none",
                      filterMode === option.value ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                    )}
                    onClick={() => handleFilterModeChange(option.value)}
                  >
                    {getMobileFilterIcon(option.value)}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 outline-none"
                  title={t("memoList.sortTitle", { label: activeSortLabel })}
                >
                  <ArrowDownWideNarrow className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44 bg-white border border-slate-200 rounded-md py-1 shadow-md">
                {memoSortOptions.map((option: any) => (
                  <DropdownMenuItem
                    key={option.value}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 px-3 text-left text-sm cursor-pointer outline-none",
                      sortMode === option.value ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                    )}
                    onClick={() => onSortModeChange(option.value)}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <ToggleGroup
              className="h-8 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white"
              type="single"
              value={listDensity}
              onValueChange={(value) => {
                if (value) {
                  handleListDensityChange(value as MemoListDensity);
                }
              }}
            >
              <ToggleGroupItem
                className="rounded-none border-0"
                size="icon"
                title={t("memoList.previewList")}
                value="preview"
                aria-label={t("memoList.previewList")}
              >
                <LayoutList className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                className="rounded-none border-0 border-l border-slate-200"
                size="icon"
                title={t("memoList.compactList")}
                value="compact"
                aria-label={t("memoList.compactList")}
              >
                <List className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              title={syncMemosTitle}
              aria-label={syncMemosTitle}
              disabled={!canSyncMemos || isSyncingMemos}
              onClick={onSyncMemos}
            >
              <RefreshCw className={cn("h-4 w-4", isSyncingMemos && "animate-spin")} />
            </Button>
            {view === "trash" && (
              <Button
                size="sm"
                variant="danger"
                title={t("memoList.emptyTrashTitle")}
                onClick={onEmptyTrash}
              >
                <Trash2 className="h-4 w-4" />
                {t("memoList.emptyTrash")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  title={t("memoList.more")}
                  aria-label={t("memoList.moreActions")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 bg-white border border-slate-200 rounded-md py-1 shadow-md">
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={onOpenTags}
                >
                  <Tags className="h-4 w-4 text-slate-500" />
                  {t("memoList.tags")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={onOpenAssets}
                >
                  <Archive className="h-4 w-4 text-slate-500" />
                  {t("memoList.assets")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={view === "trash" ? onEmptyTrash : onOpenTrash}
                >
                  <Trash2 className="h-4 w-4 text-rose-700" />
                  {view === "trash" ? t("memoList.emptyTrash") : t("memoList.trash")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  onClick={onOpenSettings}
                >
                  <KeyRound className="h-4 w-4 text-slate-500" />
                  MCP Token
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className={cn("items-center gap-2", mobileSearchActive ? "hidden lg:flex" : "flex")}>
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-transparent bg-slate-100 px-3 text-sm text-slate-500 transition focus-within:border-slate-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-400/20 lg:rounded-md lg:border-slate-200 lg:bg-slate-50">
            <Search className="h-4 w-4" />
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="search"
              spellCheck={false}
              onChange={(event) => handleSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search) {
                  event.preventDefault();
                  handleClearSearch();
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
              placeholder={t("memoList.searchPlaceholder")}
            />
            {search && (
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-slate-700"
                type="button"
                title={t("memoList.clearSearch")}
                aria-label={t("memoList.clearSearch")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleClearSearch}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {mobileFilterOptions.map((option: any) => (
              <button
                key={option.value}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border transition",
                  filterMode === option.value
                    ? "border-slate-700 bg-slate-700 text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)]"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                )}
                type="button"
                title={filterMode === option.value ? t("memoList.toggleOffFilter", { label: option.label }) : option.label}
                aria-label={filterMode === option.value ? t("memoList.toggleOffFilter", { label: option.label }) : option.label}
                aria-pressed={filterMode === option.value}
                onClick={() => handleFilterModeChange(filterMode === option.value ? "all" : option.value)}
              >
                {getMobileFilterIcon(option.value)}
              </button>
            ))}
          </div>
        </div>

        {hasListConstraint && (
          <div className="mt-3 flex min-h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
            <span className="min-w-0 flex-1 truncate">
              {t("memoList.constrainedCount", {
                label: search.trim()
                  ? t("memoList.searchConstraint", { query: search.trim() })
                  : t("memoList.filterConstraint", { label: activeFilterLabel }),
                count: totalMemoCount,
              })}
            </span>
            <button
              className="shrink-0 font-semibold text-slate-600 transition hover:text-slate-950"
              type="button"
              onClick={handleResetListConstraints}
            >
              {t("memoList.reset")}
            </button>
          </div>
        )}
      </header>

      <div
        ref={listScrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-3 lg:pr-0"
      >
        {isLoading || (isRefreshing && memos.length === 0) ? (
          <div className="px-2 py-4 text-sm text-slate-500">{t("memoList.fetchingLatest")}</div>
        ) : isError && memos.length === 0 ? (
          <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-4 py-9 text-center">
            <div className="text-sm font-semibold text-amber-950">{t("memoList.fetchEmptyTitle")}</div>
            <div className="mx-auto mt-2 max-w-[280px] text-xs leading-5 text-amber-800">
              {t("memoList.fetchEmptyDescription")}
            </div>
            <Button className="mt-4 justify-center" size="sm" variant="soft" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" />
              {t("memoList.retry")}
            </Button>
          </div>
        ) : memos.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-9 text-center">
            <div className="text-sm font-semibold text-slate-800">
              {memos.length === 0 ? (view === "trash" ? t("memoList.trashEmptyTitle") : t("memoList.emptyTitle")) : t("memoList.noFilteredTitle")}
            </div>
            <div className="mx-auto mt-2 max-w-[260px] text-xs leading-5 text-slate-500">
              {memos.length === 0
                ? view === "trash"
                  ? t("memoList.trashEmptyDescription")
                  : t("memoList.emptyDescription")
                : t("memoList.noFilteredDescription")}
            </div>
            {memos.length === 0 && canCreateMemo && view !== "trash" && (
              <Button className="mt-4 justify-center" size="sm" variant="solid" onClick={onCreateMemo} disabled={isCreating}>
                <FilePlus2 className="h-4 w-4" />
                {t("memoList.newMemo")}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4 lg:space-y-0 lg:overflow-hidden lg:rounded-sm lg:border-y lg:border-slate-200 lg:bg-white">
            <div className="space-y-3 lg:space-y-0">
              {memos.map((memo) => (
                <MemoCard
                  key={memo.id}
                  memo={memo}
                  selected={memo.id === selectedMemoId}
                  checked={selectedMemoIds.has(memo.id)}
                  dragMemoIds={selectedMemoIds.has(memo.id) ? Array.from(selectedMemoIds) : [memo.id]}
                  isTrashView={view === "trash"}
                  selectionMode={selectionMode}
                  listDensity={listDensity}
                  multiSelectKeyDown={multiSelectKeyDown}
                  onOpen={() => onOpenMemo(memo.id)}
                  onDelete={() => onDeleteMemo(memo.id)}
                  onRestore={() => onRestoreMemo(memo.id)}
                  onOpenContextMenu={(event) => handleOpenMemoContextMenu(memo, event)}
                  onOpenSelectionContextMenu={(event) => handleOpenSelectionContextMenu(memo, event)}
                  onOpenSelectionKeyboardContextMenu={(target) => handleOpenSelectionKeyboardContextMenu(memo, target)}
                  onOpenKeyboardContextMenu={(target) => handleOpenMemoKeyboardContextMenu(memo, target)}
                  onToggle={(event) => handleToggleMemo(memo.id, event)}
                />
              ))}
            </div>
            {isLoadingMoreMemos && (
              <div className="border-t border-slate-100 px-4 py-3 text-center text-xs font-medium text-slate-500">
                {t("memoList.loadingMore")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controlled Right Click context menu for single note on Desktop using absolute placement */}
      {memoContextMenu && (
        <div style={{ position: "fixed", left: memoContextMenu.x, top: memoContextMenu.y, zIndex: 100 }}>
          <DropdownMenu open={true} onOpenChange={(open) => { if (!open) setMemoContextMenu(null); }}>
            <DropdownMenuTrigger asChild>
              <span className="sr-only" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[calc(100dvh-1.5rem)] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto bg-white border border-slate-200 rounded-md py-1 shadow-md"
            >
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                onClick={() => {
                  const { memo } = memoContextMenu;
                  setMemoContextMenu(null);
                  onOpenMemo(memo.id);
                }}
              >
                <FileIcon className="h-4 w-4" />
                {t("memoList.openMemo")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                onClick={() => {
                  const { memo } = memoContextMenu;
                  setMemoContextMenu(null);
                  handleToggleMemo(memo.id);
                }}
              >
                <CheckSquare className="h-4 w-4" />
                {t("memoList.selectMemo")}
              </DropdownMenuItem>
              {view !== "trash" && (
                <DropdownMenuItem
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  disabled={isPinning}
                  onClick={() => {
                    const { memo } = memoContextMenu;
                    setMemoContextMenu(null);
                    onTogglePinMemo(memo);
                  }}
                >
                  <Star className={cn("h-4 w-4", memoContextMenu.memo.isPinned && "fill-current text-slate-700")} />
                  {memoContextMenu.memo.isPinned ? t("memoList.unpin") : t("memoList.pinMemo")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
              {view === "trash" ? (
                <>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    onClick={() => {
                      const { memo } = memoContextMenu;
                      setMemoContextMenu(null);
                      onRestoreMemo(memo.id);
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t("memoList.restoreMemo")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                    onClick={() => {
                      const { memo } = memoContextMenu;
                      setMemoContextMenu(null);
                      onDeleteMemo(memo.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("memoList.permanentDelete")}
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    disabled={moveNotebookOptions.length === 0}
                    onClick={() => setContextMoveOpen((value) => !value)}
                  >
                    <Folder className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{t("memoList.moveToNotebook")}</span>
                    <ChevronRight className={cn("h-4 w-4 transition-transform duration-200", contextMoveOpen && "rotate-90")} />
                  </DropdownMenuItem>
                  {contextMoveOpen && (
                    <div className="max-h-52 overflow-y-auto border-y border-slate-100 bg-slate-50/60 py-1">
                      {moveNotebookOptions.map((option: any) => (
                        <button
                          key={option.id}
                          className={cn(
                            "flex h-9 w-full items-center gap-2 px-3 text-left text-sm transition hover:bg-white",
                            option.id === memoContextMenu.memo.notebookId ? "font-semibold text-slate-950" : "text-slate-700"
                          )}
                          style={{ paddingLeft: `${12 + option.depth * 14}px` }}
                          type="button"
                          disabled={option.id === memoContextMenu.memo.notebookId}
                          onClick={() => {
                            const { memo } = memoContextMenu;
                            setContextMoveOpen(false);
                            setMemoContextMenu(null);
                            onMoveMemo(memo.id, option.id);
                          }}
                        >
                          <NotebookIcon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                    onClick={() => {
                      const { memo } = memoContextMenu;
                      setMemoContextMenu(null);
                      onDeleteMemo(memo.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("memoList.deleteMemo")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {selectionMode && (
        <MobileSelectionActionBar
          canDelete={selectedMemoIds.size > 0 && !isDeleting}
          canMove={selectedMemoIds.size > 0 && view !== "trash" && notebooks.length > 0 && !isMoving}
          deleteTitle={selectionDeleteTitle}
          isTrashView={view === "trash"}
          moveTitle={selectionMoveTitle}
          onDelete={onDeleteSelectedMemos}
          onOpenMore={() => setMobileMoreOpen(true)}
          onOpenMove={() => setMobileMoveOpen(true)}
        />
      )}

      {mobileListActionsOpen && (
        <Suspense fallback={null}>
          <MobileListActionsSheet
            canSelectMemos={canEnterSelectionMode}
            isSelectionMode={selectionMode}
            listDescription={listCountLabel}
            listDensity={listDensity}
            listTitle={listTitle}
            sortMode={sortMode}
            view={view}
            onClose={() => setMobileListActionsOpen(false)}
            onEmptyTrash={() => {
              setMobileListActionsOpen(false);
              onEmptyTrash();
            }}
            onEnterSelectionMode={() => {
              setMobileListActionsOpen(false);
              onEnterSelectionMode();
            }}
            onOpenAssets={() => {
              setMobileListActionsOpen(false);
              onOpenAssets();
            }}
            onOpenSettings={() => {
              setMobileListActionsOpen(false);
              onOpenSettings();
            }}
            onOpenTags={() => {
              setMobileListActionsOpen(false);
              onOpenTags();
            }}
            onOpenTrash={() => {
              setMobileListActionsOpen(false);
              onOpenTrash();
            }}
            onListDensityChange={(value) => {
              handleListDensityChange(value);
            }}
            onSortModeChange={(value) => {
              onSortModeChange(value);
            }}
          />
        </Suspense>
      )}

      {mobileMoveOpen && (
        <Suspense fallback={null}>
          <MobileMoveSheet
            isMoving={isMoving}
            notebooks={notebooks}
            selectedCount={selectedMemoIds.size}
            selectedNotebookId={moveTargetNotebookId}
            onClose={() => setMobileMoveOpen(false)}
            onMove={(notebookId) => {
              setMoveTargetNotebookId(notebookId);
              onMoveSelectedMemos(notebookId);
              setMobileMoveOpen(false);
            }}
          />
        </Suspense>
      )}

      {mobileMoreOpen && (
        <Suspense fallback={null}>
          <MobileSelectionMoreSheet
            canMerge={selectedMemoIds.size >= 2 && view !== "trash" && !isMerging}
            canPin={selectedMemoIds.size > 0 && view !== "trash" && !isPinning}
            canToggleVisibleSelection={canToggleVisibleMemoSelection}
            mergeTitle={selectionMergeTitle}
            pinLabel={selectionPinLabel}
            pinTitle={selectionPinTitle}
            selectedCount={selectedMemoIds.size}
            selectionToggleLabel={visibleSelectionToggleLabel}
            selectionToggleTitle={selectionToggleTitle}
            onToggleVisibleSelection={() => {
              setMobileMoreOpen(false);
              if (allVisibleMemosSelected) {
                handleClearVisibleMemos();
                return;
              }
              handleSelectAllVisibleMemos();
            }}
            onClearSelection={() => {
              setMobileMoreOpen(false);
              onClearSelection();
            }}
            onClose={() => setMobileMoreOpen(false)}
            onMerge={() => {
              setMobileMoreOpen(false);
              onMerge();
            }}
            onPin={() => {
              setMobileMoreOpen(false);
              onPinSelectedMemos(selectedPinTarget);
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

const NotebookIcon = ({ className }: { className?: string }) => (
  <svg
    className={cn("h-4 w-4", className)}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
    />
  </svg>
);
