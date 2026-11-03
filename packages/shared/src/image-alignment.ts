import { Extension, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { isAllowedUri } from "@tiptap/extension-link";
import { resourceNodeToMarkdown } from "./resource-links";
import { parseImageWidth } from "./image-display";
import { openBlockSource } from "./markdown-block-start";
import { getImageLink } from "./image-link";

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
const LINKED_IMAGE_HTML = /<a\b((?:[^"'>]|"[^"]*"|'[^']*')*)>\s*(<img\b(?:[^"'>]|"[^"]*"|'[^']*')*\/?>)\s*<\/a>[ \t]*(?:\n|$)/i;

/** HTML keeps the alignment useful in exports outside EdgeEver, too. */
export const alignedImageToHtml = (node: JSONContent): string => {
  const attrs = node.attrs ?? {};
  const alignment = parseImageAlignment(attrs.alignment) ?? "left";
  const width = parseImageWidth(attrs.width);
  const attribute = (key: string, value: unknown) => `${key}="${escapeAttribute(String(value ?? ""))}"`;
  const values = [attribute("src", attrs.src), attribute("alt", attrs.alt)];
  const link = getImageLink(attrs.link);
  if (link) {
    values.push(attribute("data-image-link-href", link.href));
    if (link.title) values.push(attribute("data-image-link-title", link.title));
  }
  if (attrs.title) values.push(attribute("title", attrs.title));
  values.push(attribute("data-image-align", alignment));
  if (width !== null) values.push(attribute("width", `${width}%`));
  const style = imageAlignmentStyle(alignment, width);
  values.push(attribute("style", style));
  const image = `<img ${values.join(" ")} />`;
  return link && isAllowedUri(link.href)
    ? `<a ${attribute("href", link.href)}${link.title ? ` ${attribute("title", link.title)}` : ""}>${image}</a>`
    : image;
};

export const EdgeEverImage = Image.extend({
  renderMarkdown(node) {
    if (parseImageAlignment(node.attrs?.alignment)) return alignedImageToHtml(node);
    const link = getImageLink(node.attrs?.link);
    const image = { type: "image" as const, url: String(node.attrs?.src ?? ""), alt: String(node.attrs?.alt ?? ""), title: typeof node.attrs?.title === "string" ? node.attrs.title : null };
    return resourceNodeToMarkdown(link ? { type: "link", url: link.href, title: link.title, children: [image] } : image);
  },
  parseMarkdown(token, helpers) {
    if (token.imageAttributes) return helpers.createNode("image", token.imageAttributes);
    // Marked already unescapes brackets, but leaves backslash escapes in text.
    // Read literal lexer tokens; parsing alt as rich content would consume math.
    const alt = token.tokens?.map(part => part.type === "escape" ? part.text : part.raw ?? part.text ?? "").join("") ?? token.text;
    return helpers.createNode("image", {
      src: token.href, title: token.title,
      alt,
    });
  },
  markdownTokenizer: {
    name: "image",
    level: "block",
    start: (source) => {
      const open = openBlockSource(source);
      const image = open.search(/<img\b/i);
      const linked = LINKED_IMAGE_HTML.exec(open)?.index ?? -1;
      return image === -1 ? linked : linked === -1 ? image : Math.min(image, linked);
    },
    tokenize(source) {
      const candidate = LINKED_IMAGE_HTML.exec(source);
      const wrapped = candidate?.index === 0 ? candidate : null;
      const match = wrapped ?? /^<img\b(?:[^"'>]|"[^"]*"|'[^']*')*\/?>[ \t]*(?:\n|$)/i.exec(source);
      if (!match) return undefined;
      const tag = wrapped?.[2] ?? match[0];
      const alignment = parseImageAlignment(readImageHtmlAttribute(tag, "data-image-align"));
      const src = readImageHtmlAttribute(tag, "src");
      const link = getImageLink({
        href: readImageHtmlAttribute(tag, "data-image-link-href") || (wrapped ? readImageHtmlAttribute(wrapped[1]!, "href") : ""),
        title: readImageHtmlAttribute(tag, "data-image-link-title") || (wrapped ? readImageHtmlAttribute(wrapped[1]!, "title") : "") || null,
      });
      if ((!alignment && !link) || !supportedImageSource(src)) return undefined;
      return { type: "image", raw: match[0], imageAttributes: {
        src, alignment,
        ...(link ? { link } : {}),
        alt: readImageHtmlAttribute(tag, "alt") || null,
        title: readImageHtmlAttribute(tag, "title") || null,
        width: parseImageWidth(readImageHtmlAttribute(tag, "width")),
      } };
    },
  },
});
