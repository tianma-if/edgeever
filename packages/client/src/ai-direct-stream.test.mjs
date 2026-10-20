import { describe, expect, test } from "bun:test";
import { createEdgeEverClient } from "./index.ts";
import { probeAiProviderCors } from "./ai-direct-stream.ts";

describe("direct AI generation client", () => {
  test("prepares on the instance then streams from the model provider", async () => {
    const calls = [];
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      token: "user-token",
      directAiGeneration: true,
      fetch: async (url, init) => {
        calls.push({ url: String(url), auth: new Headers(init.headers).get("Authorization") });
        expect(String(url)).toBe("https://notes.example/api/v1/ai/generate/prepare");
        return new Response(JSON.stringify({
          provider: "openai-compatible",
          baseUrl: "https://integrate.api.nvidia.com/v1",
          apiKey: "nvidia-key",
          modelId: "meta/llama",
          system: "System",
          prompt: "Note content",
          maxOutputTokens: 4096,
          resultBoundary: { start: "<edgeever-result-x>", end: "</edgeever-result-x>" },
        }), { headers: { "content-type": "application/json" } });
      },
      providerFetch: async (url, init) => {
        calls.push({ url: String(url), auth: new Headers(init.headers).get("Authorization") });
        expect(String(url)).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
        const body = JSON.parse(String(init.body));
        expect(body.stream).toBe(true);
        return new Response([
          `data: {"choices":[{"delta":{"content":"<edgeever-result-x>\\nHello"}}]}`,
          `data: {"choices":[{"delta":{"content":" world</edgeever-result-x>"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`,
          "data: [DONE]",
          "",
        ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
      },
    });

    const events = [];
    await client.streamAiGeneration(
      { action: "summarize", title: "Note", contentMarkdown: "Body" },
      { onEvent: (event) => events.push(event) },
    );

    expect(calls).toEqual([
      { url: "https://notes.example/api/v1/ai/generate/prepare", auth: "Bearer user-token" },
      { url: "https://integrate.api.nvidia.com/v1/chat/completions", auth: "Bearer nvidia-key" },
    ]);
    expect(events.filter((event) => event.type === "text-delta").map((event) => event.text).join("")).toBe("Hello world");
    expect(events.at(-1)).toMatchObject({ type: "finish", outputTokens: 2 });
  });

  test("browser network failures never call instance generation or probe the model twice", async () => {
 const paths=[];let modelCalls=0;
 const client=createEdgeEverClient({tryDirectAiGeneration:true,fetch:async url=>{paths.push(String(url));return Response.json({provider:"openai-compatible",baseUrl:"https://model.example/v1",apiKey:"key",modelId:"model",system:"Summarize",prompt:"Body",maxOutputTokens:32,resultBoundary:{start:"<r>",end:"</r>"}});},providerFetch:async()=>{modelCalls++;throw new TypeError("Failed to fetch");}});
 await expect(client.streamAiGeneration({action:"summarize",title:"Note",contentMarkdown:"Body"},{onEvent(){}})).rejects.toThrow("Failed to fetch");
 expect(paths).toEqual(["/api/v1/ai/generate/prepare"]);expect(modelCalls).toBe(1);
});

  test("browser clients directly generate without a CORS probe", async () => {
 let calls=0;const paths=[];
 const client=createEdgeEverClient({fetch:async url=>{paths.push(String(url));return Response.json({provider:"openai-compatible",baseUrl:"https://model.example/v1",apiKey:"key",modelId:"model",system:"Summarize",prompt:"Body",maxOutputTokens:32,resultBoundary:{start:"<r>",end:"</r>"}});},providerFetch:async (_url,init)=>{calls++;expect(new Headers(init.headers).get("Authorization")).toBe("Bearer key");return new Response('data: {"choices":[{"delta":{"content":"<r>Hello</r>"}}]}\n\ndata: [DONE]\n\n');}});
 const events=[];await client.streamAiGeneration({action:"summarize",title:"Note",contentMarkdown:"Body"},{onEvent:e=>events.push(e)});
 expect(events.some(e=>e.type==="text-delta"&&e.text==="Hello")).toBe(true);expect(paths).toEqual(["/api/v1/ai/generate/prepare"]);expect(calls).toBe(1);
});

  // React Native's abort-controller@3 polyfill exposes only `aborted` (#629).
  const legacySignal = (aborted) => ({ aborted, addEventListener() {}, removeEventListener() {} });

  test("streams with a React Native AbortSignal that lacks throwIfAborted", async () => {
    const client = createEdgeEverClient({
      directAiGeneration: true,
      fetch: async () => Response.json({ provider: "openai-compatible", baseUrl: "https://model.example/v1", apiKey: "key", modelId: "model", system: "Summarize", prompt: "Body", maxOutputTokens: 32, resultBoundary: { start: "<r>", end: "</r>" } }),
      providerFetch: async () => new Response('data: {"choices":[{"delta":{"content":"<r>Hello</r>"}}]}\n\ndata: [DONE]\n\n'),
    });
    const events = [];
    await client.streamAiGeneration(
      { action: "summarize", title: "Note", contentMarkdown: "Body" },
      { signal: legacySignal(false), onEvent: (event) => events.push(event) },
    );
    expect(events.some((event) => event.type === "text-delta" && event.text === "Hello")).toBe(true);
  });

  test("rejects an aborted React Native AbortSignal with AbortError before preparing", async () => {
    let prepared = false;
    const client = createEdgeEverClient({
      directAiGeneration: true,
      fetch: async () => { prepared = true; return new Response("{}", { status: 404 }); },
    });
    await expect(client.streamAiGeneration(
      { action: "summarize", title: "Note", contentMarkdown: "Body" },
      { signal: legacySignal(true), onEvent() {} },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(prepared).toBe(false);
  });

  test("fails without instance generation when direct prepare is missing", async () => {
    const urls = [];
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      directAiGeneration: true,
      fetch: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith("/prepare")) return new Response("{}", { status: 404 });
        return new Response("data: {\"type\":\"text-delta\",\"text\":\"proxied\"}\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const events = [];
    await expect(client.streamAiGeneration(
      { action: "summarize", title: "Note", contentMarkdown: "Body" },
      { onEvent: (event) => events.push(event) },
    )).rejects.toMatchObject({ code: "ai_direct_unavailable" });
    expect(urls).toEqual(["https://notes.example/api/v1/ai/generate/prepare"]);
    expect(events).toEqual([]);
  });
});

describe("AI provider CORS probe", () => {
  const openaiTarget = {
    provider: "openai-compatible",
    baseUrl: "https://api.example/v1",
    modelId: "demo",
  };

  test("POSTs a dummy key and treats a readable 401 as CORS success", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start() {},
      cancel() {
        cancelled = true;
      },
    });
    const allowed = await probeAiProviderCors(openaiTarget, async (url, init) => {
      expect(String(url)).toBe("https://api.example/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect(init?.mode).toBe("cors");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer edgeever-cors-probe");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Accept")).toBe("text/event-stream");
      expect(JSON.parse(String(init?.body)).stream).toBe(true);
      return new Response(body, { status: 401 });
    });
    expect(allowed).toBe(true);
    expect(cancelled).toBe(true);
  });

  test("sends Anthropic and Google dummy credentials on the real provider paths", async () => {
    const anthropicAllowed = await probeAiProviderCors({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      modelId: "claude",
    }, async (url, init) => {
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("edgeever-cors-probe");
      return new Response("{}", { status: 401 });
    });
    const googleAllowed = await probeAiProviderCors({
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      modelId: "models/gemini-2.5-flash",
    }, async (url, init) => {
      expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("edgeever-cors-probe");
      return new Response("{}", { status: 403 });
    });
    expect(anthropicAllowed).toBe(true);
    expect(googleAllowed).toBe(true);
  });

  test("returns false when the browser blocks the probe", async () => {
    const allowed = await probeAiProviderCors(openaiTarget, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(allowed).toBe(false);
  });

  test("rethrows when the caller aborts the probe", async () => {
    const signal = AbortSignal.abort();
    await expect(probeAiProviderCors(openaiTarget, async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }, signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
