import { Mark, Node } from "@tiptap/core";
import type { TiptapDoc, TiptapMark, TiptapNode, TiptapTextNode } from "./content";
import { FILE_ATTACHMENT_NODE_TYPE } from "./file-attachment";
import { PDF_ATTACHMENT_NODE_TYPE } from "./pdf-attachment";
import { PLUGIN_EMBED_NODE_TYPE } from "./plugin-embed";

export const UNSUPPORTED_BLOCK_NODE_TYPE = "edgeeverUnsupportedBlock" as const;
export const UNSUPPORTED_INLINE_NODE_TYPE = "edgeeverUnsupportedInline" as const;
export const UNSUPPORTED_MARK_TYPE = "edgeeverUnsupportedMark" as const;

const FALLBACK_NODE_TYPES = new Set<string>([
  UNSUPPORTED_BLOCK_NODE_TYPE,
  UNSUPPORTED_INLINE_NODE_TYPE,
]);

/** Nodes intentionally understood by both native WebView editor schemas. */
export const NATIVE_EDITOR_NODE_TYPES = new Set<string>([
  "doc",
  "text",
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "edgeeverImageGallery",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "edgeeverMergeDivider",
  "inlineMath",
  "blockMath",
  ...FALLBACK_NODE_TYPES,
]);

export const NATIVE_EDITOR_MARK_TYPES = new Set<string>([
  "bold",
  "italic",
  "strike",
  "underline",
  "code",
  "link",
  UNSUPPORTED_MARK_TYPE,
]);

const MARKDOWN_EDITOR_NODE_TYPES = new Set<string>([
  ...NATIVE_EDITOR_NODE_TYPES,
  FILE_ATTACHMENT_NODE_TYPE,
  PDF_ATTACHMENT_NODE_TYPE,
  PLUGIN_EMBED_NODE_TYPE,
]);

const INLINE_PARENT_TYPES = new Set<string>(["paragraph", "heading"]);

const isTextNode = (node: TiptapNode | TiptapTextNode): node is TiptapTextNode =>
  node.type === "text" && "text" in node;

const getOriginalType = (attrs: Record<string, unknown> | undefined) =>
  typeof attrs?.originalType === "string" ? attrs.originalType : "unknown";

const getFallbackLabel = (type: string, locale?: "zh-CN" | "en-US") =>
  locale === "zh-CN" ? `暂不支持的内容：${type}` : `Unsupported content: ${type}`;

const fallbackAttrs = (
  node: TiptapNode | TiptapTextNode,
  locale?: "zh-CN" | "en-US",
) => ({
  originalType: node.type,
  originalJson: JSON.stringify(node),
  displayLabel: getFallbackLabel(node.type, locale),
});

const parseOriginalNode = (attrs: Record<string, unknown> | undefined) => {
  if (typeof attrs?.originalJson !== "string") return null;
  try {
    const parsed = JSON.parse(attrs.originalJson) as TiptapNode | TiptapTextNode;
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
};

const parseOriginalMarks = (attrs: Record<string, unknown> | undefined): TiptapMark[] => {
  if (typeof attrs?.originalMarksJson !== "string") return [];
  try {
    const parsed = JSON.parse(attrs.originalMarksJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((mark): mark is TiptapMark => Boolean(mark && typeof mark === "object" && typeof (mark as TiptapMark).type === "string"))
      : [];
  } catch {
    return [];
  }
};

export const UnsupportedBlock = Node.create({
  name: UNSUPPORTED_BLOCK_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      originalType: { default: "unknown" },
      originalJson: { default: "" },
      displayLabel: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-edgeever-unsupported-block]" }];
  },

  renderHTML({ node }) {
    const type = getOriginalType(node.attrs);
    return [
      "div",
      {
        "data-edgeever-unsupported-block": "true",
        "data-original-type": type,
        class: "edgeever-unsupported-content edgeever-unsupported-content--block",
        contenteditable: "false",
      },
      typeof node.attrs.displayLabel === "string" && node.attrs.displayLabel
        ? node.attrs.displayLabel
        : getFallbackLabel(type),
    ];
  },
});

export const UnsupportedInline = Node.create({
  name: UNSUPPORTED_INLINE_NODE_TYPE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      originalType: { default: "unknown" },
      originalJson: { default: "" },
      displayLabel: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-edgeever-unsupported-inline]" }];
  },

  renderHTML({ node }) {
    const type = getOriginalType(node.attrs);
    return [
      "span",
      {
        "data-edgeever-unsupported-inline": "true",
        "data-original-type": type,
        class: "edgeever-unsupported-content edgeever-unsupported-content--inline",
        contenteditable: "false",
      },
      typeof node.attrs.displayLabel === "string" && node.attrs.displayLabel
        ? node.attrs.displayLabel
        : getFallbackLabel(type),
    ];
  },
});

export const UnsupportedMark = Mark.create({
  name: UNSUPPORTED_MARK_TYPE,

  addAttributes() {
    return { originalMarksJson: { default: "[]" } };
  },

  parseHTML() {
    return [{ tag: "span[data-edgeever-unsupported-mark]" }];
  },

  renderHTML() {
    return ["span", {
      "data-edgeever-unsupported-mark": "true",
      class: "edgeever-unsupported-mark",
    }, 0];
  },
});

export const createNativeUnsupportedContentExtensions = () => [
  UnsupportedBlock,
  UnsupportedInline,
  UnsupportedMark,
];

