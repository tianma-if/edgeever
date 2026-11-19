import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveSafeTableUrl } from "./table-url.ts";

const tableEditorPaneSource = readFileSync(new URL("../components/TableEditorPane.tsx", import.meta.url), "utf8");
const windowOpenPolicySource = readFileSync(new URL("../../../desktop/src/main/window-open-policy.mjs", import.meta.url), "utf8");

describe("resolveSafeTableUrl", () => {
  test("allows http and https URLs and trims surrounding whitespace", () => {
    expect(resolveSafeTableUrl("https://example.com")).toBe("https://example.com/");
    expect(resolveSafeTableUrl("  http://localhost:3000/docs?a=1#top  ")).toBe("http://localhost:3000/docs?a=1#top");
    expect(resolveSafeTableUrl("HTTPS://EdgeEver.example/notes")).toBe("https://edgeever.example/notes");
  });

  test("rejects unsafe protocols, empty values, and non-URL text", () => {
    expect(resolveSafeTableUrl("")).toBeNull();
    expect(resolveSafeTableUrl("   ")).toBeNull();
    expect(resolveSafeTableUrl(null)).toBeNull();
    expect(resolveSafeTableUrl(123)).toBeNull();
    expect(resolveSafeTableUrl("example.com")).toBeNull();
    expect(resolveSafeTableUrl("javascript:alert(1)")).toBeNull();
    expect(resolveSafeTableUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(resolveSafeTableUrl("vbscript:msgbox(1)")).toBeNull();
    expect(resolveSafeTableUrl("file:///C:/Windows/System32")).toBeNull();
    expect(resolveSafeTableUrl("mailto:user@example.com")).toBeNull();
  });
});

describe("TableEditorPane URL cell interaction contracts", () => {
  test("separates opening safe URLs in a new tab/external browser from editing the cell", () => {
    expect(tableEditorPaneSource).toContain("resolveSafeTableUrl(text)");
    expect(tableEditorPaneSource).toContain('target="_blank"');
    expect(tableEditorPaneSource).toContain('rel="noopener noreferrer"');
    expect(tableEditorPaneSource).toContain("structuredTable.openUrl");
    expect(tableEditorPaneSource).toContain("structuredTable.editUrl");
    expect(tableEditorPaneSource).toContain("group-focus-within/url-cell:opacity-100");
    expect(tableEditorPaneSource).not.toMatch(/<a[^>]*\stitle=/);
    expect(tableEditorPaneSource).not.toMatch(/<Button[^>]*\stitle=/);
  });

  test("desktop main process routes http/https window-open links to external browser", () => {
    expect(windowOpenPolicySource).toContain('if (url.startsWith("https://") || url.startsWith("http://")) void openExternal(url);');
  });
});
