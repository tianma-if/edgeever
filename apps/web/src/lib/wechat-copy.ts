import type { Editor } from "@tiptap/react";
import { MEMO_CONTENT_STYLE } from "@edgeever/shared";
import { marked } from "marked";
import { MERMAID_THEME_PALETTES } from "@/components/ThemeProvider";
import { copyHtmlToClipboard } from "@/lib/clipboard";
import { parseCustomCssToStyles } from "@/lib/css-sandbox";

const BODY_LINE_HEIGHT = MEMO_CONTENT_STYLE.body.lineHeight / MEMO_CONTENT_STYLE.body.fontSize;
const BODY_FONT_SIZE = `${MEMO_CONTENT_STYLE.body.fontSize}px`;
const PARAGRAPH_SPACING = `${MEMO_CONTENT_STYLE.body.paragraphSpacing}px`;

const WECHAT_STYLES: Record<string, string> = {
  p: `margin: 0 0 ${PARAGRAPH_SPACING}; padding: 0; line-height: ${BODY_LINE_HEIGHT}; font-size: ${BODY_FONT_SIZE}; color: #333;`,
  h1: "margin: 1.2em 0 0.6em; font-size: 24px; line-height: 1.35; font-weight: 700; color: #1f2937;",
  h2: "margin: 1.1em 0 0.55em; font-size: 21px; line-height: 1.4; font-weight: 700; color: #1f2937;",
  h3: "margin: 1em 0 0.5em; font-size: 18px; line-height: 1.45; font-weight: 700; color: #1f2937;",
  blockquote: `margin: 1em 0; padding: 0.6em 1em; border-left: 4px solid #10b981; background: #f0fdf4; color: #4b5563; line-height: ${BODY_LINE_HEIGHT};`,
  ul: `margin: 0 0 1em; padding-left: 1.6em; line-height: ${BODY_LINE_HEIGHT};`,
  ol: `margin: 0 0 1em; padding-left: 1.6em; line-height: ${BODY_LINE_HEIGHT};`,
  li: `margin: 0.25em 0; line-height: ${BODY_LINE_HEIGHT};`,
  a: "color: #059669; text-decoration: underline;",
  strong: "font-weight: 700;",
  em: "font-style: italic;",
  del: "text-decoration: line-through;",
  code: "padding: 0.15em 0.35em; border-radius: 3px; background: #f3f4f6; color: #be123c; font-family: Menlo, Consolas, monospace; font-size: 0.9em;",
  pre: "margin: 1em 0; padding: 12px 14px; overflow: hidden; border-radius: 6px; background: #f6f8fa; color: #24292f; line-height: 1.6; text-align: left;",
  hr: "margin: 1.5em 0; border: 0; border-top: 1px solid #e5e7eb;",
  table: "width: 100%; margin: 1em 0; border-collapse: collapse; font-size: 14px; line-height: 1.6;",
  th: "padding: 8px; border: 1px solid #d1d5db; background: #f3f4f6; font-weight: 700; text-align: left;",
  td: "padding: 8px; border: 1px solid #d1d5db; text-align: left;",
  img: "display: block; max-width: 100%; height: auto; margin: 1em auto;",
};

const THEME_BLOCK_LABELS: Record<string, string> = {
  intro: "引言",
  "key-point": "重点观点",
  callout: "提示",
  chapter: "章节",
};

