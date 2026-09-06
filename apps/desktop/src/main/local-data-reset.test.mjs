import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  LocalDataResetError,
  macApplicationBundlePath,
  managedUserDataDirectory,
  scheduleMacLocalDataReset,
} from "./local-data-reset.mjs";

describe("desktop local data reset", () => {
  test("only accepts a direct child of the application-data directory", () => {
    expect(managedUserDataDirectory(
      "/Users/example/Library/Application Support/EdgeEver",
      "/Users/example/Library/Application Support",
    )).toBe("/Users/example/Library/Application Support/EdgeEver");

    expect(() => managedUserDataDirectory(
      "/Users/example/Library/Application Support",
      "/Users/example/Library/Application Support",
    )).toThrow();
    expect(() => managedUserDataDirectory(
      "/Users/example/Library/Application Support/EdgeEver/accounts",
      "/Users/example/Library/Application Support",
    )).toThrow();
    try {
      managedUserDataDirectory(
        "/Users/example/Documents",
        "/Users/example/Library/Application Support",
      );
      throw new Error("expected path validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalDataResetError);
      expect(error.code).toBe("unsafe-data-directory");
    }
  });

  test("finds the enclosing macOS application bundle", () => {
    expect(macApplicationBundlePath("/Applications/EdgeEver.app/Contents/MacOS/EdgeEver"))
      .toBe("/Applications/EdgeEver.app");
    try {
      macApplicationBundlePath("/usr/local/bin/edgeever");
      throw new Error("expected bundle validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalDataResetError);
      expect(error.code).toBe("application-bundle-not-found");
    }
  });

  test("passes paths as shell arguments instead of interpolating them", async () => {
    let invocation;
    let unrefCalled = false;
    const resultPromise = scheduleMacLocalDataReset({
      appDataDirectory: "/Users/example/Library/Application Support",
      executablePath: "/Applications/EdgeEver.app/Contents/MacOS/EdgeEver",
      parentPid: 42,
      spawnProcess: (...args) => {
        invocation = args;
        const helper = new EventEmitter();
        helper.unref = () => { unrefCalled = true; };
        queueMicrotask(() => helper.emit("spawn"));
        return helper;
      },
      userDataDirectory: "/Users/example/Library/Application Support/EdgeEver data",
    });

    expect(invocation[0]).toBe("/bin/sh");
    expect(invocation[1].slice(-3)).toEqual([
      "42",
      "/Users/example/Library/Application Support/EdgeEver data",
      "/Applications/EdgeEver.app",
    ]);
    expect(invocation[1][1]).not.toContain("/Applications/EdgeEver.app");
    expect(invocation[1][1]).not.toContain("EdgeEver data");
    expect(invocation[2]).toEqual({ detached: true, stdio: "ignore" });
    const result = await resultPromise;
    expect(unrefCalled).toBe(true);
    expect(result).toEqual({
      applicationPath: "/Applications/EdgeEver.app",
      target: "/Users/example/Library/Application Support/EdgeEver data",
    });
  });

  test("rejects when the reset helper cannot be started", async () => {
    const resultPromise = scheduleMacLocalDataReset({
      appDataDirectory: "/Users/example/Library/Application Support",
      executablePath: "/Applications/EdgeEver.app/Contents/MacOS/EdgeEver",
      parentPid: 42,
      spawnProcess: () => {
        const helper = new EventEmitter();
        helper.unref = () => {};
        queueMicrotask(() => helper.emit("error", new Error("spawn failed")));
        return helper;
      },
      userDataDirectory: "/Users/example/Library/Application Support/EdgeEver",
    });

    const error = await resultPromise.catch((reason) => reason);
    expect(error).toBeInstanceOf(LocalDataResetError);
    expect(error.code).toBe("helper-start-failed");
    expect(error.cause?.message).toBe("spawn failed");
  });
});
