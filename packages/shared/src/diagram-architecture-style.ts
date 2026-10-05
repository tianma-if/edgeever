import { DIAGRAM_CANVAS_DARK, DIAGRAM_CANVAS_LIGHT } from "./diagram-canvas";
import type { ArchitectureResourceIcon, DiagramEdgeKind, DiagramNodeShape } from "./diagram";
import {
  ARCHITECTURE_RESOURCE_ICON_ELEMENTS,
  type ArchitectureIconElement,
} from "./diagram-architecture-icons";

export type { ArchitectureIconElement };

export const ARCHITECTURE_LABEL_FONT =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const ARCHITECTURE_NODE_FONT_SIZE = 12;
export const ARCHITECTURE_NODE_FONT_WEIGHT = 550;
export const ARCHITECTURE_NODE_LINE_HEIGHT = 17;
export const ARCHITECTURE_EDGE_LABEL_FONT_SIZE = 10;
export const ARCHITECTURE_EDGE_LABEL_LINE_HEIGHT = 14;

export const ARCHITECTURE_ICON_SIZE = 24;
export const ARCHITECTURE_ICON_FRAME = 34;
export const ARCHITECTURE_ICON_INSET = 10;

export type ArchitectureAppearance = "light" | "dark";
export type ArchitectureEdgePortName = "top" | "right" | "bottom" | "left";
export type ArchitectureEdgeBox = { x: number; y: number; width: number; height: number };
const NARROW_COLUMN_GAP = 32;
const CLEAR_VERTICAL_GAP = 64;

export const architectureEdgeRouter = (
  sourceId: string,
  targetId: string,
  boundaryIds: string[],
  ports?: { source: ArchitectureEdgePortName; target: ArchitectureEdgePortName },
) => ({
  name: "manhattan" as const,
  args: {
    padding: 8,
    step: 8,
    maxLoopCount: 5000,
    // Boundaries are visual containers; components and endpoints are the obstacles.
    // Per-edge exclusions also keep X6's shared obstacle map specific to this edge.
    excludeNodes: [...new Set([sourceId, targetId, ...boundaryIds])],
    ...(ports ? { startDirections: [ports.source], endDirections: [ports.target] } : {}),
  },
});

export const architectureEdgePorts = (
  source: ArchitectureEdgeBox,
  target: ArchitectureEdgeBox,
): { source: ArchitectureEdgePortName; target: ArchitectureEdgePortName } => {
  const sourceRight = source.x + source.width;
  const targetRight = target.x + target.width;
  const verticalGapAbove = source.y - (target.y + target.height);
  const verticalGapBelow = target.y - (source.y + source.height);
  if (target.x >= sourceRight) {
    // A narrow side corridor cannot accommodate a horizontal approach when
    // the target is several rows away; enter from its nearer vertical side.
    if (target.x - sourceRight < NARROW_COLUMN_GAP && verticalGapAbove > CLEAR_VERTICAL_GAP) return { source: "right", target: "bottom" };
    if (target.x - sourceRight < NARROW_COLUMN_GAP && verticalGapBelow > CLEAR_VERTICAL_GAP) return { source: "right", target: "top" };
    return { source: "right", target: "left" };
  }
  if (targetRight <= source.x) {
    if (source.x - targetRight < NARROW_COLUMN_GAP && verticalGapAbove > CLEAR_VERTICAL_GAP) return { source: "left", target: "bottom" };
    if (source.x - targetRight < NARROW_COLUMN_GAP && verticalGapBelow > CLEAR_VERTICAL_GAP) return { source: "left", target: "top" };
    return { source: "left", target: "right" };
  }

  const sourceCenterY = source.y + source.height / 2;
  const targetCenterY = target.y + target.height / 2;
  return targetCenterY >= sourceCenterY
    ? { source: "bottom", target: "top" }
    : { source: "top", target: "bottom" };
};

export type ArchitectureEdgeTerminal = { side: ArchitectureEdgePortName; offset: number };

