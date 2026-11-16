import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createEdgeEverClient } from "./index.ts";
import { detectAiModelCapabilities } from "./ai-model-capabilities-direct.ts";
import {
  loadModelsDevIndex,
  MODELS_DEV_FAILURE_BACKOFF_MS,
  MODELS_DEV_FRESH_MS,
  resetModelsDevCatalogCache,
} from "./models-dev-catalog.ts";

const catalog = JSON.parse(readFileSync(new URL("../../shared/test-fixtures/models-dev/catalog.json", import.meta.url), "utf8"));
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

/** A models.dev stand-in that records each request and answers 304 for a matching ETag. */
const catalogServer = (respond = () => json(catalog, 200, { ETag: '"v1"' })) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const ifNoneMatch = new Headers(init.headers).get("If-None-Match");
    calls.push({ url: String(url), credentials: init.credentials, ifNoneMatch });
    if (ifNoneMatch === '"v1"') return new Response(null, { status: 304 });
    return respond();
  };
  return { calls, fetchImpl };
};

afterEach(() => resetModelsDevCatalogCache());

describe("models.dev catalogue cache (#652)", () => {
  test("concurrent lookups share one download; a fresh copy is reused without a request", async () => {
    const server = catalogServer();
    let time = 1_000;
    const now = () => time;
    const [first, second] = await Promise.all([loadModelsDevIndex(server.fetchImpl, undefined, now), loadModelsDevIndex(server.fetchImpl, undefined, now)]);
    expect(first).toBe(second);
    expect(first.size).toBeGreaterThan(0);
    time += MODELS_DEV_FRESH_MS - 1;
    expect(await loadModelsDevIndex(server.fetchImpl, undefined, now)).toBe(first);
    expect(server.calls).toEqual([{ url: "https://models.dev/api.json", credentials: "omit", ifNoneMatch: null }]);
  });

  test("an expired copy is revalidated with its ETag and kept on 304", async () => {
    const server = catalogServer();
    let time = 1_000;
    const now = () => time;
    const first = await loadModelsDevIndex(server.fetchImpl, undefined, now);
    time += MODELS_DEV_FRESH_MS + 1;
    expect(await loadModelsDevIndex(server.fetchImpl, undefined, now)).toBe(first);
    expect(server.calls.map((call) => call.ifNoneMatch)).toEqual([null, '"v1"']);
    // The 304 renewed the copy, so the next lookup needs no request.
    expect(await loadModelsDevIndex(server.fetchImpl, undefined, now)).toBe(first);
    expect(server.calls).toHaveLength(2);
  });

  test("a failure is remembered for a while, then retried", async () => {
    let fail = true;
    const server = catalogServer(() => fail ? json({}, 503) : json(catalog));
    let time = 1_000;
    const now = () => time;
    expect(await loadModelsDevIndex(server.fetchImpl, undefined, now)).toBeNull();
    expect(await loadModelsDevIndex(server.fetchImpl, undefined, now)).toBeNull();
    expect(server.calls).toHaveLength(1);
    fail = false;
    time += MODELS_DEV_FAILURE_BACKOFF_MS + 1;
    expect(await loadModelsDevIndex(server.fetchImpl, undefined, now)).not.toBeNull();
    expect(server.calls).toHaveLength(2);
  });

  test("an expired copy is still used when revalidation fails", async () => {
    let up = true;
    const fetchImpl = async () => up ? json(catalog) : Promise.reject(new TypeError("Failed to fetch"));
    let time = 1_000;
    const now = () => time;
    const first = await loadModelsDevIndex(fetchImpl, undefined, now);
    up = false;
    time += MODELS_DEV_FRESH_MS + 1;
    expect(await loadModelsDevIndex(fetchImpl, undefined, now)).toBe(first);
  });

  test("a body that is not a catalogue counts as a failure", async () => {
    expect(await loadModelsDevIndex(async () => json({ error: "blocked" }))).toBeNull();
  });

  test("an aborted caller stops waiting without cancelling the shared download", async () => {
    let release;
    const fetchImpl = () => new Promise((resolve) => { release = () => resolve(json(catalog)); });
    const controller = new AbortController();
    const aborted = loadModelsDevIndex(fetchImpl, controller.signal);
    const other = loadModelsDevIndex(fetchImpl);
    controller.abort();
    await expect(aborted).rejects.toBeDefined();
    release();
    expect(await other).not.toBeNull();
  });
});

const newApiGateway = async (url) => new URL(String(url)).pathname === "/v1/models"
  ? json({ data: [{ id: "gpt-5", owned_by: "openai" }] })
  : json({}, 404);

