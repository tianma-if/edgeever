import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { EdgeEverLink } from "./editor-link.ts";

const schema = getSchema([
  StarterKit.configure({ link: false }),
  EdgeEverLink,
]);

describe("EdgeEverLink", () => {
  test("does not extend a terminal link into subsequently entered text", () => {
    const link = schema.marks.link.create({ href: "https://example.com" });
    const paragraph = schema.nodes.paragraph.create(null, schema.text("linked", [link]));
    let state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [paragraph]),
    });

    state = state.apply(
      state.tr
        .setSelection(TextSelection.atEnd(state.doc))
        .insertText(" after"),
    );

    expect(state.doc.toJSON().content[0].content).toEqual([
      {
        type: "text",
        marks: [{
          type: "link",
          attrs: {
            href: "https://example.com",
            target: "_blank",
            rel: "noopener noreferrer nofollow",
            class: null,
            title: null,
          },
        }],
        text: "linked",
      },
      { type: "text", text: " after" },
    ]);
  });

  test("retains TipTap's automatic linking features", () => {
    expect(EdgeEverLink.options.autolink).toBe(true);
    expect(EdgeEverLink.options.linkOnPaste).toBe(true);
  });
});
