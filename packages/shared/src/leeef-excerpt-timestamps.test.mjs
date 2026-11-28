import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { markdownToDoc } from "./content.ts";
import { createEdgeEverDocumentExtensions } from "./document-extensions.ts";
import { isLeeefExcerptTimestamp, LeeefExcerptTimestamps } from "./leeef-excerpt-timestamps.ts";
import { createEdgeEverMarkdownMathematics } from "./mathematics-markdown.ts";
import { MERGE_DIVIDER_MARKDOWN_MARKER } from "./merge-divider.ts";

const schema = getSchema(createEdgeEverDocumentExtensions({
  mathematics: createEdgeEverMarkdownMathematics(),
}));
const plugins = LeeefExcerptTimestamps.config.addProseMirrorPlugins.call(LeeefExcerptTimestamps);
const divider = `${MERGE_DIVIDER_MARKDOWN_MARKER}\n\n---`;

const note = (quotes) => [
  divider,
  "## 书摘",
  ...quotes,
  "来自 Leeef Reader",
  divider,
].join("\n\n");

const decorationsFor = (markdown) => {
  const state = EditorState.create({
    doc: schema.nodeFromJSON(markdownToDoc(markdown)),
    plugins,
  });
  return plugins[0].getState(state).find();
};

describe("Leeef excerpt timestamps", () => {
  test("recognizes the current date and the older prefixed date", () => {
    expect(isLeeefExcerptTimestamp("2026-10-26")).toBe(true);
    expect(isLeeefExcerptTimestamp("摘录于 2026-10-26")).toBe(true);
    expect(isLeeefExcerptTimestamp("摘录于2026-10-26")).toBe(false);
    expect(isLeeefExcerptTimestamp("原文 2026-10-26")).toBe(false);
  });

  test("draws a bare date one step smaller", () => {
    const found = decorationsFor(note(["> 原文\n>\n> 2026-10-26"]));
    expect(found).toHaveLength(1);
    expect(found[0].type.attrs.style).toContain("font-size: 0.875em");
  });

  test("hides the retired prefix until the note is synced again", () => {
    const state = EditorState.create({
      doc: schema.nodeFromJSON(markdownToDoc(note(["> 原文\n>\n> 摘录于 2026-10-26"]))),
      plugins,
    });
    const found = plugins[0].getState(state).find();
    expect(found).toHaveLength(2);
    const hidden = found.find((decoration) => decoration.type.attrs.style === "display: none");
    expect(state.doc.textBetween(hidden.from, hidden.to)).toBe("摘录于 ");
  });

  test("leaves a date outside the excerpt section alone", () => {
    expect(decorationsFor("> 2026-10-26")).toHaveLength(0);
  });
});
