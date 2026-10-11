import { Base64 } from "js-base64";
import { z } from "zod";

const MARKER = "edgeever-poster-v1";
const COLOR = z.string().regex(/^#[0-9a-f]{6}$/i);
export const PosterGradientSchema = z.object({
  kind: z.enum(["linear", "radial"]),
  from: COLOR,
  to: COLOR,
  angle: z.number().finite().min(-360).max(360).default(90),
});
export type PosterGradient = z.infer<typeof PosterGradientSchema>;
const strokeColor = z
  .string()
  .max(80)
  .regex(/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\)|transparent)$/i);
const shadow = z.object({
  color: strokeColor,
  blur: z.number().min(0).max(300),
  offsetX: z.number().min(-300).max(300),
  offsetY: z.number().min(-300).max(300),
});

const ID = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w-]+$/);
const gradientStops = z
  .array(
    z.object({
      offset: z.number().min(0).max(1),
      color: strokeColor,
      opacity: z.number().min(0).max(1).optional(),
    }),
  )
  .min(2)
  .max(16);
export const PosterPaintGradientSchema = z.object({
  kind: z.enum(["linear", "radial"]),
  from: COLOR,
  to: COLOR,
  angle: z.number().finite().default(90),
  stops: gradientStops.optional(),
  coords: z
    .object({
      x1: z.number().finite(),
      y1: z.number().finite(),
      x2: z.number().finite(),
      y2: z.number().finite(),
      r1: z.number().finite().optional(),
      r2: z.number().finite().optional(),
    })
    .optional(),
});
export type PosterPaintGradient = z.infer<typeof PosterPaintGradientSchema>;
const geometry = {
  id: ID,
  name: z.string().max(120),
  role: z.enum(["title", "subtitle", "badge", "decor"]).optional(),
  visible: z.boolean().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  stroke: strokeColor.optional(),
  strokeWidth: z.number().min(0).max(1024).optional(),
  shadow: shadow.optional(),
  gradient: PosterPaintGradientSchema.optional(),
  groupId: ID.optional(),
  x: z.number().finite().min(-8192).max(8192),
  y: z.number().finite().min(-8192).max(8192),
  width: z.number().finite().min(1).max(8192),
  height: z.number().finite().min(1).max(8192),
  rotation: z.number().finite().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().optional(),
};
const text = z.object({
  ...geometry,
  type: z.literal("text"),
  text: z.string().max(8000),
  fill: strokeColor,
  fontSize: z.number().min(4).max(8192),
  fontFamily: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[\w\s\-\u3400-\u9fff]+$/),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  underline: z.boolean().optional(),
  lineHeight: z.number().min(0.5).max(3).optional(),
  charSpacing: z.number().min(-300).max(1000).optional(),
  sourceText: z.string().max(8000).optional(),
  badge: z
    .object({
      background: COLOR,
      padX: z.number().min(0).max(3),
      padY: z.number().min(0).max(3),
      radius: z.number().min(0).max(1),
    })
    .optional(),
  fontWeight: z.enum(["normal", "bold"]),
  textAlign: z.enum(["left", "center", "right"]),
});
const shape = z.object({
  ...geometry,
  type: z.enum(["rect", "ellipse"]),
  fill: strokeColor,
  radius: z.number().min(0).max(4096).optional(),
});
const image = z.object({
  ...geometry,
  type: z.literal("image"),
  resourceId: ID,
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0.01).max(1),
      height: z.number().min(0.01).max(1),
    })
    .optional(),
});
const path = z.object({
  ...geometry,
  type: z.literal("path"),
  fill: strokeColor,
  path: z
    .string()
    .min(1)
    .max(100_000)
    .regex(/^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+\-]+$/),
});
export const PosterElementSchema = z.union([text, shape, image, path]);
export const PosterDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    width: z.number().int().min(320).max(4096),
    height: z.number().int().min(320).max(4096),
    background: COLOR,
    backgroundGradient: PosterGradientSchema.optional(),
    elements: z.array(PosterElementSchema).max(500),
    copy: z
      .object({
        title: z.string().max(8000),
        subtitle: z.string().max(8000),
        badge: z.string().max(8000),
      })
      .optional(),
    templateId: z.string().max(80).optional(),
    platformId: z.string().max(80).optional(),
    sourceMemoId: ID.optional(),
    previewResourceId: ID.optional(),
  })
  .superRefine((document, ctx) => {
    if (
      new Set(document.elements.map((element) => element.id)).size !==
      document.elements.length
    ) {
      ctx.addIssue({ code: "custom", message: "Element IDs must be unique" });
    }
  });
