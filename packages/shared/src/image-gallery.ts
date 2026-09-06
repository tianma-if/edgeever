import { mergeAttributes, Node } from "@tiptap/core";
import type { TiptapDoc, TiptapNode, TiptapTextNode } from "./content";

export const IMAGE_GALLERY_NODE_TYPE = "edgeeverImageGallery" as const;
export const IMAGE_GALLERY_LAYOUTS = ["auto", "2", "3", "1"] as const;
export type ImageGalleryLayout = (typeof IMAGE_GALLERY_LAYOUTS)[number];

export const resolveImageGalleryLayout = (value: unknown): ImageGalleryLayout =>
  IMAGE_GALLERY_LAYOUTS.includes(value as ImageGalleryLayout)
    ? (value as ImageGalleryLayout)
    : "auto";

/**
 * A rich-editor-only layout container. Markdown deliberately serializes its
 * children as ordinary sequential images so exports stay portable.
 */
export const ImageGallery = Node.create({
  name: IMAGE_GALLERY_NODE_TYPE,
  group: "block",
  content: "image+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      layout: {
        default: "auto",
        parseHTML: (element: HTMLElement) => resolveImageGalleryLayout(
          element.getAttribute("data-image-gallery-layout"),
        ),
        renderHTML: (attributes: { layout?: unknown }) => ({
          "data-image-gallery-layout": resolveImageGalleryLayout(attributes.layout),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-edgeever-image-gallery]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-edgeever-image-gallery": "true",
        "data-image-count": String(node.childCount),
      }),
      0,
    ];
  },

  renderMarkdown(node, helpers) {
    return helpers.renderChildren(node.content ?? [], "\n\n");
  },
});

const createGalleryNode = (images: TiptapNode[]): TiptapNode => ({
  type: IMAGE_GALLERY_NODE_TYPE,
  attrs: { layout: "auto" },
  content: images,
});

/** Groups only adjacent image runs and preserves all surrounding node order. */
export const groupConsecutiveImagesIntoGalleries = (nodes: TiptapNode[]): TiptapNode[] => {
  const grouped: TiptapNode[] = [];
  let images: TiptapNode[] = [];

  const flushImages = () => {
    if (images.length === 1) {
      grouped.push(images[0]!);
    } else if (images.length > 1) {
      grouped.push(createGalleryNode(images));
    }
    images = [];
  };

  for (const node of nodes) {
    if (node.type === "image") {
      images.push(node);
      continue;
    }
    flushImages();
    grouped.push(node);
  }
  flushImages();

  return grouped;
};

const hasUsableImageSource = (node: TiptapNode | TiptapTextNode) =>
  node.type === "image" &&
  "attrs" in node &&
  typeof node.attrs?.src === "string" &&
  node.attrs.src.trim().length > 0;

type NormalizedNodes = {
  changed: boolean;
  nodes: Array<TiptapNode | TiptapTextNode>;
};

const normalizeNode = (node: TiptapNode | TiptapTextNode): NormalizedNodes => {
  if (node.type === IMAGE_GALLERY_NODE_TYPE) {
    const images = (node.content ?? []).filter(hasUsableImageSource) as TiptapNode[];
    if (images.length === 0) return { changed: true, nodes: [] };
    if (images.length === 1) return { changed: true, nodes: images };
    if (images.length !== node.content?.length) {
      return { changed: true, nodes: [{ ...node, content: images }] };
    }
    return { changed: false, nodes: [node] };
  }

  if (!("content" in node) || !node.content) {
    return { changed: false, nodes: [node] };
  }

  let changed = false;
  const content = node.content.flatMap((child) => {
    const normalized = normalizeNode(child);
    changed ||= normalized.changed;
    return normalized.nodes;
  });
  return changed
    ? { changed: true, nodes: [{ ...node, content }] }
    : { changed: false, nodes: [node] };
};

/** Removes invalid gallery images and unwraps galleries that no longer contain a group. */
export const normalizeImageGalleries = (doc: TiptapDoc): TiptapDoc => {
  let changed = false;
  const content = doc.content.flatMap((node) => {
    const normalized = normalizeNode(node);
    changed ||= normalized.changed;
    return normalized.nodes as TiptapNode[];
  });

  if (!changed) return doc;
  return {
    ...doc,
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
};
