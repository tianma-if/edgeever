import {
  docToMarkdown,
  markdownToDoc,
  type TiptapDoc,
} from "@edgeever/shared";

export type MarkdownModeSnapshot = {
  memoId: string;
  contentJson: TiptapDoc;
  markdownSource: string;
};

const normalizeMarkdownSource = (value: string) => value.replace(/\r\n?/g, "\n");

const cloneContentJson = (contentJson: TiptapDoc): TiptapDoc =>
  JSON.parse(JSON.stringify(contentJson)) as TiptapDoc;

type ContentNode = {
  type?: string;
  content?: ContentNode[];
  [key: string]: unknown;
};

const isTableCell = (node: ContentNode) =>
  node.type === "tableCell" || node.type === "tableHeader";

const hasBlockContent = (node: ContentNode) => isTableCell(node) && (
  !Array.isArray(node.content)
  || node.content.length !== 1
  || node.content[0]?.type !== "paragraph"
);

const collectTables = (value: unknown): ContentNode[] => {
  const tables: ContentNode[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const contentNode = node as ContentNode;
    if (contentNode.type === "table") {
      tables.push(contentNode);
      return;
    }
    contentNode.content?.forEach(visit);
  };
  visit(value);
  return tables;
};

const collectCells = (table: ContentNode): ContentNode[] => {
  const cells: ContentNode[] = [];
  const visit = (node: ContentNode) => {
    if (isTableCell(node)) {
      cells.push(node);
      return;
    }
    node.content?.forEach(visit);
  };
  visit(table);
  return cells;
};

const nodesEqual = (left: ContentNode, right: ContentNode) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Markdown flattens block nodes inside GFM table cells. Rehydrate an original
 * rich cell only when its Markdown projection is still byte-for-byte
 * equivalent to the parsed edited cell. Edits elsewhere in the source can
 * therefore round-trip without damaging the untouched cell.
 */
const restoreUnchangedRichTableCells = (
  original: TiptapDoc,
  originalProjection: TiptapDoc,
  editedProjection: TiptapDoc,
): TiptapDoc => {
  const restored = cloneContentJson(editedProjection);
  const originalTables = collectTables(original);
  const projectedTables = collectTables(originalProjection);
  const editedTables = collectTables(restored);

  originalTables.forEach((originalTable, tableIndex) => {
    const projectedTable = projectedTables[tableIndex];
    const editedTable = editedTables[tableIndex];
    if (!projectedTable || !editedTable) return;

    const originalCells = collectCells(originalTable);
    const projectedCells = collectCells(projectedTable);
    const editedCells = collectCells(editedTable);
    if (
      originalCells.length !== projectedCells.length
      || projectedCells.length !== editedCells.length
    ) return;

    originalCells.forEach((originalCell, cellIndex) => {
      if (
        hasBlockContent(originalCell)
        && nodesEqual(projectedCells[cellIndex]!, editedCells[cellIndex]!)
      ) {
        Object.keys(editedCells[cellIndex]!).forEach((key) => {
          delete editedCells[cellIndex]![key];
        });
        Object.assign(
          editedCells[cellIndex]!,
          JSON.parse(JSON.stringify(originalCell)) as ContentNode,
        );
      }
    });
  });

  return restored;
};

/**
 * Captures the lossless rich document before exposing its Markdown projection.
 * Markdown cannot represent every valid TipTap tree, so the JSON snapshot must
 * remain authoritative until the user actually changes the source.
 */
export const createMarkdownModeSnapshot = (
  memoId: string,
  contentJson: TiptapDoc,
  markdownSource = docToMarkdown(contentJson),
): MarkdownModeSnapshot => ({
  memoId,
  contentJson: cloneContentJson(contentJson),
  markdownSource,
});

export const isMarkdownSourceUnchanged = (
  snapshot: MarkdownModeSnapshot | null,
  memoId: string | null | undefined,
  markdownSource: string,
) => Boolean(
  snapshot
  && memoId
  && snapshot.memoId === memoId
  && normalizeMarkdownSource(snapshot.markdownSource) === normalizeMarkdownSource(markdownSource)
);

/** Resolve the document used by mode switching, drafts, autosave, and recovery. */
export const resolveMarkdownModeContent = (
  snapshot: MarkdownModeSnapshot | null,
  memoId: string | null | undefined,
  markdownSource: string,
): TiptapDoc => {
  if (isMarkdownSourceUnchanged(snapshot, memoId, markdownSource)) {
    return snapshot!.contentJson;
  }

  const editedProjection = markdownToDoc(markdownSource);
  if (!snapshot || !memoId || snapshot.memoId !== memoId) {
    return editedProjection;
  }

  return restoreUnchangedRichTableCells(
    snapshot.contentJson,
    markdownToDoc(snapshot.markdownSource),
    editedProjection,
  );
};
