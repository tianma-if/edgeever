import { MarkdownManager } from "@tiptap/markdown";
import {
  createEdgeEverDocumentExtensions,
  type CreateEdgeEverDocumentExtensionsOptions,
} from "./document-extensions";
import { MergeDivider, MERGE_DIVIDER_NODE_TYPE } from "./merge-divider";
import { PdfAttachment, PDF_ATTACHMENT_NODE_TYPE, upgradeStandalonePdfLinks } from "./pdf-attachment";
import { FileAttachment, FILE_ATTACHMENT_NODE_TYPE, upgradeStandaloneFileLinks } from "./file-attachment";
import {
  BLOCK_MATH_NODE_TYPE,
  createEdgeEverMarkdownMathematics,
  INLINE_MATH_NODE_TYPE,
} from "./mathematics-markdown";
import { projectNativeUnknownContentForMarkdown } from "./mobile-content-compatibility";
import { PluginEmbed, PLUGIN_EMBED_NODE_TYPE } from "./plugin-embed";
import { NEW_IMAGE_WIDTH_PERCENT, parseImageWidth } from "./image-display";
import { ImageGallery, IMAGE_GALLERY_NODE_TYPE, groupConsecutiveImagesIntoGalleries, normalizeImageGalleries } from "./image-gallery";
import { EMPTY_EXTERNAL_LINK_NODE_TYPE } from "./empty-external-link";
import { FRONT_MATTER_LANGUAGE, createFrontMatterNode, getFrontMatterSource, splitMarkdownFrontMatter } from "./front-matter";

export { PluginEmbed, PLUGIN_EMBED_NODE_TYPE, pluginEmbedToMarkdown, normalizePluginEmbedAttributes } from "./plugin-embed";
export type { PluginEmbedAttributes } from "./plugin-embed";

export {
  BLOCK_MATH_NODE_TYPE,
  INLINE_MATH_NODE_TYPE,
} from "./mathematics-markdown";

export {
  MergeDivider,
  MERGE_DIVIDER_MARKDOWN_MARKER,
  MERGE_DIVIDER_NODE_TYPE,
  mergeMemoDocs,
  createMergeDividerNode,
} from "./merge-divider";

export {
  PdfAttachment,
  PDF_ATTACHMENT_NODE_TYPE,
  PDF_DISPLAY_MODES,
  isPdfAttachment,
  resolvePdfDisplayMode,
  upgradeStandalonePdfLinks,
} from "./pdf-attachment";
export type { PdfDisplayMode } from "./pdf-attachment";

export {
  FileAttachment,
  FILE_ATTACHMENT_NODE_TYPE,
  FILE_DISPLAY_MODES,
  isFileAttachmentLink,
  resolveFileDisplayMode,
  upgradeStandaloneFileLinks,
} from "./file-attachment";
export type { FileDisplayMode } from "./file-attachment";

export type TiptapTextNode = {
  type: "text";
  text: string;
  marks?: TiptapMark[];
};

export type TiptapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<TiptapNode | TiptapTextNode>;
};

export type TiptapDoc = {
  type: "doc";
  content: TiptapNode[];
};

export const DEFAULT_MEMO_TITLE = "无标题笔记";

export const resolveMergedMemoTitle = (
  inputTitle: string | null | undefined,
  sourceMemos: Array<{ title: string | null | undefined }>,
  date = new Date(),
) => {
  const explicitTitle = inputTitle?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }

  const customTitle = sourceMemos
    .map((memo) => memo.title?.trim())
    .find((title): title is string => Boolean(title && title !== DEFAULT_MEMO_TITLE));
  return customTitle ?? `合并笔记 ${date.toLocaleDateString("zh-CN")}`;
};

export const emptyDoc = (): TiptapDoc => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

export const createEdgeEverMarkdownManager = (
  options: CreateEdgeEverDocumentExtensionsOptions,
) => new MarkdownManager({
  extensions: createEdgeEverDocumentExtensions({
    ...options,
    markdown: true,
  }),
});

const markdownManager = createEdgeEverMarkdownManager({
  mathematics: createEdgeEverMarkdownMathematics(),
});

const PROTECTED_MARKDOWN_SEGMENT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$)/g;

/**
 * CommonMark treats one or more blank lines as a single paragraph break, so two
 * visual blank lines disappear on parse. Expand those extra newlines into the
 * empty-paragraph spacing TipTap already understands, without touching fenced
 * code or display-math blocks.
 */
