import { describe, expect, test } from "bun:test";
import { createDefaultDiagramDocument, parseDiagramDocument, serializeDiagramDocument } from "./diagram.ts";
import {
  createDefaultInfographicDocument,
  getInfographicSummary,
  InfographicAgentRequestSchema,
  infographicRequestsTimeline,
  parseInfographicDocument,
  serializeInfographicDocument,
} from "./infographic.ts";

describe("infographic note format", () => {
  test("round trips AntV syntax and keeps a readable fallback", () => {
    const document = {
      schemaVersion: 1,
      syntax: "infographic list-row-simple-horizontal-arrow\ndata\n  title 发布流程\n  lists\n    - label 准备\n    - label 发布",
    };
    const markdown = serializeInfographicDocument(document);
    expect(markdown).toContain("```infographic\n");
    expect(parseInfographicDocument(markdown)).toEqual(document);
    expect(getInfographicSummary(markdown)).toEqual({ infographic: true });
  });

  test("empty and invalid notes do not claim a valid document", () => {
    expect(parseInfographicDocument(serializeInfographicDocument(createDefaultInfographicDocument()))).toEqual(createDefaultInfographicDocument());
    expect(parseInfographicDocument("<!-- edgeever-infographic-v1:broken -->")).toBeNull();
    expect(getInfographicSummary("regular note")).toEqual({ infographic: false });
  });

  test("keeps AI revision requests with the infographic across reads", () => {
    const document = {
      schemaVersion: 1,
      syntax: "infographic sequence-steps-simple\ndata\n  title 发布流程",
      history: [
        { id: "one", prompt: "做一个发布流程图", createdAt: "2026-09-24T10:00:00.000Z", kind: "generated", resultTitle: "发布流程" },
        { id: "two", prompt: "把第二步改成审核", createdAt: "2026-09-24T10:01:00.000Z", kind: "refined", resultTitle: "发布流程", undoneAt: "2026-09-24T10:02:00.000Z" },
      ],
    };
    expect(parseInfographicDocument(serializeInfographicDocument(document))).toEqual(document);
    expect(parseInfographicDocument(serializeInfographicDocument({ ...document, history: [{ ...document.history[0], prompt: 42 }] }))).toBeNull();
  });

  test("keeps agent replies and clarification turns in the note", () => {
    const document = { schemaVersion: 1, syntax: "", history: [
      { id: "clarify", prompt: "换一家", response: "你想换成哪家公司？", kind: "clarified", resultTitle: "", createdAt: "2026-09-24T10:00:00.000Z" },
      { id: "edit", prompt: "阿里巴巴", response: "已替换对比对象。", decision: "对比关系未变，因此沿用原模板。", kind: "refined", resultTitle: "腾讯 vs 阿里巴巴", template: "compare-binary-horizontal-badge-card-vs", createdAt: "2026-09-24T10:01:00.000Z" },
    ] };
    expect(parseInfographicDocument(serializeInfographicDocument(document))).toEqual(document);
    const sessioned = {
      schemaVersion: 1,
      syntax: "infographic sequence-steps-simple\ndata\n  title 发布流程",
      activeSessionId: "session-new",
      history: [
        { id: "old", prompt: "做成发布流程", createdAt: "2026-10-01T00:00:00.000Z", kind: "generated", resultTitle: "发布流程" },
        { id: "new", prompt: "换成里程碑", createdAt: "2026-10-24T00:00:00.000Z", kind: "refined", resultTitle: "里程碑", sessionId: "session-new" },
      ],
    };
    expect(parseInfographicDocument(serializeInfographicDocument(sessioned))).toEqual(sessioned);
    expect(parseInfographicDocument(serializeInfographicDocument({ schemaVersion: 1, syntax: "", activeSessionId: "session empty" }))).toBeNull();
    expect(parseInfographicDocument(serializeInfographicDocument({ ...sessioned, history: [{ ...sessioned.history[1], sessionId: "bad id" }] }))).toBeNull();
    expect(InfographicAgentRequestSchema.safeParse({ prompt: "修改", currentContent: "", candidates: ["compare-binary-horizontal-badge-card-vs"], history: [{ prompt: "原请求", response: "原回复" }] }).success).toBe(true);
    expect(InfographicAgentRequestSchema.safeParse({ prompt: "修改", currentContent: "", candidates: [], history: [] }).success).toBe(false);
  });

  test("recognizes a request to replace a comparison with one company's timeline", () => {
    expect(infographicRequestsTimeline("给我换成字节的发展历程")).toBe(true);
    expect(infographicRequestsTimeline("按时间顺序展示字节的发展史")).toBe(true);
    expect(infographicRequestsTimeline("把字节跳动换成阿里巴巴")).toBe(false);
    expect(infographicRequestsTimeline("对比腾讯和字节的发展历程")).toBe(false);
    expect(infographicRequestsTimeline("把标题改成发展历程")).toBe(false);
  });

  test("infographic syntax and visual diagram IR keep separate envelopes", () => {
    const infographic = serializeInfographicDocument({ schemaVersion: 1, syntax: "infographic sequence-steps-simple\ndata\n  sequences\n    - label 开始" });
    const diagram = serializeDiagramDocument(createDefaultDiagramDocument("flowchart"));
    expect(parseInfographicDocument(infographic)?.syntax).toContain("sequence-steps-simple");
    expect(parseDiagramDocument(infographic)).toBeNull();
    expect(parseDiagramDocument(diagram)?.kind).toBe("flowchart");
    expect(parseInfographicDocument(diagram)).toBeNull();
  });
});
