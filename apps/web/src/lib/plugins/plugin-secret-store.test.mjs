import { describe, expect, test } from "bun:test";
import { decryptPluginSecret, encryptPluginSecret } from "./plugin-secret-store.ts";

describe("plugin secret encryption", () => {
  test("round-trips a secret with an authenticated AES-GCM payload", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const encrypted = await encryptPluginSecret(key, "edgeever-secret");

    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain("edgeever-secret");
    await expect(decryptPluginSecret(key, encrypted)).resolves.toBe("edgeever-secret");
  });

  test("rejects a modified ciphertext", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const encrypted = await encryptPluginSecret(key, "edgeever-secret");
    const modified = encrypted.ciphertext.slice(0);
    new Uint8Array(modified)[0] ^= 1;

    await expect(decryptPluginSecret(key, { ...encrypted, ciphertext: modified })).rejects.toThrow();
  });
});
