const SVG_NS = "http://www.w3.org/2000/svg";
const EXPORT_PADDING = 28;
const EXPORT_PIXEL_RATIO = 2;

// AntV `toDataURL` draws onto a transparent canvas. Shape fills are translucent,
// so the file looks empty wherever it is opened. Rasterize the exported SVG onto
// the same sheet color as the preview instead.
export const INFOGRAPHIC_EXPORT_PIXEL_RATIO = EXPORT_PIXEL_RATIO;

export const infographicExportBasename = (title: string) =>
  (title.trim() || "infographic").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);

export const readInfographicSheetColor = (sheet: Element | null, dark: boolean) => {
  const fallback = dark ? "#1F1F1F" : "#FFFFFF";
  if (!sheet || typeof getComputedStyle !== "function") return fallback;
  const color = getComputedStyle(sheet).backgroundColor;
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(color);
  if (!match) return fallback;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha) || alpha < 1) return fallback;
  return color;
};

// Export the saved artwork rather than the appearance-adapted editor preview.
export const renderInfographicExportSvg = async (syntax: string, size: { width: number; height: number }) => {
  const { Infographic, exportToSVG } = await import("@antv/infographic");
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed", left: "-100000px", top: "0", pointerEvents: "none",
    width: `${Math.max(1, size.width)}px`, height: `${Math.max(1, size.height)}px`,
  });
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);
  let instance: InstanceType<typeof Infographic> | undefined;
  try {
    const graphic = new Infographic({ container, width: "100%", height: "100%", editable: false });
    instance = graphic;
    await new Promise<void>((resolve, reject) => {
      graphic.on("loaded", () => resolve());
      graphic.on("error", reject);
      graphic.render(syntax);
    });
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("empty");
    const sheetColor = readInfographicSheetColor(container, /^\s*theme dark\s*$/m.test(syntax));
    return { svg: await exportToSVG(svg), sheetColor };
  } finally {
    instance?.destroy();
    container.remove();
  }
};

export const frameInfographicExportSvg = (svg: SVGSVGElement, sheetColor: string) => {
  const box = svg.viewBox.baseVal;
  const width = box.width > 0 ? box.width : Number(svg.getAttribute("width")) || svg.getBoundingClientRect().width;
  const height = box.height > 0 ? box.height : Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
  if (!(width > 0) || !(height > 0)) throw new Error("empty");
  const x = (box.width > 0 ? box.x : 0) - EXPORT_PADDING;
  const y = (box.height > 0 ? box.y : 0) - EXPORT_PADDING;
  const framedWidth = width + EXPORT_PADDING * 2;
  const framedHeight = height + EXPORT_PADDING * 2;
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `${x} ${y} ${framedWidth} ${framedHeight}`);
  svg.setAttribute("width", String(framedWidth));
  svg.setAttribute("height", String(framedHeight));
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("data-infographic-export-sheet", "");
  background.setAttribute("x", String(x));
  background.setAttribute("y", String(y));
  background.setAttribute("width", String(framedWidth));
  background.setAttribute("height", String(framedHeight));
  background.setAttribute("fill", sheetColor);
  svg.insertBefore(background, svg.firstChild);
  return { height: framedHeight, width: framedWidth };
};

export const rasterizeInfographicSvg = (svg: SVGSVGElement, sheetColor: string) => {
  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));
  const xml = new XMLSerializer().serializeToString(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(width * EXPORT_PIXEL_RATIO));
      canvas.height = Math.max(1, Math.ceil(height * EXPORT_PIXEL_RATIO));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("canvas"));
        return;
      }
      context.fillStyle = sheetColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("svg"));
    image.src = url;
  });
};

export const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("empty"))), "image/png");
  });

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
