import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type ImageUploadPlaceholder = {
  id: string;
  filename: string;
  previewUrl: string | null;
  statusLabel: string;
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
  element.className = "edgeever-image-upload-placeholder";
  element.contentEditable = "false";
  element.dataset.placeholderId = placeholder.id;
  element.setAttribute("role", "status");
  element.setAttribute("aria-label", `${placeholder.statusLabel}: ${placeholder.filename}`);

  if (placeholder.previewUrl) {
    const preview = document.createElement("img");
    preview.className = "edgeever-image-upload-placeholder__preview";
    preview.src = placeholder.previewUrl;
    preview.alt = "";
    preview.setAttribute("aria-hidden", "true");
    preview.addEventListener("load", () => element.classList.add("is-preview-ready"), { once: true });
    element.appendChild(preview);
  }

  const status = document.createElement("figcaption");
  status.className = "edgeever-image-upload-placeholder__status";

  const spinner = document.createElement("span");
  spinner.className = "edgeever-image-upload-placeholder__spinner";
  spinner.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "edgeever-image-upload-placeholder__label";
  label.textContent = placeholder.statusLabel;
  status.appendChild(spinner);
  status.appendChild(label);
  element.appendChild(status);
  return element;
};

export const createImageUploadPlaceholderPlugin = () => new Plugin<DecorationSet>({
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
          { id: action.placeholder.id, key: action.placeholder.id, side: 1 },
        ),
      ]);
    },
  },
  props: {
    decorations: (state) => IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY.getState(state) ?? null,
  },
});

export const ImageUploadPlaceholderExtension = Extension.create({
  name: "edgeeverImageUploadPlaceholder",
  addProseMirrorPlugins() {
    return [createImageUploadPlaceholderPlugin()];
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
  };
};

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
  const label = element?.querySelector(".edgeever-image-upload-placeholder__label");
  if (label) label.textContent = statusLabel;
};

/** Keep the local preview visible until the persisted image can paint. */
export const waitForImageSourceReady = async (source: string, timeoutMs = 4_000) => {
  if (typeof Image === "undefined") return;

  await new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    image.onload = finish;
    image.onerror = finish;
    image.src = source;
    if (image.complete) finish();
  });
};
