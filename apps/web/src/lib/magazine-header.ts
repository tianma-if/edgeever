export type CoverTitleParts = {
  primary: string;
  highlight: string;
};

export type ChapterCardLabels = {
  num: string;
  shortTitle: string;
  subTitle: string;
};

const DEFAULT_COVER_TITLE = "深度实测与结构化指南";

// Match the first explicit clause delimiter while keeping the original punctuation and trailing space intact.
// Avoid breaking timestamps (10:30), URLs (http://), or hyphenated words (AI-Native).
const COVER_DELIMITER_RE = /^(.+?(?:[：，]\s*|——\s*|[—–]\s*|[:,]\s+))(.+)$/;

const CHAPTER_PREFIX_RE =
  /^\s*(?:第[一二三四五六七八九十百\d]+[章节部分篇]\s*[：:·.\s]*|\d+\s*[.、·:：]\s*|[一二三四五六七八九十]+\s*[、.．]\s*)/u;

const CHAPTER_CLAUSE_SEPARATOR_RE = /\s*(?:[：，、·]|:\s+|[—–]{1,2}|\s+-\s+)\s*/u;

export const splitCoverTitle = (rawTitle: string): CoverTitleParts => {
  const trimmed = rawTitle.trim();
  if (!trimmed) {
    return { primary: DEFAULT_COVER_TITLE, highlight: "" };
  }

  const delimiterMatch = trimmed.match(COVER_DELIMITER_RE);
  if (delimiterMatch) {
    const [, primary, highlight] = delimiterMatch;
    if (primary.trim() && highlight.trim()) {
      return { primary, highlight };
    }
  }

  if (trimmed.length > 10) {
    const target = Math.ceil(trimmed.length * 0.45);
    if (/\s/.test(trimmed)) {
      let bestSplit = -1;
      let bestDistance = Infinity;
      for (const match of trimmed.matchAll(/\s+/g)) {
        const splitIdx = (match.index ?? 0) + match[0].length;
        if (splitIdx > 0 && splitIdx < trimmed.length) {
          const distance = Math.abs(splitIdx - target);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestSplit = splitIdx;
          }
        }
      }
      if (bestSplit > 0) {
        return {
          primary: trimmed.slice(0, bestSplit),
          highlight: trimmed.slice(bestSplit),
        };
      }
    }
    return {
      primary: trimmed.slice(0, target),
      highlight: trimmed.slice(target),
    };
  }

  return { primary: trimmed, highlight: "" };
};

export const cleanChapterHeadingText = (raw: string) =>
  raw.replace(CHAPTER_PREFIX_RE, "").trim();

const splitAtWordOrCharBoundary = (text: string, maxChars: number) => {
  if (text.length <= maxChars) {
    return { head: text, tail: "" };
  }
  if (/\s/.test(text)) {
    const words = text.split(/\s+/).filter(Boolean);
    let head = words[0] || "";
    let consumed = 1;
    while (consumed < words.length) {
      const candidate = `${head} ${words[consumed]}`;
      if (candidate.length > maxChars) break;
      head = candidate;
      consumed += 1;
    }
    return {
      head,
      tail: words.slice(consumed).join(" "),
    };
  }
  return {
    head: text.slice(0, maxChars),
    tail: text.slice(maxChars),
  };
};

const formatSubTitleText = (text: string, fallback: string, maxChars = 24) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  if (normalized.length <= maxChars) return normalized;
  if (/\s/.test(normalized)) {
    const words = normalized.split(/\s+/).filter(Boolean);
    let acc = "";
    for (const word of words) {
      const candidate = acc ? `${acc} ${word}` : word;
      if (candidate.length > maxChars - 1) break;
      acc = candidate;
    }
    if (acc) return `${acc}…`;
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
};

export const deriveChapterCardLabels = (raw: string, index: number): ChapterCardLabels => {
  const num = String(index + 1).padStart(2, "0");
  const fallbackSubTitle = `PART ${num}`;
  const cleaned = cleanChapterHeadingText(raw) || raw.trim() || `章节 ${index + 1}`;
  const parts = cleaned.split(CHAPTER_CLAUSE_SEPARATOR_RE).filter(Boolean);

  if (parts.length >= 2) {
    const first = parts[0];
    const hasSpaces = /\s/.test(first);
    const maxShort = hasSpaces ? 14 : 7;
    if (first.length <= maxShort) {
      return {
        num,
        shortTitle: first,
        subTitle: formatSubTitleText(parts.slice(1).join(" · "), fallbackSubTitle),
      };
    }
    const { head, tail } = splitAtWordOrCharBoundary(first, hasSpaces ? 14 : 6);
    const rest = [tail, ...parts.slice(1)].filter(Boolean).join(" · ");
    return {
      num,
      shortTitle: head,
      subTitle: formatSubTitleText(rest, fallbackSubTitle),
    };
  }

  const hasSpaces = /\s/.test(cleaned);
  const maxShort = hasSpaces ? 14 : 7;
  if (cleaned.length <= maxShort) {
    return {
      num,
      shortTitle: cleaned,
      subTitle: fallbackSubTitle,
    };
  }

  const { head, tail } = splitAtWordOrCharBoundary(cleaned, hasSpaces ? 14 : 6);
  return {
    num,
    shortTitle: head,
    subTitle: formatSubTitleText(tail, fallbackSubTitle),
  };
};
