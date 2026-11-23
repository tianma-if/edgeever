import {
  RESOURCE_THUMBNAIL_WIDTH_BUCKETS,
  isAnimatedRasterImage,
  isResizableThumbnailMimeType,
  normalizeResourceMimeType,
} from "@edgeever/shared";
import type { ImageThumbnailAdapter } from "./api-context";
import { sha256 } from "./hash-utils";
import type { BlobObjectAdapter, BlobStoreAdapter } from "./storage-contract";

export const MAX_THUMBNAIL_SOURCE_BYTES = 25 * 1024 * 1024;

export type ThumbnailResourceMeta = {
  id: string;
  kind: "image" | "attachment";
  mime_type: string | null;
  filename: string | null;
  byte_size: number;
  object_key: string;
  storage_config_id: string | null;
  sha256?: string | null;
  updated_at?: string | null;
};

export type ThumbnailResolution =
  | { kind: "cached"; object: BlobObjectAdapter; etag: string }
  | { kind: "generated"; bytes: Uint8Array; mimeType: string; etag: string }
  | { kind: "fallback-bytes"; bytes: Uint8Array; etag: string }
  | { kind: "fallback-unfetched"; etag: string }
  | { kind: "not-found" };

const sanitizeKeySegment = (value: string) => {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return cleaned || "default";
};

export const isThumbnailEligibleResource = (
  resource: Pick<ThumbnailResourceMeta, "kind" | "mime_type" | "byte_size">,
): boolean =>
  resource.kind === "image"
  && isResizableThumbnailMimeType(resource.mime_type)
  && resource.byte_size > 0
  && resource.byte_size <= MAX_THUMBNAIL_SOURCE_BYTES;

export const resolveThumbnailVersionKey = async (
  resource: Pick<ThumbnailResourceMeta, "object_key" | "sha256" | "updated_at">,
): Promise<string> => {
  const raw = resource.sha256?.trim()
    || await sha256(`${resource.object_key}:${resource.updated_at ?? ""}`);
  return sanitizeKeySegment(raw);
};

export const buildThumbnailObjectKey = (
  workspaceId: string,
  resourceId: string,
  versionKey: string,
  width: number,
): string =>
  `workspaces/${sanitizeKeySegment(workspaceId)}/thumbnails/${sanitizeKeySegment(resourceId)}/${versionKey}/w${width}.webp`;

export const buildAllThumbnailObjectKeys = (
  workspaceId: string,
  resourceId: string,
  versionKey: string,
): string[] =>
  RESOURCE_THUMBNAIL_WIDTH_BUCKETS.map((width) =>
    buildThumbnailObjectKey(workspaceId, resourceId, versionKey, width),
  );

export const deleteResourceThumbnails = async (
  store: BlobStoreAdapter,
  workspaceId: string,
  resource: Pick<ThumbnailResourceMeta, "id" | "kind" | "mime_type" | "byte_size" | "object_key" | "sha256" | "updated_at">,
): Promise<void> => {
  if (!isThumbnailEligibleResource(resource)) return;
  const versionKey = await resolveThumbnailVersionKey(resource).catch(() => null);
  if (!versionKey) return;
  await store
    .delete(buildAllThumbnailObjectKeys(workspaceId, resource.id, versionKey))
    .catch(() => undefined);
};

export const buildThumbnailEtag = (versionKey: string, width: number): string =>
  `"thumb-${versionKey}-w${width}"`;

export const buildThumbnailOriginalEtag = (versionKey: string, width: number): string =>
  `"orig-${versionKey}-w${width}"`;

