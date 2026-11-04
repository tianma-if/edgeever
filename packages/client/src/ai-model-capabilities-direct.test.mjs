import { describe, expect, test } from "bun:test";
import { createEdgeEverClient } from "./index.ts";
import { detectAiModelCapabilities } from "./ai-model-capabilities-direct.ts";

const json = (body, status = 200) => Response.json(body, { status });

describe("model limit detection (#652)", () => {
  test("reads Anthropic and Gemini limits from the single-model endpoint", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url: String(url), method: init.method, key: new Headers(init.headers).get("x-api-key") ?? new Headers(init.headers).get("x-goog-api-key") });
      return String(url).includes("anthropic")
        ? json({ id: "claude-x", max_tokens: 64000, max_input_tokens: 200000 })
        : json({ name: "models/gemini-x", inputTokenLimit: 1048576, outputTokenLimit: 65536 });
    };
    expect(await detectAiModelCapabilities({ provider: "anthropic", baseUrl: "https://anthropic.example/v1/", apiKey: "a-key", modelId: "claude-x" }, fetchImpl))
      .toEqual({ maxOutputTokens: 64000, maxInputTokens: null, contextWindowTokens: 200000, source: "anthropic-models" });
    expect(await detectAiModelCapabilities({ provider: "google", baseUrl: "https://gemini.example/v1beta", apiKey: "g-key", modelId: "models/gemini-x" }, fetchImpl))
      .toEqual({ maxOutputTokens: 65536, maxInputTokens: 1048576, contextWindowTokens: null, source: "gemini-models" });
    expect(seen).toEqual([
      { url: "https://anthropic.example/v1/models/claude-x", method: "GET", key: "a-key" },
      { url: "https://gemini.example/v1beta/models/gemini-x", method: "GET", key: "g-key" },
    ]);
  });

  test("OpenAI-compatible: model list first, then LiteLLM /model/info, else nothing to report", async () => {
    const paths = [];
    const gateway = (handlers) => async (url) => { const path = new URL(String(url)).pathname; paths.push(path); return handlers[path]?.() ?? json({}, 404); };
    expect(await detectAiModelCapabilities({ provider: "openai-compatible", baseUrl: "https://openrouter.example/api/v1", apiKey: "k", modelId: "m" },
      gateway({ "/api/v1/models": () => json({ data: [{ id: "m", context_length: 200000, top_provider: { max_completion_tokens: 32000 } }] }) })))
      .toMatchObject({ maxOutputTokens: 32000, contextWindowTokens: 200000, source: "openrouter-models" });
    expect(await detectAiModelCapabilities({ provider: "openai-compatible", baseUrl: "https://litellm.example/v1", apiKey: "k", modelId: "m" },
      gateway({ "/v1/models": () => json({ data: [{ id: "m" }] }), "/v1/model/info": () => json({ data: [{ model_name: "m", model_info: { max_output_tokens: 16384, max_input_tokens: 128000 } }] }) })))
      .toMatchObject({ maxOutputTokens: 16384, maxInputTokens: 128000, source: "litellm-model-info" });
    // A plain gateway answers but has no limits: report "none" so it is not asked again soon.
    expect(await detectAiModelCapabilities({ provider: "openai-compatible", baseUrl: "https://newapi.example/v1", apiKey: "k", modelId: "m" },
      gateway({ "/v1/models": () => json({ data: [{ id: "m", owned_by: "x" }] }) })))
      .toEqual({ maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: null, source: "none" });
    expect(paths).toEqual(["/api/v1/models", "/v1/models", "/v1/model/info", "/v1/models", "/v1/model/info"]);
  });

  test("a gateway answering unsupported metadata paths with 400 counts as 'no limits'", async () => {
    const gateway = async () => json({ error: "不支持的请求路径" }, 400);
    expect(await detectAiModelCapabilities({ provider: "anthropic", baseUrl: "https://gw.example/v1", apiKey: "k", modelId: "claude-x" }, gateway))
      .toEqual({ maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: null, source: "none" });
    expect(await detectAiModelCapabilities({ provider: "google", baseUrl: "https://gw.example/v1beta", apiKey: "k", modelId: "gemini-x" }, gateway))
      .toMatchObject({ source: "none" });
    // Authentication and rate limits are not answers about the model.
    expect(await detectAiModelCapabilities({ provider: "anthropic", baseUrl: "https://gw.example/v1", apiKey: "k", modelId: "claude-x" }, async () => json({}, 401))).toBeNull();
    expect(await detectAiModelCapabilities({ provider: "anthropic", baseUrl: "https://gw.example/v1", apiKey: "k", modelId: "claude-x" }, async () => json({}, 429))).toBeNull();
  });

  test("authentication, server and network errors mean 'unknown', not 'no limits'", async () => {
    const target = { provider: "openai-compatible", baseUrl: "https://g.example/v1", apiKey: "k", modelId: "m" };
    expect(await detectAiModelCapabilities(target, async () => json({ error: "bad key" }, 401))).toBeNull();
    expect(await detectAiModelCapabilities(target, async () => json({}, 503))).toBeNull();
    expect(await detectAiModelCapabilities(target, async () => { throw new TypeError("Failed to fetch"); })).toBeNull();
  });
});

const preparedBody = (overrides = {}) => ({
  provider: "openai-compatible",
  baseUrl: "https://gateway.example/v1",
  apiKey: "model-key",
  modelId: "model-x",
  system: "System",
  prompt: "Note content",
  maxOutputTokens: null,
  resultBoundary: { start: "<r>", end: "</r>" },
  ...overrides,
});
const sse = (finishReason) => new Response([
  `data: {"choices":[{"delta":{"content":"<r>Hello</r>"},"finish_reason":"${finishReason}"}]}`,
  "data: [DONE]",
  "",
].join("\n\n"), { headers: { "content-type": "text/event-stream" } });

