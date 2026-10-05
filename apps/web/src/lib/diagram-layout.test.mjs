import { describe, expect, test } from "bun:test";
import { createDefaultDiagramDocument } from "@edgeever/shared";
import {
  compileDiagramIr,
  compactArchitectureNodeSize,
  compactFlowchartNodeSize,
  compactMindMapNodeSize,
  computeDiagramLayout,
  computeDiagramLayoutResult,
  DIAGRAM_READABLE_MIN_SCALE,
  getDiagramLayoutViewport,
} from "./diagram-layout.ts";

describe("diagram auto layout", () => {
  test("places mind-map children to the right of their root", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const positions = computeDiagramLayout(document);
    expect(positions["topic-root"].x).toBeLessThan(positions["topic-1"].x);
    expect(new Set(document.nodes.map((node) => positions[node.id].y)).size).toBeGreaterThan(1);
  });

  test("lays out org, timeline, fishbone, brace, and hanging tree as distinct map families", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const org = computeDiagramLayout({ ...document, structure: "org" });
    expect(org["topic-1"].y).toBeGreaterThan(org["topic-root"].y + 40);
    expect(org["topic-2"].y).toBe(org["topic-1"].y);
    expect(org["topic-1-a"].y).toBeGreaterThan(org["topic-1"].y);

    const timeline = computeDiagramLayout({ ...document, structure: "timeline" });
    expect(timeline["topic-1"].x).toBeGreaterThan(timeline["topic-root"].x);
    expect(timeline["topic-2"].x).toBeGreaterThan(timeline["topic-1"].x);
    expect(timeline["topic-1"].y).toBeLessThan(timeline["topic-root"].y);
    expect(timeline["topic-2"].y).toBeGreaterThan(timeline["topic-root"].y);

    const fishbone = computeDiagramLayout({ ...document, structure: "fishbone" });
    expect(fishbone["topic-1"].x).toBeLessThan(fishbone["topic-root"].x);
    expect(fishbone["topic-1"].y).toBeLessThan(fishbone["topic-root"].y);
    expect(fishbone["topic-2"].y).toBeGreaterThan(fishbone["topic-root"].y);

    const brace = computeDiagramLayout({ ...document, structure: "brace" });
    expect(brace["topic-1"].x).toBeGreaterThan(brace["topic-root"].x);
    expect(brace["topic-1"].x).toBeGreaterThan(computeDiagramLayout(document)["topic-1"].x);

    const tree = computeDiagramLayout({ ...document, structure: "tree" });
    expect(tree["topic-1"].y).toBe(tree["topic-root"].y);
    expect(tree["topic-2"].y).toBeGreaterThan(tree["topic-1"].y);
    expect(tree["topic-1"].x).toBeGreaterThan(tree["topic-root"].x);
  });

  test("uses compact topic sizes while allowing longer labels to grow within a cap", () => {
    expect(compactMindMapNodeSize("分支主题", false)).toEqual({ width: 96, height: 36 });
    expect(compactMindMapNodeSize("核心主题", true)).toEqual({ width: 124, height: 46 });
    expect(compactMindMapNodeSize("A much longer topic label", false).width).toBeLessThanOrEqual(168);
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
        positions[orderedSiblings[index - 1]].y + previous.height + 20,
      );
    }
    expect(positions["topic-1-child"].x).toBeGreaterThan(positions["topic-1"].x);
    const selectedSubtreeBottom = Math.max(
      positions["topic-1"].y + 36,
      positions["topic-1-child"].y + 36,
      positions["topic-1-child-2"].y + 36,
    );
    expect(positions["topic-new"].y).toBeGreaterThanOrEqual(selectedSubtreeBottom + 20);
  });

  test("orders a connected flow from top to bottom and places detached nodes afterwards", () => {
    const document = createDefaultDiagramDocument("flowchart");
    document.nodes.push({ id: "detached", label: "Detached", x: 0, y: 0, width: 140, height: 52, shape: "process" });
    const positions = computeDiagramLayout(document);
    expect(positions["flow-start"].y).toBeLessThan(positions["flow-process"].y);
    expect(positions["flow-process"].y).toBeLessThan(positions["flow-end"].y);
    expect(Number.isFinite(positions.detached.x)).toBeTrue();
    expect(Number.isFinite(positions.detached.y)).toBeTrue();
    expect(positions.detached.y).toBeGreaterThan(positions["flow-end"].y + 44);
  });

  test("writes the plain theme on new mind maps and flowcharts", () => {
    expect(compileDiagramIr({ kind: "mind-map", nodes: [{ id: "root", label: "Root" }] }).theme).toBe("plain");
    expect(compileDiagramIr({
      kind: "flowchart",
      nodes: [{ id: "start", label: "Start", type: "start" }],
    }).theme).toBe("plain");
    expect(compileDiagramIr({
      kind: "architecture",
      nodes: [{ id: "api", label: "API", type: "service" }],
    }).theme).toBeUndefined();
    expect(compileDiagramIr({
      kind: "mind-map",
      theme: "brand",
      nodes: [{ id: "root", label: "Root" }],
    }).theme).toBe("brand");
  });

  test("aligns a sequential flowchart spine even when a loop returns from below", () => {
    const document = compileDiagramIr({
      kind: "flowchart",
      nodes: [
        { id: "a", type: "start", label: "开始" },
        { id: "b", type: "process", label: "步骤一" },
        { id: "c", type: "process", label: "Transformer 前向计算" },
        { id: "d", type: "end", label: "结束" },
        { id: "loop", type: "process", label: "回环" },
      ],
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "d" },
        { source: "d", target: "loop" },
        { source: "loop", target: "b" },
      ],
    });
    const centerX = (id) => {
      const node = document.nodes.find((item) => item.id === id);
      return node.x + node.width / 2;
    };
    expect(Math.abs(centerX("a") - centerX("b"))).toBeLessThanOrEqual(1);
    expect(Math.abs(centerX("b") - centerX("c"))).toBeLessThanOrEqual(1);
  });

  test("keeps an explicit horizontal flowchart direction", () => {
    const document = createDefaultDiagramDocument("flowchart");
    const positions = computeDiagramLayout(document, { direction: "left-to-right" });
    expect(positions["flow-start"].x).toBeLessThan(positions["flow-process"].x);
    expect(positions["flow-process"].x).toBeLessThan(positions["flow-end"].x);
  });

  test("uses compact flowchart nodes with aligned process and terminator centers", () => {
    expect(compactFlowchartNodeSize("process")).toEqual({ width: 176, height: 56 });
    expect(compactFlowchartNodeSize("terminator")).toEqual({ width: 140, height: 44 });
    expect(compactFlowchartNodeSize("decision")).toEqual({ width: 176, height: 80 });
  });

  test("balances a large mind map across both sides while keeping descendants with their branch", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.nodes.push(
      { id: "topic-4", parentId: "topic-root", label: "Branch 4", x: 256, y: 220, width: 92, height: 36, shape: "topic" },
      { id: "topic-5", parentId: "topic-root", label: "Branch 5", x: 256, y: 272, width: 92, height: 36, shape: "topic" },
      { id: "topic-6", parentId: "topic-root", label: "Branch 6", x: 256, y: 324, width: 92, height: 36, shape: "topic" },
      { id: "topic-6-child", parentId: "topic-6", label: "Nested", x: 420, y: 324, width: 92, height: 36, shape: "topic" },
    );
    const positions = computeDiagramLayout(document);
    const root = document.nodes.find((node) => node.id === "topic-root");
    const directChildren = document.nodes.filter((node) => node.parentId === root.id);
    expect(directChildren.some((node) => positions[node.id].x < root.x)).toBeTrue();
    expect(directChildren.some((node) => positions[node.id].x > root.x + root.width)).toBeTrue();
    const branchDirection = positions["topic-6"].x < root.x ? -1 : 1;
    expect(Math.sign(positions["topic-6-child"].x - positions["topic-6"].x)).toBe(branchDirection);
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

  test("reserves height for wrapped architecture labels while shortening compact nodes", () => {
    const document = compileDiagramIr({
      kind: "architecture",
      nodes: [
        { id: "short", type: "service", label: "API" },
        { id: "medium", type: "service", label: "商品与库存查询服务" },
        { id: "long", type: "service", label: "商品与库存查询服务及活动规则配置中心" },
      ],
      edges: [],
    });
    const heights = Object.fromEntries(document.nodes.map((node) => [node.id, node.height]));
    expect(heights.short).toBe(56);
    expect(heights.medium).toBe(60);
    expect(heights.long).toBeGreaterThan(heights.medium);
  });

  test("opens vertical lanes for groups with many cross-boundary relations", () => {
    const nodes = [
      { id: "business", type: "boundary", label: "业务层" },
      { id: "data", type: "boundary", label: "数据层" },
      ...Array.from({ length: 4 }, (_, index) => ({ id: `service-${index}`, type: "service", label: `服务 ${index}`, parentId: "business" })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `store-${index}`, type: "database", label: `存储 ${index}`, parentId: "data" })),
    ];
    const edges = Array.from({ length: 4 }, (_, service) => Array.from({ length: 4 }, (_, store) => ({
      source: `service-${service}`, target: `store-${store}`,
    }))).flat();
    const rowGap = (document) => {
      const services = document.nodes.filter((node) => node.parentId === "business").sort((a, b) => a.y - b.y);
      return Math.min(...services.slice(1).map((node, index) => node.y - services[index].y - services[index].height));
    };
    const sparse = compileDiagramIr({ kind: "architecture", nodes, edges: edges.slice(0, 1) });
    const dense = compileDiagramIr({ kind: "architecture", nodes, edges });
    expect(rowGap(dense)).toBeGreaterThan(rowGap(sparse) + 40);
  });

  test("turns a long ungrouped architecture pipeline downward on creation and auto layout", () => {
    const nodes = Array.from({ length: 17 }, (_, index) => ({
      id: `service-${index}`,
      label: `Service ${index}`,
      type: "service",
    }));
    const edges = nodes.slice(1).map((node, index) => ({ source: nodes[index].id, target: node.id }));
    const document = compileDiagramIr({ kind: "architecture", nodes, edges });
    const bounds = (geometry) => ({
      width: Math.max(...nodes.map((node) => geometry[node.id].x + geometry[node.id].width))
        - Math.min(...nodes.map((node) => geometry[node.id].x)),
      height: Math.max(...nodes.map((node) => geometry[node.id].y + geometry[node.id].height))
        - Math.min(...nodes.map((node) => geometry[node.id].y)),
    });
    const created = Object.fromEntries(document.nodes.map((node) => [node.id, node]));
    expect(bounds(created).width).toBeLessThanOrEqual(1480);
    expect(bounds(created).height).toBeGreaterThan(bounds(created).width);
    const relayout = computeDiagramLayoutResult(document);
    expect(bounds(relayout.nodes).width).toBeLessThanOrEqual(1480);
    expect(relayout.nodes["service-0"].y).toBeLessThan(relayout.nodes["service-16"].y);
  });

  test("keeps a long architecture pipeline inside one boundary within the width limit", () => {
    const nodes = [{ id: "system", label: "System", type: "boundary" }];
    const edges = [];
    for (let index = 0; index < 12; index += 1) {
      const id = `service-${index}`;
      nodes.push({ id, label: `Service ${index}`, type: "service", parentId: "system" });
      if (index > 0) edges.push({ source: `service-${index - 1}`, target: id });
    }
    const document = compileDiagramIr({ kind: "architecture", nodes, edges });
    const system = document.nodes.find((node) => node.id === "system");
    expect(system.width).toBeLessThanOrEqual(1480);
    expect(system.height).toBeGreaterThan(system.width);
    for (const node of document.nodes.filter((item) => item.parentId === "system")) {
      expect(node.x).toBeGreaterThan(system.x);
      expect(node.x + node.width).toBeLessThan(system.x + system.width);
    }
  });

  test("places unassigned architecture boundaries after the pipeline without covering nodes", () => {
    const services = Array.from({ length: 14 }, (_, index) => ({
      id: `service-${index}`,
      label: `Service ${index}`,
      type: "service",
    }));
    const boundaries = ["访问层", "业务服务层", "数据与基础设施层"].map((label, index) => ({
      id: `boundary-${index}`,
      label,
      type: "boundary",
    }));
    const edges = services.slice(1).map((node, index) => ({ source: services[index].id, target: node.id }));
    const document = compileDiagramIr({ kind: "architecture", nodes: [...services, ...boundaries], edges });
    const result = computeDiagramLayoutResult(document);
    const bottom = Math.max(...services.map((node) => result.nodes[node.id].y + result.nodes[node.id].height));
    for (const boundary of boundaries) expect(result.nodes[boundary.id].y).toBeGreaterThan(bottom);
    const width = Math.max(...Object.values(result.nodes).map((node) => node.x + node.width))
      - Math.min(...Object.values(result.nodes).map((node) => node.x));
    expect(width).toBeLessThanOrEqual(1480);
  });

  test("separates generated architecture boundaries and keeps their children inside", () => {
    const document = compileDiagramIr({
      kind: "architecture",
      nodes: [
        { id: "one", label: "One", type: "boundary" },
        { id: "one-api", label: "API one", type: "service", parentId: "one" },
        { id: "two", label: "Two", type: "boundary" },
        { id: "two-api", label: "API two", type: "service", parentId: "two" },
      ],
    });
    const one = document.nodes.find((node) => node.id === "one");
    const oneApi = document.nodes.find((node) => node.id === "one-api");
    const two = document.nodes.find((node) => node.id === "two");
    const twoApi = document.nodes.find((node) => node.id === "two-api");
    expect(one.y + one.height + 40).toBeLessThanOrEqual(two.y);
    for (const [boundary, child] of [[one, oneApi], [two, twoApi]]) {
      expect(child.x).toBeGreaterThan(boundary.x);
      expect(child.y).toBeGreaterThan(boundary.y);
      expect(child.x + child.width).toBeLessThan(boundary.x + boundary.width);
      expect(child.y + child.height).toBeLessThan(boundary.y + boundary.height);
    }
  });

  test("wraps a long architecture pipeline by boundary instead of shrinking it into one row", () => {
    const nodes = [];
    const edges = [];
    let previousId;
    for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
      const boundaryId = `stage-${groupIndex}`;
      nodes.push({ id: boundaryId, label: `Stage ${groupIndex}`, type: "boundary" });
      for (let nodeIndex = 0; nodeIndex < 3; nodeIndex += 1) {
        const id = `${boundaryId}-node-${nodeIndex}`;
        nodes.push({ id, label: id, type: "service", parentId: boundaryId });
        if (previousId) edges.push({ source: previousId, target: id });
        previousId = id;
      }
    }
    const document = compileDiagramIr({ kind: "architecture", nodes, edges });
    const boundaries = document.nodes.filter((node) => node.shape === "boundary");
    const contentWidth = Math.max(...boundaries.map((node) => node.x + node.width))
      - Math.min(...boundaries.map((node) => node.x));
    expect(contentWidth).toBeLessThanOrEqual(1480);
    expect(new Set(boundaries.map((node) => node.y)).size).toBeGreaterThan(1);
  });

  test("uses two rows of architecture groups when a single column wastes horizontal space", () => {
    const nodes = [];
    const edges = [];
    let previousId;
    for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
      const boundaryId = `group-${groupIndex}`;
      nodes.push({ id: boundaryId, label: boundaryId, type: "boundary" });
      for (let nodeIndex = 0; nodeIndex < 2; nodeIndex += 1) {
        const id = `${boundaryId}-node-${nodeIndex}`;
        nodes.push({ id, label: id, type: "service", parentId: boundaryId });
        if (previousId) edges.push({ source: previousId, target: id });
        previousId = id;
      }
    }
    const document = compileDiagramIr({ kind: "architecture", nodes, edges });
    const boundaries = document.nodes.filter((node) => node.shape === "boundary");
    const width = Math.max(...boundaries.map((node) => node.x + node.width))
      - Math.min(...boundaries.map((node) => node.x));
    expect(width).toBeGreaterThan(900);
    expect(width).toBeLessThanOrEqual(1480);
    expect(new Set(boundaries.map((node) => node.y)).size).toBe(2);
    const relayout = computeDiagramLayoutResult(document);
    const relayoutWidth = Math.max(...boundaries.map((node) => relayout.nodes[node.id].x + relayout.nodes[node.id].width))
      - Math.min(...boundaries.map((node) => relayout.nodes[node.id].x));
    expect(relayoutWidth).toBeGreaterThan(900);
    const vertical = computeDiagramLayoutResult(document, { direction: "top-to-bottom" });
    expect(vertical.nodes["group-1"].y).toBeGreaterThan(vertical.nodes["group-0"].y);
  });

  test("returns a complete strategy result for every diagram kind", () => {
    for (const kind of ["mind-map", "flowchart", "architecture"]) {
      const document = createDefaultDiagramDocument(kind);
      const result = computeDiagramLayoutResult(document);
      expect(Object.keys(result.nodes).sort()).toEqual(document.nodes.map((node) => node.id).sort());
      expect([...result.nodeOrder].sort()).toEqual(document.nodes.map((node) => node.id).sort());
      for (const geometry of Object.values(result.nodes)) {
        expect(Number.isFinite(geometry.x)).toBeTrue();
        expect(Number.isFinite(geometry.y)).toBeTrue();
        expect(geometry.width).toBeGreaterThan(0);
        expect(geometry.height).toBeGreaterThan(0);
      }
      expect(result.viewport).toEqual(getDiagramLayoutViewport(kind));
    }
  });

  test("finalizes architecture boundary geometry inside the shared layout engine", () => {
    const document = createDefaultDiagramDocument("architecture");
    const result = computeDiagramLayoutResult(document);
    const boundary = result.nodes.system;
    expect(result.nodeOrder.indexOf("system")).toBeLessThan(result.nodeOrder.indexOf("api"));
    for (const childId of ["api", "database"]) {
      const child = result.nodes[childId];
      expect(child.x).toBeGreaterThan(boundary.x);
      expect(child.y).toBeGreaterThan(boundary.y);
      expect(child.x + child.width).toBeLessThan(boundary.x + boundary.width);
      expect(child.y + child.height).toBeLessThan(boundary.y + boundary.height);
    }
    expect(result.viewport.minScale).toBe(DIAGRAM_READABLE_MIN_SCALE);
    expect(result.viewport.maxScale).toBe(1);
  });

  test("keeps ungrouped architecture terminals next to the groups they connect to", () => {
    const document = compileDiagramIr({
      kind: "architecture",
      nodes: [
        { id: "client", label: "Client", type: "client" },
        { id: "app", label: "App", type: "boundary" },
        { id: "web", label: "Web", type: "frontend", parentId: "app" },
        { id: "core", label: "Core", type: "boundary" },
        { id: "api", label: "API", type: "service", parentId: "core" },
        { id: "out", label: "CDN", type: "external" },
      ],
      edges: [
        { source: "client", target: "web" },
        { source: "web", target: "api" },
        { source: "api", target: "out" },
      ],
    });
    const byId = Object.fromEntries(document.nodes.map((node) => [node.id, node]));
    const center = (id) => ({ x: byId[id].x + byId[id].width / 2, y: byId[id].y + byId[id].height / 2 });
    const distance = (leftId, rightId) => {
      const left = center(leftId);
      const right = center(rightId);
      return Math.hypot(left.x - right.x, left.y - right.y);
    };
    const overlaps = (leftId, rightId, gap = 8) => {
      const left = byId[leftId];
      const right = byId[rightId];
      return left.x < right.x + right.width + gap && left.x + left.width + gap > right.x
        && left.y < right.y + right.height + gap && left.y + left.height + gap > right.y;
    };
    expect(byId.client.x).toBeLessThan(byId.web.x);
    expect(byId.web.x).toBeLessThan(byId.api.x);
    expect(byId.api.x).toBeLessThan(byId.out.x);
    expect(distance("client", "web")).toBeLessThan(420);
    expect(distance("out", "api")).toBeLessThan(420);
    expect(overlaps("client", "app")).toBeFalse();
    expect(overlaps("out", "core")).toBeFalse();
  });

  test("lays out architecture group internals without letting cross-group back edges stretch the group", () => {
    const document = compileDiagramIr({
      kind: "architecture",
      nodes: [
        { id: "ingress", label: "Ingress", type: "boundary" },
        { id: "a1", label: "Parse", type: "frontend", parentId: "ingress" },
        { id: "a2", label: "Guard", type: "security", parentId: "ingress" },
        { id: "runtime", label: "Runtime", type: "boundary" },
        { id: "b1", label: "Encode", type: "storage", parentId: "runtime" },
        { id: "b2", label: "Attend", type: "service", parentId: "runtime" },
        { id: "b3", label: "Project", type: "service", parentId: "runtime" },
        { id: "loop", label: "Cache", type: "database" },
      ],
      edges: [
        { source: "a1", target: "a2" },
        { source: "a2", target: "b1" },
        { source: "b1", target: "b2" },
        { source: "b2", target: "b3" },
        { source: "b3", target: "loop" },
        { source: "loop", target: "b1" },
      ],
    });
    const byId = Object.fromEntries(document.nodes.map((node) => [node.id, node]));
    const centerY = (id) => byId[id].y + byId[id].height / 2;
    expect(byId.a1.x).toBeLessThan(byId.a2.x);
    expect(Math.abs(centerY("a1") - centerY("a2"))).toBeLessThanOrEqual(24);
    expect(byId.b1.x).toBeLessThan(byId.b2.x);
    expect(byId.b2.x).toBeLessThan(byId.b3.x);
    expect(Math.abs(centerY("b1") - centerY("b3"))).toBeLessThanOrEqual(24);
    expect(byId.runtime.height).toBeLessThan(280);
    const loopCenter = { x: byId.loop.x + byId.loop.width / 2, y: byId.loop.y + byId.loop.height / 2 };
    const b3Center = { x: byId.b3.x + byId.b3.width / 2, y: byId.b3.y + byId.b3.height / 2 };
    expect(Math.hypot(loopCenter.x - b3Center.x, loopCenter.y - b3Center.y)).toBeLessThan(420);
  });

  test("caps auto-layout zoom at 100% and refuses to shrink below reading size", () => {
    expect(getDiagramLayoutViewport("flowchart")).toEqual({
      anchor: "center",
      maxScale: 1,
      minScale: DIAGRAM_READABLE_MIN_SCALE,
    });
    expect(getDiagramLayoutViewport("mind-map")).toEqual({
      anchor: "root",
      maxScale: 1,
      minScale: DIAGRAM_READABLE_MIN_SCALE,
    });
    expect(getDiagramLayoutViewport("architecture")).toEqual({
      anchor: "leftmost",
      maxScale: 1,
      minScale: DIAGRAM_READABLE_MIN_SCALE,
    });
  });
});
