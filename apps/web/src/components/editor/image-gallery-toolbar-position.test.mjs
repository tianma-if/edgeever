import { describe, expect, test } from "bun:test";
import { computePosition } from "@floating-ui/react-dom";
import { imageGalleryToolbarPosition } from "./image-gallery-toolbar-position";

// The editor scroll viewport starts below its header and formatting toolbar.
const clip = { x: 240, y: 120, width: 720, height: 500 };
const positionToolbar = (reference, dimensions = { width: 360, height: 44 }) => {
  const floating = { style: {} };
  return computePosition({}, floating, {
    ...imageGalleryToolbarPosition,
    platform: {
      getElementRects: () => ({ reference, floating: { x: 0, y: 0, ...dimensions } }),
      getClippingRect: () => clip,
      getDimensions: () => dimensions,
      getOffsetParent: () => null,
      isElement: () => false,
      getDocumentElement: () => ({}),
      isRTL: () => false,
    },
  }).then((result) => ({ ...result, maxWidth: floating.style.maxWidth }));
};

describe("gallery toolbar clipping", () => {
  test("moves inside the first gallery instead of under the editor header", async () => {
    const position = await positionToolbar({ x: 260, y: 136, width: 680, height: 600 });
    expect(position.placement).toBe("bottom-start");
    expect(position.y).toBe(144);
    expect(position.middlewareData.hide.referenceHidden).toBe(false);
  });

  test("stays above a gallery when there is room", async () => {
    const position = await positionToolbar({ x: 260, y: 240, width: 680, height: 200 });
    expect(position.placement).toBe("top-start");
    expect(position.y + 44).toBe(232);
  });

  test("keeps the toolbar reachable while a tall gallery scrolls past the top", async () => {
    const position = await positionToolbar({ x: 260, y: -100, width: 680, height: 600 });
    expect(position.y).toBeGreaterThanOrEqual(clip.y + 8);
    expect(position.y + 44).toBeLessThanOrEqual(clip.y + clip.height - 8);
    expect(position.middlewareData.hide.referenceHidden).toBe(false);
  });

  test("hides controls once the gallery has entirely left the scroll viewport", async () => {
    const position = await positionToolbar({ x: 260, y: -1000, width: 680, height: 600 });
    expect(position.middlewareData.hide.referenceHidden).toBe(true);
  });

  test("constrains a wrapped toolbar to the gallery and horizontal clipping bounds", async () => {
    const position = await positionToolbar({ x: 680, y: 136, width: 240, height: 400 }, { width: 240, height: 112 });
    expect(position.maxWidth).toBe("240px");
    expect(position.x).toBeGreaterThanOrEqual(clip.x + 8);
    expect(position.x + 240).toBeLessThanOrEqual(clip.x + clip.width - 8);
    expect(position.y).toBeGreaterThanOrEqual(clip.y + 8);
  });
});
