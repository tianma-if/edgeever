import {
  ARCHITECTURE_RESOURCE_ICONS,
  docToText,
  markdownToDoc,
  parseDiagramDocument,
  serializeDiagramDocument,
  stripDiagramDocumentMarker,
  type DiagramDocument,
  type DiagramNodeShape,
  type MemoDetail,
} from "@edgeever/shared";
import type { DiagramIr, DiagramIrNodeType } from "@edgeever/shared/diagram-layout";
import { AppError } from "./app-error";
import { createId } from "./entity-utils";
import { getRequiredString } from "./mcp-json-rpc";

const DIAGRAM_IR_NODE_TYPES = new Set<DiagramIrNodeType>([
  "topic", "process", "decision", "start", "end", "terminator", "client", "frontend", "service", "database", "storage",
  "queue", "security", "external", "boundary",
]);
const DIAGRAM_EDGE_KINDS = new Set(["dependency", "request", "async", "data"]);
const DIAGRAM_MEMO_KEYS = new Set(["notebookId", "title", "kind", "theme", "structure", "layout", "tags", "nodes", "edges"]);
const DIAGRAM_NODE_KEYS = new Set(["id", "label", "type", "parentId", "resourceIcon"]);
const DIAGRAM_EDGE_KEYS = new Set(["source", "target", "label", "type", "bidirectional"]);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertAllowedKeys = (value: Record<string, unknown>, allowed: Set<string>, path: string) => {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new AppError("invalid_params", `${path}.${unexpected} is not supported`, 400);
};

const parseDiagramNode = (value: unknown, index: number) => {
  const path = `nodes.${index}`;
  if (!isPlainRecord(value)) throw new AppError("invalid_params", `${path} must be an object`, 400);
  assertAllowedKeys(value, DIAGRAM_NODE_KEYS, path);
  const id = getRequiredString(value.id, `${path}.id`);
  if (id.length > 100) throw new AppError("invalid_params", `${path}.id must be at most 100 characters`, 400);
  if (typeof value.label !== "string" || value.label.length > 500) {
    throw new AppError("invalid_params", `${path}.label must be a string with at most 500 characters`, 400);
  }
  if (value.type !== undefined && (
    typeof value.type !== "string" || !DIAGRAM_IR_NODE_TYPES.has(value.type as DiagramIrNodeType)
  )) {
    throw new AppError("invalid_params", `${path}.type is not supported`, 400);
  }
  if (value.parentId !== undefined && (typeof value.parentId !== "string" || !value.parentId.trim() || value.parentId.length > 100)) {
    throw new AppError("invalid_params", `${path}.parentId must be a non-empty string with at most 100 characters`, 400);
  }
  if (value.resourceIcon !== undefined && (
    typeof value.resourceIcon !== "string"
    || !ARCHITECTURE_RESOURCE_ICONS.includes(value.resourceIcon as typeof ARCHITECTURE_RESOURCE_ICONS[number])
  )) {
    throw new AppError("invalid_params", `${path}.resourceIcon is not supported`, 400);
  }
  return { ...value, id } as DiagramIr["nodes"][number];
};

const parseDiagramEdge = (value: unknown, index: number) => {
  const path = `edges.${index}`;
  if (!isPlainRecord(value)) throw new AppError("invalid_params", `${path} must be an object`, 400);
  assertAllowedKeys(value, DIAGRAM_EDGE_KEYS, path);
  const source = getRequiredString(value.source, `${path}.source`);
  const target = getRequiredString(value.target, `${path}.target`);
  if ([source, target].some((item) => item.length > 100)) {
    throw new AppError("invalid_params", `${path} node IDs must be at most 100 characters`, 400);
  }
  if (value.label !== undefined && (typeof value.label !== "string" || value.label.length > 500)) {
    throw new AppError("invalid_params", `${path}.label must be a string with at most 500 characters`, 400);
  }
  if (value.type !== undefined && (typeof value.type !== "string" || !DIAGRAM_EDGE_KINDS.has(value.type))) {
    throw new AppError("invalid_params", `${path}.type is not supported`, 400);
  }
  if (value.bidirectional !== undefined && typeof value.bidirectional !== "boolean") {
    throw new AppError("invalid_params", `${path}.bidirectional must be a boolean`, 400);
  }
  return { ...value, source, target } as NonNullable<DiagramIr["edges"]>[number];
};