const expandExtraBlankLinesForParse = (markdown: string) =>
  markdown.split(PROTECTED_MARKDOWN_SEGMENT).map((segment) => {
    if (segment.startsWith("```") || segment.startsWith("~~~") || segment.startsWith("$$")) {
      return segment;
    }
    return segment.replace(/\n{3,}/g, (run) => "\n\n".repeat(run.length - 1));
  }).join("");

const withDefaultImageWidths = (node: TiptapNode): TiptapNode => {
  const content = node.content?.map((child) => (
    child.type === "text" ? child : withDefaultImageWidths(child)
  ));
  const next = content ? { ...node, content } : node;
  if (next.type !== "image" || parseImageWidth(next.attrs?.width) != null) return next;
  return { ...next, attrs: { ...next.attrs, width: NEW_IMAGE_WIDTH_PERCENT } };
};

export const markdownToDoc = (markdown: string): TiptapDoc => {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized) {
    return emptyDoc();
  }

  const header = splitMarkdownFrontMatter(normalized);
  const parsed = markdownManager.parse(expandExtraBlankLinesForParse(header?.body ?? normalized)) as TiptapDoc;
  return {
    ...parsed,
    content: [...(header ? [createFrontMatterNode(header.source)] : []),
      ...groupConsecutiveImagesIntoGalleries(parsed.content.map(withDefaultImageWidths)),
      ...(header && !parsed.content.length ? [{ type: "paragraph" }] : [])],
  };
};

const docContainsNodeType = (doc: TiptapDoc, nodeType: string): boolean => {
  const visit = (nodes: TiptapNode[]): boolean => nodes.some((node) =>
    node.type === nodeType || (node.content ? visit(node.content as TiptapNode[]) : false)
  );

  return visit(doc.content);
};

/** Upgrade only explicit math fences in older JSON, retaining rich-only content. */
const upgradeMathCodeFences = (doc: TiptapDoc): TiptapDoc => {
  const visit = (node: TiptapNode): TiptapNode => {
    if (node.type === "codeBlock" && node.attrs?.language === "math"
      && node.content?.every((child) => child.type === "text")) {
      const latex = node.content.map((child) => (child as TiptapTextNode).text).join("").trim();
      if (latex) return { type: BLOCK_MATH_NODE_TYPE, attrs: { latex } };
    }
    if (!node.content) return node;
    const content = node.content.map(visit);
    return content.some((child, index) => child !== node.content?.[index]) ? { ...node, content } : node;
  };
  const content = doc.content.map(visit);
  return content.some((node, index) => node !== doc.content[index]) ? { ...doc, content } : doc;
};

/**
 * Recovers Markdown features that an older editor schema could not persist in
 * contentJson. The stored Markdown remains the compatibility source in that
 * case; otherwise the richer JSON document (for example image sizing attrs)
 * keeps precedence.
 */
export const resolveMemoContentDoc = (
  contentJson: TiptapDoc | null | undefined,
  contentMarkdown: string | null | undefined
): TiptapDoc => {
  const currentDoc = contentJson && Array.isArray(contentJson.content)
    ? upgradeMathCodeFences(normalizeImageGalleries(
        upgradeStandaloneFileLinks(upgradeStandalonePdfLinks(upgradeLegacyAttachmentLinks(contentJson))),
      ))
    : emptyDoc();
  if (getFrontMatterSource(currentDoc) !== null) return currentDoc;
  if (
    !contentMarkdown?.trim() ||
    docContainsNodeType(currentDoc, "table") ||
    docContainsNodeType(currentDoc, "taskList") ||
    docContainsNodeType(currentDoc, "edgeeverThemeBlock") ||
    docContainsNodeType(currentDoc, IMAGE_GALLERY_NODE_TYPE) ||
    docContainsNodeType(currentDoc, MERGE_DIVIDER_NODE_TYPE) ||
    docContainsNodeType(currentDoc, PLUGIN_EMBED_NODE_TYPE) ||
    docContainsNodeType(currentDoc, BLOCK_MATH_NODE_TYPE) ||
    docContainsNodeType(currentDoc, INLINE_MATH_NODE_TYPE)
    || docContainsNodeType(currentDoc, PDF_ATTACHMENT_NODE_TYPE)
    || docContainsNodeType(currentDoc, FILE_ATTACHMENT_NODE_TYPE)
    || docContainsNodeType(currentDoc, EMPTY_EXTERNAL_LINK_NODE_TYPE)
    || docContainsNodeType(currentDoc, "details")
  ) {
    return currentDoc;
  }

  const markdownDoc = markdownToDoc(contentMarkdown);
  const properties = getFrontMatterSource(markdownDoc);
  if (properties !== null) {
    return !docToText(currentDoc) ? markdownDoc : { ...currentDoc, content: [createFrontMatterNode(properties), ...currentDoc.content] };
  }
  // Some older saves left an empty JSON document behind while retaining the
  // real body in Markdown. Treat that as a compatibility case too; otherwise
  // the editor can show the Markdown body while list excerpts see an empty
  // JSON document. Also recover task lists and merge dividers when only Markdown
  // still retains their semantics.
  return docContainsNodeType(markdownDoc, "table")
    || docContainsNodeType(markdownDoc, "taskList")
    || docContainsNodeType(markdownDoc, MERGE_DIVIDER_NODE_TYPE)
    || docContainsNodeType(markdownDoc, BLOCK_MATH_NODE_TYPE)
    || docContainsNodeType(markdownDoc, INLINE_MATH_NODE_TYPE)
    || docContainsNodeType(markdownDoc, EMPTY_EXTERNAL_LINK_NODE_TYPE)
    || docContainsNodeType(markdownDoc, "details")
    || !docToText(currentDoc)
    ? markdownDoc
    : currentDoc;
};

