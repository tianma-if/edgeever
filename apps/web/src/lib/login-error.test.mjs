import { describe, expect, test } from "bun:test";
import { ApiRequestError, DesktopInstanceUrlError } from "./api.ts";
import { classifyLoginError } from "./login-error.ts";

describe("login error classification", () => {
  test("distinguishes invalid URLs and unreachable instances", () => {
    expect(classifyLoginError(new DesktopInstanceUrlError(), "login")).toEqual({
      kind: "invalidInstanceUrl",
      diagnosticCode: "instance_url_invalid",
    });
    expect(classifyLoginError(new TypeError("Failed to fetch"), "login")).toEqual({
      kind: "instanceUnreachable",
      diagnosticCode: "network_unreachable",
    });
  });

  test("distinguishes invalid credentials from an expired session", () => {
    const unauthorized = new ApiRequestError("Authentication required", 401, "unauthorized");
    expect(classifyLoginError(unauthorized, "login").kind).toBe("invalidCredentials");
    expect(classifyLoginError(unauthorized, "session").kind).toBe("sessionExpired");
  });

  test("preserves actionable server error categories", () => {
    expect(classifyLoginError(new ApiRequestError("Not found", 404), "login").kind).toBe("instanceApiNotFound");
    expect(classifyLoginError(new ApiRequestError("Slow down", 429, "login_rate_limited"), "login").kind)
      .toBe("loginRateLimited");
    expect(classifyLoginError(new ApiRequestError("Unavailable", 503, "database_not_ready"), "session").kind)
      .toBe("databaseNotReady");
    expect(classifyLoginError(new ApiRequestError("Bad gateway", 502), "login")).toEqual({
      kind: "instanceServerError",
      diagnosticCode: "http_502",
      status: 502,
    });
  });

  test("identifies Cloudflare challenges and preserves the Ray ID", () => {
    const challenge = new ApiRequestError("Forbidden", 403, undefined, undefined, {
      cloudflareMitigated: true,
      isEdgeEverApiError: false,
      rayId: "abc123-SJC",
    });

    expect(classifyLoginError(challenge, "login")).toEqual({
      kind: "cloudflareChallenge",
      diagnosticCode: "cloudflare_challenge",
      rayId: "abc123-SJC",
    });
  });

  test("distinguishes an edge security block from an EdgeEver forbidden response", () => {
    const blocked = new ApiRequestError("Forbidden", 403, undefined, undefined, {
      cloudflareMitigated: false,
      isEdgeEverApiError: false,
      rayId: "def456-NRT",
    });
    const forbidden = new ApiRequestError("Forbidden", 403, "forbidden", undefined, {
      cloudflareMitigated: false,
      isEdgeEverApiError: true,
      rayId: "ghi789-LAX",
    });

    expect(classifyLoginError(blocked, "login")).toEqual({
      kind: "securityPolicyBlocked",
      diagnosticCode: "security_policy_blocked",
      rayId: "def456-NRT",
    });
    expect(classifyLoginError(forbidden, "login")).toEqual({
      kind: "requestForbidden",
      diagnosticCode: "forbidden",
      rayId: "ghi789-LAX",
    });
  });

  test("identifies responses that are not EdgeEver JSON", () => {
    expect(classifyLoginError(new SyntaxError("Unexpected token"), "login")).toEqual({
      kind: "invalidResponse",
      diagnosticCode: "invalid_instance_response",
    });
  });
});
