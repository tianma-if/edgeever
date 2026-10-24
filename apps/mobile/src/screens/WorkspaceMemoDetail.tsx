import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_MEMO_TITLE, parseDiagramDocument, type MemoDetail, type Notebook, type TiptapDoc } from "@edgeever/shared";
import {
  NOTE_IMAGE_THEMES,
  NOTE_IMAGE_THEME_OPTIONS,
  NOTE_IMAGE_BACKGROUND_COLORS,
  type NoteImageTheme,
  type NoteImageFontStyle,
  type NoteImageFontSize,
  type NoteImageCardWidth,
} from "@edgeever/shared/note-image-card";
import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Image as RNImage, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text as RNText, View, type ImageStyle, type StyleProp, type TextStyle } from "react-native";
import { Modal } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import { ActivityIndicator, ChevronDown, ChevronLeft, ChevronUp, Copy, Download, History, MoreHorizontal, Pencil, RotateCcw, Search, Share2, Sparkles, Tag, Trash2, X } from "../components/icons";
import { Alert, Pressable, Text, TextInput } from "../components/LocalizedText";
import LocalTiptapEditor, { type LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { MobileAiAssistantModal } from "../components/MobileAiAssistantModal";
import MobileNoteImageFontPicker from "../components/MobileNoteImageFontPicker";
import { getMobileNoteImageFontLabel } from "../lib/note-image-font-options";
import { MobileResourceActions } from "../components/MobileResourceActions";
import { ZoomableImagePreview } from "../components/ZoomableImagePreview";
import type { ImageSize } from "../lib/mobile-image-zoom";
import { encodeMobileNoteImageFileUri } from "../lib/mobile-note-image-export";
import { SAFE_DOM_WEBVIEW_PROPS } from "../lib/mobile-dom";
import { getNextMobileNoteSearchIndex } from "../lib/mobile-note-search";
import { hasMobilePoster, hasMobileInfographic, hasMobileStructuredTable, hasMobileVisualDiagram, resolveMobileMemoViewerContent } from "../lib/mobile-diagram";
import { safeDomCall } from "../lib/safe-dom-call";
import {
  getMobileImageTarget,
  openMobileResource,
  parseMobileResourceTargetJson,
  saveMobileResourceAs,
  type MobileResourceTarget,
} from "../lib/mobile-attachments";
import { localizeUntitledMemoTitle, useMobileLocale } from "../lib/mobile-locale";
import {
  createOnceProtectedResourceFailureNotifier,
  isProtectedResourceSource,
  loadProtectedResourceDataUrl,
  type ProtectedResourceLoadFailure,
} from "../lib/mobile-protected-resources";
import { useMobileNoteImagePreferences } from "../hooks/useMobileNoteImagePreferences";
import { useMobileRichEditor, type MobileMemoUpdateMutation } from "../hooks/useMobileRichEditor";
import type { MobileMemoDraft } from "../lib/mobile-drafts";
import { createMobileDataScope } from "../lib/local-mirror";
import { useMobileTheme } from "../lib/mobile-theme";
import { useSession } from "../lib/session";
import { beginEditorStartup } from "../lib/startup-performance";
import type { MobileSyncQueueItem } from "../lib/sync-queue";
import { getTextSearchMatches, parseTags } from "./workspace-utils";
import { styles } from "./workspace-styles";
import { NotebookPickerModal, SmartTagButton, TagPickerModal } from "./WorkspacePickers";

const ANDROID_SYSTEM_NAVIGATION_FALLBACK = 48;
const RESOURCE_DATA_URL_CACHE_LIMIT = 32;
const IMAGE_EXPORT_TIMEOUT_MS = 60_000;

type MobileImageExportEvent =
  | { type: "chunk"; requestId: string; chunk: string }
  | { type: "font-status"; requestId: string; status: "loading" | "fallback" | "ready" }
  | { type: "fonts-ready"; requestId: string }
  | { type: "progress"; requestId: string; stage: "prepare" | "render" | "transfer"; elapsedMs?: number }
  | {
      type: "complete";
      fontFallback?: boolean;
      requestId: string;
      filename: string;
      mimeType: string;
      width?: number;
      height?: number;
      totalImages?: number;
      failedImages?: number;
    }
  | { type: "error"; requestId: string; message?: string };

type MobilePreparedNoteImage = {
  fontFallback: boolean;
  failedImages: number;
  filename: string;
  height: number;
  mimeType: string;
  totalImages: number;
  uri: string;
  width: number;
};

const decodeBase64Chunks = (chunks: string[]) => {
  const parts = chunks.map((chunk) => {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  });
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const getSavedImagePath = (destination: string) => {
  if (!destination.startsWith("content://com.android.externalstorage.documents/")) return null;
  const documentId = destination.match(/\/document\/([^?#]+)/)?.[1];
  if (!documentId) return null;
  try {
    const decoded = decodeURIComponent(documentId);
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    const volume = decoded.slice(0, separator);
    const relativePath = decoded.slice(separator + 1).replace(/^\/+/, "");
    if (!relativePath) return null;
    return `${volume === "primary" ? "/storage/emulated/0" : `/storage/${volume}`}/${relativePath}`;
  } catch {
    return null;
  }
};

type SessionLike = { baseUrl: string; token: string } | null;
type AuthenticatedImageSource = {
  headers?: { Authorization: string };
  uri: string;
};

const getAuthenticatedResourceSource = (
  source: string,
  session: SessionLike
): AuthenticatedImageSource => {
  const baseUrl = session?.baseUrl.replace(/\/+$/, "") ?? "";
  const uri = source.startsWith("/") && baseUrl ? `${baseUrl}${source}` : source;
  const isProtectedResource = isProtectedResourceSource(source, session)
    || Boolean(baseUrl && uri.startsWith(`${baseUrl}/api/v1/resources/`));

  return {
    uri,
    ...(session?.token && isProtectedResource ? { headers: { Authorization: `Bearer ${session.token}` } } : {}),
  };
};

const resourceDataUrlCache = new Map<string, Promise<string | null>>();
const loadAuthenticatedImageDataUrl = (
  source: string,
  session: SessionLike,
  getResourceBlob: ((resourceUrl: string) => Promise<Blob>) | null | undefined,
  onFailure?: (failure: ProtectedResourceLoadFailure) => void
) => {
  if (!getResourceBlob || !isProtectedResourceSource(source, session)) {
    return Promise.resolve(null);
  }
  return loadProtectedResourceDataUrl(source, {
    baseUrl: session?.baseUrl ?? "",
    cache: resourceDataUrlCache,
    cacheLimit: RESOURCE_DATA_URL_CACHE_LIMIT,
    getResourceBlob,
    onFailure,
    token: session?.token,
  });
};

const alertProtectedImageLoadFailure = (
  locale: "zh-CN" | "en-US" | "ja" | "pl" | "ru",
  failure: ProtectedResourceLoadFailure
) => {
  const statusLabel = failure.status != null ? String(failure.status) : locale !== "zh-CN" ? "network error" : "网络错误";
  Alert.alert(
    locale !== "zh-CN" ? "Image failed to load" : "图片加载失败",
    locale !== "zh-CN"
      ? `Could not load a note image (${statusLabel}). Check the network and try again.`
      : `笔记中的图片未能加载（${statusLabel}）。请检查网络后重试。`
  );
};

type CachedSvgResource = {
  aspectRatio: number | null;
  xml: string;
};

const AUTHENTICATED_SVG_CACHE_LIMIT = 24;
const authenticatedSvgCache = new Map<string, Promise<CachedSvgResource | null>>();
const getAuthenticatedSvgCacheKey = (source: AuthenticatedImageSource) =>
  `${source.uri}\n${source.headers?.Authorization ?? ""}`;
const loadAuthenticatedSvg = (source: AuthenticatedImageSource) => {
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

const MOBILE_THEME_LABELS = {
  "glass": { labelZh: "透明", labelEn: "Glass" },
  "quote": { labelZh: "金句", labelEn: "Quote" },
  "book": { labelZh: "书摘", labelEn: "Book excerpt" },
  "memo": { labelZh: "备忘录", labelEn: "Memo" },
  "bento": { labelZh: "便当", labelEn: "Bento" },
  "black-sun": { labelZh: "黑日", labelEn: "Black Sun" },
  "frame": { labelZh: "框界", labelEn: "Frame" },
  "handwritten": { labelZh: "手写", labelEn: "Handwritten" },
  "code": { labelZh: "代码", labelEn: "Code" },
};

const MOBILE_THEME_OPTIONS = NOTE_IMAGE_THEME_OPTIONS.map((id) => ({
  id, ...MOBILE_THEME_LABELS[id], previewBg: NOTE_IMAGE_BACKGROUND_COLORS[id],
}));



const AuthenticatedResourceImage = ({
  alt,
  fitAspect = false,
  href,
  loadResourceBlob,
  onLoadFailure,
  onDimensions,
  resizeMultiplier,
  resizeMode = "cover",
  session,
  style,
}: {
  alt: string;
  fitAspect?: boolean;
  href: string;
  loadResourceBlob?: ((resourceUrl: string) => Promise<Blob>) | null;
  onLoadFailure?: (failure: ProtectedResourceLoadFailure) => void;
  onDimensions?: (size: ImageSize) => void;
  resizeMultiplier?: number;
  resizeMode?: "center" | "contain" | "cover" | "repeat" | "stretch";
  session: SessionLike;
  style: StyleProp<ImageStyle>;
}) => {
  const headerSource = useMemo(() => getAuthenticatedResourceSource(href, session), [href, session]);
  const isProtected = isProtectedResourceSource(href, session);
  // Protected images: wait for the data URL so we never paint a failed first frame.
  const [displaySource, setDisplaySource] = useState<AuthenticatedImageSource | null>(
    isProtected ? null : headerSource
  );
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [svgXml, setSvgXml] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const svgRequestStartedRef = useRef(false);
  const svgSourceKeyRef = useRef("");
  const svgSourceKey = displaySource ? getAuthenticatedSvgCacheKey(displaySource) : "";
  const imageStyle = fitAspect ? [style, { aspectRatio, height: undefined, width: "100%" as const }] : style;

  useEffect(() => {
    let cancelled = false;
    setSvgXml(null);
    setAspectRatio(16 / 9);
    setLoadFailed(false);
    svgRequestStartedRef.current = false;
    setDisplaySource(isProtectedResourceSource(href, session) ? null : headerSource);

    if (!isProtectedResourceSource(href, session)) {
      return () => {
        cancelled = true;
      };
    }

    void loadAuthenticatedImageDataUrl(href, session, loadResourceBlob, onLoadFailure).then((dataUrl) => {
      if (cancelled) {
        return;
      }
      if (!dataUrl) {
        setLoadFailed(true);
        return;
      }
      setDisplaySource({ uri: dataUrl });
    });

    return () => {
      cancelled = true;
    };
  }, [headerSource, href, loadResourceBlob, onLoadFailure, session]);

  useEffect(() => {
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
          onDimensions?.({ width: result.aspectRatio * 1000, height: 1000 });
        }
        setSvgXml(result.xml);
      });
    }
    return () => {
      if (svgSourceKeyRef.current === svgSourceKey) {
        svgSourceKeyRef.current = "";
      }
    };
  }, [svgSourceKey, onDimensions]);

  const loadSvgFallback = () => {
    if (svgRequestStartedRef.current || !displaySource) {
      return;
    }
    svgRequestStartedRef.current = true;
    void loadAuthenticatedSvg(displaySource)
      .then((result) => {
        if (!result || svgSourceKeyRef.current !== svgSourceKey) {
          return;
        }
        if (result.aspectRatio) {
          setAspectRatio(result.aspectRatio);
          onDimensions?.({ width: result.aspectRatio * 1000, height: 1000 });
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

  if (!displaySource || loadFailed) {
    return (
      <View
        accessibilityLabel={alt || undefined}
        accessible={Boolean(alt)}
        style={[imageStyle, resourceImageStyles.previewPlaceholder]}
      >
        {loadFailed ? null : <ActivityIndicator color="#94a3b8" />}
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
          onDimensions?.({ width, height });
        }
      }}
      onError={loadSvgFallback}
      resizeMethod={Platform.OS === "android" ? "resize" : "auto"}
      // Supported by Android's native Image view; RN 0.86's TS interface omits it.
      {...(Platform.OS === "android" && resizeMultiplier ? { resizeMultiplier } : {})}
      resizeMode={resizeMode}
      source={displaySource}
      style={imageStyle}
    />
  );
};


const DetailActionSheetItem = ({ danger = false, disabled = false, icon, label, onPress }: { danger?: boolean; disabled?: boolean; icon: ReactNode; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionSheetItem, disabled && styles.buttonDisabled]}>
    {icon}
    <Text style={[styles.actionSheetItemText, danger && styles.actionSheetItemTextDanger]}>{label}</Text>
  </Pressable>
);

const HighlightedMetadataText = ({
  activeIndex,
  matchOffset,
  matches,
  numberOfLines,
  style,
  text,
}: {
  activeIndex: number;
  matchOffset: number;
  matches: Array<{ end: number; start: number }>;
  numberOfLines?: number;
  style: StyleProp<TextStyle>;
  text: string;
}) => {
  if (matches.length === 0) {
    return <RNText numberOfLines={numberOfLines} selectable style={style}>{text}</RNText>;
  }
  const content: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    if (match.start > cursor) {
      content.push(text.slice(cursor, match.start));
    }
    content.push(
      <RNText
        key={`${match.start}-${match.end}`}
        style={activeIndex === matchOffset + index ? styles.noteSearchHighlightActive : styles.noteSearchHighlight}
      >
        {text.slice(match.start, match.end)}
      </RNText>
    );
    cursor = match.end;
  });
  if (cursor < text.length) {
    content.push(text.slice(cursor));
  }
  return <RNText numberOfLines={numberOfLines} selectable style={style}>{content}</RNText>;
};

export const MemoDetailModal = ({
  editingSession,
  imageCompressionEnabled,
  imageShareFromList,
  initialSearchQuery,
  isDeleting,
  isLoading,
  isRestoring,
  isSaving,
  isSharing,
  memo,
  notebookName,
  notebooks,
  onAdoptCloudVersion,
  onApplyAiDraft,
  onClose,
  onCloseEditor,
  onCopyLocalDraft,
  onDelete,
  onDeleteResource,
  onRichEdit,
  onOpenRevisions,
  onRenameResource,
  onResolveSyncConflict,
  onRetrySync,
  onRestore,
  onShare,
  syncError,
  syncStatus,
  updateMutation,
  visible,
}: {
  editingSession: {
    draft: MobileMemoDraft | null;
    initialFocus: "body" | "title";
    memo: MemoDetail;
  } | null;
  imageCompressionEnabled: boolean;
  imageShareFromList: boolean;
  initialSearchQuery: string;
  isDeleting: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  isSaving: boolean;
  isSharing: boolean;
  memo: MemoDetail | null;
  notebookName: string;
  notebooks: Notebook[];
  onAdoptCloudVersion: (memo: MemoDetail) => void;
  onApplyAiDraft: (memo: MemoDetail, draft: string, mode: "append" | "replace") => Promise<void>;
  onClose: () => void;
  onCloseEditor: () => void;
  onCopyLocalDraft: (memo: MemoDetail) => void;
  onDelete: (memo: MemoDetail) => void;
  onDeleteResource: (memo: MemoDetail, target: MobileResourceTarget) => Promise<void>;
  onRichEdit: (memo: MemoDetail, initialFocus?: "body" | "title") => void;
  onOpenRevisions: (memo: MemoDetail) => void;
  onRenameResource: (memo: MemoDetail, target: MobileResourceTarget, filename: string) => Promise<void>;
  onResolveSyncConflict: (memo: MemoDetail) => void;
  onRetrySync: () => void;
  onRestore: (memo: MemoDetail) => void;
  onShare: (memo: MemoDetail) => void;
  syncError: string | null;
  syncStatus: MobileSyncQueueItem["status"] | null;
  updateMutation: MobileMemoUpdateMutation;
  visible: boolean;
}) => {
  const { client, session } = useSession();
  const { resolvedTheme } = useMobileTheme();
  const { resolvedLocale } = useMobileLocale();
  const safeAreaInsets = useSafeAreaInsets();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [bodySearchMatchCount, setBodySearchMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [imagePreview, setImagePreview] = useState<{ alt: string; source: string } | null>(null);
  const [resourceTarget, setResourceTarget] = useState<MobileResourceTarget | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [titleCollapsed, setTitleCollapsed] = useState(false);
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [imageFontStatus, setImageFontStatus] = useState<"loading" | "fallback" | "ready">("ready");
  const imageFontRecoveryRef = useRef<{ requestId: string; ready: boolean; complete: boolean; retry: () => void } | null>(null);
  const [imageExportStage, setImageExportStage] = useState<"prepare" | "render" | "transfer">("prepare");
  const [imageShareOptionsOpen, setImageShareOptionsOpen] = useState(false);
  const [imageShareFontPickerOpen, setImageShareFontPickerOpen] = useState(false);
  const { preferences: imageSharePreferences, ready: imageSharePreferencesReady, setPreference: setImageSharePreference } = useMobileNoteImagePreferences();
  const {
    format: imageShareFormat, theme: imageShareTheme, fontStyle: imageShareFontStyle,
    fontSize: imageShareFontSize, cardWidth: imageShareCardWidth, showTitle: imageShareTitle,
    showNotebook: imageShareNotebook, showTags: imageShareTags, showUpdatedAt: imageShareUpdatedAt,
    showBranding: imageShareBranding,
  } = imageSharePreferences;
  const imageShareFontLabel = getMobileNoteImageFontLabel(imageShareFontStyle, imageShareTheme, resolvedLocale === "zh-CN");
  const [viewerNotebookPickerOpen, setViewerNotebookPickerOpen] = useState(false);
  const [viewerTagsOpen, setViewerTagsOpen] = useState(false);
  const [viewerTags, setViewerTags] = useState<string[]>([]);
  const [viewerNotebookId, setViewerNotebookId] = useState("");
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [preparedNoteImage, setPreparedNoteImage] = useState<MobilePreparedNoteImage | null>(null);
  const [imageSavePickerOpen, setImageSavePickerOpen] = useState(false);
  const [savedImagePath, setSavedImagePath] = useState<string | null>(null);
  const savedImageTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewerGeneration, setViewerGeneration] = useState(0);
  const viewerRef = useRef<LocalTiptapEditorRef>(null);
  // Expo assigns its native DOM proxy only when ref.current is null and does
  // not clear it on unmount. Give each WebView lifetime its own ref, then
  // publish the ready handle through the stable ref used by editor actions.
  const domViewerRef = useMemo(() => ({ current: null as LocalTiptapEditorRef | null }), [memo?.id, viewerGeneration, visible]);
  useEffect(() => {
    viewerRef.current = null;
    setViewerReady(false);
  }, [domViewerRef]);
  const imageExportIntentRef = useRef<"preview" | "share">("share");
  const imageShareOpenedMemoRef = useRef<string | null>(null);
  const imageExportRequestRef = useRef<string | null>(null);
  const imageExportChunksRef = useRef<string[]>([]);
  const imageExportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resourceDataUrlCacheRef = useRef(new Map<string, Promise<string | null>>());
  // One user-visible notice per opened memo (multi-image notes should not spam alerts).
  const imageLoadFailureNotifier = useMemo(
    () =>
      createOnceProtectedResourceFailureNotifier((failure) => {
        alertProtectedImageLoadFailure(resolvedLocale, failure);
      }),
    [memo?.id, resolvedLocale]
  );

  const baseUrl = session?.baseUrl.replace(/\/+$/, "") ?? "";
  const viewerContent = useMemo<TiptapDoc>(
    () => (memo ? resolveMobileMemoViewerContent(memo.contentJson, memo.contentMarkdown) : { type: "doc", content: [{ type: "paragraph" }] }),
    [memo]
  );
  const isVisualDiagram = useMemo(
    () => (memo ? hasMobileVisualDiagram(memo.contentMarkdown) : false),
    [memo]
  );
  const isStructuredTable = useMemo(
    () => (memo ? hasMobileStructuredTable(memo.contentMarkdown) : false),
    [memo]
  );
  const locksRichTextEdit = isVisualDiagram || isStructuredTable || Boolean(memo && (hasMobileInfographic(memo.contentMarkdown) || hasMobilePoster(memo.contentMarkdown)));
  const visualDiagramJson = useMemo(() => {
    const diagram = memo ? parseDiagramDocument(memo.contentMarkdown) : null;
    return diagram ? JSON.stringify(diagram) : undefined;
  }, [memo]);
  const isEditing = Boolean(editingSession);
  const noteBodyDom = useMemo(() => ({
    ...SAFE_DOM_WEBVIEW_PROPS,
    bounces: true,
    contentInsetAdjustmentBehavior: "never" as const,
    overScrollMode: "never" as const,
    scrollEnabled: false,
    style: [
      detailLayoutStyles.viewer,
      resolvedTheme === "dark" ? detailLayoutStyles.viewerDark : null,
    ],
  }), [resolvedTheme]);
  const editor = useMobileRichEditor({
    active: isEditing,
    alreadyReady: viewerReady,
    baseUrl,
    editorRef: viewerRef,
    handleHardwareBack: false,
    imageCompressionEnabled,
    initialDraft: editingSession?.draft ?? null,
    initialFocus: editingSession?.initialFocus ?? "body",
    memo: editingSession?.memo ?? memo,
    notebooks,
    onClose: onCloseEditor,
    updateMutation,
  });

  const downloadResource = useCallback(async (target: MobileResourceTarget) => {
    if (!client) throw new Error(resolvedLocale !== "zh-CN" ? "The resource client is unavailable." : "当前无法读取资源。");
    try {
      await openMobileResource(client, target, { baseUrl, token: session?.token });
    } catch (error) {
      Alert.alert(
        resolvedLocale !== "zh-CN" ? "Unable to open resource" : "无法打开资源",
        error instanceof Error ? error.message : (resolvedLocale !== "zh-CN" ? "Try again later." : "请稍后重试。")
      );
      throw error;
    }
  }, [baseUrl, client, resolvedLocale, session?.token]);
  const handleViewerNotebookSelect = useCallback((nextNotebookId: string) => {
    setViewerNotebookPickerOpen(false);
    if (nextNotebookId && nextNotebookId !== "all") setViewerNotebookId(nextNotebookId);
    setViewerTagsOpen(true);
  }, []);
  const openViewerTags = () => {
    if (!memo || memo.isDeleted || isSaving) return;
    setViewerTags([...memo.tags]);
    setViewerNotebookId(memo.notebookId);
    setViewerTagsOpen(true);
  };
  const saveViewerMetadata = async () => {
    if (!memo || memo.isDeleted || metadataSaving || isSaving) return;
    if (viewerNotebookId === memo.notebookId && viewerTags.join("\n") === memo.tags.join("\n")) {
      setViewerTagsOpen(false);
      return;
    }
    setMetadataSaving(true);
    try {
      await updateMutation.mutateAsync({ memo, payload: { notebookId: viewerNotebookId, tags: viewerTags } });
      setViewerTagsOpen(false);
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请重试");
    } finally {
      setMetadataSaving(false);
    }
  };

  const saveResourceAs = useCallback(async (target: MobileResourceTarget) => {
    if (!client) throw new Error(resolvedLocale !== "zh-CN" ? "The resource client is unavailable." : "当前无法读取资源。");
    const result = await saveMobileResourceAs(client, target, { baseUrl, token: session?.token });
    if (result.kind === "saf") {
      Alert.alert(
        resolvedLocale !== "zh-CN" ? "Downloaded" : "下载成功",
        resolvedLocale !== "zh-CN" ? `Saved ${result.filename}` : `已保存：${result.filename}`
      );
    }
  }, [baseUrl, client, resolvedLocale, session?.token]);

  const loadViewerResource = useCallback((source: string) => {
    if (!client) {
      return Promise.resolve(null);
    }
    return loadProtectedResourceDataUrl(source, {
      baseUrl: session?.baseUrl ?? "",
      cache: resourceDataUrlCacheRef.current,
      cacheLimit: RESOURCE_DATA_URL_CACHE_LIMIT,
      getResourceBlob: client.getResourceBlob,
      onFailure: imageLoadFailureNotifier,
      token: session?.token,
    });
  }, [client, imageLoadFailureNotifier, session?.baseUrl, session?.token]);

  const onResourcePress = useCallback(async (targetJson: string) => {
    const target = parseMobileResourceTargetJson(targetJson);
    if (target) {
      setResourceTarget(target);
    }
  }, []);

  const onImagePreview = useCallback(async (payloadJson: string) => {
    try {
      const parsed = JSON.parse(payloadJson) as { alt?: unknown; source?: unknown };
      if (typeof parsed.source === "string" && parsed.source) {
        setImagePreview({
          alt: typeof parsed.alt === "string" ? parsed.alt : "",
          source: parsed.source,
        });
      }
    } catch {
      // Ignore malformed bridge payloads.
    }
  }, []);

  const memoTitle = localizeUntitledMemoTitle(memo?.title, resolvedLocale);
  const memoTagsText = memo?.tags.join(", ") ?? "";
  const metadataSearchMatches = useMemo(() => ({
    tags: getTextSearchMatches(memoTagsText, searchQuery),
    title: getTextSearchMatches(memoTitle, searchQuery),
  }), [memoTagsText, memoTitle, searchQuery]);
  const metadataSearchMatchCount = metadataSearchMatches.title.length + metadataSearchMatches.tags.length;
  const searchMatchCount = metadataSearchMatchCount + bodySearchMatchCount;
  const searchMatchLabel = searchQuery.trim()
    ? `${searchMatchCount > 0 ? activeMatchIndex + 1 : 0}/${searchMatchCount}`
    : "0/0";
  const syncStatusLabel = isSaving || syncStatus === "syncing"
    ? "保存中"
    : syncStatus === "conflict"
      ? "同步冲突"
      : syncStatus === "error"
        ? "同步失败"
        : syncStatus === "pending"
          ? "待同步"
          : "已同步";
  const syncStatusInteractive = syncStatus === "conflict" || syncStatus === "error" || syncStatus === "pending";
  const handleSyncStatusPress = () => {
    if (!memo) {
      return;
    }
    if (syncStatus === "conflict") {
      onResolveSyncConflict(memo);
      return;
    }
    if (syncStatus === "error" || syncStatus === "pending") {
      const detail = syncError?.trim()
        || (syncStatus === "pending"
          ? "本地改动还在等待上传到云端。可立即重试同步。"
          : "本地改动未能上传到云端。可立即重试同步。");
      Alert.alert(syncStatusLabel, detail, [
        { text: "取消", style: "cancel" },
        { text: "立即同步", onPress: onRetrySync },
      ]);
    }
  };
  const editFabBottom = Math.max(
    safeAreaInsets.bottom,
    Platform.OS === "android" ? ANDROID_SYSTEM_NAVIGATION_FALLBACK : 0
  ) + 16;

  const handleReaderScroll = useCallback(async (collapsed: boolean) => {
    setTitleCollapsed(collapsed);
  }, []);

  useEffect(() => {
    if (!visible) {
      setTitleCollapsed(false);
      setImageShareFontPickerOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!imageShareFromList || !visible) {
      imageShareOpenedMemoRef.current = null;
      return;
    }
    if (!memo || !viewerReady || imageShareOpenedMemoRef.current === memo.id) return;
    imageShareOpenedMemoRef.current = memo.id;
    setImageShareOptionsOpen(true);
  }, [imageShareFromList, memo, viewerReady, visible]);

  const closeImageShareOptions = () => {
    imageFontRecoveryRef.current = null;
    clearImageExportTimeout();
    imageExportRequestRef.current = null;
    imageExportChunksRef.current = [];
    setIsExportingImage(false);
    setImageShareFontPickerOpen(false);
    setImageShareOptionsOpen(false);
    if (imageShareFromList) onClose();
  };

  const closeImagePreview = () => {
    imageFontRecoveryRef.current = null;
    clearImageExportTimeout();
    imageExportRequestRef.current = null;
    imageExportChunksRef.current = [];
    setIsExportingImage(false);
    setPreparedNoteImage(null);
    setImageShareOptionsOpen(false);
    if (imageShareFromList) {
      onClose();
    }
  };

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    setTitleCollapsed(false);
    setActionsOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setBodySearchMatchCount(0);
    setActiveMatchIndex(0);
    setImagePreview(null);
    setAiAssistantOpen(false);
    setViewerNotebookPickerOpen(false);
    setViewerTagsOpen(false);
    safeDomCall(() => viewerRef.current?.search("", -1));
  }, [isEditing]);

  useEffect(() => {
    const normalizedInitialSearchQuery = initialSearchQuery.trim();
    setViewerReady(false);
    setTitleCollapsed(false);
    setSearchOpen(Boolean(normalizedInitialSearchQuery));
    setSearchQuery(normalizedInitialSearchQuery);
    setBodySearchMatchCount(0);
    setActiveMatchIndex(0);
    setImagePreview(null);
    setResourceTarget(null);
    setViewerNotebookPickerOpen(false);
    setViewerTagsOpen(false);
    resourceDataUrlCacheRef.current.clear();
  }, [initialSearchQuery, memo?.id]);

  useEffect(() => {
    if (!viewerReady || !searchOpen) {
      return;
    }
    const bodyMatchIndex = activeMatchIndex - metadataSearchMatchCount;
    const runSearch = () => {
      safeDomCall(() => viewerRef.current?.search(searchQuery, bodyMatchIndex >= 0 ? bodyMatchIndex : -1));
    };
    runSearch();
    // The first imperative call can land while Android is replacing the DOM
    // WebView after navigation. Short idempotent retries make that ready race
    // deterministic; stale callbacks are rejected by their query below.
    const retryTimers = [120, 360].map((delayMs) => setTimeout(runSearch, delayMs));
    return () => retryTimers.forEach(clearTimeout);
  }, [activeMatchIndex, metadataSearchMatchCount, searchOpen, searchQuery, viewerReady]);

  useEffect(() => {
    setActiveMatchIndex((current) => searchMatchCount > 0
      ? Math.min(current, searchMatchCount - 1)
      : 0);
  }, [searchMatchCount]);

  const moveSearchMatch = (direction: 1 | -1) => {
    if (searchMatchCount === 0) {
      return;
    }
    setActiveMatchIndex((current) => getNextMobileNoteSearchIndex(current, direction, searchMatchCount));
  };
  const closeNoteSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setBodySearchMatchCount(0);
    setActiveMatchIndex(0);
    safeDomCall(() => viewerRef.current?.search("", -1));
  };

  const closeActionsAndRun = (action: () => void) => {
    setActionsOpen(false);
    action();
  };

  const canCopyMemoId = Boolean(memo && !memo.id.startsWith("local:") && !memo.id.startsWith("local_"));
  const copyMemoId = async () => {
    if (!memo || !canCopyMemoId) return;
    try {
      await Clipboard.setStringAsync(memo.id);
      Alert.alert(
        resolvedLocale !== "zh-CN" ? "Note ID copied" : "笔记 ID 已复制",
        memo.id
      );
    } catch {
      Alert.alert(
        resolvedLocale !== "zh-CN" ? "Could not copy note ID" : "复制笔记 ID 失败",
        resolvedLocale !== "zh-CN" ? "Please try again." : "请稍后重试。"
      );
    }
  };

  const clearImageExportTimeout = useCallback(() => {
    if (imageExportTimeoutRef.current !== null) {
      clearTimeout(imageExportTimeoutRef.current);
      imageExportTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearImageExportTimeout, [clearImageExportTimeout]);

  useEffect(() => {
    imageFontRecoveryRef.current = null;
    clearImageExportTimeout();
    imageExportRequestRef.current = null;
    imageExportChunksRef.current = [];
    setIsExportingImage(false);
    setPreparedNoteImage(null);
  }, [memo?.id, clearImageExportTimeout]);

  useEffect(() => () => {
    if (savedImageTipTimerRef.current !== null) clearTimeout(savedImageTipTimerRef.current);
  }, []);

  useEffect(() => {
    if (visible) return;
    imageFontRecoveryRef.current = null;
    clearImageExportTimeout();
    imageExportRequestRef.current = null;
    imageExportChunksRef.current = [];
    setIsExportingImage(false);
    setImageShareOptionsOpen(false);
    setPreparedNoteImage(null);
    setSavedImagePath(null);
    if (savedImageTipTimerRef.current !== null) clearTimeout(savedImageTipTimerRef.current);
  }, [clearImageExportTimeout, visible]);

  const failImageExport = useCallback((message?: string) => {
    clearImageExportTimeout();
    imageExportChunksRef.current = [];
    imageExportRequestRef.current = null;
    setIsExportingImage(false);
    if (imageShareFromList) setImageShareOptionsOpen(true);
    const localizedMessage = message === "NOTE_IMAGE_TOO_LONG"
      ? (resolvedLocale !== "zh-CN"
          ? "This note is too long for one readable image. Choose a smaller font size or split the note."
          : "这篇笔记太长，无法生成清晰的单张图片。请调小导出字号，或拆分笔记后重试。")
      : message === "NOTE_IMAGE_RENDER_FAILED"
        ? (resolvedLocale !== "zh-CN"
            ? "This image could not be rendered on this device. Try a smaller font size or a shorter note."
            : "这台设备无法渲染这张图片。请调小导出字号，或缩短笔记后重试。")
      : message;
    Alert.alert(
      resolvedLocale !== "zh-CN" ? "Image export failed" : "导出笔记图片失败",
      localizedMessage || (resolvedLocale !== "zh-CN" ? "Try again later." : "请稍后重试。")
    );
  }, [clearImageExportTimeout, imageShareFromList, resolvedLocale]);

  const handleImageExportEvent = useCallback(async (payloadJson: string) => {
    let event: MobileImageExportEvent;
    try {
      event = JSON.parse(payloadJson) as MobileImageExportEvent;
    } catch {
      return;
    }
    if (event.type === "fonts-ready") {
      const recovery = imageFontRecoveryRef.current;
      if (recovery?.requestId === event.requestId) {
        recovery.ready = true;
        if (recovery.complete) recovery.retry();
      }
      return;
    }
    if (!event.requestId || event.requestId !== imageExportRequestRef.current) return;
    if (event.type === "font-status") { setImageFontStatus(event.status); return; }
    if (event.type === "progress") {
      console.info(`[EdgeEverImageExport] ${event.stage}=${event.elapsedMs ?? 0}ms`);
      setImageExportStage(event.stage);
      return;
    }
    if (event.type === "chunk") {
      imageExportChunksRef.current.push(event.chunk);
      return;
    }
    if (event.type === "error") {
      failImageExport(event.message);
      return;
    }

    clearImageExportTimeout();
    try {
      // A fresh URI prevents Android's decoded-image cache from displaying an
      // earlier export when different notes share the same download filename.
      const directory = new Directory(Paths.cache, "edgeever-note-exports", event.requestId);
      if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
      const file = new File(encodeMobileNoteImageFileUri(Paths.join(directory, event.filename)));
      if (file.exists) file.delete();
      file.create({ overwrite: true, intermediates: true });
      file.write(decodeBase64Chunks(imageExportChunksRef.current));
      const prepared: MobilePreparedNoteImage = {
        fontFallback: event.fontFallback === true,
        failedImages: event.failedImages ?? 0,
        filename: event.filename,
        height: event.height ?? 0,
        mimeType: event.mimeType,
        totalImages: event.totalImages ?? 0,
        uri: file.uri,
        width: event.width ?? 0,
      };
      if (imageExportIntentRef.current === "preview" || prepared.fontFallback) {
        setPreparedNoteImage(prepared);
      } else {
        setIsExportingImage(false);
        if (!(await Sharing.isAvailableAsync())) throw new Error(resolvedLocale !== "zh-CN" ? "Sharing is unavailable on this device." : "当前设备无法打开系统分享面板。");
        await Sharing.shareAsync(file.uri, {
          dialogTitle: event.filename,
          mimeType: event.mimeType,
        });
      }
    } catch (error) {
      Alert.alert(
        resolvedLocale !== "zh-CN" ? "Image export failed" : "导出笔记图片失败",
        error instanceof Error ? error.message : (resolvedLocale !== "zh-CN" ? "Try again later." : "请稍后重试。")
      );
    } finally {
      imageExportChunksRef.current = [];
      imageExportRequestRef.current = null;
      setIsExportingImage(false);
      const recovery = imageFontRecoveryRef.current;
      if (recovery?.requestId === event.requestId) {
        recovery.complete = event.fontFallback === true;
        if (recovery.complete && recovery.ready) setTimeout(() => {
          if (imageFontRecoveryRef.current === recovery) recovery.retry();
        }, 0);
      }
    }
  }, [clearImageExportTimeout, failImageExport, resolvedLocale]);

  const exportMemoImage = useCallback((
    format: "jpeg" | "png",
    options: {
      theme?: NoteImageTheme;
      fontStyle?: NoteImageFontStyle;
      fontSize?: NoteImageFontSize;
      cardWidth?: NoteImageCardWidth;
      showTitle?: boolean;
      showNotebook?: boolean;
      showTags?: boolean;
      showUpdatedAt?: boolean;
      showBranding?: boolean;
      intent?: "preview" | "share";
    } = {},
  ): void => {
    if (!memo || !viewerReady || isExportingImage || imageExportRequestRef.current !== null) return;
    const viewer = viewerRef.current;
    if (!viewer) {
      failImageExport(resolvedLocale !== "zh-CN" ? "The note viewer is not ready. Try again." : "笔记尚未准备好，请重试。");
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    imageExportRequestRef.current = requestId;
    imageExportChunksRef.current = [];
    imageExportIntentRef.current = options.intent ?? "share";
    imageFontRecoveryRef.current = { requestId, ready: false, complete: false,
      retry: () => exportMemoImage(format, { ...options, intent: "preview" }) };
    setImageFontStatus("loading");
    setImageExportStage("prepare");
    setIsExportingImage(true);
    imageExportTimeoutRef.current = setTimeout(() => {
      if (imageExportRequestRef.current !== requestId) return;
      failImageExport(resolvedLocale !== "zh-CN"
        ? "Image generation timed out. Please try again."
        : "生成图片超时，请重试。");
      setViewerReady(false);
      setViewerGeneration((generation) => generation + 1);
    }, IMAGE_EXPORT_TIMEOUT_MS);
    const request = JSON.stringify({
      requestId,
      format,
      title: localizeUntitledMemoTitle(memo.title, resolvedLocale),
      fallbackTitle: localizeUntitledMemoTitle(null, resolvedLocale),
      notebook: options.showNotebook === false ? "" : notebookName,
      tags: options.showTags === false ? [] : memo.tags,
      updatedAt: options.showUpdatedAt === false ? "" : new Date(memo.updatedAt).toLocaleString(resolvedLocale),
      theme: options.theme ?? "mint",
      fontStyle: options.fontStyle ?? "auto",
      fontSize: options.fontSize ?? "lg",
      cardWidth: options.cardWidth ?? "wide",
      showTitle: options.showTitle ?? false,
      showNotebook: options.showNotebook ?? false,
      showTags: options.showTags ?? false,
      showUpdatedAt: options.showUpdatedAt ?? true,
      branding: options.showBranding ?? true,
    });
    try {
      void Promise.resolve(viewer.exportImage(request)).catch((error: unknown) => {
        if (imageExportRequestRef.current === requestId) {
          failImageExport(error instanceof Error ? error.message : undefined);
        }
      });
    } catch (error) {
      failImageExport(error instanceof Error ? error.message : undefined);
    }
  }, [failImageExport, isExportingImage, memo, notebookName, resolvedLocale, viewerReady]);

  const sharePreparedNoteImage = useCallback(async (prepared: MobilePreparedNoteImage) => {
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error(resolvedLocale !== "zh-CN" ? "Sharing is unavailable on this device." : "当前设备无法打开系统分享面板。");
      await Sharing.shareAsync(prepared.uri, { dialogTitle: prepared.filename, mimeType: prepared.mimeType });
    } catch (shareError) {
      Alert.alert(
        resolvedLocale !== "zh-CN" ? "Share failed" : "分享失败",
        shareError instanceof Error ? shareError.message : (resolvedLocale !== "zh-CN" ? "Try again later." : "请稍后重试。")
      );
    }
  }, [resolvedLocale]);

  const savePreparedNoteImage = useCallback(async (prepared: MobilePreparedNoteImage) => {
    // The Android directory picker needs the preview Modal to finish dismissing first.
    setImageSavePickerOpen(true);
    let destination: string | null = null;
    let savedPath: string | null = null;
    try {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
        FileSystem.StorageAccessFramework.getUriForDirectoryInRoot("Pictures")
      );
      if (!permission.granted) return;
      destination = await FileSystem.StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        prepared.filename.replace(/\.[^.]+$/, ""),
        prepared.mimeType
      );
      const base64 = await new File(prepared.uri).base64();
      await FileSystem.StorageAccessFramework.writeAsStringAsync(destination, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      savedPath = getSavedImagePath(destination)
        ?? (resolvedLocale !== "zh-CN" ? `Selected folder / ${prepared.filename}` : `所选文件夹 / ${prepared.filename}`);
    } catch (saveError) {
      if (destination) {
        await FileSystem.StorageAccessFramework.deleteAsync(destination, { idempotent: true }).catch(() => {});
      }
      const message = saveError instanceof Error ? saveError.message : "";
      const isUnwritableDirectory = /isn't writable|not writable|EACCES|Permission denied/i.test(message);
      Alert.alert(
        resolvedLocale !== "zh-CN" ? "Save failed" : "保存失败",
        isUnwritableDirectory
          ? (resolvedLocale !== "zh-CN" ? "This folder cannot accept files. Choose a folder in internal storage, such as Pictures." : "此文件夹无法写入。请选择内部存储中的其他文件夹，例如“Pictures”。")
          : (message || (resolvedLocale !== "zh-CN" ? "Try again later." : "请稍后重试。"))
      );
    } finally {
      setImageSavePickerOpen(false);
    }
    if (savedPath) {
      if (savedImageTipTimerRef.current !== null) clearTimeout(savedImageTipTimerRef.current);
      setSavedImagePath(savedPath);
      savedImageTipTimerRef.current = setTimeout(() => {
        setSavedImagePath(null);
        savedImageTipTimerRef.current = null;
      }, 4_000);
    }
  }, [resolvedLocale]);

  return (
    <Modal animationType="slide" onRequestClose={isEditing ? () => void editor.requestClose() : onClose} presentationStyle="fullScreen" visible={visible}>
      {/* Unmount the DomWebView with the modal. Updating its props after RN hides
          the native view rejects injectJavaScript as an uncaught promise. */}
      {visible ? (
      <SafeAreaView style={isEditing ? styles.richEditorSafeArea : styles.modalSafeArea}>
        <KeyboardAvoidingView
          behavior="height"
          enabled={Platform.OS === "android" && isEditing}
          style={styles.richEditorKeyboardAvoiding}
        >
        {isEditing ? (
          <View style={styles.createMemoHeader}>
            <Pressable accessibilityLabel="返回" accessibilityRole="button" disabled={editor.uploading} onPress={() => void editor.requestClose()} style={styles.createMemoBackButton}>
              <ChevronLeft color={editor.uploading ? "#cbd5e1" : "#0f172a"} size={30} />
            </Pressable>
            <View style={styles.createMemoHeaderActions}>
              <Text numberOfLines={1} style={[styles.createMemoStatus, styles.richEditorHeaderStatus, (editor.saving || editor.uploading || editor.dirty) && styles.createMemoStatusActive, editor.error && styles.richEditorStatusError]}>{editor.saveLabel}</Text>
              <Pressable
                accessibilityLabel="完成编辑"
                accessibilityRole="button"
                disabled={editor.uploading || !editor.ready}
                onPress={() => void editor.requestClose()}
                style={[styles.createMemoDoneButton, (editor.uploading || !editor.ready) && styles.createMemoDoneButtonDisabled]}
              >
                {editor.saving ? <ActivityIndicator color="#64748b" size="small" /> : <Text style={[styles.createMemoDoneText, (editor.uploading || !editor.ready) && styles.createMemoDoneTextDisabled]}>完成</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
        <View style={styles.detailHeader}>
          <Pressable accessibilityLabel="返回列表" accessibilityRole="button" onPress={onClose} style={styles.detailHeaderButton}>
            <ChevronLeft color="#475569" size={21} />
          </Pressable>
          <View style={detailLayoutStyles.headerTitleSlot}>
            {titleCollapsed && !searchOpen && memo ? (
              !memo.isDeleted && !locksRichTextEdit ? (
                <Pressable
                  accessibilityHint="进入编辑并聚焦标题"
                  accessibilityLabel={`编辑笔记标题：${memoTitle}`}
                  accessibilityRole="button"
                  onPress={() => {
                    beginEditorStartup();
                    onRichEdit(memo, "title");
                  }}
                >
                  <Text numberOfLines={1} style={detailLayoutStyles.headerTitle}>{memoTitle}</Text>
                </Pressable>
              ) : (
                <Text numberOfLines={1} style={detailLayoutStyles.headerTitle}>{memoTitle}</Text>
              )
            ) : null}
          </View>
          <View style={styles.detailHeaderActions}>
            <Pressable
              accessibilityHint={
                syncStatus === "conflict"
                  ? "查看并处理同步冲突"
                  : syncStatusInteractive
                    ? "查看同步状态并立即重试"
                    : undefined
              }
              accessibilityLabel={syncStatusLabel}
              accessibilityRole={syncStatusInteractive ? "button" : "text"}
              disabled={!syncStatusInteractive || !memo}
              onPress={handleSyncStatusPress}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.detailSyncStatus,
                  syncStatus === "conflict" && styles.detailSyncStatusConflict,
                  syncStatus === "error" && styles.detailSyncStatusError,
                  syncStatus === "pending" && styles.detailSyncStatusPending,
                ]}
              >
                {syncStatusLabel}
              </Text>
            </Pressable>
            {memo && !memo.isDeleted ? (
              <Pressable
                accessibilityLabel="选择笔记标签"
                accessibilityHint="点选已有标签，或输入名称创建新标签"
                accessibilityRole="button"
                disabled={isSaving}
                hitSlop={6}
                onPress={openViewerTags}
                style={styles.detailHeaderIconButton}
              >
                <Tag color={memo.tags.length > 0 ? "#16A06E" : "#475569"} size={20} />
              </Pressable>
            ) : null}
            {memo && !memo.isDeleted ? (
              <Pressable
                accessibilityLabel="搜索当前笔记"
                accessibilityRole="button"
                onPress={() => setSearchOpen(true)}
                style={styles.detailHeaderIconButton}
              >
                <Search color="#475569" size={20} />
              </Pressable>
            ) : null}
            {memo ? (
              <Pressable accessibilityLabel="笔记操作" accessibilityRole="button" onPress={() => setActionsOpen(true)} style={styles.detailHeaderIconButton}>
                <MoreHorizontal color="#475569" size={21} />
              </Pressable>
            ) : null}
          </View>
        </View>
        )}

        {!isEditing && syncStatus === "conflict" && memo ? (
          <View style={styles.conflictBanner}>
            <Text style={styles.conflictBannerText}>
              云端笔记已在其他标签页、设备，或离线期间被更新。可先复制本地草稿，再采用云端版本后继续编辑。
            </Text>
            {syncError ? <Text style={styles.conflictBannerText}>{syncError}</Text> : null}
            <View style={styles.conflictBannerActions}>
              <Pressable
                accessibilityLabel="采用云端并重新加载"
                accessibilityRole="button"
                onPress={() => onAdoptCloudVersion(memo)}
                style={styles.conflictBannerPrimaryButton}
              >
                <Text style={styles.conflictBannerPrimaryButtonText}>采用云端并重新加载</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="复制本地草稿"
                accessibilityRole="button"
                onPress={() => onCopyLocalDraft(memo)}
                style={styles.conflictBannerSecondaryButton}
              >
                <Text style={styles.conflictBannerSecondaryButtonText}>复制本地草稿</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="查看并处理同步冲突"
                accessibilityRole="button"
                onPress={() => onResolveSyncConflict(memo)}
                style={styles.conflictBannerSecondaryButton}
              >
                <Text style={styles.conflictBannerSecondaryButtonText}>更多</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!isEditing && (syncStatus === "error" || syncStatus === "pending") && memo ? (
          <View style={syncStatus === "error" ? styles.syncErrorBanner : styles.syncPendingBanner}>
            <Text style={syncStatus === "error" ? styles.syncErrorBannerText : styles.syncPendingBannerText}>
              {syncStatus === "error"
                ? (syncError?.trim() || "本地改动未能上传到云端。内容仍保存在本机，可立即重试。")
                : (syncError?.trim() || "本地改动待上传。下拉刷新或点此可立即同步。")}
            </Text>
            <View style={styles.conflictBannerActions}>
              <Pressable
                accessibilityLabel="立即同步"
                accessibilityRole="button"
                onPress={onRetrySync}
                style={syncStatus === "error" ? styles.syncErrorBannerPrimaryButton : styles.syncPendingBannerPrimaryButton}
              >
                <Text style={styles.conflictBannerPrimaryButtonText}>立即同步</Text>
              </Pressable>
              {syncStatus === "error" ? (
                <Pressable
                  accessibilityLabel="复制本地草稿"
                  accessibilityRole="button"
                  onPress={() => onCopyLocalDraft(memo)}
                  style={styles.syncErrorBannerSecondaryButton}
                >
                  <Text style={styles.syncErrorBannerSecondaryButtonText}>复制本地草稿</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#0f172a" />
          </View>
        ) : memo ? (
          <View style={detailLayoutStyles.body}>
            {isEditing ? (
              <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                <TextInput
                  autoFocus={editingSession?.initialFocus === "title"}
                  onChangeText={(value) => {
                    editor.setTitle(value);
                    editor.markDirty();
                  }}
                  placeholder={DEFAULT_MEMO_TITLE}
                  placeholderTextColor="#94a3b8"
                  selectTextOnFocus={editingSession?.initialFocus === "title"}
                  style={styles.createMemoTitleInput}
                  value={editor.title}
                />
                <View style={[styles.createMemoMetaRow, styles.richStandaloneMetaRow]}>
                  <Pressable accessibilityLabel="所在笔记本" accessibilityRole="button" onPress={() => editor.setNotebookPickerOpen(true)} style={styles.createMemoNotebookButton}>
                    <Text numberOfLines={1} style={styles.createMemoNotebookText}>{editor.notebookLabel}</Text>
                    <ChevronDown color="#64748b" size={14} />
                  </Pressable>
                  <Pressable accessibilityLabel="选择笔记标签" accessibilityRole="button" onPress={() => editor.setTagPickerOpen(true)} style={[styles.createMemoTagsButton, styles.richStandaloneTagsInput]}>
                    <Text numberOfLines={1} style={[styles.createMemoTagsInput, !editor.tagsText && styles.createMemoTagsPlaceholder]}>
                      {editor.tagsText || "添加标签"}
                    </Text>
                    <ChevronDown color="#94a3b8" size={14} />
                  </Pressable>
                  <SmartTagButton
                    client={client}
                    contentMarkdown={editor.contentMarkdown}
                    disabled={editor.saving || editor.uploading}
                    onChange={(nextTags) => {
                      editor.setTagsText(nextTags.join(", "));
                      editor.markDirty();
                    }}
                    selectedTags={parseTags(editor.tagsText)}
                    title={editor.title}
                  />
                </View>
                {editor.draftRestored ? <Text style={styles.richEditorDraftNotice}>已恢复上次未完成的本地草稿</Text> : null}
                {editor.error ? <Text style={styles.richEditorInlineError}>{editor.error}</Text> : null}
              </View>
            ) : titleCollapsed && !searchOpen ? null : (
            <View style={detailLayoutStyles.meta}>
              {!memo.isDeleted && !locksRichTextEdit ? (
                <Pressable
                  accessibilityHint="进入编辑并聚焦标题"
                  accessibilityLabel="编辑笔记标题"
                  accessibilityRole="button"
                  onPress={() => {
                    beginEditorStartup();
                    onRichEdit(memo, "title");
                  }}
                >
                  <HighlightedMetadataText
                    activeIndex={activeMatchIndex}
                    matchOffset={0}
                    matches={metadataSearchMatches.title}
                    style={styles.detailTitle}
                    text={memoTitle}
                  />
                </Pressable>
              ) : (
                <HighlightedMetadataText
                  activeIndex={activeMatchIndex}
                  matchOffset={0}
                  matches={metadataSearchMatches.title}
                  style={styles.detailTitle}
                  text={memoTitle}
                />
              )}
              {searchOpen || memo.isDeleted ? (
              <View style={styles.detailMetaRow}>
                {memo.isDeleted ? (
                <View style={styles.detailNotebookButton}>
                  <Text numberOfLines={1} selectable style={styles.detailNotebookName}>{notebookName}</Text>
                  <ChevronDown color="#94a3b8" size={14} />
                </View>
                ) : (
                <Pressable
                  accessibilityHint="更改笔记所属笔记本"
                  accessibilityLabel="所在笔记本"
                  accessibilityRole="button"
                  disabled={isSaving}
                  hitSlop={8}
                  onPress={openViewerTags}
                  style={styles.detailNotebookButton}
                >
                  <Text numberOfLines={1} style={styles.detailNotebookName}>{notebookName}</Text>
                  <ChevronDown color="#94a3b8" size={14} />
                </Pressable>
                )}
                <View style={styles.detailTagsGroup}>
                  <Tag color="#64748b" size={13} />
                  <HighlightedMetadataText
                    activeIndex={activeMatchIndex}
                    matchOffset={metadataSearchMatches.title.length}
                    matches={metadataSearchMatches.tags}
                    style={[styles.detailTagsInline, memo.tags.length === 0 && styles.detailTagsPlaceholder]}
                    text={memoTagsText || "添加标签，用逗号分隔"}
                  />
                </View>
              </View>
              ) : null}
              {searchOpen ? (
                <View style={styles.noteSearchPanel}>
                  <Search color="#64748b" size={16} />
                  <TextInput
                    accessibilityLabel="在当前笔记内搜索"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(value) => {
                      setSearchQuery(value);
                      setBodySearchMatchCount(0);
                      setActiveMatchIndex(0);
                    }}
                    onSubmitEditing={() => moveSearchMatch(1)}
                    placeholder="搜索"
                    placeholderTextColor="#94a3b8"
                    returnKeyType="search"
                    style={styles.noteSearchInput}
                    value={searchQuery}
                  />
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.noteSearchCount, searchQuery.trim() && searchMatchCount === 0 && styles.noteSearchCountEmpty]}
                  >
                    {searchMatchLabel}
                  </Text>
                  <Pressable
                    accessibilityLabel="上一个搜索结果"
                    accessibilityRole="button"
                    disabled={searchMatchCount === 0}
                    hitSlop={4}
                    onPress={() => moveSearchMatch(-1)}
                    style={[styles.noteSearchIconButton, searchMatchCount === 0 && styles.buttonDisabled]}
                  >
                    <ChevronUp color={searchMatchCount === 0 ? "#cbd5e1" : "#0f172a"} size={18} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="下一个搜索结果"
                    accessibilityRole="button"
                    disabled={searchMatchCount === 0}
                    hitSlop={4}
                    onPress={() => moveSearchMatch(1)}
                    style={[styles.noteSearchIconButton, searchMatchCount === 0 && styles.buttonDisabled]}
                  >
                    <ChevronDown color={searchMatchCount === 0 ? "#cbd5e1" : "#0f172a"} size={18} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="关闭搜索"
                    accessibilityRole="button"
                    hitSlop={4}
                    onPress={closeNoteSearch}
                    style={styles.noteSearchIconButton}
                  >
                    <X color="#0f172a" size={16} />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.detailDivider} />
            </View>
            )}
            {baseUrl ? (
              <LocalTiptapEditor
                key={`${memo.id}:${viewerGeneration}`}
                aiPromptsJson={isEditing ? editor.aiPromptsJson : undefined}
                autoFocus={isEditing && editingSession?.initialFocus === "body"}
                baseUrl={baseUrl}
                content={viewerContent}
                dom={noteBodyDom}
                locale={resolvedLocale}
                mode={isEditing ? "editor" : "viewer"}
                onAiCancel={isEditing ? editor.cancelSelectionAi : undefined}
                onAiRequest={isEditing ? editor.requestSelectionAi : undefined}
                onChange={isEditing ? editor.persistDraft : undefined}
                onImagePreview={isEditing ? undefined : onImagePreview}
                onDoublePress={isEditing || locksRichTextEdit ? undefined : async () => {
                  beginEditorStartup();
                  onRichEdit(memo, "body");
                }}
                onImageExportEvent={handleImageExportEvent}
                onLoadResource={isEditing ? editor.loadEditorResource : loadViewerResource}
                onPickImage={isEditing ? editor.pickAndUploadImage : undefined}
                onReady={async () => {
                  viewerRef.current = domViewerRef.current;
                  setViewerReady(Boolean(viewerRef.current));
                }}
                onReaderScroll={isEditing ? undefined : handleReaderScroll}
                onResourcePress={isEditing ? editor.selectResource : onResourcePress}
                onSearchResult={async (count, _index, resultQuery) => {
                  if (resultQuery === searchQuery) {
                    setBodySearchMatchCount(count);
                  }
                }}
                ref={domViewerRef}
                theme={resolvedTheme}
                visualDiagramJson={isEditing ? undefined : visualDiagramJson}
                visualDiagramNote={!isEditing && isVisualDiagram}
              />
            ) : (
              <View style={styles.centerState}>
                <Text style={styles.errorText}>{resolvedLocale !== "zh-CN" ? "Not signed in." : "未登录。"}</Text>
              </View>
            )}
            {!viewerReady ? (
              <View pointerEvents="none" style={detailLayoutStyles.viewerLoading}>
                <ActivityIndicator color="#0f172a" />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>笔记加载失败</Text>
          </View>
        )}
        {memo && !memo.isDeleted && !locksRichTextEdit && !isEditing ? (
          <Pressable
            accessibilityLabel="编辑笔记"
            accessibilityRole="button"
            onPress={() => {
              beginEditorStartup();
              onRichEdit(memo, "body");
            }}
            style={[styles.detailEditFab, { bottom: editFabBottom }]}
          >
            <Pencil color="#ffffff" size={20} />
          </Pressable>
        ) : null}
        </KeyboardAvoidingView>
        {memo ? (
          <Modal animationType="fade" onRequestClose={() => setActionsOpen(false)} transparent visible={actionsOpen}>
            <Pressable onPress={() => setActionsOpen(false)} style={styles.actionSheetBackdrop}>
              <Pressable style={styles.actionSheet}>
                <View style={styles.actionSheetHandle} />
                <Text style={styles.actionSheetTitle}>{resolvedLocale !== "zh-CN" ? "Note actions" : "笔记操作"}</Text>
                {!memo.isDeleted ? (
                  <>
                    <DetailActionSheetItem
                      disabled={isSharing}
                      icon={isSharing ? <ActivityIndicator color="#16A06E" size="small" /> : <Share2 color="#0f172a" size={18} />}
                      label={resolvedLocale !== "zh-CN" ? "Share note" : "分享笔记"}
                      onPress={() => closeActionsAndRun(() => onShare(memo))}
                    />
                    <DetailActionSheetItem
                      icon={<History color="#0f172a" size={18} />}
                      label={resolvedLocale !== "zh-CN" ? "Version history" : "版本历史"}
                      onPress={() => closeActionsAndRun(() => onOpenRevisions(memo))}
                    />
                  </>
                ) : null}
                {!memo.isDeleted && !locksRichTextEdit ? (
                  <DetailActionSheetItem
                    icon={<Sparkles color="#16A06E" size={18} />}
                    label={resolvedLocale !== "zh-CN" ? "AI note assistant" : "AI 笔记助手"}
                    onPress={() => closeActionsAndRun(() => setAiAssistantOpen(true))}
                  />
                ) : null}
                <DetailActionSheetItem
                  disabled={!canCopyMemoId}
                  icon={<Copy color="#0f172a" size={18} />}
                  label={canCopyMemoId
                    ? (resolvedLocale !== "zh-CN" ? "Copy note ID" : "复制笔记 ID")
                    : (resolvedLocale !== "zh-CN" ? "Copy note ID after sync" : "同步后可复制笔记 ID")}
                  onPress={() => closeActionsAndRun(() => void copyMemoId())}
                />
                <DetailActionSheetItem
                  disabled={isExportingImage || !viewerReady || !imageSharePreferencesReady}
                  icon={isExportingImage ? <ActivityIndicator color="#16A06E" size="small" /> : <Share2 color="#0f172a" size={18} />}
                  label={isExportingImage
                    ? (resolvedLocale !== "zh-CN" ? "Generating share image" : "正在生成分享图片")
                    : (resolvedLocale !== "zh-CN" ? "Share as image" : "分享为图片")}
                  onPress={() => closeActionsAndRun(() => setImageShareOptionsOpen(true))}
                />
                <DetailActionSheetItem
                  disabled={isExportingImage || !viewerReady || !imageSharePreferencesReady}
                  icon={<Download color="#0f172a" size={18} />}
                  label={resolvedLocale !== "zh-CN" ? "Advanced export PNG" : "高级导出 PNG"}
                  onPress={() => closeActionsAndRun(() => exportMemoImage("png"))}
                />
                <DetailActionSheetItem
                  disabled={isExportingImage || !viewerReady || !imageSharePreferencesReady}
                  icon={<Download color="#0f172a" size={18} />}
                  label={resolvedLocale !== "zh-CN" ? "Advanced export JPEG" : "高级导出 JPEG"}
                  onPress={() => closeActionsAndRun(() => exportMemoImage("jpeg"))}
                />
                {memo.isDeleted ? (
                  <>
                    <DetailActionSheetItem icon={<Search color="#0f172a" size={18} />} label="搜索当前笔记" onPress={() => closeActionsAndRun(() => {
                      setSearchOpen(true);
                    })} />
                    <DetailActionSheetItem icon={<History color="#0f172a" size={18} />} label="版本历史" onPress={() => closeActionsAndRun(() => onOpenRevisions(memo))} />
                    <DetailActionSheetItem disabled={isRestoring} icon={<RotateCcw color="#0f172a" size={18} />} label={isRestoring ? "恢复中" : "恢复笔记"} onPress={() => closeActionsAndRun(() => onRestore(memo))} />
                    <View style={styles.listActionDivider} />
                    <DetailActionSheetItem danger disabled={isDeleting} icon={<Trash2 color="#b91c1c" size={18} />} label={isDeleting ? "删除中" : "彻底删除"} onPress={() => closeActionsAndRun(() => onDelete(memo))} />
                  </>
                ) : null}
              </Pressable>
            </Pressable>
          </Modal>
        ) : null}
        <Modal animationType="fade" onRequestClose={preparedNoteImage ? closeImagePreview : imageShareFontPickerOpen ? () => setImageShareFontPickerOpen(false) : closeImageShareOptions} transparent visible={!imageSavePickerOpen && (imageShareOptionsOpen || Boolean(preparedNoteImage))}>
          {preparedNoteImage ? (
          <SafeAreaView style={imageShareStyles.previewSafeArea}>
            <View style={imageShareStyles.previewHeader}>
              <Text style={imageShareStyles.previewTitle}>{resolvedLocale !== "zh-CN" ? "Image preview" : "图片预览"}</Text>
              <Pressable accessibilityLabel={resolvedLocale !== "zh-CN" ? "Close preview" : "关闭预览"} accessibilityRole="button" onPress={closeImagePreview} style={imageShareStyles.previewCloseButton}>
                <X color="#0f172a" size={22} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={imageShareStyles.previewScrollContent} style={imageShareStyles.previewScroll}>
              {/* The exporter caps images at 12 MP / 15,000 px. Keep those pixels:
                  Android's default decoder downsamples tall images into unreadable text. */}
              <RNImage
                resizeMethod="none"
                resizeMode="contain"
                source={{ uri: preparedNoteImage.uri }}
                style={[
                  imageShareStyles.previewImage,
                  preparedNoteImage.width > 0 && preparedNoteImage.height > 0
                    ? { aspectRatio: preparedNoteImage.width / preparedNoteImage.height, minHeight: 0 }
                    : null,
                ]}
              />
              {preparedNoteImage.fontFallback || isExportingImage ? (
                <View accessibilityLiveRegion="polite">
                  <Text style={imageShareStyles.previewWarning}>{resolvedLocale === "zh-CN"
                    ? isExportingImage ? "字体加载中…" : "暂时使用替代字体，加载成功后将自动恢复"
                    : isExportingImage ? "Loading font…" : "Temporarily using substitute fonts. The original fonts will be restored automatically when loaded."}</Text>
                  {!isExportingImage ? <Pressable accessibilityRole="button" onPress={() => imageFontRecoveryRef.current?.retry()} style={imageShareStyles.previewSecondaryButton}>
                    <Text>{resolvedLocale === "zh-CN" ? "重试" : "Retry"}</Text>
                  </Pressable> : null}
                </View>
              ) : null}
              {preparedNoteImage.failedImages > 0 ? (
                <Text style={imageShareStyles.previewWarning}>
                  {resolvedLocale !== "zh-CN"
                    ? `${preparedNoteImage.failedImages} of ${preparedNoteImage.totalImages} note image(s) could not be included.`
                    : `笔记中的 ${preparedNoteImage.totalImages} 张图片有 ${preparedNoteImage.failedImages} 张未能包含。`}
                </Text>
              ) : null}
              {preparedNoteImage.height > 12_000 ? (
                <Text style={imageShareStyles.previewWarning}>
                  {resolvedLocale !== "zh-CN"
                    ? "This is a long image. Some social apps may reduce its quality; keep the saved original."
                    : "图片较长，部分社交平台可能会压缩画质；建议保留保存的原图。"}
                </Text>
              ) : null}
            </ScrollView>
            <View style={imageShareStyles.previewActions}>
              <Pressable accessibilityRole="button" onPress={() => void savePreparedNoteImage(preparedNoteImage)} style={imageShareStyles.previewSecondaryButton}>
                <Download color="#0f172a" size={18} />
                <Text style={imageShareStyles.previewSecondaryButtonText}>{resolvedLocale !== "zh-CN" ? "Save" : "保存图片"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void sharePreparedNoteImage(preparedNoteImage)} style={imageShareStyles.previewPrimaryButton}>
                <Share2 color="#ffffff" size={18} />
                <Text style={imageShareStyles.previewPrimaryButtonText}>{resolvedLocale !== "zh-CN" ? "Share" : "系统分享"}</Text>
              </Pressable>
            </View>
            {savedImagePath ? (
              <View accessibilityLiveRegion="polite" pointerEvents="none" style={imageShareStyles.savedImageTipContainer}>
                <View style={imageShareStyles.savedImageTip}>
                  <Text style={imageShareStyles.savedImageTipTitle}>{resolvedLocale !== "zh-CN" ? "Saved to" : "图片已保存至"}</Text>
                  <Text style={imageShareStyles.savedImageTipPath}>{savedImagePath}</Text>
                </View>
              </View>
            ) : null}
          </SafeAreaView>
          ) : (
          <Pressable
            onPress={imageShareFontPickerOpen ? () => setImageShareFontPickerOpen(false) : closeImageShareOptions}
            style={[
              styles.actionSheetBackdrop,
              { paddingBottom: Math.max(safeAreaInsets.bottom, Platform.OS === "android" ? ANDROID_SYSTEM_NAVIGATION_FALLBACK : 0) },
            ]}
          >
            <Pressable style={[styles.actionSheet, imageShareStyles.sheetContainer]}>
              <View style={styles.actionSheetHandle} />
              {imageShareFontPickerOpen ? (
                <View style={imageShareStyles.fontPicker}>
                  <View style={imageShareStyles.fontPickerHeader}>
                    <Pressable accessibilityRole="button" accessibilityLabel={resolvedLocale === "zh-CN" ? "返回分享设置" : "Back to share settings"} onPress={() => setImageShareFontPickerOpen(false)} style={imageShareStyles.previewCloseButton}>
                      <ChevronLeft color="#0f172a" size={22} />
                    </Pressable>
                    <Text style={imageShareStyles.previewTitle}>{resolvedLocale === "zh-CN" ? "字体风格" : "Typography"}</Text>
                  </View>
                  <MobileNoteImageFontPicker
                    selected={imageShareFontStyle}
                    theme={imageShareTheme}
                    chinese={resolvedLocale === "zh-CN"}
                    onSelect={async (font) => {
                      setImageSharePreference("fontStyle", font);
                      setImageShareFontPickerOpen(false);
                    }}
                    dom={{ ...SAFE_DOM_WEBVIEW_PROPS, scrollEnabled: false, style: { flex: 1 } }}
                  />
                </View>
              ) : null}
              <View style={[imageShareStyles.settingsContent, imageShareFontPickerOpen && imageShareStyles.hidden]}>
              <Text style={styles.actionSheetTitle}>{resolvedLocale !== "zh-CN" ? "Share as image" : "分享为图片"}</Text>
              <ScrollView contentContainerStyle={imageShareStyles.optionsContent} showsVerticalScrollIndicator={false} style={imageShareStyles.optionsScroll}>

              {imageSharePreferencesReady ? <>
              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale !== "zh-CN" ? "Theme" : "主题风格"}</Text>
              <View style={imageShareStyles.themeGrid}>
                {MOBILE_THEME_OPTIONS.map((item) => {
                  const isSelected = imageShareTheme === item.id;
                  const label = resolvedLocale !== "zh-CN" ? item.labelEn : item.labelZh;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setImageSharePreference("theme", item.id)}
                      style={[
                        imageShareStyles.themeCard,
                        { backgroundColor: item.previewBg },
                        isSelected && imageShareStyles.themeCardActive,
                      ]}
                    >
                      <View accessibilityElementsHidden style={{ width: 46, padding: 5, borderRadius: 3, backgroundColor: NOTE_IMAGE_THEMES[item.id].cardBg, borderWidth: 1, borderColor: NOTE_IMAGE_THEMES[item.id].dividerColor }}>
                        <View style={{ height: 3, width: 28, backgroundColor: NOTE_IMAGE_THEMES[item.id].headingColor, marginBottom: 4 }} />
                        <View style={{ height: 2, width: 32, backgroundColor: NOTE_IMAGE_THEMES[item.id].textColor, marginBottom: 4 }} />
                        <View style={{ height: 6, borderLeftWidth: 2, borderLeftColor: NOTE_IMAGE_THEMES[item.id].quoteBorder, backgroundColor: NOTE_IMAGE_THEMES[item.id].quoteBg }} />
                      </View>
                      <Text numberOfLines={1} style={[imageShareStyles.themeLabel, { color: item.id === "book" || item.id === "black-sun" ? "#f8fafc" : "#1f2937" }, isSelected && imageShareStyles.themeLabelActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale !== "zh-CN" ? "Font size" : "字号大小"}</Text>
              <View style={imageShareStyles.choiceRow}>
                {([
                  ["sm", resolvedLocale !== "zh-CN" ? "Compact" : "紧凑"],
                  ["md", resolvedLocale !== "zh-CN" ? "Standard" : "标准"],
                  ["lg", resolvedLocale !== "zh-CN" ? "Comfortable" : "舒适"],
                ] as const).map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setImageSharePreference("fontSize", value)} style={[imageShareStyles.choice, imageShareFontSize === value && imageShareStyles.choiceActive]}>
                    <Text style={[imageShareStyles.choiceText, imageShareFontSize === value && imageShareStyles.choiceTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale !== "zh-CN" ? "Card width" : "卡片宽度"}</Text>
              <View style={imageShareStyles.choiceRow}>
                {([
                  ["compact", resolvedLocale !== "zh-CN" ? "Compact" : "紧凑"],
                  ["standard", resolvedLocale !== "zh-CN" ? "Standard" : "标准"],
                  ["wide", resolvedLocale !== "zh-CN" ? "Wide" : "宽屏"],
                ] as const).map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setImageSharePreference("cardWidth", value)} style={[imageShareStyles.choice, imageShareCardWidth === value && imageShareStyles.choiceActive]}>
                    <Text style={[imageShareStyles.choiceText, imageShareCardWidth === value && imageShareStyles.choiceTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${resolvedLocale === "zh-CN" ? "字体风格" : "Typography"}: ${imageShareFontLabel}`}
                accessibilityHint={resolvedLocale === "zh-CN" ? "打开字体选择列表" : "Open font selection"}
                onPress={() => setImageShareFontPickerOpen(true)}
                style={imageShareStyles.fontSelector}
              >
                <Text style={imageShareStyles.optionLabel}>{resolvedLocale === "zh-CN" ? "字体风格" : "Typography"}</Text>
                <Text style={imageShareStyles.fontSelectorValue}>
                  {imageShareFontLabel}
                </Text>
                <ChevronDown color="#64748b" size={18} />
              </Pressable>

              <Text style={imageShareStyles.choiceText}>{resolvedLocale === "zh-CN"
                ? "下载型字体首次使用需联网，下载后缓存；普惠体等推荐字体保留完整文件，首次下载较大。"
                : "Downloadable fonts need a connection on first use and are cached. PuHuiTi and other recommended fonts use complete original files, so initial downloads are larger."}</Text>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale !== "zh-CN" ? "Content Elements" : "显示内容"}</Text>
              {([
                [resolvedLocale !== "zh-CN" ? "Title" : "笔记标题", imageShareTitle, "showTitle"],
                [resolvedLocale !== "zh-CN" ? "Notebook" : "笔记本", imageShareNotebook, "showNotebook"],
                [resolvedLocale !== "zh-CN" ? "Tags" : "标签", imageShareTags, "showTags"],
                [resolvedLocale !== "zh-CN" ? "Updated time" : "更新时间", imageShareUpdatedAt, "showUpdatedAt"],
                [resolvedLocale !== "zh-CN" ? "EdgeEver branding" : "EdgeEver 品牌标识", imageShareBranding, "showBranding"],
              ] as const).map(([label, selected, preferenceKey]) => (
                <Pressable key={label} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setImageSharePreference(preferenceKey, !selected)} style={imageShareStyles.optionRow}>
                  <Text style={imageShareStyles.optionLabel}>{label}</Text>
                  <Text style={imageShareStyles.optionCheck}>{selected ? "✓" : ""}</Text>
                </Pressable>
              ))}

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale !== "zh-CN" ? "Format" : "格式"}</Text>
              <View style={imageShareStyles.choiceRow}>
                {(["png", "jpeg"] as const).map((value) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setImageSharePreference("format", value)} style={[imageShareStyles.formatChoice, imageShareFormat === value && imageShareStyles.choiceActive]}>
                    <Text style={[imageShareStyles.choiceText, imageShareFormat === value && imageShareStyles.choiceTextActive]}>
                      {value === "png"
                        ? (resolvedLocale !== "zh-CN" ? "PNG · Crisp text" : "PNG · 超清无损")
                        : (resolvedLocale !== "zh-CN" ? "JPEG · Smaller file" : "JPEG · 体积小")}
                    </Text>
                  </Pressable>
                ))}
              </View>
              </> : <ActivityIndicator />}
              </ScrollView>
              <View style={imageShareStyles.sheetFooter}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isExportingImage || !viewerReady || !imageSharePreferencesReady}
                  onPress={() => {
                    exportMemoImage(imageShareFormat, {
                      theme: imageShareTheme,
                      fontStyle: imageShareFontStyle,
                      fontSize: imageShareFontSize,
                      cardWidth: imageShareCardWidth,
                      showTitle: imageShareTitle,
                      showNotebook: imageShareNotebook,
                      showTags: imageShareTags,
                      showUpdatedAt: imageShareUpdatedAt,
                      showBranding: imageShareBranding,
                      intent: "preview",
                    });
                  }}
                  style={[imageShareStyles.shareButton, (isExportingImage || !viewerReady || !imageSharePreferencesReady) && styles.buttonDisabled]}
                >
                  {isExportingImage ? <ActivityIndicator color="#ffffff" size="small" /> : <Share2 color="#ffffff" size={18} />}
                  <Text style={imageShareStyles.shareButtonText}>
                    {isExportingImage
                      ? (imageFontStatus === "loading" ? (resolvedLocale === "zh-CN" ? "字体加载中…" : "Loading font…") : imageExportStage === "render"
                        ? (resolvedLocale !== "zh-CN" ? "Rendering image…" : "正在渲染图片…")
                        : imageExportStage === "transfer"
                          ? (resolvedLocale !== "zh-CN" ? "Saving preview…" : "正在保存预览…")
                          : (resolvedLocale !== "zh-CN" ? "Preparing image…" : "正在准备图片…"))
                      : !viewerReady
                      ? (resolvedLocale !== "zh-CN" ? "Preparing note…" : "正在准备笔记…")
                      : (resolvedLocale !== "zh-CN" ? "Generate preview" : "生成预览")}
                  </Text>
                </Pressable>
              </View>
              </View>
            </Pressable>
          </Pressable>
          )}
        </Modal>
        {memo && !memo.isDeleted ? (
          <MobileAiAssistantModal
            memo={memo}
            onApply={(draft, mode) => onApplyAiDraft(memo, draft, mode)}
            onClose={() => setAiAssistantOpen(false)}
            visible={aiAssistantOpen}
          />
        ) : null}
        <Modal animationType="fade" onRequestClose={() => setImagePreview(null)} transparent visible={Boolean(imagePreview)}>
          <View style={resourceImageStyles.previewBackdrop}>
            {imagePreview ? (
              <ZoomableImagePreview
                key={imagePreview.source}
                accessibilityHint={resolvedLocale !== "zh-CN" ? "Long press for image actions" : "长按打开图片操作"}
                accessibilityLabel={imagePreview.alt || (resolvedLocale !== "zh-CN" ? "Image preview" : "图片预览")}
                onLongPress={() => {
                  // Long-press fullscreen preview → same resource sheet as ⋯ in the note.
                  const target = getMobileImageTarget(imagePreview.source, imagePreview.alt);
                  if (target) {
                    setResourceTarget(target);
                  }
                }}
                renderImage={(onDimensions, resizeMultiplier) => (
                  <AuthenticatedResourceImage
                    alt={imagePreview.alt}
                    href={imagePreview.source}
                    loadResourceBlob={client?.getResourceBlob}
                    onLoadFailure={imageLoadFailureNotifier}
                    onDimensions={onDimensions}
                    resizeMultiplier={resizeMultiplier}
                    resizeMode="contain"
                    session={session}
                    style={resourceImageStyles.previewImage}
                  />
                )}
              />
            ) : null}
            <Pressable
              accessibilityLabel={resolvedLocale !== "zh-CN" ? "Close image preview" : "关闭图片预览"}
              accessibilityRole="button"
              onPress={() => setImagePreview(null)}
              style={resourceImageStyles.previewClose}
            >
              <X color="#ffffff" size={24} />
            </Pressable>
          </View>
        </Modal>
        <MobileResourceActions
          canMutate={Boolean(memo && !memo.isDeleted && !memo.id.startsWith("local:"))}
          onClose={() => isEditing ? editor.setResourceTarget(null) : setResourceTarget(null)}
          onDelete={async (target) => {
            if (isEditing) {
              await editor.deleteResource(target);
              return;
            }
            if (!memo) return;
            await onDeleteResource(memo, target);
          }}
          onDownload={isEditing ? editor.downloadResource : downloadResource}
          onRename={async (target, filename) => {
            if (isEditing) {
              await editor.renameResource(target, filename);
              return;
            }
            if (!memo) return;
            await onRenameResource(memo, target, filename);
          }}
          onSaveAs={isEditing ? editor.saveResourceAs : saveResourceAs}
          target={isEditing ? editor.resourceTarget : resourceTarget}
        />
        {isEditing ? (
          <>
            <NotebookPickerModal
              activeNotebookId={editor.notebookId}
              includeAllNotes={false}
              notebooks={notebooks}
              onClose={() => editor.setNotebookPickerOpen(false)}
              onSelect={(nextNotebookId) => {
                if (!nextNotebookId || nextNotebookId === "all") {
                  editor.setNotebookPickerOpen(false);
                  return;
                }
                editor.setNotebookId(nextNotebookId);
                editor.setNotebookPickerOpen(false);
                editor.markDirty();
              }}
              visible={editor.notebookPickerOpen}
            />
            <TagPickerModal
              dataScope={createMobileDataScope(session?.baseUrl ?? baseUrl, session?.user?.id)}
              onChange={(nextTags) => {
                editor.setTagsText(nextTags.join(", "));
                editor.markDirty();
              }}
              onClose={() => editor.setTagPickerOpen(false)}
              selectedTags={parseTags(editor.tagsText)}
              visible={editor.tagPickerOpen}
            />
            {editor.uploadSourcePicker}
          </>
        ) : (
          <>
          <TagPickerModal
            dataScope={createMobileDataScope(session?.baseUrl ?? baseUrl, session?.user?.id)}
            disabled={metadataSaving}
            headerContent={(
              <Pressable
                accessibilityLabel="所在笔记本"
                accessibilityRole="button"
                disabled={metadataSaving}
                onPress={() => {
                  setViewerTagsOpen(false);
                  setViewerNotebookPickerOpen(true);
                }}
                style={styles.detailNotebookButton}
              >
                <Text numberOfLines={1} style={styles.detailNotebookName}>
                  {notebooks.find((notebook) => notebook.id === viewerNotebookId)?.name ?? notebookName}
                </Text>
                <ChevronDown color="#64748b" size={14} />
              </Pressable>
            )}
            footerContent={(
              <View style={detailLayoutStyles.metadataActions}>
                <Pressable accessibilityRole="button" disabled={metadataSaving} onPress={() => setViewerTagsOpen(false)} style={[styles.createMemoDoneButton, detailLayoutStyles.metadataCancel]}>
                  <Text style={[styles.createMemoDoneText, detailLayoutStyles.metadataCancelText]}>取消</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={metadataSaving || isSaving} onPress={() => void saveViewerMetadata()} style={[styles.createMemoDoneButton, (metadataSaving || isSaving) && styles.createMemoDoneButtonDisabled]}>
                  <Text style={[styles.createMemoDoneText, (metadataSaving || isSaving) && styles.createMemoDoneTextDisabled]}>{metadataSaving ? "保存中" : "保存"}</Text>
                </Pressable>
              </View>
            )}
            onChange={setViewerTags}
            onClose={() => { if (!metadataSaving) setViewerTagsOpen(false); }}
            selectedTags={viewerTags}
            visible={viewerTagsOpen}
          />
          <NotebookPickerModal
            activeNotebookId={viewerNotebookId}
            includeAllNotes={false}
            notebooks={notebooks}
            onClose={() => {
              setViewerNotebookPickerOpen(false);
              setViewerTagsOpen(true);
            }}
            onSelect={handleViewerNotebookSelect}
            visible={viewerNotebookPickerOpen}
          />
          </>
        )}
      </SafeAreaView>
      ) : null}
    </Modal>
  );
};

const imageShareStyles = StyleSheet.create({
  sheetContainer: {
    height: "85%",
    paddingBottom: 16,
  },
  optionsContent: {
    paddingBottom: 16,
  },
  optionsScroll: {
    flex: 1,
  },
  sheetFooter: {
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
    paddingTop: 12,
  },
  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  themeCard: {
    width: "47%",
    minWidth: 120,
    flexGrow: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  themeCardActive: {
    borderColor: "#16A06E",
    borderWidth: 2,
  },
  themeLabel: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  themeLabelActive: {
    fontWeight: "700",
  },
  choice: {
    alignItems: "center",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 8,
    backgroundColor: "#f8fafc",
  },
  choiceActive: {
    borderColor: "#16A06E",
    borderWidth: 2,
    backgroundColor: "#ffffff",
  },
  choiceRow: {
    flexDirection: "row",
    gap: 8,
  },
  settingsContent: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
  fontPicker: {
    flex: 1,
  },
  fontPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 12,
  },
  fontSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
  },
  fontSelectorValue: {
    color: "#64748b",
    fontSize: 14,
    flexShrink: 1,
    textAlign: "right",
  },
  choiceText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  choiceTextActive: {
    color: "#0f172a",
    fontWeight: "700",
  },
  formatChoice: {
    alignItems: "center",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 8,
    backgroundColor: "#f8fafc",
  },
  optionCheck: {
    color: "#16A06E",
    fontSize: 18,
    fontWeight: "800",
    width: 24,
  },
  optionLabel: {
    color: "#0f172a",
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 38,
    paddingHorizontal: 8,
  },
  shareButton: {
    alignItems: "center",
    backgroundColor: "#16A06E",
    borderRadius: 10,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
  },
  shareButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  previewSafeArea: {
    backgroundColor: "#f1f5f9",
    flex: 1,
  },
  previewHeader: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  previewTitle: {
    color: "#0f172a",
    fontSize: 17,
    fontWeight: "800",
  },
  previewCloseButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  previewScroll: {
    flex: 1,
  },
  previewScrollContent: {
    padding: 16,
  },
  previewImage: {
    alignSelf: "stretch",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    minHeight: 240,
    width: "100%",
  },
  previewWarning: {
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    color: "#a16207",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 12,
    padding: 10,
  },
  previewActions: {
    backgroundColor: "#ffffff",
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  previewSecondaryButton: {
    alignItems: "center",
    borderColor: "#cbd5e1",
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44,
  },
  previewSecondaryButtonText: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "700",
  },
  previewPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#16A06E",
    borderRadius: 9,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44,
  },
  previewPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  savedImageTipContainer: {
    alignItems: "center",
    bottom: 100,
    left: 16,
    position: "absolute",
    right: 16,
  },
  savedImageTip: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    maxWidth: 520,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: "100%",
  },
  savedImageTipTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  savedImageTipPath: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
});

const detailLayoutStyles = StyleSheet.create({
  metadataCancel: {
    backgroundColor: "#f1f5f9",
  },
  metadataCancelText: {
    color: "#475569",
  },
  metadataActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  meta: {
    paddingBottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  headerTitleSlot: {
    flex: 1,
    justifyContent: "center",
    marginHorizontal: 8,
    minWidth: 0,
  },
  headerTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "600",
  },
  viewer: {
    backgroundColor: "#ffffff",
    flex: 1,
    minHeight: 0,
  },
  viewerDark: {
    backgroundColor: "#0f172a",
  },
  viewerLoading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "rgba(248,250,252,0.72)",
    justifyContent: "center",
    top: 120,
  },
});

const resourceImageStyles = StyleSheet.create({
  previewBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(2,6,23,0.96)",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  previewClose: {
    alignItems: "center",
    backgroundColor: "rgba(15,23,42,0.78)",
    borderRadius: 999,
    height: 46,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    top: 54,
    width: 46,
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  previewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
});
