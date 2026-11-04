import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { Secret, TOTP } from "otpauth";
import { hashPassword } from "./auth-crypto.ts";
import { registerAuthRoutes } from "./auth-routes.ts";
import {
  authenticateRequest,
  authenticateSession,
  createSession,
  getBearerToken,
  getInstanceAuthMode,
  getLoginAttemptKeys,
  revokeSession,
  setSessionCookie,
  tooManyLoginAttempts,
  verifyLogin,
} from "./auth-service.ts";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  matchTotpStep,
  normalizeRecoveryCode,
} from "./auth-totp.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { ensureUserWorkspace } from "./workspace-provisioning.ts";

const DEVICE = "device-totp-000000001";
const OTHER_DEVICE = "device-totp-000000002";
const instances = [];

afterEach(() => {
  for (const sqlite of instances.splice(0)) sqlite.close();
});

const ownerHash = (sqlite) => sqlite.query("SELECT password_hash FROM users WHERE id = 'usr_owner'").get().password_hash;
// Hash format accepted by releases that predate TOTP (<= v2.18.0).
const LEGACY_HASH_PATTERN = /^pbkdf2-sha256\$(\d+)\$([^$]+)\$([^$]+)$/;

const codeAt = (secret, offsetSteps = 0) => new TOTP({ secret: Secret.fromBase32(secret) })
  .generate({ timestamp: Date.now() + offsetSteps * 30_000 });

const createInstance = async (envOverrides = {}) => {
  const sqlite = new Database(":memory:");
  instances.push(sqlite);
  for (const path of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(path, "utf8"));
  sqlite.query("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)")
    .run("usr_owner", "owner", await hashPassword("owner-password"), "Owner");

  const app = new Hono();
  registerAuthRoutes(app, {
    authenticateRequest,
    authenticateSession,
    createSession,
    ensureUserWorkspace,
    getBearerToken,
    getInstanceAuthMode,
    getLoginAttemptKeys,
    isDemoEnvironment: () => false,
    isDemoMode: () => false,
    revokeSession,
    setSessionCookie,
    tooManyLoginAttempts,
    verifyLogin,
  });
  const environment = {
    EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "test-credentials-key",
    ...envOverrides,
    storage: createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-totp-unused"),
  };
  const request = async (path, { token, method = "GET", body } = {}) => {
    const response = await app.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, environment);
    return { status: response.status, body: await response.json() };
  };
  const passwordLogin = (deviceId = DEVICE) => request("/api/v1/auth/login", {
    method: "POST",
    body: { username: "owner", password: "owner-password", deviceId },
  });
  const loginToken = async (deviceId = DEVICE) => {
    const response = await passwordLogin(deviceId);
    expect(response.status).toBe(200);
    return response.body.sessionToken;
  };
  const enable = async (token) => {
    const setup = await request("/api/v1/auth/totp/setup", {
      token, method: "POST", body: { password: "owner-password" },
    });
    expect(setup.status).toBe(200);
    const verify = await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { setupId: setup.body.setupId, code: codeAt(setup.body.secret) },
    });
    expect(verify.status).toBe(200);
    const confirm = await request("/api/v1/auth/totp/setup/confirm", {
      token, method: "POST", body: { batchId: verify.body.batchId },
    });
    expect(confirm.status).toBe(200);
    return { secret: setup.body.secret, recoveryCodes: verify.body.recoveryCodes };
  };
  const audits = () => sqlite.query("SELECT action, metadata_json FROM audit_events ORDER BY created_at").all();
  return { sqlite, request, passwordLogin, loginToken, enable, audits, environment };
};

describe("TOTP primitives", () => {
  test("binds ciphertext to the account and decrypts with a rotated key", async () => {
    const env = { EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "current" };
    const encrypted = await encryptTotpSecret("JBSWY3DPEHPK3PXP", "usr_a", env);
    expect(await decryptTotpSecret(encrypted, "usr_b", env)).toBeNull();
    expect(await decryptTotpSecret(encrypted, "usr_a", {
      EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "next",
      EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: "current",
    })).toBe("JBSWY3DPEHPK3PXP");
    expect(await decryptTotpSecret(encrypted, "usr_a", { EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "lost" })).toBeNull();
  });

  test("accepts one step of drift and rejects malformed codes", () => {
    const secret = new Secret({ size: 20 }).base32;
    const step = Math.floor(Date.now() / 30_000);
    expect(matchTotpStep(secret, codeAt(secret))).toBe(step);
    expect(matchTotpStep(secret, codeAt(secret, -1))).toBe(step - 1);
    expect(matchTotpStep(secret, codeAt(secret, 3))).toBeNull();
    expect(matchTotpStep(secret, "12345")).toBeNull();
  });

  test("generates ten distinct readable recovery codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(normalizeRecoveryCode(" abcd-efgh-ijkl ")).toBe("ABCDEFGH1JK1");
  });
});

