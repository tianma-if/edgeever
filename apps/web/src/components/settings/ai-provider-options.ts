import type { AiProvider } from "@edgeever/shared";
import { ApiRequestError } from "@/lib/api";

export const providerDefaults: Record<AiProvider, { displayName: string; baseUrl: string; modelId: string }> = {
  "openai-compatible": { displayName: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1-mini" },
  anthropic: { displayName: "Anthropic", baseUrl: "https://api.anthropic.com/v1", modelId: "claude-sonnet-4-5" },
  google: { displayName: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelId: "gemini-2.5-flash" },
};

const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

export const formatProviderOrdinal = (position: number, locale: string) => {
  if (!locale.toLowerCase().startsWith("zh") || position <= 0 || position >= 100) return String(position);
  if (position < 10) return chineseDigits[position];
  const tens = Math.floor(position / 10);
  const ones = position % 10;
  return `${tens === 1 ? "" : chineseDigits[tens]}十${ones ? chineseDigits[ones] : ""}`;
};

export const isLegacyProviderDisplayName = (displayName: string, provider: AiProvider) =>
  displayName.trim().toLocaleLowerCase() === providerDefaults[provider].displayName.toLocaleLowerCase();

export const aiErrorMessage = (error: unknown, fallback: string, encryptionMessage: string) => {
  if (error instanceof ApiRequestError && error.code === "ai_encryption_key_missing") return encryptionMessage;
  return error instanceof Error ? error.message : fallback;
};
