import { mergeAttributes, Node } from "@tiptap/core";
import { createImageGalleryNode, getImageOnlyDocumentImages } from "./image-gallery";
import { openBlockSource } from "./markdown-block-start";
import type { TiptapDoc, TiptapNode } from "./content";

/** TipTap / ProseMirror node type for note-merge section boundaries. */
export const MERGE_DIVIDER_NODE_TYPE = "edgeeverMergeDivider" as const;

/** Markdown marker that round-trips through `docToMarkdown` / `markdownToDoc`. */
export const MERGE_DIVIDER_MARKDOWN_MARKER = "<!-- edgeever:merge-divider -->";

const MERGE_DIVIDER_TOKENIZER =
  /^<!--\s*edgeever:merge-divider\s*-->\s*(?:\n+---[ \t]*(?:\n+|$)|(?:\n+|$))/;

/**
 * Semantic horizontal rule inserted between source notes during merge.
 * Distinct from user-authored `---` (`horizontalRule`) so themes cannot
 * collapse merge boundaries into decorative hairlines.
 */
export const MergeDivider = Node.create({
  name: MERGE_DIVIDER_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "hr[data-edgeever-merge-divider]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "hr",
      mergeAttributes(HTMLAttributes, {
        "data-edgeever-merge-divider": "true",
        class: "edgeever-merge-divider",
      }),
    ];
  },

  renderMarkdown() {
    return `${MERGE_DIVIDER_MARKDOWN_MARKER}\n\n---`;
  },

  parseMarkdown(_token, helpers) {
    return helpers.createNode(MERGE_DIVIDER_NODE_TYPE);
  },

  markdownTokenizer: {
    name: MERGE_DIVIDER_NODE_TYPE,
    level: "block",
    start(src: string) {
      return openBlockSource(src).indexOf("<!-- edgeever:merge-divider -->");
    },
    tokenize(src: string) {
      const match = MERGE_DIVIDER_TOKENIZER.exec(src);
      if (!match) {
        return undefined;
      }

      return {
        type: MERGE_DIVIDER_NODE_TYPE,
        raw: match[0],
        text: "",
      };
    },
  },
});

export const createMergeDividerNode = (): TiptapNode => ({
  type: MERGE_DIVIDER_NODE_TYPE,
});

/**
 * Use one gallery when every source is image-only. Otherwise keep each source's
 * original block order and separate the sources with semantic merge dividers.
 */
export const mergeMemoDocs = (docs: TiptapDoc[]): TiptapDoc => {
  if (docs.length > 1) {
    const imageSections = docs.map(getImageOnlyDocumentImages);
    if (imageSections.every((images) => images !== null)) {
      return { type: "doc", content: [createImageGalleryNode(imageSections.flat())] };
    }
  }

  const content: TiptapNode[] = [];

  for (const doc of docs) {
    const section = Array.isArray(doc.content) ? doc.content : [];
    if (section.length === 0) {
      continue;
    }

    if (content.length > 0) {
      content.push(createMergeDividerNode());
    }
    content.push(...section);
  }

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
};
