import type { MermaidThemePalette } from "../components/ThemeProvider";
import { getOfficialMermaidThemeVariables } from "./mermaid-theme";

let officialModule: Promise<typeof import("mermaid")["default"]> | undefined;
let officialQueue: Promise<unknown> = Promise.resolve();
let renderSequence = 0;

export const renderThemedMermaidSvg = (
  source: string,
  { palette, font, padding }: {
    palette: MermaidThemePalette;
    font: string;
    padding: number;
  },
) => {
  // Mermaid configuration is global. Serialize initialization and rendering
  // so concurrent previews and exports keep their own appearance.
  const result = officialQueue.then(async () => {
    const mermaid = await (officialModule ??= import("mermaid").then(({ default: module }) => module));
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      fontFamily: font,
      themeVariables: getOfficialMermaidThemeVariables(palette),
      flowchart: {
        diagramPadding: padding,
        nodeSpacing: 32,
        rankSpacing: 40,
        padding: 12,
      },
      themeCSS: `
        .node > rect.basic.label-container { rx: 5px; ry: 5px; }
        .cluster > rect { rx: 6px; ry: 6px; }
        .edgeLabel .labelBkg { border-radius: 3px; }
        .edgeLabel rect { opacity: 1; rx: 3px; ry: 3px; }
      `,
    });
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;visibility:hidden";
    // Mermaid measures HTML labels in viewport pixels but sizes them in SVG
    // units. Keep the temporary measurement host at 1×, including when the
    // document is scaled. The returned SVG still follows the user's zoom.
    const documentZoom = document.body.currentCSSZoom || 1;
    host.style.zoom = documentZoom === 1 ? "reset" : String(1 / documentZoom);
    document.body.appendChild(host);
    try {
      const { svg } = await mermaid.render(`edgeever-mermaid-${++renderSequence}`, source, host);
      return svg;
    } finally {
      host.remove();
    }
  });
  officialQueue = result.catch(() => undefined);
  return result;
};
