import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
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

export const EditorOutline = ({ editor, scrollContainer }: EditorOutlineProps) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [activePos, setActivePos] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setItems([]);
      return;
    }

    setItems(getOutlineItems(editor));
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

    setActivePos(activeItem?.pos ?? items[0]?.pos ?? null);
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
        setActivePos(activeItem.pos);
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
      className="sticky top-6 h-fit max-h-[calc(100vh-8rem)] shrink-0 select-none overflow-y-auto py-2"
      style={{ width: EDITOR_OUTLINE_WIDTH }}
      aria-label={t("editor.outline")}
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="group flex items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-600"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          <span>{t("editor.outline")}</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 text-slate-400 transition-transform duration-200 group-hover:text-slate-600",
              collapsed && "-rotate-90"
            )}
            aria-hidden="true"
          />
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
