import { assertBrowserImgBedEndpoint, browserImgBed } from "./imgbed-browser";
import { expandImgBedFolder, imgBedAutoRetry, IMGBED_NAME_TYPES, IMGBED_UPLOAD_CHANNELS, type ImgBedNameType, type ImgBedUploadChannel } from "./imgbed";

export const PICGO_STORAGE_KEY = "edgeever.desktop.picgo.v1";
export const DEFAULT_PICGO_ENDPOINT = "http://127.0.0.1:36677/upload";
export type ImgBedPreference = {
  endpoint: string; token: string; uploadFolder: string; nameType: ImgBedNameType;
  uploadChannel: ImgBedUploadChannel; channelName: string; serverCompress: boolean;
  // null follows imgBedAutoRetry's default; a boolean is the user's explicit choice.
  autoRetry: boolean | null;
};
export type PicGoPreference = { provider: "edgeever" | "picgo" | "imgbed"; endpoint: string; serverKey: string; imgbed: ImgBedPreference };
export type ExternalImageHost = Exclude<PicGoPreference["provider"], "edgeever">;

const emptyImgBedPreference = (): ImgBedPreference => ({
  endpoint: "", token: "", uploadFolder: "", nameType: "default", uploadChannel: "telegram", channelName: "", serverCompress: true, autoRetry: null,
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
    // Saved before channel names existed: empty keeps ImgBed's own channel choice.
    channelName: text("channelName"),
    serverCompress: typeof record.serverCompress === "boolean" ? record.serverCompress : true,
    autoRetry: typeof record.autoRetry === "boolean" ? record.autoRetry : null,
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

// Returns the value as stored. The channel name is typed freely (it may contain
// inner spaces), so its edges are trimmed only here.
export const writePicGoPreference = (value: PicGoPreference): PicGoPreference => {
  const stored = { ...value, imgbed: { ...value.imgbed, channelName: value.imgbed.channelName.trim() } };
  // Fail visibly when persistence is unavailable; never claim a provider changed.
  window.localStorage.setItem(PICGO_STORAGE_KEY, JSON.stringify(stored));
  return stored;
};

export const hasPicGoBridge = () => Boolean(window.edgeeverDesktop?.uploadPicGoImage && window.edgeeverDesktop?.testPicGoConnection);
// Older desktop hosts lack the channel list; the settings page then keeps manual entry.
export const hasImgBedChannelsBridge = () => Boolean(window.edgeeverDesktop?.listImgBedChannels);
export const hasImgBedBridge = () => Boolean(window.edgeeverDesktop?.uploadImgBedImage && window.edgeeverDesktop?.testImgBedConnection);

// A desktop host without ImgBed IPC must keep its existing capability gate.
export const isBrowserImgBed = () => !window.edgeeverDesktop;
export const canUseImgBed = () => hasImgBedBridge() || isBrowserImgBed();
export const canListImgBedChannels = () => hasImgBedChannelsBridge() || isBrowserImgBed();
export const testImgBedConnection = (input: Omit<ImgBedPreference, "autoRetry"> & { autoRetry: boolean }) =>
  isBrowserImgBed() ? browserImgBed.testImgBedConnection(input) : window.edgeeverDesktop!.testImgBedConnection!(input);
export const listImgBedChannels = (input: { endpoint: string; token: string }) =>
  isBrowserImgBed() ? browserImgBed.listImgBedChannels(input) : window.edgeeverDesktop!.listImgBedChannels!(input);

const hasBridge = (provider: ExternalImageHost) => provider === "imgbed" ? canUseImgBed() : hasPicGoBridge();

// The configured external host that will receive new images, or null for EdgeEver storage.
export const activeExternalImageHost = (): ExternalImageHost | null => {
  const { provider } = readPicGoPreference();
  return provider !== "edgeever" && hasBridge(provider) ? provider : null;
};

export const shouldUploadWithPicGo = () => activeExternalImageHost() !== null;

export type PicGoFailureCopy = { title: string; message: string; retry: string; fallback: string; cancel: string };

export type BrowserImgBedFailureChoice = "retry" | "fallback" | "cancel";
export const uploadImageWithPicGo = async (file: File, copy: PicGoFailureCopy, context: {
  memoId?: string; isActive?: () => boolean; chooseFailure?: () => Promise<BrowserImgBedFailureChoice>;
} = {}) => {
  const preference = readPicGoPreference();
  if (preference.provider === "edgeever" || !hasBridge(preference.provider)) return null;
  const upload = async () => {
    if (preference.provider === "imgbed" && isBrowserImgBed()) {
      assertBrowserImgBedEndpoint(preference.imgbed.endpoint);
      if (!file.type.startsWith("image/") || file.size === 0 || file.size > 50 * 1024 * 1024) throw new Error("ImgBed requires an image of up to 50 MB");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = preference.provider === "imgbed"
      ? await (isBrowserImgBed() ? browserImgBed.uploadImgBedImage : window.edgeeverDesktop!.uploadImgBedImage!)({
        endpoint: preference.imgbed.endpoint, token: preference.imgbed.token, nameType: preference.imgbed.nameType,
        uploadChannel: preference.imgbed.uploadChannel, channelName: preference.imgbed.channelName, serverCompress: preference.imgbed.serverCompress,
        autoRetry: imgBedAutoRetry(preference.imgbed.autoRetry, preference.imgbed.channelName),
        uploadFolder: expandImgBedFolder(preference.imgbed.uploadFolder, new Date(), { memoId: context.memoId }), bytes, filename: file.name, mimeType: file.type, copy,
      })
      : await window.edgeeverDesktop!.uploadPicGoImage({
        endpoint: preference.endpoint, serverKey: preference.serverKey, bytes, filename: file.name, mimeType: file.type, copy,
      });
    return "url" in result ? {
      kind: "image" as const, url: result.url, filename: file.name, mimeType: file.type, byteSize: file.size,
    } : null;
  };
  while (true) {
    if (context.isActive && !context.isActive()) throw new Error("The active note changed during image upload");
    try { return await upload(); }
    catch (error) {
      if (preference.provider !== "imgbed" || !isBrowserImgBed() || !context.chooseFailure) throw error;
      if (context.isActive && !context.isActive()) throw error;
      const choice = await context.chooseFailure();
      if (context.isActive && !context.isActive()) throw error;
      if (choice === "fallback") return null;
      if (choice !== "retry") throw new Error("ImgBed upload cancelled");
    }
  }
};
