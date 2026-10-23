import { Previewer } from "pagedjs";
import hljs from "highlight.js/lib/common";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import { MERMAID_THEME_PALETTES } from "@/components/ThemeProvider";
import { scaleMermaidSvg } from "@/lib/mermaid-svg";
import {
  NOTE_PRINT_MESSAGE,
  NOTE_PRINT_READY_MESSAGE,
  type NotePrintPayload,
} from "@/lib/note-print";
import type { MermaidThemeName } from "@/components/ThemeProvider";
import { getMessageTargetOrigin } from "@/lib/app-page-path";
import { withEnvironmentTitlePrefix } from "@/lib/environment-title";
import { notePrintAppearanceCss } from "@/lib/note-print-appearance";
import { installEditorBodyFontFaces } from "@/lib/editor-body-font-faces";
import { downloadNotePrintPdf } from "@/lib/note-print-pdf";
import katexStyles from "katex/dist/katex.min.css?inline";
import githubHighlightStyles from "highlight.js/styles/github.css?inline";
import printStyles from "@/styles/note-print.css?inline";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@/styles/note-print-screen.css";

const PRINT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans SC Variable", sans-serif';
let printTitle = "EdgeEver";
let printPreparingLabel = "";
let printReadyLabel = "";
const toolbar = document.getElementById("print-toolbar");
const status = document.getElementById("print-status");
const hint = document.getElementById("print-hint");
const closeButton = document.getElementById("print-close") as HTMLButtonElement | null;
const printButton = document.getElementById("print-action") as HTMLButtonElement | null;
const preview = document.getElementById("print-preview");
const token = new URLSearchParams(window.location.search).get("token");

const setText = (element: HTMLElement | null, value: string) => {
  if (element) {
    element.textContent = value;
  }
};

const renderMermaidBlocks = async (root: HTMLElement, theme: MermaidThemeName, font: string) => {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  const palette = MERMAID_THEME_PALETTES[theme] ?? MERMAID_THEME_PALETTES["zinc-light"];
  await Promise.all(blocks.map(async (code) => {
    const source = code.textContent?.trim();
    const container = code.closest("pre");
    if (!source || !container) {
      return;
    }

    try {
      const svg = scaleMermaidSvg(renderMermaidSVG(source, {
        ...THEMES[theme] ?? THEMES["zinc-light"],
        ...palette,
        transparent: true,
        font,
        padding: 24,
      }));
      const figure = document.createElement("figure");
      figure.className = "edgeever-print-mermaid";
      figure.innerHTML = svg;
      container.replaceWith(figure);
    } catch {
      // Keep invalid Mermaid source readable in the exported document.
    }
  }));
};

const highlightCodeBlocks = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>("pre > code:not(.language-mermaid)").forEach((code) => {
    hljs.highlightElement(code);
  });
};

const waitForImages = async (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map(async (image) => {
    if (image.complete && image.naturalWidth > 0) {
      return;
    }
    try {
      await image.decode();
    } catch {
      // A failed external image should not prevent the rest of the note printing.
    }
  }));
};

const waitForPrintFonts = async (text: string, fontId: NotePrintPayload["appearance"]["fontId"]) => {
  installEditorBodyFontFaces();
  if (fontId) {
    const { loadBodyFont } = await import("@edgeever/shared/font-loader");
    await loadBodyFont(fontId, text);
  }
  await document.fonts.ready;
};

const buildSource = (payload: NotePrintPayload) => {
  const article = document.createElement("article");
  article.className = "edgeever-print-document edgeever-editor";
  article.dataset.notePalette = payload.appearance.palette;
  article.lang = payload.language;

  const title = document.createElement("h1");
  title.className = "edgeever-print-title";
  title.textContent = payload.title;
  article.appendChild(title);

  const metadata = document.createElement("div");
  metadata.className = "edgeever-print-meta";
  const metadataParts = [payload.notebook, payload.updatedAt, ...payload.tags.map((tag) => `#${tag}`)].filter(Boolean);
  metadata.textContent = metadataParts.join(" · ");
  if (metadataParts.length > 0) {
    article.appendChild(metadata);
  }

  const content = document.createElement("div");
  content.className = "edgeever-print-content ProseMirror";
  content.innerHTML = payload.html;
  article.appendChild(content);
  return article;
};

const renderPreview = async (payload: NotePrintPayload) => {
  printTitle = payload.title;
  printPreparingLabel = payload.labels.preparing;
  printReadyLabel = payload.labels.ready;
  document.documentElement.lang = payload.language;
  document.title = withEnvironmentTitlePrefix(`${payload.title} · EdgeEver`, {
    development: import.meta.env.DEV,
    profile: __EDGEEVER_DEVELOPMENT_PROFILE__,
  });
  setText(status, payload.labels.preparing);
  setText(hint, "");
  setText(closeButton, payload.labels.close);
  setText(printButton, payload.labels.print);

  const source = buildSource(payload);
  const printFont = payload.appearance.fontFamily ?? PRINT_FONT_FAMILY;
  await renderMermaidBlocks(source, payload.appearance.mermaidTheme, printFont);
  highlightCodeBlocks(source);
  await Promise.all([
    waitForPrintFonts(source.textContent ?? "", payload.appearance.fontId),
    waitForImages(source),
  ]);

  if (!preview) {
    throw new Error("Print preview root not found");
  }

  const previewer = new Previewer();
  await previewer.preview(
    source,
    [{ [window.location.href]: `${katexStyles}\n${githubHighlightStyles}\n${printStyles}\n${notePrintAppearanceCss(payload.appearance)}` }],
    preview
  );
  await document.fonts.ready;

  toolbar?.classList.add("is-ready");
  setText(status, payload.labels.ready);
  setText(hint, payload.labels.hint);
  if (printButton) {
    printButton.disabled = false;
  }
};

closeButton?.addEventListener("click", () => window.close());
printButton?.addEventListener("click", () => {
  if (!preview || !printButton || printButton.disabled) return;
  printButton.disabled = true;
  setText(status, printPreparingLabel);
  void downloadNotePrintPdf(preview, printTitle, "EdgeEver").then(() => {
    setText(status, printReadyLabel);
    printButton.disabled = false;
  }).catch((error) => {
    console.error("Failed to save note PDF", error);
    setText(status, printReadyLabel);
    printButton.disabled = false;
    window.print();
  });
});

window.addEventListener("message", (event: MessageEvent<NotePrintPayload>) => {
  if (
    event.origin !== window.location.origin ||
    event.source !== window.opener ||
    event.data?.type !== NOTE_PRINT_MESSAGE ||
    event.data.token !== token
  ) {
    return;
  }

  void renderPreview(event.data).catch((error) => {
    console.error("Failed to build note print preview", error);
    setText(status, event.data.labels.error);
    setText(hint, "");
    setText(closeButton, event.data.labels.close);
  });
}, { once: true });

if (window.opener && token) {
  window.opener.postMessage(
    { type: NOTE_PRINT_READY_MESSAGE, token },
    getMessageTargetOrigin(window.location.origin)
  );
} else {
  setText(status, "EdgeEver");
}
