import { describe, expect, test } from "bun:test";
import {
  MOBILE_EDITOR_ACTIVE_FLAGS,
  MOBILE_EDITOR_TOOLBAR_ACTIONS,
  getMobileEditorCopy,
  getMobileEditorInputAttributes,
  getMobileEditorImageScaleLabel,
  getMobileEditorImageWidthPresetLabel,
  getMobileEditorPlaceholder,
  getMobileEditorToolbarActionLabel,
  getMobileEditorToolbarLabel,
} from "./mobile-editor.ts";

describe("mobile editor contract", () => {
  test("keeps undo and redo at the start of the mobile toolbar", () => {
    expect(MOBILE_EDITOR_TOOLBAR_ACTIONS.map(({ id }) => id)).toEqual([
      "undo",
      "redo",
      "image",
      "bold",
      "bulletList",
      "taskList",
      "increaseListIndent",
      "decreaseListIndent",
      "blockquote",
      "horizontalRule",
    ]);
    expect(MOBILE_EDITOR_TOOLBAR_ACTIONS.find(({ id }) => id === "bold")?.activeFlag).toBe(
      MOBILE_EDITOR_ACTIVE_FLAGS.bold
    );
  });

  test("provides the same localized copy to both mobile clients", () => {
    expect(getMobileEditorPlaceholder("zh-CN")).toBe("开始记录...");
    expect(getMobileEditorPlaceholder("en-US")).toBe("Start writing...");
    expect(getMobileEditorToolbarLabel("zh-CN")).toBe("编辑器工具栏");
    expect(getMobileEditorToolbarActionLabel("undo", "zh-CN")).toBe("撤销");
    expect(getMobileEditorToolbarActionLabel("redo", "en-US")).toBe("Redo");
    expect(getMobileEditorToolbarActionLabel("undo", "ja")).toBe("元に戻す");
    expect(getMobileEditorToolbarActionLabel("bulletList", "en-US")).toBe("Bullet list");
    expect(getMobileEditorToolbarActionLabel("taskList", "zh-CN")).toBe("任务清单");
    expect(getMobileEditorToolbarActionLabel("increaseListIndent", "zh-CN")).toBe("增加列表层级（Tab）");
    expect(getMobileEditorToolbarActionLabel("decreaseListIndent", "en-US")).toBe("Decrease list level (Shift + Tab)");
    expect(getMobileEditorImageScaleLabel("zh-CN")).toBe("图片显示尺寸");
    expect(getMobileEditorImageWidthPresetLabel("medium", "en-US")).toBe("Medium");
  });

  test("keeps mobile typing assistance enabled", () => {
    expect(getMobileEditorInputAttributes("editor-content")).toEqual({
      autocapitalize: "sentences",
      autocomplete: "on",
      autocorrect: "on",
      class: "editor-content",
      inputmode: "text",
      spellcheck: "true",
    });
  });
});

const collectCopyKeys = (value, prefix = "") =>
  typeof value === "string"
    ? [prefix]
    : Object.entries(value).flatMap(([key, child]) => collectCopyKeys(child, prefix ? `${prefix}.${key}` : key));

describe("mobile editor copy", () => {
  test("ships the same keys for every locale", () => {
    const englishKeys = collectCopyKeys(getMobileEditorCopy("en-US"));
    for (const locale of ["zh-CN", "ja", "pl"]) {
      expect({ locale, keys: collectCopyKeys(getMobileEditorCopy(locale)) }).toEqual({ locale, keys: englishKeys });
    }
  });

  test("localizes editor overlays instead of falling back to English", () => {
    expect(getMobileEditorCopy("pl").codeBlock.copy).toBe("Kopiuj kod");
    expect(getMobileEditorCopy("ja").codeBlock.copy).toBe("コードをコピー");
    expect(getMobileEditorCopy("zh-CN").codeBlock.copy).toBe("复制代码");
  });
});
