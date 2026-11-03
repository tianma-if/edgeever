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
      token, method: "POST", body: { code: codeAt(setup.body.secret) },
    });
    expect(verify.status).toBe(200);
    const confirm = await request("/api/v1/auth/totp/setup/confirm", { token, method: "POST" });
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
  test("sessions created before migration 0088 keep working after it", async () => {
    const sqlite = new Database(":memory:");
    instances.push(sqlite);
    const files = globSync("migrations/*.sql").sort();
    for (const path of files.filter((file) => !file.includes("0088_"))) sqlite.exec(readFileSync(path, "utf8"));
    sqlite.query("INSERT INTO users (id, username, password_hash) VALUES ('usr_owner', 'owner', 'unused')").run();
    const { sha256 } = await import("./hash-utils.ts");
    sqlite.query(
      `INSERT INTO sessions (id, user_id, token_hash, device_id, expires_at, created_at, last_seen_at)
       VALUES ('sess_old', 'usr_owner', ?, 'old-device', ?, ?, ?)`,
    ).run(await sha256("old-token"), new Date(Date.now() + 86_400_000).toISOString(),
      new Date().toISOString(), new Date().toISOString());
    for (const path of files.filter((file) => file.includes("0088_"))) sqlite.exec(readFileSync(path, "utf8"));
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
    expect((await request("/api/v1/auth/totp", { token })).body.enabled).toBe(false);
    expect((await request("/api/v1/auth/totp/setup/confirm", { token, method: "POST" })).status).toBe(409);

    const badCode = await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { code: "000000" === codeAt(setup.body.secret) ? "111111" : "000000" },
    });
    expect(badCode.body.error.code).toBe("invalid_totp_code");

    const verify = await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { code: codeAt(setup.body.secret) },
    });
    expect(verify.body.recoveryCodes).toHaveLength(10);
    expect((await request("/api/v1/auth/totp", { token })).body.enabled).toBe(false);

    expect((await request("/api/v1/auth/totp/setup/confirm", { token, method: "POST" })).status).toBe(200);
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
      token: restricted, method: "POST", body: { code: codeAt(setup.body.secret) },
    });
    const confirm = await request("/api/v1/auth/totp/setup/confirm", { token: restricted, method: "POST" });
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

    const confirm = await request("/api/v1/auth/totp/recovery-codes/confirm", { token, method: "POST" });
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

    await request("/api/v1/auth/totp/setup/verify", {
      token, method: "POST", body: { code: codeAt(setup.body.secret) },
    });
    expect((await request("/api/v1/auth/totp/setup/confirm", { token, method: "POST" })).status).toBe(200);
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
