import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("image gallery layout", () => {
  test("reserves a wrapping toolbar row instead of overlaying image controls", () => {
    const toolbar = globals.match(/\.ProseMirror \.edgeever-image-gallery__toolbar \{([^}]+)\}/)?.[1];
    expect(toolbar).toContain("position: relative;");
    expect(toolbar).toContain("flex-wrap: wrap;");
    expect(toolbar).toContain("max-width: 100%;");
    expect(toolbar).toContain("margin-bottom: 0.5rem;");
    expect(toolbar).not.toContain("position: absolute");
    expect(toolbar).not.toContain("opacity: 0");
  });

  test("fills React image node grid cells without exposing a persistent background", () => {
    expect(globals).toContain(
      ".edgeever-image-gallery__content > div > div > .edgeever-image-node {",
    );
    expect(globals).toMatch(
      /\.edgeever-image-gallery__content > div > div > \.edgeever-image-node \{[\s\S]*?width: 100% !important;[\s\S]*?min-width: 0;[\s\S]*?background: transparent;/,
    );
    expect(globals).toMatch(
      /\.edgeever-image-gallery__content > div > div > \.edgeever-image-node > img \{[\s\S]*?width: 100% !important;[\s\S]*?object-fit: cover;/,
    );
  });
});
