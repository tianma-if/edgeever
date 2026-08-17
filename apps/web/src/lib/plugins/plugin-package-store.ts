const DATABASE_NAME = "edgeever-plugin-packages-v1";
const DATABASE_VERSION = 1;
const PACKAGE_STORE = "packages";

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
  remove(pluginId: string): Promise<void>;
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
      request.result.createObjectStore(PACKAGE_STORE, { keyPath: "pluginId" });
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
    const value = await requestResult(transaction.objectStore(PACKAGE_STORE).get(pluginId)) as CachedPluginPackage | undefined;
    await transactionDone(transaction);
    return value?.version === version ? value : null;
  }

  async put(value: CachedPluginPackage) {
    const database = await this.database();
    const transaction = database.transaction(PACKAGE_STORE, "readwrite");
    transaction.objectStore(PACKAGE_STORE).put(value);
    await transactionDone(transaction);
  }

  async remove(pluginId: string) {
    const database = await this.database();
    const transaction = database.transaction(PACKAGE_STORE, "readwrite");
    transaction.objectStore(PACKAGE_STORE).delete(pluginId);
    await transactionDone(transaction);
  }
}
