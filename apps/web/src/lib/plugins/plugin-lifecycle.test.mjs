import { afterAll, expect, test } from 'bun:test';
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalMutationObserver = globalThis.MutationObserver;
const values = new Map();
globalThis.window = { location: { href: 'https://example.test' }, localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }, addEventListener() {}, removeEventListener() {} };
globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {}, style: { setProperty() {}, removeProperty() {} }, removeAttribute() {} } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
const { EdgeEverPluginHost } = await import('./plugin-host');
afterAll(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.MutationObserver = originalMutationObserver;
});
function setup() {
  values.clear();
  let release, entered, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const host = new EdgeEverPluginHost({ scope: crypto.randomUUID(), packageStorage: { get: async () => null }, repository: { listMemos: async () => { calls++; entered(); await gate; return { memos: [], totalCount: 0, nextCursor: null }; } } });
  const id = `org.edgeever.lifecycle-${crypto.randomUUID()}`;
  host.installManifest({ type: 'plugin', id, name: 'Delayed activation', version: '1.0.0', apiVersion: '1', entry: new URL('./plugin-lifecycle.fixture.mjs', import.meta.url).href, permissions: ['notes:read', 'ui:commands', 'ui:panels'] }, 'https://example.test/manifest.json');
  return { host, id, started, release, calls: () => calls };
}
test('concurrent enable requests share a single asynchronous activation', async () => {
  const { host, id, started, release, calls } = setup();
  const first = host.setEnabled(id, true); await started;
  const second = host.setEnabled(id, true); release(); await Promise.all([first, second]);
  expect(calls()).toBe(1); expect(host.getSnapshot().panels.filter(p => p.pluginId === id)).toHaveLength(1);
  await host.dispose();
});
test('effect cleanup and restart do not strand an async plugin activation', async () => {
  const { host, id, started, release, calls } = setup();
  host.extensions.find(e => e.manifest.id === id).enabled = true;
  const first = host.activateEnabled(); await started;
  const cleanup = host.dispose(); const restart = host.activateEnabled(); release();
  await Promise.all([first, cleanup, restart]);
  expect(calls()).toBe(2); expect(host.getSnapshot().panels.filter(p => p.pluginId === id)).toHaveLength(1);
  expect(host.getSnapshot().extensions.find(e => e.manifest.id === id).enabled).toBe(true);
  await host.dispose(); expect(host.getSnapshot().panels).toHaveLength(0);
});
