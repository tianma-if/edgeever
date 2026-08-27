import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY,
  addImageUploadPlaceholder,
  createImageUploadPlaceholderPlugin,
  removeImageUploadPlaceholder,
} from "./image-upload-placeholder.ts";

const placeholder = {
  id: "upload-1",
  filename: "photo.png",
  previewUrl: null,
  statusLabel: "Processing image",
};

describe("image upload placeholder", () => {
  test("appears immediately, follows document changes, and can be removed", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
    });
    const editor = {
      isDestroyed: false,
      state: EditorState.create({
        schema,
        doc: schema.node("doc", null, [
          schema.node("paragraph", null, schema.text("hello")),
        ]),
        plugins: [createImageUploadPlaceholderPlugin()],
      }),
      view: {
        dispatch(transaction) {
          editor.state = editor.state.apply(transaction);
        },
      },
    };

    addImageUploadPlaceholder(editor, placeholder);
    const initialDecorations = IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY
      .getState(editor.state)
      ?.find(undefined, undefined, (spec) => spec.id === placeholder.id) ?? [];
    expect(initialDecorations).toHaveLength(1);
    expect(initialDecorations[0]?.from).toBe(1);

    editor.view.dispatch(editor.state.tr.insertText("A", 1));
    const mappedDecorations = IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY
      .getState(editor.state)
      ?.find(undefined, undefined, (spec) => spec.id === placeholder.id) ?? [];
    expect(mappedDecorations).toHaveLength(1);
    expect(mappedDecorations[0]?.from).toBe(2);

    removeImageUploadPlaceholder(editor, placeholder);
    expect(IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY.getState(editor.state)?.find()).toHaveLength(0);
  });
});