export const matchesIfNoneMatch = (headerValue: string | undefined, etag: string): boolean => {
  if (!headerValue) return false;
  const normalizedTarget = etag.replace(/^W\//, "").trim();
  for (const rawCandidate of headerValue.split(",")) {
    const candidate = rawCandidate.trim();
    if (candidate === "*") return true;
    if (candidate.replace(/^W\//, "") === normalizedTarget) return true;
  }
  return false;
};

export const toThumbnailFilename = (filename: string | null, resourceId: string): string => {
  const base = (filename ?? "").trim() || resourceId;
  if (/\.[A-Za-z0-9]{1,16}$/.test(base)) {
    return base.replace(/\.[A-Za-z0-9]{1,16}$/, ".webp");
  }
  return `${base}.webp`;
};

const inFlightByStore = new WeakMap<BlobStoreAdapter, Map<string, Promise<ThumbnailResolution>>>();
const inFlightByStorageScope = new Map<string, Map<string, Promise<ThumbnailResolution>>>();

const getStoreFlightMap = (store: BlobStoreAdapter, storageScopeKey?: string) => {
  if (storageScopeKey) {
    let map = inFlightByStorageScope.get(storageScopeKey);
    if (!map) {
      map = new Map();
      inFlightByStorageScope.set(storageScopeKey, map);
    }
    const scopedMap = map;
    return {
      map: scopedMap,
      cleanup: (flightKey: string) => {
        scopedMap.delete(flightKey);
        if (!scopedMap.size) {
          inFlightByStorageScope.delete(storageScopeKey);
        }
      },
    };
  }
  let map = inFlightByStore.get(store);
  if (!map) {
    map = new Map();
    inFlightByStore.set(store, map);
  }
  const storeMap = map;
  return {
    map: storeMap,
    cleanup: (flightKey: string) => {
      storeMap.delete(flightKey);
    },
  };
};

export const resolveOrGenerateThumbnail = async ({
  store,
  resizer,
  storageConfigId,
  storageScopeKey,
  workspaceId,
  resource,
  width,
  versionKey,
  etag,
  persistCache,
  shouldPersistCache,
}: {
  store: BlobStoreAdapter;
  resizer?: ImageThumbnailAdapter;
  storageConfigId: string | null;
  storageScopeKey?: string;
  workspaceId: string;
  resource: ThumbnailResourceMeta;
  width: number;
  versionKey: string;
  etag: string;
  persistCache: boolean;
  shouldPersistCache: () => Promise<boolean>;
}): Promise<ThumbnailResolution> => {
  const originalEtag = buildThumbnailOriginalEtag(versionKey, width);
  const thumbnailKey = buildThumbnailObjectKey(workspaceId, resource.id, versionKey, width);
  const readCachedThumbnail = async (): Promise<ThumbnailResolution | null> => {
    const object = persistCache ? await store.get(thumbnailKey) : null;
    return object ? { kind: "cached", object, etag } : null;
  };

  if (!resizer) {
    return (await readCachedThumbnail()) ?? { kind: "fallback-unfetched", etag: originalEtag };
  }

  const resolveThumbnail = async (): Promise<ThumbnailResolution> => {
    const cached = await readCachedThumbnail();
    if (cached) return cached;

    const originalObject = await store.get(resource.object_key);
    if (!originalObject) {
      return { kind: "not-found" };
    }

    const originalBytes = new Uint8Array(await new Response(originalObject.body).arrayBuffer());
    if (
      originalBytes.byteLength === 0
      || originalBytes.byteLength > MAX_THUMBNAIL_SOURCE_BYTES
      || isAnimatedRasterImage(originalBytes)
    ) {
      return { kind: "fallback-bytes", bytes: originalBytes, etag: originalEtag };
    }

    let resized = null;
    try {
      resized = await resizer({
        bytes: originalBytes,
        mimeType: normalizeResourceMimeType(resource.mime_type) || "image/png",
        width,
      });
    } catch {
      resized = null;
    }

    if (
      !resized
      || resized.bytes.byteLength === 0
      || resized.bytes.byteLength >= originalBytes.byteLength
    ) {
      return { kind: "fallback-bytes", bytes: originalBytes, etag: originalEtag };
    }

    if (persistCache) {
      const checkCanPersist = async () => {
        try {
          return await shouldPersistCache();
        } catch {
          return false;
        }
      };
      if (await checkCanPersist()) {
        await store.put(thumbnailKey, resized.bytes, {
          httpMetadata: {
            contentType: resized.mimeType,
            cacheControl: "private, no-cache",
          },
          customMetadata: {
            resourceId: resource.id,
            versionKey,
            width: String(width),
          },
        }).catch(() => undefined);

        if (!(await checkCanPersist())) {
          await store.delete(thumbnailKey).catch(() => undefined);
        }
      }
    }

    return {
      kind: "generated",
      bytes: resized.bytes,
      mimeType: resized.mimeType,
      etag,
    };
  };

  const flightKey = `${storageConfigId ?? "builtin"}:${persistCache ? "persist" : "ephemeral"}:${thumbnailKey}`;
  while (true) {
    const { map, cleanup } = getStoreFlightMap(store, storageScopeKey);
    const existingFlight = map.get(flightKey);
    if (!existingFlight) {
      const flight = resolveThumbnail().finally(() => cleanup(flightKey));
      map.set(flightKey, flight);
      return flight;
    }

    const resolution = await existingFlight;
    if (resolution.kind !== "cached") return resolution;

    // Each response needs its own stream. If the object was evicted, join or start a new flight.
    const cached = await readCachedThumbnail();
    if (cached) return cached;
  }
};
