import { describe, expect, test } from "bun:test";
import { buildNotebookTree, formatLocalizedDateTime, parseTagsText } from "./utils.ts";

const notebook = (id, parentId, memoCount, lastMemoUpdatedAt = null) => ({
  id,
  parentId,
  name: id,
  slug: null,
  icon: null,
  color: null,
  sortOrder: 0,
  memoCount,
  lastMemoUpdatedAt,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("buildNotebookTree", () => {
  test("rolls descendant memo counts and update times into every ancestor", () => {
    const [root] = buildNotebookTree([
      notebook("root", null, 2, "2026-01-02T00:00:00.000Z"),
      notebook("child", "root", 3, "2026-01-03T00:00:00.000Z"),
      notebook("grandchild", "child", 5, "2026-01-04T00:00:00.000Z"),
    ]);

    expect(root.memoCount).toBe(10);
    expect(root.lastMemoUpdatedAt).toBe("2026-01-04T00:00:00.000Z");
    expect(root.children[0].memoCount).toBe(8);
    expect(root.children[0].lastMemoUpdatedAt).toBe("2026-01-04T00:00:00.000Z");
    expect(root.children[0].children[0].memoCount).toBe(5);
  });

  test("sorts siblings after descendant counts have been rolled up", () => {
    const roots = buildNotebookTree(
      [
        notebook("larger-subtree", null, 0),
        notebook("child", "larger-subtree", 4),
        notebook("smaller-subtree", null, 3),
      ],
      (first, second) => second.memoCount - first.memoCount,
    );

    expect(roots.map((node) => node.id)).toEqual(["larger-subtree", "smaller-subtree"]);
    expect(roots.map((node) => node.memoCount)).toEqual([4, 3]);
  });

  test("does not mutate the notebook records returned by the repository", () => {
    const root = notebook("root", null, 1);
    const child = notebook("child", "root", 2);

    buildNotebookTree([root, child]);

    expect(root.memoCount).toBe(1);
    expect(root).not.toHaveProperty("children");
  });
});

describe("tag text parsing", () => {
  test("supports multi-word tags and normalizes separators", () => {
    expect(parseTagsText(" #product design, work，ideas\nwork ")).toEqual([
      "product design",
      "work",
      "ideas",
      "work",
    ]);
  });
});

describe("localized date formatting", () => {
  test("includes the year for historical memo timestamps", () => {
    expect(formatLocalizedDateTime("2010-08-30T12:34:00.000Z", "en-US")).toContain("2010");
  });

  test("fails gracefully for invalid timestamps", () => {
    expect(formatLocalizedDateTime("not-a-date", "zh-CN")).toBe("");
  });
});
