import { api, getConfiguredDesktopApiBaseUrl } from "./api";
import { readPicGoPreference, uploadImageWithPicGo } from "./picgo";
import type { PicGoFailureCopy } from "./picgo";
import i18n from "i18next";

export class PublishImageError extends Error {
  constructor(readonly reason: "address" | "upload" | "render", options?: ErrorOptions) {
    super(`Publication image ${reason} failed`, options);
  }
}

// This checks obvious local addresses, not DNS reachability or a host's hotlink policy.
export const publicPublishImageUrl = (source: string, base: string) => {
  const url = new URL(source, base);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || !host.includes('.') || /(?:^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)
    || host.includes(':')
    || (ipv4 && (['0', '10', '127'].includes(ipv4[1]) || Number(ipv4[1]) >= 224
      || (ipv4[1] === '192' && ipv4[2] === '168')
      || (ipv4[1] === '172' && Number(ipv4[2]) >= 16 && Number(ipv4[2]) <= 31)
      || (ipv4[1] === '169' && ipv4[2] === '254')
      || (ipv4[1] === '100' && Number(ipv4[2]) >= 64 && Number(ipv4[2]) <= 127)))) {
    throw new PublishImageError("address");
  }
  return url.href;
};

export const publishImageErrorMessage = (error: unknown) => error instanceof PublishImageError
  ? i18n.t(`editor.publishImage${error.reason === "address" ? "Address" : error.reason === "render" ? "Render" : "Upload"}Failed`)
  : null;

type UploadDependencies = {
  external: boolean;
  baseUrl: string;
  upload: (file: File) => Promise<{ url: string } | null>;
  isCurrent: () => boolean;
};

/** Per-copy deduplication also avoids uploading duplicate diagrams to external hosts. */
export const createPublishImageUploader = (dependencies: UploadDependencies) => {
  const uploads = new Map<string, Promise<string>>();
  return async (blob: Blob) => {
    if (!dependencies.isCurrent()) throw new PublishImageError("upload");
    if (!dependencies.external) publicPublishImageUrl("/api/public/publish-images/probe", dependencies.baseUrl);
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const key = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    let upload = uploads.get(key);
    if (!upload) {
      upload = (async () => {
        try {
          const file = new File([blob], `publish-${key.slice(0, 16)}.${blob.type === "image/png" ? "png" : "jpg"}`, { type: blob.type });
          const result = await dependencies.upload(file);
          if (!result || !dependencies.isCurrent()) throw new PublishImageError("upload");
          return publicPublishImageUrl(result.url, dependencies.baseUrl);
        } catch (error) {
          if (error instanceof PublishImageError) throw error;
          throw new PublishImageError("upload", { cause: error });
        }
      })();
      uploads.set(key, upload);
    }
    return upload;
  };
};

export const createConfiguredPublishImageUploader = () => {
  const preference = readPicGoPreference();
  const preferenceKey = JSON.stringify(preference);
  const instance = getConfiguredDesktopApiBaseUrl();
  const baseUrl = instance || window.location.origin;
  const isCurrent = () => JSON.stringify(readPicGoPreference()) === preferenceKey
    && getConfiguredDesktopApiBaseUrl() === instance;
  const failure = preference.provider === "imgbed" ? "settings.picgo.imgbed" : "settings.picgo";
  const copy: PicGoFailureCopy = {
    title: i18n.t(`${failure}.failedTitle`), message: i18n.t(`${failure}.failedMessage`),
    retry: i18n.t("settings.picgo.retry"), fallback: i18n.t("settings.picgo.cancel"), cancel: i18n.t("settings.picgo.cancel"),
  };
  return createPublishImageUploader({
    external: preference.provider !== "edgeever", baseUrl, isCurrent,
    upload: preference.provider === "edgeever"
      ? (file) => api.uploadPublishImage(file)
      : (file) => uploadImageWithPicGo(file, copy, { isActive: isCurrent }),
  });
};
