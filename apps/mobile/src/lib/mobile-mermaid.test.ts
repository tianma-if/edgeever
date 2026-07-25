import { describe, expect, test } from "bun:test";
import {
  getMermaidSvgAspectRatio,
  getMobileMarkdownFenceLanguage,
  sanitizeMobileMermaidSvg,
  trimMobileMarkdownFenceContent,
} from "./mobile-mermaid";

describe("mobile Mermaid rendering", () => {
  test("recognizes Mermaid fence info case-insensitively", () => {
    expect(getMobileMarkdownFenceLanguage(" Mermaid ")).toBe("mermaid");
    expect(getMobileMarkdownFenceLanguage("typescript title=example")).toBe("typescript");
  });

  test("removes only the parser-added trailing newline", () => {
    expect(trimMobileMarkdownFenceContent("flowchart LR\n  A --> B\n")).toBe("flowchart LR\n  A --> B");
    expect(trimMobileMarkdownFenceContent("flowchart LR")).toBe("flowchart LR");
  });

  test("derives a stable native layout ratio from Mermaid SVG output", () => {
    expect(getMermaidSvgAspectRatio('<svg viewBox="0 0 800 400"></svg>')).toBe(2);
    expect(getMermaidSvgAspectRatio("<svg></svg>")).toBe(1.6);
  });

  test("normalizes SVG 2 marker orientation for react-native-svg", () => {
    expect(sanitizeMobileMermaidSvg('<marker orient="auto-start-reverse" />')).toBe('<marker orient="auto" />');
    expect(sanitizeMobileMermaidSvg("<marker orient='auto-start-reverse' />")).toBe("<marker orient='auto' />");
    expect(sanitizeMobileMermaidSvg('<marker orient="45" />')).toBe('<marker orient="45" />');
  });
});
