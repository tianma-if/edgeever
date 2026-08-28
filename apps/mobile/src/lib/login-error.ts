import { ApiRequestError } from "@edgeever/client";

export type MobileLoginLocale = "zh-CN" | "en-US";

const appendDiagnostics = (
  message: string,
  diagnosticCode: string,
  rayId?: string,
) => `${message}\n${diagnosticCode}${rayId ? ` · Ray ID: ${rayId}` : ""}`;

export const formatMobileLoginError = (error: unknown, locale: MobileLoginLocale) => {
  const english = locale === "en-US";

  if (error instanceof ApiRequestError) {
    const rayId = error.responseDiagnostics?.rayId;

    if (error.responseDiagnostics?.cloudflareMitigated) {
      return appendDiagnostics(
        english
          ? "A Cloudflare browser challenge intercepted the login API. Ask the instance administrator to adjust the WAF Challenge rule for the API."
          : "Cloudflare 人机验证拦截了登录接口。请实例管理员调整针对 API 的 WAF Challenge 规则。",
        "cloudflare_challenge",
        rayId,
      );
    }
    if (error.code === "auth_not_configured") {
      return appendDiagnostics(
        english ? "Sign-in is not configured for this instance." : "这个实例还没有配置登录功能。",
        "auth_not_configured",
        rayId,
      );
    }
    if (error.code === "database_not_ready") {
      return appendDiagnostics(
        english ? "The instance database is not ready." : "实例数据库尚未就绪。",
        "database_not_ready",
        rayId,
      );
    }
    if (error.code === "password_hash_invalid") {
      return appendDiagnostics(
        english ? "The instance password configuration is invalid." : "实例的密码配置无效。",
        "password_hash_invalid",
        rayId,
      );
    }
    if (error.code === "login_rate_limited" || error.status === 429) {
      return appendDiagnostics(
        english ? "Too many sign-in attempts. Try again later." : "登录尝试次数过多，请稍后再试。",
        "login_rate_limited",
        rayId,
      );
    }
    if (error.code === "unauthorized" || error.status === 401) {
      return appendDiagnostics(
        english ? "The username or password is incorrect." : "用户名或密码不正确。",
        "invalid_credentials",
        rayId,
      );
    }
    if (error.status === 404) {
      return appendDiagnostics(
        english
          ? "No EdgeEver API was found at this instance address."
          : "该实例地址没有找到 EdgeEver API，请检查地址。",
        "edgeever_api_not_found",
        rayId,
      );
    }
    if (error.status === 403) {
      const isEdgeEverApiError = error.responseDiagnostics?.isEdgeEverApiError;
      return appendDiagnostics(
        isEdgeEverApiError
          ? (english ? "The instance rejected the login request." : "实例拒绝了登录请求。")
          : (english
            ? "A security policy blocked the request before it reached EdgeEver. Check Cloudflare Security Events, Access, WAF, or reverse-proxy rules."
            : "登录请求在到达 EdgeEver 前被安全策略拦截。请检查 Cloudflare Security Events、Access、WAF 或反向代理规则。"),
        isEdgeEverApiError ? error.code || "http_403" : "security_policy_blocked",
        rayId,
      );
    }
    if (error.status >= 500) {
      return appendDiagnostics(
        english
          ? `The instance returned a server error (HTTP ${error.status}).`
          : `实例服务异常（HTTP ${error.status}）。`,
        `http_${error.status}`,
        rayId,
      );
    }
    return appendDiagnostics(
      english
        ? `The instance rejected the request (HTTP ${error.status}).`
        : `实例拒绝了请求（HTTP ${error.status}）。`,
      error.code || `http_${error.status}`,
      rayId,
    );
  }

  if (error instanceof TypeError) {
    return appendDiagnostics(
      english
        ? "Unable to reach the instance. Check its address and your network connection."
        : "无法连接实例，请检查实例地址和网络连接。",
      "network_unreachable",
    );
  }

  if (error instanceof SyntaxError) {
    return appendDiagnostics(
      english
        ? "The server response is not a valid EdgeEver response."
        : "服务端返回的内容不是有效的 EdgeEver 响应。",
      "invalid_instance_response",
    );
  }

  return appendDiagnostics(
    english ? "Sign-in failed. Try again later." : "登录失败，请稍后再试。",
    "unexpected_login_error",
  );
};
