import { compactFlowchartNodeSize, flowchartNodePresentation, visualTextUnits } from "./diagram-node-presentation";
export { compactFlowchartNodeSize, flowchartNodePresentation } from "./diagram-node-presentation";
import { DIAGRAM_READABLE_MIN_SCALE, FLOWCHART_LAYOUT_SPACING } from "./diagram-flowchart-style";
export {
  DIAGRAM_READABLE_MIN_SCALE,
  FLOWCHART_EDGE_ROUTER,
  FLOWCHART_LABEL_FONT,
  FLOWCHART_LAYOUT_SPACING,
  flowchartEdgeIsStraight,
  flowchartEdgePorts,
  flowchartFitsReadableViewport,
} from "./diagram-flowchart-style";
import {
  MIND_MAP_HORIZONTAL_GAP,
  MIND_MAP_VERTICAL_GAP,
  mindMapIsOneSided,
  mindMapLayoutFamily,
  mindMapNodePresentation,
  mindMapNodeRole,
} from "./diagram-mindmap-style";
export { compactMindMapNodeSize } from "./diagram-mindmap-style";
import { graphlib, layout as runDagreLayout } from "@dagrejs/dagre";
import {
  ARCHITECTURE_DIAGRAM_SCHEMA_VERSION,
  DIAGRAM_DEFAULT_THEME,
  DIAGRAM_SCHEMA_VERSION,
  type ArchitectureResourceIcon,
  type DiagramDocument,
  type DiagramEdgeKind,
  type DiagramKind,
  type DiagramNodeShape,
  type DiagramStructure,
  type DiagramTheme,
} from "./diagram";

export type DiagramLayoutPositions = Record<string, { x: number; y: number }>;

export type DiagramLayoutNodeGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DiagramLayoutViewport = {
  anchor: "root" | "leftmost" | "center";
  maxScale: number;
  minScale?: number;
};

export type DiagramLayoutResult = {
  nodes: Record<string, DiagramLayoutNodeGeometry>;
  nodeOrder: string[];
  viewport: DiagramLayoutViewport;
};

export type DiagramLayoutOptions = {
  insertedNodeId?: string;
  insertAfterNodeId?: string;
  direction?: "left-to-right" | "top-to-bottom";
};

export type DiagramIrNodeType =
  | "topic"
  | "process"
  | "decision"
  | "start"
  | "end"
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

// Product semantics for mind maps, flowcharts, and architecture diagrams.
// AntV Infographic syntax is a separate, renderer-native document format.
export type DiagramIr = {
  kind: DiagramKind;
  theme?: DiagramTheme;
  structure?: DiagramStructure;
  layout?: { direction?: "left-to-right" | "top-to-bottom" };
  nodes: Array<{
    id: string;
    label: string;
    type?: DiagramIrNodeType;
    parentId?: string;
    resourceIcon?: ArchitectureResourceIcon;
  }>;
  edges?: Array<{
    source: string;
    target: string;
    label?: string;
    type?: DiagramEdgeKind;
    bidirectional?: boolean;
  }>;
};

const MIND_MAP_TWO_SIDED_THRESHOLD = 5;
const BRACE_HORIZONTAL_GAP = 88;
const TREE_HORIZONTAL_GAP = 64;
const ORG_RANK_GAP = 56;
const ORG_NODE_GAP = 36;
const TIMELINE_COLUMN_GAP = 56;
const TIMELINE_SPINE_GAP = 40;
const TIMELINE_NEST_INDENT = 16;
const FISHBONE_COLUMN_GAP = 28;
const FISHBONE_SPINE_GAP = 56;
const FISHBONE_NEST_INDENT = 20;
const FLOWCHART_DETACHED_GAP = 56;
const FLOWCHART_DETACHED_ROW_GAP = 24;
const FLOWCHART_DETACHED_ROW_WIDTH = 960;
const ARCHITECTURE_LAYOUT_ROW_WIDTH = 1480;
const ARCHITECTURE_LAYOUT_TARGET_RATIO = 1.35;
const ARCHITECTURE_GROUP_HORIZONTAL_GAP = 72;
const ARCHITECTURE_GROUP_VERTICAL_GAP = 88;
const ARCHITECTURE_GROUP_PAD_X = 36;
const ARCHITECTURE_GROUP_PAD_Y = 56;
const ARCHITECTURE_LAYOUT_SPACING = { rank: 96, node: 40 };
const ARCHITECTURE_META_SPACING = { rank: 128, node: 56 };
const ARCHITECTURE_ORIGIN = 32;

export const compactArchitectureNodeSize = (
  shape: DiagramNodeShape,
  authored?: { width: number; height: number },
) => {
  if (shape === "boundary") return authored ?? { width: 560, height: 320 };
  if (shape === "database") return { width: 150, height: 72 };
  if (shape === "queue") return { width: 156, height: 60 };
  if (shape === "security") return { width: 148, height: 60 };
  return { width: 156, height: 56 };
};

export const architectureNodeHeight = (shape: DiagramNodeShape, lineCount: number) => {
  const baseHeight = compactArchitectureNodeSize(shape).height;
  return Math.max(baseHeight, lineCount <= 1 ? 56 : lineCount === 2 ? 60 : lineCount * 17 + 20);
};

const architectureNodeSizeForLabel = (shape: DiagramNodeShape, label: string) => {
  const { width } = compactArchitectureNodeSize(shape);
  if (shape === "boundary") return compactArchitectureNodeSize(shape);
  // Reserve space during semantic layout before the browser measures the final wrapping.
  const capacity = (width - 66) / 12;
  const lineCount = label.split("\n").reduce(
    (count, paragraph) => count + Math.max(1, Math.ceil(visualTextUnits(paragraph) / capacity)),
    0,
  );
  return { width, height: architectureNodeHeight(shape, lineCount) };
};

