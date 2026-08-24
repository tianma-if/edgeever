import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryKey, type UseMutationResult } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { File as ExpoFile } from "expo-file-system";
import type { ListMemosResponse, MemoFilterMode, MemoSortMode } from "@edgeever/client";
import {
  ActivityIndicator,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  History,
  Home,
  Image as ImageIcon,
  Info,
  List,
  LogOut,
  MessageSquare,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Tag,
  TagPlus,
  Trash2,
  UserRound,
  X,
} from "../components/icons";
import {
  BackHandler,
  FlatList,
  Image as RNImage,
  type ImageStyle,
  InteractionManager,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  Share as NativeShare,
  ScrollView,
  StyleSheet,
  Text as RNText,
  type StyleProp,
  Switch,
  useWindowDimensions,
  Vibration,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Pressable, Text, TextInput } from "../components/LocalizedText";
import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display";
import { SvgXml } from "react-native-svg";
import { ApiRequestError } from "@edgeever/client";
import { buildGitHubFeedbackUrl, createExcerpt, DEFAULT_MEMO_TITLE, docToMarkdown, docToText, getNotebookDescendantIds, markdownToDoc, resolveMemoContentDoc, type AuthUser, type MemoDetail, type MemoRevision, type MemoSummary, type Notebook, type TiptapDoc } from "@edgeever/shared";
import { MOBILE_UI_METRICS, getMobileCenteredScrollOffset, getMobileNotebookSearchVisibleIds, toggleMobileMemoFilterMode, toggleMobileMemoSelection } from "@edgeever/shared/mobile-ui";
import { clearMobileMemoDraft, clearMobileNewMemoDraft, readMobileMemoDraft, writeMobileMemoDraft, type MobileMemoDraft } from "../lib/mobile-drafts";
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
  queueMobileMemoCreate,
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
import { beginEditorStartup, markStartup, recordEditorStartup } from "../lib/startup-performance";
import { prepareUploadAsset, type MobileImageUploadAsset } from "../lib/mobile-image-upload";
import MobileWebClipCapture from "../components/MobileWebClipCapture";
import LocalTiptapEditor, { type LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { SAFE_DOM_WEBVIEW_PROPS } from "../lib/mobile-dom";
import { safeDomCall } from "../lib/safe-dom-call";
import { applyMobileEditorUpload, cancelMobileEditorUpload, flushMobileEditor } from "../lib/mobile-editor-controller";
import { showEdgeEverKeyboard } from "../../modules/edgeever-keyboard";
import { MobileResourceActions } from "../components/MobileResourceActions";
import { MobileCreateChoiceModal, MobileTemplatePickerModal } from "../components/MobileTemplatePicker";
import { resolveMobileThemeStyles, useMobileTheme } from "../lib/mobile-theme";
import { useMobileUpdate } from "../lib/mobile-update";
import { createMemoSeedHasContent, type MobileCreateMemoSeed } from "../lib/mobile-templates";
import { createMobileDraftWriteBarrier } from "../lib/mobile-draft-write-barrier";
import { MobileMermaidDiagram, MobileMermaidProvider } from "../components/MobileMermaid";
import { getMobileMarkdownFenceLanguage, trimMobileMarkdownFenceContent } from "../lib/mobile-mermaid";
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
import { useMobileEditorResourceActions } from "../hooks/useMobileEditorResourceActions";
import { useMobileEditorUploadAsset } from "../hooks/useMobileEditorUploadAsset";
import { useMobileSelectionAi } from "../hooks/useMobileSelectionAi";
import {
  filterCollapsedNotebookOptions,
  filterNotebookOptions,
  filterNotebookOptionsById,
  flattenNotebooks,
  formatDate,
  formatMemoPreviewDate,
  formatRevisionActor,
  getNotebookAncestorIds,
  getNotebookParentIdSet,
  getResolvedMobileLocale,
  getTextSearchMatches,
  isEnglishMobileLocale,
  parseTags,
  type NotebookOption,
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
import {
  createOnceProtectedResourceFailureNotifier,
  type ProtectedResourceLoadFailure,
} from "../lib/mobile-protected-resources";

const ALL_NOTES_ID = "all";
const ANDROID_SYSTEM_NAVIGATION_FALLBACK = 48;
const DETAIL_CONTENT_HORIZONTAL_PADDING = 16;
const DETAIL_TABLE_FIT_COLUMN_COUNT = 3;
const DETAIL_TABLE_MIN_COLUMN_WIDTH = 132;
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

const useMobileLocalePreference = () => useMobileLocale().preference;
type MobileView = "notes" | "settings";
type MemoView = "notebook" | "trash";
type RichEditingSession = {
  draft: MobileMemoDraft | null;
  memo: MemoDetail;
};
type MobileMemoUpdateMutation = UseMutationResult<MemoDetail, Error, { memo: MemoDetail; payload: MobileMemoUpdatePayload }>;
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(() => new Set());
  const [selectionMoveOpen, setSelectionMoveOpen] = useState(false);
  const [selectionMoreOpen, setSelectionMoreOpen] = useState(false);
  const memoDraftPrefetchRef = useRef(new Map<string, Promise<MobileMemoDraft | null>>());
  const processedShareUrlRef = useRef<string | null>(null);
  const onIncomingShareHandledRef = useRef(onIncomingShareHandled);
  onIncomingShareHandledRef.current = onIncomingShareHandled;
  const debouncedSearchText = useDebouncedValue(searchText.trim(), 250);
  const incomingShareUrl = useMemo(() => getSharedWebUrl(incomingSharePayloads), [incomingSharePayloads]);
  const sharedImages = useMemo(() => getSharedImages(incomingSharePayloads), [incomingSharePayloads]);
  const handleMemoIdRemapped = useCallback((temporaryId: string, memo: MemoDetail) => {
    setSelectedMemoId((current) => current === temporaryId ? memo.id : current);
    setSelectedMemoIds((current) => {
      if (!current.has(temporaryId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(temporaryId);
      next.add(memo.id);
      return next;
    });
  }, []);
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
        setSelectionMode(false);
        setSelectedMemoIds(new Set());
        setSelectionMoveOpen(false);
        setSelectionMoreOpen(false);
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
  }, [activeView, memoView, searchText, selectedMemoId, selectionMode]);

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

  const toggleSelectedMemo = (memoId: string) => {
    setSelectionMode(true);
    setSelectedMemoIds((current) => toggleMobileMemoSelection(current, memoId));
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedMemoIds(new Set());
    setSelectionMoveOpen(false);
    setSelectionMoreOpen(false);
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

  const toggleVisibleSelection = () => {
    const visibleMemoIds = visibleMemos.map((memo) => memo.id);

    if (visibleMemoIds.length === 0) {
      return;
    }

    setSelectionMode(true);
    setSelectedMemoIds((current) => {
      const next = new Set(current);
      const allVisibleSelected = visibleMemoIds.every((memoId) => next.has(memoId));

      for (const memoId of visibleMemoIds) {
        if (allVisibleSelected) {
          next.delete(memoId);
        } else {
          next.add(memoId);
        }
      }

      return next;
    });
  };

  const enterSelectionMode = () => {
    setSelectionMode(true);
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

  const openRichEditor = useCallback(async (memo: MemoDetail) => {
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
    setRichEditingSession({ draft, memo: editingMemo });
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
    setSelectionMode(false);
    setSelectedMemoIds(new Set());
    setIncomingClipDraft(null);
    setIncomingShareImages([]);
    setCreateSeed(seed);
    setCreateOpen(true);
  }, []);

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
  }, [activeNotebookId, memoFilterMode, memoSortMode, memoView]);

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
      setSelectionMode(context?.previousSelectionMode ?? false);
      setSelectedMemoIds(context?.previousSelectedMemoIds ?? new Set());
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

  const selectSingleMemo = (memoId: string) => {
    Vibration.vibrate(8);
    setSelectionMode(true);
    setSelectedMemoIds(new Set([memoId]));
  };

  if (richEditingSession) {
    return <RichEditorModal
      baseUrl={session?.baseUrl ?? ""}
      initialDraft={richEditingSession.draft}
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
          onMemoLongPress={(memo) => selectSingleMemo(memo.id)}
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
        onRichEdit={(memo) => void openRichEditor(memo)}
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
          toggleVisibleSelection();
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
          icon={<UserRound color="#64748b" size={20} />}
          label="我的"
          onPress={openSettings}
        />
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const useAutoCenterSelectedScrollRow = (visible: boolean, selectedKey: string) => {
  const scrollRef = useRef<ScrollView>(null);
  const viewportHeightRef = useRef(0);
  const rowLayoutsRef = useRef(new Map<string, { height: number; y: number }>());
  const hasCenteredRef = useRef(false);

  const centerSelectedRow = useCallback(() => {
    const selectedLayout = rowLayoutsRef.current.get(selectedKey);
    const viewportHeight = viewportHeightRef.current;
    if (!visible || hasCenteredRef.current || !selectedLayout || viewportHeight <= 0) {
      return;
    }

    hasCenteredRef.current = true;
    const y = getMobileCenteredScrollOffset(selectedLayout.y, selectedLayout.height, viewportHeight);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: false, y }));
  }, [selectedKey, visible]);

  useLayoutEffect(() => {
    hasCenteredRef.current = false;
    const frame = requestAnimationFrame(centerSelectedRow);
    return () => cancelAnimationFrame(frame);
  }, [centerSelectedRow]);

  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
    hasCenteredRef.current = false;
    centerSelectedRow();
  }, [centerSelectedRow]);

  const onRowLayout = useCallback((rowKey: string, event: LayoutChangeEvent) => {
    const { height, y } = event.nativeEvent.layout;
    rowLayoutsRef.current.set(rowKey, { height, y });
    if (rowKey === selectedKey) {
      hasCenteredRef.current = false;
      centerSelectedRow();
    }
  }, [centerSelectedRow, selectedKey]);

  return { onRowLayout, onViewportLayout, scrollRef };
};

