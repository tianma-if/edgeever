import { Extension, type Editor } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { SUPPORTED_PASTE_IMAGE_TYPES } from "./editor-pane-helpers";
import { pruneImageUploadPreviews } from "./image-upload-preview";

export type ImageUploadPlaceholder = {
  id: string;
  filename: string;
  previewUrl: string | null;
  statusLabel: string;
  kind: "image" | "file";
};

type ImageUploadPlaceholderAction =
  | { type: "add"; placeholder: ImageUploadPlaceholder; position: number }
  | { type: "remove"; id: string };

let nextPlaceholderId = 0;

export const IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY = new PluginKey<DecorationSet>(
  "edgeever-image-upload-placeholder",
);

const renderPlaceholder = (placeholder: ImageUploadPlaceholder) => {
  const element = document.createElement("figure");
  const isFile = placeholder.kind === "file";
  element.className = isFile ? "edgeever-file-upload-placeholder" : "edgeever-image-upload-placeholder";
  element.contentEditable = "false";
  element.dataset.placeholderId = placeholder.id;
  element.setAttribute("role", "status");
  element.setAttribute("aria-label", `${placeholder.statusLabel}: ${placeholder.filename}`);

  if (isFile) {
    const icon = document.createElement("span");
    icon.className = "edgeever-file-upload-placeholder__icon";
    icon.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
    outline.setAttribute("d", "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2v7h7 M8 14h8 M8 18h6");
    svg.appendChild(outline);
    icon.appendChild(svg);
    element.appendChild(icon);

    const filename = document.createElement("span");
    filename.className = "edgeever-file-upload-placeholder__filename";
    filename.textContent = placeholder.filename;
    element.appendChild(filename);
  } else if (placeholder.previewUrl) {
    const preview = document.createElement("img");
    preview.className = "edgeever-image-upload-placeholder__preview";
    preview.src = placeholder.previewUrl;
    preview.alt = "";
    preview.setAttribute("aria-hidden", "true");
    preview.addEventListener("load", () => element.classList.add("is-preview-ready"), { once: true });
    element.appendChild(preview);
  }

  const status = document.createElement("figcaption");
  status.className = isFile
    ? "edgeever-file-upload-placeholder__status"
    : "edgeever-image-upload-placeholder__status";

  const spinner = document.createElement("span");
  spinner.className = "edgeever-image-upload-placeholder__spinner";
  spinner.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "edgeever-upload-placeholder__label";
  label.textContent = placeholder.statusLabel;
  status.appendChild(spinner);
  status.appendChild(label);
  element.appendChild(status);
  return element;
};

export const createImageUploadPlaceholderPlugin = (editor?: Editor) => new Plugin<DecorationSet>({
  key: IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY,
  state: {
    init: () => DecorationSet.empty,
    apply: (transaction, decorations) => {
      const mappedDecorations = decorations.map(transaction.mapping, transaction.doc);
      const action = transaction.getMeta(
        IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY,
      ) as ImageUploadPlaceholderAction | undefined;

      if (!action) return mappedDecorations;
      if (action.type === "remove") {
        return mappedDecorations.remove(
          mappedDecorations.find(undefined, undefined, (spec) => spec.id === action.id),
        );
      }

      const position = Math.max(0, Math.min(action.position, transaction.doc.content.size));
      return mappedDecorations.add(transaction.doc, [
        Decoration.widget(
          position,
          () => renderPlaceholder(action.placeholder),
          {
            id: action.placeholder.id,
            key: action.placeholder.id,
            // Keep an editable caret after a block-sized widget in an empty
            // paragraph. Forcing it before the widget loses Chromium's selection.
            side: -1,
            relaxedSide: true,
            ignoreSelection: true,
          },
        ),
      ]);
    },
  },
  props: {
    decorations: (state) => IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY.getState(state) ?? null,
  },
  view: () => ({
    update: (view, previous) => {
      if (editor && view.state.doc !== previous.doc) pruneImageUploadPreviews(editor, view.state.doc);
    },
    destroy: () => { if (editor) pruneImageUploadPreviews(editor); },
  }),
});

export const ImageUploadPlaceholderExtension = Extension.create({
  name: "edgeeverImageUploadPlaceholder",
  addProseMirrorPlugins() {
    return [createImageUploadPlaceholderPlugin(this.editor)];
  },
});

export const createImageUploadPlaceholder = (
  file: File,
  statusLabel: string,
): ImageUploadPlaceholder => {
  nextPlaceholderId += 1;
  let previewUrl: string | null = null;
  try {
    previewUrl = URL.createObjectURL(file);
  } catch {
    // The stable skeleton remains useful when a runtime cannot create blob URLs.
  }
  return {
    id: `image-upload-${nextPlaceholderId}`,
    filename: file.name,
    previewUrl,
    statusLabel,
    kind: "image",
  };
};

export const createFileUploadPlaceholder = (
  file: File,
  statusLabel: string,
): ImageUploadPlaceholder => {
  nextPlaceholderId += 1;
  return {
    id: `file-upload-${nextPlaceholderId}`,
    filename: file.name,
    previewUrl: null,
    statusLabel,
    kind: "file",
  };
};

/** Every accepted resource gets an immediate placeholder; images keep their local preview. */
export const createResourceUploadPlaceholder = (
  file: File,
  labels: { imagePreparing: string; fileWaiting: string },
): ImageUploadPlaceholder => SUPPORTED_PASTE_IMAGE_TYPES.has(file.type)
  ? createImageUploadPlaceholder(file, labels.imagePreparing)
  : createFileUploadPlaceholder(file, labels.fileWaiting);

export const addImageUploadPlaceholder = (
  editor: Editor,
  placeholder: ImageUploadPlaceholder,
  position = editor.state.selection.from,
) => {
  editor.view.dispatch(editor.state.tr.setMeta(IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY, {
    type: "add",
    placeholder,
    position,
  } satisfies ImageUploadPlaceholderAction));
};

export const removeImageUploadPlaceholder = (
  editor: Editor | null | undefined,
  placeholder: ImageUploadPlaceholder,
) => {
  if (editor && !editor.isDestroyed) {
    editor.view.dispatch(editor.state.tr.setMeta(IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY, {
      type: "remove",
      id: placeholder.id,
    } satisfies ImageUploadPlaceholderAction));
  }
  if (placeholder.previewUrl) {
    URL.revokeObjectURL(placeholder.previewUrl);
  }
};

export const updateImageUploadPlaceholder = (
  editor: Editor | null | undefined,
  placeholder: ImageUploadPlaceholder,
  statusLabel: string,
) => {
  placeholder.statusLabel = statusLabel;
  if (!editor || editor.isDestroyed) return;
  // Update the widget in place so its decoded local preview stays mounted.
  const element = editor.view.dom.querySelector(`[data-placeholder-id="${placeholder.id}"]`);
  element?.setAttribute("aria-label", `${statusLabel}: ${placeholder.filename}`);
  const label = element?.querySelector(".edgeever-upload-placeholder__label");
  if (label) label.textContent = statusLabel;
};

/** Resolve an upload anchor after all edits made since the file was dropped. */
export const getImageUploadPlaceholderPosition = (state: EditorState, id: string): number | null =>
  IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY.getState(state)
    ?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from ?? null;