const THEME_BLOCK_STYLES: Record<string, { block: string; label: string }> = {
  intro: {
    block: "margin: 20px 0; padding: 0 0 4px; border-left: 5px solid #059669; background: #f0fdf4; color: #374151;",
    label: "padding: 10px 14px 0; color: #059669; font-size: 12px; font-weight: 700; letter-spacing: 1px;",
  },
  "key-point": {
    block: "margin: 20px 0; padding: 0 0 4px; border: 1px solid #a7f3d0; border-radius: 8px; background: #f0fdf4; color: #374151;",
    label: "padding: 10px 14px 0; color: #047857; font-size: 12px; font-weight: 700; letter-spacing: 1px;",
  },
  callout: {
    block: "margin: 20px 0; padding: 0 0 4px; border: 1px dashed #6ee7b7; background: #ecfdf5; color: #374151;",
    label: "padding: 10px 14px 0; color: #059669; font-size: 12px; font-weight: 700; letter-spacing: 1px;",
  },
  chapter: {
    block: "margin: 28px 0 16px; padding: 0 0 4px; border-top: 3px solid #059669; color: #111827;",
    label: "padding: 10px 0 0; color: #059669; font-size: 12px; font-weight: 700; letter-spacing: 2px;",
  },
};

const applyInlineStyles = (
  root: HTMLElement,
  editorTheme?: string,
  customColors?: { bg: string; text: string; accent: string; soft: string; codeBackground: string; border: string } | null,
  customCss?: string
) => {
  const textColor = customColors ? customColors.text : "#333";
  const bgColors = customColors ? customColors.bg : "#ffffff";
  const accent = customColors ? customColors.accent : "#059669";
  const soft = customColors ? customColors.soft : "#f0fdfa";
  const codeBackground = customColors ? customColors.codeBackground : "#f6f8fa";
  const border = customColors ? customColors.border : "#e5e7eb";

  const customStyles = customCss ? parseCustomCssToStyles(customCss) : null;

  root.style.cssText = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: ${BODY_FONT_SIZE}; line-height: ${BODY_LINE_HEIGHT}; color: ${textColor}; background-color: ${bgColors}; word-break: break-word;`;

  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    let style = WECHAT_STYLES[tagName] || "";
    const isMergeDivider =
      tagName === "hr" && element.matches("[data-edgeever-merge-divider], .edgeever-merge-divider");

    if (isMergeDivider) {
      style = `margin: 1.75em 0; border: 0; border-top: 2px solid ${accent};`;
    } else if (customColors) {
      if (tagName === "p") {
        style = `margin: 0 0 ${PARAGRAPH_SPACING}; padding: 0; line-height: ${BODY_LINE_HEIGHT}; font-size: ${BODY_FONT_SIZE}; color: ${textColor};`;
      } else if (tagName === "h1" || tagName === "h2" || tagName === "h3") {
        style = style.replace("color: #1f2937;", `color: ${textColor};`);
      } else if (tagName === "blockquote") {
        style = `margin: 1em 0; padding: 0.6em 1em; border-left: 4px solid ${accent}; background: ${soft}; color: ${textColor}; line-height: ${BODY_LINE_HEIGHT};`;
      } else if (tagName === "a") {
        style = `color: ${accent}; text-decoration: underline;`;
      } else if (tagName === "code") {
        style = `padding: 0.15em 0.35em; border-radius: 3px; background: ${codeBackground}; color: ${textColor}; font-family: Menlo, Consolas, monospace; font-size: 0.9em;`;
      } else if (tagName === "pre") {
        style = `margin: 1em 0; padding: 12px 14px; overflow: hidden; border-radius: 6px; background: ${codeBackground}; color: ${textColor}; line-height: 1.6; text-align: left;`;
      } else if (tagName === "hr") {
        style = `margin: 1.5em 0; border: 0; border-top: 1px solid ${border};`;
      } else if (tagName === "th") {
        style = `padding: 8px; border: 1px solid ${border}; background: ${soft}; font-weight: 700; text-align: left; color: ${textColor};`;
      } else if (tagName === "td") {
        style = `padding: 8px; border: 1px solid ${border}; text-align: left; color: ${textColor};`;
      }
    }

    if (customStyles && customStyles[tagName]) {
      style = `${style} ${customStyles[tagName]}`;
    }

    if (style) element.style.cssText = `${style}${element.style.cssText}`;
  });

  root.querySelectorAll<HTMLElement>("p").forEach((paragraph) => {
    paragraph.style.margin = `0 0 ${PARAGRAPH_SPACING}`;
    paragraph.style.padding = "0";
    paragraph.style.lineHeight = String(BODY_LINE_HEIGHT);
  });

  root.querySelectorAll<HTMLElement>("ul, ol, li, blockquote").forEach((bodyBlock) => {
    bodyBlock.style.lineHeight = String(BODY_LINE_HEIGHT);
  });

  root.querySelectorAll<HTMLElement>("pre code").forEach((element) => {
    element.style.cssText = "padding: 0; background: transparent; color: inherit; font-family: Menlo, Consolas, monospace; font-size: 13px; white-space: pre-wrap;";
  });

  root.querySelectorAll<HTMLElement>("[data-edgeever-theme-block]").forEach((block) => {
    const kind = block.getAttribute("data-theme-block-kind") || "intro";
    const themeStyles = THEME_BLOCK_STYLES[kind] || THEME_BLOCK_STYLES.intro;
    
    let blockStyle = themeStyles.block;
    let labelStyle = themeStyles.label;

    if (customColors) {
      if (kind === "intro") {
        blockStyle = `margin: 20px 0; padding: 0 0 4px; border-left: 5px solid ${accent}; background: ${soft}; color: ${textColor};`;
        labelStyle = `padding: 10px 14px 0; color: ${accent}; font-size: 12px; font-weight: 700; letter-spacing: 1px;`;
      } else if (kind === "key-point") {
        blockStyle = `margin: 20px 0; padding: 0 0 4px; border: 1px solid ${border}; border-radius: 8px; background: ${soft}; color: ${textColor};`;
        labelStyle = `padding: 10px 14px 0; color: ${accent}; font-size: 12px; font-weight: 700; letter-spacing: 1px;`;
      } else if (kind === "callout") {
        blockStyle = `margin: 20px 0; padding: 0 0 4px; border: 1px dashed ${border}; background: ${soft}; color: ${textColor};`;
        labelStyle = `padding: 10px 14px 0; color: ${accent}; font-size: 12px; font-weight: 700; letter-spacing: 1px;`;
      } else if (kind === "chapter") {
        blockStyle = `margin: 28px 0 16px; padding: 0 0 4px; border-top: 3px solid ${accent}; color: ${textColor};`;
        labelStyle = `padding: 10px 0 0; color: ${accent}; font-size: 12px; font-weight: 700; letter-spacing: 2px;`;
      }
    } else {
      blockStyle = `${blockStyle} border-left-color: ${accent};`;
      labelStyle = `${labelStyle} color: ${accent};`;
    }

    block.style.cssText = `${blockStyle}${block.style.cssText}`;

    const label = document.createElement("p");
    label.textContent = THEME_BLOCK_LABELS[kind] || "主题组件";
    label.style.cssText = `${labelStyle} margin: 0;`;
    block.insertBefore(label, block.firstChild);
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

const svgToPng = async (svg: string) => {
  const size = getSvgSize(svg);
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return {
      blob: await rasterizeImageElement(image, 2),
      ...size,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const renderMermaidSvg = async (source: string) => {
  const { renderMermaidSVG, THEMES } = await import("beautiful-mermaid");
  return renderMermaidSVG(source, {
    ...THEMES["zinc-light"],
    ...MERMAID_THEME_PALETTES["zinc-light"],
    transparent: true,
    font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: 24,
  });
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
      const renderedSvg = renderedBlocks[index]?.querySelector("svg")?.outerHTML;
      const svg = renderedSvg || await renderMermaidSvg(source);
      const image = document.createElement("img");
      const { blob, width, height } = await svgToPng(svg);
      image.src = await blobToDataUrl(blob);
      image.width = Math.round(width);
      image.height = Math.round(height);
      image.alt = "Mermaid diagram";
      image.style.cssText = "display: block; width: auto; max-width: 100%; height: auto; max-height: 30rem; object-fit: contain; margin: 1em auto;";
      pre.replaceWith(image);
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

const embedImagesForWeChat = async (root: HTMLElement, originalImages: HTMLImageElement[] = []) => {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map(async (image, index) => {
    const source = image.getAttribute("src")?.trim();
    if (!source || source.startsWith("data:")) {
      return;
    }

    try {
      const originalImage = originalImages[index];
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
    } catch (error) {
      // Never put a private same-origin URL into the clipboard: WeChat cannot access it.
      if (isSameOrigin(source)) {
        throw error;
      }
      // External images may still be reachable by the WeChat editor.
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

export const buildWeChatClipboardHtml = async (editor: Editor) => {
  const container = document.createElement("div");
  container.innerHTML = editor.getHTML();
  
  const closestContainer = editor.view.dom.closest<HTMLElement>("[data-editor-theme]");
  const editorTheme = closestContainer?.dataset.editorTheme;
  
  let customColors: { bg: string; text: string; accent: string; soft: string; codeBackground: string; border: string } | null = null;
  if (closestContainer && editorTheme === "custom") {
    const colors = getComputedStyle(closestContainer);
    customColors = {
      bg: colors.getPropertyValue("--editor-theme-bg") || "#ffffff",
      text: colors.getPropertyValue("--editor-theme-text") || "#1f2937",
      accent: colors.getPropertyValue("--editor-theme-accent") || "#059669",
      soft: colors.getPropertyValue("--editor-theme-soft") || "#ecfdf5",
      codeBackground: colors.getPropertyValue("--editor-theme-code-bg") || "#e0ece9",
      border: colors.getPropertyValue("--editor-theme-border") || "#a7f3d0",
    };
  }

  const customStyleTag = closestContainer?.querySelector<HTMLStyleElement>("style[data-theme-custom-css]");
  const customCss = customStyleTag?.dataset.originalCss || "";

  applyInlineStyles(container, editorTheme, customColors, customCss);
  convertImageGalleriesForWeChat(container);
  await embedMermaidForWeChat(container, editor);
  const originalImages = Array.from(editor.view.dom.querySelectorAll<HTMLImageElement>("img"));
  await embedImagesForWeChat(container, originalImages);
  return container.outerHTML;
};

export const copyEditorToWeChat = async (editor: Editor) =>
  copyHtmlToClipboard(await buildWeChatClipboardHtml(editor), editor.getText({ blockSeparator: "\n" }));

export const copyMarkdownToWeChat = async (markdown: string) => {
  const container = document.createElement("div");
  container.innerHTML = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  
  const closestContainer = document.querySelector<HTMLElement>("[data-editor-theme]");
  const editorTheme = closestContainer?.dataset.editorTheme;
  
  let customColors: { bg: string; text: string; accent: string; soft: string; codeBackground: string; border: string } | null = null;
  if (closestContainer && editorTheme === "custom") {
    const colors = getComputedStyle(closestContainer);
    customColors = {
      bg: colors.getPropertyValue("--editor-theme-bg") || "#ffffff",
      text: colors.getPropertyValue("--editor-theme-text") || "#1f2937",
      accent: colors.getPropertyValue("--editor-theme-accent") || "#059669",
      soft: colors.getPropertyValue("--editor-theme-soft") || "#ecfdf5",
      codeBackground: colors.getPropertyValue("--editor-theme-code-bg") || "#e0ece9",
      border: colors.getPropertyValue("--editor-theme-border") || "#a7f3d0",
    };
  }

  const customStyleTag = closestContainer?.querySelector<HTMLStyleElement>("style[data-theme-custom-css]");
  const customCss = customStyleTag?.dataset.originalCss || "";

  applyInlineStyles(container, editorTheme, customColors, customCss);
  await embedMermaidForWeChat(container);
  await embedImagesForWeChat(container);
  await copyHtmlToClipboard(container.outerHTML, container.textContent ?? "");
};
