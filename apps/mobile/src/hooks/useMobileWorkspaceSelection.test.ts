import { expect, test } from "bun:test";
import {
  remapSelectedMemo,
  toggleVisibleMemoSelection,
} from "./useMobileWorkspaceSelection";

test("toggleVisibleMemoSelection selects and clears only visible memos", () => {
  expect([...toggleVisibleMemoSelection(new Set(["hidden"]), ["memo-1", "memo-2"])]).toEqual([
    "hidden",
    "memo-1",
    "memo-2",
  ]);
  expect([...toggleVisibleMemoSelection(new Set(["hidden", "memo-1", "memo-2"]), ["memo-1", "memo-2"])]).toEqual([
    "hidden",
  ]);
});

test("remapSelectedMemo replaces a temporary id without touching unrelated selections", () => {
  const selected = new Set(["local:1", "memo-2"]);
  expect([...remapSelectedMemo(selected, "local:1", "memo-1")]).toEqual(["memo-2", "memo-1"]);
  expect(remapSelectedMemo(selected, "missing", "memo-3")).toBe(selected);
});
