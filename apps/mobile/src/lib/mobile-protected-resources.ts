/**
 * Shared helpers for authenticated note image / resource loading on mobile.
 *
 * Protected resources live at `/api/v1/resources/:id/blob` and require a Bearer
 * token. WebView `<img>` cannot attach headers, so native code fetches the blob
 * and injects a data URL. Failures used to be swallowed silently — always log
 * and optionally surface a one-shot user notice.
 */

export type ProtectedResourceSession = {
  baseUrl?: string | null;
  token?: string | null;
} | null | undefined;

export type ProtectedResourceLoadFailure = {
  message: string;
  path: string;
  status?: number;
};

export const isProtectedResourceSource = (
  source: string,
  session?: ProtectedResourceSession
) => {
  const baseUrl = session?.baseUrl?.replace(/\/+$/, "") ?? "";
  return (
    source.startsWith("/api/v1/resources/")
    || Boolean(
      baseUrl
      && (source.startsWith(`${baseUrl}/api/v1/resources/`)
        || source.startsWith("/api/v1/resources/"))
    )
  );
};

/**
 * Strip instance base URL and ensure protected paths hit the blob route.
 * Non-resource URLs are returned unchanged (relative form when base was stripped).
 */
export const normalizeProtectedResourcePath = (source: string, baseUrl = "") => {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  let path = source;
  if (normalizedBase && path.startsWith(`${normalizedBase}/`)) {
    path = path.slice(normalizedBase.length);
  }
  if (!path.startsWith("/api/v1/resources/")) {
    return path;
  }
  if (/\/blob(?:$|[?#])/.test(path)) {
    return path.replace(/[?#].*$/, "");
  }
  const match = path.match(/^(\/api\/v1\/resources\/[^/?#]+)/);
  return match ? `${match[1]}/blob` : path;
};

/**
 * Relative protected load path (`/api/v1/resources/:id/blob`) or null when the
 * source is not a protected EdgeEver resource.
 */
export const toProtectedResourceLoadPath = (source: string, baseUrl = ""): string | null => {
  const path = normalizeProtectedResourcePath(source, baseUrl);
  return path.startsWith("/api/v1/resources/") ? path : null;
};

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("资源读取失败"));
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("资源读取失败"));
    };
    reader.readAsDataURL(blob);
  });

export const toProtectedResourceLoadFailure = (
  path: string,
  error: unknown
): ProtectedResourceLoadFailure => {
  const status =
    error
    && typeof error === "object"
    && "status" in error
    && typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Resource download failed";
  return { message, path, status };
};

/** Always-on diagnostics for production feedback (#188). */
export const reportProtectedResourceLoadFailure = (failure: ProtectedResourceLoadFailure) => {
  const statusPart = failure.status != null ? ` status=${failure.status}` : "";
  console.warn(
    `[EdgeEver] protected image load failed path=${failure.path}${statusPart} message=${failure.message}`
  );
};

/** First failure only — avoids spamming multi-image notes. */
export const createOnceProtectedResourceFailureNotifier = (
  notify: (failure: ProtectedResourceLoadFailure) => void
) => {
  let notified = false;
  return (failure: ProtectedResourceLoadFailure) => {
    if (notified) return;
    notified = true;
    notify(failure);
  };
};

export type LoadProtectedResourceDataUrlOptions = {
  baseUrl?: string;
  /** Optional shared cache; failures are removed so a later retry can succeed. */
  cache?: Map<string, Promise<string | null>>;
  cacheLimit?: number;
  getResourceBlob: (resourceUrl: string) => Promise<Blob>;
  onFailure?: (failure: ProtectedResourceLoadFailure) => void;
  /** Included in cache keys so token rotation does not reuse stale entries. */
  token?: string | null;
};

const DEFAULT_CACHE_LIMIT = 32;

export const loadProtectedResourceDataUrl = (
  source: string,
  options: LoadProtectedResourceDataUrlOptions
): Promise<string | null> => {
  const path = toProtectedResourceLoadPath(source, options.baseUrl ?? "");
  if (!path || !options.getResourceBlob) {
    return Promise.resolve(null);
  }

  const cache = options.cache;
  const cacheKey = `${options.token ?? ""}\n${path}`;
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const limit = options.cacheLimit ?? DEFAULT_CACHE_LIMIT;
    if (cache.size >= limit) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }
  }

  const pending = options
    .getResourceBlob(path)
    .then(blobToDataUrl)
    .catch((error: unknown) => {
      cache?.delete(cacheKey);
      const failure = toProtectedResourceLoadFailure(path, error);
      reportProtectedResourceLoadFailure(failure);
      options.onFailure?.(failure);
      return null;
    });

  cache?.set(cacheKey, pending);
  return pending;
};
