import type { FontLoadStatus } from "./font-load-state";
import { prepareNoteImageAssets } from "@edgeever/shared/note-image-fonts";
import { noteImageAssetUrls } from "@edgeever/shared/note-image-assets";
import { toCanvas } from "html-to-image";
import type { HtmlImageEmbedResult, NoteHtmlExportMeta } from "@/lib/note-html-export";
import { prepareNoteBodyHtmlForExport } from "@/lib/note-html-export";
import { planWebNoteImageRender } from "@/lib/note-image-rendering";
import {
  type NoteImageFormat,
  type NoteImageTheme,
  type NoteImageBackground,
  type NoteImageFontStyle,
  type NoteImageFontSize,
  type NoteImageCardWidth,
  type ThemeStyleConfig,
  NOTE_IMAGE_EXPORT_WIDTH,
  NOTE_IMAGE_EXPORT_PIXEL_RATIO,
  NOTE_IMAGE_CARD_WIDTH_PIXELS,
  NOTE_IMAGE_BACKGROUND_COLORS,
  NOTE_IMAGE_THEMES,
  NOTE_IMAGE_FONT_FAMILIES,
  NOTE_IMAGE_FONT_SIZES,
  resolveTheme,
  buildImageExportBasename,
  buildNoteImageCardMarkup,
  estimateReadingStats,
  generateCardCss,
  prepareNoteImageContent,
} from "@edgeever/shared/note-image-card";

export {
  type NoteImageFormat,
  type NoteImageTheme,
  type NoteImageBackground,
  type NoteImageFontStyle,
  type NoteImageFontSize,
  type NoteImageCardWidth,
  type ThemeStyleConfig,
  NOTE_IMAGE_EXPORT_WIDTH,
  NOTE_IMAGE_EXPORT_PIXEL_RATIO,
  NOTE_IMAGE_CARD_WIDTH_PIXELS,
  NOTE_IMAGE_BACKGROUND_COLORS,
  NOTE_IMAGE_THEMES,
  NOTE_IMAGE_FONT_FAMILIES,
  NOTE_IMAGE_FONT_SIZES,
  resolveTheme,
  buildImageExportBasename,
  buildNoteImageCardMarkup,
  estimateReadingStats,
  generateCardCss,
};

export type DownloadNoteImageOptions = NoteHtmlExportMeta & {
  bodyHtml: string;
  branding?: boolean;
  fallbackTitle: string;
  format: NoteImageFormat;
  background?: NoteImageBackground;
  theme?: NoteImageTheme;
  fontStyle?: NoteImageFontStyle;
  fontSize?: NoteImageFontSize;
  cardWidth?: NoteImageCardWidth;
  showTitle?: boolean;
  showNotebook?: boolean;
  showTags?: boolean;
  showUpdatedAt?: boolean;
  author?: string;
  showAuthor?: boolean;
  showReadingTime?: boolean;
  readingTimeText?: string;
  styles: string;
  signal?: AbortSignal;
  onFontLoadStatus?: (status: FontLoadStatus) => void;
};

export type PreparedNoteImage = {
  fontFallback: boolean;
  fontsReady?: Promise<unknown>;
  blob: Blob;
  filename: string;
  height: number;
  images: HtmlImageEmbedResult;
  mimeType: "image/jpeg" | "image/png";
  width: number;
};

const canvasToImageBlob = (canvas: HTMLCanvasElement, format: NoteImageFormat) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image renderer returned an empty file"))),
      format === "jpeg" ? "image/jpeg" : "image/png",
      format === "jpeg" ? 0.92 : 1,
    );
  });

export const downloadPreparedNoteImage = ({ blob, filename }: Pick<PreparedNoteImage, "blob" | "filename">) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const waitForImages = async (root: HTMLElement) => {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(async (image) => {
      if (image.complete) return;
      try {
        await image.decode();
      } catch {
        // The HTML preparation stage reports resources that could not be embedded.
      }
    }),
  );
};

let maxCanvasDimension: number | undefined;
const getMaxCanvasDimension = () => {
  if (maxCanvasDimension) return maxCanvasDimension;
  const probe = document.createElement("canvas");
  try {
    for (const height of [65_535, 32_767, 16_384, 8_192, 4_096]) {
      probe.width = 1;
      probe.height = height;
      const context = probe.getContext("2d");
      if (!context) continue;
      try {
        context.fillRect(0, height - 1, 1, 1);
        if (context.getImageData(0, height - 1, 1, 1).data[3] === 255 && probe.toDataURL() !== "data:,") {
          maxCanvasDimension = height;
          return height;
        }
      } catch { /* Try a smaller supported canvas. */ }
    }
    return 4_096;
  } finally {
    probe.width = probe.height = 0;
  }
};

const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Image export cancelled", "AbortError");
};