export const architectureTerminalAnchor = ({ side, offset }: ArchitectureEdgeTerminal) => ({
  name: side,
  args: side === "left" || side === "right" ? { dy: offset } : { dx: offset },
});

/** Spread edges on a node face so separate relationships do not leave through one point. */
export const architectureEdgeTerminals = (
  nodes: Array<ArchitectureEdgeBox & { id: string }>,
  edges: Array<{ id: string; source: string; target: string }>,
) => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const terminals = new Map<string, { source: ArchitectureEdgeTerminal; target: ArchitectureEdgeTerminal }>();
  const faces = new Map<string, Array<{ edgeId: string; end: "source" | "target"; opposite: number }>>();
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const ports = architectureEdgePorts(source, target);
    terminals.set(edge.id, {
      source: { side: ports.source, offset: 0 },
      target: { side: ports.target, offset: 0 },
    });
    for (const [end, node, side, oppositeNode] of [
      ["source", source, ports.source, target],
      ["target", target, ports.target, source],
    ] as const) {
      const key = `${node.id}:${side}`;
      const face = faces.get(key) ?? [];
      face.push({
        edgeId: edge.id,
        end,
        opposite: side === "left" || side === "right"
          ? oppositeNode.y + oppositeNode.height / 2
          : oppositeNode.x + oppositeNode.width / 2,
      });
      faces.set(key, face);
    }
  }
  for (const [key, face] of faces) {
    if (face.length < 2) continue;
    const separator = key.lastIndexOf(":");
    const node = nodeById.get(key.slice(0, separator));
    const side = key.slice(separator + 1);
    if (!node) continue;
    const length = side === "left" || side === "right" ? node.height : node.width;
    const span = Math.min(Math.max(0, length - 28), (face.length - 1) * 16);
    face.sort((a, b) => a.opposite - b.opposite || a.edgeId.localeCompare(b.edgeId));
    face.forEach(({ edgeId, end }, index) => {
      const terminal = terminals.get(edgeId);
      if (terminal) terminal[end].offset = Math.round(-span / 2 + span * index / (face.length - 1));
    });
  }
  return terminals;
};

export type ArchitectureComponentShape = Exclude<
  DiagramNodeShape,
  "topic" | "process" | "decision" | "terminator" | "boundary"
>;

export const ARCHITECTURE_COMPONENT_SHAPES: ArchitectureComponentShape[] = [
  "client", "frontend", "service", "database", "storage", "queue", "security", "external",
];

export const isArchitectureNodeShape = (shape: DiagramNodeShape) =>
  shape === "boundary" || ARCHITECTURE_COMPONENT_SHAPES.includes(shape as ArchitectureComponentShape);

export const ARCHITECTURE_ACCENTS: Record<ArchitectureComponentShape, string> = {
  client: "#2B5A84",
  frontend: "#4338CA",
  service: "#16A06E",
  database: "#7C3AED",
  storage: "#D97706",
  queue: "#EA580C",
  security: "#E11D48",
  external: "#64748B",
};

export const ARCHITECTURE_SHAPE_RESOURCE: Record<ArchitectureComponentShape, ArchitectureResourceIcon> = {
  client: "client",
  frontend: "webApp",
  service: "service",
  database: "relationalDatabase",
  storage: "objectStorage",
  queue: "messageQueue",
  security: "waf",
  external: "saas",
};

export type ArchitectureShapePaint = {
  fill: string;
  stroke: string;
  text: string;
  accent: string;
  iconFrame: string;
};

export type ArchitectureEdgePaint = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  markerWidth: number;
  markerHeight: number;
};

export type ArchitectureSurface = {
  canvas: string;
  boundaryStroke: string;
  boundaryText: string;
  boundaryFill: string;
  boundaryBadgeFill: string;
  boundaryBadgeStroke: string;
  nodes: Record<ArchitectureComponentShape, ArchitectureShapePaint>;
  edges: Record<Exclude<DiagramEdgeKind, never>, ArchitectureEdgePaint>;
};

