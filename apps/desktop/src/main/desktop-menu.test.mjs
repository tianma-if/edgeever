import { describe, expect, test } from "bun:test";
import { desktopMenuCopy, screenshotRegionCopy } from "./desktop-menu.mjs";

describe("desktop native menu localization", () => {
  test("uses Chinese labels for Chinese Windows locales", () => {
    const copy = desktopMenuCopy("zh-CN");
    expect(copy.file).toBe("文件");
    expect(copy.edit).toBe("编辑");
    expect(copy.view).toBe("视图");
    expect(copy.window).toBe("窗口");
    expect(copy.restartToUpdate).toBe("重启以更新");
    expect(copy.screenshotToNote).toBe("截取屏幕到笔记");
    expect(screenshotRegionCopy("zh-CN").hint).toBe("拖拽选择区域，松开后保存为笔记");
    expect(screenshotRegionCopy("zh-CN").full).toBe("双击截取整个屏幕");
    expect(screenshotRegionCopy("en-US").cancel).toBe("Esc to cancel");
    expect(screenshotRegionCopy("ja").full).toContain("ダブルクリック");
  });

  test("recognizes other Chinese locale variants", () => {
    expect(desktopMenuCopy("zh-TW").newMemo).toBe("新建筆記");
  });

  test("falls back to English for other or missing locales", () => {
    expect(desktopMenuCopy("en-US").file).toBe("File");
    expect(desktopMenuCopy(undefined).file).toBe("File");
    expect(desktopMenuCopy("it-IT").file).toBe("File");
    expect(screenshotRegionCopy("it-IT").cancel).toBe("Esc to cancel");
    expect(desktopMenuCopy("de-DE").file).toBe("Datei");
    expect(screenshotRegionCopy("de-DE").cancel).toBe("Esc zum Abbrechen");
    expect(desktopMenuCopy("fr-FR").file).toBe("Fichier");
    expect(screenshotRegionCopy("fr-FR").cancel).toBe("Échap pour annuler");
  });

  test("resolves region overlay copy for every desktop locale", () => {
    expect(screenshotRegionCopy("pl-PL").cancel).toBe("Esc anuluje");
    expect(screenshotRegionCopy("ja-JP").cancel).toBe("Esc でキャンセル");
    expect(screenshotRegionCopy("RU").cancel).toBe("Esc — отмена");
    expect(screenshotRegionCopy("zh_Hant").cancel).toBe("Esc 取消");
  });
});
