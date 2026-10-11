import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { createPosterDocument, serializePosterDocument, createDefaultDiagramDocument, createDefaultTableDocument, diagramFallbackMarkdown, serializeDiagramDocument, serializeInfographicDocument, serializeTableDocument, tableFallbackMarkdown } from "@edgeever/shared";
import { hasMobilePoster, getMobileVisualDiagramKind, hasMobileInfographic, hasMobileStructuredTable, hasMobileVisualDiagram, resolveMobileMemoViewerContent } from "./mobile-diagram";

const hasMermaidCodeBlock = (doc: { content?: Array<{ type?: string; attrs?: { language?: string } }> }) =>
  Boolean(doc.content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "mermaid"));

describe("mobile visual diagram viewer", () => {
  test.each(["mind-map", "flowchart", "architecture"] as const)("does not project a valid %s envelope into hidden Mermaid", (kind) => {
    const serialized = serializeDiagramDocument(createDefaultDiagramDocument(kind));
    const marker = serialized.slice(serialized.indexOf("<!-- edgeever-diagram-v1:"));
    const legacyMarkdown = `# legacy\n\n- node list only\n\n${marker}`;
    const doc = resolveMobileMemoViewerContent(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "node list only" }] }] },
      legacyMarkdown,
    );
    expect(getMobileVisualDiagramKind(legacyMarkdown)).toBe(kind);
    expect(hasMermaidCodeBlock(doc)).toBe(false);
    expect(JSON.stringify(doc)).not.toContain("edgeever-diagram-v1");
    expect(JSON.stringify(doc)).not.toContain("node list only");
  });

  test("keeps visual diagram envelopes out of the regular native editor", () => {
    const architecture = serializeDiagramDocument(createDefaultDiagramDocument("architecture"));
    expect(getMobileVisualDiagramKind(architecture)).toBe("architecture");
    expect(getMobileVisualDiagramKind("# Ordinary note")).toBeNull();
  });

  test("hides an invalid envelope and still protects the note from native editing", () => {
    const markdown = `${diagramFallbackMarkdown(createDefaultDiagramDocument("mind-map"))}\n\n<!-- edgeever-diagram-v1:not-json -->`;
    expect(getMobileVisualDiagramKind(markdown)).toBeNull();
    expect(hasMobileVisualDiagram(markdown)).toBe(true);
    const viewerContent = resolveMobileMemoViewerContent(null, markdown);
    expect(JSON.stringify(viewerContent)).not.toContain("edgeever-diagram-v1");
    expect(hasMermaidCodeBlock(viewerContent)).toBe(true);
  });

  test("shows a structured table as a readable table and keeps the record marker out of the editor", () => {
    const markdown = serializeTableDocument(createDefaultTableDocument());
    expect(hasMobileStructuredTable(markdown)).toBe(true);
    const viewerContent = resolveMobileMemoViewerContent(null, markdown);
    expect(JSON.stringify(viewerContent)).not.toContain("edgeever-table-v1");
    expect(viewerContent.content?.some((node) => node.type === "table")).toBe(true);
    const broken = `${tableFallbackMarkdown(createDefaultTableDocument())}\n\n<!-- edgeever-table-v1:not-json -->`;
    expect(hasMobileStructuredTable(broken)).toBe(true);
    expect(JSON.stringify(resolveMobileMemoViewerContent(null, broken))).not.toContain("edgeever-table-v1");
  });

  test("shows a poster preview and keeps editable source out of the native reader", () => {
    const markdown = serializePosterDocument({ ...createPosterDocument("Poster"), previewResourceId: "res_preview" });
    expect(hasMobilePoster(markdown)).toBe(true);
    const doc = resolveMobileMemoViewerContent(null, markdown);
    expect(JSON.stringify(doc)).toContain("res_preview/blob");
    expect(JSON.stringify(doc)).not.toContain("edgeever-poster-v1");
    expect(hasMobilePoster("text\n<!-- edgeever-poster-v1:broken -->")).toBe(true);
  });

  test("shows infographic syntax without exposing its marker to the native viewer", () => {
    const markdown = serializeInfographicDocument({ schemaVersion: 1, syntax: "infographic list-row-simple-horizontal-arrow\ndata\n  title Test" });
    expect(hasMobileInfographic(markdown)).toBe(true);
    const viewerContent = resolveMobileMemoViewerContent(null, markdown);
    expect(JSON.stringify(viewerContent)).toContain("infographic list-row-simple-horizontal-arrow");
    expect(JSON.stringify(viewerContent)).not.toContain("edgeever-infographic-v1");
  });

  test("fills the remaining phone viewport instead of shrinking the canvas to a postage stamp", () => {
    const source = readFileSync(new URL("../components/LocalTiptapEditor.tsx", import.meta.url), "utf8");
    expect(source).toContain(".edgeever-editor-scroll:has(.edgeever-x6-document) { display: flex; flex-direction: column; overflow: hidden; }");
    expect(source).toContain("flex: 1 1 auto");
    expect(source).not.toContain("height: min(56vh, 520px)");
  });

  test("does not leak diagram metadata when browser codec globals are unavailable", () => {
    const serialized = serializeDiagramDocument(createDefaultDiagramDocument("mind-map"));
    const originalAtob = globalThis.atob;
    const originalBtoa = globalThis.btoa;
    const originalTextDecoder = globalThis.TextDecoder;
    const originalTextEncoder = globalThis.TextEncoder;
    try {
      globalThis.atob = undefined;
      globalThis.btoa = undefined;
      globalThis.TextDecoder = undefined;
      globalThis.TextEncoder = undefined;
      expect(getMobileVisualDiagramKind(serialized)).toBe("mind-map");
      const viewerContent = resolveMobileMemoViewerContent(null, serialized);
      expect(JSON.stringify(viewerContent)).not.toContain("edgeever-diagram-v1");
      expect(hasMermaidCodeBlock(viewerContent)).toBe(false);
    } finally {
      globalThis.atob = originalAtob;
      globalThis.btoa = originalBtoa;
      globalThis.TextDecoder = originalTextDecoder;
      globalThis.TextEncoder = originalTextEncoder;
    }
  });
});
