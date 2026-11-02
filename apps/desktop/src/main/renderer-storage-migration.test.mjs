import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInThisContext } from "node:vm";
import {
  RENDERER_STORAGE_MIGRATION_MARKER,
  RENDERER_STORAGE_MIGRATION_VERSION,
  exportLegacyRendererStorage,
  importRendererStorage,
  migrateRendererStorageOrigin,
  rendererStorageMigrationDatabaseNames,
} from "./renderer-storage-migration.mjs";

describe("renderer storage origin migration", () => {
  test("covers every persistent IndexedDB database", () => {
    expect(rendererStorageMigrationDatabaseNames()).toEqual([
      "edgeever-local",
      "edgeever-plugin-packages-v1",
      "edgeever-plugin-secrets-v1",
    ]);
  });

  test("writes the marker only after export and import both succeed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-origin-migration-"));
    const markerPath = join(directory, RENDERER_STORAGE_MIGRATION_MARKER);
    const loadedUrls = [];
    const destroyed = [];
    const snapshot = { version: 1, localStorageEntries: [["theme", "dark"]], databases: [], pluginSecrets: [] };
    let executionIndex = 0;
    const createWindow = () => {
      let isDestroyed = false;
      return {
        async loadURL(url) { loadedUrls.push(url); },
        destroy() { isDestroyed = true; destroyed.push(0); },
        isDestroyed() { return isDestroyed; },
        webContents: {
          async executeJavaScript() {
            return executionIndex++ === 0 ? snapshot : { localStorageEntries: 1, databases: 0, pluginSecrets: 0 };
          },
        },
      };
    };

    try {
      const result = await migrateRendererStorageOrigin({
        createWindow,
        legacyBridgeUrl: "file:///bundle/desktop-storage-bridge.html",
        targetBridgeUrl: "edgeever-app://app/desktop-storage-bridge.html",
        markerPath,
      });
      expect(result.state).toBe("migrated");
      expect(loadedUrls).toEqual([
        "file:///bundle/desktop-storage-bridge.html",
        "edgeever-app://app/desktop-storage-bridge.html",
      ]);
      expect(destroyed).toEqual([0]);
      expect(JSON.parse(await readFile(markerPath, "utf8"))).toMatchObject({
        version: 1,
        counts: { localStorageEntries: 1, databases: 0, pluginSecrets: 0 },
      });

      const second = await migrateRendererStorageOrigin({
        createWindow: () => { throw new Error("should not create a window"); },
        legacyBridgeUrl: "file:///ignored",
        targetBridgeUrl: "edgeever-app://app/ignored",
        markerPath,
      });
      expect(second.state).toBe("already-migrated");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("does not mark a failed import as migrated", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-origin-migration-failure-"));
    const markerPath = join(directory, RENDERER_STORAGE_MIGRATION_MARKER);
    let executionIndex = 0;
    try {
      await expect(migrateRendererStorageOrigin({
        createWindow: () => {
          let destroyed = false;
          return {
            async loadURL() {},
            destroy() { destroyed = true; },
            isDestroyed() { return destroyed; },
            webContents: {
              async executeJavaScript() {
                if (executionIndex++ === 0) return { version: 1, localStorageEntries: [], databases: [], pluginSecrets: [] };
                throw new Error("import failed");
              },
            },
          };
        },
        legacyBridgeUrl: "file:///bundle/desktop-storage-bridge.html",
        targetBridgeUrl: "edgeever-app://app/desktop-storage-bridge.html",
        markerPath,
      })).rejects.toThrow("import failed");
      expect(await Bun.file(markerPath).exists()).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const requestDone = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionComplete = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error);
  transaction.onerror = () => reject(transaction.error);
});

const createLocalStorage = (initial = []) => {
  const entries = new Map(initial);
  return {
    get length() { return entries.size; },
    key(index) { return Array.from(entries.keys())[index] ?? null; },
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
    clear() { entries.clear(); },
    entries() { return Array.from(entries.entries()); },
  };
};

const createOrigin = (localStorageEntries = []) => ({
  indexedDB: new IDBFactory(),
  localStorage: createLocalStorage(localStorageEntries),
});

const originalGlobals = {
  indexedDB: Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
  localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
};

const activateOrigin = (origin) => {
  Object.defineProperty(globalThis, "indexedDB", { value: origin.indexedDB, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: origin.localStorage, configurable: true, writable: true });
};

const restoreGlobals = () => {
  for (const [name, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
};

const openDatabase = (factory, name, version, upgrade) => {
  const request = factory.open(name, version);
  if (upgrade) request.onupgradeneeded = () => upgrade(request.result);
  return requestDone(request);
};

const readStore = async (factory, databaseName, storeName) => {
  const database = await openDatabase(factory, databaseName);
  try {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const [keys, values] = await Promise.all([requestDone(store.getAllKeys()), requestDone(store.getAll())]);
    await transactionComplete(transaction);
    return keys.map((key, index) => ({ key, value: values[index] }));
  } finally {
    database.close();
  }
};

const seedLegacyNotes = async (factory) => {
  const database = await openDatabase(factory, "edgeever-local", 60, (db) => {
    const memos = db.createObjectStore("memos", { keyPath: ["scope", "id"] });
    memos.createIndex("notebookId", "notebookId");
    memos.createIndex("tags", "tags", { multiEntry: true });
    const syncQueue = db.createObjectStore("syncQueue", { keyPath: "id" });
    syncQueue.createIndex("id", "id", { unique: true });
    db.createObjectStore("counters", { autoIncrement: true });
    db.createObjectStore("outOfLine");
  });
  const transaction = database.transaction(["memos", "syncQueue", "counters", "outOfLine"], "readwrite");
  transaction.objectStore("memos").put({ scope: "local", id: "memo-1", notebookId: "nb-1", tags: ["a", "b"], title: "First" });
  transaction.objectStore("memos").put({ scope: "local", id: "memo-2", notebookId: "nb-2", tags: [], title: "Second </script>" });
  transaction.objectStore("syncQueue").put({ id: "op-1", memoId: "memo-1", status: "pending" });
  transaction.objectStore("counters").put({ value: 1 });
  transaction.objectStore("counters").put({ value: 2 });
  transaction.objectStore("outOfLine").put({ note: "out of line" }, "custom-key");
  await transactionComplete(transaction);
  database.close();
};

const seedLegacyPackages = async (factory) => {
  const database = await openDatabase(factory, "edgeever-plugin-packages-v1", 2, (db) => {
    const store = db.createObjectStore("packageVersions", { keyPath: ["pluginId", "version"] });
    store.createIndex("pluginId", "pluginId");
  });
  const transaction = database.transaction("packageVersions", "readwrite");
  transaction.objectStore("packageVersions").put({ pluginId: "com.example.alpha", version: "1.0.0", mainJs: "main()", stylesCss: null });
  await transactionComplete(transaction);
  database.close();
};

const seedLegacySecrets = async (factory, secrets, { withKey = true } = {}) => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const database = await openDatabase(factory, "edgeever-plugin-secrets-v1", 1, (db) => {
    db.createObjectStore("keys");
    db.createObjectStore("secrets", { keyPath: "id" });
  });
  const records = await Promise.all(secrets.map(async ([id, value]) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
    return { id, iv, ciphertext };
  }));
  const transaction = database.transaction(["keys", "secrets"], "readwrite");
  if (withKey) transaction.objectStore("keys").put(key, "device-master-key");
  for (const record of records) transaction.objectStore("secrets").put(record);
  await transactionComplete(transaction);
  database.close();
};

const readPluginSecrets = async (factory) => {
  const database = await openDatabase(factory, "edgeever-plugin-secrets-v1");
  try {
    const transaction = database.transaction(["keys", "secrets"], "readonly");
    const key = await requestDone(transaction.objectStore("keys").get("device-master-key"));
    const records = await requestDone(transaction.objectStore("secrets").getAll());
    await transactionComplete(transaction);
    const values = {};
    for (const record of records) {
      values[record.id] = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, key, record.ciphertext));
    }
    return { key, records, values };
  } finally {
    database.close();
  }
};

