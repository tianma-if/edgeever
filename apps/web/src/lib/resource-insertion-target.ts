import type { Editor } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import type { Selection } from "@tiptap/pm/state";
import { NodeSelection, Selection as ProseMirrorSelection } from "@tiptap/pm/state";

export type ResourceInsertionTarget = number | { from: number; to: number };

/**
 * Capture where a pasted or dropped resource belongs before its async upload.
 * A selected block node (most commonly the previously inserted image) is not
 * user-selected text to replace, so the next resource belongs after it.
 */
export const getResourceInsertionTarget = (selection: Selection): ResourceInsertionTarget => {
  if (selection instanceof NodeSelection) {
    return selection.to;
  }

  return { from: selection.from, to: selection.to };
};

export const clampResourceInsertionTarget = (
  target: ResourceInsertionTarget,
  documentSize: number,
): ResourceInsertionTarget => {
  if (typeof target === "number") {
    return Math.max(0, Math.min(target, documentSize));
  }

  const from = Math.max(0, Math.min(target.from, documentSize));
  const to = Math.max(from, Math.min(target.to, documentSize));
  return { from, to };
};

export const shouldSelectInsertedResources = (
  interactionVersionAtRequest: number,
  currentInteractionVersion: number,
) => interactionVersionAtRequest === currentInteractionVersion;

/** Clear a selected image/block when the user clicks the empty editor canvas. */
export const clearNodeSelectionAtDocumentEnd = (editor: Editor) => {
  if (!(editor.state.selection instanceof NodeSelection)) {
    return false;
  }

  const documentEnd = editor.state.doc.content.size;
  const resolvedEnd = editor.state.doc.resolve(documentEnd);
  // prosemirror-gapcursor exposes valid() at runtime, but its published
  // declaration currently omits the static method.
  const isValidGap = (GapCursor as typeof GapCursor & {
    valid: (position: typeof resolvedEnd) => boolean;
  }).valid(resolvedEnd);
  const nextSelection = isValidGap
    ? new GapCursor(resolvedEnd)
    : ProseMirrorSelection.atEnd(editor.state.doc);

  // A document containing only a selectable block resolves atEnd() back to
  // that node. GapCursor handles the normal image-only case; avoid claiming
  // success for any schema where no non-node selection is available.
  if (nextSelection instanceof NodeSelection) {
    return false;
  }

  editor.view.dispatch(editor.state.tr.setSelection(nextSelection));
  return true;
};
