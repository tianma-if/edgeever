import { expect, test } from "bun:test";
import { acknowledgeTableUploads } from "./table-upload-lifecycle.ts";

test("a save retires only uploads neither committed nor used by the successor draft", () => {
  const pending = new Set(["committed", "newer", "abandoned"]);
  const removed = acknowledgeTableUploads(pending, new Set(["committed"]), new Set(["newer"]));
  expect(removed).toEqual(["abandoned"]);
  expect([...pending]).toEqual(["newer"]);
  expect(acknowledgeTableUploads(pending, new Set(["newer"]), new Set())).toEqual([]);
  expect(pending.size).toBe(0);
});
