import { mergeAttributes, Node } from "@tiptap/core";
import type { TiptapDoc, TiptapMark, TiptapNode, TiptapTextNode } from "./content";

export const PDF_ATTACHMENT_NODE_TYPE = "edgeeverPdfAttachment" as const;
export const PDF_DISPLAY_MODES = ["compact", "inline"] as const;
export type PdfDisplayMode = (typeof PDF_DISPLAY_MODES)[number];

export const resolvePdfDisplayMode = (value: unknown): PdfDisplayMode =>
  value === "inline" ? "inline" : "compact";

const PDF_LINK_PATTERN = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/;

export const isPdfAttachment = (mimeType: string | null | undefined, filename: string | null | undefined) =>
  mimeType?.toLowerCase() === "application/pdf" || filename?.trim().toLowerCase().endsWith(".pdf") === true;

const escapeMarkdownLabel = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

export const PdfAttachment = Node.create({
  name: PDF_ATTACHMENT_NODE_TYPE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-pdf-url") || "",
        renderHTML: (attributes) => ({ "data-pdf-url": attributes.url || "" }),
      },
      label: {
        default: "PDF",
        parseHTML: (element) => element.getAttribute("data-pdf-label") || "PDF",
        renderHTML: (attributes) => ({ "data-pdf-label": attributes.label || "PDF" }),
      },
      displayMode: {
        default: "compact",
        parseHTML: (element) => resolvePdfDisplayMode(element.getAttribute("data-pdf-display-mode")),
        renderHTML: (attributes) => ({
          "data-pdf-display-mode": resolvePdfDisplayMode(attributes.displayMode),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="edgeever-pdf-attachment"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "edgeever-pdf-attachment",
        class: "edgeever-pdf-attachment",
      }),
    ];
  },

  parseMarkdown: (token) => ({
    type: PDF_ATTACHMENT_NODE_TYPE,
    attrs: { url: token.url || "", label: token.label || "PDF", displayMode: "compact" },
  }),

  renderMarkdown: (node) => `[${escapeMarkdownLabel(String(node.attrs?.label || "PDF"))}](${String(node.attrs?.url || "")})`,

  markdownTokenizer: {
    name: PDF_ATTACHMENT_NODE_TYPE,
    level: "inline",
    start(source: string) {
      const linkStart = source.indexOf("[");
      return linkStart;
    },
    tokenize(source: string) {
      const match = PDF_LINK_PATTERN.exec(source);
      if (!match || !isPdfAttachment(null, match[1]) && !isPdfAttachment(null, match[2])) {
        return undefined;
      }
      return {
        type: PDF_ATTACHMENT_NODE_TYPE,
        raw: match[0],
        label: match[1],
        url: match[2],
      };
    },
  },
});

const getLinkMark = (node: TiptapTextNode): TiptapMark | undefined =>
  node.marks?.find((mark) => mark.type === "link" && typeof mark.attrs?.href === "string");

/** Upgrade legacy standalone PDF link paragraphs without changing their Markdown representation. */
export const upgradeStandalonePdfLinks = (doc: TiptapDoc): TiptapDoc => {
  let changed = false;
  const visit = (node: TiptapNode): TiptapNode => {
    if (node.type === "paragraph" && node.content?.length === 1) {
      const child = node.content[0];
      if (child.type === "text" && "text" in child) {
        const link = getLinkMark(child);
        const href = link?.attrs?.href;
        if (typeof href === "string" && (isPdfAttachment(null, child.text) || isPdfAttachment(null, href))) {
          changed = true;
          return {
            ...node,
            content: [{
              type: PDF_ATTACHMENT_NODE_TYPE,
              attrs: { url: href, label: child.text, displayMode: "compact" },
            }],
          };
        }
      }
    }
    return node.content
      ? { ...node, content: node.content.map((child) => child.type === "text" ? child : visit(child)) }
      : node;
  };
  const content = doc.content.map(visit);
  return changed ? { ...doc, content } : doc;
};
