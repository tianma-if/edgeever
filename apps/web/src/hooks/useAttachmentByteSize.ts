import { getResourceIdFromUrl, normalizeAttachmentByteSize } from "@edgeever/shared";
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

  const [updated, setUpdated] = useState<{ url: string; byteSize: number } | null>(null);
  useEffect(() => {
    setUpdated(null);
    const resourceId = getResourceIdFromUrl(url);
    if (!resourceId) return;
    let active = true;
    let receivedUpdate = false;
    const apply = (byteSize: number) => {
      byteSizeCache.set(url, byteSize);
      setUpdated({ url, byteSize });
    };
    const unsubscribe = window.edgeeverDesktop?.onAttachmentResourceSaved?.(resource => {
      if (resourceId !== resource.id) return;
      receivedUpdate = true;
      apply(resource.byteSize);
    });
    // A note may mount after the save event, including after a restart. Read
    // acknowledged local metadata rather than refetching the remote catalog.
    void window.edgeeverDesktop?.attachmentWritebacks?.().then(items => {
      if (!active || receivedUpdate) return;
      const latest = items.filter(item => item.resourceId === resourceId && item.byteSize !== null)
        .sort((left, right) => right.metadataAt - left.metadataAt)[0];
      if (latest?.byteSize !== null && latest?.byteSize !== undefined) apply(latest.byteSize);
    }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, [normalizedStoredByteSize, url]);

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

  if (updated?.url === url) return updated.byteSize;
  return normalizedStoredByteSize ?? (discovered.url === url ? discovered.byteSize : null);
};
