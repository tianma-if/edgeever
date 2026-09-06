import { expect, test } from "bun:test";
import {
  hasSyncCursorRewound,
  hasSyncIdentityChanged,
  isSyncMetadataInitialized,
  splitSyncBootstrapWriteBatches,
} from "@edgeever/shared";

test("rebuilds the mobile mirror when the server change cursor rewinds", () => {
  expect(hasSyncCursorRewound(42, 7)).toBe(true);
  expect(hasSyncCursorRewound(42, 42)).toBe(false);
  expect(hasSyncCursorRewound(42, 64)).toBe(false);
});

test("keeps compatibility with servers that do not report their current cursor", () => {
  expect(hasSyncCursorRewound(42)).toBe(false);
});

test("rebuilds the mobile mirror when the server data identity changes", () => {
  expect(hasSyncIdentityChanged("workspace-created-at-a", "workspace-created-at-b")).toBe(true);
  expect(hasSyncIdentityChanged("workspace-created-at-a", "workspace-created-at-a")).toBe(false);
});

test("keeps compatibility with servers that do not report a data identity", () => {
  expect(hasSyncIdentityChanged("legacy")).toBe(false);
});

test("waits for a complete local mirror before rendering an empty notebook", () => {
  expect(isSyncMetadataInitialized("42", "workspace-a")).toBe(true);
  expect(isSyncMetadataInitialized(null, "workspace-a")).toBe(false);
  expect(isSyncMetadataInitialized("42", null)).toBe(false);
  expect(isSyncMetadataInitialized("not-a-number", "workspace-a")).toBe(false);
});

test("splits the initial mirror into progressive write batches", () => {
  const items = Array.from({ length: 123 }, (_, index) => index);
  expect(splitSyncBootstrapWriteBatches(items, 50).map((batch) => batch.length)).toEqual([50, 50, 23]);
  expect(splitSyncBootstrapWriteBatches([], 50)).toEqual([[]]);
});
