import {
  AiGenerateSchema,
  type AiAction,
  type AiStreamEvent,
  type AiTargetLanguage,
  type AiTone,
} from "@edgeever/shared";

export type MobileSelectionAiRequest = {
  requestId: string;
  action: AiAction;
  promptId?: string;
  locale?: string;
  contentMarkdown: string;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
  instruction?: string;
};

export type MobileAiSourceRange = {
  from: number;
  to: number;
  wholeNote: boolean;
};

export type MobileAiSelectionTriggerPosition = {
  left: number;
  top: number;
};

type MobileAiRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export const resolveMobileAiSelectionTriggerPosition = ({
  selectionEnd,
  selectionStart,
  shell,
  visibleBounds,
  triggerHeight = 38,
  triggerWidth = 74,
}: {
  selectionEnd: MobileAiRect;
  selectionStart: MobileAiRect;
  shell: MobileAiRect;
  visibleBounds: Pick<MobileAiRect, "bottom" | "top">;
  triggerHeight?: number;
  triggerWidth?: number;
}): MobileAiSelectionTriggerPosition => {
  const edgePadding = 12;
  const selectionGap = 12;
  const shellWidth = Math.max(0, shell.right - shell.left);
  const maxLeft = Math.max(edgePadding, shellWidth - triggerWidth - edgePadding);
  const left = Math.min(
    Math.max(selectionEnd.left - shell.left - triggerWidth / 2, edgePadding),
    maxLeft,
  );
  const visibleTop = Math.max(shell.top, visibleBounds.top);
  const visibleBottom = Math.min(shell.bottom, visibleBounds.bottom);
  const below = selectionEnd.bottom + selectionGap;
  const above = selectionStart.top - selectionGap - triggerHeight;
  const absoluteTop = below + triggerHeight <= visibleBottom
    ? below
    : above >= visibleTop
      ? above
      : Math.min(
          Math.max(below, visibleTop + edgePadding),
          Math.max(visibleTop + edgePadding, visibleBottom - triggerHeight - edgePadding),
        );

  return {
    left: Math.round(left),
    top: Math.round(absoluteTop - shell.top),
  };
};

export const getMobileAiSourceRange = (
  selection: { from: number; to: number; empty: boolean },
  documentSize: number,
): MobileAiSourceRange | null => {
  if (!Number.isInteger(documentSize) || documentSize <= 0) return null;
  if (selection.empty || selection.from >= selection.to) {
    return { from: 0, to: documentSize, wholeNote: true };
  }
  const from = Math.max(0, Math.min(selection.from, documentSize));
  const to = Math.max(from, Math.min(selection.to, documentSize));
  if (from >= to) return null;
  return { from, to, wholeNote: from === 0 && to === documentSize };
};

export const parseMobileSelectionAiRequest = (requestJson: string): MobileSelectionAiRequest | null => {
  try {
    const raw = JSON.parse(requestJson) as Record<string, unknown>;
    if (typeof raw.requestId !== "string" || !raw.requestId.trim() || raw.requestId.length > 160) return null;
    const parsed = AiGenerateSchema.safeParse({ ...raw, title: "" });
    if (!parsed.success) return null;
    return {
      requestId: raw.requestId,
      action: parsed.data.action,
      promptId: parsed.data.promptId,
      locale: parsed.data.locale,
      contentMarkdown: parsed.data.contentMarkdown,
      targetLanguage: parsed.data.targetLanguage,
      tone: parsed.data.tone,
      instruction: parsed.data.instruction,
    };
  } catch {
    return null;
  }
};

export const buildMobileAiStreamBridgePayload = (requestId: string, event: AiStreamEvent) =>
  JSON.stringify({ requestId, event });
