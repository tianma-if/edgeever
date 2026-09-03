import { describe, expect, test } from "bun:test";
import {
  UNSUPPORTED_BLOCK_NODE_TYPE,
  UNSUPPORTED_INLINE_NODE_TYPE,
  UNSUPPORTED_MARK_TYPE,
  prepareNativeEditorContent,
  restoreNativeEditorContent,
} from "./mobile-content-compatibility.ts";
import { docToMarkdown } from "./content.ts";

const futureDocument = {
  type: "doc",
  content: [
    {
      type: "edgeeverThemeBlock",
      attrs: { kind: "warning", futureOption: true },
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "保留主题块正文" }],
      }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "带格式文本",
          marks: [
            { type: "futureComment", attrs: { threadId: "thread-1" } },
            { type: "bold" },
          ],
        },
        {
          type: "futureMention",
          attrs: { userId: "user-1", label: "小明" },
        },
      ],
    },
  ],
};

describe("native editor unknown-content compatibility", () => {
  test("replaces unknown block, inline node, and mark with schema-safe placeholders", () => {
    const prepared = prepareNativeEditorContent(futureDocument, "zh-CN");

    expect(prepared.content[0]).toMatchObject({
      type: UNSUPPORTED_BLOCK_NODE_TYPE,
      attrs: {
        originalType: "edgeeverThemeBlock",
        displayLabel: "暂不支持的内容：edgeeverThemeBlock",
      },
    });
    expect(prepared.content[1]?.content?.[0]).toMatchObject({
      type: "text",
      marks: [
        { type: "bold" },
        { type: UNSUPPORTED_MARK_TYPE },
      ],
    });
    expect(prepared.content[1]?.content?.[1]).toMatchObject({
      type: UNSUPPORTED_INLINE_NODE_TYPE,
      attrs: { originalType: "futureMention" },
    });
  });

  test("restores the original JSON exactly before persistence", () => {
    expect(restoreNativeEditorContent(prepareNativeEditorContent(futureDocument)))
      .toEqual(futureDocument);
  });

  test("keeps image galleries native on Android and iOS", () => {
    const galleryDocument = {
      type: "doc",
      content: [{
        type: "edgeeverImageGallery",
        attrs: { layout: "auto" },
        content: [
          { type: "image", attrs: { src: "/one.png" } },
          { type: "image", attrs: { src: "/two.png" } },
        ],
      }],
    };

    expect(prepareNativeEditorContent(galleryDocument)).toEqual(galleryDocument);
    expect(restoreNativeEditorContent(prepareNativeEditorContent(galleryDocument)))
      .toEqual(galleryDocument);
  });

  test("keeps Markdown generation alive by projecting unknown content to text", () => {
    const markdown = docToMarkdown(futureDocument);
    expect(markdown).toContain("保留主题块正文");
    expect(markdown).toContain("带格式文本");
    expect(markdown).toContain("Unsupported content: futureMention");
  });
});