export const parseDiagramMemoIr = (args: Record<string, unknown>): DiagramIr => {
  assertAllowedKeys(args, DIAGRAM_MEMO_KEYS, "arguments");
  const kind = getRequiredString(args.kind, "kind");
  if (!(["mind-map", "flowchart", "architecture"] as const).includes(kind as DiagramIr["kind"])) {
    throw new AppError("invalid_params", "kind must be mind-map, flowchart, or architecture", 400);
  }
  if (!Array.isArray(args.nodes) || args.nodes.length < 1 || args.nodes.length > 200) {
    throw new AppError("invalid_params", "nodes must include between 1 and 200 items", 400);
  }
  if (args.edges !== undefined && (!Array.isArray(args.edges) || args.edges.length > 400)) {
    throw new AppError("invalid_params", "edges must be an array with at most 400 items", 400);
  }
  if (args.theme !== undefined && !["plain", "brand", "sun", "wa", "island", "rose", "mint", "cosmos", "tea", "naive", "macaron", "ocean", "ink", "classic", "paper"].includes(String(args.theme))) {
    throw new AppError("invalid_params", "theme is not a supported diagram color scheme", 400);
  }
  if (args.structure !== undefined && !["map", "line", "capsule", "box", "circle", "ellipse", "hexagon", "logic", "tree", "brace", "org", "timeline", "fishbone"].includes(String(args.structure))) {
    throw new AppError("invalid_params", "structure is not a supported mind-map shape", 400);
  }
  if (args.title !== undefined && (typeof args.title !== "string" || args.title.length > 160)) {
    throw new AppError("invalid_params", "title must be a string with at most 160 characters", 400);
  }
  if (args.tags !== undefined && (
    !Array.isArray(args.tags) || args.tags.length > 100 || args.tags.some((tag) => typeof tag !== "string")
  )) {
    throw new AppError("invalid_params", "tags must be an array of at most 100 strings", 400);
  }
  if (args.layout !== undefined && (
    !isPlainRecord(args.layout)
    || Object.keys(args.layout).some((key) => key !== "direction")
    || (args.layout.direction !== undefined && !["left-to-right", "top-to-bottom"].includes(String(args.layout.direction)))
  )) {
    throw new AppError("invalid_params", "layout may only specify direction as left-to-right or top-to-bottom", 400);
  }

  const ir: DiagramIr = {
    kind: kind as DiagramIr["kind"],
    ...(args.theme === undefined ? {} : { theme: args.theme as DiagramIr["theme"] }),
    ...(args.structure === undefined ? {} : { structure: args.structure as DiagramIr["structure"] }),
    ...(args.layout === undefined ? {} : { layout: args.layout as DiagramIr["layout"] }),
    nodes: args.nodes.map(parseDiagramNode),
    edges: (args.edges as unknown[] | undefined)?.map(parseDiagramEdge),
  };
  const nodeIds = new Set(ir.nodes.map((node) => node.id));
  if (nodeIds.size !== ir.nodes.length) throw new AppError("invalid_params", "node IDs must be unique", 400);
  for (const node of ir.nodes) {
    const allowedTypes = ir.kind === "mind-map"
      ? new Set([undefined, "topic"])
      : ir.kind === "flowchart"
        ? new Set([undefined, "process", "decision", "start", "end", "terminator"])
        : new Set([undefined, "client", "frontend", "service", "database", "storage", "queue", "security", "external", "boundary"]);
    if (!allowedTypes.has(node.type)) {
      throw new AppError("invalid_params", `${node.type} is not a valid node type for ${ir.kind}`, 400);
    }
    if (ir.kind === "flowchart" && node.parentId) {
      throw new AppError("invalid_params", "flowchart nodes cannot use parentId", 400);
    }
    if (ir.kind !== "architecture" && node.resourceIcon) {
      throw new AppError("invalid_params", "resourceIcon is only available for architecture nodes", 400);
    }
    if (node.parentId && !nodeIds.has(node.parentId)) {
      throw new AppError("invalid_params", `${node.id}.parentId must reference an existing node`, 400);
    }
    if (ir.kind === "architecture" && node.parentId && ir.nodes.find((candidate) => candidate.id === node.parentId)?.type !== "boundary") {
      throw new AppError("invalid_params", `${node.id}.parentId must reference an architecture boundary`, 400);
    }
  }
  for (const edge of ir.edges ?? []) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new AppError("invalid_params", "every edge endpoint must reference an existing node", 400);
    }
    if (ir.kind === "architecture" && ir.nodes.some((node) => (node.id === edge.source || node.id === edge.target) && node.type === "boundary")) {
      throw new AppError("invalid_params", "architecture boundaries cannot be edge endpoints", 400);
    }
  }
  const parentByNodeId = new Map(ir.nodes.flatMap((node) => node.parentId ? [[node.id, node.parentId]] : []));
  for (const node of ir.nodes) {
    const ancestors = new Set<string>();
    let currentId: string | undefined = node.id;
    while (currentId) {
      if (ancestors.has(currentId)) {
        throw new AppError("invalid_params", "diagram parent relationships must not contain cycles", 400);
      }
      ancestors.add(currentId);
      currentId = parentByNodeId.get(currentId);
    }
  }
  return ir;
};

