import { describe, test, expect } from "bun:test";
import { Base64 } from "js-base64";
import { createPosterDocument, parsePosterDocument, serializePosterDocument, posterFallbackMarkdown, resizePosterDocument, PosterDocumentSchema } from "./poster";

describe("poster source compatibility", () => {
  test("round-trips editable elements, resources, source links and a portable preview", () => {
    const document = { ...createPosterDocument("知识卡片", "Read & share"), previewResourceId: "res_preview", sourceMemoId: "memo_source" };
    document.elements.push({ id: "image", name: "photo", type: "image", resourceId: "res_image", x: 10, y: 20, width: 50, height: 80, opacity: .5, locked: true, rotation: 30 });
    const markdown = serializePosterDocument(document);
    expect(parsePosterDocument(markdown)).toEqual(document);
    expect(posterFallbackMarkdown(document)).toContain("/api/v1/resources/res_preview/blob");
    expect(posterFallbackMarkdown(document)).toContain("/api/v1/resources/res_image/blob");
    expect(posterFallbackMarkdown(document)).not.toContain("edgeever-poster-v1");
  });
  test("rejects corrupt, unsupported and unsafe sources without executing arbitrary Fabric JSON", () => {
    for (const value of [null, { ...createPosterDocument(), schemaVersion: 2 }, { ...createPosterDocument(), width: Infinity }, { ...createPosterDocument(), elements: [{ type: "image", src: "https://example.com/tracker" }] }]) {
      const encoded = Base64.encodeURI(JSON.stringify(value));
      expect(parsePosterDocument(`<!-- edgeever-poster-v1:${encoded} -->`)).toBeNull();
    }
    expect(parsePosterDocument("ordinary note")).toBeNull();
    expect(PosterDocumentSchema.safeParse({ ...createPosterDocument(), elements: [createPosterDocument().elements[0], createPosterDocument().elements[0]] }).success).toBe(false);
  });
  test("resizing preserves IDs, source and locked elements with proportional geometry", () => {
    const document = createPosterDocument("Hello");
    const next = resizePosterDocument(document, 1080, 1080);
    expect(next.elements.map((element) => element.id)).toEqual(document.elements.map((element) => element.id));
    expect(next.elements[0].y).toBeCloseTo(document.elements[0].y * .75);
    expect(document.height).toBe(1440);
  });
  test("legacy Markdown shows text without allowing injected markup", () => {
    const fallback = posterFallbackMarkdown(createPosterDocument('<script>alert(1)</script>', '![x](https://example.com)'));
    expect(fallback).not.toContain('<script>');
    expect(fallback).toContain('\\!\\[x\\]');
  });
});

describe("editable design styles", () => {
  test("preserves real template curves, gradients, typography, badges, grouping and crop", () => {
    const document = { ...createPosterDocument("设计源稿", "Round trip"), templateId: "folio", platformId: "xhs", backgroundGradient: { kind: "linear", from: "#f4efe4", to: "#baf264", angle: 120 } };
    document.elements[1] = { ...document.elements[1], role: "title", sourceText: "设计源稿", fontFamily: "思源黑体 Heavy", fontStyle: "italic", underline: true, lineHeight: 1.08, charSpacing: -20, shadow: { color: "rgba(0,0,0,0.2)", blur: 20, offsetX: 4, offsetY: 6 }, groupId: "group_1" };
    document.elements.push({ id: "curve", name: "Curve", type: "path", path: "M 0 100 Q 100 0 200 100 Z", x: 40, y: 80, width: 200, height: 100, rotation: 15, opacity: .8, locked: false, fill: "#16a06e", stroke: "#07130b", strokeWidth: 12, gradient: { kind: "radial", from: "#ffffff", to: "#16a06e", angle: 90, stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "rgba(22,160,110,0.5)" }], coords: { x1: .5, y1: .5, x2: .5, y2: .5, r1: 0, r2: 1 } } });
    document.elements.push({ id: "image_crop", name: "Photo", type: "image", resourceId: "resource_photo", x: 0, y: 0, width: 1080, height: 1440, rotation: 0, opacity: 1, flipX: true, crop: { x: .2, y: 0, width: .6, height: 1 } });
    expect(parsePosterDocument(serializePosterDocument(document))).toEqual(document);
  });
  test("rejects executable SVG source, CSS injection, invalid gradients and huge geometry", () => {
    const base = createPosterDocument();
    const shape = { ...base.elements[0], type: "path", path: "M 0 0 L 50 50", fill: "#16a06e" };
    for (const patch of [{ path: '<svg onload="alert(1)">' }, { fill: "url(https://example.com/track)" }, { width: 100000 }, { gradient: { kind: "linear", from: "#ffffff", to: "#07130b", angle: 90, stops: [{ offset: 0, color: "url(foo)" }, { offset: 1, color: "#07130b" }] } }]) expect(PosterDocumentSchema.safeParse({ ...base, elements: [{ ...shape, ...patch }] }).success).toBe(false);
  });
});
