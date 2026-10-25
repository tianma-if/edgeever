export const PICGO_STORAGE_KEY = "edgeever.desktop.picgo.v1";
export const DEFAULT_PICGO_ENDPOINT = "http://127.0.0.1:36677/upload";
export type PicGoPreference = { provider: "edgeever" | "picgo"; endpoint: string; serverKey: string };

const emptyPicGoPreference = (): PicGoPreference => ({ provider: "edgeever", endpoint: DEFAULT_PICGO_ENDPOINT, serverKey: "" });

export const readPicGoPreference = (): PicGoPreference => {
  const fallback = emptyPicGoPreference();
  try {
    const value = JSON.parse(window.localStorage.getItem(PICGO_STORAGE_KEY) ?? "null");
    if (!value || typeof value.endpoint !== "string") return fallback;
    return {
      provider: value.provider === "picgo" ? "picgo" : "edgeever",
      endpoint: value.endpoint,
      serverKey: typeof value.serverKey === "string" ? value.serverKey : "",
    };
  } catch { return fallback; }
};

// A pasted PicList address may carry ?key=. Keep that secret out of the address field.
export const takePicGoServerKey = (value: string): { endpoint: string; serverKey?: string } => {
  const endpoint = value.trim();
  try {
    const url = new URL(endpoint);
    const names = [...url.searchParams.keys()];
    if (names.length === 1 && names[0] === "key" && url.searchParams.getAll("key").length === 1 && !url.hash) {
      const serverKey = url.searchParams.get("key")?.trim() ?? "";
      url.search = "";
      return { endpoint: url.href, serverKey };
    }
  } catch { /* The field may be an incomplete address while the user is typing. */ }
  return { endpoint };
};

export const writePicGoPreference = (value: PicGoPreference) => {
  // Fail visibly when persistence is unavailable; never claim a provider changed.
  window.localStorage.setItem(PICGO_STORAGE_KEY, JSON.stringify(value));
};

export const hasPicGoBridge = () => Boolean(window.edgeeverDesktop?.uploadPicGoImage && window.edgeeverDesktop?.testPicGoConnection);

export const shouldUploadWithPicGo = () => hasPicGoBridge() && readPicGoPreference().provider === "picgo";

export type PicGoFailureCopy = { title: string; message: string; retry: string; fallback: string; cancel: string };

export const uploadImageWithPicGo = async (file: File, copy: PicGoFailureCopy) => {
  const preference = readPicGoPreference();
  if (preference.provider !== "picgo" || !hasPicGoBridge()) return null;
  const result = await window.edgeeverDesktop!.uploadPicGoImage({
    endpoint: preference.endpoint, serverKey: preference.serverKey, bytes: new Uint8Array(await file.arrayBuffer()),
    filename: file.name, mimeType: file.type, copy,
  });
  return "url" in result ? {
    kind: "image" as const, url: result.url, filename: file.name, mimeType: file.type, byteSize: file.size,
  } : null;
};