export const ARCHITECTURE_SURFACES: Record<ArchitectureAppearance, ArchitectureSurface> = {
  light: {
    canvas: DIAGRAM_CANVAS_LIGHT,
    boundaryStroke: "#7B8F86",
    boundaryText: "#1C3D31",
    boundaryFill: "rgba(123, 143, 134, 0.05)",
    boundaryBadgeFill: "rgba(255, 255, 255, 0.95)",
    boundaryBadgeStroke: "rgba(123, 143, 134, 0.4)",
    nodes: {
      client: { fill: "#E9EFF5", stroke: "#3B6285", text: "#1A3B5C", accent: "#2B5A84", iconFrame: "#D4E2EE" },
      frontend: { fill: "#EEF2FF", stroke: "#4338CA", text: "#312E81", accent: "#4F46E5", iconFrame: "#E0E7FF" },
      service: { fill: "#E3F4EE", stroke: "#169567", text: "#19563E", accent: "#16A06E", iconFrame: "#D0ECE2" },
      database: { fill: "#EFE7FD", stroke: "#7437DC", text: "#472877", accent: "#7C3AED", iconFrame: "#E5D8FB" },
      storage: { fill: "#FAEFE1", stroke: "#CA6F07", text: "#71430F", accent: "#D97706", iconFrame: "#F7E4CD" },
      queue: { fill: "#FCEBE2", stroke: "#DA530D", text: "#793512", accent: "#EA580C", iconFrame: "#FBDECE" },
      security: { fill: "#FBE4E9", stroke: "#D11D44", text: "#751B2D", accent: "#E11D48", iconFrame: "#F9D2DA" },
      external: { fill: "#ECEEF1", stroke: "#5E6D82", text: "#3C424B", accent: "#64748B", iconFrame: "#E0E3E8" },
    },
    edges: {
      dependency: { stroke: "#64748B", strokeWidth: 1.2, markerWidth: 7, markerHeight: 5 },
      request: { stroke: "#0F8A5C", strokeWidth: 1.6, markerWidth: 8, markerHeight: 6 },
      data: { stroke: "#7C3AED", strokeWidth: 1.6, markerWidth: 8, markerHeight: 6 },
      async: { stroke: "#EA580C", strokeWidth: 1.5, strokeDasharray: "7 5", markerWidth: 8, markerHeight: 6 },
    },
  },
  dark: {
    canvas: DIAGRAM_CANVAS_DARK,
    boundaryStroke: "#5B6F66",
    boundaryText: "#D7F4E8",
    boundaryFill: "rgba(91, 111, 102, 0.12)",
    boundaryBadgeFill: "rgba(16, 19, 17, 0.95)",
    boundaryBadgeStroke: "rgba(91, 111, 102, 0.5)",
    nodes: {
      client: { fill: "#132537", stroke: "#5A8EB9", text: "#DCE8F2", accent: "#5A8EB9", iconFrame: "#1C3752" },
      frontend: { fill: "#18214D", stroke: "#6366F1", text: "#E0E7FF", accent: "#6366F1", iconFrame: "#232F6B" },
      service: { fill: "#123A2B", stroke: "#49B58E", text: "#D5EEE5", accent: "#49B58E", iconFrame: "#13573E" },
      database: { fill: "#2E1E4F", stroke: "#9965F1", text: "#E7DCFC", accent: "#9965F1", iconFrame: "#44267B" },
      storage: { fill: "#482F0E", stroke: "#E1953D", text: "#F8E7D2", accent: "#E1953D", iconFrame: "#70430C" },
      queue: { fill: "#4D2610", stroke: "#EF7D41", text: "#FBE1D3", accent: "#EF7D41", iconFrame: "#79340F" },
      security: { fill: "#4B1620", stroke: "#E84F70", text: "#FAD6DE", accent: "#E84F70", iconFrame: "#74182B" },
      external: { fill: "#282E33", stroke: "#8693A5", text: "#E3E6EA", accent: "#8693A5", iconFrame: "#38424C" },
    },
    edges: {
      dependency: { stroke: "#94A3B8", strokeWidth: 1.2, markerWidth: 7, markerHeight: 5 },
      request: { stroke: "#4DB58B", strokeWidth: 1.6, markerWidth: 8, markerHeight: 6 },
      data: { stroke: "#A78BFA", strokeWidth: 1.6, markerWidth: 8, markerHeight: 6 },
      async: { stroke: "#FB923C", strokeWidth: 1.5, strokeDasharray: "7 5", markerWidth: 8, markerHeight: 6 },
    },
  },
};

