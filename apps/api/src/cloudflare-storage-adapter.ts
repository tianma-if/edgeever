import type {
  CloudflareStorageBindings,
  StorageAdapter,
} from "./storage-contract";

/**
 * Adapts native Cloudflare bindings to the storage surface consumed by the
 * application. No route or service should construct this shape directly.
 */
export const createCloudflareStorageAdapter = (
  bindings: CloudflareStorageBindings,
): StorageAdapter => ({
  db: bindings.DB,
  resources: bindings.RESOURCES,
});