const LEGACY_ATTACHMENT_PATTERN = /^(附件：|Attachment:\s*)(.+?)\s+(\/api\/v1\/resources\/\S+|https?:\/\/\S+)$/;

const isTiptapTextNode = (node: TiptapNode | TiptapTextNode): node is TiptapTextNode =>
  node.type === "text" && "text" in node;

/** Convert the first-generation plain-text attachment insertion into a link mark. */
const upgradeLegacyAttachmentLinks = (doc: TiptapDoc): TiptapDoc => {
  let changed = false;
  const visit = (node: TiptapNode | TiptapTextNode): TiptapNode | TiptapTextNode => {
    if (isTiptapTextNode(node)) {
      const match = node.text.match(LEGACY_ATTACHMENT_PATTERN);
      if (!match) {
        return node;
      }

      const existingMarks = node.marks ?? [];
      if (existingMarks.some((mark) => mark.type === "link")) {
        return node;
      }

      changed = true;
      return {
        ...node,
        text: `${match[1]}${match[2]}`,
        marks: [
          ...existingMarks,
          { type: "link", attrs: { href: match[3], target: "_blank", class: "edgeever-attachment-link" } },
        ],
      };
    }

    return node.content
      ? { ...node, content: node.content.map((child: TiptapNode | TiptapTextNode) => visit(child)) }
      : node;
  };

  const upgradedDoc = visit(doc) as TiptapDoc;
  return changed ? upgradedDoc : doc;
};

export const docToText = (doc: unknown): string => {
  const pieces: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const current = node as { type?: unknown; text?: unknown; attrs?: Record<string, unknown>; content?: unknown };

    if (current.type === "codeBlock" && current.attrs?.language === FRONT_MATTER_LANGUAGE) return;

    if (typeof current.text === "string") {
      pieces.push(current.text);
    }

    if (current.type === "image") {
      const label =
        getStringAttr(current.attrs, "alt") ||
        getStringAttr(current.attrs, "title") ||
        getStringAttr(current.attrs, "filename");

      if (label) {
        pieces.push(label);
      }
    }

    if (current.type === PDF_ATTACHMENT_NODE_TYPE || current.type === FILE_ATTACHMENT_NODE_TYPE) {
      const label = getStringAttr(current.attrs, "label");
      if (label) pieces.push(label);
    }

    if (current.type === BLOCK_MATH_NODE_TYPE || current.type === INLINE_MATH_NODE_TYPE) {
      const latex = getStringAttr(current.attrs, "latex");
      if (latex) {
        pieces.push(latex);
      }
    }

    if (Array.isArray(current.content)) {
      for (const child of current.content) {
        walk(child);
      }
    }
  };

  walk(doc);

  return pieces.join(" ").replace(/\s+/g, " ").trim();
};

let memoCharacterSegmenter: Intl.Segmenter | null | undefined;

const getMemoCharacterSegmenter = () => {
  if (memoCharacterSegmenter !== undefined) {
    return memoCharacterSegmenter;
  }

  memoCharacterSegmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

  return memoCharacterSegmenter;
};

/**
 * Counts visible memo-body characters while excluding whitespace. Formatting,
 * titles, tags, and image labels are intentionally not part of the count.
 */
