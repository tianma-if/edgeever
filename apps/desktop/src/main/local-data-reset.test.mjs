import { describe, expect, test } from "bun:test";
import {
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
    expect(() => managedUserDataDirectory(
      "/Users/example/Documents",
      "/Users/example/Library/Application Support",
    )).toThrow();
  });

  test("finds the enclosing macOS application bundle", () => {
    expect(macApplicationBundlePath("/Applications/EdgeEver.app/Contents/MacOS/EdgeEver"))
      .toBe("/Applications/EdgeEver.app");
    expect(() => macApplicationBundlePath("/usr/local/bin/edgeever")).toThrow();
  });

  test("passes paths as shell arguments instead of interpolating them", () => {
    let invocation;
    let unrefCalled = false;
    const result = scheduleMacLocalDataReset({
      appDataDirectory: "/Users/example/Library/Application Support",
      executablePath: "/Applications/EdgeEver.app/Contents/MacOS/EdgeEver",
      parentPid: 42,
      spawnProcess: (...args) => {
        invocation = args;
        return { unref: () => { unrefCalled = true; } };
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
    expect(unrefCalled).toBe(true);
    expect(result).toEqual({
      applicationPath: "/Applications/EdgeEver.app",
      target: "/Users/example/Library/Application Support/EdgeEver data",
    });
  });
});
