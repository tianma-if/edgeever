import { mergeAttributes, Node } from "@tiptap/core";
import type { TiptapDoc, TiptapNode, TiptapTextNode } from "./content";
import { parseImageAlignment } from "./image-alignment";

export const IMAGE_GALLERY_NODE_TYPE = "edgeeverImageGallery" as const;
export const IMAGE_GALLERY_LAYOUTS = ["auto", "2", "3", "1"] as const;
export const IMAGE_GALLERY_FITS = ["width", "height"] as const;
export type ImageGalleryFit = (typeof IMAGE_GALLERY_FITS)[number];
export const resolveImageGalleryFit = (value: unknown): ImageGalleryFit =>
  value === "height" ? "height" : "width";
/** In-document src used while a mobile upload has not finished. */
export const TRANSIENT_IMAGE_UPLOAD_PREFIX = "edgeever-image-upload://";

export const isTransientImageUploadSource = (source: unknown) =>
  typeof source === "string" && source.startsWith(TRANSIENT_IMAGE_UPLOAD_PREFIX);
export type ImageGalleryLayout = (typeof IMAGE_GALLERY_LAYOUTS)[number];

export const resolveImageGalleryLayout = (value: unknown): ImageGalleryLayout =>
  IMAGE_GALLERY_LAYOUTS.includes(value as ImageGalleryLayout)
    ? (value as ImageGalleryLayout)
    : "auto";

/**
 * Width-fit galleries retain the ordinary sequential-image Markdown projection.
 * Height-fit galleries use invisible comments to keep their presentation when
 * editing Markdown, while images remain readable in other Markdown readers.
 */
export const ImageGallery = Node.create({
  name: IMAGE_GALLERY_NODE_TYPE,
  group: "block",
  content: "image+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      fit: {
        default: "width",
        parseHTML: (element: HTMLElement) => resolveImageGalleryFit(
          element.getAttribute("data-image-gallery-fit"),
        ),
        renderHTML: (attributes: { fit?: unknown }) => ({
          "data-image-gallery-fit": resolveImageGalleryFit(attributes.fit),
        }),
      },
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
    const images = helpers.renderChildren(node.content ?? [], "\n\n");
    if (resolveImageGalleryFit(node.attrs?.fit) === "width") return images;
    const layout = resolveImageGalleryLayout(node.attrs?.layout);
    return `<!-- edgeever:image-gallery fit=height layout=${layout} -->\n\n${images}\n\n<!-- /edgeever:image-gallery -->`;
  },

  parseMarkdown(token, helpers) {
    const content = helpers.parseChildren(token.tokens ?? []);
    // A source edit can split a gallery with text. Keep all edited content,
    // rather than forcing non-images into an image-only schema.
    if (content.length < 2 || content.some((child) => child.type !== "image")) return content;
    return helpers.createNode(IMAGE_GALLERY_NODE_TYPE, {
      fit: resolveImageGalleryFit(token.fit),
      layout: resolveImageGalleryLayout(token.layout),
    }, content);
  },

  markdownTokenizer: {
    name: IMAGE_GALLERY_NODE_TYPE,
    level: "block",
    start(source: string) {
      return source.indexOf("<!-- edgeever:image-gallery ");
    },
    tokenize(source: string, _tokens, lexer) {
      const match = /^<!-- edgeever:image-gallery fit=(width|height) layout=(auto|1|2|3) -->\s*\n([\s\S]*?)\n<!-- \/edgeever:image-gallery -->/.exec(source);
      if (!match) return undefined;
      return {
        type: IMAGE_GALLERY_NODE_TYPE,
        raw: match[0],
        fit: match[1],
        layout: match[2],
        tokens: lexer.blockTokens(match[3]!.trim()),
      };
    },
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
    // Explicitly positioned images remain standalone during Markdown import.
    if (node.type === "image" && parseImageAlignment(node.attrs?.alignment)) {
      flushImages();
      grouped.push(node);
      continue;
    }
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
