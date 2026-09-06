import { useCallback, useEffect, useRef, useState } from "react";
import { Export, Graph, History, Keyboard, Selection, type Edge, type Node } from "@antv/x6";
import {
  Box,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  Copy,
  Diamond,
  Database,
  Download,
  FileCode2,
  FileImage,
  GitBranch,
  Globe2,
  HardDrive,
  History as HistoryIcon,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Network,
  Pencil,
  Redo2,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ARCHITECTURE_DIAGRAM_SCHEMA_VERSION,
  DIAGRAM_SCHEMA_VERSION,
  diagramFallbackMarkdown,
  markdownToDoc,
  parseDiagramDocument,
  serializeDiagramDocument,
  type DiagramDocument,
  type DiagramEdgeKind,
  type DiagramNodeShape,
  type DiagramTheme,
  type MemoDetail,
  type MemoEditSession,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import { RevisionHistoryDialog } from "@/components/dialogs/RevisionHistoryDialog";
import { ShareMemoDialog } from "@/components/dialogs/ShareMemoDialog";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAppearanceTheme } from "@/components/ThemeProvider";
import { api } from "@/lib/api";
import { EDITOR_LOCAL_SAVE_DELAY_MS } from "@/lib/app-helpers";
import { copyTextToClipboard } from "@/lib/clipboard";
import { compactArchitectureNodeSize, compactFlowchartNodeSize, compactMindMapNodeSize, computeDiagramLayout } from "@/lib/diagram-layout";
import { resolveDiagramPalette, type DiagramAppearance } from "@/lib/diagram-theme";
import { isLocalMemoId } from "@/lib/local-mirror";
import { isBrowserOffline } from "@/lib/network-status";
import type { EdgeEverRepository } from "@/lib/repository";
import { cn, formatDateTime } from "@/lib/utils";

type DiagramEditorPaneProps = {
  memo: MemoDetail;
  repository: EdgeEverRepository;
  readOnly: boolean;
  desktopFocusMode: boolean;
  hasNextMemo: boolean;
  hasPreviousMemo: boolean;
  onBackToList: () => void;
  onDeleted: (memoId: string) => Promise<void>;
  onOpenNextMemo: () => void;
  onOpenPreviousMemo: () => void;
  onPermanentDeleted: (memoId: string) => Promise<void>;
  onRestored: (memoId: string) => Promise<void>;
  onSaved: (memo: MemoDetail) => Promise<void>;
  onSaveAsTemplate: (memo: MemoDetail, name: string) => Promise<void>;
  onToggleDesktopFocusMode: () => void;
};

type NodeData = { label: string; shape: DiagramNodeShape; parentId?: string };
type EdgeData = { kind?: DiagramEdgeKind; bidirectional?: boolean };
type MindMapInsertRelation = "child" | "sibling";
type FlowPort = "top" | "right" | "bottom" | "left";
type FlowQuickCreateState = {
  draftEdgeId: string;
  restoreHistory: boolean;
  sourceNodeId: string;
  sourcePort?: FlowPort;
  x: number;
  y: number;
  left: number;
  top: number;
};
type FlowPointerDragState = {
  sourceNodeId: string;
  sourcePort: FlowPort;
  startClientX: number;
  startClientY: number;
};
type NodeEditorState = {
  nodeId: string;
  originalValue: string;
  value: string;
  shape: DiagramNodeShape;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  background: string;
  borderColor: string;
};

const FLOW_ACTIVE_NODE_CLASS = "edgeever-flow-node-active";
const FLOW_PORT_HIT_RADIUS = 14;
const FLOW_PORT_DOT_RADIUS = 7;
const FLOW_QUICK_CREATE_WIDTH = 330;
const FLOW_QUICK_CREATE_HEIGHT = 132;
const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const isConnectableDiagram = (kind: DiagramDocument["kind"]) => kind !== "mind-map";
const architectureNodeLabel = (shape: DiagramNodeShape, t: (key: string) => string) => {
  const labels: Partial<Record<DiagramNodeShape, string>> = {
    client: t("diagram.newClient"),
    frontend: t("diagram.newFrontend"),
    service: t("diagram.newService"),
    database: t("diagram.newDatabase"),
    storage: t("diagram.newStorage"),
    queue: t("diagram.newQueue"),
    security: t("diagram.newSecurity"),
    external: t("diagram.newExternal"),
    boundary: t("diagram.newBoundary"),
  };
  return labels[shape] ?? t("diagram.newService");
};
const oppositeFlowPort = (port?: FlowPort): FlowPort | undefined => port ? ({
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
} as const)[port] : undefined;

const removeFlowDraftEdge = (graph: Graph, edge: Edge, restoreHistory: boolean) => {
  if (graph.isHistoryEnabled()) graph.disableHistory();
  graph.removeCell(edge);
  if (restoreHistory) graph.enableHistory();
};

const setFlowNodePortsActive = (graph: Graph, node: Node, active: boolean) => {
  const apply = () => {
    const view = graph.findViewByCell(node);
    if (!view) return false;
    if (active) view.addClass(FLOW_ACTIVE_NODE_CLASS);
    else view.removeClass(FLOW_ACTIVE_NODE_CLASS);
    view.container.querySelectorAll<SVGElement>(".x6-port-body").forEach((port) => {
      port.style.setProperty("opacity", active ? "1" : "0", "important");
      port.style.setProperty("pointer-events", active ? "auto" : "none", "important");
      const dot = port.querySelector<SVGElement>(".edgeever-flow-port-dot") ?? port;
      if (active) {
        dot.style.setProperty("fill", "var(--brand-green)", "important");
        dot.style.setProperty("stroke", "var(--workspace-editor)", "important");
        dot.style.setProperty("stroke-width", "2px", "important");
        dot.style.setProperty("filter", "drop-shadow(0 1px 3px rgb(var(--brand-green-rgb) / 0.3))");
      } else {
        dot.style.removeProperty("fill");
        dot.style.removeProperty("stroke");
        dot.style.removeProperty("stroke-width");
        dot.style.removeProperty("filter");
      }
    });
    return true;
  };
  if (!apply()) window.requestAnimationFrame(apply);
};

const setOnlyFlowNodePortsActive = (graph: Graph, activeNode?: Node) => {
  graph.getNodes().forEach((node) => setFlowNodePortsActive(graph, node, node.id === activeNode?.id));
};

const applyDiagramSurface = (
  graph: Graph,
  theme: DiagramTheme,
  appearance: DiagramAppearance,
) => {
  graph.drawBackground({ color: resolveDiagramPalette(theme, appearance).canvas });
  graph.clearGrid();
};

const prepareExportSvg = (background: string) => (svg: SVGSVGElement) => {
  svg.querySelectorAll(".x6-port").forEach((element) => element.remove());
  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) return;
  const [x, y, width, height] = viewBox;
  const rect = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("fill", background);
  svg.insertBefore(rect, svg.firstChild);
};

