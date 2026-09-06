import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const editorSource = readFileSync(
  new URL("../components/LocalTiptapEditor.tsx", import.meta.url),
  "utf8",
);

describe("mobile TipTap table layout contract", () => {
  test.each([
    ["col:first-child:last-child", "100cqi"],
    ["col:first-child:nth-last-child(2)", "50cqi"],
    ["col:first-child:nth-last-child(3)", "calc(100cqi / 3)"],
    ["col:first-child:nth-last-child(4)", "25cqi"],
  ])("fills the content width for a table matched by %s", (columnSelector, expectedWidth) => {
    const selector = `.edgeever-editor-content table:has(> colgroup > ${columnSelector})`;
    const selectorStart = editorSource.indexOf(selector);

    expect(selectorStart).toBeGreaterThanOrEqual(0);
    expect(editorSource.slice(selectorStart, selectorStart + selector.length + 100)).toContain(
      `--mobile-table-column-width: ${expectedWidth};`,
    );
  });

  test("keeps wide tables readable and scrolls them inside the wrapper", () => {
    expect(editorSource).toContain(
      "--mobile-table-column-width: clamp(4.25rem, 24cqi, 10rem);",
    );
    expect(editorSource).toMatch(
      /\.edgeever-editor-content \.tableWrapper \{[\s\S]*?overflow-x: auto;/,
    );
    expect(editorSource).toMatch(
      /\.edgeever-editor-content table \{[\s\S]*?min-width: 100%;/,
    );
  });
});
