/** Bounded per-context cache. Errors are retried and concurrent readers share work. */
export const createRequestCache = <T>({ ttlMs, limit = 32, now = Date.now }: {
  ttlMs: number;
  limit?: number;
  now?: () => number;
}) => {
  const entries = new Map<string, { promise: Promise<T>; expiresAt: number }>();
  return (key: string, load: () => Promise<T>, force = false): Promise<T> => {
    const cached = entries.get(key);
    if (cached && (!Number.isFinite(cached.expiresAt) || (!force && cached.expiresAt > now()))) return cached.promise;
    const entry: { promise: Promise<T>; expiresAt: number } = { promise: Promise.resolve(null as T), expiresAt: Infinity };
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.expiresAt = now() + ttlMs;
      return value;
    }, error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > limit) entries.delete(entries.keys().next().value!);
    return entry.promise;
  };
};
