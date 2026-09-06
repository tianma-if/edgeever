import { describe, expect, test } from "bun:test";
import { MOBILE_UI_METRICS, getMobileCenteredScrollOffset, getMobileNotebookSearchVisibleIds, toggleMobileMemoFilterMode, toggleMobileMemoSelection } from "./mobile-ui.ts";

describe("mobile UI contract", () => {
  test("keeps core touch targets and navigation metrics stable", () => {
    expect(MOBILE_UI_METRICS.minimumTouchTarget).toBeGreaterThanOrEqual(44);
    expect(MOBILE_UI_METRICS.bottomNavigationHeight).toBe(52);
    expect(MOBILE_UI_METRICS.floatingCreateButtonLift).toBe(16);
    expect(MOBILE_UI_METRICS.floatingCreateButtonSize).toBe(52);
  });

  test("toggles an exclusive memo filter off when pressed again", () => {
    expect(toggleMobileMemoFilterMode("all", "pinned")).toBe("pinned");
    expect(toggleMobileMemoFilterMode("pinned", "pinned")).toBe("all");
    expect(toggleMobileMemoFilterMode("tagged", "untagged")).toBe("untagged");
  });

  test("shares immutable memo selection behavior across mobile clients", () => {
    const current = new Set(["memo-a"]);
    const added = toggleMobileMemoSelection(current, "memo-b");

    expect(Array.from(current)).toEqual(["memo-a"]);
    expect(Array.from(added)).toEqual(["memo-a", "memo-b"]);
    expect(Array.from(toggleMobileMemoSelection(added, "memo-a"))).toEqual(["memo-b"]);
  });

  test("centers a selected row without scrolling past the start", () => {
    expect(getMobileCenteredScrollOffset(600, 48, 400)).toBe(424);
    expect(getMobileCenteredScrollOffset(80, 48, 400)).toBe(0);
  });

  test("keeps notebook hierarchy context while searching", () => {
    const notebooks = [
      { id: "projects", name: "工作项目", parentId: null },
      { id: "edgeever", name: "EdgeEver", parentId: "projects" },
      { id: "demo", name: "功能演示", parentId: "projects" },
      { id: "personal", name: "生活个人", parentId: null },
    ];

    expect(Array.from(getMobileNotebookSearchVisibleIds(notebooks, "edge"))).toEqual(["edgeever", "projects"]);
    expect(Array.from(getMobileNotebookSearchVisibleIds(notebooks, "工作"))).toEqual(["projects", "edgeever", "demo"]);
    expect(Array.from(getMobileNotebookSearchVisibleIds(notebooks, "没有"))).toEqual([]);
    expect(Array.from(getMobileNotebookSearchVisibleIds(notebooks, ""))).toEqual(["projects", "edgeever", "demo", "personal"]);
  });
});
