import { describe, expect, test } from "bun:test";
import { translateMobileText } from "./mobile-locale.tsx";

describe("mobile locale translation", () => {
  test("keeps Chinese copy unchanged for the Chinese locale", () => {
    expect(translateMobileText("正在同步笔记", "zh-CN")).toBe("正在同步笔记");
  });

  test("translates mobile-only static copy", () => {
    expect(translateMobileText("正在同步笔记", "en-US")).toBe("Syncing your notes");
    expect(translateMobileText("从相册选择", "en-US")).toBe("Choose from library");
  });

  test("interpolates mobile-only template copy", () => {
    expect(translateMobileText("已加载 12 / 40 条笔记", "en-US")).toBe("Loaded 12 of 40 notes");
    expect(translateMobileText("筛选：Pinned · 3 条", "en-US")).toBe("Filter: Pinned · 3 notes");
  });
});
