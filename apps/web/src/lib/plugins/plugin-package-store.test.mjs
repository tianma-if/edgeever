import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { WebPluginPackageStore } from "./plugin-package-store.ts";

const DATABASE_NAME = "edgeever-plugin-packages-v1";

const requestDone = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionComplete = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error);
  transaction.onerror = () => reject(transaction.error);
});

const pluginPackage = (pluginId, version, mainJs = `/* ${pluginId}@${version} */`) => ({
  pluginId,
  version,
  mainJs,
  stylesCss: null,
  checksums: { mainJs: `sha-${pluginId}-${version}`, manifestJson: "sha-manifest" },
  cachedAt: "2026-10-01T00:00:00.000Z",
});

const seedLegacyDatabase = async (records) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore("packages", { keyPath: "pluginId" });
  const database = await requestDone(request);
  const transaction = database.transaction("packages", "readwrite");
  for (const record of records) transaction.objectStore("packages").put(record);
  await transactionComplete(transaction);
  database.close();
};

const readRaw = async (storeName) => {
  const database = await requestDone(indexedDB.open(DATABASE_NAME));
  try {
    if (!database.objectStoreNames.contains(storeName)) return null;
    const transaction = database.transaction(storeName, "readonly");
    const values = await requestDone(transaction.objectStore(storeName).getAll());
    await transactionComplete(transaction);
    return values;
  } finally {
    database.close();
  }
};

