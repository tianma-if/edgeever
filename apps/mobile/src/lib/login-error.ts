import { ApiRequestError } from "@edgeever/client";
import { translateMobileText, getMobileCatalog, formatMobileCopy } from "./mobile-locale";

export type MobileLoginLocale = "zh-CN" | "en-US" | "ja" | "pl";

export const MISSING_MOBILE_SESSION_MESSAGE = "登录成功但服务端没有返回移动端会话。请确认服务端已更新到支持 App 登录的版本。";

const appendDiagnostics = (
  message: string,
  diagnosticCode: string,
  rayId?: string,
) => `${message}\n${diagnosticCode}${rayId ? ` · Ray ID: ${rayId}` : ""}`;

export const formatMobileLoginError = (error: unknown, locale: MobileLoginLocale) => {
  if (error instanceof ApiRequestError) {
    const rayId = error.responseDiagnostics?.rayId;

    if (error.responseDiagnostics?.cloudflareMitigated) {
      return appendDiagnostics(
        getMobileCatalog(locale).mobile.login.cloudflareChallenge,
        "cloudflare_challenge",
        rayId,
      );
    }
    if (error.code === "auth_not_configured") {
      return appendDiagnostics(
        getMobileCatalog(locale).mobile.login.authNotConfigured,
        "auth_not_configured",
        rayId,
      );
    }
    if (error.code === "database_not_ready") {
      return appendDiagnostics(
        getMobileCatalog(locale).mobile.login.databaseNotReady,
        "database_not_ready",
        rayId,
      );
    }
    if (error.code === "password_hash_invalid") {
      return appendDiagnostics(
        getMobileCatalog(locale).mobile.login.invalidPasswordConfig,
        "password_hash_invalid",
        rayId,
      );
    }
    if (error.code === "login_rate_limited" || error.status === 429) {
      return appendDiagnostics(
        getMobileCatalog(locale).mobile.login.rateLimited,
        "login_rate_limited",
        rayId,
      );
    }
    if (error.code === "unauthorized" || error.status === 401) {
      return appendDiagnostics(
        getMobileCatalog(locale).mobile.login.invalidCredentials,
        "invalid_credentials",
        rayId,
      );
    }
    if (error.status === 404) {
      return appendDiagnostics(
        getMobileCatalog(locale).mobile.login.apiNotFound,
        "edgeever_api_not_found",
        rayId,
      );
    }
    if (error.status === 403) {
      const isEdgeEverApiError = error.responseDiagnostics?.isEdgeEverApiError;
      return appendDiagnostics(
        isEdgeEverApiError
          ? getMobileCatalog(locale).mobile.login.loginRejected
          : getMobileCatalog(locale).mobile.login.securityPolicyBlocked,
        isEdgeEverApiError ? error.code || "http_403" : "security_policy_blocked",
        rayId,
      );
    }
    if (error.status >= 500) {
      return appendDiagnostics(
        formatMobileCopy(getMobileCatalog(locale).mobile.login.serverError, { status: error.status }),
        `http_${error.status}`,
        rayId,
      );
    }
    return appendDiagnostics(
      formatMobileCopy(getMobileCatalog(locale).mobile.login.requestRejected, { status: error.status }),
      error.code || `http_${error.status}`,
      rayId,
    );
  }

  if (error instanceof Error && error.message === MISSING_MOBILE_SESSION_MESSAGE) {
    return appendDiagnostics(translateMobileText(error.message, locale), "mobile_session_missing");
  }

  if (error instanceof TypeError) {
    return appendDiagnostics(
      getMobileCatalog(locale).mobile.login.unreachable,
      "network_unreachable",
    );
  }

  if (error instanceof SyntaxError) {
    return appendDiagnostics(
      getMobileCatalog(locale).mobile.login.invalidResponse,
      "invalid_instance_response",
    );
  }

  return appendDiagnostics(
    getMobileCatalog(locale).mobile.login.failed,
    "unexpected_login_error",
  );
};
