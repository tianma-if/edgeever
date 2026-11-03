import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";
import { ReplaceAroundStep } from "@tiptap/pm/transform";
import { openBlockSource } from "./markdown-block-start";
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

/** The shared schema uses block images, including inside lists and quotes. */
const normalizeImageParagraphs = (nodes: TiptapNode[]): TiptapNode[] => nodes.flatMap(node => {
  const content = node.content ? normalizeImageParagraphs(node.content) : undefined;
  if (!content) return [node];
  if (node.type === "paragraph" && content.some(child => child.type === "image")) {
    const blocks: TiptapNode[] = [];
    let inline: TiptapNode[] = [];
    const flush = () => { if (inline.length) blocks.push({ ...node, content: inline }); inline = []; };
    for (const child of content) {
      if (child.type === "image") { flush(); blocks.push(child); }
      else inline.push(child);
    }
    flush();
    return blocks;
  }
  if ((node.type === "listItem" || node.type === "taskItem") && node.content?.[0]?.type === "paragraph" && content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
  return [{ ...node, content }];
});

/** A list's required empty first paragraph must not separate its marker from an image. */
export const prepareImageListsForMarkdown = (doc: TiptapDoc): TiptapDoc => {
  const visit = (node: TiptapNode): TiptapNode => {
    if (!node.content) return node;
    let content = node.content.map(child => child.type === "text" ? child : visit(child));
    if ((node.type === "listItem" || node.type === "taskItem")
      && content[0]?.type === "paragraph" && !content[0].content?.length
      && content[1]?.type === "image") {
      content = content.slice(1);
    }
    return { ...node, content };
  };
  return { ...doc, content: doc.content.map(visit) };
};

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

  addProseMirrorPlugins() {
    return [createImageGalleryCleanupPlugin()];
  },

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
    const content = normalizeImageParagraphs(helpers.parseChildren(token.tokens ?? []) as TiptapNode[]);
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
      return openBlockSource(source).indexOf("<!-- edgeever:image-gallery ");
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

  for (const node of normalizeImageParagraphs(nodes)) {
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

/**
 * Repair galleries emptied or left with one image by a move or deletion, in
 * the same undoable edit as the node-view, keyboard or range change.
 */
export const createImageGalleryCleanupPlugin = () => new Plugin({
  key: new PluginKey("edgeever-image-gallery-cleanup"),
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some((transaction) => transaction.docChanged)) return null;

    const repairs: Array<{ from: number; to: number; unwrap: boolean }> = [];
    state.doc.descendants((node, position) => {
      if (node.type.name !== IMAGE_GALLERY_NODE_TYPE) return;
      // image+ makes ProseMirror insert an image with src=null when its last
      // child is deleted. Remove that shell from the live document as well as
      // saved snapshots. Pending uploads have a nonempty src and stay intact.
      const images = node.content.content.filter((image) =>
        typeof image.attrs.src === "string" && image.attrs.src.trim().length > 0
      );
      if (!images.length) {
        repairs.push({ from: position, to: position + node.nodeSize, unwrap: false });
      } else if (node.childCount === 1 && !isTransientImageUploadSource(images[0]!.attrs.src)) {
        // A gallery left with one image after a move or deletion would crop it
        // to the gallery cell. Unwrap it as normalizeImageGalleries() does for
        // snapshots, so the editor shows the standalone image that is saved.
        repairs.push({ from: position, to: position + node.nodeSize, unwrap: true });
      }
      return false;
    });
    if (!repairs.length) return null;

    const transaction = state.tr;
    for (const { from, to, unwrap } of repairs.reverse()) {
      if (!unwrap) {
        transaction.delete(from, to);
        continue;
      }
      // Remove only the wrapper, as lift() would if the gallery were not
      // isolating, so the image and a selection on it keep their identity.
      transaction.maybeStep(new ReplaceAroundStep(from, to, from + 1, to - 1, Slice.empty, 0, true));
    }
    return transaction.docChanged ? transaction : null;
  },
});

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
