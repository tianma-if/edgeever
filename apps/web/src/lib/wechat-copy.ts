import type { Editor } from "@tiptap/react";
import {
  DEFAULT_NOTE_PROSE_FONT_SIZE,
  DEFAULT_NOTE_PROSE_LINE_HEIGHT,
  flattenDetailsForLinearHtml,
  NOTE_PROSE_HEADING_SCALE,
  NOTE_PROSE_PARAGRAPH_SPACING_PX,
  noteProseCodeFontSize,
  parseNoteProseLineHeight,
  type NoteProsePaletteColors,
} from "@edgeever/shared";
import katex from "katex";
import { common, createLowlight } from "lowlight";
import { toCanvas } from "html-to-image";
import { marked } from "marked";
import { MERMAID_THEME_PALETTES } from "@/components/ThemeProvider";
import { scaleMermaidSvg } from "@/lib/mermaid-svg";
import { copyHtmlToClipboard } from "@/lib/clipboard";
import { parseCustomCssToStyles } from "@/lib/css-sandbox";

const PARAGRAPH_SPACING = `${NOTE_PROSE_PARAGRAPH_SPACING_PX}px`;
const PUBLISH_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
const PUBLISH_MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const BODY_COLOR = "#27272a";
const QUOTE_COLOR = "#3d4450";
const CODE_COLOR = "#3d4450";
const CODE_BACKGROUND = "#e9edf1";
const LINK_COLOR = "#404040";
const CHECKED_TASK_COLOR = "#737373";

const HEADING_LAYOUT = {
  h1: { margin: "0 0 14px", lineHeight: 1.28, weight: 650, tracking: "-0.02em", color: "#1a1d21" },
  h2: { margin: "22px 0 10px", lineHeight: 1.32, weight: 600, tracking: "-0.015em", color: "#27272a" },
  h3: { margin: "18px 0 8px", lineHeight: 1.38, weight: 600, tracking: "-0.01em", color: "#27272a" },
  h4: { margin: "17px 0 7px", lineHeight: 1.4, weight: 600, tracking: "-0.006em", color: "#1e293b" },
  h5: { margin: "15px 0 6px", lineHeight: 1.42, weight: 600, tracking: "-0.005em", color: "#334155" },
  h6: { margin: "14px 0 6px", lineHeight: 1.45, weight: 600, tracking: "-0.005em", color: "#334155" },
} as const;

type WeChatMetrics = {
  fontSize: number;
  lineHeight: number;
};

const headingStyle = (tag: keyof typeof HEADING_LAYOUT, metrics: WeChatMetrics) => {
  const layout = HEADING_LAYOUT[tag];
  const size = Math.round(metrics.fontSize * NOTE_PROSE_HEADING_SCALE[tag]);
  return `margin: ${layout.margin}; padding: 0; font-family: ${PUBLISH_FONT}; font-size: ${size}px; line-height: ${layout.lineHeight}; font-weight: ${layout.weight}; letter-spacing: ${layout.tracking}; color: ${layout.color};`;
};

