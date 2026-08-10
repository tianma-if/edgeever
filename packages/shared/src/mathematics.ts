import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";

export const BLOCK_MATH_NODE_TYPE = "blockMath" as const;
export const INLINE_MATH_NODE_TYPE = "inlineMath" as const;

const isEscaped = (source: string, index: number) => {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

const findClosingDelimiter = (source: string, delimiter: "$" | "$$", from: number) => {
  for (let index = from; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) {
      return index;
    }
  }
  return -1;
};

const EdgeEverInlineMath = InlineMath.extend({
  markdownTokenizer: {
    name: INLINE_MATH_NODE_TYPE,
    level: "inline",
    start: (source: string) => source.indexOf("$"),
    tokenize: (source: string) => {
      if (!source.startsWith("$") || source.startsWith("$$")) {
        return undefined;
      }

      const closingIndex = findClosingDelimiter(source, "$", 1);
      if (closingIndex < 0 || source[closingIndex + 1] === "$") {
        return undefined;
      }

      const raw = source.slice(0, closingIndex + 1);
      const latex = source.slice(1, closingIndex).trim();
      if (!latex || latex.includes("\n")) {
        return undefined;
      }

      // A dollar-wrapped number is overwhelmingly likely to be currency. Consume
      // it as text so its closing delimiter cannot start a later math token.
      if (/^\d+(?:[.,]\d+)?$/u.test(latex)) {
        return { type: "text", raw, text: raw };
      }

      return {
        type: INLINE_MATH_NODE_TYPE,
        raw,
        latex,
      };
    },
  },
});

const EdgeEverBlockMath = BlockMath.extend({
  markdownTokenizer: {
    name: BLOCK_MATH_NODE_TYPE,
    level: "block",
    start: (source: string) => source.indexOf("$$"),
    tokenize: (source: string) => {
      if (!source.startsWith("$$") || source.startsWith("$$$")) {
        return undefined;
      }

      const closingIndex = findClosingDelimiter(source, "$$", 2);
      if (closingIndex < 0) {
        return undefined;
      }

      const latex = source.slice(2, closingIndex).trim();
      if (!latex) {
        return undefined;
      }

      return {
        type: BLOCK_MATH_NODE_TYPE,
        raw: source.slice(0, closingIndex + 2),
        latex,
      };
    },
  },
});

const katexOptions = {
  throwOnError: false,
  strict: "warn" as const,
  trust: false,
};

/** Fresh extension instances for each TipTap editor or Markdown manager. */
export const createEdgeEverMathematics = () => [
  EdgeEverBlockMath.configure({ katexOptions }),
  EdgeEverInlineMath.configure({ katexOptions }),
];