const computeMindMapLayout = (
  document: DiagramDocument,
  options: DiagramLayoutOptions,
): DiagramLayoutPositions => {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, string[]>();
  for (const node of document.nodes) {
    if (!node.parentId || !nodeById.has(node.parentId)) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }

  for (const children of childrenByParent.values()) {
    children.sort((leftId, rightId) => {
      const left = nodeById.get(leftId)!;
      const right = nodeById.get(rightId)!;
      return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);
    });
  }

  if (options.insertedNodeId && options.insertAfterNodeId) {
    const inserted = nodeById.get(options.insertedNodeId);
    const target = nodeById.get(options.insertAfterNodeId);
    if (inserted?.parentId && inserted.parentId === target?.parentId) {
      const siblings = childrenByParent.get(inserted.parentId);
      if (siblings) {
        const withoutInserted = siblings.filter((id) => id !== inserted.id);
        const targetIndex = withoutInserted.indexOf(target.id);
        withoutInserted.splice(targetIndex < 0 ? withoutInserted.length : targetIndex + 1, 0, inserted.id);
        childrenByParent.set(inserted.parentId, withoutInserted);
      }
    }
  }

  const childIdsOf = (nodeId: string, ancestors: Set<string>) => (
    (childrenByParent.get(nodeId) ?? []).filter((childId) => !ancestors.has(childId) && childId !== nodeId)
  );

  const subtreeHeights = new Map<string, number>();
  const measureSubtreeHeight = (nodeId: string, ancestors: Set<string>): number => {
    const cached = subtreeHeights.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodeById.get(nodeId);
    if (!node || ancestors.has(nodeId)) return 0;
    const nextAncestors = new Set(ancestors).add(nodeId);
    const childHeights = childIdsOf(nodeId, nextAncestors)
      .map((childId) => measureSubtreeHeight(childId, nextAncestors))
      .filter((height) => height > 0);
    const childrenHeight = childHeights.reduce((total, height) => total + height, 0)
      + Math.max(0, childHeights.length - 1) * MIND_MAP_VERTICAL_GAP;
    const height = Math.max(node.height, childrenHeight);
    subtreeHeights.set(nodeId, height);
    return height;
  };

  const positions: DiagramLayoutPositions = Object.fromEntries(
    document.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  );

  const placeBranchChildren = (
    nodeId: string,
    subtreeTop: number,
    ancestors: Set<string>,
    direction: 1 | -1,
    horizontalGap: number,
    align: "center" | "start",
  ) => {
    const node = nodeById.get(nodeId);
    if (!node || ancestors.has(nodeId)) return;
    const nextAncestors = new Set(ancestors).add(nodeId);
    const childIds = childIdsOf(nodeId, nextAncestors);
    const childHeights = childIds.map((childId) => measureSubtreeHeight(childId, nextAncestors));
    const childrenHeight = childHeights.reduce((total, height) => total + height, 0)
      + Math.max(0, childHeights.length - 1) * MIND_MAP_VERTICAL_GAP;
    let cursor = align === "start"
      ? positions[nodeId].y
      : subtreeTop + (measureSubtreeHeight(nodeId, ancestors) - childrenHeight) / 2;
    for (let index = 0; index < childIds.length; index += 1) {
      const childId = childIds[index];
      const child = nodeById.get(childId)!;
      const childSubtreeHeight = childHeights[index];
      positions[childId] = {
        x: direction === 1
          ? positions[nodeId].x + node.width + horizontalGap
          : positions[nodeId].x - horizontalGap - child.width,
        y: Math.round(align === "start" ? cursor : cursor + (childSubtreeHeight - child.height) / 2),
      };
      placeBranchChildren(childId, cursor, nextAncestors, direction, horizontalGap, align);
      cursor += childSubtreeHeight + MIND_MAP_VERTICAL_GAP;
    }
  };

  const placeRootSide = (
    rootId: string,
    childIds: string[],
    direction: 1 | -1,
    horizontalGap: number,
    align: "center" | "start",
  ) => {
    const root = nodeById.get(rootId);
    if (!root || childIds.length === 0) return;
    const childHeights = childIds.map((childId) => measureSubtreeHeight(childId, new Set([rootId])));
    const sideHeight = childHeights.reduce((total, height) => total + height, 0)
      + Math.max(0, childHeights.length - 1) * MIND_MAP_VERTICAL_GAP;
    let cursor = align === "start"
      ? root.y
      : root.y + root.height / 2 - sideHeight / 2;
    for (let index = 0; index < childIds.length; index += 1) {
      const child = nodeById.get(childIds[index])!;
      const childSubtreeHeight = childHeights[index];
      positions[child.id] = {
        x: direction === 1
          ? root.x + root.width + horizontalGap
          : root.x - horizontalGap - child.width,
        y: Math.round(align === "start" ? cursor : cursor + (childSubtreeHeight - child.height) / 2),
      };
      placeBranchChildren(child.id, cursor, new Set([rootId]), direction, horizontalGap, align);
      cursor += childSubtreeHeight + MIND_MAP_VERTICAL_GAP;
    }
  };

  const layoutBranchMap = (oneSided: boolean, horizontalGap: number, align: "center" | "start") => {
    const roots = document.nodes
      .filter((node) => !node.parentId || !nodeById.has(node.parentId))
      .sort((left, right) => left.y - right.y || left.id.localeCompare(right.id));
    for (const root of roots) {
      const childIds = childIdsOf(root.id, new Set([root.id]));
      if (oneSided || childIds.length < MIND_MAP_TWO_SIDED_THRESHOLD) {
        placeRootSide(root.id, childIds, 1, horizontalGap, align);
        continue;
      }
      const sides: Record<"left" | "right", { ids: string[]; height: number }> = {
        left: { ids: [], height: 0 },
        right: { ids: [], height: 0 },
      };
      for (const childId of childIds) {
        const side = sides.right.height <= sides.left.height ? sides.right : sides.left;
        side.ids.push(childId);
        side.height += measureSubtreeHeight(childId, new Set([root.id])) + MIND_MAP_VERTICAL_GAP;
      }
      placeRootSide(root.id, sides.left.ids, -1, horizontalGap, align);
      placeRootSide(root.id, sides.right.ids, 1, horizontalGap, align);
    }
    return positions;
  };

  const subtreeWidths = new Map<string, number>();
  const measureSubtreeWidth = (nodeId: string, ancestors: Set<string>): number => {
    const cached = subtreeWidths.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodeById.get(nodeId);
    if (!node || ancestors.has(nodeId)) return 0;
    const nextAncestors = new Set(ancestors).add(nodeId);
    const childWidths = childIdsOf(nodeId, nextAncestors).map((childId) => measureSubtreeWidth(childId, nextAncestors));
    const childrenWidth = childWidths.reduce((total, width) => total + width, 0)
      + Math.max(0, childWidths.length - 1) * ORG_NODE_GAP;
    const width = Math.max(node.width, childrenWidth);
    subtreeWidths.set(nodeId, width);
    return width;
  };

  const layoutOrgChart = () => {
    const placeOrgChildren = (nodeId: string, ancestors: Set<string>) => {
      const node = nodeById.get(nodeId);
      if (!node) return;
      const nextAncestors = new Set(ancestors).add(nodeId);
      const childIds = childIdsOf(nodeId, nextAncestors);
      if (childIds.length === 0) return;
      const childWidths = childIds.map((childId) => measureSubtreeWidth(childId, nextAncestors));
      const totalWidth = childWidths.reduce((total, width) => total + width, 0)
        + Math.max(0, childWidths.length - 1) * ORG_NODE_GAP;
      const parent = positions[nodeId];
      let cursor = parent.x + node.width / 2 - totalWidth / 2;
      const childY = parent.y + node.height + ORG_RANK_GAP;
      for (let index = 0; index < childIds.length; index += 1) {
        const child = nodeById.get(childIds[index])!;
        positions[child.id] = {
          x: Math.round(cursor + (childWidths[index] - child.width) / 2),
          y: Math.round(childY),
        };
        placeOrgChildren(child.id, nextAncestors);
        cursor += childWidths[index] + ORG_NODE_GAP;
      }
    };
    for (const root of document.nodes.filter((node) => !node.parentId || !nodeById.has(node.parentId))) {
      placeOrgChildren(root.id, new Set([root.id]));
    }
    return positions;
  };

  const layoutTimeline = () => {
    const placeAway = (
      parentId: string,
      startY: number,
      direction: 1 | -1,
      x: number,
      ancestors: Set<string>,
    ): number => {
      const nextAncestors = new Set(ancestors).add(parentId);
      const childIds = childIdsOf(parentId, nextAncestors);
      let cursor = startY;
      let far = startY;
      for (const childId of childIds) {
        const child = nodeById.get(childId)!;
        if (direction === 1) {
          positions[childId] = { x: Math.round(x), y: Math.round(cursor) };
          const nestedFar = placeAway(
            childId,
            positions[childId].y + child.height + MIND_MAP_VERTICAL_GAP,
            1,
            x + TIMELINE_NEST_INDENT,
            nextAncestors,
          );
          cursor = Math.max(positions[childId].y + child.height, nestedFar) + MIND_MAP_VERTICAL_GAP;
          far = cursor;
        } else {
          positions[childId] = { x: Math.round(x), y: Math.round(cursor - child.height) };
          const nestedFar = placeAway(
            childId,
            positions[childId].y - MIND_MAP_VERTICAL_GAP,
            -1,
            x + TIMELINE_NEST_INDENT,
            nextAncestors,
          );
          cursor = Math.min(positions[childId].y, nestedFar) - MIND_MAP_VERTICAL_GAP;
          far = cursor;
        }
      }
      return far;
    };
    for (const root of document.nodes.filter((node) => !node.parentId || !nodeById.has(node.parentId))) {
      const spineY = root.y + root.height / 2;
      const childIds = childIdsOf(root.id, new Set([root.id]));
      let cursorX = root.x + root.width + TIMELINE_COLUMN_GAP;
      for (let index = 0; index < childIds.length; index += 1) {
        const child = nodeById.get(childIds[index])!;
        const above = index % 2 === 0;
        positions[child.id] = {
          x: Math.round(cursorX),
          y: Math.round(above ? spineY - TIMELINE_SPINE_GAP - child.height : spineY + TIMELINE_SPINE_GAP),
        };
        if (above) {
          placeAway(child.id, positions[child.id].y - MIND_MAP_VERTICAL_GAP, -1, cursorX + TIMELINE_NEST_INDENT, new Set([root.id, child.id]));
        } else {
          placeAway(child.id, positions[child.id].y + child.height + MIND_MAP_VERTICAL_GAP, 1, cursorX + TIMELINE_NEST_INDENT, new Set([root.id, child.id]));
        }
        const nested = childIdsOf(child.id, new Set([root.id, child.id])).length > 0;
        cursorX += child.width + (nested ? TIMELINE_NEST_INDENT : 0) + TIMELINE_COLUMN_GAP;
      }
    }
    return positions;
  };

  const layoutFishbone = () => {
    const placeBoneChildren = (parentId: string, above: boolean, ancestors: Set<string>): number => {
      const parent = nodeById.get(parentId);
      if (!parent) return positions[parentId]?.y ?? 0;
      const nextAncestors = new Set(ancestors).add(parentId);
      const childIds = childIdsOf(parentId, nextAncestors);
      let cursor = above
        ? positions[parentId].y - MIND_MAP_VERTICAL_GAP
        : positions[parentId].y + parent.height + MIND_MAP_VERTICAL_GAP;
      let far = above ? positions[parentId].y : positions[parentId].y + parent.height;
      for (const childId of childIds) {
        const child = nodeById.get(childId)!;
        positions[childId] = {
          x: Math.round(positions[parentId].x - FISHBONE_NEST_INDENT),
          y: Math.round(above ? cursor - child.height : cursor),
        };
        const childFar = placeBoneChildren(childId, above, nextAncestors);
        if (above) {
          cursor = childFar - MIND_MAP_VERTICAL_GAP;
          far = Math.min(far, childFar);
        } else {
          cursor = childFar + MIND_MAP_VERTICAL_GAP;
          far = Math.max(far, childFar);
        }
      }
      return far;
    };
    for (const root of document.nodes.filter((node) => !node.parentId || !nodeById.has(node.parentId))) {
      const spineY = root.y + root.height / 2;
      const childIds = childIdsOf(root.id, new Set([root.id]));
      let cursorX = root.x - FISHBONE_COLUMN_GAP;
      for (let index = 0; index < childIds.length; index += 2) {
        const aboveNode = nodeById.get(childIds[index])!;
        const belowNode = childIds[index + 1] ? nodeById.get(childIds[index + 1]) : undefined;
        const columnWidth = Math.max(aboveNode.width, belowNode?.width ?? 0) + FISHBONE_NEST_INDENT;
        cursorX -= columnWidth;
        positions[aboveNode.id] = {
          x: Math.round(cursorX + (columnWidth - aboveNode.width) / 2),
          y: Math.round(spineY - FISHBONE_SPINE_GAP - aboveNode.height),
        };
        placeBoneChildren(aboveNode.id, true, new Set([root.id, aboveNode.id]));
        if (belowNode) {
          positions[belowNode.id] = {
            x: Math.round(cursorX + (columnWidth - belowNode.width) / 2),
            y: Math.round(spineY + FISHBONE_SPINE_GAP),
          };
          placeBoneChildren(belowNode.id, false, new Set([root.id, belowNode.id]));
        }
        cursorX -= FISHBONE_COLUMN_GAP;
      }
    }
    return positions;
  };

  const family = mindMapLayoutFamily(document.structure);
  if (family === "org") return layoutOrgChart();
  if (family === "timeline") return layoutTimeline();
  if (family === "fishbone") return layoutFishbone();
  if (family === "brace") return layoutBranchMap(true, BRACE_HORIZONTAL_GAP, "center");
  if (family === "tree") return layoutBranchMap(true, TREE_HORIZONTAL_GAP, "start");
  return layoutBranchMap(mindMapIsOneSided(document.structure), MIND_MAP_HORIZONTAL_GAP, "center");
};

