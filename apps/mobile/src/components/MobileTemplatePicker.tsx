import { useQuery } from "@tanstack/react-query";
import type { createEdgeEverClient } from "@edgeever/client";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { ActivityIndicator, FileText, LayoutTemplate, X } from "./icons";
import { Text } from "./LocalizedText";
import {
  mobileTemplateToCreateSeed,
  toMobileSelectableTemplate,
  type MobileCreateMemoSeed,
  type MobileSelectableTemplate,
} from "../lib/mobile-templates";
import { useMobileLocale } from "../lib/mobile-locale";
import { styles } from "../screens/workspace-styles";

type MobileClient = ReturnType<typeof createEdgeEverClient>;

/**
 * Template picker.
 * - `modal` (default): system Modal — use from the workspace root only.
 * - `overlay`: absolute fill overlay — use inside CreateMemoModal so we do NOT nest
 *   RN Modals over DomWebView (Android keyboard / focus breaks after nested modals).
 */
export const MobileTemplatePickerModal = ({
  bottomOffset = 0,
  client,
  onClose,
  onSelect,
  presentation = "modal",
  visible,
}: {
  bottomOffset?: number;
  client: MobileClient | null;
  onClose: () => void;
  onSelect: (seed: MobileCreateMemoSeed) => void;
  presentation?: "modal" | "overlay";
  visible: boolean;
}) => {
  const { translate } = useMobileLocale();

  const savedTemplatesQuery = useQuery({
    queryKey: ["mobile", "templates"],
    enabled: visible && Boolean(client),
    queryFn: async () => {
      if (!client) {
        return [] as MobileSelectableTemplate[];
      }
      if (typeof client.listTemplates !== "function") {
        throw new Error("Client is missing listTemplates; reload the app to pick up the latest bundle.");
      }
      const response = await client.listTemplates();
      return response.templates.map(toMobileSelectableTemplate);
    },
    staleTime: 15_000,
    retry: 1,
  });

  const savedTemplates = savedTemplatesQuery.data ?? [];
  const isLoadingSaved = savedTemplatesQuery.isLoading || savedTemplatesQuery.isFetching;
  const savedLoadErrorMessage = savedTemplatesQuery.error instanceof Error
    ? savedTemplatesQuery.error.message
    : savedTemplatesQuery.isError
      ? String(savedTemplatesQuery.error ?? "")
      : "";

  const handleSelect = (template: MobileSelectableTemplate) => {
    onSelect(mobileTemplateToCreateSeed(template));
    onClose();
  };

  if (!visible) {
    return null;
  }

  const sheet = (
    <Pressable
      onPress={onClose}
      style={[
        styles.actionSheetBackdrop,
        presentation === "overlay" ? styles.templatePickerOverlayRoot : null,
        { paddingBottom: bottomOffset },
      ]}
    >
      <Pressable style={[styles.listActionSheet, styles.templatePickerSheet]} onPress={(event) => event.stopPropagation()}>
        <View style={styles.actionSheetHandle} />
        <View style={styles.listActionSheetHeader}>
          <View style={styles.listActionSheetHeaderText}>
            <Text numberOfLines={1} style={styles.actionSheetTitle}>{translate("从模板新建")}</Text>
            <Text numberOfLines={2} style={styles.actionSheetSubtitle}>
              {translate("选择一个模板快速开始。所有模板都可以在网页端修改或删除。")}
            </Text>
          </View>
          <Pressable accessibilityLabel={translate("关闭")} accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
            <X color="#0f172a" size={18} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.listActionSheetContent} style={styles.listActionSheetScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.actionSheetSectionTitle}>{translate("模板")}</Text>
          {isLoadingSaved ? (
            <View style={styles.templatePickerLoading}>
              <ActivityIndicator color="#0f172a" size="small" />
              <Text style={styles.mutedText}>{translate("正在加载模板")}</Text>
            </View>
          ) : null}
          {!isLoadingSaved && savedTemplatesQuery.isError ? (
            <View style={styles.templatePickerErrorBlock}>
              <Text style={styles.templatePickerHint}>
                {translate("模板暂时无法加载，请稍后重试。")}
              </Text>
              {savedLoadErrorMessage ? (
                <Text style={styles.templatePickerErrorDetail} numberOfLines={3}>
                  {savedLoadErrorMessage}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => void savedTemplatesQuery.refetch()}
                style={styles.templatePickerRetryButton}
              >
                <Text style={styles.templatePickerRetryText}>{translate("重试")}</Text>
              </Pressable>
            </View>
          ) : null}
          {!isLoadingSaved && !savedTemplatesQuery.isError && savedTemplates.length === 0 ? (
            <Text style={styles.templatePickerHint}>
              {translate("暂无模板。可在网页端新建模板，或将常用笔记另存为模板。")}
            </Text>
          ) : null}
          {savedTemplates.map((template) => (
            <TemplateRow key={template.id} onPress={() => handleSelect(template)} template={template} />
          ))}
        </ScrollView>
      </Pressable>
    </Pressable>
  );

  if (presentation === "overlay") {
    return sheet;
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      {sheet}
    </Modal>
  );
};

