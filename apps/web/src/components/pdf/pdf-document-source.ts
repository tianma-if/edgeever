import { toApiResourceUrl } from "@/lib/desktop-resources";

type PdfResourceBridge = Pick<EdgeEverDesktopBridge, "readResource" | "readStagedResource">;

export type PdfDocumentSource = { url: string } | { data: Uint8Array };

const parseDesktopResourceId = (url: string, scheme: "edgeever-resource:" | "edgeever-staged:") => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== scheme) return null;
    const rawId = parsed.pathname.replace(/^\//, "") || parsed.hostname;
    return rawId ? decodeURIComponent(rawId) : null;
  } catch {
    return null;
  }
};

const copyBytes = (bytes: Uint8Array) => new Uint8Array(bytes);

/** PDF.js only treats HTTP(S) as fetchable and can leave Electron custom URLs pending in XHR. */
export const loadPdfDocumentSource = async (
  url: string,
  bridge: PdfResourceBridge | undefined = typeof window === "undefined" ? undefined : window.edgeeverDesktop,
): Promise<PdfDocumentSource> => {
  if (!bridge) return { url: toApiResourceUrl(url) };

  const stagedId = parseDesktopResourceId(url, "edgeever-staged:");
  if (stagedId) {
    const resource = await bridge.readStagedResource(stagedId);
    return { data: copyBytes(resource.bytes) };
  }

  const resourceId = parseDesktopResourceId(url, "edgeever-resource:");
  if (resourceId) {
    const resource = await bridge.readResource(resourceId);
    return { data: copyBytes(resource.bytes) };
  }

  return { url };
};
