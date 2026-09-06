import { describe, expect, test } from "bun:test";
import { createDefaultDiagramDocument, diagramDocumentToMermaid, diagramFallbackMarkdown, parseDiagramDocument, serializeDiagramDocument } from "./diagram.ts";
import { markdownToDoc } from "./content.ts";

describe("diagram document", () => {
  test("round-trips unicode labels through the Markdown compatibility envelope", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.nodes[0].label = "产品路线图 🚀";
    document.theme = "ocean";
    expect(parseDiagramDocument(serializeDiagramDocument(document))).toEqual(document);
  });

  test("persists a Mermaid fallback that native app viewers can render", () => {
    const markdown = serializeDiagramDocument(createDefaultDiagramDocument("flowchart"));
    expect(markdown).toContain("# 流程图");
    expect(markdown).toContain("```mermaid\nflowchart TD");
    expect(markdown).toContain('n1["处理步骤"]');

    const doc = markdownToDoc(markdown);
    expect(doc.content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "mermaid")).toBe(true);
  });

  test("escapes labels and emits the mind-map hierarchy as a portable flowchart", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.nodes[0].label = '核心 <主题> "A&B"';
    const source = diagramDocumentToMermaid(document);
    expect(source).toContain("flowchart LR");
    expect(source).toContain("核心 &lt;主题&gt; &quot;A&amp;B&quot;");
    expect(source).toContain("n0 --> n1");
  });

  test("round-trips architecture components, boundaries, and semantic connections", () => {
    const document = createDefaultDiagramDocument("architecture");
    const parsed = parseDiagramDocument(serializeDiagramDocument(document));
    expect(parsed).toEqual(document);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.nodes.find((node) => node.id === "api").parentId).toBe("system");
    expect(parsed.edges.find((edge) => edge.id === "request").kind).toBe("request");
    expect(diagramFallbackMarkdown(document)).toContain("# 架构图");
    const fallback = diagramDocumentToMermaid(document);
    expect(fallback).toContain('subgraph n0["应用系统"]');
    expect(fallback).toContain('shape: display, label: "Web 客户端"');
    expect(fallback).toContain('shape: st-rect, label: "API 服务"');
    expect(fallback).toContain('shape: cyl, label: "数据库"');
    expect(fallback).toContain('shape: disk, label: "对象存储"');
    expect(fallback).toContain("classDef archDatabase");
  });

  test("rejects malformed and dangling graph data", () => {
    expect(parseDiagramDocument("ordinary note")).toBeNull();
    const document = createDefaultDiagramDocument("flowchart");
    document.nodes = document.nodes.slice(0, 1);
    expect(parseDiagramDocument(serializeDiagramDocument(document))).toBeNull();

    const mindMap = createDefaultDiagramDocument("mind-map");
    mindMap.nodes[1].parentId = "missing-parent";
    expect(parseDiagramDocument(serializeDiagramDocument(mindMap))).toBeNull();

    const invalidTheme = createDefaultDiagramDocument("mind-map");
    invalidTheme.theme = "neon";
    expect(parseDiagramDocument(serializeDiagramDocument(invalidTheme))).toBeNull();

    const architecture = createDefaultDiagramDocument("architecture");
    architecture.nodes.find((node) => node.id === "api").parentId = "database";
    expect(parseDiagramDocument(serializeDiagramDocument(architecture))).toBeNull();
  });
});
