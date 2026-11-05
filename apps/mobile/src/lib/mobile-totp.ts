import { ApiRequestError } from "@edgeever/client";
import type { TotpStatus } from "@edgeever/shared";
import type { MobileCatalog } from "./mobile-locale";

export type TwoFactorCopyKey = {
  [K in keyof MobileCatalog["twoFactor"]]: MobileCatalog["twoFactor"][K] extends string ? K : never;
}[keyof MobileCatalog["twoFactor"]];

export const TOTP_CODE_LENGTH = 6;

/** Keeps only digits so pasted "123 456" or autofilled codes still submit. */
export const normalizeTotpCodeInput = (value: string) => value.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH);

export const isCompleteTotpCode = (value: string) => /^\d{6}$/.test(value);

/** Trimmed recovery code; the server ignores case and dashes. */
export const normalizeRecoveryCodeInput = (value: string) => value.trim().toUpperCase();

export const isPlausibleRecoveryCode = (value: string) => value.replace(/[\s-]/g, "").length >= 10;

/** Base32 setup key in 4-character groups for manual entry. */
export const formatTotpManualKey = (secret: string) =>
  (secret.replace(/\s+/g, "").toUpperCase().match(/.{1,4}/g) ?? []).join(" ");

export const formatRecoveryCodesText = (codes: readonly string[]) => codes.join("\n");

export type TotpUnavailableKey = Extract<TwoFactorCopyKey, "unavailableDemo" | "unavailableEncryption">;

export const getTotpUnavailableKey = (status: Pick<TotpStatus, "available" | "unavailableReason">): TotpUnavailableKey | null => {
  if (status.available) return null;
  return status.unavailableReason === "demo" ? "unavailableDemo" : "unavailableEncryption";
};

/** Maps a TOTP management API failure to its catalog message. */
export const getTotpErrorKey = (error: unknown): TwoFactorCopyKey => {
  if (!(error instanceof ApiRequestError)) return "errorFailed";
  switch (error.code) {
    case "invalid_current_password":
      return "errorInvalidPassword";
    case "invalid_totp_code":
      return "errorInvalidCode";
    case "invalid_recovery_code":
      return "errorInvalidRecoveryCode";
    case "totp_setup_expired":
    case "recovery_codes_expired":
      return "errorSetupExpired";
    case "totp_encryption_unavailable":
      return "unavailableEncryption";
    case "totp_unavailable":
      return "errorUnavailable";
    default:
      break;
  }
  if (error.status === 403 && error.code === "forbidden") return "unavailableDemo";
  if (error.status === 429) return "errorRateLimited";
  return "errorFailed";
};

export type MfaLoginErrorOutcome =
  /** Stay on the step and let the user retry with another code. */
  | { kind: "retry"; key: TwoFactorCopyKey }
  /** The challenge is spent; the password step must start over. */
  | { kind: "expired" }
  /** Not an MFA-specific failure (rate limit, network, server): reuse the general login copy. */
  | { kind: "general" };

/** Classifies a `/auth/login/mfa` failure. A 401 here never means a lost session. */
export const classifyMfaLoginError = (error: unknown): MfaLoginErrorOutcome => {
  if (!(error instanceof ApiRequestError)) return { kind: "general" };
  if (error.code === "invalid_totp_code") return { kind: "retry", key: "errorInvalidCode" };
  if (error.code === "invalid_recovery_code") return { kind: "retry", key: "errorInvalidRecoveryCode" };
  if (error.code === "totp_unavailable") return { kind: "retry", key: "errorUnavailable" };
  if (error.code === "mfa_challenge_expired") return { kind: "expired" };
  // Any other 401 from the second step means the challenge can no longer be used.
  if (error.status === 401) return { kind: "expired" };
  return { kind: "general" };
};
