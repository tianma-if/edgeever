import { describe, expect, test } from "bun:test";
import { createDefaultDiagramDocument } from "@edgeever/shared";
import { compactArchitectureNodeSize, compactFlowchartNodeSize, compactMindMapNodeSize, computeDiagramLayout } from "./diagram-layout.ts";

describe("diagram auto layout", () => {
  test("places mind-map children to the right of their root", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const positions = computeDiagramLayout(document);
    expect(positions["topic-root"].x).toBeLessThan(positions["topic-1"].x);
    expect(new Set(document.nodes.map((node) => positions[node.id].y)).size).toBeGreaterThan(1);
  });

  test("uses compact topic sizes while allowing longer labels to grow within a cap", () => {
    expect(compactMindMapNodeSize("分支主题", false)).toEqual({ width: 92, height: 36 });
    expect(compactMindMapNodeSize("核心主题", true)).toEqual({ width: 112, height: 42 });
    expect(compactMindMapNodeSize("A much longer topic label", false).width).toBeLessThanOrEqual(156);
  });

  test("inserts a sibling after the selected branch and pushes following subtrees down", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.nodes.push(
      { id: "topic-1-child", parentId: "topic-1", label: "Child 1", x: 400, y: 60, width: 92, height: 36, shape: "topic" },
      { id: "topic-1-child-2", parentId: "topic-1", label: "Child 2", x: 400, y: 112, width: 92, height: 36, shape: "topic" },
      { id: "topic-new", parentId: "topic-root", label: "New", x: 256, y: 89, width: 92, height: 36, shape: "topic" },
    );
    document.edges.push(
      { id: "branch-child", source: "topic-1", target: "topic-1-child" },
      { id: "branch-child-2", source: "topic-1", target: "topic-1-child-2" },
      { id: "branch-new", source: "topic-root", target: "topic-new" },
    );

    const positions = computeDiagramLayout(document, {
      insertedNodeId: "topic-new",
      insertAfterNodeId: "topic-1",
    });
    const orderedSiblings = ["topic-1", "topic-new", "topic-2", "topic-3"];
    for (let index = 1; index < orderedSiblings.length; index += 1) {
      const previous = document.nodes.find((node) => node.id === orderedSiblings[index - 1]);
      expect(positions[orderedSiblings[index]].y).toBeGreaterThanOrEqual(
        positions[orderedSiblings[index - 1]].y + previous.height + 16,
      );
    }
    expect(positions["topic-1-child"].x).toBeGreaterThan(positions["topic-1"].x);
    const selectedSubtreeBottom = Math.max(
      positions["topic-1"].y + 36,
      positions["topic-1-child"].y + 36,
      positions["topic-1-child-2"].y + 36,
    );
    expect(positions["topic-new"].y).toBeGreaterThanOrEqual(selectedSubtreeBottom + 16);
  });

  test("orders a connected flow from left to right and keeps detached nodes finite", () => {
    const document = createDefaultDiagramDocument("flowchart");
    document.nodes.push({ id: "detached", label: "Detached", x: 0, y: 0, width: 140, height: 52, shape: "process" });
    const positions = computeDiagramLayout(document);
    expect(positions["flow-start"].x).toBeLessThan(positions["flow-process"].x);
    expect(positions["flow-process"].x).toBeLessThan(positions["flow-end"].x);
    expect(Number.isFinite(positions.detached.x)).toBeTrue();
    expect(Number.isFinite(positions.detached.y)).toBeTrue();
  });

  test("uses compact flowchart nodes with aligned process and terminator centers", () => {
    expect(compactFlowchartNodeSize("process")).toEqual({ width: 124, height: 44 });
    expect(compactFlowchartNodeSize("terminator")).toEqual({ width: 116, height: 44 });
    expect(compactFlowchartNodeSize("decision")).toEqual({ width: 116, height: 72 });
  });

  test("lays out architecture components while preserving authored boundary geometry", () => {
    const document = createDefaultDiagramDocument("architecture");
    const positions = computeDiagramLayout(document);
    expect(positions.client.x).toBeLessThan(positions.api.x);
    expect(positions.api.x).toBeLessThan(positions.database.x);
    expect(positions.system).toEqual({ x: 220, y: 64 });
    expect(compactArchitectureNodeSize("database")).toEqual({ width: 150, height: 72 });
    expect(compactArchitectureNodeSize("boundary", { width: 640, height: 360 })).toEqual({ width: 640, height: 360 });
  });
});
