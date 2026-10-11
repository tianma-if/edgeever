import { expect, test } from "bun:test";
import { createPosterDocument } from "@edgeever/shared";
import { applyPosterEdits } from "./mcp-poster-tools";

test("poster edits reject locked elements, duplicate IDs, unknown patch keys and invalid geometry", () => {
  const poster = createPosterDocument("Hello");
  const element = poster.elements.find(element => element.type === "text");
  const input = patch => ({ memoId: "memo", expectedRevision: 1, edits: [{ id: element.id, patch }] });
  expect(() => applyPosterEdits(input({ text: "Bad" }), { ...poster, elements: poster.elements.map(item => item.id === element.id ? { ...item, locked: true } : item) })).toThrow();
  expect(() => applyPosterEdits({ ...input({ text: "Bad" }), edits: [input({ text: "One" }).edits[0], input({ text: "Two" }).edits[0]] }, poster)).toThrow();
  expect(() => applyPosterEdits(input({ resourceId: "other" }), poster)).toThrow();
  expect(() => applyPosterEdits(input({ width: -1 }), poster)).toThrow();
  expect(() => applyPosterEdits({ memoId: "memo", expectedRevision: 1 }, poster)).toThrow();
});

test("poster edits update canonical copy, support background changes and retain a preview on no-op", () => {
  const poster = { ...createPosterDocument("Hello"), previewResourceId: "preview" };
  const title = poster.elements.find(element => element.type === "text");
  const changed = applyPosterEdits({ memoId: "memo", expectedRevision: 1, background: "#16A06E", edits: [{ id: title.id, patch: { text: "New heading" } }] }, poster);
  expect(changed.document.background).toBe("#16A06E");
  expect(changed.document.elements.find(element => element.id === title.id).sourceText).toBe("New heading");
  expect(changed.document.previewResourceId).toBeUndefined();
  const unchanged = applyPosterEdits({ memoId: "memo", expectedRevision: 1, background: poster.background }, poster);
  expect(unchanged.changed).toBe(false);
  expect(unchanged.document.previewResourceId).toBe("preview");
});