export const resolveArchitectureSurface = (appearance: ArchitectureAppearance = "light") =>
  ARCHITECTURE_SURFACES[appearance];

export const architectureShapePaint = (shape: DiagramNodeShape, appearance: ArchitectureAppearance) => {
  const surface = resolveArchitectureSurface(appearance);
  if (shape === "boundary") {
    return {
      fill: surface.boundaryFill,
      stroke: surface.boundaryStroke,
      text: surface.boundaryText,
      accent: surface.boundaryStroke,
      iconFrame: "transparent",
    } satisfies ArchitectureShapePaint;
  }
  if (ARCHITECTURE_COMPONENT_SHAPES.includes(shape as ArchitectureComponentShape)) {
    return surface.nodes[shape as ArchitectureComponentShape];
  }
  return surface.nodes.service;
};

const architectureBodyRadius = (shape: DiagramNodeShape, height: number) => {
  if (shape === "database" || shape === "queue" || shape === "external") return Math.round(height / 2);
  if (shape === "security") return 16;
  if (shape === "frontend") return 10;
  if (shape === "service") return 8;
  if (shape === "client" || shape === "storage") return 6;
  return 11;
};

const architectureIconFrameRadius = (shape: DiagramNodeShape) => {
  if (shape === "database" || shape === "external") return 17;
  if (shape === "security") return 12;
  if (shape === "queue") return 10;
  return 8;
};

export const architectureIconOffset = (height: number) =>
  Math.round((height - ARCHITECTURE_ICON_FRAME) / 2);

export const architectureIconElements = (
  resourceIcon: ArchitectureResourceIcon | undefined,
  shape: DiagramNodeShape,
): ArchitectureIconElement[] => {
  const resolved = resourceIcon
    ?? (ARCHITECTURE_COMPONENT_SHAPES.includes(shape as ArchitectureComponentShape)
      ? ARCHITECTURE_SHAPE_RESOURCE[shape as ArchitectureComponentShape]
      : "service");
  return ARCHITECTURE_RESOURCE_ICON_ELEMENTS[resolved] ?? ARCHITECTURE_RESOURCE_ICON_ELEMENTS.service;
};

export const architectureNodeMarkup = (
  resourceIcon: ArchitectureResourceIcon | undefined,
  shape: DiagramNodeShape,
) => {
  if (shape === "boundary") {
    return [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "headerBadge" },
      { tagName: "text", selector: "label" },
    ];
  }
  const icons = architectureIconElements(resourceIcon, shape);
  return [
    { tagName: "rect", selector: "body" },
    { tagName: "rect", selector: "iconFrame" },
    ...icons.map((icon, index) => ({ tagName: icon.tagName, selector: `architectureIcon${index}` })),
    { tagName: "text", selector: "label" },
  ];
};