const architectureTopLevelBoundaryId = (
  nodeId: string,
  nodeById: Map<string, DiagramDocument["nodes"][number]>,
) => {
  let current = nodeById.get(nodeId);
  let boundaryId: string | undefined;
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    const parent = nodeById.get(current.parentId);
    if (!parent) break;
    if (parent.shape === "boundary") boundaryId = parent.id;
    current = parent;
  }
  return boundaryId;
};

const layoutDagreGraph = (
  nodes: Array<{ id: string; width: number; height: number }>,
  edges: Array<{ source: string; target: string }>,
  direction: "left-to-right" | "top-to-bottom",
  spacing: { rank: number; node: number } = { rank: 96, node: 40 },
  margin = { x: 32, y: 32 },
): DiagramLayoutPositions => {
  if (nodes.length === 0) return {};
  const layoutGraph = new graphlib.Graph();
  layoutGraph.setGraph({
    rankdir: direction === "top-to-bottom" ? "TB" : "LR",
    ranksep: spacing.rank,
    nodesep: spacing.node,
    marginx: margin.x,
    marginy: margin.y,
  });
  layoutGraph.setDefaultEdgeLabel(() => ({}));
  const layoutNodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) layoutGraph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (layoutNodeIds.has(edge.source) && layoutNodeIds.has(edge.target)) layoutGraph.setEdge(edge.source, edge.target);
  }
  runDagreLayout(layoutGraph);
  return Object.fromEntries(nodes.flatMap((node) => {
    const position = layoutGraph.node(node.id) as { x: number; y: number } | undefined;
    if (!position) return [];
    return [[node.id, {
      x: Math.round(position.x - node.width / 2),
      y: Math.round(position.y - node.height / 2),
    }]];
  }));
};

