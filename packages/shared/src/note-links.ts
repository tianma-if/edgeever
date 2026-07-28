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
