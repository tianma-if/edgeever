type PasswordHashVerifier = (password: string, passwordHash: string) => Promise<boolean>;

// "-mfa" marks an account with TOTP enabled; see MFA_PASSWORD_HASH_ALGORITHM in auth-crypto.
const PASSWORD_HASH_PATTERN = /^pbkdf2-sha256(?:-mfa)?\$(\d+)\$([^$]+)\$([^$]+)$/;

export const isSupportedPasswordHash = (passwordHash: string) => {
  const match = passwordHash.match(PASSWORD_HASH_PATTERN);
  if (!match || Number(match[1]) < 100_000) {
    return false;
  }

  try {
    return decodeBase64Url(match[2]).byteLength === 16 && decodeBase64Url(match[3]).byteLength === 32;
  } catch {
    return false;
  }
};

export const hasBootstrapCredential = (password: string | undefined, passwordHash: string | undefined) =>
  Boolean(password || passwordHash?.trim());

export const verifyBootstrapPassword = async (
  password: string,
  configuredPassword: string | undefined,
  configuredPasswordHash: string | undefined,
  verifyPasswordHash: PasswordHashVerifier,
) => {
  const passwordHash = configuredPasswordHash?.trim();

  if (passwordHash) {
    return verifyPasswordHash(password, passwordHash);
  }

  if (configuredPassword === undefined || configuredPassword.length === 0) {
    return false;
  }

  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(password)),
    crypto.subtle.digest("SHA-256", encoder.encode(configuredPassword)),
  ]);

  return timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash));
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }

  return diff === 0;
};

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