export const MobileCreateChoiceModal = ({
  bottomOffset = 0,
  canCreate,
  onBlank,
  onClose,
  onTemplate,
  visible,
}: {
  bottomOffset?: number;
  canCreate: boolean;
  onBlank: () => void;
  onClose: () => void;
  onTemplate: () => void;
  visible: boolean;
}) => {
  const { translate } = useMobileLocale();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={[styles.actionSheetBackdrop, { paddingBottom: bottomOffset }]}>
        <Pressable style={styles.listActionSheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.actionSheetHandle} />
          <View style={styles.listActionSheetHeader}>
            <View style={styles.listActionSheetHeaderText}>
              <Text numberOfLines={1} style={styles.actionSheetTitle}>{translate("新建笔记")}</Text>
              <Text numberOfLines={1} style={styles.actionSheetSubtitle}>{translate("选择创建方式")}</Text>
            </View>
            <Pressable accessibilityLabel={translate("关闭")} accessibilityRole="button" onPress={onClose} style={styles.sheetCloseButton}>
              <X color="#0f172a" size={18} />
            </Pressable>
          </View>
          <View style={styles.listActionSheetContent}>
            <Pressable
              accessibilityRole="button"
              disabled={!canCreate}
              onPress={() => {
                onClose();
                onBlank();
              }}
              style={[styles.templateChoiceRow, !canCreate && styles.templateChoiceRowDisabled]}
            >
              <View style={styles.templateChoiceIcon}>
                <FileText color="#0f172a" size={18} />
              </View>
              <View style={styles.templateChoiceText}>
                <Text style={styles.templateChoiceTitle}>{translate("空白笔记")}</Text>
                <Text style={styles.templateChoiceDescription}>{translate("从空白页开始记录")}</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canCreate}
              onPress={() => {
                onClose();
                onTemplate();
              }}
              style={[styles.templateChoiceRow, !canCreate && styles.templateChoiceRowDisabled]}
            >
              <View style={styles.templateChoiceIcon}>
                <LayoutTemplate color="#0f172a" size={18} />
              </View>
              <View style={styles.templateChoiceText}>
                <Text style={styles.templateChoiceTitle}>{translate("从模板新建")}</Text>
                <Text style={styles.templateChoiceDescription}>{translate("使用会议纪要、周报等预设结构")}</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const TemplateRow = ({
  onPress,
  template,
}: {
  onPress: () => void;
  template: MobileSelectableTemplate;
}) => {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.templateRow}>
      <View style={styles.templateRowIcon}>
        <LayoutTemplate color="#047857" size={16} />
      </View>
      <View style={styles.templateRowText}>
        <View style={styles.templateRowTitleRow}>
          <Text numberOfLines={1} style={styles.templateRowTitle}>{template.name}</Text>
        </View>
        {template.description ? (
          <Text numberOfLines={2} style={styles.templateRowDescription}>{template.description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
};
