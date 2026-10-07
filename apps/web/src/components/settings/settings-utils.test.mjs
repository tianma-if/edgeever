import { describe, expect, test } from "bun:test";
import {
  ALL_TOKEN_SCOPES,
  createDefaultTokenName,
  DEFAULT_TOKEN_ACCESS_LEVEL,
  getStoredTokenAccessLevel,
  getTokenScopesForAccessLevel,
} from "./settings-utils.ts";

const READ_ONLY_SCOPES = [
  "read:notebooks",
  "read:memos",
  "read:resources",
  "read:tags",
];

describe("API token access levels", () => {
  test("creates timestamped default token names with a four-digit suffix", () => {
    const date = new Date(2026, 7, 11, 9, 8, 7);
    expect(createDefaultTokenName(date, 4827)).toBe("Token-20260811090807-4827");
  });

  test("defaults new tokens to full access", () => {
    expect(DEFAULT_TOKEN_ACCESS_LEVEL).toBe("full");
    expect(getTokenScopesForAccessLevel(DEFAULT_TOKEN_ACCESS_LEVEL)).toEqual(ALL_TOKEN_SCOPES);
  });

  test("maps read-only access to every readable workspace resource", () => {
    expect(getTokenScopesForAccessLevel("read-only")).toEqual(READ_ONLY_SCOPES);
  });

  test("summarizes standard and legacy scope sets without broadening old tokens", () => {
    expect(getStoredTokenAccessLevel([...ALL_TOKEN_SCOPES].reverse())).toBe("full");
    expect(getStoredTokenAccessLevel([...READ_ONLY_SCOPES].reverse())).toBe("read-only");
    expect(getStoredTokenAccessLevel(["read:memos", "write:memos"])).toBe("legacy-custom");
  });
});
