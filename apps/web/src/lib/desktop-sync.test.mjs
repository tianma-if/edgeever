import { describe, expect, test } from "bun:test";

const {
  isStagedResourceReferenced,
  hasDesktopSyncStateReset,
  mergeMemoIdMappings,
  mergeSyncedMemos,
  normalizeDesktopMemoPayload,
  orderBootstrapNotebooks,
  resolveDesktopMemoSyncBase,
  rewriteStagedResource,
} = await import("./desktop-sync.ts");

describe("desktop staged resource sync", () => {
  test("rewrites placeholders in memo JSON and markdown", () => {
    const rewrites = [{ memoId: "memo-1", placeholder: "edgeever-staged://stage-1", url: "/api/v1/resources/resource-1/blob" }];
    const value = {
      contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "edgeever-staged://stage-1" } }] },
      contentMarkdown: "![photo](edgeever-staged://stage-1)",
    };

    expect(rewriteStagedResource(value, rewrites)).toEqual({
      contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/resources/resource-1/blob" } }] },
      contentMarkdown: "![photo](/api/v1/resources/resource-1/blob)",
    });
  });

  test("never sends desktop-only PDF URLs to the cloud", () => {
    expect(normalizeDesktopMemoPayload({
      contentJson: {
        type: "doc",
        content: [{ type: "pdfAttachment", attrs: { url: "edgeever-resource://resource/res_pdf" } }],
      },
      contentMarkdown: "[Attachment: report.pdf](edgeever-resource://resource/res_pdf)",
    })).toMatchObject({
      contentJson: {
        content: [{ attrs: { url: "/api/v1/resources/res_pdf/blob" } }],
      },
      contentMarkdown: "[Attachment: report.pdf](/api/v1/resources/res_pdf/blob)",
    });
  });

  test("does not consume a staged image before a saved memo update references it", () => {
    const stagedId = "stage-1";

    expect(isStagedResourceReferenced([], stagedId)).toBe(false);
    expect(isStagedResourceReferenced([
      { contentJson: { type: "doc", content: [{ type: "image", attrs: { src: `edgeever-staged://${stagedId}` } }] } },
    ], stagedId)).toBe(true);
  });

  test("does not confuse one staged image id with a longer id that shares its prefix", () => {
    expect(isStagedResourceReferenced([
      { contentMarkdown: "![photo](edgeever-staged://stage-10)" },
    ], "stage-1")).toBe(false);
    expect(isStagedResourceReferenced([
      { contentMarkdown: "![photo](edgeever-staged://stage-1)" },
    ], "stage-1")).toBe(true);
  });

  test("retains a temporary id mapping when a later sync phase fails", () => {
    const retained = mergeMemoIdMappings(new Map(), new Map([["memo_local_1", "memo_remote_1"]]));

    expect(retained.get("memo_local_1")).toBe("memo_remote_1");
  });

  test("keeps the latest acknowledged memo base across sync phases", () => {
    const created = { id: "memo_remote_1", revision: 0 };
    const updated = { id: "memo_remote_1", revision: 1 };
    const retained = mergeSyncedMemos(
      new Map([[created.id, created]]),
      new Map([[updated.id, updated]]),
    );

    expect(retained.get("memo_remote_1")).toEqual(updated);
  });
});

describe("desktop bootstrap sync", () => {
  test("rebuilds when the server cursor rewinds or its identity changes", () => {
    const local = { cursor: 42, syncIdentity: "workspace-a" };
    expect(hasDesktopSyncStateReset(local, { serverCursor: 7, syncIdentity: "workspace-a" })).toBe(true);
    expect(hasDesktopSyncStateReset(local, { serverCursor: 42, syncIdentity: "workspace-b" })).toBe(true);
    expect(hasDesktopSyncStateReset(local, { serverCursor: 64, syncIdentity: "workspace-a" })).toBe(false);
  });

  test("orders parent notebooks before their children", () => {
    const child = { id: "child", parentId: "parent", name: "Child" };
    const parent = { id: "parent", parentId: null, name: "Parent" };
    const grandchild = { id: "grandchild", parentId: "child", name: "Grandchild" };

    expect(orderBootstrapNotebooks([grandchild, child, parent]).map((notebook) => notebook.id)).toEqual([
      "parent",
      "child",
      "grandchild",
    ]);
  });
});

describe("desktop memo sync base", () => {
  test("repairs a legacy local autosave revision that is ahead of the cloud", () => {
    expect(resolveDesktopMemoSyncBase(
      { revision: 3, contentHash: "cloud-3" },
      { expectedRevision: 9, expectedContentHash: "local-autosave-9" },
    )).toEqual({ expectedRevision: 3, expectedContentHash: "cloud-3" });
  });

  test("keeps a genuinely stale base so the server update remains protected", () => {
    expect(resolveDesktopMemoSyncBase(
      { revision: 9, contentHash: "cloud-9" },
      { expectedRevision: 3, expectedContentHash: "cloud-3" },
    )).toEqual({ expectedRevision: 3, expectedContentHash: "cloud-3" });
  });
});
