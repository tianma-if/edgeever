import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
import { IMAGE_GALLERY_NODE_TYPE } from "./image-gallery";

/** Extend adjacent galleries using only the nodes from the completed upload. */
export const mergeUploadedImagesIntoAdjacentGalleries = (
  tr: Transaction,
  nodes: readonly ProseMirrorNode[],
) => {
  // Match node identities, not URLs, so other occurrences are left alone.
  const inserted = new Set(nodes);
  const candidates: Array<{ node: ProseMirrorNode; pos: number }> = [];
  tr.doc.forEach((node, pos) => {
    if (inserted.has(node) && (node.type.name === "image" || node.type.name === IMAGE_GALLERY_NODE_TYPE)) {
      candidates.push({ node, pos });
    }
  });

  // Work backwards so later joins do not invalidate earlier positions. Never
  // cross paragraphs/attachments or combine two pre-existing galleries.
  for (const { node, pos } of candidates.reverse()) {
    const before = tr.doc.resolve(pos).nodeBefore;
    const after = tr.doc.resolve(pos + node.nodeSize).nodeAfter;
    const previousGallery = before?.type.name === IMAGE_GALLERY_NODE_TYPE && !inserted.has(before) ? before : null;
    const nextGallery = after?.type.name === IMAGE_GALLERY_NODE_TYPE && !inserted.has(after) ? after : null;
    const neighbor = previousGallery ?? nextGallery;
    if (!neighbor) continue;

    // Wrap only the new singleton, then join containers. Unlike replacing the
    // entire old gallery, joining maps existing selections within it correctly.
    if (node.type.name === "image") {
      const range = tr.doc.resolve(pos).blockRange(tr.doc.resolve(pos + node.nodeSize));
      if (!range) continue;
      tr.wrap(range, [{ type: neighbor.type, attrs: neighbor.attrs }]);
    } else if (!previousGallery) {
      tr.setNodeMarkup(pos, undefined, neighbor.attrs);
    }
    const joinAt = previousGallery ? pos : pos + tr.doc.nodeAt(pos)!.nodeSize;
    if (canJoin(tr.doc, joinAt)) tr.join(joinAt);
  }
  return tr;
};
