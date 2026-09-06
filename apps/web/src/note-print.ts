import { Previewer } from "pagedjs";
import hljs from "highlight.js/lib/common";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import { MERMAID_THEME_PALETTES } from "@/components/ThemeProvider";
import {
  NOTE_PRINT_MESSAGE,
  NOTE_PRINT_READY_MESSAGE,
  type NotePrintPayload,
} from "@/lib/note-print";
import { getMessageTargetOrigin } from "@/lib/app-page-path";
import { withEnvironmentTitlePrefix } from "@/lib/environment-title";
import katexStyles from "katex/dist/katex.min.css?inline";
import printStyles from "@/styles/note-print.css?inline";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@/styles/note-print-screen.css";

const PRINT_FONT_FAMILY = '"Noto Sans SC Variable", sans-serif';
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

const renderMermaidBlocks = async (root: HTMLElement) => {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  await Promise.all(blocks.map(async (code) => {
    const source = code.textContent?.trim();
    const container = code.closest("pre");
    if (!source || !container) {
      return;
    }

    try {
      const svg = renderMermaidSVG(source, {
        ...THEMES["zinc-light"],
        ...MERMAID_THEME_PALETTES["zinc-light"],
        transparent: true,
        font: PRINT_FONT_FAMILY,
        padding: 24,
      });
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

const waitForPrintFonts = async (text: string) => {
  await Promise.all([
    document.fonts.load(`400 16px ${PRINT_FONT_FAMILY}`, text),
    document.fonts.load(`700 16px ${PRINT_FONT_FAMILY}`, text),
  ]);
  await document.fonts.ready;
};

const buildSource = (payload: NotePrintPayload) => {
  const article = document.createElement("article");
  article.className = "edgeever-print-document";
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
  content.className = "edgeever-print-content";
  content.innerHTML = payload.html;
  article.appendChild(content);
  return article;
};

const renderPreview = async (payload: NotePrintPayload) => {
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
  await renderMermaidBlocks(source);
  highlightCodeBlocks(source);
  await Promise.all([
    waitForPrintFonts(source.textContent ?? ""),
    waitForImages(source),
  ]);

  if (!preview) {
    throw new Error("Print preview root not found");
  }

  const previewer = new Previewer();
  await previewer.preview(
    source,
    [{ [window.location.href]: `${katexStyles}\n${printStyles}` }],
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
printButton?.addEventListener("click", () => window.print());

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
