import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const imageNodeSource = readSource("../apps/web/src/components/editor/ResizableImage.tsx");
const imageViewerSource = readSource("../apps/web/src/components/editor/ImageViewer.tsx");
const editorSource = readSource("../apps/web/src/components/EditorPane.tsx");
const englishSource = readSource("../packages/shared/src/i18n/en-US.ts");
const chineseSource = readSource("../packages/shared/src/i18n/zh-CN.ts");

describe("web note image preview", () => {
  test("opens the same preview flow from double-click and an accessible button", () => {
    expect(imageNodeSource).toContain("onDoubleClick={(event) => {");
    expect(imageNodeSource.match(/requestImagePreview\(\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(imageNodeSource).toContain('aria-label={t("editor.previewImage")}');
    expect(imageNodeSource).toContain("<TooltipContent");
  });

  test("hosts one zoomable lightbox at the editor level", () => {
    expect(editorSource).toContain("IMAGE_PREVIEW_SHOW_EVENT");
    expect(editorSource).toContain("<ImageViewer");
    expect(imageViewerSource).toContain("plugins={[Zoom]}");
    expect(imageViewerSource).toContain("closeOnBackdropClick: true");
    expect(imageViewerSource).toContain('toolbar={{ buttons: ["zoom", "close"] }}');
  });

  test("keeps viewer controls bilingual", () => {
    for (const source of [englishSource, chineseSource]) {
      expect(source).toContain("previewImage:");
      expect(source).toContain("imageZoomIn:");
      expect(source).toContain("closeImagePreview:");
    }
  });
});