describe("generation with automatic budgets (#652)", () => {
  test("stale limits: detect, report, prepare again, then stream with the new budget", async () => {
    const instance = [];
    const provider = [];
    let prepares = 0;
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        instance.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (path.endsWith("/generate/prepare")) {
          prepares++;
          return json(prepares === 1
            ? preparedBody({ capabilityTarget: { providerConfigId: "aip_1", modelConfigId: "aim_1" }, outputBudget: { mode: "auto-unbounded", outputLimit: null, inputFits: null } })
            : preparedBody({ maxOutputTokens: 32000, outputBudget: { mode: "auto", outputLimit: 32000, inputFits: true } }));
        }
        if (path.endsWith("/capabilities")) return json({ detectedCapabilities: {} });
        throw new Error(`unexpected ${path}`);
      },
      providerFetch: async (url, init) => {
        provider.push({ path: new URL(String(url)).pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (String(url).endsWith("/models")) return json({ data: [{ id: "model-x", context_length: 200000, top_provider: { max_completion_tokens: 32000 } }] });
        return sse("stop");
      },
    });
    const events = [];
    await client.streamAiGeneration({ action: "continue-writing", title: "Note", contentMarkdown: "Body" }, { onEvent: (event) => events.push(event) });
    expect(instance.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/ai/generate/prepare",
      "PUT /api/v1/ai/providers/aip_1/models/aim_1/capabilities",
      "POST /api/v1/ai/generate/prepare",
    ]);
    expect(instance[0].body.allowUnboundedOutput).toBe(true);
    expect(instance[1].body).toEqual({ modelId: "model-x", baseUrl: "https://gateway.example/v1", maxOutputTokens: 32000, maxInputTokens: null, contextWindowTokens: 200000, source: "openrouter-models" });
    expect(provider.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /v1/models", "POST /v1/chat/completions"]);
    expect(provider[1].body.max_tokens).toBe(32000);
    expect(events.at(-1)).toMatchObject({ type: "finish", finishReason: "stop", truncated: false });
  });

  test("no limit known: the request omits max_tokens; a truncated finish is flagged", async () => {
    let body;
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      fetch: async () => json(preparedBody()),
      providerFetch: async (_url, init) => { body = JSON.parse(String(init.body)); return sse("length"); },
    });
    const events = [];
    await client.streamAiGeneration({ action: "translate", title: "Note", contentMarkdown: "Body", targetLanguage: "en" }, { onEvent: (event) => events.push(event) });
    expect("max_tokens" in body).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "finish", finishReason: "length", truncated: true });
  });

  test("a gateway that cuts the output but reports 'stop' is still flagged as truncated", async () => {
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      fetch: async () => json(preparedBody()),
      // Start marker, partial text, no end marker, finish_reason "stop" (as seen from a real gateway).
      providerFetch: async () => new Response([
        `data: {"choices":[{"delta":{"content":"<r>\\n## 1. Part one\\nText that stops mid-sen"},"finish_reason":"stop"}]}`,
        "data: [DONE]",
        "",
      ].join("\n\n"), { headers: { "content-type": "text/event-stream" } }),
    });
    const events = [];
    await client.streamAiGeneration({ action: "improve-writing", title: "Note", contentMarkdown: "Body" }, { onEvent: (event) => events.push(event) });
    expect(events.filter((event) => event.type === "text-delta").map((event) => event.text).join("")).toContain("stops mid-sen");
    expect(events.at(-1)).toMatchObject({ type: "finish", finishReason: "stop", truncated: true });
  });

  test("a recognised 'output too large' error is reported and retried once with the accepted limit", async () => {
    const instance = [];
    const sent = [];
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        instance.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (path.endsWith("/capabilities")) return json({ detectedCapabilities: {} });
        return json(preparedBody({ provider: "anthropic", maxOutputTokens: 128000, capabilityTarget: { providerConfigId: "aip_1", modelConfigId: "aim_1" } }));
      },
      providerFetch: async (url, init) => {
        if (init.method === "GET") return json({ id: "model-x", max_tokens: null, max_input_tokens: null });
        const body = JSON.parse(String(init.body));
        sent.push(body.max_tokens);
        if (body.max_tokens > 64000) {
          return json({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: 128000 > 64000, which is the maximum allowed number of output tokens for model-x" } }, 400);
        }
        return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<r>ok</r>"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n', { headers: { "content-type": "text/event-stream" } });
      },
    });
    const events = [];
    await client.streamAiGeneration({ action: "continue-writing", title: "Note", contentMarkdown: "Body" }, { onEvent: (event) => events.push(event) });
    expect(sent).toEqual([128000, 64000]);
    expect(instance.filter((call) => call.path.endsWith("/capabilities")).map((call) => call.body.source)).toEqual(["none", "provider-error"]);
    expect(instance.at(-1).body).toMatchObject({ maxOutputTokens: 64000, source: "provider-error" });
    expect(events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "finish", truncated: false });
  });

  test("an unrecognised 400 is not retried", async () => {
    let calls = 0;
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      fetch: async () => json(preparedBody({ maxOutputTokens: 4096 })),
      providerFetch: async () => { calls++; return json({ error: { message: "Invalid model" } }, 400); },
    });
    const events = [];
    await client.streamAiGeneration({ action: "summarize", title: "Note", contentMarkdown: "Body" }, { onEvent: (event) => events.push(event) });
    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "ai_generation_failed" });
  });
});
