import { createHash } from "node:crypto";
import { join } from "node:path";

export const accountScopeKey = (apiBaseUrl, accountId) => {
  if (!accountId) return "anonymous";
  return createHash("sha256").update(`${apiBaseUrl}\0${accountId}`).digest("hex").slice(0, 24);
};

export const accountDataDirectory = (userDataDirectory, apiBaseUrl, accountId) =>
  join(userDataDirectory, "accounts", accountScopeKey(apiBaseUrl, accountId));
