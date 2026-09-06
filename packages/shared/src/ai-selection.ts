import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import {
  docToMarkdown,
  markdownToDoc,
  type TiptapNode,
  type TiptapTextNode,
} from "./content";

type TiptapInlineContent = NonNullable<TiptapNode["content"]>;

const INLINE_SENTINEL = "edgeever-inline-sentinel";

const isTextNode = (node: TiptapNode | TiptapTextNode): node is TiptapTextNode =>
  node.type === "text" && "text" in node;

export type AiSelectionSnapshot = {
  from: number;
  to: number;
  documentFingerprint: string;
};

export const getAiDocumentFingerprint = (document: unknown) => JSON.stringify(document);

export const isAiSelectionSnapshotCurrent = (
  selection: AiSelectionSnapshot,
  document: unknown,
  documentSize: number,
) => selection.from >= 0
  && selection.to > selection.from
  && selection.to <= documentSize
  && selection.documentFingerprint === getAiDocumentFingerprint(document);

export type RichTextAiSelectionContext = {
  from: number;
  to: number;
  contentMarkdown: string;
  isInline: boolean;
};

/** AI output may be streamed with formatting whitespace around the response. */
export const normalizeAiSelectionReplacement = (draft: string): string => draft.trim();

/**
 * Clamp a stored rich-text selection without discarding valid block-node
 * positions. A node selection for the first document block starts at 0.
 */
export const getRichTextAiReplacementRange = (
  from: number,
  to: number,
  documentSize: number,
) => {
  const safeFrom = Math.max(0, Math.min(from, documentSize));
  return {
    from: safeFrom,
    to: Math.max(safeFrom, Math.min(to, documentSize)),
  };
};

/**
 * Resolve the Markdown and replacement range for a rich-text selection.
 * A single selected text block stays inside its existing paragraph/list item.
 */
export const getRichTextAiSelectionContext = (
  doc: ProseMirrorNode,
  selection: Selection,
): RichTextAiSelectionContext | null => {
  if (selection.empty) return null;

  const selectedTextblocks: Array<{
    node: ProseMirrorNode;
    contentFrom: number;
    contentTo: number;
    from: number;
    to: number;
  }> = [];

  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isTextblock) return true;

    const contentFrom = pos + 1;
    const contentTo = contentFrom + node.content.size;
    const from = Math.max(selection.from, contentFrom);
    const to = Math.min(selection.to, contentTo);
    if (to > from) selectedTextblocks.push({ node, contentFrom, contentTo, from, to });
    return false;
  });

  if (selectedTextblocks.length === 1) {
    const block = selectedTextblocks[0];
    const selectedBlock = block.node.cut(
      block.from - block.contentFrom,
      block.to - block.contentFrom,
    ).toJSON() as TiptapNode;
    const contentMarkdown = (
      docToMarkdown({
        type: "doc",
        content: [{ type: "paragraph", content: selectedBlock.content }],
      }) || doc.textBetween(block.from, block.to, "\n")
    ).trim();

    return contentMarkdown
      ? { from: block.from, to: block.to, contentMarkdown, isInline: true }
      : null;
  }

  const selectedContent = selection.content().content.toJSON() as TiptapNode[];
  const contentMarkdown = (
    docToMarkdown({ type: "doc", content: selectedContent })
    || doc.textBetween(selection.from, selection.to, "\n")
  ).trim();

  return contentMarkdown
    ? {
        from: selection.from,
        to: selection.to,
        contentMarkdown,
        isInline: false,
      }
    : null;
};

/**
 * Parse AI output for insertion into a rich-text selection without splitting
 * the surrounding paragraph. Multi-block selections retain normal block parsing.
 */
export const getRichTextAiSelectionReplacement = (
  draft: string,
  selectionIsInline: boolean,
): TiptapInlineContent => {
  const blockContent = markdownToDoc(draft).content;
  if (!selectionIsInline) return blockContent;

  const inlineDraft = draft.replace(/\s*\n+\s*/g, " ");
  const inlineDoc = markdownToDoc(`${INLINE_SENTINEL}${inlineDraft}`);
  if (inlineDoc.content.length !== 1 || inlineDoc.content[0]?.type !== "paragraph") {
    return [{ type: "text", text: inlineDraft }];
  }

  const inlineContent = inlineDoc.content[0].content ?? [];
  const firstNode = inlineContent[0];
  if (!firstNode || !isTextNode(firstNode) || !firstNode.text.startsWith(INLINE_SENTINEL)) {
    return [{ type: "text", text: inlineDraft }];
  }

  const firstText = firstNode.text.slice(INLINE_SENTINEL.length);
  return [
    ...(firstText ? [{ ...firstNode, text: firstText }] : []),
    ...inlineContent.slice(1),
  ];
};
