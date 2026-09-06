import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiRequestError } from "@edgeever/client";
import { useQuery } from "@tanstack/react-query";
import type { Notebook } from "@edgeever/shared";
import {
  getMobileCenteredScrollOffset,
  getMobileNotebookSearchVisibleIds,
} from "@edgeever/shared/mobile-ui";
import {
  ActivityIndicator,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Search,
  Tag,
  TagPlus,
  X,
} from "../components/icons";
import {
  type LayoutChangeEvent,
  Modal,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Pressable, Text, TextInput } from "../components/LocalizedText";
import { useMobileLocale } from "../lib/mobile-locale";
import { listLocalTags } from "../lib/local-mirror";
import { useSession } from "../lib/session";
import {
  filterCollapsedNotebookOptions,
  filterNotebookOptions,
  filterNotebookOptionsById,
  flattenNotebooks,
  getNotebookAncestorIds,
  getNotebookParentIdSet,
  parseTags,
  type NotebookOption,
} from "./workspace-utils";
import { styles } from "./workspace-styles";

const ALL_NOTES_ID = "all";

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

export const NotebookPickerModal = ({
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

export const SmartTagButton = ({
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

export const TagPickerModal = ({
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

export const MoveSelectionModal = ({
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
