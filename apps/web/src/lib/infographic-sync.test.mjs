import { expect, test } from "bun:test";
import { serializeInfographicDocument } from "@edgeever/shared";
import { classifyInfographicUpdate, infographicEditorSnapshot, infographicMemoSnapshot } from "./infographic-sync";
import { advanceStructuredMemoSyncBase, retainNewerStructuredMemoSyncBase } from "./structured-memo-sync";

const document = { schemaVersion: 1, syntax: "graphic", history: [] };
const base = { id: "memo", title: "Saved", tags: ["work"], contentMarkdown: serializeInfographicDocument(document), revision: 3, contentHash: "base", updatedAt: "2026-10-31T00:00:00Z" };
const receipt = { ...base, revision: 4, contentHash: "ack", updatedAt: "2026-10-31T00:01:00Z" };
const saved = infographicMemoSnapshot(base);

test("old receipts advance only the base and cannot confirm a newer title, graphic, tags or conversation", () => {
  const draft = { ...base, title: "New title", tags: ["new"], contentMarkdown: serializeInfographicDocument({ ...document, syntax: "new graphic", activeSessionId: "new-session", history: [{ id: "turn", prompt: "change", createdAt: "now", kind: "generated", resultTitle: "new" }] }) };
  const advanced = advanceStructuredMemoSyncBase(draft, receipt);
  expect(advanced).toEqual({ ...draft, revision: 4, contentHash: "ack", updatedAt: receipt.updatedAt });
  expect(infographicMemoSnapshot(advanced)).not.toBe(saved);
  expect(classifyInfographicUpdate(receipt, base, saved, true, false)).toBe("rebase");
  expect(base.revision).toBe(3);
});

test("real remote changes apply only to idle editors and preserve an editing draft's original base", () => {
  const remote = { ...receipt, contentMarkdown: serializeInfographicDocument({ ...document, syntax: "remote graphic" }) };
  expect(classifyInfographicUpdate(remote, base, saved, false, false)).toBe("replace");
  expect(classifyInfographicUpdate(remote, base, saved, true, false)).toBe("defer");
  expect(classifyInfographicUpdate(remote, base, saved, false, true)).toBe("defer");
  expect(classifyInfographicUpdate(remote, base, saved, true, true)).toBe("defer");
});

test("a receipt cannot replace a successor draft that has already been saved locally", () => {
  const successor = { ...base, title: "Already saved locally", updatedAt: "2026-10-31T00:02:00Z" };
  const advanced = advanceStructuredMemoSyncBase(successor, receipt);
  const successorSnapshot = infographicMemoSnapshot(successor);
  expect(classifyInfographicUpdate(receipt, advanced, successorSnapshot, false, false, receipt)).toBe("rebase");
  expect(advanced.title).toBe(successor.title);
  expect(infographicMemoSnapshot(advanced)).toBe(successorSnapshot);
  // Matching revision/hash alone cannot disguise another device's metadata edit.
  expect(classifyInfographicUpdate({ ...receipt, title: "Remote title" }, advanced, successorSnapshot, true, false, receipt)).toBe("defer");
});

test("rejects stale or unrelated snapshots and receipts", () => {
  expect(classifyInfographicUpdate(base, receipt, saved, false, false)).toBe("ignore");
  expect(classifyInfographicUpdate({ ...receipt, id: "other" }, base, saved, false, false)).toBe("ignore");
  expect(advanceStructuredMemoSyncBase(receipt, base)).toBe(receipt);
  expect(advanceStructuredMemoSyncBase(base, { ...receipt, id: "other" })).toBe(base);
  expect(classifyInfographicUpdate({ ...receipt, contentMarkdown: "invalid" }, base, saved, false, false)).toBe("ignore");
});

test("equivalent tag order and optional empty history do not create false drafts", () => {
  expect(infographicEditorSnapshot("Title", document, ["b", "a"]))
    .toBe(infographicEditorSnapshot("Title", { schemaVersion: 1, syntax: document.syntax }, ["a", "b"]));
  expect(infographicEditorSnapshot("Title", { ...document, activeSessionId: "another-session" }, ["a", "b"]))
    .not.toBe(infographicEditorSnapshot("Title", document, ["a", "b"]));
});

test("a late local save retains the acknowledged revision alongside its own content", () => {
  const locallySaved = { ...base, title: "New local title", contentMarkdown: "New local content" };
  expect(retainNewerStructuredMemoSyncBase(locallySaved, receipt)).toEqual({
    ...locallySaved, revision: receipt.revision, contentHash: receipt.contentHash, updatedAt: receipt.updatedAt,
  });
  expect(retainNewerStructuredMemoSyncBase(locallySaved, base)).toBe(locallySaved);
});
