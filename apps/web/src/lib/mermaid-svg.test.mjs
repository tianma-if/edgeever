import { describe, expect, test } from "bun:test";
import { MERMAID_THEME_PALETTES } from "../components/ThemeProvider";
import {
  getMermaidSvgPresentation,
  MERMAID_NODE_TEXT_PX,
  mermaidDisplayScale,
  normalizeMermaidSvgForViewer,
  resolveMermaidViewerBackground,
  scaleMermaidSvg,
} from "./mermaid-svg";

describe("Mermaid SVG presentation", () => {
  test("scales drawn node text to 12px without changing the viewBox", () => {
    const scaled = scaleMermaidSvg(
      '<svg width="1894.44" height="787.4px" viewBox="0 0 1894.44 787.4" style="--bg:#f8fafb"><text font-size="13">节点</text></svg>',
    );

    expect(MERMAID_NODE_TEXT_PX).toBe(12);
    expect(scaled).toContain('width="1748.71"');
    expect(scaled).toContain('height="726.83px"');
    expect(scaled).toContain('viewBox="0 0 1894.44 787.4"');
    expect(scaled).toContain('font-size="13"');
    expect(scaleMermaidSvg('<svg width="100%" height="400" viewBox="0 0 800 400"></svg>')).toContain('width="100%"');
  });

  test("fits a wide diagram to the note column without going below 8px text", () => {
    const drawnWidth = 1894;
    expect(mermaidDisplayScale(drawnWidth, 1200)).toBeCloseTo(1200 / drawnWidth, 5);
    expect(mermaidDisplayScale(drawnWidth, 400)).toBeCloseTo(8 / 13, 5);
    expect(mermaidDisplayScale(480, 2000)).toBeCloseTo(12 / 13, 5);
    expect(MERMAID_NODE_TEXT_PX).toBe(12);
  });

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

  test("uses the selected Mermaid palette for official SVGs without a root background", () => {
    const lightAppBackground = "#ffffff";
    const darkMermaidBackground = MERMAID_THEME_PALETTES["zinc-dark"].bg;
    const presentation = getMermaidSvgPresentation(
      '<svg width="100%" viewBox="0 0 640 360" class="flowchart" aria-roledescription="flowchart-v2"></svg>'
    );
    const resolvedBackground = resolveMermaidViewerBackground(
      presentation.backgroundColor,
      darkMermaidBackground
    );

    expect(presentation.backgroundColor).toBeNull();
    expect(resolvedBackground).toBe(darkMermaidBackground);
    expect(resolvedBackground).not.toBe(lightAppBackground);
    expect(resolveMermaidViewerBackground("#123456", darkMermaidBackground)).toBe("#123456");
  });

  test("gives percentage-sized SVGs explicit intrinsic viewer dimensions", () => {
    const originalDOMParser = globalThis.DOMParser;
    const originalXMLSerializer = globalThis.XMLSerializer;
    const root = {
      attributes: new Map([
        ["width", "100%"],
        ["height", null],
        ["viewBox", "0 0 1609.306640625 3598"],
        ["style", null],
      ]),
      tagName: "svg",
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      },
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
    };

    globalThis.DOMParser = class {
      parseFromString() {
        return { documentElement: root, querySelector: () => null };
      }
    };
    globalThis.XMLSerializer = class {
      serializeToString() {
        return `width=${root.attributes.get("width")};height=${root.attributes.get("height")}`;
      }
    };

    try {
      expect(normalizeMermaidSvgForViewer(
        '<svg width="100%" viewBox="0 0 1609.306640625 3598"></svg>'
      )).toBe("width=1609.306640625;height=3598");
    } finally {
      globalThis.DOMParser = originalDOMParser;
      globalThis.XMLSerializer = originalXMLSerializer;
    }
  });
});
