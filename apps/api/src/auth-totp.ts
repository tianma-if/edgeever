import { Secret, TOTP } from "otpauth";
import type { Bindings } from "./api-context";
import { AppError } from "./app-error";
import {
  hashPassword,
  hashRecoveryCode,
  markPasswordHashMfa,
  MFA_PASSWORD_HASH_ALGORITHM,
  PASSWORD_HASH_ALGORITHM,
  randomToken,
  verifyRecoveryCodeHash,
} from "./auth-crypto";
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
/** Wrong codes allowed against one pending secret before the setup is discarded. */
export const TOTP_SETUP_MAX_ATTEMPTS = 5;

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
  /** Session that passed identity verification and owns the pending setup. */
  pending_session_id: string | null;
  /** Wrong codes entered against the pending secret; the setup is discarded at the cap. */
  pending_attempts: number;
  /** Recovery-code batch created when the pending secret was verified. */
  pending_batch_id: string | null;
  /** Id handed to the client at setup; verify must name it so a setup replaced by a newer one is refused. */
  pending_setup_id: string | null;
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
            pending_secret_encrypted, pending_created_at, pending_verified_step,
            pending_session_id, pending_attempts, pending_batch_id, pending_setup_id
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

export const newRecoveryCodeBatchId = () => createId("rcb");

/** Identifies one enrollment or rebind flow from setup through confirm. */
export const newTotpSetupId = () => createId("setup");

/**
 * Stores a new pending batch for the session that passed identity
 * verification, replacing any earlier pending batch. Active codes stay valid
 * until the batch is confirmed. With `onlyIfSetupBatch`, the rows are written
 * only while user_totp still points at this batch, so a verify request that
 * lost a race against a newer setup leaves nothing behind.
 */
export const pendingRecoveryCodeStatements = async (
  db: DatabaseAdapter,
  userId: string,
  codes: string[],
  options: { batchId: string; sessionId: string; onlyIfSetupBatch?: boolean },
): Promise<PreparedStatementAdapter[]> => {
  const now = isoNow();
  const hashes = await Promise.all(codes.map((code) => hashRecoveryCode(normalizeRecoveryCode(code))));
  const guard = options.onlyIfSetupBatch
    ? `EXISTS (SELECT 1 FROM user_totp WHERE user_id = ? AND pending_batch_id = ?)`
    : null;
  const guardBinds = guard ? [userId, options.batchId] : [];
  return [
    db.prepare(
      `DELETE FROM user_recovery_codes WHERE user_id = ? AND status = 'pending' AND batch_id != ?`
      + (guard ? ` AND ${guard}` : ""),
    ).bind(userId, options.batchId, ...guardBinds),
    ...hashes.map((hash) => db.prepare(
      `INSERT INTO user_recovery_codes (id, user_id, batch_id, status, code_hash, created_at, session_id)
       SELECT ?, ?, ?, 'pending', ?, ?, ?` + (guard ? ` WHERE ${guard}` : ""),
    ).bind(createId("rc"), userId, options.batchId, hash, now, options.sessionId, ...guardBinds)),
  ];
};

export const countPendingRecoveryCodes = async (db: DatabaseAdapter, userId: string, batchId: string) => {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM user_recovery_codes
     WHERE user_id = ? AND status = 'pending' AND batch_id = ?`,
  ).bind(userId, batchId).first<{ count: number }>();
  return Number(row?.count ?? 0);
};

/**
 * One batch of codes, as created by this session, for regenerate confirm.
 * Null once a newer batch replaced it (pending) or superseded it (active).
 */
export const findRecoveryCodeBatch = async (db: DatabaseAdapter, userId: string, batchId: string, sessionId: string) => {
  const row = await db.prepare(
    `SELECT status, COUNT(*) AS count FROM user_recovery_codes
     WHERE user_id = ? AND batch_id = ? AND session_id = ?
     GROUP BY status LIMIT 1`,
  ).bind(userId, batchId, sessionId).first<{ status: "pending" | "active"; count: number }>();
  return row ? { status: row.status, count: Number(row.count) } : null;
};

/**
 * Activates one pending batch; every older code becomes invalid at once.
 * Safe to run twice: the old active codes are only cleared while this batch is
 * still pending, so a second confirm that lost the race changes nothing.
 */
export const activatePendingRecoveryCodeStatements = (db: DatabaseAdapter, userId: string, batchId: string) => [
  db.prepare(
    `DELETE FROM user_recovery_codes WHERE user_id = ? AND status = 'active'
       AND EXISTS (SELECT 1 FROM user_recovery_codes
                   WHERE user_id = ? AND status = 'pending' AND batch_id = ?)`,
  ).bind(userId, userId, batchId),
  // Last on purpose: callers read this statement's change count to learn whether
  // this request was the one that activated the batch.
  db.prepare(
    `UPDATE user_recovery_codes SET status = 'active'
     WHERE user_id = ? AND status = 'pending' AND batch_id = ?`,
  ).bind(userId, batchId),
];

export const countActiveRecoveryCodesInBatch = async (db: DatabaseAdapter, userId: string, batchId: string) => {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM user_recovery_codes
     WHERE user_id = ? AND status = 'active' AND batch_id = ?`,
  ).bind(userId, batchId).first<{ count: number }>();
  return Number(row?.count ?? 0);
};

