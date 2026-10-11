import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { docToMarkdown, markdownToDoc, type MemoDetail, type TiptapDoc } from "@edgeever/shared";
import type { MemoDocumentActionRequest } from "@/lib/app-helpers";
import { buildSingleNoteMarkdown, downloadMarkdownFile } from "@/lib/note-markdown-export";
import { downloadNoteHtmlFile, getHtmlImageEmbedNoticeKind } from "@/lib/note-html-export";
import { NOTE_HTML_FULL_STYLES } from "@/lib/note-html-export-assets";
import { openNotePrintPreview, serializeNoteDocumentForPrint } from "@/lib/note-print";
import type { NoteImageFormat } from "@/lib/note-image-export";
import { copyEditorToWeChat, copyMarkdownToWeChat } from "@/lib/wechat-copy";
import { formatDateTime, parseTagsText } from "@/lib/utils";
import type { ShareNoteImageSource } from "@/components/dialogs/ShareNoteImageDialog";
import { dispatchMemoDocumentAction, resolveEditorExportContent } from "./editor-document-actions";
import { isEditorReady } from "./editor-pane-helpers";

export type WechatCopyState = "idle" | "copying" | "copied" | "error";

export const useEditorDocumentActions = ({
  canShareMemo,
  documentActionRequest,
  editor,
  effectiveReadOnly,
  getMobilePlainTextValue,
  hydratedEditorMemoId,
  markdownSource,
  memo,
  notebookName,
  onDocumentActionConsumed,
  onSaveAsTemplate,
  tagsText,
  title,
  useMarkdownSourceEditor,
  useMobilePlainTextEditor,
}: {
  canShareMemo: boolean;
  documentActionRequest?: MemoDocumentActionRequest | null;
  editor: Editor | null;
  effectiveReadOnly: boolean;
  getMobilePlainTextValue: () => string;
  hydratedEditorMemoId: string | null;
  markdownSource: string;
  memo: MemoDetail | null;
  notebookName: string;
  onDocumentActionConsumed?: (requestId: number) => void;
  onSaveAsTemplate: (memo: MemoDetail, name: string) => Promise<void>;
  tagsText: string;
  title: string;
  useMarkdownSourceEditor: boolean;
  useMobilePlainTextEditor: boolean;
}) => {
  const { t, i18n } = useTranslation();
  const [shareOpen, setShareOpen] = useState(false);
  const [imageShareOpen, setImageShareOpen] = useState(false);
  const [imageShareSource, setImageShareSource] = useState<ShareNoteImageSource | null>(null);
  const [wechatCopyState, setWechatCopyState] = useState<WechatCopyState>("idle");
  const wechatCopyPendingRef = useRef(false);
  const wechatCopyResetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (wechatCopyResetTimerRef.current !== null) {
      window.clearTimeout(wechatCopyResetTimerRef.current);
    }
  }, []);

  const resolveExportContent = useCallback(
    () => resolveEditorExportContent({
      editor,
      getMobilePlainTextValue,
      markdownSource,
      useMarkdownSourceEditor,
      useMobilePlainTextEditor,
    }),
    [editor, getMobilePlainTextValue, markdownSource, useMarkdownSourceEditor, useMobilePlainTextEditor],
  );

  const handleCopyToWeChat = useCallback(async () => {
    if (!isEditorReady(editor) || wechatCopyPendingRef.current) {
      return;
    }

    wechatCopyPendingRef.current = true;
    if (wechatCopyResetTimerRef.current !== null) {
      window.clearTimeout(wechatCopyResetTimerRef.current);
    }
    setWechatCopyState("copying");
    try {
      if (useMarkdownSourceEditor) {
        await copyMarkdownToWeChat(markdownSource);
      } else {
        await copyEditorToWeChat(editor);
      }
      setWechatCopyState("copied");
      wechatCopyResetTimerRef.current = window.setTimeout(() => setWechatCopyState("idle"), 2200);
    } catch {
      setWechatCopyState("error");
      wechatCopyResetTimerRef.current = window.setTimeout(() => setWechatCopyState("idle"), 2600);
    } finally {
      wechatCopyPendingRef.current = false;
    }
  }, [editor, markdownSource, useMarkdownSourceEditor]);

  const handleExportPdf = useCallback((preopenedWindow?: Window | null) => {
    const content = resolveExportContent();
    if (!isEditorReady(editor) || !content || !memo) {
      return;
    }

    if (preopenedWindow === null) {
      window.alert(t("editor.pdfExport.popupBlocked"));
      return;
    }

    const opened = openNotePrintPreview(
      {
        title: title.trim() || t("common.untitledMemo"),
        notebook: notebookName,
        tags: parseTagsText(tagsText),
        updatedAt: formatDateTime(memo.updatedAt),
        html: serializeNoteDocumentForPrint(editor, content.document),
        language: i18n.resolvedLanguage ?? i18n.language,
        labels: {
          close: t("editor.pdfExport.close"),
          error: t("editor.pdfExport.error"),
          hint: t("editor.pdfExport.hint"),
          preparing: t("editor.pdfExport.preparing"),
          print: t("editor.pdfExport.print"),
          ready: t("editor.pdfExport.ready"),
        },
      },
      preopenedWindow ?? undefined,
    );

    if (!opened) {
      window.alert(t("editor.pdfExport.popupBlocked"));
    }
  }, [editor, i18n.language, i18n.resolvedLanguage, memo, notebookName, resolveExportContent, t, tagsText, title]);

  const handleExportMarkdown = useCallback(() => {
    const content = resolveExportContent();
    if (!content || !memo) {
      return;
    }

    downloadMarkdownFile(buildSingleNoteMarkdown(content.markdown, title, parseTagsText(tagsText)), title, t("common.untitledMemo"));
  }, [memo, notebookName, resolveExportContent, t, tagsText, title]);

  const handleExportHtml = useCallback(async () => {
    const content = resolveExportContent();
    if (!isEditorReady(editor) || !content || !memo) {
      return;
    }

    try {
      const { images } = await downloadNoteHtmlFile({
        bodyHtml: serializeNoteDocumentForPrint(editor, content.document),
        title: title.trim() || t("common.untitledMemo"),
        notebook: notebookName,
        tags: parseTagsText(tagsText),
        updatedAt: formatDateTime(memo.updatedAt),
        language: i18n.resolvedLanguage ?? i18n.language,
        fallbackTitle: t("common.untitledMemo"),
        styles: NOTE_HTML_FULL_STYLES,
      });

      const noticeKind = getHtmlImageEmbedNoticeKind(images);
      if (noticeKind === "partial") {
        window.alert(t("editor.htmlExport.imageEmbedPartial", {
          embedded: images.embedded,
          total: images.total,
          failed: images.failed,
        }));
      } else if (noticeKind === "failed-all") {
        window.alert(t("editor.htmlExport.imageEmbedFailed", {
          total: images.total,
        }));
      }
    } catch {
      window.alert(t("editor.htmlExport.error"));
    }
  }, [editor, i18n.language, i18n.resolvedLanguage, memo, notebookName, resolveExportContent, t, tagsText, title]);

  const buildImageExportOptions = useCallback((format: NoteImageFormat) => {
    const content = resolveExportContent();
    if (!isEditorReady(editor) || !content || !memo) return;
    return {
      bodyHtml: serializeNoteDocumentForPrint(editor, content.document),
      title: title.trim() || t("common.untitledMemo"),
      notebook: notebookName,
      tags: parseTagsText(tagsText),
      updatedAt: formatDateTime(memo.updatedAt),
      language: i18n.resolvedLanguage ?? i18n.language,
      fallbackTitle: t("common.untitledMemo"),
      format,
      styles: NOTE_HTML_FULL_STYLES,
    };
  }, [editor, i18n.language, i18n.resolvedLanguage, memo, notebookName, resolveExportContent, t, tagsText, title]);

  const handleOpenImageShare = useCallback(() => {
    const options = buildImageExportOptions("png");
    if (!options) return;
    const { format: _format, ...source } = options;
    setImageShareSource(source);
    setImageShareOpen(true);
  }, [buildImageExportOptions]);

  const handleSaveAsTemplate = useCallback(() => {
    if (!memo || effectiveReadOnly) {
      return;
    }

    const name = window.prompt(t("templates.templateNamePrompt"), memo.title || "");
    if (!name?.trim()) {
      return;
    }

    const currentMarkdown = useMobilePlainTextEditor
      ? getMobilePlainTextValue()
      : isEditorReady(editor)
        ? docToMarkdown(editor.getJSON() as TiptapDoc)
        : memo.contentMarkdown;
    const currentTemplateMemo: MemoDetail = {
      ...memo,
      title,
      tags: parseTagsText(tagsText),
      contentJson: markdownToDoc(currentMarkdown),
      contentMarkdown: currentMarkdown,
    };
    void onSaveAsTemplate(currentTemplateMemo, name.trim());
  }, [editor, effectiveReadOnly, getMobilePlainTextValue, memo, onSaveAsTemplate, t, tagsText, title, useMobilePlainTextEditor]);

  useEffect(() => {
    if (
      !documentActionRequest ||
      documentActionRequest.memoId !== memo?.id ||
      hydratedEditorMemoId !== memo.id ||
      !isEditorReady(editor)
    ) {
      return;
    }

    onDocumentActionConsumed?.(documentActionRequest.id);
    dispatchMemoDocumentAction(
      documentActionRequest.action,
      {
        exportHtml: () => void handleExportHtml(),
        exportMarkdown: handleExportMarkdown,
        exportPdf: handleExportPdf,
        saveAsTemplate: handleSaveAsTemplate,
        share: () => {
          if (canShareMemo) setShareOpen(true);
        },
        shareImage: handleOpenImageShare,
        copyWeChat: () => void handleCopyToWeChat(),
      },
      documentActionRequest.printWindow,
    );
  }, [
    canShareMemo,
    documentActionRequest,
    editor,
    handleCopyToWeChat,
    handleExportHtml,
    handleExportMarkdown,
    handleExportPdf,
    handleOpenImageShare,
    handleSaveAsTemplate,
    hydratedEditorMemoId,
    memo,
    onDocumentActionConsumed,
  ]);

  return {
    handleCopyToWeChat,
    handleExportHtml,
    handleExportMarkdown,
    handleExportPdf,
    handleOpenImageShare,
    handleSaveAsTemplate,
    imageShareOpen,
    imageShareSource,
    setImageShareOpen,
    setShareOpen,
    shareOpen,
    wechatCopyState,
  };
};
