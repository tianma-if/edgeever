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
  contentMarkdown: string;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
  instruction?: string;
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
