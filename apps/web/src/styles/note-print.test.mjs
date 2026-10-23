import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const css = readFileSync(new URL("./note-print.css", import.meta.url), "utf8");

describe("note print page margin", () => {
  test("keeps the page number and leaves the note title off the page header", () => {
    expect(css).toContain('content: counter(page) " / " counter(pages)');
    expect(css).not.toContain("@top-center");
    expect(css).not.toContain("edgeever-note-title");
    expect(css).not.toContain("string-set:");
    expect(css).not.toContain("edgeever-print-toc");
  });

  test("uses the editor's neutral prose colors", () => {
    expect(css).toContain("color: #27272a");
    expect(css).toContain("background: #f3f5f7");
    expect(css).toContain("color: #3d4450");
    expect(css).toContain("border-top: 1px solid #1a1d21");
    expect(css).toContain("font-weight: 800");
    expect(css).not.toContain("#047857");
    expect(css).not.toContain("#10b981");
    expect(css).not.toContain("#172033");
    expect(css).not.toContain("#0f172a");
  });

  test("lets a long table continue on the same page", () => {
    expect(css).toMatch(/\.edgeever-print-content \.tableWrapper\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/\.edgeever-print-content table\s*\{[^}]*break-inside:\s*auto;/s);
    expect(css).toMatch(/\.edgeever-print-content tr\s*\{[^}]*break-inside:\s*avoid;/s);
    expect(css).not.toMatch(/\.tableWrapper\s*\{[^}]*overflow:\s*hidden;/s);
  });
});
