import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MEMO_TITLE, type MemoDetail, type MemoRevision } from "@edgeever/shared";
import { History, RotateCcw, X } from "../components/icons";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert, Pressable, Text } from "../components/LocalizedText";
import { useMobileLocale } from "../lib/mobile-locale";
import { useSession } from "../lib/session";
import { formatDate, formatRevisionActor } from "./workspace-utils";
import { styles } from "./workspace-styles";

const IconButton = ({
  accessibilityLabel,
  children,
  disabled = false,
  onPress,
}: {
  accessibilityLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}) => (
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

export const RevisionHistoryModal = ({
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
  const localePreference = useMobileLocale().preference;
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
