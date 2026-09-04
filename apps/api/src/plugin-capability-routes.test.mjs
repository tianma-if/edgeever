import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerPluginCapabilityRoutes } from './plugin-capability-routes';

function fixture({ kind = 'user', demo = false, fetch = async () => new Response('public data'), generate = async input => ({ text: input.prompt.toUpperCase() }) } = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => { if (kind) c.set('auth', { kind, workspaceId: 'workspace' }); await next(); });
  registerPluginCapabilityRoutes(app, { isDemoMode: () => demo, aiStatus: async () => ({ configured: true, modelName: 'Test model' }), generate });
  const env = { publicNetworkFetch: fetch };
  return (path, body, signal) => app.request(`/api/v1/plugins/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : {}, env);
}

test('generic capabilities reject agent tokens, unauthenticated access and public demo calls', async () => {
  for (const options of [{ kind: 'agent' }, { kind: null }, { demo: true }]) {
    const call = fixture({ ...options, fetch: () => { throw new Error('must not run'); } });
    expect((await call('network/fetch', { url: 'https://example.org' })).status).toBe(403);
    expect((await call('ai/status')).status).toBe(403);
  }
});

test('public egress refuses private targets, credentials, unsupported methods and sensitive headers before transport', async () => {
  let calls = 0; const call = fixture({ fetch: async () => { calls++; return new Response('bad'); } });
  for (const url of ['http://example.org', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://user:password@example.org', 'https://example.org:8443', 'https://metadata.google.internal', 'https://localhost']) expect((await call('network/fetch', { url })).status).toBe(400);
  for (const headers of [{ Authorization: 'Bearer dummy' }, { Cookie: 'dummy' }, { Host: 'localhost' }, { Accept: 'text/plain\r\nx-test: dummy' }]) expect((await call('network/fetch', { url: 'https://example.org', headers })).status).toBe(400);
  expect((await call('network/fetch', { url: 'https://example.org', method: 'POST' })).status).toBe(400);
  expect(calls).toBe(0);
});

test('public transport preserves upstream status and useful headers without following redirects or returning cookies', async () => {
  let calls = 0;
  const call = fixture({ fetch: async (url, init) => {
    calls++; expect(url).toBe('https://example.org/feed'); expect(init.redirect).toBe('manual'); expect(init.credentials).toBe('omit'); expect(init.headers.accept).toBe('application/rss+xml');
    return new Response('moved', { status: 302, headers: { Location: 'https://127.0.0.1/private', 'Set-Cookie': 'secret=not-for-plugin', 'X-Internal': 'hidden' } });
  } });
  const response = await call('network/fetch', { url: 'https://example.org/feed', headers: { Accept: 'application/rss+xml' } });
  expect(response.status).toBe(200); expect(response.headers.get('x-edgeever-upstream-status')).toBe('302'); expect(await response.text()).toBe('moved'); expect(response.headers.get('x-edgeever-upstream-header-location')).toBe('https://127.0.0.1/private'); expect(response.headers.get('x-edgeever-upstream-header-set-cookie')).toBeNull(); expect(response.headers.get('x-edgeever-upstream-header-x-internal')).toBeNull(); expect(calls).toBe(1);
});

test('oversized and cancelled public responses fail without exposing upstream error details', async () => {
  const large = fixture({ fetch: async () => new Response(new Uint8Array(2_000_001)) });
  expect((await large('network/fetch', { url: 'https://example.org' })).status).toBe(502);
  const cancelled = fixture({ fetch: async (_url, init) => { init.signal.throwIfAborted(); return new Response('unexpected'); } });
  const controller = new AbortController(); controller.abort();
  expect((await cancelled('network/fetch', { url: 'https://example.org' }, controller.signal)).status).toBe(502);
});

test('generic AI validates ordinary prompts, returns text, and redacts provider errors', async () => {
  const call = fixture();
  expect(await (await call('ai/status')).json()).toEqual({ configured: true, modelName: 'Test model' });
  expect(await (await call('ai/generate', { system: 'Translate', prompt: 'hello', maxOutputTokens: 100 })).json()).toEqual({ text: 'HELLO' });
  expect((await call('ai/generate', { system: '', prompt: 'hello', source: 'github' })).status).toBe(400);
  expect((await call('ai/generate', { system: '', prompt: 'x'.repeat(90001) })).status).toBe(400);
  const failed = fixture({ generate: async () => { throw new Error('Bearer dummy-provider-secret'); } });
  const response = await failed('ai/generate', { system: '', prompt: 'hello' }); expect(response.status).toBe(502); expect(await response.text()).not.toContain('dummy-provider-secret');
});

test('concurrent requests are bounded and released after completion', async () => {
  let started = 0; let release; const gate = new Promise(resolve => { release = resolve; });
  const call = fixture({ fetch: async () => { started++; await gate; return new Response('ok'); } });
  const pending = Array.from({ length: 4 }, () => call('network/fetch', { url: 'https://example.org' }));
  for (let i = 0; i < 100 && started < 4; i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(started).toBe(4); expect((await call('network/fetch', { url: 'https://example.org' })).status).toBe(429);
  release(); await Promise.all(pending); expect((await call('network/fetch', { url: 'https://example.org' })).status).toBe(200);
});
