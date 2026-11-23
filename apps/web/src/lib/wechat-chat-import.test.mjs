import { describe, expect, test } from "bun:test";
import { FILE_ATTACHMENT_NODE_TYPE, resolveMemoContentDoc } from "@edgeever/shared";
import { IMAGE_WIDTH_PRESETS } from "@edgeever/shared/image-display";
import { createWeChatChatMemo } from "./wechat-chat-import.ts";

const memo = {
  id: "memo_1",
  revision: 1,
  contentHash: "hash",
  title: "聊天记录_20260922_223222",
  tags: [],
  contentMarkdown: "",
};

describe("WeChat chat note", () => {
  test("stores the picture inline and the video as an attachment", async () => {
    let updated = null;
    const result = await createWeChatChatMemo({
      notebookId: "nb_inbox",
      title: memo.title,
      markdown: [
        "**鱼** · 2026年9月22日 22:15",
        "",
        "![微信图片_1.jpg](edgeever-wechat-media://m1)",
        "",
        "**鱼** · 2026年9月22日 22:20",
        "",
        "[附件：微信视频_1.mp4](edgeever-wechat-media://m2)",
      ].join("\n"),
      media: [
        { id: "m1", filename: "微信图片_1.jpg", mimeType: "image/jpeg", byteSize: 4 },
        { id: "m2", filename: "微信视频_1.mp4", mimeType: "video/mp4", byteSize: 4 },
      ],
      createMemo: async () => ({ memo }),
      readMedia: async (item) => new File([item.id], item.filename, { type: item.mimeType }),
      uploadResource: async (_memoId, file) => ({ url: `edgeever-staged://${file.name}` }),
      updateMemo: async (_created, content) => {
        updated = content;
        return { memo: { ...memo, contentMarkdown: content.contentMarkdown } };
      },
    });
    expect(result.contentMarkdown).toContain("edgeever-staged://微信图片_1.jpg");
    expect(result.contentMarkdown).toContain("edgeever-staged://微信视频_1.mp4");
    expect(result.contentMarkdown).not.toContain("edgeever-wechat-media://");
    const saved = JSON.stringify(updated.contentJson);
    expect(saved).toContain("edgeever-staged://微信图片_1.jpg");
    expect(saved).toContain(FILE_ATTACHMENT_NODE_TYPE);
    expect(updated.contentJson.content.find((node) => node.type === "image")?.attrs?.width).toBe(
      IMAGE_WIDTH_PRESETS.find((preset) => preset.id === "small").width,
    );
    expect(resolveMemoContentDoc(updated.contentJson, updated.contentMarkdown).content.find(
      (node) => node.type === "image",
    )?.attrs?.width).toBe(IMAGE_WIDTH_PRESETS.find((preset) => preset.id === "small").width);
  });

  test("removes the empty note when an attachment cannot be saved", async () => {
    const deleted = [];
    await expect(createWeChatChatMemo({
      notebookId: "nb_inbox",
      title: "聊天记录",
      markdown: "![图.jpg](edgeever-wechat-media://m1)",
      media: [{ id: "m1", filename: "图.jpg", mimeType: "image/jpeg", byteSize: 1 }],
      createMemo: async () => ({ memo }),
      readMedia: async () => new File(["x"], "图.jpg", { type: "image/jpeg" }),
      uploadResource: async () => { throw new Error("offline"); },
      updateMemo: async () => { throw new Error("should not update"); },
      deleteMemo: async (id) => { deleted.push(id); },
    })).rejects.toThrow("offline");
    expect(deleted).toEqual(["memo_1"]);
  });

  test("groups consecutive images into an image gallery", async () => {
    let updated = null;
    await createWeChatChatMemo({
      notebookId: "nb_inbox",
      title: "多图聊天记录",
      markdown: [
        "![图1.jpg](edgeever-wechat-media://m1)",
        "",
        "![图2.jpg](edgeever-wechat-media://m2)",
      ].join("\n"),
      media: [
        { id: "m1", filename: "图1.jpg", mimeType: "image/jpeg", byteSize: 2 },
        { id: "m2", filename: "图2.jpg", mimeType: "image/jpeg", byteSize: 2 },
      ],
      createMemo: async () => ({ memo }),
      readMedia: async (item) => new File(["a"], item.filename, { type: item.mimeType }),
      uploadResource: async (_id, file) => ({ url: `edgeever-staged://${file.name}` }),
      updateMemo: async (_created, content) => {
        updated = content;
        return { memo: { ...memo, contentMarkdown: content.contentMarkdown } };
      },
    });
    expect(updated.contentJson.content.some((node) => node.type === "edgeeverImageGallery")).toBe(true);
    const gallery = updated.contentJson.content.find((node) => node.type === "edgeeverImageGallery");
    expect(gallery?.content?.length).toBe(2);
  });

  test("keeps all twelve staged image links distinct in the same note", async () => {
    const media = Array.from({ length: 12 }, (_, index) => ({
      id: `m${index + 1}`,
      filename: `图${index + 1}.jpg`,
      mimeType: "image/jpeg",
      byteSize: 1,
    }));
    const uploaded = [];
    const saved = await createWeChatChatMemo({
      notebookId: "nb_inbox",
      title: "多图聊天记录",
      markdown: media.map(({ id, filename }) => `![${filename}](edgeever-wechat-media://${id})`).join("\n\n"),
      media,
      createMemo: async () => ({ memo }),
      readMedia: async ({ filename, mimeType }) => new File(["x"], filename, { type: mimeType }),
      uploadResource: async (memoId) => {
        const url = `edgeever-staged://stage-${uploaded.length + 1}-id`;
        uploaded.push({ memoId, url });
        return { url };
      },
      updateMemo: async (created, content) => ({ memo: { ...created, ...content } }),
    });

    const gallery = saved.contentJson.content.find((node) => node.type === "edgeeverImageGallery");
    expect(gallery?.content.map((node) => node.attrs.src)).toEqual(uploaded.map(({ url }) => url));
    expect(uploaded).toHaveLength(12);
    expect(uploaded.every(({ memoId }) => memoId === memo.id)).toBe(true);
  });
});

