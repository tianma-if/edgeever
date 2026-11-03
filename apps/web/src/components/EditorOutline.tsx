import { useCallback, useEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { buildOutlineTree, type OutlineItem, type OutlineTreeItem } from "@/lib/editor-outline";
import { mapCollapsedOutlinePositions, readOutlineSnapshot, restoreOutlinePositions, writeOutlineSnapshot, type OutlineSnapshot } from "@/lib/editor-outline-state";
import { cn } from "@/lib/utils";
import { EDITOR_OUTLINE_WIDTH } from "@/lib/workspace-ui";

type EditorOutlineProps = {
  editor: Editor | null;
  memoId: string;
  editingMemoIdRef: RefObject<string | null>;
  scrollContainer: HTMLDivElement | null;
  // Non-scrolling slot at the editor pane's top-right. The collapsed button
  // portals here so it stays put while the note scrolls.
  collapsedAnchor: HTMLElement | null;
  collapsed: boolean;
  shortcutLabel: string;
  onCollapsedChange: (collapsed: boolean) => void;
  contentRef?: Ref<HTMLElement>;
};

const OUTLINE_INDENT = 12;

const stripLeadingEmoji = (str: string): string => {
  const leadingEmojiRegex = /^(?:(?:[\u0030-\u0039#*]\uFE0F?\u20E3|\p{Extended_Pictographic}|[\u2460-\u24FF\u2600-\u27BF\u2B00-\u2BFF])[\uFE00-\uFE0F\u200D]*\s*)+/u;
  return str.replace(leadingEmojiRegex, "").trim() || str;
};

const getOutlineItems = (editor: Editor): OutlineItem[] => {
  const items: OutlineItem[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") {
      return;
    }

    const text = node.textContent.trim();
    // Keep empty headings in the identity snapshot: clearing a title before
    // retyping it must not discard its folding choice.
    items.push({ level: Number(node.attrs.level) || 1, pos, text });
  });

  return items;
};

const sameOutlineItems = (left: OutlineItem[], right: OutlineItem[]) =>
  left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other?.level === item.level && other.pos === item.pos && other.text === item.text;
  });

