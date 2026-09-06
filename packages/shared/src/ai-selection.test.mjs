import { describe, expect, test } from "bun:test";
import { getAiDocumentFingerprint, isAiSelectionSnapshotCurrent } from "./ai-selection.ts";

describe("AI selection snapshots", () => {
  const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };

  test("accepts a non-empty range against the exact source document", () => {
    expect(isAiSelectionSnapshotCurrent({
      from: 1,
      to: 6,
      documentFingerprint: getAiDocumentFingerprint(document),
    }, document, 7)).toBe(true);
  });

  test("expires a selection after content changes or its range leaves the document", () => {
    const snapshot = { from: 1, to: 6, documentFingerprint: getAiDocumentFingerprint(document) };
    expect(isAiSelectionSnapshotCurrent(snapshot, { ...document, changed: true }, 7)).toBe(false);
    expect(isAiSelectionSnapshotCurrent({ ...snapshot, to: 8 }, document, 7)).toBe(false);
    expect(isAiSelectionSnapshotCurrent({ ...snapshot, to: 1 }, document, 7)).toBe(false);
  });
});
