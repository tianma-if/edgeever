import {
  Circle,
  Color,
  Ellipse,
  FabricObject,
  Gradient,
  Line,
  Path,
  Pattern,
  Polygon,
  Rect,
  Textbox,
  Triangle,
} from "fabric";
import {
  PosterDocumentSchema,
  type PosterDocument,
  type PosterElement,
  type PosterPaintGradient,
} from "@edgeever/shared";
import { TEMPLATES, sourceOf, templatesFor } from "./vendor/qiaomu/templates";
import { BadgeBox } from "./vendor/qiaomu/badge";
import { resolvePair, usePairing } from "./vendor/qiaomu/typeset";
import { POSTER_FONTS, loadDesignFonts } from "./fonts";
export { PLATFORMS, platformFor } from "./vendor/qiaomu/platforms";
export const DESIGN_TEMPLATES = TEMPLATES;
export { templatesFor };
const hex = (color: string | undefined) =>
  `#${new Color(color || "#000000").toHex()}`;
const paint = (object: FabricObject) =>
  typeof object.fill === "string" && object.fill
    ? object.fill
    : object.fill instanceof Gradient
      ? hex(object.fill.colorStops[0]?.color)
      : "rgba(0,0,0,0)";
export function gradientFromFabric(
  value: Gradient<"linear" | "radial">,
  width: number,
  height: number,
): PosterPaintGradient {
  const c = value.coords as {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    r1?: number;
    r2?: number;
  };
  return {
    kind: value.type,
    from: hex(value.colorStops[0]?.color),
    to: hex(value.colorStops.at(-1)?.color),
    angle: 90,
    stops: value.colorStops.map((stop) => ({
      offset: stop.offset,
      color: stop.color,
      opacity: (stop as typeof stop & { opacity?: number }).opacity,
    })),
    coords: {
      x1: c.x1 / width,
      y1: c.y1 / height,
      x2: c.x2 / width,
      y2: c.y2 / height,
      ...(value.type === "radial"
        ? {
            r1: (c.r1 ?? 0) / Math.max(width, height),
            r2: (c.r2 ?? 0) / Math.max(width, height),
          }
        : {}),
    },
  };
}
export function posterPrimitiveFromObject(
  object: FabricObject,
  index: number,
): PosterElement | null {
  if (object.fill instanceof Pattern) return null; // Film grain is a generated raster tile, not editable vector source.
  const roleValue = (object as FabricObject & { qcRole?: string }).qcRole;
  const role =
    roleValue === "title" || roleValue === "subtitle" || roleValue === "badge"
      ? roleValue
      : "decor";
  const pos = object.getPointByOrigin("left", "top");
  const options = {
    id: `design_${index}`,
    name: role,
    role,
    x: pos.x,
    y: pos.y,
    width: Math.max(1, object.width * Math.abs(object.scaleX)),
    height: Math.max(1, object.height * Math.abs(object.scaleY)),
    rotation: object.angle % 360,
    opacity: object.opacity,
    locked: false,
    ...(object.stroke && typeof object.stroke === "string"
      ? { stroke: object.stroke, strokeWidth: object.strokeWidth }
      : {}),
    ...(object.shadow
      ? {
          shadow: {
            color: object.shadow.color,
            blur: object.shadow.blur,
            offsetX: object.shadow.offsetX,
            offsetY: object.shadow.offsetY,
          },
        }
      : {}),
    ...(object.fill instanceof Gradient
      ? {
          gradient: gradientFromFabric(
            object.fill,
            Math.max(1, object.width),
            Math.max(1, object.height),
          ),
        }
      : {}),
  } satisfies Partial<PosterElement>;
  if (object instanceof Textbox)
    return {
      ...options,
      type: "text",
      text: object.text,
      sourceText: sourceOf(object),
      fill: paint(object),
      fontSize: object.fontSize * Math.abs(object.scaleY),
      fontFamily: object.fontFamily,
      fontWeight: ["bold", "700", "800", "900"].includes(
        String(object.fontWeight),
      )
        ? "bold"
        : "normal",
      fontStyle: object.fontStyle === "italic" ? "italic" : "normal",
      textAlign:
        object.textAlign === "center" || object.textAlign === "right"
          ? object.textAlign
          : "left",
      lineHeight: object.lineHeight,
      charSpacing: object.charSpacing,
      ...(object instanceof BadgeBox
        ? {
            badge: {
              background: hex(object.badgeBg),
              padX: object.padX,
              padY: object.padY,
              radius: object.radius,
            },
          }
        : {}),
    };
  if (object instanceof Rect)
    return {
      ...options,
      type: "rect",
      fill: paint(object),
      radius: object.rx * Math.abs(object.scaleX),
    };
  if (object instanceof Circle || object instanceof Ellipse)
    return { ...options, type: "ellipse", fill: paint(object) };
  let path: string | undefined;
  if (object instanceof Path)
    path = object.path.map((command) => command.join(" ")).join(" ");
  if (object instanceof Line)
    path = `M ${object.x1} ${object.y1} L ${object.x2} ${object.y2}`;
  if (object instanceof Polygon)
    path =
      object.points
        .map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`)
        .join(" ") + " Z";
  if (object instanceof Triangle)
    path = `M ${object.width / 2} 0 L ${object.width} ${object.height} L 0 ${object.height} Z`;
  if (!path) throw new Error(`Unsupported design primitive: ${object.type}`);
  return { ...options, type: "path", path, fill: paint(object) };
}
export function posterCopy(document: PosterDocument) {
  if (document.copy) return document.copy;
  const text = document.elements.filter((element) => element.type === "text");
  const title =
    text.find(
      (element) => element.role === "title" || element.id === "heading",
    ) ?? text[0];
  const subtitle =
    text.find(
      (element) => element.role === "subtitle" || element.id === "subtitle",
    ) ?? text[1];
  const badge = text.find((element) => element.role === "badge");
  return {
    title: title?.sourceText ?? title?.text ?? "",
    subtitle: subtitle?.sourceText ?? subtitle?.text ?? "",
    badge: badge?.sourceText ?? badge?.text ?? "",
  };
}
export async function buildPosterDesign(input: {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  points?: string[];
  width: number;
  height: number;
  zh: boolean;
  palette?: { bg?: string; ink?: string; accent?: string };
}): Promise<PosterDocument> {
  await loadDesignFonts(input.zh);
  const template =
    TEMPLATES.find((entry) => entry.id === input.id) ?? TEMPLATES[0]!;
  usePairing(
    input.zh
      ? resolvePair(template.id, (family) =>
          POSTER_FONTS.some((font) => font.family === family),
        )
      : {
          title:
            template.id === "newspaper" || template.id === "folio"
              ? "DM Serif Display"
              : "Inter",
          body: "Inter",
          titleBold: true,
          missing: [],
        },
  );
  try {
    const built = template.build({ ...input });
    const elements = built.objects
      .map(posterPrimitiveFromObject)
      .filter((value): value is PosterElement => Boolean(value));
    const background =
      built.background.kind === "solid"
        ? built.background.color
        : built.background.from;
    const result = {
      copy: {
        title: input.title,
        subtitle: input.subtitle,
        badge: input.badge ?? "",
      },
      schemaVersion: 1,
      width: input.width,
      height: input.height,
      templateId: template.id,
      background: hex(background),
      ...(built.background.kind === "linear"
        ? {
            backgroundGradient: {
              kind: "linear",
              from: hex(built.background.from),
              to: hex(built.background.to),
              angle: built.background.angle,
            },
          }
        : {}),
      elements,
    };
    return PosterDocumentSchema.parse(result);
  } finally {
    usePairing(undefined);
  }
}
