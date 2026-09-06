import {
  diagramFallbackMarkdown,
  markdownToDoc,
  parseDiagramDocument,
  resolveMemoContentDoc,
  type TiptapDoc,
  type DiagramKind,
} from "@edgeever/shared";

export const getMobileVisualDiagramKind = (contentMarkdown: string): DiagramKind | null =>
  parseDiagramDocument(contentMarkdown)?.kind ?? null;

/** Render visual-note envelopes through the native Mermaid viewer without discarding their IR. */
export const resolveMobileMemoViewerContent = (
  contentJson: TiptapDoc | null | undefined,
  contentMarkdown: string,
) => {
  const diagram = parseDiagramDocument(contentMarkdown);
  return diagram
    ? markdownToDoc(diagramFallbackMarkdown(diagram))
    : resolveMemoContentDoc(contentJson, contentMarkdown);
};
