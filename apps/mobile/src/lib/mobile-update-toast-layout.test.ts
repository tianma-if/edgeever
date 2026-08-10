import { describe, expect, test } from "bun:test";
import { getMobileUpdateToastBottomOffset } from "./mobile-update-toast-layout";

describe("mobile update toast layout", () => {
  test("clears the raised create button without a gesture inset", () => {
    expect(getMobileUpdateToastBottomOffset(0)).toBe(92);
  });

  test("adds the Android gesture inset below the bottom navigation", () => {
    expect(getMobileUpdateToastBottomOffset(24)).toBe(104);
  });
});
