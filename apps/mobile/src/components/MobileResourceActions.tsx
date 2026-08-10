import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Modal, StyleSheet, View } from "react-native";
import { ActivityIndicator, Download, FileText, MoreHorizontal, Pencil, Share2, Trash2, X } from "./icons";
import { Pressable, Text, TextInput } from "./LocalizedText";
import {
  MobileResourceCancelledError,
  type MobileAttachmentTarget,
  type MobileResourceTarget,
} from "../lib/mobile-attachments";
import { useMobileLocale } from "../lib/mobile-locale";
import { useMobileTheme } from "../lib/mobile-theme";

type MobileResourceActionsProps = {
  canMutate: boolean;
  onClose: () => void;
  onDelete: (target: MobileResourceTarget) => Promise<void>;
  onDownload: (target: MobileResourceTarget) => Promise<void>;
  onRename: (target: MobileResourceTarget, filename: string) => Promise<void>;
  onSaveAs: (target: MobileResourceTarget) => Promise<void>;
  target: MobileResourceTarget | null;
};

const copy = {
  "zh-CN": {
    attachmentActions: "附件操作",
    imageActions: "图片操作",
    cancel: "取消",
    delete: "删除",
    attachmentDeleteConfirm: "附件会从存储空间和当前笔记中永久删除，此操作无法撤销。",
    attachmentDeleteTitle: "删除附件",
    // Opens the system share sheet (not a silent save-to-folder).
    share: "分享",
    // Saves to a user-chosen folder (Android SAF) or share-as-save fallback.
    download: "下载",
    downloadFailed: "无法下载",
    failed: "资源操作失败，请重试。",
    filename: "文件名",
    rename: "重命名",
    attachmentRenameTitle: "重命名附件",
    imageDeleteConfirm: "图片会从存储空间和当前笔记中永久删除，此操作无法撤销。",
    imageDeleteTitle: "删除图片",
    imageRenameTitle: "重命名图片",
    save: "保存",
    syncedOnly: "资源同步完成后才能重命名或删除。",
  },
  "en-US": {
    attachmentActions: "Attachment actions",
    imageActions: "Image actions",
    cancel: "Cancel",
    delete: "Delete",
    attachmentDeleteConfirm: "The attachment will be permanently removed from storage and this note. This cannot be undone.",
    attachmentDeleteTitle: "Delete attachment",
    // Opens the system share sheet (not a silent save-to-folder).
    share: "Share",
    // Saves to a user-chosen folder (Android SAF) or share-as-save fallback.
    download: "Download",
    downloadFailed: "Unable to download",
    failed: "The resource action failed. Try again.",
    filename: "Filename",
    rename: "Rename",
    attachmentRenameTitle: "Rename attachment",
    imageDeleteConfirm: "The image will be permanently removed from storage and this note. This cannot be undone.",
    imageDeleteTitle: "Delete image",
    imageRenameTitle: "Rename image",
    save: "Save",
    syncedOnly: "Rename and delete are available after the resource has synced.",
  },
} as const;

export const MobileAttachmentCard = ({
  busy = false,
  onActions,
  onOpen,
  target,
}: {
  busy?: boolean;
  onActions: () => void;
  onOpen: () => void;
  target: MobileAttachmentTarget;
}) => {
  const { resolvedTheme } = useMobileTheme();
  const { resolvedLocale } = useMobileLocale();
  const extension = target.filename.includes(".") ? target.filename.split(".").pop()?.toUpperCase() : "FILE";
  const dark = resolvedTheme === "dark";
  const longPressAtRef = useRef(0);

  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      <Pressable
        accessibilityHint={resolvedLocale === "en-US" ? "Opens the system share sheet for this attachment" : "打开系统分享面板分享此附件"}
        accessibilityLabel={target.filename}
        accessibilityRole="button"
        disabled={busy}
        onLongPress={() => {
          longPressAtRef.current = Date.now();
          onActions();
        }}
        onPress={() => {
          if (Date.now() - longPressAtRef.current < 800) return;
          onOpen();
        }}
        style={styles.cardMain}
      >
        <View style={[styles.fileIcon, dark && styles.fileIconDark]}>
          {busy ? <ActivityIndicator color="#059669" size="small" /> : <FileText color={dark ? "#a7f3d0" : "#047857"} size={20} />}
        </View>
        <View style={styles.cardText}>
          <Text numberOfLines={2} style={[styles.filename, dark && styles.filenameDark]}>{target.filename}</Text>
          <Text style={[styles.fileType, dark && styles.fileTypeDark]}>{extension || "FILE"}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={resolvedLocale === "en-US" ? "Attachment actions" : "附件操作"}
        accessibilityRole="button"
        disabled={busy}
        onPress={onActions}
        style={styles.moreButton}
      >
        <MoreHorizontal color={dark ? "#94a3b8" : "#64748b"} size={21} />
      </Pressable>
    </View>
  );
};

