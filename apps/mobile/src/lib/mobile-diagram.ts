import {
  hasDiagramDocumentMarker,
  hasInfographicDocumentMarker,
  hasPosterDocumentMarker,
  stripPosterDocumentMarker,
  hasTableDocumentMarker,
  markdownToDoc,
  parseDiagramDocument,
  parseInfographicDocument,
  parseTableDocument,
  resolveMemoContentDoc,
  stripDiagramDocumentMarker,
  stripInfographicDocumentMarker,
  stripTableDocumentMarker,
  tableFallbackMarkdown,
  type TiptapDoc,
  type DiagramKind,
} from "@edgeever/shared";

export const getMobileVisualDiagramKind = (contentMarkdown: string): DiagramKind | null =>
  parseDiagramDocument(contentMarkdown)?.kind ?? null;

export const hasMobileVisualDiagram = (contentMarkdown: string) =>
  hasDiagramDocumentMarker(contentMarkdown);

export const hasMobileStructuredTable = (contentMarkdown: string) =>
  hasTableDocumentMarker(contentMarkdown);

export const hasMobileInfographic = (contentMarkdown: string) =>
  hasInfographicDocumentMarker(contentMarkdown);

export const hasMobilePoster = (contentMarkdown: string) => hasPosterDocumentMarker(contentMarkdown);

/** Viewer TipTap payload for a visual-diagram envelope. Valid IR is drawn by read-only X6, so this returns an empty doc instead of a hidden Mermaid projection. Invalid envelopes keep the stripped Mermaid fence as degraded content. */
export const resolveMobileMemoViewerContent = (
  contentJson: TiptapDoc | null | undefined,
  contentMarkdown: string,
) => {
  if (hasPosterDocumentMarker(contentMarkdown)) return markdownToDoc(stripPosterDocumentMarker(contentMarkdown));
  if (parseDiagramDocument(contentMarkdown)) {
    return { type: "doc", content: [{ type: "paragraph" }] } satisfies TiptapDoc;
  }
  if (hasDiagramDocumentMarker(contentMarkdown)) {
    return markdownToDoc(stripDiagramDocumentMarker(contentMarkdown));
  }
  const infographic = parseInfographicDocument(contentMarkdown);
  if (infographic || hasInfographicDocumentMarker(contentMarkdown)) {
    return markdownToDoc(stripInfographicDocumentMarker(contentMarkdown));
  }
  const table = parseTableDocument(contentMarkdown);
  if (table) return markdownToDoc(tableFallbackMarkdown(table));
  if (hasTableDocumentMarker(contentMarkdown)) {
    return markdownToDoc(stripTableDocumentMarker(contentMarkdown));
  }
  return resolveMemoContentDoc(contentJson, contentMarkdown);
};
