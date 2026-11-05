import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiRequestError } from "@edgeever/client";
import type { AiTargetLanguage } from "@edgeever/shared";
import {
  aiDraftIncompleteReason,
  failAiDraftCompletion,
  startAiDraftCompletion,
  stopAiDraftCompletion,
  trackAiDraftEvent,
  type AiDraftCompletion,
  type AiDraftIncompleteReason,
} from "@edgeever/shared/ai-generation";
import { api } from "@/lib/api";
import type { AiBodyCommand } from "@/lib/ai-body-commands";
import {
  clearAiBodyDraft,
  hashAiDraftSource,
  loadAiBodyDraft,
  saveAiBodyDraft,
  type AiBodyDraftRecord,
  type AiBodyDraftTarget,
  type AiDraftEditorApi,
  type AiDraftSelectionSnapshot,
  trackAiBodyDraftRun,
} from "@/lib/ai-body-draft-store";

/** A body draft in the sidebar (#652 PR B). */
export type AiBodyDraft = Omit<AiBodyDraftRecord, "scope"> & {
  generating: boolean;
  progress: { part: number; parts: number } | null;
  error: string | null;
  /** Restored from this device after a reload, not generated in this session. */
  recovered: boolean;
  /** A translation without a target language waits for the user to choose one. */
  awaitingLanguage?: boolean;
};

export type AiBodyDraftTargetRequest =
  | { kind: "note" }
  | { kind: "selection"; snapshot: AiDraftSelectionSnapshot };

/** Why applying needs the user first; `null` when it can go ahead. */
export type AiBodyDraftConfirm =
  | { kind: "note-changed" }
  | { kind: "selection-changed"; current: AiDraftSelectionSnapshot | null };

export type AiBodyDraftApplyResult = "applied" | "failed" | AiBodyDraftConfirm;

const replaceBlocked = (incomplete: AiDraftIncompleteReason | null, generating: boolean) => generating || incomplete !== null;

