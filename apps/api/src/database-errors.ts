// Cloudflare wraps binding failures in Error.cause. Match only the explicit
// daily quota failure; network, schema and per-query limits remain distinct.
export const isDatabaseDailyQuotaError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    if (/\bD1_ERROR:.*\bexceeded D1's free tier daily row (?:read|write) limit\b/i.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
};
