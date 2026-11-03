import { describe, expect, test } from "bun:test";
import { rewriteMemoResourcesForShare } from "./sharing.ts";
import { docToMarkdown, markdownToDoc } from "./content.ts";

describe("shared memo resources", () => {
  test("retains resource queries and PDF page fragments in image and text links", () => {
    const suffix = "?download=1#page=3";
    const markdown = `[![thumb](/api/v1/resources/image/blob)](/api/v1/resources/manual/blob${suffix})\n\n[manual](/api/v1/resources/manual/blob${suffix})`;
    const source = markdownToDoc(markdown);
    const expected = structuredClone(source);
    for (const base of ["/api/public/shares/token/resources", "/api/public/notebook-shares/token/resources"]) {
      const access = base.includes("notebook-shares") ? { resourceBasePath: base, memoUrls: {} } : undefined;
      const exported = docToMarkdown(rewriteMemoResourcesForShare(source, "token", {}, access));
      expect(exported).toContain(`](${base}/manual/blob${suffix})`);
      expect(exported.match(/\?download=1#page=3/g)).toHaveLength(2);
    }
    expect(source).toEqual(expected);
  });
  test("maps image outer targets without treating their title as a resource", () => {
    const title = "/api/v1/resources/title/blob";
    const source = { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/resources/image/blob", link: { href: "/api/v1/resources/manual/blob", title } } }] };
    const rewritten = rewriteMemoResourcesForShare(source, "token");
    expect(rewritten.content[0].attrs.link).toEqual({ href: "/api/public/shares/token/resources/manual/blob", title });
    const notebook = rewriteMemoResourcesForShare(source, "token", {}, { resourceBasePath: "/api/public/notebook-shares/token/resources", memoUrls: {} });
    expect(notebook.content[0].attrs.link.href).toBe("/api/public/notebook-shares/token/resources/manual/blob");
    expect(source.content[0].attrs.link.href).toBe("/api/v1/resources/manual/blob");
  });
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


test("notebook shares use their own attachment scope, link within the directory, and disable private memo links", () => {
  const source = { type: "doc", content: [
    { type: "image", attrs: { src: "/api/v1/resources/image/blob" } },
    { type: "paragraph", content: [
      { type: "text", text: "Shared", marks: [{ type: "link", attrs: { href: "#memo=inside" } }] },
      { type: "text", text: "Private", marks: [{ type: "link", attrs: { href: "#memo=outside" } }] },
      { type: "text", text: "External", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
    ] },
  ] };
  const rewritten = rewriteMemoResourcesForShare(source, "token", {}, {
    resourceBasePath: "/api/public/notebook-shares/token/resources",
    memoUrls: { inside: "/share/notebook/token/inside" },
  });
  expect(rewritten.content[0].attrs.src).toBe("/api/public/notebook-shares/token/resources/image/blob");
  expect(rewritten.content[1].content[0].marks[0].attrs.href).toBe("/share/notebook/token/inside");
  expect(rewritten.content[1].content[1].marks).toEqual([]);
  expect(rewritten.content[1].content[2].marks[0].attrs.href).toBe("https://example.com");
  expect(source.content[1].content[1].marks).toHaveLength(1);
});
