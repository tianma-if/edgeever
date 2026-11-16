import type { createEdgeEverClient } from "@edgeever/client";
import { renderWeChatChat } from "../../../desktop/src/main/wechat-chat-transcript.cjs";
import type { MobileSharedPayload } from "./mobile-web-clip";

const STAGED_ARCHIVE_PATH = /\/shared-wechat-[0-9a-f-]{36}\.zip$/;

export const getSharedWeChatArchive = (payloads: MobileSharedPayload[]) => {
  for (const payload of payloads) {
    const uri = payload.contentUri;
    const filename = payload.originalName?.trim() || "聊天记录.zip";
    if (uri?.startsWith("file:") && STAGED_ARCHIVE_PATH.test(uri)) {
      return { uri, filename };
    }
  }
  return null;
};

type WeChatMemoClient = Pick<ReturnType<typeof createEdgeEverClient>,
  "createMemo" | "createMemoEditSession" | "updateMemo" | "deleteMemo">;

export type WeChatUploadAsset = { uri: string; name: string; type: string };

export class WeChatImportCleanupError extends Error {}

export const WECHAT_ARCHIVE_STORAGE_HINT = "手机存储空间不足。请释放一些空间，然后从微信重新分享。";

export const getWeChatArchiveErrorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

export const getWeChatArchiveExtractionHint = (error: unknown) => {
  switch (getWeChatArchiveErrorCode(error)) {
    case "ERR_WECHAT_ARCHIVE_STORAGE":
      return WECHAT_ARCHIVE_STORAGE_HINT;
    case "ERR_WECHAT_ARCHIVE_EXPANDED_SIZE":
      return "解压后的聊天记录超过 256 MB。请分批从微信分享。";
    default:
      return "无法读取聊天压缩包。请从微信重新分享聊天记录。";
  }
};

export const saveMobileWeChatChat = async (input: {
  client: WeChatMemoClient;
  notebookId: string;
  filename: string;
  transcript: string;
  media: { name: string; data: string }[];
  upload: (memoId: string, asset: WeChatUploadAsset) => Promise<string>;
}) => {
  const { client, notebookId } = input;
  const note = renderWeChatChat(input.transcript, input.filename, input.media);
  if (!note) throw new Error("Empty chat transcript");
  const { memo } = await client.createMemo({
    notebookId,
    title: note.title.slice(0, 160),
    contentMarkdown: note.media.length ? "" : note.markdown,
  });
  if (!note.media.length) return memo;

  try {
    const urls = new Map<string, string>();
    for (const attachment of note.media) {
      const url = await input.upload(memo.id, {
        uri: attachment.data,
        name: attachment.filename,
        type: attachment.mimeType,
      });
      urls.set(attachment.id, url);
    }
    const contentMarkdown = note.markdown.replace(/edgeever-wechat-media:\/\/(m\d+)(?=\))/g, (original, id: string) =>
      urls.get(id) ?? original);
    const { editSession } = await client.createMemoEditSession(memo.id);
    return (await client.updateMemo(memo.id, {
      contentMarkdown,
      expectedRevision: memo.revision,
      expectedContentHash: memo.contentHash,
      editSessionId: editSession.id,
    })).memo;
  } catch (error) {
    try {
      await client.deleteMemo(memo.id);
      await client.deleteMemo(memo.id, { permanent: true });
    } catch {
      throw new WeChatImportCleanupError("Could not remove the incomplete chat import", { cause: error });
    }
    throw error;
  }
};