const databaseNames = async (factory) => (await factory.databases()).map((entry) => entry.name).sort();

const seedFullLegacyOrigin = async () => {
  const legacy = createOrigin([["theme", "dark"], ["edgeever:session", "{\"user\":\"u1\"}"]]);
  await seedLegacyNotes(legacy.indexedDB);
  await seedLegacyPackages(legacy.indexedDB);
  await seedLegacySecrets(legacy.indexedDB, [["com.example.alpha:token", "alpha-secret"], ["com.example.beta:token", "beta-secret"]]);
  return legacy;
};

// Mirrors how Electron moves the snapshot: the export result crosses IPC via
// structured clone and the import argument is embedded as JSON source text.
const transferSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));

describe("exportLegacyRendererStorage", () => {
  afterEach(restoreGlobals);

  test("returns an empty snapshot for an origin without stored data", async () => {
    activateOrigin(createOrigin());
    expect(await exportLegacyRendererStorage()).toEqual({
      version: 1,
      localStorageEntries: [],
      databases: [],
      pluginSecrets: [],
    });
  });

  test("captures schemas, records, decrypted plugin secrets and localStorage", async () => {
    const legacy = await seedFullLegacyOrigin();
    await openDatabase(legacy.indexedDB, "unrelated-database", 1, (db) => db.createObjectStore("items")).then((db) => db.close());
    activateOrigin(legacy);

    const snapshot = await exportLegacyRendererStorage();

    expect(snapshot.version).toBe(1);
    expect(snapshot.localStorageEntries).toEqual([["theme", "dark"], ["edgeever:session", "{\"user\":\"u1\"}"]]);
    expect(snapshot.databases.map((database) => database.name)).toEqual(["edgeever-local", "edgeever-plugin-packages-v1"]);
    const notes = snapshot.databases[0];
    expect(notes.version).toBe(60);
    const memos = notes.stores.find((store) => store.name === "memos");
    expect(memos.keyPath).toEqual(["scope", "id"]);
    expect(memos.autoIncrement).toBe(false);
    expect(memos.indexes).toEqual(expect.arrayContaining([
      { name: "notebookId", keyPath: "notebookId", multiEntry: false, unique: false },
      { name: "tags", keyPath: "tags", multiEntry: true, unique: false },
    ]));
    expect(memos.records).toHaveLength(2);
    expect(memos.records[0].key).toEqual(["local", "memo-1"]);
    const counters = notes.stores.find((store) => store.name === "counters");
    expect(counters.autoIncrement).toBe(true);
    expect(counters.keyPath).toBeNull();
    expect(counters.records).toEqual([{ key: 1, value: { value: 1 } }, { key: 2, value: { value: 2 } }]);
    expect(notes.stores.find((store) => store.name === "outOfLine").records).toEqual([
      { key: "custom-key", value: { note: "out of line" } },
    ]);
    expect(snapshot.pluginSecrets).toEqual([
      { id: "com.example.alpha:token", value: "alpha-secret" },
      { id: "com.example.beta:token", value: "beta-secret" },
    ]);
  });

  test("leaves the legacy origin untouched", async () => {
    const legacy = await seedFullLegacyOrigin();
    activateOrigin(legacy);
    await exportLegacyRendererStorage();

    expect(await databaseNames(legacy.indexedDB)).toEqual([
      "edgeever-local",
      "edgeever-plugin-packages-v1",
      "edgeever-plugin-secrets-v1",
    ]);
    expect(await readStore(legacy.indexedDB, "edgeever-local", "memos")).toHaveLength(2);
    expect((await readPluginSecrets(legacy.indexedDB)).values["com.example.alpha:token"]).toBe("alpha-secret");
    expect(legacy.localStorage.entries()).toHaveLength(2);
  });

  test("fails instead of dropping secrets when the device key is missing", async () => {
    const legacy = createOrigin();
    await seedLegacySecrets(legacy.indexedDB, [["com.example.alpha:token", "alpha-secret"]], { withKey: false });
    activateOrigin(legacy);

    await expect(exportLegacyRendererStorage()).rejects.toThrow("Plugin secret key is missing");
  });

  test("fails when a stored secret cannot be decrypted", async () => {
    const legacy = createOrigin();
    await seedLegacySecrets(legacy.indexedDB, [["com.example.alpha:token", "alpha-secret"]]);
    const database = await openDatabase(legacy.indexedDB, "edgeever-plugin-secrets-v1");
    const transaction = database.transaction("secrets", "readwrite");
    transaction.objectStore("secrets").put({ id: "com.example.alpha:token", iv: new Uint8Array(12), ciphertext: new Uint8Array(32).buffer });
    await transactionComplete(transaction);
    database.close();
    activateOrigin(legacy);

    await expect(exportLegacyRendererStorage()).rejects.toThrow();
  });

  test("tolerates a secret key without secrets and a secret database without stores", async () => {
    const withKeyOnly = createOrigin();
    await seedLegacySecrets(withKeyOnly.indexedDB, []);
    activateOrigin(withKeyOnly);
    expect((await exportLegacyRendererStorage()).pluginSecrets).toEqual([]);

    const withoutStores = createOrigin();
    await openDatabase(withoutStores.indexedDB, "edgeever-plugin-secrets-v1", 1).then((db) => db.close());
    activateOrigin(withoutStores);
    expect((await exportLegacyRendererStorage()).pluginSecrets).toEqual([]);
  });
});

