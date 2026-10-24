import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { docToMarkdown, markdownToDoc } from "./content";
import { ImageGallery, resolveImageGalleryFit } from "./image-gallery";
import { imageGalleryCopy, groupUploadedImages } from "./native-image-gallery";
import { EditorState } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { parseHTML } from "linkedom";

const schema = getSchema([StarterKit, Image, ImageGallery]);
const image = (name) => ({ type: "image", attrs: { src: `https://example.test/${name}.png`, alt: name } });
const gallery = (fit, layout = "2") => ({ type: "edgeeverImageGallery", attrs: { fit, layout }, content: [image("portrait"), image("landscape")] });
const doc = (node) => ({ type: "doc", content: [node] });

describe("gallery image fitting", () => {
  test("old and unknown fit values keep the existing width fit", () => {
    for (const value of [undefined, null, "", "width", "invalid", {}, 1]) expect(resolveImageGalleryFit(value)).toBe("width");
    expect(resolveImageGalleryFit("height")).toBe("height");
    expect(schema.nodeFromJSON(doc({ ...gallery(undefined), attrs: { layout: "2" } })).firstChild.attrs.fit).toBe("width");
  });

  test("height fit and column layout survive Markdown editing without a DOM", () => {
    expect(typeof document).toBe("undefined");
    for (const layout of ["auto", "1", "2", "3"]) {
      const markdown = docToMarkdown(doc(gallery("height", layout)));
      expect(markdown).toContain(`<!-- edgeever:image-gallery fit=height layout=${layout} -->`);
      const restored = markdownToDoc(`${markdown}\n\nAn unrelated source edit.`);
      expect(restored.content[0]).toMatchObject(gallery("height", layout));
      expect(restored.content[1].content[0].text).toBe("An unrelated source edit.");
      expect(docToMarkdown(doc(restored.content[0]))).toBe(markdown);
    }
  });

  test("default width-fit Markdown stays ordinary portable images", () => {
    const markdown = docToMarkdown(doc(gallery("width")));
    expect(markdown).not.toContain("edgeever:image-gallery");
    expect(markdownToDoc(markdown).content[0].type).toBe("edgeeverImageGallery");
  });

  test("HTML uses the saved fit for shared pages and reimport", () => {
    const { document: htmlDocument } = parseHTML("<html><body></body></html>");
    const node = schema.nodeFromJSON(doc(gallery("height", "3")));
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document: htmlDocument });
    htmlDocument.body.appendChild(fragment);
    const element = htmlDocument.body.firstElementChild;
    expect(element.getAttribute("data-image-gallery-fit")).toBe("height");
    expect(element.getAttribute("data-image-gallery-layout")).toBe("3");
    expect(DOMParser.fromSchema(schema).parse(htmlDocument.body).firstChild.attrs).toMatchObject({ fit: "height", layout: "3" });
    element.removeAttribute("data-image-gallery-fit");
    expect(DOMParser.fromSchema(schema).parse(htmlDocument.body).firstChild.attrs.fit).toBe("width");
  });

  test("height-fit galleries inside details survive Markdown round trips", () => {
    const nested = { type: "details", content: [
      { type: "detailsSummary", content: [{ type: "text", text: "Photos" }] },
      { type: "detailsContent", content: [gallery("height")] },
    ] };
    expect(markdownToDoc(docToMarkdown(doc(nested))).content[0]).toMatchObject(nested);
  });

  test("source edits inside a gallery preserve prose and remaining images", () => {
    const markdown = docToMarkdown(doc(gallery("height")));
    const restored = markdownToDoc(markdown.replace("![landscape]", "Inserted text.\n\n![landscape]"));
    expect(restored.content.map((node) => node.type)).toEqual(["image", "paragraph", "image"]);
    expect(restored.content[1].content[0].text).toBe("Inserted text.");
    const singleton = markdownToDoc(markdown.replace(/!\[landscape\][^\n]+/, ""));
    expect(singleton.content.map((node) => node.type)).toEqual(["image"]);
  });

  test("fit changes are undoable and survive adding images to either side", () => {
    for (const side of ["before", "after"]) {
      const original = schema.nodeFromJSON(doc(gallery("width")));
      let state = EditorState.create({ schema, doc: original, plugins: [history()] });
      const dispatch = (tr) => { state = state.apply(tr); };
      dispatch(state.tr.setNodeMarkup(0, undefined, { layout: "2", fit: "height" }));
      expect(undo(state, dispatch)).toBe(true);
      expect(state.doc.firstChild.attrs.fit).toBe("width");
      expect(redo(state, dispatch)).toBe(true);
      const extra = schema.nodeFromJSON(image("new"));
      dispatch(state.tr.insert(side === "before" ? 0 : state.doc.content.size, extra));
      const editor = { schema, state, isEditable: true, isDestroyed: false, view: { dispatch: (tr) => { editor.state = editor.state.apply(tr); } } };
      expect(groupUploadedImages(editor, [extra.attrs.src])).toBe(true);
      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.doc.firstChild.attrs).toMatchObject({ fit: "height", layout: "2" });
      expect(editor.state.doc.firstChild.childCount).toBe(3);
      expect(schema.nodeFromJSON(editor.state.doc.toJSON()).toJSON()).toEqual(editor.state.doc.toJSON());
    }
  });

  test("native controls include localized fit choices", () => {
    for (const locale of ["en-US", "zh-CN", "ja", "pl"]) {
      expect(imageGalleryCopy(locale).width.length).toBeGreaterThan(0);
      expect(imageGalleryCopy(locale).height.length).toBeGreaterThan(0);
    }
    expect(imageGalleryCopy("en-US").height).toBe("Fit height");
  });
});