// Theme changes may overlap. Serialize large canvases and discard cancelled
// preview requests before they allocate another full-resolution bitmap.
let previousRender = Promise.resolve();
const renderImage = async (source: HTMLElement, format: NoteImageFormat, backgroundColor: string, targetWidth: number, fontEmbedCSS: string, signal?: AbortSignal) => {
  const preceding = previousRender;
  let release!: () => void;
  previousRender = new Promise<void>(resolve => { release = resolve; });
  await preceding;
  try {
    checkAborted(signal);
    await document.fonts?.ready;
    await waitForImages(source);
    checkAborted(signal);
    const totalHeight = Math.max(1, Math.ceil(source.getBoundingClientRect().height));
    const capture = async (maxDimension: number, maxPixels?: number) => {
      checkAborted(signal);
      const { pixelRatio } = planWebNoteImageRender(targetWidth, totalHeight, maxDimension, maxPixels);
      const canvas = await toCanvas(source, {
        backgroundColor,
        cacheBust: false,
        height: totalHeight,
        pixelRatio,
        skipAutoScale: true,
        fontEmbedCSS,
        width: targetWidth,
      });
      try {
        checkAborted(signal);
        return { blob: await canvasToImageBlob(canvas, format), height: canvas.height, width: canvas.width };
      } finally {
        canvas.width = canvas.height = 0;
      }
    };
    try {
      return await capture(getMaxCanvasDimension());
    } catch {
      checkAborted(signal);
      // Some browsers impose an area limit below their supported side length.
      // Retry within the previous renderer's limits if allocation/encoding fails.
      return await capture(Math.min(getMaxCanvasDimension(), 16_384), 16_000_000);
    }
  } finally {
    release();
  }
};

export const createNoteImage = async ({
  bodyHtml,
  branding = true,
  title,
  notebook,
  tags,
  updatedAt,
  fallbackTitle,
  format,
  background,
  theme,
  fontStyle = "auto",
  fontSize = "lg",
  cardWidth = "wide",
  showTitle = false,
  showNotebook = false,
  showTags = false,
  showUpdatedAt = true,
  author = "",
  showAuthor = false,
  showReadingTime = false,
  readingTimeText = "",
  styles,
  signal,
  onFontLoadStatus,
}: DownloadNoteImageOptions): Promise<PreparedNoteImage> => {
  checkAborted(signal);
  const resolvedTheme = resolveTheme(background, theme);
  const targetWidth = NOTE_IMAGE_CARD_WIDTH_PIXELS[cardWidth] || NOTE_IMAGE_CARD_WIDTH_PIXELS.wide;
  const themeCfg = NOTE_IMAGE_THEMES[resolvedTheme];

  const prepared = await prepareNoteBodyHtmlForExport(bodyHtml);
  const exportContent = document.createElement("div");
  exportContent.innerHTML = prepared.bodyHtml;
  prepareNoteImageContent(exportContent);
  onFontLoadStatus?.("loading");
  const assets = await prepareNoteImageAssets({ theme: resolvedTheme, fontStyle, text: [title, notebook, ...(tags || []), updatedAt, author, readingTimeText, prepared.bodyHtml].join(" "), urls: noteImageAssetUrls })
    .then(result => { onFontLoadStatus?.(result.fontFallback ? "error" : "ready"); return result; })
    .catch(error => { onFontLoadStatus?.("error"); throw error; });
  checkAborted(signal);
  const host = document.createElement("div");
  host.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    `width:${targetWidth}px`,
    "pointer-events:none",
  ].join(";");

  // Preview requests can overlap while a user changes themes. Keep their
  // styles isolated from each other and from the live editor.
  const renderRoot = document.createElement("div");
  host.attachShadow({ mode: "open" }).appendChild(renderRoot);
  const style = document.createElement("style");
  style.textContent = `${assets.css}\n${styles}\n${generateCardCss({ theme: resolvedTheme, fontStyle, fontSize, cardWidth })}`;
  renderRoot.appendChild(style);

  const markup = buildNoteImageCardMarkup({
    title,
    notebook,
    tags,
    updatedAt,
    bodyHtml: exportContent.innerHTML,
    theme: resolvedTheme,
    fontStyle,
    showTitle,
    showNotebook,
    showTags,
    showUpdatedAt,
    showBranding: branding,
    author,
    showAuthor,
    showReadingTime,
    readingTimeText,
  });
  // The HTML clone becomes SVG XML. Pasted controls and lone surrogates
  // can make the whole snapshot undecodable, even if the editor displays it.
  renderRoot.insertAdjacentHTML("beforeend", markup.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "\uFFFD"));

  const source = renderRoot.lastElementChild as HTMLElement;
  source.style.width = `${targetWidth}px`;
  source.style.maxWidth = "none";
  source.style.margin = "0";

  document.body.appendChild(host);

  try {
    const canvasBgColor = NOTE_IMAGE_BACKGROUND_COLORS[resolvedTheme] || themeCfg.canvasBg;
    const image = await renderImage(source, format, canvasBgColor, targetWidth, assets.fontCss, signal);
    const basename = buildImageExportBasename(title, fallbackTitle);
    const extension = format === "jpeg" ? "jpg" : "png";
    const filename = `${basename}.${extension}`;

    return {
      fontFallback: assets.fontFallback,
      fontsReady: assets.fontsReady,
      blob: image.blob,
      filename,
      height: image.height,
      images: prepared.images,
      mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      width: image.width,
    };
  } finally {
    host.remove();
  }
};

export const downloadNoteImage = async (options: DownloadNoteImageOptions) => {
  const prepared = await createNoteImage(options);
  downloadPreparedNoteImage(prepared);
  return prepared;
};