describe("importRendererStorage", () => {
  afterEach(restoreGlobals);

  test("rejects missing or unsupported snapshots before touching storage", async () => {
    const target = createOrigin([["keep", "me"]]);
    activateOrigin(target);
    await expect(importRendererStorage(null)).rejects.toThrow("Unsupported renderer storage migration snapshot");
    await expect(importRendererStorage({ version: 2, localStorageEntries: [], databases: [], pluginSecrets: [] }))
      .rejects.toThrow("Unsupported renderer storage migration snapshot");
    expect(target.localStorage.entries()).toEqual([["keep", "me"]]);
  });

  test("restores every record, schema and secret into the new origin", async () => {
    const legacy = await seedFullLegacyOrigin();
    activateOrigin(legacy);
    const snapshot = transferSnapshot(await exportLegacyRendererStorage());

    const target = createOrigin([["stale", "value"]]);
    activateOrigin(target);
    const counts = await importRendererStorage(snapshot);

    expect(counts).toEqual({ localStorageEntries: 2, databases: 2, pluginSecrets: 2 });
    expect(target.localStorage.entries()).toEqual([["theme", "dark"], ["edgeever:session", "{\"user\":\"u1\"}"]]);
    expect(await readStore(target.indexedDB, "edgeever-local", "memos")).toEqual(await readStore(legacy.indexedDB, "edgeever-local", "memos"));
    expect(await readStore(target.indexedDB, "edgeever-local", "syncQueue")).toEqual(await readStore(legacy.indexedDB, "edgeever-local", "syncQueue"));
    expect(await readStore(target.indexedDB, "edgeever-local", "counters")).toEqual(await readStore(legacy.indexedDB, "edgeever-local", "counters"));
    expect(await readStore(target.indexedDB, "edgeever-local", "outOfLine")).toEqual([{ key: "custom-key", value: { note: "out of line" } }]);
    expect(await readStore(target.indexedDB, "edgeever-plugin-packages-v1", "packageVersions")).toHaveLength(1);

    const database = await openDatabase(target.indexedDB, "edgeever-local");
    try {
      expect(database.version).toBe(60);
      const transaction = database.transaction(["memos", "syncQueue", "counters"], "readwrite");
      const memos = transaction.objectStore("memos");
      expect(memos.index("tags").multiEntry).toBe(true);
      expect(transaction.objectStore("syncQueue").index("id").unique).toBe(true);
      expect(await requestDone(memos.index("tags").getAll("b"))).toHaveLength(1);
      expect(await requestDone(transaction.objectStore("counters").add({ value: 3 }))).toBe(3);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }

    const secrets = await readPluginSecrets(target.indexedDB);
    expect(secrets.values).toEqual({
      "com.example.alpha:token": "alpha-secret",
      "com.example.beta:token": "beta-secret",
    });
    expect(secrets.key.extractable).toBe(false);
    for (const record of secrets.records) {
      expect(record.iv).toHaveLength(12);
      expect(new TextDecoder().decode(record.ciphertext)).not.toContain("secret");
    }
  });

  test("is idempotent: importing the same snapshot twice does not duplicate records", async () => {
    const legacy = await seedFullLegacyOrigin();
    activateOrigin(legacy);
    const snapshot = transferSnapshot(await exportLegacyRendererStorage());

    const target = createOrigin();
    activateOrigin(target);
    await importRendererStorage(snapshot);
    await importRendererStorage(snapshot);

    expect(await readStore(target.indexedDB, "edgeever-local", "memos")).toHaveLength(2);
    expect(await readStore(target.indexedDB, "edgeever-local", "counters")).toEqual([
      { key: 1, value: { value: 1 } },
      { key: 2, value: { value: 2 } },
    ]);
    expect(Object.keys((await readPluginSecrets(target.indexedDB)).values)).toHaveLength(2);
    expect(target.localStorage.entries()).toHaveLength(2);
  });

  test("replaces stale target data and removes stale plugin secrets when none are migrated", async () => {
    const target = createOrigin();
    await seedLegacyNotes(target.indexedDB);
    await seedLegacySecrets(target.indexedDB, [["com.example.stale:token", "stale"]]);
    activateOrigin(target);

    const counts = await importRendererStorage({
      version: 1,
      localStorageEntries: [["valid", "yes"], ["number", 1], [2, "key"], ["null", null]],
      databases: [{
        name: "edgeever-local",
        version: 60,
        stores: [{ name: "memos", keyPath: ["scope", "id"], autoIncrement: false, indexes: [], records: [
          { key: ["local", "memo-9"], value: { scope: "local", id: "memo-9" } },
        ] }],
      }, {
        name: "edgeever-plugin-packages-v1",
        version: 2,
        stores: [],
      }],
      pluginSecrets: [],
    });

    expect(counts).toEqual({ localStorageEntries: 4, databases: 2, pluginSecrets: 0 });
    expect(target.localStorage.entries()).toEqual([["valid", "yes"]]);
    expect(await readStore(target.indexedDB, "edgeever-local", "memos")).toEqual([
      { key: ["local", "memo-9"], value: { scope: "local", id: "memo-9" } },
    ]);
    const database = await openDatabase(target.indexedDB, "edgeever-local");
    expect(Array.from(database.objectStoreNames)).toEqual(["memos"]);
    database.close();
    const packages = await openDatabase(target.indexedDB, "edgeever-plugin-packages-v1");
    expect(packages.version).toBe(2);
    expect(Array.from(packages.objectStoreNames)).toEqual([]);
    packages.close();
    expect(await databaseNames(target.indexedDB)).toEqual(["edgeever-local", "edgeever-plugin-packages-v1"]);
  });

  test("rejects when an open connection blocks the reset and succeeds once it is released", async () => {
    const legacy = await seedFullLegacyOrigin();
    activateOrigin(legacy);
    const snapshot = transferSnapshot(await exportLegacyRendererStorage());

    const target = createOrigin();
    await seedLegacyNotes(target.indexedDB);
    const blocker = await openDatabase(target.indexedDB, "edgeever-local");
    activateOrigin(target);

    await expect(importRendererStorage(snapshot)).rejects.toThrow("Reset of edgeever-local was blocked");
    blocker.close();

    expect(await importRendererStorage(snapshot)).toEqual({ localStorageEntries: 2, databases: 2, pluginSecrets: 2 });
    expect(await readStore(target.indexedDB, "edgeever-local", "memos")).toEqual(await readStore(legacy.indexedDB, "edgeever-local", "memos"));
    expect(Object.keys((await readPluginSecrets(target.indexedDB)).values)).toHaveLength(2);
  });
});

