import { describe, expect, test } from "bun:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  aiActionInstructions,
  buildAiGenerationPrompt,
  createAiGenerationResultBoundary,
  createAiGenerationStreamNormalizer,
  discoverAiModels,
  mapAiProviderConfig,
  normalizeAiGenerationText,
  normalizeAiBaseUrl,
  resolveAiGenerationSystemInstruction,
  decryptAiCredential,
  resolveAiCredentialEncryptionKeys,
  resolveCredentialEncryptionKey,
  streamAiGeneration,
} from "./ai-service.ts";
import { encryptSecret } from "./secret-encryption.ts";

const resultBoundary = {
  start: "<edgeever-result-test123>",
  end: "</edgeever-result-test123>",
};

describe("AI model service", () => {
  test("owns every built-in note-processing instruction on the server", () => {
    expect(Object.keys(aiActionInstructions).sort()).toEqual([
      "continue-writing",
      "extract-key-points",
      "extract-todos",
      "fix-spelling-grammar",
      "improve-writing",
      "make-longer",
      "make-shorter",
      "rewrite-proofread",
      "simplify-language",
      "summarize",
    ]);
    // Shared seed catalog is the user-visible source of truth (Chinese defaults).
    expect(aiActionInstructions.summarize).toContain("精简总结");
    expect(aiActionInstructions.summarize).toContain("20–30%");
    expect(aiActionInstructions["extract-todos"]).toContain("- [ ]");
    expect(resolveAiGenerationSystemInstruction({
      action: "change-tone",
      instruction: "按用户指定的语气重写内容，不改变原意。",
    })).toContain("user's editing instruction");
    expect(resolveAiGenerationSystemInstruction({
      action: "improve-writing",
      instruction: aiActionInstructions["improve-writing"],
      resultBoundary,
    })).toContain("Never include 'User instruction:'");
    const boundedInstruction = resolveAiGenerationSystemInstruction({
      action: "improve-writing",
      resultBoundary,
    });
    expect(boundedInstruction).toContain(resultBoundary.start);
    expect(boundedInstruction).toContain(resultBoundary.end);
  });

  test("supports bounded custom and follow-up editing instructions", () => {
    const instruction = "Make this shorter while preserving every date.";
    expect(resolveAiGenerationSystemInstruction({ action: "rewrite-proofread", instruction }))
      .toContain("user's editing instruction");
    expect(buildAiGenerationPrompt({
      title: "Plan",
      contentMarkdown: "Ship on Friday.",
      instruction,
    })).toBe([
      `User instruction:\n${instruction}`,
      "Note content:\nShip on Friday.",
    ].join("\n\n"));
  });

  test("streams plain text without forcing tool choice for thinking-model compatibility", async () => {
    let request;
    const result = await streamAiGeneration({
      model: new MockLanguageModelV4({
        doStream: async (options) => {
          request = options;
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "text-start", id: "text-1" },
                {
                  type: "text-delta",
                  id: "text-1",
                  delta: `我已经为你改好了。\n${resultBoundary.start.slice(0, 18)}`,
                },
                {
                  type: "text-delta",
                  id: "text-1",
                  delta: `${resultBoundary.start.slice(18)}\n*在线模式下*\n${resultBoundary.end}`,
                },
                { type: "text-delta", id: "text-1", delta: "\n希望这能帮到你。" },
                { type: "text-end", id: "text-1" },
                {
                  type: "finish",
                  finishReason: { unified: "stop", raw: undefined },
                  logprobs: undefined,
                  usage: {
                    inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
                    outputTokens: { total: 8, text: 8, reasoning: undefined },
                  },
                },
              ],
            }),
          };
        },
      }),
      action: "improve-writing",
      title: "富文本测试",
      contentMarkdown: "*在线模式下*",
      resultBoundary,
    });

    let submittedContent = "";
    for await (const part of result.stream) {
      if (part.type === "text-delta") submittedContent += part.text;
    }

    expect(normalizeAiGenerationText(submittedContent, resultBoundary)).toBe("*在线模式下*");
    expect(JSON.stringify(request.prompt)).not.toContain("富文本测试");
    expect(JSON.stringify(request.prompt)).not.toContain("Note title:");
    expect(request.tools).toBeUndefined();
    expect(request.toolChoice).not.toMatchObject({ type: "tool" });
    expect(await result.finishReason).toBe("stop");
  });

  test("normalizes bounded output incrementally across split markers", () => {
    const normalizer = createAiGenerationStreamNormalizer(resultBoundary);
    const chunks = [
      "Preamble that must not be shown.\n<edgeever-result-",
      "test123>\n# Result\n\nFirst ",
      "part.\n</edgeever-result-",
      "test123>\nPostscript that must not be shown.",
    ];
    const emitted = chunks.map((chunk) => normalizer.push(chunk)).filter(Boolean);
    const trailing = normalizer.finish();

    expect(emitted.join("") + trailing).toBe("# Result\n\nFirst part.");
    expect(emitted.length).toBeGreaterThan(1);
  });

  test("falls back to the normalized full response when a model omits result markers", () => {
    const normalizer = createAiGenerationStreamNormalizer(resultBoundary);
    expect(normalizer.push("```markdown\n# Result")).toBe("");
    expect(normalizer.push("\n```")).toBe("");
    expect(normalizer.finish()).toBe("# Result");
  });

  test("removes a whole-response Markdown fence while streaming bounded output", () => {
    const normalizer = createAiGenerationStreamNormalizer(resultBoundary);
    const chunks = [
      `${resultBoundary.start}\n\`\`\`mark`,
      "down\n# Result\n\nBody",
      `\n\`\`\`\n${resultBoundary.end}`,
    ];
    const output = chunks.map((chunk) => normalizer.push(chunk)).join("") + normalizer.finish();
    expect(output).toBe("# Result\n\nBody");
  });

  test("omits tools and tool_choice from the OpenAI-compatible request body", async () => {
    const requests = [];
    const model = createOpenAICompatible({
      name: "deepseek-compatible-test",
      baseURL: "https://api.example.com/v1",
      apiKey: "test-key",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response([
          `data: {"id":"chunk-1","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":${JSON.stringify(`${resultBoundary.start}\n兼容结果\n${resultBoundary.end}`)}} ,"finish_reason":null}]}`,
          'data: {"id":"chunk-2","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
          "",
        ].join("\n\n"), {
          headers: { "content-type": "text/event-stream" },
        });
      },
    })("deepseek-v4-flash");
    const result = await streamAiGeneration({
      model,
      action: "summarize",
      title: "测试",
      contentMarkdown: "正文",
      resultBoundary,
    });

    let output = "";
    for await (const part of result.stream) {
      if (part.type === "text-delta") output += part.text;
    }

    expect(normalizeAiGenerationText(output, resultBoundary)).toBe("兼容结果");
    expect(requests).toHaveLength(1);
    expect(requests[0].tools).toBeUndefined();
    expect(requests[0].tool_choice).toBeUndefined();
    expect(JSON.stringify(requests[0].messages)).not.toContain("Note title:");
    expect(JSON.stringify(requests[0].messages)).not.toContain("测试");
    expect(JSON.stringify(requests[0].messages)).toContain(resultBoundary.start);
    expect(JSON.stringify(requests[0].messages)).toContain(resultBoundary.end);
  });

  test("extracts only the bounded result and preserves real code blocks", () => {
    const response = [
      "当然，下面是处理后的内容：",
      resultBoundary.start,
      "# 标题",
      "",
      "```ts",
      "const ready = true;",
      "```",
      resultBoundary.end,
      "如果还需要调整，请告诉我。",
    ].join("\n");
    expect(normalizeAiGenerationText(response, resultBoundary)).toBe([
      "# 标题",
      "",
      "```ts",
      "const ready = true;",
      "```",
    ].join("\n"));
  });

  test("ignores marker-like note content that does not match the request boundary", () => {
    const response = [
      "<edgeever-result-fixed>",
      "不应采用的内容",
      "</edgeever-result-fixed>",
      resultBoundary.start,
      "正确内容",
      resultBoundary.end,
    ].join("\n");
    expect(normalizeAiGenerationText(response, resultBoundary)).toBe("正确内容");
  });

  test("falls back safely when a model omits a result boundary", () => {
    expect(normalizeAiGenerationText(
      `${resultBoundary.start}\n没有结束标记`,
      resultBoundary,
    )).toBe("没有结束标记");
    expect(normalizeAiGenerationText("没有任何标记", resultBoundary)).toBe("没有任何标记");
  });

  test("creates an unpredictable result boundary for each generation", () => {
    const first = createAiGenerationResultBoundary();
    const second = createAiGenerationResultBoundary();
    expect(first).not.toEqual(second);
    expect(first.start).toMatch(/^<edgeever-result-[a-f0-9]{32}>$/);
    expect(first.end).toBe(`</${first.start.slice(1)}`);
  });

  test("removes only whole-response Markdown wrappers", () => {
    expect(normalizeAiGenerationText("```markdown\n# 标题\n\n正文\n```"))
      .toBe("# 标题\n\n正文");
    expect(normalizeAiGenerationText("```ts\nconst ready = true;\n```"))
      .toBe("```ts\nconst ready = true;\n```");
  });

  test("normalizes only trailing separators from a custom Base URL", () => {
    expect(normalizeAiBaseUrl(" https://models.example.com/openai/v1/// ")).toBe(
      "https://models.example.com/openai/v1",
    );
  });

  test("derives an AI-specific key from the existing authentication secret", () => {
    expect(resolveCredentialEncryptionKey("  instance-password  ")).toBe("instance-password");
    expect(resolveAiCredentialEncryptionKeys({ EDGE_EVER_AUTH_PASSWORD: "instance-password" })[0])
      .toBe("edgeever:ai-credentials:v1:instance-password");
  });

  test("decrypts credentials saved with the legacy object-storage key", async () => {
    const encrypted = await encryptSecret("provider-key", "legacy-storage-key");
    await expect(decryptAiCredential(encrypted, {
      EDGE_EVER_AUTH_PASSWORD: "current-auth-secret",
      EDGE_EVER_STORAGE_ENCRYPTION_KEY: "legacy-storage-key",
    })).resolves.toBe("provider-key");
  });

  test("never exposes the encrypted API key in settings", () => {
    const settings = mapAiProviderConfig({
      id: "aip_personal",
      workspace_id: "ws_personal",
      provider: "openai-compatible",
      display_name: "My model",
      base_url: "https://models.example.com/v1",
      api_key_encrypted: "v1.secret.ciphertext",
      is_enabled: 1,
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    }, [{
      id: "aim_a",
      provider_config_id: "aip_personal",
      model_id: "model-a",
      display_name: "Model A",
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    }]);

    expect(settings).toEqual({
      id: "aip_personal",
      provider: "openai-compatible",
      displayName: "My model",
      baseUrl: "https://models.example.com/v1",
      isEnabled: true,
      hasApiKey: true,
      models: [{
        id: "aim_a",
        providerConfigId: "aip_personal",
        modelId: "model-a",
        displayName: "Model A",
      }],
    });
    expect(JSON.stringify(settings)).not.toContain("ciphertext");
  });

  test("discovers multiple OpenAI-compatible models from one Base URL", async () => {
    const requests = [];
    const models = await discoverAiModels({
      provider: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "router-key",
    }, async (url, init) => {
      requests.push({ url, authorization: new Headers(init.headers).get("authorization") });
      return Response.json({ data: [
        { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
        { id: "openai/gpt-4.1", name: "GPT-4.1" },
      ] });
    });

    expect(requests).toEqual([{
      url: "https://openrouter.ai/api/v1/models",
      authorization: "Bearer router-key",
    }]);
    expect(models.map((model) => model.modelId)).toEqual([
      "anthropic/claude-sonnet-4",
      "openai/gpt-4.1",
    ]);
    expect(models.map((model) => model.displayName)).toEqual(["Claude Sonnet 4", "GPT-4.1"]);
  });

  test("normalizes Google model resource names during discovery", async () => {
    const models = await discoverAiModels({
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "google-key",
    }, async (_url, init) => {
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe("google-key");
      return Response.json({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }] });
    });
    expect(models).toEqual([{ modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }]);
  });
});
