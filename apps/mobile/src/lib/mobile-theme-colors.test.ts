import { describe, expect, test } from "bun:test";
import { resolveMobileThemeColor, resolveMobileThemeStyles } from "./mobile-theme-colors";

describe("mobile dark theme colors", () => {
  test("maps neutral and semantic foreground colors", () => {
    expect(resolveMobileThemeColor("#0f172a", "dark")).toBe("#f8fafc");
    expect(resolveMobileThemeColor("#92400E", "dark")).toBe("#fde68a");
    expect(resolveMobileThemeColor("#1d4ed8", "dark")).toBe("#93c5fd");
  });

  test("maps warning and informational surfaces and borders", () => {
    expect(resolveMobileThemeColor("#fef3c7", "dark", "background")).toBe("#78350f");
    expect(resolveMobileThemeColor("#eff6ff", "dark", "background")).toBe("#172554");
    expect(resolveMobileThemeColor("#bfdbfe", "dark", "border")).toBe("#1e3a8a");
  });

  test("resolves StyleSheet-shaped records without changing light mode", () => {
    const styles = { card: { backgroundColor: "#ffffff", borderColor: "#e2e8f0", color: "#0f172a" } };
    expect(resolveMobileThemeStyles(styles, "light")).toBe(styles);
    expect(resolveMobileThemeStyles(styles, "dark")).toEqual({
      card: { backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc" },
    });
  });
});
