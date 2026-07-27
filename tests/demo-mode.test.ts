import { describe, expect, test } from "bun:test";
import {
  isDemoModeEnabled,
  isProtectedDemoAccount,
  resolveDemoPasswordHash,
  shouldUpsertDemoSeedRecord,
} from "../apps/api/src/demo-mode";

describe("demo mode policy", () => {
  test("only enables demo policy for an explicit true value", () => {
    expect(isDemoModeEnabled("true")).toBe(true);
    expect(isDemoModeEnabled(" TRUE ")).toBe(true);
    expect(isDemoModeEnabled("false")).toBe(false);
    expect(isDemoModeEnabled(undefined)).toBe(false);
  });

  test("keeps a valid configured hash authoritative", async () => {
    const hashPassword = async () => "generated-hash";
    const configuredHash = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(await resolveDemoPasswordHash("plaintext", ` ${configuredHash} `, hashPassword)).toBe(configuredHash);
  });

  test("repairs an invalid configured hash from the plaintext fallback", async () => {
    const hashPassword = async (password: string) => `hashed:${password}`;
    expect(await resolveDemoPasswordHash("plaintext", "legacy-hash", hashPassword)).toBe("hashed:plaintext");
    expect(await resolveDemoPasswordHash(undefined, "legacy-hash", hashPassword)).toBeNull();
  });

  test("protects only the configured account while demo mode is enabled", () => {
    expect(isProtectedDemoAccount("true", " ee-demo ", "ee-demo")).toBe(true);
    expect(isProtectedDemoAccount("true", "ee-demo", "member")).toBe(false);
    expect(isProtectedDemoAccount("false", "ee-demo", "ee-demo")).toBe(false);
    expect(isProtectedDemoAccount("true", undefined, "admin")).toBe(true);
  });

  test("hashes a configured plaintext password for scheduled resets", async () => {
    const hashPassword = async (password: string) => `hashed:${password}`;
    expect(await resolveDemoPasswordHash("demo-password", undefined, hashPassword)).toBe("hashed:demo-password");
    expect(await resolveDemoPasswordHash(undefined, undefined, hashPassword)).toBeNull();
  });

  test("does not overwrite existing seed records during ordinary demo reads", () => {
    const existingIds = new Set(["memo_welcome"]);

    expect(shouldUpsertDemoSeedRecord(existingIds, "memo_welcome", false)).toBe(false);
    expect(shouldUpsertDemoSeedRecord(existingIds, "memo_missing", false)).toBe(true);
    expect(shouldUpsertDemoSeedRecord(existingIds, "memo_welcome", true)).toBe(true);
  });
});
