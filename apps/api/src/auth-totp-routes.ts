import {
  LoginMfaSchema,
  TotpBatchConfirmSchema,
  TotpReauthSchema,
  TotpSetupVerifySchema,
  type LoginMfaInput,
  type TotpReauthInput,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv, AuthContext } from "./api-context";
import { audit, auditStatement } from "./audit";
import { verifyPassword } from "./auth-crypto";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordLoginFailure,
  resolveLoginRateLimitConfig,
  type LoginAttemptKey,
} from "./auth-login-limiter";
import type { UserRow } from "./auth-routes";
import {
  activatePendingRecoveryCodeStatements,
  buildOtpauthUri,
  consumeLoginChallenge,
  consumeRecoveryCode,
  countActiveRecoveryCodes,
  countActiveRecoveryCodesInBatch,
  countPendingRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  findRecoveryCodeBatch,
  findLoginChallenge,
  generateRecoveryCodes,
  generateTotpSecret,
  getUserTotp,
  isPendingFresh,
  isTotpEnabled,
  isTotpEncryptionAvailable,
  markPasswordHashMfaStatement,
  matchTotpStep,
  newRecoveryCodeBatchId,
  newTotpSetupId,
  pendingRecoveryCodeStatements,
  recordPendingSetupFailure,
  RECOVERY_CODE_COUNT,
  reserveChallengeAttempt,
  TOTP_ISSUER,
  TOTP_PENDING_TTL_SECONDS,
  unmarkPasswordHashMfaStatement,
  verifyActiveTotpCode,
} from "./auth-totp";
import { createId, isoNow } from "./entity-utils";
import { apiError, forbidden, unauthorized } from "./http-errors";

type AuthenticateOptions = { allowMfaRestricted?: boolean };

type SessionAuth = AuthContext & { actorId: string; sessionId: string };

export type FinishLoginOptions = {
  deviceId?: string;
  locale?: string;
  mfaRestricted?: boolean;
  auditAction: string;
};

export type TotpRouteDependencies = {
  authenticateRequest: (
    context: AppContext,
    touch: boolean,
    options?: AuthenticateOptions,
  ) => Promise<AuthContext | null>;
  createSession: (
    context: AppContext,
    user: UserRow,
    requestedDeviceId?: string,
    options?: { mfaRestricted?: boolean },
  ) => Promise<{ id: string; token: string; maxAge: number }>;
  finishLogin: (context: AppContext, user: UserRow, options: FinishLoginOptions) => Promise<Response>;
  getLoginAttemptKeys: (context: AppContext, username: string) => Promise<LoginAttemptKey[]>;
  isDemoEnvironment: (environment: AppContext["env"]) => boolean;
  setSessionCookie: (context: AppContext, token: string, maxAge: number) => void;
  tooManyLoginAttempts: (context: AppContext, retryAfterSeconds: number) => Response;
};

const requireSession = async (
  context: AppContext,
  dependencies: TotpRouteDependencies,
  allowMfaRestricted = false,
): Promise<SessionAuth | null> => {
  const auth = await dependencies.authenticateRequest(context, true, { allowMfaRestricted });
  if (auth?.kind !== "user" || !auth.actorId || !auth.sessionId) return null;
  return { ...auth, actorId: auth.actorId, sessionId: auth.sessionId };
};

const getActiveUser = (context: AppContext, userId: string) =>
  context.env.storage.db.prepare(
    `SELECT id, username, password_hash, display_name, is_disabled
     FROM users WHERE id = ? AND is_disabled = 0`,
  ).bind(userId).first<UserRow>();

const sessionRequired = (context: AppContext) =>
  unauthorized(context, "An interactive user session is required.");

const invalidCode = (context: AppContext) =>
  apiError(context, "invalid_totp_code", "The authenticator code is incorrect or was already used.", 400);

const totpUnavailable = (context: AppContext) =>
  apiError(
    context,
    "totp_unavailable",
    "The authenticator secret cannot be read on this deployment. Sign in with a recovery code and bind a new authenticator.",
    503,
  );