describe("WebPluginPackageStore", () => {
  const originals = {
    indexedDB: Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    IDBKeyRange: Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange"),
  };
  const openStores = [];
  const createStore = () => {
    const store = new WebPluginPackageStore();
    openStores.push(store);
    return store;
  };

  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true, writable: true });
    Object.defineProperty(globalThis, "IDBKeyRange", { value: IDBKeyRange, configurable: true, writable: true });
  });

  afterEach(async () => {
    // Close connections so a later raw open in the same test is never blocked.
    for (const store of openStores.splice(0)) {
      await store["databasePromise"]?.then((database) => database.close(), () => undefined);
    }
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  test("returns null for a package that is not cached", async () => {
    expect(await createStore().get("com.example.alpha", "1.0.0")).toBeNull();
  });

  test("stores packages per plugin and version", async () => {
    const store = createStore();
    await store.put(pluginPackage("com.example.alpha", "1.0.0"));
    await store.put(pluginPackage("com.example.alpha", "1.1.0"));
    await store.put({ ...pluginPackage("com.example.beta", "1.0.0"), stylesCss: ".x{}", checksums: { mainJs: "a", manifestJson: "b", stylesCss: "c" } });

    expect(await store.get("com.example.alpha", "1.0.0")).toEqual(pluginPackage("com.example.alpha", "1.0.0"));
    expect((await store.get("com.example.alpha", "1.1.0")).mainJs).toBe("/* com.example.alpha@1.1.0 */");
    expect((await store.get("com.example.beta", "1.0.0")).stylesCss).toBe(".x{}");
    expect(await store.get("com.example.beta", "1.1.0")).toBeNull();
  });

  test("overwrites the same plugin version instead of duplicating it", async () => {
    const store = createStore();
    await store.put(pluginPackage("com.example.alpha", "1.0.0", "old()"));
    await store.put(pluginPackage("com.example.alpha", "1.0.0", "new()"));

    expect((await store.get("com.example.alpha", "1.0.0")).mainJs).toBe("new()");
    expect(await readRaw("packageVersions")).toHaveLength(1);
  });

  test("persists packages across store instances", async () => {
    const first = createStore();
    await first.put(pluginPackage("com.example.alpha", "1.0.0"));
    expect(await createStore().get("com.example.alpha", "1.0.0")).toEqual(pluginPackage("com.example.alpha", "1.0.0"));
  });

  test("removes a single version", async () => {
    const store = createStore();
    await store.put(pluginPackage("com.example.alpha", "1.0.0"));
    await store.put(pluginPackage("com.example.alpha", "1.1.0"));

    await store.remove("com.example.alpha", "1.0.0");

    expect(await store.get("com.example.alpha", "1.0.0")).toBeNull();
    expect(await store.get("com.example.alpha", "1.1.0")).not.toBeNull();
  });

  test("removes every version of one plugin only", async () => {
    const store = createStore();
    await store.put(pluginPackage("com.example.alpha", "1.0.0"));
    await store.put(pluginPackage("com.example.alpha", "1.1.0"));
    await store.put(pluginPackage("com.example.alphabet", "1.0.0"));
    await store.put(pluginPackage("com.example.beta", "2.0.0"));

    await store.remove("com.example.alpha");
    await store.remove("com.example.unknown");

    expect((await readRaw("packageVersions")).map((value) => `${value.pluginId}@${value.version}`).sort()).toEqual([
      "com.example.alphabet@1.0.0",
      "com.example.beta@2.0.0",
    ]);
  });

  describe("with a legacy single-version store", () => {
    test("upgrades the database and keeps the legacy records", async () => {
      await seedLegacyDatabase([pluginPackage("com.example.alpha", "1.0.0")]);
      const store = createStore();

      expect(await store.get("com.example.beta", "1.0.0")).toBeNull();
      expect(await readRaw("packages")).toHaveLength(1);
      expect(await readRaw("packageVersions")).toEqual([]);
    });

    test("serves a matching legacy package and copies it into the versioned store", async () => {
      const legacy = pluginPackage("com.example.alpha", "1.0.0");
      await seedLegacyDatabase([legacy]);
      const store = createStore();

      expect(await store.get("com.example.alpha", "1.0.0")).toEqual(legacy);
      expect(await readRaw("packageVersions")).toEqual([legacy]);
      expect(await store.get("com.example.alpha", "1.0.0")).toEqual(legacy);
      expect(await readRaw("packageVersions")).toHaveLength(1);
    });

    test("ignores a legacy package with a different version", async () => {
      await seedLegacyDatabase([pluginPackage("com.example.alpha", "1.0.0")]);
      const store = createStore();

      expect(await store.get("com.example.alpha", "2.0.0")).toBeNull();
      expect(await readRaw("packageVersions")).toEqual([]);
    });

    test("prefers the versioned store over the legacy record", async () => {
      await seedLegacyDatabase([pluginPackage("com.example.alpha", "1.0.0", "legacy()")]);
      const store = createStore();
      await store.put(pluginPackage("com.example.alpha", "1.0.0", "current()"));

      expect((await store.get("com.example.alpha", "1.0.0")).mainJs).toBe("current()");
    });

    test("removing all versions also drops the legacy record", async () => {
      await seedLegacyDatabase([pluginPackage("com.example.alpha", "1.0.0"), pluginPackage("com.example.beta", "1.0.0")]);
      const store = createStore();
      await store.put(pluginPackage("com.example.alpha", "2.0.0"));

      await store.remove("com.example.alpha");

      expect(await store.get("com.example.alpha", "1.0.0")).toBeNull();
      expect(await store.get("com.example.alpha", "2.0.0")).toBeNull();
      expect((await readRaw("packages")).map((value) => value.pluginId)).toEqual(["com.example.beta"]);
    });

    test("removing a matching version drops the legacy record", async () => {
      await seedLegacyDatabase([pluginPackage("com.example.alpha", "1.0.0")]);
      const store = createStore();

      await store.remove("com.example.alpha", "1.0.0");

      expect(await readRaw("packages")).toEqual([]);
      expect(await store.get("com.example.alpha", "1.0.0")).toBeNull();
    });

    test("removing a different version keeps the legacy record", async () => {
      await seedLegacyDatabase([pluginPackage("com.example.alpha", "1.0.0")]);
      const store = createStore();

      await store.remove("com.example.alpha", "0.9.0");
      await store.remove("com.example.unknown", "1.0.0");

      expect(await readRaw("packages")).toHaveLength(1);
      expect(await store.get("com.example.alpha", "1.0.0")).not.toBeNull();
    });
  });

  test("surfaces an unavailable database", async () => {
    const database = await requestDone(indexedDB.open(DATABASE_NAME, 3));
    database.close();

    const store = new WebPluginPackageStore();
    await expect(store.get("com.example.alpha", "1.0.0")).rejects.toThrow();
    await expect(store.put(pluginPackage("com.example.alpha", "1.0.0"))).rejects.toThrow();
  });
});
