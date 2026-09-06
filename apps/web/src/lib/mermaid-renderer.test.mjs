import { describe, expect, test } from "bun:test";
import { renderMermaidSVG } from "beautiful-mermaid";
import mermaid from "mermaid";
import { renderMermaidWithFallback } from "./mermaid-renderer";

const GANTT_SOURCE = `gantt
  dateFormat YYYY-MM-DD
  section Web
  Compatibility fallback :fallback, 2026-07-30, 1d`;

describe("Mermaid renderer fallback", () => {
  test("always uses the compact renderer when it supports the diagram", async () => {
    let officialRenderCount = 0;
    const svg = await renderMermaidWithFallback({
      renderBeautiful: () => '<svg data-renderer="beautiful"></svg>',
      renderOfficial: () => {
        officialRenderCount += 1;
        return '<svg data-renderer="mermaid"></svg>';
      },
    });

    expect(officialRenderCount).toBe(0);
    expect(svg).toContain('data-renderer="beautiful"');
  });

  test("uses the official renderer for a valid Gantt diagram unsupported by beautiful-mermaid", async () => {
    expect(await mermaid.parse(GANTT_SOURCE, { suppressErrors: true })).toBeTruthy();

    let officialRenderCount = 0;
    const svg = await renderMermaidWithFallback({
      renderBeautiful: () => renderMermaidSVG(GANTT_SOURCE),
      renderOfficial: () => {
        officialRenderCount += 1;
        return '<svg data-renderer="mermaid"></svg>';
      },
    });

    expect(officialRenderCount).toBe(1);
    expect(svg).toContain('data-renderer="mermaid"');
  });
});
