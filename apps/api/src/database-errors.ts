// Cloudflare wraps binding failures in Error.cause.
const matchesDatabaseError = (error: unknown, pattern: RegExp): boolean => {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    if (pattern.test(current.message)) return true;
    current = current.cause;
  }
  return false;
};

export const isDatabaseDailyQuotaError = (error: unknown): boolean =>
  matchesDatabaseError(error, /\bD1_ERROR:.*\bexceeded D1's free tier daily row (?:read|write) limit\b/i);

export const isTableMigrationPausedError = (error: unknown): boolean =>
  matchesDatabaseError(error, /\btable_migration_in_progress\b/);
