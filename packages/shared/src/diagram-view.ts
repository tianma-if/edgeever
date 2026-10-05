import { flowchartNodePresentation } from "./diagram-node-presentation";
import {
  ARCHITECTURE_EDGE_LABEL_FONT_SIZE,
  ARCHITECTURE_EDGE_LABEL_LINE_HEIGHT,
  ARCHITECTURE_LABEL_FONT,
  architectureEdgePorts,
  architectureEdgeTerminals,
  architectureEdgeRouter,
  architectureTerminalAnchor,
  architectureEdgeVisual,
  architectureNodeVisual,
  resolveArchitectureSurface,
} from "./diagram-architecture-style";
import {
  FLOWCHART_EDGE_LABEL_FONT_SIZE,
  FLOWCHART_EDGE_LABEL_LINE_HEIGHT,
  FLOWCHART_EDGE_ROUTER,
  FLOWCHART_LABEL_FONT,
  flowchartEdgeIsStraight,
  flowchartEdgePorts,
  flowchartNodeVisual,
  resolveFlowchartSurface,
} from "./diagram-flowchart-style";
import type { DiagramDocument, DiagramTheme } from "./diagram";
import { buildDiagramPalette } from "./diagram-palette";
import {
  MIND_MAP_CONNECTOR_NAME,
  MIND_MAP_EDGE_LABEL_FONT_SIZE,
  MIND_MAP_EDGE_LABEL_LINE_HEIGHT,
  mindMapBranchSides,
  mindMapEdgeLineAttrs,
  mindMapEdgeTerminal,
  mindMapEdgeVisual,
  mindMapNodePresentation,
  mindMapNodeRole,
  mindMapSiblingSpan,
  mindMapTopicMarkup,
  resolveMindMapNodeStyle,
} from "./diagram-mindmap-style";

export type DiagramAppearance = "light" | "dark";

export type DiagramPalette = {
  topicFill: string;
  topicText: string;
  nodeFill: string;
  nodeText: string;
  nodeStroke: string;
  topicStroke: string;
  mindMapEdge: string;
  flowEdge: string;
  canvas: string;
};

export const resolvePortableDiagramPalette = (
  theme?: DiagramTheme,
  appearance: DiagramAppearance = "light",
) => buildDiagramPalette(theme, appearance);

