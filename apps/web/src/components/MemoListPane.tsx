import {
  lazy,
  Suspense,
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  type MouseEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import {
  X,
  ChevronLeft,
  ChevronDown,
  Search,
  MoreHorizontal,
  Tag,
  Paperclip,
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
  Image as ImageIcon,
  Share2,
  FileDown,
  FileCode2,
  FileUp,
  Printer,
  Pencil,
  Copy,
} from "lucide-react";
import { WeChatIcon } from "./WeChatIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { MemoCard } from "./MemoCard";
import { ClipboardCopyNotice } from "./ClipboardCopyNotice";
import { WeChatCopyProgress } from "./WeChatCopyProgress";
import { cn } from "@/lib/utils";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import type { Notebook, MemoSummary } from "@edgeever/shared";
import { toggleMobileMemoFilterMode } from "@edgeever/shared/mobile-ui";
import type {
  MemoFilterMode,
  MemoSortMode,
  MemoListDensity,
  MemoContextMenuState,
  MemoDocumentAction,
  MemoWeChatCopyResult,
  NotebookMoveOption,
} from "@/lib/app-helpers";
import { contentEnterMotion, paneEnterMotion } from "@/lib/motion";
import type { SyncQueueSummary } from "@/lib/sync-queue";
import { api } from "@/lib/api";
import { isLocalMemoId } from "@/lib/local-mirror";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  getMemoFilterOptions,
  getMemoSortOptions,
  getNotebookMoveOptions,
  resolveSelectionMoveTargetNotebookId,
  readMemoListDensityPreference,
  writeMemoListDensityPreference,
} from "@/lib/app-helpers";
import {
  estimateMemoListItemSize,
  MEMO_LIST_MOBILE_ITEM_GAP_PX,
  MEMO_LIST_VIRTUAL_OVERSCAN,
} from "@/lib/memo-list-virtual";

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
  canMove,
  deleteTitle,
  exportTitle,
  isDeleting,
  isExporting,
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
  onExport,
  onMerge,
  onMove,
  onPin,
  pinLabel,
  pinTarget,
  pinTitle,
  selectedCount,
  onMoveTargetChange,
}: {
  canMove: boolean;
  deleteTitle: string;
  exportTitle: string;
  isDeleting: boolean;
  isExporting: boolean;
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
  onExport: () => void;
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
  const selectedMoveNotebookName = moveNotebookOptions.find((item) => item.id === moveTargetNotebookId)?.name;

  return (
    <div
      className="hidden h-full min-h-0 flex-1 items-start justify-start bg-card px-6 py-6 lg:flex lg:px-8 lg:py-8 xl:px-10"
      data-memo-selection-action-bar
    >
      <m.div className="w-72 overflow-hidden rounded-md border border-slate-200 bg-card py-1 shadow-lg" {...paneEnterMotion}>
        <div className="flex h-9 items-center gap-2 px-3 text-xs font-semibold text-slate-400">
          <CheckSquare className="h-4 w-4" />
          {getSelectionCountLabel(selectedCount, t)}
        </div>
        {!isTrashView && moveNotebookOptions.length > 0 && (
          <div className="border-t border-slate-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <Select value={moveTargetNotebookId} disabled={isMoving} onValueChange={onMoveTargetChange}>
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs text-slate-700 border-slate-200">
                  <SelectValue placeholder={t("memoList.chooseNotebook")}>{selectedMoveNotebookName}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-60 bg-card border border-slate-200 rounded-md py-1 shadow-md">
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
                disabled={selectedCount === 0 || !moveTargetNotebookId || isMoving || isTrashView || !canMove}
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
          <Star className={cn("h-4 w-4", !pinTarget && "fill-amber-400 text-amber-500")} />
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
        <Button
          className="h-11 w-full justify-start rounded-none px-3 text-slate-700 hover:bg-slate-50"
          variant="ghost"
          title={exportTitle}
          onClick={onExport}
          disabled={selectedCount === 0 || isExporting || isTrashView}
        >
          <FileDown className="h-4 w-4" />
          {t("workspace.selection.export")}
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
      </m.div>
    </div>
  );
};

const getMobileFilterIcon = (filterMode: MemoFilterMode) => {
  if (filterMode === "tagged") {
    return <Tag className="h-4 w-4" />;
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-card/95 px-8 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
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
  selectedTag,
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
  isExporting,
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
  onPrefetchMemo,
  onDeleteMemo,
  onRestoreMemo,
  onTogglePinMemo,
  onMoveMemo,
  onRequestDocumentAction,
  onCopyMemoToWeChat,
  onMoveSelectedMemos,
  onPinSelectedMemos,
  onExportSelectedMemos,
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
  onClearTag,
  onOpenSettings,
  onSyncMemos,
  onCreateMemo,
  onImportMarkdownFiles,
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
  selectedTag: string | null;
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
  isExporting: boolean;
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
  onPrefetchMemo?: (memoId: string) => void;
  onDeleteMemo: (memoId: string) => void;
  onRestoreMemo: (memoId: string) => void;
  onTogglePinMemo: (memo: MemoSummary) => void;
  onMoveMemo: (memoId: string, notebookId: string) => void;
  onRequestDocumentAction: (memoId: string, action: MemoDocumentAction, printWindow?: Window | null) => void;
  onCopyMemoToWeChat: (memoId: string) => Promise<MemoWeChatCopyResult>;
  onMoveSelectedMemos: (notebookId: string) => void;
  onPinSelectedMemos: (pinned: boolean) => void;
  onExportSelectedMemos: () => void;
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
  onClearTag: () => void;
  onOpenSettings: () => void;
  onSyncMemos: () => void;
  onCreateMemo: () => void;
  onImportMarkdownFiles: (files: File[]) => void;
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
  const [listDensity, setListDensity] = useState<MemoListDensity>(() => readMemoListDensityPreference());
  const [lastSelectedMemoId, setLastSelectedMemoId] = useState<string | null>(null);
  const [moveTargetNotebookId, setMoveTargetNotebookId] = useState("");
  const [memoIdCopyNotice, setMemoIdCopyNotice] = useState<{ status: "copied" | "error"; id: string } | null>(null);
  const [wechatCopyNotice, setWechatCopyNotice] = useState<"copied" | "error" | null>(null);
  const [wechatCopyPending, setWechatCopyPending] = useState(false);
  const wechatCopyPendingRef = useRef(false);
  const wechatCopyNoticeTimerRef = useRef<number | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);

  const filterOptions = useMemo(() => getMemoFilterOptions(t), [t]);
  const memoSortOptions = useMemo(() => getMemoSortOptions(t), [t]);
  const mobileFilterOptions = useMemo(() => filterOptions.filter((option: any) => option.value !== "all"), [filterOptions]);
  const visibleMemoIds = useMemo(() => memos.map((memo) => memo.id), [memos]);
  const moveNotebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const selectedMemosInList = useMemo(() => memos.filter((memo) => selectedMemoIds.has(memo.id)), [memos, selectedMemoIds]);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const listRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    if (wechatCopyNoticeTimerRef.current !== null) {
      window.clearTimeout(wechatCopyNoticeTimerRef.current);
    }
  }, []);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [listScrollElement, setListScrollElement] = useState<HTMLDivElement | null>(null);
  const [isDesktopList, setIsDesktopList] = useState(isDesktopViewport);
  const moveTargetSelectRef = useRef<HTMLSelectElement | null>(null);
  const previousSelectionModeRef = useRef(selectionMode);
  const skipSelectedMemoAutoScrollRef = useRef(false);
  const setListScrollNode = useCallback((node: HTMLDivElement | null) => {
    listScrollRef.current = node;
    setListScrollElement(node);
  }, []);
  const memoListVirtualizer = useVirtualizer({
    count: memos.length,
    getScrollElement: () => listScrollElement,
    estimateSize: () => estimateMemoListItemSize(listDensity, isDesktopList),
    overscan: MEMO_LIST_VIRTUAL_OVERSCAN,
    gap: isDesktopList ? 0 : MEMO_LIST_MOBILE_ITEM_GAP_PX,
    getItemKey: (index) => memos[index]?.id ?? index,
  });

  const canEnterSelectionMode = visibleMemoIds.length > 0;
  const selectedVisibleMemoCount = visibleMemoIds.filter((memoId) => selectedMemoIds.has(memoId)).length;
  const allVisibleMemosSelected = visibleMemoIds.length > 0 && selectedVisibleMemoCount === visibleMemoIds.length;
  const canToggleVisibleMemoSelection = visibleMemoIds.length > 0;
  const visibleSelectionToggleLabel = allVisibleMemosSelected ? t("memoList.selectedListNone") : t("memoList.selectedListAll");

  const listTitle = view === "trash" ? t("memoList.trash") : selectedTag ? `#${selectedTag}` : notebook?.name ?? t("memoList.allMemos");
  const listContextLabel = view === "trash" ? t("memoList.deletedMemos") : selectedTag ? t("memoList.tagFilter") : notebook ? t("memoList.currentNotebook") : t("memoList.allNotebooks");
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
  const selectionExportTitle =
    selectedMemoIds.size === 0
      ? t("workspace.selection.chooseMemo")
      : view === "trash"
        ? t("workspace.selection.trashCannotExport")
        : isExporting
          ? t("workspace.selection.exporting")
          : t("workspace.selection.exportHint");
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
  const searchActive = Boolean(search.trim());
  const hasListConstraint = searchActive || filterMode !== "all" || Boolean(selectedTag);
  const activeFilterLabel = filterOptions.find((option) => option.value === filterMode)?.label ?? t("options.memoFilter.all");
  const activeSortLabel = memoSortOptions.find((option) => option.value === sortMode)?.label ?? t("options.memoSort.updatedDesc");
  const syncMemosTitle = !canSyncMemos
    ? t("memoList.manualSyncOffline")
    : isSyncingMemos
      ? t("memoList.manualSyncing")
      : t("memoList.manualSync");

  const hasFileDrag = (event: ReactDragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleFileDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!canCreateMemo || view === "trash" || !hasFileDrag(event)) return;
    event.preventDefault();
    setFileDragActive(true);
  };

  const handleFileDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!canCreateMemo || view === "trash" || !hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!fileDragActive) setFileDragActive(true);
  };

  const handleFileDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setFileDragActive(false);
  };

  const handleFileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!canCreateMemo || view === "trash" || !hasFileDrag(event)) return;
    event.preventDefault();
    setFileDragActive(false);
    onImportMarkdownFiles(Array.from(event.dataTransfer.files));
  };

  const requestContextDocumentAction = (action: MemoDocumentAction) => {
    if (!memoContextMenu) {
      return;
    }

    const { memo } = memoContextMenu;
    const printWindow = action === "export-pdf" ? window.open("about:blank", "_blank") : undefined;
    setMemoContextMenu(null);
    onRequestDocumentAction(memo.id, action, printWindow);
  };

  const handleCopyContextMemoId = async () => {
    const memo = memoContextMenu?.memo;
    if (!memo || isLocalMemoId(memo.id)) return;
    setMemoContextMenu(null);
    const copied = await copyTextToClipboard(memo.id);
    setMemoIdCopyNotice({ status: copied ? "copied" : "error", id: memo.id });
    window.setTimeout(() => setMemoIdCopyNotice(null), copied ? 2200 : 3000);
  };

  const handleCopyContextMemoToWeChat = async () => {
    const memo = memoContextMenu?.memo;
    if (!memo || memo.diagramKind || memo.structuredTable || memo.infographic || memo.poster || wechatCopyPendingRef.current) return;
    setMemoContextMenu(null);
    wechatCopyPendingRef.current = true;
    if (wechatCopyNoticeTimerRef.current !== null) {
      window.clearTimeout(wechatCopyNoticeTimerRef.current);
    }
    setWechatCopyNotice(null);
    setWechatCopyPending(true);
    try {
      const result = await onCopyMemoToWeChat(memo.id);
      if (result === "editor") return;
      setWechatCopyNotice(result);
      wechatCopyNoticeTimerRef.current = window.setTimeout(() => setWechatCopyNotice(null), result === "copied" ? 2200 : 2600);
    } catch {
      setWechatCopyNotice("error");
      wechatCopyNoticeTimerRef.current = window.setTimeout(() => setWechatCopyNotice(null), 2600);
    } finally {
      wechatCopyPendingRef.current = false;
      setWechatCopyPending(false);
    }
  };

  useEffect(() => {
    const nextTargetId = resolveSelectionMoveTargetNotebookId(
      moveTargetNotebookId,
      moveNotebookOptions.map((option) => option.id),
      notebook?.id
    );

    if (nextTargetId !== moveTargetNotebookId) {
      setMoveTargetNotebookId(nextTargetId);
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
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktopList(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    memoListVirtualizer.measure();
  }, [isDesktopList, listDensity, memoListVirtualizer]);

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

    const selectedIndex = visibleMemoIds.indexOf(selectedMemoId);
    if (selectedIndex < 0) {
      return;
    }

    memoListVirtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [memoListVirtualizer, selectedMemoId, visibleMemoIds]);

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

    const focusIndex = visibleMemoIds.indexOf(memoIdToFocus);
    if (focusIndex >= 0) {
      memoListVirtualizer.scrollToIndex(focusIndex, { align: "auto" });
    }

    window.setTimeout(() => {
      const scrollContainer = listScrollRef.current;
      if (!scrollContainer) {
        return;
      }

      const escapedMemoId = CSS.escape(memoIdToFocus);
      const memoButton = scrollContainer.querySelector<HTMLButtonElement>(
        `[data-memo-id="${escapedMemoId}"] button`
      );
      memoButton?.focus({ preventScroll: true });
    }, 0);
  }, [lastSelectedMemoId, memoListVirtualizer, selectedMemoId, selectionMode, visibleMemoIds]);

  useEffect(() => {
    if (!selectionMode) {
      setMobileMoveOpen(false);
      setMobileMoreOpen(false);
      return;
    }

    setDesktopActionsOpen(false);
    setDesktopFilterOpen(false);
    setDesktopSortOpen(false);
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
    const menuHeight = view === "trash" ? 216 : 392;
    const x = Math.min(clientX, Math.max(12, window.innerWidth - menuWidth - 12));
    const y = Math.min(clientY, Math.max(12, window.innerHeight - menuHeight - 12));

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
    setMemoContextMenu(null);
  };

  const handleOpenSelectionKeyboardContextMenu = (memo: MemoSummary, target: HTMLElement) => {
    if (!isDesktopViewport()) {
      return;
    }

    if (!selectedMemoIds.has(memo.id)) {
      handleToggleMemo(memo.id);
    }

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
    if (selectedTag) onClearTag();
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
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {fileDragActive && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-400 bg-slate-50/95 p-6 text-center shadow-lg backdrop-blur-sm">
          <div>
            <FileUp className="mx-auto h-8 w-8 text-slate-700" />
            <div className="mt-3 text-sm font-semibold text-slate-950">{t("memoList.dropMarkdownTitle")}</div>
            <div className="mt-1 text-xs text-slate-600">{t("memoList.dropMarkdownDescription")}</div>
          </div>
        </div>
      )}
      <header className="border-b border-slate-200 bg-slate-50 px-4 pb-2 pt-[max(0.375rem,env(safe-area-inset-bottom))] lg:bg-transparent lg:py-3 lg:pt-3">
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
            <div
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border px-3 text-sm text-slate-500 transition-colors",
                searchActive
                  ? "bg-[color-mix(in_srgb,var(--workspace-sidebar)_78%,var(--workspace-memo-list))] text-slate-700"
                  : "bg-[color-mix(in_srgb,var(--workspace-sidebar)_62%,var(--workspace-memo-list))]",
                searchFocused || searchActive ? "border-[var(--workspace-divider)]" : "border-transparent",
              )}
            >
              <Search className="h-4 w-4 shrink-0" />
              <input
                ref={mobileSearchInputRef}
                type="text"
                role="searchbox"
                value={search}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                enterKeyHint="search"
                spellCheck={false}
                onChange={(event) => handleSearchChange(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
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
              {(view === "trash" || selectedTag) && (
                <button
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  type="button"
                  title={t("notebookPane.backToList")}
                  aria-label={t("notebookPane.backToList")}
                  onClick={view === "trash" ? onBackFromTrash : onClearTag}
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
          {(view === "trash" || selectedTag) && (
            <Button
              className="-ml-2 mt-0.5 shrink-0"
              size="icon"
              variant="ghost"
              title={t("notebookPane.backToList")}
              aria-label={t("notebookPane.backToList")}
              onClick={view === "trash" ? onBackFromTrash : onClearTag}
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

        <div className={cn("items-center gap-2", mobileSearchActive ? "hidden lg:flex" : "flex")}>
          <div
            className={cn(
              "flex h-mobile-control min-w-0 flex-1 items-center gap-2 rounded-full border px-3 text-sm text-slate-500 transition-colors lg:rounded-md",
              searchActive
                ? "bg-[color-mix(in_srgb,var(--workspace-sidebar)_78%,var(--workspace-memo-list))] text-slate-700"
                : "bg-[color-mix(in_srgb,var(--workspace-sidebar)_62%,var(--workspace-memo-list))] hover:bg-[color-mix(in_srgb,var(--workspace-sidebar)_72%,var(--workspace-memo-list))]",
              searchFocused || searchActive ? "border-[var(--workspace-divider)]" : "border-transparent"
            )}
          >
            <Search className="h-4 w-4 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              role="searchbox"
              value={search}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="search"
              spellCheck={false}
              onChange={(event) => handleSearchChange(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
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
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-card hover:text-slate-700"
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="hidden lg:inline-flex"
                size="icon"
                variant="ghost"
                title={t("memoList.more")}
                aria-label={t("memoList.moreActions")}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 border border-slate-200 bg-card py-1 shadow-md">
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                disabled={!canEnterSelectionMode}
                onClick={onEnterSelectionMode}
              >
                <CheckSquare className="h-4 w-4 text-slate-500" />
                {t("memoList.selectMemo")}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">{t("memoList.filterTitle", { label: activeFilterLabel })}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44 border border-slate-200 bg-card py-1 shadow-md">
                  {filterOptions.map((option: any) => (
                    <DropdownMenuItem
                      key={option.value}
                      className={cn(
                        "flex h-9 w-full items-center gap-2 px-3 text-left text-xs cursor-pointer outline-none",
                        filterMode === option.value ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50",
                      )}
                      onClick={() => handleFilterModeChange(option.value)}
                    >
                      {getMobileFilterIcon(option.value)}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">{t("memoList.sortTitle", { label: activeSortLabel })}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44 border border-slate-200 bg-card py-1 shadow-md">
                  {memoSortOptions.map((option: any) => (
                    <DropdownMenuItem
                      key={option.value}
                      className={cn(
                        "flex h-9 w-full items-center gap-2 px-3 text-left text-xs cursor-pointer outline-none",
                        sortMode === option.value ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50",
                      )}
                      onClick={() => onSortModeChange(option.value)}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">{listDensity === "compact" ? t("memoList.compactList") : t("memoList.previewList")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40 border border-slate-200 bg-card py-1 shadow-md">
                  <DropdownMenuItem
                    className={cn("text-xs", listDensity === "preview" && "bg-slate-100 text-slate-900")}
                    onClick={() => handleListDensityChange("preview")}
                  >
                    <LayoutList className="h-4 w-4 text-slate-500" />
                    {t("memoList.previewList")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn("text-xs", listDensity === "compact" && "bg-slate-100 text-slate-900")}
                    onClick={() => handleListDensityChange("compact")}
                  >
                    <List className="h-4 w-4 text-slate-500" />
                    {t("memoList.compactList")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                disabled={!canSyncMemos || isSyncingMemos}
                onClick={onSyncMemos}
              >
                <RefreshCw className={cn("h-4 w-4 text-slate-500", isSyncingMemos && "animate-spin")} />
                {syncMemosTitle}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                onClick={onOpenTags}
              >
                <Tag className="h-4 w-4 text-slate-500" />
                {t("memoList.tags")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                onClick={onOpenAssets}
              >
                <Paperclip className="h-4 w-4 text-slate-500" />
                {t("memoList.assets")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                onClick={view === "trash" ? onEmptyTrash : onOpenTrash}
              >
                <Trash2 className="h-4 w-4 text-rose-700" />
                {view === "trash" ? t("memoList.emptyTrash") : t("memoList.trash")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                onClick={onOpenSettings}
              >
                <KeyRound className="h-4 w-4 text-slate-500" />
                MCP Token
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {mobileFilterOptions.map((option: any) => (
              <button
                key={option.value}
                className={cn(
                  "flex h-mobile-control w-mobile-control items-center justify-center rounded-full border transition",
                  filterMode === option.value
                    ? "border-slate-700 bg-slate-700 text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)]"
                    : "border-slate-200 bg-card text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                )}
                type="button"
                title={filterMode === option.value ? t("memoList.toggleOffFilter", { label: option.label }) : option.label}
                aria-label={filterMode === option.value ? t("memoList.toggleOffFilter", { label: option.label }) : option.label}
                aria-pressed={filterMode === option.value}
                onClick={() => handleFilterModeChange(toggleMobileMemoFilterMode(filterMode, option.value))}
              >
                {getMobileFilterIcon(option.value)}
              </button>
            ))}
          </div>
        </div>

        {hasListConstraint && (
          <m.div
            className={cn(
              "mt-3 flex min-h-8 items-center gap-2 rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600",
            )}
            role="status"
            {...contentEnterMotion}
          >
            {searchActive && (
              <span className="flex shrink-0 items-center gap-1 font-medium text-slate-700">
                <Search className="h-3 w-3" />
                {t("memoList.searchActive")}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-medium">
              {searchActive
                ? t("memoList.searchResults", { count: totalMemoCount })
                : t("memoList.constrainedCount", {
                    label: selectedTag ? `#${selectedTag}` : t("memoList.filterConstraint", { label: activeFilterLabel }),
                    count: totalMemoCount,
                  })}
            </span>
            <button
              className={cn(
                "shrink-0 font-semibold transition",
                "text-slate-600 hover:text-slate-950"
              )}
              type="button"
              onClick={searchActive ? handleClearSearch : handleResetListConstraints}
            >
              {searchActive ? t("memoList.cancelSearch") : t("memoList.reset")}
            </button>
          </m.div>
        )}
      </header>

      <div
        ref={setListScrollNode}
        className="relative min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:px-2 lg:py-2 lg:pb-3 lg:[scrollbar-gutter:stable_both-edges]"
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
          <div className="rounded-md border border-dashed border-slate-300 bg-card px-4 py-9 text-center">
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
              <Button className="mt-4 justify-center" size="sm" variant="solid" onClick={() => onCreateMemo()} disabled={isCreating}>
                <FilePlus2 className="h-4 w-4" />
                {t("memoList.newMemo")}
              </Button>
            )}
          </div>
        ) : (
          <div className="lg:overflow-hidden">
            <div className="relative w-full" style={{ height: `${memoListVirtualizer.getTotalSize()}px` }}>
              {memoListVirtualizer.getVirtualItems().map((virtualRow) => {
                const memo = memos[virtualRow.index];
                if (!memo) {
                  return null;
                }

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={(element) => memoListVirtualizer.measureElement(element)}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <MemoCard
                      memo={memo}
                      selected={memo.id === selectedMemoId}
                      checked={selectedMemoIds.has(memo.id)}
                      dragMemoIds={selectedMemoIds.has(memo.id) ? Array.from(selectedMemoIds) : [memo.id]}
                      isLast={virtualRow.index === memos.length - 1}
                      isTrashView={view === "trash"}
                      selectionMode={selectionMode}
                      listDensity={listDensity}
                      sortMode={view === "trash" ? "updated-desc" : sortMode}
                      multiSelectKeyDown={multiSelectKeyDown}
                      onOpen={() => onOpenMemo(memo.id)}
                      onPrefetch={onPrefetchMemo ? () => onPrefetchMemo(memo.id) : undefined}
                      onRestore={() => onRestoreMemo(memo.id)}
                      onDelete={() => onDeleteMemo(memo.id)}
                      onOpenContextMenu={(event) => handleOpenMemoContextMenu(memo, event)}
                      onOpenSelectionContextMenu={(event) => handleOpenSelectionContextMenu(memo, event)}
                      onOpenSelectionKeyboardContextMenu={(target) => handleOpenSelectionKeyboardContextMenu(memo, target)}
                      onOpenKeyboardContextMenu={(target) => handleOpenMemoKeyboardContextMenu(memo, target)}
                      onToggle={(event) => handleToggleMemo(memo.id, event)}
                    />
                  </div>
                );
              })}
            </div>
            {isLoadingMoreMemos && (
              <div className="mt-4 border-t border-slate-100 px-4 py-3 text-center text-xs font-medium text-slate-500 lg:mt-0">
                {t("memoList.loadingMore")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keep the virtual trigger in the document viewport so fixed coordinates
          are not offset by the memo pane's backdrop-filter containing block. */}
      {memoContextMenu && typeof document !== "undefined" ? createPortal(
        <div style={{ position: "fixed", left: memoContextMenu.x, top: memoContextMenu.y, zIndex: 100 }}>
          <DropdownMenu modal={false} open={true} onOpenChange={(open) => { if (!open) setMemoContextMenu(null); }}>
            <DropdownMenuTrigger asChild>
              <span className="sr-only" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => event.preventDefault()}
              className="max-h-[calc(100dvh-1.5rem)] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto bg-card border border-slate-200 rounded-md py-1 shadow-md duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
              data-memo-actions-menu
            >
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
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
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
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
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                  disabled={isPinning}
                  onClick={() => {
                    const { memo } = memoContextMenu;
                    setMemoContextMenu(null);
                    onTogglePinMemo(memo);
                  }}
                >
                  <Star className={cn("h-4 w-4", memoContextMenu.memo.isPinned && "fill-amber-400 text-amber-500")} />
                  {memoContextMenu.memo.isPinned ? t("memoList.unpin") : t("memoList.pinMemo")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                disabled={isLocalMemoId(memoContextMenu.memo.id)}
                onClick={() => void handleCopyContextMemoId()}
              >
                <Copy className="h-4 w-4 text-slate-500" />
                {t(isLocalMemoId(memoContextMenu.memo.id) ? "editor.copyNoteIdAfterSync" : "editor.copyNoteId")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
              {view === "trash" ? (
                <>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
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
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
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
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                      disabled={moveNotebookOptions.length === 0}
                    >
                      <Folder className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate">{t("memoList.moveToNotebook")}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-64 w-56 overflow-y-auto">
                      {moveNotebookOptions.map((option) => (
                        <DropdownMenuItem
                          key={option.id}
                          className={cn(
                            "flex h-9 items-center gap-2 px-3 text-xs",
                            option.id === memoContextMenu.memo.notebookId ? "font-semibold text-slate-950" : "text-slate-700"
                          )}
                          style={{ paddingLeft: `${12 + option.depth * 14}px` }}
                          disabled={option.id === memoContextMenu.memo.notebookId}
                          onSelect={() => {
                            const { memo } = memoContextMenu;
                            setMemoContextMenu(null);
                            onMoveMemo(memo.id, option.id);
                          }}
                        >
                          <NotebookIcon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    disabled={isLocalMemoId(memoContextMenu.memo.id)}
                    onClick={() => requestContextDocumentAction("share")}
                  >
                    <Share2 className="h-4 w-4 text-slate-500" />
                    {t(isLocalMemoId(memoContextMenu.memo.id) ? "sharing.afterSync" : "sharing.action")}
                  </DropdownMenuItem>
                  {!memoContextMenu.memo.diagramKind && !memoContextMenu.memo.structuredTable && !memoContextMenu.memo.infographic && !memoContextMenu.memo.poster && (
                    <DropdownMenuItem
                      className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                      onClick={() => void handleCopyContextMemoToWeChat()}
                    >
                      <WeChatIcon className="h-4 w-4 text-slate-500" />
                      {t("editor.copyToWeChat")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    onClick={() => requestContextDocumentAction("export-markdown")}
                  >
                    <FileDown className="h-4 w-4 text-slate-500" />
                    {t("editor.exportMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    onClick={() => requestContextDocumentAction("export-html")}
                  >
                    <FileCode2 className="h-4 w-4 text-slate-500" />
                    {t("editor.exportHtml")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    onClick={() => requestContextDocumentAction("export-pdf")}
                  >
                    <Printer className="h-4 w-4 text-slate-500" />
                    {t("editor.exportPdf")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    onClick={() => requestContextDocumentAction("share-image")}
                  >
                    <ImageIcon className="h-4 w-4 text-slate-500" />
                    {t("editor.imageShare.action")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
                    onClick={() => requestContextDocumentAction("save-as-template")}
                  >
                    <Pencil className="h-4 w-4 text-slate-500" />
                    {t("templates.saveAsTemplate")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
                  <DropdownMenuItem
                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
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
        </div>,
        document.body
      ) : null}

      {memoIdCopyNotice && (
        <ClipboardCopyNotice status={memoIdCopyNotice.status}>
          {t(memoIdCopyNotice.status === "copied" ? "editor.noteIdCopied" : "editor.noteIdCopyFailed", { id: memoIdCopyNotice.id })}
        </ClipboardCopyNotice>
      )}

      {wechatCopyPending && <WeChatCopyProgress />}

      {wechatCopyNotice && (
        <ClipboardCopyNotice status={wechatCopyNotice}>
          {t(wechatCopyNotice === "copied" ? "editor.copiedToWeChat" : "editor.copyToWeChatFailed")}
        </ClipboardCopyNotice>
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
            canExport={selectedMemoIds.size > 0 && view !== "trash" && !isExporting}
            canMerge={selectedMemoIds.size >= 2 && view !== "trash" && !isMerging}
            canPin={selectedMemoIds.size > 0 && view !== "trash" && !isPinning}
            canToggleVisibleSelection={canToggleVisibleMemoSelection}
            exportTitle={selectionExportTitle}
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
            onExport={() => {
              setMobileMoreOpen(false);
              onExportSelectedMemos();
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
