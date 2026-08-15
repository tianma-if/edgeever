import { memo, useRef, type ReactNode } from "react";
import type { MemoFilterMode } from "@edgeever/client";
import { DEFAULT_MEMO_TITLE, type MemoSummary, type Notebook } from "@edgeever/shared";
import { MOBILE_UI_METRICS, toggleMobileMemoFilterMode } from "@edgeever/shared/mobile-ui";
import { FlatList, Platform, RefreshControl, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { ActivityIndicator, Check, ChevronDown, ChevronLeft, LayoutTemplate, MoreHorizontal, Plus, RotateCcw, Search, Sparkles, Tag, X } from "../components/icons";
import { Pressable, Text, TextInput } from "../components/LocalizedText";
import type { MobileBootstrapProgress } from "../lib/local-mirror";
import { useMobileLocale } from "../lib/mobile-locale";
import { useMobileTheme } from "../lib/mobile-theme";
import type { MobileMemoListDensity } from "../lib/preferences";
import { formatMemoPreviewDate } from "./workspace-utils";
import { styles } from "./workspace-styles";

type MemoView = "notebook" | "trash";

export const NotesView = ({
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
  onCreateFromTemplate,
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
  onCreateFromTemplate?: () => void;
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
  const { preference: localePreference, translate } = useMobileLocale();
  const searchActive = searchText.trim().length > 0;
  const filterActive = memoFilterMode !== "all";
  const searchStatusLabel = translate("正在搜索");
  const searchResultLabel = translate(`${totalMemoCount} 条结果`);
  const exitSearchLabel = translate("退出搜索");
  const activeFilterLabel = memoFilterMode === "pinned"
    ? translate("置顶")
    : memoFilterMode === "tagged"
      ? translate("有标签")
      : translate("无标签");
  const filterResultLabel = translate(`筛选：${activeFilterLabel} · ${totalMemoCount} 条`);
  const resetFilterLabel = translate("重置");

  return (
    <View style={styles.viewBody}>
      <View style={styles.mobileListHeader}>
        {selectionMode ? (
          <View style={styles.mobileSelectionHeader}>
            <Pressable accessibilityLabel="取消选择" accessibilityRole="button" onPress={onClearSelection} style={styles.mobileSelectionClose}>
              <X color="#64748b" size={19} />
            </Pressable>
            <Text style={styles.mobileSelectionTitle}>{selectedMemoIds.size > 0 ? translate(`已选择 ${selectedMemoIds.size} 条`) : "选择笔记"}</Text>
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
      emptyActions={memoView === "notebook" && notebooks.length > 0 && !searchActive && memoFilterMode === "all"
        ? [
          { label: "新建笔记", onPress: onCreate, variant: "primary" as const },
          ...(onCreateFromTemplate
            ? [{ label: "从模板新建", onPress: onCreateFromTemplate, variant: "secondary" as const }]
            : []),
        ]
        : undefined}
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


const MemoList = ({
  emptyActions,
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
  emptyActions?: Array<{ label: string; onPress: () => void; variant?: "primary" | "secondary" }>;
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
  const { preference: localePreference, translate } = useMobileLocale();
  const hasInitialSyncProgress = initialSyncProgress !== null;
  const loadedCount = initialSyncProgress?.loadedCount ?? 0;
  const totalCount = initialSyncProgress?.totalCount ?? 0;
  const progressPercent = totalCount > 0 ? Math.min(100, Math.round((loadedCount / totalCount) * 100)) : 0;
  const progressTitle = translate("正在同步笔记");
  const progressDescription = totalCount > 0
    ? translate(`已加载 ${loadedCount} / ${totalCount} 条笔记`)
    : translate("正在准备首次同步…");
  const loadingTitle = hasInitialSyncProgress ? progressTitle : translate("正在加载笔记");
  const loadingDescription = hasInitialSyncProgress
    ? progressDescription
    : translate("正在加载笔记本和笔记…");

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
          {emptyActions && emptyActions.length > 0 ? (
            <View style={styles.emptyActionRow}>
              {emptyActions.map((action) => {
                const isSecondary = action.variant === "secondary";
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={action.label}
                    onPress={action.onPress}
                    style={isSecondary ? styles.emptyActionSecondaryButton : styles.emptyActionButton}
                  >
                    {isSecondary
                      ? <LayoutTemplate color="#0f172a" size={16} />
                      : <Plus color="#ffffff" size={18} />}
                    <Text style={isSecondary ? styles.emptyActionSecondaryButtonText : styles.emptyActionButtonText}>
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
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
              <Text style={styles.memoSyncErrorBannerTitle}>{translate("同步已暂停")}</Text>
              <Text style={styles.memoSyncErrorBannerDescription}>
                {translate("已加载的笔记仍可使用，请检查网络后重试。")}
              </Text>
            </View>
            {onRetry ? (
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.memoSyncErrorRetryButton}>
                <RotateCcw color="#92400e" size={15} />
                <Text style={styles.memoListRetryText}>{translate("重试")}</Text>
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
  const localePreference = useMobileLocale().preference;
  const memoTitle = memo.title?.trim() || DEFAULT_MEMO_TITLE;
  const handledLongPressRef = useRef(false);
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
        onLongPress={() => {
          handledLongPressRef.current = true;
          onLongPress?.();
        }}
        onPress={() => {
          if (handledLongPressRef.current) {
            handledLongPressRef.current = false;
            return;
          }
          onPress();
        }}
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
