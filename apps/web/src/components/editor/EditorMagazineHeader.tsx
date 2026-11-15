import { useEffect, useState } from "react";
import { formatNoteCoverTags } from "@/lib/note-cover-tags";
import type { Editor } from "@tiptap/react";

type SectionItem = {
  index: number;
  num: string;
  shortTitle: string;
  subTitle: string;
};

const cleanHeadingText = (raw: string) =>
  raw
    .replace(/^\s*(?:第[一二三四五六七八九十百\d]+[章节部分篇]\s*[：:·.\s]*|\d+\s*[.、·:：]\s*|[一二三四五六七八九十]+\s*[、.．]\s*)/u, "")
    .trim();

const deriveShortAndSubTitle = (raw: string, index: number) => {
  const cleaned = cleanHeadingText(raw) || raw.trim() || `章节 ${index + 1}`;
  const parts = cleaned.split(/[：:，,——·\s]+/).filter(Boolean);
  if (parts.length >= 2 && parts[0].length <= 8) {
    return {
      shortTitle: parts[0],
      subTitle: parts.slice(1).join(" · ").slice(0, 14),
    };
  }
  if (cleaned.length <= 6) {
    return {
      shortTitle: cleaned,
      subTitle: `PART ${String(index + 1).padStart(2, "0")}`,
    };
  }
  return {
    shortTitle: cleaned.slice(0, 5),
    subTitle: cleaned.slice(5, 17) || cleaned.slice(0, 12),
  };
};

const splitCoverTitle = (rawTitle: string) => {
  const trimmed = rawTitle.trim();
  if (!trimmed) {
    return { primary: "深度实测与结构化指南", highlight: "" };
  }
  const colonMatch = trimmed.match(/^([^：:，,——]+)[：:，,——]\s*(.+)$/);
  if (colonMatch) {
    return {
      primary: `${colonMatch[1]}，`,
      highlight: colonMatch[2],
    };
  }
  if (trimmed.length > 10) {
    const mid = Math.ceil(trimmed.length * 0.45);
    return {
      primary: trimmed.slice(0, mid),
      highlight: trimmed.slice(mid),
    };
  }
  return { primary: trimmed, highlight: "" };
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
      const nextSections = h2Elements.map((el, index) => {
        const { shortTitle, subTitle } = deriveShortAndSubTitle(el.textContent || "", index);
        return {
          index,
          num: String(index + 1).padStart(2, "0"),
          shortTitle,
          subTitle,
        };
      });
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
      {showMagazineCover && <div
        data-edgeever-magazine-cover="true"
        style={{
          margin: "0 0 28px",
          background: "#ffffff",
          border: isNative
            ? "1.5px solid #e5e7eb"
            : "1.5px solid color-mix(in srgb, var(--note-palette-accent, #374151) 18%, transparent)",
          borderRadius: "20px",
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.06)",
        }}
      >
        <div style={{ padding: "28px 28px 24px" }}>
          {topTag ? <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "22px" }}>
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--note-palette-accent, #4b5563)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                minWidth: 0,
                overflowWrap: "anywhere",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "3px",
                color: "var(--note-palette-accent, #4b5563)",
              }}
            >
              {topTag}
            </span>
            <span
              style={{
                flex: 1,
                height: "1px",
                background: isNative
                  ? "linear-gradient(to right, #e5e7eb, transparent)"
                  : "linear-gradient(to right, color-mix(in srgb, var(--note-palette-accent, #374151) 18%, transparent), transparent)",
              }}
            />
            <span style={{ fontSize: "10px", color: "#d1d5db", fontWeight: 600 }}>
              {dateLabel}
            </span>
          </div> : null}

          <p
            style={{
              fontSize: "24px",
              fontWeight: 900,
              color: "#111827",
              margin: 0,
              lineHeight: 1.18,
              letterSpacing: "-1px",
            }}
          >
            <span>{primary}</span>
            {highlight ? (
              <span style={{ color: "var(--note-palette-accent, #374151)" }}>{highlight}</span>
            ) : null}
          </p>
        </div>

        <div
          style={{
            background: isNative
              ? "#f3f4f6"
              : "linear-gradient(135deg, var(--note-palette-accent, #374151), color-mix(in srgb, var(--note-palette-accent, #374151) 80%, #ffffff))",
            borderTop: isNative ? "1px solid #e5e7eb" : undefined,
            height: "8px",
          }}
          aria-hidden="true"
        />
      </div>}

      {showNavigation ? (
        <div data-edgeever-chapter-navigation="true" style={{ margin: "0 0 28px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "10px",
            }}
          >
            <span
              style={{
                fontSize: "10px",
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "2px",
                fontWeight: 600,
              }}
            >
              {sections.length} PARTS · 章节导览
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-start", gap: "8px", width: "100%" }}>
            {sections.map((section, idx) => {
              const isHighlighted = idx < sections.length - 1;
              const useSolidAccent = isHighlighted && !isNative;
              return (
                <button
                  key={section.num}
                  type="button"
                  onClick={() => scrollToSection(section.index)}
                  style={
                    useSolidAccent
                      ? {
                          minWidth: 0,
                          width: "146px",
                          maxWidth: "100%",
                          flex: "0 0 auto",
                          boxSizing: "border-box",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          textAlign: "left",
                          background: "linear-gradient(135deg, var(--note-palette-accent, #374151), color-mix(in srgb, var(--note-palette-accent, #374151) 80%, #ffffff))",
                          border: "1px solid transparent",
                          borderRadius: "12px",
                          padding: "12px",
                          cursor: "pointer",
                        }
                      : {
                          minWidth: 0,
                          width: "146px",
                          maxWidth: "100%",
                          flex: "0 0 auto",
                          boxSizing: "border-box",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          textAlign: "left",
                          background: isHighlighted ? "#f3f4f6" : "#ffffff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "12px",
                          padding: "12px",
                          boxShadow: "0 2px 6px rgba(0, 0, 0, 0.03)",
                          cursor: "pointer",
                        }
                  }
                >
                  <div
                    style={{
                      fontSize: "9px",
                      lineHeight: 1.4,
                      fontWeight: 700,
                      color: useSolidAccent ? "rgba(255, 255, 255, 0.72)" : "#6b7280",
                      letterSpacing: "1px",
                      marginBottom: "5px",
                    }}
                  >
                    {section.num}
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 800,
                      color: useSolidAccent ? "#ffffff" : "#111827",
                      marginBottom: "3px",
                      lineHeight: 1.3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {section.shortTitle}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: useSolidAccent ? "rgba(255, 255, 255, 0.75)" : "#6b7280",
                      lineHeight: 1.4,
                      wordBreak: "break-word",
                    }}
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