export type PosterDocument = z.infer<typeof PosterDocumentSchema>;
export type PosterElement = z.infer<typeof PosterElementSchema>;
export type PosterText = Extract<PosterElement, { type: "text" }>;
export const POSTER_FORMATS = [
  { id: "portrait", width: 1080, height: 1440 },
  { id: "square", width: 1080, height: 1080 },
  { id: "wechat", width: 1410, height: 600 },
  { id: "video", width: 1280, height: 720 },
  { id: "story", width: 1080, height: 1920 },
] as const;
export const POSTER_TEMPLATES = [
  "editorial",
  "bold",
  "quote",
  "minimal",
] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];
export const createPosterDocument = (
  heading = "",
  subtitle = "",
  template: PosterTemplate = "editorial",
  width = 1080,
  height = 1440,
): PosterDocument => {
  const dark = template === "bold";
  const padding = width * 0.09;
  const fontSize = Math.round(Math.min(width * 0.085, height * 0.13));
  const headingY = template === "quote" ? height * 0.3 : height * 0.24;
  const makeText = (
    id: string,
    content: string,
    y: number,
    size: number,
  ): PosterText => ({
    id,
    name: id,
    type: "text",
    text: content,
    x: padding,
    y,
    width: width - padding * 2,
    height: size * 1.5,
    rotation: 0,
    opacity: 1,
    locked: false,
    fill: dark ? "#ffffff" : "#07130b",
    fontSize: size,
    fontFamily:
      template === "editorial" || template === "quote" ? "serif" : "sans-serif",
    fontWeight: id === "heading" ? "bold" : "normal",
    textAlign: template === "minimal" ? "center" : "left",
  });
  return {
    schemaVersion: 1,
    width,
    height,
    background: dark
      ? "#07130b"
      : template === "editorial"
        ? "#f4efe4"
        : "#ffffff",
    elements: [
      {
        id: "accent",
        name: "accent",
        type: "rect",
        x: padding,
        y: height * 0.12,
        width: width * 0.12,
        height: Math.max(8, height * 0.008),
        fill: dark ? "#baf264" : "#16a06e",
        rotation: 0,
        opacity: 1,
        locked: false,
      },
      makeText("heading", heading, headingY, fontSize),
      makeText("subtitle", subtitle, height * 0.7, Math.round(fontSize * 0.4)),
    ],
  };
};
export const resizePosterDocument = (
  document: PosterDocument,
  width: number,
  height: number,
): PosterDocument => {
  const sx = width / document.width,
    sy = height / document.height;
  return PosterDocumentSchema.parse({
    ...document,
    width,
    height,
    elements: document.elements.map((element) => ({
      ...element,
      x: element.x * sx,
      y: element.y * sy,
      width: element.width * sx,
      height: element.height * sy,
      ...(element.type === "text"
        ? {
            fontSize: Math.max(
              8,
              Math.min(512, element.fontSize * Math.min(sx, sy)),
            ),
          }
        : {}),
    })),
  });
};
export const hasPosterDocumentMarker = (markdown: string | null | undefined) =>
  Boolean(markdown?.includes(`<!-- ${MARKER}:`));
export const stripPosterDocumentMarker = (markdown: string) =>
  markdown.replace(/<!--\s*edgeever-poster-v1:[\s\S]*?-->/g, "").trim();
export const parsePosterDocument = (
  markdown: string | null | undefined,
): PosterDocument | null => {
  const encoded = markdown?.match(
    /<!--\s*edgeever-poster-v1:([A-Za-z0-9_-]+)\s*-->/,
  )?.[1];
  if (!encoded || encoded.length > 2_000_000) return null;
  try {
    return PosterDocumentSchema.parse(JSON.parse(Base64.decode(encoded)));
  } catch {
    return null;
  }
};
const resourceUrl = (id: string) =>
  `/api/v1/resources/${encodeURIComponent(id)}/blob`;
export const posterFallbackMarkdown = (document: PosterDocument) =>
  [
    document.previewResourceId
      ? `![Poster](${resourceUrl(document.previewResourceId)})`
      : "",
    ...document.elements
      .filter((element): element is PosterText => element.type === "text")
      .map((element) => element.text.replace(/([\\`*_{}\[\]<>#!])/g, "\\$1")),
    document.sourceMemoId ? `[Source](#memo=${document.sourceMemoId})` : "",
    ...document.elements
      .filter((element) => element.type === "image")
      .map(
        (element) =>
          `[Image](${resourceUrl((element as Extract<PosterElement, { type: "image" }>).resourceId)})`,
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
export const serializePosterDocument = (document: PosterDocument) => {
  const safe = PosterDocumentSchema.parse(document);
  return `${posterFallbackMarkdown(safe)}\n\n<!-- ${MARKER}:${Base64.encodeURI(JSON.stringify(safe))} -->`.trim();
};
export const getPosterSummary = (markdown: string | null | undefined) => ({
  poster: hasPosterDocumentMarker(markdown),
});
