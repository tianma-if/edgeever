import type { TFunction } from "i18next";
export { copyTextToClipboard } from "@/lib/clipboard";

export const ALL_TOKEN_SCOPES = [
  "read:notebooks",
  "write:notebooks",
  "read:memos",
  "write:memos",
  "read:resources",
  "write:resources",
  "read:tags",
  "write:tags",
];

export type TokenAccessLevel = "full" | "read-only";
export type StoredTokenAccessLevel = TokenAccessLevel | "legacy-custom";
export const DEFAULT_TOKEN_ACCESS_LEVEL: TokenAccessLevel = "full";

const padDatePart = (value: number) => String(value).padStart(2, "0");

const createFourDigitSuffix = () => {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  return 1000 + (values[0] % 9000);
};

export const createDefaultTokenName = (
  date: Date = new Date(),
  randomSuffix: number = createFourDigitSuffix(),
) => {
  const timestamp = [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds()),
  ].join("");

  return `Token-${timestamp}-${String(randomSuffix).padStart(4, "0")}`;
};

const sameScopes = (left: string[], right: string[]) => {
  const leftScopes = new Set(left);
  const rightScopes = new Set(right);
  return leftScopes.size === rightScopes.size && [...leftScopes].every((scope) => rightScopes.has(scope));
};

export const getTokenScopesForAccessLevel = (
  accessLevel: TokenAccessLevel,
  availableScopes: string[] = ALL_TOKEN_SCOPES,
) => accessLevel === "full"
  ? [...availableScopes]
  : availableScopes.filter((scope) => scope.startsWith("read:"));

export const getStoredTokenAccessLevel = (
  scopes: string[],
  availableScopes: string[] = ALL_TOKEN_SCOPES,
): StoredTokenAccessLevel => {
  if (sameScopes(scopes, getTokenScopesForAccessLevel("full", availableScopes))) {
    return "full";
  }

  if (sameScopes(scopes, getTokenScopesForAccessLevel("read-only", availableScopes))) {
    return "read-only";
  }

  return "legacy-custom";
};

export const getTokenScopeLabel = (scope: string, t: TFunction) => t(`mcp.scopes.${scope}`, { defaultValue: scope });

export const getMcpRemoteServerUrl = () => {
  if (typeof window === "undefined") {
    return "/mcp";
  }

  return `${window.location.origin}/mcp`;
};

export const getEdgeEverBaseUrl = () => {
  if (typeof window === "undefined") {
    return "https://your-domain.example";
  }

  return window.location.origin;
};

export const buildMcpRemoteConfig = (token: string) =>
  JSON.stringify(
    {
      mcpServers: {
        edgeever: {
          url: getMcpRemoteServerUrl(),
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2
  );