const prepareTextNode = (node: TiptapTextNode): TiptapTextNode => {
  const marks = node.marks ?? [];
  const supportedMarks = marks.filter((mark) => NATIVE_EDITOR_MARK_TYPES.has(mark.type));
  const unsupportedMarks = marks.filter((mark) => !NATIVE_EDITOR_MARK_TYPES.has(mark.type));
  if (!unsupportedMarks.length) return node;
  return {
    ...node,
    marks: [
      ...supportedMarks,
      {
        type: UNSUPPORTED_MARK_TYPE,
        attrs: { originalMarksJson: JSON.stringify(marks) },
      },
    ],
  };
};

/**
 * Converts content unknown to native editor schemas into lossless atom placeholders.
 * The raw subtree/marks stay in attrs and are restored before persistence.
 */
export const prepareNativeEditorContent = (
  doc: TiptapDoc,
  locale?: "zh-CN" | "en-US",
): TiptapDoc => {
  const visit = (
    node: TiptapNode | TiptapTextNode,
    parentType: string,
  ): TiptapNode | TiptapTextNode => {
    if (isTextNode(node)) return prepareTextNode(node);
    if (!NATIVE_EDITOR_NODE_TYPES.has(node.type)) {
      return {
        type: INLINE_PARENT_TYPES.has(parentType)
          ? UNSUPPORTED_INLINE_NODE_TYPE
          : UNSUPPORTED_BLOCK_NODE_TYPE,
        attrs: fallbackAttrs(node, locale),
      };
    }
    const structuralNode = node as TiptapNode;
    if (FALLBACK_NODE_TYPES.has(structuralNode.type)) return structuralNode;
    return structuralNode.content
      ? { ...structuralNode, content: structuralNode.content.map((child) => visit(child, structuralNode.type)) }
      : structuralNode;
  };

  return {
    ...doc,
    content: doc.content.map((node) => visit(node, "doc") as TiptapNode),
  };
};

/** Restores the exact unsupported JSON subtrees/marks before save or sync. */
export const restoreNativeEditorContent = (doc: TiptapDoc): TiptapDoc => {
  const visit = (node: TiptapNode | TiptapTextNode): TiptapNode | TiptapTextNode => {
    if (FALLBACK_NODE_TYPES.has(node.type)) {
      const fallbackNode = node as TiptapNode;
      return parseOriginalNode(fallbackNode.attrs) ?? {
        type: node.type === UNSUPPORTED_INLINE_NODE_TYPE ? "text" : "paragraph",
        ...(node.type === UNSUPPORTED_INLINE_NODE_TYPE
          ? { text: getFallbackLabel(getOriginalType(fallbackNode.attrs)) }
          : { content: [{ type: "text", text: getFallbackLabel(getOriginalType(fallbackNode.attrs)) }] }),
      } as TiptapNode | TiptapTextNode;
    }
    if (isTextNode(node)) {
      const textNode = node;
      const fallbackMark = textNode.marks?.find((mark) => mark.type === UNSUPPORTED_MARK_TYPE);
      const marks = fallbackMark
        ? parseOriginalMarks(fallbackMark.attrs)
        : textNode.marks ?? [];
      return marks.length ? { ...textNode, marks } : { type: "text", text: textNode.text };
    }
    const structuralNode = node as TiptapNode;
    return structuralNode.content
      ? { ...structuralNode, content: structuralNode.content.map(visit) }
      : structuralNode;
  };

  return {
    ...doc,
    content: doc.content.map((node) => visit(node) as TiptapNode),
  };
};

const collectText = (node: TiptapNode | TiptapTextNode): string => {
  if (isTextNode(node)) return node.text;
  return (node as TiptapNode).content?.map(collectText).filter(Boolean).join(" ") ?? "";
};

/** Produces a schema-safe secondary Markdown projection without mutating saved JSON. */
export const projectNativeUnknownContentForMarkdown = (doc: TiptapDoc): TiptapDoc => {
  const visit = (node: TiptapNode | TiptapTextNode, parentType: string): TiptapNode | TiptapTextNode => {
    if (isTextNode(node)) {
      const textNode = node;
      return {
        ...textNode,
        marks: textNode.marks?.filter((mark) => NATIVE_EDITOR_MARK_TYPES.has(mark.type) && mark.type !== UNSUPPORTED_MARK_TYPE),
      };
    }
    if (!MARKDOWN_EDITOR_NODE_TYPES.has(node.type) || FALLBACK_NODE_TYPES.has(node.type)) {
      const structuralNode = node as TiptapNode;
      const original = FALLBACK_NODE_TYPES.has(node.type) ? parseOriginalNode(structuralNode.attrs) : structuralNode;
      const type = original?.type ?? getOriginalType(structuralNode.attrs);
      const text = original ? collectText(original) : "";
      const label = text || getFallbackLabel(type);
      return INLINE_PARENT_TYPES.has(parentType)
        ? { type: "text", text: label }
        : { type: "paragraph", content: [{ type: "text", text: label }] };
    }
    const structuralNode = node as TiptapNode;
    return structuralNode.content
      ? { ...structuralNode, content: structuralNode.content.map((child) => visit(child, structuralNode.type)) }
      : structuralNode;
  };

  return {
    ...doc,
    content: doc.content.map((node) => visit(node, "doc") as TiptapNode),
  };
};
