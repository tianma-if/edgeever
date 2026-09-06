const DATABASE_NAME = "edgeever-plugin-secrets-v1";
const DATABASE_VERSION = 1;
const KEY_STORE = "keys";
const SECRET_STORE = "secrets";
const MASTER_KEY_ID = "device-master-key";

type EncryptedSecret = {
  id: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
};

export const encryptPluginSecret = async (key: CryptoKey, value: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { iv, ciphertext };
};

export const decryptPluginSecret = async (key: CryptoKey, encrypted: Pick<EncryptedSecret, "iv" | "ciphertext">) => {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: encrypted.iv }, key, encrypted.ciphertext);
  return new TextDecoder().decode(plaintext);
};

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
    if (!request.result.objectStoreNames.contains(KEY_STORE)) request.result.createObjectStore(KEY_STORE);
    if (!request.result.objectStoreNames.contains(SECRET_STORE)) request.result.createObjectStore(SECRET_STORE, { keyPath: "id" });
  });
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error ?? new Error("Secret storage is unavailable.")), { once: true });
});

export interface PluginSecretStorage {
  get(pluginId: string, key: string): Promise<string | null>;
  set(pluginId: string, key: string, value: string): Promise<void>;
  remove(pluginId: string, key: string): Promise<void>;
  clearNamespace(pluginId: string): Promise<void>;
}

export class WebPluginSecretStore implements PluginSecretStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private masterKeyPromise: Promise<CryptoKey> | null = null;

  private database() {
    this.databasePromise ??= openDatabase();
    return this.databasePromise;
  }

  private masterKey() {
    this.masterKeyPromise ??= this.loadOrCreateMasterKey();
    return this.masterKeyPromise;
  }

  private async loadOrCreateMasterKey() {
    const database = await this.database();
    const readTransaction = database.transaction(KEY_STORE, "readonly");
    const existing = await requestResult(readTransaction.objectStore(KEY_STORE).get(MASTER_KEY_ID)) as CryptoKey | undefined;
    await transactionDone(readTransaction);
    if (existing) return existing;

    const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const writeTransaction = database.transaction(KEY_STORE, "readwrite");
    writeTransaction.objectStore(KEY_STORE).put(generated, MASTER_KEY_ID);
    await transactionDone(writeTransaction);
    return generated;
  }

  private recordId(pluginId: string, key: string) {
    return `${pluginId}:${key}`;
  }

  async get(pluginId: string, key: string) {
    const database = await this.database();
    const transaction = database.transaction(SECRET_STORE, "readonly");
    const record = await requestResult(transaction.objectStore(SECRET_STORE).get(this.recordId(pluginId, key))) as EncryptedSecret | undefined;
    await transactionDone(transaction);
    if (!record) return null;
    return decryptPluginSecret(await this.masterKey(), record);
  }

  async set(pluginId: string, key: string, value: string) {
    const { iv, ciphertext } = await encryptPluginSecret(await this.masterKey(), value);
    const database = await this.database();
    const transaction = database.transaction(SECRET_STORE, "readwrite");
    transaction.objectStore(SECRET_STORE).put({ id: this.recordId(pluginId, key), iv, ciphertext } satisfies EncryptedSecret);
    await transactionDone(transaction);
  }

  async remove(pluginId: string, key: string) {
    const database = await this.database();
    const transaction = database.transaction(SECRET_STORE, "readwrite");
    transaction.objectStore(SECRET_STORE).delete(this.recordId(pluginId, key));
    await transactionDone(transaction);
  }

  async clearNamespace(pluginId: string) {
    const database = await this.database();
    const transaction = database.transaction(SECRET_STORE, "readwrite");
    const store = transaction.objectStore(SECRET_STORE);
    const request = store.openCursor();
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as EncryptedSecret;
      if (record.id.startsWith(`${pluginId}:`)) cursor.delete();
      cursor.continue();
    });
    await transactionDone(transaction);
  }
}
