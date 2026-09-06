import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { File as ExpoFile } from "expo-file-system";
import { ActivityIndicator, Check, ChevronDown, ChevronLeft, RotateCcw } from "../components/icons";
import { BackHandler, KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert, Pressable, Text, TextInput } from "../components/LocalizedText";
import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  docToText,
  markdownToDoc,
  resolveMemoContentDoc,
  type MemoDetail,
  type Notebook,
  type TiptapDoc,
} from "@edgeever/shared";
import {
  clearMobileMemoDraft,
  clearMobileNewMemoDraft,
  writeMobileMemoDraft,
  type MobileMemoDraft,
} from "../lib/mobile-drafts";
import { useMobileLocale } from "../lib/mobile-locale";
import { useSession } from "../lib/session";
import { queueMobileMemoCreate, queueMobileMemoUpdate } from "../lib/sync-queue";
import { createMobileDataScope, upsertLocalMemo } from "../lib/local-mirror";
import { recordEditorStartup } from "../lib/startup-performance";
import { prepareUploadAsset, type MobileImageUploadAsset } from "../lib/mobile-image-upload";
import MobileWebClipCapture from "../components/MobileWebClipCapture";
import LocalTiptapEditor, { type LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { SAFE_DOM_WEBVIEW_PROPS } from "../lib/mobile-dom";
import { safeDomCall } from "../lib/safe-dom-call";
import { applyMobileEditorUpload, cancelMobileEditorUpload, flushMobileEditor } from "../lib/mobile-editor-controller";
import { showEdgeEverKeyboard } from "../../modules/edgeever-keyboard";
import { MobileResourceActions } from "../components/MobileResourceActions";
import { MobileTemplatePickerModal } from "../components/MobileTemplatePicker";
import { useMobileTheme } from "../lib/mobile-theme";
import { createMemoSeedHasContent, type MobileCreateMemoSeed } from "../lib/mobile-templates";
import { createMobileDraftWriteBarrier } from "../lib/mobile-draft-write-barrier";
import {
  type MobileSharedImage,
  type MobileWebClipDraft,
} from "../lib/mobile-web-clip";
import { useMobileEditorResourceActions } from "../hooks/useMobileEditorResourceActions";
import { useMobileEditorUploadAsset } from "../hooks/useMobileEditorUploadAsset";
import { useMobileSelectionAi } from "../hooks/useMobileSelectionAi";
import { parseTags } from "./workspace-utils";
import { createOptimisticMemo, type MobileMemoUpdatePayload } from "./workspace-memo-cache";
import { styles } from "./workspace-styles";
import { NotebookPickerModal, SmartTagButton, TagPickerModal } from "./WorkspacePickers";
import {
  deleteMobileResourceFromDoc,
  getMobileResourceUpdatePayload,
  renameMobileResourceInDoc,
  type MobileResourceTarget,
} from "../lib/mobile-attachments";
import {
  createOnceProtectedResourceFailureNotifier,
  type ProtectedResourceLoadFailure,
} from "../lib/mobile-protected-resources";

type MobileMemoUpdateMutation = UseMutationResult<MemoDetail, Error, { memo: MemoDetail; payload: MobileMemoUpdatePayload }>;

const MOBILE_EDITOR_STARTUP_TIMEOUT_MS = 10_000;

const useMobileEditorStartupGuard = ({ active, ready }: { active: boolean; ready: boolean }) => {
  const [attempt, setAttempt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active || ready) {
      setTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setTimedOut(true), MOBILE_EDITOR_STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [active, attempt, ready]);

  const restart = useCallback(() => {
    setTimedOut(false);
    setAttempt((current) => current + 1);
  }, []);

  return { attempt, restart, timedOut };
};

const MobileEditorStartupOverlay = ({
  onRetry,
  timedOut,
}: {
  onRetry: () => void;
  timedOut: boolean;
}) => {
  const { translate } = useMobileLocale();
  return (
    <View accessibilityLiveRegion="polite" style={styles.richEditorLoading}>
      {!timedOut ? <ActivityIndicator color="#16a06e" size="large" /> : null}
      <Text style={styles.richEditorLoadingTitle}>
        {translate(timedOut ? "编辑器启动时间过长" : "正在启动编辑器")}
      </Text>
      <Text style={styles.mutedText}>
        {translate(timedOut
          ? "本地编辑器未能及时启动，可以重试或返回，当前草稿不会丢失。"
          : "正在准备本地编辑器，笔记内容是安全的。")}
      </Text>
      {timedOut ? (
        <Pressable
          accessibilityLabel={translate("重试")}
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.actionButton}
        >
          <RotateCcw color="#0f172a" size={16} />
          <Text style={styles.actionButtonText}>{translate("重试")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const resolveEditableMemoTitle = (title?: string | null) => {
  const trimmedTitle = title?.trim() ?? "";
  return trimmedTitle === DEFAULT_MEMO_TITLE ? "" : trimmedTitle;
};

const alertProtectedImageLoadFailure = (
  locale: "zh-CN" | "en-US",
  failure: ProtectedResourceLoadFailure
) => {
  const statusLabel = failure.status != null
    ? String(failure.status)
    : locale === "en-US"
      ? "network error"
      : "网络错误";
  Alert.alert(
    locale === "en-US" ? "Image failed to load" : "图片加载失败",
    locale === "en-US"
      ? `Could not load a note image (${statusLabel}). Check the network and try again.`
      : `笔记中的图片未能加载（${statusLabel}）。请检查网络后重试。`
  );
};

export const CreateMemoModal = ({
  baseUrl,
  client: clientProp,
  dataScope,
  defaultNotebookId,
  imageCompressionEnabled,
  initialDraft,
  initialSharedImages = [],
  notebooks,
  onCreated,
  onDismiss,
  onQueued,
  syncQueueScope,
}: {
  baseUrl: string;
  client?: ReturnType<typeof useSession>["client"];
  dataScope: string;
  defaultNotebookId: string;
  imageCompressionEnabled: boolean;
  initialDraft?: MobileCreateMemoSeed | MobileWebClipDraft | null;
  initialSharedImages?: MobileSharedImage[];
  notebooks: Notebook[];
  onCreated: (memo: MemoDetail) => void;
  onDismiss: () => void;
  onQueued: () => void | Promise<void>;
  syncQueueScope: string;
}) => {
  const sessionState = useSession();
  const client = clientProp ?? sessionState.client;
  const session = sessionState.session;
  const queryClient = useQueryClient();
  const { resolvedLocale, translate } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  const fallbackNotebookId = defaultNotebookId;
  const editorRef = useRef<LocalTiptapEditorRef>(null);
  const resourceDataUrlCacheRef = useRef(new Map<string, Promise<string | null>>());
  const imageLoadFailureNotifier = useMemo(
    () =>
      createOnceProtectedResourceFailureNotifier((failure) => {
        alertProtectedImageLoadFailure(resolvedLocale, failure);
      }),
    [resolvedLocale]
  );
  const contentJsonRef = useRef<TiptapDoc>(markdownToDoc(""));
  const contentMarkdownRef = useRef("");
  const draftVersionRef = useRef(0);
  const draftWriteBarrier = useMemo(createMobileDraftWriteBarrier, []);
  const flushResolverRef = useRef<(() => void) | null>(null);
  const materializedMemoRef = useRef<MemoDetail | null>(null);
  const [notebookId, setNotebookId] = useState(fallbackNotebookId);
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [imageOperation, setImageOperation] = useState<"idle" | "creating" | "uploading">("idle");
  const imageOperationRef = useRef(imageOperation);
  const sharedImagesHandledRef = useRef(false);
  const createPendingRef = useRef(false);
  const submitStartedRef = useRef(false);
  const [submitStarted, setSubmitStarted] = useState(false);
  const [resourceTarget, setResourceTarget] = useState<MobileResourceTarget | null>(null);
  const editorStartup = useMobileEditorStartupGuard({ active: draftLoaded && Boolean(baseUrl), ready: editorReady });
  const { pickUploadAssets, uploadSourcePicker } = useMobileEditorUploadAsset();
  const targetNotebookId = notebookId || fallbackNotebookId;
  const selectedNotebookName = notebooks.find((notebook) => notebook.id === targetNotebookId)?.name ?? "选择笔记本";
  const titleRef = useRef(title);
  const tagsTextRef = useRef(tagsText);
  const targetNotebookIdRef = useRef(targetNotebookId);
  const userEditedSinceOpenRef = useRef(false);
  const notebooksRef = useRef(notebooks);
  notebooksRef.current = notebooks;
  titleRef.current = title;
  tagsTextRef.current = tagsText;
  targetNotebookIdRef.current = targetNotebookId;
  imageOperationRef.current = imageOperation;

  const { aiPromptsJson, cancelSelectionAi, requestSelectionAi } = useMobileSelectionAi({
    client,
    editorRef,
    resolvedLocale,
    titleRef,
  });

  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushBodyToEditor = useCallback((doc: TiptapDoc) => {
    safeDomCall(() => editorRef.current?.setContent(JSON.stringify(doc)));
  }, []);

  const clearFocusTimers = useCallback(() => {
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (keyboardTimerRef.current !== null) {
      clearTimeout(keyboardTimerRef.current);
      keyboardTimerRef.current = null;
    }
  }, []);

  const scheduleBodyKeyboard = useCallback((delayMs = 160, focusEditor = true) => {
    clearFocusTimers();
    // Full-tree create only mounts the editor DomWebView, so native IME show is safe again.
    focusTimerRef.current = setTimeout(() => {
      focusTimerRef.current = null;
      if (focusEditor) {
        safeDomCall(() => editorRef.current?.focusEnd());
      }
      if (Platform.OS === "android") {
        keyboardTimerRef.current = setTimeout(() => {
          keyboardTimerRef.current = null;
          showEdgeEverKeyboard();
        }, focusEditor ? 120 : 0);
      }
    }, delayMs);
  }, [clearFocusTimers]);

  const retryEditorStartup = useCallback(() => {
    clearFocusTimers();
    setEditorReady(false);
    editorStartup.restart();
  }, [clearFocusTimers, editorStartup.restart]);

  // Component is only mounted while create is open — init once on mount.
  useEffect(() => {
    let active = true;
    setDraftLoaded(false);
    setEditorReady(false);
    setTemplatePickerOpen(false);
    userEditedSinceOpenRef.current = false;
    draftVersionRef.current = 0;

    if (initialDraft) {
      const markdown = initialDraft.contentMarkdown;
      contentMarkdownRef.current = markdown;
      contentJsonRef.current = markdownToDoc(markdown);
      setTitle(initialDraft.title);
      setTagsText(initialDraft.tagsText);
      setContentMarkdown(markdown);
      setNotebookId(fallbackNotebookId);
      setDirty(false);
      setDraftLoaded(true);
      return () => {
        active = false;
      };
    }

    contentMarkdownRef.current = "";
    contentJsonRef.current = markdownToDoc("");
    setTitle("");
    setTagsText("");
    setContentMarkdown("");
    setNotebookId(fallbackNotebookId);
    setDirty(false);

    // A regular create session must always start blank. Remove any legacy
    // auto-saved create draft instead of restoring content from the last one.
    void clearMobileNewMemoDraft(dataScope).catch(() => undefined).finally(() => {
      if (active) {
        setDraftLoaded(true);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only for create screen lifetime
  }, []);

  const isWebClipDraft = Boolean(
    initialDraft && "sourceUrl" in initialDraft && typeof initialDraft.sourceUrl === "string" && initialDraft.sourceUrl.length > 0
  );

  const persistCurrentDraft = useCallback(() => {
    const materializedMemo = materializedMemoRef.current;
    const currentTitle = titleRef.current;
    const currentContentMarkdown = contentMarkdownRef.current;
    const currentNotebookId = targetNotebookIdRef.current;
    const currentTagsText = tagsTextRef.current;
    const updatedAt = new Date().toISOString();

    return draftWriteBarrier.enqueue(() => materializedMemo
      ? writeMobileMemoDraft({
        memoId: materializedMemo.id,
        expectedRevision: materializedMemo.revision,
        title: currentTitle,
        contentMarkdown: currentContentMarkdown,
        notebookId: currentNotebookId,
        tagsText: currentTagsText,
        updatedAt,
      })
      : Promise.resolve());
  }, [draftWriteBarrier]);

  const applyTemplateSeed = useCallback((seed: MobileCreateMemoSeed) => {
    const markdown = seed.contentMarkdown;
    const doc = markdownToDoc(markdown);
    contentMarkdownRef.current = markdown;
    contentJsonRef.current = doc;
    setTitle(seed.title);
    setTagsText(seed.tagsText);
    setContentMarkdown(markdown);
    draftVersionRef.current += 1;
    userEditedSinceOpenRef.current = true;
    setDirty(true);
    // In-place body replace — never remount DomWebView (remount costs ~1s and breaks Android IME).
    pushBodyToEditor(doc);
    scheduleBodyKeyboard(80);
  }, [pushBodyToEditor, scheduleBodyKeyboard]);

  const requestApplyTemplateSeed = useCallback((seed: MobileCreateMemoSeed) => {
    const current = {
      title: titleRef.current,
      contentMarkdown: contentMarkdownRef.current,
      tagsText: tagsTextRef.current,
    };
    if (createMemoSeedHasContent(current)) {
      Alert.alert(translate("应用模板？"), translate("当前内容将被模板内容替换。"), [
        { text: translate("取消"), style: "cancel" },
        { text: translate("替换"), style: "destructive", onPress: () => applyTemplateSeed(seed) },
      ]);
      return;
    }
    applyTemplateSeed(seed);
  }, [applyTemplateSeed, translate]);

  useEffect(() => {
    if (!draftLoaded || !dirty || isWebClipDraft) {
      return;
    }
    const draftVersion = draftVersionRef.current;
    const timeout = setTimeout(() => {
      void persistCurrentDraft().then((written) => {
        if (written && !submitStartedRef.current && draftVersionRef.current === draftVersion) {
          setDirty(false);
        }
      }).catch(() => undefined);
    }, 350);
    return () => clearTimeout(timeout);
  }, [contentMarkdown, dirty, draftLoaded, isWebClipDraft, persistCurrentDraft, tagsText, targetNotebookId, title]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!targetNotebookId) {
        throw new Error("请先创建一个笔记本");
      }
      const materializedMemo = materializedMemoRef.current;
      if (materializedMemo) {
        const optimisticMemo = createOptimisticMemo(materializedMemo, {
          title: titleRef.current.trim() || DEFAULT_MEMO_TITLE,
          contentJson: contentJsonRef.current,
          contentMarkdown: contentMarkdownRef.current.trim(),
          notebookId: targetNotebookIdRef.current,
          tags: parseTags(tagsTextRef.current),
        });
        await upsertLocalMemo(dataScope, optimisticMemo);
        await queueMobileMemoUpdate(syncQueueScope, {
          memoId: materializedMemo.id,
          expectedRevision: materializedMemo.revision,
          expectedContentHash: materializedMemo.contentHash,
          title: optimisticMemo.title ?? DEFAULT_MEMO_TITLE,
          contentMarkdown: optimisticMemo.contentMarkdown,
          notebookId: optimisticMemo.notebookId,
          tags: optimisticMemo.tags,
        });
        return optimisticMemo;
      }
      const now = new Date().toISOString();
      const temporaryId = `local:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
      const markdown = contentMarkdownRef.current.trim();
      const contentJson = contentJsonRef.current;
      const contentText = docToText(contentJson);
      const memo: MemoDetail = {
        id: temporaryId,
        notebookId: targetNotebookId,
        title: title.trim() || DEFAULT_MEMO_TITLE,
        excerpt: createExcerpt(contentText),
        tags: parseTags(tagsText),
        isPinned: false,
        isArchived: false,
        isDeleted: false,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        contentJson,
        contentMarkdown: markdown,
        contentText,
        contentHash: `local:${temporaryId}`,
        sourceMemoIds: [],
        mergeSourceCount: 0,
        mergedIntoMemoId: null,
      };
      await upsertLocalMemo(dataScope, memo);
      await queueMobileMemoCreate(syncQueueScope, {
        memoId: temporaryId,
        notebookId: memo.notebookId,
        title: memo.title ?? DEFAULT_MEMO_TITLE,
        contentMarkdown: memo.contentMarkdown,
        tags: memo.tags,
        createdAt: now,
      });
      return memo;
    },
    onSuccess: async (memo) => {
      const materializedMemoId = materializedMemoRef.current?.id ?? null;
      // Wait for any already-running AsyncStorage write before removing the
      // draft. Nothing queued after submit began is allowed to recreate it.
      await draftWriteBarrier.blockAndDrain();
      if (!isWebClipDraft) {
        await clearMobileNewMemoDraft(dataScope);
      }
      if (materializedMemoId) {
        await clearMobileMemoDraft(materializedMemoId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
      ]);
      setTitle("");
      setTagsText("");
      setContentMarkdown("");
      contentMarkdownRef.current = "";
      contentJsonRef.current = markdownToDoc("");
      materializedMemoRef.current = null;
      draftVersionRef.current += 1;
      setDirty(false);
      void onQueued();
      onCreated(memo);
    },
    onError: () => {
      submitStartedRef.current = false;
      draftWriteBarrier.unblock();
      setSubmitStarted(false);
      draftVersionRef.current += 1;
      setDirty(true);
      if (!isWebClipDraft) {
        void persistCurrentDraft().catch(() => undefined);
      }
    },
  });
  createPendingRef.current = createMutation.isPending;
  const canSubmitCreateMemo = Boolean(targetNotebookId) && !submitStarted && !createMutation.isPending && imageOperation === "idle";
  const canUseTemplate = editorReady && imageOperation === "idle" && !submitStarted && !createMutation.isPending;

  const materializeMemoForImage = async () => {
    if (materializedMemoRef.current) {
      return materializedMemoRef.current;
    }
    if (!client || !targetNotebookIdRef.current) {
      throw new Error("当前无法连接实例，请稍后重试");
    }
    setImageOperation("creating");
    const response = await client.createMemo({
      notebookId: targetNotebookIdRef.current,
      title: titleRef.current.trim() || DEFAULT_MEMO_TITLE,
      contentMarkdown: contentMarkdownRef.current.trim(),
      tags: parseTags(tagsTextRef.current),
    });
    materializedMemoRef.current = response.memo;
    await upsertLocalMemo(dataScope, response.memo);
    if (!isWebClipDraft) {
      await clearMobileNewMemoDraft(dataScope);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
    ]);
    return response.memo;
  };

  const uploadImageAsset = async (asset: MobileImageUploadAsset | null, keepBusy = false) => {
    let uploadId: string | null = null;
    try {
      if (!asset) {
        return;
      }
      const isImage = asset.mimeType?.startsWith("image/") ?? false;
      if (isImage) {
        uploadId = createMobileImageUploadId();
        const previewDataUrl = await createLocalImagePreviewDataUrl(asset);
        safeDomCall(() => editorRef.current?.beginImageUpload(uploadId, previewDataUrl));
      }
      const memo = await materializeMemoForImage();
      setImageOperation("uploading");
      const uploadAsset = await prepareUploadAsset(asset, imageCompressionEnabled);
      const { resource } = await client!.uploadMemoResource(memo.id, new ExpoFile(uploadAsset.uri));
      applyMobileEditorUpload(editorRef, resource, uploadId, uploadAsset.name || (resource.kind === "image" ? "图片" : "附件"));
      if (resource.kind === "image" && !keepBusy) {
        safeDomCall(() => editorRef.current?.finishImageBatch([resource.url]));
      }
      return resource.kind === "image" ? resource.url : null;
    } catch (error) {
      cancelMobileEditorUpload(editorRef, uploadId);
      Alert.alert("附件上传失败", error instanceof Error ? error.message : "请检查网络连接后重试");
    } finally {
      if (!keepBusy) setImageOperation("idle");
    }
  };

  const pickAndUploadImage = async () => {
    const assets = await pickUploadAssets();
    if (!assets.length) return;
    const sources: string[] = [];
    setImageOperation("uploading");
    try {
      for (const asset of assets) {
        const source = await uploadImageAsset(asset, true);
        if (source === undefined) break;
        if (source) sources.push(source);
      }
      safeDomCall(() => editorRef.current?.finishImageBatch(sources));
    } finally {
      setImageOperation("idle");
    }
  };

  useEffect(() => {
    if (!editorReady || sharedImagesHandledRef.current || initialSharedImages.length === 0) {
      return;
    }
    sharedImagesHandledRef.current = true;
    void (async () => {
      for (const image of initialSharedImages) {
        await uploadImageAsset(image);
      }
    })();
  }, [editorReady, initialSharedImages]);

  const markDirty = () => {
    if (submitStartedRef.current) {
      return;
    }
    userEditedSinceOpenRef.current = true;
    draftVersionRef.current += 1;
    setDirty(true);
  };

  const flushEditor = () => flushMobileEditor(editorRef, flushResolverRef);

  const submitCreateMemo = async () => {
    if (submitStartedRef.current || createPendingRef.current || imageOperationRef.current !== "idle") {
      return;
    }
    submitStartedRef.current = true;
    setSubmitStarted(true);
    const draftsDrained = draftWriteBarrier.blockAndDrain();
    try {
      await flushEditor();
      await draftsDrained;
      createMutation.mutate();
    } catch {
      submitStartedRef.current = false;
      draftWriteBarrier.unblock();
      setSubmitStarted(false);
    }
  };

  const requestClose = () => submitCreateMemo();

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      void requestClose();
      return true;
    });
    return () => {
      subscription.remove();
      clearFocusTimers();
    };
  }, [clearFocusTimers]);

  const canMutateEditorResource = useCallback(() => Boolean(materializedMemoRef.current), []);
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

  const editorElement = useMemo(() => draftLoaded && baseUrl ? (
    <LocalTiptapEditor
      autoFocus
      aiPromptsJson={aiPromptsJson}
      baseUrl={baseUrl}
      content={contentJsonRef.current}
      dom={{
        ...SAFE_DOM_WEBVIEW_PROPS,
        bounces: false,
        contentInsetAdjustmentBehavior: "never",
        overScrollMode: "never",
        scrollEnabled: false,
        style: styles.createMemoEditor,
      }}
      onChange={async (contentJson) => {
        contentJsonRef.current = contentJson;
        const markdown = docToMarkdown(contentJson);
        contentMarkdownRef.current = markdown;
        setContentMarkdown(markdown);
        markDirty();
        flushResolverRef.current?.();
        flushResolverRef.current = null;
      }}
      onAiCancel={cancelSelectionAi}
      onAiRequest={requestSelectionAi}
      onResourcePress={selectResource}
      onLoadResource={loadEditorResource}
      onPickImage={pickAndUploadImage}
      onReady={async (elapsedMs) => {
        setEditorReady(true);
        recordEditorStartup(elapsedMs);
        // LocalTiptapEditor owns caret placement; native only reveals the IME after
        // its final focus retry so the two layers cannot race each other.
        scheduleBodyKeyboard(180, false);
      }}
      key={editorStartup.attempt}
      ref={editorRef}
      locale={resolvedLocale}
      theme={resolvedTheme}
    />
  ) : null, [aiPromptsJson, baseUrl, cancelSelectionAi, draftLoaded, editorStartup.attempt, loadEditorResource, pushBodyToEditor, requestSelectionAi, resolvedLocale, resolvedTheme, scheduleBodyKeyboard, selectResource]);

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.createMemoSafeArea}>
      <View style={styles.createMemoHeader}>
        <Pressable accessibilityLabel="返回" accessibilityRole="button" disabled={submitStarted || createMutation.isPending || imageOperation !== "idle"} onPress={() => void requestClose()} style={styles.createMemoBackButton}>
          <ChevronLeft color={submitStarted || createMutation.isPending || imageOperation !== "idle" ? "#cbd5e1" : "#0f172a"} size={30} />
        </Pressable>
        <View style={styles.createMemoHeaderActions}>
          <Text style={[styles.createMemoStatus, (submitStarted || createMutation.isPending) && styles.createMemoStatusActive]}>
            {imageOperation === "creating" ? "正在创建" : imageOperation === "uploading" ? "正在上传" : submitStarted || createMutation.isPending || dirty ? "保存中" : editorReady ? "已保存" : "准备中"}
          </Text>
          <Pressable
            accessibilityLabel={translate("模板")}
            accessibilityRole="button"
            disabled={!canUseTemplate}
            onPress={() => setTemplatePickerOpen(true)}
            style={[styles.createMemoTemplateButton, !canUseTemplate && styles.createMemoDoneButtonDisabled]}
          >
            <Text style={[styles.createMemoTemplateButtonText, !canUseTemplate && styles.createMemoDoneTextDisabled]}>{translate("模板")}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="完成新建笔记"
            disabled={!canSubmitCreateMemo}
            onPress={() => void submitCreateMemo()}
            style={[styles.createMemoDoneButton, !canSubmitCreateMemo && styles.createMemoDoneButtonDisabled]}
          >
            {submitStarted || createMutation.isPending ? <ActivityIndicator color="#64748b" size="small" /> : <Text style={[styles.createMemoDoneText, !canSubmitCreateMemo && styles.createMemoDoneTextDisabled]}>完成</Text>}
          </Pressable>
        </View>
      </View>

      <View style={styles.createMemoMain}>
        <TextInput
          autoCorrect
          accessibilityLabel="笔记标题"
          onChangeText={(value) => {
            setTitle(value);
            markDirty();
          }}
          placeholder={DEFAULT_MEMO_TITLE}
          placeholderTextColor="#94a3b8"
          style={styles.createMemoTitleInput}
          value={title}
        />

        <View style={styles.createMemoMetaRow}>
          <Pressable accessibilityLabel="所在笔记本" accessibilityRole="button" onPress={() => setNotebookPickerOpen(true)} style={styles.createMemoNotebookButton}>
            <Text numberOfLines={1} style={styles.createMemoNotebookText}>{selectedNotebookName}</Text>
            <ChevronDown color="#64748b" size={14} />
          </Pressable>
          <Pressable accessibilityLabel="选择笔记标签" accessibilityRole="button" onPress={() => setTagPickerOpen(true)} style={styles.createMemoTagsButton}>
            <Text numberOfLines={1} style={[styles.createMemoTagsInput, !tagsText && styles.createMemoTagsPlaceholder]}>
              {tagsText || "添加标签"}
            </Text>
            <ChevronDown color="#94a3b8" size={14} />
          </Pressable>
          <SmartTagButton
            client={client}
            contentMarkdown={contentMarkdown}
            onChange={(nextTags) => {
              setTagsText(nextTags.join(", "));
              markDirty();
            }}
            selectedTags={parseTags(tagsText)}
            title={title}
          />
        </View>

        <View style={styles.createMemoEditorFrame}>
          {editorElement}
          {!editorReady ? <MobileEditorStartupOverlay onRetry={retryEditorStartup} timedOut={editorStartup.timedOut} /> : null}
        </View>

        {createMutation.error ? (
          <Text style={styles.errorText}>{createMutation.error instanceof Error ? createMutation.error.message : "创建失败"}</Text>
        ) : null}
      </View>
      <NotebookPickerModal
        activeNotebookId={targetNotebookId}
        notebooks={notebooks}
        onClose={() => setNotebookPickerOpen(false)}
        onSelect={(nextNotebookId) => {
          setNotebookId(nextNotebookId);
          setNotebookPickerOpen(false);
          markDirty();
        }}
        visible={notebookPickerOpen}
      />
      <TagPickerModal
        dataScope={dataScope}
        onChange={(nextTags) => {
          setTagsText(nextTags.join(", "));
          markDirty();
        }}
        onClose={() => setTagPickerOpen(false)}
        selectedTags={parseTags(tagsText)}
        visible={tagPickerOpen}
      />
      <MobileResourceActions
        canMutate={Boolean(materializedMemoRef.current)}
        onClose={() => setResourceTarget(null)}
        onDelete={deleteResource}
        onDownload={downloadResource}
        onRename={renameResource}
        onSaveAs={saveResourceAs}
        target={resourceTarget}
      />
      <MobileTemplatePickerModal
        client={client}
        onClose={() => {
          setTemplatePickerOpen(false);
          scheduleBodyKeyboard(80);
        }}
        onSelect={requestApplyTemplateSeed}
        presentation="overlay"
        visible={templatePickerOpen}
      />
      {uploadSourcePicker}
    </SafeAreaView>
  );
};

export const RichEditorModal = ({
  baseUrl,
  initialDraft,
  initialFocus = "body",
  imageCompressionEnabled,
  memo,
  notebooks,
  onClose,
  updateMutation,
}: {
  baseUrl: string;
  initialDraft: MobileMemoDraft | null;
  initialFocus?: "body" | "title";
  imageCompressionEnabled: boolean;
  memo: MemoDetail | null;
  notebooks: Notebook[];
  onClose: () => void;
  updateMutation: MobileMemoUpdateMutation;
}) => {
  const { client, session } = useSession();
  const { resolvedLocale } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  const restoredDraft = initialDraft?.expectedRevision === memo?.revision ? initialDraft : null;
  const initialContentJson = restoredDraft
    ? markdownToDoc(restoredDraft.contentMarkdown)
    : resolveMemoContentDoc(memo?.contentJson, memo?.contentMarkdown);
  const editorRef = useRef<LocalTiptapEditorRef>(null);
  const resourceDataUrlCacheRef = useRef(new Map<string, Promise<string | null>>());
  const imageLoadFailureNotifier = useMemo(
    () =>
      createOnceProtectedResourceFailureNotifier((failure) => {
        alertProtectedImageLoadFailure(resolvedLocale, failure);
      }),
    [memo?.id, resolvedLocale]
  );
  const initialFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentJsonRef = useRef<TiptapDoc>(initialContentJson);
  const contentMarkdownRef = useRef(restoredDraft?.contentMarkdown ?? memo?.contentMarkdown ?? "");
  const contentSnapshotRef = useRef(JSON.stringify(contentJsonRef.current));
  const dirtyRef = useRef(Boolean(restoredDraft));
  const flushResolverRef = useRef<(() => void) | null>(null);
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const memoBaseRef = useRef(memo);
  const [title, setTitle] = useState(resolveEditableMemoTitle(restoredDraft?.title ?? memo?.title));
  const [tagsText, setTagsText] = useState(restoredDraft?.tagsText ?? memo?.tags.join(", ") ?? "");
  const [notebookId, setNotebookId] = useState(restoredDraft?.notebookId ?? memo?.notebookId ?? "");
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(Boolean(restoredDraft));
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(Boolean(restoredDraft));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startupMs, setStartupMs] = useState<number | null>(null);
  const [resourceTarget, setResourceTarget] = useState<MobileResourceTarget | null>(null);
  const editorStartup = useMobileEditorStartupGuard({ active: Boolean(memo && baseUrl), ready });
  const { pickUploadAssets, uploadSourcePicker } = useMobileEditorUploadAsset();
  const notebookLabel = notebooks.find((notebook) => notebook.id === notebookId)?.name ?? "未分类";
  const saveLabel = error ? "保存失败" : saving ? "保存中" : uploading ? "上传中" : dirty ? (draftRestored ? "本地草稿" : "未保存") : ready ? "已保存" : "加载中";
  const titleRef = useRef(title);
  const tagsTextRef = useRef(tagsText);
  const notebookIdRef = useRef(notebookId);
  titleRef.current = title;
  tagsTextRef.current = tagsText;
  notebookIdRef.current = notebookId;

  useEffect(() => () => {
    if (initialFocusTimerRef.current !== null) {
      clearTimeout(initialFocusTimerRef.current);
      initialFocusTimerRef.current = null;
    }
  }, []);

  const retryEditorStartup = useCallback(() => {
    if (initialFocusTimerRef.current !== null) {
      clearTimeout(initialFocusTimerRef.current);
      initialFocusTimerRef.current = null;
    }
    setReady(false);
    setStartupMs(null);
    setError(null);
    editorStartup.restart();
  }, [editorStartup.restart]);

  const persistDraft = async (contentJson: TiptapDoc) => {
    const currentMemo = memoBaseRef.current;
    if (!currentMemo) {
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
    // Capture whether the user kept typing while this save is in flight so we
    // do not clear the dirty flag and drop their next autosave.
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
        // Newer local edits arrived during the save; keep dirty so the next pass uploads them.
        dirtyRef.current = true;
        setDirty(true);
      }
      setDraftRestored(false);
      return savedMemo;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const flushEditor = () => flushMobileEditor(editorRef, flushResolverRef);
  const { aiPromptsJson, cancelSelectionAi, requestSelectionAi } = useMobileSelectionAi({
    client,
    editorRef,
    resolvedLocale,
    titleRef,
  });

  const requestClose = async () => {
    if (savingRef.current || uploadingRef.current) {
      return;
    }
    if (initialFocusTimerRef.current !== null) {
      clearTimeout(initialFocusTimerRef.current);
      initialFocusTimerRef.current = null;
    }
    await flushEditor();
    const savedMemo = await save();
    if (savedMemo) {
      onClose();
    }
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      void requestClose();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const pickAndUploadImage = async () => {
    if (!client || !memo || uploadingRef.current) {
      return;
    }
    if (memo.id.startsWith("local:")) {
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
        const { resource } = await client.uploadMemoResource(memo.id, new ExpoFile(uploadAsset.uri));
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

  const canMutateEditorResource = useCallback(() => Boolean(memo && !memo.id.startsWith("local:")), [memo]);
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

  const editorElement = useMemo(
    () => memo && baseUrl ? (
      <LocalTiptapEditor
        autoFocus={initialFocus === "body"}
        aiPromptsJson={aiPromptsJson}
        baseUrl={baseUrl}
        content={contentJsonRef.current}
        dom={{
          ...SAFE_DOM_WEBVIEW_PROPS,
          bounces: false,
          contentInsetAdjustmentBehavior: "never",
          overScrollMode: "never",
          scrollEnabled: false,
          style: styles.richEditorWebView,
        }}
        onChange={persistDraft}
        onAiCancel={cancelSelectionAi}
        onAiRequest={requestSelectionAi}
        onResourcePress={selectResource}
        onLoadResource={loadEditorResource}
        onPickImage={pickAndUploadImage}
        onReady={async (elapsedMs) => {
          setStartupMs(elapsedMs);
          setReady(true);
          recordEditorStartup(elapsedMs);
          if (initialFocusTimerRef.current !== null) {
            clearTimeout(initialFocusTimerRef.current);
          }
          // The DOM editor performs its own bounded focus retry. Reveal the Android
          // keyboard only after that retry instead of issuing another competing focus.
          if (Platform.OS === "android" && initialFocus === "body") {
            initialFocusTimerRef.current = setTimeout(() => {
              initialFocusTimerRef.current = null;
              showEdgeEverKeyboard();
            }, 180);
          }
        }}
        key={editorStartup.attempt}
        ref={editorRef}
        locale={resolvedLocale}
        theme={resolvedTheme}
      />
    ) : null,
    [aiPromptsJson, baseUrl, cancelSelectionAi, editorStartup.attempt, initialFocus, loadEditorResource, memo?.id, requestSelectionAi, resolvedLocale, resolvedTheme, selectResource]
  );

  useEffect(() => {
    const currentMemo = memoBaseRef.current;
    if (!currentMemo || !dirty) {
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
  }, [dirty, memo, notebookId, tagsText, title]);

  useEffect(() => {
    if (!memoBaseRef.current || !dirty || !ready || savingRef.current || uploadingRef.current) {
      return;
    }
    const timeout = setTimeout(() => {
      void flushEditor().then(save);
    }, 1200);
    return () => clearTimeout(timeout);
  }, [dirty, memo, notebookId, ready, tagsText, title]);

  return (
    <SafeAreaView style={styles.richEditorSafeArea}>
      <KeyboardAvoidingView
        behavior="height"
        enabled={Platform.OS === "android"}
        style={styles.richEditorKeyboardAvoiding}
      >
        <View style={styles.createMemoHeader}>
          <Pressable accessibilityLabel="返回" accessibilityRole="button" disabled={saving || uploading} onPress={() => void requestClose()} style={styles.createMemoBackButton}>
            <ChevronLeft color={saving || uploading ? "#cbd5e1" : "#0f172a"} size={30} />
          </Pressable>
          <View style={styles.createMemoHeaderActions}>
            <Text numberOfLines={1} style={[styles.createMemoStatus, styles.richEditorHeaderStatus, (saving || uploading || dirty) && styles.createMemoStatusActive, error && styles.richEditorStatusError]}>{saveLabel}</Text>
            <Pressable
              accessibilityLabel="完成编辑"
              accessibilityRole="button"
              disabled={saving || uploading || !ready}
              onPress={() => void requestClose()}
              style={[styles.createMemoDoneButton, (saving || uploading || !ready) && styles.createMemoDoneButtonDisabled]}
            >
              {saving ? <ActivityIndicator color="#64748b" size="small" /> : <Text style={[styles.createMemoDoneText, (uploading || !ready) && styles.createMemoDoneTextDisabled]}>完成</Text>}
            </Pressable>
          </View>
        </View>

        {memo && baseUrl ? (
          <View style={styles.richEditorContainer}>
            <TextInput
              autoFocus={initialFocus === "title"}
              onChangeText={(value) => {
                setTitle(value);
                dirtyRef.current = true;
                setDirty(true);
              }}
              placeholder={DEFAULT_MEMO_TITLE}
              placeholderTextColor="#94a3b8"
              selectTextOnFocus={initialFocus === "title"}
              style={styles.createMemoTitleInput}
              value={title}
            />
            <View style={[styles.createMemoMetaRow, styles.richStandaloneMetaRow]}>
              <Pressable accessibilityLabel="所在笔记本" accessibilityRole="button" onPress={() => setNotebookPickerOpen(true)} style={styles.createMemoNotebookButton}>
                <Text numberOfLines={1} style={styles.createMemoNotebookText}>{notebookLabel}</Text>
                <ChevronDown color="#64748b" size={14} />
              </Pressable>
              <Pressable accessibilityLabel="选择笔记标签" accessibilityRole="button" onPress={() => setTagPickerOpen(true)} style={[styles.createMemoTagsButton, styles.richStandaloneTagsInput]}>
                <Text numberOfLines={1} style={[styles.createMemoTagsInput, !tagsText && styles.createMemoTagsPlaceholder]}>
                  {tagsText || "添加标签"}
                </Text>
                <ChevronDown color="#94a3b8" size={14} />
              </Pressable>
              <SmartTagButton
                client={client}
                contentMarkdown={contentMarkdownRef.current}
                disabled={saving || uploading}
                onChange={(nextTags) => {
                  setTagsText(nextTags.join(", "));
                  dirtyRef.current = true;
                  setDirty(true);
                }}
                selectedTags={parseTags(tagsText)}
                title={title}
              />
            </View>
            {draftRestored ? <Text style={styles.richEditorDraftNotice}>已恢复上次未完成的本地草稿</Text> : null}
            <View style={styles.richEditorFrame}>
              {editorElement}
              {!ready ? <MobileEditorStartupOverlay onRetry={retryEditorStartup} timedOut={editorStartup.timedOut} /> : null}
            </View>
            {error ? <Text style={styles.richEditorInlineError}>{error}</Text> : null}
            {startupMs !== null && __DEV__ ? <Text style={styles.richEditorPerf}>本地编辑器启动：{startupMs}ms</Text> : null}
          </View>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>缺少笔记数据，无法打开富文本编辑器</Text>
          </View>
        )}
        <NotebookPickerModal
          activeNotebookId={notebookId}
          notebooks={notebooks}
          onClose={() => setNotebookPickerOpen(false)}
          onSelect={(nextNotebookId) => {
            setNotebookId(nextNotebookId);
            setNotebookPickerOpen(false);
            dirtyRef.current = true;
            setDirty(true);
          }}
          visible={notebookPickerOpen}
        />
        <TagPickerModal
          dataScope={createMobileDataScope(session?.baseUrl ?? baseUrl, session?.user?.id)}
          onChange={(nextTags) => {
            setTagsText(nextTags.join(", "));
            dirtyRef.current = true;
            setDirty(true);
          }}
          onClose={() => setTagPickerOpen(false)}
          selectedTags={parseTags(tagsText)}
          visible={tagPickerOpen}
        />
        <MobileResourceActions
          canMutate={Boolean(memo && !memo.id.startsWith("local:"))}
          onClose={() => setResourceTarget(null)}
          onDelete={deleteResource}
          onDownload={downloadResource}
          onRename={renameResource}
          onSaveAs={saveResourceAs}
          target={resourceTarget}
        />
        {uploadSourcePicker}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createMobileImageUploadId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createLocalImagePreviewDataUrl = async (asset: { mimeType?: string | null; uri: string }) => {
  const file = new ExpoFile(asset.uri);
  const mimeType = asset.mimeType || file.type || "application/octet-stream";
  return `data:${mimeType};base64,${await file.base64()}`;
};

const appendResourceMarkdown = (
  currentMarkdown: string,
  resource: {
    filename: string;
    kind: "image" | "attachment";
    url: string;
  }
) => {
  const label = resource.filename.replace(/\]/g, "\\]");
  const markdown = resource.kind === "image" ? `![${label}](${resource.url})` : `附件：[${label}](${resource.url})`;
  const trimmed = currentMarkdown.trimEnd();

  return trimmed ? `${trimmed}\n\n${markdown}\n` : `${markdown}\n`;
};
