import hljs from "highlight.js/lib/common";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const EXPORT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

export type NoteHtmlExportMeta = {
  title: string;
  notebook?: string;
  tags?: string[];
  updatedAt?: string;
  language?: string;
};

export type BuildStandaloneHtmlDocumentOptions = NoteHtmlExportMeta & {
  bodyHtml: string;
  styles?: string;
};

export type DownloadNoteHtmlOptions = NoteHtmlExportMeta & {
  bodyHtml: string;
  fallbackTitle: string;
  styles?: string;
};

export type HtmlImageEmbedResult = {
  /** Images with a non-empty src attribute. */
  total: number;
  /** Already data: URLs plus successfully fetched/inlined images. */
  embedded: number;
  /** Images that could not be inlined and may break offline. */
  failed: number;
};

export type PreparedNoteHtmlExport = {
  bodyHtml: string;
  images: HtmlImageEmbedResult;
};

export type DownloadNoteHtmlResult = {
  filename: string;
  images: HtmlImageEmbedResult;
};

export const createEmptyHtmlImageEmbedResult = (): HtmlImageEmbedResult => ({
  total: 0,
  embedded: 0,
  failed: 0,
});

/** Decide whether the UI should warn about image embedding after a successful download. */
export const getHtmlImageEmbedNoticeKind = (
  images: HtmlImageEmbedResult,
): "none" | "partial" | "failed-all" => {
  if (images.total === 0 || images.failed === 0) {
    return "none";
  }
  if (images.embedded === 0) {
    return "failed-all";
  }
  return "partial";
};

export const buildHtmlFilename = (title: string, fallback: string) => {
  const sanitized = title
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  const basename = sanitized || fallback;
  const safeBasename = WINDOWS_RESERVED_NAME.test(basename) ? `_${basename}` : basename;
  return /\.html?$/i.test(safeBasename) ? safeBasename.replace(/\.htm$/i, ".html") : `${safeBasename}.html`;
};

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const buildNoteHtmlContentMarkup = ({
  title,
  notebook = "",
  tags = [],
  updatedAt = "",
  bodyHtml,
}: Pick<BuildStandaloneHtmlDocumentOptions, "title" | "notebook" | "tags" | "updatedAt" | "bodyHtml">) => {
  const metadataParts = [notebook, updatedAt, ...tags.map((tag) => `#${tag}`)].filter(Boolean);
  const metaHtml = metadataParts.length > 0
    ? `<div class="edgeever-html-meta">${escapeHtml(metadataParts.join(" · "))}</div>`
    : "";

  return `<div class="edgeever-html-shell">
<article class="edgeever-html-document">
<h1 class="edgeever-html-title">${escapeHtml(title)}</h1>
${metaHtml}
<div class="edgeever-html-content">
${bodyHtml}
</div>
</article>
</div>`;
};

export const buildStandaloneHtmlDocument = ({
  title,
  notebook = "",
  tags = [],
  updatedAt = "",
  language = "en",
  bodyHtml,
  styles = "",
}: BuildStandaloneHtmlDocumentOptions) => {
  const contentMarkup = buildNoteHtmlContentMarkup({ title, notebook, tags, updatedAt, bodyHtml });

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="EdgeEver" />
<title>${escapeHtml(title)}</title>
<style>
${styles}
</style>
</head>
<body>
${contentMarkup}
</body>
</html>
`;
};

export const createHtmlFile = (html: string, title: string, fallback: string) => ({
  blob: new Blob([html], { type: "text/html;charset=utf-8" }),
  filename: buildHtmlFilename(title, fallback),
});

export const downloadHtmlFile = (html: string, title: string, fallback: string) => {
  const { blob, filename } = createHtmlFile(html, title, fallback);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to encode resource as data URL"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read resource blob"));
    reader.readAsDataURL(blob);
  });

const resolveResourceUrl = (src: string) => {
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
};

export const renderMermaidBlocksForHtmlExport = async (root: HTMLElement) => {
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
        transparent: true,
        font: EXPORT_FONT_FAMILY,
        padding: 24,
      });
      const figure = document.createElement("figure");
      figure.className = "edgeever-html-mermaid";
      figure.innerHTML = svg;
      container.replaceWith(figure);
    } catch {
      // Keep invalid Mermaid source readable in the exported document.
    }
  }));
};

export const highlightCodeBlocksForHtmlExport = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>("pre > code:not(.language-mermaid)").forEach((code) => {
    try {
      hljs.highlightElement(code);
    } catch {
      // Leave unhighlighted source readable when language detection fails.
    }
  });
};

export const embedImagesForHtmlExport = async (root: HTMLElement): Promise<HtmlImageEmbedResult> => {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[src]"));
  const result = createEmptyHtmlImageEmbedResult();

  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute("src")?.trim();
    if (!src) {
      return;
    }

    result.total += 1;

    if (src.startsWith("data:")) {
      result.embedded += 1;
      return;
    }

    try {
      const response = await fetch(src.startsWith("blob:") ? src : resolveResourceUrl(src), {
        credentials: src.startsWith("blob:") ? "omit" : "include",
      });
      if (!response.ok) {
        result.failed += 1;
        return;
      }
      image.setAttribute("src", await blobToDataUrl(await response.blob()));
      result.embedded += 1;
    } catch {
      // Leave the original URL so partial exports still open, but report the miss.
      result.failed += 1;
    }
  }));

  return result;
};

/** Enrich note body HTML for a self-contained offline file. */
export const prepareNoteBodyHtmlForExport = async (bodyHtml: string): Promise<PreparedNoteHtmlExport> => {
  const container = document.createElement("div");
  container.innerHTML = bodyHtml;
  await renderMermaidBlocksForHtmlExport(container);
  highlightCodeBlocksForHtmlExport(container);
  const images = await embedImagesForHtmlExport(container);
  return {
    bodyHtml: container.innerHTML,
    images,
  };
};

export const downloadNoteHtmlFile = async ({
  bodyHtml,
  title,
  notebook,
  tags,
  updatedAt,
  language,
  fallbackTitle,
  styles = "",
}: DownloadNoteHtmlOptions): Promise<DownloadNoteHtmlResult> => {
  const prepared = await prepareNoteBodyHtmlForExport(bodyHtml);
  const html = buildStandaloneHtmlDocument({
    title,
    notebook,
    tags,
    updatedAt,
    language,
    bodyHtml: prepared.bodyHtml,
    styles,
  });
  return {
    filename: downloadHtmlFile(html, title, fallbackTitle),
    images: prepared.images,
  };
};