describe("models.dev as the detection fallback (#652)", () => {
  test("a service without limits falls back to the catalogue", async () => {
    const server = catalogServer();
    expect(await detectAiModelCapabilities(
      { provider: "openai-compatible", baseUrl: "https://newapi.example/v1", apiKey: "k", modelId: "gpt-5" },
      newApiGateway,
      undefined,
      { catalogFetch: server.fetchImpl },
    )).toEqual({ maxOutputTokens: 128000, maxInputTokens: 272000, contextWindowTokens: null, source: "models-dev" });
    expect(server.calls).toHaveLength(1);
  });

  test("the service's own limits win and the catalogue is not read", async () => {
    const server = catalogServer();
    const openRouter = async () => json({ data: [{ id: "gpt-5", context_length: 200000, top_provider: { max_completion_tokens: 32000 } }] });
    expect(await detectAiModelCapabilities(
      { provider: "openai-compatible", baseUrl: "https://openrouter.example/api/v1", apiKey: "k", modelId: "gpt-5" },
      openRouter,
      undefined,
      { catalogFetch: server.fetchImpl },
    )).toMatchObject({ source: "openrouter-models", maxOutputTokens: 32000 });
    expect(server.calls).toHaveLength(0);
  });

  test("an unreadable service is still 'unknown'; the catalogue does not replace it", async () => {
    const server = catalogServer();
    expect(await detectAiModelCapabilities(
      { provider: "openai-compatible", baseUrl: "https://newapi.example/v1", apiKey: "k", modelId: "gpt-5" },
      async () => json({}, 401),
      undefined,
      { catalogFetch: server.fetchImpl },
    )).toBeNull();
    expect(server.calls).toHaveLength(0);
  });

  test("an unmatched model or unreachable catalogue reports 'no limits'", async () => {
    const none = { maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: null, source: "none" };
    const target = { provider: "openai-compatible", baseUrl: "https://newapi.example/v1", apiKey: "k", modelId: "my-alias" };
    expect(await detectAiModelCapabilities(target, newApiGateway, undefined, { catalogFetch: catalogServer().fetchImpl })).toEqual(none);
    // An unknown prefix is never removed: my-team/gpt-5 must not save OpenAI gpt-5's limits for every client.
    expect(await detectAiModelCapabilities({ ...target, modelId: "my-team/gpt-5" }, newApiGateway, undefined, { catalogFetch: catalogServer().fetchImpl })).toEqual(none);
    resetModelsDevCatalogCache();
    expect(await detectAiModelCapabilities({ ...target, modelId: "gpt-5" }, newApiGateway, undefined, {
      catalogFetch: async () => { throw new TypeError("Failed to fetch"); },
    })).toEqual(none);
  });

  test("generation: catalogue limits are reported and used by the same request", async () => {
    const instance = [];
    const sent = [];
    const server = catalogServer();
    let prepares = 0;
    const prepared = (overrides) => ({
      provider: "openai-compatible", baseUrl: "https://newapi.example/v1", apiKey: "k", modelId: "gpt-5",
      system: "System", prompt: "Note", maxOutputTokens: null, resultBoundary: { start: "<r>", end: "</r>" }, ...overrides,
    });
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        instance.push({ method: init.method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (path.endsWith("/capabilities")) return json({ detectedCapabilities: {} });
        prepares++;
        return json(prepares === 1
          ? prepared({ capabilityTarget: { providerConfigId: "aip_1", modelConfigId: "aim_1", configVersion: "v1" }, detectCapabilities: true })
          : prepared({ maxOutputTokens: 128000 }));
      },
      providerFetch: async (url, init) => {
        if (init.method === "GET") return newApiGateway(url);
        sent.push(JSON.parse(String(init.body)).max_tokens);
        return new Response('data: {"choices":[{"delta":{"content":"<r>ok</r>"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
      },
      modelCatalogFetch: server.fetchImpl,
    });
    await client.streamAiGeneration({ action: "continue-writing", title: "Note", contentMarkdown: "Body" }, { onEvent: () => {} });
    expect(instance.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/ai/generate/prepare",
      "PUT /api/v1/ai/providers/aip_1/models/aim_1/capabilities",
      "POST /api/v1/ai/generate/prepare",
    ]);
    expect(instance[1].body).toMatchObject({ maxOutputTokens: 128000, maxInputTokens: 272000, contextWindowTokens: null, source: "models-dev" });
    expect(sent).toEqual([128000]);
    expect(server.calls).toHaveLength(1);
  });
});