const applyLegacyWeChatStyles = (
  root: HTMLElement,
  metrics: WeChatMetrics,
  colors: NoteProsePaletteColors | null,
  _accentOnly = false,
) => {
  const fontSize = `${metrics.fontSize}px`;
  const lineHeight = String(metrics.lineHeight);
  const codeSize = `${noteProseCodeFontSize(metrics.fontSize)}px`;
  // A named hue recolors links, inline code, and bold, matching the editor.
  const link = colors?.link ?? LINK_COLOR;
  const inlineCodeColor = colors?.codeText ?? CODE_COLOR;
  const inlineCodeBackground = colors?.codeBackground ?? CODE_BACKGROUND;
  const inlineCodeShadow = colors
    ? "box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06);"
    : "box-shadow: inset 0 0 0 1px rgba(61,68,80,0.08);";
  const accent = colors?.accent ?? BODY_COLOR;
  const bold = colors ? `font-weight: 800; color: ${accent};` : "font-weight: 800;";
  const textStyle = `font-family: ${PUBLISH_FONT}; font-size: ${fontSize}; line-height: ${lineHeight}; letter-spacing: -0.005em; color: ${BODY_COLOR};`;
  const styles: Record<string, string> = {
    p: `margin: 0 0 ${PARAGRAPH_SPACING}; padding: 0; ${textStyle}`,
    h1: headingStyle("h1", metrics),
    h2: headingStyle("h2", metrics),
    h3: headingStyle("h3", metrics),
    h4: headingStyle("h4", metrics),
    h5: headingStyle("h5", metrics),
    h6: headingStyle("h6", metrics),
    blockquote: `margin: 0 0 16px; padding: 12px 16px; border: 0; border-radius: 8px; background: #f3f5f7; color: ${QUOTE_COLOR}; font-family: ${PUBLISH_FONT}; line-height: ${lineHeight};`,
    ul: `margin: 0 0 16px; padding-left: 24px; line-height: ${lineHeight}; list-style-type: disc;`,
    ol: `margin: 0 0 16px; padding-left: 24px; line-height: ${lineHeight}; list-style-type: decimal;`,
    li: `margin: 4px 0; line-height: ${lineHeight}; ${textStyle}`,
    a: `color: ${link}; font-weight: 500; text-decoration: underline; text-underline-offset: 2px;`,
    strong: bold,
    b: bold,
    em: "font-style: italic;",
    del: "text-decoration: line-through;",
    code: `padding: 1px 4px; border: 0; border-radius: 4px; background: ${inlineCodeBackground}; ${inlineCodeShadow} color: ${inlineCodeColor}; font-family: ${PUBLISH_MONO}; font-size: ${codeSize}; font-weight: 400;`,
    pre: `margin: 0 0 16px; padding: 14px 16px; overflow: hidden; border: 1px solid #e4e4e4; border-radius: 8px; background: #fafafa; color: #0f172a; font-family: ${PUBLISH_MONO}; font-size: ${codeSize}; line-height: 1.6; text-align: left; white-space: pre-wrap;`,
    hr: "margin: 24px 0; border: 0; border-top: 1px solid #1a1d21;",
    table: `width: 100%; margin: 20px 0; border-collapse: collapse; font-size: ${fontSize}; line-height: 1.45;`,
    th: "padding: 8px 13px; border: 1px solid #e5e5e5; background: #f5f5f5; color: #0f172a; font-weight: 600; font-size: 13px; text-align: left;",
    td: `padding: 8px 13px; border: 1px solid #e5e5e5; color: ${BODY_COLOR}; text-align: left;`,
    img: "display: block; max-width: 100%; height: auto; margin: 16px 0; border: 1px solid #b8dfd0; border-radius: 8px;",
  };

  root.style.cssText = `${textStyle} background-color: #ffffff; word-break: break-word;`;
  root.querySelectorAll("[data-edgeever-video-note]").forEach((element) => element.remove());

  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    if (element.closest("[data-ee-math]")) return;
    const tagName = element.tagName.toLowerCase();
    const isMergeDivider =
      tagName === "hr" && element.matches("[data-edgeever-merge-divider], .edgeever-merge-divider");
    const quoted = (tagName === "p" || tagName === "li") && element.closest("blockquote");
    const baseStyle = styles[tagName] || "";
    // One color declaration. A second `color` later in the attribute is easy for WeChat to drop.
    const style = isMergeDivider
      ? "margin: 24px 0; border: 0; border-top: 2px solid #1a1d21;"
      : quoted
        ? baseStyle.replace(/(^|;)\s*color:\s*[^;]+/i, `$1 color: ${QUOTE_COLOR}`)
        : baseStyle;
    if (style) element.style.cssText = `${style}${element.style.cssText}`;
  });

  root.querySelectorAll<HTMLElement>("pre code").forEach((element) => {
    element.style.cssText = `padding: 0; border: 0; background: transparent; color: inherit; font-family: ${PUBLISH_MONO}; font-size: ${codeSize}; font-weight: 400; white-space: pre-wrap;`;
  });
};

const applyInlineStyles = (
  root: HTMLElement,
  metrics: WeChatMetrics,
  colors: NoteProsePaletteColors | null,
  customCss?: string,
  accentOnly = false,
) => {
  applyLegacyWeChatStyles(root, metrics, colors, accentOnly);

  const customStyles = customCss ? parseCustomCssToStyles(customCss) : null;
  if (!customStyles) return;

  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    if (element.getAttribute("data-ee-publish-chrome") === "true") return;
    if (element.closest("[data-ee-math]")) return;
    const extra = customStyles[element.tagName.toLowerCase()];
    if (extra) element.style.cssText = `${element.style.cssText}; ${extra}`;
  });
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      resolve(reader.result);
      return;
    }
    reject(new Error("Could not encode image for clipboard"));
  };
  reader.onerror = () => reject(reader.error ?? new Error("Could not read image for clipboard"));
  reader.readAsDataURL(blob);
});

const WECHAT_IMAGE_MIME_TYPES = new Set([
  "image/bmp",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const canvasToPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((png) => {
    if (png) {
      resolve(png);
      return;
    }
    reject(new Error("Could not convert image to PNG"));
  }, "image/png");
});

const rasterizeImageElement = async (image: HTMLImageElement, scale = 1) => {
  if (!image.complete || image.naturalWidth === 0) {
    await image.decode();
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error("Could not decode image for clipboard");
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(image.naturalWidth * scale);
  canvas.height = Math.ceil(image.naturalHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create image canvas");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToPng(canvas);
};

const rasterizeBlob = async (blob: Blob) => {
  if (blob.type.toLocaleLowerCase() === "image/svg+xml") {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      return rasterizeImageElement(image);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create image canvas");
    }
    context.drawImage(bitmap, 0, 0);
    return canvasToPng(canvas);
  } finally {
    bitmap.close();
  }
};

const convertImageToPng = async (blob: Blob) => {
  if (WECHAT_IMAGE_MIME_TYPES.has(blob.type.toLocaleLowerCase())) {
    return blob;
  }

  return rasterizeBlob(blob);
};

const getSvgSize = (svg: string) => {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = Number.parseFloat(root.getAttribute("width") || "");
  const height = Number.parseFloat(root.getAttribute("height") || "");
  const viewBoxWidth = viewBox && viewBox.length === 4 ? viewBox[2] : Number.NaN;
  const viewBoxHeight = viewBox && viewBox.length === 4 ? viewBox[3] : Number.NaN;
  return {
    width: Number.isFinite(viewBoxWidth) ? viewBoxWidth : Number.isFinite(width) ? width : 800,
    height: Number.isFinite(viewBoxHeight) ? viewBoxHeight : Number.isFinite(height) ? height : 600,
  };
};

const WECHAT_MERMAID_MAX_EDGE = 1280;

const prepareSvgMarkup = (svg: string) => {
  const markup = svg.trim();
  if (/<svg\b[^>]*\sxmlns=/.test(markup)) return markup;
  return markup.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
};

const canvasToJpeg = (canvas: HTMLCanvasElement, quality = 0.86) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (jpeg) => {
        if (jpeg) {
          resolve(jpeg);
          return;
        }
        reject(new Error("Could not convert image to JPEG"));
      },
      "image/jpeg",
      quality,
    );
  });

