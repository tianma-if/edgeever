import type { MobileImageUploadAsset } from "./mobile-image-upload";

export type MobileImagePickerAsset = {
  fileName?: string | null;
  mimeType?: string | null;
  uri: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const getFilenameExtension = (filename?: string | null) => {
  const match = filename?.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
};

const getTimestampedPhotoFilename = (timestamp: number) =>
  `photo-${new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.jpg`;

export const normalizeMobileImagePickerAssets = (result: {
  canceled: boolean;
  assets: MobileImagePickerAsset[] | null;
}): MobileImageUploadAsset[] => result.canceled ? [] : (result.assets ?? []).map((asset) => normalizeMobileImagePickerAsset(asset));

export const normalizeMobileImagePickerAsset = (
  asset: MobileImagePickerAsset,
  timestamp = Date.now()
): MobileImageUploadAsset => {
  const fileName = asset.fileName?.trim() || getTimestampedPhotoFilename(timestamp);
  const extension = getFilenameExtension(fileName);
  return {
    uri: asset.uri,
    name: fileName,
    mimeType: asset.mimeType?.trim() || (extension ? MIME_BY_EXTENSION[extension] : null) || "image/jpeg",
  };
};
