import { toCanvas } from "html-to-image";
import type { HtmlImageEmbedResult, NoteHtmlExportMeta } from "@/lib/note-html-export";
import { prepareNoteBodyHtmlForExport } from "@/lib/note-html-export";
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
  generateCardCss,
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
  styles: string;
};

export type PreparedNoteImage = {
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

const renderImage = async (source: HTMLElement, format: NoteImageFormat, backgroundColor: string, targetWidth: number) => {
  await document.fonts?.ready;
  await waitForImages(source);
  const totalHeight = Math.max(1, Math.ceil(source.getBoundingClientRect().height));
  const canvas = await toCanvas(source, {
    backgroundColor,
    cacheBust: false,
    height: totalHeight,
    pixelRatio: NOTE_IMAGE_EXPORT_PIXEL_RATIO,
    skipFonts: true,
    width: targetWidth,
  });
  return { blob: await canvasToImageBlob(canvas, format), height: canvas.height, width: canvas.width };
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
  fontStyle = "serif",
  fontSize = "lg",
  cardWidth = "standard",
  showTitle = true,
  showNotebook = false,
  showTags = false,
  showUpdatedAt = true,
  styles,
}: DownloadNoteImageOptions): Promise<PreparedNoteImage> => {
  const resolvedTheme = resolveTheme(background, theme);
  const targetWidth = NOTE_IMAGE_CARD_WIDTH_PIXELS[cardWidth] || 680;
  const themeCfg = NOTE_IMAGE_THEMES[resolvedTheme];

  const prepared = await prepareNoteBodyHtmlForExport(bodyHtml);
  const host = document.createElement("div");
  host.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    `width:${targetWidth}px`,
    "pointer-events:none",
  ].join(";");

  const style = document.createElement("style");
  style.textContent = `${styles}\n${generateCardCss({ theme: resolvedTheme, fontStyle, fontSize, cardWidth })}`;
  host.appendChild(style);

  host.insertAdjacentHTML(
    "beforeend",
    buildNoteImageCardMarkup({
      title,
      notebook,
      tags,
      updatedAt,
      bodyHtml: prepared.bodyHtml,
      theme: resolvedTheme,
      fontStyle,
      showTitle,
      showNotebook,
      showTags,
      showUpdatedAt,
      showBranding: branding,
    }),
  );

  const source = host.lastElementChild as HTMLElement;
  source.style.width = `${targetWidth}px`;
  source.style.maxWidth = "none";
  source.style.margin = "0";

  document.body.appendChild(host);

  try {
    const canvasBgColor = NOTE_IMAGE_BACKGROUND_COLORS[resolvedTheme] || themeCfg.canvasBg;
    const image = await renderImage(source, format, canvasBgColor, targetWidth);
    const basename = buildImageExportBasename(title, fallbackTitle);
    const extension = format === "jpeg" ? "jpg" : "png";
    const filename = `${basename}.${extension}`;

    return {
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
