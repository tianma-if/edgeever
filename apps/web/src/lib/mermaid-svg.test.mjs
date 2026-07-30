import { describe, expect, test } from "bun:test";
import { MERMAID_THEME_PALETTES } from "../components/ThemeProvider";
import {
  getMermaidSvgPresentation,
  normalizeMermaidSvgForViewer,
  resolveMermaidViewerBackground,
} from "./mermaid-svg";

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

  test("uses the selected Mermaid palette for official SVGs without a root background", () => {
    const lightAppBackground = "#ffffff";
    const darkMermaidBackground = MERMAID_THEME_PALETTES["github-dark"].bg;
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