const setupExpired = (context: AppContext) =>
  apiError(context, "totp_setup_expired", "This setup has expired. Start again.", 409);

export const registerTotpRoutes = (app: Hono<AppEnv>, dependencies: TotpRouteDependencies) => {
  const unavailableReason = (context: AppContext) => {
    if (dependencies.isDemoEnvironment(context.env)) return "demo" as const;
    if (!isTotpEncryptionAvailable(context.env)) return "encryption_unavailable" as const;
    return null;
  };

  /**
   * Re-verifies identity for a security change. Failures count against the
   * account's login limiter so a stolen session cannot brute-force codes.
   */
  const reauthenticate = async (
    context: AppContext,
    auth: SessionAuth,
    input: TotpReauthInput,
    requireCode: boolean,
  ): Promise<{ user: UserRow } | { response: Response }> => {
    const user = await getActiveUser(context, auth.actorId);
    if (!user) return { response: sessionRequired(context) };

    const keys = await dependencies.getLoginAttemptKeys(context, user.username);
    const config = resolveLoginRateLimitConfig(context.env);
    const current = await checkLoginRateLimit(context.env.storage.db, keys, config);
    if (current.retryAfterSeconds > 0) {
      return { response: dependencies.tooManyLoginAttempts(context, current.retryAfterSeconds) };
    }

    const fail = async (response: Response) => {
      const updated = await recordLoginFailure(context.env.storage.db, keys, config);
      if (updated.retryAfterSeconds > 0) {
        await audit(context.env.storage.db, "user", user.id, "auth.mfa_rate_limited", "user", user.id, {
          retryAfterSeconds: updated.retryAfterSeconds,
        });
        return { response: dependencies.tooManyLoginAttempts(context, updated.retryAfterSeconds) };
      }
      return { response };
    };

    if (!input.password || !(await verifyPassword(input.password, user.password_hash))) {
      return fail(apiError(context, "invalid_current_password", "Current password is incorrect.", 400));
    }

    if (requireCode) {
      const row = await getUserTotp(context.env.storage.db, user.id);
      if (!isTotpEnabled(row)) {
        return { response: apiError(context, "totp_not_enabled", "Two-factor authentication is not enabled.", 409) };
      }
      if (input.recoveryCode && !input.code) {
        if (!(await consumeRecoveryCode(context.env.storage.db, user.id, input.recoveryCode))) {
          return fail(apiError(context, "invalid_recovery_code", "The recovery code is incorrect or was already used.", 400));
        }
        await audit(context.env.storage.db, "user", user.id, "auth.recovery_code_used", "user", user.id, {
          remaining: await countActiveRecoveryCodes(context.env.storage.db, user.id),
          purpose: "reauthenticate",
        });
        return { user };
      }
      const result = input.code
        ? await verifyActiveTotpCode(context.env.storage.db, context.env, row, input.code)
        : "invalid";
      if (result === "unavailable") return { response: totpUnavailable(context) };
      if (result !== "valid") return fail(invalidCode(context));
    }

    return { user };
  };

  app.get("/api/v1/auth/totp", async (context) => {
    const auth = await requireSession(context, dependencies, true);
    if (!auth) return sessionRequired(context);

    const row = await getUserTotp(context.env.storage.db, auth.actorId);
    const enabled = isTotpEnabled(row);
    const reason = unavailableReason(context);
    return context.json({
      enabled,
      enabledAt: enabled ? row.enabled_at : null,
      recoveryCodesRemaining: enabled ? await countActiveRecoveryCodes(context.env.storage.db, auth.actorId) : 0,
      available: reason === null,
      unavailableReason: reason,
      rebindRequired: auth.mfaRestricted === true,
    });
  });

  // Step 1 of enabling or rebinding: issue a pending secret. The active
  // secret, if any, keeps working until the new one is confirmed.
  app.post("/api/v1/auth/totp/setup", zValidator("json", TotpReauthSchema), async (context) => {
    const auth = await requireSession(context, dependencies, true);
    if (!auth) return sessionRequired(context);
    if (dependencies.isDemoEnvironment(context.env)) {
      return forbidden(context, "The demo environment does not allow two-factor authentication.");
    }
    if (!isTotpEncryptionAvailable(context.env)) {
      return apiError(
        context,
        "totp_encryption_unavailable",
        "Configure EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY before enabling two-factor authentication.",
        503,
      );
    }

    const row = await getUserTotp(context.env.storage.db, auth.actorId);
    let user: UserRow | null;
    if (auth.mfaRestricted) {
      // Password and a recovery code were just verified to obtain this session.
      user = await getActiveUser(context, auth.actorId);
      if (!user) return sessionRequired(context);
    } else {
      const result = await reauthenticate(context, auth, context.req.valid("json"), isTotpEnabled(row));
      if ("response" in result) return result.response;
      user = result.user;
    }

    const secret = generateTotpSecret();
    const setupId = newTotpSetupId();
    const now = isoNow();
    const db = context.env.storage.db;
    await db.batch([
      // The setup belongs to the session that just passed identity verification
      // and carries an id the client sends back: verify and confirm accept only
      // that session, and only the setup it was shown, so two tabs of one
      // session cannot finish each other's flow.
      db.prepare(
        `INSERT INTO user_totp (
           user_id, pending_secret_encrypted, pending_created_at, pending_session_id,
           pending_setup_id, pending_attempts, pending_batch_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           pending_secret_encrypted = excluded.pending_secret_encrypted,
           pending_created_at = excluded.pending_created_at,
           pending_verified_step = NULL,
           pending_session_id = excluded.pending_session_id,
           pending_setup_id = excluded.pending_setup_id,
           pending_attempts = 0,
           pending_batch_id = NULL,
           updated_at = excluded.updated_at`,
      ).bind(user.id, await encryptTotpSecret(secret, user.id, context.env), now, auth.sessionId, setupId, now, now),
      db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ? AND status = 'pending'`).bind(user.id),
    ]);

    return context.json({
      setupId,
      secret,
      otpauthUri: buildOtpauthUri(secret, user.username),
      issuer: TOTP_ISSUER,
      accountName: user.username,
      expiresAt: new Date(Date.parse(now) + TOTP_PENDING_TTL_SECONDS * 1000).toISOString(),
    });
  });

  // Step 2: prove the authenticator works, then show recovery codes once.
  app.post("/api/v1/auth/totp/setup/verify", zValidator("json", TotpSetupVerifySchema), async (context) => {
    const auth = await requireSession(context, dependencies, true);
    if (!auth) return sessionRequired(context);

    const input = context.req.valid("json");
    const db = context.env.storage.db;
    const row = await getUserTotp(db, auth.actorId);
    if (!row || !isPendingFresh(row)) return setupExpired(context);
    // Only the session that passed identity verification may continue this
    // setup, and only for the setup it was shown. A newer setup from another
    // tab of the same session replaced this one: refuse it instead of counting
    // the code as a wrong attempt against the newer secret.
    if (row.pending_session_id !== auth.sessionId || row.pending_setup_id !== input.setupId) {
      return setupExpired(context);
    }

    const secret = await decryptTotpSecret(row.pending_secret_encrypted, auth.actorId, context.env);
    if (!secret) return setupExpired(context);
    const step = matchTotpStep(secret, input.code);
    if (step === null) {
      // Wrong codes are capped per pending secret; at the cap the setup is
      // discarded and has to be started again with the password.
      if (await recordPendingSetupFailure(db, row)) {
        await auditStatement(db, "user", auth.actorId, "auth.mfa_rate_limited", "user", auth.actorId, { scope: "setup" }).run();
        return setupExpired(context);
      }
      return invalidCode(context);
    }

    // The verification is bound to the exact secret that was checked: the
    // update only lands while that secret is still pending for this session,
    // and the recovery codes are written only if the update landed.
    const recoveryCodes = generateRecoveryCodes();
    const batchId = newRecoveryCodeBatchId();
    const results = await db.batch([
      db.prepare(
        `UPDATE user_totp SET pending_verified_step = ?, pending_batch_id = ?, updated_at = ?
         WHERE user_id = ? AND pending_secret_encrypted = ? AND pending_session_id = ? AND pending_setup_id = ?`,
      ).bind(step, batchId, isoNow(), auth.actorId, row.pending_secret_encrypted, auth.sessionId, input.setupId),
      ...(await pendingRecoveryCodeStatements(db, auth.actorId, recoveryCodes, {
        batchId, sessionId: auth.sessionId, onlyIfSetupBatch: true,
      })),
    ]);
    // A newer setup replaced the secret while this code was being checked.
    if (Number(results[0]?.meta.changes) !== 1) return setupExpired(context);
    // Confirm must name this batch, so only the codes shown here can be activated.
    return context.json({ recoveryCodes, batchId });
  });

  // Step 3: the user confirmed the codes are saved. Activate atomically.
  app.post("/api/v1/auth/totp/setup/confirm", zValidator("json", TotpBatchConfirmSchema), async (context) => {
    const auth = await requireSession(context, dependencies, true);
    if (!auth) return sessionRequired(context);

    const { batchId } = context.req.valid("json");
    const db = context.env.storage.db;
    const row = await getUserTotp(db, auth.actorId);
    if (!row || !isPendingFresh(row) || row.pending_verified_step === null || !row.pending_batch_id) {
      return setupExpired(context);
    }
    // Only the session that passed identity verification may finish this
    // setup, and only with the batch of codes it was shown. A newer verified
    // setup from another tab of the same session owns a different batch:
    // refuse rather than enable a secret and codes this tab never displayed.
    if (row.pending_session_id !== auth.sessionId || row.pending_batch_id !== batchId) return setupExpired(context);
    if (await countPendingRecoveryCodes(db, auth.actorId, batchId) !== RECOVERY_CODE_COUNT) return setupExpired(context);

    const user = await getActiveUser(context, auth.actorId);
    if (!user) return sessionRequired(context);

    const wasEnabled = isTotpEnabled(row);
    const restricted = auth.mfaRestricted === true;
    const now = isoNow();
    const action = restricted
      ? "auth.totp_rebind_after_recovery"
      : wasEnabled ? "auth.totp_rebind" : "auth.totp_enable";
    // Everything below is a no-op unless user_totp still points at this verified
    // batch, i.e. no concurrent confirm, rebind or new setup got there first.
    // The claim that clears the pointer runs last, inside the same transaction.
    const stillPending = `EXISTS (SELECT 1 FROM user_totp
      WHERE user_id = ? AND pending_batch_id = ? AND pending_verified_step IS NOT NULL)`;
    const results = await db.batch([
      db.prepare(
        `INSERT INTO audit_events (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
         SELECT ?, 'user', ?, ?, 'user', ?, '{}', ? WHERE ${stillPending}`,
      ).bind(createId("audit"), user.id, action, user.id, now, user.id, batchId),
      // Enabling and a voluntary rebind keep every signed-in device; each one
      // is asked for a code at its next sign-in. Only an emergency rebind after
      // a recovery-code sign-in signs the other devices out.
      ...(restricted
        ? [db.prepare(
          `UPDATE sessions SET revoked_at = ?
           WHERE user_id = ? AND id != ? AND revoked_at IS NULL AND ${stillPending}`,
        ).bind(now, user.id, auth.sessionId, user.id, batchId)]
        : []),
      // First enable: tag the password hash so a pre-TOTP backend fails closed
      // for this account after a rollback (see auth-totp.ts). Idempotent.
      ...(!wasEnabled ? [markPasswordHashMfaStatement(db, user.id, now)] : []),
      ...activatePendingRecoveryCodeStatements(db, user.id, batchId),
      db.prepare(`DELETE FROM auth_challenges WHERE user_id = ?`).bind(user.id),
      db.prepare(
        `UPDATE user_totp SET
           secret_encrypted = pending_secret_encrypted,
           enabled_at = COALESCE(enabled_at, ?),
           last_used_step = pending_verified_step,
           pending_secret_encrypted = NULL,
           pending_created_at = NULL,
           pending_verified_step = NULL,
           pending_session_id = NULL,
           pending_attempts = 0,
           pending_batch_id = NULL,
           updated_at = ?
         WHERE user_id = ? AND pending_secret_encrypted = ? AND pending_batch_id = ?
           AND pending_verified_step IS NOT NULL`,
      ).bind(now, now, user.id, row.pending_secret_encrypted, batchId),
    ]);
    if (Number(results[results.length - 1]?.meta.changes) !== 1) {
      // Lost the race against a duplicate confirm of the same setup: nothing
      // above changed anything. Report success if that confirm already enabled
      // exactly this secret; a restricted duplicate cannot be rotated twice.
      const latest = await getUserTotp(db, user.id);
      if (!restricted && isTotpEnabled(latest) && latest.pending_batch_id === null
        && latest.secret_encrypted === row.pending_secret_encrypted) {
        return context.json({ ok: true });
      }
      return setupExpired(context);
    }

    if (!restricted) return context.json({ ok: true });

    // Rotate the restricted session into a normal one for the same device.
    const current = await db.prepare(`SELECT device_id FROM sessions WHERE id = ?`)
      .bind(auth.sessionId).first<{ device_id: string | null }>();
    const session = await dependencies.createSession(context, user, current?.device_id ?? undefined);
    await db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
      .bind(isoNow(), auth.sessionId).run();
    dependencies.setSessionCookie(context, session.token, session.maxAge);
    return context.json({ ok: true, sessionToken: session.token });
  });

  // Regenerating recovery codes is two-step too: old codes stay valid until
  // the user confirms the new ones were saved.
  app.post("/api/v1/auth/totp/recovery-codes", zValidator("json", TotpReauthSchema), async (context) => {
    const auth = await requireSession(context, dependencies);
    if (!auth) return sessionRequired(context);
    const result = await reauthenticate(context, auth, context.req.valid("json"), true);
    if ("response" in result) return result.response;

    const db = context.env.storage.db;
    const recoveryCodes = generateRecoveryCodes();
    const batchId = newRecoveryCodeBatchId();
    await db.batch(await pendingRecoveryCodeStatements(db, auth.actorId, recoveryCodes, {
      batchId, sessionId: auth.sessionId,
    }));
    // Confirm must name this batch, so only the codes shown here can be activated.
    return context.json({ recoveryCodes, batchId });
  });

  app.post("/api/v1/auth/totp/recovery-codes/confirm", zValidator("json", TotpBatchConfirmSchema), async (context) => {
    const auth = await requireSession(context, dependencies);
    if (!auth) return sessionRequired(context);

    const { batchId } = context.req.valid("json");
    const db = context.env.storage.db;
    const row = await getUserTotp(db, auth.actorId);
    if (!isTotpEnabled(row)) {
      return apiError(context, "totp_not_enabled", "Two-factor authentication is not enabled.", 409);
    }
    // Only the session that generated the batch may confirm it, and only the
    // batch it was shown. A batch replaced by a newer one (another tab of the
    // same session) no longer exists, so the stale tab gets 409 instead of
    // activating codes the user never saw.
    const batch = await findRecoveryCodeBatch(db, auth.actorId, batchId, auth.sessionId);
    const expired = () => apiError(context, "recovery_codes_expired", "Generate new recovery codes again.", 409);
    if (!batch || batch.count !== RECOVERY_CODE_COUNT) return expired();
    // A duplicate confirm of a batch this session already activated is a success.
    if (batch.status === "active") return context.json({ ok: true });

    const stillPending = `EXISTS (SELECT 1 FROM user_recovery_codes
      WHERE user_id = ? AND status = 'pending' AND batch_id = ?)`;
    const results = await db.batch([
      db.prepare(
        `INSERT INTO audit_events (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
         SELECT ?, 'user', ?, 'auth.recovery_codes_regenerate', 'user', ?, '{}', ? WHERE ${stillPending}`,
      ).bind(createId("audit"), auth.actorId, auth.actorId, isoNow(), auth.actorId, batchId),
      ...activatePendingRecoveryCodeStatements(db, auth.actorId, batchId),
    ]);
    if (Number(results[results.length - 1]?.meta.changes) !== RECOVERY_CODE_COUNT) {
      // Lost the race against a concurrent confirm: nothing above changed anything.
      return await countActiveRecoveryCodesInBatch(db, auth.actorId, batchId) === RECOVERY_CODE_COUNT
        ? context.json({ ok: true })
        : expired();
    }
    return context.json({ ok: true });
  });

  app.post("/api/v1/auth/totp/disable", zValidator("json", TotpReauthSchema), async (context) => {
    const auth = await requireSession(context, dependencies);
    if (!auth) return sessionRequired(context);
    const result = await reauthenticate(context, auth, context.req.valid("json"), true);
    if ("response" in result) return result.response;

    const db = context.env.storage.db;
    await db.batch([
      db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ?`).bind(auth.actorId),
      db.prepare(`DELETE FROM auth_challenges WHERE user_id = ?`).bind(auth.actorId),
      db.prepare(`DELETE FROM user_totp WHERE user_id = ?`).bind(auth.actorId),
      unmarkPasswordHashMfaStatement(db, auth.actorId, isoNow()),
      auditStatement(db, "user", auth.actorId, "auth.totp_disable", "user", auth.actorId, {}),
    ]);
    return context.json({ ok: true });
  });

  // Second login step. No session exists until this succeeds.
  app.post("/api/v1/auth/login/mfa", zValidator("json", LoginMfaSchema), async (context) => {
    const input: LoginMfaInput = context.req.valid("json");
    const db = context.env.storage.db;
    const expired = () => apiError(
      context,
      "mfa_challenge_expired",
      "This sign-in attempt has expired. Enter your password again.",
      401,
    );

    const challenge = await findLoginChallenge(db, input.challengeToken);
    if (
      !challenge
      || challenge.consumed_at
      || Date.parse(challenge.expires_at) <= Date.now()
      || (challenge.device_id ?? null) !== (input.deviceId ?? null)
    ) {
      return expired();
    }

    const user = await getActiveUser(context, challenge.user_id);
    const row = user ? await getUserTotp(db, user.id) : null;
    if (!user || !isTotpEnabled(row)) return expired();

    const keys = await dependencies.getLoginAttemptKeys(context, user.username);
    const config = resolveLoginRateLimitConfig(context.env);
    const current = await checkLoginRateLimit(db, keys, config);
    if (current.retryAfterSeconds > 0) {
      return dependencies.tooManyLoginAttempts(context, current.retryAfterSeconds);
    }
    if (!(await reserveChallengeAttempt(db, challenge.id))) return expired();

    let verified = false;
    if (input.recoveryCode) {
      verified = await consumeRecoveryCode(db, user.id, input.recoveryCode);
    } else if (input.code) {
      const result = await verifyActiveTotpCode(db, context.env, row, input.code);
      if (result === "unavailable") return totpUnavailable(context);
      verified = result === "valid";
    }

    if (!verified) {
      const updated = await recordLoginFailure(db, keys, config);
      if (updated.retryAfterSeconds > 0) {
        await audit(db, "system", null, "auth.mfa_rate_limited", "user", user.id, {
          retryAfterSeconds: updated.retryAfterSeconds,
        });
        return dependencies.tooManyLoginAttempts(context, updated.retryAfterSeconds);
      }
      return apiError(
        context,
        input.recoveryCode ? "invalid_recovery_code" : "invalid_totp_code",
        input.recoveryCode
          ? "The recovery code is incorrect or was already used."
          : "The authenticator code is incorrect or was already used.",
        401,
      );
    }

    if (!(await consumeLoginChallenge(db, challenge.id))) return expired();
    await clearLoginAttempts(db, keys);

    const usedRecoveryCode = Boolean(input.recoveryCode);
    if (usedRecoveryCode) {
      await audit(db, "user", user.id, "auth.recovery_code_used", "user", user.id, {
        remaining: await countActiveRecoveryCodes(db, user.id),
      });
    }
    return dependencies.finishLogin(context, user, {
      deviceId: input.deviceId,
      locale: input.locale,
      mfaRestricted: usedRecoveryCode,
      auditAction: usedRecoveryCode ? "auth.login_recovery_code" : "auth.login_mfa",
    });
  });
};