export const architectureNodeVisual = (
  shape: DiagramNodeShape,
  appearance: ArchitectureAppearance,
  size: { width: number; height: number },
  resourceIcon?: ArchitectureResourceIcon,
) => {
  const surface = resolveArchitectureSurface(appearance);
  const paint = architectureShapePaint(shape, appearance);
  const boundary = shape === "boundary";
  const radius = architectureBodyRadius(shape, size.height);
  const iconY = architectureIconOffset(size.height);
  const icons = boundary ? [] : architectureIconElements(resourceIcon, shape);
  const iconAttrs = Object.fromEntries(icons.map((icon, index) => [`architectureIcon${index}`, {
    ...icon.attrs,
    transform: `translate(15 ${iconY + 5})`,
    fill: "none",
    stroke: paint.accent,
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    pointerEvents: "none",
  }]));
  return {
    markup: architectureNodeMarkup(resourceIcon, shape),
    body: {
      fill: paint.fill,
      stroke: paint.stroke,
      strokeWidth: 1.5,
      strokeDasharray: boundary || shape === "external" ? "7 5" : undefined,
      rx: radius,
      ry: radius,
    },
    label: {
      fill: paint.text,
      fontSize: boundary ? 12 : ARCHITECTURE_NODE_FONT_SIZE,
      fontWeight: boundary ? 650 : ARCHITECTURE_NODE_FONT_WEIGHT,
      fontFamily: ARCHITECTURE_LABEL_FONT,
      lineHeight: boundary ? 18 : ARCHITECTURE_NODE_LINE_HEIGHT,
      ...(boundary
        ? { refX: 20, refY: 20, textAnchor: "start" as const, textVerticalAnchor: "middle" as const }
        : { refX: 54, refY: "50%", textAnchor: "start" as const, textVerticalAnchor: "middle" as const }),
    },
    attrs: (boundary ? {
      headerBadge: {
        ref: "label",
        refWidth: 1,
        refHeight: 1,
        refWidth2: 16,
        refHeight2: 6,
        refX: -8,
        refY: -3,
        fill: surface.boundaryBadgeFill,
        stroke: surface.boundaryBadgeStroke,
        strokeWidth: 1,
        rx: 4,
        ry: 4,
        pointerEvents: "none",
      },
    } : {
      iconFrame: {
        x: ARCHITECTURE_ICON_INSET,
        y: iconY,
        width: ARCHITECTURE_ICON_FRAME,
        height: ARCHITECTURE_ICON_FRAME,
        rx: architectureIconFrameRadius(shape),
        ry: architectureIconFrameRadius(shape),
        fill: paint.iconFrame,
        stroke: "none",
        pointerEvents: "none",
      },
      ...iconAttrs,
    }) as Record<string, Record<string, string | number | undefined>>,
  };
};

export const architectureEdgeVisual = (
  kind: DiagramEdgeKind | undefined,
  appearance: ArchitectureAppearance,
  bidirectional = false,
) => {
  const paint = resolveArchitectureSurface(appearance).edges[kind ?? "dependency"];
  const marker = { name: "block" as const, width: paint.markerWidth, height: paint.markerHeight };
  return {
    stroke: paint.stroke,
    strokeWidth: paint.strokeWidth,
    strokeDasharray: paint.strokeDasharray,
    sourceMarker: bidirectional ? marker : null,
    targetMarker: marker,
    fill: "none" as const,
  };
};

const mermaidClassName: Record<ArchitectureComponentShape, string> = {
  client: "archClient",
  frontend: "archFrontend",
  service: "archService",
  database: "archDatabase",
  storage: "archStorage",
  queue: "archQueue",
  security: "archSecurity",
  external: "archExternal",
};

export const architectureMermaidClassName = (shape: DiagramNodeShape) =>
  mermaidClassName[shape as ArchitectureComponentShape];

export const architectureMermaidClassDefs = (appearance: ArchitectureAppearance = "light") => {
  const surface = resolveArchitectureSurface(appearance);
  return ARCHITECTURE_COMPONENT_SHAPES.map((shape) => {
    const paint = surface.nodes[shape];
    const dashed = shape === "external" ? ",stroke-dasharray:6 4" : "";
    return `  classDef ${mermaidClassName[shape]} fill:${paint.fill},stroke:${paint.stroke},color:${paint.text},stroke-width:1.5px${dashed}`;
  });
};

export const architectureMermaidBoundaryStyle = (appearance: ArchitectureAppearance = "light") => {
  const surface = resolveArchitectureSurface(appearance);
  return `fill:transparent,stroke:${surface.boundaryStroke},stroke-width:1.5px,stroke-dasharray:7 5`;
};
