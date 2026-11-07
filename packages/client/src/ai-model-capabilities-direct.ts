import type { AiModelCapabilityLimits, AiModelMetadataEndpoint, AiProvider } from "@edgeever/shared";
import { AI_MODEL_CAPABILITY_NONE, parseAiModelCapabilityLimits } from "@edgeever/shared/ai-model-capabilities";

type DetectionTarget = { provider: AiProvider; baseUrl: string; apiKey: string; modelId: string };

const providerHeaders = (target: DetectionTarget) => {
  const headers = new Headers({ Accept: "application/json" });
  if (target.provider === "anthropic") {
    headers.set("x-api-key", target.apiKey);
    headers.set("anthropic-version", "2023-06-01");
    headers.set("anthropic-dangerous-direct-browser-access", "true");
  } else if (target.provider === "google") {
    headers.set("x-goog-api-key", target.apiKey);
  } else {
    headers.set("Authorization", `Bearer ${target.apiKey}`);
  }
  return headers;
};

class DetectionUnavailable extends Error {}

/**
 * Read a model's output and context limits from the provider's own metadata (#652).
 * - Returns the limits found, or `AI_MODEL_CAPABILITY_NONE` when the provider answered without
 *   any (common for OpenAI and many gateways), so the client does not ask again for a while.
 * - Returns `null` when the metadata could not be read (network, authentication, rate-limit or
 *   server errors); nothing should be reported then. A gateway answering an unsupported metadata
 *   path with 400 or 404 counts as "no limits".
 * - When the provider answered without limits and `catalogFetch` is given, the public models.dev
 *   catalogue fills in (`source: "models-dev"`). It is never mixed with the provider's own limits,
 *   and an unreadable or unmatched catalogue still reports "no limits".
 * These are read-only GET requests; they never generate text.
 */
export const detectAiModelCapabilities = async (
  target: DetectionTarget,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  options: { catalogFetch?: typeof fetch } = {},
): Promise<AiModelCapabilityLimits | null> => {
  const fromService = await detectFromService(target, fetchImpl, signal);
  if (fromService?.source !== "none" || !options.catalogFetch) return fromService;
  const [{ loadModelsDevIndex }, { matchModelsDevLimits }] = await Promise.all([
    import("./models-dev-catalog"),
    import("@edgeever/shared/ai-models-dev"),
  ]);
  const index = await loadModelsDevIndex(options.catalogFetch, signal);
  return (index && matchModelsDevLimits(index, target)) ?? fromService;
};

const detectFromService = async (
  target: DetectionTarget,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<AiModelCapabilityLimits | null> => {
  const base = target.baseUrl.trim().replace(/\/+$/, "");
  const headers = providerHeaders(target);
  const read = async (url: string, endpoint: AiModelMetadataEndpoint, missingIsEmpty: boolean) => {
    const response = await fetchImpl(url, { method: "GET", headers, signal });
    // Gateways answer unsupported metadata paths with 404 or, often, 400. Treat any client
    // error other than authentication or rate limiting as "this endpoint has no metadata".
    const unsupported = response.status >= 400 && response.status < 500
      && response.status !== 401 && response.status !== 403 && response.status !== 429;
    if (unsupported && missingIsEmpty) return null;
    if (!response.ok) throw new DetectionUnavailable(`HTTP ${response.status}`);
    const body: unknown = await response.json().catch(() => null);
    return parseAiModelCapabilityLimits({ provider: target.provider, modelId: target.modelId, endpoint, body });
  };
  try {
    if (target.provider === "anthropic") {
      return await read(`${base}/models/${encodeURIComponent(target.modelId)}`, "model", true) ?? AI_MODEL_CAPABILITY_NONE;
    }
    if (target.provider === "google") {
      const modelId = target.modelId.replace(/^models\//, "");
      return await read(`${base}/models/${encodeURIComponent(modelId)}`, "model", true) ?? AI_MODEL_CAPABILITY_NONE;
    }
    // OpenRouter and DeepSeek put limits on the model list; LiteLLM serves them on /model/info.
    // The list itself must answer: it is the same endpoint "Discover models" uses.
    return await read(`${base}/models`, "models", false)
      ?? await read(`${base}/model/info`, "litellm-model-info", true).catch(() => null)
      ?? AI_MODEL_CAPABILITY_NONE;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
};
