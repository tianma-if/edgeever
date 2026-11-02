import { Secret, TOTP } from "otpauth";
import type { Bindings } from "./api-context";
import { AppError } from "./app-error";
import { hashRecoveryCode, randomToken, verifyRecoveryCodeHash } from "./auth-crypto";
import { createId, isoNow } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { decryptSecret, encryptSecret } from "./secret-encryption";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

export const TOTP_ISSUER = "EdgeEver";
export const TOTP_PERIOD_SECONDS = 30;
/** Accept the previous and next 30-second step to absorb clock drift. */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** An unconfirmed enrollment or rebind expires so a stale secret is never activated. */
export const TOTP_PENDING_TTL_SECONDS = 15 * 60;

const CHALLENGE_TOKEN_BYTES = 32;
// Crockford-style alphabet without look-alike characters (no I, L, O, U).
const RECOVERY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_CODE_GROUPS = 3;
const RECOVERY_CODE_GROUP_LENGTH = 4;

type EncryptionEnvironment = Pick<Bindings,
  "EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY" | "EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS" |
  "EDGE_EVER_AUTH_PASSWORD" | "EDGE_EVER_AUTH_PASSWORD_HASH" | "EDGE_EVER_AUTH_PASSWORD_FALLBACK">;

export type UserTotpRow = {
  user_id: string;
  secret_encrypted: string | null;
  enabled_at: string | null;
  last_used_step: number;
  pending_secret_encrypted: string | null;
  pending_created_at: string | null;
  pending_verified_step: number | null;
};

// Same deployment keys as share passwords, bound to a separate purpose and
// to the account so ciphertexts cannot be swapped between users.
const totpKeys = (env: EncryptionEnvironment, userId: string) => [
  env.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY,
  env.EDGE_EVER_AUTH_PASSWORD,
  env.EDGE_EVER_AUTH_PASSWORD_HASH,
  env.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS,
  env.EDGE_EVER_AUTH_PASSWORD_FALLBACK,
].flatMap((value) => value?.trim() ? [`edgeever:totp-secret:v1:${userId}:${value.trim()}`] : []);

const primaryTotpKey = (env: EncryptionEnvironment, userId: string) => totpKeys({
  ...env,
  EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: undefined,
  EDGE_EVER_AUTH_PASSWORD_FALLBACK: undefined,
}, userId)[0];

export const isTotpEncryptionAvailable = (env: EncryptionEnvironment) =>
  Boolean(primaryTotpKey(env, "probe"));

export const encryptTotpSecret = async (secret: string, userId: string, env: EncryptionEnvironment) => {
  const key = primaryTotpKey(env, userId);
  if (!key) {
    throw new AppError(
      "totp_encryption_unavailable",
      "Configure EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY before enabling two-factor authentication.",
      503,
    );
  }
  return encryptSecret(secret, key);
};

/** Returns null when no configured key can decrypt it (for example a lost key). */
export const decryptTotpSecret = async (encrypted: string | null, userId: string, env: EncryptionEnvironment) => {
  if (!encrypted) return null;
  for (const key of totpKeys(env, userId)) {
    try {
      return await decryptSecret(encrypted, key);
    } catch {
      // Try the next configured key; rotation keeps _PREVIOUS readable.
    }
  }
  return null;
};

export const generateTotpSecret = () => new Secret({ size: 20 }).base32;

const buildTotp = (secret: string, accountName: string) => new TOTP({
  issuer: TOTP_ISSUER,
  label: accountName,
  algorithm: "SHA1",
  digits: 6,
  period: TOTP_PERIOD_SECONDS,
  secret: Secret.fromBase32(secret),
});

export const buildOtpauthUri = (secret: string, accountName: string) =>
  buildTotp(secret, accountName).toString();

export const normalizeTotpCode = (code: string) => code.replace(/[\s-]/g, "");

/** Returns the matched absolute time step, or null. Replay checks are separate. */
export const matchTotpStep = (secret: string, code: string, nowMs = Date.now()) => {
  const token = normalizeTotpCode(code);
  if (!/^\d{6}$/.test(token)) return null;
  const delta = buildTotp(secret, "account").validate({ token, timestamp: nowMs, window: TOTP_WINDOW });
  if (delta === null) return null;
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS) + delta;
};

/** Atomically advance the replay guard; false means the step was already used. */
export const consumeTotpStep = async (db: DatabaseAdapter, userId: string, step: number) => {
  const result = await db.prepare(
    `UPDATE user_totp SET last_used_step = ?, updated_at = ?
     WHERE user_id = ? AND last_used_step < ? AND enabled_at IS NOT NULL`,
  ).bind(step, isoNow(), userId, step).run();
  return Number(result.meta.changes) === 1;
};

export const getUserTotp = (db: DatabaseAdapter, userId: string) =>
  db.prepare(
    `SELECT user_id, secret_encrypted, enabled_at, last_used_step,
            pending_secret_encrypted, pending_created_at, pending_verified_step
     FROM user_totp WHERE user_id = ?`,
  ).bind(userId).first<UserTotpRow>();

export const isTotpEnabled = (row: UserTotpRow | null): row is UserTotpRow & { enabled_at: string } =>
  Boolean(row?.enabled_at && row.secret_encrypted);

export const isPendingFresh = (row: UserTotpRow | null, nowMs = Date.now()) => {
  if (!row?.pending_secret_encrypted || !row.pending_created_at) return false;
  const createdAt = Date.parse(row.pending_created_at);
  return Number.isFinite(createdAt) && nowMs - createdAt <= TOTP_PENDING_TTL_SECONDS * 1000;
};