const createLocalEditSession = (memo: MemoDetail): MemoEditSession => ({
  id: `local-edit:${memo.id}`,
  memoId: memo.id,
  baseRevision: memo.revision,
  baseContentHash: memo.contentHash,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

const nodeEditorState = (
  graph: Graph,
  node: Node,
  theme: DiagramTheme,
  appearance: DiagramAppearance,
): NodeEditorState => {
  const data = node.getData<NodeData>();
  const bbox = node.getBBox();
  const topLeft = graph.localToGraph({ x: bbox.x, y: bbox.y });
  const bottomRight = graph.localToGraph({ x: bbox.x + bbox.width, y: bbox.y + bbox.height });
  const isRootTopic = data?.shape === "topic" && !data.parentId;
  const attrs = nodeAttrs(data?.shape ?? "process", theme, appearance, isRootTopic);
  return {
    nodeId: node.id,
    originalValue: data?.label ?? "",
    value: data?.label ?? "",
    shape: data?.shape ?? "process",
    left: topLeft.x,
    top: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
    fontSize: (data?.shape === "topic" ? 14 : 13) * graph.scale().sx,
    color: String(attrs.label.fill),
    background: String(attrs.body.fill),
    borderColor: String(attrs.body.stroke),
  };
};

const nodeAttrs = (
  shape: DiagramNodeShape,
  theme: DiagramTheme,
  appearance: DiagramAppearance,
  isRootTopic = false,
) => {
  const palette = resolveDiagramPalette(theme, appearance);
  const isTerminator = shape === "terminator";
  const isBoundary = shape === "boundary";
  const architectureAccent = ARCHITECTURE_NODE_ACCENTS[shape];
  const isAccent = isRootTopic || isTerminator;
  const architectureFill = appearance === "dark" ? palette.nodeFill : `${architectureAccent}12`;
  const architectureRadius: Partial<Record<DiagramNodeShape, number>> = {
    client: 6,
    frontend: 12,
    service: 8,
    database: 24,
    storage: 6,
    queue: 18,
    security: 16,
    external: 28,
  };
  return {
    body: {
      fill: isBoundary ? "transparent" : architectureAccent ? architectureFill : isAccent ? palette.topicFill : palette.nodeFill,
      stroke: isBoundary ? palette.nodeStroke : architectureAccent ?? (isAccent ? palette.topicStroke : palette.nodeStroke),
      strokeWidth: isBoundary ? 1.5 : isAccent || architectureAccent ? 1.5 : 1,
      strokeDasharray: isBoundary || shape === "external" ? "7 5" : undefined,
      rx: isTerminator ? 24 : architectureRadius[shape] ?? 11,
      ry: isTerminator ? 24 : architectureRadius[shape] ?? 11,
      ...(shape === "decision" ? { refPoints: "0,10 10,0 20,10 10,20" } : {}),
    },
    label: {
      fill: isAccent ? palette.topicText : palette.nodeText,
      fontSize: shape === "topic" ? 14 : isBoundary ? 12 : 13,
      fontWeight: isAccent || isBoundary || architectureAccent ? 650 : 500,
      ...(isBoundary ? { refX: 18, refY: 22, textAnchor: "start", textVerticalAnchor: "middle" } : {}),
    },
  };
};

const ARCHITECTURE_NODE_ACCENTS: Partial<Record<DiagramNodeShape, string>> = {
  client: "#0891B2",
  frontend: "#2563EB",
  service: "#16A06E",
  database: "#7C3AED",
  storage: "#D97706",
  queue: "#EA580C",
  security: "#E11D48",
  external: "#64748B",
};

// Simple 24px pictograms are embedded in the X6 SVG so exports remain self-contained.
const ARCHITECTURE_NODE_ICONS: Partial<Record<DiagramNodeShape, string>> = {
  client: "M3 4h18v13H3z M8 21h8 M12 17v4",
  frontend: "M3 4h18v16H3z M3 9h18 M7 6.5h.01 M10 6.5h.01",
  service: "M4 3h16v7H4z M4 14h16v7H4z M7 6.5h.01 M7 17.5h.01 M16 6.5h2 M16 17.5h2",
  database: "M20 6c0 2.2-3.6 4-8 4S4 8.2 4 6s3.6-4 8-4 8 1.8 8 4Z M4 6v6c0 2.2 3.6 4 8 4s8-1.8 8-4V6 M4 12v6c0 2.2 3.6 4 8 4s8-1.8 8-4v-6",
  storage: "M4 4h16l2 6v10H2V10z M2 10h20 M17 15h.01",
  queue: "M5 6h14 M5 12h14 M5 18h14 M3 6h.01 M3 12h.01 M3 18h.01",
  security: "M12 2 20 5v6c0 5.2-3.4 9.2-8 11-4.6-1.8-8-5.8-8-11V5z M9 12l2 2 4-5",
  external: "M16 16h3a4 4 0 0 0 .6-8A7 7 0 0 0 6.3 6.4 4.5 4.5 0 0 0 7.5 16H10 M14 4h6v6 M20 4l-8 8",
};

const architectureNodeVisuals = (
  shape: DiagramNodeShape,
  size: { width: number; height: number },
  appearance: DiagramAppearance,
) => {
  const accent = ARCHITECTURE_NODE_ACCENTS[shape] ?? "#64748B";
  const iconY = Math.round((size.height - 34) / 2);
  return {
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "iconFrame" },
      { tagName: "path", selector: "architectureIcon" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      iconFrame: {
        x: 10,
        y: iconY,
        width: 34,
        height: 34,
        rx: shape === "database" ? 17 : shape === "security" ? 12 : 8,
        ry: shape === "database" ? 17 : shape === "security" ? 12 : 8,
        fill: appearance === "dark" ? `${accent}30` : `${accent}18`,
        stroke: "none",
        pointerEvents: "none",
      },
      architectureIcon: {
        d: ARCHITECTURE_NODE_ICONS[shape],
        transform: `translate(15 ${iconY + 5})`,
        fill: "none",
        stroke: accent,
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        pointerEvents: "none",
      },
    },
  };
};

const diagramNodeSize = (
  node: DiagramDocument["nodes"][number],
  kind: DiagramDocument["kind"],
) => kind === "mind-map"
  ? compactMindMapNodeSize(node.label, !node.parentId)
  : kind === "architecture"
    ? compactArchitectureNodeSize(node.shape, node)
    : compactFlowchartNodeSize(node.shape);

const flowPortGroup = (
  position: FlowPort,
  palette: ReturnType<typeof resolveDiagramPalette>,
) => ({
  position,
  markup: [
    { tagName: "circle", selector: "hitArea", className: "edgeever-flow-port-hit-area" },
    { tagName: "circle", selector: "circle", className: "edgeever-flow-port-dot" },
  ],
  attrs: {
    hitArea: {
      r: FLOW_PORT_HIT_RADIUS,
      magnet: true,
      fill: "transparent",
      stroke: "transparent",
      pointerEvents: "all",
    },
    circle: {
      r: FLOW_PORT_DOT_RADIUS,
      stroke: palette.topicStroke,
      fill: palette.canvas,
      strokeWidth: 2,
      pointerEvents: "none",
    },
  },
});

const nodeMetadata = (
  node: DiagramDocument["nodes"][number],
  theme: DiagramTheme,
  kind: DiagramDocument["kind"],
  appearance: DiagramAppearance,
) => {
  const isDecision = node.shape === "decision";
  const isRootTopic = node.shape === "topic" && !node.parentId;
  const visualAttrs = nodeAttrs(node.shape, theme, appearance, isRootTopic);
  const palette = resolveDiagramPalette(theme, appearance);
  const size = diagramNodeSize(node, kind);
  const hasPorts = isConnectableDiagram(kind) && node.shape !== "boundary";
  const architectureVisuals = kind === "architecture" && node.shape !== "boundary"
    ? architectureNodeVisuals(node.shape, size, appearance)
    : null;
  return {
    id: node.id,
    shape: isDecision ? "polygon" : "rect",
    x: node.x,
    y: node.y,
    width: size.width,
    height: size.height,
    zIndex: node.shape === "boundary" ? 0 : 2,
    data: { label: node.label, shape: node.shape, ...(node.parentId ? { parentId: node.parentId } : {}) } satisfies NodeData,
    ...(architectureVisuals ? { markup: architectureVisuals.markup } : {}),
    attrs: {
      body: visualAttrs.body,
      label: {
        ...visualAttrs.label,
        text: node.label,
        ...(architectureVisuals ? { refX: 54, refY: "50%", textAnchor: "start", textVerticalAnchor: "middle" } : {}),
      },
      ...(architectureVisuals?.attrs ?? {}),
    },
    ...(hasPorts ? { ports: {
      groups: {
        top: flowPortGroup("top", palette),
        right: flowPortGroup("right", palette),
        bottom: flowPortGroup("bottom", palette),
        left: flowPortGroup("left", palette),
      },
      items: ["top", "right", "bottom", "left"].map((group) => ({ id: group, group })),
    } } : {}),
  };
};

const edgeMetadata = (
  edge: DiagramDocument["edges"][number],
  kind: DiagramDocument["kind"],
  theme: DiagramTheme,
  appearance: DiagramAppearance,
) => {
  const palette = resolveDiagramPalette(theme, appearance);
  const edgeKind = edge.kind ?? (kind === "architecture" ? "dependency" : undefined);
  const edgeStroke = edgeKind === "data"
    ? "#7C3AED"
    : edgeKind === "async"
      ? "#EA580C"
      : kind === "mind-map" ? palette.mindMapEdge : palette.flowEdge;
  return {
    id: edge.id,
    source: { cell: edge.source },
    target: { cell: edge.target },
    router: undefined,
    connector: { name: kind === "mind-map" ? "smooth" : "rounded", args: { radius: 10 } },
    data: { ...(edgeKind ? { kind: edgeKind } : {}), ...(edge.bidirectional ? { bidirectional: true } : {}) } satisfies EdgeData,
    attrs: {
      line: {
        stroke: edgeStroke,
        strokeWidth: kind === "mind-map" ? 2 : 1.5,
        strokeDasharray: edgeKind === "async" ? "7 5" : undefined,
        sourceMarker: edge.bidirectional ? { name: "block", width: 8, height: 6 } : null,
        targetMarker: kind === "mind-map" ? null : { name: "block", width: 8, height: 6 },
      },
    },
    labels: edge.label ? [{ attrs: {
      label: { text: edge.label, fill: palette.nodeText, fontSize: 12 },
      body: { fill: palette.canvas, stroke: palette.nodeStroke, strokeWidth: 1, rx: 5, ry: 5 },
    } }] : undefined,
  };
};

const graphToDocument = (graph: Graph, kind: DiagramDocument["kind"], theme: DiagramTheme): DiagramDocument => ({
  schemaVersion: kind === "architecture" ? ARCHITECTURE_DIAGRAM_SCHEMA_VERSION : DIAGRAM_SCHEMA_VERSION,
  kind,
  theme,
  nodes: graph.getNodes().map((node) => {
    const data = node.getData<NodeData>();
    const position = node.getPosition();
    const size = node.getSize();
    return {
      id: node.id,
      label: data?.label ?? String(node.attr("label/text") ?? ""),
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: Math.round(size.width),
      height: Math.round(size.height),
      shape: data?.shape ?? "process",
      ...(data?.parentId && graph.getCellById(data.parentId)?.isNode() ? { parentId: data.parentId } : {}),
    };
  }),
  edges: graph.getEdges().flatMap((edge) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target) return [];
    const label = edge.getLabels()[0]?.attrs?.label?.text;
    const data = edge.getData<EdgeData>();
    return [{
      id: edge.id,
      source,
      target,
      ...(typeof label === "string" && label ? { label } : {}),
      ...(data?.kind ? { kind: data.kind } : {}),
      ...(data?.bidirectional ? { bidirectional: true } : {}),
    }];
  }),
});