const svgToTransparentPng = async (svg: string) => {
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth);
    canvas.height = Math.max(1, image.naturalHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create ornament canvas");
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) {
          resolve(png);
          return;
        }
        reject(new Error("Could not convert ornament to PNG"));
      }, "image/png");
    });
    return blobToDataUrl(blob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const rasterizePublishOrnamentsForWeChat = async (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-ee-publish-ornament]"));
  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute("src")?.trim() ?? "";
    if (!source.startsWith("data:image/svg+xml")) return;
    try {
      const encoded = source.replace(/^data:image\/svg\+xml(?:;charset=utf-8)?,/, "");
      const svg = decodeURIComponent(encoded);
      image.setAttribute("src", await svgToTransparentPng(svg));
    } catch {
      // Keep the SVG data URI in the live preview; WeChat copy can drop a broken ornament.
    }
  }));
};

const svgToWeChatImage = async (svg: string) => {
  const markup = prepareSvgMarkup(svg);
  const size = getSvgSize(markup);
  const objectUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const naturalWidth = image.naturalWidth || size.width;
    const naturalHeight = image.naturalHeight || size.height;
    const scale = Math.min(2, WECHAT_MERMAID_MAX_EDGE / Math.max(naturalWidth, naturalHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create image canvas");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const displayWidth = Math.min(size.width || naturalWidth, 677);
    const displayHeight = displayWidth * (naturalHeight / Math.max(naturalWidth, 1));
    return {
      blob: await canvasToJpeg(canvas),
      width: displayWidth,
      height: displayHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const renderMermaidSvg = async (source: string) => {
  const { renderMermaidSVG, THEMES } = await import("beautiful-mermaid");
  return scaleMermaidSvg(renderMermaidSVG(source, {
    ...THEMES["zinc-light"],
    ...MERMAID_THEME_PALETTES["zinc-light"],
    transparent: true,
    font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: 24,
  }));
};

const embedMermaidForWeChat = async (root: HTMLElement, editor?: Editor) => {
  const codeBlocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  if (codeBlocks.length === 0) {
    return;
  }

  const renderedBlocks = editor
    ? Array.from(editor.view.dom.querySelectorAll<HTMLElement>(".edgeever-mermaid-code-block"))
    : [];
  await Promise.all(codeBlocks.map(async (codeBlock, index) => {
    const source = codeBlock.textContent?.trim();
    const pre = codeBlock.closest("pre");
    if (!source || !pre) {
      return;
    }

    try {
      let svg = "";
      try {
        svg = await renderMermaidSvg(source);
      } catch {
        svg = renderedBlocks[index]?.querySelector("svg")?.outerHTML || "";
      }
      if (!svg) return;

      const { blob, width, height } = await svgToWeChatImage(svg);
      const paragraph = document.createElement("p");
      paragraph.style.cssText = "text-align: center; margin: 1em 0;";
      const image = document.createElement("img");
      image.src = await blobToDataUrl(blob);
      image.width = Math.round(width);
      image.height = Math.round(height);
      image.alt = "Mermaid diagram";
      image.style.cssText = "display: inline-block; max-width: 100%; height: auto;";
      paragraph.appendChild(image);
      pre.replaceWith(paragraph);
    } catch {
      // Preserve the Mermaid source as a readable fallback when rendering fails.
    }
  }));
};

const isSameOrigin = (source: string) => {
  try {
    return new URL(source, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

const isContentImage = (image: HTMLImageElement) =>
  Boolean(image.getAttribute("src")?.trim()) && !image.classList.contains("ProseMirror-separator");

const findOriginalImage = (source: string, originals: HTMLImageElement[]) => {
  const match = originals.find((image) => image.getAttribute("src") === source || image.currentSrc === source);
  if (match) return match;
  try {
    const resolved = new URL(source, window.location.href).href;
    return originals.find((image) => image.src === resolved) ?? null;
  } catch {
    return null;
  }
};

const embedImagesForWeChat = async (root: HTMLElement, originalImages: HTMLImageElement[] = []) => {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img")).filter(isContentImage);
  const originals = originalImages.filter(isContentImage);
  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute("src")?.trim();
    if (!source || source.startsWith("data:")) {
      return;
    }

    try {
      const originalImage = findOriginalImage(source, originals);
      if (originalImage) {
        image.setAttribute("src", await blobToDataUrl(await rasterizeImageElement(originalImage)));
        image.removeAttribute("srcset");
        return;
      }

      const response = await fetch(source, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`Could not fetch image (${response.status})`);
      }
      image.setAttribute("src", await blobToDataUrl(await convertImageToPng(await response.blob())));
      image.removeAttribute("srcset");
    } catch {
      // Never put a private same-origin URL into the clipboard: WeChat cannot access it.
      if (isSameOrigin(source)) {
        image.removeAttribute("src");
        image.removeAttribute("srcset");
      }
    }
  }));
};

const convertImageGalleriesForWeChat = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>("[data-edgeever-image-gallery]").forEach((gallery) => {
    const images = Array.from(gallery.children).filter(
      (child): child is HTMLImageElement => child.tagName === "IMG",
    );
    if (images.length < 2) return;

    const layout = gallery.getAttribute("data-image-gallery-layout");
    let columns = Math.min(images.length, 3);
    if (layout === "1") {
      columns = 1;
    } else if (layout === "2" || (layout !== "3" && images.length === 4)) {
      columns = 2;
    } else if (layout === "3") {
      columns = 3;
    }
    const table = document.createElement("table");
    table.setAttribute("role", "presentation");
    table.style.cssText = "width: 100%; margin: 1em 0; border: 0; border-collapse: separate; border-spacing: 6px; table-layout: fixed;";
    const body = document.createElement("tbody");

    images.forEach((image, index) => {
      if (index % columns === 0) body.appendChild(document.createElement("tr"));
      const cell = document.createElement("td");
      cell.style.cssText = `width: ${100 / columns}%; border: 0; padding: 0; vertical-align: middle;`;
      image.style.cssText = "display: block; width: 100%; height: auto; max-height: 18em; margin: 0; border-radius: 6px; object-fit: cover;";
      cell.appendChild(image);
      body.lastElementChild?.appendChild(cell);
    });

    table.appendChild(body);
    gallery.replaceWith(table);
  });
};

const publishLowlight = createLowlight(common);
for (const [language, aliases] of [
  ["bash", ["sh", "zsh"]],
  ["yaml", ["yml"]],
] as const) {
  const missing = aliases.filter((alias) => !publishLowlight.registered(alias));
  if (missing.length > 0) publishLowlight.registerAlias({ [language]: missing });
}

const HLJS_COLORS: Record<string, string> = {
  "hljs-doctag": "#d73a49",
  "hljs-keyword": "#d73a49",
  "hljs-template-tag": "#d73a49",
  "hljs-template-variable": "#d73a49",
  "hljs-type": "#d73a49",
  "hljs-title": "#6f42c1",
  "hljs-attr": "#005cc5",
  "hljs-attribute": "#005cc5",
  "hljs-literal": "#005cc5",
  "hljs-meta": "#005cc5",
  "hljs-number": "#005cc5",
  "hljs-operator": "#005cc5",
  "hljs-variable": "#005cc5",
  "hljs-selector-attr": "#005cc5",
  "hljs-selector-class": "#005cc5",
  "hljs-selector-id": "#005cc5",
  "hljs-regexp": "#032f62",
  "hljs-string": "#032f62",
  "hljs-built_in": "#e36209",
  "hljs-symbol": "#e36209",
  "hljs-comment": "#6a737d",
  "hljs-code": "#6a737d",
  "hljs-formula": "#6a737d",
  "hljs-name": "#22863a",
  "hljs-quote": "#22863a",
  "hljs-selector-tag": "#22863a",
  "hljs-selector-pseudo": "#22863a",
  "hljs-subst": "#24292e",
  "hljs-section": "#005cc5",
  "hljs-bullet": "#735c0f",
  "hljs-emphasis": "#24292e",
  "hljs-strong": "#24292e",
  "hljs-addition": "#22863a",
  "hljs-deletion": "#b31d28",
};

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string | string[] };
  children?: HastNode[];
};

