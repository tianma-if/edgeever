import type { ImageWidthPresetId } from "./image-display";

export type MobileEditorLocale = "zh-CN" | "en-US";

export type MobileEditorToolbarActionId =
  | "image"
  | "mermaid"
  | "bold"
  | "bulletList"
  | "increaseListIndent"
  | "decreaseListIndent"
  | "blockquote"
  | "horizontalRule"
  | MobileEditorTableActionId;

export type MobileEditorTableActionId =
  | "insertTable"
  | "addTableRow"
  | "deleteTableRow"
  | "addTableColumn"
  | "deleteTableColumn"
  | "toggleTableHeader"
  | "deleteTable";

export const MOBILE_EDITOR_ACTIVE_FLAGS = {
  bold: 1,
  mermaid: 2,
  bulletList: 8,
  blockquote: 16,
  table: 32,
  tableHeader: 64,
} as const;

export const MOBILE_EDITOR_TOOLBAR_ACTIONS = [
  { id: "image", activeFlag: 0, requiresTable: false },
  { id: "mermaid", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.mermaid, requiresTable: false },
  { id: "bold", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.bold, requiresTable: false },
  { id: "bulletList", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.bulletList, requiresTable: false },
  { id: "increaseListIndent", activeFlag: 0, requiresTable: false },
  { id: "decreaseListIndent", activeFlag: 0, requiresTable: false },
  { id: "blockquote", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.blockquote, requiresTable: false },
  { id: "horizontalRule", activeFlag: 0, requiresTable: false },
  { id: "insertTable", activeFlag: 0, requiresTable: false },
  { id: "addTableRow", activeFlag: 0, requiresTable: true },
  { id: "deleteTableRow", activeFlag: 0, requiresTable: true },
  { id: "addTableColumn", activeFlag: 0, requiresTable: true },
  { id: "deleteTableColumn", activeFlag: 0, requiresTable: true },
  { id: "toggleTableHeader", activeFlag: 0, requiresTable: true },
  { id: "deleteTable", activeFlag: 0, requiresTable: true },
] as const satisfies ReadonlyArray<{
  id: MobileEditorToolbarActionId;
  activeFlag: number;
  requiresTable: boolean;
}>;

export const isMobileEditorActionDisabledInTableHeader = (
  action: MobileEditorToolbarActionId
): boolean => action === "deleteTableRow";

const MOBILE_EDITOR_COPY = {
  "zh-CN": {
    placeholder: "开始记录...",
    toolbar: "编辑器工具栏",
    tableMenu: {
      title: "表格操作",
      close: "关闭",
    },
    actions: {
      image: "上传图片",
      mermaid: "插入 Mermaid 图表",
      bold: "加粗",
      bulletList: "无序列表",
      increaseListIndent: "增加列表层级（Tab）",
      decreaseListIndent: "减少列表层级（Shift + Tab）",
      blockquote: "引用",
      horizontalRule: "分割线",
      insertTable: "插入表格",
      addTableRow: "在下方添加行",
      deleteTableRow: "删除当前行",
      addTableColumn: "在右侧添加列",
      deleteTableColumn: "删除当前列",
      toggleTableHeader: "切换表头行",
      deleteTable: "删除表格",
    },
    imageScale: "图片显示尺寸",
    imageSizes: {
      small: "较小",
      medium: "适中",
      large: "较大",
      full: "铺满",
    },
  },
  "en-US": {
    placeholder: "Start writing...",
    toolbar: "Editor toolbar",
    tableMenu: {
      title: "Table actions",
      close: "Close",
    },
    actions: {
      image: "Upload image",
      mermaid: "Insert Mermaid diagram",
      bold: "Bold",
      bulletList: "Bullet list",
      increaseListIndent: "Increase list level (Tab)",
      decreaseListIndent: "Decrease list level (Shift + Tab)",
      blockquote: "Quote",
      horizontalRule: "Horizontal rule",
      insertTable: "Insert table",
      addTableRow: "Add row below",
      deleteTableRow: "Delete current row",
      addTableColumn: "Add column right",
      deleteTableColumn: "Delete current column",
      toggleTableHeader: "Toggle header row",
      deleteTable: "Delete table",
    },
    imageScale: "Image display size",
    imageSizes: {
      small: "Small",
      medium: "Medium",
      large: "Large",
      full: "Full",
    },
  },
} as const;

export const getMobileEditorPlaceholder = (locale: MobileEditorLocale): string =>
  MOBILE_EDITOR_COPY[locale].placeholder;

export const getMobileEditorToolbarLabel = (locale: MobileEditorLocale): string =>
  MOBILE_EDITOR_COPY[locale].toolbar;

export const getMobileEditorTableMenuCopy = (locale: MobileEditorLocale) =>
  MOBILE_EDITOR_COPY[locale].tableMenu;

export const getMobileEditorToolbarActionLabel = (
  action: MobileEditorToolbarActionId,
  locale: MobileEditorLocale
): string => MOBILE_EDITOR_COPY[locale].actions[action];

export const getMobileEditorImageScaleLabel = (locale: MobileEditorLocale): string =>
  MOBILE_EDITOR_COPY[locale].imageScale;

export const getMobileEditorImageWidthPresetLabel = (
  preset: ImageWidthPresetId,
  locale: MobileEditorLocale
): string => MOBILE_EDITOR_COPY[locale].imageSizes[preset];

export const getMobileEditorInputAttributes = (className: string): Record<string, string> => ({
  autocapitalize: "sentences",
  autocomplete: "on",
  autocorrect: "on",
  class: className,
  inputmode: "text",
  spellcheck: "true",
});
