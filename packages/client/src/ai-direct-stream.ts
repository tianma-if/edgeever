import type { AiAttachmentInput, AiDirectTarget, AiPreparedGeneration, AiStreamEvent } from "@edgeever/shared";
import {
  buildAiDirectProviderRequest,
  createAiGenerationStreamNormalizer,
  extractAiDirectStreamDelta,
  redactAiProviderError,
} from "@edgeever/shared/ai-generation";
import { isAiTruncatedFinishReason, parseAiOutputLimitFromError } from "@edgeever/shared/ai-model-capabilities";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;

import { consumeProviderEventStream } from "@edgeever/shared/provider-event-stream";
export { consumeProviderEventStream } from "@edgeever/shared/provider-event-stream";

export const streamDirectAiGeneration = async (
  prepared: AiPreparedGeneration,
  attachments: AiAttachmentInput[] | undefined,
  options: {
    fetch: typeof fetch;
    signal?: AbortSignal;
    onEvent: (event: AiStreamEvent) => void;
    /** Called with the limit read from a provider's "output too large" error before the single retry. */
    onOutputLimit?: (maxOutputTokens: number) => Promise<void> | void;
    /** Internal: set on the retry so it happens at most once and `start` is not repeated. */
    retried?: boolean;
  },
): Promise<void> => {
  const request = buildAiDirectProviderRequest(prepared, attachments ?? []);
  if (!options.retried) options.onEvent({ type: "start" });
  const response = await options.fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: options.signal,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    // The provider rejected the requested output limit and said what it accepts. Nothing was
    // generated or streamed yet, so retry once with that limit (#652).
    const acceptedLimit = response.status === 400 && !options.retried ? parseAiOutputLimitFromError(raw) : null;
    if (acceptedLimit && (prepared.maxOutputTokens === null || acceptedLimit < prepared.maxOutputTokens)) {
      await Promise.resolve(options.onOutputLimit?.(acceptedLimit)).catch(() => undefined);
      return streamDirectAiGeneration({ ...prepared, maxOutputTokens: acceptedLimit }, attachments, { ...options, retried: true });
    }
    const message = redactAiProviderError(raw || `The AI provider responded with HTTP ${response.status}.`);
    options.onEvent({ type: "error", code: "ai_generation_failed", message });
    return;
  }
  if (!response.body) {
    options.onEvent({
      type: "error",
      code: "ai_stream_unavailable",
      message: "Streaming response is unavailable",
    });
    return;
  }

  const normalizer = createAiGenerationStreamNormalizer(prepared.resultBoundary);
  let hasContent = false;
  let finishReason: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  await consumeProviderEventStream(response.body, (payload) => {
    const delta = extractAiDirectStreamDelta(prepared.provider, payload);
    if (delta.finishReason) finishReason = delta.finishReason;
    if (typeof delta.inputTokens === "number") inputTokens = delta.inputTokens;
    if (typeof delta.outputTokens === "number") outputTokens = delta.outputTokens;
    const text = normalizer.push(delta.text);
    if (!text) return;
    hasContent ||= Boolean(text.trim());
    options.onEvent({ type: "text-delta", text });
  });
  const trailingText = normalizer.finish();
  if (trailingText) {
    hasContent ||= Boolean(trailingText.trim());
    options.onEvent({ type: "text-delta", text: trailingText });
  }
  if (!hasContent) {
    options.onEvent({
      type: "error",
      code: "ai_generation_failed",
      message: "The AI did not return a note result.",
    });
    return;
  }
  // The connection closed before the provider said it finished and before the end marker,
  // whether or not the start marker arrived: the stream was interrupted, not cut at a limit.
  // The text so far stays an incomplete draft.
  if (!finishReason && !normalizer.isComplete()) {
    options.onEvent({
      type: "error",
      code: "ai_stream_interrupted",
      message: "The connection ended before the AI finished.",
    });
    return;
  }
  // Some gateways cut the output at their own default and still report "stop"; a missing
  // end marker catches that case as well.
  const truncated = isAiTruncatedFinishReason(finishReason) || normalizer.isUnterminated();
  options.onEvent({ type: "finish", finishReason, truncated, inputTokens, outputTokens });
};

export const isAiCorsFailure = (error: unknown) => {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|cors/i.test(message);
};

export const probeAiProviderCors = async (
  target: AiDirectTarget,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
) => {
  const request = buildAiDirectProviderRequest({
    ...target,
    apiKey: "edgeever-cors-probe",
    system: "ping",
    prompt: "ping",
    maxOutputTokens: 1,
    resultBoundary: { start: "<edgeever-result-probe>", end: "</edgeever-result-probe>" },
  });
  try {
    // POST with the dummy key so the browser preflight matches the real direct request.
    const response = await fetchImpl(request.url, {
      method: "POST",
      mode: "cors",
      headers: request.headers,
      body: request.body,
      signal,
    });
    await response.body?.cancel().catch(() => {});
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
};

export const parseAiDirectTarget = (value: unknown): AiDirectTarget | null => {
  const record = asRecord(value);
  if (
    !record
    || (record.provider !== "openai-compatible" && record.provider !== "anthropic" && record.provider !== "google")
    || typeof record.baseUrl !== "string"
    || typeof record.modelId !== "string"
    || typeof record.apiKey === "string"
  ) {
    return null;
  }
  return {
    provider: record.provider,
    baseUrl: record.baseUrl,
    modelId: record.modelId,
  };
};

export const parsePreparedAiGeneration = (value: unknown): AiPreparedGeneration | null => {
  const record = asRecord(value);
  const boundary = asRecord(record?.resultBoundary);
  if (
    !record
    || (record.provider !== "openai-compatible" && record.provider !== "anthropic" && record.provider !== "google")
    || typeof record.baseUrl !== "string"
    || typeof record.apiKey !== "string"
    || typeof record.modelId !== "string"
    || typeof record.system !== "string"
    || typeof record.prompt !== "string"
    || (typeof record.maxOutputTokens !== "number" && record.maxOutputTokens !== null)
    || typeof boundary?.start !== "string"
    || typeof boundary?.end !== "string"
  ) {
    return null;
  }
  const target = asRecord(record.capabilityTarget);
  const budget = asRecord(record.outputBudget);
  return {
    provider: record.provider,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    modelId: record.modelId,
    system: record.system,
    prompt: record.prompt,
    maxOutputTokens: record.maxOutputTokens,
    resultBoundary: { start: boundary.start, end: boundary.end },
    ...(budget && typeof budget.mode === "string" ? {
      outputBudget: {
        mode: budget.mode as NonNullable<AiPreparedGeneration["outputBudget"]>["mode"],
        outputLimit: typeof budget.outputLimit === "number" ? budget.outputLimit : null,
        inputFits: typeof budget.inputFits === "boolean" ? budget.inputFits : null,
      },
    } : {}),
    ...(target && typeof target.providerConfigId === "string" && typeof target.modelConfigId === "string"
      && typeof target.configVersion === "string"
      ? {
        capabilityTarget: { providerConfigId: target.providerConfigId, modelConfigId: target.modelConfigId, configVersion: target.configVersion },
        detectCapabilities: record.detectCapabilities === true,
      }
      : {}),
  };
};
