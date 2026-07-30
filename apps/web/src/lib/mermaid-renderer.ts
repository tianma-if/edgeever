export type MermaidRendererName = "mermaid" | "beautiful";

interface MermaidRenderFallbackOptions {
  renderer: MermaidRendererName;
  renderBeautiful: () => string | Promise<string>;
  renderOfficial: () => string | Promise<string>;
}

export const renderMermaidWithFallback = async ({
  renderer,
  renderBeautiful,
  renderOfficial,
}: MermaidRenderFallbackOptions) => {
  if (renderer === "beautiful") {
    try {
      return await renderBeautiful();
    } catch {
      return renderOfficial();
    }
  }

  return renderOfficial();
};
