import { useRef, useState, useEffect, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Component, GitFork, PieChart, Table2, Workflow, Star, Check, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { getMemoListTimestamp, type MemoSummary } from "@edgeever/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MemoListDensity, MemoSortMode } from "@/lib/app-helpers";
import { isDefaultMemoTitle, MEMO_DRAG_MIME, setMemoDragPreview } from "@/lib/app-helpers";

const MEMO_LONG_PRESS_DELAY_MS = 520;
const MEMO_LONG_PRESS_MOVE_TOLERANCE_PX = 14;

const isDesktopViewport = () => window.matchMedia("(min-width: 1024px)").matches;

const formatMemoPreviewDate = (value: string, locale: string, yesterdayLabel: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const memoDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (memoDay === today) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  if (memoDay === today - 24 * 60 * 60 * 1000) {
    return yesterdayLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
};

export const MemoCard = ({
  memo,
  selected,
  checked,
  dragMemoIds,
  isLast = false,
  isTrashView,
  selectionMode,
  listDensity,
  sortMode,
  multiSelectKeyDown,
  onOpen,
  onPrefetch,
  onRestore,
  onDelete,
  onOpenContextMenu,
  onOpenSelectionContextMenu,
  onOpenSelectionKeyboardContextMenu,
  onOpenKeyboardContextMenu,
  onToggle,
}: {
  memo: MemoSummary;
  selected: boolean;
  checked: boolean;
  dragMemoIds: string[];
  isLast?: boolean;
  isTrashView: boolean;
  selectionMode: boolean;
  listDensity: MemoListDensity;
  sortMode: MemoSortMode;
  multiSelectKeyDown: boolean;
  onOpen: () => void;
  onPrefetch?: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onOpenSelectionContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onOpenSelectionKeyboardContextMenu: (target: HTMLElement) => void;
  onOpenKeyboardContextMenu: (target: HTMLElement) => void;
  onToggle: (event?: MouseEvent<HTMLElement>) => void;
}) => {
  const { t, i18n } = useTranslation();
  const handledModifierPointerRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressPointRef = useRef<{ x: number; y: number } | null>(null);
  const [modifierHoverActive, setModifierHoverActive] = useState(false);
  const memoTitle = memo.title?.trim() && !isDefaultMemoTitle(memo.title) ? memo.title.trim() : t("common.untitledMemo");
  const memoExcerpt = memo.excerpt.trim() || t("memoCard.emptyMemo");
  const diagramLabel = memo.diagramKind
    ? t(`diagram.${memo.diagramKind === "mind-map" ? "mindMap" : memo.diagramKind}`)
    : null;
  const tableLabel = !diagramLabel && memo.structuredTable ? t("structuredTable.name") : null;
  const DiagramIcon = memo.diagramKind === "mind-map" ? GitFork : memo.diagramKind === "architecture" ? Component : Workflow;
  const listTimestamp = getMemoListTimestamp(memo, sortMode);
  const listTimestampLabel = formatMemoPreviewDate(
    listTimestamp.value,
    i18n.resolvedLanguage ?? i18n.language,
    t("memoCard.yesterday"),
  );
  const showSelectionControl = selectionMode || checked || multiSelectKeyDown || modifierHoverActive;
  const selectionControlLabel = checked
    ? t("memoCard.unselect", { title: memoTitle })
    : t("memoCard.select", { title: memoTitle });

  const shouldToggleSelection = (event: MouseEvent<HTMLElement>) =>
    event.ctrlKey || event.metaKey || event.shiftKey || multiSelectKeyDown;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) {
      return;
    }

    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const resetLongPress = () => {
    clearLongPressTimer();
    longPressPointRef.current = null;
  };

  useEffect(() => () => resetLongPress(), []);

  useEffect(() => {
    if (!modifierHoverActive) {
      return;
    }

    const handleModifierKeyUp = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
        setModifierHoverActive(false);
      }
    };
    const handleWindowBlur = () => setModifierHoverActive(false);

    window.addEventListener("keyup", handleModifierKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keyup", handleModifierKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [modifierHoverActive]);

  const markModifierPointerHandled = () => {
    handledModifierPointerRef.current = true;
    window.setTimeout(() => {
      handledModifierPointerRef.current = false;
    }, 450);
  };

  const handleModifierToggle = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    markModifierPointerHandled();
    onToggle(event);
  };

  const handleLongPressSelection = () => {
    markModifierPointerHandled();

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(8);
    }

    onToggle();
  };

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (shouldToggleSelection(event)) {
      handleModifierToggle(event);
    }
  };

  const handleMouseMove = (event: MouseEvent<HTMLButtonElement>) => {
    const modifierActive = event.ctrlKey || event.metaKey || event.shiftKey;

    setModifierHoverActive((current) => (current === modifierActive ? current : modifierActive));
  };

  const handleMouseLeave = () => {
    setModifierHoverActive(false);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch") {
      onPrefetch?.();
      return;
    }

    if (selectionMode) {
      return;
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers may already release capture during gesture cancellation.
    }

    clearLongPressTimer();
    longPressPointRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressPointRef.current = null;
      handleLongPressSelection();
    }, MEMO_LONG_PRESS_DELAY_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch" || !longPressPointRef.current) {
      return;
    }

    const xDistance = Math.abs(event.clientX - longPressPointRef.current.x);
    const yDistance = Math.abs(event.clientY - longPressPointRef.current.y);

    if (xDistance > MEMO_LONG_PRESS_MOVE_TOLERANCE_PX || yDistance > MEMO_LONG_PRESS_MOVE_TOLERANCE_PX) {
      resetLongPress();
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Gesture cancellation can race with pointer capture release.
      }

      resetLongPress();
    }
  };

  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    if (isTrashView || !isDesktopViewport() || dragMemoIds.length === 0) {
      event.preventDefault();
      return;
    }

    const dragLabel = dragMemoIds.length > 1
      ? t("memoCard.dragMany", { count: dragMemoIds.length })
      : t("memoCard.dragOne", { title: memoTitle });

    resetLongPress();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(MEMO_DRAG_MIME, JSON.stringify(dragMemoIds));
    event.dataTransfer.setData("text/plain", dragLabel);
    setMemoDragPreview(event.dataTransfer, dragLabel);
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (handledModifierPointerRef.current) {
      event.preventDefault();
      event.stopPropagation();
      handledModifierPointerRef.current = false;
      return;
    }

    if (selectionMode) {
      event.preventDefault();
      event.stopPropagation();
      onToggle(event);
      return;
    }

    if (shouldToggleSelection(event)) {
      handleModifierToggle(event);
      return;
    }

    onOpen();
  };

  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (longPressPointRef.current) {
      event.preventDefault();
      event.stopPropagation();
      resetLongPress();
      handleLongPressSelection();
      return;
    }

    if (selectionMode) {
      event.preventDefault();
      event.stopPropagation();
      onOpenSelectionContextMenu(event);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (handledModifierPointerRef.current) {
      return;
    }

    if (shouldToggleSelection(event)) {
      markModifierPointerHandled();
      onToggle(event);
      return;
    }

    if (isDesktopViewport()) {
      onOpenContextMenu(event);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const opensContextMenu = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

    if (!opensContextMenu) {
      return;
    }

    if (selectionMode) {
      event.preventDefault();
      event.stopPropagation();
      onOpenSelectionKeyboardContextMenu(event.currentTarget);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpenKeyboardContextMenu(event.currentTarget);
  };

  return (
    <article
      data-memo-id={memo.id}
      draggable={!isTrashView}
      onDragStart={handleDragStart}
      className={cn(
        "edgeever-memo-divider group relative overflow-hidden border border-slate-100 bg-card transition lg:my-0.5 lg:rounded-lg lg:border lg:border-transparent lg:bg-transparent lg:shadow-none transition-all duration-200 select-none",
        isLast && "lg:border-b-transparent",
        listDensity === "compact" ? "rounded-md shadow-none" : "rounded-lg shadow-[0_4px_16px_rgba(15,23,42,0.045)] lg:shadow-none",
        !selectionMode && selected
          ? "edgeever-workspace-selection border-[var(--workspace-divider)] bg-workspace-selection lg:border-[var(--workspace-divider)] lg:bg-workspace-selection"
          : checked
            ? "bg-slate-50 ring-1 ring-slate-200 lg:border-[var(--workspace-divider)] lg:bg-[var(--workspace-selection)] lg:ring-0"
            : "active:bg-slate-50 lg:hover:bg-workspace-hover"
      )}
    >
      <div className={cn("flex min-h-[132px] items-center", listDensity === "compact" && "min-h-[84px] lg:min-h-[76px]")}>
        {showSelectionControl && (
          <Tooltip><TooltipTrigger asChild><button
            className="ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70 focus-visible:ring-offset-2 lg:ml-3 lg:h-6 lg:w-6"
            type="button"
            aria-label={selectionControlLabel}
            aria-pressed={checked}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(event);
            }}
          >
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border transition-all duration-150 lg:h-4 lg:w-4",
                checked
                  ? "border-slate-700 bg-slate-700 text-white shadow-[0_4px_10px_rgba(15,23,42,0.16)]"
                  : "border-slate-300 bg-card text-transparent"
              )}
              aria-hidden="true"
            >
              <Check className="h-3.5 w-3.5 stroke-[3] lg:h-2.5 lg:w-2.5" />
            </span>
          </button></TooltipTrigger><TooltipContent>{selectionControlLabel}</TooltipContent></Tooltip>
        )}
        <button
          className={cn(
            "min-w-0 flex-1 px-4 py-3.5 text-left touch-pan-y focus-visible:bg-slate-50 focus-visible:shadow-[inset_3px_0_0_rgb(148,163,184)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400/60 [-webkit-touch-callout:none] lg:py-3.5 transition-all duration-200",
            listDensity === "compact" && "py-2.5",
            showSelectionControl && "pl-3 lg:pl-3",
            !isTrashView && !multiSelectKeyDown && "lg:cursor-grab lg:active:cursor-grabbing",
            multiSelectKeyDown && "cursor-copy"
          )}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onPointerLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={resetLongPress}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
        >
          <div className={cn("mb-1.5 flex min-w-0 items-center gap-1.5 text-[14px] font-semibold tracking-[-0.012em] leading-snug text-slate-950", listDensity === "compact" && "mb-0.5")}>
            {memo.isPinned && <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" />}
            <span className="min-w-0 truncate">{memoTitle}</span>
          </div>
          {diagramLabel ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0 items-center text-slate-500">
                      <DiagramIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{diagramLabel}</TooltipContent>
                </Tooltip>
                {memo.diagramPreview ? (
                  <span>{t("diagram.listCounts", { nodes: memo.diagramPreview.nodeCount, edges: memo.diagramPreview.edgeCount })}</span>
                ) : (
                  <span>{diagramLabel}</span>
                )}
              </div>
              {listDensity !== "compact" && memo.diagramPreview?.labels.length ? (
                <div className="line-clamp-2 text-xs leading-relaxed text-slate-600">{memo.diagramPreview.labels.join(" · ")}</div>
              ) : null}
            </div>
          ) : memo.poster ? (
            <div className="flex items-center gap-1.5 text-xs text-slate-500"><FileText className="h-3.5 w-3.5" aria-hidden="true" /><span>{t("poster.name")}</span></div>
          ) : memo.infographic ? (
            <div className="flex items-center text-xs text-slate-500">
              <PieChart className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">{t("infographic.name")}</span>
            </div>
          ) : tableLabel ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0 items-center text-slate-500">
                      <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{tableLabel}</TooltipContent>
                </Tooltip>
                {memo.tablePreview ? (
                  <span>{t("structuredTable.listCounts", { records: memo.tablePreview.recordCount, fields: memo.tablePreview.fieldCount })}</span>
                ) : (
                  <span>{tableLabel}</span>
                )}
              </div>
              {listDensity !== "compact" && memo.tablePreview?.fieldNames.length ? (
                <div className="line-clamp-2 text-xs leading-relaxed text-slate-600">{memo.tablePreview.fieldNames.join(" · ")}</div>
              ) : null}
            </div>
          ) : (
            <div
              className={cn(
                "line-clamp-2 min-h-10 text-xs leading-relaxed text-slate-500",
                listDensity === "compact" && "line-clamp-1 min-h-0"
              )}
            >
              {memoExcerpt}
            </div>
          )}
          <div className={cn("mt-3.5 flex flex-wrap items-center gap-2", listDensity === "compact" && "mt-1.5")}>
            <time className="text-xs font-normal text-slate-500 " dateTime={listTimestamp.value}>
              {listTimestamp.field === "createdAt"
                ? t("memoCard.createdAt", { time: listTimestampLabel })
                : listTimestampLabel}
            </time>
            {memo.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs tracking-tight text-slate-400"
              >
                #{tag}
              </span>
            ))}
          </div>
        </button>
        {!selectionMode && (
          <div
            className={cn(
              "mr-2 mt-3 hidden shrink-0 flex-col gap-1 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100 lg:flex",
              listDensity === "compact" && "lg:mt-2"
            )}
          >
            <Tooltip><TooltipTrigger asChild><button
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70 focus-visible:ring-offset-2"
              type="button"
              aria-label={t("memoCard.moreActions")}
              aria-haspopup="menu"
              data-memo-actions-trigger
              onClick={(event) => {
                event.stopPropagation();
                onOpenKeyboardContextMenu(event.currentTarget);
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button></TooltipTrigger><TooltipContent>{t("memoCard.moreActions")}</TooltipContent></Tooltip>
            {isTrashView && (
              <Tooltip><TooltipTrigger asChild><button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70 focus-visible:ring-offset-2"
                type="button"
                aria-label={t("memoCard.restoreMemo")}
                onClick={(event) => {
                  event.stopPropagation();
                  onRestore();
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </button></TooltipTrigger><TooltipContent>{t("memoCard.restoreMemo")}</TooltipContent></Tooltip>
            )}
            <Tooltip><TooltipTrigger asChild><button
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70 focus-visible:ring-offset-2"
              type="button"
              aria-label={isTrashView ? t("memoCard.permanentDelete") : t("memoCard.deleteMemo")}
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button></TooltipTrigger><TooltipContent>{isTrashView ? t("memoCard.permanentDelete") : t("memoCard.deleteMemo")}</TooltipContent></Tooltip>
          </div>
        )}
      </div>
    </article>
  );
};
