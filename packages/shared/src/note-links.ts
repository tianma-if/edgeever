import type { TiptapDoc, TiptapNode, TiptapTextNode } from "./content";

const MEMO_LINK_PREFIX = "#memo=";

export const createMemoLinkHref = (memoId: string): string => `${MEMO_LINK_PREFIX}${encodeURIComponent(memoId)}`;

export const parseMemoLinkHref = (href: unknown): string | null => {
  if (typeof href !== "string" || !href.startsWith(MEMO_LINK_PREFIX)) {
    return null;
  }

  const memoId = href.slice(MEMO_LINK_PREFIX.length);
  if (!memoId) {
    return null;
  }

  try {
    return decodeURIComponent(memoId);
  } catch {
    return null;
  }
};

export const collectMemoLinkIds = (doc: TiptapDoc): string[] => {
  const memoIds = new Set<string>();
  const visit = (node: TiptapNode | TiptapTextNode) => {
    if ("attrs" in node) {
      const memoId = parseMemoLinkHref(node.attrs?.href);
      if (memoId) memoIds.add(memoId);
    }
    if ("marks" in node) {
      for (const mark of node.marks ?? []) {
        const memoId = parseMemoLinkHref(mark.attrs?.href);
        if (memoId) memoIds.add(memoId);
      }
    }
    if ("content" in node) node.content?.forEach(visit);
  };

  doc.content.forEach(visit);
  return [...memoIds];
};
