import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { MergeDivider, MERGE_DIVIDER_NODE_TYPE } from "./merge-divider";
import { PdfAttachment, PDF_ATTACHMENT_NODE_TYPE, upgradeStandalonePdfLinks } from "./pdf-attachment";
import { FileAttachment, FILE_ATTACHMENT_NODE_TYPE, upgradeStandaloneFileLinks } from "./file-attachment";
import {
  BLOCK_MATH_NODE_TYPE,
  createEdgeEverMarkdownMathematics,
  INLINE_MATH_NODE_TYPE,
} from "./mathematics-markdown";
import { projectNativeUnknownContentForMarkdown } from "./mobile-content-compatibility";

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
  isFileAttachmentLink,
  upgradeStandaloneFileLinks,
} from "./file-attachment";

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

const markdownManager = new MarkdownManager({
  extensions: [
    StarterKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    Image,
    PdfAttachment,
    FileAttachment,
    MergeDivider,
    ...createEdgeEverMarkdownMathematics(),
    Markdown.configure({
      markedOptions: { gfm: true },
    }),
  ],
});

export const markdownToDoc = (markdown: string): TiptapDoc => {
  if (!markdown.trim()) {
    return emptyDoc();
  }

  return markdownManager.parse(markdown.replace(/\r\n?/g, "\n")) as TiptapDoc;
};

const docContainsNodeType = (doc: TiptapDoc, nodeType: string): boolean => {
  const visit = (nodes: TiptapNode[]): boolean => nodes.some((node) =>
    node.type === nodeType || (node.content ? visit(node.content as TiptapNode[]) : false)
  );

  return visit(doc.content);
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
    ? upgradeStandaloneFileLinks(upgradeStandalonePdfLinks(upgradeLegacyAttachmentLinks(contentJson)))
    : emptyDoc();
  if (
    !contentMarkdown?.trim() ||
    docContainsNodeType(currentDoc, "table") ||
    docContainsNodeType(currentDoc, "taskList") ||
    docContainsNodeType(currentDoc, "edgeeverThemeBlock") ||
    docContainsNodeType(currentDoc, MERGE_DIVIDER_NODE_TYPE) ||
    docContainsNodeType(currentDoc, BLOCK_MATH_NODE_TYPE) ||
    docContainsNodeType(currentDoc, INLINE_MATH_NODE_TYPE)
    || docContainsNodeType(currentDoc, PDF_ATTACHMENT_NODE_TYPE)
    || docContainsNodeType(currentDoc, FILE_ATTACHMENT_NODE_TYPE)
  ) {
    return currentDoc;
  }

  const markdownDoc = markdownToDoc(contentMarkdown);
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

  const serializableDoc = protectLiteralDollarPairs(projectNativeUnknownContentForMarkdown(
    stripEditorOnlyNodes(doc) as TiptapDoc
  ));
  return markdownManager
    .serialize(serializableDoc as Parameters<typeof markdownManager.serialize>[0])
    .replaceAll(LITERAL_DOLLAR_PLACEHOLDER, "\\$");
};

const LITERAL_DOLLAR_PLACEHOLDER = "\uE000edgeever-dollar\uE001";

/** Preserve dollar pairs that are text rather than inline-math nodes. */
const protectLiteralDollarPairs = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const node = value as { type?: unknown; text?: unknown; content?: unknown };
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
