import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Code2, Copy, Maximize2 } from "lucide-react";
import { MERMAID_THEME_PALETTES, useMermaidTheme } from "./ThemeProvider";
import { MermaidViewer } from "./MermaidViewer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isAppleShortcutPlatform } from "@/lib/app-helpers";
import { copyTextToClipboard } from "@/lib/clipboard";
import { renderThemedMermaidSvg } from "@/lib/mermaid-renderer";
import { mermaidDisplayScale } from "@/lib/mermaid-svg";

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
  const [copyTooltipOpen, setCopyTooltipOpen] = useState(false);
  const copyLabel = t(copyState === "copied" ? "editorToolbar.codeCopied" : copyState === "error" ? "editorToolbar.codeCopyFailed" : "editorToolbar.copyCode");
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !svg) return;

    const applySize = () => {
      const root = preview.querySelector("svg");
      const viewBox = root?.viewBox?.baseVal;
      if (!viewBox?.width || !viewBox.height) return;

      const host = preview.parentElement ?? preview;
      const previewStyle = getComputedStyle(preview);
      const available = host.clientWidth
        - Number.parseFloat(previewStyle.paddingLeft)
        - Number.parseFloat(previewStyle.paddingRight)
        - Number.parseFloat(previewStyle.borderLeftWidth)
        - Number.parseFloat(previewStyle.borderRightWidth);
      const scale = mermaidDisplayScale(viewBox.width, available);
      preview.style.setProperty("--mermaid-display-width", `${Math.round(viewBox.width * scale)}px`);
      preview.style.setProperty("--mermaid-display-height", `${Math.round(viewBox.height * scale)}px`);
    };

    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(preview.parentElement ?? preview);
    return () => observer.disconnect();
  }, [svg]);

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

      const renderPromise = renderThemedMermaidSvg(source, {
        palette,
        font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: 24,
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
          <Tooltip open={copyTooltipOpen} onOpenChange={setCopyTooltipOpen}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="edgeever-code-copy-button"
                contentEditable={false}
                aria-label={copyLabel}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleCopy();
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                {copyLabel}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {copyState === "idle" && editor.isEditable
                ? t("editorToolbar.copyCodeLineHint", { shortcut: isAppleShortcutPlatform() ? "⌘C" : "Ctrl+C" })
                : copyLabel}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {isMermaid && (
        <div
          ref={previewRef}
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
