export const DIAGRAM_SCHEMA_VERSION = 1 as const;
export const ARCHITECTURE_DIAGRAM_SCHEMA_VERSION = 2 as const;

export type DiagramKind = "mind-map" | "flowchart" | "architecture";
export type DiagramNodeShape =
  | "topic"
  | "process"
  | "decision"
  | "terminator"
  | "client"
  | "frontend"
  | "service"
  | "database"
  | "storage"
  | "queue"
  | "security"
  | "external"
  | "boundary";
export type DiagramEdgeKind = "dependency" | "request" | "async" | "data";
export type DiagramTheme = "brand" | "ocean" | "ink";

export type DiagramNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: DiagramNodeShape;
  parentId?: string;
};

export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: DiagramEdgeKind;
  bidirectional?: boolean;
};

export type DiagramDocument = {
  schemaVersion: typeof DIAGRAM_SCHEMA_VERSION | typeof ARCHITECTURE_DIAGRAM_SCHEMA_VERSION;
  kind: DiagramKind;
  theme?: DiagramTheme;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

const DIAGRAM_MARKER = "edgeever-diagram-v1";
const DIAGRAM_COMMENT = new RegExp(`<!--\\s*${DIAGRAM_MARKER}:([A-Za-z0-9_-]+)\\s*-->`);

const encodeBase64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const decodeBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const DIAGRAM_KINDS = ["mind-map", "flowchart", "architecture"] as const;
const DIAGRAM_NODE_SHAPES: DiagramNodeShape[] = [
  "topic",
  "process",
  "decision",
  "terminator",
  "client",
  "frontend",
  "service",
  "database",
  "storage",
  "queue",
  "security",
  "external",
  "boundary",
];
const DIAGRAM_EDGE_KINDS: DiagramEdgeKind[] = ["dependency", "request", "async", "data"];

const parseNode = (value: unknown): DiagramNode | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const node = value as Record<string, unknown>;
  if (
    typeof node.id !== "string" || !node.id || typeof node.label !== "string"
    || !isFiniteNumber(node.x) || !isFiniteNumber(node.y)
    || !isFiniteNumber(node.width) || !isFiniteNumber(node.height)
    || !DIAGRAM_NODE_SHAPES.includes(node.shape as DiagramNodeShape)
  ) return null;
  return {
    id: node.id,
    label: node.label,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    shape: node.shape as DiagramNodeShape,
    ...(typeof node.parentId === "string" && node.parentId ? { parentId: node.parentId } : {}),
  };
};

const parseEdge = (value: unknown): DiagramEdge | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const edge = value as Record<string, unknown>;
  if (
    typeof edge.id !== "string" || !edge.id || typeof edge.source !== "string" || typeof edge.target !== "string"
    || (edge.kind !== undefined && !DIAGRAM_EDGE_KINDS.includes(edge.kind as DiagramEdgeKind))
    || (edge.bidirectional !== undefined && typeof edge.bidirectional !== "boolean")
  ) return null;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(typeof edge.label === "string" && edge.label ? { label: edge.label } : {}),
    ...(DIAGRAM_EDGE_KINDS.includes(edge.kind as DiagramEdgeKind) ? { kind: edge.kind as DiagramEdgeKind } : {}),
    ...(typeof edge.bidirectional === "boolean" ? { bidirectional: edge.bidirectional } : {}),
  };
};

export const parseDiagramDocument = (markdown: string | null | undefined): DiagramDocument | null => {
  const encoded = markdown?.match(DIAGRAM_COMMENT)?.[1];
  if (!encoded) return null;
  try {
    const value = JSON.parse(decodeBase64Url(encoded)) as Record<string, unknown>;
    if (!DIAGRAM_KINDS.includes(value.kind as DiagramKind)) return null;
    const isArchitecture = value.kind === "architecture";
    if (isArchitecture
      ? value.schemaVersion !== ARCHITECTURE_DIAGRAM_SCHEMA_VERSION
      : value.schemaVersion !== DIAGRAM_SCHEMA_VERSION) return null;
    if (
      !Array.isArray(value.nodes)
      || !Array.isArray(value.edges)
      || (value.theme !== undefined && !["brand", "ocean", "ink"].includes(String(value.theme)))
    ) return null;
    const nodes = value.nodes.map(parseNode);
    const edges = value.edges.map(parseEdge);
    if (nodes.some((node) => !node) || edges.some((edge) => !edge)) return null;
    const nodeIds = new Set((nodes as DiagramNode[]).map((node) => node.id));
    const nodeById = new Map((nodes as DiagramNode[]).map((node) => [node.id, node]));
    if (
      nodeIds.size !== nodes.length
      || (nodes as DiagramNode[]).some((node) => node.parentId && (node.parentId === node.id || !nodeIds.has(node.parentId)))
      || (edges as DiagramEdge[]).some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
    ) return null;
    if (isArchitecture) {
      if ((nodes as DiagramNode[]).some((node) => node.shape === "topic" || node.shape === "process" || node.shape === "decision" || node.shape === "terminator")) return null;
      if ((nodes as DiagramNode[]).some((node) => node.parentId && nodeById.get(node.parentId)?.shape !== "boundary")) return null;
      if ((edges as DiagramEdge[]).some((edge) => nodeById.get(edge.source)?.shape === "boundary" || nodeById.get(edge.target)?.shape === "boundary")) return null;
    } else if ((nodes as DiagramNode[]).some((node) => !["topic", "process", "decision", "terminator"].includes(node.shape))) {
      return null;
    }
    return {
      schemaVersion: value.schemaVersion as DiagramDocument["schemaVersion"],
      kind: value.kind as DiagramKind,
      ...(value.theme ? { theme: value.theme as DiagramTheme } : {}),
      nodes: nodes as DiagramNode[],
      edges: edges as DiagramEdge[],
    };
  } catch {
    return null;
  }
};

