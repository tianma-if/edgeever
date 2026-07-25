import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { File as ExpoFile } from "expo-file-system";
import type { MemoFilterMode, MemoSortMode } from "@edgeever/client";
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Copy,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Folder,
  Grid,
  HardDrive,
  History,
  Home,
  Image as ImageIcon,
  Info,
  KeyRound,
  List,
  LogOut,
  Merge,
  MessageSquare,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Upload,
  UserRound,
  Users,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "../components/icons";
import {
  ActivityIndicator,
  BackHandler,
  AppState,
  type AppStateStatus,
  FlatList,
  Image as RNImage,
  type ImageStyle,
  InteractionManager,
  type LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  RefreshControl,
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
import Animated, { FadeInDown, FadeOutUp, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Pressable, Text, TextInput } from "../components/LocalizedText";
import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display";
import { SvgXml } from "react-native-svg";
import { buildGitHubFeedbackUrl, buildRevisionDiffRows, createExcerpt, docToMarkdown, docToText, getNotebookDescendantIds, markdownToDoc, resolveMemoContentDoc, type ApiToken, type AuthUser, type MemoDetail, type MemoRevision, type MemoSummary, type Notebook, type ResourceListItem, type RevisionDiffRow, type TagSummary, type TiptapDoc } from "@edgeever/shared";
import { MOBILE_UI_METRICS, getMobileCenteredScrollOffset, getMobileNotebookSearchVisibleIds, toggleMobileMemoFilterMode, toggleMobileMemoSelection } from "@edgeever/shared/mobile-ui";
import { clearMobileMemoDraft, clearMobileNewMemoDraft, readMobileMemoDraft, readMobileNewMemoDraft, writeMobileMemoDraft, writeMobileNewMemoDraft, type MobileMemoDraft } from "../lib/mobile-drafts";
import {
  readMobileImageCompressionEnabled,
  readMobileMemoListDensity,
  readMobileResourceLayout,
  writeMobileImageCompressionEnabled,
  writeMobileMemoListDensity,
  writeMobileResourceLayout,
  type MobileLocalePreference,
  type MobileMemoListDensity,
  type MobileResourceLayoutPreference,
} from "../lib/preferences";
import { useMobileLocale } from "../lib/mobile-locale";
import { useSession } from "../lib/session";
import {
  getMobileSyncRetryDelay,
  listMobileSyncQueueItems,
  loadMobileSyncQueueSummary,
  queueMobileMemoCreate,
  queueMobileMemoUpdate,
  syncMobileQueuedChanges,
} from "../lib/sync-queue";
import {
  createMobileDataScope,
  getLocalMemo,
  isMobileLocalMirrorInitialized,
  listLocalMemos,
  listLocalNotebooks,
  replaceLocalMemoId,
  resolveLocalMemo,
  syncMobileLocalMirror,
  upsertLocalMemo,
  type MobileBootstrapProgress,
} from "../lib/local-mirror";
import { AccountSecurityPanel } from "./AccountSecurityModal";
import { beginEditorStartup, markStartup, recordEditorStartup } from "../lib/startup-performance";
import { prepareUploadAsset } from "../lib/mobile-image-upload";
import EditorRuntimePrewarm from "../components/EditorRuntimePrewarm";
import { showEdgeEverKeyboard } from "../../modules/edgeever-keyboard";
import LocalTiptapEditor, { type LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { resolveMobileThemeStyles, useMobileTheme, type MobileResolvedTheme } from "../lib/mobile-theme";
import { MobileUpdateCard } from "../components/MobileUpdateCard";
import { MobileMermaidDiagram, MobileMermaidProvider } from "../components/MobileMermaid";
import { getMobileMarkdownFenceLanguage, trimMobileMarkdownFenceContent } from "../lib/mobile-mermaid";

const ALL_NOTES_ID = "all";
const DEFAULT_MEMO_TITLE = "无标题笔记";
const resolveEditableMemoTitle = (title?: string | null) => {
  const trimmedTitle = title?.trim() ?? "";
  return trimmedTitle === DEFAULT_MEMO_TITLE ? "" : trimmedTitle;
};
const MOBILE_APP_VERSION = Constants.expoConfig?.version ?? "0.1.2";
const GITHUB_REPOSITORY_URL = "https://github.com/tianma-if/edgeever";
const ANDROID_SYSTEM_NAVIGATION_FALLBACK = 48;
const DETAIL_CONTENT_HORIZONTAL_PADDING = 16;
const DETAIL_TABLE_FIT_COLUMN_COUNT = 3;
const DETAIL_TABLE_MIN_COLUMN_WIDTH = 132;

const formatExecutionEnvironment = (environment: string | null | undefined, localePreference: MobileLocaleMode = "system") => {
  const english = isEnglishMobileLocale(localePreference);

  switch (environment) {
    case "standalone":
      return english ? "Standalone app" : "独立安装包";
    case "storeClient":
      return english ? "Expo Go / development client" : "Expo Go / 开发客户端";
    case "bare":
      return "Bare React Native";
    default:
      return environment || getMobileSystemInfoText(localePreference).unknown;
  }
};
const ALL_TOKEN_SCOPES = [
  "read:notebooks",
  "write:notebooks",
  "read:memos",
  "write:memos",
  "read:resources",
  "write:resources",
  "read:tags",
  "write:tags",
];
const ADVANCED_PROMPTS_ZH = [
  {
    id: "persona",
    title: "人物画像",
    prompt:
      "请通过 EdgeEver MCP 读取我的笔记，基于真实笔记内容为我整理一份人物画像。请只根据笔记中的证据判断，不要做心理诊断，不要夸张定性。输出包括：长期关注的主题、做事偏好、能力线索、反复出现的问题、近期动向，并在每条结论后列出相关笔记标题或 memo id。",
  },
  {
    id: "knowledgeMap",
    title: "知识图谱",
    prompt:
      "请通过 EdgeEver MCP 读取我的笔记，为我整理一份知识地图。请找出主要知识领域、每个领域下的关键概念、相关笔记、我已经掌握的部分和还需要补齐的问题。输出结构要适合后续继续学习和写作。",
  },
  {
    id: "tagAdvice",
    title: "标签建议",
    prompt:
      "请通过 EdgeEver MCP 读取我的笔记和现有标签，帮我设计一套更清晰的标签体系。请指出重复、过细、过宽或命名不一致的标签，并给出合并、重命名和新增标签建议。先不要修改笔记，等我确认后再执行。",
  },
];
const ADVANCED_PROMPTS_EN = [
  {
    id: "persona",
    title: "Persona profile",
    prompt:
      "Use EdgeEver MCP to read my notes and create a persona profile based on the real note content. Judge only from evidence in the notes, do not make psychological diagnoses, and do not exaggerate traits. Include long-term themes, work preferences, capability signals, recurring problems, recent direction, and list related note titles or memo ids after each conclusion.",
  },
  {
    id: "knowledgeMap",
    title: "Knowledge map",
    prompt:
      "Use EdgeEver MCP to read my notes and organize a knowledge map. Identify the main knowledge areas, key concepts in each area, related notes, what I already understand, and the gaps I still need to fill. Structure the output so it is useful for continued learning and writing.",
  },
  {
    id: "tagAdvice",
    title: "Tag suggestions",
    prompt:
      "Use EdgeEver MCP to read my notes and existing tags, then design a clearer tag system. Point out duplicate, overly narrow, overly broad, or inconsistently named tags, and suggest merges, renames, and new tags. Do not modify notes yet. Wait for my confirmation before applying changes.",
  },
];
const MOBILE_LOCALE_OPTIONS: Array<{ label: string; value: MobileLocalePreference }> = [
  { label: "跟随系统", value: "system" },
  { label: "简体中文", value: "zh-CN" },
  { label: "English", value: "en-US" },
];
type MobileView = "notes" | "settings";
type SettingsTab = "general" | "users" | "ai" | "account";
type MemoView = "notebook" | "trash";
type NotebookOption = {
  notebook: Notebook;
  depth: number;
};
type MobileLocaleMode = MobileLocalePreference;
const useMobileLocalePreference = () => useMobileLocale().preference;
type MobileMemoUpdatePayload = {
  title?: string;
  contentJson?: TiptapDoc;
  contentMarkdown?: string;
  isPinned?: boolean;
  notebookId?: string;
  tags?: string[];
};
type RichEditingSession = {
  draft: MobileMemoDraft | null;
  memo: MemoDetail;
};
type MobileMemoUpdateMutation = UseMutationResult<MemoDetail, Error, { memo: MemoDetail; payload: MobileMemoUpdatePayload }>;

export const WorkspaceScreen = () => {
  const { resolvedTheme } = useMobileTheme();
  const { preference: localePreference, setPreference: setLocalePreference } = useMobileLocale();
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
  const [notesActionsOpen, setNotesActionsOpen] = useState(false);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [richEditingSession, setRichEditingSession] = useState<RichEditingSession | null>(null);
  const [editorRuntimeWarm, setEditorRuntimeWarm] = useState(false);
  const [tagsManagerOpen, setTagsManagerOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [resourceTargetMemo, setResourceTargetMemo] = useState<MemoDetail | null>(null);
  const [apiTokensOpen, setApiTokensOpen] = useState(false);
  const [revisionMemo, setRevisionMemo] = useState<MemoDetail | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(() => new Set());
  const [selectionMoveOpen, setSelectionMoveOpen] = useState(false);
  const [selectionMoreOpen, setSelectionMoreOpen] = useState(false);
  const [isInitialMirrorStatusPending, setIsInitialMirrorStatusPending] = useState(true);
  const [initialMirrorSyncProgress, setInitialMirrorSyncProgress] = useState<MobileBootstrapProgress | null>(null);
  const [initialMirrorSyncError, setInitialMirrorSyncError] = useState<unknown>(null);
  const [mirrorSyncAttempt, setMirrorSyncAttempt] = useState(0);
  const autoSyncRunningRef = useRef(false);
  const autoSyncRequestedRef = useRef(false);
  const autoSyncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoDraftPrefetchRef = useRef(new Map<string, Promise<MobileMemoDraft | null>>());
  const debouncedSearchText = useDebouncedValue(searchText.trim(), 250);

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
    if (!notebooksQuery.data || !memosQuery.data || editorRuntimeWarm) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      // Keep first-screen work isolated from Chromium/WebKit startup. A short
      // idle window is still early enough to finish before a normal edit flow.
      timeout = setTimeout(() => setEditorRuntimeWarm(true), 600);
    });

    return () => {
      task.cancel();
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [editorRuntimeWarm, memosQuery.data, notebooksQuery.data]);

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
    beginEditorStartup();
    const draft = await loadMemoDraft(memo.id);
    memoDraftPrefetchRef.current.delete(memo.id);
    setRichEditingSession({ draft, memo });
  }, [loadMemoDraft]);

  const memos = useMemo(() => memosQuery.data?.pages.flatMap((page) => page.memos) ?? [], [memosQuery.data]);
  const searchResults = useMemo(() => searchQuery.data?.pages.flatMap((page) => page.memos) ?? [], [searchQuery.data]);
  const searchActive = searchText.trim().length > 0;
  const visibleMemos = searchActive ? searchResults : memos;
  const selectedMemo = memoDetailQuery.data?.memo ?? null;
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
  const openCreateMemo = () => {
    beginEditorStartup();
    setCreateOpen(true);
  };

  useEffect(() => {
    if (selectedMemo && !selectedMemo.isDeleted) {
      void loadMemoDraft(selectedMemo.id);
    }
  }, [loadMemoDraft, selectedMemo]);

  useEffect(() => {
    setResourceTargetMemo(null);
  }, [dataScope]);

  useEffect(() => {
    if (selectedMemo && !selectedMemo.isDeleted) {
      setResourceTargetMemo(selectedMemo);
    }
  }, [selectedMemo]);

  useEffect(() => {
    if (!resourcesOpen || selectedMemo || resourceTargetMemo) {
      return;
    }

    const fallbackMemo = visibleMemos.find((memo) => !memo.isDeleted);
    if (!fallbackMemo) {
      return;
    }

    let mounted = true;
    void getLocalMemo(dataScope, fallbackMemo.id).then((memo) => {
      if (mounted && memo && !memo.isDeleted) {
        setResourceTargetMemo(memo);
      }
    });

    return () => {
      mounted = false;
    };
  }, [dataScope, resourceTargetMemo, resourcesOpen, selectedMemo, visibleMemos]);

  useEffect(() => {
    clearSelection();
  }, [activeNotebookId, memoFilterMode, memoSortMode, memoView]);

  useEffect(() => {
    let mounted = true;

    listMobileSyncQueueItems(syncQueueScope).then((items) => {
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
  }, [queryClient, syncQueueScope]);

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

      await queueMobileMemoUpdate(syncQueueScope, {
        memoId: syncBaseMemo.id,
        expectedRevision: syncBaseMemo.revision,
        expectedContentHash: syncBaseMemo.contentHash,
        title: optimisticMemo.title?.trim() || DEFAULT_MEMO_TITLE,
        contentMarkdown: optimisticMemo.contentMarkdown,
        notebookId: optimisticMemo.notebookId,
        tags: optimisticMemo.tags,
      });

      return optimisticMemo;
    },
    onSuccess: async (memo, variables) => {
      await upsertLocalMemo(dataScope, memo);
      applyOptimisticMemoToCache(queryClient, variables.memo, memo);
      void runAutomaticSync();
    },
  });

  const deleteMemoMutation = useMutation({
    mutationFn: async ({ memo, permanent }: { memo: MemoDetail; permanent: boolean }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      await client.deleteMemo(memo.id, { permanent });
      return { memo, permanent };
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      setRichEditingSession(null);
      setSelectedMemoId(null);
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
    mutationFn: async ({ memoIds, permanent }: { memoIds: string[]; permanent: boolean }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return client.deleteMemos({ memoIds, permanent });
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      clearSelection();
    },
  });

  const mergeMemosMutation = useMutation({
    mutationFn: async ({ memoIds, notebookId }: { memoIds: string[]; notebookId?: string }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      const response = await client.mergeMemos({ memoIds, notebookId });
      return response.memo;
    },
    onSuccess: async (memo) => {
      await invalidateWorkspace();
      clearSelection();
      setSelectedMemoId(memo.id);
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

  const handleMergeSelection = () => {
    if (selectedMemoIdList.length < 2) {
      return;
    }

    const targetNotebookId = activeNotebookId === ALL_NOTES_ID ? selectedMemos[0]?.notebookId : activeNotebookId;

    mergeMemosMutation.mutate({ memoIds: selectedMemoIdList, notebookId: targetNotebookId });
  };

  const runAutomaticSync = async () => {
    if (!client) {
      return;
    }

    if (autoSyncRunningRef.current) {
      autoSyncRequestedRef.current = true;
      return;
    }

    if (autoSyncRetryTimerRef.current) {
      clearTimeout(autoSyncRetryTimerRef.current);
      autoSyncRetryTimerRef.current = null;
    }

    autoSyncRunningRef.current = true;

    const summary = await loadMobileSyncQueueSummary(syncQueueScope);
    if (summary.pending + summary.error + summary.syncing === 0) {
      autoSyncRunningRef.current = false;
      return;
    }

    try {
      await syncMobileQueuedChanges(client, syncQueueScope, {
        onSynced: async (memo, item) => {
          if (item.kind === "memo.create") {
            await replaceLocalMemoId(dataScope, item.memoId, memo);
            setSelectedMemoId((current) => current === item.memoId ? memo.id : current);
          } else {
            await upsertLocalMemo(dataScope, memo);
          }
          queryClient.setQueryData(["mobile", "memo", "notebook", memo.id], { memo });
          queryClient.setQueryData(["mobile", "memo", "trash", memo.id], { memo });
        },
      });
      const nextSummary = await loadMobileSyncQueueSummary(syncQueueScope);
      if (nextSummary.total === 0) {
        await invalidateWorkspace();
      }
    } catch {
      // The queue keeps its retry metadata; the next scheduled pass resumes it.
    } finally {
      autoSyncRunningRef.current = false;
      if (autoSyncRequestedRef.current) {
        autoSyncRequestedRef.current = false;
        void runAutomaticSync();
      } else {
        const retryDelay = await getMobileSyncRetryDelay(syncQueueScope);
        if (retryDelay !== null) {
          autoSyncRetryTimerRef.current = setTimeout(() => {
            autoSyncRetryTimerRef.current = null;
            void runAutomaticSync();
          }, retryDelay);
        }
      }
    }
  };

  useEffect(() => {
    if (!client) {
      return;
    }

    void runAutomaticSync();

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void runAutomaticSync();
      }
    });

    return () => {
      subscription.remove();
      if (autoSyncRetryTimerRef.current) {
        clearTimeout(autoSyncRetryTimerRef.current);
        autoSyncRetryTimerRef.current = null;
      }
    };
  }, [client, syncQueueScope]);

  useEffect(() => {
    if (!client) {
      return;
    }
    let active = true;
    const syncMirror = async () => {
      let isInitialSync = false;
      let refreshedNotebooksDuringBootstrap = false;
      try {
        isInitialSync = !(await isMobileLocalMirrorInitialized(dataScope));
        if (active) {
          setIsInitialMirrorStatusPending(false);
          setInitialMirrorSyncError(null);
          setInitialMirrorSyncProgress(isInitialSync ? { loadedCount: 0, totalCount: 0 } : null);
        }
        await syncMobileLocalMirror(client, dataScope, {
          onBootstrapProgress: isInitialSync ? async (progress) => {
            if (!active) {
              return;
            }
            setInitialMirrorSyncProgress(progress);
            const invalidations = [
              queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
              queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
            ];
            if (!refreshedNotebooksDuringBootstrap) {
              refreshedNotebooksDuringBootstrap = true;
              invalidations.push(queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }));
            }
            await Promise.all(invalidations);
          } : undefined,
        });
        if (active) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }),
            queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
            queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
          ]);
          setInitialMirrorSyncProgress(null);
        }
      } catch (error) {
        if (active && isInitialSync) {
          setInitialMirrorSyncProgress(null);
          setInitialMirrorSyncError(error);
        }
        // An initialized local mirror remains readable while the device is offline.
      }
    };
    void syncMirror();
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void syncMirror();
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [client, dataScope, mirrorSyncAttempt, queryClient]);

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
          onCreate={openCreateMemo}
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
          onRetry={() => {
            setIsInitialMirrorStatusPending(true);
            setInitialMirrorSyncError(null);
            setMirrorSyncAttempt((attempt) => attempt + 1);
          }}
        />
      ) : null}

      {activeView === "settings" ? (
        <SettingsView
          baseUrl={session?.baseUrl ?? ""}
          currentUser={session?.user ?? null}
          onClose={closeSettings}
          localePreference={localePreference}
          onLocalePreferenceChange={handleLocalePreferenceChange}
          imageCompressionEnabled={imageCompressionEnabled}
          isOwner={session?.user?.role === "owner"}
          onImageCompressionChange={handleImageCompressionChange}
          onSignOut={signOut}
        />
      ) : null}

      <MemoDetailModal
        isDeleting={deleteMemoMutation.isPending}
        isLoading={memoDetailQuery.isLoading}
        isRestoring={restoreMemoMutation.isPending}
        isSaving={updateMemoMutation.isPending}
        memo={selectedMemo}
        notebookName={notebooks.find((notebook) => notebook.id === selectedMemo?.notebookId)?.name ?? "未分类"}
        onClose={closeDetail}
        onDelete={handleDeleteMemo}
        onRichEdit={(memo) => void openRichEditor(memo)}
        onOpenRevisions={setRevisionMemo}
        onRestore={(memo) => restoreMemoMutation.mutate(memo)}
        visible={Boolean(selectedMemoId)}
      />

      {editorRuntimeWarm ? (
        <EditorRuntimePrewarm
          dom={{
            bounces: false,
            containerStyle: styles.editorRuntimePrewarm,
            scrollEnabled: false,
            style: styles.editorRuntimePrewarm,
          }}
        />
      ) : null}
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

      {tagsManagerOpen ? <TagsManagerModal onClose={() => setTagsManagerOpen(false)} visible /> : null}
      {resourcesOpen ? <ResourcesModal activeMemo={selectedMemo ?? resourceTargetMemo} imageCompressionEnabled={imageCompressionEnabled} onClose={() => setResourcesOpen(false)} visible /> : null}
      {apiTokensOpen ? <ApiTokensModal baseUrl={session?.baseUrl ?? ""} onClose={() => setApiTokensOpen(false)} visible /> : null}
      {revisionMemo ? <RevisionHistoryModal
        memo={revisionMemo}
        onClose={() => setRevisionMemo(null)}
        onRestored={(memo) => {
          setRevisionMemo(null);
          setSelectedMemoId(memo.id);
        }}
      /> : null}

      <CreateMemoModal
        baseUrl={session?.baseUrl ?? ""}
        dataScope={dataScope}
        defaultNotebookId={createMemoNotebookId}
        imageCompressionEnabled={imageCompressionEnabled}
        notebooks={notebooks}
        onCreated={() => {
          setCreateOpen(false);
          setActiveView("notes");
          setMemoView("notebook");
          setSelectedMemoId(null);
        }}
        onQueued={runAutomaticSync}
        syncQueueScope={syncQueueScope}
        visible={createOpen}
      />

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
        onOpenApiTokens={() => {
          setNotesActionsOpen(false);
          setApiTokensOpen(true);
        }}
        onOpenResources={() => {
          setNotesActionsOpen(false);
          setResourcesOpen(true);
        }}
        onOpenTags={() => {
          setNotesActionsOpen(false);
          setTagsManagerOpen(true);
        }}
        onMemoListDensityChange={handleMemoListDensityChange}
        onSortModeChange={setMemoSortMode}
        selectionMode={selectionMode}
        visible
      /> : null}

      {selectionMoreOpen ? <SelectionMoreModal
        bottomOffset={58 + safeAreaInsets.bottom}
        canMerge={memoView !== "trash" && selectedMemoIds.size >= 2 && !mergeMemosMutation.isPending}
        canPin={memoView !== "trash" && selectedMemoIds.size > 0 && !pinMemosMutation.isPending}
        canToggleVisibleSelection={canToggleVisibleSelection}
        onClear={clearSelection}
        onClose={() => setSelectionMoreOpen(false)}
        onMerge={() => {
          setSelectionMoreOpen(false);
          handleMergeSelection();
        }}
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
          isBusy={deleteMemosMutation.isPending || moveMemosMutation.isPending || pinMemosMutation.isPending || mergeMemosMutation.isPending}
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
          onPress={openCreateMemo}
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

const NotesView = ({
  activeNotebook,
  error,
  initialSyncProgress,
  isError,
  isLoading,
  isLoadingMore,
  isRefreshing,
  memoFilterMode,
  memoListDensity,
  memoView,
  memos,
  notebooks,
  onCreate,
  onClearSelection,
  onFilterModeChange,
  onOpenActions,
  onOpenNotebookPicker,
  onMemoLongPress,
  onMemoPress,
  onLoadMore,
  onRefresh,
  onRetry,
  onSearchTextChange,
  onSetMemoView,
  searchText,
  totalMemoCount,
  selectedMemoIds,
  selectionMode,
}: {
  activeNotebook: Notebook | null;
  error: unknown;
  initialSyncProgress: MobileBootstrapProgress | null;
  isError: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  memoFilterMode: MemoFilterMode;
  memoListDensity: MobileMemoListDensity;
  memoView: MemoView;
  memos: MemoSummary[];
  notebooks: Notebook[];
  onCreate: () => void;
  onClearSelection: () => void;
  onFilterModeChange: (filterMode: MemoFilterMode) => void;
  onOpenActions: () => void;
  onOpenNotebookPicker: () => void;
  onMemoLongPress: (memo: MemoSummary) => void;
  onMemoPress: (memoId: string) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onSearchTextChange: (value: string) => void;
  onSetMemoView: (memoView: MemoView) => void;
  searchText: string;
  totalMemoCount: number;
  selectionMode: boolean;
  selectedMemoIds: Set<string>;
}) => {
  const { resolvedTheme } = useMobileTheme();
  const localePreference = useMobileLocalePreference();
  const searchActive = searchText.trim().length > 0;
  const filterActive = memoFilterMode !== "all";
  const englishLocale = isEnglishMobileLocale(localePreference);
  const searchStatusLabel = englishLocale ? "Searching" : "正在搜索";
  const searchResultLabel = englishLocale ? `${totalMemoCount} ${totalMemoCount === 1 ? "result" : "results"}` : `${totalMemoCount} 条结果`;
  const exitSearchLabel = englishLocale ? "Exit search" : "退出搜索";
  const activeFilterLabel = memoFilterMode === "pinned"
    ? (englishLocale ? "Pinned" : "置顶")
    : memoFilterMode === "tagged"
      ? (englishLocale ? "Tagged" : "有标签")
      : (englishLocale ? "Untagged" : "无标签");
  const filterResultLabel = englishLocale
    ? `Filter: ${activeFilterLabel} · ${totalMemoCount} ${totalMemoCount === 1 ? "note" : "notes"}`
    : `筛选：${activeFilterLabel} · ${totalMemoCount} 条`;
  const resetFilterLabel = englishLocale ? "Reset" : "重置";

  return (
    <View style={styles.viewBody}>
      <View style={styles.mobileListHeader}>
        {selectionMode ? (
          <View style={styles.mobileSelectionHeader}>
            <Pressable accessibilityLabel="取消选择" accessibilityRole="button" onPress={onClearSelection} style={styles.mobileSelectionClose}>
              <X color="#64748b" size={19} />
            </Pressable>
            <Text style={styles.mobileSelectionTitle}>{selectedMemoIds.size > 0 ? `已选择 ${selectedMemoIds.size} 条` : "选择笔记"}</Text>
            <View style={styles.iconButtonPlaceholder} />
          </View>
        ) : null}
        <View style={styles.mobileListTitleRow}>
          <Pressable
            accessibilityLabel={memoView === "trash" ? "返回笔记列表" : "切换笔记本"}
            accessibilityRole="button"
            onPress={memoView === "trash" ? () => onSetMemoView("notebook") : onOpenNotebookPicker}
            style={styles.mobileNotebookTitleButton}
          >
            {memoView === "trash" ? <ChevronLeft color="#475569" size={18} /> : null}
            <Text numberOfLines={1} style={styles.mobileNotebookTitle}>
              {memoView === "trash" ? "回收站" : activeNotebook?.name ?? "全部笔记"}
            </Text>
            {memoView === "notebook" ? <ChevronDown color="#64748b" size={16} /> : null}
          </Pressable>
          <Pressable accessibilityLabel={selectionMode ? "批量操作" : "列表选项"} accessibilityRole="button" onPress={onOpenActions} style={styles.mobileMoreButton}>
            <MoreHorizontal color="#475569" size={20} />
          </Pressable>
        </View>

        <>
          <View style={styles.mobileSearchRow}>
              <View style={[styles.mobileSearchButton, searchActive && styles.mobileSearchButtonActive, searchActive && resolvedTheme === "dark" && styles.mobileSearchButtonActiveDark]}>
                <Search color={searchActive && resolvedTheme === "dark" ? "rgb(5, 150, 105)" : searchActive ? "#059669" : "#64748b"} size={17} />
                <TextInput
                  accessibilityLabel="搜索笔记"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={onSearchTextChange}
                  placeholder="搜索笔记"
                  placeholderTextColor="#94a3b8"
                  returnKeyType="search"
                  style={[styles.mobileSearchInput, searchActive && resolvedTheme === "dark" && styles.mobileSearchInputActiveDark]}
                  value={searchText}
                />
                {searchText ? (
                  <Pressable accessibilityLabel="清空搜索" accessibilityRole="button" onPress={() => onSearchTextChange("")} style={styles.mobileSearchClearButton}>
                    <X color={resolvedTheme === "dark" ? "rgb(100, 116, 139)" : "#64748b"} size={14} />
                  </Pressable>
                ) : null}
              </View>
              <MobileFilterButton
                active={memoFilterMode === "pinned"}
                icon={<Sparkles color={memoFilterMode === "pinned" ? "#ffffff" : "#475569"} size={18} />}
                label="置顶"
                onPress={() => onFilterModeChange(toggleMobileMemoFilterMode(memoFilterMode, "pinned"))}
              />
              <MobileFilterButton
                active={memoFilterMode === "tagged"}
                icon={<Tag color={memoFilterMode === "tagged" ? "#ffffff" : "#475569"} size={18} />}
                label="有标签"
                onPress={() => onFilterModeChange(toggleMobileMemoFilterMode(memoFilterMode, "tagged"))}
              />
              <MobileFilterButton
                active={memoFilterMode === "untagged"}
                icon={<Tag color={memoFilterMode === "untagged" ? "#ffffff" : "#475569"} size={18} />}
                label="无标签"
                onPress={() => onFilterModeChange(toggleMobileMemoFilterMode(memoFilterMode, "untagged"))}
              />
          </View>
          {searchActive || filterActive ? (
            <View accessibilityLiveRegion="polite" style={[styles.mobileListConstraint, !searchActive && styles.mobileListConstraintFilter]}>
              {searchActive ? (
                <View style={styles.mobileSearchStatusPill}>
                  <Search color="#ffffff" size={12} />
                  <Text style={styles.mobileSearchStatusPillText}>{searchStatusLabel}</Text>
                </View>
              ) : null}
              <Text numberOfLines={1} style={[styles.mobileListConstraintText, !searchActive && styles.mobileListConstraintTextFilter]}>
                {searchActive ? searchResultLabel : filterResultLabel}
              </Text>
              <Pressable
                accessibilityLabel={searchActive ? exitSearchLabel : resetFilterLabel}
                accessibilityRole="button"
                onPress={searchActive ? () => onSearchTextChange("") : () => onFilterModeChange("all")}
              >
                <Text style={[styles.mobileListConstraintAction, !searchActive && styles.mobileListConstraintActionFilter]}>
                  {searchActive ? exitSearchLabel : resetFilterLabel}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      </View>

    <MemoList
      emptyAction={memoView === "notebook" && notebooks.length > 0 ? { label: "新建笔记", onPress: onCreate } : undefined}
      emptyDescription={searchActive ? "换个关键词再试" : memoFilterMode !== "all" ? "试试切换筛选条件，或调整搜索关键词。" : memoView === "trash" ? "删除的笔记会显示在这里。" : "先创建一条笔记，之后可以在这里快速预览、搜索和批量整理。"}
      emptyTitle={searchActive ? "没有找到匹配笔记" : memoFilterMode !== "all" ? "没有符合筛选的笔记" : memoView === "trash" ? "回收站为空" : "暂无笔记"}
      error={error}
      initialSyncProgress={initialSyncProgress}
      isError={isError}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      isRefreshing={isRefreshing}
      listDensity={memoListDensity}
      memos={memos}
      onMemoLongPress={onMemoLongPress}
      onMemoPress={onMemoPress}
      onLoadMore={onLoadMore}
      onRefresh={onRefresh}
      onRetry={onRetry}
      selectionMode={selectionMode}
      selectedMemoIds={selectedMemoIds}
    />
    </View>
  );
};

const NotesActionsModal = ({
  bottomOffset,
  canEnterSelection,
  listDescription,
  listTitle,
  memoListDensity,
  memoSortMode,
  onClose,
  onEnterSelection,
  onMemoListDensityChange,
  onOpenApiTokens,
  onOpenResources,
  onOpenTags,
  onSortModeChange,
  selectionMode,
  visible,
}: {
  bottomOffset: number;
  canEnterSelection: boolean;
  listDescription: string;
  listTitle: string;
  memoListDensity: MobileMemoListDensity;
  memoSortMode: MemoSortMode;
  onClose: () => void;
  onEnterSelection: () => void;
  onMemoListDensityChange: (density: MobileMemoListDensity) => void;
  onOpenApiTokens: () => void;
  onOpenResources: () => void;
  onOpenTags: () => void;
  onSortModeChange: (sortMode: MemoSortMode) => void;
  selectionMode: boolean;
  visible: boolean;
}) => (
  <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
    <Pressable onPress={onClose} style={[styles.actionSheetBackdrop, { paddingBottom: bottomOffset }]}>
      <Pressable style={styles.listActionSheet}>
        <View style={styles.actionSheetHandle} />
        <View style={styles.listActionSheetHeader}>
          <View style={styles.listActionSheetHeaderText}>
            <Text numberOfLines={1} style={styles.actionSheetTitle}>列表选项</Text>
            <Text numberOfLines={1} style={styles.actionSheetSubtitle}>{listTitle} · {listDescription}</Text>
          </View>
          <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
            <X color="#0f172a" size={18} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.listActionSheetContent} style={styles.listActionSheetScroll}>
          {!selectionMode ? (
            <>
              <ActionSheetItem compact disabled={!canEnterSelection} icon={<CheckSquare color="#0f172a" size={18} />} label="选择笔记" onPress={onEnterSelection} />
              <View style={styles.listActionDivider} />
            </>
          ) : null}
          <Text style={styles.actionSheetSectionTitle}>显示方式</Text>
          <SheetOptionRow
            active={memoListDensity === "preview"}
            icon={<FileText color={memoListDensity === "preview" ? "#10b981" : "#64748b"} size={18} />}
            label="预览列表"
            onPress={() => onMemoListDensityChange("preview")}
          />
          <SheetOptionRow
            active={memoListDensity === "compact"}
            icon={<List color={memoListDensity === "compact" ? "#10b981" : "#64748b"} size={18} />}
            label="紧凑列表"
            onPress={() => onMemoListDensityChange("compact")}
          />
          <View style={styles.listActionDivider} />
          <Text style={styles.actionSheetSectionTitle}>排序方式</Text>
          <SheetOptionRow active={memoSortMode === "updated-desc"} label="最近更新" onPress={() => onSortModeChange("updated-desc")} />
          <SheetOptionRow active={memoSortMode === "created-desc"} label="创建时间" onPress={() => onSortModeChange("created-desc")} />
          <SheetOptionRow active={memoSortMode === "title-asc"} label="标题 A-Z" onPress={() => onSortModeChange("title-asc")} />
          <View style={styles.listActionDivider} />
          <ActionSheetItem compact icon={<Tag color="#0f172a" size={18} />} label="标签" onPress={onOpenTags} />
          <ActionSheetItem compact icon={<Archive color="#0f172a" size={18} />} label="附件" onPress={onOpenResources} />
          <ActionSheetItem compact icon={<KeyRound color="#0f172a" size={18} />} label="MCP Token" onPress={onOpenApiTokens} />
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>
);

const SheetOptionRow = ({ active, icon, label, onPress }: { active: boolean; icon?: ReactNode; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={[styles.sheetOptionRow, active && styles.sheetOptionRowActive]}>
    {icon ? <View style={styles.sheetOptionIcon}>{icon}</View> : null}
    <Text style={[styles.sheetOptionLabel, active && styles.sheetOptionLabelActive]}>{label}</Text>
    <View style={[styles.sheetOptionCheck, !active && styles.sheetOptionCheckHidden]}>
      <Check color="#ffffff" size={13} />
    </View>
  </Pressable>
);

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

const ActionSheetItem = ({ compact = false, danger = false, disabled = false, icon, label, onPress }: { compact?: boolean; danger?: boolean; disabled?: boolean; icon: ReactNode; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionSheetItem, compact && styles.actionSheetItemCompact, disabled && styles.buttonDisabled]}>
    {icon}
    <Text style={[styles.actionSheetItemText, compact && styles.actionSheetItemTextCompact, danger && styles.actionSheetItemTextDanger]}>{label}</Text>
  </Pressable>
);

const AccountInfoCopyRow = ({ instance, userName }: { instance: string; userName: string }) => {
  const [copied, setCopied] = useState(false);

  const copyAccountInfo = async () => {
    const accountInfo = [
      `当前用户: ${userName}`,
      `实例地址: ${instance || "未连接"}`,
      `移动端版本: v${MOBILE_APP_VERSION}`,
      `GitHub 仓库: ${GITHUB_REPOSITORY_URL}`,
    ].join("\n");

    await Clipboard.setStringAsync(accountInfo);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Pressable accessibilityRole="button" onPress={copyAccountInfo} style={[styles.panelRow, styles.panelLinkRow]}>
      <View style={styles.panelLinkText}>
        <Text style={styles.panelLabel}>账户信息</Text>
        <Text style={styles.panelValue}>{copied ? "已复制" : "复制当前连接信息"}</Text>
      </View>
      {copied ? <ShieldCheck color="#047857" size={18} /> : <Copy color="#0f172a" size={18} />}
    </Pressable>
  );
};

const SettingsView = ({
  baseUrl,
  currentUser,
  imageCompressionEnabled,
  isOwner,
  localePreference,
  onClose,
  onImageCompressionChange,
  onLocalePreferenceChange,
  onSignOut,
}: {
  baseUrl: string;
  currentUser: AuthUser | null;
  imageCompressionEnabled: boolean;
  isOwner: boolean;
  localePreference: MobileLocaleMode;
  onClose: () => void;
  onImageCompressionChange: (enabled: boolean) => void;
  onLocalePreferenceChange: (locale: MobileLocaleMode) => void;
  onSignOut: () => void;
}) => {
  const { resolvedTheme, toggleTheme } = useMobileTheme();
  const { translate } = useMobileLocale();
  const [activeTab, setActiveTab] = useState<SettingsTab | null>(null);
  const [localePickerOpen, setLocalePickerOpen] = useState(false);
  const [localePickerAnchor, setLocalePickerAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const localeSelectRef = useRef<ComponentRef<typeof Pressable>>(null);
  const tabs: Array<{ key: SettingsTab; label: string; icon: ReactNode }> = [
    { key: "general", label: "常规设置", icon: <SlidersHorizontal color="#059669" size={17} /> },
    ...(isOwner ? [{ key: "users" as const, label: "成员管理", icon: <Users color="#059669" size={17} /> }] : []),
    { key: "ai", label: "AI集成", icon: <Sparkles color="#059669" size={17} /> },
    { key: "account", label: "登录设置", icon: <ShieldCheck color="#059669" size={17} /> },
  ];
  const title = tabs.find((tab) => tab.key === activeTab)?.label ?? "我的";
  const activeLocaleLabel = MOBILE_LOCALE_OPTIONS.find((option) => option.value === localePreference)?.label ?? "跟随系统";
  const openLocalePicker = () => {
    localeSelectRef.current?.measureInWindow((left, top, width, height) => {
      setLocalePickerAnchor({ left, top: top + height + 4, width });
      setLocalePickerOpen(true);
    });
  };
  const openFeedback = () => {
    void Linking.openURL(buildMobileFeedbackUrl(localePreference));
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (activeTab) {
        setActiveTab(null);
      } else {
        onClose();
      }
      return true;
    });

    return () => subscription.remove();
  }, [activeTab, onClose]);

  const renderContent = () => {
    if (activeTab === "general") {
      return (
        <View style={styles.settingsDetailList}>
          <SettingsGroup title="偏好设置" icon={<ImageIcon color="#047857" size={16} />}>
            <View style={styles.settingsContentRow}>
              <View style={styles.preferenceStack}>
                <View style={styles.preferenceText}>
                  <Text style={styles.settingsRowTitle}>界面语言</Text>
                  <Text style={styles.settingsRowDescription}>切换产品界面的显示语言。</Text>
                </View>
                <Pressable accessibilityLabel="界面语言" accessibilityRole="button" onPress={openLocalePicker} ref={localeSelectRef} style={styles.settingsSelect}>
                  <Text style={styles.settingsSelectText}>{activeLocaleLabel}</Text>
                  <ChevronDown color="#64748b" size={18} />
                </Pressable>
              </View>
            </View>
            <View style={styles.settingsContentRow}>
              <View style={styles.preferenceStack}>
                <View style={styles.preferenceText}>
                  <Text style={styles.settingsRowTitle}>压缩笔记内图片</Text>
                  <Text style={styles.settingsRowDescription}>上传大图时在本地压缩，节省资源占用。</Text>
                </View>
                <View style={styles.settingsSwitchStart}>
                  <Switch accessibilityLabel={translate("是否压缩笔记内图片")} onValueChange={onImageCompressionChange} value={imageCompressionEnabled} />
                </View>
              </View>
            </View>
            <MobileUpdateCard />
            <SystemInfoCard embedded />
          </SettingsGroup>
        </View>
      );
    }
    if (activeTab === "users") {
      return (
        <View style={styles.settingsGroup}>
          <AccountSecurityPanel active currentUser={currentUser} section="users" />
        </View>
      );
    }
    if (activeTab === "ai") {
      return (
        <View style={styles.settingsGroup}>
          <AdvancedPlayCard embedded />
          <ApiTokensContent active baseUrl={baseUrl} embedded />
        </View>
      );
    }
    return (
      <View style={styles.settingsDetailList}>
        <View style={styles.settingsGroup}>
          <AccountSecurityPanel active currentUser={currentUser} section="password" />
        </View>
        <View style={styles.settingsLogoutCard}>
          <Pressable onPress={onSignOut} style={styles.settingsLogoutButton}>
            <LogOut color="#ffffff" size={17} />
            <Text style={styles.settingsLogoutText}>退出登录</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.settingsScreen}>
      <View style={styles.settingsHeader}>
        <Pressable accessibilityLabel="返回" onPress={() => activeTab ? setActiveTab(null) : onClose()} style={styles.settingsBackButton}>
          <ChevronLeft color="#64748b" size={21} />
        </Pressable>
        <View style={styles.settingsHeaderTitle}>
          {activeTab ? tabs.find((tab) => tab.key === activeTab)?.icon : <UserRound color="#047857" size={17} />}
          <Text numberOfLines={1} style={styles.settingsTitle}>{title}</Text>
        </View>
        <Pressable
          accessibilityLabel={resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          accessibilityRole="button"
          onPress={toggleTheme}
          style={styles.settingsThemeButton}
        >
          {resolvedTheme === "dark" ? <Sun color="#64748b" size={19} /> : <Moon color="#64748b" size={19} />}
          <Text numberOfLines={1} style={styles.settingsThemeText}>{resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.settingsScrollContent} style={styles.viewBody}>
        {activeTab === null ? (
          <View style={styles.settingsDetailList}>
            <View style={styles.settingsMenu}>
              {tabs.map((tab, index) => (
                <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={[styles.settingsMenuRow, index > 0 && styles.settingsMenuRowBorder]}>
                  <View style={styles.settingsMenuLabel}>
                    <View style={styles.settingsMenuIcon}>{tab.icon}</View>
                    <Text style={styles.settingsMenuText}>{tab.label}</Text>
                  </View>
                  <ChevronRight color="#94a3b8" size={17} />
                </Pressable>
              ))}
            </View>
            <View style={styles.settingsMenu}>
              <Pressable accessibilityRole="link" onPress={openFeedback} style={styles.settingsMenuRow}>
                <View style={styles.settingsMenuLabel}>
                  <View style={[styles.settingsMenuIcon, styles.settingsFeedbackIcon]}><MessageSquare color="#64748b" size={17} /></View>
                  <View style={styles.settingsFeedbackCopy}>
                    <Text style={styles.settingsMenuText}>意见反馈</Text>
                    <Text style={styles.settingsFeedbackDescription}>报告问题或提出功能建议</Text>
                  </View>
                </View>
                <ExternalLink color="#94a3b8" size={17} />
              </Pressable>
            </View>
          </View>
        ) : renderContent()}
      </ScrollView>
      <Modal animationType="fade" onRequestClose={() => setLocalePickerOpen(false)} statusBarTranslucent transparent visible={localePickerOpen && Boolean(localePickerAnchor)}>
        <Pressable onPress={() => setLocalePickerOpen(false)} style={styles.localePickerBackdrop}>
          {localePickerAnchor ? (
            <View style={[styles.localePickerMenu, localePickerAnchor]}>
              {MOBILE_LOCALE_OPTIONS.map((option) => {
                const active = localePreference === option.value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    key={option.value}
                    onPress={() => {
                      onLocalePreferenceChange(option.value);
                      setLocalePickerOpen(false);
                    }}
                    style={[styles.localePickerOption, active && styles.localePickerOptionActive]}
                  >
                    <Text style={[styles.localePickerOptionText, active && styles.localePickerOptionTextActive]}>{option.label}</Text>
                    {active ? <Check color="#047857" size={16} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
};

const SettingsGroup = ({ children, icon, title }: { children: ReactNode; icon?: ReactNode; title?: string }) => (
  <View style={styles.settingsGroup}>
    {title ? <View style={styles.settingsGroupHeader}>{icon}<Text style={styles.settingsGroupTitle}>{title}</Text></View> : null}
    {children}
  </View>
);

const CreateMemoModal = ({
  baseUrl,
  dataScope,
  defaultNotebookId,
  imageCompressionEnabled,
  notebooks,
  onCreated,
  onQueued,
  syncQueueScope,
  visible,
}: {
  baseUrl: string;
  dataScope: string;
  defaultNotebookId: string;
  imageCompressionEnabled: boolean;
  notebooks: Notebook[];
  onCreated: (memo: MemoDetail) => void;
  onQueued: () => void | Promise<void>;
  syncQueueScope: string;
  visible: boolean;
}) => {
  const { client } = useSession();
  const queryClient = useQueryClient();
  const { resolvedLocale } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  const fallbackNotebookId = defaultNotebookId;
  const editorRef = useRef<LocalTiptapEditorRef>(null);
  const resourceDataUrlCacheRef = useRef(new Map<string, Promise<string | null>>());
  const contentJsonRef = useRef<TiptapDoc>(markdownToDoc(""));
  const contentMarkdownRef = useRef("");
  const draftVersionRef = useRef(0);
  const flushResolverRef = useRef<(() => void) | null>(null);
  const materializedMemoRef = useRef<MemoDetail | null>(null);
  const [notebookId, setNotebookId] = useState(fallbackNotebookId);
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [imageOperation, setImageOperation] = useState<"idle" | "creating" | "uploading">("idle");
  const targetNotebookId = notebookId || fallbackNotebookId;
  const selectedNotebookName = notebooks.find((notebook) => notebook.id === targetNotebookId)?.name ?? "选择笔记本";
  const titleRef = useRef(title);
  const tagsTextRef = useRef(tagsText);
  const targetNotebookIdRef = useRef(targetNotebookId);
  titleRef.current = title;
  tagsTextRef.current = tagsText;
  targetNotebookIdRef.current = targetNotebookId;

  useEffect(() => {
    if (!visible) {
      return;
    }
    let active = true;
    setDraftLoaded(false);
    setEditorReady(false);
    void readMobileNewMemoDraft(dataScope).then((draft) => {
      if (!active) {
        return;
      }
      const restoredNotebookId = draft && notebooks.some((notebook) => notebook.id === draft.notebookId)
        ? draft.notebookId
        : fallbackNotebookId;
      const markdown = draft?.contentMarkdown ?? "";
      contentMarkdownRef.current = markdown;
      contentJsonRef.current = markdownToDoc(markdown);
      draftVersionRef.current = 0;
      setTitle(draft?.title ?? "");
      setTagsText(draft?.tagsText ?? "");
      setContentMarkdown(markdown);
      setNotebookId(restoredNotebookId);
      setDirty(false);
      setDraftLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [fallbackNotebookId, visible]);

  useEffect(() => {
    if (!visible || !draftLoaded || !dirty) {
      return;
    }
    const draftVersion = draftVersionRef.current;
    const timeout = setTimeout(() => {
      const materializedMemo = materializedMemoRef.current;
      const writeDraft = materializedMemo
        ? writeMobileMemoDraft({
          memoId: materializedMemo.id,
          expectedRevision: materializedMemo.revision,
          title,
          contentMarkdown: contentMarkdownRef.current,
          notebookId: targetNotebookId,
          tagsText,
          updatedAt: new Date().toISOString(),
        })
        : writeMobileNewMemoDraft(dataScope, {
          title,
          contentMarkdown: contentMarkdownRef.current,
          notebookId: targetNotebookId,
          tagsText,
          updatedAt: new Date().toISOString(),
        });
      void writeDraft.then(() => {
        if (draftVersionRef.current === draftVersion) {
          setDirty(false);
        }
      });
    }, 350);
    return () => clearTimeout(timeout);
  }, [dataScope, dirty, draftLoaded, tagsText, targetNotebookId, title, visible, contentMarkdown]);

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
      await clearMobileNewMemoDraft(dataScope);
      if (materializedMemoId) {
        await clearMobileMemoDraft(materializedMemoId);
      }
      void onQueued();
      onCreated(memo);
    },
  });
  const canSubmitCreateMemo = Boolean(targetNotebookId) && !createMutation.isPending && imageOperation === "idle";

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
    await clearMobileNewMemoDraft(dataScope);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mobile", "notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
    ]);
    return response.memo;
  };

  const pickAndUploadImage = async () => {
    let uploadId: string | null = null;
    try {
      const DocumentPicker = await import("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: "*/*",
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) {
        return;
      }
      const isImage = asset.mimeType?.startsWith("image/") ?? false;
      if (isImage) {
        uploadId = createMobileImageUploadId();
        const previewDataUrl = await createLocalImagePreviewDataUrl(asset);
        editorRef.current?.beginImageUpload(uploadId, previewDataUrl);
      }
      const memo = await materializeMemoForImage();
      setImageOperation("uploading");
      const uploadAsset = await prepareUploadAsset(asset, imageCompressionEnabled);
      const form = new FormData();
      form.append("file", new ExpoFile(uploadAsset.uri));
      const { resource } = await client!.uploadMemoResource(memo.id, form);
      if (resource.kind === "image" && uploadId) {
        editorRef.current?.completeImageUpload(
          uploadId,
          resource.url,
          resource.filename || uploadAsset.name || "图片"
        );
      } else {
        editorRef.current?.appendAttachment(resource.url, resource.filename || uploadAsset.name || "附件");
      }
    } catch (error) {
      if (uploadId) {
        editorRef.current?.cancelImageUpload(uploadId);
      }
      Alert.alert("附件上传失败", error instanceof Error ? error.message : "请检查网络连接后重试");
    } finally {
      setImageOperation("idle");
    }
  };

  const markDirty = () => {
    draftVersionRef.current += 1;
    setDirty(true);
  };

  const flushEditor = async () => {
    if (!editorRef.current) {
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        flushResolverRef.current = null;
        resolve();
      };
      flushResolverRef.current = finish;
      editorRef.current?.flush();
      setTimeout(finish, 1000);
    });
  };

  const requestClose = async () => {
    if (createMutation.isPending || imageOperation !== "idle") {
      return;
    }
    await flushEditor();
    createMutation.mutate();
  };

  const loadEditorResource = useCallback((source: string) => {
    if (!client) {
      return Promise.resolve(null);
    }
    const cached = resourceDataUrlCacheRef.current.get(source);
    if (cached) {
      return cached;
    }
    const pending = client.getResourceBlob(source).then(blobToDataUrl).catch(() => null);
    resourceDataUrlCacheRef.current.set(source, pending);
    return pending;
  }, [client]);

  const editorElement = useMemo(() => draftLoaded && baseUrl ? (
    <LocalTiptapEditor
      autoFocus
      baseUrl={baseUrl}
      content={contentJsonRef.current}
      dom={{
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
      onLoadResource={loadEditorResource}
      onPickImage={pickAndUploadImage}
      onReady={async (elapsedMs) => {
        setEditorReady(true);
        recordEditorStartup(elapsedMs);
        if (Platform.OS === "android") {
          setTimeout(showEdgeEverKeyboard, 180);
        }
      }}
      ref={editorRef}
      locale={resolvedLocale}
      theme={resolvedTheme}
    />
  ) : null, [baseUrl, draftLoaded, loadEditorResource, resolvedLocale, resolvedTheme]);

  return (
    <Modal animationType="slide" onRequestClose={() => void requestClose()} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaView style={styles.createMemoSafeArea}>
        <View style={styles.createMemoHeader}>
          <Pressable accessibilityLabel="返回" accessibilityRole="button" disabled={createMutation.isPending || imageOperation !== "idle"} onPress={() => void requestClose()} style={styles.createMemoBackButton}>
            <ChevronLeft color={createMutation.isPending || imageOperation !== "idle" ? "#cbd5e1" : "#0f172a"} size={30} />
          </Pressable>
          <View style={styles.createMemoHeaderActions}>
            <Text style={[styles.createMemoStatus, createMutation.isPending && styles.createMemoStatusActive]}>
              {imageOperation === "creating" ? "正在创建" : imageOperation === "uploading" ? "正在上传" : createMutation.isPending || dirty ? "保存中" : editorReady ? "已保存" : "正在启动"}
            </Text>
            <Pressable
              accessibilityLabel="完成新建笔记"
              disabled={!canSubmitCreateMemo}
              onPress={() => void flushEditor().then(() => createMutation.mutate())}
              style={[styles.createMemoDoneButton, !canSubmitCreateMemo && styles.createMemoDoneButtonDisabled]}
            >
              {createMutation.isPending ? <ActivityIndicator color="#64748b" size="small" /> : <Text style={[styles.createMemoDoneText, !canSubmitCreateMemo && styles.createMemoDoneTextDisabled]}>完成</Text>}
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
            <TextInput
              accessibilityLabel="笔记标签"
              autoCorrect
              onChangeText={(value) => {
                setTagsText(value);
                markDirty();
              }}
              placeholder="添加标签，用逗号分隔"
              placeholderTextColor="#94a3b8"
              style={styles.createMemoTagsInput}
              value={tagsText}
            />
          </View>

          <View style={styles.createMemoEditorFrame}>
            {!editorReady ? (
              <View style={styles.richEditorLoading}>
                <ActivityIndicator color="#0f172a" />
                <Text style={styles.mutedText}>正在启动本地编辑器</Text>
              </View>
            ) : null}
            {editorElement}
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
      </SafeAreaView>
    </Modal>
  );
};

const TagsManagerModal = ({ onClose, visible }: { onClose: () => void; visible: boolean }) => {
  const { client } = useSession();
  const { translate } = useMobileLocale();
  const queryClient = useQueryClient();
  const localePreference = useMobileLocalePreference();
  const [editingTagName, setEditingTagName] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState("");

  const tagsQuery = useQuery({
    queryKey: ["mobile", "tags"],
    queryFn: async () => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return client.listTags();
    },
    enabled: Boolean(client && visible),
  });

  const invalidateTagsAndMemos = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mobile", "tags"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memos"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "search"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile", "memo"] }),
    ]);
  };

  const renameTagMutation = useMutation({
    mutationFn: async ({ tag, name }: { tag: string; name: string }) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      const trimmed = name.trim();

      if (!trimmed) {
        throw new Error("请输入标签名称");
      }

      return client.renameTag(tag, trimmed);
    },
    onSuccess: async () => {
      setEditingTagName(null);
      setEditingTagValue("");
      await invalidateTagsAndMemos();
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (tag: string) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return client.deleteTag(tag);
    },
    onSuccess: invalidateTagsAndMemos,
  });

  const requestDeleteTag = (tag: TagSummary) => {
    Alert.alert(`删除标签 #${tag.name}`, `将从 ${tag.memoCount} 条笔记中移除这个标签，笔记内容不会被删除。`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除标签",
        style: "destructive",
        onPress: () => deleteTagMutation.mutate(tag.name),
      },
    ]);
  };

  const tags = tagsQuery.data?.tags ?? [];
  const renderTagItem = ({ item: tag }: { item: TagSummary }) => {
    const editing = editingTagName === tag.name;
    const nextName = editingTagValue.trim();
    const canRename = Boolean(nextName && nextName !== tag.name && !renameTagMutation.isPending);

    return (
      <View style={[styles.tagManageRow, editing && styles.tagManageRowEditing]}>
        {editing ? (
          <View style={styles.tagRenameForm}>
            <TextInput
              accessibilityLabel="标签名称"
              autoFocus
              editable={!renameTagMutation.isPending}
              maxLength={80}
              onChangeText={setEditingTagValue}
              onSubmitEditing={() => {
                if (canRename) {
                  renameTagMutation.mutate({ tag: tag.name, name: nextName });
                }
              }}
              placeholder="标签名称"
              placeholderTextColor="#94a3b8"
              returnKeyType="done"
              style={styles.tagRenameInput}
              value={editingTagValue}
            />
            <View style={styles.tagRenameActions}>
              <Pressable
                accessibilityLabel="保存"
                accessibilityRole="button"
                disabled={!canRename}
                onPress={() => renameTagMutation.mutate({ tag: tag.name, name: nextName })}
                style={[styles.tagRenameSaveButton, !canRename && styles.buttonDisabled]}
              >
                {renameTagMutation.isPending ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.tagRenameSaveText}>保存</Text>}
              </Pressable>
              <Pressable
                accessibilityLabel="取消"
                accessibilityRole="button"
                disabled={renameTagMutation.isPending}
                onPress={() => {
                  setEditingTagName(null);
                  setEditingTagValue("");
                }}
                style={[styles.tagRenameCancelButton, renameTagMutation.isPending && styles.buttonDisabled]}
              >
                <Text style={styles.tagRenameCancelText}>取消</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.tagManageText}>
              <Text numberOfLines={1} style={styles.tagManageName}>
                #{tag.name}
              </Text>
              <Text style={styles.tagManageMeta}>
                {translate(`${tag.memoCount} 条笔记`)}{tag.updatedAt ? ` · ${formatDate(tag.updatedAt, localePreference)}` : ""}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={translate(`重命名标签 ${tag.name}`)}
              accessibilityRole="button"
              onPress={() => {
                setEditingTagName(tag.name);
                setEditingTagValue(tag.name);
              }}
              style={styles.tagManageAction}
            >
              <Pencil color="#64748b" size={16} />
            </Pressable>
            <Pressable
              accessibilityLabel={translate(`删除标签 ${tag.name}`)}
              accessibilityRole="button"
              onPress={() => requestDeleteTag(tag)}
              style={[styles.tagManageAction, styles.tagManageActionDanger]}
            >
              <Trash2 color="#b91c1c" size={16} />
            </Pressable>
          </>
        )}
      </View>
    );
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={styles.modalSafeArea}>
        <View style={styles.managementHeader}>
          <Pressable accessibilityLabel="返回" accessibilityRole="button" onPress={onClose} style={styles.managementBackButton}>
            <ChevronLeft color="#64748b" size={21} />
          </Pressable>
          <View style={styles.managementHeaderText}>
            <View style={styles.managementTitleRow}>
              <Tag color="#047857" size={17} />
              <Text style={styles.managementTitle}>标签</Text>
            </View>
            <Text style={styles.managementSubtitle}>{tags.length} tags</Text>
          </View>
        </View>

        {tagsQuery.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#0f172a" />
          </View>
        ) : tags.length === 0 ? (
          <View style={styles.centerState}>
            <Tag color="#94a3b8" size={32} />
            <Text style={styles.emptyTitle}>暂无标签</Text>
            <Text style={styles.mutedText}>在编辑笔记时添加标签后会显示在这里</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.tagManagerListContent}
            data={tags}
            initialNumToRender={12}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(tag) => tag.name}
            ListFooterComponent={(
              <>
                {renameTagMutation.error ? (
                  <Text style={styles.errorText}>{renameTagMutation.error instanceof Error ? renameTagMutation.error.message : "重命名失败"}</Text>
                ) : null}
                {deleteTagMutation.error ? (
                  <Text style={styles.errorText}>{deleteTagMutation.error instanceof Error ? deleteTagMutation.error.message : "删除失败"}</Text>
                ) : null}
              </>
            )}
            maxToRenderPerBatch={10}
            removeClippedSubviews={Platform.OS === "android"}
            renderItem={renderTagItem}
            style={styles.tagManagerList}
            updateCellsBatchingPeriod={32}
            windowSize={7}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};

const ApiTokensContent = ({ active, baseUrl, embedded = false }: { active: boolean; baseUrl: string; embedded?: boolean }) => {
  const { client } = useSession();
  const { translate } = useMobileLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState("MCP Token 1");
  const [nameDefaultsSynced, setNameDefaultsSynced] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(() => new Set(ALL_TOKEN_SCOPES));
  const [scopeDefaultsSynced, setScopeDefaultsSynced] = useState(false);
  const [scopesExpanded, setScopesExpanded] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [exampleOpen, setExampleOpen] = useState(false);

  const tokensQuery = useQuery({
    queryKey: ["mobile", "api-tokens"],
    queryFn: async () => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return client.listApiTokens();
    },
    enabled: Boolean(client && active),
  });

  const availableScopes = tokensQuery.data?.availableScopes ?? ALL_TOKEN_SCOPES;
  const tokens = tokensQuery.data?.apiTokens ?? [];

  useEffect(() => {
    if (nameDefaultsSynced || !tokensQuery.data) {
      return;
    }
    const highestTokenNumber = tokens.reduce((highest, token) => {
      const match = token.name.match(/^MCP Token (\d+)$/i);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    setName(`MCP Token ${highestTokenNumber + 1}`);
    setNameDefaultsSynced(true);
  }, [nameDefaultsSynced, tokens, tokensQuery.data]);

  useEffect(() => {
    if (scopeDefaultsSynced || !tokensQuery.data?.availableScopes) {
      return;
    }

    setSelectedScopes(new Set(tokensQuery.data.availableScopes));
    setScopeDefaultsSynced(true);
  }, [scopeDefaultsSynced, tokensQuery.data?.availableScopes]);

  const createTokenMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      const trimmedName = name.trim();
      const scopes = Array.from(selectedScopes);

      if (!trimmedName) {
        throw new Error("请输入 Token 名称");
      }

      if (scopes.length === 0) {
        throw new Error("请至少选择一个权限");
      }

      return client.createApiToken({ name: trimmedName, scopes });
    },
    onSuccess: async (data) => {
      setCreatedToken(data.token);
      setName("");
      setSelectedScopes(new Set(availableScopes));
      await queryClient.invalidateQueries({ queryKey: ["mobile", "api-tokens"] });
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return client.revokeApiToken(tokenId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mobile", "api-tokens"] });
    },
  });

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) => {
      const next = new Set(current);

      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }

      return next;
    });
  };

  const copyText = async (value: string, label: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedValue(label);
    setTimeout(() => {
      setCopiedValue((current) => (current === label ? null : current));
    }, 1600);
  };

  const requestRevokeToken = (token: ApiToken) => {
    Alert.alert(`确定要删除 Token「${token.name}」吗？`, "删除操作不可逆。一旦删除，使用此 Token 进行 API 或 MCP 调用的一切客户端将立即失效并被拒绝访问。", [
      { text: "取消", style: "cancel" },
      {
        text: "确认删除",
        style: "destructive",
        onPress: () => revokeTokenMutation.mutate(token.id),
      },
    ]);
  };

  return (
    <View style={[styles.settingsGroup, embedded && styles.settingsAiEmbeddedCard]}>
      <View style={styles.mcpCardHeader}>
        <View style={styles.mcpCardTitleRow}>
          <KeyRound color="#047857" size={16} />
          <Text style={styles.settingsGroupTitle}>生成 MCP 配置</Text>
          <Pressable accessibilityRole="button" onPress={() => setExampleOpen(true)} style={styles.mcpExampleButton}>
            <Text style={styles.mcpExampleButtonText}>使用示例</Text>
          </Pressable>
        </View>
        <Text style={styles.mcpCardDescription}>让 AI Agent 可以读取和整理你的笔记。</Text>
      </View>

      <View style={styles.mcpCardContent}>
          {createdToken ? (
            <View style={styles.createdTokenPanel}>
              <View style={styles.assetsSummary}>
                <ShieldCheck color="#047857" size={18} />
                <Text style={styles.assetsSummaryText}>API Token 已成功生成</Text>
              </View>
              <Text selectable numberOfLines={2} style={styles.tokenValueText}>
                {createdToken}
              </Text>
              <View style={styles.tokenActionRow}>
                <ActionButton label={copiedValue === "created-token" ? "已复制" : "复制 Token"} onPress={() => copyText(createdToken, "created-token")}>
                  <Copy color="#0f172a" size={16} />
                </ActionButton>
                <ActionButton label={copiedValue === "created-config" ? "已复制" : "复制完整 MCP 配置"} onPress={() => copyText(buildMcpRemoteConfig(baseUrl, createdToken), "created-config")}>
                  <KeyRound color="#0f172a" size={16} />
                </ActionButton>
              </View>
              <Text style={styles.assetsHint}>安全提醒：此 Token 属于高危凭证，请勿对外泄露。</Text>
            </View>
          ) : null}

          <TextInput
            accessibilityLabel={translate("Token 名称")}
            editable={!createTokenMutation.isPending}
            maxLength={80}
            onChangeText={setName}
            onSubmitEditing={() => {
              if (name.trim() && selectedScopes.size > 0 && !createTokenMutation.isPending) {
                createTokenMutation.mutate();
              }
            }}
            placeholder="Token 名称，例如：Codex 或 Claude Code"
            placeholderTextColor="#94a3b8"
            returnKeyType="done"
            style={styles.mcpNameInput}
            value={name}
          />

          <Pressable
            accessibilityRole="button"
            disabled={createTokenMutation.isPending || !name.trim() || selectedScopes.size === 0}
            onPress={() => createTokenMutation.mutate()}
            style={[styles.mcpGenerateButton, (createTokenMutation.isPending || !name.trim() || selectedScopes.size === 0) && styles.buttonDisabled]}
          >
            {createTokenMutation.isPending ? <ActivityIndicator color="#ffffff" size="small" /> : <Plus color="#ffffff" size={16} />}
            <Text style={styles.mcpGenerateButtonText}>{createTokenMutation.isPending ? "正在创建..." : "生成 Token"}</Text>
          </Pressable>

          <Pressable accessibilityState={{ expanded: scopesExpanded }} onPress={() => setScopesExpanded((value) => !value)} style={styles.tokenScopeHeader}>
            <View>
              <Text style={styles.settingsRowTitle}>Token 权限范围</Text>
              <Text style={styles.settingsRowDescription}>{translate(`已选择 ${selectedScopes.size}/${availableScopes.length}`)}</Text>
            </View>
            {scopesExpanded ? <ChevronDown color="#94a3b8" size={17} /> : <ChevronRight color="#94a3b8" size={17} />}
          </Pressable>
          {scopesExpanded ? <View style={styles.scopeGrid}>
            {availableScopes.map((scope) => {
              const selected = selectedScopes.has(scope);

              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={scope}
                  onPress={() => toggleScope(scope)}
                  style={[styles.scopeOption, selected && styles.scopeOptionSelected]}
                >
                  <View style={[styles.scopeCheckbox, selected && styles.scopeCheckboxSelected]}>
                    {selected ? <Check color="#ffffff" size={12} /> : null}
                  </View>
                  <Text numberOfLines={1} style={[styles.scopeOptionText, selected && styles.scopeOptionTextSelected]}>{translate(getTokenScopeLabel(scope))}</Text>
                </Pressable>
              );
            })}
          </View> : null}
          {createTokenMutation.error ? (
            <Text style={styles.errorText}>{createTokenMutation.error instanceof Error ? createTokenMutation.error.message : "创建失败"}</Text>
          ) : null}

          <Text style={styles.label}>Token 列表</Text>
          {tokensQuery.isLoading ? (
            <View style={styles.centerInline}>
              <ActivityIndicator color="#0f172a" />
            </View>
          ) : tokens.length === 0 ? (
            <Text style={styles.apiTokenEmptyText}>暂无 API Token</Text>
          ) : (
            tokens.map((token) => (
              <ApiTokenRow
                baseUrl={baseUrl}
                copiedValue={copiedValue}
                isDeleting={revokeTokenMutation.isPending}
                key={token.id}
                onCopy={copyText}
                onDelete={requestRevokeToken}
                token={token}
              />
            ))
          )}
          {revokeTokenMutation.error ? (
            <Text style={styles.errorText}>{revokeTokenMutation.error instanceof Error ? revokeTokenMutation.error.message : "撤销失败"}</Text>
          ) : null}
      </View>
      <Modal animationType="fade" onRequestClose={() => setExampleOpen(false)} transparent visible={exampleOpen}>
        <Pressable onPress={() => setExampleOpen(false)} style={styles.settingsDialogBackdrop}>
          <Pressable style={styles.settingsExampleDialog}>
            <View style={styles.promptCardHeader}>
              <Text style={styles.settingsGroupTitle}>Remote MCP 示例</Text>
              <IconButton accessibilityLabel="关闭" onPress={() => setExampleOpen(false)}>
                <X color="#0f172a" size={18} />
              </IconButton>
            </View>
            <Text selectable style={styles.tokenValueText}>{buildMcpRemoteConfig(baseUrl, "YOUR_TOKEN_HERE")}</Text>
            <ActionButton label={copiedValue === "example-config" ? "已复制" : "复制示例"} onPress={() => copyText(buildMcpRemoteConfig(baseUrl, "YOUR_TOKEN_HERE"), "example-config")}>
              <Copy color="#0f172a" size={16} />
            </ActionButton>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const ApiTokensModal = ({ baseUrl, onClose, visible }: { baseUrl: string; onClose: () => void; visible: boolean }) => (
  <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
    <SafeAreaView style={styles.modalSafeArea}>
      <View style={styles.modalHeader}>
        <IconButton accessibilityLabel="关闭" onPress={onClose}>
          <X color="#0f172a" size={20} />
        </IconButton>
        <Text style={styles.modalTitle}>MCP 与 API Token</Text>
        <View style={styles.iconButtonPlaceholder} />
      </View>
      <ScrollView contentContainerStyle={styles.editorForm}>
        <ApiTokensContent active={visible} baseUrl={baseUrl} />
      </ScrollView>
    </SafeAreaView>
  </Modal>
);

const ApiTokenRow = ({
  baseUrl,
  copiedValue,
  isDeleting,
  onCopy,
  onDelete,
  token,
}: {
  baseUrl: string;
  copiedValue: string | null;
  isDeleting: boolean;
  onCopy: (value: string, label: string) => void;
  onDelete: (token: ApiToken) => void;
  token: ApiToken;
}) => {
  const { resolvedLocale, translate } = useMobileLocale();
  const tokenCopyLabel = `token-${token.id}`;
  const configCopyLabel = `config-${token.id}`;
  const canCopyToken = Boolean(token.token && !token.isRevoked);
  const localePreference = useMobileLocalePreference();

  return (
    <View style={[styles.apiTokenRow, token.isRevoked && styles.buttonDisabled]}>
      <View style={styles.apiTokenText}>
        <Text numberOfLines={1} style={styles.apiTokenName}>
          {token.name}
        </Text>
        <Text numberOfLines={1} style={styles.apiTokenScopes}>
          {token.scopes.map((scope) => translate(getTokenScopeLabel(scope))).join(resolvedLocale === "en-US" ? ", " : "、") || translate("无权限")}
        </Text>
        <Text style={styles.apiTokenMeta}>
          {translate(token.lastUsedAt ? `上次调用时间：${formatDate(token.lastUsedAt, localePreference)}` : "从未被调用")}
          {!token.token ? ` · ${translate("旧 Token 无法找回明文，请重新生成")}` : ""}
        </Text>
      </View>
      <View style={styles.apiTokenActions}>
        <Pressable
          accessibilityLabel={canCopyToken ? "复制 Token" : "旧 Token 无法复制"}
          accessibilityRole="button"
          disabled={!canCopyToken}
          onPress={() => token.token && onCopy(token.token, tokenCopyLabel)}
          style={[styles.apiTokenActionButton, !canCopyToken && styles.buttonDisabled]}
        >
          {copiedValue === tokenCopyLabel ? <ShieldCheck color="#047857" size={18} /> : <Copy color={canCopyToken ? "#0f172a" : "#cbd5e1"} size={18} />}
          <Text style={styles.apiTokenActionText}>{copiedValue === tokenCopyLabel ? "已复制" : "复制 Token"}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={canCopyToken ? "复制完整 MCP 配置" : "旧 Token 无法复制 MCP 配置"}
          accessibilityRole="button"
          disabled={!canCopyToken}
          onPress={() => token.token && onCopy(buildMcpRemoteConfig(baseUrl, token.token), configCopyLabel)}
          style={[styles.apiTokenActionButton, !canCopyToken && styles.buttonDisabled]}
        >
          {copiedValue === configCopyLabel ? <ShieldCheck color="#047857" size={18} /> : <KeyRound color={canCopyToken ? "#0f172a" : "#cbd5e1"} size={18} />}
          <Text style={styles.apiTokenActionText}>{copiedValue === configCopyLabel ? "已复制" : "复制完整 MCP 配置"}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="删除 Token"
          accessibilityRole="button"
          disabled={isDeleting}
          onPress={() => onDelete(token)}
          style={[styles.apiTokenActionButton, styles.apiTokenDeleteButton, isDeleting && styles.buttonDisabled]}
        >
          <Trash2 color="#b91c1c" size={18} />
          <Text style={styles.apiTokenDeleteText}>删除 Token</Text>
        </Pressable>
      </View>
    </View>
  );
};

const AdvancedPlayCard = ({ embedded = false }: { embedded?: boolean }) => {
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const localePreference = useMobileLocalePreference();
  const advancedPrompts = useMemo(() => getMobileAdvancedPrompts(localePreference), [localePreference]);

  const copyPrompt = async (promptId: string, prompt: string) => {
    await Clipboard.setStringAsync(prompt);
    setCopiedPromptId(promptId);
    setTimeout(() => setCopiedPromptId((current) => (current === promptId ? null : current)), 1600);
  };

  return (
    <View style={[styles.settingsGroup, embedded && styles.settingsAiEmbeddedCardFirst]}>
      <Pressable accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.settingsAccordionHeader}>
        <View style={styles.settingsLinkCopy}>
          <View style={styles.settingsGroupHeader}>
            <Sparkles color="#047857" size={16} />
            <Text style={styles.settingsGroupTitle}>进阶玩法</Text>
          </View>
          <Text style={styles.settingsLinkDescription}>搭配 AI Agent 的进阶玩法。</Text>
        </View>
        <ChevronDown color="#94a3b8" size={17} style={[styles.settingsAccordionChevron, expanded && styles.settingsAccordionChevronExpanded]} />
      </Pressable>
      {expanded ? (
        <View style={styles.settingsAccordionContent}>
          <View style={styles.guideHero}>
            <Sparkles color="#047857" size={24} />
            <Text style={styles.panelValue}>搭配 AI Agent 的进阶工作流</Text>
            <Text style={styles.panelLabel}>复制 Prompt 后，配合 EdgeEver MCP 让 AI 读取真实笔记并输出结构化结果。</Text>
          </View>

          {advancedPrompts.map((item) => (
            <View key={item.id} style={styles.promptCard}>
              <View style={styles.promptCardHeader}>
                <Text style={styles.panelValue}>{item.title}</Text>
                <ActionButton label={copiedPromptId === item.id ? "已复制" : "复制"} onPress={() => copyPrompt(item.id, item.prompt)}>
                  {copiedPromptId === item.id ? <ShieldCheck color="#047857" size={16} /> : <Copy color="#0f172a" size={16} />}
                </ActionButton>
              </View>
              <Text selectable style={styles.revisionPreviewText}>
                {item.prompt}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const SystemInfoCard = ({ embedded = false }: { embedded?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const localePreference = useMobileLocalePreference();
  const copy = getMobileSystemInfoText(localePreference);
  const infoItems = getMobileSystemInfoItems(localePreference);

  const copySystemInfo = async () => {
    await Clipboard.setStringAsync(infoItems.map((item) => `${item.label}: ${item.value}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={[styles.settingsGroup, embedded && styles.settingsEmbeddedSection]}>
      <Pressable accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.settingsAccordionHeader}>
        <View style={styles.settingsLinkCopy}>
          <View style={styles.settingsGroupHeader}>
            <Info color="#047857" size={16} />
            <Text style={styles.settingsGroupTitle}>{copy.title}</Text>
          </View>
          <Text style={styles.settingsLinkDescription}>{copy.description}</Text>
        </View>
        {expanded ? <ChevronDown color="#94a3b8" size={17} /> : <ChevronRight color="#94a3b8" size={17} />}
      </Pressable>
      {expanded ? (
        <View style={styles.settingsAccordionContent}>
          <ActionButton label={copied ? "已复制" : "复制信息"} onPress={copySystemInfo}>
            {copied ? <ShieldCheck color="#047857" size={16} /> : <Copy color="#0f172a" size={16} />}
          </ActionButton>
          <View style={styles.systemInfoRows}>
            {Array.from({ length: Math.ceil(infoItems.length / 3) }, (_, rowIndex) => {
              const rowItems = infoItems.slice(rowIndex * 3, rowIndex * 3 + 3);

              return (
                <View
                  key={`system-info-row-${rowIndex}`}
                  style={[styles.systemInfoRow, rowIndex === Math.ceil(infoItems.length / 3) - 1 && styles.systemInfoRowLast]}
                >
                  {rowItems.map((item, itemIndex) => (
                    <View
                      key={item.label}
                      style={[styles.systemInfoCell, itemIndex < rowItems.length - 1 && styles.systemInfoCellDivider]}
                    >
                      <Text numberOfLines={1} style={styles.panelLabel}>{item.label}</Text>
                      <Text numberOfLines={1} selectable style={styles.systemInfoListValue}>
                        {item.value}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
};

type ResourceFilter = "all" | "image" | "document" | "other";

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/html",
  "text/css",
  "text/javascript",
]);

const ResourcesModal = ({
  activeMemo,
  imageCompressionEnabled,
  onClose,
  visible,
}: {
  activeMemo: MemoDetail | null;
  imageCompressionEnabled: boolean;
  onClose: () => void;
  visible: boolean;
}) => {
  const { client } = useSession();
  const { translate } = useMobileLocale();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [layout, setLayout] = useState<MobileResourceLayoutPreference>("grid");
  const [previewResource, setPreviewResource] = useState<ResourceListItem | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");

  useEffect(() => {
    if (!visible) {
      setUploadProgress("");
      return;
    }

    let mounted = true;

    readMobileResourceLayout().then((value) => {
      if (mounted) {
        setLayout(value);
      }
    });

    return () => {
      mounted = false;
    };
  }, [visible]);

  const resourcesQuery = useQuery({
    queryKey: ["mobile", "resources"],
    queryFn: async () => {
      if (!client) {
        throw new Error("Client is not ready");
      }

      return client.listResources();
    },
    enabled: Boolean(client && visible),
  });

  const uploadResourceMutation = useMutation({
    mutationFn: async () => {
      if (!client || !activeMemo) {
        throw new Error("请先打开一条可用笔记");
      }

      if (activeMemo.isDeleted) {
        throw new Error("回收站中的笔记不能上传资源");
      }

      const DocumentPicker = await import("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });

      if (result.canceled) {
        return null;
      }

      const assets = result.assets.filter((asset) => asset.uri);

      if (assets.length === 0) {
        throw new Error("没有选择文件");
      }

      const resources = [];

      for (const [index, asset] of assets.entries()) {
        setUploadProgress(`正在上传第 ${index + 1}/${assets.length} 个文件...`);
        const form = new FormData();
        const uploadAsset = await prepareUploadAsset(asset, imageCompressionEnabled);
        form.append("file", new ExpoFile(uploadAsset.uri));

        const { resource } = await client.uploadMemoResource(activeMemo.id, form);
        resources.push(resource);
      }

      return { resources };
    },
    onSuccess: async (result) => {
      if (!result) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile", "resources"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile", "memo"] }),
      ]);
      setFilter(result.resources.some((resource) => resource.kind === "image") ? "image" : "all");
      setUploadProgress("上传成功！");
    },
    onError: () => {
      setUploadProgress("");
    },
  });

  const resources = resourcesQuery.data?.resources ?? [];
  const summary = resourcesQuery.data?.summary ?? {
    totalCount: 0,
    totalBytes: 0,
    imageCount: 0,
    attachmentCount: 0,
  };
  const filteredResources = resources.filter((resource) => {
    const isDocument = isDocumentResource(resource);

    if (filter === "image" && resource.kind !== "image") {
      return false;
    }

    if (filter === "document" && (!isDocument || resource.kind === "image")) {
      return false;
    }

    if (filter === "other" && (resource.kind === "image" || isDocument)) {
      return false;
    }

    const query = searchText.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return (
      (resource.filename || "").toLowerCase().includes(query) ||
      (resource.memoTitle || "").toLowerCase().includes(query) ||
      (resource.memoExcerpt || "").toLowerCase().includes(query)
    );
  });
  const imageResources = filteredResources.filter((resource) => resource.kind === "image");
  const previewIndex = previewResource ? imageResources.findIndex((resource) => resource.id === previewResource.id) : -1;
  const uploadTargetHint = !activeMemo
    ? "提示：在右侧编辑器中打开一篇笔记，即可在此处拖放或上传新文件。"
    : activeMemo.isDeleted
      ? "已删除笔记不能上传附件，请先恢复笔记"
      : `当前关联笔记：《${activeMemo.title?.trim() || activeMemo.excerpt || DEFAULT_MEMO_TITLE}》`;
  const handlePreviewStep = (direction: -1 | 1) => {
    if (previewIndex < 0 || imageResources.length < 2) {
      return;
    }

    const nextIndex = (previewIndex + direction + imageResources.length) % imageResources.length;
    setPreviewResource(imageResources[nextIndex]);
  };
  const handleLayoutChange = (nextLayout: MobileResourceLayoutPreference) => {
    setLayout(nextLayout);
    void writeMobileResourceLayout(nextLayout);
  };

  return (
    <Modal animationType="slide" onRequestClose={() => !uploadResourceMutation.isPending && onClose()} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={styles.modalSafeArea}>
        <View style={styles.managementHeader}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            disabled={uploadResourceMutation.isPending}
            onPress={onClose}
            style={styles.managementBackButton}
          >
            <ChevronLeft color={uploadResourceMutation.isPending ? "#cbd5e1" : "#64748b"} size={21} />
          </Pressable>
          <View style={styles.managementHeaderText}>
            <View style={styles.managementTitleRow}>
              <Archive color="#047857" size={17} />
              <Text style={styles.managementTitle}>附件管理</Text>
            </View>
            <Text numberOfLines={1} style={styles.managementSubtitle}>
              {formatBytes(summary.totalBytes)} • {translate(`${summary.totalCount} 文件`)} • {translate(`${summary.imageCount} 图片`)}
            </Text>
          </View>
        </View>

        <View style={styles.assetsToolbar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <OptionPill active={filter === "all"} label="全部" onPress={() => setFilter("all")} />
            <OptionPill active={filter === "image"} label="图片" onPress={() => setFilter("image")} />
            <OptionPill active={filter === "document"} label="文档" onPress={() => setFilter("document")} />
            <OptionPill active={filter === "other"} label="其他" onPress={() => setFilter("other")} />
          </ScrollView>

          <View style={styles.assetsSearchLayoutRow}>
            <View style={[styles.searchBox, styles.assetsSearchBox]}>
              <Search color="#64748b" size={17} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setSearchText}
                placeholder="搜索附件名或来源笔记..."
                placeholderTextColor="#94a3b8"
                style={[styles.searchInput, styles.assetsSearchInput]}
                value={searchText}
              />
              {searchText ? (
                <Pressable onPress={() => setSearchText("")}>
                  <X color="#64748b" size={17} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.layoutToggle}>
              <Pressable accessibilityLabel="网格视图" accessibilityRole="button" onPress={() => handleLayoutChange("grid")} style={[styles.layoutToggleButton, layout === "grid" && styles.layoutToggleButtonActive]}>
                <Grid color={layout === "grid" ? "#047857" : "#64748b"} size={16} />
              </Pressable>
              <Pressable accessibilityLabel="列表视图" accessibilityRole="button" onPress={() => handleLayoutChange("list")} style={[styles.layoutToggleButton, layout === "list" && styles.layoutToggleButtonActive]}>
                <List color={layout === "list" ? "#047857" : "#64748b"} size={16} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={[styles.assetsUploadBanner, !activeMemo && styles.assetsUploadBannerInactive]}>
          <Text numberOfLines={2} style={[styles.assetsUploadHint, !activeMemo && styles.assetsUploadHintInactive]}>
            {translate(uploadProgress || uploadTargetHint)}
          </Text>
          {activeMemo ? (
            <Pressable
              accessibilityRole="button"
              disabled={activeMemo.isDeleted || uploadResourceMutation.isPending}
              onPress={() => uploadResourceMutation.mutate()}
              style={[styles.assetsUploadButton, (activeMemo.isDeleted || uploadResourceMutation.isPending) && styles.buttonDisabled]}
            >
              {uploadResourceMutation.isPending ? <ActivityIndicator color="#ffffff" size="small" /> : <Upload color="#ffffff" size={13} />}
              <Text style={styles.assetsUploadButtonText}>{uploadResourceMutation.isPending ? "处理中..." : "上传附件"}</Text>
            </Pressable>
          ) : null}
        </View>
        {uploadResourceMutation.error ? (
          <Text style={styles.assetsUploadError}>{uploadResourceMutation.error instanceof Error ? uploadResourceMutation.error.message : "上传失败"}</Text>
        ) : null}

        {resourcesQuery.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#0f172a" />
          </View>
        ) : filteredResources.length === 0 ? (
          <View style={styles.centerState}>
            <Archive color="#94a3b8" size={32} />
            <Text style={styles.emptyTitle}>{searchText || filter !== "all" ? "没有匹配资源" : "资源库为空"}</Text>
            <Text style={styles.mutedText}>{searchText || filter !== "all" ? "调整筛选条件后再试" : "PWA 上传的图片和附件会显示在这里"}</Text>
          </View>
        ) : (
          <FlatList
            columnWrapperStyle={layout === "grid" ? styles.assetGridRow : undefined}
            contentContainerStyle={layout === "grid" ? styles.assetGrid : styles.assetList}
            data={filteredResources}
            initialNumToRender={6}
            key={layout}
            keyExtractor={(resource) => resource.id}
            maxToRenderPerBatch={8}
            numColumns={layout === "grid" ? 2 : 1}
            removeClippedSubviews={Platform.OS === "android"}
            renderItem={({ item }) => <ResourceCard layout={layout} resource={item} onOpen={() => openResource(item)} onPreview={() => setPreviewResource(item)} />}
            refreshControl={<RefreshControl onRefresh={() => resourcesQuery.refetch()} refreshing={resourcesQuery.isFetching} tintColor="#0f172a" />}
            updateCellsBatchingPeriod={32}
            windowSize={5}
          />
        )}

        <ImagePreviewModal
          onClose={() => setPreviewResource(null)}
          onNext={() => handlePreviewStep(1)}
          onPrevious={() => handlePreviewStep(-1)}
          onSelect={setPreviewResource}
          resource={previewResource}
          resources={imageResources}
          resourceIndex={previewIndex}
        />
      </SafeAreaView>
    </Modal>
  );
};

const ResourceCard = ({
  layout,
  onOpen,
  onPreview,
  resource,
}: {
  layout: MobileResourceLayoutPreference;
  onOpen: () => void;
  onPreview: () => void;
  resource: ResourceListItem;
}) => {
  const { session } = useSession();
  const { translate } = useMobileLocale();
  const source = resource.memoDeleted ? "已删除笔记" : resource.memoTitle || resource.memoExcerpt || resource.memoId;
  const isImage = resource.kind === "image";
  const localePreference = useMobileLocalePreference();

  return (
    <Pressable
      accessibilityLabel={`${resource.filename || resource.id}, ${formatBytes(resource.byteSize)}, ${translate(`来自：${source}`)}`}
      accessibilityRole="button"
      onPress={isImage ? onPreview : onOpen}
      style={layout === "grid" ? styles.resourceGridCard : styles.resourceCard}
    >
      <View style={layout === "grid" ? styles.resourceGridThumb : styles.resourceThumb}>
        {isImage ? (
          <AuthenticatedResourceImage
            alt={resource.filename || "图片资源"}
            source={getAuthenticatedResourceSource(resource.url, session)}
            style={styles.resourceImage}
          />
        ) : (
          <View style={styles.resourceFileIcon}>{getResourceIcon(resource)}</View>
        )}
      </View>
      <View style={layout === "grid" ? styles.resourceGridInfo : styles.resourceInfo}>
        <Text numberOfLines={1} style={styles.memoTitle}>
          {resource.filename || resource.id}
        </Text>
        {layout === "grid" ? (
          <>
            <View style={styles.resourceGridMetaRow}>
              <Text numberOfLines={1} style={styles.resourceGridMetaText}>{formatBytes(resource.byteSize)}</Text>
              <Text numberOfLines={1} style={styles.resourceGridMetaText}>{(resource.mimeType?.split("/")[1] || resource.kind).toUpperCase()}</Text>
            </View>
            <Text accessibilityLabel={translate(`来自：${source}`)} numberOfLines={1} style={styles.resourceGridSource}>
              📄 {translate(source)}
            </Text>
          </>
        ) : (
          <>
            <Text numberOfLines={1} style={styles.panelLabel}>
              {formatBytes(resource.byteSize)} · {resource.mimeType?.split("/")[1] || resource.kind} · {formatDate(resource.createdAt, localePreference)}
            </Text>
            <Text numberOfLines={1} style={styles.panelLabel}>
              {translate(`来源笔记：${source}`)}
            </Text>
          </>
        )}
      </View>
      {layout === "list" ? (
        <Pressable accessibilityLabel={translate("在新窗口打开")} accessibilityRole="button" onPress={onOpen} style={styles.secondaryIconButton}>
          <ExternalLink color="#0f172a" size={16} />
        </Pressable>
      ) : null}
    </Pressable>
  );
};

const ImagePreviewModal = ({
  onClose,
  onNext,
  onPrevious,
  onSelect,
  resource,
  resources,
  resourceIndex,
}: {
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSelect: (resource: ResourceListItem) => void;
  resource: ResourceListItem | null;
  resources: ResourceListItem[];
  resourceIndex: number;
}) => {
  const { session } = useSession();
  const { resolvedLocale, translate } = useMobileLocale();
  const previewInsets = useSafeAreaInsets();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const thumbnailListRef = useRef<FlatList<ResourceListItem>>(null);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const stageWidth = useSharedValue(0);
  const stageHeight = useSharedValue(0);
  const resourceCount = resources.length;

  const resetTransform = useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    setZoomLevel(1);
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  useEffect(() => {
    resetTransform();
    if (resourceIndex > 0) {
      thumbnailListRef.current?.scrollToIndex({ animated: true, index: resourceIndex, viewPosition: 0.5 });
    }
  }, [resetTransform, resource?.id, resourceIndex]);

  useEffect(() => {
    if (!resource) {
      setShowThumbnails(false);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => setShowThumbnails(true));
    return () => task.cancel();
  }, [Boolean(resource)]);

  const applyZoom = useCallback((nextZoom: number) => {
    const resolvedZoom = Math.max(1, Math.min(3, nextZoom));
    scale.value = withTiming(resolvedZoom, { duration: 160 });
    savedScale.value = resolvedZoom;
    const maxTranslateX = Math.max(0, (resolvedZoom - 1) * stageWidth.value / 2);
    const maxTranslateY = Math.max(0, (resolvedZoom - 1) * stageHeight.value / 2);
    const resolvedTranslateX = Math.max(-maxTranslateX, Math.min(maxTranslateX, translateX.value));
    const resolvedTranslateY = Math.max(-maxTranslateY, Math.min(maxTranslateY, translateY.value));
    translateX.value = withTiming(resolvedTranslateX, { duration: 160 });
    translateY.value = withTiming(resolvedTranslateY, { duration: 160 });
    savedTranslateX.value = resolvedTranslateX;
    savedTranslateY.value = resolvedTranslateY;
    setZoomLevel(resolvedZoom);
  }, [savedScale, savedTranslateX, savedTranslateY, scale, stageHeight, stageWidth, translateX, translateY]);

  const previewGesture = useMemo(() => Gesture.Simultaneous(
    Gesture.Pinch()
      .onUpdate((event) => {
        scale.value = Math.max(1, Math.min(3, savedScale.value * event.scale));
      })
      .onEnd(() => {
        const resolvedZoom = Math.max(1, Math.min(3, scale.value));
        scale.value = withTiming(resolvedZoom, { duration: 120 });
        savedScale.value = resolvedZoom;
        const maxTranslateX = Math.max(0, (resolvedZoom - 1) * stageWidth.value / 2);
        const maxTranslateY = Math.max(0, (resolvedZoom - 1) * stageHeight.value / 2);
        const resolvedTranslateX = Math.max(-maxTranslateX, Math.min(maxTranslateX, translateX.value));
        const resolvedTranslateY = Math.max(-maxTranslateY, Math.min(maxTranslateY, translateY.value));
        translateX.value = withTiming(resolvedTranslateX, { duration: 120 });
        translateY.value = withTiming(resolvedTranslateY, { duration: 120 });
        savedTranslateX.value = resolvedTranslateX;
        savedTranslateY.value = resolvedTranslateY;
        runOnJS(setZoomLevel)(resolvedZoom);
      }),
    Gesture.Pan()
      .onUpdate((event) => {
        if (scale.value > 1) {
          const maxTranslateX = Math.max(0, (scale.value - 1) * stageWidth.value / 2);
          const maxTranslateY = Math.max(0, (scale.value - 1) * stageHeight.value / 2);
          translateX.value = Math.max(-maxTranslateX, Math.min(maxTranslateX, savedTranslateX.value + event.translationX));
          translateY.value = Math.max(-maxTranslateY, Math.min(maxTranslateY, savedTranslateY.value + event.translationY));
        }
      })
      .onEnd(() => {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      })
  ), [savedScale, savedTranslateX, savedTranslateY, scale, stageHeight, stageWidth, translateX, translateY]);
  const previewAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return <Modal animationType="fade" transparent visible={Boolean(resource)} onRequestClose={onClose}>
    <View style={styles.previewBackdrop}>
      <View style={[styles.previewToolbar, { top: previewInsets.top + 8 }]}>
        <Pressable
          accessibilityLabel={translate("放大")}
          accessibilityRole="button"
          disabled={zoomLevel >= 3}
          onPress={() => applyZoom(zoomLevel + 0.5)}
          style={[styles.previewToolbarButton, zoomLevel >= 3 && styles.previewToolbarButtonDisabled]}
        >
          <ZoomIn color="#ffffff" size={24} />
        </Pressable>
        <Pressable
          accessibilityLabel={translate("缩小")}
          accessibilityRole="button"
          disabled={zoomLevel <= 1}
          onPress={() => applyZoom(zoomLevel - 0.5)}
          style={[styles.previewToolbarButton, zoomLevel <= 1 && styles.previewToolbarButtonDisabled]}
        >
          <ZoomOut color="#ffffff" size={24} />
        </Pressable>
        <Pressable accessibilityLabel={translate("关闭")} accessibilityRole="button" onPress={onClose} style={styles.previewToolbarButton}>
          <X color="#ffffff" size={27} />
        </Pressable>
      </View>

      <View
        onLayout={(event) => {
          stageWidth.value = event.nativeEvent.layout.width;
          stageHeight.value = event.nativeEvent.layout.height;
        }}
        style={[styles.previewStage, { bottom: Math.max(136, previewInsets.bottom + 108) }]}
      >
        {resource ? (
          <GestureDetector gesture={previewGesture}>
            <Animated.View style={[styles.previewImageFrame, previewAnimatedStyle]}>
              <AuthenticatedResourceImage
                alt={resource.filename || "图片预览"}
                resizeMode="contain"
                source={getAuthenticatedResourceSource(resource.url, session)}
                style={styles.previewImage}
              />
            </Animated.View>
          </GestureDetector>
        ) : null}
      </View>
      {resourceCount > 1 ? (
        <View style={styles.previewNavRow}>
          <Pressable accessibilityLabel={translate("上一张")} accessibilityRole="button" onPress={onPrevious} style={styles.previewNavButton}>
            <ChevronLeft color="#ffffff" size={28} style={styles.previewNavIcon} />
          </Pressable>
          <Pressable accessibilityLabel={translate("下一张")} accessibilityRole="button" onPress={onNext} style={styles.previewNavButton}>
            <ChevronRight color="#ffffff" size={28} style={styles.previewNavIcon} />
          </Pressable>
        </View>
      ) : null}
      {showThumbnails && resourceCount > 0 ? (
        <View style={[styles.previewThumbnailRail, { bottom: previewInsets.bottom + 8 }]}>
          <FlatList
            contentContainerStyle={styles.previewThumbnailList}
            data={resources}
            getItemLayout={(_data, index) => ({ index, length: 108, offset: 108 * index })}
            horizontal
            initialNumToRender={5}
            keyExtractor={(item) => item.id}
            maxToRenderPerBatch={6}
            onScrollToIndexFailed={({ index }) => thumbnailListRef.current?.scrollToOffset({ animated: true, offset: Math.max(0, index * 108) })}
            ref={thumbnailListRef}
            renderItem={({ index, item }) => (
              <Pressable
                accessibilityLabel={resolvedLocale === "en-US" ? `${index + 1} of ${resourceCount}` : `${index + 1}/${resourceCount}`}
                accessibilityRole="button"
                onPress={() => onSelect(item)}
                style={[styles.previewThumbnail, item.id === resource?.id && styles.previewThumbnailActive]}
              >
                <AuthenticatedResourceImage
                  alt={item.filename || "图片预览"}
                  resizeMode="contain"
                  source={getAuthenticatedResourceSource(item.url, session)}
                  style={styles.previewThumbnailImage}
                />
              </Pressable>
            )}
            showsHorizontalScrollIndicator={false}
            windowSize={5}
          />
        </View>
      ) : null}
    </View>
  </Modal>;
};

const RevisionHistoryModal = ({
  memo,
  onClose,
  onRestored,
}: {
  memo: MemoDetail | null;
  onClose: () => void;
  onRestored: (memo: MemoDetail) => void;
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
  const diffRows = selectedRevision ? buildRevisionDiffRows(selectedRevision.contentMarkdown, memo?.contentMarkdown ?? "") : null;
  const changedLines = diffRows?.changed ?? 0;

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
      onRestored(restoredMemo);
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
              <Text style={styles.settingsRowTitle}>{selectedRevision ? `版本 ${selectedRevision.revision} 与当前内容` : "未选择历史版本"}</Text>
              {selectedRevision ? <Text style={styles.revisionChangeBadge}>{`${changedLines} 行有变化`}</Text> : null}
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

          {selectedRevision ? <RevisionComparisonTable leftRows={diffRows?.leftRows ?? []} rightRows={diffRows?.rightRows ?? []} /> : null}
          {restoreRevisionMutation.error ? (
            <Text style={styles.errorText}>{restoreRevisionMutation.error instanceof Error ? restoreRevisionMutation.error.message : "恢复失败"}</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const RevisionComparisonTable = ({ leftRows, rightRows }: { leftRows: RevisionDiffRow[]; rightRows: RevisionDiffRow[] }) => {
  const hasContent = leftRows.some((row) => row.text) || rightRows.some((row) => row.text);

  return (
    <View style={styles.revisionComparisonTable}>
      <View style={styles.revisionComparisonHeader}>
        <Text style={styles.revisionComparisonHeaderText}>历史版本</Text>
        <Text style={styles.revisionComparisonHeaderText}>当前内容</Text>
      </View>
      {hasContent ? leftRows.map((leftRow, index) => (
        <View key={`${leftRow.lineNumber ?? "empty"}-${index}`} style={styles.revisionComparisonRow}>
          <RevisionDiffCell row={leftRow} tone="history" />
          <RevisionDiffCell row={rightRows[index] ?? { lineNumber: null, text: "", state: "empty" }} tone="current" />
        </View>
      )) : <Text style={styles.revisionComparisonEmpty}>空笔记</Text>}
    </View>
  );
};

const RevisionDiffCell = ({ row, tone }: { row: RevisionDiffRow; tone: "history" | "current" }) => (
  <View style={[styles.revisionComparisonCell, tone === "current" && styles.revisionComparisonCellCurrent, row.state === "changed" && (tone === "history" ? styles.revisionDiffRowHistory : styles.revisionDiffRowCurrent)]}>
    <Text style={styles.revisionComparisonLineNumber}>{row.lineNumber ?? ""}</Text>
    <Text style={[styles.revisionComparisonText, row.state === "empty" && styles.revisionDiffTextEmpty]}>{row.text || " "}</Text>
  </View>
);

const getAuthenticatedResourceSource = (
  source: string,
  session: { baseUrl: string; token: string } | null
) => {
  const baseUrl = session?.baseUrl.replace(/\/+$/, "") ?? "";
  const uri = source.startsWith("/") && baseUrl ? `${baseUrl}${source}` : source;
  const isProtectedResource = source.startsWith("/api/v1/resources/") || Boolean(baseUrl && uri.startsWith(`${baseUrl}/api/v1/resources/`));

  return {
    uri,
    ...(session?.token && isProtectedResource ? { headers: { Authorization: `Bearer ${session.token}` } } : {}),
  };
};

type CachedSvgResource = {
  aspectRatio: number | null;
  xml: string;
};

const AUTHENTICATED_SVG_CACHE_LIMIT = 24;
const authenticatedSvgCache = new Map<string, Promise<CachedSvgResource | null>>();
const getAuthenticatedSvgCacheKey = (source: ReturnType<typeof getAuthenticatedResourceSource>) =>
  `${source.uri}\n${source.headers?.Authorization ?? ""}`;
const loadAuthenticatedSvg = (source: ReturnType<typeof getAuthenticatedResourceSource>) => {
  const cacheKey = getAuthenticatedSvgCacheKey(source);
  const cached = authenticatedSvgCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  if (authenticatedSvgCache.size >= AUTHENTICATED_SVG_CACHE_LIMIT) {
    const oldestKey = authenticatedSvgCache.keys().next().value;
    if (oldestKey) {
      authenticatedSvgCache.delete(oldestKey);
    }
  }
  const pending = fetch(source.uri, { headers: source.headers })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Resource request failed with ${response.status}`);
      }
      if (!response.headers.get("Content-Type")?.toLowerCase().includes("svg")) {
        return null;
      }
      const xml = await response.text();
      const viewBox = xml.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
      const width = Number(viewBox?.[1]);
      const height = Number(viewBox?.[2]);
      return {
        aspectRatio: width > 0 && height > 0 ? width / height : null,
        xml,
      };
    })
    .catch(() => {
      authenticatedSvgCache.delete(cacheKey);
      return null;
    });
  authenticatedSvgCache.set(cacheKey, pending);
  return pending;
};

const AuthenticatedResourceImage = ({
  alt,
  fitAspect = false,
  resizeMode = "cover",
  source,
  style,
}: {
  alt: string;
  fitAspect?: boolean;
  resizeMode?: "center" | "contain" | "cover" | "repeat" | "stretch";
  source: ReturnType<typeof getAuthenticatedResourceSource>;
  style: StyleProp<ImageStyle>;
}) => {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [svgXml, setSvgXml] = useState<string | null>(null);
  const svgRequestStartedRef = useRef(false);
  const svgSourceKeyRef = useRef("");
  const svgSourceKey = getAuthenticatedSvgCacheKey(source);
  const imageStyle = fitAspect ? [style, { aspectRatio, height: undefined, width: "100%" as const }] : style;

  useEffect(() => {
    setSvgXml(null);
    setAspectRatio(16 / 9);
    svgRequestStartedRef.current = false;
    svgSourceKeyRef.current = svgSourceKey;
    const cached = authenticatedSvgCache.get(svgSourceKey);
    if (cached) {
      svgRequestStartedRef.current = true;
      void cached.then((result) => {
        if (!result || svgSourceKeyRef.current !== svgSourceKey) {
          return;
        }
        if (result.aspectRatio) {
          setAspectRatio(result.aspectRatio);
        }
        setSvgXml(result.xml);
      });
    }
    return () => {
      if (svgSourceKeyRef.current === svgSourceKey) {
        svgSourceKeyRef.current = "";
      }
    };
  }, [svgSourceKey]);

  const loadSvgFallback = () => {
    if (svgRequestStartedRef.current) {
      return;
    }
    svgRequestStartedRef.current = true;
    void loadAuthenticatedSvg(source)
      .then((result) => {
        if (!result || svgSourceKeyRef.current !== svgSourceKey) {
          return;
        }
        if (result.aspectRatio) {
          setAspectRatio(result.aspectRatio);
        }
        setSvgXml(result.xml);
      });
  };

  if (svgXml) {
    return (
      <View accessibilityLabel={alt || undefined} accessible={Boolean(alt)} style={imageStyle}>
        <SvgXml height="100%" width="100%" xml={svgXml} />
      </View>
    );
  }

  return (
    <RNImage
      accessibilityLabel={alt || undefined}
      accessible={Boolean(alt)}
      fadeDuration={Platform.OS === "android" ? 0 : undefined}
      onLoad={(event) => {
        const { height, width } = event.nativeEvent.source;
        if (height > 0 && width > 0) {
          setAspectRatio(width / height);
        }
      }}
      onError={loadSvgFallback}
      resizeMethod={Platform.OS === "android" ? "resize" : "auto"}
      resizeMode={resizeMode}
      source={source}
      style={imageStyle}
    />
  );
};

const MemoDetailModal = ({
  isDeleting,
  isLoading,
  isRestoring,
  isSaving,
  memo,
  notebookName,
  onClose,
  onDelete,
  onRichEdit,
  onOpenRevisions,
  onRestore,
  visible,
}: {
  isDeleting: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  isSaving: boolean;
  memo: MemoDetail | null;
  notebookName: string;
  onClose: () => void;
  onDelete: (memo: MemoDetail) => void;
  onRichEdit: (memo: MemoDetail) => void;
  onOpenRevisions: (memo: MemoDetail) => void;
  onRestore: (memo: MemoDetail) => void;
  visible: boolean;
}) => {
  const { session } = useSession();
  const { resolvedTheme } = useMobileTheme();
  const { resolvedLocale } = useMobileLocale();
  const { width: viewportWidth } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchReplaceOpen, setSearchReplaceOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const localePreference = useMobileLocalePreference();
  const themedDetailMarkdownStyles = useMemo(
    () => resolveMobileThemeStyles(detailMarkdownStyles, resolvedTheme),
    [resolvedTheme]
  );
  const detailMarkdownRules = useMemo<RenderRules>(() => {
    const availableTableWidth = Math.max(0, viewportWidth - DETAIL_CONTENT_HORIZONTAL_PADDING * 2);
    const getTableColumnCount = (node: ASTNode, parents: ASTNode[]) => {
      const table = node.type === "table" ? node : parents.find((parent) => parent.type === "table");
      const tableSection = table?.children.find((child) => child.type === "thead" || child.type === "tbody");
      const firstRow = tableSection?.children.find((child) => child.type === "tr");
      return Math.max(1, firstRow?.children.filter((child) => child.type === "th" || child.type === "td").length ?? 1);
    };
    const renderTableCell = (node: ASTNode, children: ReactNode[], parents: ASTNode[], markdownStyles: Record<string, StyleProp<ViewStyle>>, isHeader: boolean) => {
      const columnCount = getTableColumnCount(node, parents);
      const row = parents.find((parent) => parent.type === "tr");
      const cellIndex = row?.children.findIndex((child) => child.key === node.key) ?? -1;
      const isLastCell = cellIndex === (row?.children.length ?? 0) - 1;
      const wideCellStyle = columnCount > DETAIL_TABLE_FIT_COLUMN_COUNT
        ? { flex: 0, width: DETAIL_TABLE_MIN_COLUMN_WIDTH }
        : undefined;

      return (
        <View
          key={node.key}
          style={[
            markdownStyles[isHeader ? "_VIEW_SAFE_th" : "_VIEW_SAFE_td"],
            wideCellStyle,
            !isLastCell && markdownStyles._VIEW_SAFE_tableCellDivider,
          ]}
        >
          {children}
        </View>
      );
    };

    return {
      fence: (node, _children, _parents, markdownStyles, inheritedStyles = {}) => {
        const language = getMobileMarkdownFenceLanguage((node as ASTNode & { sourceInfo?: string }).sourceInfo);
        const content = trimMobileMarkdownFenceContent(node.content);
        if (language === "mermaid") {
          return (
            <MobileMermaidDiagram
              key={node.key}
              locale={resolvedLocale}
              source={content}
              theme={resolvedTheme}
            />
          );
        }
        return <RNText key={node.key} style={[inheritedStyles, markdownStyles.fence]}>{content}</RNText>;
      },
      image: (node, _children, _parents, markdownStyles) => (
        <AuthenticatedResourceImage
          alt={String(node.attributes.alt ?? "")}
          fitAspect
          key={node.key}
          resizeMode="contain"
          source={getAuthenticatedResourceSource(String(node.attributes.src ?? ""), session)}
          style={markdownStyles._VIEW_SAFE_image}
        />
      ),
      table: (node, children, parents, markdownStyles) => {
        const columnCount = getTableColumnCount(node, parents);
        const tableWidth = columnCount > DETAIL_TABLE_FIT_COLUMN_COUNT
          ? columnCount * DETAIL_TABLE_MIN_COLUMN_WIDTH
          : availableTableWidth;

        return (
          <ScrollView
            contentContainerStyle={markdownStyles._VIEW_SAFE_tableScrollContent}
            horizontal
            key={node.key}
            nestedScrollEnabled
            showsHorizontalScrollIndicator={columnCount > DETAIL_TABLE_FIT_COLUMN_COUNT}
            style={markdownStyles._VIEW_SAFE_tableScroll}
          >
            <View style={[markdownStyles._VIEW_SAFE_table, { width: tableWidth }]}>{children}</View>
          </ScrollView>
        );
      },
      td: (node, children, parents, markdownStyles) => renderTableCell(node, children, parents, markdownStyles, false),
      th: (node, children, parents, markdownStyles) => renderTableCell(node, children, parents, markdownStyles, true),
    };
  }, [resolvedLocale, resolvedTheme, session, viewportWidth]);
  const detailText = memo?.contentMarkdown || memo?.contentText || "没有正文内容";
  const searchMatches = useMemo(() => getTextSearchMatches(detailText, searchQuery), [detailText, searchQuery]);
  const searchMatchLabel = searchQuery.trim() ? `${searchMatches.length > 0 ? activeMatchIndex + 1 : 0}/${searchMatches.length}` : "0/0";
  const editFabBottom = Math.max(
    safeAreaInsets.bottom,
    Platform.OS === "android" ? ANDROID_SYSTEM_NAVIGATION_FALLBACK : 0
  ) + 16;

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [detailText, searchQuery]);

  const moveSearchMatch = (direction: 1 | -1) => {
    if (searchMatches.length === 0) {
      return;
    }

    setActiveMatchIndex((current) => (current + direction + searchMatches.length) % searchMatches.length);
  };

  const closeActionsAndRun = (action: () => void) => {
    setActionsOpen(false);
    action();
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaView style={styles.modalSafeArea}>
        <View style={styles.detailHeader}>
          <Pressable accessibilityLabel="返回列表" accessibilityRole="button" onPress={onClose} style={styles.detailHeaderButton}>
            <ChevronLeft color="#475569" size={21} />
          </Pressable>
          <View style={styles.detailHeaderActions}>
            <Text numberOfLines={1} style={styles.detailSyncStatus}>{isSaving ? "保存中" : "已保存"}</Text>
            {memo?.isDeleted ? (
              <Pressable accessibilityLabel="笔记操作" accessibilityRole="button" onPress={() => setActionsOpen(true)} style={styles.detailHeaderIconButton}>
                <MoreHorizontal color="#475569" size={21} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#0f172a" />
          </View>
        ) : memo ? (
          <ScrollView contentContainerStyle={styles.detailContent}>
            <Text style={styles.detailTitle}>{memo.title?.trim() || DEFAULT_MEMO_TITLE}</Text>
            <View style={styles.detailMetaRow}>
              <View style={styles.detailNotebookButton}>
                <Text numberOfLines={1} style={styles.detailNotebookName}>{notebookName}</Text>
                <ChevronDown color="#94a3b8" size={14} />
              </View>
              <View style={styles.detailTagsGroup}>
                <Tag color="#64748b" size={16} />
                <Text
                  numberOfLines={1}
                  style={[styles.detailTagsInline, memo.tags.length === 0 && styles.detailTagsPlaceholder]}
                >
                  {memo.tags.length ? memo.tags.join(", ") : "添加标签，用逗号分隔"}
                </Text>
              </View>
            </View>
            {searchOpen ? (
              <View style={styles.noteSearchPanel}>
                <View style={styles.searchBox}>
                  <Search color="#64748b" size={18} />
                  <TextInput
                    accessibilityLabel="在当前笔记内搜索"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setSearchQuery}
                    placeholder="在当前笔记内搜索"
                    placeholderTextColor="#94a3b8"
                    style={styles.searchInput}
                    value={searchQuery}
                  />
                  <Text style={[styles.noteSearchCount, searchQuery.trim() && searchMatches.length === 0 && styles.noteSearchCountEmpty]}>{searchMatchLabel}</Text>
                </View>
                {searchReplaceOpen ? (
                  <View style={styles.searchBox}>
                    <RefreshCw color="#94a3b8" size={18} />
                    <TextInput
                      accessibilityLabel="替换为"
                      editable={false}
                      placeholder="替换为"
                      placeholderTextColor="#94a3b8"
                      style={styles.searchInput}
                      value=""
                    />
                  </View>
                ) : null}
                <View style={styles.richEditorSearchActions}>
                  <ActionButton disabled={searchMatches.length === 0} label="上一个搜索结果" onPress={() => moveSearchMatch(-1)}>
                    <ChevronLeft color={searchMatches.length === 0 ? "#cbd5e1" : "#0f172a"} size={16} />
                  </ActionButton>
                  <ActionButton disabled={searchMatches.length === 0} label="下一个搜索结果" onPress={() => moveSearchMatch(1)}>
                    <ChevronRight color={searchMatches.length === 0 ? "#cbd5e1" : "#0f172a"} size={16} />
                  </ActionButton>
                  {searchReplaceOpen ? (
                    <ActionButton disabled label="全部替换" onPress={() => undefined}>
                      <RefreshCw color="#cbd5e1" size={16} />
                    </ActionButton>
                  ) : null}
                  <ActionButton label="关闭搜索" onPress={() => {
                    setSearchOpen(false);
                    setSearchReplaceOpen(false);
                    setSearchQuery("");
                  }}>
                    <X color="#0f172a" size={16} />
                  </ActionButton>
                </View>
              </View>
            ) : null}
            <View style={styles.detailDivider} />
            {searchOpen && searchQuery.trim() ? (
              <HighlightedDetailText activeIndex={activeMatchIndex} matches={searchMatches} text={detailText} />
            ) : (
              <MobileMermaidProvider theme={resolvedTheme}>
                <Markdown rules={detailMarkdownRules} style={themedDetailMarkdownStyles}>{detailText}</Markdown>
              </MobileMermaidProvider>
            )}
          </ScrollView>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>笔记加载失败</Text>
          </View>
        )}
        {memo && !memo.isDeleted ? (
          <Pressable
            accessibilityLabel="编辑笔记"
            accessibilityRole="button"
            onPress={() => {
              beginEditorStartup();
              onRichEdit(memo);
            }}
            style={[styles.detailEditFab, { bottom: editFabBottom }]}
          >
            <Pencil color="#ffffff" size={20} />
          </Pressable>
        ) : null}
        {memo?.isDeleted ? (
          <Modal animationType="fade" onRequestClose={() => setActionsOpen(false)} transparent visible={actionsOpen}>
            <Pressable onPress={() => setActionsOpen(false)} style={styles.actionSheetBackdrop}>
              <Pressable style={styles.actionSheet}>
                <View style={styles.actionSheetHandle} />
                <Text style={styles.actionSheetTitle}>笔记操作</Text>
                <ActionSheetItem icon={<Search color="#0f172a" size={18} />} label="搜索当前笔记" onPress={() => closeActionsAndRun(() => {
                  setSearchOpen(true);
                  setSearchReplaceOpen(false);
                })} />
                <ActionSheetItem icon={<RefreshCw color="#0f172a" size={18} />} label="替换当前笔记" onPress={() => closeActionsAndRun(() => {
                  setSearchOpen(true);
                  setSearchReplaceOpen(true);
                })} />
                <ActionSheetItem icon={<History color="#0f172a" size={18} />} label="版本历史" onPress={() => closeActionsAndRun(() => onOpenRevisions(memo))} />
                <ActionSheetItem disabled={isRestoring} icon={<RotateCcw color="#0f172a" size={18} />} label={isRestoring ? "恢复中" : "恢复笔记"} onPress={() => closeActionsAndRun(() => onRestore(memo))} />
                <View style={styles.listActionDivider} />
                <ActionSheetItem danger disabled={isDeleting} icon={<Trash2 color="#b91c1c" size={18} />} label={isDeleting ? "删除中" : "彻底删除"} onPress={() => closeActionsAndRun(() => onDelete(memo))} />
              </Pressable>
            </Pressable>
          </Modal>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
};

const HighlightedDetailText = ({
  activeIndex,
  matches,
  text,
}: {
  activeIndex: number;
  matches: Array<{ end: number; start: number }>;
  text: string;
}) => {
  if (matches.length === 0) {
    return <Text style={styles.detailMarkdown}>{text}</Text>;
  }

  const segments: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    if (match.start > cursor) {
      segments.push(text.slice(cursor, match.start));
    }

    segments.push(
      <Text key={`${match.start}-${match.end}`} style={index === activeIndex ? styles.noteSearchHighlightActive : styles.noteSearchHighlight}>
        {text.slice(match.start, match.end)}
      </Text>
    );
    cursor = match.end;
  });

  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  return <Text style={styles.detailMarkdown}>{segments}</Text>;
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
  const { client } = useSession();
  const { resolvedLocale } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  const restoredDraft = initialDraft?.expectedRevision === memo?.revision ? initialDraft : null;
  const initialContentJson = restoredDraft
    ? markdownToDoc(restoredDraft.contentMarkdown)
    : resolveMemoContentDoc(memo?.contentJson, memo?.contentMarkdown);
  const editorRef = useRef<LocalTiptapEditorRef>(null);
  const resourceDataUrlCacheRef = useRef(new Map<string, Promise<string | null>>());
  const initialFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentJsonRef = useRef<TiptapDoc>(initialContentJson);
  const contentMarkdownRef = useRef(restoredDraft?.contentMarkdown ?? memo?.contentMarkdown ?? "");
  const contentSnapshotRef = useRef(JSON.stringify(contentJsonRef.current));
  const dirtyRef = useRef(Boolean(restoredDraft));
  const flushResolverRef = useRef<(() => void) | null>(null);
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const [title, setTitle] = useState(resolveEditableMemoTitle(restoredDraft?.title ?? memo?.title));
  const [tagsText, setTagsText] = useState(restoredDraft?.tagsText ?? memo?.tags.join(", ") ?? "");
  const [notebookId, setNotebookId] = useState(restoredDraft?.notebookId ?? memo?.notebookId ?? "");
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(Boolean(restoredDraft));
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(Boolean(restoredDraft));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startupMs, setStartupMs] = useState<number | null>(null);
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

  const persistDraft = async (contentJson: TiptapDoc) => {
    if (!memo) {
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
      memoId: memo.id,
      expectedRevision: memo.revision,
      title: titleRef.current.trim(),
      contentMarkdown: contentMarkdownRef.current,
      notebookId: notebookIdRef.current,
      tagsText: tagsTextRef.current,
      updatedAt: new Date().toISOString(),
    });
  };

  const save = async () => {
    if (!memo || savingRef.current || !notebookIdRef.current) {
      return null;
    }
    if (!dirtyRef.current) {
      return memo;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);

    try {
      const savedMemo = await updateMutation.mutateAsync({
        memo,
        payload: {
          title: titleRef.current.trim() || DEFAULT_MEMO_TITLE,
          contentJson: contentJsonRef.current,
          contentMarkdown: contentMarkdownRef.current,
          notebookId: notebookIdRef.current,
          tags: parseTags(tagsTextRef.current),
        },
      });
      await clearMobileMemoDraft(memo.id);
      dirtyRef.current = false;
      setDirty(false);
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

  const flushEditor = async () => {
    if (!editorRef.current) {
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        flushResolverRef.current = null;
        resolve();
      };
      flushResolverRef.current = finish;
      editorRef.current?.flush();
      setTimeout(finish, 1000);
    });
  };

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
    const DocumentPicker = await import("expo-document-picker");
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "*/*",
    });
    const asset = result.canceled ? null : result.assets[0];
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
        editorRef.current?.beginImageUpload(uploadId, previewDataUrl);
      }
      const uploadAsset = await prepareUploadAsset(asset, imageCompressionEnabled);
      const form = new FormData();
      form.append("file", new ExpoFile(uploadAsset.uri));
      const { resource } = await client.uploadMemoResource(memo.id, form);
      if (resource.kind === "image" && uploadId) {
        editorRef.current?.completeImageUpload(
          uploadId,
          resource.url,
          resource.filename || uploadAsset.name || "图片"
        );
      } else {
        editorRef.current?.appendAttachment(resource.url, resource.filename || uploadAsset.name || "附件");
      }
    } catch (uploadError) {
      editorRef.current?.cancelImageUpload(uploadId);
      setError(uploadError instanceof Error ? uploadError.message : "附件上传失败");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const loadEditorResource = useCallback((source: string) => {
    if (!client) {
      return Promise.resolve(null);
    }
    const cached = resourceDataUrlCacheRef.current.get(source);
    if (cached) {
      return cached;
    }
    const pending = client.getResourceBlob(source).then(blobToDataUrl).catch(() => null);
    resourceDataUrlCacheRef.current.set(source, pending);
    return pending;
  }, [client]);

  const editorElement = useMemo(
    () => memo && baseUrl ? (
      <LocalTiptapEditor
        autoFocus
        baseUrl={baseUrl}
        content={contentJsonRef.current}
        dom={{
          bounces: false,
          contentInsetAdjustmentBehavior: "never",
          overScrollMode: "never",
          scrollEnabled: false,
          style: styles.richEditorWebView,
        }}
        onChange={persistDraft}
        onLoadResource={loadEditorResource}
        onPickImage={pickAndUploadImage}
        onReady={async (elapsedMs) => {
          setStartupMs(elapsedMs);
          setReady(true);
          recordEditorStartup(elapsedMs);
          if (initialFocusTimerRef.current !== null) {
            clearTimeout(initialFocusTimerRef.current);
          }
          initialFocusTimerRef.current = setTimeout(() => {
            initialFocusTimerRef.current = null;
            editorRef.current?.focusEnd();
            if (Platform.OS === "android") {
              showEdgeEverKeyboard();
            }
          }, 180);
        }}
        ref={editorRef}
        locale={resolvedLocale}
        theme={resolvedTheme}
      />
    ) : null,
    [baseUrl, loadEditorResource, memo?.id, resolvedLocale, resolvedTheme]
  );

  useEffect(() => {
    if (!memo || !dirty) {
      return;
    }
    const timeout = setTimeout(() => {
      void writeMobileMemoDraft({
        memoId: memo.id,
        expectedRevision: memo.revision,
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
    if (!memo || !dirty || !ready || savingRef.current || uploadingRef.current) {
      return;
    }
    const timeout = setTimeout(() => {
      void flushEditor().then(save);
    }, 1200);
    return () => clearTimeout(timeout);
  }, [dirty, memo, notebookId, ready, tagsText, title]);

  return (
    <SafeAreaView style={styles.richEditorSafeArea}>
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
              <TextInput
                autoCorrect
                onChangeText={(value) => {
                  setTagsText(value);
                  dirtyRef.current = true;
                  setDirty(true);
                }}
                placeholder="添加标签，用逗号分隔"
                placeholderTextColor="#94a3b8"
                style={[styles.createMemoTagsInput, styles.richStandaloneTagsInput]}
                value={tagsText}
              />
            </View>
            {draftRestored ? <Text style={styles.richEditorDraftNotice}>已恢复上次未完成的本地草稿</Text> : null}
            <View style={styles.richEditorFrame}>
              {!ready ? (
                <View style={styles.richEditorLoading}>
                  <ActivityIndicator color="#0f172a" />
                  <Text style={styles.mutedText}>正在启动本地编辑器</Text>
                </View>
              ) : null}
              {editorElement}
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
    </SafeAreaView>
  );
};

const MemoList = ({
  emptyAction,
  emptyDescription,
  emptyTitle,
  error,
  isError,
  initialSyncProgress,
  isLoading,
  isLoadingMore = false,
  isRefreshing,
  listDensity,
  memos,
  onMemoLongPress,
  onMemoPress,
  onLoadMore,
  onRefresh,
  onRetry,
  selectionMode = false,
  selectedMemoIds = new Set(),
}: {
  emptyAction?: { label: string; onPress: () => void };
  emptyDescription: string;
  emptyTitle: string;
  error?: unknown;
  isError: boolean;
  initialSyncProgress: MobileBootstrapProgress | null;
  isLoading: boolean;
  isLoadingMore?: boolean;
  isRefreshing: boolean;
  listDensity: MobileMemoListDensity;
  memos: MemoSummary[];
  onMemoLongPress?: (memo: MemoSummary) => void;
  onMemoPress: (memoId: string) => void;
  onLoadMore?: () => void;
  onRefresh: () => void;
  onRetry?: () => void;
  selectionMode?: boolean;
  selectedMemoIds?: Set<string>;
}) => {
  const localePreference = useMobileLocalePreference();
  const englishLocale = isEnglishMobileLocale(localePreference);
  const hasInitialSyncProgress = initialSyncProgress !== null;
  const loadedCount = initialSyncProgress?.loadedCount ?? 0;
  const totalCount = initialSyncProgress?.totalCount ?? 0;
  const progressPercent = totalCount > 0 ? Math.min(100, Math.round((loadedCount / totalCount) * 100)) : 0;
  const progressTitle = englishLocale ? "Syncing your notes" : "正在同步笔记";
  const progressDescription = totalCount > 0
    ? (englishLocale ? `${loadedCount} of ${totalCount} notes loaded` : `已加载 ${loadedCount} / ${totalCount} 条笔记`)
    : (englishLocale ? "Preparing your notes for the first sync…" : "正在准备首次同步…");
  const loadingTitle = hasInitialSyncProgress ? progressTitle : (englishLocale ? "Loading notes" : "正在加载笔记");
  const loadingDescription = hasInitialSyncProgress
    ? progressDescription
    : (englishLocale ? "Loading notebooks and notes…" : "正在加载笔记本和笔记…");

  if ((isLoading || hasInitialSyncProgress) && memos.length === 0) {
    return (
      <View accessibilityLabel={loadingTitle} accessibilityLiveRegion="polite" style={styles.memoListStateWrap}>
        <View style={styles.memoListLoadingCard}>
          <ActivityIndicator color="#059669" size="large" />
          <Text style={styles.memoListLoadingTitle}>{loadingTitle}</Text>
          <Text style={styles.memoListLoadingDescription}>{loadingDescription}</Text>
          {totalCount > 0 ? (
            <View style={styles.memoSyncProgressTrack}>
              <View style={[styles.memoSyncProgressFill, { width: `${progressPercent}%` }]} />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  if (isError && memos.length === 0) {
    return (
      <View style={styles.memoListStateWrap}>
        <View style={styles.memoListErrorCard}>
          <Text style={styles.memoListErrorTitle}>暂时没有拉到笔记</Text>
          <Text style={styles.memoListErrorDescription}>网络或 PWA 后台恢复可能短暂中断了同步。这里不会把它当作空笔记本。</Text>
        {onRetry ? (
          <Pressable accessibilityLabel="重试加载" accessibilityRole="button" onPress={onRetry} style={styles.memoListRetryButton}>
            <RotateCcw color="#92400e" size={17} />
            <Text style={styles.memoListRetryText}>重试</Text>
          </Pressable>
        ) : null}
        </View>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={memos.length === 0 ? styles.emptyList : styles.list}
      data={memos}
      initialNumToRender={10}
      keyExtractor={(memo) => memo.id}
      maxToRenderPerBatch={8}
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.35}
      removeClippedSubviews={Platform.OS === "android"}
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} tintColor="#0f172a" />}
      style={styles.memoList}
      renderItem={({ item }) => (
        <MemoCard
          memo={item}
          listDensity={listDensity}
          onLongPress={!selectionMode && onMemoLongPress ? () => onMemoLongPress(item) : undefined}
          onPress={() => onMemoPress(item.id)}
          selected={selectedMemoIds.has(item.id)}
          selectionMode={selectionMode}
        />
      )}
      ListEmptyComponent={
        <View style={styles.memoListEmptyCard}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.mutedText}>{emptyDescription}</Text>
          {emptyAction ? (
            <Pressable accessibilityRole="button" onPress={emptyAction.onPress} style={styles.emptyActionButton}>
              <Plus color="#ffffff" size={18} />
              <Text style={styles.emptyActionButtonText}>{emptyAction.label}</Text>
            </Pressable>
          ) : null}
        </View>
      }
      ListHeaderComponent={hasInitialSyncProgress ? (
          <View accessibilityLiveRegion="polite" style={styles.memoSyncBanner}>
            <ActivityIndicator color="#059669" size="small" />
            <View style={styles.memoSyncBannerContent}>
              <Text style={styles.memoSyncBannerTitle}>{progressTitle}</Text>
              <Text style={styles.memoSyncBannerDescription}>{progressDescription}</Text>
              <View style={styles.memoSyncProgressTrack}>
                <View style={[styles.memoSyncProgressFill, { width: `${progressPercent}%` }]} />
              </View>
            </View>
          </View>
        ) : isError ? (
          <View accessibilityLiveRegion="polite" style={styles.memoSyncErrorBanner}>
            <View style={styles.memoSyncBannerContent}>
              <Text style={styles.memoSyncErrorBannerTitle}>{englishLocale ? "Sync paused" : "同步已暂停"}</Text>
              <Text style={styles.memoSyncErrorBannerDescription}>
                {englishLocale ? "Loaded notes remain available. Check your connection and retry." : "已加载的笔记仍可使用，请检查网络后重试。"}
              </Text>
            </View>
            {onRetry ? (
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.memoSyncErrorRetryButton}>
                <RotateCcw color="#92400e" size={15} />
                <Text style={styles.memoListRetryText}>{englishLocale ? "Retry" : "重试"}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator color="#0f172a" style={styles.listLoadingFooter} /> : null}
      updateCellsBatchingPeriod={32}
      windowSize={7}
    />
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

const SelectionActionBar = ({
  bottomInset,
  canMove,
  isBusy,
  isTrashView,
  onDelete,
  onMore,
  onMove,
  selectedCount,
}: {
  bottomInset: number;
  canMove: boolean;
  isBusy: boolean;
  isTrashView: boolean;
  onDelete: () => void;
  onMore: () => void;
  onMove: () => void;
  selectedCount: number;
}) => (
  <View accessibilityLabel="批量操作" style={[styles.selectionBar, { paddingBottom: Math.max(2, bottomInset) }]}>
    <View style={styles.selectionActions}>
      <SelectionAction disabled={isBusy || !canMove} icon={<Folder color={canMove ? "#0f172a" : "#cbd5e1"} size={20} />} label="移动" onPress={onMove} />
      <SelectionAction danger disabled={isBusy || selectedCount === 0} icon={<Trash2 color={selectedCount === 0 ? "#cbd5e1" : "#b91c1c"} size={20} />} label={isTrashView ? "永久删除" : "删除"} onPress={onDelete} />
      <SelectionAction disabled={isBusy} icon={<MoreVertical color="#0f172a" size={20} />} label="更多" onPress={onMore} />
    </View>
  </View>
);

const SelectionMoreModal = ({
  bottomOffset,
  canMerge,
  canPin,
  canToggleVisibleSelection,
  onClear,
  onClose,
  onMerge,
  onPin,
  onToggleVisibleSelection,
  pinLabel,
  selectedCount,
  selectionToggleLabel,
  visible,
}: {
  bottomOffset: number;
  canMerge: boolean;
  canPin: boolean;
  canToggleVisibleSelection: boolean;
  onClear: () => void;
  onClose: () => void;
  onMerge: () => void;
  onPin: () => void;
  onToggleVisibleSelection: () => void;
  pinLabel: string;
  selectedCount: number;
  selectionToggleLabel: string;
  visible: boolean;
}) => (
  <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
    <Pressable onPress={onClose} style={[styles.actionSheetBackdrop, { paddingBottom: bottomOffset }]}>
      <Pressable style={styles.selectionMoreSheet}>
        <View style={styles.actionSheetHandle} />
        <View style={styles.listActionSheetHeader}>
          <View style={styles.listActionSheetHeaderText}>
            <Text style={styles.actionSheetTitle}>批量操作</Text>
            <Text style={styles.actionSheetSubtitle}>{selectedCount > 0 ? `已选择 ${selectedCount} 条` : "选择笔记"}</Text>
          </View>
          <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
            <X color="#0f172a" size={18} />
          </Pressable>
        </View>
        <ActionSheetItem disabled={!canToggleVisibleSelection} icon={<CheckSquare color={canToggleVisibleSelection ? "#0f172a" : "#cbd5e1"} size={18} />} label={selectionToggleLabel} onPress={onToggleVisibleSelection} />
        <ActionSheetItem disabled={!canMerge} icon={<Merge color={canMerge ? "#0f172a" : "#cbd5e1"} size={18} />} label="合并笔记" onPress={onMerge} />
        <ActionSheetItem disabled={!canPin} icon={<Sparkles color={canPin ? "#0f172a" : "#cbd5e1"} size={18} />} label={pinLabel} onPress={onPin} />
        <ActionSheetItem icon={<X color="#0f172a" size={18} />} label="取消选择" onPress={onClear} />
      </Pressable>
    </Pressable>
  </Modal>
);

const SelectionAction = ({
  danger = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <Pressable disabled={disabled} onPress={onPress} style={[styles.selectionAction, disabled && styles.buttonDisabled]}>
    {icon}
    <Text style={[styles.selectionActionText, danger && styles.selectionActionTextDanger]}>{label}</Text>
  </Pressable>
);

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

const MobileFilterButton = ({ active, icon, label, onPress }: { active: boolean; icon: ReactNode; label: string; onPress: () => void }) => (
  <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    style={[styles.mobileFilterButton, active && styles.mobileFilterButtonActive]}
  >
    {icon}
  </Pressable>
);

const MemoCard = memo(function MemoCard({
  listDensity,
  memo,
  onLongPress,
  onPress,
  selected = false,
  selectionMode = false,
}: {
  listDensity: MobileMemoListDensity;
  memo: MemoSummary;
  onLongPress?: () => void;
  onPress: () => void;
  selected?: boolean;
  selectionMode?: boolean;
}) {
  const localePreference = useMobileLocalePreference();
  const memoTitle = memo.title?.trim() || DEFAULT_MEMO_TITLE;
  const pressScale = useSharedValue(1);
  const pressAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.duration(260).springify().damping(18)}
      exiting={FadeOutUp.duration(220)}
      layout={LinearTransition.duration(220)}
      style={[
        styles.memoCard,
        listDensity === "compact" && styles.memoCardCompact,
        selected && styles.memoCardSelected,
        pressAnimatedStyle,
      ]}
    >
      {selectionMode ? (
        <Pressable
          accessibilityLabel={`${selected ? "取消选择" : "选择"} ${memoTitle}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          onPress={onPress}
          style={styles.memoSelectionButton}
        >
          <View style={[styles.selectionIndicator, selected && styles.selectionIndicatorActive]}>
            {selected ? <Check color="#ffffff" size={14} /> : null}
          </View>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={memoTitle}
        accessibilityRole="button"
        delayLongPress={520}
        onLongPress={onLongPress}
        onPress={onPress}
        onPressIn={() => {
          pressScale.value = withTiming(0.985, { duration: 100 });
        }}
        onPressOut={() => {
          pressScale.value = withTiming(1, { duration: 160 });
        }}
        style={[styles.memoCardContent, listDensity === "compact" && styles.memoCardContentCompact, selectionMode && styles.memoCardContentWithSelection]}
      >
        <View style={styles.memoCardTop}>
          {memo.isPinned ? (
            <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.memoPinnedStar}>★</Text>
          ) : null}
          <Text numberOfLines={1} style={styles.memoTitle}>
            {memoTitle}
          </Text>
        </View>
        {listDensity === "preview" ? (
          <Text numberOfLines={2} style={styles.memoExcerpt}>
            {memo.excerpt || "空笔记"}
          </Text>
        ) : null}
        <View style={[styles.memoMeta, listDensity === "compact" && styles.memoMetaCompact]}>
          <Text style={styles.memoDate}>{formatMemoPreviewDate(memo.updatedAt, localePreference)}</Text>
          {memo.tags.slice(0, 3).map((tag) => (
            <Text key={tag} style={styles.tag}>
              #{tag}
            </Text>
          ))}
        </View>
      </Pressable>
    </Animated.View>
  );
}, (previous, next) =>
  previous.memo === next.memo &&
  previous.listDensity === next.listDensity &&
  previous.selected === next.selected &&
  previous.selectionMode === next.selectionMode
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

const parseTags = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );

const useDebouncedValue = <T,>(value: T, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timeout);
  }, [delay, value]);

  return debouncedValue;
};

const flattenNotebooks = (notebooks: Notebook[]) => {
  const byParent = new Map<string | null, Notebook[]>();
  const byId = new Set(notebooks.map((notebook) => notebook.id));
  const result: NotebookOption[] = [];

  for (const notebook of notebooks) {
    const parentId = notebook.parentId && byId.has(notebook.parentId) ? notebook.parentId : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(notebook);
    byParent.set(parentId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort(compareNotebooksManual);
  }

  const walk = (parentId: string | null, depth: number) => {
    for (const notebook of byParent.get(parentId) ?? []) {
      result.push({ notebook, depth });
      walk(notebook.id, depth + 1);
    }
  };

  walk(null, 0);
  return result;
};

const compareNotebooksManual = (left: Notebook, right: Notebook) =>
  left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id);

const filterNotebookOptions = (options: NotebookOption[], searchText: string) => {
  const query = searchText.trim().toLowerCase();

  if (!query) {
    return options;
  }

  return options.filter(({ notebook }) => notebook.name.toLowerCase().includes(query) || (notebook.slug || "").toLowerCase().includes(query));
};

const filterNotebookOptionsById = (options: NotebookOption[], visibleIds: ReadonlySet<string>) =>
  options.filter(({ notebook }) => visibleIds.has(notebook.id));

const getNotebookParentIdSet = (notebooks: Notebook[]) => {
  const notebookIds = new Set(notebooks.map((notebook) => notebook.id));
  const parentIds = new Set<string>();

  for (const notebook of notebooks) {
    if (notebook.parentId && notebookIds.has(notebook.parentId)) {
      parentIds.add(notebook.parentId);
    }
  }

  return parentIds;
};

const getNotebookAncestorIds = (notebooks: Notebook[], notebookId: string) => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const ancestorIds = new Set<string>();
  let current = byId.get(notebookId);

  while (current?.parentId) {
    if (ancestorIds.has(current.parentId)) {
      break;
    }
    ancestorIds.add(current.parentId);
    current = byId.get(current.parentId);
  }

  return ancestorIds;
};

const filterCollapsedNotebookOptions = (options: NotebookOption[], collapsedNotebookIds: Set<string>) => {
  if (collapsedNotebookIds.size === 0) {
    return options;
  }

  const visibleOptions: NotebookOption[] = [];
  let hiddenDepth: number | null = null;

  for (const option of options) {
    if (hiddenDepth !== null && option.depth > hiddenDepth) {
      continue;
    }

    hiddenDepth = null;
    visibleOptions.push(option);

    if (collapsedNotebookIds.has(option.notebook.id)) {
      hiddenDepth = option.depth;
    }
  }

  return visibleOptions;
};

const isNotebookDescendant = (notebooks: Notebook[], candidateNotebookId: string, ancestorNotebookId: string) => {
  let current = notebooks.find((notebook) => notebook.id === candidateNotebookId) ?? null;

  while (current?.parentId) {
    if (current.parentId === ancestorNotebookId) {
      return true;
    }

    current = notebooks.find((notebook) => notebook.id === current?.parentId) ?? null;
  }

  return false;
};

const getResolvedMobileLocale = (localePreference: MobileLocaleMode) =>
  localePreference === "system" ? Intl.DateTimeFormat().resolvedOptions().locale || "zh-CN" : localePreference;

const isEnglishMobileLocale = (localePreference: MobileLocaleMode) => getResolvedMobileLocale(localePreference).startsWith("en");

const getMobileAdvancedPrompts = (localePreference: MobileLocaleMode) =>
  isEnglishMobileLocale(localePreference) ? ADVANCED_PROMPTS_EN : ADVANCED_PROMPTS_ZH;

const getMobileSystemInfoText = (localePreference: MobileLocaleMode) =>
  isEnglishMobileLocale(localePreference)
    ? {
        appIdentifier: "App identifier",
        build: "Build",
        description: "View the current app version, build identifier, and runtime environment.",
        disconnected: "Disconnected",
        followSystem: "Follow system",
        installMode: "Mode",
        instanceUrl: "Instance URL",
        language: "Language",
        memoCount: "Notes",
        notSet: "Not set",
        notebookCount: "Notebooks",
        platform: "Platform",
        platformVersion: "Platform version",
        timeZone: "Time zone",
        title: "System info",
        unknown: "Unknown",
        version: "Version",
      }
    : {
        appIdentifier: "应用标识",
        build: "构建",
        description: "查看当前应用版本、构建标识和运行环境。",
        disconnected: "未连接",
        followSystem: "跟随系统",
        installMode: "安装形态",
        instanceUrl: "实例地址",
        language: "语言",
        memoCount: "笔记总数",
        notSet: "未设置",
        notebookCount: "笔记本数量",
        platform: "平台",
        platformVersion: "平台版本",
        timeZone: "时区",
        title: "系统信息",
        unknown: "未知",
        version: "版本",
      };

const getMobileSystemInfoItems = (localePreference: MobileLocaleMode) => {
  const copy = getMobileSystemInfoText(localePreference);
  const resolvedLocale = getResolvedMobileLocale(localePreference);

  return [
    { label: copy.version, value: `v${MOBILE_APP_VERSION}` },
    { label: copy.build, value: __DEV__ ? "development" : "production" },
    { label: copy.platform, value: Platform.OS },
    { label: copy.platformVersion, value: String(Platform.Version) },
    { label: copy.language, value: localePreference === "system" ? `${resolvedLocale} (${copy.followSystem})` : resolvedLocale },
    { label: copy.timeZone, value: Intl.DateTimeFormat().resolvedOptions().timeZone || copy.unknown },
    { label: copy.installMode, value: formatExecutionEnvironment(Constants.executionEnvironment, localePreference) },
  ];
};

const buildMobileFeedbackUrl = (localePreference: MobileLocaleMode) => {
  const english = isEnglishMobileLocale(localePreference);

  return buildGitHubFeedbackUrl({
    contentHeading: english ? "Feedback" : "反馈内容",
    contentPrompt: english
      ? "Describe the problem, steps to reproduce it, or the feature you would like to see."
      : "请描述遇到的问题、复现步骤，或你希望增加的功能。",
    privacyNotice: english
      ? "GitHub Issues are public. Do not include passwords, tokens, instance URLs, or private note content."
      : "GitHub Issue 公开可见，请勿提交密码、Token、实例地址或私人笔记内容。",
    systemInfo: getMobileSystemInfoItems(localePreference),
    systemInfoHeading: english ? "System information" : "系统信息",
    systemInfoNotice: english
      ? "The following information was generated by EdgeEver to help diagnose the issue."
      : "以下信息由 EdgeEver 自动生成，可帮助定位问题。",
    titlePrefix: english ? "[Feedback] " : "[反馈] ",
  });
};

const formatDate = (value: string, localePreference: MobileLocaleMode = "system") =>
  new Intl.DateTimeFormat(getResolvedMobileLocale(localePreference), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatMemoPreviewDate = (value: string, localePreference: MobileLocaleMode = "system") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const memoDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const locale = getResolvedMobileLocale(localePreference);
  if (memoDay === today) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (memoDay === today - 24 * 60 * 60 * 1000) {
    return isEnglishMobileLocale(localePreference) ? "Yesterday" : "昨天";
  }
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" }).format(date);
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${exponent === 0 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)} ${units[exponent]}`;
};

const isDocumentResource = (resource: ResourceListItem) => DOCUMENT_MIME_TYPES.has(resource.mimeType || "") || resource.kind === "attachment";

const getResourceIcon = (resource: ResourceListItem) => {
  const mime = (resource.mimeType || "").toLowerCase();
  const extension = (resource.filename || "").split(".").pop()?.toLowerCase() || "";

  if (mime.startsWith("image/")) {
    return <ImageIcon color="#10b981" size={28} />;
  }

  if (mime.startsWith("audio/")) {
    return <Music color="#0ea5e9" size={28} />;
  }

  if (mime.startsWith("video/")) {
    return <Video color="#e11d48" size={28} />;
  }

  if (mime === "application/pdf" || extension === "pdf") {
    return <FileText color="#dc2626" size={28} />;
  }

  if (mime.includes("spreadsheet") || mime.includes("excel") || ["xls", "xlsx", "csv"].includes(extension)) {
    return <FileSpreadsheet color="#16a34a" size={28} />;
  }

  if (mime.includes("word") || mime.includes("officedocument.wordprocessingml") || ["doc", "docx"].includes(extension)) {
    return <FileText color="#2563eb" size={28} />;
  }

  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || ["zip", "rar", "tar", "gz"].includes(extension)) {
    return <FileArchive color="#f59e0b" size={28} />;
  }

  return <FileText color="#64748b" size={28} />;
};

const openResource = (resource: ResourceListItem) => {
  Linking.openURL(resource.url).catch(() => {
    Alert.alert("无法打开资源", "系统没有可用应用打开此链接。");
  });
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error("资源读取失败"));
  reader.onloadend = () => {
    if (typeof reader.result === "string") {
      resolve(reader.result);
      return;
    }
    reject(new Error("资源读取失败"));
  };
  reader.readAsDataURL(blob);
});

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

const createOptimisticMemo = (
  memo: MemoDetail,
  payload: MobileMemoUpdatePayload
): MemoDetail => {
  const contentMarkdown = payload.contentMarkdown ?? memo.contentMarkdown;
  const contentText = markdownToLocalText(contentMarkdown);

  return {
    ...memo,
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.isPinned !== undefined ? { isPinned: payload.isPinned } : {}),
    ...(payload.notebookId !== undefined ? { notebookId: payload.notebookId } : {}),
    ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
    ...(payload.contentJson !== undefined ? { contentJson: payload.contentJson } : {}),
    ...(payload.contentMarkdown !== undefined
      ? {
          contentMarkdown,
          contentText,
          excerpt: contentText.slice(0, 180),
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
};

const applyOptimisticMemoToCache = (queryClient: QueryClient, previousMemo: MemoDetail, nextMemo: MemoDetail) => {
  const detailQueries = queryClient.getQueryCache().findAll({ queryKey: ["mobile", "memo"] });

  for (const query of detailQueries) {
    const data = query.state.data as { memo?: MemoDetail } | undefined;
    if (data?.memo?.id === nextMemo.id || data?.memo?.id === previousMemo.id) {
      queryClient.setQueryData(query.queryKey, { ...data, memo: nextMemo });
    }
  }

  const listQueries = queryClient.getQueryCache().findAll({ queryKey: ["mobile", "memos"] });

  for (const query of listQueries) {
    const data = query.state.data as InfiniteData<Awaited<ReturnType<typeof listLocalMemos>>, number> | undefined;
    if (!Array.isArray(data?.pages) || data.pages.length === 0) {
      continue;
    }

    const previouslyMatched = memoMatchesListQuery(previousMemo, query.queryKey);
    const nextMatches = memoMatchesListQuery(nextMemo, query.queryKey);
    const flattened = data.pages.flatMap((page) => page.memos);
    const withoutMemo = flattened.filter((memo) => memo.id !== nextMemo.id && memo.id !== previousMemo.id);
    const nextMemos = nextMatches ? sortMemoSummaries([nextMemo, ...withoutMemo], query.queryKey[5]) : withoutMemo;
    const totalCount = Math.max(0, data.pages[0].totalCount + (nextMatches ? 1 : 0) - (previouslyMatched ? 1 : 0));
    let cursor = 0;
    const pages = data.pages.map((page, index) => {
      const pageSize = index === data.pages.length - 1 ? Math.min(page.memos.length, Math.max(0, nextMemos.length - cursor)) : page.memos.length;
      const memos = nextMemos.slice(cursor, cursor + pageSize);
      cursor += pageSize;
      return { ...page, memos, totalCount };
    });

    queryClient.setQueryData(query.queryKey, { ...data, pages });
  }

  const searchQueries = queryClient.getQueryCache().findAll({ queryKey: ["mobile", "search"] });
  for (const query of searchQueries) {
    const data = query.state.data as InfiniteData<Awaited<ReturnType<typeof listLocalMemos>>, number> | undefined;
    if (Array.isArray(data?.pages) && data.pages.some((page) => page.memos.some((memo) => memo.id === nextMemo.id || memo.id === previousMemo.id))) {
      queryClient.setQueryData(query.queryKey, {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          memos: page.memos.map((memo) => (memo.id === nextMemo.id || memo.id === previousMemo.id ? nextMemo : memo)),
        })),
      });
    }
  }

  if (previousMemo.notebookId !== nextMemo.notebookId) {
    queryClient.setQueriesData<{ notebooks: Notebook[] }>({ queryKey: ["mobile", "notebooks"] }, (data) => {
      if (!data) {
        return data;
      }

      return {
        ...data,
        notebooks: data.notebooks.map((notebook) => {
          if (notebook.id === previousMemo.notebookId) {
            return { ...notebook, memoCount: Math.max(0, notebook.memoCount - 1) };
          }
          if (notebook.id === nextMemo.notebookId) {
            return { ...notebook, memoCount: notebook.memoCount + 1, lastMemoUpdatedAt: nextMemo.updatedAt };
          }
          return notebook;
        }),
      };
    });
  }
};

const findCachedMemoDetail = (queryClient: QueryClient, memoId: string) => {
  const detailQueries = queryClient.getQueryCache().findAll({ queryKey: ["mobile", "memo"] });

  for (const query of detailQueries) {
    const data = query.state.data as { memo?: MemoDetail } | undefined;
    if (data?.memo?.id === memoId) {
      return data.memo;
    }
  }

  return null;
};

const memoMatchesListQuery = (memo: MemoSummary, queryKey: readonly unknown[]) => {
  const view = queryKey[2];
  const notebookId = queryKey[3];
  const filter = queryKey[4];
  const notebookIds = Array.isArray(queryKey[6]) ? queryKey[6] : [];

  if ((view === "trash") !== memo.isDeleted) {
    return false;
  }
  if (notebookId !== ALL_NOTES_ID && !notebookIds.includes(memo.notebookId)) {
    return false;
  }
  if (filter === "tagged" && memo.tags.length === 0) {
    return false;
  }
  if (filter === "untagged" && memo.tags.length > 0) {
    return false;
  }
  if (filter === "pinned" && !memo.isPinned) {
    return false;
  }

  return true;
};

const sortMemoSummaries = (memos: MemoSummary[], sortMode: unknown) =>
  [...memos].sort((left, right) => {
    if (sortMode === "title-asc") {
      return (left.title || DEFAULT_MEMO_TITLE).localeCompare(right.title || DEFAULT_MEMO_TITLE);
    }
    if (sortMode === "created-desc") {
      return right.createdAt.localeCompare(left.createdAt);
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });

const markdownToLocalText = (markdown: string) =>
  markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getTokenScopeLabel = (scope: string) => {
  const labels: Record<string, string> = {
    "read:notebooks": "读取笔记本",
    "write:notebooks": "创建与修改笔记本",
    "read:memos": "读取笔记",
    "write:memos": "创建与修改笔记",
    "read:resources": "读取附件资源",
    "write:resources": "上传与修改附件",
    "read:tags": "读取标签",
    "write:tags": "创建与修改标签",
  };

  return labels[scope] ?? scope;
};

const getTextSearchMatches = (text: string, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const normalizedText = text.toLowerCase();
  const matches: Array<{ end: number; start: number }> = [];
  let cursor = 0;

  while (cursor < normalizedText.length) {
    const start = normalizedText.indexOf(normalizedQuery, cursor);

    if (start === -1) {
      break;
    }

    const end = start + normalizedQuery.length;
    matches.push({ end, start });
    cursor = end;
  }

  return matches;
};

const buildMcpRemoteConfig = (baseUrl: string, token: string) =>
  JSON.stringify(
    {
      mcpServers: {
        edgeever: {
          url: `${baseUrl.replace(/\/+$/, "")}/mcp`,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2
  );

const formatRevisionActor = (actor: string) => {
  if (actor.startsWith("user:")) {
    return "user";
  }

  if (actor.startsWith("agent:")) {
    return "agent";
  }

  return actor || "system";
};

const detailMarkdownStyles = StyleSheet.create({
  body: {
    color: "#0f172a",
    fontSize: 17,
    lineHeight: 27,
  },
  blockquote: {
    backgroundColor: "#f8fafc",
    borderLeftColor: "#94a3b8",
    borderLeftWidth: 3,
    marginVertical: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bullet_list: {
    marginVertical: 8,
  },
  code_inline: {
    backgroundColor: "#f1f5f9",
    borderRadius: 4,
    color: "#334155",
    fontSize: 15,
  },
  fence: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 14,
    marginVertical: 10,
    padding: 12,
  },
  heading1: {
    color: "#0f172a",
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 34,
    marginBottom: 10,
    marginTop: 14,
  },
  heading2: {
    color: "#0f172a",
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 29,
    marginBottom: 8,
    marginTop: 18,
  },
  heading3: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 26,
    marginBottom: 6,
    marginTop: 14,
  },
  link: {
    color: "#059669",
  },
  list_item: {
    marginVertical: 3,
  },
  ordered_list: {
    marginVertical: 8,
  },
  paragraph: {
    marginBottom: 10,
    marginTop: 0,
  },
  strong: {
    fontWeight: "800",
  },
  table: {
    backgroundColor: "#ffffff",
    borderColor: "#d8d8d8",
    borderRadius: 2,
    borderWidth: 1,
    overflow: "hidden",
  },
  tableCellDivider: {
    borderRightColor: "#dedede",
    borderRightWidth: 1,
  },
  tableScroll: {
    marginBottom: 10,
    marginTop: 10,
    maxWidth: "100%",
  },
  tableScrollContent: {
    flexGrow: 1,
  },
  td: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  th: {
    backgroundColor: "#f2f2f2",
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  tr: {
    borderBottomColor: "#dedede",
    borderBottomWidth: 1,
    flexDirection: "row",
  },
});

const baseWorkspaceStyles = StyleSheet.create({
  editorRuntimePrewarm: {
    position: "absolute",
    left: -2,
    top: -2,
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  safeArea: {
    backgroundColor: "#f8fafc",
    flex: 1,
  },
  viewBody: {
    flex: 1,
    paddingBottom: 0,
  },
  settingsScreen: {
    backgroundColor: "#f8fafc",
    flex: 1,
  },
  settingsHeader: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 12,
  },
  settingsBackButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  settingsThemeButton: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  settingsThemeText: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
  },
  settingsHeaderTitle: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-start",
  },
  settingsTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "800",
  },
  settingsScrollContent: {
    padding: 16,
    paddingBottom: 96,
  },
  settingsMenu: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  settingsMenuRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: 16,
  },
  settingsMenuRowBorder: {
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
  },
  settingsMenuLabel: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  settingsMenuIcon: {
    alignItems: "center",
    backgroundColor: "#ecfdf5",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  settingsMenuText: {
    color: "#1e293b",
    fontSize: 14,
    fontWeight: "700",
  },
  settingsFeedbackCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  settingsFeedbackDescription: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 17,
  },
  settingsFeedbackIcon: {
    backgroundColor: "#f1f5f9",
  },
  settingsDetailList: {
    gap: 16,
  },
  settingsGroup: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  settingsAiEmbeddedCardFirst: {
    borderRadius: 0,
    borderWidth: 0,
  },
  settingsAiEmbeddedCard: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRadius: 0,
    borderRightWidth: 0,
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
  },
  settingsEmbeddedSection: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRadius: 0,
    borderRightWidth: 0,
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
  },
  settingsGroupHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    padding: 16,
  },
  settingsGroupTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
  },
  settingsContentRow: {
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
    gap: 10,
    minHeight: 64,
    padding: 16,
  },
  settingsSelect: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  settingsSelectText: {
    color: "#0f172a",
    flex: 1,
    fontSize: 14,
  },
  settingsSwitchStart: {
    alignItems: "flex-start",
  },
  settingsRowTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700",
  },
  settingsRowDescription: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 17,
  },
  settingsLinkDescription: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
  },
  settingsAccordionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingRight: 16,
  },
  settingsAccordionChevron: {
    transform: [{ rotate: "0deg" }],
  },
  settingsAccordionChevronExpanded: {
    transform: [{ rotate: "180deg" }],
  },
  settingsAccordionContent: {
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
    gap: 10,
    padding: 16,
  },
  settingsDialogBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.46)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  localePickerBackdrop: {
    flex: 1,
  },
  localePickerMenu: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    elevation: 8,
    overflow: "hidden",
    padding: 4,
    position: "absolute",
    shadowColor: "#0f172a",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
  },
  localePickerOption: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 38,
    paddingHorizontal: 10,
  },
  localePickerOptionActive: {
    backgroundColor: "#ecfdf5",
  },
  localePickerOptionText: {
    color: "#334155",
    flex: 1,
    fontSize: 14,
  },
  localePickerOptionTextActive: {
    color: "#047857",
    fontWeight: "700",
  },
  settingsExampleDialog: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    gap: 14,
    maxWidth: 620,
    padding: 16,
    width: "100%",
  },
  mcpCardHeader: {
    gap: 4,
    padding: 16,
  },
  mcpCardTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  mcpCardDescription: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 16,
  },
  mcpExampleButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  mcpExampleButtonText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  mcpCardContent: {
    gap: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  mcpNameInput: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 6,
    borderWidth: 1,
    color: "#0f172a",
    fontSize: 12,
    height: 36,
    paddingHorizontal: 12,
    paddingVertical: 0,
  },
  mcpGenerateButton: {
    alignItems: "center",
    backgroundColor: "#10b981",
    borderRadius: 6,
    flexDirection: "row",
    gap: 8,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  mcpGenerateButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  settingsLinkCopy: {
    flex: 1,
    paddingBottom: 16,
  },
  settingsLogoutButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#e11d48",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
  },
  settingsLogoutCard: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecaca",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  settingsLogoutText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  iconButtonPlaceholder: {
    height: 38,
    width: 38,
  },
  mobileListHeader: {
    backgroundColor: "#f8fafc",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  mobileSelectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 44,
  },
  mobileSelectionTitle: {
    color: "#0f172a",
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: 8,
  },
  mobileSelectionClose: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  mobileListTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    minHeight: MOBILE_UI_METRICS.compactControlHeight,
  },
  mobileNotebookTitleButton: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 4,
    minHeight: MOBILE_UI_METRICS.compactControlHeight,
    paddingRight: 12,
  },
  mobileNotebookTitle: {
    color: "#0f172a",
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "700",
  },
  mobileMoreButton: {
    alignItems: "center",
    borderRadius: MOBILE_UI_METRICS.compactControlHeight / 2,
    height: MOBILE_UI_METRICS.compactControlHeight,
    justifyContent: "center",
    width: MOBILE_UI_METRICS.compactControlHeight,
  },
  mobileSearchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  mobileSearchButton: {
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderColor: "transparent",
    borderRadius: MOBILE_UI_METRICS.compactControlHeight / 2,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    height: MOBILE_UI_METRICS.compactControlHeight,
    paddingHorizontal: 12,
  },
  mobileSearchButtonActive: {
    backgroundColor: "#ecfdf5",
    borderColor: "#10b981",
  },
  mobileSearchButtonActiveDark: {
    backgroundColor: "rgb(255, 255, 255)",
  },
  mobileSearchInput: {
    color: "#0f172a",
    flex: 1,
    fontSize: 14,
    height: MOBILE_UI_METRICS.compactControlHeight,
    paddingVertical: 0,
  },
  mobileSearchInputActiveDark: {
    color: "rgb(15, 23, 42)",
  },
  mobileSearchClearButton: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  mobileListConstraint: {
    alignItems: "center",
    backgroundColor: "rgb(236, 253, 245)",
    borderColor: "rgb(167, 243, 208)",
    borderLeftColor: "rgb(16, 185, 129)",
    borderLeftWidth: 3,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  mobileListConstraintFilter: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderLeftColor: "#e2e8f0",
    borderLeftWidth: 1,
  },
  mobileSearchStatusPill: {
    alignItems: "center",
    backgroundColor: "#059669",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mobileSearchStatusPillText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  mobileListConstraintText: {
    color: "#065f46",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  mobileListConstraintTextFilter: {
    color: "#64748b",
  },
  mobileListConstraintAction: {
    color: "#065f46",
    fontSize: 12,
    fontWeight: "700",
  },
  mobileListConstraintActionFilter: {
    color: "#475569",
  },
  mobileFilterButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: MOBILE_UI_METRICS.compactControlHeight / 2,
    borderWidth: 1,
    height: MOBILE_UI_METRICS.compactControlHeight,
    justifyContent: "center",
    width: MOBILE_UI_METRICS.compactControlHeight,
  },
  mobileFilterButtonActive: {
    backgroundColor: "#334155",
    borderColor: "#334155",
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  searchInput: {
    color: "#0f172a",
    flex: 1,
    fontSize: 15,
    minHeight: 44,
  },
  assetsToolbar: {
    backgroundColor: "#ffffff",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    gap: 12,
    padding: 16,
  },
  assetsSearchLayoutRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  assetsSearchBox: {
    flex: 1,
    minHeight: 36,
  },
  assetsSearchInput: {
    fontSize: 12,
    minHeight: 34,
  },
  assetsSummary: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  assetsSummaryText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
  },
  assetsHint: {
    color: "#047857",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  assetsUploadBanner: {
    alignItems: "center",
    backgroundColor: "#ecfdf5",
    borderBottomColor: "#a7f3d0",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  assetsUploadBannerInactive: {
    backgroundColor: "#fffbeb",
    borderBottomColor: "#fde68a",
  },
  assetsUploadHint: {
    color: "#047857",
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  assetsUploadHintInactive: {
    color: "#92400e",
  },
  assetsUploadButton: {
    alignItems: "center",
    backgroundColor: "#059669",
    borderRadius: 4,
    flexDirection: "row",
    gap: 4,
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  assetsUploadButtonText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },
  assetsUploadError: {
    backgroundColor: "#fef2f2",
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  layoutToggle: {
    alignSelf: "flex-start",
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  layoutToggleButton: {
    alignItems: "center",
    flexDirection: "row",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  layoutToggleButtonActive: {
    backgroundColor: "#ecfdf5",
  },
  secondaryIconButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  optionPill: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginRight: 6,
    minHeight: 32,
    paddingHorizontal: 12,
  },
  optionPillActive: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
  },
  optionPillText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "700",
  },
  optionPillTextActive: {
    color: "#047857",
  },
  list: {
    paddingBottom: 18,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  memoList: {
    flex: 1,
  },
  listLoadingFooter: {
    marginVertical: 18,
  },
  assetList: {
    padding: 18,
    paddingBottom: 48,
  },
  assetGrid: {
    padding: 12,
    paddingBottom: 48,
  },
  assetGridRow: {
    gap: 10,
  },
  emptyList: {
    flexGrow: 1,
    paddingBottom: 22,
  },
  memoListStateWrap: {
    paddingHorizontal: 12,
    paddingTop: 16,
  },
  memoListLoadingCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#a7f3d0",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 34,
  },
  memoListLoadingTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 14,
  },
  memoListLoadingDescription: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
    maxWidth: 300,
    textAlign: "center",
  },
  memoSyncBanner: {
    alignItems: "center",
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  memoSyncBannerContent: {
    flex: 1,
  },
  memoSyncBannerTitle: {
    color: "#065f46",
    fontSize: 13,
    fontWeight: "800",
  },
  memoSyncBannerDescription: {
    color: "#047857",
    fontSize: 12,
    marginTop: 2,
  },
  memoSyncProgressTrack: {
    backgroundColor: "#d1fae5",
    borderRadius: 999,
    height: 4,
    marginTop: 10,
    overflow: "hidden",
    width: "100%",
  },
  memoSyncProgressFill: {
    backgroundColor: "#059669",
    borderRadius: 999,
    height: "100%",
  },
  memoSyncErrorBanner: {
    alignItems: "center",
    backgroundColor: "#fffbeb",
    borderColor: "#fcd34d",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  memoSyncErrorBannerTitle: {
    color: "#451a03",
    fontSize: 13,
    fontWeight: "800",
  },
  memoSyncErrorBannerDescription: {
    color: "#92400e",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  memoSyncErrorRetryButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  memoListErrorCard: {
    alignItems: "center",
    backgroundColor: "#fffbeb",
    borderColor: "#fcd34d",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 34,
  },
  memoListErrorTitle: {
    color: "#451a03",
    fontSize: 14,
    fontWeight: "800",
  },
  memoListErrorDescription: {
    color: "#92400e",
    fontSize: 12,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 300,
    textAlign: "center",
  },
  memoListRetryButton: {
    alignItems: "center",
    backgroundColor: "#fef3c7",
    borderRadius: 8,
    flexDirection: "row",
    gap: 7,
    marginTop: 16,
    minHeight: 36,
    paddingHorizontal: 12,
  },
  memoListRetryText: {
    color: "#92400e",
    fontSize: 13,
    fontWeight: "800",
  },
  memoListEmptyCard: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 34,
  },
  memoCard: {
    alignItems: "stretch",
    backgroundColor: "#ffffff",
    borderColor: "#f1f5f9",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 12,
    minHeight: 132,
    overflow: "hidden",
  },
  memoCardCompact: {
    marginBottom: 10,
    minHeight: 84,
  },
  memoCardSelected: {
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
  },
  memoCardContent: {
    flex: 1,
    minWidth: 0,
    padding: 16,
  },
  memoCardContentCompact: {
    padding: 13,
  },
  memoCardContentWithSelection: {
    paddingLeft: 12,
  },
  memoSelectionButton: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
    width: 44,
  },
  memoCardTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  selectionIndicator: {
    alignItems: "center",
    borderColor: "#cbd5e1",
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  selectionIndicatorActive: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  memoTitle: {
    color: "#0f172a",
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  memoPinnedStar: {
    color: "#64748b",
    fontSize: 16,
    lineHeight: 16,
    width: 16,
  },
  memoExcerpt: {
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    minHeight: 40,
  },
  memoMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 20,
  },
  memoMetaCompact: {
    marginTop: 8,
  },
  memoDate: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "500",
  },
  tag: {
    backgroundColor: "#f1f5f9",
    borderRadius: 2,
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "500",
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  resourceCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
    padding: 10,
  },
  resourceGridCard: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    marginBottom: 10,
    minWidth: 0,
    overflow: "hidden",
  },
  resourceThumb: {
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    overflow: "hidden",
    width: 58,
  },
  resourceGridThumb: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#f8fafc",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%",
  },
  resourceImage: {
    height: "100%",
    width: "100%",
  },
  resourceFileIcon: {
    alignItems: "center",
    justifyContent: "center",
  },
  resourceInfo: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  resourceGridInfo: {
    gap: 4,
    minWidth: 0,
    padding: 12,
  },
  resourceGridMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  resourceGridMetaText: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "600",
  },
  resourceGridSource: {
    borderTopColor: "#f8fafc",
    borderTopWidth: 1,
    color: "#94a3b8",
    fontSize: 10,
    marginTop: 2,
    paddingTop: 4,
  },
  centerState: {
    alignItems: "center",
    flex: 1,
    gap: 8,
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    color: "#dc2626",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  emptyTitle: {
    color: "#334155",
    fontSize: 16,
    fontWeight: "800",
  },
  mutedText: {
    color: "#64748b",
    fontSize: 13,
    textAlign: "center",
  },
  emptyActionButton: {
    alignItems: "center",
    backgroundColor: "#0f172a",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    minHeight: 38,
    paddingHorizontal: 14,
  },
  emptyActionButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  panelRow: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  systemInfoRows: {
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
  },
  systemInfoRow: {
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
  },
  systemInfoRowLast: {
    borderBottomWidth: 0,
  },
  systemInfoCell: {
    flex: 1,
    gap: 3,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  systemInfoCellDivider: {
    borderRightColor: "#e2e8f0",
    borderRightWidth: 1,
  },
  systemInfoListValue: {
    color: "#0f172a",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
  },
  panelLinkRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  panelLinkText: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  panelLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },
  panelValue: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "700",
  },
  preferenceStack: {
    gap: 12,
  },
  preferenceText: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  modalSafeArea: {
    backgroundColor: "#f8fafc",
    flex: 1,
  },
  createMemoSafeArea: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  createMemoHeader: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderBottomColor: "#f1f5f9",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    minHeight: 52,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  createMemoBackButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  createMemoHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  createMemoStatus: {
    backgroundColor: "#f1f5f9",
    borderRadius: 999,
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  createMemoStatusActive: {
    backgroundColor: "#ecfdf5",
    color: "#047857",
  },
  createMemoDoneButton: {
    alignItems: "center",
    backgroundColor: "#020617",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 36,
    minWidth: 58,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  createMemoDoneButtonDisabled: {
    backgroundColor: "#e2e8f0",
  },
  createMemoDoneText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  createMemoDoneTextDisabled: {
    color: "#64748b",
  },
  createMemoMain: {
    flex: 1,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  createMemoTitleInput: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
    minHeight: 42,
    padding: 0,
  },
  createMemoMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 40,
  },
  createMemoNotebookButton: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 3,
    maxWidth: "46%",
    minHeight: 30,
    paddingRight: 5,
  },
  createMemoNotebookText: {
    color: "#64748b",
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  createMemoTagsInput: {
    color: "#64748b",
    flex: 1,
    fontSize: 15,
    lineHeight: 23,
    minHeight: 36,
    minWidth: 0,
    padding: 0,
  },
  createMemoToolButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 36,
  },
  createMemoToolButtonPressed: {
    backgroundColor: "#ecfdf5",
    borderColor: "#bbf7d0",
  },
  createMemoEditorFrame: {
    borderColor: "#e2e8f0",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    marginHorizontal: -4,
    marginTop: 4,
    overflow: "hidden",
  },
  createMemoEditor: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  richEditorSafeArea: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  richEditorHeaderStatus: {
    maxWidth: 76,
  },
  richEditorContainer: {
    backgroundColor: "#ffffff",
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  richEditorStatusError: {
    backgroundColor: "#fef2f2",
    color: "#b91c1c",
  },
  richEditorFrame: {
    flex: 1,
    marginHorizontal: -12,
  },
  richStandaloneMetaRow: {
    minHeight: 30,
  },
  richStandaloneTagsInput: {
    minHeight: 30,
  },
  richEditorSearchActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  richEditorLoading: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    bottom: 0,
    gap: 10,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 2,
  },
  richEditorWebView: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  richEditorInlineError: {
    backgroundColor: "#fef2f2",
    color: "#b91c1c",
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  richEditorDraftNotice: {
    backgroundColor: "#fffbeb",
    color: "#92400e",
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  richEditorPerf: {
    backgroundColor: "#f8fafc",
    color: "#64748b",
    fontSize: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
    textAlign: "right",
  },
  managementHeader: {
    alignItems: "center",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: 14,
  },
  managementBackButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    marginRight: 10,
    width: 36,
  },
  managementHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  managementTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  managementTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "800",
  },
  managementSubtitle: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  modalHeader: {
    alignItems: "center",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  modalTitle: {
    color: "#0f172a",
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    marginHorizontal: 12,
    textAlign: "center",
  },
  actionSheetBackdrop: {
    backgroundColor: "rgba(15, 23, 42, 0.34)",
    flex: 1,
    justifyContent: "flex-end",
  },
  actionSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  listActionSheet: {
    backgroundColor: "#ffffff",
    borderRadius: MOBILE_UI_METRICS.floatingSheetCornerRadius,
    marginHorizontal: 12,
    maxHeight: "82%",
    overflow: "hidden",
    paddingBottom: 8,
    paddingTop: 8,
  },
  selectionMoreSheet: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    gap: 0,
    marginHorizontal: 8,
    overflow: "hidden",
    paddingBottom: 8,
    paddingTop: 8,
  },
  moveSelectionSheet: {
    maxHeight: "76%",
  },
  moveSelectionSearch: {
    borderBottomColor: "#f1f5f9",
    borderBottomWidth: 1,
    padding: 12,
  },
  moveSelectionList: {
    gap: 8,
    padding: 8,
  },
  listActionSheetHeader: {
    alignItems: "center",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  listActionSheetHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  sheetCloseButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  listActionSheetScroll: {
    flexShrink: 1,
  },
  listActionSheetContent: {
    padding: 8,
  },
  actionSheetSubtitle: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 2,
  },
  listActionDivider: {
    backgroundColor: "#f1f5f9",
    height: 1,
    marginVertical: 8,
  },
  notebookPickerSheet: {
    maxHeight: "82%",
    paddingBottom: 8,
    paddingHorizontal: 0,
  },
  notebookPickerHeader: {
    alignItems: "center",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: 16,
  },
  notebookPickerHeaderText: {
    flex: 1,
    gap: 2,
  },
  notebookPickerCloseButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  notebookPickerSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  notebookPickerToggleAll: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  notebookPickerToggleAllText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },
  notebookPickerScroll: {
    flexShrink: 1,
  },
  notebookPickerContent: {
    padding: 8,
  },
  notebookPickerSearchBox: {
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 6,
    flexDirection: "row",
    gap: 8,
    height: 36,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  notebookPickerSearchInput: {
    color: "#0f172a",
    flex: 1,
    fontSize: 14,
    height: 36,
    paddingVertical: 0,
  },
  notebookPickerRow: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 6,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  notebookPickerAllRow: {
    marginBottom: 4,
  },
  notebookPickerRowActive: {
    backgroundColor: "#f1f5f9",
  },
  actionSheetHandle: {
    alignSelf: "center",
    backgroundColor: "#cbd5e1",
    borderRadius: 999,
    height: 4,
    marginBottom: 8,
    width: 42,
  },
  actionSheetTitle: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
    paddingBottom: 4,
  },
  actionSheetSectionTitle: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionSheetItem: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 7,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  actionSheetItemCompact: {
    minHeight: 44,
  },
  actionSheetItemText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
  },
  actionSheetItemTextCompact: {
    fontWeight: "500",
  },
  actionSheetItemTextDanger: {
    color: "#b91c1c",
  },
  sheetOptionRow: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  sheetOptionRowActive: {
    backgroundColor: "rgb(236, 253, 245)",
  },
  sheetOptionIcon: {
    alignItems: "center",
    justifyContent: "center",
    width: 20,
  },
  sheetOptionLabel: {
    color: "#0f172a",
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  sheetOptionLabelActive: {
    color: "rgb(4, 120, 87)",
  },
  sheetOptionCheck: {
    alignItems: "center",
    backgroundColor: "#10b981",
    borderRadius: 9,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  sheetOptionCheckHidden: {
    opacity: 0,
  },
  detailContent: {
    paddingBottom: 112,
    paddingHorizontal: DETAIL_CONTENT_HORIZONTAL_PADDING,
    paddingTop: 16,
  },
  detailTitle: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 30,
  },
  detailHeader: {
    alignItems: "center",
    borderBottomColor: "#f1f5f9",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  detailHeaderButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  detailHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  detailHeaderIconButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  detailSyncStatus: {
    backgroundColor: "#f1f5f9",
    borderRadius: 999,
    color: "#64748b",
    fontSize: 11,
    fontWeight: "500",
    maxWidth: 88,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  detailMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  detailNotebookButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 32,
    maxWidth: "46%",
    paddingHorizontal: 8,
  },
  detailNotebookName: {
    color: "#64748b",
    flexShrink: 1,
    fontSize: 14,
  },
  detailTagsGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    height: 32,
    paddingHorizontal: 8,
  },
  detailTagsInline: {
    color: "#64748b",
    flex: 1,
    fontSize: 14,
  },
  detailTagsPlaceholder: {
    color: "#94a3b8",
  },
  detailDivider: {
    backgroundColor: "#e2e8f0",
    height: 1,
    marginHorizontal: -16,
    marginTop: 16,
    marginBottom: 18,
  },
  detailEditFab: {
    alignItems: "center",
    backgroundColor: "#10b981",
    borderRadius: 24,
    elevation: 6,
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: 16,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    width: 48,
  },
  detailMarkdown: {
    color: "#1f2937",
    fontSize: 16,
    lineHeight: 25,
    marginTop: 20,
  },
  noteSearchPanel: {
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    marginTop: 14,
    padding: 10,
  },
  noteSearchCount: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
  },
  noteSearchCountEmpty: {
    color: "#b91c1c",
  },
  noteSearchHighlight: {
    backgroundColor: "#fef3c7",
    color: "#78350f",
  },
  noteSearchHighlightActive: {
    backgroundColor: "#fde68a",
    color: "#0f172a",
    fontWeight: "800",
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  actionButtonDanger: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
  },
  actionButtonText: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
  },
  actionButtonTextDanger: {
    color: "#b91c1c",
  },
  parentSelectList: {
    flexGrow: 0,
  },
  notebookPicker: {
    gap: 10,
  },
  tagManageRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tagManageRowEditing: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
  },
  tagManagerList: {
    flex: 1,
  },
  tagManagerListContent: {
    gap: 8,
    paddingBottom: 32,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  tagManageText: {
    flex: 1,
    minWidth: 0,
  },
  tagManageName: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "600",
  },
  tagManageMeta: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 4,
  },
  tagManageAction: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  tagManageActionDanger: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
  },
  tagRenameForm: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  tagRenameInput: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 6,
    borderWidth: 1,
    color: "#0f172a",
    fontSize: 14,
    height: 36,
    paddingHorizontal: 10,
    paddingVertical: 0,
  },
  tagRenameActions: {
    flexDirection: "row",
    gap: 8,
  },
  tagRenameSaveButton: {
    alignItems: "center",
    backgroundColor: "#10b981",
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    minWidth: 58,
    paddingHorizontal: 10,
  },
  tagRenameSaveText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  tagRenameCancelButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 6,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    minWidth: 58,
    paddingHorizontal: 10,
  },
  tagRenameCancelText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  createdTokenPanel: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  tokenValueText: {
    backgroundColor: "#ffffff",
    borderColor: "#a7f3d0",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    padding: 10,
  },
  tokenActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scopeGrid: {
    gap: 4,
  },
  tokenScopeHeader: {
    alignItems: "center",
    borderBottomColor: "#f1f5f9",
    borderBottomWidth: 1,
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    paddingVertical: 8,
  },
  scopeOption: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 12,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scopeOptionSelected: {
    backgroundColor: "#ecfdf5",
  },
  scopeCheckbox: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#6ee7b7",
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  scopeCheckboxSelected: {
    backgroundColor: "#10b981",
    borderColor: "#10b981",
  },
  scopeOptionText: {
    color: "#475569",
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  scopeOptionTextSelected: {
    color: "#047857",
  },
  apiTokenRow: {
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
    gap: 12,
    minHeight: 64,
    paddingVertical: 12,
  },
  apiTokenText: {
    minWidth: 0,
  },
  apiTokenName: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
  },
  apiTokenScopes: {
    alignSelf: "flex-start",
    backgroundColor: "#f8fafc",
    borderColor: "#f1f5f9",
    borderRadius: 6,
    borderWidth: 1,
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 8,
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  apiTokenMeta: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 16,
    marginTop: 8,
  },
  apiTokenActions: {
    gap: 8,
  },
  apiTokenActionButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  apiTokenActionText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  apiTokenDeleteButton: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
  },
  apiTokenDeleteText: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "600",
  },
  apiTokenEmptyText: {
    color: "#94a3b8",
    fontSize: 14,
    paddingVertical: 16,
  },
  centerInline: {
    alignItems: "center",
    padding: 18,
  },
  emptyInlinePanel: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: 8,
    padding: 22,
  },
  guideHero: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  promptCard: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  promptCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  moveNotebookRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    padding: 12,
  },
  moveNotebookRowActive: {
    borderColor: "#0f172a",
  },
  moveNotebookRowCompact: {
    borderWidth: 0,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  moveNotebookRowCompactActive: {
    backgroundColor: "#ecfdf5",
  },
  moveNotebookTextCompactActive: {
    color: "#047857",
  },
  moveNotebookText: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  moveNotebookSelectArea: {
    flex: 1,
    gap: 4,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 0,
  },
  notebookTreeToggle: {
    alignItems: "center",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  notebookTreeTogglePlaceholder: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  notebookTreeRows: {
    gap: 10,
  },
  notebookTreeRowsCompact: {
    gap: 0,
  },
  editorForm: {
    gap: 12,
    padding: 18,
    paddingBottom: 48,
  },
  revisionHistoryContent: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  revisionSummaryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  revisionSummaryText: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  revisionChangeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderRadius: 999,
    borderWidth: 1,
    color: "#92400e",
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  revisionTimelineLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  revisionTimeline: {
    gap: 7,
  },
  revisionTimelineState: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 32,
  },
  revisionTimelineError: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  revisionPill: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  revisionPillActive: {
    backgroundColor: "#ecfdf5",
    borderColor: "#a7f3d0",
  },
  revisionPillTitle: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
  },
  revisionPillTitleActive: {
    color: "#047857",
  },
  revisionPillMeta: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  revisionComparisonTable: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  revisionComparisonHeader: {
    backgroundColor: "#f8fafc",
    flexDirection: "row",
  },
  revisionComparisonHeaderText: {
    color: "#475569",
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    padding: 10,
  },
  revisionComparisonRow: {
    alignItems: "stretch",
    borderBottomColor: "#f1f5f9",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 28,
  },
  revisionComparisonCell: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  revisionComparisonCellCurrent: {
    borderLeftColor: "#e2e8f0",
    borderLeftWidth: 1,
  },
  revisionComparisonLineNumber: {
    backgroundColor: "#f8fafc",
    borderRightColor: "#e2e8f0",
    borderRightWidth: 1,
    color: "#94a3b8",
    fontSize: 10,
    minWidth: 28,
    paddingHorizontal: 4,
    paddingTop: 6,
    textAlign: "right",
  },
  revisionComparisonText: {
    color: "#334155",
    flex: 1,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 11,
    lineHeight: 17,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  revisionComparisonEmpty: {
    color: "#94a3b8",
    fontSize: 13,
    padding: 24,
    textAlign: "center",
  },
  revisionPreviewText: {
    color: "#334155",
    fontSize: 13,
    lineHeight: 20,
  },
  revisionDiffRowHistory: {
    backgroundColor: "#fff1f2",
  },
  revisionDiffRowCurrent: {
    backgroundColor: "#ecfdf5",
  },
  revisionDiffTextEmpty: {
    color: "#94a3b8",
  },
  label: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "800",
  },
  bottomNav: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 36,
  },
  bottomCreateButton: {
    alignItems: "center",
    backgroundColor: "#10b981",
    borderColor: "#ffffff",
    borderRadius: MOBILE_UI_METRICS.floatingCreateButtonSize / 2,
    borderWidth: 4,
    height: MOBILE_UI_METRICS.floatingCreateButtonSize,
    justifyContent: "center",
    marginTop: -16,
    shadowColor: "#10b981",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    width: MOBILE_UI_METRICS.floatingCreateButtonSize,
  },
  bottomCreateButtonDisabled: {
    backgroundColor: "#cbd5e1",
    shadowOpacity: 0,
  },
  selectionBar: {
    backgroundColor: "#ffffff",
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    paddingHorizontal: 32,
    paddingTop: 4,
    position: "absolute",
    right: 0,
  },
  selectionActions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  selectionAction: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    justifyContent: "center",
    minHeight: 56,
  },
  selectionActionText: {
    color: "#0f172a",
    fontSize: 11,
    fontWeight: "800",
  },
  selectionActionTextDanger: {
    color: "#b91c1c",
  },
  bottomNavItem: {
    alignItems: "center",
    gap: 4,
    minHeight: MOBILE_UI_METRICS.minimumTouchTarget,
    minWidth: 58,
  },
  bottomNavText: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
  },
  bottomNavTextActive: {
    color: "#0f172a",
  },
  previewBackdrop: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center",
  },
  previewToolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    position: "absolute",
    right: 12,
    top: 44,
    zIndex: 4,
  },
  previewToolbarButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  previewToolbarButtonDisabled: {
    opacity: 0.34,
  },
  previewStage: {
    alignItems: "center",
    bottom: 136,
    justifyContent: "center",
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 98,
  },
  previewImageFrame: {
    height: "100%",
    width: "100%",
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  previewNavRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    left: 8,
    position: "absolute",
    right: 8,
    zIndex: 3,
  },
  previewNavButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  previewNavIcon: {
    textShadowColor: "rgba(0, 0, 0, 0.88)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 3,
  },
  previewThumbnailRail: {
    bottom: 18,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 4,
  },
  previewThumbnailList: {
    gap: 12,
  },
  previewThumbnail: {
    borderColor: "rgba(255, 255, 255, 0.48)",
    borderRadius: 3,
    borderWidth: 1,
    height: 84,
    overflow: "hidden",
    width: 96,
  },
  previewThumbnailActive: {
    borderColor: "#ffffff",
    borderWidth: 2,
  },
  previewThumbnailImage: {
    backgroundColor: "#020617",
    height: "100%",
    width: "100%",
  },
});

let styles = baseWorkspaceStyles;
let workspaceStylesTheme: MobileResolvedTheme = "light";

const refreshWorkspaceThemeStyles = (theme: MobileResolvedTheme) => {
  if (workspaceStylesTheme === theme) {
    return;
  }
  styles = resolveMobileThemeStyles(baseWorkspaceStyles, theme);
  workspaceStylesTheme = theme;
};
