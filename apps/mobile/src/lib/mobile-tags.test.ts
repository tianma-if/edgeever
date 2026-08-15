import { expect, test } from "bun:test";
import type { MemoDetail } from "@edgeever/shared";
import { summarizeMobileTags } from "./mobile-tags";

const memo = (id: string, tags: string[], updatedAt: string, isDeleted = false) => ({
  id,
  tags,
  updatedAt,
  isDeleted,
} as MemoDetail);

test("summarizes active memo tags for the offline picker", () => {
  expect(summarizeMobileTags([
    memo("1", ["work", "shared", "work"], "2026-08-13T00:00:00.000Z"),
    memo("2", ["shared", "ideas"], "2026-08-14T00:00:00.000Z"),
    memo("3", ["hidden"], "2026-08-15T00:00:00.000Z", true),
  ])).toEqual([
    { name: "ideas", memoCount: 1, updatedAt: "2026-08-14T00:00:00.000Z" },
    { name: "shared", memoCount: 2, updatedAt: "2026-08-14T00:00:00.000Z" },
    { name: "work", memoCount: 1, updatedAt: "2026-08-13T00:00:00.000Z" },
  ]);
});
