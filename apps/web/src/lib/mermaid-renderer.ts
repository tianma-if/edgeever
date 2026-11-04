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
    const { svg } = await mermaid.render(`edgeever-mermaid-${++renderSequence}`, source);
    return svg;
  });
  officialQueue = result.catch(() => undefined);
  return result;
};
