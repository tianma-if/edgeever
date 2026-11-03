import { describe, expect, test } from "bun:test";
import {
  hashPassword,
  isMfaPasswordHash,
  markPasswordHashMfa,
  randomToken,
  unmarkPasswordHashMfa,
  verifyPassword,
} from "./auth-crypto";

describe("API authentication crypto", () => {
  test("round trips a password without accepting another password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("incorrect", hash)).toBe(false);
  });

  test("rejects malformed or intentionally weak hashes", async () => {
    expect(await verifyPassword("password", "plaintext")).toBe(false);
    expect(await verifyPassword("password", "pbkdf2-sha256$99999$c2FsdA$aGFzaA")).toBe(false);
  });

  test("re-tags a hash for TOTP accounts without changing salt or digest", async () => {
    const plain = await hashPassword("correct horse battery staple");
    const tagged = markPasswordHashMfa(plain);

    expect(tagged).toMatch(/^pbkdf2-sha256-mfa\$100000\$/);
    expect(tagged.split("$").slice(1)).toEqual(plain.split("$").slice(1));
    expect(isMfaPasswordHash(tagged)).toBe(true);
    expect(isMfaPasswordHash(plain)).toBe(false);
    expect(markPasswordHashMfa(tagged)).toBe(tagged);
    expect(unmarkPasswordHashMfa(tagged)).toBe(plain);
    expect(unmarkPasswordHashMfa(plain)).toBe(plain);

    // This version accepts both tags for the same password.
    expect(await verifyPassword("correct horse battery staple", tagged)).toBe(true);
    expect(await verifyPassword("incorrect", tagged)).toBe(false);
  });

  test("a backend that predates TOTP cannot accept the tagged hash", async () => {
    // Pre-TOTP releases (<= v2.18.0) only accept this algorithm tag and this
    // hash pattern; anything else is rejected and reported as password_hash_invalid.
    // That is what makes a code rollback fail closed for TOTP accounts.
    const legacyAlgorithm = "pbkdf2-sha256";
    const legacyPattern = /^pbkdf2-sha256\$(\d+)\$([^$]+)\$([^$]+)$/;
    const tagged = markPasswordHashMfa(await hashPassword("correct horse battery staple"));

    expect(tagged.split("$")[0]).not.toBe(legacyAlgorithm);
    expect(legacyPattern.test(tagged)).toBe(false);
  });

  test("creates URL-safe tokens with the requested entropy length", () => {
    const token = randomToken(32);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBe(43);
  });
});
