import { normalizeImageGalleries, type TiptapDoc, type TiptapNode } from "@edgeever/shared";

const IMAGE_UPLOAD_PLACEHOLDER_PREFIX = "edgeever-image-upload://";

export const createMobileImageUploadPlaceholderSource = (id: string) =>
  `${IMAGE_UPLOAD_PLACEHOLDER_PREFIX}${id}`;

export const isMobileImageUploadPlaceholderSource = (source: unknown) =>
  typeof source === "string" && source.startsWith(IMAGE_UPLOAD_PLACEHOLDER_PREFIX);

export const stripMobileImageUploadPlaceholders = (doc: TiptapDoc): TiptapDoc => {
  const stripNodes = (nodes: TiptapNode[]): TiptapNode[] => nodes.flatMap((node) => {
    if (node.type === "image" && isMobileImageUploadPlaceholderSource(node.attrs?.src)) {
      return [];
    }

    return [{
      ...node,
      ...(node.content ? { content: stripNodes(node.content as TiptapNode[]) } : {}),
    }];
  });

  const content = stripNodes(doc.content);
  return normalizeImageGalleries({
    ...doc,
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  });
};