const isEscaped = (source: string, index: number) => {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

const findClosingDelimiter = (source: string, delimiter: "$" | "$$", from: number) => {
  for (let index = from; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) return index;
  }
  return -1;
};

const escapeHtmlAttribute = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\r?\n/g, "&#10;");

const inlineMathHtml = (latex: string) =>
  `<span data-type="inline-math" data-latex="${escapeHtmlAttribute(latex)}"></span>`;

const blockMathHtml = (latex: string) =>
  `\n\n<div data-type="block-math" data-latex="${escapeHtmlAttribute(latex)}"></div>\n\n`;

/** Inline `$...$` only. A later `$` in another table cell must not close an unclosed price. */
const embedInlineMath = (source: string) => {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === "`") {
      let ticks = 0;
      while (source[index + ticks] === "`") ticks += 1;
      const token = "`".repeat(ticks);
      const close = source.indexOf(token, index + ticks);
      if (close < 0) return output + source.slice(index);
      const end = close + ticks;
      output += source.slice(index, end);
      index = end;
      continue;
    }
    if (source[index] === "$" && !source.startsWith("$$", index) && !isEscaped(source, index)) {
      const close = findClosingDelimiter(source, "$", index + 1);
      if (close > index && source[close + 1] !== "$") {
        const latex = source.slice(index + 1, close).trim();
        if (latex && !latex.includes("\n") && !isPureCurrency(latex)) {
          output += inlineMathHtml(latex);
          index = close + 1;
          continue;
        }
        if (latex && isPureCurrency(latex)) {
          output += source.slice(index, close + 1);
          index = close + 1;
          continue;
        }
      }
    }
    output += source[index];
    index += 1;
  }
  return output;
};

