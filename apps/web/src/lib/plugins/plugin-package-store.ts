const DATABASE_NAME = "edgeever-plugin-packages-v1";
const DATABASE_VERSION = 2;
const LEGACY_PACKAGE_STORE = "packages";
const PACKAGE_STORE = "packageVersions";
const PLUGIN_ID_INDEX = "pluginId";

export interface CachedPluginPackage {
  pluginId: string;
  version: string;
  mainJs: string;
  stylesCss: string | null;
  checksums: {
    mainJs: string;
    manifestJson: string;
    stylesCss?: string;
  };
  cachedAt: string;
}

export interface PluginPackageStorage {
  get(pluginId: string, version: string): Promise<CachedPluginPackage | null>;
  put(value: CachedPluginPackage): Promise<void>;
  remove(pluginId: string, version?: string): Promise<void>;
}

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed.")), { once: true });
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.addEventListener("complete", () => resolve(), { once: true });
  transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted.")), { once: true });
  transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")), { once: true });
});

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(PACKAGE_STORE)) {
      const store = request.result.createObjectStore(PACKAGE_STORE, { keyPath: ["pluginId", "version"] });
      store.createIndex(PLUGIN_ID_INDEX, "pluginId");
    }
  });
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error ?? new Error("Plugin package storage is unavailable.")), { once: true });
});

export class WebPluginPackageStore implements PluginPackageStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database() {
    this.databasePromise ??= openDatabase();
    return this.databasePromise;
  }

  async get(pluginId: string, version: string) {
    const database = await this.database();
    const transaction = database.transaction(PACKAGE_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(PACKAGE_STORE).get([pluginId, version])) as CachedPluginPackage | undefined;
    await transactionDone(transaction);
    if (value) return value;
    if (!database.objectStoreNames.contains(LEGACY_PACKAGE_STORE)) return null;
    const legacyTransaction = database.transaction(LEGACY_PACKAGE_STORE, "readonly");
    const legacy = await requestResult(legacyTransaction.objectStore(LEGACY_PACKAGE_STORE).get(pluginId)) as CachedPluginPackage | undefined;
    await transactionDone(legacyTransaction);
    if (legacy?.version !== version) return null;
    await this.put(legacy);
    return legacy;
  }

  async put(value: CachedPluginPackage) {
    const database = await this.database();
    const transaction = database.transaction(PACKAGE_STORE, "readwrite");
    transaction.objectStore(PACKAGE_STORE).put(value);
    await transactionDone(transaction);
  }

  async remove(pluginId: string, version?: string) {
    const database = await this.database();
    const transaction = database.transaction(PACKAGE_STORE, "readwrite");
    const store = transaction.objectStore(PACKAGE_STORE);
    if (version) {
      store.delete([pluginId, version]);
    } else {
      const request = store.index(PLUGIN_ID_INDEX).openCursor(IDBKeyRange.only(pluginId));
      request.addEventListener("success", () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      });
    }
    await transactionDone(transaction);
    if (!database.objectStoreNames.contains(LEGACY_PACKAGE_STORE)) return;
    const legacyTransaction = database.transaction(LEGACY_PACKAGE_STORE, "readwrite");
    const legacyStore = legacyTransaction.objectStore(LEGACY_PACKAGE_STORE);
    if (!version) {
      legacyStore.delete(pluginId);
    } else {
      const legacy = await requestResult(legacyStore.get(pluginId)) as CachedPluginPackage | undefined;
      if (legacy?.version === version) legacyStore.delete(pluginId);
    }
    await transactionDone(legacyTransaction);
  }
}
