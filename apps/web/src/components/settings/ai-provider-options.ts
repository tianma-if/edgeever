import type { AiProvider } from "@edgeever/shared";
import { ApiRequestError } from "@/lib/api";

export const providerDefaults: Record<AiProvider, { displayName: string; baseUrl: string; modelId: string }> = {
  "openai-compatible": { displayName: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1-mini" },
  anthropic: { displayName: "Anthropic", baseUrl: "https://api.anthropic.com/v1", modelId: "claude-sonnet-4-5" },
  google: { displayName: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelId: "gemini-2.5-flash" },
};

export const aiErrorMessage = (error: unknown, fallback: string, encryptionMessage: string) => {
  if (error instanceof ApiRequestError && error.code === "ai_encryption_key_missing") return encryptionMessage;
  return error instanceof Error ? error.message : fallback;
};
