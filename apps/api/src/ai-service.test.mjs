import { describe, expect, test } from "bun:test";
import {
  aiActionInstructions,
  buildAiGenerationPrompt,
  discoverAiModels,
  mapAiProviderConfig,
  normalizeAiBaseUrl,
  resolveAiGenerationSystemInstruction,
  decryptAiCredential,
  resolveAiCredentialEncryptionKeys,
  resolveCredentialEncryptionKey,
} from "./ai-service.ts";
import { encryptSecret } from "./secret-encryption.ts";

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
    expect(aiActionInstructions["extract-todos"]).toContain("- [ ]");
    expect(resolveAiGenerationSystemInstruction({ action: "change-tone", tone: "friendly" }))
      .toContain("friendly tone");
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
      "Note title:\nPlan",
      "Note content:\nShip on Friday.",
    ].join("\n\n"));
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
