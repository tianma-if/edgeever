import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

// Session-only display state: local URLs must never enter the saved document.
const previews = new WeakMap<Editor, Map<string, string>>();

export const registerImageUploadPreview = (editor: Editor, source: string, file: Blob) => {
  let sources = previews.get(editor);
  if (!sources) previews.set(editor, sources = new Map());
  if (sources.has(source)) return;
  sources.set(source, URL.createObjectURL(file));
};

export const getImageUploadPreview = (editor: Editor, source: string) =>
  previews.get(editor)?.get(source);

export const releaseImageUploadPreview = (editor: Editor, source: string) => {
  const sources = previews.get(editor);
  const preview = sources?.get(source);
  if (preview) URL.revokeObjectURL(preview);
  sources?.delete(source);
};

/** Release previews after deletion, note switches, and editor destruction too. */
export const pruneImageUploadPreviews = (editor: Editor, doc?: Node) => {
  const sources = previews.get(editor);
  if (!sources?.size) return;
  const liveSources = new Set<string>();
  doc?.descendants((node) => {
    if (node.type.name === "image") liveSources.add(node.attrs.src);
  });
  for (const source of sources.keys()) {
    if (!liveSources.has(source)) releaseImageUploadPreview(editor, source);
  }
};
