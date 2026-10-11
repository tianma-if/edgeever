import { describe, expect, test } from "bun:test";
import {
  buildImageExportBasename,
  buildNoteImageCardMarkup,
  generateCardCss,
  NOTE_IMAGE_THEMES,
} from "./note-image-export.ts";

describe("note image export helpers", () => {
  test("sanitizes portable filenames and protects Windows device names", () => {
    expect(buildImageExportBasename(" Roadmap: Q3/Q4. ", "Untitled")).toBe("Roadmap- Q3-Q4");
    expect(buildImageExportBasename("CON", "Untitled")).toBe("_CON");
    expect(buildImageExportBasename("   ", "Untitled")).toBe("Untitled");
  });

  test("generates rich card markup with title, notebook, tags, and footer branding", () => {
    const markup = buildNoteImageCardMarkup({
      title: "My Note",
      notebook: "Work",
      tags: ["important", "idea"],
      updatedAt: "2026-08-22 19:00",
      bodyHtml: "<p>Hello World</p>",
      fontStyle: "sans",
      showTitle: true,
      showNotebook: true,
      showTags: true,
      showUpdatedAt: true,
      showBranding: true,
    });

    expect(markup).toContain("My Note");
    expect(markup).toContain("Work");
    expect(markup).toContain("#important");
    expect(markup).toContain("#idea");
    expect(markup).toContain("2026-08-22 19:00");
    expect(markup).toContain("Hello World");
    expect(markup).toContain("EdgeEver");
  });

  test("keeps terminal decoration separate from manual font choice", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Geek Note",
      notebook: "Dev",
      tags: [],
      updatedAt: "",
      bodyHtml: "<pre><code>console.log('hi')</code></pre>",
      fontStyle: "mono",
      showTitle: true,
      showBranding: false,
    });

    expect(markup).not.toContain("edgeever-terminal-header");
    expect(markup).not.toContain("dot-red");
    expect(markup).not.toContain("dot-green");
    expect(markup).not.toContain("edgeever-card-footer");
  });

  test("generates valid card CSS with selected theme variables", () => {
    const midnightCss = generateCardCss({
      theme: "midnight",
      fontStyle: "mono",
      fontSize: "lg",
      cardWidth: "wide",
    });

    expect(midnightCss).toContain(NOTE_IMAGE_THEMES.terminal.canvasBg);
    expect(midnightCss).toContain("800px");
    expect(midnightCss).toContain("JetBrains Mono");
  });

  test("generates editorial theme with brand logo", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Editorial Note",
      notebook: "Work",
      bodyHtml: "<p>New Yorker style editorial essay</p>",
      theme: "editorial",
      fontStyle: "serif",
      showTitle: true,
      showNotebook: false,
      showTags: false,
      showUpdatedAt: true,
      showBranding: true,
    });

    expect(markup).toContain('data-theme="editorial"');
    expect(markup).toContain("edgeever-brand-logo");
    expect(markup).not.toContain("edgeever-meta-notebook");

    const editorialCss = generateCardCss({
      theme: "editorial",
      fontStyle: "serif",
      fontSize: "lg",
      cardWidth: "standard",
    });
    expect(editorialCss).toContain('data-theme="editorial"');
    expect(editorialCss).toContain("edgeever-brand-logo");
  });

  test("generates film theme with brand logo", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Poem Note",
      bodyHtml: "<p>Kodak film aesthetic</p>",
      theme: "film",
      fontStyle: "serif",
      showTitle: true,
      showBranding: true,
    });

    expect(markup).toContain('data-theme="film"');
    expect(markup).toContain("edgeever-brand-logo");
  });
});

