import { describe, expect, test } from "bun:test";

globalThis.window = {
  edgeeverDesktop: { isAvailable: true, apiBaseUrl: "https://notes.example.com" },
};

const {
  mapTiptapResourceUrls,
  createStagedResourceListItem,
  toApiResourceUrl,
  toDesktopResourceUrl,
} = await import("./desktop-resources.ts");

describe("desktop resource URLs", () => {
  test("maps remote resource URLs to the native cache protocol", () => {
    expect(toDesktopResourceUrl("/api/v1/resources/resource-1/blob")).toBe("edgeever-resource://resource/resource-1");
    expect(toDesktopResourceUrl("https://cdn.example.com/image.png")).toBe("https://cdn.example.com/image.png");
  });

  test("restores portable API URLs before a memo is saved", () => {
    expect(toApiResourceUrl("edgeever-resource://resource/resource-1")).toBe("/api/v1/resources/resource-1/blob");
    const mapped = mapTiptapResourceUrls({
      type: "doc",
      content: [{ type: "image", attrs: { src: "edgeever-resource://resource/resource-1" } }],
    }, toApiResourceUrl);
    expect(mapped.content?.[0]?.attrs?.src).toBe("/api/v1/resources/resource-1/blob");
  });

  test("exposes staged offline attachments as local resources", () => {
    expect(createStagedResourceListItem({ id: "stage-1", memoId: "memo-1", name: "photo.png", type: "image/png", size: 42 }, "2026-01-01T00:00:00.000Z")).toMatchObject({
      id: "staged_stage-1",
      memoId: "memo-1",
      kind: "image",
      byteSize: 42,
      url: "edgeever-staged://stage-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