const layoutArchitectureGraph = (
  nodes: Array<{ id: string; width: number; height: number }>,
  edges: Array<{ source: string; target: string }>,
  direction: "left-to-right" | "top-to-bottom",
  spacing: { rank: number; node: number },
  margin: { x: number; y: number },
  maxWidth = ARCHITECTURE_LAYOUT_ROW_WIDTH,
): DiagramLayoutPositions => {
  const positions = layoutDagreGraph(nodes, edges, direction, spacing, margin);
  if (direction === "top-to-bottom" || nodes.length < 2) return positions;
  const width = (candidate: DiagramLayoutPositions) => Math.max(...nodes.map((node) => candidate[node.id].x + node.width))
    - Math.min(...nodes.map((node) => candidate[node.id].x));
  if (width(positions) <= maxWidth) return positions;
  const vertical = layoutDagreGraph(nodes, edges, "top-to-bottom", spacing, margin);
  return width(vertical) < width(positions) ? vertical : positions;
};

const layoutArchitectureMetaGraph = (
  nodes: Array<{ id: string; width: number; height: number }>,
  edges: Array<{ source: string; target: string }>,
  direction: "left-to-right" | "top-to-bottom",
  margin: { x: number; y: number },
): DiagramLayoutPositions => {
  const vertical = layoutDagreGraph(nodes, edges, "top-to-bottom", ARCHITECTURE_META_SPACING, margin);
  if (direction === "top-to-bottom" || nodes.length === 0) return vertical;
  const horizontal = layoutDagreGraph(nodes, edges, "left-to-right", ARCHITECTURE_META_SPACING, margin);
  const size = (positions: DiagramLayoutPositions) => ({
    width: Math.max(...nodes.map((node) => positions[node.id].x + node.width))
      - Math.min(...nodes.map((node) => positions[node.id].x)),
    height: Math.max(...nodes.map((node) => positions[node.id].y + node.height))
      - Math.min(...nodes.map((node) => positions[node.id].y)),
  });
  if (size(horizontal).width <= ARCHITECTURE_LAYOUT_ROW_WIDTH) return horizontal;
  if (nodes.length < 3) return vertical;

  const wrapped: DiagramLayoutPositions = {};
  let x = margin.x;
  let y = margin.y;
  let rowHeight = 0;
  for (const node of [...nodes].sort((left, right) => (
    horizontal[left.id].x - horizontal[right.id].x
    || horizontal[left.id].y - horizontal[right.id].y
    || left.id.localeCompare(right.id)
  ))) {
    if (x > margin.x && x + node.width > margin.x + ARCHITECTURE_LAYOUT_ROW_WIDTH) {
      x = margin.x;
      y += rowHeight + ARCHITECTURE_GROUP_VERTICAL_GAP;
      rowHeight = 0;
    }
    wrapped[node.id] = { x, y };
    x += node.width + ARCHITECTURE_GROUP_HORIZONTAL_GAP;
    rowHeight = Math.max(rowHeight, node.height);
  }
  const fitCost = (positions: DiagramLayoutPositions) => {
    const bounds = size(positions);
    const targetHeight = ARCHITECTURE_LAYOUT_ROW_WIDTH / ARCHITECTURE_LAYOUT_TARGET_RATIO;
    const overflow = Math.max(bounds.width / ARCHITECTURE_LAYOUT_ROW_WIDTH, bounds.height / targetHeight);
    const aspectError = Math.abs(Math.log((bounds.width / bounds.height) / ARCHITECTURE_LAYOUT_TARGET_RATIO));
    return overflow + aspectError * 0.2;
  };
  return fitCost(wrapped) < fitCost(vertical) ? wrapped : vertical;
};

