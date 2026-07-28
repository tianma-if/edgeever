export const LOCAL_RESOURCE_CACHE_NAME = "edgeever-resource-blobs";

const absoluteResourceUrl = (url: string) => {
  if (typeof window === "undefined" || !window.location?.origin) return url;
  return new URL(url, window.location.origin).toString();
};

export const localResourceUrl = (resourceId: string) => `/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;

const getResourceCache = async () => {
  if (typeof caches === "undefined") return null;
  return caches.open(LOCAL_RESOURCE_CACHE_NAME);
};

export const cacheLocalResourceBytes = async (url: string, file: Blob) => {
  const cache = await getResourceCache();
  if (!cache) throw new Error("Offline resource storage is unavailable in this browser");
  await cache.put(absoluteResourceUrl(url), new Response(file, {
    headers: { "Content-Type": file.type || "application/octet-stream" },
  }));
};

export const getCachedLocalResourceBytes = async (url: string) => {
  const cache = await getResourceCache();
  if (!cache) return null;
  const response = await cache.match(absoluteResourceUrl(url));
  return response ? response.blob() : null;
};

export const removeCachedLocalResourceBytes = async (url: string) => {
  const cache = await getResourceCache();
  if (!cache) return;
  await cache.delete(absoluteResourceUrl(url));
};
