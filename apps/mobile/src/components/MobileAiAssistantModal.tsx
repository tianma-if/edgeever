import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@edgeever/client";
import type { AiAction, MemoDetail } from "@edgeever/shared";
import * as Clipboard from "expo-clipboard";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Copy, Sparkles, Square, X } from "./icons";
import { Alert, Text } from "./LocalizedText";
import { useMobileLocale } from "../lib/mobile-locale";
import { useMobileTheme } from "../lib/mobile-theme";
import { useSession } from "../lib/session";

const actions: AiAction[] = [
  "summarize",
  "extract-key-points",
  "extract-todos",
  "rewrite-proofread",
  "translate",
];

export const MobileAiAssistantModal = ({
  memo,
  onApply,
  onClose,
  visible,
}: {
  memo: MemoDetail;
  onApply: (draft: string, mode: "append" | "replace") => Promise<void>;
  onClose: () => void;
  visible: boolean;
}) => {
  const { client } = useSession();
  const { resolvedLocale } = useMobileLocale();
  const { resolvedTheme } = useMobileTheme();
  const dark = resolvedTheme === "dark";
  const [action, setAction] = useState<AiAction>("summarize");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const tr = (zh: string, en: string) => resolvedLocale === "en-US" ? en : zh;

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (!visible) controllerRef.current?.abort();
  }, [visible]);

  const labels: Record<AiAction, string> = {
    summarize: tr("总结", "Summarize"),
    "extract-key-points": tr("提炼要点", "Key points"),
    "extract-todos": tr("提取待办", "Extract tasks"),
    "rewrite-proofread": tr("改写与校对", "Rewrite & proofread"),
    translate: tr("翻译", "Translate"),
  };

  const generate = async () => {
    if (!client || (action === "translate" && !targetLanguage.trim())) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setOutput("");
    setError(null);
    setGenerating(true);
    try {
      await client.streamAiGeneration(
        {
          action,
          title: memo.title?.trim() ?? "",
          contentMarkdown: memo.contentMarkdown,
          ...(action === "translate" ? { targetLanguage: targetLanguage.trim() } : {}),
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "text-delta") setOutput((current) => current + event.text);
            if (event.type === "error") setError(event.message);
          },
        }
      );
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof ApiRequestError && caught.code === "ai_not_configured"
          ? tr("请先在 Web 或桌面端的“AI 集成”中配置模型。", "Configure a model in AI Integrations on the web or desktop app first.")
          : caught instanceof Error ? caught.message : tr("AI 生成失败。", "AI generation failed.")
      );
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setGenerating(false);
      }
    }
  };

  const apply = async (mode: "append" | "replace") => {
    if (!output || applying) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(output, mode);
      Alert.alert(tr("已更新笔记", "Note updated"));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tr("更新笔记失败。", "Could not update the note."));
    } finally {
      setApplying(false);
    }
  };

  const surface = dark ? "#111c18" : "#ffffff";
  const mutedSurface = dark ? "#17251f" : "#f8fafc";
  const border = dark ? "#33453d" : "#dbe4df";
  const foreground = dark ? "#e2e8f0" : "#0f172a";
  const muted = dark ? "#94a3b8" : "#64748b";

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: surface }]}>
        <View style={[styles.header, { borderBottomColor: border }]}>
          <View style={styles.titleRow}>
            <Sparkles color="#16A06E" size={20} />
            <Text style={[styles.title, { color: foreground }]}>{tr("AI 笔记助手", "AI note assistant")}</Text>
          </View>
          <Pressable accessibilityLabel={tr("关闭", "Close")} accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
            <X color={muted} size={22} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.description, { color: muted }]}>
            {tr("AI 输出会先作为草稿展示，确认后才会修改笔记。", "AI output remains a draft until you choose to apply it.")}
          </Text>
          <View style={styles.actions}>
            {actions.map((item) => (
              <Pressable
                key={item}
                onPress={() => setAction(item)}
                style={[
                  styles.actionChip,
                  { borderColor: action === item ? "#16A06E" : border, backgroundColor: action === item ? (dark ? "#073f2f" : "#e8f7f0") : surface },
                ]}
              >
                <Text style={[styles.actionText, { color: action === item ? (dark ? "#5ee2ad" : "#087a51") : foreground }]}>{labels[item]}</Text>
              </Pressable>
            ))}
          </View>
          {action === "translate" ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: foreground }]}>{tr("目标语言", "Target language")}</Text>
              <TextInput
                maxLength={80}
                onChangeText={setTargetLanguage}
                placeholder={tr("例如：英语、日语", "For example: English, Japanese")}
                placeholderTextColor={muted}
                style={[styles.input, { borderColor: border, color: foreground, backgroundColor: surface }]}
                value={targetLanguage}
              />
            </View>
          ) : null}
          <View style={styles.resultHeader}>
            <Text style={[styles.fieldLabel, { color: foreground }]}>{tr("AI 草稿", "AI draft")}</Text>
            {generating ? <Text style={styles.streaming}>{tr("生成中…", "Generating…")}</Text> : null}
          </View>
          <View style={[styles.result, { borderColor: border, backgroundColor: mutedSurface }]}>
            <Text selectable style={[styles.resultText, { color: output ? foreground : muted }]}>
              {output || tr("生成的草稿会显示在这里。", "The generated draft will appear here.")}
            </Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={[styles.footer, { borderTopColor: border, backgroundColor: surface }]}>
          <View style={styles.footerRow}>
            <Pressable disabled={!output || generating} onPress={() => void Clipboard.setStringAsync(output)} style={[styles.secondaryButton, { borderColor: border }, (!output || generating) && styles.disabled]}>
              <Copy color={foreground} size={16} />
              <Text style={[styles.secondaryText, { color: foreground }]}>{tr("复制", "Copy")}</Text>
            </Pressable>
            <Pressable disabled={!output || generating || applying} onPress={() => void apply("append")} style={[styles.secondaryButton, { borderColor: border }, (!output || generating || applying) && styles.disabled]}>
              <Text style={[styles.secondaryText, { color: foreground }]}>{tr("追加", "Append")}</Text>
            </Pressable>
            <Pressable disabled={!output || generating || applying} onPress={() => void apply("replace")} style={[styles.secondaryButton, { borderColor: border }, (!output || generating || applying) && styles.disabled]}>
              <Text style={[styles.secondaryText, { color: foreground }]}>{tr("替换", "Replace")}</Text>
            </Pressable>
          </View>
          {generating ? (
            <Pressable onPress={() => controllerRef.current?.abort()} style={styles.primaryButton}>
              <Square color="#ffffff" size={14} />
              <Text style={styles.primaryText}>{tr("停止", "Stop")}</Text>
            </Pressable>
          ) : (
            <Pressable disabled={applying || (action === "translate" && !targetLanguage.trim())} onPress={() => void generate()} style={[styles.primaryButton, (applying || (action === "translate" && !targetLanguage.trim())) && styles.disabled]}>
              <Text style={styles.primaryText}>{tr("生成", "Generate")}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { minHeight: 54, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 17, fontWeight: "700" },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 16 },
  description: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionChip: { minHeight: 38, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 13, fontWeight: "600" },
  field: { gap: 7 },
  fieldLabel: { fontSize: 13, fontWeight: "700" },
  input: { height: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontSize: 15 },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  streaming: { color: "#087a51", fontSize: 12, fontWeight: "600" },
  result: { minHeight: 220, borderWidth: 1, borderRadius: 10, padding: 14 },
  resultText: { fontSize: 15, lineHeight: 23 },
  error: { color: "#be123c", fontSize: 13, lineHeight: 19 },
  footer: { padding: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  footerRow: { flexDirection: "row", gap: 8 },
  secondaryButton: { minHeight: 40, flex: 1, flexDirection: "row", gap: 6, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 13, fontWeight: "600" },
  primaryButton: { height: 44, borderRadius: 9, backgroundColor: "#16A06E", flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.45 },
});
