import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@edgeever/client";
import { useQuery } from "@tanstack/react-query";
import {
  AI_TARGET_LANGUAGES,
  AI_TONES,
  AI_WHOLE_NOTE_ACTIONS,
  buildAiAssistantLastActionPreference,
  getDefaultAiTargetLanguage,
  promptAllowsAppend,
  promptAllowsReplace,
  promptNeedsTargetLanguage,
  promptNeedsTone,
  resolveAiAssistantOpenAction,
  type AiAction,
  type AiAssistantLastActionPreference,
  type AiTargetLanguage,
  type AiTone,
  type MemoDetail,
} from "@edgeever/shared";
import * as Clipboard from "expo-clipboard";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronDown, Copy, RefreshCw, Sparkles, Square, X } from "./icons";
import { Alert, Pressable, Text, TextInput } from "./LocalizedText";
import { useMobileLocale, getMobileCatalog } from "../lib/mobile-locale";
import { useMobileTheme } from "../lib/mobile-theme";
import { readMobileAiAssistantLastAction, writeMobileAiAssistantLastAction } from "../lib/preferences";
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
  const storedPreferenceRef = useRef<AiAssistantLastActionPreference | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [initializedForOpen, setInitializedForOpen] = useState(false);
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

  const labels: Record<AssistantAction, string> = getMobileCatalog(resolvedLocale).aiAssistant.actions;

  const languageLabels: Record<TargetLanguage, string> = getMobileCatalog(resolvedLocale).aiAssistant.targetLanguages;

  const toneLabels: Record<Tone, string> = getMobileCatalog(resolvedLocale).aiAssistant.tones;

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (!visible) {
      controllerRef.current?.abort();
      setPicker(null);
      setSessionReady(false);
      setInitializedForOpen(false);
      return;
    }
    controllerRef.current?.abort();
    setCustomInstruction("");
    setRefineInstruction("");
    setOutput("");
    setError(null);
    setGenerating(false);
    setApplying(false);
    setPicker(null);
    setSessionReady(false);
    setInitializedForOpen(false);
    let cancelled = false;
    void readMobileAiAssistantLastAction("wholeNote").then((preference) => {
      if (cancelled) return;
      storedPreferenceRef.current = preference;
      setSessionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [memo.id, visible]);

  useEffect(() => {
    if (!visible || !sessionReady || initializedForOpen || promptsQuery.isLoading) return;
    const resolved = resolveAiAssistantOpenAction({
      hasSelection: false,
      preference: storedPreferenceRef.current,
      prompts,
    });
    setSelectedPromptId(resolved.selectedPromptId);
    setAction(resolved.action);
    setTargetLanguage(resolved.targetLanguage ?? getDefaultAiTargetLanguage(resolvedLocale));
    setTone(resolved.tone ?? "professional");
    setInitializedForOpen(true);
  }, [initializedForOpen, prompts, promptsQuery.isLoading, resolvedLocale, sessionReady, visible]);

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

  const persistLastAction = (
    nextAction: AssistantAction,
    nextPromptId: string | null,
    nextLanguage = targetLanguage,
    nextTone = tone,
  ) => {
    const prompt = nextPromptId ? prompts.find((item) => item.id === nextPromptId) : null;
    void writeMobileAiAssistantLastAction("wholeNote", buildAiAssistantLastActionPreference({
      action: nextAction,
      promptId: nextPromptId,
      seedKey: prompt?.seedKey ?? null,
      targetLanguage: nextLanguage,
      tone: nextTone,
    }));
  };

  const generate = async (source = memo.contentMarkdown, refinement?: string) => {
    if (!client || (!selectedPrompt && action === "custom" && !customInstruction.trim() && !refinement?.trim())) return;
    if (!refinement?.trim()) persistLastAction(action, selectedPromptId);
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
          ? getMobileCatalog(resolvedLocale).mobile.ai.modelNotConfigured
          : caught instanceof Error ? caught.message : getMobileCatalog(resolvedLocale).mobile.ai.generationFailed
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
      Alert.alert(getMobileCatalog(resolvedLocale).mobile.ai.noteUpdated);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : getMobileCatalog(resolvedLocale).mobile.ai.noteUpdateFailed);
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
      const nextAction = prompt?.action ?? (value as AssistantAction);
      const nextPromptId = prompt?.id ?? null;
      setSelectedPromptId(nextPromptId);
      setAction(nextAction);
      persistLastAction(nextAction, nextPromptId);
      setOutput("");
      setError(null);
    } else if (picker === "language") {
      const nextLanguage = value as TargetLanguage;
      setTargetLanguage(nextLanguage);
      persistLastAction(action, selectedPromptId, nextLanguage);
    } else if (picker === "tone") {
      const nextTone = value as Tone;
      setTone(nextTone);
      persistLastAction(action, selectedPromptId, targetLanguage, nextTone);
    }
    setPicker(null);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: surface }]}>
        <View style={[styles.header, { borderBottomColor: border }]}>
          <View style={styles.titleRow}>
            <Sparkles color="#16A06E" size={20} />
            <Text style={[styles.title, { color: foreground }]}>{getMobileCatalog(resolvedLocale).aiAssistant.title}</Text>
          </View>
          <Pressable accessibilityLabel={getMobileCatalog(resolvedLocale).common.close} accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
            <X color={muted} size={22} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.description, { color: muted }]}>
            {getMobileCatalog(resolvedLocale).mobile.ai.intro}
          </Text>
          {selectField(getMobileCatalog(resolvedLocale).aiAssistant.actionLabel, selectedPrompt?.name ?? labels[action], () => setPicker("action"))}
          {promptNeedsTargetLanguage(parameterKind) ? selectField(getMobileCatalog(resolvedLocale).aiAssistant.targetLanguage, languageLabels[targetLanguage], () => setPicker("language")) : null}
          {promptNeedsTone(parameterKind) ? selectField(getMobileCatalog(resolvedLocale).aiAssistant.tone, toneLabels[tone], () => setPicker("tone")) : null}
          {!selectedPrompt && action === "custom" ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: foreground }]}>{getMobileCatalog(resolvedLocale).aiAssistant.customInstruction}</Text>
              <TextInput
                maxLength={2000}
                multiline
                onChangeText={setCustomInstruction}
                placeholder={getMobileCatalog(resolvedLocale).mobile.ai.instructionPlaceholder}
                placeholderTextColor={muted}
                style={[styles.instructionInput, { borderColor: border, color: foreground, backgroundColor: surface }]}
                value={customInstruction}
              />
            </View>
          ) : null}
          <View style={styles.resultHeader}>
            <Text style={[styles.fieldLabel, { color: foreground }]}>{getMobileCatalog(resolvedLocale).mobile.ai.draft}</Text>
            {generating ? <Text style={styles.streaming}>{getMobileCatalog(resolvedLocale).mobile.ai.generating}</Text> : null}
          </View>
          <View style={[styles.result, { borderColor: border, backgroundColor: mutedSurface }]}>
            <Text selectable style={[styles.resultText, { color: output ? foreground : muted }]}>
              {output || getMobileCatalog(resolvedLocale).mobile.ai.draftPlaceholder}
            </Text>
          </View>
          {output && !generating ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: foreground }]}>{getMobileCatalog(resolvedLocale).mobile.ai.refineResult}</Text>
              <View style={styles.refineRow}>
                <TextInput
                  maxLength={2000}
                  onChangeText={setRefineInstruction}
                  onSubmitEditing={refine}
                  placeholder={getMobileCatalog(resolvedLocale).mobile.ai.refinePlaceholder}
                  placeholderTextColor={muted}
                  returnKeyType="send"
                  style={[styles.refineInput, { borderColor: border, color: foreground, backgroundColor: surface }]}
                  value={refineInstruction}
                />
                <Pressable disabled={!refineInstruction.trim()} onPress={refine} style={[styles.refineButton, !refineInstruction.trim() && styles.disabled]}>
                  <Text style={styles.refineButtonText}>{getMobileCatalog(resolvedLocale).aiAssistant.refineAction}</Text>
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
              <Text style={[styles.secondaryText, { color: foreground }]}>{getMobileCatalog(resolvedLocale).mobile.ai.copy}</Text>
            </Pressable>
            {promptAllowsAppend(resultMode) ? (
              <Pressable disabled={!output || generating || applying} onPress={() => void apply("append")} style={[styles.secondaryButton, { borderColor: border }, (!output || generating || applying) && styles.disabled]}>
                <Text style={[styles.secondaryText, { color: foreground }]}>{getMobileCatalog(resolvedLocale).mobile.ai.append}</Text>
              </Pressable>
            ) : null}
            {promptAllowsReplace(resultMode) ? (
              <Pressable disabled={!output || generating || applying} onPress={() => void apply("replace")} style={[styles.secondaryButton, { borderColor: border }, (!output || generating || applying) && styles.disabled]}>
                <Text style={[styles.secondaryText, { color: foreground }]}>{getMobileCatalog(resolvedLocale).mobile.ai.replace}</Text>
              </Pressable>
            ) : null}
          </View>
          {generating ? (
            <Pressable onPress={() => controllerRef.current?.abort()} style={styles.primaryButton}>
              <Square color="#ffffff" size={14} />
              <Text style={styles.primaryText}>{getMobileCatalog(resolvedLocale).aiAssistant.stop}</Text>
            </Pressable>
          ) : (
            <Pressable disabled={actionDisabled} onPress={() => void generate()} style={[styles.primaryButton, actionDisabled && styles.disabled]}>
              {output ? <RefreshCw color="#ffffff" size={16} /> : null}
              <Text style={styles.primaryText}>{output ? getMobileCatalog(resolvedLocale).mobile.ai.regenerate : getMobileCatalog(resolvedLocale).aiAssistant.generate}</Text>
            </Pressable>
          )}
        </View>
        <Modal animationType="fade" onRequestClose={() => setPicker(null)} transparent visible={picker !== null}>
          <Pressable onPress={() => setPicker(null)} style={styles.pickerBackdrop}>
            <View style={[styles.pickerSheet, { backgroundColor: surface }]}>
              <Text style={[styles.pickerTitle, { color: foreground }]}>
                {picker === "action" ? getMobileCatalog(resolvedLocale).mobile.ai.chooseAction : picker === "language" ? getMobileCatalog(resolvedLocale).mobile.ai.chooseTargetLanguage : getMobileCatalog(resolvedLocale).mobile.ai.chooseTone}
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
