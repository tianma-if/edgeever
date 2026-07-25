export const getMobileMarkdownFenceLanguage = (sourceInfo: unknown) =>
  typeof sourceInfo === "string" ? sourceInfo.trim().split(/\s+/)[0]?.toLowerCase() ?? "" : "";

export const trimMobileMarkdownFenceContent = (content: string) =>
  content.endsWith("\n") ? content.slice(0, -1) : content;

/**
 * Mermaid uses the SVG 2 `auto-start-reverse` marker orientation for arrows.
 * Browsers support it, but react-native-svg parses marker `orient` as a
 * numeric angle and crashes while drawing the SVG. `auto` keeps the arrow
 * direction compatible on native without changing the Mermaid source.
 */
export const sanitizeMobileMermaidSvg = (svg: string) =>
  svg.replace(/(\borient\s*=\s*)(["'])auto-start-reverse\2/gi, "$1$2auto$2");

export const getMermaidSvgAspectRatio = (svg: string) => {
  const viewBox = /viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg);
  const width = Number(viewBox?.[1]);
  const height = Number(viewBox?.[2]);
  return width > 0 && height > 0 ? width / height : 1.6;
};
