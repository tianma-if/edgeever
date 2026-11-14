import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { WebPluginSecretStore, decryptPluginSecret, encryptPluginSecret } from "./plugin-secret-store.ts";

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

  test("uses a fresh IV for every encryption of the same value", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const first = await encryptPluginSecret(key, "same");
    const second = await encryptPluginSecret(key, "same");

    expect(first.iv).toHaveLength(12);
    expect(Array.from(first.iv)).not.toEqual(Array.from(second.iv));
    expect(Array.from(new Uint8Array(first.ciphertext))).not.toEqual(Array.from(new Uint8Array(second.ciphertext)));
  });

  test("rejects decryption with a different key", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const otherKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const encrypted = await encryptPluginSecret(key, "edgeever-secret");

    await expect(decryptPluginSecret(otherKey, encrypted)).rejects.toThrow();
  });
});

const DATABASE_NAME = "edgeever-plugin-secrets-v1";

const requestDone = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionComplete = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error);
  transaction.onerror = () => reject(transaction.error);
});

const withRawDatabase = async (callback) => {
  const database = await requestDone(indexedDB.open(DATABASE_NAME));
  try {
    return await callback(database);
  } finally {
    database.close();
  }
};

const rawRecords = () => withRawDatabase(async (database) => {
  const transaction = database.transaction("secrets", "readonly");
  const records = await requestDone(transaction.objectStore("secrets").getAll());
  await transactionComplete(transaction);
  return records;
});

const rawKeyStore = () => withRawDatabase(async (database) => {
  const transaction = database.transaction("keys", "readonly");
  const store = transaction.objectStore("keys");
  const [keys, values] = await Promise.all([requestDone(store.getAllKeys()), requestDone(store.getAll())]);
  await transactionComplete(transaction);
  return { keys, values };
});

const rawWrite = (storeName, mutate) => withRawDatabase(async (database) => {
  const transaction = database.transaction(storeName, "readwrite");
  mutate(transaction.objectStore(storeName));
  await transactionComplete(transaction);
});

const bytesContain = (buffer, text) => {
  const haystack = Array.from(new Uint8Array(buffer)).join(",");
  const needle = Array.from(new TextEncoder().encode(text)).join(",");
  return haystack.includes(needle);
};

