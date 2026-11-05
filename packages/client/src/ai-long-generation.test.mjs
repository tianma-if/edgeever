import { describe, expect, test } from "bun:test";
import { createEdgeEverClient } from "./index.ts";
import { runAiLongGeneration } from "./ai-long-generation.ts";
import { aiDraftIncompleteReason, startAiDraftCompletion, trackAiDraftEvent } from "../../shared/src/ai-generation.ts";

const prepared = (overrides = {}) => ({
  provider: "openai-compatible",
  baseUrl: "https://gateway.example/v1",
  apiKey: "model-key",
  modelId: "model-x",
  system: "System",
  prompt: "Note content",
  maxOutputTokens: null,
  resultBoundary: { start: "<r>", end: "</r>" },
  longGeneration: true,
  ...overrides,
});

/** Folds events the way the assistants do: deltas append, a reset replaces the draft. */
const collect = () => {
  const events = [];
  let text = "";
  let completion = startAiDraftCompletion();
  const onEvent = (event) => {
    events.push(event);
    if (event.type === "text-delta") text += event.text;
    if (event.type === "text-reset") text = event.text;
    completion = trackAiDraftEvent(completion, event);
  };
  return { events, onEvent, text: () => text, completion: () => completion };
};

/** A fake model: the reply for each request is chosen by `reply(prepared)`. */
const streamWith = (reply) => async (request, onEvent) => {
  const result = reply(request);
  for (const chunk of result.chunks) onEvent({ type: "text-delta", text: chunk });
  if (result.error) onEvent({ type: "error", code: result.error, message: "failed" });
  else onEvent({ type: "finish", finishReason: result.truncated ? "length" : "stop", truncated: Boolean(result.truncated) });
};

const parts = [
  { markdown: "# Title\n\nFirst part.\n\n", headingPath: [], passthrough: false },
  { markdown: "```js\ncode();\n```\n\n", headingPath: ["Title"], passthrough: true },
  { markdown: "## Two\n\nSecond part.\n", headingPath: ["Title"], passthrough: false },
];

