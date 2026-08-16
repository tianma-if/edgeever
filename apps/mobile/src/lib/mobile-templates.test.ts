import { describe, expect, test } from "bun:test";
import {
  createMemoSeedHasContent,
  mobileTemplateToCreateSeed,
  toMobileSelectableTemplate,
} from "./mobile-templates";

describe("mobile-templates", () => {
  test("maps a persisted template to a selectable row", () => {
    const selectableSaved = toMobileSelectableTemplate(
      {
        id: "tpl_1",
        name: "我的周报",
        description: "团队周报",
        title: "【周报】",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "## 本周",
        tags: ["work", "weekly"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    );
    expect(selectableSaved.title).toBe("【周报】");
    expect(mobileTemplateToCreateSeed(selectableSaved)).toEqual({
      title: "【周报】",
      contentMarkdown: "## 本周",
      tagsText: "work, weekly",
    });
  });

  test("detects whether a seed has user content", () => {
    expect(createMemoSeedHasContent({ title: "", contentMarkdown: "", tagsText: "" })).toBe(false);
    expect(createMemoSeedHasContent({ title: "a", contentMarkdown: "", tagsText: "" })).toBe(true);
    expect(createMemoSeedHasContent({ title: "", contentMarkdown: "x", tagsText: "" })).toBe(true);
    expect(createMemoSeedHasContent({ title: "", contentMarkdown: "", tagsText: "tag" })).toBe(true);
  });
});
