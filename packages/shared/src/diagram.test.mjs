import { describe, expect, test } from "bun:test";
import { DIAGRAM_CANVAS_DARK, DIAGRAM_CANVAS_LIGHT } from "./diagram-canvas.ts";
import { createDefaultDiagramDocument, DIAGRAM_SELECTABLE_STRUCTURES, DIAGRAM_SELECTABLE_THEMES, diagramDocumentToMermaid, diagramFallbackMarkdown, hasDiagramDocumentMarker, parseDiagramDocument, serializeDiagramDocument, stripDiagramDocumentMarker } from "./diagram.ts";
import { diagramDocumentToX6Cells } from "./diagram-view.ts";
import { markdownToDoc } from "./content.ts";

describe("diagram document", () => {
  test("round-trips unicode labels through the Markdown compatibility envelope", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.nodes[0].label = "产品路线图 🚀";
    document.theme = "ocean";
    document.structure = "box";
    expect(parseDiagramDocument(serializeDiagramDocument(document))).toEqual(document);
  });

  test("offers selectable mind-map layouts and color schemes", () => {
    expect(DIAGRAM_SELECTABLE_STRUCTURES).toEqual([
      "map", "line", "capsule", "box", "circle", "ellipse", "hexagon",
      "logic", "tree", "brace", "org", "timeline", "fishbone",
    ]);
    expect(DIAGRAM_SELECTABLE_THEMES[0]).toBe("plain");
    expect(DIAGRAM_SELECTABLE_THEMES).toHaveLength(11);
    const document = createDefaultDiagramDocument("mind-map");
    document.theme = "mint";
    document.structure = "fishbone";
    expect(parseDiagramDocument(serializeDiagramDocument(document))).toEqual(document);
    const unknown = structuredClone(document);
    unknown.theme = "not-a-theme";
    const encoded = serializeDiagramDocument(unknown);
    const parsedUnknown = parseDiagramDocument(encoded.replace("not-a-theme", "not-a-theme"));
    expect(parsedUnknown?.theme).toBeUndefined();
  });

  test("parses the envelope without browser base64 and text codec globals", () => {
    const originalAtob = globalThis.atob;
    const originalBtoa = globalThis.btoa;
    const originalTextDecoder = globalThis.TextDecoder;
    const originalTextEncoder = globalThis.TextEncoder;
    try {
      globalThis.atob = undefined;
      globalThis.btoa = undefined;
      globalThis.TextDecoder = undefined;
      globalThis.TextEncoder = undefined;
      const document = createDefaultDiagramDocument("mind-map");
      document.nodes[0].label = "核心主题";
      expect(parseDiagramDocument(serializeDiagramDocument(document))).toEqual(document);
    } finally {
      globalThis.atob = originalAtob;
      globalThis.btoa = originalBtoa;
      globalThis.TextDecoder = originalTextDecoder;
      globalThis.TextEncoder = originalTextEncoder;
    }
  });

  test("accepts wrapped metadata and strips invalid envelopes from visible content", () => {
    const serialized = serializeDiagramDocument(createDefaultDiagramDocument("mind-map"));
    const wrapped = serialized.replace(
      /(edgeever-diagram-v1:)([A-Za-z0-9_-]+)/,
      (_match, prefix, payload) => `${prefix}${payload.match(/.{1,48}/g).join("\n")}`,
    );
    expect(parseDiagramDocument(wrapped)?.kind).toBe("mind-map");

    const invalid = `${diagramFallbackMarkdown(createDefaultDiagramDocument("flowchart"))}\n\n<!-- edgeever-diagram-v1:not-json -->`;
    expect(hasDiagramDocumentMarker(invalid)).toBe(true);
    expect(parseDiagramDocument(invalid)).toBeNull();
    expect(stripDiagramDocumentMarker(invalid)).not.toContain("edgeever-diagram-v1");
    expect(stripDiagramDocumentMarker(invalid)).toContain("```mermaid");
  });

  test("persists a Mermaid fallback in the portable Markdown envelope", () => {
    const markdown = serializeDiagramDocument(createDefaultDiagramDocument("flowchart"));
    expect(markdown).toContain("# 流程图");
    expect(markdown).toContain("```mermaid\nflowchart TD");
    expect(markdown).toContain('n1["处理步骤"]');
    expect(markdown).toContain("classDef flowProcess fill:#FFFFFF,stroke:#D4D4D4,color:#212121");
    expect(markdown).toContain("classDef flowTerminator fill:#707070,stroke:#707070,color:#FFFFFF");
    expect(markdown).toContain("class n1 flowProcess");
    expect(markdown).toContain("class n0 flowTerminator");

    const paper = createDefaultDiagramDocument("flowchart");
    paper.theme = "paper";
    expect(diagramDocumentToMermaid(paper)).toContain("classDef flowTerminator fill:#F0E4D0,stroke:#7A5230");
    const mint = createDefaultDiagramDocument("flowchart");
    mint.theme = "mint";
    expect(diagramDocumentToMermaid(mint)).toContain("classDef flowTerminator fill:#D4EEE8,stroke:#1A7A70");
    const naive = createDefaultDiagramDocument("flowchart");
    naive.theme = "naive";
    expect(diagramDocumentToMermaid(naive)).toContain("classDef flowProcess fill:#FFFFFF,stroke:#6F9B88");

    const doc = markdownToDoc(markdown);
    expect(doc.content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "mermaid")).toBe(true);
  });

  test("persists flowchart paper and ink surfaces in the native projection", () => {
    const document = createDefaultDiagramDocument("flowchart");
    document.theme = "paper";
    expect(parseDiagramDocument(serializeDiagramDocument(document))?.theme).toBe("paper");
    const paper = diagramDocumentToX6Cells(document, "light");
    expect(paper.canvas).toBe(DIAGRAM_CANVAS_LIGHT);
    expect(paper.nodes.find((node) => node.id === "flow-start").attrs.body.stroke).toBe("#7A5230");
    document.theme = "ink";
    const ink = diagramDocumentToX6Cells(document, "light");
    expect(ink.canvas).toBe(DIAGRAM_CANVAS_LIGHT);
    expect(ink.nodes.find((node) => node.id === "flow-start").attrs.body.stroke).toBe("#3A4656");
  });

  test("projects native viewers into the same branded X6 palette", () => {
    const document = createDefaultDiagramDocument("mind-map");
    expect(document.theme).toBe("plain");
    const plain = diagramDocumentToX6Cells(document, "light");
    expect(plain.canvas).toBe(DIAGRAM_CANVAS_LIGHT);
    expect(plain.nodes[0].attrs.body.fill).toBe("#707070");
    expect(plain.nodes[0].attrs.label.fill).toBe("#FFFFFF");
    expect(plain.nodes[1].attrs.body.fill).toBe("#FFFFFF");
    expect(plain.nodes[1].attrs.body.stroke).toBe(plain.nodes[2].attrs.body.stroke);
    expect(plain.nodes.find((node) => node.id === "topic-1-a").attrs.underline.stroke).toBe("#737373");
    const unset = structuredClone(document);
    delete unset.theme;
    expect(diagramDocumentToX6Cells(unset, "light").nodes[0].attrs.body.fill).toBe("#707070");

    document.theme = "brand";
    const light = diagramDocumentToX6Cells(document, "light");
    expect(light.canvas).toBe(DIAGRAM_CANVAS_LIGHT);
    expect(light.nodes[0].attrs.body.fill).toBe("#16A06E");
    expect(light.nodes[0].attrs.body.rx).toBe(23);
    expect(light.nodes[1].attrs.body.fill).toBe("#F0F8F4");
    const nested = light.nodes.find((node) => node.id === "topic-1-a");
    expect(nested.attrs.body.fill).toBe("transparent");
    expect(nested.attrs.underline.stroke).toBe("#55B891");
    expect(light.edges[0].attrs.line.stroke).toBe("#55B891");
    expect(light.edges[0].attrs.line.targetMarker).toBeNull();
    expect(light.edges[0].connector.name).toBe("edgeever-mindmap");
    expect(light.edges[0].source.anchor.name).toBe("right");
    expect(light.edges.find((edge) => edge.target.cell === "topic-1-a").target.anchor.args.dy).toBeGreaterThan(0);
    const boxed = diagramDocumentToX6Cells({ ...document, structure: "box" }, "light");
    expect(boxed.nodes.find((node) => node.id === "topic-1-a").attrs.body.fill).not.toBe("transparent");
    expect(boxed.nodes.find((node) => node.id === "topic-1-a").attrs.underline.stroke).toBe("none");
    const org = diagramDocumentToX6Cells({ ...document, structure: "org" }, "light");
    expect(org.edges[0].source.anchor.name).toBe("bottom");
    expect(org.edges[0].target.anchor.name).toBe("top");
    expect(org.edges[0].attrs.line.fill).toBe("none");
    expect(org.edges[0].connector.args.structure).toBe("org");

    const classic = diagramDocumentToX6Cells({ ...document, theme: "classic" }, "light");
    expect(classic.nodes.find((node) => node.id === "topic-1").attrs.body.stroke)
      .not.toBe(classic.nodes.find((node) => node.id === "topic-2").attrs.body.stroke);
    expect(classic.nodes.find((node) => node.id === "topic-1-a").attrs.underline.stroke)
      .toBe(classic.edges.find((edge) => edge.target.cell === "topic-1").attrs.line.stroke);

    const dark = diagramDocumentToX6Cells(document, "dark");
    expect(dark.canvas).toBe(DIAGRAM_CANVAS_DARK);
    expect(dark.nodes[1].attrs.body.fill).toBe("#18211D");
  });

  test("escapes labels and emits the mind-map hierarchy as a portable flowchart", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.nodes[0].label = '核心 <主题> "A&B"';
    const source = diagramDocumentToMermaid(document);
    expect(source).toContain("flowchart LR");
    expect(source).toContain("核心 &lt;主题&gt; &quot;A&amp;B&quot;");
    expect(source).toContain("n0 --- n1");
    expect(source).toContain("class n0 mindRoot");
    expect(source).toContain("classDef mindRoot fill:#707070,stroke:#707070,color:#FFFFFF");
  });

  test("round-trips architecture components, boundaries, and semantic connections", () => {
    const document = createDefaultDiagramDocument("architecture");
    document.nodes.find((node) => node.id === "api").resourceIcon = "container";
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

  test("projects forward diagonal architecture edges through horizontal anchors", () => {
    const document = createDefaultDiagramDocument("architecture");
    const edge = document.edges[0];
    const source = document.nodes.find((node) => node.id === edge.source);
    const target = document.nodes.find((node) => node.id === edge.target);
    Object.assign(source, { x: 194, y: 711, width: 170, height: 64 });
    Object.assign(target, { x: 446, y: 658, width: 170, height: 68 });

    const projectedEdge = diagramDocumentToX6Cells(document, "light").edges[0];
    expect(projectedEdge.source.anchor.name).toBe("right");
    expect(projectedEdge.target.anchor.name).toBe("left");
  });

  test("routes aligned architecture edges around intervening components", () => {
    const document = createDefaultDiagramDocument("architecture");
    document.nodes.find((node) => node.id === "client").x = 32;
    document.nodes.find((node) => node.id === "client").y = 32;
    document.nodes.find((node) => node.id === "api").x = 32;
    document.nodes.find((node) => node.id === "api").y = 400;
    document.nodes.find((node) => node.id === "database").x = 32;
    document.nodes.find((node) => node.id === "database").y = 216;
    const projected = diagramDocumentToX6Cells(document, "light");
    const edge = projected.edges.find((item) => item.source.cell === "client" && item.target.cell === "api");
    expect(edge.router.name).toBe("manhattan");
    expect(edge.router.args.excludeNodes).toContain("system");
    expect(edge.router.args.excludeNodes).not.toContain("database");
    expect(edge.router.args.startDirections).toEqual([edge.source.anchor.name]);
    expect(edge.router.args.endDirections).toEqual([edge.target.anchor.name]);
  });

  test("projects architecture edge labels below component typography", () => {
    const document = createDefaultDiagramDocument("architecture");
    const projectedLabel = diagramDocumentToX6Cells(document, "light").edges[0].labels[0].attrs.label;
    expect(projectedLabel.fontSize).toBe(10);
    expect(projectedLabel.lineHeight).toBe(14);
  });

  test("projects mind map edge labels below topic typography", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.edges[0].label = "补充说明";
    const projectedLabel = diagramDocumentToX6Cells(document, "light").edges[0].labels[0].attrs.label;
    expect(projectedLabel.fontSize).toBe(10);
    expect(projectedLabel.lineHeight).toBe(14);
  });

  test("keeps legacy architecture nodes valid and projects resource-specific icons", () => {
    const legacy = createDefaultDiagramDocument("architecture");
    expect(legacy.nodes.every((node) => node.resourceIcon === undefined)).toBe(true);
    expect(parseDiagramDocument(serializeDiagramDocument(legacy))).toEqual(legacy);

    const container = legacy.nodes.find((node) => node.id === "api");
    const database = legacy.nodes.find((node) => node.id === "database");
    container.resourceIcon = "container";
    database.resourceIcon = "noSqlDatabase";
    const projected = diagramDocumentToX6Cells(legacy, "light");
    const containerCell = projected.nodes.find((node) => node.id === "api");
    const databaseCell = projected.nodes.find((node) => node.id === "database");
    expect(containerCell.attrs.architectureIcon0.d).toContain("M22 7.7");
    expect(databaseCell.markup.some((item) => item.selector === "architectureIcon0" && item.tagName === "ellipse")).toBe(true);
    expect(containerCell.attrs.body.fill).toHaveLength(7);
    expect(containerCell.attrs.body.fill).not.toBe(databaseCell.attrs.body.fill);
    const dark = diagramDocumentToX6Cells(legacy, "dark");
    expect(dark.nodes.find((node) => node.id === "api").attrs.body.fill).not.toBe(
      dark.nodes.find((node) => node.id === "database").attrs.body.fill,
    );
    expect(projected.edges[0].source.anchor.name).toBeDefined();
    expect(projected.edges[0].target.anchor.name).toBeDefined();
    expect(["normal", "manhattan"]).toContain(projected.edges[0].router.name);
  });

  test("round-trips AI architecture resources", () => {
    const document = createDefaultDiagramDocument("architecture");
    const resourceIcons = [
      "largeLanguageModel", "multimodalModel", "embeddingModel", "reranker", "modelInference",
      "vectorDatabase", "ragPipeline", "aiAgent", "modelGateway", "mcpServer",
    ];
    document.nodes = resourceIcons.map((resourceIcon, index) => ({
      id: `ai-${index}`,
      label: resourceIcon,
      x: index * 40,
      y: index * 24,
      width: 120,
      height: 64,
      shape: resourceIcon === "vectorDatabase" ? "database" : "service",
      resourceIcon,
    }));
    document.edges = [];
    expect(parseDiagramDocument(serializeDiagramDocument(document))).toEqual(document);
    const projection = diagramDocumentToX6Cells(document, "light");
    expect(projection.nodes).toHaveLength(resourceIcons.length);
    expect(projection.nodes.every((node) => node.markup.some((item) => item.selector === "architectureIcon0"))).toBe(true);
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
    expect(parseDiagramDocument(serializeDiagramDocument(invalidTheme))?.theme).toBeUndefined();

    const architecture = createDefaultDiagramDocument("architecture");
    architecture.nodes.find((node) => node.id === "api").parentId = "database";
    expect(parseDiagramDocument(serializeDiagramDocument(architecture))).toBeNull();
  });
});

test('native flowchart projection shares label sizing and obstacle routing without mutating content', () => {
  const document = createDefaultDiagramDocument('flowchart');
  document.nodes[1].label = 'Transformer 前向计算\n因果注意力以及前馈网络'.repeat(4);
  document.edges[0].label = '是';
  const original = structuredClone(document);
  const projection = diagramDocumentToX6Cells(document, 'dark');
  expect(projection.nodes[1].height).toBeGreaterThan(document.nodes[1].height);
  expect(projection.nodes[1].attrs.label.text.replaceAll('\n', '')).toBe(document.nodes[1].label.replaceAll('\n', ''));
  expect(projection.edges[0].router.name).toBe('normal');
  expect(projection.edges[0].source.port).toBe('bottom');
  expect(projection.edges[0].target.port).toBe('top');
  expect(projection.edges[0].labels[0].attrs.label.fontSize).toBe(10);
  expect(projection.edges[0].labels[0].attrs.label.lineHeight).toBe(14);
  expect(projection.edges[0].attrs.line.fill).toBe('none');
  expect(projection.nodes[0].attrs.body.fill).not.toBe('#16A06E');
  expect(projection.nodes[0].attrs.label.fontFamily).toContain('Inter');
  expect(document).toEqual(original);
});
