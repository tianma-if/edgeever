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

  test("includes terminal header bar when fontStyle is mono", () => {
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

    expect(markup).toContain("edgeever-terminal-header");
    expect(markup).toContain("dot-red");
    expect(markup).toContain("dot-green");
    expect(markup).not.toContain("edgeever-card-footer");
  });

  test("generates valid card CSS with selected theme variables", () => {
    const midnightCss = generateCardCss({
      theme: "midnight",
      fontStyle: "mono",
      fontSize: "lg",
      cardWidth: "wide",
    });

    expect(midnightCss).toContain(NOTE_IMAGE_THEMES.midnight.canvasBg);
    expect(midnightCss).toContain("800px");
    expect(midnightCss).toContain("JetBrains Mono");
  });

  test("generates notepad theme with tear strip, ruled lines, and brand logo", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Notepad Note",
      notebook: "Work",
      bodyHtml: "<p>Smartisan style note line</p>",
      theme: "notepad",
      fontStyle: "serif",
      showTitle: true,
      showNotebook: false,
      showTags: false,
      showUpdatedAt: true,
      showBranding: true,
    });

    expect(markup).toContain("edgeever-card-tear-strip");
    expect(markup).toContain("edgeever-brand-logo");
    expect(markup).not.toContain("edgeever-meta-notebook");

    const notepadCss = generateCardCss({
      theme: "notepad",
      fontStyle: "serif",
      fontSize: "lg",
      cardWidth: "standard",
    });
    expect(notepadCss).toContain("edgeever-card-tear-strip");
    expect(notepadCss).toContain("edgeever-brand-logo");
  });

  test("generates xuan rice paper theme with brand logo", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Poem Note",
      bodyHtml: "<p>东方诗意</p>",
      theme: "xuan",
      fontStyle: "serif",
      showTitle: true,
      showBranding: true,
    });

    expect(markup).toContain("edgeever-brand-logo");
  });
});

