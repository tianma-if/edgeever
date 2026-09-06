import { describe, expect, test } from "bun:test";
import {
  isDatabaseNotReadyError,
  isUnauthenticatedAccessEnabled,
  resolveInstanceAuthMode,
} from "../apps/api/src/auth-state";

describe("instance authentication state", () => {
  test("fails closed when production has neither credentials nor users", () => {
    expect(
      resolveInstanceAuthMode({
        allowUnauthenticated: false,
        hasBootstrapCredential: false,
        hasEnabledUser: false,
      }),
    ).toBe("unconfigured");
  });

  test("requires authentication when a bootstrap credential or enabled user exists", () => {
    expect(
      resolveInstanceAuthMode({
        allowUnauthenticated: false,
        hasBootstrapCredential: true,
        hasEnabledUser: false,
      }),
    ).toBe("required");
    expect(
      resolveInstanceAuthMode({
        allowUnauthenticated: false,
        hasBootstrapCredential: false,
        hasEnabledUser: true,
      }),
    ).toBe("required");
  });

  test("allows unauthenticated access only through an explicit opt-in", () => {
    expect(isUnauthenticatedAccessEnabled("true")).toBe(true);
    expect(isUnauthenticatedAccessEnabled(" TRUE ")).toBe(true);
    expect(isUnauthenticatedAccessEnabled(undefined)).toBe(false);
    expect(
      resolveInstanceAuthMode({
        allowUnauthenticated: true,
        hasBootstrapCredential: false,
        hasEnabledUser: false,
      }),
    ).toBe("disabled");
  });

  test("recognizes only schema errors as unapplied migrations", () => {
    expect(isDatabaseNotReadyError(new Error("D1_ERROR: no such table: users"))).toBe(true);
    expect(isDatabaseNotReadyError(new Error("D1_COLUMN_NOTFOUND: users.is_disabled"))).toBe(true);
    expect(isDatabaseNotReadyError(new Error("query failed", {
      cause: new Error("D1_ERROR: no such column: is_disabled"),
    }))).toBe(true);
    expect(isDatabaseNotReadyError(new Error("D1_ERROR: Network connection lost."))).toBe(false);
    expect(isDatabaseNotReadyError(new Error("D1_ERROR: Exceeded maximum DB size."))).toBe(false);
    expect(isDatabaseNotReadyError(new Error("D1_EXEC_ERROR: near SELECTZ: syntax error"))).toBe(false);
    expect(isDatabaseNotReadyError(new TypeError("Cannot read properties of undefined (reading 'prepare')"))).toBe(false);
    expect(isDatabaseNotReadyError(new Error("network timeout"))).toBe(false);
  });
});
