import { ApiRequestError, DesktopInstanceUrlError } from "@/lib/api";

export type LoginErrorPhase = "session" | "login";

type LoginProblemDetails = {
  diagnosticCode: string;
  rayId?: string;
};

export type LoginProblem = LoginProblemDetails & (
  | { kind: "invalidInstanceUrl"; diagnosticCode: "instance_url_invalid" }
  | { kind: "instanceUnreachable"; diagnosticCode: "network_unreachable" }
  | { kind: "instanceApiNotFound"; diagnosticCode: "edgeever_api_not_found" }
  | { kind: "invalidCredentials"; diagnosticCode: "invalid_credentials" }
  | { kind: "sessionExpired"; diagnosticCode: "session_expired" }
  | { kind: "loginRateLimited"; diagnosticCode: "login_rate_limited" }
  | { kind: "authNotConfigured"; diagnosticCode: "auth_not_configured" }
  | { kind: "databaseNotReady"; diagnosticCode: "database_not_ready" }
  | { kind: "passwordHashInvalid"; diagnosticCode: "password_hash_invalid" }
  | { kind: "cloudflareChallenge"; diagnosticCode: "cloudflare_challenge" }
  | { kind: "securityPolicyBlocked"; diagnosticCode: "security_policy_blocked" }
  | { kind: "requestForbidden"; diagnosticCode: string }
  | { kind: "instanceServerError"; diagnosticCode: string; status: number }
  | { kind: "requestRejected"; diagnosticCode: string; status: number }
  | { kind: "invalidResponse"; diagnosticCode: "invalid_instance_response" }
  | { kind: "unexpected"; diagnosticCode: "unexpected_login_error" }
);

export type LoginProblemMessageKey =
  | "login.desktopInstanceUrlInvalid"
  | "login.instanceUnreachable"
  | "login.instanceApiNotFound"
  | "login.invalidCredentials"
  | "login.sessionExpired"
  | "login.loginRateLimited"
  | "login.authNotConfigured"
  | "login.databaseNotReady"
  | "login.passwordHashInvalid"
  | "login.cloudflareChallenge"
  | "login.securityPolicyBlocked"
  | "login.requestForbidden"
  | "login.instanceServerError"
  | "login.requestRejected"
  | "login.invalidInstanceResponse"
  | "login.unexpectedError";

const withRayId = <T extends LoginProblem>(problem: T, error: ApiRequestError): T => {
  const rayId = error.responseDiagnostics?.rayId;
  return rayId ? { ...problem, rayId } : problem;
};

export const getLoginProblemMessageKey = (problem: LoginProblem): LoginProblemMessageKey => {
  switch (problem.kind) {
    case "invalidInstanceUrl": return "login.desktopInstanceUrlInvalid";
    case "instanceUnreachable": return "login.instanceUnreachable";
    case "instanceApiNotFound": return "login.instanceApiNotFound";
    case "invalidCredentials": return "login.invalidCredentials";
    case "sessionExpired": return "login.sessionExpired";
    case "loginRateLimited": return "login.loginRateLimited";
    case "authNotConfigured": return "login.authNotConfigured";
    case "databaseNotReady": return "login.databaseNotReady";
    case "passwordHashInvalid": return "login.passwordHashInvalid";
    case "cloudflareChallenge": return "login.cloudflareChallenge";
    case "securityPolicyBlocked": return "login.securityPolicyBlocked";
    case "requestForbidden": return "login.requestForbidden";
    case "instanceServerError": return "login.instanceServerError";
    case "requestRejected": return "login.requestRejected";
    case "invalidResponse": return "login.invalidInstanceResponse";
    case "unexpected": return "login.unexpectedError";
  }
};

export const classifyLoginError = (error: unknown, phase: LoginErrorPhase): LoginProblem => {
  if (error instanceof DesktopInstanceUrlError) {
    return { kind: "invalidInstanceUrl", diagnosticCode: "instance_url_invalid" };
  }

  if (error instanceof ApiRequestError) {
    if (error.responseDiagnostics?.cloudflareMitigated) {
      return withRayId({ kind: "cloudflareChallenge", diagnosticCode: "cloudflare_challenge" }, error);
    }
    if (error.code === "auth_not_configured") {
      return withRayId({ kind: "authNotConfigured", diagnosticCode: "auth_not_configured" }, error);
    }
    if (error.code === "database_not_ready") {
      return withRayId({ kind: "databaseNotReady", diagnosticCode: "database_not_ready" }, error);
    }
    if (error.code === "password_hash_invalid") {
      return withRayId({ kind: "passwordHashInvalid", diagnosticCode: "password_hash_invalid" }, error);
    }
    if (error.code === "login_rate_limited" || error.status === 429) {
      return withRayId({ kind: "loginRateLimited", diagnosticCode: "login_rate_limited" }, error);
    }
    if (error.code === "unauthorized" || error.status === 401) {
      return withRayId(phase === "login"
        ? { kind: "invalidCredentials", diagnosticCode: "invalid_credentials" }
        : { kind: "sessionExpired", diagnosticCode: "session_expired" }, error);
    }
    if (error.status === 404) {
      return withRayId({ kind: "instanceApiNotFound", diagnosticCode: "edgeever_api_not_found" }, error);
    }
    if (error.status === 403) {
      return withRayId(
        error.responseDiagnostics?.isEdgeEverApiError
          ? { kind: "requestForbidden", diagnosticCode: error.code || "http_403" }
          : { kind: "securityPolicyBlocked", diagnosticCode: "security_policy_blocked" },
        error,
      );
    }
    if (error.status >= 500) {
      return withRayId({ kind: "instanceServerError", diagnosticCode: `http_${error.status}`, status: error.status }, error);
    }
    return withRayId({
      kind: "requestRejected",
      diagnosticCode: error.code || `http_${error.status}`,
      status: error.status,
    }, error);
  }

  if (error instanceof TypeError) {
    return { kind: "instanceUnreachable", diagnosticCode: "network_unreachable" };
  }

  if (error instanceof SyntaxError) {
    return { kind: "invalidResponse", diagnosticCode: "invalid_instance_response" };
  }

  return { kind: "unexpected", diagnosticCode: "unexpected_login_error" };
};
