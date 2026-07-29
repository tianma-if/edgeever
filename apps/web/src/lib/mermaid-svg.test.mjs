import { describe, expect, test } from "bun:test";
import { getMermaidSvgPresentation } from "./mermaid-svg";

describe("Mermaid SVG presentation", () => {
  test("uses the viewBox as the authoritative diagram dimensions", () => {
    expect(getMermaidSvgPresentation(
      '<svg width="400" height="300" viewBox="0 0 1935.6325833333335 1888.952" style="--bg:#FFFFFF;--fg:#27272A"></svg>'
    )).toEqual({
      width: 1935.6325833333335,
      height: 1888.952,
      backgroundColor: "#FFFFFF",
      foregroundColor: "#27272A",
    });
  });

  test("falls back to explicit dimensions when the viewBox is unavailable", () => {
    expect(getMermaidSvgPresentation('<svg width="720px" height="480px"></svg>')).toEqual({
      width: 720,
      height: 480,
      backgroundColor: null,
      foregroundColor: null,
    });
  });

  test("uses safe defaults and rejects arbitrary style values", () => {
    expect(getMermaidSvgPresentation('<svg style="--bg:url(javascript:alert(1));--fg:rgb(15, 23, 42)"></svg>')).toEqual({
      width: 1600,
      height: 900,
      backgroundColor: null,
      foregroundColor: "rgb(15, 23, 42)",
    });
  });
});