const wrapArchitectureGroups = (
  document: DiagramDocument,
  positions: DiagramLayoutPositions,
) => {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const topLevelBoundaries = document.nodes.filter((node) => (
    node.shape === "boundary" && (!node.parentId || nodeById.get(node.parentId)?.shape !== "boundary")
  ));
  if (topLevelBoundaries.length < 2) return positions;

  const groups = topLevelBoundaries.flatMap((boundary) => {
    const members = document.nodes.filter((node) => (
      node.shape !== "boundary"
      && architectureTopLevelBoundaryId(node.id, nodeById) === boundary.id
      && positions[node.id]
    ));
    if (members.length === 0) return [];
    const left = Math.min(...members.map((node) => positions[node.id].x));
    const top = Math.min(...members.map((node) => positions[node.id].y));
    const right = Math.max(...members.map((node) => positions[node.id].x + node.width));
    const bottom = Math.max(...members.map((node) => positions[node.id].y + node.height));
    return [{
      boundary,
      members: document.nodes.filter((node) => (
        node.id === boundary.id || architectureTopLevelBoundaryId(node.id, nodeById) === boundary.id
      )),
      left,
      top,
      width: Math.max(260, right - left + ARCHITECTURE_GROUP_PAD_X * 2),
      height: Math.max(180, bottom - top + ARCHITECTURE_GROUP_PAD_Y + ARCHITECTURE_GROUP_PAD_X),
    }];
  }).sort((left, right) => left.left - right.left || left.top - right.top || left.boundary.id.localeCompare(right.boundary.id));
  if (groups.length < 2) return positions;

  const contentLeft = Math.min(...groups.map((group) => group.left - ARCHITECTURE_GROUP_PAD_X));
  const contentRight = Math.max(...groups.map((group) => group.left - ARCHITECTURE_GROUP_PAD_X + group.width));
  if (contentRight - contentLeft <= ARCHITECTURE_LAYOUT_ROW_WIDTH) return positions;

  let cursorX = ARCHITECTURE_ORIGIN;
  let cursorY = ARCHITECTURE_ORIGIN;
  let rowHeight = 0;
  for (const group of groups) {
    if (cursorX > ARCHITECTURE_ORIGIN && cursorX + group.width > ARCHITECTURE_ORIGIN + ARCHITECTURE_LAYOUT_ROW_WIDTH) {
      cursorX = ARCHITECTURE_ORIGIN;
      cursorY += rowHeight + ARCHITECTURE_GROUP_VERTICAL_GAP;
      rowHeight = 0;
    }
    const deltaX = cursorX + ARCHITECTURE_GROUP_PAD_X - group.left;
    const deltaY = cursorY + ARCHITECTURE_GROUP_PAD_Y - group.top;
    for (const node of group.members) {
      const position = positions[node.id] ?? { x: node.x, y: node.y };
      positions[node.id] = { x: position.x + deltaX, y: position.y + deltaY };
    }
    cursorX += group.width + ARCHITECTURE_GROUP_HORIZONTAL_GAP;
    rowHeight = Math.max(rowHeight, group.height);
  }
  return positions;
};

const placeUnpositionedArchitectureNodes = (
  document: DiagramDocument,
  positions: DiagramLayoutPositions,
) => {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const detached = document.nodes.filter((node) => (
    node.shape !== "boundary"
    && !positions[node.id]
    && !architectureTopLevelBoundaryId(node.id, nodeById)
  )).sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  if (detached.length === 0) return positions;

  const placed = document.nodes.filter((node) => node.shape !== "boundary" && positions[node.id]);
  const contentLeft = placed.length > 0
    ? Math.min(...placed.map((node) => positions[node.id].x))
    : ARCHITECTURE_ORIGIN;
  const contentBottom = placed.length > 0
    ? Math.max(...placed.map((node) => positions[node.id].y + node.height))
    : ARCHITECTURE_ORIGIN;
  let cursorX = contentLeft;
  let cursorY = contentBottom + FLOWCHART_DETACHED_GAP;
  let rowHeight = 0;
  for (const node of detached) {
    if (cursorX > contentLeft && cursorX + node.width > contentLeft + FLOWCHART_DETACHED_ROW_WIDTH) {
      cursorX = contentLeft;
      cursorY += rowHeight + FLOWCHART_DETACHED_ROW_GAP;
      rowHeight = 0;
    }
    positions[node.id] = { x: cursorX, y: cursorY };
    cursorX += node.width + 40;
    rowHeight = Math.max(rowHeight, node.height);
  }
  return positions;
};

const placeEmptyArchitectureBoundaries = (
  document: DiagramDocument,
  positions: DiagramLayoutPositions,
) => {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const empty = document.nodes.filter((node) => (
    node.shape === "boundary"
    && !node.parentId
    && !document.nodes.some((member) => (
      member.shape !== "boundary" && architectureTopLevelBoundaryId(member.id, nodeById) === node.id
    ))
  )).sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  if (empty.length === 0) return positions;

  const emptyIds = new Set(empty.map((node) => node.id));
  const placed = document.nodes.filter((node) => (
    positions[node.id]
    && !emptyIds.has(node.id)
    && !empty.some((boundary) => architectureTopLevelBoundaryId(node.id, nodeById) === boundary.id)
  ));
  const contentBottom = placed.length > 0
    ? Math.max(...placed.map((node) => positions[node.id].y + node.height))
    : ARCHITECTURE_ORIGIN - ARCHITECTURE_GROUP_VERTICAL_GAP;
  let cursorX = ARCHITECTURE_ORIGIN;
  let cursorY = contentBottom + ARCHITECTURE_GROUP_VERTICAL_GAP;
  let rowHeight = 0;
  for (const boundary of empty) {
    if (cursorX > ARCHITECTURE_ORIGIN
      && cursorX + boundary.width > ARCHITECTURE_ORIGIN + ARCHITECTURE_LAYOUT_ROW_WIDTH) {
      cursorX = ARCHITECTURE_ORIGIN;
      cursorY += rowHeight + ARCHITECTURE_GROUP_VERTICAL_GAP;
      rowHeight = 0;
    }
    const deltaX = cursorX - positions[boundary.id].x;
    const deltaY = cursorY - positions[boundary.id].y;
    for (const node of document.nodes) {
      if (node.id !== boundary.id && architectureTopLevelBoundaryId(node.id, nodeById) !== boundary.id) continue;
      positions[node.id] = { x: positions[node.id].x + deltaX, y: positions[node.id].y + deltaY };
    }
    cursorX += boundary.width + ARCHITECTURE_GROUP_HORIZONTAL_GAP;
    rowHeight = Math.max(rowHeight, boundary.height);
  }
  return positions;
};

