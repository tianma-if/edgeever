import { z } from "zod";
import { PosterDocumentSchema, PosterGradientSchema, type PosterDocument } from "@edgeever/shared";
import { AppError } from "./app-error";

const patch = z.object({
  text: z.string().max(8000).optional(),
  fill: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  fontSize: z.number().finite().min(4).max(8192).optional(),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  x: z.number().finite().min(-8192).max(8192).optional(),
  y: z.number().finite().min(-8192).max(8192).optional(),
  width: z.number().finite().min(1).max(8192).optional(),
  height: z.number().finite().min(1).max(8192).optional(),
  rotation: z.number().finite().min(-360).max(360).optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
}).strict().refine(value => Object.keys(value).length > 0);
const request = z.object({
  memoId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  dryRun: z.boolean().optional(),
  background: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  backgroundGradient: PosterGradientSchema.nullable().optional(),
  edits: z.array(z.object({ id: z.string().min(1), patch }).strict()).max(100).optional(),
}).strict().refine(value => Boolean(value.edits?.length || value.background || value.backgroundGradient !== undefined));

export function applyPosterEdits(input: unknown, current: PosterDocument) {
  const parsed = request.safeParse(input);
  if (!parsed.success) throw new AppError("invalid_params", "Invalid poster edits", 400);
  const args = parsed.data;
  const edits = args.edits ?? [];
  if (new Set(edits.map(edit => edit.id)).size !== edits.length) throw new AppError("invalid_params", "Duplicate poster element IDs", 400);
  for (const edit of edits) {
    const element = current.elements.find(element => element.id === edit.id);
    if (!element || element.locked) throw new AppError("invalid_params", "Poster element is missing or locked", 400);
    if (element.type !== "text" && ["text", "fontSize", "fontWeight", "textAlign"].some(key => key in edit.patch)) {
      throw new AppError("invalid_params", "Typography edits require a text element", 400);
    }
    if (element.type === "image" && edit.patch.fill !== undefined) throw new AppError("invalid_params", "Image elements do not have a fill", 400);
  }
  const next = PosterDocumentSchema.safeParse({
    ...current,
    ...(args.background !== undefined ? { background: args.background } : {}),
    ...(args.backgroundGradient !== undefined ? { backgroundGradient: args.backgroundGradient ?? undefined } : {}),
    elements: current.elements.map(element => {
      const edit = edits.find(edit => edit.id === element.id);
      if (!edit) return element;
      return { ...element, ...edit.patch, ...(edit.patch.text !== undefined ? { sourceText: edit.patch.text } : {}) };
    }),
  });
  if (!next.success) throw new AppError("invalid_params", "Poster edits exceed document limits", 400);
  const document = next.data;
  if (edits.some(edit => edit.patch.text !== undefined)) {
    document.copy = {
      title: current.copy?.title ?? "", subtitle: current.copy?.subtitle ?? "", badge: current.copy?.badge ?? "",
    };
    for (const role of ["title", "subtitle", "badge"] as const) {
      if (!edits.some(edit => edit.patch.text !== undefined && current.elements.some(element => element.id === edit.id && element.role === role))) continue;
      document.copy[role] = [...new Set(document.elements.filter(element => element.type === "text" && element.role === role)
        .map(element => element.type === "text" ? element.sourceText ?? element.text : ""))].join("\n");
    }
  }
  const changed = JSON.stringify(document) !== JSON.stringify(PosterDocumentSchema.parse(current));
  if (changed) document.previewResourceId = undefined;
  return { document, changed };
}
