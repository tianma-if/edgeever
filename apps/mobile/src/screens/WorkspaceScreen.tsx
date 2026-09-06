import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import type { ListMemosResponse, MemoFilterMode, MemoSortMode } from "@edgeever/client";
import {
  ActivityIndicator,
  Home,
  Plus,
  UserRound,
} from "../components/icons";
import {
  BackHandler,
  InteractionManager,
  Modal,
  Share as NativeShare,
  Vibration,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Pressable, Text } from "../components/LocalizedText";
import { ApiRequestError } from "@edgeever/client";
import { DEFAULT_MEMO_TITLE, getNotebookDescendantIds, markdownToDoc, type MemoDetail } from "@edgeever/shared";
import { MOBILE_UI_METRICS, toggleMobileMemoFilterMode } from "@edgeever/shared/mobile-ui";
import { clearMobileMemoDraft, readMobileMemoDraft, type MobileMemoDraft } from "../lib/mobile-drafts";
import {
  readMobileImageCompressionEnabled,
  readMobileMemoListDensity,
  writeMobileImageCompressionEnabled,
  writeMobileMemoListDensity,
  type MobileLocalePreference,
  type MobileMemoListDensity,
} from "../lib/preferences";
import { useMobileLocale } from "../lib/mobile-locale";
import { useSession } from "../lib/session";
import {
  clearMobileMemoUpdateQueueItem,
  deleteMobileSyncQueueItem,
  discardMobileMemoConflict,
  getMobileConflictDraftClipboardText,
  getMobileSyncErrorMessage,
  isMobileSyncConflictError,
  listMobileSyncQueueItems,
  markMobileMemoUpdateConflict,
  markMobileMemoUpdateError,
  queueMobileMemoUpdate,
  shouldQueueMobileMemoSaveError,
  type MobileSyncQueueItem,
} from "../lib/sync-queue";
import { deleteMobileMemos } from "../lib/mobile-memo-delete";
import { removeMobileMemosFromListCache } from "../lib/mobile-memo-list-cache";
import {
  createMobileDataScope,
  getLocalMemo,
  listLocalMemos,
  listLocalNotebooks,
  listLocalTags,
  resolveLocalMemo,
  syncMobileLocalMirror,
  upsertLocalMemo,
  type MobileBootstrapProgress,
} from "../lib/local-mirror";
import { AccountSecurityPanel } from "./AccountSecurityModal";
import { beginEditorStartup, markStartup } from "../lib/startup-performance";
import MobileWebClipCapture from "../components/MobileWebClipCapture";
import { MobileCreateChoiceModal, MobileTemplatePickerModal } from "../components/MobileTemplatePicker";
import { useMobileTheme } from "../lib/mobile-theme";
import { useMobileUpdateAvailable } from "../lib/mobile-update";
import { type MobileCreateMemoSeed } from "../lib/mobile-templates";
import {
  buildMobileWebClipDraft,
  buildMobileWebClipDraftFromRenderedPage,
  getSharedImages,
  getSharedWebUrl,
  isWeChatArticleUrl,
  type MobileRenderedWebPage,
  type MobileSharedImage,
  type MobileSharedPayload,
  type MobileWebClipDraft,
} from "../lib/mobile-web-clip";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useMobileAutomaticSync } from "../hooks/useMobileAutomaticSync";
import { useMobileLocalMirrorSync } from "../hooks/useMobileLocalMirrorSync";
import { useMobileWorkspaceSelection } from "../hooks/useMobileWorkspaceSelection";
import {
  flattenNotebooks,
  formatMemoPreviewDate,
  getResolvedMobileLocale,
  getTextSearchMatches,
  isEnglishMobileLocale,
  parseTags,
} from "./workspace-utils";
import {
  applyOptimisticMemoToCache,
  createOptimisticMemo,
  findCachedMemoDetail,
  type MobileMemoUpdatePayload,
} from "./workspace-memo-cache";
import { refreshWorkspaceThemeStyles, styles } from "./workspace-styles";
import { NotesView } from "./WorkspaceNotesView";
import { SettingsView, type MobileLocaleMode } from "./WorkspaceSettingsView";
import { MemoDetailModal } from "./WorkspaceMemoDetail";
import {
  MoveSelectionModal,
  NotebookPickerModal,
} from "./WorkspacePickers";
import { RevisionHistoryModal } from "./WorkspaceRevisionHistory";
import { CreateMemoModal, RichEditorModal } from "./WorkspaceEditors";
import {
  NotesActionsModal,
  SelectionActionBar,
  SelectionMoreModal,
} from "./WorkspaceActionSheets";
import {
  deleteMobileResourceFromDoc,
  getMobileResourceUpdatePayload,
  renameMobileResourceInDoc,
  type MobileResourceTarget,
} from "../lib/mobile-attachments";

const ALL_NOTES_ID = "all";
type MobileView = "notes" | "settings";
type MemoView = "notebook" | "trash";
type RichEditingSession = {
  draft: MobileMemoDraft | null;
  initialFocus: "body" | "title";
  memo: MemoDetail;
};
type MobileMemoListCacheSnapshot = Array<[QueryKey, InfiniteData<ListMemosResponse> | undefined]>;

