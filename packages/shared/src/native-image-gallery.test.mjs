import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
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

  test("never crosses text or nests a gallery, and leaves isolated singletons alone", () => {
    const editor = makeEditor([gallery(), paragraph("keep"), image("one"), paragraph("keep"), image("two")]);
    const original = editor.state.doc;
    expect(groupUploadedImages(editor, ["old-a", "old-b", "one", "two"])).toBe(false);
    expect(groupUploadedImages(editor, ["one"])).toBe(false);
    expect(editor.state.doc).toBe(original);
    editor.isEditable = false;
    expect(groupUploadedImages(editor, ["one", "two"])).toBe(false);
  });

  test("a later single upload extends the saved gallery and preserves layout, selection and undo", () => {
    const editor = makeEditor([gallery()]);
    // Rehydrate the JSON as when returning to the note after autosave.
    editor.state = EditorState.create({ schema, doc: schema.nodeFromJSON(editor.state.doc.toJSON()), plugins: [history()] });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)));
    editor.view.dispatch(createImageInsertTransaction(editor.state, { src: "third", alt: "third" }));
    const beforeGrouping = editor.state.doc.toJSON();
    editor.view.dispatch(closeHistory(editor.state.tr));
    expect(groupUploadedImages(editor, ["third"])).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild.attrs.layout).toBe("3");
    expect(editor.state.doc.firstChild.content.content.map((node) => node.attrs.src)).toEqual(["old-a", "old-b", "third"]);
    expect(editor.state.selection.node.attrs.src).toBe("third");
    editor.state.doc.check();
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.toJSON()).toEqual(beforeGrouping);
    expect(redo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.firstChild.childCount).toBe(3);
    expect(groupUploadedImages(editor, ["third"])).toBe(false);
  });

  for (const layout of ["auto", "1", "2", "3"]) {
    for (const side of ["before", "after"]) {
      test(`merges a later batch ${side} the existing ${layout} gallery in upload order`, () => {
        const existing = schema.nodes[IMAGE_GALLERY_NODE_TYPE].create({ layout }, [image("old-a"), image("old-b")]);
        const editor = makeEditor([existing]);
        for (const [index, src] of ["new-a", "new-b", "new-c"].entries()) {
          const selection = index === 0 ? { from: side === "before" ? 0 : 4, to: side === "before" ? 0 : 4 } : editor.state.selection;
          editor.view.dispatch(createImageInsertTransaction(editor.state, { src }, selection));
        }
        expect(groupUploadedImages(editor, ["new-a", "new-b", "new-c"])).toBe(true);
        expect(editor.state.doc.childCount).toBe(1);
        expect(editor.state.doc.firstChild.attrs.layout).toBe(layout);
        const expected = side === "before" ? ["new-a", "new-b", "new-c", "old-a", "old-b"] : ["old-a", "old-b", "new-a", "new-b", "new-c"];
        expect(editor.state.doc.firstChild.content.content.map((node) => node.attrs.src)).toEqual(expected);
        editor.state.doc.check();
      });
    }
  }

  test("groups only successful Android placeholder replacements and leaves pending uploads alone", () => {
    const editor = makeEditor([gallery()]);
    editor.view.dispatch(createImageInsertTransaction(editor.state, { src: "upload:third" }, { from: 4, to: 4 }));
    editor.view.dispatch(createImageInsertTransaction(editor.state, { src: "upload:pending" }));
    editor.view.dispatch(editor.state.tr.setNodeMarkup(4, undefined, { src: "third", alt: "third" }));
    expect(groupUploadedImages(editor, ["third"])).toBe(true);
    expect(editor.state.doc.firstChild.childCount).toBe(3);
    expect(editor.state.doc.lastChild.attrs.src).toBe("upload:pending");
    // Cancelling the pending upload must leave the existing gallery intact.
    const pendingPos = editor.state.doc.firstChild.nodeSize;
    editor.view.dispatch(editor.state.tr.delete(pendingPos, pendingPos + 1));
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild.content.content.map((node) => node.attrs.src)).toEqual(["old-a", "old-b", "third"]);
  });

  test("does not merge existing galleries or cross an attachment/text boundary", () => {
    const editor = makeEditor([gallery(), image("third"), gallery(), paragraph("attachment"), image("fourth")]);
    expect(groupUploadedImages(editor, ["third", "fourth"])).toBe(true);
    expect(editor.state.doc.childCount).toBe(4);
    expect(editor.state.doc.child(0).childCount).toBe(3);
    expect(editor.state.doc.child(1).childCount).toBe(2);
    expect(editor.state.doc.child(2).textContent).toBe("attachment");
    expect(editor.state.doc.child(3).attrs.src).toBe("fourth");
  });

  test("empty, read-only and destroyed editors do not change", () => {
    const editor = makeEditor([gallery(), image("third")]);
    const original = editor.state.doc;
    expect(groupUploadedImages(editor, [])).toBe(false);
    editor.isEditable = false;
    expect(groupUploadedImages(editor, ["third"])).toBe(false);
    editor.isEditable = true;
    editor.isDestroyed = true;
    expect(groupUploadedImages(editor, ["third"])).toBe(false);
    expect(editor.state.doc).toBe(original);
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
