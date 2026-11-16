import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY,
  addImageUploadPlaceholder,
  createFileUploadPlaceholder,
  createImageUploadPlaceholderPlugin,
  createResourceUploadPlaceholder,
  getImageUploadPlaceholderPosition,
  removeImageUploadPlaceholder,
  updateImageUploadPlaceholder,
} from "./image-upload-placeholder.ts";

const placeholder = {
  id: "upload-1",
  filename: "photo.png",
  previewUrl: null,
  statusLabel: "Processing image",
  kind: "image",
};

describe("resource upload placeholder", () => {
  test("uses the loading card for non-PDF attachment types too", () => {
    const files = [
      new File(["notes"], "notes.txt", { type: "text/plain" }),
      new File(["zip"], "archive.zip", { type: "application/zip" }),
      new File(["audio"], "recording.mp3", { type: "audio/mpeg" }),
      new File(["video"], "clip.mp4", { type: "video/mp4" }),
      new File(["doc"], "report.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      new File(["data"], "unknown.bin"),
    ];
    for (const file of files) {
      const pending = createResourceUploadPlaceholder(file, {
        imagePreparing: "Preparing image",
        fileWaiting: "Waiting to upload",
      });
      expect(pending.kind).toBe("file");
      expect(pending.filename).toBe(file.name);
      expect(pending.statusLabel).toBe("Waiting to upload");
    }
  });

  test("shows a file card and updates its upload status before insertion", () => {
    const file = new File(["pdf"], "estimate.pdf", { type: "application/pdf" });
    const pending = createFileUploadPlaceholder(file, "Waiting to upload");
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
    });
    const editor = {
      isDestroyed: false,
      state: EditorState.create({ schema, plugins: [createImageUploadPlaceholderPlugin()] }),
      view: {
        dispatch(transaction) { editor.state = editor.state.apply(transaction); },
        dom: null,
      },
    };
    addImageUploadPlaceholder(editor, pending);
    const widget = IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY.getState(editor.state)?.find()[0];
    expect(widget).toBeDefined();

    const makeElement = (tagName) => ({
      tagName,
      className: "",
      dataset: {},
      children: [],
      attributes: {},
      textContent: "",
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { this.children.push(child); },
      querySelector(selector) {
        if (selector.startsWith("[data-placeholder-id=")) {
          return this.dataset.placeholderId === pending.id ? this : null;
        }
        const className = selector.slice(1);
        return this.children.find((child) => child.className === className)
          ?? this.children.map((child) => child.querySelector(selector)).find(Boolean)
          ?? null;
      },
    });
    const originalDocument = globalThis.document;
    globalThis.document = { createElement: makeElement, createElementNS: (_, tagName) => makeElement(tagName) };
    try {
      editor.view.dom = widget.type.toDOM();
      expect(editor.view.dom.className).toBe("edgeever-file-upload-placeholder");
      expect(editor.view.dom.querySelector(".edgeever-file-upload-placeholder__filename")?.textContent)
        .toBe("estimate.pdf");
      expect(editor.view.dom.attributes["aria-label"]).toBe("Waiting to upload: estimate.pdf");
      updateImageUploadPlaceholder(editor, pending, "Uploading");
      expect(editor.view.dom.querySelector(".edgeever-upload-placeholder__label")?.textContent)
        .toBe("Uploading");
      expect(editor.view.dom.attributes["aria-label"]).toBe("Uploading: estimate.pdf");
    } finally {
      globalThis.document = originalDocument;
    }
  });

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
    expect(getImageUploadPlaceholderPosition(editor.state, placeholder.id)).toBe(1);

    editor.view.dispatch(editor.state.tr.insertText("A", 1));
    const mappedDecorations = IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY
      .getState(editor.state)
      ?.find(undefined, undefined, (spec) => spec.id === placeholder.id) ?? [];
    expect(mappedDecorations).toHaveLength(1);
    // Text typed at the upload caret belongs after the pending image.
    expect(mappedDecorations[0]?.from).toBe(1);
    expect(getImageUploadPlaceholderPosition(editor.state, placeholder.id)).toBe(1);
    expect(mappedDecorations[0]?.spec.relaxedSide).toBe(true);
    expect(mappedDecorations[0]?.spec.ignoreSelection).toBe(true);

    removeImageUploadPlaceholder(editor, placeholder);
    expect(IMAGE_UPLOAD_PLACEHOLDER_PLUGIN_KEY.getState(editor.state)?.find()).toHaveLength(0);
    expect(getImageUploadPlaceholderPosition(editor.state, placeholder.id)).toBeNull();
  });
});

// #709: dropped files use a mapped point, never the previous replacement selection.
describe("drop upload anchors", () => {
  const makeEditor = () => {
    const schema = new Schema({ nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
    } });
    const editor = {
      state: EditorState.create({ schema,
        doc: schema.node("doc", null, [schema.node("paragraph", null, schema.text("before after"))]),
        plugins: [createImageUploadPlaceholderPlugin()],
      }),
      view: { dispatch(tr) { editor.state = editor.state.apply(tr); } },
    };
    return editor;
  };

  test("retains distinct queued drop points through edits before and between them", () => {
    const editor = makeEditor();
    addImageUploadPlaceholder(editor, { ...placeholder, id: "first" }, 5);
    addImageUploadPlaceholder(editor, { ...placeholder, id: "second" }, 10);
    editor.view.dispatch(editor.state.tr.insertText("ABC", 1));
    expect(getImageUploadPlaceholderPosition(editor.state, "first")).toBe(8);
    expect(getImageUploadPlaceholderPosition(editor.state, "second")).toBe(13);
    editor.view.dispatch(editor.state.tr.insertText("XY", 9));
    expect(getImageUploadPlaceholderPosition(editor.state, "first")).toBe(8);
    expect(getImageUploadPlaceholderPosition(editor.state, "second")).toBe(15);
  });

  test("does not revive an anchor whose containing content was deleted", () => {
    const editor = makeEditor();
    addImageUploadPlaceholder(editor, placeholder, 5);
    editor.view.dispatch(editor.state.tr.delete(2, 8));
    expect(getImageUploadPlaceholderPosition(editor.state, placeholder.id)).toBeNull();
  });
});
