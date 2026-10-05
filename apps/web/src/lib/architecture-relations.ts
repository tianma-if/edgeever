import { Graph } from "@antv/x6";

export const focusArchitectureRelations = (
  graph: Graph,
  host: HTMLElement | null,
  focus: { type: "node" | "edge"; id: string } | null,
) => {
  if (!host) return;
  host.dataset.relationsFocused = focus ? "true" : "false";
  const focusedEdges = new Set(graph.getEdges().filter((edge) => focus && (focus.type === "edge"
    ? edge.id === focus.id
    : edge.getSourceCellId() === focus.id || edge.getTargetCellId() === focus.id)).map((edge) => edge.id));
  const focusedNodes = new Set<string>();
  if (focus?.type === "node") focusedNodes.add(focus.id);
  for (const edge of graph.getEdges()) {
    if (focusedEdges.has(edge.id)) {
      focusedNodes.add(edge.getSourceCellId());
      focusedNodes.add(edge.getTargetCellId());
    }
    graph.findViewByCell(edge)?.container.classList.toggle("edgeever-relation-focused", focusedEdges.has(edge.id));
  }
  for (const node of graph.getNodes()) {
    const container = graph.findViewByCell(node)?.container;
    container?.classList.toggle("edgeever-relation-focused", focusedNodes.has(node.id));
    container?.classList.toggle("edgeever-relation-boundary", node.getData<{ shape?: string }>()?.shape === "boundary");
  }
};