const isPureCurrency = (latex: string) => /^\d+(?:[.,]\d+)?$/u.test(latex);

/** Turn `$...$` / `$$...$$` into math nodes before Markdown parsing. Fences and inline code stay literal. */
const embedMarkdownMath = (markdown: string) => {
  let output = "";
  let index = 0;
  while (index < markdown.length) {
    const atLineStart = index === 0 || markdown[index - 1] === "\n";
    if (atLineStart) {
      const lineBreak = markdown.indexOf("\n", index);
      const lineEnd = lineBreak < 0 ? markdown.length : lineBreak;
      const line = markdown.slice(index, lineEnd);
      // Scan each cell on its own so `$10+/月` in one cell cannot close on `$5+/月` in the next.
      if (/^\s*\|.*\|\s*$/u.test(line) && !line.includes("$$")) {
        output += line.split("|").map((cell) => embedInlineMath(cell)).join("|");
        if (lineBreak >= 0) output += "\n";
        index = lineBreak < 0 ? markdown.length : lineBreak + 1;
        continue;
      }
    }
    if (atLineStart && (markdown.startsWith("```", index) || markdown.startsWith("~~~", index))) {
      const fenceChar = markdown[index];
      let fenceLength = 0;
      while (markdown[index + fenceLength] === fenceChar) fenceLength += 1;
      const fence = markdown.slice(index, index + fenceLength);
      let cursor = markdown.indexOf("\n", index);
      cursor = cursor < 0 ? markdown.length : cursor + 1;
      let close = -1;
      while (cursor <= markdown.length) {
        const next = markdown.indexOf("\n", cursor);
        const lineEnd = next < 0 ? markdown.length : next;
        const line = markdown.slice(cursor, lineEnd).trim();
        const fenceOnly = line.length >= fenceLength && [...line].every((char) => char === fenceChar);
        if (fenceOnly && line.startsWith(fence)) {
          close = next < 0 ? markdown.length : next + 1;
          break;
        }
        if (next < 0) break;
        cursor = next + 1;
      }
      const end = close < 0 ? markdown.length : close;
      output += markdown.slice(index, end);
      index = end;
      continue;
    }

    if (markdown[index] === "`") {
      let ticks = 0;
      while (markdown[index + ticks] === "`") ticks += 1;
      const token = "`".repeat(ticks);
      const close = markdown.indexOf(token, index + ticks);
      if (close < 0) {
        output += markdown.slice(index);
        break;
      }
      const end = close + ticks;
      output += markdown.slice(index, end);
      index = end;
      continue;
    }

    if (atLineStart && markdown.startsWith("$$", index) && !isEscaped(markdown, index)) {
      const lineBreak = markdown.indexOf("\n", index);
      const lineEnd = lineBreak < 0 ? markdown.length : lineBreak;
      const line = markdown.slice(index, lineEnd).trim();
      const sameLine = /^\$\$([\s\S]*?)\$\$$/u.exec(line);
      if (sameLine?.[1]?.trim()) {
        output += blockMathHtml(sameLine[1].trim());
        index = lineBreak < 0 ? markdown.length : lineBreak + 1;
        continue;
      }
      if (line === "$$") {
        const close = findClosingDelimiter(markdown, "$$", lineEnd + 1);
        const latex = close >= 0 ? markdown.slice(lineEnd + 1, close).trim() : "";
        const after = close + 2;
        const nextBreak = close >= 0 ? markdown.indexOf("\n", after) : -1;
        const restOfLine = close >= 0
          ? markdown.slice(after, nextBreak < 0 ? markdown.length : nextBreak).trim()
          : "kept";
        if (latex && restOfLine === "") {
          output += blockMathHtml(latex);
          index = nextBreak < 0 ? markdown.length : nextBreak + 1;
          continue;
        }
      }
    }

    if (markdown[index] === "$" && !markdown.startsWith("$$", index) && !isEscaped(markdown, index)) {
      const close = findClosingDelimiter(markdown, "$", index + 1);
      if (close > index && markdown[close + 1] !== "$") {
        const latex = markdown.slice(index + 1, close).trim();
        if (latex && !latex.includes("\n") && !isPureCurrency(latex)) {
          output += inlineMathHtml(latex);
          index = close + 1;
          continue;
        }
        if (latex && isPureCurrency(latex)) {
          output += markdown.slice(index, close + 1);
          index = close + 1;
          continue;
        }
      }
    }

    output += markdown[index];
    index += 1;
  }
  return output;
};

const renderKatexHtml = (latex: string, displayMode: boolean) => {
  const trimmed = latex.trim();
  if (!trimmed) return "";
  try {
    return katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      strict: "warn",
      trust: false,
      output: "html",
    });
  } catch {
    return "";
  }
};

