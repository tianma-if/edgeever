import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { ImageGallery, IMAGE_GALLERY_NODE_TYPE } from "@edgeever/shared";
import { hasAiTextSelection, shouldShowAiBubbleMenu } from "./useAiBubbleMenu.ts";

const visibleState = {
  assistantOpen: false,
  editable: true,
  enabled: true,
  selectionEmpty: false,
  selectionHasText: true,
};

describe("AI bubble menu visibility", () => {
  test("shows for a non-empty editable selection when enabled", () => {
    expect(shouldShowAiBubbleMenu(visibleState)).toBe(true);
  });

  test("stays hidden when disabled, read-only, empty, or already open", () => {
    expect(shouldShowAiBubbleMenu({ ...visibleState, enabled: false })).toBe(false);
    expect(shouldShowAiBubbleMenu({ ...visibleState, editable: false })).toBe(false);
    expect(shouldShowAiBubbleMenu({ ...visibleState, selectionEmpty: true })).toBe(false);
    expect(shouldShowAiBubbleMenu({ ...visibleState, assistantOpen: true })).toBe(false);
    expect(shouldShowAiBubbleMenu({ ...visibleState, selectionHasText: false })).toBe(false);
  });

  const schema = getSchema([StarterKit, Image, ImageGallery]);
  const image = () => schema.nodes.image.create({ src: "image.png", alt: "not selected text" });
  const paragraph = (text) => schema.nodes.paragraph.create(null, schema.text(text));
  const isVisible = (doc, selection) => shouldShowAiBubbleMenu({
    ...visibleState,
    selectionEmpty: selection.empty,
    selectionHasText: hasAiTextSelection({ doc, selection }),
  });

  test("hides for standalone images, gallery children, and entire galleries", () => {
    const gallery = schema.nodes[IMAGE_GALLERY_NODE_TYPE].create(null, [image(), image()]);
    const doc = schema.nodes.doc.create(null, [image(), gallery]);
    for (const position of [0, 1, 2, 3]) {
      expect(isVisible(doc, NodeSelection.create(doc, position))).toBe(false);
    }
    expect(isVisible(doc, new AllSelection(doc))).toBe(false);
  });

  test("keeps text and mixed text/image selections available, but not whitespace", () => {
    const doc = schema.nodes.doc.create(null, [paragraph("hello"), image()]);
    expect(isVisible(doc, TextSelection.create(doc, 1, 6))).toBe(true);
    expect(isVisible(doc, new AllSelection(doc))).toBe(true);
    expect(isVisible(doc, TextSelection.create(doc, 1))).toBe(false);
    const blank = schema.nodes.doc.create(null, [paragraph("   "), image()]);
    expect(isVisible(blank, new AllSelection(blank))).toBe(false);
  });
});