const diagramNodeType = (shape: DiagramNodeShape): DiagramIrNodeType => shape;

export const diagramSemanticGraph = (document: DiagramDocument, includeLayout = false) => ({
  kind: document.kind,
  ...(document.theme ? { theme: document.theme } : {}),
  ...(document.structure ? { structure: document.structure } : {}),
  nodes: document.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: diagramNodeType(node.shape),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.resourceIcon ? { resourceIcon: node.resourceIcon } : {}),
    ...(includeLayout ? { layout: { x: node.x, y: node.y, width: node.width, height: node.height } } : {}),
  })),
  edges: document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.label ? { label: edge.label } : {}),
    ...(edge.kind ? { type: edge.kind } : {}),
    ...(edge.bidirectional !== undefined ? { bidirectional: edge.bidirectional } : {}),
  })),
});

export const memoWithoutDiagramPayload = (memo: MemoDetail) => {
  const contentMarkdown = stripDiagramDocumentMarker(memo.contentMarkdown);
  const contentJson = markdownToDoc(contentMarkdown);
  return { ...memo, contentMarkdown, contentJson, contentText: docToText(contentJson) };
};

type MutableDiagramEdge = ReturnType<typeof diagramSemanticGraph>["edges"][number];

export const applyDiagramOperations = async (
  args: Record<string, unknown>,
  current: DiagramDocument,
) => {
  assertAllowedKeys(args, new Set(["memoId", "expectedRevision", "operations", "dryRun", "reflow"]), "arguments");
  if (!Array.isArray(args.operations) || args.operations.length < 1 || args.operations.length > 100) {
    throw new AppError("invalid_params", "operations must include between 1 and 100 items", 400);
  }
  if (args.reflow !== undefined && args.reflow !== "preserve" && args.reflow !== "all") {
    throw new AppError("invalid_params", "reflow must be preserve or all", 400);
  }

  let nodes: DiagramIr["nodes"] = current.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: diagramNodeType(node.shape),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.resourceIcon ? { resourceIcon: node.resourceIcon } : {}),
  }));
  let edges: MutableDiagramEdge[] = diagramSemanticGraph(current).edges;
  const resizedNodeIds = new Set<string>();
  const repositionedNodeIds = new Set<string>();
  const affectedBoundaryIds = new Set<string>();
  const counts = { addedNodes: 0, updatedNodes: 0, removedNodes: 0, addedEdges: 0, updatedEdges: 0, removedEdges: 0 };

  const requireOperation = (value: unknown, index: number) => {
    if (!isPlainRecord(value) || typeof value.op !== "string") {
      throw new AppError("invalid_params", `operations.${index} must be an object with an op`, 400);
    }
    return value;
  };
  const findNodeIndex = (nodeId: string) => {
    const index = nodes.findIndex((node) => node.id === nodeId);
    if (index < 0) throw new AppError("invalid_params", `diagram node ${nodeId} does not exist`, 400);
    return index;
  };
  const findEdgeIndex = (edgeId: string) => {
    const index = edges.findIndex((edge) => edge.id === edgeId);
    if (index < 0) throw new AppError("invalid_params", `diagram edge ${edgeId} does not exist`, 400);
    return index;
  };

  for (let operationIndex = 0; operationIndex < args.operations.length; operationIndex += 1) {
    const operation = requireOperation(args.operations[operationIndex], operationIndex);
    const path = `operations.${operationIndex}`;
    if (operation.op === "add_node") {
      assertAllowedKeys(operation, new Set(["op", "node"]), path);
      const node = parseDiagramNode(operation.node, operationIndex);
      if (nodes.some((candidate) => candidate.id === node.id)) {
        throw new AppError("invalid_params", `diagram node ${node.id} already exists`, 400);
      }
      nodes.push(node);
      if (node.parentId) affectedBoundaryIds.add(node.parentId);
      counts.addedNodes += 1;
      continue;
    }
    if (operation.op === "update_node") {
      assertAllowedKeys(operation, new Set(["op", "nodeId", "changes"]), path);
      const nodeId = getRequiredString(operation.nodeId, `${path}.nodeId`);
      if (!isPlainRecord(operation.changes) || Object.keys(operation.changes).length === 0) {
        throw new AppError("invalid_params", `${path}.changes must be a non-empty object`, 400);
      }
      assertAllowedKeys(operation.changes, new Set(["label", "type", "parentId", "resourceIcon"]), `${path}.changes`);
      const index = findNodeIndex(nodeId);
      const previous = nodes[index];
      const candidate: Record<string, unknown> = { ...previous, ...operation.changes, id: nodeId };
      if (operation.changes.parentId === null || operation.changes.parentId === "") delete candidate.parentId;
      if (operation.changes.resourceIcon === null || operation.changes.resourceIcon === "") delete candidate.resourceIcon;
      const next = parseDiagramNode(candidate, operationIndex);
      nodes[index] = next;
      if (operation.changes.label !== undefined || operation.changes.type !== undefined) resizedNodeIds.add(nodeId);
      if (operation.changes.parentId !== undefined && previous.parentId !== next.parentId) {
        repositionedNodeIds.add(nodeId);
        if (previous.parentId) affectedBoundaryIds.add(previous.parentId);
        if (next.parentId) affectedBoundaryIds.add(next.parentId);
      }
      counts.updatedNodes += 1;
      continue;
    }
    if (operation.op === "remove_node") {
      assertAllowedKeys(operation, new Set(["op", "nodeId", "cascade"]), path);
      const nodeId = getRequiredString(operation.nodeId, `${path}.nodeId`);
      findNodeIndex(nodeId);
      const removalIds = new Set([nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const node of nodes) {
          if (node.parentId && removalIds.has(node.parentId) && !removalIds.has(node.id)) {
            if (operation.cascade !== true) {
              throw new AppError("invalid_params", `${nodeId} contains child nodes; set cascade to true to remove them`, 400);
            }
            removalIds.add(node.id);
            changed = true;
          }
        }
      }
      for (const node of nodes) if (removalIds.has(node.id) && node.parentId) affectedBoundaryIds.add(node.parentId);
      const priorEdgeCount = edges.length;
      nodes = nodes.filter((node) => !removalIds.has(node.id));
      edges = edges.filter((edge) => !removalIds.has(edge.source) && !removalIds.has(edge.target));
      counts.removedNodes += removalIds.size;
      counts.removedEdges += priorEdgeCount - edges.length;
      continue;
    }
    if (operation.op === "add_edge") {
      assertAllowedKeys(operation, new Set(["op", "edge"]), path);
      if (!isPlainRecord(operation.edge)) throw new AppError("invalid_params", `${path}.edge must be an object`, 400);
      assertAllowedKeys(operation.edge, new Set([...DIAGRAM_EDGE_KEYS, "id"]), `${path}.edge`);
      const { id: requestedId, ...edgeInput } = operation.edge;
      const parsed = parseDiagramEdge(edgeInput, operationIndex);
      const id = requestedId === undefined ? createId("edge") : getRequiredString(requestedId, `${path}.edge.id`);
      if (id.length > 100 || edges.some((edge) => edge.id === id)) {
        throw new AppError("invalid_params", `diagram edge ID ${id} is invalid or already exists`, 400);
      }
      edges.push({ id, ...parsed });
      counts.addedEdges += 1;
      continue;
    }
    if (operation.op === "update_edge") {
      assertAllowedKeys(operation, new Set(["op", "edgeId", "changes"]), path);
      const edgeId = getRequiredString(operation.edgeId, `${path}.edgeId`);
      if (!isPlainRecord(operation.changes) || Object.keys(operation.changes).length === 0) {
        throw new AppError("invalid_params", `${path}.changes must be a non-empty object`, 400);
      }
      assertAllowedKeys(operation.changes, DIAGRAM_EDGE_KEYS, `${path}.changes`);
      const index = findEdgeIndex(edgeId);
      const candidate: Record<string, unknown> = { ...edges[index], ...operation.changes };
      delete candidate.id;
      if (operation.changes.label === null || operation.changes.label === "") delete candidate.label;
      if (operation.changes.type === null || operation.changes.type === "") delete candidate.type;
      if (operation.changes.bidirectional === null) delete candidate.bidirectional;
      edges[index] = { id: edgeId, ...parseDiagramEdge(candidate, operationIndex) };
      counts.updatedEdges += 1;
      continue;
    }
    if (operation.op === "remove_edge") {
      assertAllowedKeys(operation, new Set(["op", "edgeId"]), path);
      const edgeId = getRequiredString(operation.edgeId, `${path}.edgeId`);
      edges.splice(findEdgeIndex(edgeId), 1);
      counts.removedEdges += 1;
      continue;
    }
    throw new AppError("invalid_params", `${path}.op is not supported`, 400);
  }

  if (nodes.length < 1) throw new AppError("invalid_params", "a diagram must contain at least one node", 400);
  if (current.kind === "mind-map") {
    const priorEdgeCount = edges.length;
    edges = edges.filter((edge) => !repositionedNodeIds.has(edge.target)
      || nodes.find((node) => node.id === edge.target)?.parentId === edge.source);
    counts.removedEdges += priorEdgeCount - edges.length;
    for (const node of nodes) {
      if (!node.parentId || edges.some((edge) => edge.source === node.parentId && edge.target === node.id)) continue;
      edges.push({ id: createId("edge"), source: node.parentId, target: node.id });
      counts.addedEdges += 1;
    }
  }
  const validatedIr = parseDiagramMemoIr({
    kind: current.kind,
    ...(current.theme ? { theme: current.theme } : {}),
    ...(current.structure ? { structure: current.structure } : {}),
    nodes,
    edges: edges.map(({ id: _id, ...edge }) => edge),
  });
  const { compileDiagramIr } = await import("@edgeever/shared/diagram-layout");
  const next = compileDiagramIr(validatedIr);
  next.edges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.label ? { label: edge.label } : {}),
    ...(edge.type ? { kind: edge.type } : {}),
    ...(edge.bidirectional !== undefined ? { bidirectional: edge.bidirectional } : {}),
  }));

  if (args.reflow !== "all") {
    const currentById = new Map(current.nodes.map((node) => [node.id, node]));
    for (const node of next.nodes) {
      const previous = currentById.get(node.id);
      if (!previous) continue;
      const boundaryNeedsLayout = node.shape === "boundary" && affectedBoundaryIds.has(node.id);
      if (repositionedNodeIds.has(node.id) || boundaryNeedsLayout) continue;
      node.x = previous.x;
      node.y = previous.y;
      if (!resizedNodeIds.has(node.id)) {
        node.width = previous.width;
        node.height = previous.height;
      }
    }
    if (current.kind === "architecture" && affectedBoundaryIds.size > 0) {
      const nodeById = new Map(next.nodes.map((node) => [node.id, node]));
      for (const boundaryId of [...affectedBoundaryIds]) {
        let parentId = nodeById.get(boundaryId)?.parentId;
        while (parentId) {
          affectedBoundaryIds.add(parentId);
          parentId = nodeById.get(parentId)?.parentId;
        }
      }
      const depth = (nodeId: string) => {
        let result = 0;
        let node = nodeById.get(nodeId);
        while (node?.parentId) {
          result += 1;
          node = nodeById.get(node.parentId);
        }
        return result;
      };
      for (const boundaryId of [...affectedBoundaryIds].sort((left, right) => depth(right) - depth(left))) {
        const boundary = nodeById.get(boundaryId);
        const children = next.nodes.filter((node) => node.parentId === boundaryId);
        if (!boundary || boundary.shape !== "boundary" || children.length === 0) continue;
        const left = Math.min(...children.map((node) => node.x)) - 36;
        const top = Math.min(...children.map((node) => node.y)) - 56;
        const right = Math.max(...children.map((node) => node.x + node.width)) + 36;
        const bottom = Math.max(...children.map((node) => node.y + node.height)) + 36;
        boundary.x = left;
        boundary.y = top;
        boundary.width = Math.max(260, right - left);
        boundary.height = Math.max(180, bottom - top);
      }
    }
  }

  const contentMarkdown = serializeDiagramDocument(next);
  if (!parseDiagramDocument(contentMarkdown)) {
    throw new AppError("invalid_params", "The diagram operations produced an invalid document", 400);
  }
  return { document: next, contentMarkdown, changes: counts };
};
