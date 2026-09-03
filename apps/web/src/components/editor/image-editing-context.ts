import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { IMAGE_GALLERY_NODE_TYPE } from "@edgeever/shared";

export const isImageInGallery = (doc: ProseMirrorNode, position: number | undefined): boolean => {
  if (typeof position !== "number" || position < 0 || position > doc.content.size) return false;
  const resolved = doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === IMAGE_GALLERY_NODE_TYPE) return true;
  }
  return false;
};
