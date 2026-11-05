import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "./api-context";
import { apiError } from "./http-errors";
import { getWorkspaceId, requireScopes } from "./request-auth";

type Provider = { provider: string; base_url: string };
const relayHeaders = new Set([
  "authorization", "x-api-key", "x-goog-api-key", "content-type", "accept",
  "anthropic-version", "anthropic-beta", "anthropic-dangerous-direct-browser-access",
  "http-referer", "x-title",
]);

export const isConfiguredAiEndpoint = (target: URL, method: string, config: Provider): boolean => {
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.hash) return false;
  let base: URL;
  try { base = new URL(config.base_url); } catch { return false; }
  if (target.origin !== base.origin) return false;
  const root = base.pathname.replace(/\/+$/, "");
  // Read-only model metadata used to detect output limits (#652): one model by id.
  const isModelMetadata = method === "GET" && target.pathname.startsWith(`${root}/models/`)
    && /^[A-Za-z0-9._:@%-]+$/.test(target.pathname.slice(`${root}/models/`.length));
  if (config.provider === "google") {
    if ([...target.searchParams.keys()].some(key => key !== "key" && key !== "alt")) return false;
    if (method === "GET" && target.pathname === `${root}/models`) return true;
    if (isModelMetadata) return true;
    const suffix = target.pathname.slice(`${root}/models/`.length);
    return method === "POST" && target.pathname.startsWith(`${root}/models/`)
      && /^[A-Za-z0-9._-]+:(?:streamGenerateContent|generateContent)$/.test(suffix);
  }
  if (target.search) return false;
  if (method === "GET") {
    return target.pathname === `${root}/models`
      || (config.provider === "anthropic" && isModelMetadata)
      // LiteLLM proxy reports limits on /model/info.
      || (config.provider === "openai-compatible" && target.pathname === `${root}/model/info`);
  }
  if (method !== "POST") return false;
  if (config.provider === "anthropic") return target.pathname === `${root}/messages`;
  return config.provider === "openai-compatible"
    && (target.pathname === `${root}/chat/completions` || target.pathname === `${root}/audio/transcriptions`);
};

export const registerAiProviderRelay = (app: Hono<AppEnv>, fetchProvider: typeof fetch = (...args) => fetch(...args)) => {
  app.post("/api/v1/ai/provider-relay", bodyLimit({ maxSize: 64 * 1024 * 1024 }), async c => {
    const denied = requireScopes(c, "ai:generate");
    if (denied) return denied;
    let target: URL;
    let headers: Headers;
    const method = c.req.header("x-edgeever-ai-method") ?? "POST";
    try {
      target = new URL(c.req.header("x-edgeever-ai-target") ?? "");
      const raw = JSON.parse(c.req.header("x-edgeever-ai-headers") ?? "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid headers");
      headers = new Headers();
      for (const [key, value] of Object.entries(raw)) {
        if (relayHeaders.has(key.toLowerCase()) && typeof value === "string") headers.set(key, value);
      }
    } catch { return apiError(c, "ai_relay_invalid", "Invalid model request.", 400); }
    const workspaceId = getWorkspaceId(c);
    const rows = await c.env.storage.db.prepare(
      `SELECT provider, base_url FROM ai_provider_configs WHERE workspace_id = ? AND is_enabled = 1
       UNION ALL SELECT 'openai-compatible' AS provider, base_url FROM ai_transcription_providers WHERE workspace_id = ? AND is_enabled = 1`,
    ).bind(workspaceId, workspaceId).all<Provider>();
    if (!rows.results.some(config => isConfiguredAiEndpoint(target, method, config))) {
      return apiError(c, "ai_relay_target_denied", "Save and enable this model service before using the browser fallback.", 403);
    }
    try {
      const requestInit: RequestInit & { duplex?: "half" } = {
        method, headers, redirect: "manual", signal: c.req.raw.signal,
        ...(method === "POST" ? { body: c.req.raw.body, duplex: "half" } : {}),
      };
      const upstream = await fetchProvider(target, requestInit);
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return apiError(c, "ai_relay_redirect_denied", "Model service redirects are not supported.", 502);
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
      });
    } catch {
      return apiError(c, "ai_relay_unavailable", "The instance could not reach the model service.", 502);
    }
  });
};
