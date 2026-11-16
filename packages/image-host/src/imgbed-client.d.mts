export type ImgBedInput = {
  endpoint: string; token: string; uploadFolder?: string; nameType?: string;
  uploadChannel?: string; channelName?: string; serverCompress?: boolean; autoRetry?: boolean | null;
};
export type ImgBedChannels = { channels: Record<string, string[]>; skipped: Record<string, number> };
export type ImgBedOptions = { fetchImpl?: typeof fetch; timeoutMs?: number; lookupImpl?: unknown };
export function createImgBedClient(adapter: {
  assertHostShape: (hostname: string, message?: string) => void;
  assertImageHostAllowed: (hostname: string, lookup: unknown, options: { label: string; message: string }) => Promise<void>;
  postImageHostJson: (url: URL, body: FormData | undefined, fetchImpl: typeof fetch, timeoutMs: number,
    options: { label: string; headers?: Record<string, string>; method?: string }) => Promise<unknown>;
  lookup?: unknown;
}): {
  IMGBED_NAME_TYPES: string[];
  IMGBED_UPLOAD_CHANNELS: string[];
  IMGBED_MAX_CHANNEL_NAME_LENGTH: number;
  IMGBED_MAX_IMAGE_BYTES: number;
  normalizeImgBedToken: (value: unknown) => string;
  normalizeImgBedFolder: (value: unknown) => string;
  normalizeImgBedChannelName: (value: unknown) => string;
  resolveImgBedAutoRetry: (value: boolean | null | undefined, channelName: string) => boolean;
  normalizeImgBedEndpoint: (value: string) => URL;
  listImgBedChannels: (input: Pick<ImgBedInput, "endpoint" | "token">, options?: ImgBedOptions) => Promise<ImgBedChannels>;
  testImgBedConnection: (input: ImgBedInput, options?: ImgBedOptions) => Promise<boolean>;
  uploadImgBedImage: (input: ImgBedInput & { bytes: Uint8Array; mimeType: string; filename: string }, options?: ImgBedOptions) => Promise<{ url: string }>;
};
