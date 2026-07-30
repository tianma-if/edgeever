export interface MermaidSvgPresentation {
  width: number;
  height: number;
  backgroundColor: string | null;
  foregroundColor: string | null;
}

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 900;

const toPositiveNumber = (value: string | null | undefined) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeCssColor = (value: string | null | undefined) => {
  const color = value?.trim();
  if (!color) return null;

  return /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\)|[a-z]+)$/i.test(color) ? color : null;
};

const readCssVariable = (style: string | null | undefined, name: string) => {
  const match = style?.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"));
  return normalizeCssColor(match?.[1]);
};

const readPresentation = ({
  width,
  height,
  viewBox,
  style,
}: {
  width?: string | null;
  height?: string | null;
  viewBox?: string | null;
  style?: string | null;
}): MermaidSvgPresentation => {
  const viewBoxParts = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  const viewBoxWidth = viewBoxParts.length === 4 && viewBoxParts.every(Number.isFinite) && viewBoxParts[2] > 0
    ? viewBoxParts[2]
    : null;
  const viewBoxHeight = viewBoxParts.length === 4 && viewBoxParts.every(Number.isFinite) && viewBoxParts[3] > 0
    ? viewBoxParts[3]
    : null;

  return {
    width: viewBoxWidth ?? toPositiveNumber(width) ?? DEFAULT_WIDTH,
    height: viewBoxHeight ?? toPositiveNumber(height) ?? DEFAULT_HEIGHT,
    backgroundColor: readCssVariable(style, "--bg"),
    foregroundColor: readCssVariable(style, "--fg"),
  };
};

const readPresentationFromMarkup = (svg: string) => {
  const rootAttributes = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const readAttribute = (name: string) =>
    rootAttributes.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? null;

  return readPresentation({
    width: readAttribute("width"),
    height: readAttribute("height"),
    viewBox: readAttribute("viewBox"),
    style: readAttribute("style"),
  });
};

export const getMermaidSvgPresentation = (svg: string): MermaidSvgPresentation => {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = document.documentElement;
    if (root.tagName.toLowerCase() === "svg" && !document.querySelector("parsererror")) {
      return readPresentation({
        width: root.getAttribute("width"),
        height: root.getAttribute("height"),
        viewBox: root.getAttribute("viewBox"),
        style: root.getAttribute("style"),
      });
    }
  }

  return readPresentationFromMarkup(svg);
};

export const resolveMermaidViewerBackground = (
  svgBackgroundColor: string | null,
  paletteBackgroundColor: string
) => svgBackgroundColor ?? paletteBackgroundColor;

export const normalizeMermaidSvgForViewer = (
  svg: string,
  presentation = getMermaidSvgPresentation(svg)
) => {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return svg;

  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || document.querySelector("parsererror")) return svg;

  // Mermaid emits width="100%", which gives Blob-backed images incorrect intrinsic dimensions.
  root.setAttribute("width", String(presentation.width));
  root.setAttribute("height", String(presentation.height));
  return new XMLSerializer().serializeToString(document);
};
