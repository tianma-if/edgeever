import { describe, expect, test, spyOn } from "bun:test";
import { createEdgeEverClient } from "./index.ts";
import { parsePreparedCompanion } from "./companion-direct-stream.ts";

const preparedTurn = {
  turn: {
    id: "11111111-1111-1111-1111-111111111111",
    threadId: "22222222-2222-2222-2222-222222222222",
    message: "hi",
    response: "",
    process: "",
    status: "running",
    sources: [],
    tools: [],
    todos: [],
    questions: [],
    mentions: [],
    model: "direct-model",
    inputTokens: null,
    outputTokens: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  provider: "openai-compatible",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "or-key",
  modelId: "openai/gpt-4o-mini",
  instructions: "You are EdgeEver.",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  maxSteps: 8,
  maxOutputTokens: 2048,
};

describe("companion prepare payload", () => {
  test("rejects a payload that would send the API key as a target probe", () => {
    expect(parsePreparedCompanion({ ...preparedTurn, apiKey: undefined })).toBeNull();
    expect(parsePreparedCompanion(preparedTurn)?.modelId).toBe("openai/gpt-4o-mini");
    expect(parsePreparedCompanion(preparedTurn)?.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("keeps user attachment parts and rejects a malformed message", () => {
    const parts = [
      { type: "text", text: "hi" },
      { type: "image", image: "aaaa", mediaType: "image/png" },
      { type: "file", data: "bbbb", mediaType: "application/pdf", filename: "a.pdf" },
    ];
    expect(parsePreparedCompanion({
      ...preparedTurn,
      messages: [{ role: "user", content: parts }, { role: "assistant", content: "ok" }],
    })?.messages).toEqual([
      { role: "user", content: parts },
      { role: "assistant", content: "ok" },
    ]);
    expect(parsePreparedCompanion({
      ...preparedTurn,
      messages: [{ role: "assistant", content: [{ type: "text", text: "no" }] }],
    })).toBeNull();
    expect(parsePreparedCompanion({
      ...preparedTurn,
      messages: [{ role: "user", content: "hi" }, { role: "user", content: [{ type: "image" }] }],
    })).toBeNull();
  });
});

describe("direct companion client", () => {
  test("prepares on the instance then streams from the model provider", async () => {
    const urls = [];
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      token: "user-token",
      directAiGeneration: true,
      fetch: async (url, init) => {
        urls.push({ url: String(url), method: init?.method ?? "GET" });
        if (String(url).endsWith("/prepare")) {
          return new Response(JSON.stringify(preparedTurn), { headers: { "content-type": "application/json" } });
        }
        if (String(url).endsWith("/checkpoint") || String(url).endsWith("/complete")) {
          return new Response(JSON.stringify({
            ok: true,
            turn: { ...preparedTurn.turn, status: "completed", response: "Hello" },
          }), { headers: { "content-type": "application/json" } });
        }
        throw new Error(`unexpected instance ${url}`);
      },
      providerFetch: async (url) => {
        urls.push({ url: String(url), method: "POST" });
        return new Response([
          `data: {"choices":[{"delta":{"content":"Hello"}}]}`,
          `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}`,
          "data: [DONE]",
          "",
        ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
      },
    });
    const events = [];
    await client.streamCompanion(
      { id: preparedTurn.turn.id, threadId: preparedTurn.turn.threadId, message: "hi" },
      { onEvent: (event) => events.push(event) },
    );
    expect(urls[0]).toEqual({ url: "https://notes.example/api/v1/companion/turns/prepare", method: "POST" });
    expect(urls.some((call) => call.url.includes("openrouter.ai"))).toBe(true);
    expect(urls.some((call) => call.url.endsWith("/complete"))).toBe(true);
    expect(urls.some((call) => call.url.endsWith("/api/v1/companion/turns") && call.method === "POST" && !call.url.endsWith("/prepare"))).toBe(false);
    expect(events.some((event) => event.type === "start")).toBe(true);
  });

  test("browser companion reports network failure without instance fallback", async () => {
    const paths = [];
    const completions = [];
    const events = [];
    let calls = 0;
    const client = createEdgeEverClient({
      fetch: async (url, init) => {
        paths.push(String(url));
        if (String(url).endsWith("/prepare")) return Response.json(preparedTurn);
        if (String(url).endsWith("/complete")) {
          const completion = JSON.parse(init.body);
          completions.push(completion);
          return Response.json({ turn: { ...preparedTurn.turn, ...completion } });
        }
        throw new Error(`Unexpected instance request: ${url}`);
      },
      providerFetch: async () => {
        calls++;
        throw new TypeError("Failed to fetch");
      },
    });
    await client.streamCompanion(
      { id: preparedTurn.turn.id, message: "hi" },
      { onEvent: event => events.push(event) },
    );
    expect(paths).toEqual([
      "/api/v1/companion/turns/prepare",
      `/api/v1/companion/turns/${preparedTurn.turn.id}/complete`,
    ]);
    expect(calls).toBe(1);
    expect(completions).toHaveLength(1);
    expect(completions[0].status).toBe("failed");
    expect(events.at(-1)).toEqual({
      type: "error",
      code: "companion_generation_failed",
      diagnostics: { reason: "network" },
    });
  });
});

test("direct provider rejection includes safe diagnostics and completes the failed turn once", async () => {
  const { streamDirectCompanion } = await import("./companion-direct-stream.ts");
  const events = [];
  const completed = [];
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await streamDirectCompanion(preparedTurn, {
      fetch: async () => new Response(JSON.stringify({ error: { message: "private-key-secret private-note", type: "invalid_request_error" } }), { status: 404, headers: { "content-type": "application/json" } }),
      onEvent: event => events.push(event),
      executeTool: async () => { throw new Error("must not execute tools"); },
      checkpoint: async () => { throw new Error("must not checkpoint"); },
      complete: async body => { completed.push(body); return { turn: { ...preparedTurn.turn, ...body } }; },
    });
    expect(completed).toHaveLength(1);
    expect(completed[0].status).toBe("failed");
    expect(events.at(-1)).toEqual({ type: "error", code: "companion_generation_failed", diagnostics: { reason: "http", status: 404 } });
    expect(JSON.stringify(events)).not.toContain("private-key-secret");
    expect(JSON.stringify(events)).not.toContain("private-note");
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test("browser fallback continues the same prepared turn and completes the streamed reply", async () => {
  const paths = []; const events = []; let providerCalls = 0;
  const client = createEdgeEverClient({
    allowAiServerFallback: true,
    fetch: async (url, init) => {
      const path = String(url); paths.push(path);
      if (path.endsWith("/prepare")) return Response.json(preparedTurn);
      if (path.endsWith("/provider-relay")) {
        expect(new Headers(init.headers).get("x-edgeever-ai-target")).toBe(preparedTurn.baseUrl + "/chat/completions");
        return new Response('data: {"choices":[{"delta":{"content":"Relayed reply"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
      }
      if (path.endsWith("/complete")) {
        const body = JSON.parse(init.body);
        expect(body.status).toBe("completed"); expect(body.response).toBe("Relayed reply");
        return Response.json({ turn: { ...preparedTurn.turn, ...body } });
      }
      throw Error("Unexpected instance request");
    },
    providerFetch: async () => { providerCalls++; throw new TypeError("Failed to fetch"); },
  });
  await client.streamCompanion({ id: preparedTurn.turn.id, message: "hi" }, { onEvent: event => events.push(event) });
  expect(paths).toEqual(["/api/v1/companion/turns/prepare", "/api/v1/ai/provider-relay", `/api/v1/companion/turns/${preparedTurn.turn.id}/complete`]);
  expect(providerCalls).toBe(1);
  expect(events).toContainEqual({ type: "text-delta", text: "Relayed reply" });
  expect(events.at(-1)).toMatchObject({ type: "done", turn: { id: preparedTurn.turn.id, status: "completed" } });
});

test("a resumed turn with answered questions completes after the reply (#637)", async () => {
  const { streamDirectCompanion } = await import("./companion-direct-stream.ts");
  const answered = [{ id: "language", prompt: "Which language?", inputType: "single_select", options: [{ id: "en", label: "English" }] }];
  const completed = [];
  await streamDirectCompanion({ ...preparedTurn, turn: { ...preparedTurn.turn, questions: answered } }, {
    fetch: async () => new Response('data: {"choices":[{"delta":{"content":"Translated note."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }),
    onEvent: () => {},
    executeTool: async () => { throw new Error("must not execute tools"); },
    checkpoint: async () => {},
    complete: async body => { completed.push(body); return { turn: { ...preparedTurn.turn, ...body } }; },
  });
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ status: "completed", response: "Translated note." });
});

test("a reply longer than the per-turn limit is saved up to the limit and the turn closes (#652)", async () => {
  const { streamDirectCompanion } = await import("./companion-direct-stream.ts");
  const { CompanionTurnCheckpointSchema, CompanionTurnCompleteSchema, COMPANION_RESPONSE_MAX_CHARS } = await import("@edgeever/shared");
  // 170 chunks x 100 chars = 17,000 characters with a 9,000-token budget.
  const chunks = Array.from({ length: 170 }, (_, index) => `${String(index).padStart(3, "0")}${"x".repeat(97)}`);
  let providerSignal;
  const sse = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const text of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  });
  const events = [];
  const checkpoints = [];
  const completed = [];
  await streamDirectCompanion({ ...preparedTurn, maxOutputTokens: 9000 }, {
    fetch: async (_url, init) => { providerSignal = init.signal; return new Response(sse, { headers: { "content-type": "text/event-stream" } }); },
    onEvent: event => events.push(event),
    executeTool: async () => { throw new Error("must not execute tools"); },
    // The instance validates these bodies with the shared schemas; mirror that here.
    checkpoint: async body => { checkpoints.push(CompanionTurnCheckpointSchema.parse(body)); },
    complete: async body => { completed.push(CompanionTurnCompleteSchema.parse(body)); return { turn: { ...preparedTurn.turn, ...body } }; },
  });
  expect(COMPANION_RESPONSE_MAX_CHARS).toBe(16000);
  expect(completed).toHaveLength(1);
  expect(completed[0].status).toBe("failed");
  expect(completed[0].response).toBe(chunks.join("").slice(0, 16000));
  expect(checkpoints.every(body => body.response.length <= 16000)).toBe(true);
  expect(events.filter(event => event.type === "text-delta").map(event => event.text).join("")).toBe(completed[0].response);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "companion_response_too_long" });
  expect(providerSignal?.aborted).toBe(true);
});

test("process text sealed before tool calls stays within the instance limit (#652)", async () => {
  const { clipCompanionProcess, COMPANION_PROCESS_MAX_CHARS, sealCompanionProcess } = await import("@edgeever/shared");
  const sealed = sealCompanionProcess("p".repeat(30000), "r".repeat(9000));
  const clipped = clipCompanionProcess(sealed.process);
  expect(clipped.length).toBeLessThanOrEqual(COMPANION_PROCESS_MAX_CHARS);
  expect(clipped.endsWith("r".repeat(9000))).toBe(true);
  expect(clipCompanionProcess("short")).toBe("short");
});