const createEvaluatingWindow = (origins, log) => () => {
  let destroyed = false;
  return {
    async loadURL(url) {
      log.push(["load", url]);
      if (!origins[url]) throw new Error(`Cannot load ${url}`);
      activateOrigin(origins[url]);
    },
    destroy() { destroyed = true; log.push(["destroy"]); },
    isDestroyed() { return destroyed; },
    webContents: {
      async executeJavaScript(code, userGesture) {
        log.push(["execute", code, userGesture]);
        // Runs the injected script in the global scope, like the renderer would.
        return structuredClone(await runInThisContext(code));
      },
    },
  };
};

describe("migrateRendererStorageOrigin end to end", () => {
  let directory;
  let markerPath;
  const legacyBridgeUrl = "file:///bundle/desktop-storage-bridge.html";
  const targetBridgeUrl = "edgeever-app://app/desktop-storage-bridge.html";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "edgeever-origin-migration-e2e-"));
    markerPath = join(directory, RENDERER_STORAGE_MIGRATION_MARKER);
  });

  afterEach(async () => {
    restoreGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  test("moves all data to the new origin, keeps the legacy copy and writes the marker", async () => {
    const legacy = await seedFullLegacyOrigin();
    const target = createOrigin();
    const log = [];

    const result = await migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow({ [legacyBridgeUrl]: legacy, [targetBridgeUrl]: target }, log),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    });

    expect(result).toEqual({ state: "migrated", counts: { localStorageEntries: 2, databases: 2, pluginSecrets: 2 } });
    expect(log.map(([kind, value]) => (kind === "execute" ? kind : value ? `${kind}:${value}` : kind))).toEqual([
      `load:${legacyBridgeUrl}`,
      "execute",
      `load:${targetBridgeUrl}`,
      "execute",
      "destroy",
    ]);
    const importCode = log.filter(([kind]) => kind === "execute")[1][1];
    expect(importCode).not.toContain("</script>");
    expect(log.filter(([kind]) => kind === "execute").every(([, , userGesture]) => userGesture === true)).toBe(true);

    expect(await readStore(target.indexedDB, "edgeever-local", "memos")).toEqual(await readStore(legacy.indexedDB, "edgeever-local", "memos"));
    expect((await readStore(target.indexedDB, "edgeever-local", "memos"))[1].value.title).toBe("Second </script>");
    expect((await readPluginSecrets(target.indexedDB)).values["com.example.beta:token"]).toBe("beta-secret");
    expect(target.localStorage.entries()).toEqual(legacy.localStorage.entries());
    expect(await databaseNames(legacy.indexedDB)).toHaveLength(3);

    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    expect(marker.version).toBe(RENDERER_STORAGE_MIGRATION_VERSION);
    expect(Number.isNaN(Date.parse(marker.migratedAt))).toBe(false);
    expect(await Bun.file(`${markerPath}.tmp`).exists()).toBe(false);

    const again = await migrateRendererStorageOrigin({
      createWindow: () => { throw new Error("should not create a window"); },
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    });
    expect(again).toEqual({ state: "already-migrated" });
  });

  test("an interrupted export leaves no marker and no target data, and a retry completes", async () => {
    const legacy = createOrigin([["theme", "dark"]]);
    await seedLegacyNotes(legacy.indexedDB);
    await seedLegacySecrets(legacy.indexedDB, [["com.example.alpha:token", "alpha-secret"]], { withKey: false });
    const target = createOrigin([["target-only", "kept"]]);
    const log = [];

    await expect(migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow({ [legacyBridgeUrl]: legacy, [targetBridgeUrl]: target }, log),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    })).rejects.toThrow("Plugin secret key is missing");

    expect(log.at(-1)).toEqual(["destroy"]);
    expect(log.some(([kind, url]) => kind === "load" && url === targetBridgeUrl)).toBe(false);
    expect(await Bun.file(markerPath).exists()).toBe(false);
    expect(await databaseNames(target.indexedDB)).toEqual([]);
    expect(target.localStorage.entries()).toEqual([["target-only", "kept"]]);

    const database = await openDatabase(legacy.indexedDB, "edgeever-plugin-secrets-v1");
    const transaction = database.transaction("secrets", "readwrite");
    transaction.objectStore("secrets").clear();
    await transactionComplete(transaction);
    database.close();

    const retry = await migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow({ [legacyBridgeUrl]: legacy, [targetBridgeUrl]: target }, []),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    });
    expect(retry.state).toBe("migrated");
    expect(await readStore(target.indexedDB, "edgeever-local", "memos")).toHaveLength(2);
    expect(await Bun.file(markerPath).exists()).toBe(true);
  });

  test("a failed import followed by a retry yields exactly one copy of each record", async () => {
    const legacy = await seedFullLegacyOrigin();
    const target = createOrigin();
    await seedLegacyNotes(target.indexedDB);
    const blocker = await openDatabase(target.indexedDB, "edgeever-local");
    const origins = { [legacyBridgeUrl]: legacy, [targetBridgeUrl]: target };

    await expect(migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow(origins, []),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    })).rejects.toThrow("was blocked");
    expect(await Bun.file(markerPath).exists()).toBe(false);
    blocker.close();

    expect((await migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow(origins, []),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    })).state).toBe("migrated");
    expect(await readStore(target.indexedDB, "edgeever-local", "memos")).toHaveLength(2);
    expect(await readStore(target.indexedDB, "edgeever-local", "counters")).toHaveLength(2);
    expect(Object.keys((await readPluginSecrets(target.indexedDB)).values)).toHaveLength(2);
  });

  test("a leftover temporary marker from an interrupted run does not count as migrated", async () => {
    await writeFile(`${markerPath}.tmp`, "{\"partial\":");
    const legacy = await seedFullLegacyOrigin();
    const target = createOrigin();

    const result = await migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow({ [legacyBridgeUrl]: legacy, [targetBridgeUrl]: target }, []),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    });

    expect(result.state).toBe("migrated");
    expect(JSON.parse(await readFile(markerPath, "utf8")).counts.databases).toBe(2);
    expect(await Bun.file(`${markerPath}.tmp`).exists()).toBe(false);
  });

  test("does not write a marker when it cannot be persisted", async () => {
    const missingDirectoryMarker = join(directory, "missing", RENDERER_STORAGE_MIGRATION_MARKER);
    const log = [];
    await expect(migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow({ [legacyBridgeUrl]: createOrigin(), [targetBridgeUrl]: createOrigin() }, log),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath: missingDirectoryMarker,
    })).rejects.toThrow();
    expect(await Bun.file(missingDirectoryMarker).exists()).toBe(false);
    expect(log.at(-1)).toEqual(["destroy"]);
  });

  test("destroys the window when a bridge page fails to load", async () => {
    const log = [];
    await expect(migrateRendererStorageOrigin({
      createWindow: createEvaluatingWindow({ [legacyBridgeUrl]: createOrigin() }, log),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    })).rejects.toThrow(`Cannot load ${targetBridgeUrl}`);
    expect(log.at(-1)).toEqual(["destroy"]);
    expect(await Bun.file(markerPath).exists()).toBe(false);
  });

  test("propagates window creation failures and skips destroying an already destroyed window", async () => {
    await expect(migrateRendererStorageOrigin({
      createWindow: () => { throw new Error("no window"); },
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    })).rejects.toThrow("no window");

    let destroyCalls = 0;
    await expect(migrateRendererStorageOrigin({
      createWindow: () => ({
        async loadURL() { throw new Error("renderer gone"); },
        destroy() { destroyCalls += 1; },
        isDestroyed() { return true; },
        webContents: { async executeJavaScript() { return null; } },
      }),
      legacyBridgeUrl,
      targetBridgeUrl,
      markerPath,
    })).rejects.toThrow("renderer gone");
    expect(destroyCalls).toBe(0);
    expect(await Bun.file(markerPath).exists()).toBe(false);
  });
});
