import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");
const mobileEditor = readFileSync(new URL("../styles/mobile-markdown-editor.css", import.meta.url), "utf8");

describe("responsive table layout contracts", () => {
  test("globals.css sizes tables with up to 8 columns by content, not the fixed column-width variable", () => {
    expect(globals).not.toContain("min-width: 42rem !important;");
    expect(globals).not.toContain("calc((100vw - 3rem) / 3)");
    expect(globals).toContain(".ProseMirror .tableWrapper");
    expect(globals).toContain("container-type: inline-size;");
    // The per-count width variable no longer governs compact tables (the
    // content-based rules below override it), so its 1-4 column definitions
    // are removed instead of asserted.
    expect(globals).not.toContain("--mobile-table-column-width: 100cqi;");
    expect(globals).not.toContain("--mobile-table-column-width: 50cqi;");
    expect(globals).not.toContain("--mobile-table-column-width: calc(100cqi / 3);");
    expect(globals).not.toContain("--mobile-table-column-width: 25cqi;");
    // Tables with up to 8 columns (or no colgroup) distribute widths by
    // content in both the editor and the reader.
    expect(globals).toContain(".ProseMirror table:has(> colgroup > col:first-child:nth-last-child(-n+8))");
    expect(globals).toContain(".markdown-content table:has(> colgroup > col:first-child:nth-last-child(-n+8))");
    expect(globals).toContain(".markdown-content table:not(:has(colgroup))");
    expect(globals).toContain("table-layout: auto;");
    expect(globals).toContain("width: auto !important;");
    expect(globals).toContain("min-width: 0 !important;");
  });

  test("mobile-markdown-editor.css provides container-query proportional column widths", () => {
    expect(mobileEditor).not.toContain("calc((100vw - 3rem) / 3)");
    expect(mobileEditor).toContain("container-type: inline-size;");
    expect(mobileEditor).toContain("--mobile-table-column-width: 100cqi;");
    expect(mobileEditor).toContain("--mobile-table-column-width: 50cqi;");
    expect(mobileEditor).toContain("--mobile-table-column-width: calc(100cqi / 3);");
    expect(mobileEditor).toContain("--mobile-table-column-width: 25cqi;");
  });

  test("wide tables with 9+ columns expand and scroll smoothly inside wrapper", () => {
    expect(globals).toContain(".tableWrapper {\n  --mobile-table-column-width: clamp(4.5rem, 24cqi, 12rem);");
    expect(globals).toContain(".ProseMirror table:has(> colgroup > col:first-child:nth-last-child(n+9))");
    expect(globals).toContain(".markdown-content table:has(> colgroup > col:first-child:nth-last-child(n+9))");
    expect(globals).toContain("width: max-content;");
    expect(globals).toMatch(/\.ProseMirror \.tableWrapper[\s\S]*?overflow-x: auto;/);
    expect(mobileEditor).toMatch(/\.edgeever-mobile-tiptap-content \.tableWrapper[\s\S]*?overflow-x: auto;/);
  });

  test("narrow editor and reader keep tables inside the wrapper instead of overflowing the page", () => {
    // On a narrow editor or reader (e.g. a phone-width note) the wrapper is
    // capped at the container width and scrolls internally, and content-sized
    // cells may shrink below the old fixed width, so the table scrolls inside
    // the wrapper rather than breaking the page layout.
    expect(globals).toMatch(/\.tableWrapper \{[\s\S]*?max-width: 100%;/);
    expect(globals).toMatch(/\.tableWrapper \{[\s\S]*?overflow-x: auto;/);
    expect(globals).toContain("min-width: 0;");
  });
});