export const useAiBodyDraft = (options: {
  scope: string | undefined;
  memoId: string | undefined;
  noteTitle: string | undefined;
  editor: AiDraftEditorApi | null | undefined;
}) => {
  const { scope, memoId, noteTitle, editor } = options;
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<AiBodyDraft | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const completionRef = useRef<AiDraftCompletion>(startAiDraftCompletion());
  const stoppedByUser = useRef(false);
  const draftRef = useRef<AiBodyDraft | null>(null);
  draftRef.current = draft;

  // Show the last unapplied draft of this note on this device; a run in progress ends with the page.
  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setDraft(null);
    if (!scope || !memoId) return;
    let cancelled = false;
    void loadAiBodyDraft(scope, memoId).then((record) => {
      if (cancelled || !record || draftRef.current) return;
      const { scope: _scope, ...rest } = record;
      setDraft({ ...rest, message: rest.message || rest.source.slice(0, 80), generating: false, progress: null, error: null, recovered: true });
    });
    return () => {
      cancelled = true;
    };
  }, [memoId, scope]);

  useEffect(() => () => {
    // Leaving (or signing out) ends the run without saving it.
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
  }, []);

  const explain = useCallback((cause: unknown) => {
    if (cause instanceof ApiRequestError && cause.code === "ai_input_too_long") return t("aiAssistant.sidebar.draft.inputTooLong");
    if (cause instanceof ApiRequestError && cause.code === "ai_not_configured") return t("aiAssistant.configure");
    return cause instanceof Error && cause.message ? cause.message : t("aiAssistant.sidebar.draft.failed");
  }, [t]);

  const persist = useCallback(async (next: AiBodyDraft) => {
    if (!scope || !next.text.trim()) return;
    const { generating: _generating, progress: _progress, error: _error, recovered: _recovered, ...record } = next;
    await saveAiBodyDraft({ ...record, scope });
  }, [scope]);

  const start = useCallback(async (command: AiBodyCommand, target: AiBodyDraftTargetRequest, message: string, sourceOverride?: string) => {
    if (!memoId || !editor) return;
    controllerRef.current?.abort();
    const source = sourceOverride ?? (target.kind === "note" ? editor.noteMarkdown() : target.snapshot.text);
    if (!source.trim()) return;
    const recordTarget: AiBodyDraftTarget = target.kind === "note"
      ? { kind: "note", sourceHash: hashAiDraftSource(source) }
      : { kind: "selection", ...target.snapshot };
    if (command.action === "translate" && !command.targetLanguage) {
      // Ask which language first; choosing one starts the translation of the same source.
      controllerRef.current = null;
      setDraft({
        memoId, action: command.action, message, source, text: "", incomplete: null, incompleteParts: [],
        ...(command.instruction ? { instruction: command.instruction } : {}),
        target: recordTarget, createdAt: new Date().toISOString(),
        generating: false, progress: null, error: null, recovered: false, awaitingLanguage: true,
      });
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    stoppedByUser.current = false;
    const untrack = trackAiBodyDraftRun(controller);
    completionRef.current = startAiDraftCompletion();
    const initial: AiBodyDraft = {
      memoId,
      action: command.action,
      message,
      ...(command.targetLanguage ? { targetLanguage: command.targetLanguage } : {}),
      ...(command.instruction ? { instruction: command.instruction } : {}),
      source,
      text: "",
      incomplete: "interrupted",
      incompleteParts: [],
      target: recordTarget,
      createdAt: new Date().toISOString(),
      generating: true,
      progress: null,
      error: null,
      recovered: false,
    };
    setDraft(initial);
    const current = () => controllerRef.current === controller;
    let text = "";
    let error: string | null = null;
    try {
      await api.streamAiGeneration({
        action: command.action,
        locale: i18n.language,
        title: (noteTitle ?? "").trim().slice(0, 160),
        contentMarkdown: source,
        ...(command.targetLanguage ? { targetLanguage: command.targetLanguage } : {}),
        ...(command.instruction ? { instruction: command.instruction } : {}),
      }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (!current()) return;
          completionRef.current = trackAiDraftEvent(completionRef.current, event);
          if (event.type === "text-delta") text += event.text;
          else if (event.type === "text-reset") text = event.text;
          else if (event.type === "error" && event.code !== "ai_stream_interrupted") error = event.message;
          setDraft((previous) => previous && current() ? {
            ...previous,
            text,
            error,
            progress: event.type === "progress" ? { part: event.part, parts: event.parts } : previous.progress,
          } : previous);
        },
      });
      if (controller.signal.aborted) completionRef.current = stopAiDraftCompletion(completionRef.current);
    } catch (cause) {
      if (!current()) return;
      if (controller.signal.aborted) {
        completionRef.current = stopAiDraftCompletion(completionRef.current);
      } else {
        // Text that arrived before a dropped connection stays as an incomplete draft.
        completionRef.current = failAiDraftCompletion(completionRef.current);
        error = explain(cause);
      }
    }
    untrack();
    if (!current()) return;
    controllerRef.current = null;
    const finished: AiBodyDraft = {
      ...initial,
      text,
      error,
      generating: false,
      progress: null,
      incomplete: aiDraftIncompleteReason(completionRef.current),
      incompleteParts: [...completionRef.current.incompleteParts],
    };
    setDraft(finished);
    // A run cancelled by signing out is not saved.
    if (controller.signal.aborted && !stoppedByUser.current) return;
    // Only a draft with text is kept, complete or not; it is cleared once applied or discarded.
    if (text.trim()) await persist(finished);
    else if (scope) await clearAiBodyDraft(scope, memoId);
  }, [editor, explain, i18n.language, memoId, noteTitle, persist, scope]);

  const stop = useCallback(() => {
    stoppedByUser.current = true;
    controllerRef.current?.abort();
  }, []);

  const discard = useCallback(async () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setDraft(null);
    if (scope && memoId) await clearAiBodyDraft(scope, memoId);
  }, [memoId, scope]);

  const regenerate = useCallback((targetLanguage?: AiTargetLanguage, instruction?: string) => {
    const previous = draftRef.current;
    if (!previous) return;
    const target: AiBodyDraftTargetRequest = previous.target.kind === "note"
      ? { kind: "note" }
      : { kind: "selection", snapshot: { ...previous.target } };
    void start({
      action: previous.action,
      ...(targetLanguage ?? previous.targetLanguage ? { targetLanguage: targetLanguage ?? previous.targetLanguage } : {}),
      ...(instruction ?? previous.instruction ? { instruction: instruction ?? previous.instruction } : {}),
    }, target, previous.message, previous.target.kind === "selection" ? previous.source : undefined);
  }, [start]);

  const applied = useCallback(async () => {
    setDraft(null);
    if (scope && memoId) await clearAiBodyDraft(scope, memoId);
  }, [memoId, scope]);

  /**
   * Insert keeps the note and adds the draft after the selection (or at the end of the note).
   * Replace needs a finished, complete draft and a target that did not change, or the user's
   * confirmation of a new one.
   */
  const apply = useCallback(async (
    mode: "insert" | "replace",
    confirmed?: { noteChanged?: boolean; selection?: AiDraftSelectionSnapshot },
  ): Promise<AiBodyDraftApplyResult> => {
    const current = draftRef.current;
    if (!current || !editor || !current.text.trim() || current.generating) return "failed";
    const body = current.text.trim();
    const target = current.target;
    if (mode === "insert") {
      const ok = target.kind === "selection"
        ? editor.insertAfterSelection(target, body) || editor.appendToNote(body)
        : editor.appendToNote(body);
      if (ok) await applied();
      return ok ? "applied" : "failed";
    }
    if (replaceBlocked(current.incomplete, current.generating)) return "failed";
    if (target.kind === "note") {
      if (!confirmed?.noteChanged && hashAiDraftSource(editor.noteMarkdown()) !== target.sourceHash) return { kind: "note-changed" };
      const ok = editor.replaceNote(body);
      if (ok) await applied();
      return ok ? "applied" : "failed";
    }
    if (confirmed?.selection) {
      const ok = editor.replaceSelection(confirmed.selection, body);
      if (ok) await applied();
      return ok ? "applied" : "failed";
    }
    if (editor.replaceSelection(target, body)) {
      await applied();
      return "applied";
    }
    return { kind: "selection-changed", current: editor.currentSelection() };
  }, [applied, editor]);

  return { draft, start, stop, discard, regenerate, apply };
};
