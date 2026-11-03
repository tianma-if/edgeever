export const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
/**
 * Same PBKDF2 hash, different algorithm tag. Accounts with TOTP enabled store
 * their hash under this tag so a backend that predates TOTP (which only accepts
 * PASSWORD_HASH_ALGORITHM) fails closed instead of accepting the password alone.
 */
export const MFA_PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256-mfa";
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;

export const SESSION_TOKEN_BYTES = 32;

export const hashPassword = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS,
    base64UrlEncode(salt),
    base64UrlEncode(hash),
  ].join("$");
};

export const verifyPassword = async (password: string, passwordHash: string) => {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = passwordHash.split("$");
  const iterations = Number(iterationsRaw);

  if (
    (algorithm !== PASSWORD_HASH_ALGORITHM && algorithm !== MFA_PASSWORD_HASH_ALGORITHM) ||
    !Number.isInteger(iterations) ||
    iterations < PASSWORD_HASH_ITERATIONS ||
    !saltRaw ||
    !hashRaw
  ) {
    return false;
  }

  try {
    const expected = base64UrlDecode(hashRaw);
    const salt = base64UrlDecode(saltRaw);
    const actual = await derivePasswordHash(password, salt, iterations);

    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

export const isMfaPasswordHash = (passwordHash: string) =>
  passwordHash.startsWith(`${MFA_PASSWORD_HASH_ALGORITHM}$`);

/** Re-tags a plain hash for an account that has TOTP enabled. No-op if already tagged. */
export const markPasswordHashMfa = (passwordHash: string) =>
  passwordHash.startsWith(`${PASSWORD_HASH_ALGORITHM}$`)
    ? `${MFA_PASSWORD_HASH_ALGORITHM}${passwordHash.slice(PASSWORD_HASH_ALGORITHM.length)}`
    : passwordHash;

/** Restores the plain tag once TOTP is turned off. No-op if not tagged. */
export const unmarkPasswordHashMfa = (passwordHash: string) =>
  isMfaPasswordHash(passwordHash)
    ? `${PASSWORD_HASH_ALGORITHM}${passwordHash.slice(MFA_PASSWORD_HASH_ALGORITHM.length)}`
    : passwordHash;

const derivePasswordHash = async (password: string, salt: Uint8Array, iterations: number) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    key,
    PASSWORD_HASH_BYTES * 8
  );

  return new Uint8Array(bits);
};

export const randomToken = (bytes: number) => {
  const token = crypto.getRandomValues(new Uint8Array(bytes));
  return base64UrlEncode(token);
};

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }

  return diff === 0;
};

// Recovery codes carry ~60 bits of entropy, so a lighter salted PBKDF2 keeps
// offline guessing infeasible while checking all ten codes on a sign-in costs
// about the same CPU as one password verification.
const RECOVERY_CODE_HASH_ALGORITHM = "pbkdf2-sha256-rc";
const RECOVERY_CODE_HASH_ITERATIONS = 10_000;

export const hashRecoveryCode = async (code: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordHash(code, salt, RECOVERY_CODE_HASH_ITERATIONS);
  return [
    RECOVERY_CODE_HASH_ALGORITHM,
    RECOVERY_CODE_HASH_ITERATIONS,
    base64UrlEncode(salt),
    base64UrlEncode(hash),
  ].join("$");
};

export const verifyRecoveryCodeHash = async (code: string, codeHash: string) => {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = codeHash.split("$");
  const iterations = Number(iterationsRaw);
  if (
    algorithm !== RECOVERY_CODE_HASH_ALGORITHM
    || !Number.isInteger(iterations)
    || iterations < RECOVERY_CODE_HASH_ITERATIONS
    || !saltRaw
    || !hashRaw
  ) {
    return false;
  }
  try {
    const actual = await derivePasswordHash(code, base64UrlDecode(saltRaw), iterations);
    return timingSafeEqual(actual, base64UrlDecode(hashRaw));
  } catch {
    return false;
  }
};
