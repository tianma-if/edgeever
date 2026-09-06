import type { ResourceListItem, TiptapDoc } from "@edgeever/shared";
import { getConfiguredDesktopApiBaseUrl } from "@/lib/api";

export const isDesktopResourceRuntime = () => Boolean(typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable);

const RESOURCE_PATH_PATTERN = /\/api\/v1\/resources\/([^/]+)\/blob(?:$|[?#])/;

const getResourceId = (url: string) => {
  if (url.startsWith("edgeever-resource://")) {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  }

  try {
    const base = getConfiguredDesktopApiBaseUrl() || "http://edgeever.local";
    const parsed = new URL(url, base);
    const match = parsed.pathname.match(RESOURCE_PATH_PATTERN);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
};

export const toDesktopResourceUrl = (url: string) => {
  if (!isDesktopResourceRuntime() || url.startsWith("edgeever-resource://") || url.startsWith("edgeever-staged://")) return url;
  const resourceId = getResourceId(url);
  return resourceId ? `edgeever-resource://resource/${encodeURIComponent(resourceId)}` : url;
};

export const toApiResourceUrl = (url: string) => {
  if (!url.startsWith("edgeever-resource://")) return url;
  const resourceId = getResourceId(url);
  return resourceId ? `/api/v1/resources/${encodeURIComponent(resourceId)}/blob` : url;
};

export const mapTiptapResourceUrls = (doc: TiptapDoc, mapper: (url: string) => string): TiptapDoc => {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = (key === "src" || key === "href" || key === "url") && typeof child === "string" ? mapper(child) : visit(child);
    }
    return result;
  };

  return visit(doc) as TiptapDoc;
};

export const mapMarkdownResourceUrls = (markdown: string | undefined, mapper: (url: string) => string) =>
  markdown?.replace(/(?:edgeever-resource:\/\/resource\/[^\s)"']+|\/api\/v1\/resources\/[^\s)"']+\/blob)/g, mapper) ?? markdown;

export const stageDesktopResource = async (memoId: string, file: File) => {
  if (!isDesktopResourceRuntime()) return null;
  const bridge = window.edgeeverDesktop!;
  const staged = await bridge.beginStagedResource({
    memoId,
    name: file.name,
    type: file.type,
    size: file.size,
  });
  try {
    for (let start = 0; start < file.size; start += staged.partSize) {
      const bytes = await file.slice(start, Math.min(start + staged.partSize, file.size)).arrayBuffer();
      await bridge.appendStagedResource(staged.id, bytes);
    }
    return await bridge.completeStagedResource(staged.id);
  } catch (error) {
    await bridge.abortStagedResource(staged.id).catch(() => undefined);
    throw error;
  }
};

export const createStagedResourceListItem = (
  item: { id: string; memoId: string; name: string; type: string; size: number },
  now = new Date().toISOString(),
): ResourceListItem => ({
  id: `staged_${item.id}`,
  memoId: item.memoId,
  originalMemoId: null,
  kind: item.type.startsWith("image/") ? "image" : "attachment",
  mimeType: item.type || null,
  filename: item.name,
  byteSize: item.size,
  sha256: null,
  width: null,
  height: null,
  createdAt: now,
  updatedAt: now,
  url: `edgeever-staged://${item.id}`,
  memoTitle: null,
  memoExcerpt: null,
  memoDeleted: false,
});
