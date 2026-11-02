import { describe, expect, test } from "bun:test";
import { shareExpiryFromDateInput, shareExpiryFromPreset, toDateInputValue } from "./share-expiry.ts";

describe("share link expiry choices", () => {
  test("presets count whole days from now", () => {
    const now = new Date("2026-11-01T10:00:00.000Z");
    expect(shareExpiryFromPreset(1, now)).toBe("2026-11-02T10:00:00.000Z");
    expect(shareExpiryFromPreset(7, now)).toBe("2026-11-08T10:00:00.000Z");
    expect(shareExpiryFromPreset(30, now)).toBe("2026-12-01T10:00:00.000Z");
  });

  test("a custom date lasts until the end of that local day", () => {
    const expected = new Date(2026, 11, 24, 23, 59, 59, 999).toISOString();
    expect(shareExpiryFromDateInput("2026-12-24")).toBe(expected);
    expect(toDateInputValue(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });

  test("an empty or malformed date gives no expiry to save", () => {
    expect(shareExpiryFromDateInput("")).toBeNull();
    expect(shareExpiryFromDateInput("24.12.2026")).toBeNull();
  });
});
