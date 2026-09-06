import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio } from "./color-contrast";

const globals = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

describe("application color system", () => {
  test("uses the same restrained brand green throughout the application", () => {
    const mobileEditor = readFileSync(new URL("../styles/mobile-markdown-editor.css", import.meta.url), "utf8");

    expect(globals).toContain("--brand-green: #16a06e;");
    expect(globals).not.toContain("--brand-green: #00a82d;");
    expect(mobileEditor).toContain("color: #16a06e;");
    expect(contrastRatio("#11694a", "#f0f8f4")).toBeGreaterThanOrEqual(4.5);
  });

  test("keeps the light workspace achromatic while preserving text hierarchy", () => {
    expect(globals).toContain("--workspace-canvas: #f8f9fa;");
    expect(globals).toContain("--workspace-sidebar: #f8f9fa;");
    expect(globals).toContain("--workspace-memo-list: #fafafa;");
    expect(globals).toContain("--workspace-editor: #ffffff;");
    expect(globals).toContain("--workspace-selection: #edf0f2;");
    expect(globals).toContain("--slate-500-rgb: 115 115 115;");
    expect(globals).not.toContain("--slate-500-rgb: 100 116 139;");
    expect(contrastRatio("#222222", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#737373", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  test("keeps dark workspace surfaces distinct without blue-black color casts", () => {
    expect(globals).toContain("--workspace-canvas: #101311;");
    expect(globals).toContain("--workspace-sidebar: #121612;");
    expect(globals).toContain("--workspace-memo-list: #151a17;");
    expect(globals).toContain("--workspace-editor: #191e1b;");
    expect(contrastRatio("#cad4ce", "#191e1b")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#9aa9a0", "#191e1b")).toBeGreaterThanOrEqual(4.5);
  });
});
