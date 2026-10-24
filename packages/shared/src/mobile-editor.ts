import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import type { ImageWidthPresetId } from "./image-display";

export type MobileEditorLocale = "zh-CN" | "en-US" | "ja" | "pl" | "ru";

export type MobileEditorToolbarActionId =
  | "undo"
  | "redo"
  | "image"
  | "bold"
  | "bulletList"
  | "taskList"
  | "increaseListIndent"
  | "decreaseListIndent"
  | "blockquote"
  | "horizontalRule";

export const MOBILE_EDITOR_ACTIVE_FLAGS = {
  bold: 1,
  taskList: 2,
  bulletList: 8,
  blockquote: 16,
} as const;

export const MOBILE_EDITOR_TOOLBAR_ACTIONS = [
  { id: "undo", activeFlag: 0 },
  { id: "redo", activeFlag: 0 },
  { id: "image", activeFlag: 0 },
  { id: "bold", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.bold },
  { id: "bulletList", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.bulletList },
  { id: "taskList", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.taskList },
  { id: "increaseListIndent", activeFlag: 0 },
  { id: "decreaseListIndent", activeFlag: 0 },
  { id: "blockquote", activeFlag: MOBILE_EDITOR_ACTIVE_FLAGS.blockquote },
  { id: "horizontalRule", activeFlag: 0 },
] as const satisfies ReadonlyArray<{
  id: MobileEditorToolbarActionId;
  activeFlag: number;
}>;

const MOBILE_EDITOR_COPY = {
  "zh-CN": {
    placeholder: "开始记录...",
    toolbar: "编辑器工具栏",
    actions: {
      undo: "撤销",
      redo: "重做",
      image: "上传图片",
      bold: "加粗",
      bulletList: "无序列表",
      taskList: "任务清单",
      increaseListIndent: "增加列表层级（Tab）",
      decreaseListIndent: "减少列表层级（Shift + Tab）",
      blockquote: "引用",
      horizontalRule: "分割线",
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
    actions: {
      undo: "Undo",
      redo: "Redo",
      image: "Upload image",
      bold: "Bold",
      bulletList: "Bullet list",
      taskList: "Task list",
      increaseListIndent: "Increase list level (Tab)",
      decreaseListIndent: "Decrease list level (Shift + Tab)",
      blockquote: "Quote",
      horizontalRule: "Horizontal rule",
    },
    imageScale: "Image display size",
    imageSizes: {
      small: "Small",
      medium: "Medium",
      large: "Large",
      full: "Full",
    },
  },
  ja: {
    placeholder: "書き始める...",
    toolbar: "エディタのツールバー",
    actions: {
      undo: "元に戻す",
      redo: "やり直す",
      image: "画像をアップロード",
      bold: "太字",
      bulletList: "箇条書き",
      taskList: "タスクリスト",
      increaseListIndent: "リストの階層を上げる（Tab）",
      decreaseListIndent: "リストの階層を下げる（Shift + Tab）",
      blockquote: "引用",
      horizontalRule: "区切り線",
    },
    imageScale: "画像の表示サイズ",
    imageSizes: {
      small: "小",
      medium: "中",
      large: "大",
      full: "幅いっぱい",
    },
  },
  pl: {
    placeholder: "Zacznij pisać...",
    toolbar: "Pasek narzędzi edytora",
    actions: {
      undo: "Cofnij",
      redo: "Ponów",
      image: "Prześlij obraz",
      bold: "Pogrubienie",
      bulletList: "Lista punktowana",
      taskList: "Lista zadań",
      increaseListIndent: "Zwiększ poziom listy (Tab)",
      decreaseListIndent: "Zmniejsz poziom listy (Shift + Tab)",
      blockquote: "Cytat",
      horizontalRule: "Linia pozioma",
    },
    imageScale: "Rozmiar wyświetlania obrazu",
    imageSizes: {
      small: "Mały",
      medium: "Średni",
      large: "Duży",
      full: "Pełna szerokość",
    },
  },
  ru: {
    placeholder: "Начните запись...",
    toolbar: "Панель редактора",
    actions: {
      undo: "Отменить",
      redo: "Повторить",
      image: "Загрузить изображение",
      bold: "Полужирный",
      bulletList: "Маркированный список",
      taskList: "Список задач",
      increaseListIndent: "Увеличить уровень списка (Tab)",
      decreaseListIndent: "Уменьшить уровень списка (Shift + Tab)",
      blockquote: "Цитата",
      horizontalRule: "Горизонтальная линия",
    },
    imageScale: "Размер изображения",
    imageSizes: {
      small: "Маленький",
      medium: "Средний",
      large: "Большой",
      full: "На всю ширину",
    },
  },
} as const;

export const getMobileEditorPlaceholder = (locale: MobileEditorLocale): string =>
  MOBILE_EDITOR_COPY[locale].placeholder;

export const getMobileEditorToolbarLabel = (locale: MobileEditorLocale): string =>
  MOBILE_EDITOR_COPY[locale].toolbar;

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

/**
 * Opening a note, restoring a draft, or applying a template replaces the
 * document. That replacement must not become an undo step, or the first undo
 * would wipe the note back to the previous document.
 */
export const clearMobileEditorUndoHistory = (editor: Editor): void => {
  try {
    const state = editor.state;
    editor.view.updateState(EditorState.create({
      doc: state.doc,
      plugins: state.plugins,
      schema: state.schema,
      selection: state.selection,
    }));
    // updateState does not emit a transaction, so toolbar subscribers would
    // keep the pre-reset undo flag. A no-step transaction refreshes them
    // without recording a new history event or a save.
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false).setMeta("preventUpdate", true));
  } catch {
    try {
      const state = editor.state;
      editor.view.updateState(EditorState.create({
        doc: state.doc,
        plugins: state.plugins,
        schema: state.schema,
      }));
    } catch {
      // The view is not mounted yet. The next user edit still starts a new history.
    }
  }
};

export const getMobileEditorInputAttributes = (className: string): Record<string, string> => ({
  autocapitalize: "sentences",
  autocomplete: "on",
  autocorrect: "on",
  class: className,
  inputmode: "text",
  spellcheck: "true",
});
