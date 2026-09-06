import { describe, expect, test } from "bun:test";
import { createRendererStartupGuard } from "./renderer-startup-guard.mjs";

describe("renderer startup guard", () => {
  test("reports a startup that never reaches the renderer", () => {
    const failures = [];
    let callback;
    const guard = createRendererStartupGuard({
      onFailure: (details) => failures.push(details),
      setTimer: (next) => { callback = next; return 1; },
      clearTimer: () => {},
    });

    guard.arm();
    callback();

    expect(failures).toEqual([{ kind: "startup-timeout" }]);
    expect(guard.complete()).toBe(false);
  });

  test("cancels the timeout after the renderer reports readiness", () => {
    const failures = [];
    const cleared = [];
    const guard = createRendererStartupGuard({
      onFailure: (details) => failures.push(details),
      setTimer: () => 7,
      clearTimer: (timer) => cleared.push(timer),
    });

    guard.arm();

    expect(guard.complete()).toBe(true);
    expect(cleared).toEqual([7]);
    expect(guard.fail({ kind: "late-failure" })).toBe(false);
    expect(failures).toEqual([]);
  });
});