export const MobileResourceActions = ({
  canMutate,
  onClose,
  onDelete,
  onDownload,
  onRename,
  onSaveAs,
  target,
}: MobileResourceActionsProps) => {
  const { resolvedLocale } = useMobileLocale();
  const labels = copy[resolvedLocale];
  const [mode, setMode] = useState<"actions" | "rename">("actions");
  const [filename, setFilename] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setMode("actions");
    setFilename(target.filename);
    setError(null);
  }, [target]);

  if (!target) return null;

  const isImage = target.kind === "image";
  const actionsTitle = isImage ? labels.imageActions : labels.attachmentActions;
  const deleteTitle = isImage ? labels.imageDeleteTitle : labels.attachmentDeleteTitle;
  const deleteConfirm = isImage ? labels.imageDeleteConfirm : labels.attachmentDeleteConfirm;
  const renameTitle = isImage ? labels.imageRenameTitle : labels.attachmentRenameTitle;

  const run = async (action: () => Promise<void>, closeAfter = true) => {
    setPending(true);
    setError(null);
    try {
      await action();
      if (closeAfter) onClose();
    } catch (actionError) {
      if (actionError instanceof MobileResourceCancelledError) {
        return;
      }
      setError(actionError instanceof Error ? actionError.message : labels.failed);
    } finally {
      setPending(false);
    }
  };

  /**
   * Share / download open Android system UI (share sheet or SAF folder picker).
   * Dismiss our Modal first so the activity-result channel is free — otherwise SAF
   * often never appears and the tap looks like a dead button.
   */
  const runSystemUiAction = async (
    action: (current: MobileResourceTarget) => Promise<void>,
    failureTitle: string
  ) => {
    const current = target;
    if (!current || pending) return;
    onClose();
    try {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await action(current);
    } catch (actionError) {
      if (actionError instanceof MobileResourceCancelledError) {
        return;
      }
      Alert.alert(
        failureTitle,
        actionError instanceof Error ? actionError.message : labels.failed
      );
    }
  };

  const confirmDelete = () => {
    Alert.alert(deleteTitle, deleteConfirm, [
      { text: labels.cancel, style: "cancel" },
      { text: labels.delete, style: "destructive", onPress: () => void run(() => onDelete(target)) },
    ]);
  };

  return (
    <Modal animationType="fade" onRequestClose={pending ? undefined : onClose} transparent visible>
      <Pressable disabled={pending} onPress={onClose} style={styles.backdrop}>
        <Pressable style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetTitle}>{mode === "rename" ? renameTitle : actionsTitle}</Text>
              <Text numberOfLines={1} style={styles.sheetSubtitle}>{target.filename}</Text>
            </View>
            <Pressable accessibilityLabel={labels.cancel} accessibilityRole="button" disabled={pending} onPress={onClose} style={styles.closeButton}>
              <X color="#475569" size={19} />
            </Pressable>
          </View>

          {mode === "actions" ? (
            <View style={styles.actions}>
              <ResourceActionRow
                icon={<Share2 color="#0f172a" size={19} />}
                label={labels.share}
                onPress={() => void runSystemUiAction((current) => onDownload(current), labels.failed)}
                pending={pending}
              />
              <ResourceActionRow
                icon={<Download color="#0f172a" size={19} />}
                label={labels.download}
                onPress={() => void runSystemUiAction((current) => onSaveAs(current), labels.downloadFailed)}
                pending={pending}
              />
              <ResourceActionRow disabled={!canMutate} icon={<Pencil color={canMutate ? "#0f172a" : "#94a3b8"} size={19} />} label={labels.rename} onPress={() => setMode("rename")} pending={pending} />
              <View style={styles.divider} />
              <ResourceActionRow danger disabled={!canMutate} icon={<Trash2 color={canMutate ? "#be123c" : "#94a3b8"} size={19} />} label={labels.delete} onPress={confirmDelete} pending={pending} />
              {!canMutate ? <Text style={styles.hint}>{labels.syncedOnly}</Text> : null}
            </View>
          ) : (
            <View style={styles.renameForm}>
              <Text style={styles.inputLabel}>{labels.filename}</Text>
              <TextInput
                autoFocus
                editable={!pending}
                maxLength={160}
                onChangeText={setFilename}
                selectTextOnFocus
                style={styles.input}
                value={filename}
              />
              <View style={styles.formButtons}>
                <Pressable disabled={pending} onPress={() => setMode("actions")} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>{labels.cancel}</Text>
                </Pressable>
                <Pressable
                  disabled={pending || !filename.trim()}
                  onPress={() => void run(() => onRename(target, filename.trim()))}
                  style={[styles.primaryButton, (pending || !filename.trim()) && styles.disabled]}
                >
                  {pending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryButtonText}>{labels.save}</Text>}
                </Pressable>
              </View>
            </View>
          )}
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const ResourceActionRow = ({
  danger = false,
  disabled = false,
  icon,
  label,
  onPress,
  pending,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
  pending: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled || pending}
    onPress={onPress}
    style={[styles.actionRow, disabled && styles.disabled]}
  >
    {icon}
    <Text style={[styles.actionLabel, danger && styles.dangerText]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  actionLabel: { color: "#0f172a", fontSize: 16, fontWeight: "600" },
  actionRow: { alignItems: "center", flexDirection: "row", gap: 14, minHeight: 52, paddingHorizontal: 6 },
  actions: { gap: 2, paddingTop: 8 },
  backdrop: { backgroundColor: "rgba(15,23,42,0.34)", flex: 1, justifyContent: "flex-end" },
  card: { alignItems: "center", backgroundColor: "#f8fafc", borderColor: "#cbd5e1", borderRadius: 12, borderWidth: 1, flexDirection: "row", marginVertical: 6, minHeight: 64 },
  cardDark: { backgroundColor: "#172033", borderColor: "#334155" },
  cardMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12, minHeight: 62, paddingHorizontal: 12, paddingVertical: 9 },
  cardText: { flex: 1, gap: 3 },
  closeButton: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  dangerText: { color: "#be123c" },
  disabled: { opacity: 0.45 },
  divider: { backgroundColor: "#e2e8f0", height: 1, marginVertical: 4 },
  error: { color: "#be123c", fontSize: 13, marginTop: 10 },
  fileIcon: { alignItems: "center", backgroundColor: "#ecfdf5", borderRadius: 10, height: 42, justifyContent: "center", width: 42 },
  fileIconDark: { backgroundColor: "#134e4a" },
  filename: { color: "#1e293b", fontSize: 15, fontWeight: "700" },
  filenameDark: { color: "#f1f5f9" },
  fileType: { color: "#64748b", fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  fileTypeDark: { color: "#94a3b8" },
  formButtons: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 14 },
  handle: { alignSelf: "center", backgroundColor: "#cbd5e1", borderRadius: 999, height: 4, marginBottom: 14, width: 42 },
  hint: { color: "#64748b", fontSize: 12, lineHeight: 18, marginTop: 4 },
  input: { borderColor: "#cbd5e1", borderRadius: 9, borderWidth: 1, color: "#0f172a", fontSize: 16, minHeight: 46, paddingHorizontal: 12 },
  inputLabel: { color: "#475569", fontSize: 13, fontWeight: "600" },
  moreButton: { alignItems: "center", alignSelf: "stretch", justifyContent: "center", minWidth: 48 },
  primaryButton: { alignItems: "center", backgroundColor: "#059669", borderRadius: 9, justifyContent: "center", minHeight: 42, minWidth: 84, paddingHorizontal: 16 },
  primaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  renameForm: { gap: 8, paddingTop: 14 },
  secondaryButton: { alignItems: "center", borderColor: "#cbd5e1", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 42, minWidth: 84, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#475569", fontSize: 14, fontWeight: "700" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 28, paddingHorizontal: 20, paddingTop: 10 },
  sheetHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sheetHeaderText: { flex: 1, gap: 3 },
  sheetSubtitle: { color: "#64748b", fontSize: 13 },
  sheetTitle: { color: "#0f172a", fontSize: 19, fontWeight: "800" },
});
