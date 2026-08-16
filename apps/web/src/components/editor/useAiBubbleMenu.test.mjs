import { describe, expect, test } from "bun:test";
import { shouldShowAiBubbleMenu } from "./useAiBubbleMenu.ts";

const visibleState = {
  assistantOpen: false,
  editable: true,
  enabled: true,
  selectionEmpty: false,
};

describe("AI bubble menu visibility", () => {
  test("shows for a non-empty editable selection when enabled", () => {
    expect(shouldShowAiBubbleMenu(visibleState)).toBe(true);
  });

  test("stays hidden when disabled, read-only, empty, or already open", () => {
    expect(shouldShowAiBubbleMenu({ ...visibleState, enabled: false })).toBe(false);
    expect(shouldShowAiBubbleMenu({ ...visibleState, editable: false })).toBe(false);
    expect(shouldShowAiBubbleMenu({ ...visibleState, selectionEmpty: true })).toBe(false);
    expect(shouldShowAiBubbleMenu({ ...visibleState, assistantOpen: true })).toBe(false);
  });
});