describe("WebPluginSecretStore", () => {
  const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true, writable: true });
  });

  afterEach(() => {
    if (originalIndexedDB) Object.defineProperty(globalThis, "indexedDB", originalIndexedDB);
    else delete globalThis.indexedDB;
  });

  test("returns null for a secret that was never stored", async () => {
    const store = new WebPluginSecretStore();
    expect(await store.get("com.example.alpha", "token")).toBeNull();
  });

  test("stores, reads and overwrites a secret", async () => {
    const store = new WebPluginSecretStore();
    await store.set("com.example.alpha", "token", "first");
    expect(await store.get("com.example.alpha", "token")).toBe("first");
    await store.set("com.example.alpha", "token", "second");
    expect(await store.get("com.example.alpha", "token")).toBe("second");
    expect(await rawRecords()).toHaveLength(1);
  });

  test("keeps secrets encrypted at rest under a non-extractable device key", async () => {
    const store = new WebPluginSecretStore();
    await store.set("com.example.alpha", "token", "sk-plaintext-value");

    const [record] = await rawRecords();
    expect(record.id).toBe("com.example.alpha:token");
    expect(Object.keys(record).sort()).toEqual(["ciphertext", "id", "iv"]);
    expect(record.iv).toHaveLength(12);
    expect(bytesContain(record.ciphertext, "sk-plaintext-value")).toBe(false);
    expect(JSON.stringify(record)).not.toContain("sk-plaintext-value");

    const { keys, values } = await rawKeyStore();
    expect(keys).toEqual(["device-master-key"]);
    expect(values[0]).toBeInstanceOf(CryptoKey);
    expect(values[0].extractable).toBe(false);
    expect(values[0].algorithm.name).toBe("AES-GCM");
  });

  test("reuses the persisted device key across store instances", async () => {
    await new WebPluginSecretStore().set("com.example.alpha", "token", "persisted");

    const reopened = new WebPluginSecretStore();
    expect(await reopened.get("com.example.alpha", "token")).toBe("persisted");
    await reopened.set("com.example.alpha", "other", "value");
    expect((await rawKeyStore()).keys).toEqual(["device-master-key"]);
  });

  test("creates a single device key for concurrent first writes", async () => {
    const store = new WebPluginSecretStore();
    await Promise.all([
      store.set("com.example.alpha", "a", "1"),
      store.set("com.example.alpha", "b", "2"),
      store.set("com.example.beta", "a", "3"),
    ]);

    const reopened = new WebPluginSecretStore();
    expect(await reopened.get("com.example.alpha", "a")).toBe("1");
    expect(await reopened.get("com.example.alpha", "b")).toBe("2");
    expect(await reopened.get("com.example.beta", "a")).toBe("3");
  });

  test("scopes secrets per plugin and key", async () => {
    const store = new WebPluginSecretStore();
    await store.set("com.example.alpha", "token", "alpha-token");
    await store.set("com.example.beta", "token", "beta-token");
    await store.set("com.example.alpha", "account.work", "alpha-work");

    expect(await store.get("com.example.alpha", "token")).toBe("alpha-token");
    expect(await store.get("com.example.beta", "token")).toBe("beta-token");
    expect(await store.get("com.example.alpha", "account.work")).toBe("alpha-work");
    expect(await store.get("com.example.beta", "account.work")).toBeNull();
  });

  test("removes a single secret without touching others", async () => {
    const store = new WebPluginSecretStore();
    await store.set("com.example.alpha", "token", "alpha-token");
    await store.set("com.example.alpha", "refresh", "alpha-refresh");
    await store.set("com.example.beta", "token", "beta-token");

    await store.remove("com.example.alpha", "token");
    await store.remove("com.example.alpha", "missing");

    expect(await store.get("com.example.alpha", "token")).toBeNull();
    expect(await store.get("com.example.alpha", "refresh")).toBe("alpha-refresh");
    expect(await store.get("com.example.beta", "token")).toBe("beta-token");
  });

  test("clears one plugin namespace without touching plugins that share a prefix", async () => {
    const store = new WebPluginSecretStore();
    await store.set("com.example.alpha", "token", "1");
    await store.set("com.example.alpha", "refresh", "2");
    await store.set("com.example.alphabet", "token", "3");
    await store.set("com.example.beta", "token", "4");

    await store.clearNamespace("com.example.alpha");

    expect(await store.get("com.example.alpha", "token")).toBeNull();
    expect(await store.get("com.example.alpha", "refresh")).toBeNull();
    expect(await store.get("com.example.alphabet", "token")).toBe("3");
    expect(await store.get("com.example.beta", "token")).toBe("4");
    expect((await rawRecords()).map((record) => record.id).sort()).toEqual([
      "com.example.alphabet:token",
      "com.example.beta:token",
    ]);
  });

  test("clearing an empty or unknown namespace is a no-op", async () => {
    const store = new WebPluginSecretStore();
    await store.clearNamespace("com.example.alpha");
    await store.set("com.example.beta", "token", "kept");
    await store.clearNamespace("com.example.alpha");
    expect(await store.get("com.example.beta", "token")).toBe("kept");
  });

  test("rejects a tampered ciphertext instead of returning corrupt data", async () => {
    const store = new WebPluginSecretStore();
    await store.set("com.example.alpha", "token", "original");
    const [record] = await rawRecords();
    const tampered = record.ciphertext.slice(0);
    new Uint8Array(tampered)[0] ^= 0xff;
    await rawWrite("secrets", (secrets) => secrets.put({ ...record, ciphertext: tampered }));

    await expect(new WebPluginSecretStore().get("com.example.alpha", "token")).rejects.toThrow();
  });

  test("rejects a secret whose IV no longer matches", async () => {
    const store = new WebPluginSecretStore();
    await store.set("com.example.alpha", "token", "original");
    const [record] = await rawRecords();
    await rawWrite("secrets", (secrets) => secrets.put({ ...record, iv: new Uint8Array(12) }));

    await expect(store.get("com.example.alpha", "token")).rejects.toThrow();
  });

  test("cannot read old secrets after the device key is lost, but can store new ones", async () => {
    await new WebPluginSecretStore().set("com.example.alpha", "token", "original");
    await rawWrite("keys", (keys) => keys.delete("device-master-key"));

    const store = new WebPluginSecretStore();
    await expect(store.get("com.example.alpha", "token")).rejects.toThrow();
    await store.set("com.example.alpha", "token", "replacement");
    expect(await store.get("com.example.alpha", "token")).toBe("replacement");
  });

  test("surfaces a database that exists without its object stores", async () => {
    const database = await requestDone(indexedDB.open(DATABASE_NAME, 1));
    database.close();
    // The current version already exists, so no upgrade runs to create the stores.
    await expect(new WebPluginSecretStore().get("com.example.alpha", "token")).rejects.toThrow();
  });

  test("surfaces an unavailable database", async () => {
    const database = await requestDone(indexedDB.open(DATABASE_NAME, 2));
    database.close();

    const store = new WebPluginSecretStore();
    await expect(store.get("com.example.alpha", "token")).rejects.toThrow();
    await expect(store.set("com.example.alpha", "token", "value")).rejects.toThrow();
  });
});

test("HTTP origins receive an actionable error without storing secrets in plaintext", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (bytes) => bytes } });
  try {
    await expect(encryptPluginSecret({}, "secret")).rejects.toThrow("require HTTPS or localhost");
    await expect(decryptPluginSecret({}, { iv: new Uint8Array(12), ciphertext: new ArrayBuffer(0) })).rejects.toThrow("require HTTPS or localhost");
  } finally { Object.defineProperty(globalThis, "crypto", original); }
});