const mountMath = (latex: string, kind: "inline" | "block", metrics: WeChatMetrics) => {
  const host = document.createElement("span");
  host.setAttribute("data-ee-math", kind);
  host.setAttribute("data-latex", latex.trim());
  const codeSize = `${noteProseCodeFontSize(metrics.fontSize)}px`;
  const html = renderKatexHtml(latex, kind === "block");
  host.style.cssText = kind === "block"
    ? `display: block; margin: 16px 0; text-align: center; font-size: ${codeSize}; color: ${BODY_COLOR};`
    : `font-size: ${codeSize}; color: ${BODY_COLOR};`;
  if (html) host.innerHTML = html;
  else host.textContent = latex.trim();
  return host;
};

const collectTextNodes = (root: Node) => {
  const nodes: Text[] = [];
  const visit = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) nodes.push(child as Text);
      else visit(child);
    });
  };
  visit(root);
  return nodes;
};

type MathPiece = string | { kind: "inline" | "block"; latex: string };

const splitMathText = (source: string): MathPiece[] => {
  const parts: MathPiece[] = [];
  let cursor = 0;
  let plainStart = 0;
  const pushPlain = (end: number) => {
    if (end > plainStart) parts.push(source.slice(plainStart, end));
  };
  while (cursor < source.length) {
    if (source[cursor] !== "$" || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }
    if (source.startsWith("$$", cursor)) {
      const close = findClosingDelimiter(source, "$$", cursor + 2);
      const latex = close >= 0 ? source.slice(cursor + 2, close).trim() : "";
      if (!latex) {
        cursor += 2;
        continue;
      }
      pushPlain(cursor);
      parts.push({ kind: "block", latex });
      cursor = close + 2;
      plainStart = cursor;
      continue;
    }
    const close = findClosingDelimiter(source, "$", cursor + 1);
    if (close < 0 || source[close + 1] === "$") {
      cursor += 1;
      continue;
    }
    const latex = source.slice(cursor + 1, close).trim();
    if (!latex || latex.includes("\n") || isPureCurrency(latex)) {
      if (latex && isPureCurrency(latex)) {
        cursor = close + 1;
        continue;
      }
      cursor += 1;
      continue;
    }
    pushPlain(cursor);
    parts.push({ kind: "inline", latex });
    cursor = close + 1;
    plainStart = cursor;
  }
  pushPlain(source.length);
  return parts;
};

const replaceMathNodes = (root: HTMLElement, metrics: WeChatMetrics) => {
  root.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]').forEach((node) => {
    const latex = node.getAttribute("data-latex") ?? "";
    if (!latex.trim()) return;
    const kind = node.getAttribute("data-type") === "block-math" ? "block" : "inline";
    node.replaceWith(mountMath(latex, kind, metrics));
  });

  for (const node of collectTextNodes(root)) {
    const parent = node.parentElement;
    if (!parent || parent.closest("pre, code, [data-ee-math], .katex")) continue;
    if (!node.data.includes("$")) continue;
    const parts = splitMathText(node.data);
    if (parts.length === 1 && typeof parts[0] === "string") continue;
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (typeof part === "string") fragment.append(document.createTextNode(part));
      else fragment.append(mountMath(part.latex, part.kind, metrics));
    }
    node.replaceWith(fragment);
  }
};

const convertTaskLists = (root: HTMLElement, accent: string | null) => {
  const markerColor = accent || "#1a1d21";
  const items = new Set<HTMLElement>();
  root.querySelectorAll<HTMLElement>('li[data-checked], li[data-type="taskItem"]').forEach((item) => items.add(item));
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    const item = input.closest("li");
    if (item) items.add(item);
  });

  items.forEach((item) => {
    const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const flag = item.getAttribute("data-checked");
    const checked = flag === "true" || (flag !== "false" && Boolean(input?.hasAttribute("checked") || input?.checked));
    item.querySelectorAll('input[type="checkbox"]').forEach((box) => box.remove());
    item.querySelectorAll("label").forEach((label) => {
      if (!label.textContent?.trim()) label.remove();
    });
    const marker = document.createElement("span");
    marker.setAttribute("data-ee-task", checked ? "checked" : "open");
    marker.textContent = checked ? "☑ " : "☐ ";
    marker.style.cssText = `color: ${markerColor}; text-decoration: none; font-weight: 400;`;
    const paragraph = item.querySelector("p");
    const target = paragraph ?? item;
    target.insertBefore(marker, target.firstChild);
    if (checked) {
      target.style.color = CHECKED_TASK_COLOR;
      target.style.textDecoration = "line-through";
    }
    item.style.listStyle = "none";
    const list = item.parentElement;
    if (list && (list.tagName === "UL" || list.tagName === "OL")) {
      const kept = list.style.cssText
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !/^(list-style|padding-left)\b/i.test(part));
      list.style.cssText = `${kept.join("; ")}; list-style: none; padding-left: 0;`;
    }
  });
};