describe("TOTP routes", () => {
  test("sessions created before the TOTP migrations keep working after them", async () => {
    const sqlite = new Database(":memory:");
    instances.push(sqlite);
    const files = globSync("migrations/*.sql").sort();
    // 0088 introduced TOTP; later migrations in this feature (0089, 0090) build on it.
    const migrationNumber = (file) => Number(file.match(/(\d{4})_[^/]*\.sql$/)[1]);
    for (const path of files.filter((file) => migrationNumber(file) < 88)) sqlite.exec(readFileSync(path, "utf8"));
    sqlite.query("INSERT INTO users (id, username, password_hash) VALUES ('usr_owner', 'owner', 'unused')").run();
    const { sha256 } = await import("./hash-utils.ts");
    sqlite.query(
      `INSERT INTO sessions (id, user_id, token_hash, device_id, expires_at, created_at, last_seen_at)
       VALUES ('sess_old', 'usr_owner', ?, 'old-device', ?, ?, ?)`,
    ).run(await sha256("old-token"), new Date(Date.now() + 86_400_000).toISOString(),
      new Date().toISOString(), new Date().toISOString());
    for (const path of files.filter((file) => migrationNumber(file) >= 88)) sqlite.exec(readFileSync(path, "utf8"));
    const auth = await authenticateRequestFor(sqlite, "old-token");
    expect(auth).toMatchObject({ kind: "user", actorId: "usr_owner", sessionId: "sess_old" });
    expect(auth.mfaRestricted).toBeUndefined();
  });

  test("accounts without TOTP keep the one-step password login", async () => {
    const { passwordLogin } = await createInstance();
    const response = await passwordLogin();
    expect(response.status).toBe(200);
    expect(response.body.sessionToken).toBeString();
    expect(response.body.mfaRebindRequired).toBeUndefined();
  });

  test("refuses to enable without a deployment encryption key", async () => {
    const { request, loginToken } = await createInstance({ EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: undefined });
    const token = await loginToken();
    const status = await request("/api/v1/auth/totp", { token });
    expect(status.body).toMatchObject({ enabled: false, available: false, unavailableReason: "encryption_unavailable" });
    const setup = await request("/api/v1/auth/totp/setup", {
      token, method: "POST", body: { password: "owner-password" },
    });
    expect(setup.status).toBe(503);
    expect(setup.body.error.code).toBe("totp_encryption_unavailable");
  });

  test("enables only after verify and confirm, and stores no plaintext", async () => {
    const { request, loginToken, sqlite, audits } = await createInstance();
    const token = await loginToken();
    const otherToken = await loginToken(OTHER_DEVICE);

    const wrongPassword = await request("/api/v1/auth/totp/setup", {
      token, method: "POST", body: { password: "nope" },
    });
    expect(wrongPassword.body.error.code).toBe("invalid_current_password");

    const setup = await request("/api/v1/auth/totp/setup", {
      token, method: "POST", body: { password: "owner-password" },
    });
    expect(setup.body.otpauthUri).toStartWith("otpauth://totp/EdgeEver:owner?");
    expect(setup.body.setupId).toStartWith("setup_");
    expect((await request("/api/v1/auth/totp", { token })).body.enabled).toBe(false);
    // Nothing to confirm yet; and a confirm must always name the batch it saw.
    expect((await request("/api/v1/auth/totp/setup/confirm", {
      token, method: "POST", body: { batchId: "rcb_00000000000000000000000000000000" },
    })).status).toBe(409);
    expect((await request("/api/v1/auth/totp/setup/confirm", { token, method: "POST", body: {} })).status).toBe(400);

    const badCode = await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { setupId: setup.body.setupId, code: "000000" === codeAt(setup.body.secret) ? "111111" : "000000" },
    });
    expect(badCode.body.error.code).toBe("invalid_totp_code");

    const verify = await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { setupId: setup.body.setupId, code: codeAt(setup.body.secret) },
    });
    expect(verify.body.recoveryCodes).toHaveLength(10);
    expect(verify.body.batchId).toStartWith("rcb_");
    expect((await request("/api/v1/auth/totp", { token })).body.enabled).toBe(false);

    expect((await request("/api/v1/auth/totp/setup/confirm", {
      token, method: "POST", body: { batchId: verify.body.batchId },
    })).status).toBe(200);
    expect((await request("/api/v1/auth/totp", { token })).body).toMatchObject({
      enabled: true, recoveryCodesRemaining: 10, rebindRequired: false,
    });

    // Enabling keeps every signed-in device; each is asked for a code at its next sign-in.
    expect((await request("/api/v1/auth/totp", { token: otherToken })).status).toBe(200);
    // The password hash is re-tagged so a pre-TOTP backend fails closed for this account.
    expect(ownerHash(sqlite)).toMatch(/^pbkdf2-sha256-mfa\$/);

    const stored = JSON.stringify(sqlite.query("SELECT * FROM user_totp").all())
      + JSON.stringify(sqlite.query("SELECT * FROM user_recovery_codes").all())
      + JSON.stringify(audits());
    expect(stored).not.toContain(setup.body.secret);
    for (const code of verify.body.recoveryCodes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(normalizeRecoveryCode(code));
    }
    expect(audits().map((row) => row.action)).toContain("auth.totp_enable");
  });

  test("password login returns a 401 challenge and the code step issues the session", async () => {
    const { request, passwordLogin, loginToken, enable, sqlite } = await createInstance();
    const { secret } = await enable(await loginToken());
    const sessionsBefore = sqlite.query("SELECT COUNT(*) AS count FROM sessions").get().count;

    const first = await passwordLogin();
    expect(first.status).toBe(401);
    expect(first.body.error.code).toBe("mfa_required");
    expect(first.body.sessionToken).toBeUndefined();
    expect(first.body.error.details.methods).toEqual(["totp", "recovery_code"]);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM sessions").get().count).toBe(sessionsBefore);
    const { challengeToken } = first.body.error.details;
    expect(sqlite.query("SELECT token_hash FROM auth_challenges").get().token_hash).not.toBe(challengeToken);

    const otherDevice = await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken, code: codeAt(secret, 1), deviceId: OTHER_DEVICE },
    });
    expect(otherDevice.body.error.code).toBe("mfa_challenge_expired");

    // The code from enrollment's step is already burned: no replay.
    const usedStep = sqlite.query("SELECT last_used_step FROM user_totp").get().last_used_step;
    const usedCode = new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: usedStep * 30_000 });
    const replay = await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken, code: usedCode, deviceId: DEVICE },
    });
    expect(replay.status).toBe(401);

    const ok = await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken, code: codeAt(secret, 1), deviceId: DEVICE },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ authenticated: true, user: { username: "owner" } });
    expect(ok.body.mfaRebindRequired).toBeUndefined();

    const reused = await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken, code: codeAt(secret, 1), deviceId: DEVICE },
    });
    expect(reused.body.error.code).toBe("mfa_challenge_expired");
  });

  test("a challenge allows five attempts, then the account limiter applies", async () => {
    const { request, passwordLogin, loginToken, enable, audits } = await createInstance();
    const { secret } = await enable(await loginToken());
    const wrong = codeAt(secret, 1) === "123456" ? "654321" : "123456";

    const { challengeToken } = (await passwordLogin()).body.error.details;
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await request("/api/v1/auth/login/mfa", {
        method: "POST", body: { challengeToken, code: wrong, deviceId: DEVICE },
      })).status);
    }
    // Five failures exhaust the default username limiter on the fifth attempt.
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses[4]).toBe(429);
    expect(statuses[5]).toBe(429);
    expect(audits().map((row) => row.action)).toContain("auth.mfa_rate_limited");
    expect((await passwordLogin()).status).toBe(429);
  });

  test("a recovery code yields a restricted session that must rebind", async () => {
    const { request, passwordLogin, loginToken, enable, sqlite, audits } = await createInstance();
    const firstToken = await loginToken();
    const { recoveryCodes } = await enable(firstToken);

    const challenge = (await passwordLogin(OTHER_DEVICE)).body.error.details.challengeToken;
    const recovered = await request("/api/v1/auth/login/mfa", {
      method: "POST",
      body: { challengeToken: challenge, recoveryCode: recoveryCodes[0].toLowerCase(), deviceId: OTHER_DEVICE },
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.mfaRebindRequired).toBe(true);
    const restricted = recovered.body.sessionToken;
    const row = sqlite.query("SELECT mfa_restricted, expires_at FROM sessions WHERE mfa_restricted = 1").get();
    expect(Date.parse(row.expires_at) - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);

    // Fail closed everywhere except the rebind routes.
    expect((await request("/api/v1/auth/sessions", { token: restricted })).status).toBe(401);
    expect(await authenticateRequestFor(sqlite, restricted)).toBeNull();
    expect((await request("/api/v1/auth/session", { token: restricted })).body).toMatchObject({
      authenticated: true, mfaRebindRequired: true,
    });
    expect((await request("/api/v1/auth/totp/disable", {
      token: restricted, method: "POST", body: { password: "owner-password" },
    })).status).toBe(401);

    // The same recovery code cannot be used twice.
    const again = (await passwordLogin(OTHER_DEVICE)).body.error.details.challengeToken;
    expect((await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken: again, recoveryCode: recoveryCodes[0], deviceId: OTHER_DEVICE },
    })).body.error.code).toBe("invalid_recovery_code");

    const setup = await request("/api/v1/auth/totp/setup", { token: restricted, method: "POST", body: {} });
    expect(setup.status).toBe(200);
    const verify = await request("/api/v1/auth/totp/setup/verify", {
      token: restricted, method: "POST", body: { setupId: setup.body.setupId, code: codeAt(setup.body.secret) },
    });
    const confirm = await request("/api/v1/auth/totp/setup/confirm", {
      token: restricted, method: "POST", body: { batchId: verify.body.batchId },
    });
    expect(confirm.status).toBe(200);
    const fresh = confirm.body.sessionToken;
    expect(fresh).toBeString();

    expect((await request("/api/v1/auth/session", { token: restricted })).body.authenticated).toBe(false);
    expect((await request("/api/v1/auth/session", { token: firstToken })).body.authenticated).toBe(false);
    const status = await request("/api/v1/auth/totp", { token: fresh });
    expect(status.body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10, rebindRequired: false });
    expect(await authenticateRequestFor(sqlite, fresh)).not.toBeNull();

    // Old codes are gone; new codes work.
    const next = (await passwordLogin()).body.error.details.challengeToken;
    expect((await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken: next, recoveryCode: recoveryCodes[1], deviceId: DEVICE },
    })).status).toBe(401);
    const last = (await passwordLogin()).body.error.details.challengeToken;
    expect((await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken: last, recoveryCode: verify.body.recoveryCodes[0], deviceId: DEVICE },
    })).status).toBe(200);

    const actions = audits().map((entry) => entry.action);
    expect(actions).toContain("auth.recovery_code_used");
    expect(actions).toContain("auth.totp_rebind_after_recovery");
  });

  test("regenerating codes keeps the old batch until confirmed", async () => {
    const { request, loginToken, enable } = await createInstance();
    const token = await loginToken();
    const { secret, recoveryCodes } = await enable(token);

    const missingCode = await request("/api/v1/auth/totp/recovery-codes", {
      token, method: "POST", body: { password: "owner-password" },
    });
    expect(missingCode.body.error.code).toBe("invalid_totp_code");

    const generated = await request("/api/v1/auth/totp/recovery-codes", {
      token, method: "POST", body: { password: "owner-password", code: codeAt(secret, 1) },
    });
    expect(generated.body.recoveryCodes).toHaveLength(10);
    expect(generated.body.recoveryCodes).not.toEqual(recoveryCodes);

    expect(generated.body.batchId).toStartWith("rcb_");
    const confirm = await request("/api/v1/auth/totp/recovery-codes/confirm", {
      token, method: "POST", body: { batchId: generated.body.batchId },
    });
    expect(confirm.status).toBe(200);
    expect((await request("/api/v1/auth/totp", { token })).body.recoveryCodesRemaining).toBe(10);
  });

  test("a voluntary rebind keeps other devices and swaps the secret on confirm", async () => {
    const { request, loginToken, enable, passwordLogin, sqlite } = await createInstance();
    const token = await loginToken();
    const { secret } = await enable(token);
    // A device that signed in before the rebind (inserted directly so no step is consumed).
    const otherToken = await loginTokenWithoutTotp(sqlite, OTHER_DEVICE);

    const withoutCode = await request("/api/v1/auth/totp/setup", {
      token, method: "POST", body: { password: "owner-password" },
    });
    expect(withoutCode.body.error.code).toBe("invalid_totp_code");

    const setup = await request("/api/v1/auth/totp/setup", {
      token, method: "POST", body: { password: "owner-password", code: codeAt(secret, 1) },
    });
    expect(setup.status).toBe(200);
    // Until confirmed, the active secret is unchanged.
    const before = sqlite.query("SELECT secret_encrypted, pending_secret_encrypted FROM user_totp").get();
    expect(before.pending_secret_encrypted).not.toBe(before.secret_encrypted);

    const verify = await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { setupId: setup.body.setupId, code: codeAt(setup.body.secret) },
    });
    expect((await request("/api/v1/auth/totp/setup/confirm", {
      token, method: "POST", body: { batchId: verify.body.batchId },
    })).status).toBe(200);
    expect((await request("/api/v1/auth/totp", { token: otherToken })).status).toBe(200);

    const { challengeToken } = (await passwordLogin()).body.error.details;
    expect((await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken, code: codeAt(setup.body.secret, 1), deviceId: DEVICE },
    })).status).toBe(200);
  });

  test("disabling requires password and code and restores one-step login", async () => {
    const { request, loginToken, enable, passwordLogin, audits } = await createInstance();
    const token = await loginToken();
    const { secret } = await enable(token);

    expect((await request("/api/v1/auth/totp/disable", {
      token, method: "POST", body: { password: "owner-password" },
    })).status).toBe(400);
    const disabled = await request("/api/v1/auth/totp/disable", {
      token, method: "POST", body: { password: "owner-password", code: codeAt(secret, 1) },
    });
    expect(disabled.status).toBe(200);
    expect((await passwordLogin()).status).toBe(200);
    expect(audits().map((row) => row.action)).toContain("auth.totp_disable");
  });

  test("a recovery code can stand in for the code when disabling", async () => {
    const { request, loginToken, enable, passwordLogin } = await createInstance();
    const token = await loginToken();
    const { recoveryCodes } = await enable(token);
    expect((await request("/api/v1/auth/totp/disable", {
      token, method: "POST", body: { password: "owner-password", recoveryCode: "AAAA-BBBB-CCCC" },
    })).body.error.code).toBe("invalid_recovery_code");
    expect((await request("/api/v1/auth/totp/disable", {
      token, method: "POST", body: { password: "owner-password", recoveryCode: recoveryCodes[3] },
    })).status).toBe(200);
    expect((await passwordLogin()).status).toBe(200);
  });
});

