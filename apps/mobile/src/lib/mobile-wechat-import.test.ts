import { describe, expect, test } from "bun:test";
import {
  getSharedWeChatArchive,
  getWeChatArchiveExtractionHint,
  saveMobileWeChatChat,
  WECHAT_ARCHIVE_STORAGE_HINT,
  WeChatImportCleanupError,
} from "./mobile-wechat-import";

const archiveUri = "file:/cache/shared-wechat-e411fb66-d811-4ade-abcd-a6130470dc09.zip";
const memo = { id: "memo-1", revision: 1, contentHash: "hash" };
const transcript = "·小明\n2026年9月22日 22:15\n你好\n[图片] 现场.jpg";
const media = [{ name: "聊天记录内的图片、视频和文件/现场.jpg", data: "file:///cache/现场.jpg" }];

const setup = () => {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const removed: unknown[] = [];
  const input = {
    notebookId: "inbox",
    filename: "聊天记录.zip",
    transcript,
    media,
    client: {
      createMemo: async (payload: unknown) => { created.push(payload); return { memo }; },
      createMemoEditSession: async () => ({ editSession: { id: "session-1" } }),
      updateMemo: async (id: string, payload: unknown) => { updated.push({ id, payload }); return { memo }; },
      deleteMemo: async (id: string, options?: { permanent?: boolean }) => { removed.push({ id, ...options }); },
    } as Parameters<typeof saveMobileWeChatChat>[0]["client"],
    upload: async () => "/api/v1/resources/image-1",
  };
  return { input, created, updated, removed };
};

describe("Android WeChat share import", () => {
  test("uses the staged archive even when the sender labels the share as a generic binary", () => {
    expect(getSharedWeChatArchive([{ contentMimeType: "application/octet-stream", contentUri: archiveUri }]))
      .toEqual({ uri: archiveUri, filename: "聊天记录.zip" });
    expect(getSharedWeChatArchive([{ mimeType: "application/zip", value: "content://wechat/outgoing/1" }])).toBeNull();
    expect(getSharedWeChatArchive([{ contentMimeType: "image/jpeg", contentUri: "file:///cache/shared.jpg" }])).toBeNull();
  });

  test("distinguishes low storage, the expansion limit, and an unreadable archive", () => {
    expect(getWeChatArchiveExtractionHint({ code: "ERR_WECHAT_ARCHIVE_STORAGE" })).toBe(WECHAT_ARCHIVE_STORAGE_HINT);
    expect(getWeChatArchiveExtractionHint({ code: "ERR_WECHAT_ARCHIVE_EXPANDED_SIZE" })).toContain("256 MB");
    expect(getWeChatArchiveExtractionHint(new Error("bad zip"))).toBe("无法读取聊天压缩包。请从微信重新分享聊天记录。");
  });

  test("saves the transcript with the uploaded image in the message and guards the edit", async () => {
    const { input, created, updated } = setup();
    expect(await saveMobileWeChatChat(input)).toBe(memo);
    expect(created).toEqual([{ notebookId: "inbox", title: "聊天记录 · 2026-09-22 22:15", contentMarkdown: "" }]);
    expect(updated).toEqual([{
      id: memo.id,
      payload: {
        contentMarkdown: "**小明** · 2026年9月22日 22:15\n\n你好\n\n![现场.jpg](/api/v1/resources/image-1)",
        expectedRevision: 1,
        expectedContentHash: "hash",
        editSessionId: "session-1",
      },
    }]);
  });

  test("saves a text-only chat in one request", async () => {
    const { input, created, updated } = setup();
    await saveMobileWeChatChat({ ...input, transcript: "你好", media: [] });
    expect(created).toEqual([{ notebookId: "inbox", title: "聊天记录", contentMarkdown: "你好" }]);
    expect(updated).toEqual([]);
  });

  test("removes a partially created note if the attachment upload fails", async () => {
    const { input, removed, updated } = setup();
    const error = new Error("upload failed");
    await expect(saveMobileWeChatChat({ ...input, upload: async () => { throw error; } })).rejects.toBe(error);
    expect(removed).toEqual([{ id: memo.id }, { id: memo.id, permanent: true }]);
    expect(updated).toEqual([]);
  });

  test("reports when an incomplete note could not be removed", async () => {
    const { input } = setup();
    input.client.deleteMemo = async () => { throw new Error("offline"); };
    await expect(saveMobileWeChatChat({ ...input, upload: async () => { throw new Error("upload failed"); } }))
      .rejects.toBeInstanceOf(WeChatImportCleanupError);
  });
});
