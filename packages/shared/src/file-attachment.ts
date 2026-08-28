import { mergeAttributes, Node } from "@tiptap/core";
import type { TiptapDoc, TiptapMark, TiptapNode, TiptapTextNode } from "./content";
import { resolveAttachmentKind } from "./attachment-kind";
import { getAttachmentFilenameFromLabel } from "./resource-links";
import { normalizeAttachmentByteSize } from "./attachment-metadata";

export const FILE_ATTACHMENT_NODE_TYPE = "edgeeverFileAttachment" as const;

const MARKDOWN_LINK_PATTERN = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/;
const ATTACHMENT_LABEL_PATTERN = /^\s*(?:附件[：:]|Attachment:)\s*/i;
const RESOURCE_URL_PATTERN = /(?:\/api\/v1\/resources\/|edgeever-(?:resource|staged):\/\/)/i;

const escapeMarkdownLabel = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

export const isFileAttachmentLink = (label: string, url: string) => {
  const filename = getAttachmentFilenameFromLabel(label) || label || url;
  if (resolveAttachmentKind(null, filename) === "pdf" || resolveAttachmentKind(null, url) === "pdf") {
    return false;
  }
  return ATTACHMENT_LABEL_PATTERN.test(label) || RESOURCE_URL_PATTERN.test(url) || resolveAttachmentKind(null, filename) !== "file";
};

export const FileAttachment = Node.create({
  name: FILE_ATTACHMENT_NODE_TYPE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-file-url") || "",
        renderHTML: (attributes) => ({ "data-file-url": attributes.url || "" }),
      },
      label: {
        default: "Attachment",
        parseHTML: (element) => element.getAttribute("data-file-label") || "Attachment",
        renderHTML: (attributes) => ({ "data-file-label": attributes.label || "Attachment" }),
      },
      filename: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-file-name") || "",
        renderHTML: (attributes) => ({ "data-file-name": attributes.filename || "" }),
      },
      mimeType: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-file-mime-type") || "",
        renderHTML: (attributes) => ({ "data-file-mime-type": attributes.mimeType || "" }),
      },
      byteSize: {
        default: null,
        parseHTML: (element) => normalizeAttachmentByteSize(element.getAttribute("data-file-byte-size")),
        renderHTML: (attributes) => {
          const byteSize = normalizeAttachmentByteSize(attributes.byteSize);
          return byteSize === null ? {} : { "data-file-byte-size": String(byteSize) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="edgeever-file-attachment"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "edgeever-file-attachment",
        class: "edgeever-file-attachment",
      }),
    ];
  },

  parseMarkdown: (token) => {
    const label = token.label || "Attachment";
    return {
      type: FILE_ATTACHMENT_NODE_TYPE,
      attrs: {
        url: token.url || "",
        label,
        filename: getAttachmentFilenameFromLabel(label),
        mimeType: "",
        byteSize: null,
      },
    };
  },

  renderMarkdown: (node) =>
    `[${escapeMarkdownLabel(String(node.attrs?.label || "Attachment"))}](${String(node.attrs?.url || "")})`,

  markdownTokenizer: {
    name: FILE_ATTACHMENT_NODE_TYPE,
    level: "inline",
    start(source: string) {
      return source.indexOf("[");
    },
    tokenize(source: string) {
      const match = MARKDOWN_LINK_PATTERN.exec(source);
      if (!match || !isFileAttachmentLink(match[1], match[2])) return undefined;
      return {
        type: FILE_ATTACHMENT_NODE_TYPE,
        raw: match[0],
        label: match[1],
        url: match[2],
      };
    },
  },
});

const getLinkMark = (node: TiptapTextNode): TiptapMark | undefined =>
  node.marks?.find((mark) => mark.type === "link" && typeof mark.attrs?.href === "string");

const getLinkAttachmentAttrs = (link: TiptapMark | undefined, label: string) => ({
  filename: typeof link?.attrs?.attachmentFilename === "string"
    ? link.attrs.attachmentFilename
    : getAttachmentFilenameFromLabel(label),
  mimeType: typeof link?.attrs?.attachmentMimeType === "string" ? link.attrs.attachmentMimeType : "",
  byteSize: normalizeAttachmentByteSize(link?.attrs?.attachmentByteSize),
});

/** Upgrade legacy standalone attachment links while preserving ordinary web links. */
export const upgradeStandaloneFileLinks = (doc: TiptapDoc): TiptapDoc => {
  let changed = false;
  const visit = (node: TiptapNode): TiptapNode => {
    if (node.type === "paragraph" && node.content?.length === 1) {
      const child = node.content[0];
      if (child.type === "text" && "text" in child) {
        const link = getLinkMark(child);
        const href = link?.attrs?.href;
        if (typeof href === "string" && isFileAttachmentLink(child.text, href)) {
          changed = true;
          return {
            ...node,
            content: [{
              type: FILE_ATTACHMENT_NODE_TYPE,
              attrs: {
                url: href,
                label: child.text,
                ...getLinkAttachmentAttrs(link, child.text),
              },
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
