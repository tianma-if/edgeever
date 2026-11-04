import { describe, expect, test } from "bun:test";
import { ApiRequestError, getMfaChallenge } from "@edgeever/client";
import { getMobileCatalog } from "./mobile-locale.tsx";
import {
  classifyMfaLoginError,
  formatRecoveryCodesText,
  formatTotpManualKey,
  getTotpErrorKey,
  getTotpUnavailableKey,
  isCompleteTotpCode,
  isPlausibleRecoveryCode,
  normalizeRecoveryCodeInput,
  normalizeTotpCodeInput,
} from "./mobile-totp.ts";

describe("TOTP input helpers", () => {
  test("keeps only the six digits of a pasted or autofilled code", () => {
    expect(normalizeTotpCodeInput("123 456")).toBe("123456");
    expect(normalizeTotpCodeInput("12-34-5678")).toBe("123456");
    expect(isCompleteTotpCode("12345")).toBe(false);
    expect(isCompleteTotpCode("123456")).toBe(true);
  });

  test("accepts recovery codes with or without dashes", () => {
    expect(normalizeRecoveryCodeInput("  abcd-efgh-ijkl ")).toBe("ABCD-EFGH-IJKL");
    expect(isPlausibleRecoveryCode("ABCDEFGHIJKL")).toBe(true);
    expect(isPlausibleRecoveryCode("ABCD-EF")).toBe(false);
  });

  test("groups the manual setup key in fours", () => {
    expect(formatTotpManualKey("jbswy3dpehpk3pxp")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(formatTotpManualKey("JBSW Y3DP EH")).toBe("JBSW Y3DP EH");
  });

  test("puts one recovery code per line for copy and share", () => {
    expect(formatRecoveryCodesText(["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"])).toBe("AAAA-BBBB-CCCC\nDDDD-EEEE-FFFF");
  });
});

describe("TOTP availability and errors", () => {
  test("explains why TOTP cannot be enabled", () => {
    expect(getTotpUnavailableKey({ available: true, unavailableReason: null })).toBeNull();
    expect(getTotpUnavailableKey({ available: false, unavailableReason: "demo" })).toBe("unavailableDemo");
    expect(getTotpUnavailableKey({ available: false, unavailableReason: "encryption_unavailable" })).toBe("unavailableEncryption");
  });

  test("maps management failures to catalog keys that exist in every locale", () => {
    const cases: Array<[ApiRequestError, string]> = [
      [new ApiRequestError("x", 400, "invalid_current_password"), "errorInvalidPassword"],
      [new ApiRequestError("x", 400, "invalid_totp_code"), "errorInvalidCode"],
      [new ApiRequestError("x", 400, "invalid_recovery_code"), "errorInvalidRecoveryCode"],
      [new ApiRequestError("x", 409, "totp_setup_expired"), "errorSetupExpired"],
      [new ApiRequestError("x", 409, "recovery_codes_expired"), "errorSetupExpired"],
      [new ApiRequestError("x", 503, "totp_encryption_unavailable"), "unavailableEncryption"],
      [new ApiRequestError("x", 403, "forbidden"), "unavailableDemo"],
      [new ApiRequestError("x", 429, "rate_limited"), "errorRateLimited"],
      [new ApiRequestError("x", 500), "errorFailed"],
    ];
    for (const [error, key] of cases) {
      expect(getTotpErrorKey(error)).toBe(key);
      for (const locale of ["zh-CN", "en-US", "ja", "pl", "ru"] as const) {
        expect(typeof getMobileCatalog(locale).twoFactor[getTotpErrorKey(error)]).toBe("string");
      }
    }
    expect(getTotpErrorKey(new TypeError("Failed to fetch"))).toBe("errorFailed");
  });
});

describe("second login step errors", () => {
  test("keeps the user on the step for a wrong code", () => {
    expect(classifyMfaLoginError(new ApiRequestError("x", 401, "invalid_totp_code"))).toEqual({ kind: "retry", key: "errorInvalidCode" });
    expect(classifyMfaLoginError(new ApiRequestError("x", 401, "invalid_recovery_code"))).toEqual({ kind: "retry", key: "errorInvalidRecoveryCode" });
    expect(classifyMfaLoginError(new ApiRequestError("x", 503, "totp_unavailable"))).toEqual({ kind: "retry", key: "errorUnavailable" });
  });

  test("returns to the password step when the challenge is spent", () => {
    expect(classifyMfaLoginError(new ApiRequestError("x", 401, "mfa_challenge_expired"))).toEqual({ kind: "expired" });
    expect(classifyMfaLoginError(new ApiRequestError("x", 401, "unauthorized"))).toEqual({ kind: "expired" });
  });

  test("leaves rate limits, server and network errors to the general login copy", () => {
    expect(classifyMfaLoginError(new ApiRequestError("x", 429, "login_rate_limited"))).toEqual({ kind: "general" });
    expect(classifyMfaLoginError(new ApiRequestError("x", 500))).toEqual({ kind: "general" });
    expect(classifyMfaLoginError(new TypeError("Failed to fetch"))).toEqual({ kind: "general" });
  });

  test("reads the challenge from a 401 mfa_required login response", () => {
    const error = new ApiRequestError("MFA required", 401, "mfa_required", {
      challengeToken: "challenge-token-0123456789",
      expiresAt: "2026-11-02T00:05:00.000Z",
      methods: ["totp", "recovery_code"],
    });
    expect(getMfaChallenge(error)?.challengeToken).toBe("challenge-token-0123456789");
    expect(getMfaChallenge(new ApiRequestError("Unauthorized", 401, "unauthorized"))).toBeNull();
  });
});
