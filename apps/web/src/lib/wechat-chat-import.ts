import {
  docToMarkdown,
  groupConsecutiveImagesIntoGalleries,
  markdownToDoc,
  type TiptapDoc,
} from "@edgeever/shared";
import { IMAGE_WIDTH_PRESETS } from "@edgeever/shared/image-display";

export const WECHAT_MEDIA_URL_PREFIX = "edgeever-wechat-media://";
const WECHAT_MEDIA_URL = /edgeever-wechat-media:\/\/([A-Za-z0-9_-]+)/g;
const WECHAT_IMAGE_WIDTH = IMAGE_WIDTH_PRESETS.find((preset) => preset.id === "small")!.width;

type WeChatMedia = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
};

type WeChatMemo = {
  id: string;
  revision: number;
  contentHash: string;
  title: string | null;
  tags: string[];
  contentMarkdown: string;
};

const noteContent = (markdown: string) => {
  const parsed = markdownToDoc(markdown);
  const nodes = (parsed.content ?? []).map((node) => node.type === "image"
    ? { ...node, attrs: { ...node.attrs, width: WECHAT_IMAGE_WIDTH } }
    : node);
  const groupedNodes = groupConsecutiveImagesIntoGalleries(nodes);
  const contentJson: TiptapDoc = {
    type: "doc",
    content: groupedNodes.at(-1)?.type === "paragraph" ? groupedNodes : [...groupedNodes, { type: "paragraph" }],
  };
  return { contentJson, contentMarkdown: docToMarkdown(contentJson) };
};

export const createWeChatChatMemo = async <TMemo extends WeChatMemo>(input: {
  notebookId: string;
  title: string;
  markdown: string;
  media: WeChatMedia[];
  createMemo: (payload: {
    notebookId: string;
    title: string;
    contentMarkdown: string;
    tags: string[];
  }) => Promise<{ memo: TMemo }>;
  readMedia: (media: WeChatMedia) => Promise<File>;
  prepareFile?: (file: File) => Promise<File>;
  uploadResource: (memoId: string, file: File) => Promise<{ url: string }>;
  updateMemo: (
    memo: TMemo,
    content: { contentJson: TiptapDoc; contentMarkdown: string },
  ) => Promise<{ memo: TMemo }>;
  deleteMemo?: (memoId: string) => Promise<unknown>;
}) => {
  const created = await input.createMemo({
    notebookId: input.notebookId,
    title: input.title,
    contentMarkdown: "",
    tags: [],
  });
  try {
    const resourceUrls = new Map<string, string>();
    for (const media of input.media) {
      const file = await input.readMedia(media);
      const prepared = input.prepareFile ? await input.prepareFile(file) : file;
      const resource = await input.uploadResource(created.memo.id, prepared);
      resourceUrls.set(media.id, resource.url);
    }
    const markdown = input.markdown.replace(WECHAT_MEDIA_URL, (url, id: string) => resourceUrls.get(id) ?? url);
    if (markdown.includes(WECHAT_MEDIA_URL_PREFIX)) {
      throw new Error("WeChat chat still contains an unresolved attachment");
    }
    return (await input.updateMemo(created.memo, noteContent(markdown))).memo;
  } catch (error) {
    await input.deleteMemo?.(created.memo.id).catch(() => undefined);
    throw error;
  }
};
