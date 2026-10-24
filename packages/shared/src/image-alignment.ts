import { Extension, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { parseImageWidth } from "./image-display";

export const IMAGE_ALIGNMENTS = ["left", "center", "right"] as const;
export type ImageAlignment = (typeof IMAGE_ALIGNMENTS)[number];

export const parseImageAlignment = (value: unknown): ImageAlignment | null =>
  IMAGE_ALIGNMENTS.includes(value as ImageAlignment) ? value as ImageAlignment : null;

export const imageAlignmentMargins = (value: unknown) => {
  const alignment = parseImageAlignment(value) ?? "left";
  return {
    marginLeft: alignment === "left" ? "0" : "auto",
    marginRight: alignment === "right" ? "0" : "auto",
  };
};

export const imageAlignmentStyle = (value: unknown, widthValue?: unknown) => {
  const margins = imageAlignmentMargins(value);
  const width = parseImageWidth(widthValue);
  return `display: block; margin-left: ${margins.marginLeft}; margin-right: ${margins.marginRight}${width === null ? "" : `; width: ${width}%`}`;
};

/** Native figure views keep their legacy layout until an alignment is explicit. */
export const applyImageAlignment = (element: HTMLElement, value: unknown) => {
  const alignment = parseImageAlignment(value);
  if (!alignment) {
    if (element.dataset.imageAlign) {
      delete element.dataset.imageAlign;
      element.style.removeProperty("margin-left");
      element.style.removeProperty("margin-right");
    }
    return;
  }
  element.dataset.imageAlign = alignment;
  Object.assign(element.style, imageAlignmentMargins(alignment));
};

// Register against every image implementation, including custom native views.
export const ImageAlignmentAttributes = Extension.create({
  name: "imageAlignment",
  addGlobalAttributes() {
    return [{ types: ["image"], attributes: {
      alignment: {
        default: null,
        parseHTML: (element) => parseImageAlignment(element.getAttribute("data-image-align")),
        renderHTML: (attributes) => {
          const alignment = parseImageAlignment(attributes.alignment);
          const width = parseImageWidth(attributes.width);
          return alignment ? {
            "data-image-align": alignment,
            ...(width === null ? {} : { "data-width": String(width) }),
            style: imageAlignmentStyle(alignment, width),
          } : {};
        },
      },
    } }];
  },
});

const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const decodeAttribute = (value: string) => value.replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");

export const readImageHtmlAttribute = (source: string, name: string) => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(source);
  return decodeAttribute(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
};

const supportedImageSource = (source: string) => {
  // oxlint-disable-next-line no-control-regex -- do not accept executable or ambiguous URL schemes
  if (!source || /[\u0000-\u0020]/.test(source)) return false;
  return /^(?:https?:\/\/|edgeever-resource:\/\/|edgeever-staged:\/\/|\/(?!\/))/i.test(source);
};

/** HTML keeps the alignment useful in exports outside EdgeEver, too. */
export const alignedImageToHtml = (node: JSONContent): string => {
  const attrs = node.attrs ?? {};
  const alignment = parseImageAlignment(attrs.alignment) ?? "left";
  const width = parseImageWidth(attrs.width);
  const attribute = (key: string, value: unknown) => `${key}="${escapeAttribute(String(value ?? ""))}"`;
  const values = [attribute("src", attrs.src), attribute("alt", attrs.alt)];
  if (attrs.title) values.push(attribute("title", attrs.title));
  values.push(attribute("data-image-align", alignment));
  if (width !== null) values.push(attribute("width", `${width}%`));
  const style = imageAlignmentStyle(alignment, width);
  values.push(attribute("style", style));
  return `<img ${values.join(" ")} />`;
};

export const EdgeEverImage = Image.extend({
  renderMarkdown(node, helpers, context) {
    return parseImageAlignment(node.attrs?.alignment)
      ? alignedImageToHtml(node)
      : this.parent?.(node, helpers, context) ?? "";
  },
  parseMarkdown(token, helpers) {
    return token.imageAttributes
      ? helpers.createNode("image", token.imageAttributes)
      : this.parent?.(token, helpers) ?? [];
  },
  markdownTokenizer: {
    name: "image",
    level: "block",
    start: (source) => source.search(/<img\b/i),
    tokenize(source) {
      const match = /^<img\b(?:[^"'>]|"[^"]*"|'[^']*')*\/?>[ \t]*(?:\n|$)/i.exec(source);
      if (!match) return undefined;
      const tag = match[0];
      const alignment = parseImageAlignment(readImageHtmlAttribute(tag, "data-image-align"));
      const src = readImageHtmlAttribute(tag, "src");
      if (!alignment || !supportedImageSource(src)) return undefined;
      return { type: "image", raw: tag, imageAttributes: {
        src, alignment,
        alt: readImageHtmlAttribute(tag, "alt") || null,
        title: readImageHtmlAttribute(tag, "title") || null,
        width: parseImageWidth(readImageHtmlAttribute(tag, "width")),
      } };
    },
  },
});
