import { requireNativeModule } from "expo";

type WeChatArchive = {
  transcript: string;
  media: { name: string; data: string }[];
  cacheUri: string;
};

export const extractWeChatArchive = (uri: string) =>
  requireNativeModule<{ extract: (uri: string) => Promise<WeChatArchive> }>("EdgeEverWeChatArchive").extract(uri);
