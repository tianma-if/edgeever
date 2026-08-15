import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_MEMO_TITLE, resolveMemoContentDoc, type MemoDetail, type TiptapDoc } from "@edgeever/shared";
import * as Clipboard from "expo-clipboard";
import { Image as RNImage, Platform, StyleSheet, Text as RNText, View, type ImageStyle, type StyleProp, type TextStyle } from "react-native";
import { Modal } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import { ActivityIndicator, ChevronDown, ChevronLeft, ChevronRight, Copy, History, MoreHorizontal, Pencil, RotateCcw, Search, Share2, Sparkles, Tag, Trash2, X } from "../components/icons";
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
  const viewerRef = useRef<LocalTiptapEditorRef>(null);
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
      await openMobileResource(client, target);
    } catch (error) {
      Alert.alert(
        resolvedLocale === "en-US" ? "Unable to open resource" : "无法打开资源",
        error instanceof Error ? error.message : (resolvedLocale === "en-US" ? "Try again later." : "请稍后重试。")
      );
      throw error;
    }
  }, [client, resolvedLocale]);
  const saveResourceAs = useCallback(async (target: MobileResourceTarget) => {
    if (!client) throw new Error(resolvedLocale === "en-US" ? "The resource client is unavailable." : "当前无法读取资源。");
    const result = await saveMobileResourceAs(client, target);
    if (result.kind === "saf") {
      Alert.alert(
        resolvedLocale === "en-US" ? "Downloaded" : "下载成功",
        resolvedLocale === "en-US" ? `Saved ${result.filename}` : `已保存：${result.filename}`
      );
    }
  }, [client, resolvedLocale]);

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
                <Text style={styles.actionSheetTitle}>笔记操作</Text>
                {!memo.isDeleted ? (
                  <DetailActionSheetItem
                    icon={<Sparkles color="#16A06E" size={18} />}
                    label="AI 笔记助手"
                    onPress={() => closeActionsAndRun(() => setAiAssistantOpen(true))}
                  />
                ) : null}
                <DetailActionSheetItem
                  disabled={!canCopyMemoId}
                  icon={<Copy color="#0f172a" size={18} />}
                  label={canCopyMemoId ? "复制笔记 ID" : "同步后可复制笔记 ID"}
                  onPress={() => closeActionsAndRun(() => void copyMemoId())}
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
