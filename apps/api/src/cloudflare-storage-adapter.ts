import type {
  BlobStoreAdapter,
  DatabaseAdapter,
  StorageAdapter,
} from "./storage-contract";

/** Native Worker bindings are mentioned only at this platform boundary. */
export type CloudflareStorageBindings = {
  DB: DatabaseAdapter;
  RESOURCES: BlobStoreAdapter;
};

/**
 * Adapts native Cloudflare bindings to the storage surface consumed by the
 * application. No route or service should construct this shape directly.
 */
export const createCloudflareStorageAdapter = (
  bindings: CloudflareStorageBindings,
): StorageAdapter => ({
  db: bindings.DB,
  resources: bindings.RESOURCES,
  diagnostics: {
    database: "d1",
    resources: "r2",
    migrationTable: "d1_migrations",
  },
});
