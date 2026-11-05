import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const loginScreen = readFileSync(new URL("../apps/web/src/components/LoginScreen.tsx", import.meta.url), "utf8");

describe("login screen chrome", () => {
  test("uses the workspace canvas and a neutral card shadow", () => {
    expect(loginScreen).toContain("bg-[var(--workspace-canvas)]");
    expect(loginScreen).toContain("shadow-[0_20px_50px_rgb(0_0_0/0.08)]");
    expect(loginScreen).toContain("backdrop-blur-md");
    expect(loginScreen).not.toContain("slate-900-rgb");
  });

  test("accepts instance hosts without a protocol", () => {
    expect(loginScreen).toContain("normalizeInstanceUrl");
    expect(loginScreen).toContain('inputMode="url"');
    expect(loginScreen).not.toContain('type="url"');
  });
});
