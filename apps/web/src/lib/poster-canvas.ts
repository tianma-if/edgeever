import {
  ActiveSelection,
  Canvas,
  StaticCanvas,
  Textbox,
  Rect,
  Ellipse,
  FabricImage,
  Gradient,
  Path,
  Shadow,
  Point,
  util,
  type FabricObject,
} from "fabric";
import {
  PosterDocumentSchema,
  type PosterDocument,
  type PosterElement,
  type PosterPaintGradient,
} from "@edgeever/shared";
import { BadgeBox } from "./poster-design/vendor/qiaomu/badge";
import { loadPosterFont } from "./poster-design/fonts";

export function makePosterGradient(
  value: PosterPaintGradient,
  width: number,
  height: number,
) {
  const angle = ((value.angle - 90) * Math.PI) / 180,
    dx = Math.cos(angle),
    dy = Math.sin(angle);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const c = value.coords;
  const coords = c
    ? {
        x1: c.x1 * width,
        y1: c.y1 * height,
        x2: c.x2 * width,
        y2: c.y2 * height,
        ...(value.kind === "radial"
          ? {
              r1: (c.r1 ?? 0) * Math.max(width, height),
              r2: (c.r2 ?? 1) * Math.max(width, height),
            }
          : {}),
      }
    : value.kind === "radial"
      ? {
          x1: width / 2,
          y1: height / 2,
          x2: width / 2,
          y2: height / 2,
          r1: 0,
          r2: Math.max(width, height) / 2,
        }
      : {
          x1: width / 2 - dx * half,
          y1: height / 2 - dy * half,
          x2: width / 2 + dx * half,
          y2: height / 2 + dy * half,
        };
  const colorStops = value.stops ?? [
    { offset: 0, color: value.from },
    { offset: 1, color: value.to },
  ];
  return value.kind === "radial"
    ? new Gradient<"radial">({
        type: "radial",
        gradientUnits: "pixels",
        coords: {
          ...coords,
          r1: "r1" in coords ? (coords.r1 ?? 0) : 0,
          r2:
            "r2" in coords
              ? (coords.r2 ?? Math.max(width, height))
              : Math.max(width, height),
        },
        colorStops,
      })
    : new Gradient<"linear">({
        type: "linear",
        gradientUnits: "pixels",
        coords,
        colorStops,
      });
}
export const posterObject = async (
  element: PosterElement,
  readResource: (id: string) => Promise<Blob>,
): Promise<FabricObject> => {
  const options = {
    left: element.x,
    top: element.y,
    angle: element.rotation,
    opacity: element.opacity,
    strokeWidth: element.strokeWidth ?? 0,
    stroke: element.stroke,
    strokeUniform: true,
    paintFirst: "stroke" as const,
    originX: "left" as const,
    originY: "top" as const,
    flipX: element.flipX ?? false,
    flipY: element.flipY ?? false,
    visible: element.visible ?? true,
    shadow: element.shadow ? new Shadow(element.shadow) : undefined,
    selectable: !element.locked,
    evented: !element.locked,
    borderColor: "#16a06e",
    cornerColor: "#16a06e",
    cornerStrokeColor: "#ffffff",
    cornerSize: 9,
    cornerStyle: "circle" as const,
    transparentCorners: false,
  };
  const fill = element.gradient
    ? makePosterGradient(element.gradient, element.width, element.height)
    : "fill" in element
      ? element.fill
      : undefined;
  if (element.type === "text") {
    await loadPosterFont(element.fontFamily);
    const textOptions = {
      ...options,
      width: element.width,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      fontWeight: element.fontWeight,
      fontStyle: element.fontStyle ?? "normal",
      underline: element.underline ?? false,
      lineHeight: element.lineHeight ?? 1.25,
      charSpacing: element.charSpacing ?? 0,
      textAlign: element.textAlign,
      fill,
      splitByGrapheme: true,
    };
    if (element.badge) {
      const badge = new BadgeBox(element.text, {
        ...textOptions,
        badgeBg: element.badge.background,
        padX: element.badge.padX,
        padY: element.badge.padY,
        radius: element.badge.radius,
      });
      badge.editable = true;
      return badge;
    }
    return new Textbox(element.text, textOptions);
  }
  if (element.type === "rect")
    return new Rect({
      ...options,
      width: element.width,
      height: element.height,
      fill,
      rx: element.radius ?? 0,
      ry: element.radius ?? 0,
    });
  if (element.type === "ellipse")
    return new Ellipse({
      ...options,
      rx: element.width / 2,
      ry: element.height / 2,
      fill,
    });
  if (element.type === "path") {
    const path = new Path(element.path, { ...options, fill });
    path.set({
      scaleX: element.width / Math.max(1, path.width),
      scaleY: element.height / Math.max(1, path.height),
    });
    return path;
  }
  if (element.type !== "image") throw new Error("Unsupported poster element");
  const blob = await readResource(element.resourceId);
  const url = URL.createObjectURL(blob);
  try {
    const image = await FabricImage.fromURL(url);
    const crop = element.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const width = image.width * crop.width,
      height = image.height * crop.height;
    image.set({
      ...options,
      cropX: image.width * crop.x,
      cropY: image.height * crop.y,
      width,
      height,
      scaleX: element.width / width,
      scaleY: element.height / height,
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};
export const posterElementFromObject = (
  element: PosterElement,
  object: FabricObject,
): PosterElement => {
  const matrix = object.calcTransformMatrix();
  const transform = util.qrDecompose(matrix);
  const radians = (transform.angle * Math.PI) / 180;
  const offsetX =
    -(object.width * Math.abs(transform.scaleX) + object.strokeWidth) / 2;
  const offsetY =
    -(object.height * Math.abs(transform.scaleY) + object.strokeWidth) / 2;
  const point = {
    x: matrix[4] + offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
    y: matrix[5] + offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
  };
  return {
    ...element,
    x: point.x,
    y: point.y,
    rotation: transform.angle % 360,
    width: Math.max(1, Math.abs(object.width * transform.scaleX)),
    height: Math.max(1, Math.abs(object.height * transform.scaleY)),
    flipX: false,
    flipY: transform.scaleY < 0,
    ...(element.type === "text" && object instanceof Textbox
      ? {
          text: object.text,
          sourceText:
            object.text === element.text ? element.sourceText : object.text,
          fontSize: object.fontSize * Math.abs(transform.scaleY),
        }
      : {}),
  };
};
export const renderPosterBlob = async (
  document: PosterDocument,
  readResource: (id: string) => Promise<Blob>,
  format: "png" | "jpeg" | "webp" = "png",
  preview = false,
  scale = 1,
  quality = 0.92,
) => {
  PosterDocumentSchema.parse(document);
  const canvas = new StaticCanvas(undefined, {
    width: document.width,
    height: document.height,
    backgroundColor: document.backgroundGradient
      ? makePosterGradient(
          document.backgroundGradient,
          document.width,
          document.height,
        )
      : document.background,
    enableRetinaScaling: false,
  });
  try {
    canvas.add(
      ...(await Promise.all(
        document.elements.map((element) => posterObject(element, readResource)),
      )),
    );
    canvas.renderAll();
    const output = canvas.toCanvasElement(
      preview
        ? Math.min(1, 480 / document.width)
        : Math.min(scale, 8192 / Math.max(document.width, document.height)),
    );
    return await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Image export failed")),
        `image/${format}`,
        quality,
      ),
    );
  } finally {
    await canvas.dispose();
  }
};
export const renderPosterThumbnail = async (
  document: PosterDocument,
): Promise<string> => {
  const blob = await renderPosterBlob(
    document,
    async () => {
      throw new Error("Template thumbnails cannot access resources");
    },
    "png",
    true,
  );
  return URL.createObjectURL(blob);
};
export { Canvas, ActiveSelection };

/** AI colours must be checked against the actual card underneath, not just the outer canvas background. */
export async function ensurePosterContrast(
  document: PosterDocument,
  readResource: (id: string) => Promise<Blob>,
): Promise<PosterDocument> {
  const { contrast } = await import("./poster-design/vendor/qiaomu/quality");
  const background = new StaticCanvas(undefined, {
    width: document.width,
    height: document.height,
    enableRetinaScaling: false,
    backgroundColor: document.backgroundGradient
      ? makePosterGradient(
          document.backgroundGradient,
          document.width,
          document.height,
        )
      : document.background,
  });
  try {
    const objects = await Promise.all(
      document.elements.map((element) => posterObject(element, readResource)),
    );
    const elements: PosterElement[] = [];
    for (let i = 0; i < objects.length; i++) {
      const element = document.elements[i],
        object = objects[i];
      if (
        element.type === "text" &&
        ["title", "subtitle", "badge"].includes(element.role ?? "") &&
        !element.gradient &&
        element.visible !== false
      ) {
        background.renderAll();
        const colors: string[] = [];
        if (element.badge) colors.push(element.badge.background);
        else {
          const bounds = object.getBoundingRect();
          for (const fraction of [0.25, 0.5, 0.75]) {
            const x = Math.max(
                0,
                Math.min(
                  document.width - 1,
                  Math.round(bounds.left + bounds.width * fraction),
                ),
              ),
              y = Math.max(
                0,
                Math.min(
                  document.height - 1,
                  Math.round(bounds.top + bounds.height / 2),
                ),
              );
            const pixel = background.getContext().getImageData(x, y, 1, 1).data;
            colors.push(
              `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`,
            );
          }
        }
        const average = (fill: string) =>
          colors.reduce(
            (sum, color) => sum + (contrast(fill, color) ?? 21),
            0,
          ) / colors.length;
        const best =
          average("#111111") >= average("#ffffff") ? "#111111" : "#ffffff";
        const outlined =
          element.stroke &&
          (element.strokeWidth ?? 0) >= 2 &&
          average(element.stroke) >= 3;
        if (average(element.fill) < 3 && !outlined) {
          elements.push({ ...element, fill: best });
          object.set("fill", best);
        } else elements.push(element);
      } else elements.push(element);
      background.add(object);
    }
    return { ...document, elements };
  } finally {
    await background.dispose();
  }
}
