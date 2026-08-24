import { describe, expect, test } from "bun:test";
import { buildOutlineTree } from "./editor-outline";

const heading = (level, pos, text) => ({ level, pos, text });

describe("editor outline hierarchy", () => {
  test("nests headings beneath the closest preceding shallower heading", () => {
    const tree = buildOutlineTree([
      heading(1, 0, "Project"),
      heading(2, 10, "Plan"),
      heading(3, 20, "Draft"),
      heading(2, 30, "Review"),
      heading(1, 40, "Archive"),
    ]);

    expect(tree.map((item) => item.text)).toEqual(["Project", "Archive"]);
    expect(tree[0]?.children.map((item) => item.text)).toEqual(["Plan", "Review"]);
    expect(tree[0]?.children[0]?.children.map((item) => item.text)).toEqual(["Draft"]);
  });

  test("keeps skipped heading levels attached to the nearest valid ancestor", () => {
    const tree = buildOutlineTree([
      heading(2, 0, "Standalone"),
      heading(4, 10, "Detail"),
      heading(3, 20, "Sibling detail"),
      heading(2, 30, "Next section"),
    ]);

    expect(tree.map((item) => item.text)).toEqual(["Standalone", "Next section"]);
    expect(tree[0]?.children.map((item) => item.text)).toEqual(["Detail", "Sibling detail"]);
  });
});
