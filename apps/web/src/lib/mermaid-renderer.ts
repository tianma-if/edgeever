interface MermaidRenderFallbackOptions {
  renderBeautiful: () => string | Promise<string>;
  renderOfficial: () => string | Promise<string>;
}

export const renderMermaidWithFallback = async ({
  renderBeautiful,
  renderOfficial,
}: MermaidRenderFallbackOptions) => {
  try {
    return await renderBeautiful();
  } catch {
    return renderOfficial();
  }
};