/** Plain X6 metadata shared by native WebView viewers. */
export const diagramDocumentToX6Cells = (
  document: DiagramDocument,
  appearance: DiagramAppearance,
) => {
  const palette = resolvePortableDiagramPalette(
    document.kind === "architecture" ? (document.theme ?? "brand") : document.theme,
    appearance,
  );
  const flowchartSurface = document.kind === "flowchart" ? resolveFlowchartSurface(appearance, document.theme) : null;
  const architectureSurface = document.kind === "architecture" ? resolveArchitectureSurface(appearance) : null;
  const nodes = document.nodes.map((node) => {
    const mindMapRole = document.kind === "mind-map" ? mindMapNodeRole(document.nodes, node.id) : null;
    const presentation = document.kind === "flowchart"
      ? flowchartNodePresentation(node.shape, node.label)
      : mindMapRole
        ? mindMapNodePresentation(node.label, mindMapRole, document.structure)
        : { width: node.width, height: node.height, text: node.label };
    const mindStyle = mindMapRole
      ? resolveMindMapNodeStyle(document.nodes, node.id, palette, document.theme, appearance, presentation, document.structure)
      : null;
    const mindVisual = mindStyle?.visual ?? null;
    const flowchartVisual = document.kind === "flowchart"
      ? flowchartNodeVisual(node.shape, appearance, presentation, document.theme)
      : null;
    const architectureVisual = document.kind === "architecture"
      ? architectureNodeVisual(node.shape, appearance, presentation, node.resourceIcon)
      : null;
    const isRootTopic = node.shape === "topic" && !node.parentId;
    const isTerminator = node.shape === "terminator";
    const isBoundary = node.shape === "boundary";
    const emphasized = isRootTopic || isTerminator;
    const fill = mindVisual
      ? mindVisual.body.fill
      : flowchartVisual
        ? flowchartVisual.body.fill
      : architectureVisual
        ? architectureVisual.body.fill
      : emphasized ? palette.topicFill : palette.nodeFill;
    const stroke = mindVisual
      ? mindVisual.body.stroke
      : flowchartVisual
        ? flowchartVisual.body.stroke
      : architectureVisual
        ? architectureVisual.body.stroke
      : emphasized ? palette.topicStroke : palette.nodeStroke;
    return {
      id: node.id,
      shape: node.shape === "decision" ? "polygon" : "rect",
      x: node.x,
      y: node.y,
      width: presentation.width,
      height: presentation.height,
      zIndex: isBoundary ? 0 : 2,
      ...(architectureVisual ? { markup: architectureVisual.markup } : mindMapRole ? { markup: mindMapTopicMarkup(document.structure, mindMapRole) } : {}),
      attrs: {
        body: {
          fill,
          stroke,
          strokeWidth: mindVisual?.body.strokeWidth ?? flowchartVisual?.body.strokeWidth ?? architectureVisual?.body.strokeWidth ?? 1,
          strokeDasharray: architectureVisual?.body.strokeDasharray ?? (isBoundary ? "7 5" : undefined),
          ...(mindVisual?.body ?? flowchartVisual?.body ?? architectureVisual?.body ?? {
            rx: isTerminator ? 24 : 11,
            ry: isTerminator ? 24 : 11,
          }),
          ...(node.shape === "decision" ? { refPoints: "0,10 10,0 20,10 10,20" } : {}),
        },
        label: {
          text: presentation.text,
          lineHeight: mindVisual?.label.lineHeight ?? flowchartVisual?.label.lineHeight ?? architectureVisual?.label.lineHeight ?? (mindMapRole === "root" ? 20 : 18),
          fill: mindVisual?.label.fill ?? flowchartVisual?.label.fill ?? architectureVisual?.label.fill ?? (emphasized ? palette.topicText : palette.nodeText),
          fontSize: mindVisual?.label.fontSize ?? flowchartVisual?.label.fontSize ?? architectureVisual?.label.fontSize ?? (node.shape === "topic" ? 14 : 13),
          fontWeight: mindVisual?.label.fontWeight ?? flowchartVisual?.label.fontWeight ?? architectureVisual?.label.fontWeight ?? (emphasized ? 650 : 500),
          fontFamily: mindVisual?.label.fontFamily ?? flowchartVisual?.label.fontFamily ?? architectureVisual?.label.fontFamily ?? FLOWCHART_LABEL_FONT,
          ...(mindVisual ? {
            refX: mindVisual.label.refX,
            refY: mindVisual.label.refY,
            textAnchor: mindVisual.label.textAnchor,
            textVerticalAnchor: mindVisual.label.textVerticalAnchor,
          } : {}),
          ...(architectureVisual ? {
            refX: architectureVisual.label.refX,
            refY: architectureVisual.label.refY,
            textAnchor: architectureVisual.label.textAnchor,
            textVerticalAnchor: architectureVisual.label.textVerticalAnchor,
          } : {}),
        },
        ...(mindVisual ? { underline: mindVisual.underline } : {}),
        ...(architectureVisual?.attrs ?? {}),
      },
    };
  });
  const projectedById = new Map(nodes.map((node) => [node.id, node]));
  const architectureBoundaryIds = document.nodes.filter((node) => node.shape === "boundary").map((node) => node.id);
  const architectureTerminals = document.kind === "architecture"
    ? architectureEdgeTerminals(document.nodes.filter((node) => node.shape !== "boundary"), document.edges)
    : null;
  const edges = document.edges.map((edge) => {
    const edgeKind = edge.kind ?? (document.kind === "architecture" ? "dependency" : undefined);
    const sourceNode = projectedById.get(edge.source);
    const targetNode = projectedById.get(edge.target);
    const mindMapSourceRole = document.kind === "mind-map" ? mindMapNodeRole(document.nodes, edge.source) : null;
    const mindMapTargetRole = document.kind === "mind-map" ? mindMapNodeRole(document.nodes, edge.target) : null;
    const branchTint = document.kind === "mind-map"
      ? resolveMindMapNodeStyle(document.nodes, edge.target, palette, document.theme, appearance, { width: 96, height: 36 }, document.structure).tint
      : undefined;
    const mindEdge = mindMapSourceRole ? mindMapEdgeVisual(mindMapSourceRole, palette, branchTint) : null;
    const sides = sourceNode && targetNode
      ? mindMapBranchSides(sourceNode, targetNode, document.structure)
      : { source: "right" as const, target: "left" as const };
    const sourceTerminal = sourceNode && mindMapSourceRole
      ? mindMapEdgeTerminal(sourceNode, mindMapSourceRole, sides.source, document.structure)
      : null;
    const targetTerminal = targetNode && mindMapTargetRole
      ? mindMapEdgeTerminal(targetNode, mindMapTargetRole, sides.target, document.structure)
      : null;
    const braceSpan = document.kind === "mind-map" && document.structure === "brace"
      ? mindMapSiblingSpan(document.nodes, edge.source)
      : null;
    const architectureEdge = document.kind === "architecture"
      ? architectureEdgeVisual(edgeKind, appearance, edge.bidirectional)
      : null;
    const stroke = architectureEdge?.stroke
      ?? mindEdge?.stroke
      ?? flowchartSurface?.edge
      ?? palette.flowEdge;
    const orthogonalPorts = sourceNode && targetNode
      ? document.kind === "architecture"
        ? architectureEdgePorts(sourceNode, targetNode)
        : document.kind === "flowchart"
          ? flowchartEdgePorts(sourceNode, targetNode)
          : null
      : null;
    const orthogonalStraight = document.kind === "flowchart"
      && Boolean(orthogonalPorts && sourceNode && targetNode && flowchartEdgeIsStraight(sourceNode, targetNode));
    const architectureTerminal = architectureTerminals?.get(edge.id);
    return {
      id: edge.id,
      source: document.kind === "mind-map"
        ? { cell: edge.source, ...(sourceTerminal ?? { anchor: { name: sides.source } }) }
        : architectureTerminal
          ? { cell: edge.source, anchor: architectureTerminalAnchor(architectureTerminal.source) }
        : orthogonalPorts
          ? { cell: edge.source, port: orthogonalPorts.source }
          : { cell: edge.source },
      target: document.kind === "mind-map"
        ? { cell: edge.target, ...(targetTerminal ?? { anchor: { name: sides.target } }) }
        : architectureTerminal
          ? { cell: edge.target, anchor: architectureTerminalAnchor(architectureTerminal.target) }
        : orthogonalPorts
          ? { cell: edge.target, port: orthogonalPorts.target }
          : { cell: edge.target },
      router: document.kind === "architecture"
        ? architectureEdgeRouter(edge.source, edge.target, architectureBoundaryIds, orthogonalPorts ?? undefined)
        : document.kind === "flowchart"
          ? (orthogonalStraight ? { name: "normal" } : FLOWCHART_EDGE_ROUTER)
          : undefined,
      connector: document.kind === "mind-map"
        ? {
          name: MIND_MAP_CONNECTOR_NAME,
          args: {
            sourceWidth: mindEdge?.sourceWidth,
            targetWidth: mindEdge?.targetWidth,
            structure: document.structure,
            ...(braceSpan ? { braceTop: braceSpan.top, braceBottom: braceSpan.bottom } : {}),
          },
        }
        : { name: "rounded", args: { radius: 10 } },
      attrs: { line: {
        stroke,
        strokeWidth: architectureEdge?.strokeWidth ?? (mindEdge ? mindMapEdgeLineAttrs(document.structure, stroke).strokeWidth : 1.5),
        strokeDasharray: architectureEdge?.strokeDasharray,
        sourceMarker: architectureEdge
          ? architectureEdge.sourceMarker
          : edge.bidirectional ? { name: "block", width: 7, height: 5 } : null,
        targetMarker: document.kind === "mind-map" ? null : architectureEdge?.targetMarker ?? { name: "block", width: 7, height: 5 },
        ...(mindEdge ? mindMapEdgeLineAttrs(document.structure, stroke) : { fill: "none" }),
      } },
      labels: edge.label ? [{ attrs: {
        label: {
          text: edge.label,
          fill: document.kind === "architecture"
            ? (appearance === "dark" ? "#E2E8F0" : "#334155")
            : document.kind === "flowchart"
              ? (appearance === "dark" ? "#E2E8F0" : "#475569")
              : (flowchartSurface?.process.text ?? architectureSurface?.nodes.service.text ?? palette.nodeText),
          fontSize: document.kind === "architecture"
            ? ARCHITECTURE_EDGE_LABEL_FONT_SIZE
            : document.kind === "flowchart"
              ? FLOWCHART_EDGE_LABEL_FONT_SIZE
              : MIND_MAP_EDGE_LABEL_FONT_SIZE,
          fontWeight: (document.kind === "architecture" || document.kind === "flowchart") ? 500 : 400,
          lineHeight: document.kind === "architecture"
            ? ARCHITECTURE_EDGE_LABEL_LINE_HEIGHT
            : document.kind === "flowchart"
              ? FLOWCHART_EDGE_LABEL_LINE_HEIGHT
              : MIND_MAP_EDGE_LABEL_LINE_HEIGHT,
          fontFamily: document.kind === "architecture" ? ARCHITECTURE_LABEL_FONT : FLOWCHART_LABEL_FONT,
          textWrap: { width: 140, height: 512 },
        },
        body: {
          ref: "label", refWidth: 1, refHeight: 1,
          refWidth2: (document.kind === "architecture" || document.kind === "flowchart") ? 14 : 12,
          refHeight2: 6,
          refX: (document.kind === "architecture" || document.kind === "flowchart") ? -7 : -6,
          refY: -3,
          fill: document.kind === "architecture"
            ? (appearance === "dark" ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.96)")
            : document.kind === "flowchart"
              ? (appearance === "dark" ? "rgba(24, 28, 34, 0.94)" : "rgba(255, 255, 255, 0.95)")
              : (flowchartSurface?.canvas ?? architectureSurface?.canvas ?? palette.canvas),
          stroke: document.kind === "architecture"
            ? (architectureEdge?.stroke ?? (appearance === "dark" ? "rgba(148, 163, 184, 0.3)" : "rgba(203, 213, 225, 0.8)"))
            : document.kind === "flowchart"
              ? (appearance === "dark" ? "rgba(148, 163, 184, 0.28)" : "rgba(100, 116, 139, 0.24)")
              : (flowchartSurface?.process.stroke ?? architectureSurface?.nodes.service.stroke ?? palette.nodeStroke),
          strokeWidth: 1,
          rx: 6,
          ry: 6,
          ...((document.kind === "architecture" || document.kind === "flowchart") ? { style: { filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.06))" } } : {}),
        },
      } }] : undefined,
    };
  });
  return { canvas: flowchartSurface?.canvas ?? architectureSurface?.canvas ?? palette.canvas, edges, nodes };
};
