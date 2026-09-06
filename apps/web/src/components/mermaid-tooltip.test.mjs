import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("Mermaid tooltips", () => {
  test("uses shared tooltips instead of native title attributes", () => {
    const codeBlock = readSource("./MermaidCodeBlock.tsx");
    const viewer = readSource("./MermaidViewer.tsx");

    expect(codeBlock).toContain("TooltipProvider");
    expect(codeBlock).toContain("TooltipTrigger");
    expect(codeBlock).toContain("TooltipContent");
    expect(viewer).toContain("TooltipContent");
    expect(codeBlock).not.toMatch(/\btitle=/);
    expect(viewer).not.toMatch(/\btitle=/);
  });
});
