import { describe, expect, test } from "bun:test";
import { buildPublicOutlineTree, collectPublicOutlineParentIds } from "./public-article-outline";

const heading = (level, id, text) => ({ level, id, text });

describe("public article outline", () => {
  test("builds a hierarchy from heading levels", () => {
    const tree = buildPublicOutlineTree([
      heading(1, "project", "Project"),
      heading(2, "plan", "Plan"),
      heading(3, "draft", "Draft"),
      heading(2, "review", "Review"),
      heading(1, "archive", "Archive"),
    ]);

    expect(tree.map((item) => item.id)).toEqual(["project", "archive"]);
    expect(tree[0]?.children.map((item) => item.id)).toEqual(["plan", "review"]);
    expect(tree[0]?.children[0]?.children.map((item) => item.id)).toEqual(["draft"]);
  });

  test("collects only headings that can be collapsed", () => {
    const tree = buildPublicOutlineTree([
      heading(1, "project", "Project"),
      heading(2, "plan", "Plan"),
      heading(2, "review", "Review"),
      heading(1, "archive", "Archive"),
    ]);

    expect(collectPublicOutlineParentIds(tree)).toEqual(["project"]);
  });
});
