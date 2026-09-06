import { describe, expect, test } from "bun:test";
import { desktopMenuCopy } from "./desktop-menu.mjs";

describe("desktop native menu localization", () => {
  test("uses Chinese labels for Chinese Windows locales", () => {
    const copy = desktopMenuCopy("zh-CN");
    expect(copy.file).toBe("文件");
    expect(copy.edit).toBe("编辑");
    expect(copy.view).toBe("视图");
    expect(copy.window).toBe("窗口");
    expect(copy.restartToUpdate).toBe("重启以更新");
  });

  test("recognizes other Chinese locale variants", () => {
    expect(desktopMenuCopy("zh-TW").newMemo).toBe("新建笔记");
  });

  test("falls back to English for other or missing locales", () => {
    expect(desktopMenuCopy("en-US").file).toBe("File");
    expect(desktopMenuCopy(undefined).file).toBe("File");
  });
});
