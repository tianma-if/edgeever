import { describe, expect, test } from "bun:test";
import { rewriteMemoResourcesForShare } from "./sharing.ts";

describe("shared memo resources", () => {
  test("rewrites owned images and attachments without touching external links", () => {
    const source = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/api/v1/resources/res_image/blob", alt: "Image" } },
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "Attachment",
            marks: [{ type: "link", attrs: { href: "/api/v1/resources/res_file/blob", target: "_blank" } }],
          }],
        },
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "External",
            marks: [{ type: "link", attrs: { href: "https://example.com/file" } }],
          }],
        },
      ],
    };

    const rewritten = rewriteMemoResourcesForShare(source, "share_token");

    expect(rewritten.content[0].attrs.src).toBe("/api/public/shares/share_token/resources/res_image/blob");
    expect(rewritten.content[1].content[0].marks[0].attrs.href).toBe(
      "/api/public/shares/share_token/resources/res_file/blob",
    );
    expect(rewritten.content[2].content[0].marks[0].attrs.href).toBe("https://example.com/file");
    expect(source.content[0].attrs.src).toBe("/api/v1/resources/res_image/blob");
  });

  test("rewrites references to publicly shared notes without exposing private targets", () => {
    const source = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "Public", marks: [{ type: "link", attrs: { href: "#memo=memo_public" } }] },
          { type: "text", text: "Private", marks: [{ type: "link", attrs: { href: "#memo=memo_private" } }] },
        ],
      }],
    };

    const rewritten = rewriteMemoResourcesForShare(source, "source_token", { memo_public: "target_token" });

    expect(rewritten.content[0].content[0].marks[0].attrs.href).toBe("/share/target_token");
    expect(rewritten.content[0].content[1].marks[0].attrs.href).toBe("#memo=memo_private");
  });
});
