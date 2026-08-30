import { describe, expect, test } from "bun:test";
import { persistEmergencyDraft, readEmergencyDraft, removeEmergencyDraft } from "./emergency-draft";

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

describe("emergency editor drafts", () => {
  test("round-trips and removes a draft independently of IndexedDB", () => {
    const storage = createStorage();
    const draft = {
      memoId: "memo-1",
      expectedRevision: 3,
      title: "Local title",
      tagsText: "draft",
      contentJson: { type: "doc", content: [] },
      updatedAt: "2026-08-29T12:00:00.000Z",
    };

    expect(persistEmergencyDraft(draft, storage)).toBe(true);
    expect(readEmergencyDraft(draft.memoId, storage)).toEqual(draft);
    removeEmergencyDraft(draft.memoId, storage);
    expect(readEmergencyDraft(draft.memoId, storage)).toBeNull();
  });

  test("fails closed when browser storage is unavailable", () => {
    const storage = { setItem: () => { throw new Error("quota"); } };
    expect(persistEmergencyDraft({
      memoId: "memo-1",
      title: "",
      tagsText: "",
      contentJson: { type: "doc", content: [] },
      updatedAt: "2026-08-29T12:00:00.000Z",
    }, storage)).toBe(false);
  });
});
