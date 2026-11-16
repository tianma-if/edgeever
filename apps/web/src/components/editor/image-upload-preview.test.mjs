import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import {
  getImageUploadPreview,
  pruneImageUploadPreviews,
  registerImageUploadPreview,
  releaseImageUploadPreview,
} from "./image-upload-preview.ts";

const schema = new Schema({ nodes: {
  doc: { content: "block+" },
  paragraph: { group: "block" },
  image: { group: "block", attrs: { src: {} } },
  text: {},
} });

describe("session-only upload previews", () => {
  test("retains readable local bytes independently of the upload placeholder until released", async () => {
    const editor = {};
    const file = new Blob(["local image bytes"], { type: "image/png" });
    registerImageUploadPreview(editor, "edgeever-resource://resource/first", file);
    const preview = getImageUploadPreview(editor, "edgeever-resource://resource/first");
    expect(await (await fetch(preview)).text()).toBe("local image bytes");
    // Registering twice must not replace/revoke a preview already being painted.
    registerImageUploadPreview(editor, "edgeever-resource://resource/first", file);
    expect(getImageUploadPreview(editor, "edgeever-resource://resource/first")).toBe(preview);
    releaseImageUploadPreview(editor, "edgeever-resource://resource/first");
    expect(getImageUploadPreview(editor, "edgeever-resource://resource/first")).toBeUndefined();
    await expect(fetch(preview)).rejects.toThrow();
  });

  test("isolates editors and releases deleted images, note switches and teardown", async () => {
    const editor = {}, other = {};
    const source = "https://example.com/image.png";
    const file = new Blob(["image"]);
    registerImageUploadPreview(editor, source, file);
    registerImageUploadPreview(editor, "deleted", file);
    registerImageUploadPreview(other, source, file);
    const retained = getImageUploadPreview(editor, source);
    const deleted = getImageUploadPreview(editor, "deleted");
    const doc = schema.node("doc", null, [schema.node("image", { src: source })]);
    pruneImageUploadPreviews(editor, doc);
    expect(getImageUploadPreview(editor, source)).toBe(retained);
    expect(getImageUploadPreview(editor, "deleted")).toBeUndefined();
    await expect(fetch(deleted)).rejects.toThrow();
    expect(JSON.stringify(doc.toJSON())).not.toContain("blob:");
    pruneImageUploadPreviews(editor, schema.node("doc", null, [schema.node("paragraph")]));
    await expect(fetch(retained)).rejects.toThrow();
    expect(getImageUploadPreview(other, source)).toBeDefined();
    pruneImageUploadPreviews(other);
    expect(getImageUploadPreview(other, source)).toBeUndefined();
  });
});
