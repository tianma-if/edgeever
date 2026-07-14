import { useState, useEffect, useRef, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Notebook as NotebookIcon, Plus, Pencil, Trash2 } from "lucide-react";
import type { NotebookNode, NotebookDropPosition } from "@/lib/app-helpers";
import {
  hasMemoDragData,
  hasNotebookDragData,
  getMemoDragIds,
  getNotebookDropPosition,
  notebookTreeContainsId,
  focusNotebookTreeButton,
  NOTEBOOK_DRAG_MIME,
  setMemoDragPreview,
} from "@/lib/app-helpers";
import { cn } from "@/lib/utils";
import type { Notebook } from "@edgeever/shared";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const NOTEBOOK_DRAG_EXPAND_DELAY_MS = 520;

export const NotebookTreeItem = ({
  node,
  depth,
  selectedNotebookId,
  onSelect,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onMoveNotebook,
  onMoveMemos,
  onDragScroll,
  expandSiblingsRequest,
  onExpandSiblings,
}: {
  node: NotebookNode;
  depth: number;
  selectedNotebookId: string | null;
  onSelect: (notebookId: string) => void;
  onCreateNotebook: (parentId?: string | null) => void;
  onRenameNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
  onMoveNotebook: (notebookId: string, targetNotebookId: string, position: NotebookDropPosition) => void;
  onMoveMemos: (memoIds: string[], targetNotebookId: string) => void;
  onDragScroll: (event: DragEvent<HTMLDivElement>) => void;
  expandSiblingsRequest: { parentId: string | null; token: number } | null;
  onExpandSiblings: (parentId: string | null) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const selected = node.id === selectedNotebookId;
  const isInbox = node.slug === "inbox";
  const hasSelectedDescendant = selectedNotebookId ? notebookTreeContainsId(node.children, selectedNotebookId) : false;
  const [dropPosition, setDropPosition] = useState<NotebookDropPosition | null>(null);
  const expandTimerRef = useRef<number | null>(null);

  const clearExpandTimer = () => {
    if (expandTimerRef.current === null) {
      return;
    }

    window.clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
  };

  useEffect(() => () => clearExpandTimer(), []);

  useEffect(() => {
    if (hasSelectedDescendant) {
      setOpen(true);
    }
  }, [hasSelectedDescendant]);

  useEffect(() => {
    if (!expandSiblingsRequest || expandSiblingsRequest.parentId !== node.parentId || !hasChildren) {
      return;
    }

    setOpen(true);
  }, [expandSiblingsRequest, hasChildren, node.parentId]);

  const scheduleDragExpand = (position: NotebookDropPosition) => {
    if (!hasChildren || open || position !== "inside") {
      clearExpandTimer();
      return;
    }

    if (expandTimerRef.current !== null) {
      return;
    }

    expandTimerRef.current = window.setTimeout(() => {
      expandTimerRef.current = null;
      setOpen(true);
    }, NOTEBOOK_DRAG_EXPAND_DELAY_MS);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    onDragScroll(event);

    if (hasMemoDragData(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropPosition("inside");
      scheduleDragExpand("inside");
      return;
    }

    if (!hasNotebookDragData(event.dataTransfer)) {
      return;
    }

    const position = getNotebookDropPosition(event);

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropPosition(position);
    scheduleDragExpand(position);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const memoIds = getMemoDragIds(event.dataTransfer);
    const notebookId = event.dataTransfer.getData(NOTEBOOK_DRAG_MIME);
    const position = getNotebookDropPosition(event);
    setDropPosition(null);
    clearExpandTimer();

    if (memoIds.length > 0) {
      onMoveMemos(memoIds, node.id);
      setOpen(true);
      return;
    }

    if (!notebookId || notebookId === node.id) {
      return;
    }

    onMoveNotebook(notebookId, node.id, position);
    setOpen(true);
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-notebook-id={node.id}
            className={cn(
              "group relative flex h-9 items-center gap-1 rounded-md px-2 text-sm lg:text-[13px] transition-all duration-200 select-none",
              selected
                ? "bg-slate-100 font-medium text-slate-950"
                : hasSelectedDescendant
                  ? "bg-slate-50 text-slate-900 hover:bg-slate-100"
                  : "text-slate-700 hover:bg-slate-50",
              dropPosition === "inside" && "ring-2 ring-slate-300",
              dropPosition === "inside" && hasChildren && !open && "bg-slate-100"
            )}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(NOTEBOOK_DRAG_MIME, node.id);
              event.dataTransfer.setData("text/plain", node.id);
              setMemoDragPreview(event.dataTransfer, t("notebookTree.dragNotebook", { name: node.name }));
            }}
            onDragOver={handleDragOver}
            onDragLeave={() => {
              setDropPosition(null);
              clearExpandTimer();
            }}
            onDragEnd={clearExpandTimer}
            onDrop={handleDrop}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            {hasChildren ? (
              <button
                className="flex h-6 w-5 items-center justify-center rounded hover:bg-slate-100/50 transition-colors"
                type="button"
                onClick={() => setOpen((value) => !value)}
                title={t("notebookTree.expandCollapse")}
                aria-label={open ? t("notebookTree.collapse", { name: node.name }) : t("notebookTree.expand", { name: node.name })}
                aria-expanded={open}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="h-6 w-5 shrink-0" aria-hidden="true" />
            )}
            <button
              data-notebook-tree-button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              type="button"
              aria-label={selected ? t("notebookTree.current", { name: node.name }) : t("notebookTree.switchTo", { name: node.name })}
              aria-current={selected ? "page" : undefined}
              aria-expanded={hasChildren ? open : undefined}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  event.stopPropagation();
                  focusNotebookTreeButton(
                    event.currentTarget,
                    event.key === "Home" ? "first" : event.key === "End" ? "last" : event.key === "ArrowDown" ? "next" : "previous"
                  );
                  return;
                }

                if (event.key === "*" || event.key === "Multiply") {
                  event.preventDefault();
                  event.stopPropagation();
                  onExpandSiblings(node.parentId);
                  return;
                }

                if (event.key === "ArrowRight" && hasChildren && !open) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(true);
                  return;
                }

                if (event.key === "ArrowLeft" && hasChildren && open) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  return;
                }
              }}
            >
              <NotebookIcon className={cn("h-4 w-4 shrink-0 transition-colors duration-200", selected || hasSelectedDescendant ? "text-slate-700" : "text-slate-500")} />
              <span
                className={cn(
                  "truncate font-medium transition-colors duration-200",
                  selected ? "text-slate-950" : hasSelectedDescendant ? "text-slate-900" : "text-slate-800 group-hover:text-slate-950"
                )}
              >
                {node.name}
              </span>
            </button>
            <button
              className={cn(
                "hidden h-6 w-6 items-center justify-center rounded-md group-focus-within:flex group-hover:flex transition-colors duration-150",
                selected ? "hover:bg-slate-200" : "hover:bg-slate-100"
              )}
              type="button"
              title={t("notebookTree.newChild")}
              aria-label={t("notebookTree.newChildAria", { name: node.name })}
              onClick={(event) => {
                event.stopPropagation();
                onCreateNotebook(node.id);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              className={cn(
                "hidden h-6 w-6 items-center justify-center rounded-md group-focus-within:flex group-hover:flex transition-colors duration-150",
                selected ? "hover:bg-slate-200" : "hover:bg-slate-100"
              )}
              type="button"
              title={t("notebookTree.renameNotebook")}
              aria-label={t("notebookTree.renameAria", { name: node.name })}
              onClick={(event) => {
                event.stopPropagation();
                onRenameNotebook(node);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!isInbox ? (
              <button
                className="hidden h-6 w-6 items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 group-focus-within:flex group-hover:flex transition-colors duration-150"
                type="button"
                title={t("notebookTree.deleteNotebook")}
                aria-label={t("notebookTree.deleteAria", { name: node.name })}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteNotebook(node);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {dropPosition === "before" && (
              <div className="absolute top-0 right-2 h-[3px] bg-slate-400 rounded-full z-30 animate-pulse" style={{ left: `${20 + depth * 14}px` }} />
            )}
            {dropPosition === "after" && (
              <div className="absolute bottom-0 right-2 h-[3px] bg-slate-400 rounded-full z-30 animate-pulse" style={{ left: `${20 + depth * 14}px` }} />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48 bg-white border border-slate-200 rounded-md py-1 shadow-md">
          <ContextMenuItem
            className="flex h-9 items-center gap-2 px-3 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
            onClick={() => onCreateNotebook(node.id)}
          >
            <Plus className="h-4 w-4" />
            {t("notebookTree.newChild")}
          </ContextMenuItem>
          <ContextMenuItem
            className="flex h-9 items-center gap-2 px-3 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
            onClick={() => onRenameNotebook(node)}
          >
            <Pencil className="h-4 w-4" />
            {t("notebookTree.rename")}
          </ContextMenuItem>
          {!isInbox && (
            <>
              <ContextMenuSeparator className="my-1 h-px bg-slate-100" />
              <ContextMenuItem
                className="flex h-9 items-center gap-2 px-3 text-sm text-rose-700 hover:bg-rose-50 cursor-pointer outline-none"
                onClick={() => onDeleteNotebook(node)}
              >
                <Trash2 className="h-4 w-4" />
                {t("notebookTree.deleteNotebook")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {hasChildren && open ? (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <NotebookTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNotebookId={selectedNotebookId}
              onSelect={onSelect}
              onCreateNotebook={onCreateNotebook}
              onRenameNotebook={onRenameNotebook}
              onDeleteNotebook={onDeleteNotebook}
              onMoveNotebook={onMoveNotebook}
              onMoveMemos={onMoveMemos}
              onDragScroll={onDragScroll}
              expandSiblingsRequest={expandSiblingsRequest}
              onExpandSiblings={onExpandSiblings}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
