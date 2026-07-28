import { describe, expect, test } from "bun:test";

const { rewriteStagedResource } = await import("./desktop-sync.ts");

describe("desktop staged resource sync", () => {
  test("rewrites placeholders in memo JSON and markdown", () => {
    const rewrites = [{ memoId: "memo-1", placeholder: "edgeever-staged://stage-1", url: "/api/v1/resources/resource-1/blob" }];
    const value = {
      contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "edgeever-staged://stage-1" } }] },
      contentMarkdown: "![photo](edgeever-staged://stage-1)",
    };

    expect(rewriteStagedResource(value, rewrites)).toEqual({
      contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/resources/resource-1/blob" } }] },
      contentMarkdown: "![photo](/api/v1/resources/resource-1/blob)",
    });
  });
});
