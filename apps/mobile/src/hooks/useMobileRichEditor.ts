import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { File as ExpoFile } from "expo-file-system";
import { BackHandler, Platform } from "react-native";
import {
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  markdownToDoc,
  resolveMemoContentDoc,
  type MemoDetail,
  type Notebook,
  type TiptapDoc,
} from "@edgeever/shared";
import { Alert } from "../components/LocalizedText";
import type { LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import {
  applyMobileEditorUpload,
  cancelMobileEditorUpload,
  flushMobileEditor,
} from "../lib/mobile-editor-controller";
import { clearMobileMemoDraft, writeMobileMemoDraft, type MobileMemoDraft } from "../lib/mobile-drafts";
import { prepareUploadAsset } from "../lib/mobile-image-upload";
import { localizeMissingNotebookName, useMobileLocale } from "../lib/mobile-locale";
import { useSession } from "../lib/session";
import { recordEditorStartup } from "../lib/startup-performance";
import { safeDomCall } from "../lib/safe-dom-call";
import { showEdgeEverKeyboard } from "../../modules/edgeever-keyboard";
import { parseTags } from "../screens/workspace-utils";
import type { MobileMemoUpdatePayload } from "../screens/workspace-memo-cache";
import { resolveEditorCloseAction } from "./mobile-editor-close";
import { useMobileEditorResourceActions } from "./useMobileEditorResourceActions";
import { useMobileEditorUploadAsset } from "./useMobileEditorUploadAsset";
import { useMobileSelectionAi } from "./useMobileSelectionAi";
import {
  createOnceProtectedResourceFailureNotifier,
  type ProtectedResourceLoadFailure,
} from "../lib/mobile-protected-resources";
import type { MobileResourceTarget } from "../lib/mobile-attachments";
import { uploadMobileResource } from "../lib/mobile-resource-upload";

export type MobileMemoUpdateMutation = UseMutationResult<
  MemoDetail,
  Error,
  { memo: MemoDetail; payload: MobileMemoUpdatePayload }
>;

export const resolveEditableMemoTitle = (title?: string | null) => {
  const trimmedTitle = title?.trim() ?? "";
  return trimmedTitle === DEFAULT_MEMO_TITLE ? "" : trimmedTitle;
};

const createMobileImageUploadId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createLocalImagePreviewDataUrl = async (asset: { mimeType?: string | null; uri: string }) => {
  const file = new ExpoFile(asset.uri);
  const mimeType = asset.mimeType || file.type || "application/octet-stream";
  return `data:${mimeType};base64,${await file.base64()}`;
};

const alertProtectedImageLoadFailure = (
  locale: "zh-CN" | "en-US" | "ja" | "pl" | "ru",
  failure: ProtectedResourceLoadFailure
) => {
  const statusLabel = failure.status != null
    ? String(failure.status)
    : locale !== "zh-CN"
      ? "network error"
      : "网络错误";
  Alert.alert(
    locale !== "zh-CN" ? "Image failed to load" : "图片加载失败",
    locale !== "zh-CN"
      ? `Could not load a note image (${statusLabel}). Check the network and try again.`
      : `笔记中的图片未能加载（${statusLabel}）。请检查网络后重试。`
  );
};

const restoreDraft = (memo: MemoDetail | null, initialDraft: MobileMemoDraft | null) =>
  initialDraft?.expectedRevision === memo?.revision ? initialDraft : null;

export const useMobileRichEditor = ({
  active,
  alreadyReady = false,
  baseUrl,
  editorRef,
  handleHardwareBack = true,
  imageCompressionEnabled,
  initialDraft,
  initialFocus = "body",
  memo,
  notebooks,
  onClose,
  updateMutation,
}: {
  active: boolean;
  alreadyReady?: boolean;
  baseUrl: string;
  editorRef: RefObject<LocalTiptapEditorRef | null>;
  handleHardwareBack?: boolean;
  imageCompressionEnabled: boolean;
  initialDraft: MobileMemoDraft | null;
  initialFocus?: "body" | "title";
  memo: MemoDetail | null;
  notebooks: Notebook[];
  onClose: () => void;
  updateMutation: MobileMemoUpdateMutation;
}) => {
  const { client, session } = useSession();
  const { resolvedLocale } = useMobileLocale();
  const restoredDraft = restoreDraft(memo, initialDraft);
  const initialContentJson = restoredDraft
    ? markdownToDoc(restoredDraft.contentMarkdown)
    : resolveMemoContentDoc(memo?.contentJson, memo?.contentMarkdown);
  const resourceDataUrlCacheRef = useRef(new Map<string, Promise<string | null>>());
  const imageLoadFailureNotifier = useMemo(
    () =>
      createOnceProtectedResourceFailureNotifier((failure) => {
        alertProtectedImageLoadFailure(resolvedLocale, failure);
      }),
    [memo?.id, resolvedLocale]
  );
  const initialFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionKeyRef = useRef<string | null>(null);
  const contentJsonRef = useRef<TiptapDoc>(initialContentJson);
  const contentMarkdownRef = useRef(restoredDraft?.contentMarkdown ?? memo?.contentMarkdown ?? "");
  const contentSnapshotRef = useRef(JSON.stringify(contentJsonRef.current));
  const dirtyRef = useRef(Boolean(restoredDraft));
  const flushResolverRef = useRef<(() => void) | null>(null);
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const closingRef = useRef(false);
  const closeInFlightRef = useRef(false);
  const requestCloseRef = useRef<() => Promise<void>>(async () => undefined);
  const memoBaseRef = useRef(memo);
  const [title, setTitle] = useState(resolveEditableMemoTitle(restoredDraft?.title ?? memo?.title));
  const [tagsText, setTagsText] = useState(restoredDraft?.tagsText ?? memo?.tags.join(", ") ?? "");
  const [notebookId, setNotebookId] = useState(restoredDraft?.notebookId ?? memo?.notebookId ?? "");
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(Boolean(restoredDraft));
  const [ready, setReady] = useState(alreadyReady);
  const [dirty, setDirty] = useState(Boolean(restoredDraft));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resourceTarget, setResourceTarget] = useState<MobileResourceTarget | null>(null);
  const { pickUploadAssets, uploadSourcePicker } = useMobileEditorUploadAsset();
  const notebookLabel = notebooks.find((notebook) => notebook.id === notebookId)?.name ?? localizeMissingNotebookName(resolvedLocale);
  const saveLabel = error
    ? "保存失败"
    : saving
      ? "保存中"
      : uploading
        ? "上传中"
        : dirty
          ? (draftRestored ? "本地草稿" : "未保存")
          : ready
            ? "已保存"
            : "加载中";
  const titleRef = useRef(title);
  const tagsTextRef = useRef(tagsText);
  const notebookIdRef = useRef(notebookId);
  titleRef.current = title;
  tagsTextRef.current = tagsText;
  notebookIdRef.current = notebookId;
  memoBaseRef.current = memoBaseRef.current ?? memo;

  useEffect(() => () => {
    if (initialFocusTimerRef.current !== null) {
      clearTimeout(initialFocusTimerRef.current);
      initialFocusTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active || !memo) {
      sessionKeyRef.current = null;
      return;
    }
    const sessionKey = `${memo.id}:${initialFocus}`;
    if (sessionKeyRef.current === sessionKey) {
      if (alreadyReady) {
        setReady(true);
      }
      return;
    }
    sessionKeyRef.current = sessionKey;
    memoBaseRef.current = memo;
    const nextDraft = restoreDraft(memo, initialDraft);
    const nextContentJson = nextDraft
      ? markdownToDoc(nextDraft.contentMarkdown)
      : resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
    contentJsonRef.current = nextContentJson;
    contentMarkdownRef.current = nextDraft?.contentMarkdown ?? memo.contentMarkdown ?? "";
    contentSnapshotRef.current = JSON.stringify(nextContentJson);
    dirtyRef.current = Boolean(nextDraft);
    setTitle(resolveEditableMemoTitle(nextDraft?.title ?? memo.title));
    setTagsText(nextDraft?.tagsText ?? memo.tags.join(", ") ?? "");
    setNotebookId(nextDraft?.notebookId ?? memo.notebookId ?? "");
    setNotebookPickerOpen(false);
    setTagPickerOpen(false);
    setDraftRestored(Boolean(nextDraft));
    setDirty(Boolean(nextDraft));
    setSaving(false);
    setUploading(false);
    closingRef.current = false;
    closeInFlightRef.current = false;
    setError(null);
    setResourceTarget(null);
    if (alreadyReady) {
      setReady(true);
      recordEditorStartup(0);
      if (nextDraft) {
        safeDomCall(() => editorRef.current?.setContent(JSON.stringify(nextContentJson)));
      }
      if (Platform.OS === "android" && initialFocus === "body") {
        if (initialFocusTimerRef.current !== null) {
          clearTimeout(initialFocusTimerRef.current);
        }
        initialFocusTimerRef.current = setTimeout(() => {
          initialFocusTimerRef.current = null;
          showEdgeEverKeyboard();
        }, 180);
      }
    } else {
      setReady(false);
    }
  }, [active, alreadyReady, editorRef, initialDraft, initialFocus, memo]);

  const persistDraft = async (contentJson: TiptapDoc) => {
    const currentMemo = memoBaseRef.current;
    if (!active || !currentMemo) {
      return;
    }
    const contentSnapshot = JSON.stringify(contentJson);
    if (contentSnapshot === contentSnapshotRef.current) {
      flushResolverRef.current?.();
      flushResolverRef.current = null;
      return;
    }
    contentSnapshotRef.current = contentSnapshot;
    contentJsonRef.current = contentJson;
    contentMarkdownRef.current = docToMarkdown(contentJson);
    dirtyRef.current = true;
    setDirty(true);
    setError(null);
    flushResolverRef.current?.();
    flushResolverRef.current = null;
    await writeMobileMemoDraft({
      memoId: currentMemo.id,
      expectedRevision: currentMemo.revision,
      title: titleRef.current.trim(),
      contentMarkdown: contentMarkdownRef.current,
      notebookId: notebookIdRef.current,
      tagsText: tagsTextRef.current,
      updatedAt: new Date().toISOString(),
    });
  };

  const save = async () => {
    const currentMemo = memoBaseRef.current;
    if (!currentMemo || savingRef.current || !notebookIdRef.current) {
      return null;
    }
    if (!dirtyRef.current) {
      return currentMemo;
    }
    const dirtyGenerationAtStart = contentSnapshotRef.current;
    savingRef.current = true;
    setSaving(true);
    setError(null);

    try {
      const savedMemo = await updateMutation.mutateAsync({
        memo: currentMemo,
        payload: {
          title: titleRef.current.trim() || DEFAULT_MEMO_TITLE,
          contentJson: contentJsonRef.current,
          contentMarkdown: contentMarkdownRef.current,
          notebookId: notebookIdRef.current,
          tags: parseTags(tagsTextRef.current),
        },
      });
      memoBaseRef.current = savedMemo;
      await clearMobileMemoDraft(currentMemo.id);
      if (contentSnapshotRef.current === dirtyGenerationAtStart) {
        dirtyRef.current = false;
        setDirty(false);
      } else {
        dirtyRef.current = true;
        setDirty(true);
      }
      setDraftRestored(false);
      return savedMemo;
    } catch (saveError) {
      closingRef.current = false;
      setError(saveError instanceof Error ? saveError.message : "保存失败");
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
      // A back/done tap during autosave is remembered and finished here.
      if (closingRef.current && !closeInFlightRef.current) {
        void requestCloseRef.current();
      }
    }
  };

  const flushEditor = () => flushMobileEditor(editorRef, flushResolverRef);
  const { aiPromptsJson, cancelSelectionAi, requestSelectionAi } = useMobileSelectionAi({
    client,
    editorRef,
    resolvedLocale,
    titleRef,
  });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = async () => {
    const action = resolveEditorCloseAction({
      closeInFlight: closeInFlightRef.current,
      saving: savingRef.current,
      uploading: uploadingRef.current,
    });
    if (action === "block") {
      return;
    }
    closingRef.current = true;
    if (action === "defer") {
      return;
    }
    closeInFlightRef.current = true;
    if (initialFocusTimerRef.current !== null) {
      clearTimeout(initialFocusTimerRef.current);
      initialFocusTimerRef.current = null;
    }
    try {
      await flushEditor();
      if (!closingRef.current) {
        return;
      }
      const savedMemo = await save();
      if (savedMemo && closingRef.current) {
        onCloseRef.current();
        return;
      }
      // Keep the close queued when another save is still in flight.
      if (!savedMemo && !savingRef.current) {
        closingRef.current = false;
      }
    } finally {
      closeInFlightRef.current = false;
    }
  };
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!active || !handleHardwareBack) {
      return;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      void requestCloseRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [active, handleHardwareBack]);

  const pickAndUploadImage = async () => {
    const currentMemo = memoBaseRef.current;
    if (!client || !currentMemo || uploadingRef.current) {
      return;
    }
    if (currentMemo.id.startsWith("local:")) {
      Alert.alert("正在同步新笔记", "首次同步完成后即可上传本地图片；图片链接现在就可以直接粘贴到正文。");
      return;
    }
    const assets = await pickUploadAssets();
    if (!assets.length) {
      return;
    }

    let uploadId: string | null = null;
    const sources: string[] = [];
    uploadingRef.current = true;
    setUploading(true);
    setError(null);
    try {
      for (const asset of assets) {
        const isImage = asset.mimeType?.startsWith("image/") ?? false;
        uploadId = isImage ? createMobileImageUploadId() : null;
        if (isImage && uploadId) {
          const previewDataUrl = await createLocalImagePreviewDataUrl(asset);
          safeDomCall(() => editorRef.current?.beginImageUpload(uploadId, previewDataUrl));
        }
        const uploadAsset = await prepareUploadAsset(asset, imageCompressionEnabled);
        const { resource } = await uploadMobileResource(client, currentMemo.id, uploadAsset);
        applyMobileEditorUpload(editorRef, resource, uploadId, uploadAsset.name || (resource.kind === "image" ? "图片" : "附件"));
        if (resource.kind === "image") sources.push(resource.url);
        uploadId = null;
      }
    } catch (uploadError) {
      cancelMobileEditorUpload(editorRef, uploadId);
      setError(uploadError instanceof Error ? uploadError.message : "附件上传失败");
    } finally {
      safeDomCall(() => editorRef.current?.finishImageBatch(sources));
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const canMutateEditorResource = useCallback(
    () => Boolean(memoBaseRef.current && !memoBaseRef.current.id.startsWith("local:")),
    []
  );
  const {
    deleteResource,
    downloadResource,
    loadEditorResource,
    renameResource,
    saveResourceAs,
    selectResource,
  } = useMobileEditorResourceActions({
    baseUrl,
    canMutate: canMutateEditorResource,
    client,
    editorRef,
    onLoadFailure: imageLoadFailureNotifier,
    onSelect: setResourceTarget,
    resolvedLocale,
    resourceCacheRef: resourceDataUrlCacheRef,
    sessionBaseUrl: session?.baseUrl,
    token: session?.token,
  });

  useEffect(() => {
    const currentMemo = memoBaseRef.current;
    if (!active || !currentMemo || !dirty) {
      return;
    }
    const timeout = setTimeout(() => {
      void writeMobileMemoDraft({
        memoId: currentMemo.id,
        expectedRevision: currentMemo.revision,
        title: titleRef.current.trim(),
        contentMarkdown: contentMarkdownRef.current,
        notebookId: notebookIdRef.current,
        tagsText: tagsTextRef.current,
        updatedAt: new Date().toISOString(),
      });
    }, 350);
    return () => clearTimeout(timeout);
  }, [active, dirty, memo, notebookId, tagsText, title]);

  useEffect(() => {
    if (!active || !memoBaseRef.current || !dirty || !ready || savingRef.current || uploadingRef.current || closingRef.current) {
      return;
    }
    const timeout = setTimeout(() => {
      void flushEditor().then(save);
    }, 1200);
    return () => clearTimeout(timeout);
  }, [active, dirty, memo, notebookId, ready, tagsText, title]);

  const markDirty = () => {
    dirtyRef.current = true;
    setDirty(true);
  };

  return {
    aiPromptsJson,
    cancelSelectionAi,
    contentMarkdown: contentMarkdownRef.current,
    deleteResource,
    dirty,
    downloadResource,
    draftRestored,
    error,
    loadEditorResource,
    markDirty,
    notebookId,
    notebookLabel,
    notebookPickerOpen,
    persistDraft,
    pickAndUploadImage,
    ready,
    renameResource,
    requestClose,
    requestSelectionAi,
    resourceTarget,
    saveLabel,
    saveResourceAs,
    saving,
    selectResource,
    setNotebookId,
    setNotebookPickerOpen,
    setResourceTarget,
    setTagPickerOpen,
    setTagsText,
    setTitle,
    tagPickerOpen,
    tagsText,
    title,
    uploadSourcePicker,
    uploading,
  };
};

export type UseMobileRichEditorResult = ReturnType<typeof useMobileRichEditor>;
