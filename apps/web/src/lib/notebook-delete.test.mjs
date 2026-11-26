import { describe, expect, test } from "bun:test";
import { notebookDeleteIdsFromPayload, notebooksBlockedByPendingDeletes } from "./notebook-delete.ts";

describe("notebook delete ids", () => {
  test("uses the ordered descendant list and falls back to the single id", () => {
    expect(notebookDeleteIdsFromPayload({ notebookId: "parent", notebookIds: ["child", "parent"] }, "other")).toEqual(["child", "parent"]);
    expect(notebookDeleteIdsFromPayload({ notebookId: "parent" }, "other")).toEqual(["parent"]);
    expect(notebookDeleteIdsFromPayload({}, "parent")).toEqual(["parent"]);
  });

  test("hides a notebook and every descendant covered by a pending delete", () => {
    const notebooks = [
      { id: "exam", parentId: null },
      { id: "law", parentId: "exam" },
      { id: "history", parentId: "exam" },
      { id: "outline", parentId: "history" },
      { id: "games", parentId: null },
    ];

    expect(notebooksBlockedByPendingDeletes(notebooks, new Set(["exam"]))).toEqual(new Set(["exam", "law", "history", "outline"]));
    expect(notebooksBlockedByPendingDeletes(
      notebooks.filter((notebook) => notebook.id !== "exam"),
      new Set(["exam"]),
    )).toEqual(new Set(["law", "history", "outline"]));
  });
});
