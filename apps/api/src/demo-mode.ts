import { isSupportedPasswordHash } from "./auth-bootstrap";

type PasswordHasher = (password: string) => Promise<string>;

export const isDemoModeEnabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";

export const isProtectedDemoAccount = (
  demoMode: string | undefined,
  configuredUsername: string | undefined,
  accountUsername: string,
) =>
  isDemoModeEnabled(demoMode)
  && accountUsername === (configuredUsername?.trim() || "admin");

export const shouldUpsertDemoSeedRecord = (
  existingIds: ReadonlySet<string>,
  id: string,
  overwriteExisting: boolean,
) => overwriteExisting || !existingIds.has(id);

export const resolveDemoPasswordHash = async (
  configuredPassword: string | undefined,
  configuredPasswordHash: string | undefined,
  hashPassword: PasswordHasher,
) => {
  const passwordHash = configuredPasswordHash?.trim();
  if (passwordHash && isSupportedPasswordHash(passwordHash)) {
    return passwordHash;
  }

  return configuredPassword ? hashPassword(configuredPassword) : null;
};
