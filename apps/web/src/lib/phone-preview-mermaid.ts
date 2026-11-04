import type { Editor } from "@tiptap/react";
import { MERMAID_THEME_PALETTES, type MermaidThemeName } from "@/components/ThemeProvider";
import { renderThemedMermaidSvg } from "@/lib/mermaid-renderer";

const remapSvgIds = (svg: SVGElement, prefix: string) => {
  const renamed = new Map<string, string>();
  svg.querySelectorAll("[id]").forEach((element) => {
    const id = element.getAttribute("id");
    if (!id) return;
    const next = `${prefix}-${id}`;
    renamed.set(id, next);
    element.setAttribute("id", next);
  });

  svg.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value;
      let changed = false;
      for (const [from, to] of renamed) {
        const next = value
          .replaceAll(`url(#${from})`, `url(#${to})`)
          .replaceAll(`#${from}`, `#${to}`);
        if (next !== value) {
          value = next;
          changed = true;
        }
      }
      if (changed) element.setAttribute(attribute.name, value);
    }
  });
};

const renderMermaidSvg = async (source: string, theme: MermaidThemeName) => {
  const palette = MERMAID_THEME_PALETTES[theme] ?? MERMAID_THEME_PALETTES["zinc-light"];
  return renderThemedMermaidSvg(source, {
    palette,
    font: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: 16,
  });
};

export const embedMermaidForPreview = async (
  root: HTMLElement,
  editor?: Editor | null,
  mermaidTheme: MermaidThemeName = "zinc-light",
) => {
  const codeBlocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  if (codeBlocks.length === 0) return;

  const liveSvgs = editor
    ? Array.from(editor.view.dom.querySelectorAll<SVGElement>(".edgeever-mermaid-code-block .edgeever-mermaid-svg svg"))
    : [];

  await Promise.all(codeBlocks.map(async (codeBlock, index) => {
    const source = codeBlock.textContent?.trim();
    const pre = codeBlock.closest("pre");
    if (!source || !pre) return;

    try {
      const live = liveSvgs[index];
      let svgHtml = "";
      if (live) {
        const clone = live.cloneNode(true) as SVGElement;
        remapSvgIds(clone, `phone-mermaid-${index}`);
        svgHtml = clone.outerHTML;
      } else {
        svgHtml = await renderMermaidSvg(source, mermaidTheme);
      }

      const figure = document.createElement("figure");
      figure.className = "edgeever-phone-mermaid";
      figure.innerHTML = svgHtml;
      pre.replaceWith(figure);
    } catch {
      // Keep the Mermaid source readable when rendering fails.
    }
  }));
};
