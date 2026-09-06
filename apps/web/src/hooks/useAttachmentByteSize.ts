import { normalizeAttachmentByteSize } from "@edgeever/shared";
import { useEffect, useState } from "react";
import { fetchAttachmentByteSize } from "@/lib/attachment-byte-size";

const byteSizeCache = new Map<string, number | null>();
const pendingRequests = new Map<string, Promise<number | null>>();

const loadAttachmentByteSize = (url: string) => {
  const cached = byteSizeCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = pendingRequests.get(url);
  if (pending) return pending;

  const request = fetchAttachmentByteSize(url)
    .catch(() => null)
    .then((byteSize) => {
      byteSizeCache.set(url, byteSize);
      pendingRequests.delete(url);
      return byteSize;
    });
  pendingRequests.set(url, request);
  return request;
};

export const useAttachmentByteSize = (url: string, storedByteSize: unknown) => {
  const normalizedStoredByteSize = normalizeAttachmentByteSize(storedByteSize);
  const [discovered, setDiscovered] = useState<{ url: string; byteSize: number | null }>(() => ({
    url,
    byteSize: normalizedStoredByteSize === null ? byteSizeCache.get(url) ?? null : null,
  }));

  useEffect(() => {
    if (normalizedStoredByteSize !== null || !url) {
      setDiscovered({ url, byteSize: null });
      return;
    }

    let active = true;
    void loadAttachmentByteSize(url).then((byteSize) => {
      if (active) setDiscovered({ url, byteSize });
    });
    return () => {
      active = false;
    };
  }, [normalizedStoredByteSize, url]);

  return normalizedStoredByteSize ?? (discovered.url === url ? discovered.byteSize : null);
};