const computeDagreLayout = (
  document: DiagramDocument,
  options: DiagramLayoutOptions,
  excludeBoundaries: boolean,
  spacing: { rank: number; node: number } = { rank: 96, node: 40 },
): DiagramLayoutPositions => {
  const layoutNodes = excludeBoundaries
    ? document.nodes.filter((node) => node.shape !== "boundary")
    : document.nodes;
  const positions = layoutDagreGraph(
    layoutNodes,
    document.edges,
    options.direction === "top-to-bottom" ? "top-to-bottom" : "left-to-right",
    spacing,
  );
  for (const node of document.nodes) {
    if (node.shape === "boundary" && !positions[node.id]) positions[node.id] = { x: node.x, y: node.y };
  }
  return positions;
};

const placeDetachedFlowchartNodes = (
  document: DiagramDocument,
  positions: DiagramLayoutPositions,
) => {
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const connectedIds = new Set<string>();
  for (const edge of document.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  const connected = document.nodes.filter((node) => connectedIds.has(node.id));
  const detached = document.nodes
    .filter((node) => !connectedIds.has(node.id))
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  if (connected.length === 0 || detached.length === 0) return positions;

  const contentLeft = Math.min(...connected.map((node) => positions[node.id].x));
  const contentBottom = Math.max(...connected.map((node) => positions[node.id].y + node.height));
  let cursorX = contentLeft;
  let cursorY = contentBottom + FLOWCHART_DETACHED_GAP;
  let rowHeight = 0;
  for (const node of detached) {
    if (cursorX > contentLeft && cursorX + node.width > contentLeft + FLOWCHART_DETACHED_ROW_WIDTH) {
      cursorX = contentLeft;
      cursorY += rowHeight + FLOWCHART_DETACHED_ROW_GAP;
      rowHeight = 0;
    }
    positions[node.id] = { x: cursorX, y: cursorY };
    cursorX += node.width + 40;
    rowHeight = Math.max(rowHeight, node.height);
  }
  return positions;
};

const alignFlowchartSpine = (
  document: DiagramDocument,
  positions: DiagramLayoutPositions,
  direction: "left-to-right" | "top-to-bottom",
) => {
  const topToBottom = direction !== "left-to-right";
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of document.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of document.edges) {
    if (!positions[edge.source] || !positions[edge.target]) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }
  const isBackEdge = (source: string, target: string) => {
    const from = positions[source];
    const to = positions[target];
    return topToBottom ? from.y > to.y + 8 : from.x > to.x + 8;
  };
  const sizeById = new Map(document.nodes.map((node) => [node.id, node]));
  const ordered = [...document.nodes].sort((left, right) => {
    const leftPosition = positions[left.id];
    const rightPosition = positions[right.id];
    return topToBottom
      ? leftPosition.y - rightPosition.y || leftPosition.x - rightPosition.x
      : leftPosition.x - rightPosition.x || leftPosition.y - rightPosition.y;
  });
  const boxesOverlap = (
    left: { x: number; y: number; width: number; height: number },
    right: { x: number; y: number; width: number; height: number },
  ) => left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;

  for (const node of ordered) {
    const successors = (outgoing.get(node.id) ?? []).filter((target) => !isBackEdge(node.id, target));
    if (successors.length !== 1) continue;
    const targetId = successors[0];
    const predecessors = (incoming.get(targetId) ?? []).filter((source) => !isBackEdge(source, targetId));
    if (predecessors.length !== 1 || predecessors[0] !== node.id) continue;
    const source = sizeById.get(node.id);
    const target = sizeById.get(targetId);
    if (!source || !target) continue;
    const from = positions[node.id];
    const current = positions[targetId];
    const next = topToBottom
      ? { x: Math.round(from.x + source.width / 2 - target.width / 2), y: current.y }
      : { x: current.x, y: Math.round(from.y + source.height / 2 - target.height / 2) };
    const nextBox = { ...next, width: target.width, height: target.height };
    const overlaps = document.nodes.some((other) => {
      if (other.id === node.id || other.id === targetId) return false;
      const otherPosition = positions[other.id];
      return boxesOverlap(nextBox, { ...otherPosition, width: other.width, height: other.height });
    });
    if (!overlaps) positions[targetId] = next;
  }
  return positions;
};

const computeFlowchartLayout = (document: DiagramDocument, options: DiagramLayoutOptions) => {
  const direction = options.direction ?? "top-to-bottom";
  const positions = computeDagreLayout(document, { ...options, direction }, false, FLOWCHART_LAYOUT_SPACING);
  alignFlowchartSpine(document, positions, direction);
  return placeDetachedFlowchartNodes(document, positions);
};

