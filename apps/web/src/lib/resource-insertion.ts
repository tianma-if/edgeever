import type { Command } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import {
  groupConsecutiveImagesIntoGalleries,
  type TiptapNode,
} from "@edgeever/shared";
import { mergeUploadedImagesIntoAdjacentGalleries } from "@edgeever/shared/image-gallery-editing";
import type { ResourceInsertionTarget } from "./resource-insertion-target";

/** Insert a batch and extend only galleries immediately beside the new media. */
export const insertUploadedResources = (
  target: ResourceInsertionTarget,
  content: TiptapNode[],
  updateSelection: boolean,
): Command => ({ tr, commands, dispatch }) => {
  const nodes = groupConsecutiveImagesIntoGalleries(content).map((node) => tr.doc.type.schema.nodeFromJSON(node));
  if (!commands.insertContentAt(target, Fragment.from(nodes), { updateSelection })) return false;
  if (!dispatch) return true;

  mergeUploadedImagesIntoAdjacentGalleries(tr, nodes);
  return true;
};
