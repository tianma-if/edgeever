import { useEffect, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Code2, Copy, Maximize2 } from "lucide-react";
import { MERMAID_THEME_PALETTES, useMermaidTheme } from "./ThemeProvider";
import { MermaidViewer } from "./MermaidViewer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/clipboard";
import { renderMermaidWithFallback } from "@/lib/mermaid-renderer";
import { getOfficialMermaidThemeVariables } from "@/lib/mermaid-theme";

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
  const { mermaidTheme } = useMermaidTheme();
  const language = typeof node.attrs.language === "string" ? node.attrs.language.toLowerCase() : "plaintext";
  const source = node.textContent.trim();
  const isMermaid = language === "mermaid";
  const [svg, setSvg] = useState("");
  const [sourceVisible, setSourceVisible] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(node.textContent);
    setCopyState(copied ? "copied" : "error");
  };

  useEffect(() => {
    if (!isMermaid || !source) {
      setSvg("");
      setRenderState("idle");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRenderState("loading");
      const palette = MERMAID_THEME_PALETTES[mermaidTheme];

      const renderBeautiful = () => loadBeautifulMermaid()
        .then(({ renderMermaidSVG, THEMES }) => renderMermaidSVG(source, {
          ...THEMES[mermaidTheme],
          ...palette,
          transparent: true,
          font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: 24,
        }));
      const renderOfficial = () => loadMermaid().then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: getOfficialMermaidThemeVariables(palette),
        });
        const valid = await mermaid.parse(source, { suppressErrors: true });
        if (!valid) throw new Error("Invalid Mermaid diagram");

        mermaidRenderSequence += 1;
        const { svg: renderedSvg } = await mermaid.render(`edgeever-mermaid-${mermaidRenderSequence}`, source);
        return renderedSvg;
      });
      const renderPromise = renderMermaidWithFallback({
        renderBeautiful,
        renderOfficial,
      });

      void renderPromise
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
      {isMermaid ? (
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <div className="edgeever-mermaid-toolbar" contentEditable={false}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="edgeever-mermaid-tool-button"
                  data-state={copyState}
                  aria-label={t(copyState === "copied" ? "editorToolbar.codeCopied" : copyState === "error" ? "editorToolbar.codeCopyFailed" : "editorToolbar.copyCode")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleCopy();
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {copyState === "copied"
                    ? <Check aria-hidden="true" />
                    : copyState === "error"
                      ? <CircleAlert aria-hidden="true" />
                      : <Copy aria-hidden="true" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t(copyState === "copied" ? "editorToolbar.codeCopied" : copyState === "error" ? "editorToolbar.codeCopyFailed" : "editorToolbar.copyCode")}
              </TooltipContent>
            </Tooltip>
            {editor.isEditable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="edgeever-mermaid-tool-button"
                    aria-label={t(sourceVisible ? "editorToolbar.mermaidHideSource" : "editorToolbar.mermaidShowSource")}
                    aria-pressed={sourceVisible}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSourceVisible((visible) => !visible);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <Code2 aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t(sourceVisible ? "editorToolbar.mermaidHideSource" : "editorToolbar.mermaidShowSource")}
                </TooltipContent>
              </Tooltip>
            )}
            {svg && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="edgeever-mermaid-tool-button"
                    aria-label={t("editorToolbar.mermaidOpenViewer")}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setViewerOpen(true);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <Maximize2 aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("editorToolbar.mermaidOpenViewer")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      ) : (
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="edgeever-code-copy-button"
                contentEditable={false}
                aria-label={t(copyState === "copied" ? "editorToolbar.codeCopied" : copyState === "error" ? "editorToolbar.codeCopyFailed" : "editorToolbar.copyCode")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleCopy();
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                {copyState === "copied"
                  ? t("editorToolbar.codeCopied")
                  : copyState === "error"
                    ? t("editorToolbar.codeCopyFailed")
                    : t("editorToolbar.copyCode")}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t(copyState === "copied" ? "editorToolbar.codeCopied" : copyState === "error" ? "editorToolbar.codeCopyFailed" : "editorToolbar.copyCode")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {isMermaid && (
        <div
          className="edgeever-mermaid-preview"
          contentEditable={false}
          aria-label={t("editorToolbar.mermaidPreview")}
          style={{ backgroundColor: MERMAID_THEME_PALETTES[mermaidTheme].bg }}
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
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label={isMermaid ? t("editorToolbar.mermaidSource") : undefined}
        aria-multiline="true"
        aria-readonly={!editor.isEditable}
      />
      {isMermaid && svg && (
        <MermaidViewer
          closeLabel={t("editorToolbar.mermaidCloseViewer")}
          fallbackBackgroundColor={MERMAID_THEME_PALETTES[mermaidTheme].bg}
          open={viewerOpen}
          resetZoomLabel={t("editorToolbar.mermaidResetZoom")}
          svg={svg}
          viewerLabel={t("editorToolbar.mermaidViewer")}
          zoomInLabel={t("editorToolbar.mermaidZoomIn")}
          zoomOutLabel={t("editorToolbar.mermaidZoomOut")}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </NodeViewWrapper>
  );
};