const NotebookPickerModal = ({
  activeNotebookId,
  notebooks,
  onClose,
  onSelect,
  visible,
}: {
  activeNotebookId: string;
  notebooks: Notebook[];
  onClose: () => void;
  onSelect: (notebookId: string) => void;
  visible: boolean;
}) => {
  const { translate } = useMobileLocale();
  const safeAreaInsets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState("");
  const [collapsedNotebookIds, setCollapsedNotebookIds] = useState<Set<string>>(() => new Set());
  const selectedScroll = useAutoCenterSelectedScrollRow(visible, activeNotebookId);
  const notebookOptions = flattenNotebooks(notebooks);
  const searchQuery = searchText.trim();
  const childNotebookIds = getNotebookParentIdSet(notebooks);
  const activeNotebookAncestorIds = getNotebookAncestorIds(notebooks, activeNotebookId);
  const visibleNotebookOptions = searchQuery
    ? filterNotebookOptionsById(notebookOptions, getMobileNotebookSearchVisibleIds(notebooks, searchText))
    : filterCollapsedNotebookOptions(notebookOptions, collapsedNotebookIds);
  const activeNotebookName = activeNotebookId === ALL_NOTES_ID
    ? "全部笔记"
    : notebooks.find((notebook) => notebook.id === activeNotebookId)?.name ?? "全部笔记";
  const allNotebookBranchesExpanded = childNotebookIds.size > 0 && Array.from(childNotebookIds).every((notebookId) => !collapsedNotebookIds.has(notebookId));

  useEffect(() => {
    if (visible) {
      setSearchText("");
      setCollapsedNotebookIds(new Set(Array.from(childNotebookIds).filter((notebookId) => !activeNotebookAncestorIds.has(notebookId))));
    }
  }, [visible, activeNotebookId, notebooks]);

  const toggleNotebookCollapsed = (notebookId: string) => {
    setCollapsedNotebookIds((current) => {
      const next = new Set(current);

      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }

      return next;
    });
  };

  const toggleAllNotebookBranches = () => {
    setCollapsedNotebookIds(allNotebookBranchesExpanded ? new Set(childNotebookIds) : new Set());
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.actionSheetBackdrop}>
        <Pressable style={[styles.actionSheet, styles.notebookPickerSheet, { paddingBottom: Math.max(8, safeAreaInsets.bottom) }]}>
          <View style={styles.actionSheetHandle} />
          <View style={styles.notebookPickerHeader}>
            <View style={styles.notebookPickerHeaderText}>
              <Text style={styles.actionSheetTitle}>切换笔记本</Text>
              <Text style={styles.panelLabel}>{translate(`当前：${activeNotebookName}`)}</Text>
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.notebookPickerCloseButton}>
              <X color="#0f172a" size={20} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.notebookPickerContent}
            onLayout={selectedScroll.onViewportLayout}
            ref={selectedScroll.scrollRef}
            style={styles.notebookPickerScroll}
          >
          <View style={styles.notebookPickerSearchBox}>
            <Search color="#64748b" size={18} />
            <TextInput
              accessibilityLabel="搜索笔记本"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchText}
              placeholder="搜索笔记本"
              placeholderTextColor="#94a3b8"
              style={styles.notebookPickerSearchInput}
              value={searchText}
            />
            {searchText ? (
              <Pressable onPress={() => setSearchText("")}>
                <X color="#64748b" size={18} />
              </Pressable>
            ) : null}
          </View>

          <Pressable
            accessibilityLabel={activeNotebookId === ALL_NOTES_ID ? "当前：全部笔记" : "切换到全部笔记"}
            accessibilityRole="button"
            accessibilityState={{ selected: activeNotebookId === ALL_NOTES_ID }}
            onLayout={(event) => selectedScroll.onRowLayout(ALL_NOTES_ID, event)}
            onPress={() => onSelect(ALL_NOTES_ID)}
            style={[styles.notebookPickerRow, styles.notebookPickerAllRow, activeNotebookId === ALL_NOTES_ID && styles.notebookPickerRowActive]}
          >
            <View style={styles.moveNotebookText}>
              <Text numberOfLines={1} style={styles.panelValue}>
                全部笔记
              </Text>
            </View>
            {activeNotebookId === ALL_NOTES_ID ? <Check color="#0f172a" size={18} /> : null}
          </Pressable>

          <View style={styles.notebookPickerSectionHeader}>
            <Text style={styles.label}>{searchQuery ? "匹配的笔记本" : "笔记本"}</Text>
            {!searchQuery && childNotebookIds.size > 0 ? (
              <Pressable
                accessibilityLabel={allNotebookBranchesExpanded ? "收起全部笔记本" : "展开全部笔记本"}
                accessibilityRole="button"
                onPress={toggleAllNotebookBranches}
                style={styles.notebookPickerToggleAll}
              >
                <Text style={styles.notebookPickerToggleAllText}>{allNotebookBranchesExpanded ? "收起全部" : "展开全部"}</Text>
              </Pressable>
            ) : null}
          </View>
          {visibleNotebookOptions.map(({ depth, notebook }) => (
            <View
              key={notebook.id}
              onLayout={(event) => selectedScroll.onRowLayout(notebook.id, event)}
              style={[styles.notebookPickerRow, activeNotebookId === notebook.id && styles.notebookPickerRowActive, depth > 0 && { marginLeft: Math.min(depth * 18, 54) }]}
            >
              {childNotebookIds.has(notebook.id) && !searchQuery ? (
                <Pressable
                  accessibilityLabel={`${collapsedNotebookIds.has(notebook.id) ? "展开" : "收起"} ${notebook.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !collapsedNotebookIds.has(notebook.id) }}
                  onPress={() => toggleNotebookCollapsed(notebook.id)}
                  style={styles.notebookTreeToggle}
                >
                  {collapsedNotebookIds.has(notebook.id) ? <ChevronRight color="#64748b" size={17} /> : <ChevronDown color="#64748b" size={17} />}
                </Pressable>
              ) : (
                <View style={styles.notebookTreeTogglePlaceholder} />
              )}
              <Pressable
                accessibilityLabel={`${activeNotebookId === notebook.id ? "当前" : "切换到"} ${notebook.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected: activeNotebookId === notebook.id }}
                onPress={() => onSelect(notebook.id)}
                style={styles.moveNotebookSelectArea}
              >
                <Text numberOfLines={1} style={styles.panelValue}>
                  {notebook.name}
                </Text>
              </Pressable>
              {activeNotebookId === notebook.id ? <Check color="#0f172a" size={18} /> : null}
            </View>
          ))}
          {visibleNotebookOptions.length === 0 ? (
            <View style={styles.emptyInlinePanel}>
              <Folder color="#94a3b8" size={28} />
              <Text style={styles.mutedText}>没有匹配的笔记本</Text>
            </View>
          ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const SmartTagButton = ({
  client,
  contentMarkdown,
  disabled = false,
  onChange,
  selectedTags,
  title,
}: {
  client: ReturnType<typeof useSession>["client"];
  contentMarkdown: string;
  disabled?: boolean;
  onChange: (tags: string[]) => void;
  selectedTags: string[];
  title: string;
}) => {
  const { resolvedLocale, translate } = useMobileLocale();
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const controllerRef = useRef<AbortController | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unavailable = disabled || !client || selectedTags.length >= 24 || (!title.trim() && !contentMarkdown.trim());

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const generateAndApplyTags = async () => {
    if (unavailable || !client) return;
    controllerRef.current?.abort();
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    try {
      const selectedTagKeys = new Set(selectedTags.map((tag) => tag.toLocaleLowerCase()));
      const result = await client.suggestAiTags({
        title,
        contentMarkdown,
        currentTags: selectedTags,
        locale: resolvedLocale,
      }, controller.signal);
      const additions = result.suggestions
        .filter((suggestion) => !selectedTagKeys.has(suggestion.name.toLocaleLowerCase()))
        .slice(0, Math.max(0, 24 - selectedTags.length))
        .map((suggestion) => suggestion.name);
      if (additions.length === 0) {
        setStatus("idle");
        Alert.alert(translate("智能标签"), translate("没有找到适合这篇笔记的新标签。"));
        return;
      }
      onChange(Array.from(new Set([...selectedTags, ...additions])).slice(0, 24));
      setStatus("success");
      feedbackTimerRef.current = setTimeout(() => {
        setStatus("idle");
        feedbackTimerRef.current = null;
      }, 4000);
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus("idle");
      Alert.alert(
        translate("智能标签生成失败"),
        error instanceof ApiRequestError && error.code === "ai_not_configured"
          ? translate("请先在“AI 集成”中配置默认模型。")
          : error instanceof Error
            ? error.message
            : translate("AI 标签建议生成失败。")
      );
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const accessibilityLabel = status === "loading"
    ? translate("正在生成智能标签")
    : status === "success"
      ? translate("智能标签已添加")
      : translate("智能标签");

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable || status === "loading" }}
      disabled={unavailable || status === "loading"}
      onPress={() => void generateAndApplyTags()}
      style={[styles.smartTagButton, status === "success" && styles.smartTagButtonSuccess, unavailable && styles.buttonDisabled]}
    >
      {status === "loading"
        ? <ActivityIndicator color="#047857" size="small" />
        : status === "success"
          ? <Check color="#047857" size={17} />
          : <TagPlus color="#047857" size={18} />}
    </Pressable>
  );
};

const TagPickerModal = ({
  dataScope,
  onChange,
  onClose,
  selectedTags,
  visible,
}: {
  dataScope: string;
  onChange: (tags: string[]) => void;
  onClose: () => void;
  selectedTags: string[];
  visible: boolean;
}) => {
  const { translate } = useMobileLocale();
  const safeAreaInsets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState("");
  const tagsQuery = useQuery({
    queryKey: ["mobile-tags", dataScope],
    queryFn: () => listLocalTags(dataScope),
    enabled: visible && Boolean(dataScope),
  });
  const normalizedSearch = searchText.trim().replace(/^#/, "");
  const tags = tagsQuery.data?.tags ?? [];
  const visibleTags = tags.filter((tag) => tag.name.toLocaleLowerCase().includes(normalizedSearch.toLocaleLowerCase()));
  const exactMatch = tags.some((tag) => tag.name.toLocaleLowerCase() === normalizedSearch.toLocaleLowerCase());

  useEffect(() => {
    if (visible) {
      setSearchText("");
    }
  }, [visible]);

  const commit = (nextTags: string[]) => onChange(Array.from(new Set(nextTags)).slice(0, 24));
  const toggleTag = (name: string) => commit(
    selectedTags.includes(name) ? selectedTags.filter((tag) => tag !== name) : [...selectedTags, name]
  );
  const createTag = () => {
    const additions = parseTags(normalizedSearch);
    if (additions.length === 0) return;
    commit([...selectedTags, ...additions]);
    setSearchText("");
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.actionSheetBackdrop}>
        <Pressable style={[styles.actionSheet, styles.notebookPickerSheet, { paddingBottom: Math.max(8, safeAreaInsets.bottom) }]}>
          <View style={styles.actionSheetHandle} />
          <View style={styles.notebookPickerHeader}>
            <View style={styles.notebookPickerHeaderText}>
              <Text style={styles.actionSheetTitle}>{translate("选择标签")}</Text>
              <Text style={styles.panelLabel}>{translate("点选已有标签，或输入名称创建新标签")}</Text>
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.notebookPickerCloseButton}>
              <X color="#0f172a" size={20} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.notebookPickerContent} keyboardShouldPersistTaps="handled" style={styles.notebookPickerScroll}>
            {selectedTags.length > 0 ? (
              <View accessibilityLabel="已选标签" style={styles.tagPickerSelectedList}>
                {selectedTags.map((tag) => (
                  <Pressable key={tag} accessibilityLabel={`移除标签 ${tag}`} accessibilityRole="button" onPress={() => toggleTag(tag)} style={styles.tagPickerChip}>
                    <Text style={styles.tagPickerChipText}>#{tag}</Text>
                    <X color="#047857" size={14} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.notebookPickerSearchBox}>
              <Search color="#64748b" size={18} />
              <TextInput
                accessibilityLabel="搜索或输入新标签"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setSearchText}
                onSubmitEditing={createTag}
                placeholder="搜索或输入新标签"
                placeholderTextColor="#94a3b8"
                returnKeyType="done"
                style={styles.notebookPickerSearchInput}
                value={searchText}
              />
              {normalizedSearch && !exactMatch && selectedTags.length < 24 ? (
                <Pressable accessibilityLabel={`新建标签 ${normalizedSearch}`} accessibilityRole="button" onPress={createTag}>
                  <Text style={styles.tagPickerCreateText}>{translate("新建")}</Text>
                </Pressable>
              ) : null}
            </View>

            {tagsQuery.isLoading ? (
              <ActivityIndicator color="#16a06e" style={styles.tagPickerLoading} />
            ) : visibleTags.length === 0 ? (
              <View style={styles.emptyInlinePanel}>
                <Tag color="#94a3b8" size={28} />
                <Text style={styles.mutedText}>{translate("没有匹配的现有标签，可直接新建")}</Text>
              </View>
            ) : visibleTags.map((tag) => {
              const selected = selectedTags.includes(tag.name);
              return (
                <Pressable
                  key={tag.name}
                  accessibilityLabel={`标签 ${tag.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => toggleTag(tag.name)}
                  style={[styles.notebookPickerRow, selected && styles.notebookPickerRowActive]}
                >
                  <View style={[styles.tagPickerCheckbox, selected && styles.tagPickerCheckboxSelected]}>
                    {selected ? <Check color="#ffffff" size={14} /> : null}
                  </View>
                  <Text numberOfLines={1} style={styles.tagPickerRowText}>#{tag.name}</Text>
                  <Text style={styles.panelLabel}>{translate(`${tag.memoCount} 条笔记`)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const CreateMemoModal = ({
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
  const { pickUploadAsset, uploadSourcePicker } = useMobileEditorUploadAsset();
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

  const uploadImageAsset = async (asset: MobileImageUploadAsset | null) => {
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
      const form = new FormData();
      form.append("file", new ExpoFile(uploadAsset.uri));
      const { resource } = await client!.uploadMemoResource(memo.id, form);
      applyMobileEditorUpload(editorRef, resource, uploadId, uploadAsset.name || (resource.kind === "image" ? "图片" : "附件"));
    } catch (error) {
      cancelMobileEditorUpload(editorRef, uploadId);
      Alert.alert("附件上传失败", error instanceof Error ? error.message : "请检查网络连接后重试");
    } finally {
      setImageOperation("idle");
    }
  };

  const pickAndUploadImage = async () => {
    const asset = await pickUploadAsset();
    await uploadImageAsset(asset);
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

const RevisionHistoryModal = ({
  memo,
  onClose,
  onRestored,
}: {
  memo: MemoDetail | null;
  onClose: () => void;
  onRestored: (memo: MemoDetail) => void | Promise<void>;
}) => {
  const { client } = useSession();
  const queryClient = useQueryClient();
  const localePreference = useMobileLocalePreference();
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);

  const revisionsQuery = useQuery({
    queryKey: ["mobile", "memo-revisions", memo?.id],
    queryFn: async () => {
      if (!client || !memo) {
        throw new Error("Memo is not selected");
      }

      return client.listMemoRevisions(memo.id);
    },
    enabled: Boolean(client && memo),
  });

  const revisions = revisionsQuery.data?.revisions ?? [];
  const selectedRevision = revisions.find((revision) => revision.id === selectedRevisionId) ?? revisions[0] ?? null;

  useEffect(() => {
    if (memo && revisions.length > 0 && !selectedRevisionId) {
      setSelectedRevisionId(revisions[0].id);
    }
  }, [memo, revisions, selectedRevisionId]);

  useEffect(() => {
    if (!memo) {
      setSelectedRevisionId(null);
    }
  }, [memo]);

  useEffect(() => {
    setSelectedRevisionId(null);
  }, [memo?.id]);

  const restoreRevisionMutation = useMutation({
    mutationFn: async (revision: MemoRevision) => {
      if (!client || !memo) {
        throw new Error("Memo is not selected");
      }

      const response = await client.restoreMemoRevision(memo.id, revision.id);
      return response.memo;
    },
    onSuccess: async (restoredMemo) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "memo"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "memo-revisions", restoredMemo.id] }),
      ]);
      await onRestored(restoredMemo);
    },
  });

  const requestRestoreRevision = (revision: MemoRevision) => {
    Alert.alert("恢复到这个历史版本", "当前内容会被这个历史版本替换，恢复后仍会产生新的历史记录。", [
      { text: "取消", style: "cancel" },
      {
        text: "恢复",
        onPress: () => restoreRevisionMutation.mutate(revision),
      },
    ]);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={Boolean(memo)}>
      <SafeAreaView style={styles.modalSafeArea}>
        <View style={styles.managementHeader}>
          <View style={styles.managementHeaderText}>
            <View style={styles.managementTitleRow}>
              <History color="#059669" size={19} />
              <Text style={styles.managementTitle}>版本历史</Text>
            </View>
            <Text numberOfLines={1} style={styles.managementSubtitle}>{memo?.title?.trim() || DEFAULT_MEMO_TITLE}</Text>
          </View>
          <IconButton accessibilityLabel="关闭" onPress={onClose}>
            <X color="#0f172a" size={20} />
          </IconButton>
        </View>

        <ScrollView contentContainerStyle={styles.revisionHistoryContent}>
          <View style={styles.revisionSummaryRow}>
            <View style={styles.revisionSummaryText}>
              <Text style={styles.settingsRowTitle}>{selectedRevision ? `版本 ${selectedRevision.revision}` : "未选择历史版本"}</Text>
              <Text style={styles.settingsRowDescription}>选择历史记录后可预览并恢复。</Text>
            </View>
            {selectedRevision ? (
              <ActionButton disabled={restoreRevisionMutation.isPending || Boolean(memo?.isDeleted)} label={restoreRevisionMutation.isPending ? "恢复中" : "恢复该版本"} onPress={() => requestRestoreRevision(selectedRevision)}>
                <RotateCcw color="#0f172a" size={16} />
              </ActionButton>
            ) : null}
          </View>

          <Text style={styles.revisionTimelineLabel}>历史记录</Text>
          {revisionsQuery.isLoading ? (
            <View style={styles.revisionTimelineState}>
              <Text style={styles.mutedText}>加载中</Text>
            </View>
          ) : revisionsQuery.isError ? (
            <View style={styles.revisionTimelineState}>
              <Text style={styles.errorText}>加载失败</Text>
              <Text style={styles.revisionTimelineError}>
                {revisionsQuery.error instanceof Error ? revisionsQuery.error.message : "请稍后重试"}
              </Text>
              <ActionButton label="重试" onPress={() => void revisionsQuery.refetch()}>
                <RotateCcw color="#0f172a" size={16} />
              </ActionButton>
            </View>
          ) : revisions.length === 0 ? (
            <View style={styles.revisionTimelineState}>
              <Text style={styles.mutedText}>暂无历史版本</Text>
            </View>
          ) : (
            <View style={styles.revisionTimeline}>
              {revisions.map((revision) => (
                <Pressable
                  key={revision.id}
                  onPress={() => setSelectedRevisionId(revision.id)}
                  style={[styles.revisionPill, selectedRevision?.id === revision.id && styles.revisionPillActive]}
                >
                  <Text style={[styles.revisionPillTitle, selectedRevision?.id === revision.id && styles.revisionPillTitleActive]}>{`版本 ${revision.revision}`}</Text>
                  <Text style={[styles.revisionPillMeta, selectedRevision?.id === revision.id && styles.revisionPillTitleActive]}>
                    {formatDate(revision.createdAt, localePreference)} · {formatRevisionActor(revision.createdBy)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {selectedRevision ? (
            <View style={styles.revisionPreviewCard}>
              <Text selectable style={styles.revisionPreviewText}>{selectedRevision.contentMarkdown || "空笔记"}</Text>
            </View>
          ) : null}
          {restoreRevisionMutation.error ? (
            <Text style={styles.errorText}>{restoreRevisionMutation.error instanceof Error ? restoreRevisionMutation.error.message : "恢复失败"}</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const RichEditorModal = ({
  baseUrl,
  initialDraft,
  imageCompressionEnabled,
  memo,
  notebooks,
  onClose,
  updateMutation,
}: {
  baseUrl: string;
  initialDraft: MobileMemoDraft | null;
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
  const { pickUploadAsset, uploadSourcePicker } = useMobileEditorUploadAsset();
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
    const asset = await pickUploadAsset();
    if (!asset) {
      return;
    }

    const isImage = asset.mimeType?.startsWith("image/") ?? false;
    const uploadId = isImage ? createMobileImageUploadId() : null;
    uploadingRef.current = true;
    setUploading(true);
    setError(null);
    try {
      if (isImage && uploadId) {
        const previewDataUrl = await createLocalImagePreviewDataUrl(asset);
        safeDomCall(() => editorRef.current?.beginImageUpload(uploadId, previewDataUrl));
      }
      const uploadAsset = await prepareUploadAsset(asset, imageCompressionEnabled);
      const form = new FormData();
      form.append("file", new ExpoFile(uploadAsset.uri));
      const { resource } = await client.uploadMemoResource(memo.id, form);
      applyMobileEditorUpload(editorRef, resource, uploadId, uploadAsset.name || (resource.kind === "image" ? "图片" : "附件"));
    } catch (uploadError) {
      cancelMobileEditorUpload(editorRef, uploadId);
      setError(uploadError instanceof Error ? uploadError.message : "附件上传失败");
    } finally {
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
          if (Platform.OS === "android") {
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
    [aiPromptsJson, baseUrl, cancelSelectionAi, editorStartup.attempt, loadEditorResource, memo?.id, requestSelectionAi, resolvedLocale, resolvedTheme, selectResource]
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
              onChangeText={(value) => {
                setTitle(value);
                dirtyRef.current = true;
                setDirty(true);
              }}
              placeholder={DEFAULT_MEMO_TITLE}
              placeholderTextColor="#94a3b8"
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

const MoveSelectionModal = ({
  bottomOffset,
  isMoving,
  notebooks,
  onClose,
  onMove,
  selectedCount,
  selectedNotebookId,
  visible,
}: {
  bottomOffset: number;
  isMoving: boolean;
  notebooks: Notebook[];
  onClose: () => void;
  onMove: (notebookId: string) => void;
  selectedCount: number;
  selectedNotebookId: string;
  visible: boolean;
}) => {
  const [searchText, setSearchText] = useState("");
  const notebookOptions = flattenNotebooks(notebooks);
  const selectedScroll = useAutoCenterSelectedScrollRow(visible, selectedNotebookId);

  useEffect(() => {
    if (visible) {
      setSearchText("");
    }
  }, [visible]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={[styles.actionSheetBackdrop, { paddingBottom: bottomOffset }]}>
        <Pressable style={[styles.listActionSheet, styles.moveSelectionSheet]}>
          <View style={styles.actionSheetHandle} />
          <View style={styles.listActionSheetHeader}>
            <View style={styles.listActionSheetHeaderText}>
              <Text style={styles.actionSheetTitle}>移动到笔记本</Text>
              <Text style={styles.actionSheetSubtitle}>{selectedCount > 0 ? `已选择 ${selectedCount} 条` : "选择笔记"}</Text>
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
              <X color="#0f172a" size={18} />
            </Pressable>
          </View>
          <View style={styles.moveSelectionSearch}>
            <View style={styles.searchBox}>
              <Search color="#64748b" size={18} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setSearchText}
                placeholder="搜索笔记本"
                placeholderTextColor="#94a3b8"
                style={styles.searchInput}
                value={searchText}
              />
              {searchText ? (
                <Pressable onPress={() => setSearchText("")}>
                  <X color="#64748b" size={18} />
                </Pressable>
              ) : null}
            </View>
          </View>
          <ScrollView
            contentContainerStyle={styles.moveSelectionList}
            onLayout={selectedScroll.onViewportLayout}
            ref={selectedScroll.scrollRef}
            style={styles.listActionSheetScroll}
          >
            <NotebookTreeOptionRows
              collapsible={false}
              compact
              disabled={isMoving}
              emptyIconSize={28}
              notebooks={notebooks}
              onSelect={onMove}
              options={notebookOptions}
              searchText={searchText}
              showDepthPrefix={false}
              showMemoCount={false}
              selectedNotebookId={selectedNotebookId}
              onRowLayout={selectedScroll.onRowLayout}
            />
            {isMoving ? <ActivityIndicator color="#0f172a" style={styles.listLoadingFooter} /> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const NotebookParentSelector = ({
  currentParentId,
  onChange,
  options,
}: {
  currentParentId: string | null;
  onChange: (parentId: string | null) => void;
  options: NotebookOption[];
}) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.parentSelectList}>
    <OptionPill active={currentParentId === null} label="顶层" onPress={() => onChange(null)} />
    {options.map(({ depth, notebook }) => (
      <OptionPill
        active={currentParentId === notebook.id}
        key={notebook.id}
        label={`${"  ".repeat(depth)}${depth > 0 ? "└ " : ""}${notebook.name}`}
        onPress={() => onChange(notebook.id)}
      />
    ))}
  </ScrollView>
);

const NotebookTreeOptionRows = ({
  collapsible = true,
  compact = false,
  disabled = false,
  emptyIconSize,
  notebooks,
  onRowLayout,
  onSelect,
  options,
  searchText,
  selectedNotebookId,
  showDepthPrefix = true,
  showMemoCount = true,
}: {
  collapsible?: boolean;
  compact?: boolean;
  disabled?: boolean;
  emptyIconSize: number;
  notebooks: Notebook[];
  onRowLayout?: (notebookId: string, event: LayoutChangeEvent) => void;
  onSelect: (notebookId: string) => void;
  options: NotebookOption[];
  searchText: string;
  selectedNotebookId: string;
  showDepthPrefix?: boolean;
  showMemoCount?: boolean;
}) => {
  const [collapsedNotebookIds, setCollapsedNotebookIds] = useState<Set<string>>(() => new Set());
  const searchQuery = searchText.trim();
  const childNotebookIds = getNotebookParentIdSet(notebooks);
  const visibleNotebookOptions = searchQuery
    ? filterNotebookOptions(options, searchText)
    : filterCollapsedNotebookOptions(options, collapsedNotebookIds);

  const toggleNotebookCollapsed = (notebookId: string) => {
    setCollapsedNotebookIds((current) => {
      const next = new Set(current);

      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }

      return next;
    });
  };

  if (visibleNotebookOptions.length === 0) {
    return (
      <View style={styles.emptyInlinePanel}>
        <Folder color="#94a3b8" size={emptyIconSize} />
        <Text style={styles.mutedText}>没有匹配的笔记本</Text>
      </View>
    );
  }

  return (
    <View style={[styles.notebookTreeRows, compact && styles.notebookTreeRowsCompact]}>
      {visibleNotebookOptions.map(({ depth, notebook }) => (
        <View
          key={notebook.id}
          onLayout={onRowLayout ? (event) => onRowLayout(notebook.id, event) : undefined}
          style={[
            styles.moveNotebookRow,
            compact && styles.moveNotebookRowCompact,
            selectedNotebookId === notebook.id && styles.moveNotebookRowActive,
            compact && selectedNotebookId === notebook.id && styles.moveNotebookRowCompactActive,
            depth > 0 && { marginLeft: Math.min(depth * 14, 42) },
          ]}
        >
          {collapsible && childNotebookIds.has(notebook.id) && !searchQuery ? (
            <Pressable accessibilityRole="button" onPress={() => toggleNotebookCollapsed(notebook.id)} style={styles.notebookTreeToggle}>
              {collapsedNotebookIds.has(notebook.id) ? <ChevronRight color="#64748b" size={17} /> : <ChevronDown color="#64748b" size={17} />}
            </Pressable>
          ) : !collapsible ? (
            <View style={styles.notebookTreeTogglePlaceholder}>
              <Folder color={selectedNotebookId === notebook.id ? "#059669" : "#64748b"} size={17} />
            </View>
          ) : (
            <View style={styles.notebookTreeTogglePlaceholder} />
          )}
          <Pressable disabled={disabled} onPress={() => onSelect(notebook.id)} style={[styles.moveNotebookSelectArea, disabled && styles.buttonDisabled]}>
            <Text numberOfLines={1} style={[styles.panelValue, compact && selectedNotebookId === notebook.id && styles.moveNotebookTextCompactActive]}>
              {showDepthPrefix && depth > 0 ? `${"· ".repeat(depth)}${notebook.name}` : notebook.name}
            </Text>
            {showMemoCount ? <Text style={styles.panelLabel}>{notebook.memoCount} 条笔记</Text> : null}
          </Pressable>
          {selectedNotebookId === notebook.id ? <Check color={compact ? "#059669" : "#0f172a"} size={18} /> : null}
        </View>
      ))}
    </View>
  );
};

const NotebookPicker = ({
  notebooks,
  onChange,
  selectedNotebookId,
}: {
  notebooks: Notebook[];
  onChange: (notebookId: string) => void;
  selectedNotebookId: string;
}) => {
  const [searchText, setSearchText] = useState("");
  const notebookOptions = flattenNotebooks(notebooks);

  return (
    <View style={styles.notebookPicker}>
      <View style={styles.searchBox}>
        <Search color="#64748b" size={18} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchText}
          placeholder="搜索笔记本"
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
          value={searchText}
        />
        {searchText ? (
          <Pressable onPress={() => setSearchText("")}>
            <X color="#64748b" size={18} />
          </Pressable>
        ) : null}
      </View>
      <NotebookTreeOptionRows
        emptyIconSize={24}
        notebooks={notebooks}
        onSelect={onChange}
        options={notebookOptions}
        searchText={searchText}
        selectedNotebookId={selectedNotebookId}
      />
    </View>
  );
};

const OptionPill = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.optionPill, active && styles.optionPillActive]}>
    <Text style={[styles.optionPillText, active && styles.optionPillTextActive]}>{label}</Text>
  </Pressable>
);

const PanelRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.panelRow}>
    <Text style={styles.panelLabel}>{label}</Text>
    <Text selectable style={styles.panelValue}>
      {value}
    </Text>
  </View>
);

const IconButton = ({ accessibilityLabel, children, disabled = false, onPress }: { accessibilityLabel?: string; children: ReactNode; disabled?: boolean; onPress: () => void }) => (
  <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.iconButton, disabled && styles.buttonDisabled]}>
    {children}
  </Pressable>
);

const ActionButton = ({
  children,
  danger = false,
  disabled = false,
  label,
  onPress,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) => (
  <Pressable disabled={disabled} onPress={onPress} style={[styles.actionButton, danger && styles.actionButtonDanger, disabled && styles.buttonDisabled]}>
    {children}
    <Text style={[styles.actionButtonText, danger && styles.actionButtonTextDanger]}>{label}</Text>
  </Pressable>
);

const BottomNavItem = ({ active = false, icon, label, onPress }: { active?: boolean; icon: ReactNode; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={styles.bottomNavItem}>
    {icon}
    <Text style={[styles.bottomNavText, active && styles.bottomNavTextActive]}>{label}</Text>
  </Pressable>
);

const CreateMemoToolbarButton = ({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  icon: ReactNode;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityLabel={accessibilityLabel}
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [styles.createMemoToolButton, pressed && styles.createMemoToolButtonPressed]}
  >
    {icon}
  </Pressable>
);

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
