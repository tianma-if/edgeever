import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import {
  formatNoteSearchMatchLabel,
  getNextSearchMatchIndex,
  getSearchNavigationIdentity,
  getSearchMatchesFromDocument,
} from "./note-search.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

const documentWithParagraphs = (...paragraphs) => schema.node(
  "doc",
  null,
  paragraphs.map((text) => schema.node("paragraph", null, text ? schema.text(text) : undefined)),
);

describe("note search", () => {
  test("finds case-insensitive document positions", () => {
    const matches = getSearchMatchesFromDocument(
      documentWithParagraphs("Alpha beta ALPHA"),
      "alpha",
    );

    expect(matches).toEqual([
      { from: 1, to: 6 },
      { from: 12, to: 17 },
    ]);
  });

  test("does not match across block boundaries", () => {
    const doc = documentWithParagraphs("beta", "alpha");
    expect(getSearchMatchesFromDocument(doc, "betaalpha")).toEqual([]);
    expect(getSearchMatchesFromDocument(doc, "alpha")).toEqual([{ from: 7, to: 12 }]);
  });

  test("returns non-overlapping matches", () => {
    expect(getSearchMatchesFromDocument(documentWithParagraphs("aaaa"), "aa")).toEqual([
      { from: 1, to: 3 },
      { from: 3, to: 5 },
    ]);
  });

  test("wraps navigation and formats the result label", () => {
    expect(getNextSearchMatchIndex(2, 1, 3)).toBe(0);
    expect(getNextSearchMatchIndex(0, -1, 3)).toBe(2);
    expect(getNextSearchMatchIndex(4, 1, 0)).toBe(0);
    expect(formatNoteSearchMatchLabel("alpha", 1, 3)).toBe("2/3");
    expect(formatNoteSearchMatchLabel("alpha", 0, 0)).toBe("0/0");
    expect(formatNoteSearchMatchLabel("  ", 0, 3)).toBe("0/0");
  });

  test("does not treat document edits as a new search navigation request", () => {
    const identityBeforeEdit = getSearchNavigationIdentity("memo-1", "note", "alpha");
    const matchesBeforeEdit = getSearchMatchesFromDocument(
      documentWithParagraphs("alpha before"),
      "alpha",
    );
    const identityAfterEdit = getSearchNavigationIdentity("memo-1", "note", "alpha");
    const matchesAfterEdit = getSearchMatchesFromDocument(
      documentWithParagraphs("changed text", "alpha after"),
      "alpha",
    );

    expect(matchesAfterEdit).not.toEqual(matchesBeforeEdit);
    expect(identityAfterEdit).toBe(identityBeforeEdit);
    expect(getSearchNavigationIdentity("memo-1", "note", "beta")).not.toBe(identityBeforeEdit);
  });
});