const classNamesOf = (properties?: { className?: string | string[] }) => {
  const value = properties?.className;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const tokenStyle = (classNames: string[]) => {
  if (classNames.includes("hljs-variable") && classNames.includes("language_")) return "color: #d73a49;";
  let color = "";
  for (const name of classNames) {
    const next = HLJS_COLORS[name];
    if (next) color = next;
  }
  if (!color) return "";
  let style = `color: ${color};`;
  if (classNames.includes("hljs-section") || classNames.includes("hljs-strong")) style += " font-weight: 700;";
  if (classNames.includes("hljs-emphasis")) style += " font-style: italic;";
  if (classNames.includes("hljs-addition")) style += " background-color: #f0fff4;";
  if (classNames.includes("hljs-deletion")) style += " background-color: #ffeef0;";
  return style;
};

const appendHast = (parent: Node, node: HastNode) => {
  if (node.type === "text") {
    parent.appendChild(document.createTextNode(node.value ?? ""));
    return;
  }
  if (node.type === "root") {
    node.children?.forEach((child) => appendHast(parent, child));
    return;
  }
  if (node.type !== "element") return;
  const element = document.createElement(node.tagName || "span");
  const style = tokenStyle(classNamesOf(node.properties));
  if (style) element.setAttribute("style", style);
  node.children?.forEach((child) => appendHast(element, child));
  parent.appendChild(element);
};

const languageOf = (code: HTMLElement) => {
  const named = code.className.split(/\s+/u).find((item) => item.startsWith("language-"));
  if (!named) return null;
  const raw = named.slice("language-".length).toLowerCase();
  if (!raw || raw === "mermaid" || raw === "plaintext" || raw === "text" || raw === "none") return null;
  if (raw === "sh" || raw === "zsh") return "bash";
  if (raw === "yml") return "yaml";
  return raw;
};

const highlightCodeForWeChat = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>("pre > code").forEach((code) => {
    const language = languageOf(code);
    if (!language || !publishLowlight.registered(language)) return;
    const source = code.textContent ?? "";
    if (!source.trim()) return;
    try {
      const tree = publishLowlight.highlight(language, source) as HastNode;
      code.replaceChildren();
      appendHast(code, tree);
      code.style.color = "#24292e";
    } catch {
      // Leave the source readable when the grammar rejects it.
    }
  });
};

const neutralizeWeChatTopics = (root: HTMLElement) => {
  for (const node of collectTextNodes(root)) {
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-ee-math], .katex")) continue;
    if (!node.data.includes("#")) continue;
    node.data = node.data.replace(/#(?=[\p{L}\p{N}_])/gu, "#\u200b");
  }
};

const WECHAT_CONTENT_WIDTH = 677;

/**
 * html-to-image copies the target's computed position into the SVG snapshot.
 * A `position: fixed; left: -10000px` target is painted outside that SVG, so
 * WeChat receives a blank PNG and the formula looks missing. Park the offset
 * on a wrapper and snapshot an in-flow mount, same as note-image export.
 */
const placeMathRasterMount = (host: HTMLElement, kind: "inline" | "block") => {
  const sandbox = document.createElement("div");
  sandbox.setAttribute("aria-hidden", "true");
  sandbox.style.cssText = "position: fixed; left: -10000px; top: 0; pointer-events: none;";
  const mount = host.cloneNode(true) as HTMLElement;
  mount.style.position = "static";
  mount.style.left = "auto";
  mount.style.top = "auto";
  mount.style.zIndex = "auto";
  mount.style.margin = "0";
  mount.style.transform = "none";
  mount.style.background = "#ffffff";
  mount.style.color = BODY_COLOR;
  mount.style.display = "inline-block";
  mount.style.width = "max-content";
  mount.style.maxWidth = "none";
  mount.style.padding = kind === "block" ? "8px 4px" : "2px 2px";
  mount.style.boxSizing = "content-box";
  sandbox.appendChild(mount);
  document.body.appendChild(sandbox);
  return { sandbox, mount };
};

const canvasHasInk = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] ?? 0;
    if (alpha < 16) continue;
    const red = data[index] ?? 255;
    const green = data[index + 1] ?? 255;
    const blue = data[index + 2] ?? 255;
    if (red < 250 || green < 250 || blue < 250) return true;
  }
  return false;
};

const rasterizeMathForWeChat = async (root: HTMLElement) => {
  const hosts = Array.from(root.querySelectorAll<HTMLElement>("[data-ee-math]"));
  if (hosts.length === 0) return;
  for (const host of hosts) {
    const kind = host.getAttribute("data-ee-math") === "block" ? "block" : "inline";
    const latex = host.getAttribute("data-latex") || host.textContent || "";
    if (!host.querySelector(".katex")) continue;
    const { sandbox, mount } = placeMathRasterMount(host, kind);
    try {
      await document.fonts?.ready;
      const canvas = await toCanvas(mount, {
        backgroundColor: "#ffffff",
        cacheBust: false,
        pixelRatio: 2,
        style: {
          position: "static",
          left: "0px",
          top: "0px",
          margin: "0px",
          transform: "none",
        },
      });
      if (canvas.width < 2 || canvas.height < 2 || !canvasHasInk(canvas)) continue;
      const cssWidth = Math.max(1, Math.round(canvas.width / 2));
      const cssHeight = Math.max(1, Math.round(canvas.height / 2));
      const image = document.createElement("img");
      image.alt = latex.trim();
      image.src = canvas.toDataURL("image/png");
      if (kind === "block") {
        const width = Math.min(cssWidth, WECHAT_CONTENT_WIDTH);
        const height = Math.max(1, Math.round(cssHeight * (width / cssWidth)));
        image.width = width;
        image.height = height;
        image.style.cssText = `display: block; max-width: 100%; width: ${width}px; height: auto; margin: 16px auto; border: 0; border-radius: 0; background: #ffffff;`;
      } else {
        image.width = cssWidth;
        image.height = cssHeight;
        image.style.cssText = `display: inline-block; max-width: 100%; width: ${cssWidth}px; height: ${cssHeight}px; margin: 0 1px; border: 0; border-radius: 0; background: #ffffff; vertical-align: middle;`;
      }
      host.replaceWith(image);
    } catch {
      // Keep the KaTeX HTML so a failed snapshot never drops the formula.
    } finally {
      sandbox.remove();
    }
  }
};

const readCssNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readPaletteColor = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();

export const readEditorCopyContext = (from?: HTMLElement | null) => {
  const container = from?.closest<HTMLElement>("[data-note-palette]")
    ?? from?.closest<HTMLElement>("[data-editor-theme]")
    ?? document.querySelector<HTMLElement>("[data-note-palette], [data-editor-theme]");
  const style = container ? getComputedStyle(container) : null;
  const fontSize = readCssNumber(style?.getPropertyValue("--editor-body-font-size"), DEFAULT_NOTE_PROSE_FONT_SIZE);
  const lineHeight = parseNoteProseLineHeight(style?.getPropertyValue("--editor-body-line-height").trim())
    ?? DEFAULT_NOTE_PROSE_LINE_HEIGHT;
  const palette = container?.dataset.notePalette;
  let colors: NoteProsePaletteColors | null = null;
  if (style && palette && palette !== "native") {
    // Publishing uses a light surface even when the editor is in dark mode.
    const accent = readPaletteColor(style, "--note-palette-light-accent")
      || readPaletteColor(style, "--note-palette-accent");
    const text = readPaletteColor(style, "--note-palette-text");
    if (accent && text) {
      colors = {
        accent,
        text,
        muted: readPaletteColor(style, "--note-palette-muted") || text,
        surface: readPaletteColor(style, "--note-palette-surface") || "#f8fafc",
        divider: readPaletteColor(style, "--note-palette-divider") || "#e5e7eb",
        link: readPaletteColor(style, "--note-palette-link") || accent,
        codeBackground: readPaletteColor(style, "--note-palette-code-bg") || "#f6f8fa",
        codeText: readPaletteColor(style, "--note-palette-code-text") || text,
        background: readPaletteColor(style, "--note-palette-bg") || "#ffffff",
      };
    }
  }
  const customStyleTag = container?.querySelector<HTMLStyleElement>("style[data-theme-custom-css]");
  return {
    fontSize,
    lineHeight,
    colors,
    accentOnly: Boolean(palette && palette !== "native"),
    customCss: customStyleTag?.dataset.originalCss || "",
  };
};

export const preparePublishArticle = (
  html: string,
  from?: HTMLElement | null,
) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  flattenDetailsForLinearHtml(root);
  const context = readEditorCopyContext(from);
  const metrics = { fontSize: context.fontSize, lineHeight: context.lineHeight };
  applyInlineStyles(
    root,
    metrics,
    context.colors,
    context.customCss,
    context.accentOnly,
  );
  replaceMathNodes(root, metrics);
  convertTaskLists(root, context.colors?.accent ?? null);
  highlightCodeForWeChat(root);
  neutralizeWeChatTopics(root);
  convertImageGalleriesForWeChat(root);
  return root;
};

export const prepareMarkdownPublishArticle = (markdown: string, from?: HTMLElement | null) => {
  const html = marked.parse(embedMarkdownMath(markdown), { async: false, gfm: true, breaks: false });
  if (typeof html !== "string") {
    throw new Error("Markdown parser returned a promise");
  }
  return preparePublishArticle(html, from);
};

export const buildWeChatClipboardHtml = async (editor: Editor) => {
  const container = preparePublishArticle(editor.getHTML(), editor.view.dom);
  await rasterizeMathForWeChat(container);
  await embedMermaidForWeChat(container, editor);
  const originalImages = Array.from(editor.view.dom.querySelectorAll<HTMLImageElement>("img")).filter(isContentImage);
  await embedImagesForWeChat(container, originalImages);
  await rasterizePublishOrnamentsForWeChat(container);
  return container.outerHTML;
};

export const copyEditorToWeChat = async (editor: Editor) =>
  copyHtmlToClipboard(await buildWeChatClipboardHtml(editor), editor.getText({ blockSeparator: "\n" }));

export const buildMarkdownWeChatHtml = async (markdown: string) => {
  const container = prepareMarkdownPublishArticle(markdown);
  await rasterizeMathForWeChat(container);
  await embedMermaidForWeChat(container);
  await embedImagesForWeChat(container);
  await rasterizePublishOrnamentsForWeChat(container);
  return { html: container.outerHTML, text: container.textContent ?? "" };
};

export const copyMarkdownToWeChat = async (markdown: string) => {
  const { html, text } = await buildMarkdownWeChatHtml(markdown);
  await copyHtmlToClipboard(html, text);
};