const removeGraphSelection = (graph: Graph) => {
  const selected = graph.getSelectedCells();
  if (selected.length === 0) return false;
  const removalIds = new Set(selected.map((cell) => cell.id));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of graph.getNodes()) {
      const parentId = node.getData<NodeData>()?.parentId;
      if (parentId && removalIds.has(parentId) && !removalIds.has(node.id)) {
        removalIds.add(node.id);
        expanded = true;
      }
    }
  }
  const cells = [...removalIds].map((id) => graph.getCellById(id)).filter((cell) => Boolean(cell));
  graph.startBatch("remove");
  for (const cell of cells) {
    if (cell.isNode()) graph.removeConnectedEdges(cell);
  }
  graph.removeCells(cells);
  graph.stopBatch("remove");
  return true;
};

const diagramEditorSnapshot = (title: string, document: DiagramDocument) => JSON.stringify({
  title,
  document: {
    ...document,
    theme: document.theme ?? "brand",
    nodes: document.nodes.map((node) => ({ ...node, ...diagramNodeSize(node, document.kind) })),
  },
});

const fitDiagramContent = (graph: Graph, document: DiagramDocument, container: HTMLElement | null, padding = 32) => {
  graph.zoomToFit({ padding, maxScale: document.kind === "mind-map" ? 1 : 0.84 });
  if (!container) return;
  const anchor = document.kind === "mind-map"
    ? graph.getNodes().find((node) => !node.getData<NodeData>()?.parentId)
    : graph.getNodes().reduce<Node | null>((leftmost, node) => (
        !leftmost || node.getBBox().x < leftmost.getBBox().x ? node : leftmost
      ), null);
  if (!anchor) return;
  const contentLeft = graph.localToGraph(anchor.getBBox().topLeft).x;
  const desiredLeft = Math.max(32, Math.min(72, container.clientWidth * 0.055));
  const translation = graph.translate();
  graph.translate(translation.tx + desiredLeft - contentLeft, translation.ty);
};

const fitArchitectureBoundaries = (graph: Graph) => {
  const nodes = graph.getNodes();
  for (const boundary of nodes.filter((node) => node.getData<NodeData>()?.shape === "boundary")) {
    const children = nodes.filter((node) => node.getData<NodeData>()?.parentId === boundary.id);
    if (children.length === 0) continue;
    const positions = new Map(children.map((node) => [node.id, node.getPosition()]));
    const boxes = children.map((node) => node.getBBox());
    const left = Math.min(...boxes.map((box) => box.x)) - 36;
    const top = Math.min(...boxes.map((box) => box.y)) - 56;
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + 36;
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 36;
    boundary.position(left, top);
    boundary.resize(Math.max(260, right - left), Math.max(180, bottom - top));
    for (const child of children) {
      const position = positions.get(child.id);
      if (position) child.position(position.x, position.y);
    }
  }
};

const applyGraphPalette = (
  graph: Graph,
  theme: DiagramTheme,
  kind: DiagramDocument["kind"],
  appearance: DiagramAppearance,
) => {
  const palette = resolveDiagramPalette(theme, appearance);
  const historyEnabled = graph.isHistoryEnabled();
  if (historyEnabled) graph.disableHistory();
  try {
    for (const node of graph.getNodes()) {
      const data = node.getData<NodeData>();
      const shape = data?.shape ?? "process";
      const attrs = nodeAttrs(shape, theme, appearance, shape === "topic" && !data?.parentId);
      node.attr("body", attrs.body);
      node.attr("label", { ...attrs.label, text: data?.label ?? "" });
      if (kind === "architecture" && shape !== "boundary") {
        const architectureVisuals = architectureNodeVisuals(shape, node.getSize(), appearance);
        node.attr("iconFrame", architectureVisuals.attrs.iconFrame);
        node.attr("architectureIcon", architectureVisuals.attrs.architectureIcon);
      }
      for (const port of node.getPorts()) {
        if (!port.id) continue;
        node.portProp(port.id, "attrs/circle", {
          stroke: palette.topicStroke,
          fill: palette.canvas,
        });
      }
    }
    for (const edge of graph.getEdges()) {
      const edgeKind = edge.getData<EdgeData>()?.kind;
      edge.attr("line/stroke", edgeKind === "data" ? "#7C3AED" : edgeKind === "async" ? "#EA580C" : kind === "mind-map" ? palette.mindMapEdge : palette.flowEdge);
      if (edge.getLabels().length > 0) {
        edge.attr("label/fill", palette.nodeText);
        edge.attr("body/fill", palette.canvas);
        edge.attr("body/stroke", palette.nodeStroke);
      }
    }
    applyDiagramSurface(graph, theme, appearance);
  } finally {
    if (historyEnabled) graph.enableHistory();
  }
};

