import { describe, expect, test } from "bun:test";
import {
  MOBILE_EDITOR_ACTIVE_FLAGS,
  MOBILE_EDITOR_TOOLBAR_ACTIONS,
  getMobileEditorInputAttributes,
  getMobileEditorImageScaleLabel,
  getMobileEditorImageWidthPresetLabel,
  getMobileEditorPlaceholder,
  getMobileEditorTableMenuCopy,
  getMobileEditorToolbarActionLabel,
  getMobileEditorToolbarLabel,
  isMobileEditorActionDisabledInTableHeader,
} from "./mobile-editor.ts";

describe("mobile editor contract", () => {
  test("keeps the core toolbar compact and ordered by editing frequency", () => {
    expect(MOBILE_EDITOR_TOOLBAR_ACTIONS.map(({ id }) => id)).toEqual([
      "image",
      "mermaid",
      "bold",
      "bulletList",
      "increaseListIndent",
      "decreaseListIndent",
      "blockquote",
      "horizontalRule",
      "insertTable",
      "addTableRow",
      "deleteTableRow",
      "addTableColumn",
      "deleteTableColumn",
      "toggleTableHeader",
      "deleteTable",
    ]);
    expect(MOBILE_EDITOR_TOOLBAR_ACTIONS.find(({ id }) => id === "bold")?.activeFlag).toBe(
      MOBILE_EDITOR_ACTIVE_FLAGS.bold
    );
    expect(isMobileEditorActionDisabledInTableHeader("deleteTableRow")).toBe(true);
    expect(isMobileEditorActionDisabledInTableHeader("deleteTableColumn")).toBe(false);
    expect(MOBILE_EDITOR_ACTIVE_FLAGS.tableHeader & MOBILE_EDITOR_ACTIVE_FLAGS.table).toBe(0);
  });

  test("provides the same localized copy to both mobile clients", () => {
    expect(getMobileEditorPlaceholder("zh-CN")).toBe("开始记录...");
    expect(getMobileEditorPlaceholder("en-US")).toBe("Start writing...");
    expect(getMobileEditorToolbarLabel("zh-CN")).toBe("编辑器工具栏");
    expect(getMobileEditorTableMenuCopy("zh-CN")).toEqual({ title: "表格操作", close: "关闭" });
    expect(getMobileEditorTableMenuCopy("en-US")).toEqual({ title: "Table actions", close: "Close" });
    expect(getMobileEditorToolbarActionLabel("bulletList", "en-US")).toBe("Bullet list");
    expect(getMobileEditorToolbarActionLabel("increaseListIndent", "zh-CN")).toBe("增加列表层级（Tab）");
    expect(getMobileEditorToolbarActionLabel("decreaseListIndent", "en-US")).toBe("Decrease list level (Shift + Tab)");
    expect(getMobileEditorToolbarActionLabel("mermaid", "zh-CN")).toBe("插入 Mermaid 图表");
    expect(getMobileEditorToolbarActionLabel("insertTable", "zh-CN")).toBe("插入表格");
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