/** Verifies a code against the active secret and consumes its time step. */
export const verifyActiveTotpCode = async (
  db: DatabaseAdapter,
  env: EncryptionEnvironment,
  row: UserTotpRow,
  code: string,
) => {
  const secret = await decryptTotpSecret(row.secret_encrypted, row.user_id, env);
  if (!secret) return "unavailable" as const;
  const step = matchTotpStep(secret, code);
  if (step === null || step <= row.last_used_step) return "invalid" as const;
  return await consumeTotpStep(db, row.user_id, step) ? "valid" as const : "invalid" as const;
};

export const normalizeRecoveryCode = (code: string) =>
  code.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");

const formatRecoveryCode = (normalized: string) =>
  normalized.match(new RegExp(`.{1,${RECOVERY_CODE_GROUP_LENGTH}}`, "g"))!.join("-");

export const generateRecoveryCodes = () => Array.from({ length: RECOVERY_CODE_COUNT }, () => {
  const length = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH;
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 32 symbols divide 256 evenly, so masking keeps the distribution uniform.
  const raw = Array.from(bytes, (byte) => RECOVERY_CODE_ALPHABET[byte & 31]).join("");
  return formatRecoveryCode(raw);
});

/**
 * Stores a new pending batch, replacing any earlier pending batch. Active
 * codes stay valid until the batch is confirmed.
 */
export const pendingRecoveryCodeStatements = async (
  db: DatabaseAdapter,
  userId: string,
  codes: string[],
): Promise<PreparedStatementAdapter[]> => {
  const batchId = createId("rcb");
  const now = isoNow();
  const hashes = await Promise.all(codes.map((code) => hashRecoveryCode(normalizeRecoveryCode(code))));
  return [
    db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ? AND status = 'pending'`).bind(userId),
    ...hashes.map((hash) => db.prepare(
      `INSERT INTO user_recovery_codes (id, user_id, batch_id, status, code_hash, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    ).bind(createId("rc"), userId, batchId, hash, now)),
  ];
};

export const countPendingRecoveryCodes = async (db: DatabaseAdapter, userId: string) => {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM user_recovery_codes WHERE user_id = ? AND status = 'pending'`,
  ).bind(userId).first<{ count: number }>();
  return Number(row?.count ?? 0);
};

/** Activates the pending batch; every older code becomes invalid at once. */
export const activatePendingRecoveryCodeStatements = (db: DatabaseAdapter, userId: string) => [
  db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ? AND status = 'active'`).bind(userId),
  db.prepare(`UPDATE user_recovery_codes SET status = 'active' WHERE user_id = ? AND status = 'pending'`).bind(userId),
];

export const countActiveRecoveryCodes = async (db: DatabaseAdapter, userId: string) => {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM user_recovery_codes
     WHERE user_id = ? AND status = 'active' AND used_at IS NULL`,
  ).bind(userId).first<{ count: number }>();
  return Number(row?.count ?? 0);
};

/** Verifies and atomically burns one unused active recovery code. */
export const consumeRecoveryCode = async (db: DatabaseAdapter, userId: string, code: string) => {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH) return false;
  const rows = await db.prepare(
    `SELECT id, code_hash FROM user_recovery_codes
     WHERE user_id = ? AND status = 'active' AND used_at IS NULL
     LIMIT ${RECOVERY_CODE_COUNT * 2}`,
  ).bind(userId).all<{ id: string; code_hash: string }>();
  for (const row of rows.results) {
    if (!(await verifyRecoveryCodeHash(normalized, row.code_hash))) continue;
    const result = await db.prepare(
      `UPDATE user_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
    ).bind(isoNow(), row.id).run();
    return Number(result.meta.changes) === 1;
  }
  return false;
};

export type LoginChallengeRow = {
  id: string;
  user_id: string;
  device_id: string | null;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
};

export const createLoginChallenge = async (db: DatabaseAdapter, userId: string, deviceId: string | null) => {
  const token = randomToken(CHALLENGE_TOKEN_BYTES);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MFA_CHALLENGE_TTL_SECONDS * 1000).toISOString();
  await db.batch([
    // Expired challenges carry no authority; drop them so the table stays small.
    db.prepare(`DELETE FROM auth_challenges WHERE user_id = ? AND expires_at <= ?`).bind(userId, now.toISOString()),
    db.prepare(
      `INSERT INTO auth_challenges (id, token_hash, user_id, device_id, attempts, expires_at, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).bind(createId("mfa"), await sha256(token), userId, deviceId, expiresAt, now.toISOString()),
  ]);
  return { token, expiresAt };
};

export const findLoginChallenge = async (db: DatabaseAdapter, token: string) =>
  db.prepare(
    `SELECT id, user_id, device_id, attempts, expires_at, consumed_at
     FROM auth_challenges WHERE token_hash = ?`,
  ).bind(await sha256(token)).first<LoginChallengeRow>();

/** Reserves one attempt; false when the challenge is spent, expired or exhausted. */
export const reserveChallengeAttempt = async (db: DatabaseAdapter, challengeId: string) => {
  const result = await db.prepare(
    `UPDATE auth_challenges SET attempts = attempts + 1
     WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?`,
  ).bind(challengeId, isoNow(), MFA_CHALLENGE_MAX_ATTEMPTS).run();
  return Number(result.meta.changes) === 1;
};

export const consumeLoginChallenge = async (db: DatabaseAdapter, challengeId: string) => {
  const result = await db.prepare(
    `UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
  ).bind(isoNow(), challengeId).run();
  return Number(result.meta.changes) === 1;
};
