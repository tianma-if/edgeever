import { expandImgBedFolder, IMGBED_NAME_TYPES, IMGBED_UPLOAD_CHANNELS, type ImgBedNameType, type ImgBedUploadChannel } from "./imgbed";

export const PICGO_STORAGE_KEY = "edgeever.desktop.picgo.v1";
export const DEFAULT_PICGO_ENDPOINT = "http://127.0.0.1:36677/upload";
export type ImgBedPreference = {
  endpoint: string; token: string; uploadFolder: string; nameType: ImgBedNameType;
  uploadChannel: ImgBedUploadChannel; serverCompress: boolean;
};
export type PicGoPreference = { provider: "edgeever" | "picgo" | "imgbed"; endpoint: string; serverKey: string; imgbed: ImgBedPreference };
export type ExternalImageHost = Exclude<PicGoPreference["provider"], "edgeever">;

const emptyImgBedPreference = (): ImgBedPreference => ({
  endpoint: "", token: "", uploadFolder: "", nameType: "default", uploadChannel: "telegram", serverCompress: true,
});
const emptyPicGoPreference = (): PicGoPreference => ({ provider: "edgeever", endpoint: DEFAULT_PICGO_ENDPOINT, serverKey: "", imgbed: emptyImgBedPreference() });

const readImgBedPreference = (value: unknown): ImgBedPreference => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof record[key] === "string" ? record[key] as string : "";
  return {
    endpoint: text("endpoint"),
    token: text("token"),
    uploadFolder: text("uploadFolder"),
    nameType: IMGBED_NAME_TYPES.includes(record.nameType as ImgBedNameType) ? record.nameType as ImgBedNameType : "default",
    uploadChannel: IMGBED_UPLOAD_CHANNELS.includes(record.uploadChannel as ImgBedUploadChannel) ? record.uploadChannel as ImgBedUploadChannel : "telegram",
    serverCompress: typeof record.serverCompress === "boolean" ? record.serverCompress : true,
  };
};

export const readPicGoPreference = (): PicGoPreference => {
  const fallback = emptyPicGoPreference();
  try {
    const value = JSON.parse(window.localStorage.getItem(PICGO_STORAGE_KEY) ?? "null");
    if (!value || typeof value.endpoint !== "string") return fallback;
    return {
      provider: value.provider === "picgo" || value.provider === "imgbed" ? value.provider : "edgeever",
      endpoint: value.endpoint,
      serverKey: typeof value.serverKey === "string" ? value.serverKey : "",
      imgbed: readImgBedPreference(value.imgbed),
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
export const hasImgBedBridge = () => Boolean(window.edgeeverDesktop?.uploadImgBedImage && window.edgeeverDesktop?.testImgBedConnection);

const hasBridge = (provider: ExternalImageHost) => provider === "imgbed" ? hasImgBedBridge() : hasPicGoBridge();

// The configured external host that will receive new images, or null for EdgeEver storage.
export const activeExternalImageHost = (): ExternalImageHost | null => {
  const { provider } = readPicGoPreference();
  return provider !== "edgeever" && hasBridge(provider) ? provider : null;
};

export const shouldUploadWithPicGo = () => activeExternalImageHost() !== null;

export type PicGoFailureCopy = { title: string; message: string; retry: string; fallback: string; cancel: string };

export const uploadImageWithPicGo = async (file: File, copy: PicGoFailureCopy, context: { memoId?: string } = {}) => {
  const preference = readPicGoPreference();
  if (preference.provider === "edgeever" || !hasBridge(preference.provider)) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = preference.provider === "imgbed"
    ? await window.edgeeverDesktop!.uploadImgBedImage!({
      endpoint: preference.imgbed.endpoint, token: preference.imgbed.token, nameType: preference.imgbed.nameType,
      uploadChannel: preference.imgbed.uploadChannel, serverCompress: preference.imgbed.serverCompress,
      uploadFolder: expandImgBedFolder(preference.imgbed.uploadFolder, new Date(), { memoId: context.memoId }), bytes, filename: file.name, mimeType: file.type, copy,
    })
    : await window.edgeeverDesktop!.uploadPicGoImage({
      endpoint: preference.endpoint, serverKey: preference.serverKey, bytes, filename: file.name, mimeType: file.type, copy,
    });
  return "url" in result ? {
    kind: "image" as const, url: result.url, filename: file.name, mimeType: file.type, byteSize: file.size,
  } : null;
};
