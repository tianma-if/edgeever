import type { Editor, NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { IMAGE_GALLERY_LAYOUTS, IMAGE_GALLERY_NODE_TYPE, resolveImageGalleryLayout } from "./image-gallery";

/** Adding images while an image/gallery is selected must not replace that content. */
export const getImageInsertionRange = (doc: ProseMirrorNode, selection: { from: number; to: number }) => {
  const from = Math.min(selection.from, doc.content.size);
  const to = Math.min(selection.to, doc.content.size);
  const resolved = doc.resolve(from);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === IMAGE_GALLERY_NODE_TYPE) {
      const after = resolved.after(depth);
      return { from: after, to: after };
    }
  }
  const node = doc.nodeAt(from);
  if (to > from && (node?.type.name === "image" || node?.type.name === IMAGE_GALLERY_NODE_TYPE)) {
    const after = from + node.nodeSize;
    return { from: after, to: after };
  }
  return { from, to };
};

export const createImageInsertTransaction = (
  state: EditorState,
  attrs: Record<string, unknown>,
  selection = state.selection as { from: number; to: number },
) => {
  const { from, to } = getImageInsertionRange(state.doc, selection);
  const image = state.schema.nodes.image.create(attrs);
  const tr = state.tr.replaceRangeWith(from, to, image);
  // ProseMirror may keep the first image selected after an insertion. Explicitly
  // advance to the inserted node so a batch of 3+ images cannot reverse order.
  tr.doc.descendants((node, pos) => {
    if (node === image) tr.setSelection(NodeSelection.create(tr.doc, pos));
  });
  return tr;
};

/** Group only consecutive top-level images from this upload batch. Never move user text. */
export const groupUploadedImages = (editor: Editor, sources: readonly string[]): boolean => {
  if (!editor.isEditable || editor.isDestroyed || sources.length < 2) return false;
  const type = editor.schema.nodes[IMAGE_GALLERY_NODE_TYPE];
  if (!type) return false;
  const wanted = new Set(sources);
  const groups: Array<{ from: number; to: number; images: ProseMirrorNode[] }> = [];
  let current: typeof groups[number] | null = null;
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === "image" && wanted.has(node.attrs.src)) {
      if (!current) current = { from: pos, to: pos, images: [] };
      current.images.push(node);
      current.to = pos + node.nodeSize;
    } else {
      if (current && current.images.length > 1) groups.push(current);
      current = null;
    }
  });
  if (current && (current as typeof groups[number]).images.length > 1) groups.push(current);
  if (!groups.length) return false;
  const tr = editor.state.tr;
  for (const group of groups.reverse()) {
    tr.replaceWith(group.from, group.to, type.create({ layout: "auto" }, group.images));
  }
  editor.view.dispatch(tr);
  return true;
};

/** A shared touch-sized, in-flow toolbar for Android and iOS WebView editors. */
export const createNativeImageGalleryView = (getLocale: () => string): NodeViewRenderer => (
  ({ editor, node, getPos }) => {
    let current = node;
    const dom = document.createElement("div");
    dom.className = "edgeever-native-image-gallery";
    dom.dataset.edgeeverImageGallery = "true";
    const toolbar = document.createElement("div");
    toolbar.className = "edgeever-native-gallery-toolbar";
    toolbar.contentEditable = "false";
    toolbar.setAttribute("role", "toolbar");
    const contentDOM = document.createElement("div");
    contentDOM.className = "edgeever-native-gallery-content";
    const buttons = IMAGE_GALLERY_LAYOUTS.map((layout) => {
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pos = getPos();
        if (!editor.isEditable || typeof pos !== "number") return;
        const target = editor.state.doc.nodeAt(pos);
        if (target?.type.name !== IMAGE_GALLERY_NODE_TYPE) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...target.attrs, layout }));
      });
      toolbar.appendChild(button);
      return { button, layout };
    });
    dom.appendChild(toolbar);
    dom.appendChild(contentDOM);
    const sync = () => {
      const english = getLocale() === "en-US";
      const layout = resolveImageGalleryLayout(current.attrs.layout);
      dom.dataset.imageGalleryLayout = layout;
      dom.dataset.imageCount = String(current.childCount);
      toolbar.hidden = !editor.isEditable;
      toolbar.setAttribute("aria-label", english ? "Image gallery layout" : "图片画廊布局");
      for (const item of buttons) {
        item.button.textContent = item.layout === "auto" ? (english ? "Auto" : "自动")
          : item.layout === "1" ? (english ? "Single" : "单列")
          : `${item.layout} ${english ? "columns" : "栏"}`;
        item.button.setAttribute("aria-pressed", String(item.layout === layout));
      }
    };
    sync();
    editor.on("transaction", sync);
    // setEditable emits update without a document transaction.
    editor.on("update", sync);
    return {
      dom,
      contentDOM,
      update: (next) => {
        if (next.type !== current.type) return false;
        current = next;
        sync();
        return true;
      },
      stopEvent: (event) => toolbar.contains(event.target as globalThis.Node),
      ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
      destroy: () => {
        editor.off("transaction", sync);
        editor.off("update", sync);
      },
    };
  }
);

export const NATIVE_IMAGE_GALLERY_CSS = `
[data-edgeever-image-gallery].edgeever-native-image-gallery { display: block; }
.edgeever-native-gallery-toolbar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; line-height: 1.2; }
.edgeever-native-gallery-toolbar[hidden] { display: none; }
.edgeever-native-gallery-toolbar button { min-height: 44px; padding: 8px 12px; border: 1px solid #16a06e55; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; }
.edgeever-native-gallery-toolbar button[aria-pressed="true"] { color: #16a06e; background: #16a06e22; }
.edgeever-native-gallery-toolbar button:focus-visible { outline: 2px solid #16a06e; outline-offset: 2px; }
.edgeever-native-gallery-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
[data-image-gallery-layout="1"] > .edgeever-native-gallery-content { grid-template-columns: minmax(0, 1fr); }
@media (min-width: 600px) { [data-image-gallery-layout="3"] > .edgeever-native-gallery-content { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.edgeever-native-gallery-content > * { width: 100% !important; min-width: 0; height: 100%; margin: 0 !important; overflow: hidden; border-radius: 10px; background: transparent; }
.edgeever-native-gallery-content > img, .edgeever-native-gallery-content > * > img { width: 100% !important; height: 100%; min-height: 112px; max-height: 220px; object-fit: cover; }
.edgeever-native-gallery-content .edgeever-image-size-controls { display: none !important; }
`;