export const EditorOutline = ({ editor, memoId, editingMemoIdRef, scrollContainer, collapsedAnchor, collapsed, shortcutLabel, onCollapsedChange, contentRef }: EditorOutlineProps) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
  const [collapsedPositions, setCollapsedPositions] = useState<Set<number>>(() => new Set());
  const scrollTrackingPausedUntilRef = useRef(0);
  const tree = useMemo(() => buildOutlineTree(items), [items]);

  const snapshotRef = useRef<OutlineSnapshot>({ items: [], collapsed: [] });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      writeOutlineSnapshot(memoId, snapshotRef.current);
      saveTimerRef.current = null;
    }, 250);
  }, [memoId]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || editingMemoIdRef.current !== memoId) return;
    const initialItems = getOutlineItems(editor);
    const initialCollapsed = restoreOutlinePositions(readOutlineSnapshot(memoId), initialItems);
    snapshotRef.current = { items: initialItems, collapsed: [...initialCollapsed] };
    setItems(initialItems.filter((item) => item.text));
    setCollapsedPositions(initialCollapsed);

    const refresh = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || editingMemoIdRef.current !== memoId || editor.isDestroyed) return;
      const nextItems = getOutlineItems(editor);
      const previous = snapshotRef.current;
      // Draft hydration, source-mode edits and remote refreshes may replace the
      // entire document. Transaction positions cannot identify headings then.
      const replacesDocument = transaction.mapping.maps.some((map) => {
        let replaces = false;
        map.forEach((from, to) => { if (from === 0 && to >= transaction.before.content.size) replaces = true; });
        return replaces;
      });
      const nextCollapsed = replacesDocument
        ? restoreOutlinePositions(previous, nextItems)
        : mapCollapsedOutlinePositions(new Set(previous.collapsed), transaction.mapping, nextItems);
      snapshotRef.current = { items: nextItems, collapsed: [...nextCollapsed] };
      const visibleItems = nextItems.filter((item) => item.text);
      setItems((current) => sameOutlineItems(current, visibleItems) ? current : visibleItems);
      setCollapsedPositions(nextCollapsed);
      save();
    };
    const flush = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      writeOutlineSnapshot(memoId, snapshotRef.current);
    };
    editor.on("transaction", refresh);
    window.addEventListener("pagehide", flush);
    return () => {
      editor.off("transaction", refresh);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [editor, memoId, editingMemoIdRef, save]);

  const changeCollapsedPositions = (next: Set<number>) => {
    snapshotRef.current = { ...snapshotRef.current, collapsed: [...next] };
    setCollapsedPositions(next);
    writeOutlineSnapshot(memoId, snapshotRef.current);
  };

  const updateActiveItem = useCallback(() => {
    if (!editor || editor.isDestroyed || items.length === 0) {
      setActivePos(null);
      return;
    }

    const selectionPos = editor.state.selection.from;
    const activeItem = items.reduce<OutlineItem | null>((current, item) => (
      item.pos <= selectionPos ? item : current
    ), null);

    const nextActivePos = activeItem?.pos ?? items[0]?.pos ?? null;
    setActivePos((currentActivePos) => (currentActivePos === nextActivePos ? currentActivePos : nextActivePos));
  }, [editor, items]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.on("selectionUpdate", updateActiveItem);
    return () => {
      editor.off("selectionUpdate", updateActiveItem);
    };
  }, [editor, updateActiveItem]);

  useEffect(() => {
    updateActiveItem();
  }, [updateActiveItem]);

  useEffect(() => {
    if (!scrollContainer || items.length === 0) {
      return;
    }

    const updateFromScroll = () => {
      if (Date.now() < scrollTrackingPausedUntilRef.current) {
        return;
      }

      const threshold = scrollContainer.getBoundingClientRect().top + 96;
      let activeItem: OutlineItem | null = null;

      for (const item of items) {
        const element = editor?.view.nodeDOM(item.pos);
        if (element instanceof HTMLElement && element.getBoundingClientRect().top <= threshold) {
          activeItem = item;
        }
      }

      if (activeItem) {
        const nextActivePos = activeItem.pos;
        setActivePos((currentActivePos) => (currentActivePos === nextActivePos ? currentActivePos : nextActivePos));
      }
    };

    scrollContainer.addEventListener("scroll", updateFromScroll, { passive: true });
    updateFromScroll();
    return () => scrollContainer.removeEventListener("scroll", updateFromScroll);
  }, [editor, items, scrollContainer]);

  const jumpToHeading = (item: OutlineItem) => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    // Keep the clicked heading active while smooth scrolling. Without this
    // guard, intermediate scroll positions can briefly reactivate an earlier
    // heading and make two rows appear selected (active + hovered).
    scrollTrackingPausedUntilRef.current = Date.now() + 800;
    setActivePos(item.pos);

    let domElement: HTMLElement | null = null;
    const domNode = editor.view.nodeDOM(item.pos);
    if (domNode instanceof HTMLElement) {
      domElement = domNode;
    } else {
      try {
        const domAtPos = editor.view.domAtPos(item.pos);
        if (domAtPos.node instanceof HTMLElement) {
          domElement = domAtPos.node;
        } else if (domAtPos.node.parentElement instanceof HTMLElement) {
          domElement = domAtPos.node.parentElement;
        }
      } catch {
        // ignore DOM resolution error
      }
    }

    if (domElement) {
      domElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      const maxPos = editor.state.doc.content.size;
      const targetPos = Math.min(item.pos + 1, maxPos);
      editor.chain().focus().setTextSelection(targetPos).run();
    } catch {
      // ignore selection positioning error
    }
  };

  const toggleItem = (pos: number) => {
    const next = new Set(snapshotRef.current.collapsed);
    if (next.has(pos)) next.delete(pos);
    else next.add(pos);
    changeCollapsedPositions(next);
  };

  const parentPositions = useMemo(() => {
    const positions: number[] = [];
    const visit = (nodes: OutlineTreeItem[]) => nodes.forEach((node) => {
      if (node.children.length) positions.push(node.pos);
      visit(node.children);
    });
    visit(tree);
    return positions;
  }, [tree]);

  const renderItems = (treeItems: OutlineTreeItem[], depth = 0) => (
    <ol className={cn("space-y-0.5", depth > 0 && "py-0.5")}>
      {treeItems.map((item) => {
        const isActive = activePos === item.pos;
        const hasChildren = item.children.length > 0;
        const itemCollapsed = collapsedPositions.has(item.pos);
        const displayText = stripLeadingEmoji(item.text);
        const toggleLabel = t(itemCollapsed ? "editor.expandOutlineHeading" : "editor.collapseOutlineHeading", { name: item.text });

        return (
          <li key={item.pos}>
            <div
              className={cn(
                "relative group flex min-h-8 items-center rounded-[6px] pr-2 text-[12px] leading-5 transition-colors duration-150",
                isActive
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-700 hover:bg-slate-50/70 hover:text-slate-900"
              )}
              style={{ paddingLeft: depth * OUTLINE_INDENT }}
            >
              {hasChildren ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                      onClick={() => toggleItem(item.pos)}
                      aria-label={toggleLabel}
                      aria-expanded={!itemCollapsed}
                    >
                      {itemCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{toggleLabel}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="h-7 w-6 shrink-0" aria-hidden="true" />
              )}

              <button
                type="button"
                className="min-w-0 flex-1 truncate py-1 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                onClick={() => jumpToHeading(item)}
                aria-current={isActive ? "location" : undefined}
              >
                {displayText}
              </button>
            </div>

            {hasChildren && !itemCollapsed && (
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 border-l border-slate-200/90"
                  style={{ left: `calc(${depth * OUTLINE_INDENT}px + 0.75rem)` }}
                />
                {renderItems(item.children, depth + 1)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );

  if (items.length === 0) {
    return null;
  }

  const outlineToggleLabel = `${t(collapsed ? "editor.showOutline" : "editor.hideOutline")} (${shortcutLabel})`;

  const outline = (
    <TooltipProvider delayDuration={350} skipDelayDuration={100}>
      <aside
        className={cn(
          "select-none overflow-x-hidden",
          collapsed
            ? "pointer-events-auto absolute inset-0 overflow-hidden"
            : "sticky top-6 h-fit max-h-[calc(100vh-8rem)] shrink-0 overflow-y-auto pt-2 pb-16"
        )}
        style={!collapsed ? { width: EDITOR_OUTLINE_WIDTH } : undefined}
        aria-label={t("editor.outline")}
        data-editor-outline={collapsed ? "collapsed" : "expanded"}
      >
        <div className={cn("flex", collapsed ? "justify-center" : "mb-3 justify-between px-1")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "group flex items-center text-left text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                  collapsed ? "h-7 w-7 justify-center rounded-md hover:bg-slate-100" : "gap-1.5 rounded-sm"
                )}
                onClick={() => onCollapsedChange(!collapsed)}
                aria-expanded={!collapsed}
                aria-label={outlineToggleLabel}
              >
                {collapsed ? (
                  <ListTree className="h-4 w-4 text-slate-400 group-hover:text-slate-600" aria-hidden="true" />
                ) : (
                  <>
                    <span>{t("editor.outline")}</span>
                    <ChevronDown className="h-3 w-3 text-slate-400 transition-transform duration-200 group-hover:text-slate-600" aria-hidden="true" />
                  </>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{outlineToggleLabel}</TooltipContent>
          </Tooltip>
          {!collapsed && parentPositions.length > 0 && (
            <div className="flex shrink-0 items-center gap-0.5">
              {([
                ["editor.collapseAllOutline", ChevronsDownUp, true],
                ["editor.expandAllOutline", ChevronsUpDown, false],
              ] as const).map(([label, Icon, collapseAll]) => (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:opacity-40"
                      aria-label={t(label)}
                      disabled={collapseAll ? parentPositions.every((pos) => collapsedPositions.has(pos)) : collapsedPositions.size === 0}
                      onClick={() => changeCollapsedPositions(new Set(collapseAll ? parentPositions : []))}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t(label)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>

        {!collapsed && (
          <nav ref={contentRef} className="pr-2" aria-label={t("editor.outline")}>
            {renderItems(tree)}
          </nav>
        )}
      </aside>
    </TooltipProvider>
  );

  // Absolute inside the note scroller is tied to the document top, so the
  // button scrolls away. The anchor sits on the pane and does not scroll.
  if (collapsed) {
    return collapsedAnchor ? createPortal(outline, collapsedAnchor) : null;
  }

  return outline;
};
