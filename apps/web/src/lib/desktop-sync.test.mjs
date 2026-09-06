import { describe, expect, test } from "bun:test";

const {
  classifyDesktopSyncFailure,
  createDesktopSyncIssueDetails,
  createDesktopSyncDiagnosticText,
  createDesktopSyncSummary,
  isStagedResourceReferenced,
  hasDesktopSyncStateReset,
  mergeMemoIdMappings,
  mergeSyncedMemos,
  normalizeDesktopMemoPayload,
  orderBootstrapNotebooks,
  resolveDesktopMemoSyncBase,
  rewriteStagedResource,
  shouldAttemptDesktopRecoveryPull,
  shouldPullDesktopChanges,
} = await import("./desktop-sync.ts");
const { ApiRequestError } = await import("./api.ts");

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

describe("desktop sync failure handling", () => {
  test("stops retrying a missing memo update and keeps transient failures retryable", () => {
    expect(classifyDesktopSyncFailure(
      { kind: "memo.update" },
      new ApiRequestError("Memo not found", 404, "not_found"),
    )).toEqual({ conflict: false, retryable: false, errorCode: "memo_not_found" });

    expect(classifyDesktopSyncFailure(
      { kind: "memo.update" },
      new ApiRequestError("Temporarily unavailable", 503),
    )).toEqual({ conflict: false, retryable: true, errorCode: "http_503" });
  });

  test("copies diagnostics without exposing entity ids or payload content", () => {
    const diagnostic = createDesktopSyncDiagnosticText([{
      id: 7,
      kind: "memo.update",
      entityId: "private-memo-id",
      payload: { contentMarkdown: "private note body" },
      attemptCount: 3,
      version: 1,
      status: "error",
      lastError: "Memo memo_private123 not found at https://private.example.test/api",
      lastErrorCode: "memo_not_found",
      retryable: false,
    }]);

    expect(diagnostic).toContain("memo_not_found");
    expect(diagnostic).toContain('"totalItemCount": 1');
    expect(diagnostic).not.toContain('"id": 7');
    expect(diagnostic).not.toContain("private-memo-id");
    expect(diagnostic).not.toContain("private note body");
    expect(diagnostic).not.toContain("memo_private123");
    expect(diagnostic).not.toContain("private.example.test");
  });

  test("keeps a global failure visible in both the summary and details", () => {
    const globalIssue = {
      phase: "pull_remote_changes",
      message: "Request failed at https://private.example.test/api/v1/sync/changes",
      errorCode: "http_500",
      occurredAt: "2026-09-05T00:00:00.000Z",
    };

    expect(createDesktopSyncSummary({ pending: 0, syncing: 0, conflict: 0, error: 0 }, globalIssue)).toEqual({
      total: 1,
      pending: 0,
      syncing: 0,
      conflict: 0,
      error: 1,
    });
    expect(createDesktopSyncIssueDetails([], globalIssue)).toEqual({ globalIssue, items: [] });
    expect(createDesktopSyncDiagnosticText([], globalIssue)).toContain("pull_remote_changes");
    expect(createDesktopSyncDiagnosticText([], globalIssue)).not.toContain("private.example.test");
  });

  test("bounds diagnostics for a prefilled GitHub Issue URL", () => {
    const items = Array.from({ length: 200 }, (_, id) => ({
      id,
      kind: "memo.update",
      entityId: `memo_private_${id}`,
      payload: { contentMarkdown: "private note body" },
      attemptCount: 99_999,
      version: 1,
      status: "error",
      lastError: "Temporary failure ".repeat(40),
      lastErrorCode: "network_error",
      retryable: true,
    }));
    const diagnostic = createDesktopSyncDiagnosticText(items);

    expect(diagnostic).toContain('"totalItemCount": 200');
    expect(diagnostic).toContain('"includedItemCount": 5');
    expect(encodeURIComponent(diagnostic).length).toBeLessThan(6_000);
  });

  test("allows remote pulls while durable errors are handled separately", () => {
    expect(shouldPullDesktopChanges({ pending: 0, syncing: 0, error: 1, conflict: 1 }, true)).toBe(true);
    expect(shouldPullDesktopChanges({ pending: 1, syncing: 0, error: 0, conflict: 0 }, true)).toBe(false);
    expect(shouldPullDesktopChanges({ pending: 0, syncing: 0, error: 0, conflict: 0 }, false)).toBe(false);
  });

  test("attempts a recovery pull only when no local upload can be overwritten", () => {
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 0, syncing: 0 }, true)).toBe(true);
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 1, syncing: 0 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 0, syncing: 1 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("pull_remote_changes", { pending: 0, syncing: 0 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("finalize_resource_remap", { pending: 0, syncing: 0 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 0, syncing: 0 }, false)).toBe(false);
  });
});
