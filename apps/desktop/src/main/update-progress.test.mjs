import { expect, test } from "bun:test";
import { normalizeUpdateProgress } from "./update-progress.mjs";

test("preserves real updater progress, size and speed", () => {
  expect(normalizeUpdateProgress({ percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 200 }))
    .toEqual({ percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 200 });
});

test("uses transferred bytes when percentage is unavailable and clamps completion", () => {
  expect(normalizeUpdateProgress({ transferred: 500, total: 1000 }).percent).toBe(50);
  expect(normalizeUpdateProgress({ percent: 105, transferred: 1100, total: 1000 }))
    .toMatchObject({ percent: 100, transferred: 1000 });
});

test("unknown and malformed progress stays indeterminate rather than showing false completion", () => {
  expect(normalizeUpdateProgress({ percent: NaN, transferred: -1, total: 0, bytesPerSecond: Infinity }))
    .toEqual({ percent: null, transferred: null, total: null, bytesPerSecond: null });
  expect(normalizeUpdateProgress()).toMatchObject({ percent: null, total: null });
});
