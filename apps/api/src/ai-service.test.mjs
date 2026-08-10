import { describe, expect, test } from "bun:test";
import {
  aiActionInstructions,
  mapAiModelSettings,
  normalizeAiBaseUrl,
  decryptAiCredential,
  resolveAiCredentialEncryptionKeys,
  resolveCredentialEncryptionKey,
} from "./ai-service.ts";
import { encryptSecret } from "./secret-encryption.ts";

describe("AI model service", () => {
  test("limits the first release to note-processing instructions", () => {
    expect(Object.keys(aiActionInstructions).sort()).toEqual([
      "extract-key-points",
      "extract-todos",
      "rewrite-proofread",
      "summarize",
    ]);
    expect(aiActionInstructions["extract-todos"]).toContain("- [ ]");
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
    const settings = mapAiModelSettings({
      id: "ai_ws_personal",
      workspace_id: "ws_personal",
      provider: "openai-compatible",
      display_name: "My model",
      base_url: "https://models.example.com/v1",
      api_key_encrypted: "v1.secret.ciphertext",
      model_id: "model-a",
      is_enabled: 1,
    }, true);

    expect(settings).toEqual({
      provider: "openai-compatible",
      displayName: "My model",
      baseUrl: "https://models.example.com/v1",
      modelId: "model-a",
      isEnabled: true,
      hasApiKey: true,
      encryptionConfigured: true,
    });
    expect(JSON.stringify(settings)).not.toContain("ciphertext");
  });
});
