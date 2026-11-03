import { expect, test } from "bun:test";
import {
  buildInfographicLocalAgentContext,
  infographicLocalAgentErrorKey,
  collectInfographicLocalAgentText,
  parseInfographicLocalReply,
  visibleInfographicAgentReply,
} from "./infographic-local-agent.ts";

const chartReply = `已换成小米集团的季度营收。
\`\`\`json
{"type":"proposal","template":"chart-column-simple","explanation":"换成小米公开营收。","data":{"title":"小米集团2024年季度营收","values":[{"label":"Q1 2024","value":755},{"label":"Q2 2024","value":889}]}}
\`\`\``;

test("a local infographic reply keeps the sentence and one validated proposal", () => {
  expect(visibleInfographicAgentReply(chartReply)).toBe("已换成小米集团的季度营收。");
  const reply = parseInfographicLocalReply(chartReply, ["chart-column-simple"], "给我换成小米的。");
  expect(reply.rejected).toBe(false);
  expect(reply.proposal?.template).toBe("chart-column-simple");
  expect(reply.proposal?.data.values).toEqual([
    { label: "Q1 2024", value: 755 },
    { label: "Q2 2024", value: 889 },
  ]);
  expect(reply.visibleText).toBe("已换成小米集团的季度营收。");
});

test("a clarification stays text and does not change the infographic", () => {
  const raw = `需要先确认年份。\n\`\`\`json\n{"type":"question","question":"去年是指2024年吗？"}\n\`\`\``;
  const reply = parseInfographicLocalReply(raw, ["chart-column-simple"], "去年四个季度的营收");
  expect(reply.proposal).toBeNull();
  expect(reply.rejected).toBe(false);
  expect(reply.question).toBe("去年是指2024年吗？");
  expect(parseInfographicLocalReply("我先说明口径，暂不改图。", ["chart-column-simple"], "换个数").question).toBe("我先说明口径，暂不改图。");
});

test("a history request rejects a chart proposal", () => {
  const reply = parseInfographicLocalReply(chartReply, ["chart-column-simple", "sequence-timeline-simple"], "展示字节跳动发展历程");
  expect(reply.proposal).toBeNull();
  expect(reply.rejected).toBe(true);
});

test("the local prompt forbids note writes and lists only allowed templates", () => {
  const context = buildInfographicLocalAgentContext({
    prompt: "换成小米",
    currentTemplate: "chart-column-simple",
    currentContent: "{\"template\":\"chart-column-simple\"}",
    candidates: ["chart-column-simple"],
    history: [{ prompt: "做营收图", response: "已生成" }],
  });
  expect(context).toContain("Do not edit files");
  expect(context).toContain("Allowed templates: chart-column-simple");
  expect(context).toContain("User: 做营收图");
});

test("local infographic text follows one ACP request and can be cancelled", async () => {
  let emit = () => undefined;
  let cancelId = "";
  const controller = new AbortController();
  const text = await collectInfographicLocalAgentText({
    request: { adapterId: "codex", prompt: "换成小米", noteAccess: false },
    signal: controller.signal,
    deps: {
      prompt: async () => {
        emit({ requestId: "other", type: "text-delta", text: "ignore" });
        emit({ requestId: "req-1", type: "text-delta", text: "已更新" });
        emit({ requestId: "req-1", type: "done" });
        return { requestId: "req-1" };
      },
      subscribe: (callback) => {
        emit = callback;
        return () => undefined;
      },
      cancel: async (requestId) => { cancelId = requestId; },
    },
  });
  expect(text).toBe("已更新");

  const aborted = new AbortController();
  await expect(collectInfographicLocalAgentText({
    request: { adapterId: "codex", prompt: "停止", noteAccess: false },
    signal: aborted.signal,
    deps: {
      prompt: async () => {
        aborted.abort();
        return { requestId: "req-2" };
      },
      subscribe: () => () => undefined,
      cancel: async (requestId) => { cancelId = requestId; },
    },
  })).rejects.toThrow("aborted");
  expect(cancelId).toBe("req-2");
});

test("infographic requests use the same note access errors without blaming the agent login", () => {
  expect(infographicLocalAgentErrorKey("note_access_network", "workbuddyIntl")).toBe("aiAssistant.sidebar.noteAccessNetwork");
  expect(infographicLocalAgentErrorKey("node_missing", "codebuddy")).toBe("aiAssistant.agentSource.codebuddyNodeMissingHint");
  expect(infographicLocalAgentErrorKey("note_access_login_required", "workbuddyIntl")).toBe("aiAssistant.sidebar.noteAccessLoginRequired");
  expect(infographicLocalAgentErrorKey("note_access_changed", "codex")).toBe("aiAssistant.sidebar.noteAccessChanged");
});
