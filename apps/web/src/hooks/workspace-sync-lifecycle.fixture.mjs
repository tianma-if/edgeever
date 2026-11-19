import { mock } from "bun:test";
import { strict as assert } from "node:assert";
let cursor = 0;
const slots = [], effects = [];
mock.module("react", () => ({
  useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect(run, deps) {
    const i = cursor++, old = slots[i];
    if (old && deps.every((value, index) => Object.is(value, old.deps[index]))) return;
    old?.cleanup?.();
    const state = slots[i] = { deps };
    effects.push(() => { state.cleanup = run(); });
  },
}));
const timers = new Map();
let timerId = 0;
globalThis.window = Object.assign(new EventTarget(), {
  location: { hostname: "localhost", origin: "http://localhost", href: "http://localhost/" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setInterval(fn) { timers.set(++timerId, fn); return timerId; },
  clearInterval(id) { timers.delete(id); },
  setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
  clearTimeout(id) { timers.delete(id); },
});
globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
const { useWorkspaceSyncLifecycle } = await import("./useWorkspaceSyncLifecycle.ts");
let refreshes = [], pushes = 0;
const render = async (failedSyncCount, key = "instance-a|user-a") => {
  cursor = 0;
  useWorkspaceSyncLifecycle({
    failedSyncCount, backgroundRefreshKey: key,
    refreshWorkspace: async mode => { refreshes.push(mode); },
    runQueuedSync: async () => { pushes++; },
    setOnline,
  });
  effects.splice(0).forEach(run => run());
  await new Promise(resolve => setImmediate(resolve));
};
const setOnline = () => {};
await render(0);
assert.deepEqual(refreshes, ["manual"]);
for (let i = 0; i < 100; i++) await render(i % 2);
assert.deepEqual(refreshes, ["manual"], "100 queue/callback changes must not trigger startup sync or full notebook refreshes");
await render(0);
assert.equal(timers.size, 1, "only the five-minute shared background timer remains");
window.dispatchEvent(new Event("focus"));
window.dispatchEvent(new Event("pageshow"));
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(refreshes, ["manual", "background"]);
await render(0, "instance-b|user-b");
assert.deepEqual(refreshes, ["manual", "background", "manual"], "new account/instance must perform its own startup sync");
window.dispatchEvent(new Event("edgeever:sync-queue-changed"));
await new Promise(resolve => setImmediate(resolve));
assert.equal(pushes, 1, "queue writes still trigger upload");
slots.forEach(slot => slot?.cleanup?.());
console.log("workspace lifecycle request budget passed");
