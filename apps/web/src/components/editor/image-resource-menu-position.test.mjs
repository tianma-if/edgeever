import { describe, expect, test } from "bun:test";
import { computePosition } from "@floating-ui/react-dom";
import { imageResourceMenuPosition } from "./image-resource-menu-position";

const menuSize = { width: 300, height: 42 };
const viewport = { x: 0, y: 0, width: 1024, height: 768 };

const positionMenu = (reference) => computePosition({}, {}, {
  ...imageResourceMenuPosition,
  platform: {
    getElementRects: () => ({ reference, floating: { x: 0, y: 0, ...menuSize } }),
    getClippingRect: () => viewport,
    getDimensions: () => menuSize,
    getOffsetParent: () => null,
    isElement: () => false,
    getDocumentElement: () => ({}),
    isRTL: () => false,
  },
});

const expectOutsideImage = (position, image) => {
  expect(position.y >= image.y + image.height + 8 ||
    position.y + menuSize.height <= image.y - 8).toBe(true);
  expect(position.x).toBeGreaterThanOrEqual(12);
  expect(position.x + menuSize.width).toBeLessThanOrEqual(viewport.width - 12);
};

describe("image resource menu positioning", () => {
  test("keeps actions below a short image instead of covering its adjustment controls", async () => {
    const image = { x: 300, y: 200, width: 500, height: 60 };
    const position = await positionMenu(image);
    expect(position.placement).toBe("bottom-end");
    expectOutsideImage(position, image);
  });

  test("flips above an image near the bottom of the viewport", async () => {
    const image = { x: 300, y: 700, width: 500, height: 60 };
    const position = await positionMenu(image);
    expect(position.placement.startsWith("top")).toBe(true);
    expectOutsideImage(position, image);
  });

  test("keeps the menu within horizontal bounds when the image is resized", async () => {
    for (const image of [
      { x: 0, y: 200, width: 160, height: 30 },
      { x: 900, y: 200, width: 124, height: 30 },
    ]) {
      expectOutsideImage(await positionMenu(image), image);
    }
  });
});
