import type { AppContext, AuditActor, AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { forbidden, unauthorized } from "./http-errors";

export const ALL_TOKEN_SCOPES = [
  "read:notebooks",
  "write:notebooks",
  "read:memos",
  "write:memos",
  "read:resources",
  "write:resources",
  "read:tags",
  "write:tags",
] as const;

export type TokenScope = (typeof ALL_TOKEN_SCOPES)[number];

export const getAuditActor = (c: AppContext): AuditActor => {
  const auth = c.get("auth");
  return {
    actorType: auth?.actorType ?? "user",
    actorId: auth?.actorId ?? null,
  };
};

export const getActorLabel = (c: AppContext) => {
  const auth = c.get("auth");
  return auth?.actorId ? `${auth.actorType}:${auth.actorId}` : auth?.username ?? "user";
};

export const getWorkspaceId = (c: AppContext) => c.get("auth").workspaceId;

export const requireOwner = (c: AppContext) => {
  const auth = c.get("auth");
  return auth?.kind === "user" && auth.role === "owner"
    ? null
    : forbidden(c, "Only the instance owner can manage users.");
};

export const requireUser = (c: AppContext) => {
  const auth = c.get("auth");
  return auth?.kind === "user"
    ? null
    : forbidden(c, "Only an interactive user session can manage this resource.");
};

export const hasScopes = (auth: AuthContext, scopes: TokenScope[]) =>
  auth.kind === "user" || scopes.every((scope) => auth.scopes.includes(scope));

export const requireScopes = (c: AppContext, ...scopes: TokenScope[]) => {
  const auth = c.get("auth");
  if (!auth) return unauthorized(c, "Authentication required.");
  return hasScopes(auth, scopes)
    ? null
    : forbidden(c, `Missing required scope: ${scopes.join(", ")}`);
};

export const requireAnyScopes = (c: AppContext, ...scopeSets: TokenScope[][]) => {
  const auth = c.get("auth");
  if (!auth) return unauthorized(c, "Authentication required.");
  return scopeSets.some((scopes) => hasScopes(auth, scopes))
    ? null
    : forbidden(c, `Missing required scope: ${scopeSets.map((scopes) => scopes.join(", ")).join(" or ")}`);
};

export const assertScope = (auth: AuthContext, scope: TokenScope) => {
  if (!hasScopes(auth, [scope])) {
    throw new AppError("forbidden", `Missing required scope: ${scope}`, 403);
  }
};

export const isTokenScope = (scope: string): scope is TokenScope =>
  (ALL_TOKEN_SCOPES as readonly string[]).includes(scope);

export const normalizeTokenScopes = (scopes: string[]) => {
  const normalized = Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)));
  return normalized.some((scope) => !isTokenScope(scope)) ? null : normalized as TokenScope[];
};
