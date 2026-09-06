import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");
const mobileEditor = readFileSync(new URL("../styles/mobile-markdown-editor.css", import.meta.url), "utf8");

describe("responsive table layout contracts", () => {
  test("globals.css provides container-query proportional column widths for compact tables", () => {
    expect(globals).not.toContain("min-width: 42rem !important;");
    expect(globals).not.toContain("calc((100vw - 3rem) / 3)");
    expect(globals).toContain(".ProseMirror .tableWrapper");
    expect(globals).toContain("container-type: inline-size;");
    expect(globals).toContain("--mobile-table-column-width: 100cqi;");
    expect(globals).toContain("--mobile-table-column-width: 50cqi;");
    expect(globals).toContain("--mobile-table-column-width: calc(100cqi / 3);");
    expect(globals).toContain("--mobile-table-column-width: 25cqi;");
  });

  test("mobile-markdown-editor.css provides container-query proportional column widths", () => {
    expect(mobileEditor).not.toContain("calc((100vw - 3rem) / 3)");
    expect(mobileEditor).toContain("container-type: inline-size;");
    expect(mobileEditor).toContain("--mobile-table-column-width: 100cqi;");
    expect(mobileEditor).toContain("--mobile-table-column-width: 50cqi;");
    expect(mobileEditor).toContain("--mobile-table-column-width: calc(100cqi / 3);");
    expect(mobileEditor).toContain("--mobile-table-column-width: 25cqi;");
  });

  test("wide tables with 5+ columns expand and scroll smoothly inside wrapper", () => {
    expect(globals).toContain(".tableWrapper {\n  --mobile-table-column-width: clamp(4.5rem, 24cqi, 12rem);");
    expect(globals).toMatch(/\.ProseMirror \.tableWrapper[\s\S]*?overflow-x: auto;/);
    expect(mobileEditor).toMatch(/\.edgeever-mobile-tiptap-content \.tableWrapper[\s\S]*?overflow-x: auto;/);
  });
});
