import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordLoginFailure,
  resolveLoginRateLimitConfig,
} from "../apps/api/src/auth-login-limiter";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter";

const createDatabase = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(readFileSync("migrations/0020_auth_login_attempts.sql", "utf8"));
  return {
    sqlite,
    db: createSelfHostedStorageAdapter(sqlite, ".edgeever-test-resources").db,
  };
};

describe("login attempt limiter", () => {
  test("uses portable defaults and clamps invalid configuration", () => {
    expect(resolveLoginRateLimitConfig({})).toMatchObject({
      windowSeconds: 900,
      usernameMaxAttempts: 5,
      usernameCooldownSeconds: 900,
      ipMaxAttempts: 30,
      ipCooldownSeconds: 300,
    });
    expect(resolveLoginRateLimitConfig({
      EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS: "0",
      EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS: "6.5",
      EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS: "2000",
    })).toMatchObject({
      windowSeconds: 900,
      usernameMaxAttempts: 5,
      ipMaxAttempts: 1_000,
    });
  });

  test("blocks repeated failures and reports a retry duration", async () => {
    const { sqlite, db } = createDatabase();
    const config = resolveLoginRateLimitConfig({
      EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS: "60",
      EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS: "2",
      EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS: "30",
      EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS: "10",
    });
    const keys = [{ scope: "username" as const, key: "user-hash" }];
    const start = Date.parse("2026-07-26T00:00:00.000Z");

    try {
      expect((await checkLoginRateLimit(db, keys, config, start)).retryAfterSeconds).toBe(0);
      expect((await recordLoginFailure(db, keys, config, start)).retryAfterSeconds).toBe(0);
      expect((await recordLoginFailure(db, keys, config, start + 1_000)).retryAfterSeconds).toBe(30);
      expect((await checkLoginRateLimit(db, keys, config, start + 2_000)).retryAfterSeconds).toBe(29);
      expect((await checkLoginRateLimit(db, keys, config, start + 31_000)).retryAfterSeconds).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  test("clears username and IP buckets after a successful login", async () => {
    const { sqlite, db } = createDatabase();
    const config = resolveLoginRateLimitConfig({
      EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS: "1",
      EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS: "1",
    });
    const keys = [
      { scope: "username" as const, key: "user-hash" },
      { scope: "ip" as const, key: "ip-hash" },
    ];

    try {
      await recordLoginFailure(db, keys, config);
      await clearLoginAttempts(db, keys);
      expect((await checkLoginRateLimit(db, keys, config)).retryAfterSeconds).toBe(0);
      expect(sqlite.query("SELECT COUNT(*) AS count FROM auth_login_attempts").get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});
