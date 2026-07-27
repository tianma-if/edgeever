import type { DatabaseAdapter } from "./storage-contract";

export type LoginAttemptScope = "username" | "ip";

export type LoginAttemptKey = {
  scope: LoginAttemptScope;
  key: string;
};

export type LoginRateLimitConfig = {
  windowSeconds: number;
  usernameMaxAttempts: number;
  usernameCooldownSeconds: number;
  ipMaxAttempts: number;
  ipCooldownSeconds: number;
};

export type LoginRateLimitEnv = {
  EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS?: string;
  EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS?: string;
  EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS?: string;
  EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS?: string;
  EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS?: string;
};

export type LoginRateLimitResult = {
  blockedUntil: string | null;
  retryAfterSeconds: number;
};

export const DEFAULT_LOGIN_RATE_LIMIT_CONFIG: LoginRateLimitConfig = {
  windowSeconds: 15 * 60,
  usernameMaxAttempts: 5,
  usernameCooldownSeconds: 15 * 60,
  ipMaxAttempts: 30,
  ipCooldownSeconds: 5 * 60,
};

type LoginAttemptRow = {
  scope: LoginAttemptScope;
  blocked_until: string | null;
};

const parsePositiveInteger = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const resolveLoginRateLimitConfig = (
  env: LoginRateLimitEnv,
): LoginRateLimitConfig => ({
  windowSeconds: parsePositiveInteger(
    env.EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS,
    DEFAULT_LOGIN_RATE_LIMIT_CONFIG.windowSeconds,
    24 * 60 * 60,
  ),
  usernameMaxAttempts: parsePositiveInteger(
    env.EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS,
    DEFAULT_LOGIN_RATE_LIMIT_CONFIG.usernameMaxAttempts,
    100,
  ),
  usernameCooldownSeconds: parsePositiveInteger(
    env.EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS,
    DEFAULT_LOGIN_RATE_LIMIT_CONFIG.usernameCooldownSeconds,
    24 * 60 * 60,
  ),
  ipMaxAttempts: parsePositiveInteger(
    env.EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS,
    DEFAULT_LOGIN_RATE_LIMIT_CONFIG.ipMaxAttempts,
    1_000,
  ),
  ipCooldownSeconds: parsePositiveInteger(
    env.EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS,
    DEFAULT_LOGIN_RATE_LIMIT_CONFIG.ipCooldownSeconds,
    24 * 60 * 60,
  ),
});

const getScopeConfig = (scope: LoginAttemptScope, config: LoginRateLimitConfig) =>
  scope === "username"
    ? { maxAttempts: config.usernameMaxAttempts, cooldownSeconds: config.usernameCooldownSeconds }
    : { maxAttempts: config.ipMaxAttempts, cooldownSeconds: config.ipCooldownSeconds };

const toIso = (timestampMs: number) => new Date(timestampMs).toISOString();

const retryAfterSeconds = (blockedUntil: string | null, nowMs: number) => {
  if (!blockedUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(blockedUntil) - nowMs) / 1000));
};

const buildKeyFilter = (keys: LoginAttemptKey[]) =>
  keys.map(() => "(scope = ? AND attempt_key = ?)").join(" OR ");

const bindKeys = (keys: LoginAttemptKey[]) => keys.flatMap(({ scope, key }) => [scope, key]);

export const checkLoginRateLimit = async (
  db: DatabaseAdapter,
  keys: LoginAttemptKey[],
  config: LoginRateLimitConfig,
  nowMs = Date.now(),
): Promise<LoginRateLimitResult> => {
  if (keys.length === 0) return { blockedUntil: null, retryAfterSeconds: 0 };

  const now = toIso(nowMs);
  const retentionBoundary = toIso(nowMs - Math.max(config.windowSeconds, config.usernameCooldownSeconds, config.ipCooldownSeconds) * 2 * 1000);
  await db.prepare(`DELETE FROM auth_login_attempts WHERE updated_at <= ?`).bind(retentionBoundary).run();

  const rows = await db.prepare(
    `SELECT scope, blocked_until
     FROM auth_login_attempts
     WHERE ${buildKeyFilter(keys)}`,
  ).bind(...bindKeys(keys)).all<LoginAttemptRow>();

  const blockedUntil = rows.results
    .map((row) => row.blocked_until)
    .filter((value): value is string => Boolean(value && value > now))
    .sort()
    .at(-1) ?? null;

  return {
    blockedUntil,
    retryAfterSeconds: retryAfterSeconds(blockedUntil, nowMs),
  };
};

export const recordLoginFailure = async (
  db: DatabaseAdapter,
  keys: LoginAttemptKey[],
  config: LoginRateLimitConfig,
  nowMs = Date.now(),
): Promise<LoginRateLimitResult> => {
  if (keys.length === 0) return { blockedUntil: null, retryAfterSeconds: 0 };

  const now = toIso(nowMs);
  const windowBoundary = toIso(nowMs - config.windowSeconds * 1000);
  const statements = keys.map(({ scope, key }) => {
    const scopeConfig = getScopeConfig(scope, config);
    const blockedUntil = toIso(nowMs + scopeConfig.cooldownSeconds * 1000);
    return db.prepare(
      `INSERT INTO auth_login_attempts (
        scope, attempt_key, failure_count, window_started_at, blocked_until, updated_at
      ) VALUES (?, ?, 1, ?, NULL, ?)
      ON CONFLICT(scope, attempt_key) DO UPDATE SET
        failure_count = CASE
          WHEN auth_login_attempts.window_started_at <= ? THEN 1
          ELSE auth_login_attempts.failure_count + 1
        END,
        window_started_at = CASE
          WHEN auth_login_attempts.window_started_at <= ? THEN excluded.window_started_at
          ELSE auth_login_attempts.window_started_at
        END,
        blocked_until = CASE
          WHEN (
            CASE
              WHEN auth_login_attempts.window_started_at <= ? THEN 1
              ELSE auth_login_attempts.failure_count + 1
            END
          ) >= ? THEN ?
          ELSE NULL
        END,
        updated_at = excluded.updated_at`,
    ).bind(scope, key, now, now, windowBoundary, windowBoundary, windowBoundary, scopeConfig.maxAttempts, blockedUntil);
  });

  await db.batch(statements);
  return checkLoginRateLimit(db, keys, config, nowMs);
};

export const clearLoginAttempts = async (db: DatabaseAdapter, keys: LoginAttemptKey[]) => {
  if (keys.length === 0) return;
  await db.prepare(`DELETE FROM auth_login_attempts WHERE ${buildKeyFilter(keys)}`).bind(...bindKeys(keys)).run();
};
