import { describe, expect, test } from "bun:test";
import {
  resolveObjectStorageEncryptionKeys,
  resolvePrimaryObjectStorageEncryptionKey,
  resolveStoredObjectStorageSecret,
} from "./object-storage.ts";
import { decryptSecret, encryptSecret } from "./secret-encryption.ts";

const objectStorageRow = (encryptedSecret) => ({
  id: "instance-s3",
  provider: "s3",
  display_name: "S3",
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "edgeever",
  access_key_id: "access-key",
  secret_access_key_encrypted: encryptedSecret,
  force_path_style: 1,
  object_prefix: "edgeever",
  is_active: 1,
});

const migrationDatabase = () => {
  const updates = [];
  return {
    updates,
    prepare: () => ({
      bind: (...values) => ({
        run: async () => {
          updates.push(values);
          return { success: true };
        },
      }),
    }),
  };
};

describe("object storage credential encryption", () => {
  test("derives a purpose-specific key from instance authentication", () => {
    const environment = { EDGE_EVER_AUTH_PASSWORD: "instance-auth-secret" };

    expect(resolvePrimaryObjectStorageEncryptionKey(environment))
      .toBe("edgeever:object-storage:v1:instance-auth-secret");
    expect(resolveObjectStorageEncryptionKeys(environment)).not.toContain("instance-auth-secret");
  });

  test("never uses the legacy object-storage key for new credentials", () => {
    const environment = { EDGE_EVER_STORAGE_ENCRYPTION_KEY: "legacy-storage-key" };

    expect(resolvePrimaryObjectStorageEncryptionKey(environment)).toBeUndefined();
    expect(resolveObjectStorageEncryptionKeys(environment)).toEqual(["legacy-storage-key"]);
  });

  test("migrates a legacy object-storage credential after decrypting it", async () => {
    const plaintext = "legacy-secret-access-key";
    const legacyKey = "legacy-storage-key";
    const environment = {
      EDGE_EVER_AUTH_PASSWORD: "instance-auth-secret",
      EDGE_EVER_STORAGE_ENCRYPTION_KEY: legacyKey,
    };
    const row = objectStorageRow(await encryptSecret(plaintext, legacyKey));
    const database = migrationDatabase();

    expect(await resolveStoredObjectStorageSecret(database, row, environment)).toBe(plaintext);
    expect(database.updates).toHaveLength(1);
    const [migratedSecret, configId] = database.updates[0];
    expect(configId).toBe("instance-s3");
    expect(await decryptSecret(
      migratedSecret,
      resolvePrimaryObjectStorageEncryptionKey(environment),
    )).toBe(plaintext);
  });

  test("does not rewrite a credential already encrypted with the auth-derived key", async () => {
    const environment = { EDGE_EVER_AUTH_PASSWORD_HASH: "stable-auth-hash" };
    const encrypted = await encryptSecret(
      "current-secret-access-key",
      resolvePrimaryObjectStorageEncryptionKey(environment),
    );
    const database = migrationDatabase();

    expect(await resolveStoredObjectStorageSecret(
      database,
      objectStorageRow(encrypted),
      environment,
    )).toBe("current-secret-access-key");
    expect(database.updates).toHaveLength(0);
  });
});
