import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import type { ImageWidthPresetId } from "./image-display";

export type MobileEditorLocale = "zh-CN" | "en-US" | "ja" | "pl";

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
    attachmentPrefix: "附件：",
    close: "关闭",
    ai: {
      generationFailed: "AI 生成失败。",
      promptMissing: "所选指令已不存在，请重新选择。",
      selectionExpired: "笔记内容已变化，选区已失效，请重新选择文本。",
      openForNote: "用 AI 处理正文或选中内容",
      openForSelection: "用 AI 处理选中内容",
      emptyNote: "请先输入正文内容。",
      selectionUpdated: "AI 已更新选中内容。",
      actions: {
        summarize: "精简总结",
        "extract-key-points": "提炼要点",
        "extract-todos": "提取待办",
        "rewrite-proofread": "改写与校对",
        translate: "全文翻译",
        "improve-writing": "润色表达",
        "fix-spelling-grammar": "修正错别字与语法",
        "make-shorter": "精炼表达",
        "make-longer": "扩写内容",
        "simplify-language": "简化表达",
        "change-tone": "改变语气",
        "continue-writing": "继续写作",
        custom: "自定义指令",
      },
      languages: {
        en: "英语",
        "zh-CN": "简体中文",
        "zh-TW": "繁体中文",
        ja: "日语",
        ko: "韩语",
        es: "西班牙语",
        fr: "法语",
        de: "德语",
        pt: "葡萄牙语",
        pl: "波兰语",
      },
      tones: {
        professional: "专业",
        friendly: "友好",
        casual: "轻松",
        direct: "直接",
      },
      chooseAction: "选择处理方式",
      chooseTargetLanguage: "选择目标语言",
      chooseTone: "选择语气",
      noteTitle: "AI 全文助手",
      selectionTitle: "AI 选区助手",
      noteScopeHint: "未选择文字，将处理整篇正文。",
      selectionScopeHint: "只处理当前选中的正文。",
      action: "处理方式",
      targetLanguage: "目标语言",
      tone: "语气",
      instruction: "告诉 AI 你想怎么处理",
      instructionPlaceholder: "例如：改写成一封简洁的邮件。",
      draft: "AI 草稿",
      generating: "生成中…",
      draftPlaceholder: "生成的草稿会显示在这里。",
      refineResult: "继续调整",
      refinePlaceholder: "例如：再简洁一点",
      refine: "调整",
      insertAfter: "插入到选区后",
      replaceSelection: "替换选中内容",
      stop: "停止",
      regenerate: "重新生成",
      generate: "生成",
    },
    codeBlock: {
      mermaidPreview: "Mermaid 图表预览",
      copy: "复制代码",
      copied: "已复制",
      copyFailed: "复制失败",
      mermaidSource: "Mermaid 源码",
      codeSource: "代码源码",
      mermaidEmpty: "请在下方输入 Mermaid 源码。",
      rendering: "正在渲染图表…",
      renderFailed: "无法渲染此图表，请检查语法。",
    },
    diagram: {
      mindMap: "思维导图",
      architecture: "架构图",
      flowchart: "流程图",
    },
    image: {
      loadFailed: "图片加载失败",
      uploading: "图片上传中…",
      actions: "图片操作",
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
    attachmentPrefix: "Attachment: ",
    close: "Close",
    ai: {
      generationFailed: "AI generation failed.",
      promptMissing: "The selected prompt no longer exists. Choose another prompt.",
      selectionExpired: "The selection expired because the note changed. Select the text again.",
      openForNote: "Use AI on the note or selected text",
      openForSelection: "Use AI on selected text",
      emptyNote: "Add some note content first.",
      selectionUpdated: "AI updated the selection.",
      actions: {
        summarize: "Summarize",
        "extract-key-points": "Key points",
        "extract-todos": "Extract tasks",
        "rewrite-proofread": "Rewrite & proofread",
        translate: "Translate",
        "improve-writing": "Polish",
        "fix-spelling-grammar": "Fix spelling & grammar",
        "make-shorter": "Make concise",
        "make-longer": "Make longer",
        "simplify-language": "Simplify language",
        "change-tone": "Change tone",
        "continue-writing": "Continue writing",
        custom: "Custom prompt",
      },
      languages: {
        en: "English",
        "zh-CN": "Simplified Chinese",
        "zh-TW": "Traditional Chinese",
        ja: "Japanese",
        ko: "Korean",
        es: "Spanish",
        fr: "French",
        de: "German",
        pt: "Portuguese",
        pl: "Polish",
      },
      tones: {
        professional: "Professional",
        friendly: "Friendly",
        casual: "Casual",
        direct: "Direct",
      },
      chooseAction: "Choose an action",
      chooseTargetLanguage: "Choose target language",
      chooseTone: "Choose tone",
      noteTitle: "AI whole-note assistant",
      selectionTitle: "AI selection assistant",
      noteScopeHint: "No text selected; the whole note will be processed.",
      selectionScopeHint: "Only the selected text will be processed.",
      action: "Action",
      targetLanguage: "Target language",
      tone: "Tone",
      instruction: "Tell AI what to do",
      instructionPlaceholder: "For example: Rewrite this as a concise email.",
      draft: "AI draft",
      generating: "Generating…",
      draftPlaceholder: "The generated draft will appear here.",
      refineResult: "Refine result",
      refinePlaceholder: "Make it more concise",
      refine: "Refine",
      insertAfter: "Insert after",
      replaceSelection: "Replace selection",
      stop: "Stop",
      regenerate: "Regenerate",
      generate: "Generate",
    },
    codeBlock: {
      mermaidPreview: "Mermaid diagram preview",
      copy: "Copy code",
      copied: "Copied",
      copyFailed: "Copy failed",
      mermaidSource: "Mermaid source",
      codeSource: "Code source",
      mermaidEmpty: "Enter Mermaid source below.",
      rendering: "Rendering diagram…",
      renderFailed: "Unable to render this diagram. Check its syntax.",
    },
    diagram: {
      mindMap: "Mind map",
      architecture: "Architecture diagram",
      flowchart: "Flowchart",
    },
    image: {
      loadFailed: "Image failed to load",
      uploading: "Uploading image…",
      actions: "Image actions",
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
    attachmentPrefix: "添付: ",
    close: "閉じる",
    ai: {
      generationFailed: "AI の生成に失敗しました。",
      promptMissing: "選択したプロンプトはもう存在しません。別のプロンプトを選んでください。",
      selectionExpired: "ノートが変更されたため選択範囲が無効になりました。もう一度テキストを選択してください。",
      openForNote: "ノートまたは選択したテキストに AI を使う",
      openForSelection: "選択したテキストに AI を使う",
      emptyNote: "先にノートの本文を入力してください。",
      selectionUpdated: "AI が選択範囲を更新しました。",
      actions: {
        summarize: "要約",
        "extract-key-points": "要点",
        "extract-todos": "タスクを抽出",
        "rewrite-proofread": "書き直しと校正",
        translate: "翻訳",
        "improve-writing": "推敲",
        "fix-spelling-grammar": "スペルと文法を直す",
        "make-shorter": "簡潔にする",
        "make-longer": "長くする",
        "simplify-language": "表現をやさしくする",
        "change-tone": "トーンを変える",
        "continue-writing": "続きを書く",
        custom: "カスタムプロンプト",
      },
      languages: {
        en: "英語",
        "zh-CN": "簡体字中国語",
        "zh-TW": "繁体字中国語",
        ja: "日本語",
        ko: "韓国語",
        es: "スペイン語",
        fr: "フランス語",
        de: "ドイツ語",
        pt: "ポルトガル語",
        pl: "ポーランド語",
      },
      tones: {
        professional: "フォーマル",
        friendly: "フレンドリー",
        casual: "カジュアル",
        direct: "率直",
      },
      chooseAction: "操作を選択",
      chooseTargetLanguage: "翻訳先の言語を選択",
      chooseTone: "トーンを選択",
      noteTitle: "AI ノート全体アシスタント",
      selectionTitle: "AI 選択範囲アシスタント",
      noteScopeHint: "テキストが選択されていないため、ノート全体を処理します。",
      selectionScopeHint: "選択したテキストだけを処理します。",
      action: "操作",
      targetLanguage: "対象言語",
      tone: "トーン",
      instruction: "AI に何をしてほしいか伝える",
      instructionPlaceholder: "例：簡潔なメールに書き直す。",
      draft: "AI の下書き",
      generating: "生成中…",
      draftPlaceholder: "生成された下書きがここに表示されます。",
      refineResult: "結果を調整",
      refinePlaceholder: "例：もっと簡潔に",
      refine: "調整",
      insertAfter: "選択範囲の後に挿入",
      replaceSelection: "選択範囲を置き換え",
      stop: "停止",
      regenerate: "再生成",
      generate: "生成",
    },
    codeBlock: {
      mermaidPreview: "Mermaid 図のプレビュー",
      copy: "コードをコピー",
      copied: "コピーしました",
      copyFailed: "コピーできませんでした",
      mermaidSource: "Mermaid ソース",
      codeSource: "コードのソース",
      mermaidEmpty: "下に Mermaid のソースを入力してください。",
      rendering: "図をレンダリング中…",
      renderFailed: "この図をレンダリングできません。構文を確認してください。",
    },
    diagram: {
      mindMap: "マインドマップ",
      architecture: "アーキテクチャ図",
      flowchart: "フローチャート",
    },
    image: {
      loadFailed: "画像を読み込めませんでした",
      uploading: "画像をアップロード中…",
      actions: "画像の操作",
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
    attachmentPrefix: "Załącznik: ",
    close: "Zamknij",
    ai: {
      generationFailed: "Generowanie AI nie powiodło się.",
      promptMissing: "Wybrane polecenie już nie istnieje. Wybierz inne.",
      selectionExpired: "Notatka się zmieniła, więc zaznaczenie wygasło. Zaznacz tekst ponownie.",
      openForNote: "Użyj AI na notatce lub zaznaczonym tekście",
      openForSelection: "Użyj AI na zaznaczonym tekście",
      emptyNote: "Najpierw dodaj treść notatki.",
      selectionUpdated: "AI zaktualizowało zaznaczenie.",
      actions: {
        summarize: "Podsumuj",
        "extract-key-points": "Najważniejsze punkty",
        "extract-todos": "Wyodrębnij zadania",
        "rewrite-proofread": "Przeredaguj i popraw",
        translate: "Przetłumacz",
        "improve-writing": "Dopracuj",
        "fix-spelling-grammar": "Popraw pisownię i gramatykę",
        "make-shorter": "Skróć",
        "make-longer": "Wydłuż",
        "simplify-language": "Uprość język",
        "change-tone": "Zmień ton",
        "continue-writing": "Pisz dalej",
        custom: "Własny prompt",
      },
      languages: {
        en: "Angielski",
        "zh-CN": "Chiński uproszczony",
        "zh-TW": "Chiński tradycyjny",
        ja: "Japoński",
        ko: "Koreański",
        es: "Hiszpański",
        fr: "Francuski",
        de: "Niemiecki",
        pt: "Portugalski",
        pl: "Polski",
      },
      tones: {
        professional: "Profesjonalny",
        friendly: "Przyjazny",
        casual: "Swobodny",
        direct: "Bezpośredni",
      },
      chooseAction: "Wybierz działanie",
      chooseTargetLanguage: "Wybierz język docelowy",
      chooseTone: "Wybierz ton",
      noteTitle: "Asystent AI całej notatki",
      selectionTitle: "Asystent AI zaznaczenia",
      noteScopeHint: "Nie zaznaczono tekstu, więc zostanie przetworzona cała notatka.",
      selectionScopeHint: "Zostanie przetworzony tylko zaznaczony tekst.",
      action: "Działanie",
      targetLanguage: "Język docelowy",
      tone: "Ton",
      instruction: "Powiedz AI, co ma zrobić",
      instructionPlaceholder: "Na przykład: przepisz to jako zwięzłego e-maila.",
      draft: "Szkic AI",
      generating: "Generowanie…",
      draftPlaceholder: "Wygenerowany szkic pojawi się tutaj.",
      refineResult: "Dopracuj wynik",
      refinePlaceholder: "Na przykład: bardziej zwięźle",
      refine: "Dopracuj",
      insertAfter: "Wstaw po zaznaczeniu",
      replaceSelection: "Zastąp zaznaczenie",
      stop: "Zatrzymaj",
      regenerate: "Generuj ponownie",
      generate: "Generuj",
    },
    codeBlock: {
      mermaidPreview: "Podgląd diagramu Mermaid",
      copy: "Kopiuj kod",
      copied: "Skopiowano",
      copyFailed: "Nie udało się skopiować",
      mermaidSource: "Źródło Mermaid",
      codeSource: "Kod źródłowy",
      mermaidEmpty: "Wpisz poniżej kod źródłowy Mermaid.",
      rendering: "Renderowanie diagramu…",
      renderFailed: "Nie można wyrenderować tego diagramu. Sprawdź składnię.",
    },
    diagram: {
      mindMap: "Mapa myśli",
      architecture: "Diagram architektury",
      flowchart: "Schemat blokowy",
    },
    image: {
      loadFailed: "Nie udało się wczytać obrazu",
      uploading: "Przesyłanie obrazu…",
      actions: "Działania na obrazie",
    },
  },
} as const;

export const getMobileEditorCopy = (locale: MobileEditorLocale) => MOBILE_EDITOR_COPY[locale];

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