describe("running a long task in parts (#652 PR B)", () => {
  test("parts run in order with context, code passes through, and the result keeps the layout", async () => {
    const requests = [];
    const sink = collect();
    await runAiLongGeneration({
      first: prepared({ segments: parts }),
      prepare: async (request) => { requests.push(request); return prepared({ prompt: request.contentMarkdown }); },
      stream: streamWith((request) => ({ chunks: [request.prompt.includes("First") ? "# 标题\n\n第一部分。" : "## 二\n\n第二部分。"] })),
      onEvent: sink.onEvent,
    });
    expect(sink.text()).toBe("# 标题\n\n第一部分。\n\n```js\ncode();\n```\n\n## 二\n\n第二部分。");
    expect(requests).toHaveLength(2);
    expect(requests[0].segment).toEqual({ index: 0, count: 3, headingPath: [] });
    expect(requests[1].segment).toMatchObject({
      index: 2, count: 3, headingPath: ["Title"], previousSourceTail: "# Title\n\nFirst part.", previousOutputTail: "# 标题\n\n第一部分。",
    });
    expect(sink.events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(sink.events.filter((event) => event.type === "progress").map((event) => event.part)).toEqual([1, 2, 3]);
    expect(sink.events.at(-1)).toEqual({ type: "finish", truncated: false });
    expect(aiDraftIncompleteReason(sink.completion())).toBeNull();
  });

  test("a cut-off part is split again; one that still cannot finish keeps its source and blocks replace", async () => {
    const sink = collect();
    const requests = [];
    await runAiLongGeneration({
      first: prepared({ segments: [parts[0], parts[2]] }),
      prepare: async (request) => {
        requests.push(request);
        if (request.segmentation?.depth === 2) return prepared({ prompt: request.contentMarkdown });
        if (request.segmentation) {
          // The second part splits into two smaller ones; the second of those cannot split further.
          return prepared({ segments: [
            { markdown: "## Two\n\n", headingPath: [], passthrough: false },
            { markdown: "Second part.\n", headingPath: ["Two"], passthrough: false },
          ] });
        }
        return prepared({ prompt: request.contentMarkdown });
      },
      stream: streamWith((request) => {
        if (request.prompt.includes("First")) return { chunks: ["第一部分。"] };
        if (request.prompt === "## Two\n\n") return { chunks: ["## 二"] };
        // The full second part and its second half are always cut off.
        return { chunks: ["第二部"], truncated: true };
      }),
      onEvent: sink.onEvent,
    });
    expect(requests.filter((request) => request.segmentation)).toEqual([
      { contentMarkdown: "## Two\n\nSecond part.\n", segmentation: { depth: 1 } },
      { contentMarkdown: "Second part.\n", segmentation: { depth: 2 } },
    ]);
    // The part that could not finish keeps its source text instead of the cut-off result.
    expect(sink.text()).toBe("第一部分。\n\n## 二\n\nSecond part.");
    expect(sink.events.at(-1)).toEqual({ type: "finish", truncated: true, incompleteParts: [2] });
    expect(aiDraftIncompleteReason(sink.completion())).toBe("truncated");
    expect(sink.completion().incompleteParts).toEqual([2]);
  });

  test("an error in a part ends the run and keeps the text so far as an interrupted draft", async () => {
    const sink = collect();
    let streamed = 0;
    await runAiLongGeneration({
      first: prepared({ segments: [parts[0], parts[2]] }),
      prepare: async (request) => prepared({ prompt: request.contentMarkdown }),
      stream: streamWith(() => (streamed++ === 0 ? { chunks: ["第一部分。"] } : { chunks: ["第二"], error: "ai_stream_interrupted" })),
      onEvent: sink.onEvent,
    });
    expect(sink.text()).toBe("第一部分。\n\n第二");
    expect(sink.events.at(-1)).toMatchObject({ type: "error", code: "ai_stream_interrupted" });
    expect(aiDraftIncompleteReason(sink.completion())).toBe("interrupted");
  });

  test("a stop between parts ends the run without another request", async () => {
    const controller = new AbortController();
    let prepares = 0;
    const run = runAiLongGeneration({
      first: prepared({ segments: [parts[0], parts[2]] }),
      prepare: async (request) => { prepares += 1; return prepared({ prompt: request.contentMarkdown }); },
      stream: async (request, onEvent) => {
        onEvent({ type: "text-delta", text: "第一部分。" });
        controller.abort();
        onEvent({ type: "finish", truncated: false });
      },
      signal: controller.signal,
      onEvent: () => {},
    });
    await expect(run).rejects.toBeDefined();
    expect(prepares).toBe(1);
  });
});

test("a part whose result is far too short is split again instead of losing text (#652 PR B)", async () => {
  const long = { markdown: `## 30. 节\n\n${"这一段需要被完整处理。".repeat(40)}\n\n`, headingPath: [], passthrough: false };
  const sink = collect();
  const requests = [];
  await runAiLongGeneration({
    first: prepared({ segments: [parts[0], long] }),
    prepare: async (request) => {
      requests.push(request);
      if (request.segmentation) return prepared({ prompt: request.contentMarkdown });
      return prepared({ prompt: request.contentMarkdown });
    },
    stream: streamWith((request) => ({ chunks: [request.prompt.includes("First") ? "第一部分。" : "只返回了一句话。"] })),
    onEvent: sink.onEvent,
  });
  expect(requests.some((request) => request.segmentation?.depth === 1)).toBe(true);
  expect(sink.text()).toContain("这一段需要被完整处理。");
  expect(sink.text()).not.toContain("只返回了一句话。");
  expect(sink.events.at(-1)).toMatchObject({ type: "finish", truncated: true, incompleteParts: [2] });
});

describe("continuing a cut-off result (#652 PR B)", () => {
  test("continues up to three rounds and drops text repeated at the seam", async () => {
    const sink = collect();
    const continuations = [];
    const replies = [
      { chunks: ["Paragraph one.\n\nParagraph two is cut"], truncated: true },
      { chunks: ["Paragraph two is cut", " short here.\n\nParagraph three"], truncated: true },
      { chunks: [" ends.\n\nThe end."] },
    ];
    await runAiLongGeneration({
      first: prepared(),
      prepare: async (request) => { continuations.push(request.continuation); return prepared(); },
      stream: streamWith(() => replies.shift()),
      onEvent: sink.onEvent,
    });
    expect(continuations).toEqual([
      { round: 1, previousOutput: "Paragraph one.\n\nParagraph two is cut" },
      { round: 2, previousOutput: "Paragraph one.\n\nParagraph two is cut short here.\n\nParagraph three" },
    ]);
    expect(sink.text()).toBe("Paragraph one.\n\nParagraph two is cut short here.\n\nParagraph three ends.\n\nThe end.");
    expect(sink.events.at(-1)).toMatchObject({ type: "finish", truncated: false });
    expect(aiDraftIncompleteReason(sink.completion())).toBeNull();
  });

  test("an empty continuation that ends normally keeps the draft incomplete (#652 PR B review)", async () => {
    for (const second of [{ chunks: [] }, { chunks: ["   \n"] }, { chunks: ["Paragraph two is cut"] }]) {
      const sink = collect();
      const replies = [{ chunks: ["Paragraph one.\n\nParagraph two is cut"], truncated: true }, second];
      let prepares = 0;
      await runAiLongGeneration({
        first: prepared(),
        prepare: async () => { prepares += 1; return prepared(); },
        stream: streamWith(() => replies.shift() ?? { chunks: ["more"] }),
        onEvent: sink.onEvent,
      });
      expect(prepares).toBe(1);
      expect(sink.text()).toBe("Paragraph one.\n\nParagraph two is cut");
      expect(sink.events.at(-1)).toMatchObject({ type: "finish", truncated: true });
      expect(aiDraftIncompleteReason(sink.completion())).toBe("truncated");
    }
  });

  test("stays incomplete after three rounds, when the window is full, or on an older server", async () => {
    const always = () => ({ chunks: ["more "], truncated: true });
    const rounds = collect();
    let prepares = 0;
    await runAiLongGeneration({ first: prepared(), prepare: async () => { prepares += 1; return prepared(); }, stream: streamWith(always), onEvent: rounds.onEvent });
    expect(prepares).toBe(3);
    expect(aiDraftIncompleteReason(rounds.completion())).toBe("truncated");

    const full = collect();
    await runAiLongGeneration({
      first: prepared(),
      prepare: async () => { throw Object.assign(new Error("too long"), { code: "ai_input_too_long", status: 413 }); },
      stream: streamWith(always),
      onEvent: full.onEvent,
    });
    expect(full.text()).toBe("more ");
    expect(aiDraftIncompleteReason(full.completion())).toBe("truncated");

    // A server without long generation would start over, so the client does not ask it to continue.
    const older = collect();
    let olderPrepares = 0;
    await runAiLongGeneration({ first: prepared({ longGeneration: undefined }), prepare: async () => { olderPrepares += 1; return prepared(); }, stream: streamWith(always), onEvent: older.onEvent });
    expect(olderPrepares).toBe(0);
    expect(aiDraftIncompleteReason(older.completion())).toBe("truncated");
  });
});

describe("streamAiGeneration runs parts end to end (#652 PR B)", () => {
  test("asks prepare for parts, then prepares and streams each part", async () => {
    const bodies = [];
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        if (body.segmentation) return Response.json(prepared({ segments: parts }));
        return Response.json(prepared({ prompt: body.contentMarkdown }));
      },
      providerFetch: async (url, init) => {
        const prompt = JSON.parse(init.body).messages.at(-1).content;
        const text = prompt.includes("First") ? "第一部分。" : "第二部分。";
        return new Response(`data: {"choices":[{"delta":{"content":"<r>\\n${text}\\n</r>"},"finish_reason":"stop"}]}\n\n`, { headers: { "content-type": "text/event-stream" } });
      },
    });
    const sink = collect();
    await client.streamAiGeneration({ action: "translate", targetLanguage: "zh-CN", title: "Note", contentMarkdown: "# Title..." }, { onEvent: sink.onEvent });
    expect(bodies[0]).toMatchObject({ segmentation: {}, allowUnboundedOutput: true });
    expect(bodies.slice(1).map((body) => body.segment?.index)).toEqual([0, 2]);
    expect(bodies.slice(1).every((body) => body.action === "translate" && body.targetLanguage === "zh-CN" && !body.segmentation)).toBe(true);
    expect(sink.text()).toBe("第一部分。\n\n```js\ncode();\n```\n\n第二部分。");
    expect(sink.events.at(-1)).toEqual({ type: "finish", truncated: false });
  });
});