export const countMemoCharacters = (doc: unknown): number => {
  const pieces: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const current = node as { type?: unknown; text?: unknown; attrs?: Record<string, unknown>; content?: unknown };

    if (current.type === "codeBlock" && current.attrs?.language === FRONT_MATTER_LANGUAGE) return;

    if (typeof current.text === "string") {
      pieces.push(current.text);
    }

    if (current.type === PDF_ATTACHMENT_NODE_TYPE || current.type === FILE_ATTACHMENT_NODE_TYPE) {
      const label = getStringAttr(current.attrs, "label");
      if (label) pieces.push(label);
    }

    if (Array.isArray(current.content)) {
      for (const child of current.content) {
        walk(child);
      }
    }
  };

  walk(doc);
  const text = pieces.join("");
  const segmenter = getMemoCharacterSegmenter();
  const characters = segmenter ? Array.from(segmenter.segment(text), ({ segment }) => segment) : Array.from(text);

  return characters.reduce((count, character) => count + (/^\s+$/u.test(character) ? 0 : 1), 0);
};

export const docToMarkdown = (doc: unknown): string => {
  if (!doc || typeof doc !== "object") {
    return "";
  }

  const root = doc as { content?: unknown };

  if (!Array.isArray(root.content)) {
    return "";
  }

  const properties = getFrontMatterSource(doc as TiptapDoc);
  const body = properties === null ? doc : { ...doc, content: root.content.slice(1) };
  const serializableDoc = protectLiteralDollarPairs(projectNativeUnknownContentForMarkdown(
    stripEditorOnlyNodes(body) as TiptapDoc
  ));
  const markdown = markdownManager
    .serialize(serializableDoc as Parameters<typeof markdownManager.serialize>[0])
    .replaceAll(LITERAL_DOLLAR_PLACEHOLDER, "\\$");
  return properties === null ? markdown : `---\n${properties}\n---\n\n${markdown}`;
};

const LITERAL_DOLLAR_PLACEHOLDER = "\uE000edgeever-dollar\uE001";

/** Preserve dollar pairs that are text rather than inline-math nodes. */
const protectLiteralDollarPairs = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const node = value as { type?: unknown; text?: unknown; content?: unknown; marks?: Array<{ type?: string }> };
  // Markdown does not interpret escapes inside code; adding them changes the source.
  if (node.type === "codeBlock" || node.marks?.some((mark) => mark.type === "code")) return value;
  if (node.type === "text" && typeof node.text === "string") {
    const dollarCount = Array.from(node.text).filter((character) => character === "$").length;
    return dollarCount >= 2
      ? { ...node, text: node.text.replaceAll("$", LITERAL_DOLLAR_PLACEHOLDER) }
      : value;
  }

  return Array.isArray(node.content)
    ? { ...node, content: node.content.map(protectLiteralDollarPairs) }
    : value;
};

/**
 * Returns the best complete Markdown representation available for a memo.
 * Some older rich-editor saves populated contentJson while leaving the
 * Markdown compatibility copy empty, so merge/export callers must not trust
 * contentMarkdown alone.
 */
export const resolveMemoContentMarkdown = (
  contentJson: TiptapDoc | null | undefined,
  contentMarkdown: string | null | undefined,
) => docToMarkdown(resolveMemoContentDoc(contentJson, contentMarkdown));

/**
 * Theme blocks are richer editor-only nodes. Markdown has no portable equivalent,
 * so exports keep their text as a quoted section instead of silently dropping it.
 */
const stripEditorOnlyNodes = (doc: unknown): unknown => {
  if (!doc || typeof doc !== "object") {
    return doc;
  }

  const node = doc as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown };
  if (node.type === "edgeeverThemeBlock") {
    const label = getStringAttr(node.attrs, "kind");
    const content = Array.isArray(node.content) ? node.content : [];
    return {
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: label ? `[${label}]` : "[主题化组件]" }] },
        ...content.map(stripEditorOnlyNodes),
      ],
    };
  }

  if (!Array.isArray(node.content)) {
    return doc;
  }

  return { ...node, content: node.content.map(stripEditorOnlyNodes) };
};

const getStringAttr = (attrs: Record<string, unknown> | undefined, key: string) => {
  const value = attrs?.[key];
  return typeof value === "string" ? value.trim() : "";
};

export const createExcerpt = (text: string, maxLength = 30): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

export const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
        .filter(Boolean)
        .map((tag) => tag.replace(/^#/, ""))
    )
  ).slice(0, 24);
};
