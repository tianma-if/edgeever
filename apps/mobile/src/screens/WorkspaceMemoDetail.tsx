import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_MEMO_TITLE, resolveMemoContentDoc, type MemoDetail, type TiptapDoc } from "@edgeever/shared";
import {
  type NoteImageTheme,
  type NoteImageFontStyle,
  type NoteImageFontSize,
  type NoteImageCardWidth,
} from "@edgeever/shared/note-image-card";
import * as Clipboard from "expo-clipboard";
import { Image as RNImage, Platform, ScrollView, StyleSheet, Text as RNText, View, type ImageStyle, type StyleProp, type TextStyle } from "react-native";
import { Modal } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import { ActivityIndicator, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, History, MoreHorizontal, Pencil, RotateCcw, Search, Share2, Sparkles, Tag, Trash2, X } from "../components/icons";
import { Alert, Pressable, Text, TextInput } from "../components/LocalizedText";
import LocalTiptapEditor, { type LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { MobileAiAssistantModal } from "../components/MobileAiAssistantModal";
import { MobileResourceActions } from "../components/MobileResourceActions";
import { SAFE_DOM_WEBVIEW_PROPS } from "../lib/mobile-dom";
import { getNextMobileNoteSearchIndex } from "../lib/mobile-note-search";
import { safeDomCall } from "../lib/safe-dom-call";
import {
  getMobileImageTarget,
  openMobileResource,
  parseMobileResourceTargetJson,
  saveMobileResourceAs,
  type MobileResourceTarget,
} from "../lib/mobile-attachments";
import { useMobileLocale } from "../lib/mobile-locale";
import {
  createOnceProtectedResourceFailureNotifier,
  isProtectedResourceSource,
  loadProtectedResourceDataUrl,
  type ProtectedResourceLoadFailure,
} from "../lib/mobile-protected-resources";
import { useMobileTheme } from "../lib/mobile-theme";
import { useSession } from "../lib/session";
import { beginEditorStartup } from "../lib/startup-performance";
import type { MobileSyncQueueItem } from "../lib/sync-queue";
import { getTextSearchMatches } from "./workspace-utils";
import { styles } from "./workspace-styles";

const ANDROID_SYSTEM_NAVIGATION_FALLBACK = 48;
const RESOURCE_DATA_URL_CACHE_LIMIT = 32;

type MobileImageExportEvent =
  | { type: "chunk"; requestId: string; chunk: string }
  | {
      type: "complete";
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
  base64: string;
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
  locale: "zh-CN" | "en-US",
  failure: ProtectedResourceLoadFailure
) => {
  const statusLabel = failure.status != null ? String(failure.status) : locale === "en-US" ? "network error" : "网络错误";
  Alert.alert(
    locale === "en-US" ? "Image failed to load" : "图片加载失败",
    locale === "en-US"
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

const MOBILE_THEME_OPTIONS: Array<{
  id: NoteImageTheme;
  labelZh: string;
  labelEn: string;
  previewBg: string;
  dotColor: string;
}> = [
  { id: "slate", labelZh: "经典浅色", labelEn: "Light", previewBg: "#f8fafc", dotColor: "#16a06e" },
  { id: "aurora", labelZh: "极光渐变", labelEn: "Aurora", previewBg: "#a7f3d0", dotColor: "#0d9488" },
  { id: "sunset", labelZh: "暮色晚霞", labelEn: "Sunset", previewBg: "#fde68a", dotColor: "#ea580c" },
  { id: "midnight", labelZh: "暗夜曜石", labelEn: "Midnight", previewBg: "#090d16", dotColor: "#34d399" },
  { id: "mint", labelZh: "薄荷", labelEn: "Mint", previewBg: "#ecfdf5", dotColor: "#059669" },
  { id: "lavender", labelZh: "紫雾流光", labelEn: "Lavender", previewBg: "#f5f3ff", dotColor: "#7c3aed" },
  { id: "notepad", labelZh: "经典便签", labelEn: "Notepad", previewBg: "#fbf7ee", dotColor: "#c2410c" },
  { id: "xuan", labelZh: "水墨宣纸", labelEn: "Rice Paper", previewBg: "#f7f6f2", dotColor: "#b91c1c" },
];

const MOBILE_FONT_OPTIONS: Array<{ id: NoteImageFontStyle; labelZh: string; labelEn: string }> = [
  { id: "serif", labelZh: "文艺衬线", labelEn: "Serif" },
  { id: "sans", labelZh: "现代无衬线", labelEn: "Sans" },
  { id: "mono", labelZh: "极客等宽", labelEn: "Mono" },
];

const AuthenticatedResourceImage = ({
  alt,
  fitAspect = false,
  href,
  loadResourceBlob,
  onLoadFailure,
  resizeMode = "cover",
  session,
  style,
}: {
  alt: string;
  fitAspect?: boolean;
  href: string;
  loadResourceBlob?: ((resourceUrl: string) => Promise<Blob>) | null;
  onLoadFailure?: (failure: ProtectedResourceLoadFailure) => void;
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
        }
      }}
      onError={loadSvgFallback}
      resizeMethod={Platform.OS === "android" ? "resize" : "auto"}
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

const DetailActionButton = ({ children, disabled = false, label, onPress }: { children: ReactNode; disabled?: boolean; label: string; onPress: () => void }) => (
  <Pressable disabled={disabled} onPress={onPress} style={[styles.actionButton, disabled && styles.buttonDisabled]}>
    {children}
    <Text style={styles.actionButtonText}>{label}</Text>
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
  initialSearchQuery,
  isDeleting,
  isLoading,
  isRestoring,
  isSaving,
  isSharing,
  memo,
  notebookName,
  onAdoptCloudVersion,
  onApplyAiDraft,
  onClose,
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
  visible,
}: {
  initialSearchQuery: string;
  isDeleting: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  isSaving: boolean;
  isSharing: boolean;
  memo: MemoDetail | null;
  notebookName: string;
  onAdoptCloudVersion: (memo: MemoDetail) => void;
  onApplyAiDraft: (memo: MemoDetail, draft: string, mode: "append" | "replace") => Promise<void>;
  onClose: () => void;
  onCopyLocalDraft: (memo: MemoDetail) => void;
  onDelete: (memo: MemoDetail) => void;
  onDeleteResource: (memo: MemoDetail, target: MobileResourceTarget) => Promise<void>;
  onRichEdit: (memo: MemoDetail) => void;
  onOpenRevisions: (memo: MemoDetail) => void;
  onRenameResource: (memo: MemoDetail, target: MobileResourceTarget, filename: string) => Promise<void>;
  onResolveSyncConflict: (memo: MemoDetail) => void;
  onRetrySync: () => void;
  onRestore: (memo: MemoDetail) => void;
  onShare: (memo: MemoDetail) => void;
  syncError: string | null;
  syncStatus: MobileSyncQueueItem["status"] | null;
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
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [imageShareOptionsOpen, setImageShareOptionsOpen] = useState(false);
  const [imageShareFormat, setImageShareFormat] = useState<"jpeg" | "png">("png");
  const [imageShareTheme, setImageShareTheme] = useState<NoteImageTheme>("slate");
  const [imageShareFontStyle, setImageShareFontStyle] = useState<NoteImageFontStyle>("serif");
  const [imageShareFontSize, setImageShareFontSize] = useState<NoteImageFontSize>("lg");
  const [imageShareCardWidth, setImageShareCardWidth] = useState<NoteImageCardWidth>("standard");
  const [imageShareTitle, setImageShareTitle] = useState(true);
  const [imageShareNotebook, setImageShareNotebook] = useState(false);
  const [imageShareTags, setImageShareTags] = useState(false);
  const [imageShareUpdatedAt, setImageShareUpdatedAt] = useState(true);
  const [imageShareBranding, setImageShareBranding] = useState(true);
  const [preparedNoteImage, setPreparedNoteImage] = useState<MobilePreparedNoteImage | null>(null);
  const viewerRef = useRef<LocalTiptapEditorRef>(null);
  const imageExportIntentRef = useRef<"preview" | "share">("share");
  const imageExportRequestRef = useRef<string | null>(null);
  const imageExportChunksRef = useRef<string[]>([]);
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
    () => (memo ? resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown) : { type: "doc", content: [{ type: "paragraph" }] }),
    [memo]
  );

  const downloadResource = useCallback(async (target: MobileResourceTarget) => {
    if (!client) throw new Error(resolvedLocale === "en-US" ? "The resource client is unavailable." : "当前无法读取资源。");
    try {
      await openMobileResource(client, target, { baseUrl, token: session?.token });
    } catch (error) {
      Alert.alert(
        resolvedLocale === "en-US" ? "Unable to open resource" : "无法打开资源",
        error instanceof Error ? error.message : (resolvedLocale === "en-US" ? "Try again later." : "请稍后重试。")
      );
      throw error;
    }
  }, [baseUrl, client, resolvedLocale, session?.token]);
  const saveResourceAs = useCallback(async (target: MobileResourceTarget) => {
    if (!client) throw new Error(resolvedLocale === "en-US" ? "The resource client is unavailable." : "当前无法读取资源。");
    const result = await saveMobileResourceAs(client, target, { baseUrl, token: session?.token });
    if (result.kind === "saf") {
      Alert.alert(
        resolvedLocale === "en-US" ? "Downloaded" : "下载成功",
        resolvedLocale === "en-US" ? `Saved ${result.filename}` : `已保存：${result.filename}`
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

  const memoTitle = memo?.title?.trim() || DEFAULT_MEMO_TITLE;
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

  useEffect(() => {
    const normalizedInitialSearchQuery = initialSearchQuery.trim();
    setViewerReady(false);
    setSearchOpen(Boolean(normalizedInitialSearchQuery));
    setSearchQuery(normalizedInitialSearchQuery);
    setBodySearchMatchCount(0);
    setActiveMatchIndex(0);
    setImagePreview(null);
    setResourceTarget(null);
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
        resolvedLocale === "en-US" ? "Note ID copied" : "笔记 ID 已复制",
        memo.id
      );
    } catch {
      Alert.alert(
        resolvedLocale === "en-US" ? "Could not copy note ID" : "复制笔记 ID 失败",
        resolvedLocale === "en-US" ? "Please try again." : "请稍后重试。"
      );
    }
  };

  const handleImageExportEvent = useCallback(async (payloadJson: string) => {
    let event: MobileImageExportEvent;
    try {
      event = JSON.parse(payloadJson) as MobileImageExportEvent;
    } catch {
      return;
    }
    if (!event.requestId || event.requestId !== imageExportRequestRef.current) return;
    if (event.type === "chunk") {
      imageExportChunksRef.current.push(event.chunk);
      return;
    }
    if (event.type === "error") {
      imageExportChunksRef.current = [];
      imageExportRequestRef.current = null;
      setIsExportingImage(false);
      Alert.alert(
        resolvedLocale === "en-US" ? "Image export failed" : "导出笔记图片失败",
        event.message || (resolvedLocale === "en-US" ? "Try again later." : "请稍后重试。")
      );
      return;
    }

    try {
      const { Directory, File, Paths } = await import("expo-file-system");
      const directory = new Directory(Paths.cache, "edgeever-note-exports");
      if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
      const file = new File(directory, event.filename);
      if (file.exists) file.delete();
      file.create({ overwrite: true, intermediates: true });
      const base64 = imageExportChunksRef.current.join("");
      file.write(decodeBase64Chunks(imageExportChunksRef.current));
      const prepared: MobilePreparedNoteImage = {
        base64,
        failedImages: event.failedImages ?? 0,
        filename: event.filename,
        height: event.height ?? 0,
        mimeType: event.mimeType,
        totalImages: event.totalImages ?? 0,
        uri: file.uri,
        width: event.width ?? 0,
      };
      if (imageExportIntentRef.current === "preview") {
        setPreparedNoteImage(prepared);
      } else {
        const Sharing = await import("expo-sharing");
        if (!(await Sharing.isAvailableAsync())) throw new Error(resolvedLocale === "en-US" ? "Sharing is unavailable on this device." : "当前设备无法打开系统分享面板。");
        await Sharing.shareAsync(file.uri, {
          dialogTitle: event.filename,
          mimeType: event.mimeType,
        });
      }
    } catch (error) {
      Alert.alert(
        resolvedLocale === "en-US" ? "Image export failed" : "导出笔记图片失败",
        error instanceof Error ? error.message : (resolvedLocale === "en-US" ? "Try again later." : "请稍后重试。")
      );
    } finally {
      imageExportChunksRef.current = [];
      imageExportRequestRef.current = null;
      setIsExportingImage(false);
    }
  }, [resolvedLocale]);

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
  ) => {
    if (!memo || !viewerReady || isExportingImage) return;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    imageExportRequestRef.current = requestId;
    imageExportChunksRef.current = [];
    imageExportIntentRef.current = options.intent ?? "share";
    setIsExportingImage(true);
    safeDomCall(() => viewerRef.current?.exportImage(JSON.stringify({
      requestId,
      format,
      title: memo.title?.trim() || (resolvedLocale === "en-US" ? "Untitled note" : "无标题笔记"),
      fallbackTitle: resolvedLocale === "en-US" ? "Untitled note" : "无标题笔记",
      notebook: options.showNotebook === false ? "" : notebookName,
      tags: options.showTags === false ? [] : memo.tags,
      updatedAt: options.showUpdatedAt === false ? "" : new Date(memo.updatedAt).toLocaleString(resolvedLocale),
      theme: options.theme ?? "slate",
      fontStyle: options.fontStyle ?? "serif",
      fontSize: options.fontSize ?? "lg",
      cardWidth: options.cardWidth ?? "standard",
      showTitle: options.showTitle ?? true,
      showNotebook: options.showNotebook ?? false,
      showTags: options.showTags ?? false,
      showUpdatedAt: options.showUpdatedAt ?? true,
      branding: options.showBranding ?? true,
    })));
  }, [isExportingImage, memo, notebookName, resolvedLocale, viewerReady]);

  const sharePreparedNoteImage = useCallback(async (prepared: MobilePreparedNoteImage) => {
    try {
      const Sharing = await import("expo-sharing");
      if (!(await Sharing.isAvailableAsync())) throw new Error(resolvedLocale === "en-US" ? "Sharing is unavailable on this device." : "当前设备无法打开系统分享面板。");
      await Sharing.shareAsync(prepared.uri, { dialogTitle: prepared.filename, mimeType: prepared.mimeType });
    } catch (shareError) {
      Alert.alert(
        resolvedLocale === "en-US" ? "Share failed" : "分享失败",
        shareError instanceof Error ? shareError.message : (resolvedLocale === "en-US" ? "Try again later." : "请稍后重试。")
      );
    }
  }, [resolvedLocale]);

  const copyPreparedNoteImage = useCallback(async (prepared: MobilePreparedNoteImage) => {
    try {
      await Clipboard.setImageAsync(prepared.base64);
      Alert.alert(resolvedLocale === "en-US" ? "Copied" : "复制成功", resolvedLocale === "en-US" ? "The image is on your clipboard." : "图片已复制到剪贴板。");
    } catch {
      Alert.alert(resolvedLocale === "en-US" ? "Copy failed" : "复制失败", resolvedLocale === "en-US" ? "Try saving the image instead." : "请尝试保存图片。" );
    }
  }, [resolvedLocale]);

  const savePreparedNoteImage = useCallback(async (prepared: MobilePreparedNoteImage) => {
    try {
      const FileSystem = await import("expo-file-system/legacy");
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted) return;
      const destination = await FileSystem.StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        prepared.filename,
        prepared.mimeType
      );
      await FileSystem.StorageAccessFramework.writeAsStringAsync(destination, prepared.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      Alert.alert(resolvedLocale === "en-US" ? "Saved" : "保存成功", prepared.filename);
    } catch (saveError) {
      Alert.alert(
        resolvedLocale === "en-US" ? "Save failed" : "保存失败",
        saveError instanceof Error ? saveError.message : (resolvedLocale === "en-US" ? "Try again later." : "请稍后重试。")
      );
    }
  }, [resolvedLocale]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaView style={styles.modalSafeArea}>
        <View style={styles.detailHeader}>
          <Pressable accessibilityLabel="返回列表" accessibilityRole="button" onPress={onClose} style={styles.detailHeaderButton}>
            <ChevronLeft color="#475569" size={21} />
          </Pressable>
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
                accessibilityLabel="分享笔记"
                accessibilityRole="button"
                disabled={isSharing}
                onPress={() => onShare(memo)}
                style={[styles.detailHeaderIconButton, isSharing && styles.buttonDisabled]}
              >
                {isSharing ? <ActivityIndicator color="#475569" size="small" /> : <Share2 color="#475569" size={20} />}
              </Pressable>
            ) : null}
            {memo && !memo.isDeleted ? (
              <Pressable
                accessibilityLabel="版本历史"
                accessibilityRole="button"
                onPress={() => onOpenRevisions(memo)}
                style={styles.detailHeaderIconButton}
              >
                <History color="#475569" size={20} />
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

        {syncStatus === "conflict" && memo ? (
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

        {(syncStatus === "error" || syncStatus === "pending") && memo ? (
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
            <View style={detailLayoutStyles.meta}>
              <HighlightedMetadataText
                activeIndex={activeMatchIndex}
                matchOffset={0}
                matches={metadataSearchMatches.title}
                style={styles.detailTitle}
                text={memoTitle}
              />
              <View style={styles.detailMetaRow}>
                <View style={styles.detailNotebookButton}>
                  <Text numberOfLines={1} selectable style={styles.detailNotebookName}>{notebookName}</Text>
                  <ChevronDown color="#94a3b8" size={14} />
                </View>
                <View style={styles.detailTagsGroup}>
                  <Tag color="#64748b" size={16} />
                  <HighlightedMetadataText
                    activeIndex={activeMatchIndex}
                    matchOffset={metadataSearchMatches.title.length}
                    matches={metadataSearchMatches.tags}
                    numberOfLines={1}
                    style={[styles.detailTagsInline, memo.tags.length === 0 && styles.detailTagsPlaceholder]}
                    text={memoTagsText || "添加标签，用逗号分隔"}
                  />
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
                      onChangeText={(value) => {
                        setSearchQuery(value);
                        setBodySearchMatchCount(0);
                        setActiveMatchIndex(0);
                      }}
                      placeholder="在当前笔记内搜索"
                      placeholderTextColor="#94a3b8"
                      style={styles.searchInput}
                      value={searchQuery}
                    />
                    <Text style={[styles.noteSearchCount, searchQuery.trim() && searchMatchCount === 0 && styles.noteSearchCountEmpty]}>{searchMatchLabel}</Text>
                  </View>
                  <View style={styles.richEditorSearchActions}>
                    <DetailActionButton disabled={searchMatchCount === 0} label="上一个搜索结果" onPress={() => moveSearchMatch(-1)}>
                      <ChevronLeft color={searchMatchCount === 0 ? "#cbd5e1" : "#0f172a"} size={16} />
                    </DetailActionButton>
                    <DetailActionButton disabled={searchMatchCount === 0} label="下一个搜索结果" onPress={() => moveSearchMatch(1)}>
                      <ChevronRight color={searchMatchCount === 0 ? "#cbd5e1" : "#0f172a"} size={16} />
                    </DetailActionButton>
                    <DetailActionButton label="关闭搜索" onPress={() => {
                      setSearchOpen(false);
                      setSearchQuery("");
                      setBodySearchMatchCount(0);
                      setActiveMatchIndex(0);
                      safeDomCall(() => viewerRef.current?.search("", -1));
                    }}>
                      <X color="#0f172a" size={16} />
                    </DetailActionButton>
                  </View>
                </View>
              ) : null}
              <View style={styles.detailDivider} />
            </View>
            {baseUrl ? (
              <LocalTiptapEditor
                key={memo.id}
                baseUrl={baseUrl}
                content={viewerContent}
                dom={{
                  ...SAFE_DOM_WEBVIEW_PROPS,
                  bounces: true,
                  contentInsetAdjustmentBehavior: "never",
                  overScrollMode: "never",
                  scrollEnabled: false,
                  style: [
                    detailLayoutStyles.viewer,
                    resolvedTheme === "dark" ? detailLayoutStyles.viewerDark : null,
                  ],
                }}
                locale={resolvedLocale}
                mode="viewer"
                onImagePreview={onImagePreview}
                onImageExportEvent={handleImageExportEvent}
                onLoadResource={loadViewerResource}
                onReady={async () => {
                  setViewerReady(true);
                }}
                onResourcePress={onResourcePress}
                onSearchResult={async (count, _index, resultQuery) => {
                  if (resultQuery === searchQuery) {
                    setBodySearchMatchCount(count);
                  }
                }}
                ref={viewerRef}
                theme={resolvedTheme}
              />
            ) : (
              <View style={styles.centerState}>
                <Text style={styles.errorText}>{resolvedLocale === "en-US" ? "Not signed in." : "未登录。"}</Text>
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
        {memo ? (
          <Modal animationType="fade" onRequestClose={() => setActionsOpen(false)} transparent visible={actionsOpen}>
            <Pressable onPress={() => setActionsOpen(false)} style={styles.actionSheetBackdrop}>
              <Pressable style={styles.actionSheet}>
                <View style={styles.actionSheetHandle} />
                <Text style={styles.actionSheetTitle}>{resolvedLocale === "en-US" ? "Note actions" : "笔记操作"}</Text>
                {!memo.isDeleted ? (
                  <DetailActionSheetItem
                    icon={<Sparkles color="#16A06E" size={18} />}
                    label={resolvedLocale === "en-US" ? "AI note assistant" : "AI 笔记助手"}
                    onPress={() => closeActionsAndRun(() => setAiAssistantOpen(true))}
                  />
                ) : null}
                <DetailActionSheetItem
                  disabled={!canCopyMemoId}
                  icon={<Copy color="#0f172a" size={18} />}
                  label={canCopyMemoId
                    ? (resolvedLocale === "en-US" ? "Copy note ID" : "复制笔记 ID")
                    : (resolvedLocale === "en-US" ? "Copy note ID after sync" : "同步后可复制笔记 ID")}
                  onPress={() => closeActionsAndRun(() => void copyMemoId())}
                />
                <DetailActionSheetItem
                  disabled={isExportingImage || !viewerReady}
                  icon={isExportingImage ? <ActivityIndicator color="#16A06E" size="small" /> : <Share2 color="#0f172a" size={18} />}
                  label={isExportingImage
                    ? (resolvedLocale === "en-US" ? "Generating share image" : "正在生成分享图片")
                    : (resolvedLocale === "en-US" ? "Share as image" : "分享为图片")}
                  onPress={() => closeActionsAndRun(() => setImageShareOptionsOpen(true))}
                />
                <DetailActionSheetItem
                  disabled={isExportingImage || !viewerReady}
                  icon={<Download color="#0f172a" size={18} />}
                  label={resolvedLocale === "en-US" ? "Advanced export PNG" : "高级导出 PNG"}
                  onPress={() => closeActionsAndRun(() => exportMemoImage("png"))}
                />
                <DetailActionSheetItem
                  disabled={isExportingImage || !viewerReady}
                  icon={<Download color="#0f172a" size={18} />}
                  label={resolvedLocale === "en-US" ? "Advanced export JPEG" : "高级导出 JPEG"}
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
        <Modal animationType="fade" onRequestClose={() => setImageShareOptionsOpen(false)} transparent visible={imageShareOptionsOpen}>
          <Pressable onPress={() => setImageShareOptionsOpen(false)} style={styles.actionSheetBackdrop}>
            <Pressable style={[styles.actionSheet, imageShareStyles.sheetContainer]}>
              <View style={styles.actionSheetHandle} />
              <Text style={styles.actionSheetTitle}>{resolvedLocale === "en-US" ? "Share as image" : "分享为图片"}</Text>
              <ScrollView contentContainerStyle={imageShareStyles.optionsContent} showsVerticalScrollIndicator={false} style={imageShareStyles.optionsScroll}>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale === "en-US" ? "Theme" : "主题风格"}</Text>
              <View style={imageShareStyles.themeGrid}>
                {MOBILE_THEME_OPTIONS.map((item) => {
                  const isSelected = imageShareTheme === item.id;
                  const label = resolvedLocale === "en-US" ? item.labelEn : item.labelZh;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => setImageShareTheme(item.id)}
                      style={[
                        imageShareStyles.themeCard,
                        { backgroundColor: item.previewBg },
                        isSelected && imageShareStyles.themeCardActive,
                      ]}
                    >
                      <View style={[imageShareStyles.themeDot, { backgroundColor: item.dotColor }]} />
                      <Text numberOfLines={1} style={[imageShareStyles.themeLabel, isSelected && imageShareStyles.themeLabelActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale === "en-US" ? "Font size" : "字号大小"}</Text>
              <View style={imageShareStyles.choiceRow}>
                {([
                  ["sm", resolvedLocale === "en-US" ? "Compact" : "紧凑"],
                  ["md", resolvedLocale === "en-US" ? "Standard" : "标准"],
                  ["lg", resolvedLocale === "en-US" ? "Comfortable" : "舒适"],
                ] as const).map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setImageShareFontSize(value)} style={[imageShareStyles.choice, imageShareFontSize === value && imageShareStyles.choiceActive]}>
                    <Text style={[imageShareStyles.choiceText, imageShareFontSize === value && imageShareStyles.choiceTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale === "en-US" ? "Card width" : "卡片宽度"}</Text>
              <View style={imageShareStyles.choiceRow}>
                {([
                  ["compact", resolvedLocale === "en-US" ? "Compact" : "紧凑"],
                  ["standard", resolvedLocale === "en-US" ? "Standard" : "标准"],
                  ["wide", resolvedLocale === "en-US" ? "Wide" : "宽屏"],
                ] as const).map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setImageShareCardWidth(value)} style={[imageShareStyles.choice, imageShareCardWidth === value && imageShareStyles.choiceActive]}>
                    <Text style={[imageShareStyles.choiceText, imageShareCardWidth === value && imageShareStyles.choiceTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale === "en-US" ? "Typography" : "字体风格"}</Text>
              <View style={imageShareStyles.choiceRow}>
                {MOBILE_FONT_OPTIONS.map((item) => {
                  const isSelected = imageShareFontStyle === item.id;
                  const label = resolvedLocale === "en-US" ? item.labelEn : item.labelZh;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => setImageShareFontStyle(item.id)}
                      style={[
                        imageShareStyles.choice,
                        isSelected && imageShareStyles.choiceActive,
                      ]}
                    >
                      <Text style={[imageShareStyles.choiceText, isSelected && imageShareStyles.choiceTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale === "en-US" ? "Content Elements" : "显示内容"}</Text>
              {([
                [resolvedLocale === "en-US" ? "Title" : "笔记标题", imageShareTitle, setImageShareTitle],
                [resolvedLocale === "en-US" ? "Notebook" : "笔记本", imageShareNotebook, setImageShareNotebook],
                [resolvedLocale === "en-US" ? "Tags" : "标签", imageShareTags, setImageShareTags],
                [resolvedLocale === "en-US" ? "Updated time" : "更新时间", imageShareUpdatedAt, setImageShareUpdatedAt],
                [resolvedLocale === "en-US" ? "EdgeEver branding" : "EdgeEver 品牌标识", imageShareBranding, setImageShareBranding],
              ] as const).map(([label, selected, setSelected]) => (
                <Pressable key={label} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setSelected(!selected)} style={imageShareStyles.optionRow}>
                  <Text style={imageShareStyles.optionLabel}>{label}</Text>
                  <Text style={imageShareStyles.optionCheck}>{selected ? "✓" : ""}</Text>
                </Pressable>
              ))}

              <Text style={styles.actionSheetSectionTitle}>{resolvedLocale === "en-US" ? "Format" : "格式"}</Text>
              <View style={imageShareStyles.choiceRow}>
                {(["png", "jpeg"] as const).map((value) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setImageShareFormat(value)} style={[imageShareStyles.formatChoice, imageShareFormat === value && imageShareStyles.choiceActive]}>
                    <Text style={[imageShareStyles.choiceText, imageShareFormat === value && imageShareStyles.choiceTextActive]}>
                      {value === "png"
                        ? (resolvedLocale === "en-US" ? "PNG · Crisp text" : "PNG · 超清无损")
                        : (resolvedLocale === "en-US" ? "JPEG · Smaller file" : "JPEG · 体积小")}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={isExportingImage}
                onPress={() => {
                  setImageShareOptionsOpen(false);
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
                style={[imageShareStyles.shareButton, isExportingImage && styles.buttonDisabled]}
              >
                <Share2 color="#ffffff" size={18} />
                <Text style={imageShareStyles.shareButtonText}>
                  {resolvedLocale === "en-US" ? "Generate preview" : "生成预览"}
                </Text>
              </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
        <Modal animationType="slide" onRequestClose={() => setPreparedNoteImage(null)} presentationStyle="fullScreen" visible={Boolean(preparedNoteImage)}>
          <SafeAreaView style={imageShareStyles.previewSafeArea}>
            <View style={imageShareStyles.previewHeader}>
              <Text style={imageShareStyles.previewTitle}>{resolvedLocale === "en-US" ? "Image preview" : "图片预览"}</Text>
              <Pressable accessibilityLabel={resolvedLocale === "en-US" ? "Close preview" : "关闭预览"} accessibilityRole="button" onPress={() => setPreparedNoteImage(null)} style={imageShareStyles.previewCloseButton}>
                <X color="#0f172a" size={22} />
              </Pressable>
            </View>
            {preparedNoteImage ? (
              <>
                <ScrollView contentContainerStyle={imageShareStyles.previewScrollContent} style={imageShareStyles.previewScroll}>
                  <RNImage
                    resizeMode="contain"
                    source={{ uri: preparedNoteImage.uri }}
                    style={[
                      imageShareStyles.previewImage,
                      preparedNoteImage.width > 0 && preparedNoteImage.height > 0
                        ? { aspectRatio: preparedNoteImage.width / preparedNoteImage.height }
                        : null,
                    ]}
                  />
                  {preparedNoteImage.failedImages > 0 ? (
                    <Text style={imageShareStyles.previewWarning}>
                      {resolvedLocale === "en-US"
                        ? `${preparedNoteImage.failedImages} of ${preparedNoteImage.totalImages} note image(s) could not be included.`
                        : `笔记中的 ${preparedNoteImage.totalImages} 张图片有 ${preparedNoteImage.failedImages} 张未能包含。`}
                    </Text>
                  ) : null}
                  {preparedNoteImage.height > 12_000 ? (
                    <Text style={imageShareStyles.previewWarning}>
                      {resolvedLocale === "en-US"
                        ? "This is a long image. Some social apps may reduce its quality; keep the saved original."
                        : "图片较长，部分社交平台可能会压缩画质；建议保留保存的原图。"}
                    </Text>
                  ) : null}
                </ScrollView>
                <View style={imageShareStyles.previewActions}>
                  <Pressable accessibilityRole="button" onPress={() => void copyPreparedNoteImage(preparedNoteImage)} style={imageShareStyles.previewSecondaryButton}>
                    <Copy color="#0f172a" size={18} />
                    <Text style={imageShareStyles.previewSecondaryButtonText}>{resolvedLocale === "en-US" ? "Copy" : "复制图片"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => void savePreparedNoteImage(preparedNoteImage)} style={imageShareStyles.previewSecondaryButton}>
                    <Download color="#0f172a" size={18} />
                    <Text style={imageShareStyles.previewSecondaryButtonText}>{resolvedLocale === "en-US" ? "Save" : "保存图片"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => void sharePreparedNoteImage(preparedNoteImage)} style={imageShareStyles.previewPrimaryButton}>
                    <Share2 color="#ffffff" size={18} />
                    <Text style={imageShareStyles.previewPrimaryButtonText}>{resolvedLocale === "en-US" ? "Share" : "系统分享"}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </SafeAreaView>
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
              <Pressable
                accessibilityHint={resolvedLocale === "en-US" ? "Long press for image actions" : "长按打开图片操作"}
                accessibilityLabel={imagePreview.alt || (resolvedLocale === "en-US" ? "Image preview" : "图片预览")}
                accessibilityRole="image"
                delayLongPress={400}
                onLongPress={() => {
                  // Long-press fullscreen preview → same resource sheet as ⋯ in the note.
                  const target = getMobileImageTarget(imagePreview.source, imagePreview.alt);
                  if (target) {
                    setResourceTarget(target);
                  }
                }}
                style={resourceImageStyles.previewImagePressable}
              >
                <AuthenticatedResourceImage
                  alt={imagePreview.alt}
                  href={imagePreview.source}
                  loadResourceBlob={client?.getResourceBlob}
                  onLoadFailure={imageLoadFailureNotifier}
                  resizeMode="contain"
                  session={session}
                  style={resourceImageStyles.previewImage}
                />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={resolvedLocale === "en-US" ? "Close image preview" : "关闭图片预览"}
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
          onClose={() => setResourceTarget(null)}
          onDelete={async (target) => {
            if (!memo) return;
            await onDeleteResource(memo, target);
          }}
          onDownload={downloadResource}
          onRename={async (target, filename) => {
            if (!memo) return;
            await onRenameResource(memo, target, filename);
          }}
          onSaveAs={saveResourceAs}
          target={resourceTarget}
        />
      </SafeAreaView>
    </Modal>
  );
};

const imageShareStyles = StyleSheet.create({
  sheetContainer: {
    maxHeight: "85%",
    paddingBottom: 24,
  },
  optionsContent: {
    paddingBottom: 4,
  },
  optionsScroll: {
    flexShrink: 1,
  },
  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  themeCard: {
    width: "23%",
    minWidth: 70,
    flexGrow: 1,
    flexDirection: "row",
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
  themeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  themeLabel: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  themeLabelActive: {
    color: "#0f172a",
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
    marginTop: 16,
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
});

const detailLayoutStyles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  meta: {
    paddingBottom: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
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
  previewImagePressable: {
    flex: 1,
    height: "100%",
    width: "100%",
  },
  previewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
});
