import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { EDITOR_OUTLINE_WIDTH } from "@/lib/workspace-ui";

type OutlineItem = {
  level: number;
  pos: number;
  text: string;
};

type EditorOutlineProps = {
  editor: Editor | null;
  scrollContainer: HTMLDivElement | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

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
    if (text) {
      items.push({
        level: Number(node.attrs.level) || 1,
        pos,
        text,
      });
    }
  });

  return items;
};

const sameOutlineItems = (left: OutlineItem[], right: OutlineItem[]) =>
  left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other?.level === item.level && other.pos === item.pos && other.text === item.text;
  });

export const EditorOutline = ({ editor, scrollContainer, collapsed, onCollapsedChange }: EditorOutlineProps) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setItems([]);
      return;
    }

    const nextItems = getOutlineItems(editor);
    setItems((currentItems) => (sameOutlineItems(currentItems, nextItems) ? currentItems : nextItems));
  }, [editor]);

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
    refresh();
    if (!editor) {
      return;
    }

    editor.on("update", refresh);
    editor.on("selectionUpdate", updateActiveItem);
    return () => {
      editor.off("update", refresh);
      editor.off("selectionUpdate", updateActiveItem);
    };
  }, [editor, refresh, updateActiveItem]);

  useEffect(() => {
    updateActiveItem();
  }, [updateActiveItem]);

  useEffect(() => {
    if (!scrollContainer || items.length === 0) {
      return;
    }

    const updateFromScroll = () => {
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

    setActivePos(item.pos);
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <aside
      className={cn(
        "select-none overflow-x-hidden",
        collapsed
          ? "absolute right-2 top-6 z-10 h-8 w-8 overflow-hidden"
          : "sticky top-6 h-fit max-h-[calc(100vh-8rem)] shrink-0 overflow-y-auto py-2"
      )}
      style={!collapsed ? { width: EDITOR_OUTLINE_WIDTH } : undefined}
      aria-label={t("editor.outline")}
    >
      <div className={cn("flex", collapsed ? "justify-center" : "mb-3 justify-between")}>
        <button
          type="button"
          className={cn(
            "group flex items-center text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-600",
            collapsed ? "h-7 w-7 justify-center rounded-md hover:bg-slate-100" : "gap-1.5"
          )}
          onClick={() => onCollapsedChange(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "editor.showOutline" : "editor.hideOutline")}
          title={t(collapsed ? "editor.showOutline" : "editor.hideOutline")}
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
      </div>

      {!collapsed && (
        <nav className="relative pl-3.5" aria-label={t("editor.outline")}>
          <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-slate-200/80" aria-hidden="true" />
          <ol className="space-y-1.5">
            {items.map((item) => {
              const isActive = activePos === item.pos;
              const displayText = stripLeadingEmoji(item.text);
              return (
                <li key={item.pos} className="relative flex items-center">
                  {isActive && (
                    <span
                      className="absolute left-0 top-0.5 bottom-0.5 w-[2px] -translate-x-[0.5px] rounded-full bg-sky-500 transition-all duration-200"
                      aria-hidden="true"
                    />
                  )}
                  <button
                    type="button"
                    className={cn(
                      "block w-full truncate text-left text-[13px] leading-snug transition-colors duration-150 py-0.5",
                      isActive
                        ? "font-medium text-slate-900"
                        : "text-slate-500 hover:text-slate-800"
                    )}
                    style={{ paddingLeft: `${Math.max(0, item.level - 1) * 12}px` }}
                    onClick={() => jumpToHeading(item)}
                    title={item.text}
                  >
                    {displayText}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
    </aside>
  );
};