/**
 * Counts a wrong enrollment code against the pending secret. Once the cap is
 * reached the pending setup is discarded, so the user has to start again with
 * their password. Returns true when the setup was discarded.
 */
export const recordPendingSetupFailure = async (db: DatabaseAdapter, row: UserTotpRow) => {
  const now = isoNow();
  const results = await db.batch([
    db.prepare(
      `UPDATE user_totp SET pending_attempts = pending_attempts + 1, updated_at = ?
       WHERE user_id = ? AND pending_secret_encrypted = ?`,
    ).bind(now, row.user_id, row.pending_secret_encrypted),
    db.prepare(
      `UPDATE user_totp SET pending_secret_encrypted = NULL, pending_created_at = NULL,
         pending_verified_step = NULL, pending_session_id = NULL, pending_setup_id = NULL,
         pending_attempts = 0, pending_batch_id = NULL, updated_at = ?
       WHERE user_id = ? AND pending_secret_encrypted = ? AND pending_attempts >= ?`,
    ).bind(now, row.user_id, row.pending_secret_encrypted, TOTP_SETUP_MAX_ATTEMPTS),
    db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ? AND status = 'pending'`).bind(row.user_id),
  ]);
  return Number(results[1]?.meta.changes) === 1;
};

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

// ---------------------------------------------------------------------------
// Rollback protection. While TOTP is enabled the account's password hash is
// stored under MFA_PASSWORD_HASH_ALGORITHM. A backend that predates TOTP only
// accepts PASSWORD_HASH_ALGORITHM, so after a code rollback such an account
// cannot sign in with the password alone (it gets password_hash_invalid) instead
// of silently losing its second factor. The tag is a prefix swap: salt and
// hash stay the same, so no plaintext password is needed to apply or remove it.
// Both statements are no-ops when the row is already in the target state.

const PLAIN_HASH_PREFIX = `${PASSWORD_HASH_ALGORITHM}$`;
const MFA_HASH_PREFIX = `${MFA_PASSWORD_HASH_ALGORITHM}$`;

export const markPasswordHashMfaStatement = (db: DatabaseAdapter, userId: string, now: string) =>
  db.prepare(
    `UPDATE users SET password_hash = ? || substr(password_hash, ?), updated_at = ?
     WHERE id = ? AND substr(password_hash, 1, ?) = ?`,
  ).bind(MFA_HASH_PREFIX, PLAIN_HASH_PREFIX.length + 1, now, userId, PLAIN_HASH_PREFIX.length, PLAIN_HASH_PREFIX);

export const unmarkPasswordHashMfaStatement = (db: DatabaseAdapter, userId: string, now: string) =>
  db.prepare(
    `UPDATE users SET password_hash = ? || substr(password_hash, ?), updated_at = ?
     WHERE id = ? AND substr(password_hash, 1, ?) = ?`,
  ).bind(PLAIN_HASH_PREFIX, MFA_HASH_PREFIX.length + 1, now, userId, MFA_HASH_PREFIX.length, MFA_HASH_PREFIX);

/** Hashes a new password for a user, keeping the MFA tag if TOTP is enabled. */
export const hashPasswordForUser = async (db: DatabaseAdapter, userId: string, password: string) => {
  const hash = await hashPassword(password);
  return isTotpEnabled(await getUserTotp(db, userId)) ? markPasswordHashMfa(hash) : hash;
};
