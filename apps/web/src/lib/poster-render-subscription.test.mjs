import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { POSTER_RENDER_AVAILABLE } from "@edgeever/shared/poster-render-events";
import { subscribeToPosterRenders } from "./poster-render-subscription";

class TestSocket extends EventTarget {
  open() { this.dispatchEvent(new Event("open")); }
  notify() { this.dispatchEvent(new MessageEvent("message", { data: POSTER_RENDER_AVAILABLE })); }
  close() { this.dispatchEvent(new Event("close")); }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let unsubscribe;
beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
});
afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
});

test("a notification received during an in-flight check is drained serially", async () => {
  const socket = new TestSocket();
  const check = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const drain = mock(async () => {
    if (drain.mock.calls.length === 1) await check.promise;
    else finished.resolve();
  });
  unsubscribe = subscribeToPosterRenders(() => socket, drain);
  expect(drain).not.toHaveBeenCalled();
  socket.open();
  socket.notify();
  socket.notify();
  expect(drain).toHaveBeenCalledTimes(1);
  check.resolve();
  await finished.promise;
  expect(drain).toHaveBeenCalledTimes(2);
});

test("checks once on reconnection even without a new notification", async () => {
  const first = new TestSocket();
  const reconnecting = Promise.withResolvers();
  const openSocket = mock(() => {
    if (openSocket.mock.calls.length === 1) return first;
    const second = new TestSocket();
    reconnecting.resolve(second);
    return second;
  });
  const drain = mock(async () => {});
  unsubscribe = subscribeToPosterRenders(openSocket, drain);
  first.open();
  first.close();
  const second = await reconnecting.promise;
  expect(drain).toHaveBeenCalledTimes(1);
  second.open();
  expect(drain).toHaveBeenCalledTimes(2);
  unsubscribe();
  unsubscribe = undefined;
  second.notify();
  expect(drain).toHaveBeenCalledTimes(2);
});