const computeArchitectureLayout = (document: DiagramDocument, options: DiagramLayoutOptions) => {
  const direction = options.direction ?? "left-to-right";
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const topLevelBoundaries = document.nodes.filter((node) => (
    node.shape === "boundary" && (!node.parentId || nodeById.get(node.parentId)?.shape !== "boundary")
  ));
  const groups = topLevelBoundaries.flatMap((boundary) => {
    const members = document.nodes.filter((node) => (
      node.shape !== "boundary" && architectureTopLevelBoundaryId(node.id, nodeById) === boundary.id
    ));
    return members.length > 0 ? [{ boundary, members }] : [];
  });
  if (groups.length === 0) {
    const positions = layoutArchitectureGraph(
      document.nodes.filter((node) => node.shape !== "boundary"),
      document.edges,
      direction,
      ARCHITECTURE_LAYOUT_SPACING,
      { x: 32, y: 32 },
    );
    for (const boundary of document.nodes.filter((node) => node.shape === "boundary")) {
      positions[boundary.id] = { x: boundary.x, y: boundary.y };
    }
    return placeEmptyArchitectureBoundaries(document, positions);
  }

  const innerByGroup = new Map<string, DiagramLayoutPositions>();
  const groupMetaNodes = groups.map((group) => {
    const memberIds = new Set(group.members.map((node) => node.id));
    const intraEdges = document.edges.filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target));
    const crossEdgeCount = document.edges.filter((edge) => (
      memberIds.has(edge.source) !== memberIds.has(edge.target)
    )).length;
    // Cross-boundary relations need separate vertical lanes beside their nodes.
    // Keep sparse groups compact while giving dense groups room for labels.
    const nodeGap = Math.min(112, ARCHITECTURE_LAYOUT_SPACING.node
      + Math.round(crossEdgeCount / group.members.length * 22));
    const inner = layoutArchitectureGraph(
      group.members,
      intraEdges,
      direction,
      { ...ARCHITECTURE_LAYOUT_SPACING, node: nodeGap },
      { x: 0, y: 0 },
      ARCHITECTURE_LAYOUT_ROW_WIDTH - ARCHITECTURE_GROUP_PAD_X * 2,
    );
    const left = Math.min(...group.members.map((node) => inner[node.id].x));
    const top = Math.min(...group.members.map((node) => inner[node.id].y));
    const normalized = Object.fromEntries(group.members.map((node) => [node.id, {
      x: inner[node.id].x - left,
      y: inner[node.id].y - top,
    }]));
    innerByGroup.set(group.boundary.id, normalized);
    const width = Math.max(...group.members.map((node) => normalized[node.id].x + node.width));
    const height = Math.max(...group.members.map((node) => normalized[node.id].y + node.height));
    return {
      id: group.boundary.id,
      width: Math.max(260, width + ARCHITECTURE_GROUP_PAD_X * 2),
      height: Math.max(180, height + ARCHITECTURE_GROUP_PAD_Y + ARCHITECTURE_GROUP_PAD_X),
    };
  });

  const connectedIds = new Set<string>();
  for (const edge of document.edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }
  const connectedFree = document.nodes.filter((node) => (
    node.shape !== "boundary"
    && !architectureTopLevelBoundaryId(node.id, nodeById)
    && connectedIds.has(node.id)
  ));
  const metaNodes = [
    ...groupMetaNodes,
    ...connectedFree.map((node) => ({ id: node.id, width: node.width, height: node.height })),
  ];
  const metaNodeIds = new Set(metaNodes.map((node) => node.id));
  const metaId = (nodeId: string) => {
    const groupId = architectureTopLevelBoundaryId(nodeId, nodeById);
    if (groupId && metaNodeIds.has(groupId)) return groupId;
    return metaNodeIds.has(nodeId) ? nodeId : undefined;
  };
  const seenMetaEdges = new Set<string>();
  const metaEdges: Array<{ source: string; target: string }> = [];
  for (const edge of document.edges) {
    const sourceId = metaId(edge.source);
    const targetId = metaId(edge.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const key = `${sourceId}\0${targetId}`;
    if (seenMetaEdges.has(key)) continue;
    seenMetaEdges.add(key);
    metaEdges.push({ source: sourceId, target: targetId });
  }

  const metaMargin = { x: ARCHITECTURE_ORIGIN, y: ARCHITECTURE_ORIGIN };
  const metaPositions = layoutArchitectureMetaGraph(
    metaNodes,
    metaEdges,
    direction,
    metaMargin,
  );

  const positions: DiagramLayoutPositions = Object.fromEntries(
    document.nodes.filter((node) => node.shape === "boundary").map((node) => [node.id, { x: node.x, y: node.y }]),
  );
  for (const group of groups) {
    const inner = innerByGroup.get(group.boundary.id)!;
    const origin = metaPositions[group.boundary.id];
    for (const member of group.members) {
      positions[member.id] = {
        x: origin.x + ARCHITECTURE_GROUP_PAD_X + inner[member.id].x,
        y: origin.y + ARCHITECTURE_GROUP_PAD_Y + inner[member.id].y,
      };
    }
  }
  for (const node of connectedFree) {
    const position = metaPositions[node.id];
    if (position) positions[node.id] = position;
  }

  wrapArchitectureGroups(document, positions);
  placeUnpositionedArchitectureNodes(document, positions);
  return placeEmptyArchitectureBoundaries(document, positions);
};

const irNodeShape = (kind: DiagramKind, type: DiagramIrNodeType | undefined): DiagramNodeShape => {
  if (kind === "mind-map") return "topic";
  if (kind === "flowchart") return type === "decision" ? "decision" : type === "start" || type === "end" || type === "terminator" ? "terminator" : "process";
  return (type ?? "service") as DiagramNodeShape;
};

const finalizeArchitectureLayout = (document: DiagramDocument) => {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const boundaryDepth = (nodeId: string) => {
    let depth = 0;
    let current = nodeById.get(nodeId);
    const visited = new Set<string>();
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      depth += 1;
      current = nodeById.get(current.parentId);
    }
    return depth;
  };
  const boundaries = document.nodes
    .filter((node) => node.shape === "boundary")
    .sort((left, right) => boundaryDepth(right.id) - boundaryDepth(left.id));
  for (const boundary of boundaries) {
    const children = document.nodes.filter((node) => node.parentId === boundary.id);
    if (children.length === 0) continue;
    const left = Math.min(...children.map((node) => node.x)) - 36;
    const top = Math.min(...children.map((node) => node.y)) - 56;
    const right = Math.max(...children.map((node) => node.x + node.width)) + 36;
    const bottom = Math.max(...children.map((node) => node.y + node.height)) + 36;
    boundary.x = left;
    boundary.y = top;
    boundary.width = Math.max(260, right - left);
    boundary.height = Math.max(180, bottom - top);
  }

  const topLevelBoundaries = boundaries
    .filter((boundary) => !boundary.parentId)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const placed: typeof topLevelBoundaries = [];
  const shiftGroup = (boundaryId: string, deltaY: number) => {
    for (const node of document.nodes) {
      let current = node;
      const visited = new Set<string>();
      while (current.parentId && !visited.has(current.parentId)) {
        visited.add(current.parentId);
        if (current.parentId === boundaryId) {
          node.y += deltaY;
          break;
        }
        const parent = nodeById.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
    }
    nodeById.get(boundaryId)!.y += deltaY;
  };
  for (const boundary of topLevelBoundaries) {
    const overlappingBottom = placed
      .filter((other) => boundary.x < other.x + other.width + 40 && boundary.x + boundary.width + 40 > other.x)
      .reduce((bottom, other) => Math.max(bottom, other.y + other.height), Number.NEGATIVE_INFINITY);
    if (Number.isFinite(overlappingBottom) && boundary.y < overlappingBottom + 40) {
      shiftGroup(boundary.id, overlappingBottom + 40 - boundary.y);
    }
    placed.push(boundary);
  }

  const minX = Math.min(...document.nodes.map((node) => node.x));
  const minY = Math.min(...document.nodes.map((node) => node.y));
  const deltaX = minX < ARCHITECTURE_ORIGIN ? ARCHITECTURE_ORIGIN - minX : 0;
  const deltaY = minY < ARCHITECTURE_ORIGIN ? ARCHITECTURE_ORIGIN - minY : 0;
  if (deltaX === 0 && deltaY === 0) return;
  for (const node of document.nodes) {
    node.x += deltaX;
    node.y += deltaY;
  }
};

