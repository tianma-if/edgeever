import type { ReactNode } from "react";
import type { MemoSortMode } from "@edgeever/client";
import { Modal, ScrollView, View } from "react-native";
import { Check, CheckSquare, FileText, Folder, List, MoreVertical, Sparkles, Trash2, X } from "../components/icons";
import { Pressable, Text } from "../components/LocalizedText";
import type { MobileMemoListDensity } from "../lib/preferences";
import { styles } from "./workspace-styles";

const ActionSheetItem = ({
  compact = false,
  danger = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  compact?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={[
      styles.actionSheetItem,
      compact && styles.actionSheetItemCompact,
      disabled && styles.buttonDisabled,
    ]}
  >
    {icon}
    <Text
      style={[
        styles.actionSheetItemText,
        compact && styles.actionSheetItemTextCompact,
        danger && styles.actionSheetItemTextDanger,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

const SheetOptionRow = ({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon?: ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityState={{ checked: active }}
    onPress={onPress}
    style={[styles.sheetOptionRow, active && styles.sheetOptionRowActive]}
  >
    {icon ? <View style={styles.sheetOptionIcon}>{icon}</View> : null}
    <Text style={[styles.sheetOptionLabel, active && styles.sheetOptionLabelActive]}>{label}</Text>
    <View style={[styles.sheetOptionCheck, !active && styles.sheetOptionCheckHidden]}>
      <Check color="#ffffff" size={13} />
    </View>
  </Pressable>
);

export const NotesActionsModal = ({
  bottomOffset,
  canEnterSelection,
  listDescription,
  listTitle,
  memoListDensity,
  memoSortMode,
  onClose,
  onEnterSelection,
  onMemoListDensityChange,
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
              <ActionSheetItem
                compact
                disabled={!canEnterSelection}
                icon={<CheckSquare color="#0f172a" size={18} />}
                label="选择笔记"
                onPress={onEnterSelection}
              />
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
        </ScrollView>
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

export const SelectionActionBar = ({
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
      <SelectionAction
        disabled={isBusy || !canMove}
        icon={<Folder color={canMove ? "#0f172a" : "#cbd5e1"} size={20} />}
        label="移动"
        onPress={onMove}
      />
      <SelectionAction
        danger
        disabled={isBusy || selectedCount === 0}
        icon={<Trash2 color={selectedCount === 0 ? "#cbd5e1" : "#b91c1c"} size={20} />}
        label={isTrashView ? "永久删除" : "删除"}
        onPress={onDelete}
      />
      <SelectionAction
        disabled={isBusy}
        icon={<MoreVertical color="#0f172a" size={20} />}
        label="更多"
        onPress={onMore}
      />
    </View>
  </View>
);

export const SelectionMoreModal = ({
  bottomOffset,
  canPin,
  canToggleVisibleSelection,
  onClear,
  onClose,
  onPin,
  onToggleVisibleSelection,
  pinLabel,
  selectedCount,
  selectionToggleLabel,
  visible,
}: {
  bottomOffset: number;
  canPin: boolean;
  canToggleVisibleSelection: boolean;
  onClear: () => void;
  onClose: () => void;
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
        <ActionSheetItem
          disabled={!canToggleVisibleSelection}
          icon={<CheckSquare color={canToggleVisibleSelection ? "#0f172a" : "#cbd5e1"} size={18} />}
          label={selectionToggleLabel}
          onPress={onToggleVisibleSelection}
        />
        <ActionSheetItem
          disabled={!canPin}
          icon={<Sparkles color={canPin ? "#0f172a" : "#cbd5e1"} size={18} />}
          label={pinLabel}
          onPress={onPin}
        />
        <ActionSheetItem icon={<X color="#0f172a" size={18} />} label="取消选择" onPress={onClear} />
      </Pressable>
    </Pressable>
  </Modal>
);
