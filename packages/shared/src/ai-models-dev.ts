import { AI_MODEL_CAPABILITY_MAX_TOKENS, type AiModelCapabilityLimits } from "./ai-model-capabilities";
import type { AiProvider } from "./types";

/**
 * models.dev (https://github.com/anomalyco/models.dev) is a public catalogue of model limits.
 * EdgeEver uses it only as a fallback when the model service itself reports no limits (#652).
 * The whole catalogue is downloaded, so no model ID or service address is sent to models.dev.
 */
export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json";

type ModelsDevEntry = {
  provider: string;
  modelKey: string;
  /** `vendor/model` from `canonical_model_id`, lower case; `null` when the catalogue has none. */
  canonical: string | null;
  /** The catalogue's own numbers, kept to combine several relay listings. */
  raw: RawLimit;
  limits: AiModelCapabilityLimits;
};

type RawLimit = { context: number | null; input: number | null; output: number | null };

/** A compact lookup built once from the catalogue; it keeps only the limits. */
export type ModelsDevIndex = {
  /** Provider key -> lower-case model key -> entry. */
  providers: Map<string, Map<string, ModelsDevEntry>>;
  /** Lower-case API host -> provider keys, from each provider's `api` field. */
  hosts: Map<string, string[]>;
  /** Lower-case model key, canonical ID, or canonical model part without a `/` -> entries. */
  ids: Map<string, ModelsDevEntry[]>;
  size: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const positiveTokens = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= AI_MODEL_CAPABILITY_MAX_TOKENS ? value : null;

const hostOf = (url: string) => {
  try {
    return new URL(url.trim()).host.toLowerCase() || null;
  } catch {
    return null;
  }
};

/**
 * Map one catalogue `limit` object to EdgeEver's limit shapes.
 * - With `input`, the input and output limits are independent; `context` is kept as a shared
 *   window only when input + output would not fit into it.
 * - Without `input`, `context` is treated as a window shared by input and output.
 * Zero, negative or missing values mean "unknown".
 */
export const mapModelsDevLimit = (limit: unknown): AiModelCapabilityLimits | null => {
  const raw = readRawLimit(limit);
  return raw ? mapRawLimit(raw) : null;
};

const readRawLimit = (limit: unknown): RawLimit | null => {
  const record = asRecord(limit);
  return record
    ? { context: positiveTokens(record.context), input: positiveTokens(record.input), output: positiveTokens(record.output) }
    : null;
};

const mapRawLimit = ({ context, input, output }: RawLimit): AiModelCapabilityLimits | null => {
  const window = input
    ? context && input + (output ?? 0) > context ? context : null
    : context;
  if (!output && !input && !window) return null;
  return { maxOutputTokens: output, maxInputTokens: input, contextWindowTokens: window, source: "models-dev" };
};

const push = (map: Map<string, ModelsDevEntry[]>, key: string, entry: ModelsDevEntry) => {
  const list = map.get(key);
  if (!list) map.set(key, [entry]);
  else if (!list.includes(entry)) list.push(entry);
};

/** Build the lookup from the `api.json` body; `null` when the body is not a catalogue. */
export const buildModelsDevIndex = (body: unknown): ModelsDevIndex | null => {
  const root = asRecord(body);
  if (!root) return null;
  const index: ModelsDevIndex = { providers: new Map(), hosts: new Map(), ids: new Map(), size: 0 };
  for (const [providerKey, providerValue] of Object.entries(root)) {
    const provider = asRecord(providerValue);
    const models = asRecord(provider?.models);
    if (!provider || !models) continue;
    const key = providerKey.toLowerCase();
    const host = typeof provider.api === "string" ? hostOf(provider.api) : null;
    if (host) index.hosts.set(host, [...(index.hosts.get(host) ?? []), key]);
    const entries = new Map<string, ModelsDevEntry>();
    for (const [modelKey, modelValue] of Object.entries(models)) {
      const model = asRecord(modelValue);
      const raw = readRawLimit(model?.limit);
      const limits = raw ? mapRawLimit(raw) : null;
      if (!model || !raw || !limits) continue;
      const canonical = typeof model.canonical_model_id === "string" && model.canonical_model_id.includes("/")
        ? model.canonical_model_id.trim().toLowerCase()
        : null;
      const entry: ModelsDevEntry = { provider: key, modelKey: modelKey.toLowerCase(), canonical, raw, limits };
      entries.set(entry.modelKey, entry);
      push(index.ids, entry.modelKey, entry);
      if (canonical) {
        push(index.ids, canonical, entry);
        // A bare ID (no `/`) may match the canonical model part; a prefixed ID must match in full.
        const modelPart = canonical.slice(canonical.indexOf("/") + 1);
        if (!modelPart.includes("/")) push(index.ids, modelPart, entry);
      }
      index.size++;
    }
    if (entries.size) index.providers.set(key, entries);
  }
  return index.size ? index : null;
};

const vendorOf = (canonical: string) => canonical.slice(0, canonical.indexOf("/"));
const modelPartOf = (canonical: string) => canonical.slice(canonical.indexOf("/") + 1);

/** The lower median: robust to an outlier on either side, and the smaller middle value on a tie. */
const lowerMedian = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

/**
 * Combine relay listings that disagree: the lower median of each catalogue number, mapped with the
 * same shape rules as one listing. An input limit counts only when at least half the listings have
 * one, so a few listings cannot change the shape for the rest.
 */
const combineListings = (entries: ModelsDevEntry[]): AiModelCapabilityLimits | null => {
  const field = (name: keyof RawLimit) => {
    const values = entries.map((entry) => entry.raw[name]).filter((value): value is number => value !== null);
    return values.length ? lowerMedian(values) : null;
  };
  const inputCount = entries.filter((entry) => entry.raw.input !== null).length;
  return mapRawLimit({ context: field("context"), input: inputCount * 2 >= entries.length ? field("input") : null, output: field("output") });
};

/** The catalogue providers that describe this endpoint, from its host or EdgeEver provider type. */
const endpointProviders = (index: ModelsDevIndex, provider: AiProvider, baseUrl: string) => {
  const host = hostOf(baseUrl);
  const keys = [...(host ? index.hosts.get(host) ?? [] : [])];
  if (host === "api.openai.com") keys.push("openai");
  if (provider === "anthropic") keys.push("anthropic");
  if (provider === "google") keys.push("google");
  return keys;
};

/**
 * Find the limits for a model in the catalogue. Matching is exact (case-insensitive), never fuzzy:
 * 1. The catalogue provider that runs this endpoint, by API host (or the official provider).
 * 2. Every listing whose model key or `canonical_model_id` equals the ID, or, for an ID without a
 *    `vendor/` prefix, whose canonical model part equals it. A prefix is never removed to find a
 *    match: `my-team/gpt-5` matches only when the catalogue records that full ID (as a key or a
 *    canonical ID), because the gateway's model behind an unknown prefix is not known, and the
 *    result is shared by every client of the instance.
 * 3. Among those listings, the original vendor's own listing wins, looked up through the canonical
 *    IDs they record; otherwise the listings are combined conservatively (see `combineListings`).
 * Returns `null` when nothing matches.
 */
export const matchModelsDevLimits = (
  index: ModelsDevIndex,
  input: { provider: AiProvider; baseUrl: string; modelId: string },
): AiModelCapabilityLimits | null => {
  const id = input.modelId.trim().replace(/^models\//i, "").toLowerCase();
  if (!id) return null;
  for (const key of endpointProviders(index, input.provider, input.baseUrl)) {
    const entry = index.providers.get(key)?.get(id);
    if (entry) return entry.limits;
  }
  const candidates = index.ids.get(id) ?? [];
  if (!candidates.length) return null;
  const canonicals = new Set(candidates.map((entry) => entry.canonical).filter((value): value is string => Boolean(value)));
  // The original vendor's listing, looked up under the canonical IDs the candidates record.
  for (const canonical of canonicals) {
    const own = index.providers.get(vendorOf(canonical));
    const entry = own?.get(modelPartOf(canonical)) ?? (id.includes("/") ? undefined : own?.get(id));
    if (entry) return entry.limits;
  }
  return combineListings(candidates);
};