export const WorkspaceScreen = ({
  incomingShareError = null,
  incomingShareIsResolving = false,
  incomingSharePayloads = [],
  onIncomingShareHandled,
}: {
  incomingShareError?: Error | null;
  incomingShareIsResolving?: boolean;
  incomingSharePayloads?: MobileSharedPayload[];
  onIncomingShareHandled?: () => void;
}) => {
  const { resolvedTheme } = useMobileTheme();
  const { preference: localePreference, resolvedLocale, setPreference: setLocalePreference } = useMobileLocale();
  const hasUpdate = useMobileUpdateAvailable();
  refreshWorkspaceThemeStyles(resolvedTheme);
  const { client, session, signOut } = useSession();
  const queryClient = useQueryClient();
  const safeAreaInsets = useSafeAreaInsets();
  const syncQueueScope = session?.baseUrl ?? "";
  const dataScope = createMobileDataScope(session?.baseUrl ?? "", session?.user?.id);
  const [activeView, setActiveView] = useState<MobileView>("notes");
  const [activeNotebookId, setActiveNotebookId] = useState<string>(ALL_NOTES_ID);
  const autoSelectedDemoNotebookRef = useRef(false);
  const [memoView, setMemoView] = useState<MemoView>("notebook");
  const [memoFilterMode, setMemoFilterMode] = useState<MemoFilterMode>("all");
  const [memoSortMode, setMemoSortMode] = useState<MemoSortMode>("updated-desc");
  const [memoListDensity, setMemoListDensity] = useState<MobileMemoListDensity>("preview");
  const [imageCompressionEnabled, setImageCompressionEnabled] = useState(true);
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<MobileCreateMemoSeed | null>(null);
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [incomingClipDraft, setIncomingClipDraft] = useState<MobileWebClipDraft | null>(null);
  const [incomingClipCaptureUrl, setIncomingClipCaptureUrl] = useState<string | null>(null);
  const [incomingShareImages, setIncomingShareImages] = useState<MobileSharedImage[]>([]);
  const [isImportingShare, setIsImportingShare] = useState(false);
  const [notesActionsOpen, setNotesActionsOpen] = useState(false);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [richEditingSession, setRichEditingSession] = useState<RichEditingSession | null>(null);
  const [revisionMemo, setRevisionMemo] = useState<MemoDetail | null>(null);
  const {
    clearSelection,
    enterSelectionMode,
    remapSelectedMemoId,
    restoreSelection,
    selectedMemoIds,
    selectionMode,
    selectionMoreOpen,
    selectionMoveOpen,
    selectSingleMemo,
    setSelectionMoreOpen,
    setSelectionMoveOpen,
    toggleSelectedMemo,
    toggleVisibleSelection,
  } = useMobileWorkspaceSelection();
  const memoDraftPrefetchRef = useRef(new Map<string, Promise<MobileMemoDraft | null>>());
  const processedShareUrlRef = useRef<string | null>(null);
  const onIncomingShareHandledRef = useRef(onIncomingShareHandled);
  onIncomingShareHandledRef.current = onIncomingShareHandled;
  const debouncedSearchText = useDebouncedValue(searchText.trim(), 250);
  const incomingShareUrl = useMemo(() => getSharedWebUrl(incomingSharePayloads), [incomingSharePayloads]);
  const sharedImages = useMemo(() => getSharedImages(incomingSharePayloads), [incomingSharePayloads]);
  const handleMemoIdRemapped = useCallback((temporaryId: string, memo: MemoDetail) => {
    setSelectedMemoId((current) => current === temporaryId ? memo.id : current);
    remapSelectedMemoId(temporaryId, memo.id);
  }, [remapSelectedMemoId]);
  const {
    refreshSyncQueueItems,
    runForcedSync,
    syncQueueItems,
  } = useMobileAutomaticSync({
    client,
    dataScope,
    onMemoIdRemapped: handleMemoIdRemapped,
    syncQueueScope,
  });
  const {
    initialSyncError: initialMirrorSyncError,
    initialSyncProgress: initialMirrorSyncProgress,
    isInitialStatusPending: isInitialMirrorStatusPending,
    retryInitialSync,
  } = useMobileLocalMirrorSync({ client, dataScope });

  const notebooksQuery = useQuery({
    queryKey: ["mobile", "notebooks"],
    queryFn: async () => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return listLocalNotebooks(dataScope);
    },
    enabled: Boolean(client),
  });

  const notebooks = notebooksQuery.data?.notebooks ?? [];
  useEffect(() => {
    const english = isEnglishMobileLocale(localePreference);
    const preferredNotebookId = english ? "nb_demo_features_en" : "nb_demo_features";
    const alternateNotebookId = english ? "nb_demo_features" : "nb_demo_features_en";

    if (!notebooks.some((notebook) => notebook.id === preferredNotebookId)) {
      return;
    }

    if (!autoSelectedDemoNotebookRef.current && activeNotebookId === ALL_NOTES_ID) {
      autoSelectedDemoNotebookRef.current = true;
      setActiveNotebookId(preferredNotebookId);
      return;
    }

    if (activeNotebookId === alternateNotebookId) {
      setActiveNotebookId(preferredNotebookId);
    }
  }, [activeNotebookId, localePreference, notebooks]);

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null;
  const activeNotebookDescendantIds = useMemo(
    () => (activeNotebookId === ALL_NOTES_ID ? [] : getNotebookDescendantIds(notebooks, activeNotebookId)),
    [activeNotebookId, notebooks]
  );

  const memosQuery = useInfiniteQuery({
    queryKey: ["mobile", "memos", memoView, activeNotebookId, memoFilterMode, memoSortMode, activeNotebookDescendantIds, "paged-v2"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return listLocalMemos(dataScope, {
        notebookIds: activeNotebookDescendantIds,
        filter: memoFilterMode,
        limit: 50,
        offset: pageParam,
        sort: memoSortMode,
        trash: memoView === "trash",
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ? Number(lastPage.nextCursor) : undefined,
    enabled: Boolean(client),
    placeholderData: keepPreviousData,
  });

  const searchQuery = useInfiniteQuery({
    queryKey: ["mobile", "search", memoView, debouncedSearchText, activeNotebookId, memoFilterMode, memoSortMode, activeNotebookDescendantIds, "paged-v4"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return listLocalMemos(dataScope, {
        q: debouncedSearchText,
        notebookIds: activeNotebookDescendantIds,
        filter: memoFilterMode,
        limit: 50,
        offset: pageParam,
        sort: memoSortMode,
        trash: memoView === "trash",
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ? Number(lastPage.nextCursor) : undefined,
    enabled: Boolean(client && debouncedSearchText.length > 0),
    placeholderData: keepPreviousData,
  });

  const memoDetailQuery = useQuery({
    queryKey: ["mobile", "memo", memoView, selectedMemoId],
    queryFn: async () => {
      if (!client || !selectedMemoId) {
        throw new Error("Memo is not selected");
      }

      const local = await getLocalMemo(dataScope, selectedMemoId);
      if (local) {
        return { memo: local };
      }
      const response = await client.getMemo(selectedMemoId, { includeDeleted: memoView === "trash" });
      await upsertLocalMemo(dataScope, response.memo);
      return response;
    },
    enabled: Boolean(client && selectedMemoId),
  });

  useEffect(() => {
    markStartup("workspace-first-commit");
    const task = InteractionManager.runAfterInteractions(() => markStartup("workspace-interactive"));
    return () => task.cancel();
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectedMemoId) {
        setSelectedMemoId(null);
        return true;
      }
      if (selectionMode) {
        clearSelection();
        return true;
      }
      if (searchText.trim()) {
        setSearchText("");
        return true;
      }
      if (activeView !== "notes") {
        setActiveView("notes");
        if (memoView === "trash") {
          setMemoView("notebook");
          setActiveNotebookId(ALL_NOTES_ID);
        }
        return true;
      }
      if (memoView === "trash") {
        setMemoView("notebook");
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [activeView, clearSelection, memoView, searchText, selectedMemoId, selectionMode]);

  useEffect(() => {
    if (notebooksQuery.data && memosQuery.data) {
      markStartup("workspace-data-ready");
    }
  }, [memosQuery.data, notebooksQuery.data]);

  const refresh = async () => {
    // Pull-to-refresh must push the outbox first; previously it only pulled
    // the server mirror, so pending local edits stayed stuck on "待同步".
    if (client) {
      await runForcedSync();
      await syncMobileLocalMirror(client, dataScope);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memo"] }),
      refreshSyncQueueItems(),
    ]);
  };

  const handleMemoPress = (memoId: string) => {
    if (selectionMode) {
      toggleSelectedMemo(memoId);
      return;
    }

    setSelectedMemoId(memoId);
  };

  const showAllNotes = () => {
    setActiveView("notes");
    setMemoView("notebook");
    setActiveNotebookId(ALL_NOTES_ID);
    setSearchText("");
    clearSelection();
  };

  const showTrash = () => {
    setMemoView("trash");
    setActiveNotebookId(ALL_NOTES_ID);
    setSearchText("");
    clearSelection();
  };

  const openSettings = () => {
    setSearchText("");
    setActiveView("settings");
  };

  const closeSettings = () => {
    setActiveView("notes");
    if (memoView === "trash") {
      setMemoView("notebook");
      setActiveNotebookId(ALL_NOTES_ID);
    }
  };

  const closeDetail = () => {
    setSelectedMemoId(null);
  };

  const closeRichEditor = () => {
    const memoId = richEditingSession?.memo.id ?? null;
    setRichEditingSession(null);
    setSelectedMemoId(null);
    if (memoId) {
      memoDraftPrefetchRef.current.delete(memoId);
      void loadMemoDraft(memoId);
    }
  };

  const loadMemoDraft = useCallback((memoId: string) => {
    const cached = memoDraftPrefetchRef.current.get(memoId);
    if (cached) {
      return cached;
    }
    const pending = readMobileMemoDraft(memoId);
    memoDraftPrefetchRef.current.set(memoId, pending);
    return pending;
  }, []);

  const openRichEditor = useCallback(async (memo: MemoDetail, initialFocus: "body" | "title" = "body") => {
    // Unmount detail DomWebView before the editable instance mounts (Android IME).
    beginEditorStartup();
    let editingMemo = memo;
    const queuedItem = (await listMobileSyncQueueItems(syncQueueScope)).find((item) => item.memoId === memo.id);

    if (!queuedItem && client && !memo.id.startsWith("local:")) {
      try {
        const response = await client.getMemo(memo.id);
        editingMemo = response.memo;
        await upsertLocalMemo(dataScope, editingMemo);
        queryClient.setQueryData(["mobile", "memo", "notebook", editingMemo.id], { memo: editingMemo });
        queryClient.setQueryData(["mobile", "memo", "trash", editingMemo.id], { memo: editingMemo });
      } catch {
        // The local mirror remains editable while offline.
      }
    }

    const draft = await loadMemoDraft(editingMemo.id);
    memoDraftPrefetchRef.current.delete(memo.id);
    setSelectedMemoId(null);
    setRichEditingSession({ draft, initialFocus, memo: editingMemo });
  }, [client, dataScope, loadMemoDraft, queryClient, syncQueueScope]);

  const memos = useMemo(() => memosQuery.data?.pages.flatMap((page) => page.memos) ?? [], [memosQuery.data]);
  const searchResults = useMemo(() => searchQuery.data?.pages.flatMap((page) => page.memos) ?? [], [searchQuery.data]);
  const searchActive = searchText.trim().length > 0;
  const visibleMemos = searchActive ? searchResults : memos;
  const selectedMemo = memoDetailQuery.data?.memo ?? null;
  const selectedMemoSyncItem = selectedMemo
    ? syncQueueItems.find((item) => item.memoId === selectedMemo.id) ?? null
    : null;
  const selectedMemoSyncStatus = selectedMemoSyncItem?.status ?? null;
  const selectedMemoSyncError = selectedMemoSyncItem?.lastError ?? null;
  const isRefreshing = notebooksQuery.isFetching || memosQuery.isFetching || searchQuery.isFetching || memoDetailQuery.isFetching;
  const selectedMemoIdList = Array.from(selectedMemoIds);
  const selectedMemos = visibleMemos.filter((memo) => selectedMemoIds.has(memo.id));
  const canToggleVisibleSelection = visibleMemos.length > 0;
  const allVisibleMemosSelected = canToggleVisibleSelection && visibleMemos.every((memo) => selectedMemoIds.has(memo.id));
  const nextSelectionPinValue = selectedMemos.some((memo) => !memo.isPinned);
  const defaultMemoNotebookId = notebooks.find(
    (notebook) => notebook.id === "nb_inbox" || notebook.slug === "inbox" || notebook.name === "等待分类"
  )?.id ?? "";
  const createMemoNotebookId =
    activeNotebookId !== ALL_NOTES_ID && notebooks.some((notebook) => notebook.id === activeNotebookId)
      ? activeNotebookId
      : defaultMemoNotebookId;
  const canCreateMemo = memoView !== "trash" && Boolean(createMemoNotebookId);
  const openCreateMemo = useCallback((seed: MobileCreateMemoSeed | null = null) => {
    beginEditorStartup();
    // Drop detail / selection so no other DomWebView stays mounted under the editor.
    // Multiple WebViews make Android IME attach to the wrong (often read-only) view.
    setSelectedMemoId(null);
    clearSelection();
    setIncomingClipDraft(null);
    setIncomingShareImages([]);
    setCreateSeed(seed);
    setCreateOpen(true);
  }, [clearSelection]);

  const openCreateFromTemplate = useCallback(() => {
    if (!canCreateMemo) {
      return;
    }
    setSelectedMemoId(null);
    setTemplatePickerOpen(true);
  }, [canCreateMemo]);

  const openIncomingClipDraft = useCallback((draft: MobileWebClipDraft) => {
    beginEditorStartup();
    setSelectedMemoId(null);
    setCreateSeed(null);
    setIncomingClipDraft(draft);
    setActiveView("notes");
    setMemoView("notebook");
    setCreateOpen(true);
  }, []);

  const finishIncomingShare = useCallback(() => {
    setIncomingClipCaptureUrl(null);
    setIsImportingShare(false);
    onIncomingShareHandledRef.current?.();
  }, []);

  const handleRenderedClipCaptured = useCallback((page: MobileRenderedWebPage) => {
    if (!incomingClipCaptureUrl) return;
    openIncomingClipDraft(
      buildMobileWebClipDraftFromRenderedPage(incomingClipCaptureUrl, page),
    );
    finishIncomingShare();
  }, [finishIncomingShare, incomingClipCaptureUrl, openIncomingClipDraft]);

  const handleRenderedClipFailed = useCallback((message: string) => {
    const sourceUrl = incomingClipCaptureUrl;
    if (!sourceUrl) return;
    setIncomingClipCaptureUrl(null);
    void buildMobileWebClipDraft(sourceUrl)
      .then((draft) => {
        openIncomingClipDraft(draft);
        Alert.alert(
          "正文剪藏失败",
          `${message} 已保留文章链接，你可以稍后重新分享重试。`,
        );
      })
      .finally(finishIncomingShare);
  }, [finishIncomingShare, incomingClipCaptureUrl, openIncomingClipDraft]);

  useEffect(() => {
    if (incomingShareIsResolving) {
      return;
    }

    if (incomingShareError && sharedImages.some((image) => !image.uri.startsWith("file:"))) {
      if (processedShareUrlRef.current !== "invalid-binary-share") {
        processedShareUrlRef.current = "invalid-binary-share";
        Alert.alert("无法读取分享图片", incomingShareError.message || "请重新分享后再试。");
        onIncomingShareHandledRef.current?.();
      }
      return;
    }

    if (sharedImages.length > 0) {
      const shareKey = `images:${sharedImages.map((image) => image.uri).join("|")}`;
      if (processedShareUrlRef.current === shareKey) {
        return;
      }
      if (notebooks.length === 0) {
        if (notebooksQuery.isSuccess) {
          processedShareUrlRef.current = shareKey;
          Alert.alert("无法保存图片", "请先在 EdgeEver 中创建一个笔记本。");
          onIncomingShareHandledRef.current?.();
        }
        return;
      }

      processedShareUrlRef.current = shareKey;
      beginEditorStartup();
      setSelectedMemoId(null);
      setIncomingClipDraft(null);
      setIncomingShareImages(sharedImages);
      setCreateSeed({
        contentMarkdown: "",
        tagsText: "",
        title: sharedImages.length === 1 ? "分享的图片" : `分享的图片（${sharedImages.length} 张）`,
      });
      setActiveView("notes");
      setMemoView("notebook");
      setCreateOpen(true);
      onIncomingShareHandledRef.current?.();
      return;
    }

    const sourceUrl = incomingShareUrl;
    if (!sourceUrl) {
      if (incomingSharePayloads.length > 0 && processedShareUrlRef.current !== "invalid-share") {
        processedShareUrlRef.current = "invalid-share";
        Alert.alert(
          "无法读取分享内容",
          incomingShareError?.message || "分享内容里没有可识别的网页链接或图片。",
        );
        onIncomingShareHandledRef.current?.();
        return;
      }
      processedShareUrlRef.current = null;
      return;
    }
    if (processedShareUrlRef.current === sourceUrl) {
      return;
    }
    if (notebooks.length === 0) {
      if (notebooksQuery.isSuccess) {
        processedShareUrlRef.current = sourceUrl;
        Alert.alert("无法保存剪藏", "请先在 EdgeEver 中创建一个笔记本。");
        onIncomingShareHandledRef.current?.();
      }
      return;
    }

    let active = true;
    processedShareUrlRef.current = sourceUrl;
    setIsImportingShare(true);
    if (isWeChatArticleUrl(sourceUrl)) {
      setIncomingClipCaptureUrl(sourceUrl);
      return () => {
        active = false;
      };
    }
    void buildMobileWebClipDraft(sourceUrl)
      .then((draft) => {
        if (!active) {
          return;
        }
        openIncomingClipDraft(draft);
      })
      .catch(() => {
        if (active) {
          Alert.alert("剪藏失败", "无法读取分享的网页，请稍后重试。");
        }
      })
      .finally(() => {
        if (active) {
          setIsImportingShare(false);
          onIncomingShareHandledRef.current?.();
        }
      });

    return () => {
      active = false;
    };
  }, [
    incomingShareError,
    incomingShareIsResolving,
    incomingSharePayloads.length,
    incomingShareUrl,
    notebooks.length,
    notebooksQuery.isSuccess,
    openIncomingClipDraft,
    sharedImages,
  ]);

  useEffect(() => {
    if (selectedMemo && !selectedMemo.isDeleted) {
      void loadMemoDraft(selectedMemo.id);
    }
  }, [loadMemoDraft, selectedMemo]);

  useEffect(() => {
    clearSelection();
  }, [activeNotebookId, clearSelection, memoFilterMode, memoSortMode, memoView]);

  useEffect(() => {
    let mounted = true;

    refreshSyncQueueItems().then((items) => {
      if (!mounted) {
        return;
      }

      for (const item of items) {
        const cachedMemo = findCachedMemoDetail(queryClient, item.memoId);
        if (cachedMemo) {
          const optimisticMemo = createOptimisticMemo(cachedMemo, item.payload);
          applyOptimisticMemoToCache(queryClient, cachedMemo, { ...optimisticMemo, updatedAt: item.updatedAt });
        }
      }
    });

    return () => {
      mounted = false;
    };
  }, [queryClient, refreshSyncQueueItems]);

  useEffect(() => {
    let mounted = true;

    readMobileImageCompressionEnabled().then((enabled) => {
      if (mounted) {
        setImageCompressionEnabled(enabled);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    readMobileMemoListDensity().then((density) => {
      if (mounted) {
        setMemoListDensity(density);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleMemoListDensityChange = (density: MobileMemoListDensity) => {
    setMemoListDensity(density);
    void writeMobileMemoListDensity(density);
  };

  const handleLocalePreferenceChange = (locale: MobileLocaleMode) => {
    setLocalePreference(locale);
  };

  const handleImageCompressionChange = (enabled: boolean) => {
    setImageCompressionEnabled(enabled);
    void writeMobileImageCompressionEnabled(enabled);
  };

  const optimisticallyRemoveMemoIds = async (memoIds: string[]): Promise<MobileMemoListCacheSnapshot> => {
    const queryKeys: QueryKey[] = [
      ["mobile", "memos"],
      ["mobile", "search"],
    ];
    await Promise.all(queryKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
    const snapshot = queryKeys.flatMap((queryKey) =>
      queryClient.getQueriesData<InfiniteData<ListMemosResponse>>({ queryKey })
    );
    const memoIdSet = new Set(memoIds);
    for (const queryKey of queryKeys) {
      queryClient.setQueriesData<InfiniteData<ListMemosResponse>>({ queryKey }, (current) =>
        removeMobileMemosFromListCache(current, memoIdSet)
      );
    }
    return snapshot;
  };

  const restoreMemoListCache = (snapshot: MobileMemoListCacheSnapshot | undefined) => {
    for (const [queryKey, data] of snapshot ?? []) {
      queryClient.setQueryData(queryKey, data);
    }
  };

  const invalidateWorkspace = async () => {
    if (client) {
      await syncMobileLocalMirror(client, dataScope);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memo"] }),
    ]);
  };

  const updateMemoMutation = useMutation({
    mutationFn: async ({ memo, payload }: { memo: MemoDetail; payload: MobileMemoUpdatePayload }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      const editSessionResponse = payload.contentMarkdown !== undefined
        ? await client.createMemoEditSession(memo.id)
        : null;
      const response = await client.updateMemo(memo.id, {
        expectedRevision: memo.revision,
        ...(editSessionResponse
          ? {
              expectedContentHash: memo.contentHash,
              editSessionId: editSessionResponse.editSession.id,
            }
          : {}),
        ...payload,
      });

      return response.memo;
    },
    onSuccess: async (memo) => {
      await invalidateWorkspace();
      queryClient.setQueryData(["mobile", "memo", memoView, memo.id], { memo });
    },
  });

  const localUpdateMemoMutation = useMutation({
    mutationFn: async ({ memo, payload }: { memo: MemoDetail; payload: MobileMemoUpdatePayload }) => {
      const syncBaseMemo = await resolveLocalMemo(dataScope, memo.id) ?? memo;
      const optimisticMemo = createOptimisticMemo(syncBaseMemo, payload);
      const queuePayload = {
        memoId: syncBaseMemo.id,
        expectedRevision: syncBaseMemo.revision,
        expectedContentHash: syncBaseMemo.contentHash,
        title: optimisticMemo.title?.trim() || DEFAULT_MEMO_TITLE,
        contentMarkdown: optimisticMemo.contentMarkdown,
        notebookId: optimisticMemo.notebookId,
        tags: optimisticMemo.tags,
      };

      // Online-first: push immediately when the instance is reachable so common
      // edits never sit in "待同步". Fall back to the durable outbox only when
      // the network or server cannot accept the write right now.
      if (client && !syncBaseMemo.id.startsWith("local:")) {
        try {
          const editSessionResponse = payload.contentMarkdown !== undefined
            ? await client.createMemoEditSession(syncBaseMemo.id)
            : null;

          if (
            editSessionResponse
            && (
              editSessionResponse.editSession.baseRevision !== syncBaseMemo.revision
              || editSessionResponse.editSession.baseContentHash !== syncBaseMemo.contentHash
            )
          ) {
            throw new ApiRequestError("Note changed before the offline draft could sync.", 409, "revision_conflict");
          }

          const response = await client.updateMemo(syncBaseMemo.id, {
            expectedRevision: syncBaseMemo.revision,
            ...(editSessionResponse
              ? {
                  expectedContentHash: syncBaseMemo.contentHash,
                  editSessionId: editSessionResponse.editSession.id,
                }
              : {}),
            ...payload,
          });

          await clearMobileMemoUpdateQueueItem(syncQueueScope, syncBaseMemo.id);
          await refreshSyncQueueItems();
          return response.memo;
        } catch (error) {
          const message = getMobileSyncErrorMessage(error);

          if (isMobileSyncConflictError(error)) {
            await queueMobileMemoUpdate(syncQueueScope, queuePayload);
            await markMobileMemoUpdateConflict(syncQueueScope, syncBaseMemo.id, message);
            await refreshSyncQueueItems();
            return optimisticMemo;
          }

          await queueMobileMemoUpdate(syncQueueScope, queuePayload);
          if (!shouldQueueMobileMemoSaveError(error)) {
            await markMobileMemoUpdateError(syncQueueScope, syncBaseMemo.id, message);
          }
          await refreshSyncQueueItems();
          // Durable local save succeeded; outbox will retry. Do not fail the editor.
          return optimisticMemo;
        }
      }

      await queueMobileMemoUpdate(syncQueueScope, queuePayload);
      await refreshSyncQueueItems();
      return optimisticMemo;
    },
    onSuccess: async (memo, variables) => {
      await upsertLocalMemo(dataScope, memo);
      applyOptimisticMemoToCache(queryClient, variables.memo, memo);
      void runForcedSync();
    },
  });

  const applyAiDraftToMemo = async (memo: MemoDetail, draft: string, mode: "append" | "replace") => {
    const normalizedDraft = draft.trim();
    const contentMarkdown = mode === "append"
      ? [memo.contentMarkdown.trimEnd(), normalizedDraft].filter(Boolean).join("\n\n")
      : normalizedDraft;
    await localUpdateMemoMutation.mutateAsync({
      memo,
      payload: {
        contentMarkdown,
        contentJson: markdownToDoc(contentMarkdown),
      },
    });
  };

  const deleteMemoMutation = useMutation({
    onMutate: async ({ memo }) => {
      const cacheSnapshot = await optimisticallyRemoveMemoIds([memo.id]);
      const reopenMemoId = selectedMemoId === memo.id ? memo.id : null;
      setSelectedMemoId(null);
      return { cacheSnapshot, reopenMemoId };
    },
    mutationFn: async ({ memo, permanent }: { memo: MemoDetail; permanent: boolean }) => {
      await deleteMobileMemos({
        client,
        dataScope,
        syncQueueScope,
        memoIds: [memo.id],
        permanent,
      });
      await refreshSyncQueueItems();
      return { memo, permanent };
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      setRichEditingSession(null);
      setSelectedMemoId(null);
    },
    onError: (error, _variables, context) => {
      restoreMemoListCache(context?.cacheSnapshot);
      if (context?.reopenMemoId) {
        setSelectedMemoId(context.reopenMemoId);
      }
      Alert.alert("删除失败", error instanceof Error ? error.message : "请检查网络后重试");
    },
  });

  const restoreMemoMutation = useMutation({
    mutationFn: async (memo: MemoDetail) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      const response = await client.restoreMemo(memo.id);
      return response.memo;
    },
    onSuccess: async (memo) => {
      await invalidateWorkspace();
      setMemoView("notebook");
      setSelectedMemoId(memo.id);
    },
  });

  const shareMemoMutation = useMutation({
    mutationFn: async (memo: MemoDetail) => {
      if (!client || !session) {
        throw new Error("Client is not ready");
      }

      const response = await client.createMemoShare(memo.id);
      const shareUrl = `${session.baseUrl.replace(/\/+$/, "")}/share/${encodeURIComponent(response.share.token)}`;
      await NativeShare.share({
        message: `${memo.title?.trim() || DEFAULT_MEMO_TITLE}\n${shareUrl}`,
        title: memo.title?.trim() || DEFAULT_MEMO_TITLE,
        url: shareUrl,
      });
    },
    onError: () => {
      Alert.alert("分享失败", "无法创建分享链接，请检查网络后重试。");
    },
  });

  const moveMemosMutation = useMutation({
    mutationFn: async ({ memoIds, notebookId }: { memoIds: string[]; notebookId: string }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return client.moveMemos({ memoIds, notebookId });
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      clearSelection();
    },
  });

  const pinMemosMutation = useMutation({
    mutationFn: async ({ memoIds, isPinned }: { memoIds: string[]; isPinned: boolean }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      await Promise.all(memoIds.map((memoId) => client.updateMemo(memoId, { isPinned })));
      return { ok: true };
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      clearSelection();
    },
  });

  const deleteMemosMutation = useMutation({
    onMutate: async ({ memoIds }) => {
      const cacheSnapshot = await optimisticallyRemoveMemoIds(memoIds);
      const previousSelectionMode = selectionMode;
      const previousSelectedMemoIds = new Set(selectedMemoIds);
      clearSelection();
      return { cacheSnapshot, previousSelectionMode, previousSelectedMemoIds };
    },
    mutationFn: async ({ memoIds, permanent }: { memoIds: string[]; permanent: boolean }) => {
      const result = await deleteMobileMemos({
        client,
        dataScope,
        syncQueueScope,
        memoIds,
        permanent,
      });
      await refreshSyncQueueItems();
      return result;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      clearSelection();
    },
    onError: (error, _variables, context) => {
      restoreMemoListCache(context?.cacheSnapshot);
      restoreSelection(
        context?.previousSelectionMode ?? false,
        context?.previousSelectedMemoIds ?? new Set(),
      );
      Alert.alert("删除失败", error instanceof Error ? error.message : "请检查网络后重试");
    },
  });

  const handleTogglePin = (memo: MemoDetail) => {
    updateMemoMutation.mutate({ memo, payload: { isPinned: !memo.isPinned } });
  };

  const handleDeleteMemo = (memo: MemoDetail) => {
    const permanent = memoView === "trash" || memo.isDeleted;
    if (!permanent) {
      deleteMemoMutation.mutate({ memo, permanent: false });
      return;
    }
    Alert.alert("永久删除笔记", "这个操作不可恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "永久删除",
        style: "destructive",
        onPress: () => deleteMemoMutation.mutate({ memo, permanent: true }),
      },
    ]);
  };

  const handleRenameResource = async (memo: MemoDetail, target: MobileResourceTarget, filename: string) => {
    if (!client) throw new Error("当前无法连接实例，请稍后重试");
    const { resource } = await client.renameResource(target.resourceId, filename);
    const contentJson = renameMobileResourceInDoc(
      memo.contentJson,
      target,
      resource.filename || filename,
      resolvedLocale === "en-US" ? "Attachment: " : "附件："
    );
    await localUpdateMemoMutation.mutateAsync({
      memo,
      payload: getMobileResourceUpdatePayload(contentJson),
    });
  };

  const handleDeleteResource = async (memo: MemoDetail, target: MobileResourceTarget) => {
    if (!client) throw new Error("当前无法连接实例，请稍后重试");
    await client.deleteResource(target.resourceId);
    const contentJson = deleteMobileResourceFromDoc(memo.contentJson, target);
    await localUpdateMemoMutation.mutateAsync({
      memo,
      payload: getMobileResourceUpdatePayload(contentJson),
    });
  };

  const handleCopyConflictDraft = useCallback(async (memo: MemoDetail) => {
    try {
      const text = await getMobileConflictDraftClipboardText(syncQueueScope, memo.id);
      if (!text?.trim()) {
        Alert.alert("复制失败", "没有可复制的本地草稿。");
        return;
      }
      await Clipboard.setStringAsync(text);
      Alert.alert("已复制", "本地草稿已复制到剪贴板。");
    } catch (error) {
      Alert.alert("复制失败", error instanceof Error ? error.message : "请重试");
    }
  }, [syncQueueScope]);

  const handleAdoptCloudVersion = useCallback(async (memo: MemoDetail) => {
    if (!client) {
      return;
    }

    try {
      const remoteMemo = await discardMobileMemoConflict(client, syncQueueScope, memo.id);
      await Promise.all([
        clearMobileMemoDraft(memo.id),
        upsertLocalMemo(dataScope, remoteMemo),
      ]);
      queryClient.setQueryData(["mobile", "memo", "notebook", memo.id], { memo: remoteMemo });
      queryClient.setQueryData(["mobile", "memo", "trash", memo.id], { memo: remoteMemo });
      await Promise.all([
        refreshSyncQueueItems(),
        queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "memo", "notebook", memo.id] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "memo", "trash", memo.id] }),
      ]);
    } catch (error) {
      Alert.alert("采用云端版本失败", error instanceof Error ? error.message : "请检查网络后重试");
    }
  }, [client, dataScope, queryClient, refreshSyncQueueItems, syncQueueScope]);

  const handleMemoSyncConflict = useCallback((memo: MemoDetail) => {
    Alert.alert(
      "同步冲突",
      "云端笔记已在其他标签页、设备，或离线期间被更新，本地草稿无法直接覆盖。可先复制本地草稿，再采用云端版本后继续编辑。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "复制本地草稿",
          onPress: () => {
            void handleCopyConflictDraft(memo);
          },
        },
        { text: "查看历史", onPress: () => setRevisionMemo(memo) },
        {
          text: "采用云端并重新加载",
          style: "destructive",
          onPress: () => {
            void handleAdoptCloudVersion(memo);
          },
        },
      ]
    );
  }, [handleAdoptCloudVersion, handleCopyConflictDraft]);

  const handleDeleteSelection = () => {
    const permanent = memoView === "trash";
    if (!permanent) {
      deleteMemosMutation.mutate({ memoIds: selectedMemoIdList, permanent: false });
      return;
    }
    Alert.alert(`永久删除 ${selectedMemoIdList.length} 条笔记`, "这个操作不可恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "永久删除",
        style: "destructive",
        onPress: () => deleteMemosMutation.mutate({ memoIds: selectedMemoIdList, permanent: true }),
      },
    ]);
  };

  if (richEditingSession) {
    return <RichEditorModal
      baseUrl={session?.baseUrl ?? ""}
      initialDraft={richEditingSession.draft}
      initialFocus={richEditingSession.initialFocus}
      imageCompressionEnabled={imageCompressionEnabled}
      memo={richEditingSession.memo}
      notebooks={notebooks}
      onClose={closeRichEditor}
      updateMutation={localUpdateMemoMutation}
    />;
  }

  // Full-tree create (same as rich edit) — never stack DomWebView inside RN Modal over
  // list/detail WebViews; that breaks Android soft-input attachment.
  if (createOpen) {
    return (
      <CreateMemoModal
        baseUrl={session?.baseUrl ?? ""}
        client={client}
        dataScope={dataScope}
        defaultNotebookId={createMemoNotebookId}
        imageCompressionEnabled={imageCompressionEnabled}
        initialDraft={incomingClipDraft ?? createSeed}
        initialSharedImages={incomingShareImages}
        notebooks={notebooks}
        onCreated={() => {
          setCreateOpen(false);
          setIncomingClipDraft(null);
          setIncomingShareImages([]);
          setCreateSeed(null);
          setActiveView("notes");
          setMemoView("notebook");
          setSelectedMemoId(null);
        }}
        onDismiss={() => {
          setCreateOpen(false);
          setIncomingClipDraft(null);
          setIncomingShareImages([]);
          setCreateSeed(null);
        }}
        onQueued={runForcedSync}
        syncQueueScope={syncQueueScope}
      />
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>

      {activeView === "notes" ? (
        <NotesView
          activeNotebook={activeNotebook}
          initialSyncProgress={initialMirrorSyncProgress}
          isLoading={notebooksQuery.isLoading || (searchActive ? searchQuery.isLoading : memosQuery.isLoading) || (isInitialMirrorStatusPending && visibleMemos.length === 0)}
          isLoadingMore={searchActive ? searchQuery.isFetchingNextPage : memosQuery.isFetchingNextPage}
          isRefreshing={isRefreshing}
          memoFilterMode={memoFilterMode}
          memoListDensity={memoListDensity}
          memoSortMode={memoSortMode}
          memoView={memoView}
          memos={visibleMemos}
          notebooks={notebooks}
          onCreate={() => openCreateMemo()}
          onCreateFromTemplate={canCreateMemo ? openCreateFromTemplate : undefined}
          onClearSelection={clearSelection}
          onFilterModeChange={setMemoFilterMode}
          onOpenActions={() => setNotesActionsOpen(true)}
          onOpenNotebookPicker={() => setNotebookPickerOpen(true)}
          onMemoPress={handleMemoPress}
          onMemoLongPress={(memo) => {
            Vibration.vibrate(8);
            selectSingleMemo(memo.id);
          }}
          onLoadMore={() => {
            const query = searchActive ? searchQuery : memosQuery;
            if (query.hasNextPage && !query.isFetchingNextPage) {
              void query.fetchNextPage();
            }
          }}
          onRefresh={refresh}
          onSearchTextChange={(value) => {
            setSearchText(value);
            clearSelection();
          }}
          onSetMemoView={(nextMemoView) => nextMemoView === "trash" ? showTrash() : showAllNotes()}
          searchText={searchText}
          totalMemoCount={searchActive
            ? searchQuery.data?.pages[0]?.totalCount ?? searchResults.length
            : memosQuery.data?.pages[0]?.totalCount ?? memos.length}
          selectionMode={selectionMode}
          selectedMemoIds={selectedMemoIds}
          error={initialMirrorSyncError ?? notebooksQuery.error ?? (searchActive ? searchQuery.error : memosQuery.error)}
          isError={Boolean(initialMirrorSyncError) || notebooksQuery.isError || (searchActive ? searchQuery.isError : memosQuery.isError)}
          onRetry={retryInitialSync}
        />
      ) : null}

      {activeView === "settings" ? (
        <SettingsView
          currentUser={session?.user ?? null}
          onClose={closeSettings}
          localePreference={localePreference}
          onLocalePreferenceChange={handleLocalePreferenceChange}
          imageCompressionEnabled={imageCompressionEnabled}
          onImageCompressionChange={handleImageCompressionChange}
          onSignOut={signOut}
        />
      ) : null}

      <MemoDetailModal
        initialSearchQuery={selectedMemoId ? searchText.trim() : ""}
        isDeleting={deleteMemoMutation.isPending}
        isLoading={memoDetailQuery.isLoading}
        isRestoring={restoreMemoMutation.isPending}
        isSaving={updateMemoMutation.isPending || localUpdateMemoMutation.isPending}
        isSharing={shareMemoMutation.isPending}
        memo={selectedMemo}
        notebookName={notebooks.find((notebook) => notebook.id === selectedMemo?.notebookId)?.name ?? "未分类"}
        onClose={closeDetail}
        onDelete={handleDeleteMemo}
        onDeleteResource={handleDeleteResource}
        onRichEdit={(memo, initialFocus) => void openRichEditor(memo, initialFocus)}
        onOpenRevisions={setRevisionMemo}
        onRenameResource={handleRenameResource}
        onAdoptCloudVersion={(memo) => void handleAdoptCloudVersion(memo)}
        onApplyAiDraft={applyAiDraftToMemo}
        onCopyLocalDraft={(memo) => void handleCopyConflictDraft(memo)}
        onResolveSyncConflict={handleMemoSyncConflict}
        onRetrySync={() => {
          void runForcedSync();
        }}
        onRestore={(memo) => restoreMemoMutation.mutate(memo)}
        onShare={(memo) => shareMemoMutation.mutate(memo)}
        syncError={selectedMemoSyncError}
        syncStatus={selectedMemoSyncStatus}
        visible={Boolean(selectedMemoId)}
      />

      {notebookPickerOpen ? <NotebookPickerModal
        activeNotebookId={activeNotebookId}
        notebooks={notebooks}
        onClose={() => setNotebookPickerOpen(false)}
        onSelect={(notebookId) => {
          setActiveNotebookId(notebookId);
          setNotebookPickerOpen(false);
        }}
        visible
      /> : null}

      {revisionMemo ? <RevisionHistoryModal
        memo={revisionMemo}
        onClose={() => setRevisionMemo(null)}
        onRestored={async (memo) => {
          const queuedItems = (await listMobileSyncQueueItems(syncQueueScope))
            .filter((item) => item.memoId === memo.id);
          await Promise.all([
            ...queuedItems.map((item) => deleteMobileSyncQueueItem(syncQueueScope, item.id)),
            clearMobileMemoDraft(memo.id),
            upsertLocalMemo(dataScope, memo),
          ]);
          queryClient.setQueryData(["mobile", "memo", "notebook", memo.id], { memo });
          queryClient.setQueryData(["mobile", "memo", "trash", memo.id], { memo });
          await refreshSyncQueueItems();
          setRevisionMemo(null);
          setSelectedMemoId(memo.id);
        }}
      /> : null}

      <MobileCreateChoiceModal
        bottomOffset={58 + safeAreaInsets.bottom}
        canCreate={canCreateMemo}
        onBlank={() => openCreateMemo()}
        onClose={() => setCreateChoiceOpen(false)}
        onTemplate={openCreateFromTemplate}
        visible={createChoiceOpen}
      />

      <MobileTemplatePickerModal
        bottomOffset={58 + safeAreaInsets.bottom}
        client={client}
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={(seed) => openCreateMemo(seed)}
        visible={templatePickerOpen}
      />

      <Modal animationType="fade" statusBarTranslucent transparent visible={isImportingShare}>
        <View style={styles.shareImportBackdrop}>
          <View style={styles.shareImportCard}>
            <ActivityIndicator color="#059669" size="large" />
            <Text style={styles.shareImportTitle}>正在剪藏文章</Text>
            <Text style={styles.shareImportDescription}>正在提取标题、正文和图片链接…</Text>
          </View>
          {incomingClipCaptureUrl ? (
            <MobileWebClipCapture
              onCaptured={handleRenderedClipCaptured}
              onFailed={handleRenderedClipFailed}
              url={incomingClipCaptureUrl}
            />
          ) : null}
        </View>
      </Modal>

      {selectionMoveOpen ? <MoveSelectionModal
        bottomOffset={58 + safeAreaInsets.bottom}
        isMoving={moveMemosMutation.isPending}
        notebooks={notebooks}
        onClose={() => setSelectionMoveOpen(false)}
        onMove={(notebookId) => moveMemosMutation.mutate({ memoIds: selectedMemoIdList, notebookId })}
        selectedCount={selectedMemoIds.size}
        selectedNotebookId={activeNotebookId === ALL_NOTES_ID ? flattenNotebooks(notebooks)[0]?.notebook.id ?? "" : activeNotebookId}
        visible
      /> : null}

      {notesActionsOpen ? <NotesActionsModal
        bottomOffset={52 + safeAreaInsets.bottom}
        canEnterSelection={visibleMemos.length > 0}
        memoListDensity={memoListDensity}
        memoSortMode={memoSortMode}
        listDescription={`${searchActive ? searchQuery.data?.pages[0]?.totalCount ?? searchResults.length : memosQuery.data?.pages[0]?.totalCount ?? memos.length} 条笔记`}
        listTitle={memoView === "trash" ? "回收站" : activeNotebook?.name ?? "全部笔记"}
        onClose={() => setNotesActionsOpen(false)}
        onEnterSelection={() => {
          setNotesActionsOpen(false);
          enterSelectionMode();
        }}
        onMemoListDensityChange={handleMemoListDensityChange}
        onSortModeChange={setMemoSortMode}
        selectionMode={selectionMode}
        visible
      /> : null}

      {selectionMoreOpen ? <SelectionMoreModal
        bottomOffset={58 + safeAreaInsets.bottom}
        canPin={memoView !== "trash" && selectedMemoIds.size > 0 && !pinMemosMutation.isPending}
        canToggleVisibleSelection={canToggleVisibleSelection}
        onClear={clearSelection}
        onClose={() => setSelectionMoreOpen(false)}
        onPin={() => {
          setSelectionMoreOpen(false);
          pinMemosMutation.mutate({ memoIds: selectedMemoIdList, isPinned: nextSelectionPinValue });
        }}
        onToggleVisibleSelection={() => {
          setSelectionMoreOpen(false);
          toggleVisibleSelection(visibleMemos.map((memo) => memo.id));
        }}
        pinLabel={nextSelectionPinValue ? "置顶" : "取消置顶"}
        selectedCount={selectedMemoIds.size}
        selectionToggleLabel={allVisibleMemosSelected ? "全不选当前列表" : "全选当前列表"}
        visible
      /> : null}

      {activeView === "notes" && selectionMode ? (
        <SelectionActionBar
          bottomInset={safeAreaInsets.bottom}
          canMove={memoView !== "trash" && selectedMemoIds.size > 0}
          isBusy={deleteMemosMutation.isPending || moveMemosMutation.isPending || pinMemosMutation.isPending}
          isTrashView={memoView === "trash"}
          onDelete={handleDeleteSelection}
          onMore={() => setSelectionMoreOpen(true)}
          onMove={() => setSelectionMoveOpen(true)}
          selectedCount={selectedMemoIds.size}
        />
      ) : null}

      {activeView !== "settings" && !selectionMode ? (
        <View
          style={[styles.bottomNav, { height: MOBILE_UI_METRICS.bottomNavigationHeight + safeAreaInsets.bottom, paddingBottom: safeAreaInsets.bottom }]}
        >
        <BottomNavItem
          active={activeView === "notes"}
          icon={<Home color={activeView === "notes" ? "#0f172a" : "#64748b"} size={20} />}
          label="首页"
          onPress={showAllNotes}
        />
        <Pressable
          accessibilityLabel="新建笔记"
          accessibilityRole="button"
          disabled={!canCreateMemo}
          onLongPress={() => {
            if (!canCreateMemo) {
              return;
            }
            Vibration.vibrate(8);
            setCreateChoiceOpen(true);
          }}
          onPress={() => openCreateMemo()}
          style={[styles.bottomCreateButton, !canCreateMemo && styles.bottomCreateButtonDisabled]}
        >
          <Plus color={canCreateMemo ? "#ffffff" : "#e2e8f0"} size={28} />
        </Pressable>
        <BottomNavItem
          active={false}
          badge={hasUpdate}
          icon={<UserRound color="#64748b" size={20} />}
          label="我的"
          onPress={openSettings}
        />
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const BottomNavItem = ({ active = false, badge = false, icon, label, onPress }: { active?: boolean; badge?: boolean; icon: ReactNode; label: string; onPress: () => void }) => (
  <Pressable
    accessibilityLabel={badge ? `${label}，发现新版本` : label}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    style={styles.bottomNavItem}
  >
    <View style={styles.bottomNavIcon}>
      {icon}
      {badge ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bottomNavBadge} /> : null}
    </View>
    <Text style={[styles.bottomNavText, active && styles.bottomNavTextActive]}>{label}</Text>
  </Pressable>
);
