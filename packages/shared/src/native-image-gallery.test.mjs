import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { ImageGallery, IMAGE_GALLERY_NODE_TYPE } from "./image-gallery";
import { createImageInsertTransaction, getImageInsertionRange, groupUploadedImages, NATIVE_IMAGE_GALLERY_CSS } from "./native-image-gallery";

const schema = getSchema([StarterKit, Image, ImageGallery]);
const image = (src) => schema.nodes.image.create({ src, alt: src });
const paragraph = (text) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const gallery = () => schema.nodes[IMAGE_GALLERY_NODE_TYPE].create({ layout: "3" }, [image("old-a"), image("old-b")]);
const makeEditor = (nodes) => {
  const editor = {
    schema, isEditable: true, isDestroyed: false,
    state: EditorState.create({ schema, doc: schema.nodes.doc.create(null, nodes), plugins: [history()] }),
  };
  editor.view = { dispatch: (tr) => { editor.state = editor.state.apply(tr); } };
  return editor;
};

describe("native gallery editing", () => {
  test("advances the insertion target through a three-image upload batch", () => {
    const editor = makeEditor([paragraph()]);
    for (const src of ["one", "two", "three"]) {
      editor.view.dispatch(createImageInsertTransaction(editor.state, { src }));
    }
    expect(editor.state.doc.content.content.map((node) => node.attrs.src)).toEqual(["one", "two", "three"]);
    expect(groupUploadedImages(editor, ["one", "two", "three"])).toBe(true);
    expect(editor.state.doc.firstChild.content.content.map((node) => node.attrs.src)).toEqual(["one", "two", "three"]);
  });
  test("groups only this batch, preserves order and is undoable", () => {
    const editor = makeEditor([image("old"), image("one"), image("two"), paragraph("text")]);
    expect(groupUploadedImages(editor, ["one", "two"])).toBe(true);
    expect(editor.state.doc.child(0).attrs.src).toBe("old");
    const group = editor.state.doc.child(1);
    expect(group.type.name).toBe(IMAGE_GALLERY_NODE_TYPE);
    expect(group.attrs.layout).toBe("auto");
    expect(group.content.content.map((node) => node.attrs.src)).toEqual(["one", "two"]);
    undo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.childCount).toBe(4);
    expect(editor.state.doc.child(1).attrs.src).toBe("one");
  });

  test("never crosses text, nests a gallery or groups a single successful upload", () => {
    const editor = makeEditor([gallery(), image("one"), paragraph("keep"), image("two")]);
    const original = editor.state.doc;
    expect(groupUploadedImages(editor, ["old-a", "old-b", "one", "two"])).toBe(false);
    expect(groupUploadedImages(editor, ["one"])).toBe(false);
    expect(editor.state.doc).toBe(original);
    editor.isEditable = false;
    expect(groupUploadedImages(editor, ["one", "two"])).toBe(false);
  });

  test("inserts after selected media instead of replacing it or nesting a gallery", () => {
    const doc = schema.nodes.doc.create(null, [gallery(), image("last"), paragraph("text")]);
    expect(getImageInsertionRange(doc, NodeSelection.create(doc, 0))).toEqual({ from: 4, to: 4 });
    expect(getImageInsertionRange(doc, NodeSelection.create(doc, 1))).toEqual({ from: 4, to: 4 });
    expect(getImageInsertionRange(doc, NodeSelection.create(doc, 4))).toEqual({ from: 5, to: 5 });
    expect(getImageInsertionRange(doc, { from: 6, to: 8 })).toEqual({ from: 6, to: 8 });
  });

  test("layout and source metadata survive JSON round trips", () => {
    const doc = schema.nodes.doc.create(null, [gallery()]);
    expect(schema.nodeFromJSON(doc.toJSON()).toJSON()).toEqual(doc.toJSON());
    expect(NATIVE_IMAGE_GALLERY_CSS).toContain("min-height: 44px");
    expect(NATIVE_IMAGE_GALLERY_CSS).toContain(".edgeever-native-gallery-content .edgeever-image-size-controls { display: none !important; }");
  });
});