const loginTokenWithoutTotp = async (sqlite, deviceId) => {
  const token = `direct-${deviceId}`;
  const { sha256 } = await import("./hash-utils.ts");
  sqlite.query(
    `INSERT INTO sessions (id, user_id, token_hash, device_id, expires_at, created_at, last_seen_at)
     VALUES (?, 'usr_owner', ?, ?, ?, ?, ?)`,
  ).run(`sess_${deviceId}`, await sha256(token), deviceId, new Date(Date.now() + 86_400_000).toISOString(),
    new Date().toISOString(), new Date().toISOString());
  return token;
};

// Simulates every business route: the default authenticateRequest call.
const authenticateRequestFor = async (sqlite, token) => {
  const app = new Hono();
  let result;
  app.get("/probe", async (context) => {
    result = await authenticateRequest(context, false);
    return context.json({});
  });
  await app.request("/probe", { headers: { Authorization: `Bearer ${token}` } }, {
    storage: createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-totp-unused"),
  });
  return result;
};

describe("TOTP rollback protection", () => {
  test("the stored hash is only accepted by this version while TOTP is on, and restored when it is off", async () => {
    const { request, passwordLogin, loginToken, enable, sqlite } = await createInstance();
    const plainBefore = ownerHash(sqlite);
    expect(LEGACY_HASH_PATTERN.test(plainBefore)).toBe(true);

    const token = await loginToken();
    const { secret } = await enable(token);
    const tagged = ownerHash(sqlite);
    // Same salt and digest, different tag: a pre-TOTP backend cannot verify it.
    expect(tagged.split("$").slice(1)).toEqual(plainBefore.split("$").slice(1));
    expect(LEGACY_HASH_PATTERN.test(tagged)).toBe(false);
    // This version still verifies the password and asks for the second factor.
    expect((await passwordLogin(OTHER_DEVICE)).body.error.code).toBe("mfa_required");

    const disable = await request("/api/v1/auth/totp/disable", {
      token, method: "POST", body: { password: "owner-password", code: codeAt(secret, 1) },
    });
    expect(disable.status).toBe(200);
    expect(ownerHash(sqlite)).toBe(plainBefore);
    expect((await passwordLogin(OTHER_DEVICE)).status).toBe(200);
  });

  test("changing the password while TOTP is on keeps the tag", async () => {
    const { request, loginToken, enable, sqlite } = await createInstance();
    const token = await loginToken();
    await enable(token);

    const change = await request("/api/v1/auth/change-password", {
      token, method: "POST",
      body: { currentPassword: "owner-password", newPassword: "new-owner-password", confirmPassword: "new-owner-password" },
    });
    expect(change.status).toBe(200);
    expect(ownerHash(sqlite)).toMatch(/^pbkdf2-sha256-mfa\$/);
    expect(LEGACY_HASH_PATTERN.test(ownerHash(sqlite))).toBe(false);

    const login = await request("/api/v1/auth/login", {
      method: "POST", body: { username: "owner", password: "new-owner-password", deviceId: OTHER_DEVICE },
    });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("mfa_required");
  });
});

