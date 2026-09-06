import { PluginAiGenerateSchema, PluginPublicFetchSchema, type PluginAiGenerateRequest, type PluginAiStatus } from '@edgeever/shared';
import { zValidator } from '@hono/zod-validator';
import { bodyLimit } from 'hono/body-limit';
import type { Hono } from 'hono';
import type { AppEnv, Bindings } from './api-context';
import { getAiSettings, loadDefaultAiModel, resolvePrimaryAiCredentialEncryptionKey } from './ai-service';
import { apiError } from './http-errors';
import { getWorkspaceId, requireUser } from './request-auth';
import { PUBLIC_NETWORK_TIMEOUT_MS, publicRequestHeaders, publicResponseHeaders, readPublicBody, validatePublicUrl } from './public-network-policy';

export function registerPluginCapabilityRoutes(app: Hono<AppEnv>, dependencies: {
  isDemoMode: (env: Bindings) => boolean;
  aiStatus?: () => Promise<PluginAiStatus>;
  generate?: (input: PluginAiGenerateRequest, signal: AbortSignal) => Promise<{ text: string }>;
}) {
  // Per app instance concurrency guard, not a cross-instance usage quota.
  const active = new Map<string, number>();
  for (const path of ['/api/v1/plugins/ai/*', '/api/v1/plugins/network/*']) {
    app.use(path, bodyLimit({ maxSize: 400_000 }));
    app.use(path, async (c, next) => {
      const denied = requireUser(c); if (denied) return denied;
      if (dependencies.isDemoMode(c.env)) return apiError(c, 'plugin_capability_demo_disabled', 'This capability requires your own authenticated workspace.', 403);
      const key = `${getWorkspaceId(c)}:${c.req.path.includes('/ai/') ? 'ai' : 'network'}`;
      const count = active.get(key) ?? 0;
      if (count >= 4) return apiError(c, 'plugin_capability_busy', 'Too many concurrent requests. Try again shortly.', 429);
      active.set(key, count + 1);
      try { await next(); } finally { const left = (active.get(key) ?? 1) - 1; if (left) active.set(key, left); else active.delete(key); }
    });
  }
  app.get('/api/v1/plugins/ai/status', async c => {
    if (dependencies.aiStatus) return c.json(await dependencies.aiStatus());
    const settings = await getAiSettings(c.env.storage.db, getWorkspaceId(c), Boolean(resolvePrimaryAiCredentialEncryptionKey(c.env)), false);
    const provider = settings.providers.find(p => p.isEnabled && p.models.some(m => m.id === settings.defaultModelId));
    const model = provider?.models.find(m => m.id === settings.defaultModelId);
    return c.json({ configured: Boolean(model), ...(model ? { modelName: model.displayName } : {}) });
  });
  app.post('/api/v1/plugins/ai/generate', zValidator('json', PluginAiGenerateSchema), async c => {
    try {
      const input = c.req.valid('json');
      const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(120_000)]);
      if (dependencies.generate) return c.json(await dependencies.generate(input, signal));
      const model = await loadDefaultAiModel(c.env.storage.db, getWorkspaceId(c), c.env);
      // Keep provider SDKs out of startup and non-AI plugin requests.
      const { generateAiText } = await import('./ai-runtime');
      const output = await generateAiText({ model, system: input.system, prompt: input.prompt, maxOutputTokens: input.maxOutputTokens ?? 3000, abortSignal: signal });
      return c.json({ text: output.text });
    } catch { return apiError(c, 'plugin_ai_failed', 'AI generation failed or timed out. Check the default AI model configuration.', 502); }
  });
  app.post('/api/v1/plugins/network/fetch', zValidator('json', PluginPublicFetchSchema), async c => {
    const input = c.req.valid('json');
    let url: URL; let headers: Record<string, string>;
    try { url = validatePublicUrl(input.url); headers = publicRequestHeaders(input.headers); }
    catch { return apiError(c, 'plugin_network_invalid', 'Use a public HTTPS hostname, GET/HEAD, and supported public request headers.', 400); }
    if (!c.env.publicNetworkFetch) return apiError(c, 'plugin_network_unavailable', 'This runtime has no public network transport.', 503);
    try {
      const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(PUBLIC_NETWORK_TIMEOUT_MS)]);
      const response = await c.env.publicNetworkFetch(url.href, { method: input.method, headers: { ...headers, 'User-Agent': 'EdgeEver-Plugins/1.0' }, redirect: 'manual', credentials: 'omit', signal });
      const bytes = await readPublicBody(response, signal);
      const outputHeaders = new Headers({
        'Cache-Control': 'no-store',
        'Content-Type': 'application/octet-stream',
        'X-EdgeEver-Upstream-Status': String(response.status),
        'X-EdgeEver-Upstream-Status-Text': encodeURIComponent(response.statusText),
      });
      for (const [name, value] of Object.entries(publicResponseHeaders(response.headers))) outputHeaders.set(`X-EdgeEver-Upstream-Header-${name}`, value);
      const body = bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : new Uint8Array(bytes).buffer;
      return new Response(body, { headers: outputHeaders });
    } catch { return apiError(c, 'plugin_network_failed', 'Public request failed, was blocked, exceeded its size limit, or timed out.', 502); }
  });
}
