import { describe, expect, test } from "bun:test";
import { syncIntervalMsToPreference } from "./useWorkspacePreferences.ts";

describe("workspace sync interval preference", () => {
  test("serializes every supported interval", () => {
    expect([null, 30_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000].map(syncIntervalMsToPreference))
      .toEqual(["off", "30s", "5m", "15m", "30m", "1h", "2h"]);
  });

  test("falls back to the default interval for an unknown value", () => {
    expect(syncIntervalMsToPreference(1234)).toBe("30s");
  });
});
