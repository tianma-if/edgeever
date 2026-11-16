import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { deriveChapterCardLabels, splitCoverTitle } from "@/lib/magazine-header";
import { formatNoteCoverTags } from "@/lib/note-cover-tags";

type SectionItem = {
  index: number;
  num: string;
  shortTitle: string;
  subTitle: string;
};

const formatYearMonth = (iso?: string) => {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "2026.11";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}.${month}`;
};

export const EditorMagazineHeader = ({
  editor,
  showMagazineCover,
  showChapterNavigation,
  title,
  tags = [],
  updatedAt,
  palette = "native",
}: {
  editor: Editor | null;
  showMagazineCover: boolean;
  showChapterNavigation: boolean;
  title?: string;
  tags?: string[];
  updatedAt?: string;
  palette?: string;
}) => {
  const isNative = !palette || palette === "native";
  const [sections, setSections] = useState<SectionItem[]>([]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setSections([]);
      return;
    }

    const sync = () => {
      if (editor.isDestroyed) return;
      const dom = editor.view.dom;
      const h2Elements = Array.from(dom.querySelectorAll<HTMLElement>("h2"));
      const nextSections = h2Elements.map((el, index) => ({
        index,
        ...deriveChapterCardLabels(el.textContent || "", index),
      }));
      setSections(nextSections);
    };

    sync();
    editor.on("update", sync);
    editor.on("create", sync);
    return () => {
      editor.off("update", sync);
      editor.off("create", sync);
    };
  }, [editor]);

  const { primary, highlight } = splitCoverTitle(title || "");
  const topTag = formatNoteCoverTags(tags);
  const dateLabel = formatYearMonth(updatedAt);

  const scrollToSection = (index: number) => {
    if (!editor || editor.isDestroyed) return;
    const h2Elements = editor.view.dom.querySelectorAll<HTMLElement>("h2");
    const target = h2Elements[index];
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const showNavigation = showChapterNavigation && sections.length >= 2;
  if (!showMagazineCover && !showNavigation) return null;

  return (
    <div
      data-edgeever-magazine-header="true"
      className="mb-6 select-none"
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
      }}
    >
      {showMagazineCover ? (
        <div
          data-edgeever-magazine-cover="true"
          className="mb-7 overflow-hidden rounded-[20px] border bg-card text-card-foreground shadow-[0_4px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.28)]"
          style={{
            borderWidth: "1.5px",
            borderColor: isNative
              ? undefined
              : "color-mix(in srgb, var(--note-palette-accent, #374151) 18%, transparent)",
          }}
        >
          <div className="px-7 pb-6 pt-7">
            {topTag ? (
              <div className="mb-[22px] flex items-center gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background: "var(--note-palette-accent, #4b5563)",
                  }}
                />
                <span
                  className={isNative ? "min-w-0 text-muted-foreground" : "min-w-0"}
                  style={{
                    overflowWrap: "anywhere",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "3px",
                    color: isNative ? undefined : "var(--note-palette-accent, #4b5563)",
                  }}
                >
                  {topTag}
                </span>
                <span
                  className="h-px flex-1"
                  style={{
                    background: isNative
                      ? "linear-gradient(to right, hsl(var(--border)), transparent)"
                      : "linear-gradient(to right, color-mix(in srgb, var(--note-palette-accent, #374151) 18%, transparent), transparent)",
                  }}
                />
                <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/70">
                  {dateLabel}
                </span>
              </div>
            ) : null}

            <p
              className="m-0 font-black text-card-foreground"
              style={{
                fontSize: "24px",
                lineHeight: 1.18,
                letterSpacing: "-0.5px",
              }}
            >
              <span>{primary}</span>
              {highlight ? (
                <span
                  className={isNative ? "text-muted-foreground" : undefined}
                  style={isNative ? undefined : { color: "var(--note-palette-accent, #374151)" }}
                >
                  {highlight}
                </span>
              ) : null}
            </p>
          </div>

          <div
            className={isNative ? "h-2 border-t border-border bg-muted/70" : "h-2"}
            style={
              isNative
                ? undefined
                : {
                    background:
                      "linear-gradient(135deg, var(--note-palette-accent, #374151), color-mix(in srgb, var(--note-palette-accent, #374151) 80%, #ffffff))",
                  }
            }
            aria-hidden="true"
          />
        </div>
      ) : null}

      {showNavigation ? (
        <div data-edgeever-chapter-navigation="true" className="mb-7">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[2px] text-muted-foreground">
              {sections.length} PARTS · 章节导览
            </span>
          </div>
          <div className="flex w-full flex-wrap items-stretch justify-start gap-2">
            {sections.map((section, idx) => {
              const isHighlighted = idx < sections.length - 1;
              const useSolidAccent = isHighlighted && !isNative;
              return (
                <button
                  key={section.num}
                  type="button"
                  onClick={() => scrollToSection(section.index)}
                  className={
                    useSolidAccent
                      ? "box-border flex w-[146px] max-w-full min-w-0 flex-none cursor-pointer flex-col items-stretch rounded-xl border border-transparent p-3 text-left transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      : isHighlighted
                        ? "box-border flex w-[146px] max-w-full min-w-0 flex-none cursor-pointer flex-col items-stretch rounded-xl border border-border bg-muted/60 p-3 text-left shadow-[0_2px_6px_rgba(0,0,0,0.03)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "box-border flex w-[146px] max-w-full min-w-0 flex-none cursor-pointer flex-col items-stretch rounded-xl border border-border bg-card p-3 text-left shadow-[0_2px_6px_rgba(0,0,0,0.03)] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  }
                  style={
                    useSolidAccent
                      ? {
                          background:
                            "linear-gradient(135deg, var(--note-palette-accent, #374151), color-mix(in srgb, var(--note-palette-accent, #374151) 80%, #ffffff))",
                        }
                      : undefined
                  }
                >
                  <div
                    className={
                      useSolidAccent
                        ? "mb-[5px] text-[9px] font-bold leading-[1.4] tracking-[1px] text-white/75"
                        : "mb-[5px] text-[9px] font-bold leading-[1.4] tracking-[1px] text-muted-foreground"
                    }
                  >
                    {section.num}
                  </div>
                  <div
                    className={
                      useSolidAccent
                        ? "mb-[3px] truncate text-[13px] font-extrabold leading-[1.3] text-white"
                        : "mb-[3px] truncate text-[13px] font-extrabold leading-[1.3] text-card-foreground"
                    }
                  >
                    {section.shortTitle}
                  </div>
                  <div
                    className={
                      useSolidAccent
                        ? "line-clamp-2 break-words text-[10px] leading-[1.4] text-white/80"
                        : "line-clamp-2 break-words text-[10px] leading-[1.4] text-muted-foreground"
                    }
                  >
                    {section.subTitle}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};
