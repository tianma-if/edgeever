import { describe, expect, test } from "bun:test";
import {
  clampFloatingPanelPosition,
  resolveAnchoredFloatingPanelLayout,
} from "./floating-panel.ts";

describe("resolveAnchoredFloatingPanelLayout", () => {
  test("shifts a below-anchor panel upward instead of shortening it", () => {
    expect(resolveAnchoredFloatingPanelLayout(
      { left: 160, placement: "below", top: 360 },
      576,
      { width: 1440, height: 900 },
    )).toEqual({
      left: 160,
      maxHeight: 630,
      top: 258,
    });
  });

  test("keeps an above-anchor panel aligned when it has enough room", () => {
    expect(resolveAnchoredFloatingPanelLayout(
      { left: 160, placement: "above", top: 720 },
      576,
      { width: 1440, height: 900 },
    )).toEqual({
      bottom: 180,
      left: 160,
      maxHeight: 630,
    });
  });

  test("keeps the preferred height inside short and narrow viewports", () => {
    expect(resolveAnchoredFloatingPanelLayout(
      { left: 900, placement: "below", top: 300 },
      576,
      { width: 800, height: 500 },
    )).toEqual({
      left: 212,
      maxHeight: 350,
      top: 138,
    });
  });
});

describe("clampFloatingPanelPosition", () => {
  test("keeps an in-bounds position unchanged", () => {
    expect(clampFloatingPanelPosition(
      { left: 160, top: 120 },
      { width: 576, height: 420 },
      { width: 1440, height: 900 },
    )).toEqual({ left: 160, top: 120 });
  });

  test("keeps the panel inside every viewport edge", () => {
    expect(clampFloatingPanelPosition(
      { left: 2000, top: 1200 },
      { width: 576, height: 420 },
      { width: 1440, height: 900 },
    )).toEqual({ left: 852, top: 468 });

    expect(clampFloatingPanelPosition(
      { left: -100, top: -80 },
      { width: 576, height: 420 },
      { width: 1440, height: 900 },
    )).toEqual({ left: 12, top: 12 });
  });
});