describe("TOTP concurrency and flow binding", () => {
  const wrongCode = (secret) => (codeAt(secret) === "000000" ? "111111" : "000000");
  const unusedActive = (sqlite) => sqlite
    .query("SELECT COUNT(*) AS count FROM user_recovery_codes WHERE status = 'active' AND used_at IS NULL").get().count;
  const pendingCount = (sqlite) => sqlite
    .query("SELECT COUNT(*) AS count FROM user_recovery_codes WHERE status = 'pending'").get().count;

  test("concurrent confirms of one enrollment keep exactly one batch of recovery codes", async () => {
    const { request, loginToken, sqlite, audits } = await createInstance();
    const token = await loginToken();
    const setup = await request("/api/v1/auth/totp/setup", { token, method: "POST", body: { password: "owner-password" } });
    const verify = await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { setupId: setup.body.setupId, code: codeAt(setup.body.secret) },
    });
    expect(verify.status).toBe(200);

    const confirm = () => request("/api/v1/auth/totp/setup/confirm", {
      token, method: "POST", body: { batchId: verify.body.batchId },
    });
    const results = await Promise.all([confirm(), confirm(), confirm()]);
    expect(results.some((result) => result.status === 200)).toBe(true);
    expect(results.every((result) => result.status === 200 || result.status === 409)).toBe(true);

    expect(unusedActive(sqlite)).toBe(10);
    expect(pendingCount(sqlite)).toBe(0);
    expect((await request("/api/v1/auth/totp", { token })).body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
    expect(audits().filter((row) => row.action === "auth.totp_enable")).toHaveLength(1);
  });

  test("concurrent confirms of regenerated codes keep exactly one batch", async () => {
    const { request, passwordLogin, loginToken, enable, sqlite, audits } = await createInstance();
    const token = await loginToken();
    const { secret, recoveryCodes } = await enable(token);
    const regenerate = await request("/api/v1/auth/totp/recovery-codes", {
      token, method: "POST", body: { password: "owner-password", code: codeAt(secret, 1) },
    });
    expect(regenerate.status).toBe(200);
    expect(regenerate.body.recoveryCodes).toHaveLength(10);

    const confirm = () => request("/api/v1/auth/totp/recovery-codes/confirm", {
      token, method: "POST", body: { batchId: regenerate.body.batchId },
    });
    const results = await Promise.all([confirm(), confirm(), confirm()]);
    expect(results.some((result) => result.status === 200)).toBe(true);
    expect(results.every((result) => result.status === 200 || result.status === 409)).toBe(true);
    expect(unusedActive(sqlite)).toBe(10);
    expect(audits().filter((row) => row.action === "auth.recovery_codes_regenerate")).toHaveLength(1);

    // The old batch is gone, the new one works.
    const challenge = (await passwordLogin(OTHER_DEVICE)).body.error.details.challengeToken;
    expect((await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken: challenge, recoveryCode: recoveryCodes[0], deviceId: OTHER_DEVICE },
    })).body.error.code).toBe("invalid_recovery_code");
    const next = (await passwordLogin(OTHER_DEVICE)).body.error.details.challengeToken;
    expect((await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken: next, recoveryCode: regenerate.body.recoveryCodes[0], deviceId: OTHER_DEVICE },
    })).status).toBe(200);
  });

  test("a verification only counts for the secret it checked", async () => {
    const { request, loginToken, sqlite, environment } = await createInstance();
    const token = await loginToken();
    const setup = async () => (await request("/api/v1/auth/totp/setup", { token, method: "POST", body: { password: "owner-password" } })).body;
    const verify = (flow, code) => request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { setupId: flow.setupId, code },
    });
    const confirm = (batchId) => request("/api/v1/auth/totp/setup/confirm", { token, method: "POST", body: { batchId } });

    // Secret A is replaced by B before A's code arrives: the request names
    // setup A, which no longer exists, so it is refused without touching B.
    const a = await setup();
    await setup();
    const stale = await verify(a, codeAt(a.secret));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("totp_setup_expired");
    expect(pendingCount(sqlite)).toBe(0);
    const row = sqlite.query("SELECT pending_verified_step, pending_attempts FROM user_totp").get();
    expect(row.pending_verified_step).toBeNull();
    expect(row.pending_attempts).toBe(0);
    expect((await confirm("rcb_00000000000000000000000000000000")).status).toBe(409);

    // Racing a verification of X against a new setup (Y), whatever the
    // interleaving, never leaves a confirmable state: either the setup ran last
    // and cleared the verification, or the verification saw Y and was refused,
    // or it read X, lost to Y and its write was refused.
    for (let round = 0; round < 8; round += 1) {
      const x = await setup();
      const [raced] = await Promise.all([verify(x, codeAt(x.secret)), setup()]);
      expect([200, 409]).toContain(raced.status);
      const pending = sqlite.query("SELECT pending_verified_step, pending_batch_id FROM user_totp").get();
      expect(pending.pending_verified_step).toBeNull();
      expect(pending.pending_batch_id).toBeNull();
      expect(pendingCount(sqlite)).toBe(0);
      expect((await confirm(raced.body.batchId ?? "rcb_00000000000000000000000000000000")).status).toBe(409);
    }
    expect((await request("/api/v1/auth/totp", { token })).body.enabled).toBe(false);

    // The honest path: verify the current secret, then confirm enables exactly it.
    const c = await setup();
    const verified = await verify(c, codeAt(c.secret));
    expect(verified.status).toBe(200);
    expect((await confirm(verified.body.batchId)).status).toBe(200);
    const stored = sqlite.query("SELECT secret_encrypted FROM user_totp").get().secret_encrypted;
    expect(await decryptTotpSecret(stored, "usr_owner", environment)).toBe(c.secret);
  });

  test("wrong enrollment codes are capped and discard the setup", async () => {
    const { request, loginToken, sqlite, audits } = await createInstance();
    const token = await loginToken();
    const { secret, setupId } = (await request("/api/v1/auth/totp/setup", {
      token, method: "POST", body: { password: "owner-password" },
    })).body;
    const verify = (code) => request("/api/v1/auth/totp/setup/verify", { token, method: "POST", body: { setupId, code } });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await verify(wrongCode(secret))).body.error.code).toBe("invalid_totp_code");
    }
    const fifth = await verify(wrongCode(secret));
    expect(fifth.status).toBe(409);
    expect(fifth.body.error.code).toBe("totp_setup_expired");
    expect(sqlite.query("SELECT pending_secret_encrypted FROM user_totp").get().pending_secret_encrypted).toBeNull();
    // The right code no longer helps; the user has to start again with the password.
    expect((await verify(codeAt(secret))).body.error.code).toBe("totp_setup_expired");
    expect((await request("/api/v1/auth/totp", { token })).body.enabled).toBe(false);
    expect(audits().map((row) => row.action)).toContain("auth.mfa_rate_limited");
  });

  test("only the session that passed identity verification can continue or confirm a flow", async () => {
    const { request, loginToken, sqlite } = await createInstance();
    const owner = await loginToken();
    const other = await loginToken(OTHER_DEVICE);
    const { secret, setupId } = (await request("/api/v1/auth/totp/setup", {
      token: owner, method: "POST", body: { password: "owner-password" },
    })).body;

    const verifyAs = (token, code) => request("/api/v1/auth/totp/setup/verify", { token, method: "POST", body: { setupId, code } });
    const confirmAs = (token, batchId) => request("/api/v1/auth/totp/setup/confirm", { token, method: "POST", body: { batchId } });
    expect((await verifyAs(other, codeAt(secret))).body.error.code).toBe("totp_setup_expired");
    expect((await confirmAs(other, "rcb_00000000000000000000000000000000")).body.error.code).toBe("totp_setup_expired");
    expect(pendingCount(sqlite)).toBe(0);

    const verified = await verifyAs(owner, codeAt(secret));
    expect(verified.status).toBe(200);
    // Even with the right batch id, another session cannot finish the owner's flow.
    expect((await confirmAs(other, verified.body.batchId)).body.error.code).toBe("totp_setup_expired");
    expect((await request("/api/v1/auth/totp", { token: owner })).body.enabled).toBe(false);
    expect((await confirmAs(owner, verified.body.batchId)).status).toBe(200);
    // Enabling kept the other device signed in; it still cannot act on the owner's flows.
    expect((await request("/api/v1/auth/totp", { token: other })).status).toBe(200);

    const regenerate = await request("/api/v1/auth/totp/recovery-codes", {
      token: owner, method: "POST", body: { password: "owner-password", code: codeAt(secret, 1) },
    });
    expect(regenerate.status).toBe(200);
    const regenConfirm = (token) => request("/api/v1/auth/totp/recovery-codes/confirm", {
      token, method: "POST", body: { batchId: regenerate.body.batchId },
    });
    expect((await regenConfirm(other)).body.error.code).toBe("recovery_codes_expired");
    expect(unusedActive(sqlite)).toBe(10);
    expect((await regenConfirm(owner)).status).toBe(200);
  });

  test("a confirm only activates the batch of codes this tab was shown", async () => {
    const { request, passwordLogin, loginToken, enable, sqlite } = await createInstance();
    const token = await loginToken();
    const { secret, recoveryCodes } = await enable(token);
    const regenerate = (second) => request("/api/v1/auth/totp/recovery-codes", {
      token, method: "POST", body: { password: "owner-password", ...second },
    });
    const confirm = (batchId) => request("/api/v1/auth/totp/recovery-codes/confirm", { token, method: "POST", body: { batchId } });
    const loginWith = async (recoveryCode) => {
      const { challengeToken } = (await passwordLogin(OTHER_DEVICE)).body.error.details;
      return request("/api/v1/auth/login/mfa", { method: "POST", body: { challengeToken, recoveryCode, deviceId: OTHER_DEVICE } });
    };

    // Two tabs of one session: A generates a batch, then B generates another
    // (B re-verifies with a recovery code, so one of the original ten is spent).
    const a = await regenerate({ code: codeAt(secret, 1) });
    const b = await regenerate({ recoveryCode: recoveryCodes[0] });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.batchId).not.toBe(b.body.batchId);

    // Confirming from tab A must not activate B's codes behind the user's back.
    const stale = await confirm(a.body.batchId);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("recovery_codes_expired");
    expect(unusedActive(sqlite)).toBe(9);
    expect(pendingCount(sqlite)).toBe(10);
    expect((await request("/api/v1/auth/totp", { token })).body.recoveryCodesRemaining).toBe(9);

    // Tab B confirms what it displayed; A's codes were never valid.
    expect((await confirm(b.body.batchId)).status).toBe(200);
    expect(unusedActive(sqlite)).toBe(10);
    expect((await loginWith(a.body.recoveryCodes[0])).body.error.code).toBe("invalid_recovery_code");
    expect((await loginWith(recoveryCodes[1])).body.error.code).toBe("invalid_recovery_code");
    expect((await loginWith(b.body.recoveryCodes[0])).status).toBe(200);
    // A confirm that names no batch is rejected before anything is read.
    expect((await request("/api/v1/auth/totp/recovery-codes/confirm", { token, method: "POST", body: {} })).status).toBe(400);
  });

  test("a confirm only enables the setup this tab verified", async () => {
    const { request, passwordLogin, loginToken, sqlite, environment } = await createInstance();
    const token = await loginToken();
    const setup = async () => (await request("/api/v1/auth/totp/setup", { token, method: "POST", body: { password: "owner-password" } })).body;
    const verify = (flow, code) => request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { setupId: flow.setupId, code },
    });
    const confirm = (batchId) => request("/api/v1/auth/totp/setup/confirm", { token, method: "POST", body: { batchId } });
    const loginWith = async (recoveryCode) => {
      const { challengeToken } = (await passwordLogin(OTHER_DEVICE)).body.error.details;
      return request("/api/v1/auth/login/mfa", { method: "POST", body: { challengeToken, recoveryCode, deviceId: OTHER_DEVICE } });
    };

    // Tab A scans secret A and verifies it; tab B (same session) starts over and verifies secret B.
    const a = await setup();
    const verifiedA = await verify(a, codeAt(a.secret));
    expect(verifiedA.status).toBe(200);
    const b = await setup();
    // A's setup is gone: its code is refused as an expired setup, not counted as a wrong code for B.
    const staleVerify = await verify(a, codeAt(a.secret));
    expect(staleVerify.status).toBe(409);
    expect(staleVerify.body.error.code).toBe("totp_setup_expired");
    expect(sqlite.query("SELECT pending_attempts FROM user_totp").get().pending_attempts).toBe(0);
    const verifiedB = await verify(b, codeAt(b.secret));
    expect(verifiedB.status).toBe(200);
    expect(verifiedB.body.batchId).not.toBe(verifiedA.body.batchId);

    // Tab A confirms the codes it displayed: refused, and nothing is enabled.
    const staleConfirm = await confirm(verifiedA.body.batchId);
    expect(staleConfirm.status).toBe(409);
    expect(staleConfirm.body.error.code).toBe("totp_setup_expired");
    expect((await request("/api/v1/auth/totp", { token })).body.enabled).toBe(false);
    expect(unusedActive(sqlite)).toBe(0);

    // Tab B confirms its own batch: exactly secret B and B's codes become active.
    expect((await confirm(verifiedB.body.batchId)).status).toBe(200);
    const stored = sqlite.query("SELECT secret_encrypted FROM user_totp").get().secret_encrypted;
    expect(await decryptTotpSecret(stored, "usr_owner", environment)).toBe(b.secret);
    expect((await loginWith(verifiedA.body.recoveryCodes[0])).body.error.code).toBe("invalid_recovery_code");
    expect((await loginWith(verifiedB.body.recoveryCodes[0])).status).toBe(200);
    // Requests without the flow ids are rejected before anything is read.
    expect((await request("/api/v1/auth/totp/setup/verify", { token, method: "POST", body: { code: "123456" } })).status).toBe(400);
    expect((await request("/api/v1/auth/totp/setup/confirm", { token, method: "POST", body: {} })).status).toBe(400);
  });

  test("restricted sessions live under a token hash a pre-TOTP backend never looks up", async () => {
    const { request, passwordLogin, loginToken, enable, sqlite } = await createInstance();
    const { sha256 } = await import("./hash-utils.ts");
    const { recoveryCodes } = await enable(await loginToken());

    const challenge = (await passwordLogin(OTHER_DEVICE)).body.error.details.challengeToken;
    const recovered = await request("/api/v1/auth/login/mfa", {
      method: "POST", body: { challengeToken: challenge, recoveryCode: recoveryCodes[0], deviceId: OTHER_DEVICE },
    });
    expect(recovered.body.mfaRebindRequired).toBe(true);
    const restricted = recovered.body.sessionToken;

    // Releases before TOTP look sessions up by sha256(token): that finds nothing.
    const legacyHash = await sha256(restricted);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?").get(legacyHash).count).toBe(0);
    expect(sqlite.query("SELECT token_hash FROM sessions WHERE mfa_restricted = 1").get().token_hash).not.toBe(legacyHash);
    // This release still resolves it, as a restricted session.
    expect((await request("/api/v1/auth/session", { token: restricted })).body).toMatchObject({
      authenticated: true, mfaRebindRequired: true,
    });

    // After the rebind the fresh session is a normal one under the plain hash.
    const setup = await request("/api/v1/auth/totp/setup", { token: restricted, method: "POST", body: {} });
    const verify = await request("/api/v1/auth/totp/setup/verify", {
      token: restricted, method: "POST", body: { setupId: setup.body.setupId, code: codeAt(setup.body.secret) },
    });
    expect(verify.status).toBe(200);
    const confirm = await request("/api/v1/auth/totp/setup/confirm", {
      token: restricted, method: "POST", body: { batchId: verify.body.batchId },
    });
    expect(confirm.status).toBe(200);
    const fresh = confirm.body.sessionToken;
    expect(sqlite.query("SELECT mfa_restricted FROM sessions WHERE token_hash = ?").get(await sha256(fresh)).mfa_restricted).toBe(0);
    expect((await request("/api/v1/auth/session", { token: restricted })).body.authenticated).toBe(false);
  });
});
