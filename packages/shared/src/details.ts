import type { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { resolveAttachmentKind, resolveVideoMimeType } from "./attachment-kind";
import { FILE_ATTACHMENT_NODE_TYPE } from "./file-attachment";
import { parseImageWidth } from "./image-display";
import { alignedImageToHtml, parseImageAlignment, type ImageAlignment } from "./image-alignment";
import { getResourceIdFromUrl } from "./resource-links";

export const DETAILS_NODE_TYPE = "details" as const;
export const DETAILS_SUMMARY_NODE_TYPE = "detailsSummary" as const;
export const DETAILS_CONTENT_NODE_TYPE = "detailsContent" as const;

const DETAILS_OPEN_PATTERN = /^<details\b([^>]*)>/i;
const SUMMARY_PATTERN = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary\s*>\s*/i;
const DETAILS_CONTENT_WRAPPER_PATTERN =
  /^\s*<div\b[^>]*data-type=["']detailsContent["'][^>]*>([\s\S]*)<\/div>\s*$/i;

const collectText = (node: JSONContent | undefined): string => {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((child) => collectText(child)).join("");
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");

const stripHtmlTags = (value: string) => decodeHtmlEntities(value.replace(/<[^>]+>/g, "")).trim();

const findHtmlBlock = (source: string, tag: string) => {
  const open = new RegExp(`^<${tag}\\b([^>]*)>`, "i").exec(source);
  if (!open) return null;

  const openTag = open[0];
  let depth = 1;
  let index = openTag.length;
  const openPattern = new RegExp(`<${tag}\\b`, "ig");
  const closePattern = new RegExp(`</${tag}\\s*>`, "ig");

  while (index < source.length && depth > 0) {
    openPattern.lastIndex = index;
    closePattern.lastIndex = index;
    const nextOpen = openPattern.exec(source);
    const nextClose = closePattern.exec(source);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      index = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    index = nextClose.index + nextClose[0].length;
    if (depth === 0) {
      return {
        raw: source.slice(0, index),
        inner: source.slice(openTag.length, nextClose.index),
      };
    }
  }

  return null;
};

const unwrapDetailsContent = (inner: string) => {
  const match = DETAILS_CONTENT_WRAPPER_PATTERN.exec(inner.trim());
  return match ? match[1] : inner;
};

const HTML_ATTR_PATTERN = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");

const readHtmlAttr = (attrs: string, name: string) => {
  const match = HTML_ATTR_PATTERN(name).exec(attrs);
  return decodeHtmlEntities((match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim());
};

const escapeMarkdownLabel = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

/** http(s) URLs that are not already stored EdgeEver resources. */
const isRemoteHttpUrl = (value: string) => {
  // oxlint-disable-next-line no-control-regex -- rejects URLs containing control characters or whitespace
  if (!value || /[\u0000-\u0020"'<>`]/.test(value)) return false;
  if (getResourceIdFromUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const isDetailsImageSrc = (value: string) => {
  // oxlint-disable-next-line no-control-regex -- rejects image sources containing control characters or whitespace
  if (!value || /[\u0000-\u0020"'<>`]/.test(value)) return false;
  if (value.startsWith("edgeever-resource://") || value.startsWith("edgeever-staged://")) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const readPercentWidth = (raw: string) => {
  const trimmed = raw.trim();
  if (!/^\d+(?:\.\d+)?%$/.test(trimmed)) return null;
  return parseImageWidth(trimmed);
};

type RemoteVideo = {
  src: string;
  label: string;
  filename: string;
  mimeType: string;
};

const remoteVideoFromSrc = (src: string): RemoteVideo | null => {
  const url = src.trim();
  if (!isRemoteHttpUrl(url)) return null;
  let segment = "";
  try {
    segment = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "").trim();
  } catch {
    segment = "";
  }
  if (!segment || segment.length > 120 || /[\\/[\]()<>]/.test(segment)) segment = "";
  const filename = segment || "video";
  return {
    src: url,
    label: `附件：${filename}`,
    filename,
    mimeType: resolveVideoMimeType(null, filename) ?? "video/mp4",
  };
};

type PreparedDetailsBody = {
  markdown: string;
  images: Array<{ src: string; width: number | null; alignment?: ImageAlignment }>;
  videoUrls: string[];
};

const replaceOutsideCodeFences = (
  source: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: Array<string | undefined>) => string,
) => source.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g).map((segment) => {
  if (segment.startsWith("```") || segment.startsWith("~~~")) return segment;
  pattern.lastIndex = 0;
  return segment.replace(pattern, replacer);
}).join("");

/**
 * Other Markdown editors treat the inside of <details> as HTML, so images and
 * remote videos are exchanged as tags. The editor still stores image nodes and
 * the existing video attachment.
 */
const prepareDetailsBody = (source: string): PreparedDetailsBody => {
  const images: PreparedDetailsBody["images"] = [];
  const videoUrls: string[] = [];
  const withoutVideos = replaceOutsideCodeFences(
    source,
    /<video\b([^>]*)>([\s\S]*?)<\/video\s*>|<video\b([^>]*)\/>/gi,
    (_match, openAttrs, _inner, selfClosingAttrs) => {
      const video = remoteVideoFromSrc(readHtmlAttr(openAttrs || selfClosingAttrs || "", "src"));
      if (!video) return "";
      videoUrls.push(video.src);
      return `\n\n[${escapeMarkdownLabel(video.label)}](${video.src})\n\n`;
    },
  );
  const markdown = replaceOutsideCodeFences(
    withoutVideos,
    /<img\b([^>]*)\/?>/gi,
    (tag, attrs) => {
      const src = readHtmlAttr(attrs || "", "src");
      if (!src) return tag;
      const alt = readHtmlAttr(attrs || "", "alt");
      const title = readHtmlAttr(attrs || "", "title");
      const alignment = parseImageAlignment(readHtmlAttr(attrs || "", "data-image-align"));
      images.push({ src, width: readPercentWidth(readHtmlAttr(attrs || "", "width")), ...(alignment ? { alignment } : {}) });
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    },
  );
  return { markdown, images, videoUrls };
};

const applyDetailsMedia = (
  nodes: JSONContent[],
  images: PreparedDetailsBody["images"],
  videoUrls: string[],
) => {
  const videos = new Set(videoUrls);
  let imageIndex = 0;
  const visit = (node: JSONContent): JSONContent => {
    if (node.type === "image") {
      const expected = images[imageIndex];
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      if (expected && expected.src === src) {
        imageIndex += 1;
        if (expected.width != null || expected.alignment) {
          return { ...node, attrs: { ...node.attrs,
            ...(expected.width != null ? { width: expected.width } : {}),
            ...(expected.alignment ? { alignment: expected.alignment } : {}),
          } };
        }
      }
      return node;
    }

    if (node.type === FILE_ATTACHMENT_NODE_TYPE && videos.has(String(node.attrs?.url || ""))) {
      const filename = typeof node.attrs?.filename === "string" ? node.attrs.filename : "";
      return {
        ...node,
        attrs: {
          ...node.attrs,
          mimeType: resolveVideoMimeType(null, filename) ?? "video/mp4",
        },
      };
    }

    return Array.isArray(node.content)
      ? { ...node, content: node.content.map(visit) }
      : node;
  };

  return nodes.map(visit);
};

const htmlAttribute = (name: string, value: string) => `${name}="${escapeHtml(value)}"`;

const renderDetailsImage = (node: JSONContent) => {
  const src = typeof node.attrs?.src === "string" ? node.attrs.src.trim() : "";
  if (!isDetailsImageSrc(src)) return null;
  if (parseImageAlignment(node.attrs?.alignment)) return alignedImageToHtml(node);
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt.trim() : "";
  const title = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
  const width = node.attrs?.width == null || node.attrs.width === ""
    ? null
    : parseImageWidth(node.attrs.width);
  const attrs = [htmlAttribute("src", src)];
  if (alt) attrs.push(htmlAttribute("alt", alt));
  if (title) attrs.push(htmlAttribute("title", title));
  if (width != null) attrs.push(htmlAttribute("width", `${width}%`));
  return `<img ${attrs.join(" ")} />`;
};

const fileAttachmentNode = (node: JSONContent) => {
  if (node.type === FILE_ATTACHMENT_NODE_TYPE) return node;
  if (
    node.type === "paragraph"
    && node.content?.length === 1
    && node.content[0]?.type === FILE_ATTACHMENT_NODE_TYPE
  ) {
    return node.content[0];
  }
  return null;
};

const renderDetailsVideo = (node: JSONContent) => {
  const attachment = fileAttachmentNode(node);
  if (!attachment) return null;
  const url = typeof attachment.attrs?.url === "string" ? attachment.attrs.url.trim() : "";
  if (!isRemoteHttpUrl(url)) return null;
  const filename = typeof attachment.attrs?.filename === "string" ? attachment.attrs.filename : "";
  const mimeType = typeof attachment.attrs?.mimeType === "string" ? attachment.attrs.mimeType : "";
  if (resolveAttachmentKind(mimeType, filename || url) !== "video") return null;
  return `<video src="${escapeHtml(url)}" controls></video>`;
};

const renderDetailsBody = (nodes: JSONContent[], helpers: MarkdownRendererHelpers) => {
  const parts: string[] = [];
  const buffer: JSONContent[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const rendered = helpers.renderChildren(buffer, "\n\n").trim();
    if (rendered) parts.push(rendered);
    buffer.length = 0;
  };

  for (const node of nodes) {
    const media = node.type === "image" ? renderDetailsImage(node) : renderDetailsVideo(node);
    if (!media) {
      buffer.push(node);
      continue;
    }
    flush();
    parts.push(media);
  }
  flush();
  return parts.join("\n\n");
};

const attachmentParagraph = (document: Document, video: RemoteVideo) => {
  const paragraph = document.createElement("p");
  const span = document.createElement("span");
  span.setAttribute("data-type", "edgeever-file-attachment");
  span.setAttribute("data-file-url", video.src);
  span.setAttribute("data-file-label", video.label);
  span.setAttribute("data-file-name", video.filename);
  span.setAttribute("data-file-mime-type", video.mimeType);
  paragraph.appendChild(span);
  return paragraph;
};

/**
 * GitHub-style HTML paste uses <details><summary>…</summary>blocks</details>.
 * TipTap's schema expects the body wrapped in div[data-type=detailsContent].
 */
export const wrapDetailsContentHtml = (html: string): string => {
  if (typeof DOMParser === "undefined" || !html.includes("<details")) {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks = [...document.querySelectorAll("details")].reverse();
  for (const details of blocks) {
    for (const video of Array.from(details.querySelectorAll("video"))) {
      if (video.closest("[data-type='edgeever-file-attachment'], [data-edgeever-video-player]")) continue;
      const parsed = remoteVideoFromSrc(video.getAttribute("src") || "");
      if (!parsed) {
        video.remove();
        continue;
      }
      video.replaceWith(attachmentParagraph(document, parsed));
    }
    if (details.querySelector(':scope > [data-type="detailsContent"]')) continue;
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-type", "detailsContent");
    for (const child of Array.from(details.childNodes)) {
      if (child.nodeName === "SUMMARY") continue;
      wrapper.appendChild(child);
    }
    if (!wrapper.hasChildNodes()) {
      wrapper.appendChild(document.createElement("p"));
    }
    const summary = details.querySelector(":scope > summary");
    if (summary?.nextSibling) {
      details.insertBefore(wrapper, summary.nextSibling);
    } else {
      details.appendChild(wrapper);
    }
  }
  return document.body.innerHTML;
};

/** WeChat and similar HTML sinks do not honor <details>, so unwrap to visible title + body. */
export const flattenDetailsForLinearHtml = (root: HTMLElement) => {
  const document = root.ownerDocument;
  if (!document) return;

  const blocks = [...root.querySelectorAll("details")].reverse();
  for (const details of blocks) {
    const replacement = document.createElement("div");
    replacement.className = "edgeever-details-flat";
    const summary = details.querySelector(":scope > summary");
    const title = summary?.textContent?.trim();
    if (title) {
      const heading = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = title;
      heading.appendChild(strong);
      replacement.appendChild(heading);
    }
    for (const child of Array.from(details.childNodes)) {
      if (child === summary) continue;
      if (child instanceof HTMLElement && child.getAttribute("data-type") === "detailsContent") {
        while (child.firstChild) {
          replacement.appendChild(child.firstChild);
        }
        continue;
      }
      replacement.appendChild(child);
    }
    details.parentNode?.replaceChild(replacement, details);
  }
};

export const DETAILS_EDITOR_CSS = `
.ProseMirror [data-type="details"],
.edgeever-editor-content [data-type="details"] {
  display: flex;
  align-items: flex-start;
  gap: 0.1em;
  margin: 0.15em 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.ProseMirror [data-type="details"] > button,
.edgeever-editor-content [data-type="details"] > button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 1.6em;
  height: 1.6em;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #16a06e;
  font: inherit;
  line-height: 0;
  cursor: pointer;
}
.ProseMirror [data-type="details"] > button:hover,
.edgeever-editor-content [data-type="details"] > button:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.ProseMirror [data-type="details"] > button:focus-visible,
.edgeever-editor-content [data-type="details"] > button:focus-visible {
  outline: 2px solid color-mix(in srgb, #16a06e 55%, transparent);
  outline-offset: 1px;
}
.ProseMirror [data-type="details"] > button::before,
.edgeever-editor-content [data-type="details"] > button::before {
  content: "";
  width: 0.32em;
  height: 0.32em;
  margin: 0;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
}
.ProseMirror [data-type="details"].is-open > button::before,
.edgeever-editor-content [data-type="details"].is-open > button::before {
  transform: rotate(45deg);
}
.ProseMirror [data-type="details"] > div,
.edgeever-editor-content [data-type="details"] > div {
  flex: 1;
  min-width: 0;
}
.ProseMirror summary,
.edgeever-editor-content summary {
  display: block;
  margin: 0;
  padding: 0;
  font-size: inherit;
  font-weight: 500;
  line-height: inherit;
  list-style: none;
  cursor: text;
}
.ProseMirror summary::-webkit-details-marker,
.edgeever-editor-content summary::-webkit-details-marker {
  display: none;
}
.ProseMirror [data-type="details"]:not(.is-open) [data-type="detailsContent"],
.edgeever-editor-content [data-type="details"]:not(.is-open) [data-type="detailsContent"] {
  display: none !important;
}
.ProseMirror [data-type="details"].is-open [data-type="detailsContent"],
.edgeever-editor-content [data-type="details"].is-open [data-type="detailsContent"] {
  margin-top: 0.15em;
}
`;

const parseDetailsMarkdown = (token: MarkdownToken, helpers: MarkdownParseHelpers) => {
  const summaryText = typeof token.summary === "string" ? token.summary : "";
  const mediaToken = token as MarkdownToken & {
    detailImages?: PreparedDetailsBody["images"];
    detailVideoUrls?: string[];
  };
  const parsedBody = applyDetailsMedia(
    helpers.parseChildren(token.tokens || []),
    mediaToken.detailImages || [],
    mediaToken.detailVideoUrls || [],
  );
  const body = parsedBody.length > 0 ? parsedBody : [{ type: "paragraph" }];
  return helpers.createNode(DETAILS_NODE_TYPE, undefined, [
    helpers.createNode(
      DETAILS_SUMMARY_NODE_TYPE,
      undefined,
      summaryText ? [helpers.createTextNode(summaryText)] : [],
    ),
    helpers.createNode(DETAILS_CONTENT_NODE_TYPE, undefined, body),
  ]);
};

const renderDetailsMarkdown = (node: JSONContent, helpers: MarkdownRendererHelpers) => {
  const children = Array.isArray(node.content) ? node.content : [];
  const summary = children.find((child) => child.type === DETAILS_SUMMARY_NODE_TYPE);
  const body = children.find((child) => child.type === DETAILS_CONTENT_NODE_TYPE);
  const summaryHtml = escapeHtml(collectText(summary).trim());
  const bodyMarkdown = Array.isArray(body?.content) && body.content.length > 0
    ? renderDetailsBody(body.content, helpers)
    : "";
  return `<details>\n<summary>${summaryHtml}</summary>\n\n${bodyMarkdown}\n\n</details>`;
};

export const EdgeEverDetails = Details.extend({
  addOptions() {
    return {
      persist: false,
      openClassName: "is-open",
      HTMLAttributes: {
        class: "edgeever-details",
      },
      renderToggleButton: ({ element, isOpen }) => {
        element.setAttribute("aria-label", isOpen ? "Collapse details" : "Expand details");
      },
    };
  },

  parseMarkdown: parseDetailsMarkdown,
  renderMarkdown: renderDetailsMarkdown,
  markdownTokenizer: {
    name: DETAILS_NODE_TYPE,
    level: "block",
    start(source: string) {
      const match = /<details\b/i.exec(source);
      return match ? match.index : -1;
    },
    tokenize(source: string, _tokens, lexer) {
      const leading = /^\s*/.exec(source)?.[0] ?? "";
      const rest = source.slice(leading.length);
      if (!DETAILS_OPEN_PATTERN.test(rest)) return undefined;
      const block = findHtmlBlock(rest, "details");
      if (!block) return undefined;

      const summaryMatch = SUMMARY_PATTERN.exec(block.inner);
      const summary = summaryMatch ? stripHtmlTags(summaryMatch[1]) : "";
      const prepared = prepareDetailsBody(unwrapDetailsContent(
        summaryMatch ? block.inner.slice(summaryMatch[0].length) : block.inner,
      ));
      const tokens = prepared.markdown.trim() ? lexer.blockTokens(prepared.markdown.trim()) : [];
      const trailing = /^\s*\n/.exec(source.slice(leading.length + block.raw.length))?.[0] ?? "";

      return {
        type: DETAILS_NODE_TYPE,
        raw: `${leading}${block.raw}${trailing}`,
        summary,
        tokens,
        detailImages: prepared.images,
        detailVideoUrls: prepared.videoUrls,
      };
    },
  },
});

export const EdgeEverDetailsSummary = DetailsSummary;
export const EdgeEverDetailsContent = DetailsContent;

export const createEdgeEverDetailsExtensions = () => [
  EdgeEverDetails,
  EdgeEverDetailsSummary,
  EdgeEverDetailsContent,
];
