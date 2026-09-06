import { describe, expect, test } from "bun:test";
import {
  createEmptySyncQueueSummary,
  createEmptySyncRunResult,
  getMemoSyncBaseConflictDetails,
  getNextSyncQueueRetryDelay,
  getSyncRetryAt,
  getSyncRetryDelayMs,
  hasSyncCursorRewound,
  hasSyncIdentityChanged,
  hasSyncStateReset,
  isSyncMetadataInitialized,
  isMemoSyncBaseCurrent,
  splitSyncBootstrapWriteBatches,
  summarizeSyncQueue,
} from "./sync.ts";

describe("shared sync queue contract", () => {
  test("creates independent empty summaries and run results", () => {
    const firstSummary = createEmptySyncQueueSummary();
    const secondSummary = createEmptySyncQueueSummary();
    firstSummary.pending = 1;

    expect(secondSummary).toEqual({
      total: 0,
      pending: 0,
      syncing: 0,
      conflict: 0,
      error: 0,
    });
    expect(createEmptySyncRunResult()).toEqual({
      attempted: 0,
      synced: 0,
      failed: 0,
      conflicted: 0,
    });
  });

  test("summarizes every queue status", () => {
    expect(summarizeSyncQueue([
      { status: "pending" },
      { status: "pending" },
      { status: "syncing" },
      { status: "conflict" },
      { status: "error" },
    ])).toEqual({
      total: 5,
      pending: 2,
      syncing: 1,
      conflict: 1,
      error: 1,
    });
  });

  test("shares capped exponential retry timing", () => {
    const now = Date.parse("2026-08-01T00:00:00.000Z");

    expect(getSyncRetryDelayMs(1)).toBe(2_000);
    expect(getSyncRetryDelayMs(20)).toBe(64_000);
    expect(getSyncRetryAt(2, now)).toBe("2026-08-01T00:00:04.000Z");
  });

  test("finds the earliest retry while ignoring conflicts", () => {
    const now = Date.parse("2026-08-01T00:00:00.000Z");
    const items = [
      { status: "pending", nextAttemptAt: null },
      { status: "error", nextAttemptAt: "2026-08-01T00:00:05.000Z" },
      { status: "conflict", nextAttemptAt: "2026-08-01T00:00:01.000Z" },
    ];

    expect(getNextSyncQueueRetryDelay(items, now)).toBe(250);
    expect(getNextSyncQueueRetryDelay(items.slice(1), now)).toBe(5_000);
    expect(getNextSyncQueueRetryDelay(items.slice(2), now)).toBeNull();
  });

  test("shares edit-session base validation and conflict details", () => {
    const current = { revision: 4, contentHash: "remote-hash" };
    const expected = { expectedRevision: 4, expectedContentHash: "remote-hash" };

    expect(isMemoSyncBaseCurrent(current, expected)).toBe(true);
    expect(isMemoSyncBaseCurrent({ ...current, revision: 5 }, expected)).toBe(false);
    expect(getMemoSyncBaseConflictDetails({ ...current, revision: 5 }, expected)).toEqual({
      expectedRevision: 4,
      currentRevision: 5,
      expectedContentHash: "remote-hash",
      currentContentHash: "remote-hash",
      source: "offline_sync",
    });
  });

  test("detects a reset shared by mobile and desktop mirrors", () => {
    expect(hasSyncCursorRewound(42, 7)).toBe(true);
    expect(hasSyncCursorRewound(42, 42)).toBe(false);
    expect(hasSyncIdentityChanged("workspace-a", "workspace-b")).toBe(true);
    expect(hasSyncIdentityChanged("workspace-a", "workspace-a")).toBe(false);
    expect(hasSyncStateReset(
      { cursor: 42, syncIdentity: "workspace-a" },
      { serverCursor: 64, syncIdentity: "workspace-b" },
    )).toBe(true);
  });

  test("validates mirror metadata and splits bootstrap writes", () => {
    expect(isSyncMetadataInitialized("42", "workspace-a")).toBe(true);
    expect(isSyncMetadataInitialized("not-a-number", "workspace-a")).toBe(false);
    expect(splitSyncBootstrapWriteBatches(Array.from({ length: 123 }, (_, index) => index), 50)
      .map((batch) => batch.length)).toEqual([50, 50, 23]);
    expect(splitSyncBootstrapWriteBatches([], 50)).toEqual([[]]);
  });
});
