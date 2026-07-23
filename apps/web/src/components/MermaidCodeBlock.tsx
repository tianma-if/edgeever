import { useCallback, useEffect, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { useTheme } from "./ThemeProvider";

type MermaidModule = typeof import("mermaid")["default"];
type BeautifulMermaidModule = typeof import("beautiful-mermaid");

let mermaidModulePromise: Promise<MermaidModule> | null = null;
let mermaidRenderSequence = 0;
let beautifulMermaidModulePromise: Promise<BeautifulMermaidModule> | null = null;

const loadMermaid = () => {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then(({ default: mermaid }) => {
      return mermaid;
    });
  }

  return mermaidModulePromise;
};

const loadBeautifulMermaid = () => {
  if (!beautifulMermaidModulePromise) {
    beautifulMermaidModulePromise = import("beautiful-mermaid");
  }
  return beautifulMermaidModulePromise;
};

export const MermaidCodeBlock = ({ editor, node }: NodeViewProps) => {
  const { t } = useTranslation();
  const { mermaidTheme } = useTheme();
  const language = typeof node.attrs.language === "string" ? node.attrs.language.toLowerCase() : "plaintext";
  const source = node.textContent.trim();
  const isMermaid = language === "mermaid";
  const [svg, setSvg] = useState("");
  const [sourceVisible, setSourceVisible] = useState(false);
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = node.textContent;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API may be unavailable.
    }
  }, [node]);

  useEffect(() => {
    if (!isMermaid || !source) {
      setSvg("");
      setRenderState("idle");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRenderState("loading");

      void loadBeautifulMermaid()
        .then(({ renderMermaidSVG, THEMES }) => {
          try {
            return renderMermaidSVG(source, {
              ...THEMES[mermaidTheme],
              transparent: true,
              font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
              padding: 24,
            });
          } catch {
            return null;
          }
        })
        .then((beautifulSvg) => {
          if (beautifulSvg) return beautifulSvg;
          return loadMermaid().then(async (mermaid) => {
            const palette = (await loadBeautifulMermaid()).THEMES[mermaidTheme];
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: "strict",
              suppressErrorRendering: true,
              theme: "base",
              themeVariables: {
                background: palette.bg,
                primaryColor: palette.surface ?? palette.bg,
                primaryTextColor: palette.fg,
                primaryBorderColor: palette.border ?? palette.fg,
                lineColor: palette.line ?? palette.fg,
                textColor: palette.fg,
                mainBkg: palette.bg,
                nodeBorder: palette.border ?? palette.fg,
                edgeLabelBackground: palette.bg,
                actorBkg: palette.surface ?? palette.bg,
                actorBorder: palette.border ?? palette.fg,
                actorTextColor: palette.fg,
                signalColor: palette.line ?? palette.fg,
                signalTextColor: palette.fg,
              },
            });
            const valid = await mermaid.parse(source, { suppressErrors: true });
            if (!valid) {
              throw new Error("Invalid Mermaid diagram");
            }

            mermaidRenderSequence += 1;
            const { svg: fallbackSvg } = await mermaid.render(`edgeever-mermaid-${mermaidRenderSequence}`, source);
            return fallbackSvg;
          });
        })
        .then((nextSvg) => {
          if (!cancelled) {
            setSvg(nextSvg);
            setRenderState("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSvg("");
            setRenderState("error");
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isMermaid, mermaidTheme, source]);

  return (
    <NodeViewWrapper
      className={isMermaid
        ? `edgeever-mermaid-code-block${sourceVisible ? " is-source-visible" : ""}`
        : "edgeever-code-block"}
      data-language={language}
    >
      <button
        type="button"
        className="edgeever-code-copy-button"
        contentEditable={false}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void handleCopy();
        }}
        aria-label={copied ? t("common.copied") : t("common.copy")}
      >
        {copied ? t("common.copied") : t("common.copy")}
      </button>
      {isMermaid && (
        <div
          className="edgeever-mermaid-preview"
          contentEditable={false}
          onClick={() => editor.isEditable && setSourceVisible((visible) => !visible)}
          onKeyDown={(event) => {
            if (editor.isEditable && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setSourceVisible((visible) => !visible);
            }
          }}
          aria-label={editor.isEditable
            ? `${t("editorToolbar.mermaidPreview")} · ${t("editorToolbar.mermaidSource")}`
            : undefined}
          role={editor.isEditable ? "button" : undefined}
          tabIndex={editor.isEditable ? 0 : undefined}
        >
          {!source && <p className="edgeever-mermaid-message">{t("editorToolbar.mermaidEmpty")}</p>}
          {source && renderState === "loading" && !svg && (
            <p className="edgeever-mermaid-message">{t("editorToolbar.mermaidRendering")}</p>
          )}
          {renderState === "error" && (
            <p className="edgeever-mermaid-error" role="alert">
              {t("editorToolbar.mermaidInvalid")}
            </p>
          )}
          {svg && (
            <div
              className="edgeever-mermaid-svg"
              role="img"
              aria-label={t("editorToolbar.mermaidPreview")}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      )}
      <NodeViewContent
        className={isMermaid ? "edgeever-code-source edgeever-mermaid-source" : "edgeever-code-source"}
        role="textbox"
        aria-label={isMermaid ? t("editorToolbar.mermaidSource") : undefined}
        aria-multiline="true"
        aria-readonly={!editor.isEditable}
      />
    </NodeViewWrapper>
  );
};