export const DiagramEditorPane = ({
  memo,
  repository,
  readOnly,
  desktopFocusMode,
  hasNextMemo,
  hasPreviousMemo,
  onBackToList,
  onDeleted,
  onOpenNextMemo,
  onOpenPreviousMemo,
  onPermanentDeleted,
  onRestored,
  onSaved,
  onSaveAsTemplate,
  onToggleDesktopFocusMode,
}: DiagramEditorPaneProps) => {
  const { t } = useTranslation();
  const { resolvedTheme } = useAppearanceTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const insertNodeRef = useRef<(relation: MindMapInsertRelation, baseNodeId?: string) => void>(() => undefined);
  const openFlowQuickCreateRef = useRef<(node: Node) => void>(() => undefined);
  const memoRef = useRef(memo);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const saveRef = useRef<() => void>(() => undefined);
  const document = parseDiagramDocument(memo.contentMarkdown);
  const documentTheme = document?.theme ?? "brand";
  const [title, setTitle] = useState(memo.title ?? "");
  const [theme, setTheme] = useState<DiagramTheme>(documentTheme);
  const titleRef = useRef(title);
  const themeRef = useRef<DiagramTheme>(documentTheme);
  const appearanceRef = useRef<DiagramAppearance>(resolvedTheme);
  const savedSnapshotRef = useRef(document ? diagramEditorSnapshot(memo.title ?? "", document) : "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeLabel, setSelectedNodeLabel] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedEdgeLabel, setSelectedEdgeLabel] = useState("");
  const [hasSelection, setHasSelection] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editSessionReady, setEditSessionReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [memoIdCopyNotice, setMemoIdCopyNotice] = useState<"copied" | "error" | null>(null);
  const memoIdCopyTimerRef = useRef<number | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [nodeEditor, setNodeEditor] = useState<NodeEditorState | null>(null);
  const [flowQuickCreate, setFlowQuickCreate] = useState<FlowQuickCreateState | null>(null);
  const flowQuickCreateRef = useRef<FlowQuickCreateState | null>(null);
  const flowPointerDragRef = useRef<FlowPointerDragState | null>(null);
  const nodeEditorRef = useRef<NodeEditorState | null>(null);

  const beginNodeEdit = useCallback((node: Node) => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;
    const nextEditor = nodeEditorState(graph, node, themeRef.current, appearanceRef.current);
    nodeEditorRef.current = nextEditor;
    setNodeEditor(nextEditor);
  }, [readOnly]);

  const finishNodeEdit = useCallback((cancel = false) => {
    const graph = graphRef.current;
    const current = nodeEditorRef.current;
    nodeEditorRef.current = null;
    setNodeEditor(null);
    if (!graph || !current) return null;
    const cell = graph.getCellById(current.nodeId);
    if (!cell?.isNode()) return null;
    if (!cancel) {
      const label = current.value.trim() || current.originalValue;
      if (label !== current.originalValue) {
        graph.startBatch("edit-label");
        cell.setData({ ...cell.getData<NodeData>(), label });
        cell.attr("label/text", label);
        graph.stopBatch("edit-label");
        setSelectedNodeLabel(label);
      }
    }
    containerRef.current?.focus({ preventScroll: true });
    return cell;
  }, []);

  const dismissFlowQuickCreate = useCallback(() => {
    const pending = flowQuickCreateRef.current;
    flowQuickCreateRef.current = null;
    setFlowQuickCreate(null);
    if (!pending) return;
    const graph = graphRef.current;
    const draftEdge = graph?.getCellById(pending.draftEdgeId);
    if (graph && draftEdge?.isEdge()) removeFlowDraftEdge(graph, draftEdge, pending.restoreHistory);
    if (graph && pending.restoreHistory) graph.enableHistory();
  }, []);

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedNodeLabel("");
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(false);
    flowQuickCreateRef.current = null;
    setFlowQuickCreate(null);
    nodeEditorRef.current = null;
    setNodeEditor(null);
    setTheme(documentTheme);
    themeRef.current = documentTheme;
    setHistoryOpen(false);
    setShareOpen(false);
    setMemoIdCopyNotice(null);
  }, [documentTheme, memo.id]);

  useEffect(() => () => {
    if (memoIdCopyTimerRef.current !== null) window.clearTimeout(memoIdCopyTimerRef.current);
  }, []);

  useEffect(() => {
    memoRef.current = memo;
    setTitle(memo.title ?? "");
    titleRef.current = memo.title ?? "";
    savedSnapshotRef.current = document ? diagramEditorSnapshot(memo.title ?? "", document) : "";
    setDirty(false);
    setSaveError(null);
    setSaveFailed(false);
    editSessionRef.current = null;
    setEditSessionReady(false);
    if (readOnly || isLocalMemoId(memo.id) || isBrowserOffline() || window.edgeeverDesktop?.isAvailable) {
      editSessionRef.current = createLocalEditSession(memo);
      setEditSessionReady(true);
      return;
    }
    let cancelled = false;
    void api.createMemoEditSession(memo.id).then(({ editSession }) => {
      if (!cancelled) {
        editSessionRef.current = editSession;
        setEditSessionReady(true);
      }
    }).catch(() => {
      if (!cancelled) setSaveError(t("diagram.editSessionError"));
    });
    return () => { cancelled = true; };
  }, [memo.id, memo.contentHash, memo.revision, readOnly, t]);

  useEffect(() => {
    appearanceRef.current = resolvedTheme;
    const graph = graphRef.current;
    if (!graph || !document) return;
    applyGraphPalette(graph, themeRef.current, document.kind, resolvedTheme);
    const currentEditor = nodeEditorRef.current;
    if (!currentEditor) return;
    const node = graph.getCellById(currentEditor.nodeId);
    if (!node?.isNode()) return;
    const visualState = nodeEditorState(graph, node, themeRef.current, resolvedTheme);
    const nextEditor = {
      ...currentEditor,
      color: visualState.color,
      background: visualState.background,
      borderColor: visualState.borderColor,
    };
    nodeEditorRef.current = nextEditor;
    setNodeEditor(nextEditor);
  }, [resolvedTheme, document?.kind]);

  useEffect(() => {
    if (!containerRef.current || !document) return;
    const appearance = appearanceRef.current;
    const palette = resolveDiagramPalette(documentTheme, appearance);
    let graph!: Graph;
    graph = new Graph({
      container: containerRef.current,
      autoResize: true,
      async: true,
      background: { color: palette.canvas },
      grid: false,
      panning: { enabled: true, eventTypes: ["leftMouseDown", "mouseWheel"] },
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: 0.3, maxScale: 2.5 },
      interacting: !readOnly,
      connecting: {
        allowBlank: document.kind === "flowchart",
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        allowPort: isConnectableDiagram(document.kind),
        allowMulti: false,
        highlight: isConnectableDiagram(document.kind),
        snap: { radius: 24 },
        router: "normal",
        connector: document.kind === "mind-map" ? "smooth" : "rounded",
        validateConnection: ({ sourceCell, targetCell, sourcePort, targetPort }) => {
          if (!isConnectableDiagram(document.kind) || !sourceCell || !sourcePort) return false;
          if (!targetCell) return true;
          return Boolean(targetPort && sourceCell.id !== targetCell.id);
        },
        createEdge: (): Edge => {
          dismissFlowQuickCreate();
          const restoreHistory = graph.isHistoryEnabled();
          if (restoreHistory) graph.disableHistory();
          return graph.createEdge({
            ...edgeMetadata(
              { id: createId("edge"), source: "", target: "" },
              document.kind,
              themeRef.current,
              appearanceRef.current,
            ),
            data: { quickConnectDraft: true, restoreHistory },
          });
        },
      },
    });
    graph.use(new History({ enabled: !readOnly }));
    graph.use(new Export());
    graph.use(new Keyboard({
      enabled: !readOnly,
      global: false,
      guard: (event) => {
        const target = event.target;
        return !(target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));
      },
    }));
    graph.use(new Selection({ enabled: true, multiple: true, rubberband: true, movable: !readOnly, showNodeSelectionBox: true, showEdgeSelectionBox: true }));
    graph.addNodes(document.nodes.map((node) => nodeMetadata(node, documentTheme, document.kind, appearance)));
    if (document.kind === "architecture") {
      for (const node of graph.getNodes()) {
        const parentId = node.getData<NodeData>()?.parentId;
        const parent = parentId ? graph.getCellById(parentId) : null;
        if (parent?.isNode()) parent.addChild(node);
      }
    }
    graph.addEdges(document.edges.map((edge) => edgeMetadata(edge, document.kind, documentTheme, appearance)));
    graph.cleanHistory();
    fitDiagramContent(graph, document, containerRef.current);

    const updateHistory = () => setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    const markDirty = () => {
      if (!readOnly) {
        const currentDocument = graphToDocument(graph, document.kind, themeRef.current);
        const hasChanges = savedSnapshotRef.current !== diagramEditorSnapshot(titleRef.current, currentDocument);
        setDirty(hasChanges);
        if (hasChanges) setDirtyVersion((current) => current + 1);
      }
      updateHistory();
    };
    const clearSelectionAfterHistory = () => {
      applyGraphPalette(graph, themeRef.current, document.kind, appearanceRef.current);
      graph.cleanSelection();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph);
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      ));
    };
    graph.on("model:updated", markDirty);
    graph.on("history:change", updateHistory);
    graph.on("history:undo", clearSelectionAfterHistory);
    graph.on("history:redo", clearSelectionAfterHistory);
    graph.on("node:selected", ({ node }: { node: Node }) => {
      if (isConnectableDiagram(document.kind)) setFlowNodePortsActive(graph, node, true);
    });
    graph.on("node:unselected", ({ node }: { node: Node }) => {
      if (isConnectableDiagram(document.kind)) setFlowNodePortsActive(graph, node, false);
    });
    graph.on("node:click", ({ node }: { node: Node }) => {
      const data = node.getData<NodeData>();
      dismissFlowQuickCreate();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph, node);
      containerRef.current?.focus({ preventScroll: true });
      setSelectedNodeId(node.id);
      setSelectedNodeLabel(data?.label ?? "");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(true);
    });
    graph.on("node:dblclick", ({ node }: { node: Node }) => beginNodeEdit(node));
    graph.on("edge:click", ({ edge }: { edge: Edge }) => {
      dismissFlowQuickCreate();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph);
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(edge.id);
      setSelectedEdgeLabel(String(edge.getLabels()[0]?.attrs?.label?.text ?? ""));
      setHasSelection(true);
    });
    graph.on("blank:click", () => {
      dismissFlowQuickCreate();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph);
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
    });
    graph.on("edge:removed", ({ edge }: { edge: Edge }) => {
      const draft = edge.getData<{ quickConnectDraft?: boolean; restoreHistory?: boolean }>();
      if (flowQuickCreateRef.current?.draftEdgeId === edge.id) {
        flowQuickCreateRef.current = null;
        setFlowQuickCreate(null);
      }
      if (draft?.quickConnectDraft && draft.restoreHistory) graph.enableHistory();
    });
    const showFlowQuickCreate = (
      edge: Edge,
      sourceNodeId: string,
      sourcePort: FlowPort | undefined,
      point: { x: number; y: number },
      restoreHistory: boolean,
    ) => {
      if (!containerRef.current) return;
      const overlayPoint = graph.localToGraph(point);
      const nextQuickCreate: FlowQuickCreateState = {
        draftEdgeId: edge.id,
        restoreHistory,
        sourceNodeId,
        sourcePort,
        x: point.x,
        y: point.y,
        left: Math.max(12, Math.min(overlayPoint.x + 12, containerRef.current.clientWidth - FLOW_QUICK_CREATE_WIDTH - 12)),
        top: Math.max(12, Math.min(overlayPoint.y + 12, containerRef.current.clientHeight - FLOW_QUICK_CREATE_HEIGHT - 12)),
      };
      flowQuickCreateRef.current = nextQuickCreate;
      setFlowQuickCreate(nextQuickCreate);
      if (restoreHistory) graph.enableHistory();
    };
    const openFlowQuickCreate = (sourceNode: Node) => {
      dismissFlowQuickCreate();
      const sourceBounds = sourceNode.getBBox();
      const nextSize = compactFlowchartNodeSize("process");
      const sourcePort: FlowPort = "right";
      const point = {
        x: sourceBounds.x + sourceBounds.width + 96 + nextSize.width / 2,
        y: sourceBounds.y + sourceBounds.height / 2,
      };
      const restoreHistory = graph.isHistoryEnabled();
      if (restoreHistory) graph.disableHistory();
      const draftEdge = graph.addEdge({
        ...edgeMetadata(
          { id: createId("edge"), source: sourceNode.id, target: "" },
          document.kind,
          themeRef.current,
          appearanceRef.current,
        ),
        source: { cell: sourceNode.id, port: sourcePort },
        target: point,
        data: { quickConnectDraft: true, restoreHistory },
      });
      showFlowQuickCreate(draftEdge, sourceNode.id, sourcePort, point, restoreHistory);
    };
    openFlowQuickCreateRef.current = openFlowQuickCreate;
    graph.on("edge:connected", ({ edge, isNew, type, currentCell, currentPort, currentPoint }) => {
      if (!isConnectableDiagram(document.kind) || !isNew || type !== "target") return;
      const sourceNodeId = edge.getSourceCellId();
      const source = edge.getSource();
      const draft = edge.getData<{ restoreHistory?: boolean }>();
      const removeDraft = () => {
        graph.removeCell(edge);
        if (draft?.restoreHistory) graph.enableHistory();
      };
      if (!sourceNodeId) {
        removeDraft();
        return;
      }
      if (currentCell?.isNode()) {
        removeDraft();
        graph.startBatch("connect");
        graph.addEdge({
          ...edgeMetadata(
            { id: edge.id, source: sourceNodeId, target: currentCell.id },
            document.kind,
            themeRef.current,
            appearanceRef.current,
          ),
          source,
          target: { cell: currentCell.id, ...(currentPort ? { port: currentPort } : {}) },
        });
        graph.stopBatch("connect");
        return;
      }
      if (!currentPoint || !containerRef.current) {
        removeDraft();
        return;
      }
      showFlowQuickCreate(
        edge,
        sourceNodeId,
        "port" in source && typeof source.port === "string" ? source.port as FlowPort : undefined,
        currentPoint,
        Boolean(draft?.restoreHistory),
      );
    });
    const handleFlowPointerDown = (event: PointerEvent) => {
      if (document.kind !== "flowchart" || readOnly || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const port = target?.closest(".x6-port-body");
      const node = target?.closest(".x6-node");
      const sourcePort = port?.getAttribute("port") as FlowPort | null;
      const sourceNodeId = node?.getAttribute("data-cell-id");
      if (!sourcePort || !sourceNodeId) return;
      flowPointerDragRef.current = {
        sourceNodeId,
        sourcePort,
        startClientX: event.clientX,
        startClientY: event.clientY,
      };
    };
    const handleFlowPointerUp = (event: PointerEvent) => {
      const pointerDrag = flowPointerDragRef.current;
      flowPointerDragRef.current = null;
      if (!pointerDrag || document.kind !== "flowchart" || readOnly) return;
      if (Math.hypot(event.clientX - pointerDrag.startClientX, event.clientY - pointerDrag.startClientY) < 8) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".x6-port-body") || target?.closest(".x6-node")) return;
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      const clientPoint = { x: event.clientX, y: event.clientY };
      window.setTimeout(() => {
        if (graphRef.current !== graph || flowQuickCreateRef.current) return;
        const point = graph.clientToLocal(clientPoint);
        const existingDraft = graph.getEdges().find((candidate) => candidate.getData<{ quickConnectDraft?: boolean }>()?.quickConnectDraft);
        const restoreHistory = existingDraft
          ? Boolean(existingDraft.getData<{ restoreHistory?: boolean }>()?.restoreHistory)
          : graph.isHistoryEnabled();
        if (!existingDraft && restoreHistory) graph.disableHistory();
        const draftEdge = existingDraft ?? graph.addEdge({
          ...edgeMetadata(
            { id: createId("edge"), source: pointerDrag.sourceNodeId, target: "" },
            document.kind,
            themeRef.current,
            appearanceRef.current,
          ),
          source: { cell: pointerDrag.sourceNodeId, port: pointerDrag.sourcePort },
          target: point,
          data: { quickConnectDraft: true, restoreHistory },
        });
        showFlowQuickCreate(draftEdge, pointerDrag.sourceNodeId, pointerDrag.sourcePort, point, restoreHistory);
      }, 0);
    };
    containerRef.current.addEventListener("pointerdown", handleFlowPointerDown, true);
    window.addEventListener("pointerup", handleFlowPointerUp, true);
    graph.bindKey(["backspace", "delete"], (event) => {
      event.preventDefault();
      if (!removeGraphSelection(graph)) return;
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      ));
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    });
    graph.bindKey("enter", (event) => {
      event.preventDefault();
      const selected = graph.getSelectedCells().find((cell) => cell.isNode());
      if (document.kind === "mind-map") {
        insertNodeRef.current("sibling", selected?.id);
      } else if (selected?.isNode()) {
        beginNodeEdit(selected);
      }
    });
    graph.bindKey("tab", (event) => {
      event.preventDefault();
      const selected = graph.getSelectedCells().find((cell) => cell.isNode());
      if (document.kind === "mind-map") {
        insertNodeRef.current("child", selected?.id);
      } else if (document.kind === "flowchart" && selected?.isNode()) {
        openFlowQuickCreate(selected);
      }
    });
    if (isConnectableDiagram(document.kind)) {
      graph.bindKey(["meta+d", "ctrl+d"], (event) => {
        event.preventDefault();
        const selectedNodes = graph.getSelectedCells().filter((cell): cell is Node => cell.isNode());
        if (selectedNodes.length === 0) return;
        graph.startBatch("duplicate");
        const duplicates = selectedNodes.map((node) => {
          const data = node.getData<NodeData>();
          const position = node.getPosition();
          const duplicate = graph.addNode(nodeMetadata({
            id: createId("node"),
            label: data?.label ?? (document.kind === "architecture" ? t("diagram.newService") : t("diagram.newStep")),
            x: position.x + 24,
            y: position.y + 24,
            width: node.getSize().width,
            height: node.getSize().height,
            shape: data?.shape ?? "process",
            ...(data?.parentId ? { parentId: data.parentId } : {}),
          }, themeRef.current, document.kind, appearanceRef.current));
          const parent = data?.parentId ? graph.getCellById(data.parentId) : null;
          if (parent?.isNode()) parent.addChild(duplicate);
          return duplicate;
        });
        graph.stopBatch("duplicate");
        graph.cleanSelection();
        duplicates.forEach((node) => graph.select(node));
        const lastNode = duplicates.at(-1);
        setSelectedNodeId(lastNode?.id ?? null);
        setSelectedNodeLabel(lastNode?.getData<NodeData>()?.label ?? "");
        setHasSelection(duplicates.length > 0);
      });
    }
    const nudgeSelection = (event: KeyboardEvent) => {
      const selectedNodes = graph.getSelectedCells().filter((cell): cell is Node => cell.isNode());
      if (selectedNodes.length === 0) return;
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      const movement = {
        ArrowUp: { dx: 0, dy: -distance },
        ArrowDown: { dx: 0, dy: distance },
        ArrowLeft: { dx: -distance, dy: 0 },
        ArrowRight: { dx: distance, dy: 0 },
      }[event.key];
      if (!movement) return;
      graph.startBatch("nudge");
      selectedNodes.forEach((node) => node.translate(movement.dx, movement.dy));
      graph.stopBatch("nudge");
    };
    graph.bindKey(["up", "down", "left", "right", "shift+up", "shift+down", "shift+left", "shift+right"], nudgeSelection);
    graph.bindKey("0", (event) => {
      event.preventDefault();
      fitDiagramContent(graph, document, containerRef.current);
    });
    graph.bindKey("1", (event) => {
      event.preventDefault();
      graph.zoomTo(1);
    });
    graph.bindKey("esc", (event) => {
      if (!flowQuickCreateRef.current) return;
      event.preventDefault();
      dismissFlowQuickCreate();
    });
    graph.bindKey(["meta+z", "ctrl+z"], (event) => {
      event.preventDefault();
      graph.undo();
      applyGraphPalette(graph, themeRef.current, document.kind, appearanceRef.current);
      graph.cleanSelection();
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      ));
    });
    graph.bindKey(["meta+shift+z", "ctrl+shift+z", "ctrl+y"], (event) => {
      event.preventDefault();
      graph.redo();
      applyGraphPalette(graph, themeRef.current, document.kind, appearanceRef.current);
      graph.cleanSelection();
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      ));
    });
    graphRef.current = graph;
    return () => {
      containerRef.current?.removeEventListener("pointerdown", handleFlowPointerDown, true);
      window.removeEventListener("pointerup", handleFlowPointerUp, true);
      flowPointerDragRef.current = null;
      openFlowQuickCreateRef.current = () => undefined;
      nodeEditorRef.current = null;
      graphRef.current = null;
      graph.dispose();
    };
  }, [beginNodeEdit, dismissFlowQuickCreate, memo.contentHash, memo.id, readOnly]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (readOnly) return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [readOnly]);

  const addNode = useCallback((
    shape: DiagramNodeShape = "process",
    options: { relation?: MindMapInsertRelation; baseNodeId?: string; beginEditing?: boolean } = {},
  ) => {
    const graph = graphRef.current;
    if (!graph || !document || readOnly) return;
    const baseNodeId = options.baseNodeId ?? selectedNodeId;
    const selected = baseNodeId
      ? graph.getCellById(baseNodeId) as Node | undefined
      : document.kind === "mind-map"
        ? graph.getNodes()[0]
        : undefined;
    const selectedPosition = selected?.isNode() ? selected.getPosition() : { x: 120, y: 120 };
    const selectedSize = selected?.isNode() ? selected.getSize() : { width: 140, height: 52 };
    const isMindMap = document.kind === "mind-map";
    const isArchitecture = document.kind === "architecture";
    const selectedData = selected?.isNode() ? selected.getData<NodeData>() : undefined;
    const requestedSibling = isMindMap && options.relation === "sibling" && Boolean(selectedData?.parentId);
    const parent = requestedSibling
      ? graph.getCellById(selectedData?.parentId ?? "") as Node | undefined
      : selected;
    const siblings = requestedSibling
      ? graph.getNodes().filter((node) => node.getData<NodeData>()?.parentId === selectedData?.parentId)
      : [];
    const childNodes = isMindMap && selected?.isNode()
      ? graph.getNodes().filter((node) => node.getData<NodeData>()?.parentId === selected.id)
      : [];
    const nextPosition = requestedSibling
      ? {
          x: selectedPosition.x,
          y: Math.max(selectedPosition.y, ...siblings.map((node) => node.getPosition().y)) + 52,
        }
      : {
          x: selectedPosition.x + selectedSize.width + (isMindMap ? 72 : 110),
          y: childNodes.length > 0
            ? Math.max(...childNodes.map((node) => node.getPosition().y)) + 52
            : selectedPosition.y,
        };
    const id = createId(isMindMap ? "topic" : "node");
    const architectureParentId = isArchitecture && shape !== "boundary"
      ? selectedData?.shape === "boundary" ? selected?.id : selectedData?.parentId
      : undefined;
    const authoredSize = isArchitecture
      ? compactArchitectureNodeSize(shape)
      : { width: shape === "decision" ? 132 : 140, height: shape === "decision" ? 84 : 52 };
    graph.startBatch("add");
    const node = graph.addNode(nodeMetadata({
      id,
      label: isMindMap ? t("diagram.newTopic") : isArchitecture ? architectureNodeLabel(shape, t) : t("diagram.newStep"),
      x: nextPosition.x,
      y: nextPosition.y,
      width: authoredSize.width,
      height: authoredSize.height,
      shape: isMindMap ? "topic" : shape,
      ...(isMindMap && parent?.isNode() ? { parentId: parent.id } : {}),
      ...(architectureParentId ? { parentId: architectureParentId } : {}),
    }, themeRef.current, document.kind, appearanceRef.current));
    if (architectureParentId) {
      const architectureParent = graph.getCellById(architectureParentId);
      if (architectureParent?.isNode()) architectureParent.addChild(node);
    }
    if (isMindMap && parent?.isNode()) {
      graph.addEdge(edgeMetadata(
        { id: createId("branch"), source: parent.id, target: id },
        document.kind,
        themeRef.current,
        appearanceRef.current,
      ));
    }
    if (isMindMap) {
      const positions = computeDiagramLayout(
        graphToDocument(graph, document.kind, themeRef.current),
        requestedSibling && selected?.isNode()
          ? { insertedNodeId: id, insertAfterNodeId: selected.id }
          : {},
      );
      for (const graphNode of graph.getNodes()) {
        const position = positions[graphNode.id];
        if (position) graphNode.position(position.x, position.y);
      }
    }
    graph.stopBatch("add");
    graph.cleanSelection();
    graph.select(node);
    setSelectedNodeId(id);
    setSelectedNodeLabel(node.getData<NodeData>().label);
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(true);
    setDirty(true);
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    if (options.beginEditing) {
      requestAnimationFrame(() => beginNodeEdit(node));
    }
  }, [beginNodeEdit, document, readOnly, selectedNodeId, t]);

  insertNodeRef.current = (relation, baseNodeId) => {
    addNode("topic", { relation, baseNodeId, beginEditing: true });
  };

  const updateSelectedLabel = (label: string) => {
    setSelectedNodeLabel(label);
    const node = selectedNodeId ? graphRef.current?.getCellById(selectedNodeId) : null;
    if (!node?.isNode() || readOnly) return;
    node.setData({ ...node.getData<NodeData>(), label });
    node.attr("label/text", label);
  };

  const updateSelectedEdgeLabel = (label: string) => {
    setSelectedEdgeLabel(label);
    const edge = selectedEdgeId ? graphRef.current?.getCellById(selectedEdgeId) : null;
    if (!edge?.isEdge() || readOnly) return;
    if (!label) {
      edge.setLabels([]);
      return;
    }
    const palette = resolveDiagramPalette(themeRef.current, appearanceRef.current);
    edge.setLabels([{ attrs: {
      label: { text: label, fill: palette.nodeText, fontSize: 12 },
      body: { fill: palette.canvas, stroke: palette.nodeStroke, strokeWidth: 1, rx: 5, ry: 5 },
    } }]);
  };

  const createConnectedFlowNode = (shape: DiagramNodeShape) => {
    const graph = graphRef.current;
    const pending = flowQuickCreate;
    if (!graph || !document || document.kind !== "flowchart" || !pending || readOnly) return;
    if (!graph.getCellById(pending.sourceNodeId)?.isNode()) {
      dismissFlowQuickCreate();
      return;
    }
    const size = compactFlowchartNodeSize(shape);
    const id = createId("node");
    const label = shape === "decision"
      ? t("diagram.newDecision")
      : shape === "terminator"
        ? t("diagram.newTerminator")
        : t("diagram.newStep");
    const draftEdge = graph.getCellById(pending.draftEdgeId);
    if (draftEdge?.isEdge()) removeFlowDraftEdge(graph, draftEdge, pending.restoreHistory);
    if (pending.restoreHistory) graph.enableHistory();
    flowQuickCreateRef.current = null;
    setFlowQuickCreate(null);
    graph.startBatch("quick-create");
    const node = graph.addNode(nodeMetadata({
      id,
      label,
      x: Math.round(Math.max(0, pending.x - size.width / 2)),
      y: Math.round(Math.max(0, pending.y - size.height / 2)),
      width: size.width,
      height: size.height,
      shape,
    }, themeRef.current, document.kind, appearanceRef.current));
    graph.addEdge({
      ...edgeMetadata(
        { id: createId("edge"), source: pending.sourceNodeId, target: id },
        document.kind,
        themeRef.current,
        appearanceRef.current,
      ),
      source: { cell: pending.sourceNodeId, ...(pending.sourcePort ? { port: pending.sourcePort } : {}) },
      target: { cell: id, ...(oppositeFlowPort(pending.sourcePort) ? { port: oppositeFlowPort(pending.sourcePort) } : {}) },
    });
    graph.stopBatch("quick-create");
    graph.cleanSelection();
    graph.select(node);
    setSelectedNodeId(id);
    setSelectedNodeLabel(label);
    setHasSelection(true);
    setDirty(true);
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    requestAnimationFrame(() => beginNodeEdit(node));
  };

  const removeSelected = () => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;
    if (!removeGraphSelection(graph)) return;
    setSelectedNodeId(null);
    setSelectedNodeLabel("");
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(false);
    if (document) {
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      ));
    }
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
  };

  const runHistoryAction = (action: "undo" | "redo") => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;
    if (action === "undo") graph.undo();
    else graph.redo();
    applyGraphPalette(
      graph,
      themeRef.current,
      document?.kind ?? "flowchart",
      appearanceRef.current,
    );
    graph.cleanSelection();
    setSelectedNodeId(null);
    setSelectedNodeLabel("");
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(false);
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    if (document) {
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      ));
    }
  };

  const applyAutoLayout = () => {
    const graph = graphRef.current;
    if (!graph || !document || readOnly || graph.getNodes().length === 0) return;
    const positions = computeDiagramLayout(graphToDocument(graph, document.kind, themeRef.current));
    graph.startBatch("layout");
    let changed = false;
    for (const node of graph.getNodes()) {
      const position = positions[node.id];
      if (!position) continue;
      const currentPosition = node.getPosition();
      if (currentPosition.x !== position.x || currentPosition.y !== position.y) {
        changed = true;
        node.position(position.x, position.y);
      }
    }
    if (document.kind === "architecture") fitArchitectureBoundaries(graph);
    graph.stopBatch("layout");
    fitDiagramContent(graph, document, containerRef.current, 40);
    if (changed) {
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      ));
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    }
  };

  const applyTheme = (nextTheme: DiagramTheme) => {
    const graph = graphRef.current;
    if (nextTheme === theme) return;
    themeRef.current = nextTheme;
    setTheme(nextTheme);
    if (!graph || readOnly) return;
    applyGraphPalette(
      graph,
      nextTheme,
      document?.kind ?? "flowchart",
      appearanceRef.current,
    );
    setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
      titleRef.current,
      graphToDocument(graph, document?.kind ?? "flowchart", nextTheme),
    ));
  };

  const exportDiagram = (format: "png" | "svg") => {
    const graph = graphRef.current;
    if (!graph || !document) return;
    const fallbackName = document.kind === "mind-map" ? t("diagram.mindMap") : document.kind === "architecture" ? t("diagram.architecture") : t("diagram.flowchart");
    const fileName = (title.trim() || fallbackName).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    setSaveError(null);
    try {
      const palette = resolveDiagramPalette(themeRef.current, appearanceRef.current);
      const beforeSerialize = prepareExportSvg(palette.canvas);
      if (format === "png") {
        graph.exportPNG(fileName, { backgroundColor: palette.canvas, padding: 32, ratio: 2, copyStyles: false, beforeSerialize });
      } else {
        graph.exportSVG(fileName, { preserveDimensions: true, copyStyles: false, beforeSerialize });
      }
    } catch {
      setSaveError(t("diagram.exportError"));
    }
  };

  const save = async () => {
    const graph = graphRef.current;
    const currentMemo = memoRef.current;
    const editSession = editSessionRef.current;
    if (!graph || !document || !editSession || readOnly || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveFailed(false);
    try {
      const nextDocument = graphToDocument(graph, document.kind, themeRef.current);
      const markdown = serializeDiagramDocument(nextDocument);
      const nextTitle = titleRef.current;
      const nextSnapshot = diagramEditorSnapshot(nextTitle, nextDocument);
      const result = await repository.updateMemo(currentMemo, {
        expectedRevision: currentMemo.revision,
        expectedContentHash: currentMemo.contentHash,
        editSessionId: editSession.id,
        title: nextTitle,
        contentJson: markdownToDoc(diagramFallbackMarkdown(nextDocument)),
        contentMarkdown: markdown,
        tags: currentMemo.tags,
      });
      memoRef.current = result.memo;
      savedSnapshotRef.current = nextSnapshot;
      const currentSnapshot = diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current),
      );
      const hasNewChanges = currentSnapshot !== nextSnapshot;
      setDirty(hasNewChanges);
      if (!hasNewChanges) {
        graph.cleanHistory();
        setHistoryState({ undo: false, redo: false });
        await onSaved(result.memo);
      }
    } catch (error) {
      setSaveFailed(true);
      setSaveError(error instanceof Error ? error.message : t("diagram.saveError"));
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => { void save(); };

  useEffect(() => {
    if (readOnly || !dirty || nodeEditor !== null || saving || !editSessionReady || saveFailed) return;
    const timer = window.setTimeout(() => saveRef.current(), EDITOR_LOCAL_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, dirtyVersion, editSessionReady, nodeEditor, readOnly, saveFailed, saving]);

  const handleCopyMemoId = async () => {
    if (isLocalMemoId(memo.id)) return;
    const copied = await copyTextToClipboard(memo.id);
    setMemoIdCopyNotice(copied ? "copied" : "error");
    if (memoIdCopyTimerRef.current !== null) window.clearTimeout(memoIdCopyTimerRef.current);
    memoIdCopyTimerRef.current = window.setTimeout(() => {
      setMemoIdCopyNotice(null);
      memoIdCopyTimerRef.current = null;
    }, copied ? 2200 : 3000);
  };

  const handleSaveAsTemplate = () => {
    if (!document || readOnly) return;
    const name = window.prompt(t("templates.templateNamePrompt"), titleRef.current);
    if (!name?.trim()) return;
    const currentDocument = graphRef.current
      ? graphToDocument(graphRef.current, document.kind, themeRef.current)
      : document;
    const markdown = serializeDiagramDocument(currentDocument);
    void onSaveAsTemplate({
      ...memoRef.current,
      title: titleRef.current,
      contentJson: markdownToDoc(diagramFallbackMarkdown(currentDocument)),
      contentMarkdown: markdown,
    }, name.trim());
  };

  if (!document) return null;
  const kindLabel = document.kind === "mind-map" ? t("diagram.mindMap") : document.kind === "architecture" ? t("diagram.architecture") : t("diagram.flowchart");
  const updatedLabel = formatDateTime(memo.updatedAt);
  const currentMarkdown = historyOpen
    ? serializeDiagramDocument(graphRef.current ? graphToDocument(graphRef.current, document.kind, themeRef.current) : document)
    : memo.contentMarkdown;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button className="lg:hidden" size="icon" variant="ghost" aria-label={t("diagram.back")} onClick={() => dirty ? setConfirmDiscardOpen(true) : onBackToList()}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("diagram.back")}</TooltipContent>
            </Tooltip>
            <div className="hidden items-center gap-1 sm:flex lg:hidden">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={t("editor.previousMemo")} onClick={onOpenPreviousMemo} disabled={!hasPreviousMemo}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.previousMemo")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={t("editor.nextMemo")} onClick={onOpenNextMemo} disabled={!hasNextMemo}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.nextMemo")}</TooltipContent>
              </Tooltip>
            </div>
            <div className="hidden items-center gap-1 lg:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant={desktopFocusMode ? "soft" : "ghost"} aria-label={t(desktopFocusMode ? "editor.exitFocusMode" : "editor.enterFocusMode")} aria-pressed={desktopFocusMode} onClick={onToggleDesktopFocusMode}>
                    {desktopFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t(desktopFocusMode ? "editor.exitFocusMode" : "editor.focusMode")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={t("editor.previousMemo")} onClick={onOpenPreviousMemo} disabled={!hasPreviousMemo}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.previousMemo")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={t("editor.nextMemo")} onClick={onOpenNextMemo} disabled={!hasNextMemo}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.nextMemo")}</TooltipContent>
              </Tooltip>
            </div>
            <span className="hidden truncate text-xs text-slate-400 sm:inline">{updatedLabel}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <span className={cn(
              "inline-flex max-w-[5.5rem] truncate rounded-full px-2 py-1 text-[11px] font-medium sm:hidden",
              saveError ? "bg-rose-50 text-rose-700" : dirty || saving ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700",
            )} role="status" aria-live="polite">
              {saveError ?? (dirty || saving ? t("diagram.saving") : t("diagram.saved"))}
            </span>
            <span className={cn(
              "hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium sm:inline-flex",
              saveError ? "bg-rose-50 text-rose-700" : dirty || saving ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700",
            )} role="status" aria-live="polite">
              {saveError ? <CircleAlert className="h-3 w-3" /> : dirty || saving ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {saveError ?? (dirty || saving ? t("diagram.saving") : t("diagram.saved"))}
            </span>
            {!readOnly && saveFailed && (
              <Button variant="soft" size="sm" disabled={saving || !editSessionReady} onClick={() => void save()}>
                <RefreshCw className="h-4 w-4" />
                {t("diagram.retrySave")}
              </Button>
            )}
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={t("editor.moreAria")}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 border border-slate-200 bg-white py-1 shadow-md">
                <DropdownMenuItem disabled={isLocalMemoId(memo.id)} onClick={() => void handleCopyMemoId()}>
                  <Copy className="h-4 w-4 text-slate-500" />
                  {t(isLocalMemoId(memo.id) ? "editor.copyNoteIdAfterSync" : "editor.copyNoteId")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                  <HistoryIcon className="h-4 w-4 text-slate-500" />
                  {t("editor.versionHistory")}
                </DropdownMenuItem>
                {!readOnly && (
                  <DropdownMenuItem disabled={isLocalMemoId(memo.id)} onClick={() => setShareOpen(true)}>
                    <Link2 className="h-4 w-4 text-slate-500" />
                    {t(isLocalMemoId(memo.id) ? "sharing.afterSync" : "sharing.action")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportDiagram("png")}>
                  <FileImage className="h-4 w-4 text-slate-500" />
                  {t("diagram.exportPng")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportDiagram("svg")}>
                  <FileCode2 className="h-4 w-4 text-slate-500" />
                  {t("diagram.exportSvg")}
                </DropdownMenuItem>
                {!readOnly && (
                  <DropdownMenuItem onClick={handleSaveAsTemplate}>
                    <Pencil className="h-4 w-4 text-slate-500" />
                    {t("templates.saveAsTemplate")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {readOnly ? (
                  <>
                    <DropdownMenuItem onClick={() => void onRestored(memo.id)}>
                      <RotateCcw className="h-4 w-4 text-slate-500" />
                      {t("editor.restoreMemo")}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onClick={() => void onPermanentDeleted(memo.id)}>
                      <Trash2 className="h-4 w-4" />
                      {t("editor.deleteForever")}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onClick={() => void onDeleted(memo.id)}>
                    <Trash2 className="h-4 w-4" />
                    {t("editor.deleteMemo")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex min-h-14 items-center gap-3 px-4 py-2.5 sm:px-7">
          <input
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-slate-950 outline-none placeholder:text-slate-400 disabled:text-slate-600 sm:text-2xl"
            value={title}
            disabled={readOnly}
            maxLength={160}
            placeholder={kindLabel}
            aria-label={t("diagram.title")}
            onChange={(event) => {
              const nextTitle = event.target.value;
              titleRef.current = nextTitle;
              setTitle(nextTitle);
              setDirtyVersion((current) => current + 1);
              const graph = graphRef.current;
              if (graph) {
                setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
                  nextTitle,
                  graphToDocument(graph, document.kind, themeRef.current),
                ));
              }
            }}
          />
          <div className="shrink-0 rounded-full border border-[var(--brand-green-border)] bg-[var(--brand-green-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-green-text)]">{kindLabel}</div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-2">
          {!readOnly && (
            document.kind === "mind-map" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="soft" onClick={() => addNode("topic")}><GitBranch className="h-4 w-4" />{t("diagram.addTopic")}</Button>
                </TooltipTrigger>
                <TooltipContent>{t("diagram.mindMapShortcuts")}</TooltipContent>
              </Tooltip>
            ) : document.kind === "architecture" ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="soft" onClick={() => addNode("service")}><Server className="h-4 w-4" />{t("diagram.addService")}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("diagram.architectureShortcuts")}</TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline"><Boxes className="h-4 w-4" />{t("diagram.components")}</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => addNode("client")}><Network className="h-4 w-4" />{t("diagram.addClient")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => addNode("frontend")}><Globe2 className="h-4 w-4" />{t("diagram.addFrontend")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => addNode("database")}><Database className="h-4 w-4" />{t("diagram.addDatabase")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => addNode("storage")}><HardDrive className="h-4 w-4" />{t("diagram.addStorage")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => addNode("queue")}><GitBranch className="h-4 w-4" />{t("diagram.addQueue")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => addNode("security")}><ShieldCheck className="h-4 w-4" />{t("diagram.addSecurity")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => addNode("external")}><Globe2 className="h-4 w-4" />{t("diagram.addExternal")}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => addNode("boundary")}><Box className="h-4 w-4" />{t("diagram.addBoundary")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="hidden items-center gap-1.5 px-2 text-xs text-slate-500 xl:flex"><Link2 className="h-3.5 w-3.5" />{t("diagram.architectureConnectHint")}</span>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="soft" onClick={() => addNode("process")}><Box className="h-4 w-4" />{t("diagram.addStep")}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("diagram.flowchartShortcuts")}</TooltipContent>
                </Tooltip>
                <Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" aria-label={t("diagram.addDecision")} onClick={() => addNode("decision")}><Diamond className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.addDecision")}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" aria-label={t("diagram.addTerminator")} onClick={() => addNode("terminator")}><Circle className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.addTerminator")}</TooltipContent></Tooltip>
                <span className="hidden items-center gap-1.5 px-2 text-xs text-slate-500 xl:flex"><Link2 className="h-3.5 w-3.5" />{t("diagram.connectHint")}</span>
              </>
            )
          )}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={t("diagram.undo")} disabled={!historyState.undo || readOnly} onClick={() => runHistoryAction("undo")}><Undo2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.undo")}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={t("diagram.redo")} disabled={!historyState.redo || readOnly} onClick={() => runHistoryAction("redo")}><Redo2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.redo")}</TooltipContent></Tooltip>
          {!readOnly && <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={t("diagram.deleteSelection")} disabled={!hasSelection} onClick={removeSelected}><Trash2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.deleteSelection")}</TooltipContent></Tooltip>}
          {!readOnly && <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={t("diagram.autoLayout")} onClick={applyAutoLayout}><LayoutDashboard className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.autoLayout")}</TooltipContent></Tooltip>}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={t("diagram.zoomOut")} onClick={() => graphRef.current?.zoom(-0.1)}><ZoomOut className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.zoomOut")}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={t("diagram.zoomIn")} onClick={() => graphRef.current?.zoom(0.1)}><ZoomIn className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.zoomIn")}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={t("diagram.fit")} onClick={() => { const graph = graphRef.current; if (graph) fitDiagramContent(graph, document, containerRef.current); }}><Maximize2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("diagram.fit")}</TooltipContent></Tooltip>
          <Select value={theme} disabled={readOnly} onValueChange={(value) => applyTheme(value as DiagramTheme)}>
            <SelectTrigger className="h-8 w-[8.5rem] gap-2" aria-label={t("diagram.theme")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="brand" textValue={t("diagram.themeBrand")}><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-black/10" style={{ background: resolveDiagramPalette("brand", resolvedTheme).topicFill }} />{t("diagram.themeBrand")}</span></SelectItem>
              <SelectItem value="ocean" textValue={t("diagram.themeOcean")}><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-black/10" style={{ background: resolveDiagramPalette("ocean", resolvedTheme).topicFill }} />{t("diagram.themeOcean")}</span></SelectItem>
              <SelectItem value="ink" textValue={t("diagram.themeInk")}><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-black/10" style={{ background: resolveDiagramPalette("ink", resolvedTheme).nodeFill }} />{t("diagram.themeInk")}</span></SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline"><Download className="h-4 w-4" />{t("diagram.export")}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => exportDiagram("png")}><FileImage className="h-4 w-4" />{t("diagram.exportPng")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportDiagram("svg")}><FileCode2 className="h-4 w-4" />{t("diagram.exportSvg")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedNodeId && !readOnly && (
            <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-sm">
              <span className="shrink-0 text-xs font-medium text-slate-500">{t("diagram.nodeText")}</span>
              <Input value={selectedNodeLabel} maxLength={120} onChange={(event) => updateSelectedLabel(event.target.value)} />
            </div>
          )}
          {selectedEdgeId && !readOnly && (
            <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-sm">
              <span className="shrink-0 text-xs font-medium text-slate-500">{t("diagram.edgeText")}</span>
              <Input value={selectedEdgeLabel} maxLength={80} onChange={(event) => updateSelectedEdgeLabel(event.target.value)} />
            </div>
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={containerRef} className="edgeever-diagram-canvas absolute inset-0 touch-none outline-none" data-diagram-appearance={resolvedTheme} data-diagram-kind={document.kind} data-diagram-theme={theme} tabIndex={0} aria-label={t("diagram.canvas", { type: kindLabel })} />
          {flowQuickCreate ? (
            <div
              className="absolute z-30 w-[330px] max-w-[calc(100%-24px)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
              style={{ left: flowQuickCreate.left, top: flowQuickCreate.top }}
              role="dialog"
              aria-label={t("diagram.quickCreateTitle")}
              onKeyDown={(event) => {
                const shape = ({ "1": "process", "2": "decision", "3": "terminator" } as const)[event.key as "1" | "2" | "3"];
                if (shape) {
                  event.preventDefault();
                  createConnectedFlowNode(shape);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  dismissFlowQuickCreate();
                  containerRef.current?.focus({ preventScroll: true });
                }
              }}
            >
              <div className="whitespace-nowrap px-1.5 pb-1.5 text-xs font-medium text-slate-500">{t("diagram.quickCreateTitle")}</div>
              <div className="grid grid-cols-3 gap-1">
                <Button autoFocus className="relative h-16 min-w-0 flex-col gap-1 whitespace-nowrap px-2 text-xs" variant="ghost" aria-label={t("diagram.addStep")} onClick={() => createConnectedFlowNode("process")}>
                  <kbd className="absolute right-1.5 top-1 text-[10px] font-normal text-slate-400">1</kbd>
                  <Box className="h-6 w-6" />
                  {t("diagram.addStep")}
                </Button>
                <Button className="relative h-16 min-w-0 flex-col gap-1 whitespace-nowrap px-2 text-xs" variant="ghost" aria-label={t("diagram.addDecision")} onClick={() => createConnectedFlowNode("decision")}>
                  <kbd className="absolute right-1.5 top-1 text-[10px] font-normal text-slate-400">2</kbd>
                  <Diamond className="h-6 w-6" />
                  {t("diagram.addDecision")}
                </Button>
                <Button className="relative h-16 min-w-0 flex-col gap-1 whitespace-nowrap px-2 text-xs" variant="ghost" aria-label={t("diagram.addTerminator")} onClick={() => createConnectedFlowNode("terminator")}>
                  <kbd className="absolute right-1.5 top-1 text-[10px] font-normal text-slate-400">3</kbd>
                  <Circle className="h-6 w-6" />
                  {t("diagram.addTerminator")}
                </Button>
              </div>
              <div className="whitespace-nowrap px-1.5 pt-1 text-[11px] text-slate-400">{t("diagram.quickCreateShortcuts")}</div>
            </div>
          ) : null}
          {nodeEditor ? (
            <input
              autoFocus
              className="absolute z-20 px-3 text-center font-medium outline-none"
              style={{
                left: nodeEditor.left,
                top: nodeEditor.top,
                width: nodeEditor.width,
                height: nodeEditor.height,
                fontSize: nodeEditor.fontSize,
                color: nodeEditor.color,
                background: nodeEditor.background,
                border: `2px solid ${nodeEditor.borderColor}`,
                borderRadius: nodeEditor.shape === "terminator" ? 999 : 11,
                clipPath: nodeEditor.shape === "decision" ? "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" : undefined,
              }}
              value={nodeEditor.value}
              maxLength={120}
              aria-label={t("diagram.editNode")}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const nextEditor = { ...nodeEditor, value: event.target.value };
                nodeEditorRef.current = nextEditor;
                setNodeEditor(nextEditor);
              }}
              onBlur={() => { finishNodeEdit(); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  finishNodeEdit(true);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const editedNode = finishNodeEdit();
                  if (document.kind === "mind-map" && editedNode) {
                    requestAnimationFrame(() => insertNodeRef.current("sibling", editedNode.id));
                  }
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  const editedNode = finishNodeEdit();
                  if (editedNode) {
                    requestAnimationFrame(() => {
                      if (document.kind === "mind-map") insertNodeRef.current("child", editedNode.id);
                      else if (document.kind === "flowchart") openFlowQuickCreateRef.current(editedNode);
                    });
                  }
                }
              }}
            />
          ) : null}
        </div>
      </div>
        {confirmDiscardOpen ? (
          <AppConfirmDialog
            title={t("diagram.discardTitle")}
            description={t("diagram.discardDescription")}
            confirmLabel={t("diagram.discard")}
            tone="danger"
            onCancel={() => setConfirmDiscardOpen(false)}
            onConfirm={onBackToList}
          />
        ) : null}
        {historyOpen ? (
          <RevisionHistoryDialog
            memo={memo}
            repository={repository}
            currentMarkdown={currentMarkdown}
            onClose={() => setHistoryOpen(false)}
            onRestored={async (restoredMemo) => {
              setHistoryOpen(false);
              await onSaved(restoredMemo);
            }}
          />
        ) : null}
        <ShareMemoDialog memoId={memo.id} open={shareOpen} onOpenChange={setShareOpen} />
        {memoIdCopyNotice ? (
          <ClipboardCopyNotice status={memoIdCopyNotice}>
            {t(memoIdCopyNotice === "copied" ? "editor.noteIdCopied" : "editor.noteIdCopyFailed", { id: memo.id })}
          </ClipboardCopyNotice>
        ) : null}
      </div>
    </TooltipProvider>
  );
};

export default DiagramEditorPane;
