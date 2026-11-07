import { buildModelsDevIndex, MODELS_DEV_CATALOG_URL, type ModelsDevIndex } from "@edgeever/shared/ai-models-dev";
import { throwIfAborted } from "./abort-signal";

/**
 * In-memory cache of the models.dev catalogue (#652).
 * - The instance already stores each model's limits for every client, so the catalogue is only
 *   needed when a model's limits are missing or stale; it is kept in memory, not on disk.
 * - A fresh copy is reused for a day. After that it is requested again. Where the response's ETag
 *   is readable (Android), the request carries `If-None-Match`, so an unchanged catalogue costs a
 *   304. models.dev does not expose ETag to browsers, so Web and desktop send a plain GET and rely
 *   on the browser's own HTTP cache revalidation.
 * - Concurrent lookups share one download. A failure is remembered briefly, so a blocked or slow
 *   network does not delay every generation in a row.
 */
export const MODELS_DEV_FRESH_MS = 24 * 60 * 60 * 1000;
export const MODELS_DEV_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
export const MODELS_DEV_TIMEOUT_MS = 5000;

type CachedCatalog = { index: ModelsDevIndex; etag: string | null; checkedAt: number };

let cached: CachedCatalog | null = null;
let failedAt: number | null = null;
let pending: Promise<ModelsDevIndex | null> | null = null;

/** Test hook: forget the cached catalogue. */
export const resetModelsDevCatalogCache = () => {
  cached = null;
  failedAt = null;
  pending = null;
};

const download = async (fetchImpl: typeof fetch, now: () => number): Promise<ModelsDevIndex | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
  try {
    const headers = new Headers({ Accept: "application/json" });
    if (cached?.etag) headers.set("If-None-Match", cached.etag);
    const response = await fetchImpl(MODELS_DEV_CATALOG_URL, {
      method: "GET",
      headers,
      credentials: "omit",
      signal: controller.signal,
    });
    if (response.status === 304 && cached) {
      cached = { ...cached, checkedAt: now() };
      return cached.index;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const index = buildModelsDevIndex(await response.json());
    if (!index) throw new Error("Not a models.dev catalogue");
    cached = { index, etag: response.headers.get("ETag"), checkedAt: now() };
    failedAt = null;
    return index;
  } catch {
    failedAt = now();
    // A stale copy is still better than nothing.
    return cached?.index ?? null;
  } finally {
    clearTimeout(timer);
  }
};

/** Stop waiting when the caller aborts, without cancelling the shared download for others. */
const untilAborted = <T>(promise: Promise<T>, signal?: AbortSignal) => {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
};

/** The models.dev lookup, or `null` when the catalogue cannot be read now. */
export const loadModelsDevIndex = (
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<ModelsDevIndex | null> => {
  const time = now();
  if (cached && time - cached.checkedAt < MODELS_DEV_FRESH_MS) return Promise.resolve(cached.index);
  if (failedAt !== null && time - failedAt < MODELS_DEV_FAILURE_BACKOFF_MS) return Promise.resolve(cached?.index ?? null);
  pending ??= download(fetchImpl, now).finally(() => { pending = null; });
  return untilAborted(pending, signal);
};
