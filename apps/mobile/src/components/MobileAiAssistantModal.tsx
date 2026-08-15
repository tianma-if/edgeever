import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@edgeever/client";
import { useQuery } from "@tanstack/react-query";
import {
  AI_TARGET_LANGUAGES,
  AI_TONES,
  AI_WHOLE_NOTE_ACTIONS,
  getDefaultAiTargetLanguage,
  promptAllowsAppend,
  promptAllowsReplace,
  promptNeedsTargetLanguage,
  promptNeedsTone,
  type AiAction,
  type AiTargetLanguage,
  type AiTone,
  type MemoDetail,
} from "@edgeever/shared";
import * as Clipboard from "expo-clipboard";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronDown, Copy, RefreshCw, Sparkles, Square, X } from "./icons";
import { Alert, Pressable, Text, TextInput } from "./LocalizedText";
import { useMobileLocale } from "../lib/mobile-locale";
import { useMobileTheme } from "../lib/mobile-theme";
import { useSession } from "../lib/session";

type AssistantAction = AiAction;
type Tone = AiTone;
type TargetLanguage = AiTargetLanguage;

const actions = AI_WHOLE_NOTE_ACTIONS;
const tones = AI_TONES;
const targetLanguages = AI_TARGET_LANGUAGES;
const PROMPT_PREFIX = "prompt:";

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
  const tr = (zh: string, en: string) => resolvedLocale === "en-US" ? en : zh;
  const [action, setAction] = useState<AssistantAction>("summarize");
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>(() => getDefaultAiTargetLanguage(resolvedLocale));
  const [tone, setTone] = useState<Tone>("professional");
  const [customInstruction, setCustomInstruction] = useState("");
  const [refineInstruction, setRefineInstruction] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [picker, setPicker] = useState<"action" | "language" | "tone" | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const promptsQuery = useQuery({
    queryKey: ["ai-prompts", resolvedLocale],
    queryFn: async () => (await client!.listAiPrompts(resolvedLocale)).prompts,
    enabled: visible && Boolean(client),
    retry: false,
  });
  const prompts = promptsQuery.data ?? [];
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) ?? null;
  const parameterKind = selectedPrompt?.parameterKind
    ?? (action === "translate" ? "target-language" : action === "change-tone" ? "tone" : "none");
  const resultMode = selectedPrompt?.resultMode
    ?? (["summarize", "extract-key-points", "extract-todos", "continue-writing"].includes(action) ? "append" : "both");

  const labels: Record<AssistantAction, string> = {
    summarize: tr("总结", "Summarize"),
    "extract-key-points": tr("提炼要点", "Key points"),
    "extract-todos": tr("提取待办", "Extract tasks"),
    "rewrite-proofread": tr("转为小红书风格", "Convert to Xiaohongshu style"),
    "improve-writing": tr("改进写作", "Improve writing"),
    "fix-spelling-grammar": tr("修正拼写与语法", "Fix spelling & grammar"),
    "make-shorter": tr("精炼表达", "Make concise"),
    "make-longer": tr("扩写内容", "Make longer"),
    "simplify-language": tr("转为推特风格", "Convert to X (Twitter) style"),
    "change-tone": tr("调整语气", "Change tone"),
    translate: tr("翻译", "Translate"),
    "continue-writing": tr("继续写作", "Continue writing"),
    custom: tr("自定义指令", "Custom prompt"),
  };

  const languageLabels: Record<TargetLanguage, string> = {
    en: tr("英语", "English"),
    "zh-CN": tr("简体中文", "Simplified Chinese"),
    "zh-TW": tr("繁体中文", "Traditional Chinese"),
    ja: tr("日语", "Japanese"),
    ko: tr("韩语", "Korean"),
    es: tr("西班牙语", "Spanish"),
    fr: tr("法语", "French"),
    de: tr("德语", "German"),
    pt: tr("葡萄牙语", "Portuguese"),
  };

  const toneLabels: Record<Tone, string> = {
    professional: tr("专业", "Professional"),
    friendly: tr("友好", "Friendly"),
    casual: tr("轻松", "Casual"),
    direct: tr("直接", "Direct"),
  };

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (visible) {
      controllerRef.current?.abort();
      setAction("summarize");
      setSelectedPromptId(null);
      setTargetLanguage(getDefaultAiTargetLanguage(resolvedLocale));
      setTone("professional");
      setCustomInstruction("");
      setRefineInstruction("");
      setOutput("");
      setError(null);
      setGenerating(false);
      setApplying(false);
      setPicker(null);
    } else {
      controllerRef.current?.abort();
      setPicker(null);
    }
  }, [memo.id, resolvedLocale, visible]);
  useEffect(() => {
    setTargetLanguage(getDefaultAiTargetLanguage(resolvedLocale));
  }, [resolvedLocale]);

  useEffect(() => {
    if (!visible || selectedPromptId || prompts.length === 0) return;
    const preferred = prompts.find((prompt) => prompt.seedKey === "summarize") ?? prompts[0];
    setSelectedPromptId(preferred.id);
    setAction(preferred.action);
  }, [prompts, selectedPromptId, visible]);

  const buildRequest = (source: string, refinement?: string) => {
    const base = {
      title: memo.title?.trim() ?? "",
      contentMarkdown: source,
    };
    if (refinement?.trim()) return { ...base, action: "custom" as const, instruction: refinement.trim() };
    return {
      ...base,
      action: selectedPrompt?.action ?? action,
      locale: resolvedLocale,
      ...(selectedPrompt ? { promptId: selectedPrompt.id } : {}),
      ...(promptNeedsTargetLanguage(parameterKind) ? { targetLanguage } : {}),
      ...(promptNeedsTone(parameterKind) ? { tone } : {}),
      ...(!selectedPrompt && action === "custom" ? { instruction: customInstruction.trim() } : {}),
    };
  };

  const generate = async (source = memo.contentMarkdown, refinement?: string) => {
    if (!client || (!selectedPrompt && action === "custom" && !customInstruction.trim() && !refinement?.trim())) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setOutput("");
    setError(null);
    setGenerating(true);
    try {
      await client.streamAiGeneration(buildRequest(source, refinement), {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "text-delta") setOutput((current) => current + event.text);
          if (event.type === "error") setError(event.message);
        },
      });
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

  const refine = () => {
    const instruction = refineInstruction.trim();
    if (!output || !instruction) return;
    const currentOutput = output;
    setRefineInstruction("");
    void generate(currentOutput, instruction);
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
  const actionDisabled = applying || (!selectedPrompt && action === "custom" && !customInstruction.trim());

  const selectField = (label: string, value: string, onPress: () => void) => (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: foreground }]}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={onPress} style={[styles.select, { borderColor: border, backgroundColor: surface }]}>
        <Text style={[styles.selectText, { color: foreground }]}>{value}</Text>
        <ChevronDown color={muted} size={18} />
      </Pressable>
    </View>
  );

  const pickerOptions = picker === "action"
    ? (prompts.length
      ? [
        ...prompts.map((prompt) => ({
          value: `${PROMPT_PREFIX}${prompt.id}`,
          label: prompt.name,
          active: selectedPromptId === prompt.id,
        })),
        { value: "custom", label: labels.custom, active: !selectedPromptId && action === "custom" },
      ]
      : actions.map((value) => ({ value, label: labels[value], active: !selectedPromptId && action === value })))
    : picker === "language"
      ? targetLanguages.map((value) => ({ value, label: languageLabels[value], active: targetLanguage === value }))
      : tones.map((value) => ({ value, label: toneLabels[value], active: tone === value }));

  const choosePickerOption = (value: string) => {
    if (picker === "action") {
      controllerRef.current?.abort();
      const promptId = value.startsWith(PROMPT_PREFIX) ? value.slice(PROMPT_PREFIX.length) : null;
      const prompt = promptId ? prompts.find((item) => item.id === promptId) : null;
      setSelectedPromptId(prompt?.id ?? null);
      setAction(prompt?.action ?? (value as AssistantAction));
      setOutput("");
      setError(null);
    } else if (picker === "language") {
      setTargetLanguage(value as TargetLanguage);
    } else if (picker === "tone") {
      setTone(value as Tone);
    }
    setPicker(null);
  };

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
            {tr("选择 AI 要做的事。输出只会作为草稿，确认后才会修改笔记。", "Choose what AI should do. Output remains a draft until you apply it.")}
          </Text>
          {selectField(tr("处理方式", "Action"), selectedPrompt?.name ?? labels[action], () => setPicker("action"))}
          {promptNeedsTargetLanguage(parameterKind) ? selectField(tr("目标语言", "Target language"), languageLabels[targetLanguage], () => setPicker("language")) : null}
          {promptNeedsTone(parameterKind) ? selectField(tr("语气", "Tone"), toneLabels[tone], () => setPicker("tone")) : null}
          {!selectedPrompt && action === "custom" ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: foreground }]}>{tr("告诉 AI 你想怎么处理", "Tell AI what to do")}</Text>
              <TextInput
                maxLength={2000}
                multiline
                onChangeText={setCustomInstruction}
                placeholder={tr("例如：改成适合周报的结构，保留所有数据", "For example: Restructure this for a weekly report and keep all data")}
                placeholderTextColor={muted}
                style={[styles.instructionInput, { borderColor: border, color: foreground, backgroundColor: surface }]}
                value={customInstruction}
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
          {output && !generating ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: foreground }]}>{tr("继续调整", "Refine result")}</Text>
              <View style={styles.refineRow}>
                <TextInput
                  maxLength={2000}
                  onChangeText={setRefineInstruction}
                  onSubmitEditing={refine}
                  placeholder={tr("例如：再简洁一点", "For example: Make it more concise")}
                  placeholderTextColor={muted}
                  returnKeyType="send"
                  style={[styles.refineInput, { borderColor: border, color: foreground, backgroundColor: surface }]}
                  value={refineInstruction}
                />
                <Pressable disabled={!refineInstruction.trim()} onPress={refine} style={[styles.refineButton, !refineInstruction.trim() && styles.disabled]}>
                  <Text style={styles.refineButtonText}>{tr("调整", "Refine")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={[styles.footer, { borderTopColor: border, backgroundColor: surface }]}>
          <View style={styles.footerRow}>
            <Pressable disabled={!output || generating} onPress={() => void Clipboard.setStringAsync(output)} style={[styles.secondaryButton, { borderColor: border }, (!output || generating) && styles.disabled]}>
              <Copy color={foreground} size={16} />
              <Text style={[styles.secondaryText, { color: foreground }]}>{tr("复制", "Copy")}</Text>
            </Pressable>
            {promptAllowsAppend(resultMode) ? (
              <Pressable disabled={!output || generating || applying} onPress={() => void apply("append")} style={[styles.secondaryButton, { borderColor: border }, (!output || generating || applying) && styles.disabled]}>
                <Text style={[styles.secondaryText, { color: foreground }]}>{tr("追加", "Append")}</Text>
              </Pressable>
            ) : null}
            {promptAllowsReplace(resultMode) ? (
              <Pressable disabled={!output || generating || applying} onPress={() => void apply("replace")} style={[styles.secondaryButton, { borderColor: border }, (!output || generating || applying) && styles.disabled]}>
                <Text style={[styles.secondaryText, { color: foreground }]}>{tr("替换", "Replace")}</Text>
              </Pressable>
            ) : null}
          </View>
          {generating ? (
            <Pressable onPress={() => controllerRef.current?.abort()} style={styles.primaryButton}>
              <Square color="#ffffff" size={14} />
              <Text style={styles.primaryText}>{tr("停止", "Stop")}</Text>
            </Pressable>
          ) : (
            <Pressable disabled={actionDisabled} onPress={() => void generate()} style={[styles.primaryButton, actionDisabled && styles.disabled]}>
              {output ? <RefreshCw color="#ffffff" size={16} /> : null}
              <Text style={styles.primaryText}>{output ? tr("重新生成", "Regenerate") : tr("生成", "Generate")}</Text>
            </Pressable>
          )}
        </View>
        <Modal animationType="fade" onRequestClose={() => setPicker(null)} transparent visible={picker !== null}>
          <Pressable onPress={() => setPicker(null)} style={styles.pickerBackdrop}>
            <View style={[styles.pickerSheet, { backgroundColor: surface }]}>
              <Text style={[styles.pickerTitle, { color: foreground }]}>
                {picker === "action" ? tr("选择处理方式", "Choose an action") : picker === "language" ? tr("选择目标语言", "Choose target language") : tr("选择语气", "Choose tone")}
              </Text>
              <ScrollView style={styles.pickerScroll}>
                {pickerOptions.map((option) => (
                  <Pressable key={option.value} onPress={() => choosePickerOption(option.value)} style={[styles.pickerOption, { borderBottomColor: border }]}>
                    <Text style={[styles.pickerOptionText, { color: option.active ? "#16A06E" : foreground }]}>{option.label}</Text>
                    {option.active ? <Check color="#16A06E" size={18} /> : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
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
  field: { gap: 7 },
  fieldLabel: { fontSize: 13, fontWeight: "700" },
  select: { minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectText: { fontSize: 15, fontWeight: "600" },
  instructionInput: { minHeight: 88, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlignVertical: "top" },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  streaming: { color: "#087a51", fontSize: 12, fontWeight: "600" },
  result: { minHeight: 220, borderWidth: 1, borderRadius: 10, padding: 14 },
  resultText: { fontSize: 15, lineHeight: 23 },
  refineRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  refineInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontSize: 14 },
  refineButton: { height: 44, paddingHorizontal: 14, borderRadius: 9, backgroundColor: "#16A06E", alignItems: "center", justifyContent: "center" },
  refineButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  error: { color: "#be123c", fontSize: 13, lineHeight: 19 },
  footer: { padding: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  footerRow: { flexDirection: "row", gap: 8 },
  secondaryButton: { minHeight: 40, flex: 1, flexDirection: "row", gap: 6, borderWidth: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 13, fontWeight: "600" },
  primaryButton: { height: 44, borderRadius: 9, backgroundColor: "#16A06E", flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  pickerBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.38)" },
  pickerSheet: { maxHeight: "72%", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24 },
  pickerTitle: { fontSize: 17, fontWeight: "700", paddingBottom: 12 },
  pickerScroll: { flexGrow: 0 },
  pickerOption: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  pickerOptionText: { fontSize: 15, fontWeight: "600" },
});
