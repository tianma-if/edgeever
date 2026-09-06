import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const marxico = readFileSync(new URL("./editor-themes/marxico.css", import.meta.url), "utf8");

describe("Mermaid editor layout", () => {
  test("caps wide-screen diagram blocks without narrowing compact viewports", () => {
    expect(globals).toMatch(
      /@media \(min-width: 1280px\)\s*{\s*\.ProseMirror \.edgeever-mermaid-code-block\s*{[^}]*max-width: min\(60vw, 52rem\);[^}]*margin-inline: auto;/s,
    );
  });

  test("keeps rendered diagrams within the capped block", () => {
    expect(globals).toMatch(
      /\.ProseMirror \.edgeever-mermaid-svg svg\s*{[^}]*width: auto;[^}]*max-width: 100%;[^}]*max-height: 30rem;/s,
    );
  });

  test("keeps Mermaid source collapsed in the classic blue and white theme", () => {
    expect(marxico).toMatch(
      /\.edgeever-mermaid-code-block:not\(\.is-source-visible\) \.edgeever-mermaid-source\s*{[^}]*display:\s*none;/s,
    );
  });
});
