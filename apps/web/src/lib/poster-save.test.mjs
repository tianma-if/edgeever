import { describe, test, expect } from "bun:test";
import { createPosterDocument, parsePosterDocument, serializePosterDocument } from "@edgeever/shared";
import { canRestorePosterDraft, classifyPosterUpdate, posterMemoContent, savePosterMemo } from "./poster-save";
const memo = { id: "memo", title: "Poster", revision: 3, contentHash: "old", tags: ["design"] };
test("saves source with optimistic revision/hash checks and immutable preview", async () => {
  let payload;
  const repository = {
    uploadMemoResource: async () => ({ resource: { id: "res_new" } }),
    updateMemo: async (_memo, input) => { payload = input; return { memo: { ...memo, ...input } }; },
    deleteResource: async () => { throw new Error("must keep committed preview"); },
  };
  await savePosterMemo(repository, memo, createPosterDocument("Hello"), "Poster", "session", new Blob(["png"]));
  expect(payload).toMatchObject({ expectedRevision: 3, expectedContentHash: "old", editSessionId: "session", tags: ["design"] });
  expect(parsePosterDocument(payload.contentMarkdown)?.previewResourceId).toBe("res_new");
  expect(JSON.stringify(payload.contentJson)).not.toContain("edgeever-poster-v1");
});
test("failed memo save removes only its uncommitted preview, never the previous revision", async () => {
  const deleted = [];
  const repository = {
    uploadMemoResource: async () => ({ resource: { id: "res_new" } }),
    updateMemo: async () => { throw new Error("revision conflict"); },
    getMemo: async () => ({ memo }),
    deleteResource: async (id) => { deleted.push(id); },
  };
  await expect(savePosterMemo(repository, memo, { ...createPosterDocument(), previewResourceId: "res_old" }, "Poster", "session", new Blob(["png"]))).rejects.toThrow("revision conflict");
  expect(deleted).toEqual(["res_new"]);
});
test("metadata-only saves reuse the existing preview and persist edited tags", async () => {
  let payload;
  const repository = {
    uploadMemoResource: async () => { throw new Error("should not upload"); },
    updateMemo: async (_memo, input) => { payload = input; return { memo }; },
  };
  const result = await savePosterMemo(repository, memo, { ...createPosterDocument(), previewResourceId: "res_old" }, "New title", "session", undefined, ["poster", "layout"]);
  expect(result.document.previewResourceId).toBe("res_old");
  expect(payload.tags).toEqual(["poster", "layout"]);
});

test("an uncertain storage failure retains a preview already referenced by source", async () => {
  const { serializePosterDocument } = await import("@edgeever/shared");
  const document = { ...createPosterDocument(), previewResourceId: "res_new" };
  let deleted = false;
  const repository = {
    uploadMemoResource: async () => ({ resource: { id: "res_new" } }),
    updateMemo: async () => { throw new Error("acknowledgement lost"); },
    getMemo: async () => ({ memo: { ...memo, contentMarkdown: serializePosterDocument(document) } }),
    deleteResource: async () => { deleted = true; },
  };
  await expect(savePosterMemo(repository, memo, document, "Poster", "session", new Blob(["png"]))).rejects.toThrow("acknowledgement lost");
  expect(deleted).toBe(false);
});

describe("poster sync updates", () => {
  const document = { ...createPosterDocument("Hello"), previewResourceId: "preview-old" };
  const base = { ...memo, contentMarkdown: serializePosterDocument(document) };
  const acknowledged = { ...base, revision: 4, contentHash: "acknowledged", contentMarkdown: serializePosterDocument({ ...document, previewResourceId: "preview-new" }) };

  test("a sync acknowledgement advances the baseline without losing unsaved edits", () => {
    expect(classifyPosterUpdate(acknowledged, base, true, false)).toBe("rebase");
  });
  test("a local save notification waits until the save result establishes its baseline", () => {
    expect(classifyPosterUpdate(acknowledged, base, true, true)).toBe("defer");
    expect(classifyPosterUpdate(acknowledged, acknowledged, true, false, base)).toBe("ignore");
  });
  test("stale parent props after a save do not roll back the saved baseline", () => {
    expect(classifyPosterUpdate(base, acknowledged, false, false, base)).toBe("ignore");
  });
  test("a genuine artwork change conflicts with a dirty draft", () => {
    const remote = { ...acknowledged, contentMarkdown: serializePosterDocument({ ...document, width: document.width + 100 }) };
    expect(classifyPosterUpdate(remote, base, true, false)).toBe("conflict");
    expect(classifyPosterUpdate(remote, base, false, false)).toBe("replace");
  });
  test("remote title and tag edits still conflict with a dirty draft", () => {
    expect(classifyPosterUpdate({ ...acknowledged, title: "Remote title" }, base, true, false)).toBe("conflict");
    expect(classifyPosterUpdate({ ...acknowledged, tags: ["other"] }, base, true, false)).toBe("conflict");
  });
  test("a remote update during saving is checked once saving finishes", () => {
    const remote = { ...acknowledged, revision: 5, contentHash: "remote", title: "Another device" };
    expect(classifyPosterUpdate(remote, base, true, true)).toBe("defer");
    expect(classifyPosterUpdate(remote, acknowledged, true, false, base)).toBe("conflict");
  });
  test("draft recovery tolerates acknowledgement hashes but protects actual remote edits", () => {
    const draft = { baseHash: base.contentHash, baseContent: posterMemoContent(base) };
    expect(canRestorePosterDraft(draft, acknowledged)).toBe(true);
    expect(canRestorePosterDraft(draft, { ...acknowledged, title: "Changed remotely" })).toBe(false);
    expect(canRestorePosterDraft({ baseHash: base.contentHash }, acknowledged)).toBe(false);
    expect(canRestorePosterDraft({ baseHash: base.contentHash }, base)).toBe(true);
  });
  test("invalid remote source cannot silently rebase a dirty draft", () => {
    expect(classifyPosterUpdate({ ...acknowledged, contentMarkdown: "invalid" }, base, true, false)).toBe("conflict");
  });
});
