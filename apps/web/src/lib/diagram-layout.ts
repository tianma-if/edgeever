import { graphlib, layout as runDagreLayout } from "@dagrejs/dagre";
import type { DiagramDocument } from "@edgeever/shared";

export type DiagramLayoutPositions = Record<string, { x: number; y: number }>;

export type DiagramLayoutOptions = {
  insertedNodeId?: string;
  insertAfterNodeId?: string;
};

const MIND_MAP_HORIZONTAL_GAP = 72;
const MIND_MAP_VERTICAL_GAP = 16;

const visualTextUnits = (label: string) => Array.from(label).reduce(
  (total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.55),
  0,
);

export const compactMindMapNodeSize = (label: string, isRoot: boolean) => ({
  width: Math.round(Math.min(isRoot ? 168 : 156, Math.max(isRoot ? 112 : 92, visualTextUnits(label) * 13 + 28))),
  height: isRoot ? 42 : 36,
});

export const compactFlowchartNodeSize = (shape: DiagramDocument["nodes"][number]["shape"]) => (
  shape === "decision"
    ? { width: 116, height: 72 }
    : shape === "terminator"
      ? { width: 116, height: 44 }
      : { width: 124, height: 44 }
);

export const compactArchitectureNodeSize = (
  shape: DiagramDocument["nodes"][number]["shape"],
  authored?: { width: number; height: number },
) => {
  if (shape === "boundary") return authored ?? { width: 560, height: 320 };
  if (shape === "database") return { width: 150, height: 72 };
  if (shape === "queue") return { width: 156, height: 60 };
  if (shape === "security") return { width: 148, height: 68 };
  return { width: 156, height: 64 };
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

  const subtreeHeights = new Map<string, number>();
  const measureSubtree = (nodeId: string, ancestors: Set<string>): number => {
    const cached = subtreeHeights.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodeById.get(nodeId);
    if (!node || ancestors.has(nodeId)) return 0;
    const nextAncestors = new Set(ancestors).add(nodeId);
    const childHeights = (childrenByParent.get(nodeId) ?? [])
      .map((childId) => measureSubtree(childId, nextAncestors))
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
  const placeChildren = (nodeId: string, subtreeTop: number, ancestors: Set<string>) => {
    const node = nodeById.get(nodeId);
    if (!node || ancestors.has(nodeId)) return;
    const nextAncestors = new Set(ancestors).add(nodeId);
    const childIds = (childrenByParent.get(nodeId) ?? [])
      .filter((childId) => !nextAncestors.has(childId));
    const childHeights = childIds.map((childId) => measureSubtree(childId, nextAncestors));
    const childrenHeight = childHeights.reduce((total, height) => total + height, 0)
      + Math.max(0, childHeights.length - 1) * MIND_MAP_VERTICAL_GAP;
    let cursor = subtreeTop + (measureSubtree(nodeId, ancestors) - childrenHeight) / 2;
    for (let index = 0; index < childIds.length; index += 1) {
      const childId = childIds[index];
      const child = nodeById.get(childId)!;
      const childSubtreeHeight = childHeights[index];
      positions[childId] = {
        x: positions[nodeId].x + node.width + MIND_MAP_HORIZONTAL_GAP,
        y: Math.round(cursor + (childSubtreeHeight - child.height) / 2),
      };
      placeChildren(childId, cursor, nextAncestors);
      cursor += childSubtreeHeight + MIND_MAP_VERTICAL_GAP;
    }
  };

  const roots = document.nodes
    .filter((node) => !node.parentId || !nodeById.has(node.parentId))
    .sort((left, right) => left.y - right.y || left.id.localeCompare(right.id));
  for (const root of roots) {
    const subtreeHeight = measureSubtree(root.id, new Set());
    const subtreeTop = root.y + root.height / 2 - subtreeHeight / 2;
    placeChildren(root.id, subtreeTop, new Set());
  }
  return positions;
};

export const computeDiagramLayout = (
  document: DiagramDocument,
  options: DiagramLayoutOptions = {},
): DiagramLayoutPositions => {
  if (document.kind === "mind-map") return computeMindMapLayout(document, options);
  const layoutGraph = new graphlib.Graph();
  layoutGraph.setGraph({
    rankdir: "LR",
    ranksep: 96,
    nodesep: 40,
    marginx: 32,
    marginy: 32,
  });
  layoutGraph.setDefaultEdgeLabel(() => ({}));

  const layoutNodes = document.kind === "architecture"
    ? document.nodes.filter((node) => node.shape !== "boundary")
    : document.nodes;
  const layoutNodeIds = new Set(layoutNodes.map((node) => node.id));
  for (const node of layoutNodes) {
    layoutGraph.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of document.edges) {
    if (layoutNodeIds.has(edge.source) && layoutNodeIds.has(edge.target)) {
      layoutGraph.setEdge(edge.source, edge.target);
    }
  }

  runDagreLayout(layoutGraph);
  return Object.fromEntries(document.nodes.flatMap((node) => {
    if (node.shape === "boundary") return [[node.id, { x: node.x, y: node.y }]];
    const position = layoutGraph.node(node.id) as { x: number; y: number } | undefined;
    if (!position) return [];
    return [[node.id, {
      x: Math.round(position.x - node.width / 2),
      y: Math.round(position.y - node.height / 2),
    }]];
  }));
};