export type DiagramLayoutStrategy = {
  kind: DiagramKind;
  layout: (document: DiagramDocument, options: DiagramLayoutOptions) => DiagramLayoutPositions;
  finalize?: (document: DiagramDocument) => void;
  viewport: DiagramLayoutViewport;
};

const DIAGRAM_LAYOUT_STRATEGIES: Record<DiagramKind, DiagramLayoutStrategy> = {
  "mind-map": {
    kind: "mind-map",
    layout: computeMindMapLayout,
    viewport: { anchor: "root", maxScale: 1, minScale: DIAGRAM_READABLE_MIN_SCALE },
  },
  flowchart: {
    kind: "flowchart",
    layout: computeFlowchartLayout,
    viewport: { anchor: "center", maxScale: 1, minScale: DIAGRAM_READABLE_MIN_SCALE },
  },
  architecture: {
    kind: "architecture",
    layout: computeArchitectureLayout,
    finalize: finalizeArchitectureLayout,
    viewport: { anchor: "leftmost", maxScale: 1, minScale: DIAGRAM_READABLE_MIN_SCALE },
  },
};

export const getDiagramLayoutViewport = (kind: DiagramKind): DiagramLayoutViewport => ({
  ...DIAGRAM_LAYOUT_STRATEGIES[kind].viewport,
});

export const computeDiagramLayoutResult = (
  document: DiagramDocument,
  options: DiagramLayoutOptions = {},
): DiagramLayoutResult => {
  const strategy = DIAGRAM_LAYOUT_STRATEGIES[document.kind];
  const layoutDocument: DiagramDocument = {
    ...document,
    nodes: document.nodes.map((node) => {
      if (document.kind !== "flowchart") return { ...node };
      const size = flowchartNodePresentation(node.shape, node.label);
      return { ...node, width: size.width, height: size.height };
    }),
    edges: document.edges.map((edge) => ({ ...edge })),
  };
  const positions = strategy.layout(layoutDocument, options);
  for (const node of layoutDocument.nodes) {
    const position = positions[node.id];
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      node.x = position.x;
      node.y = position.y;
    }
  }
  strategy.finalize?.(layoutDocument);
  const nodeById = new Map(layoutDocument.nodes.map((node) => [node.id, node]));
  const nodeDepth = (nodeId: string) => {
    let depth = 0;
    let current = nodeById.get(nodeId);
    const visited = new Set<string>();
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      const parent = nodeById.get(current.parentId);
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    return depth;
  };
  return {
    nodes: Object.fromEntries(layoutDocument.nodes.map((node) => [node.id, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    }])),
    nodeOrder: layoutDocument.nodes
      .map((node) => node.id)
      .sort((left, right) => nodeDepth(left) - nodeDepth(right)),
    viewport: getDiagramLayoutViewport(document.kind),
  };
};

export const computeDiagramLayout = (
  document: DiagramDocument,
  options: DiagramLayoutOptions = {},
): DiagramLayoutPositions => DIAGRAM_LAYOUT_STRATEGIES[document.kind].layout(document, options);

export const compileDiagramIr = (ir: DiagramIr): DiagramDocument => {
  const nodes = ir.nodes.map((node, index) => {
    const shape = irNodeShape(ir.kind, node.type);
    const size = ir.kind === "mind-map"
      ? mindMapNodePresentation(node.label, mindMapNodeRole(ir.nodes, node.id), ir.structure)
      : ir.kind === "architecture"
        ? architectureNodeSizeForLabel(shape, node.label)
        : flowchartNodePresentation(shape, node.label);
    return {
      id: node.id,
      label: node.label,
      x: 72,
      y: 64 + index * 80,
      width: size.width,
      height: size.height,
      shape,
      ...(node.parentId ? { parentId: node.parentId } : {}),
      ...(node.resourceIcon ? { resourceIcon: node.resourceIcon } : {}),
    };
  });
  const edges = (ir.edges ?? []).map((edge, index) => ({
    id: `edge-${index + 1}`,
    source: edge.source,
    target: edge.target,
    ...(edge.label ? { label: edge.label } : {}),
    ...(edge.type ? { kind: edge.type } : {}),
    ...(edge.bidirectional !== undefined ? { bidirectional: edge.bidirectional } : {}),
  }));
  if (ir.kind === "mind-map") {
    const pairs = new Set(edges.map((edge) => `${edge.source}\0${edge.target}`));
    for (const node of nodes) {
      if (!node.parentId || pairs.has(`${node.parentId}\0${node.id}`)) continue;
      edges.push({ id: `edge-${edges.length + 1}`, source: node.parentId, target: node.id });
    }
  }
  const document: DiagramDocument = {
    schemaVersion: ir.kind === "architecture" ? ARCHITECTURE_DIAGRAM_SCHEMA_VERSION : DIAGRAM_SCHEMA_VERSION,
    kind: ir.kind,
    ...(ir.theme
      ? { theme: ir.theme }
      : ir.kind === "architecture"
        ? {}
        : { theme: DIAGRAM_DEFAULT_THEME }),
    ...(ir.kind === "mind-map" && ir.structure ? { structure: ir.structure } : {}),
    nodes,
    edges,
  };
  const layout = computeDiagramLayoutResult(document, {
    direction: ir.layout?.direction ?? (ir.kind === "flowchart" ? "top-to-bottom" : "left-to-right"),
  });
  for (const node of document.nodes) {
    const geometry = layout.nodes[node.id];
    if (geometry) Object.assign(node, geometry);
  }
  return document;
};