export const diagramFallbackMarkdown = (document: DiagramDocument) => {
  const title = document.kind === "mind-map" ? "思维导图" : document.kind === "architecture" ? "架构图" : "流程图";
  return [`# ${title}`, "", "```mermaid", diagramDocumentToMermaid(document), "```"].join("\n");
};

const escapeMermaidLabel = (label: string) =>
  (label.replace(/\s+/g, " ").trim() || "未命名节点")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Portable rendering envelope for clients that do not ship the interactive X6
 * diagram editor. Both native apps already render Mermaid inside their TipTap
 * WebViews, so keeping this in the persisted Markdown makes diagram notes
 * visible there without a second graph renderer.
 */
export const diagramDocumentToMermaid = (document: DiagramDocument) => {
  const nodeIds = new Map(document.nodes.map((node, index) => [node.id, `n${index}`]));
  const direction = document.kind === "mind-map" ? "LR" : "TD";
  const lines = [`flowchart ${direction}`];

  for (const node of document.nodes) {
    const id = nodeIds.get(node.id)!;
    const label = escapeMermaidLabel(node.label);
    const declaration = node.shape === "decision"
      ? `${id}{"${label}"}`
      : node.shape === "terminator"
        ? `${id}(["${label}"])`
        : node.shape === "topic"
          ? `${id}("${label}")`
          : `${id}["${label}"]`;
    lines.push(`  ${declaration}`);
  }

  for (const edge of document.edges) {
    const source = nodeIds.get(edge.source);
    const target = nodeIds.get(edge.target);
    if (!source || !target) continue;
    const label = edge.label ? `|"${escapeMermaidLabel(edge.label)}"|` : "";
    lines.push(`  ${source} -->${label} ${target}`);
  }

  return lines.join("\n");
};

export const serializeDiagramDocument = (document: DiagramDocument) =>
  `${diagramFallbackMarkdown(document)}\n\n<!-- ${DIAGRAM_MARKER}:${encodeBase64Url(JSON.stringify(document))} -->`;

export const createDefaultDiagramDocument = (kind: DiagramKind): DiagramDocument => {
  if (kind === "mind-map") {
    return {
      schemaVersion: DIAGRAM_SCHEMA_VERSION,
      kind,
      nodes: [
        { id: "topic-root", label: "核心主题", x: 72, y: 150, width: 112, height: 42, shape: "topic" },
        { id: "topic-1", label: "分支主题", x: 256, y: 88, width: 92, height: 36, shape: "topic", parentId: "topic-root" },
        { id: "topic-2", label: "分支主题", x: 256, y: 153, width: 92, height: 36, shape: "topic", parentId: "topic-root" },
        { id: "topic-3", label: "分支主题", x: 256, y: 218, width: 92, height: 36, shape: "topic", parentId: "topic-root" },
      ],
      edges: [
        { id: "branch-1", source: "topic-root", target: "topic-1" },
        { id: "branch-2", source: "topic-root", target: "topic-2" },
        { id: "branch-3", source: "topic-root", target: "topic-3" },
      ],
    };
  }
  if (kind === "architecture") {
    return {
      schemaVersion: ARCHITECTURE_DIAGRAM_SCHEMA_VERSION,
      kind,
      nodes: [
        { id: "system", label: "应用系统", x: 220, y: 64, width: 590, height: 330, shape: "boundary" },
        { id: "client", label: "Web 客户端", x: 72, y: 190, width: 150, height: 64, shape: "client" },
        { id: "api", label: "API 服务", x: 280, y: 190, width: 156, height: 68, shape: "service", parentId: "system" },
        { id: "database", label: "数据库", x: 540, y: 118, width: 150, height: 64, shape: "database", parentId: "system" },
        { id: "storage", label: "对象存储", x: 540, y: 268, width: 150, height: 64, shape: "storage", parentId: "system" },
      ],
      edges: [
        { id: "request", source: "client", target: "api", label: "HTTPS", kind: "request" },
        { id: "query", source: "api", target: "database", label: "查询 / 写入", kind: "data" },
        { id: "objects", source: "api", target: "storage", label: "文件", kind: "data" },
      ],
    };
  }
  return {
    schemaVersion: DIAGRAM_SCHEMA_VERSION,
    kind,
    nodes: [
      { id: "flow-start", label: "开始", x: 80, y: 180, width: 104, height: 40, shape: "terminator" },
      { id: "flow-process", label: "处理步骤", x: 256, y: 180, width: 112, height: 40, shape: "process" },
      { id: "flow-end", label: "结束", x: 440, y: 180, width: 104, height: 40, shape: "terminator" },
    ],
    edges: [
      { id: "flow-edge-1", source: "flow-start", target: "flow-process" },
      { id: "flow-edge-2", source: "flow-process", target: "flow-end" },
    ],
  };
};
