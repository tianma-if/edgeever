import { Extension, mergeAttributes, Node } from "@tiptap/core";

export const BLOCK_MATH_NODE_TYPE = "blockMath" as const;
export const INLINE_MATH_NODE_TYPE = "inlineMath" as const;

/** Reuse the Markdown lexer's fence handling, including nesting and fence length. */
export const MathCodeFence = Extension.create({
  name: "mathCodeFence",
  priority: 101,
  markdownTokenName: "code",
  parseMarkdown: (token) => {
    if (token.lang !== "math" || !token.text?.trim()) return [];
    return { type: BLOCK_MATH_NODE_TYPE, attrs: { latex: token.text.trim() } };
  },
});

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

/** A dollar-wrapped number is currency, so it must not become a formula. */
export const isCurrencyLatex = (latex: string) => /^\d+(?:[.,]\d+)?$/u.test(latex);

export type InlineMathSpan = {
  index: number;
  raw: string;
  latex: string;
};

const readInlineMathAt = (text: string, start: number): InlineMathSpan | null => {
  if (text[start] !== "$" || isEscaped(text, start) || text.startsWith("$$", start)) {
    return null;
  }
  // The second `$` of `$$` belongs to a display delimiter, not an inline formula.
  if (start > 0 && text[start - 1] === "$" && !isEscaped(text, start - 1)) {
    return null;
  }

  const closing = findClosingDelimiter(text, "$", start + 1);
  if (closing < 0 || text[closing + 1] === "$") return null;

  const latex = text.slice(start + 1, closing).trim();
  if (!latex || latex.includes("\n") || isCurrencyLatex(latex)) return null;

  return {
    index: start,
    raw: text.slice(start, closing + 1),
    latex,
  };
};

const skipConsumedDollars = (text: string, start: number) => {
  if (isEscaped(text, start) || text.startsWith("$$", start)) return start + 1;

  const closing = findClosingDelimiter(text, "$", start + 1);
  if (closing < 0 || text[closing + 1] === "$") return start + 1;

  const latex = text.slice(start + 1, closing).trim();
  if (latex && !latex.includes("\n") && isCurrencyLatex(latex)) return closing + 1;
  return start + 1;
};

/** Inline `$...$` spans in document order. Currency pairs are consumed and skipped. */
export const findInlineMathSpans = (text: string): InlineMathSpan[] => {
  const spans: InlineMathSpan[] = [];
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("$", index);
    if (start < 0) break;

    const span = readInlineMathAt(text, start);
    if (!span) {
      index = skipConsumedDollars(text, start);
      continue;
    }

    spans.push(span);
    index = span.index + span.raw.length;
  }

  return spans;
};

/** The inline formula that ends at the caret, if the closing `$` was just typed. */
export const matchInlineMathSuffix = (text: string): InlineMathSpan | null => {
  const span = findInlineMathSpans(text).at(-1);
  if (!span || span.index + span.raw.length !== text.length) return null;
  return span;
};

/** A paragraph whose entire text is one `$$...$$` display formula. */
export const matchBlockMathText = (text: string): { latex: string } | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("$$") || trimmed.startsWith("$$$")) return null;

  const closing = findClosingDelimiter(trimmed, "$$", 2);
  if (closing < 0 || trimmed.slice(closing + 2).trim() !== "") return null;

  const latex = trimmed.slice(2, closing).trim();
  if (!latex) return null;
  return { latex };
};

export const edgeEverInlineMathMarkdownTokenizer = {
  name: INLINE_MATH_NODE_TYPE,
  level: "inline" as const,
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
    if (isCurrencyLatex(latex)) {
      return { type: "text", raw, text: raw };
    }

    return {
      type: INLINE_MATH_NODE_TYPE,
      raw,
      latex,
    };
  },
};

export const edgeEverBlockMathMarkdownTokenizer = {
  name: BLOCK_MATH_NODE_TYPE,
  level: "block" as const,
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
};

const MarkdownInlineMath = Node.create({
  name: INLINE_MATH_NODE_TYPE,
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex"),
        renderHTML: (attributes) => ({ "data-latex": attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "inline-math" })];
  },

  parseMarkdown: (token) => ({
    type: INLINE_MATH_NODE_TYPE,
    attrs: { latex: token.latex },
  }),

  renderMarkdown: (node) => `$${node.attrs?.latex || ""}$`,
  markdownTokenizer: edgeEverInlineMathMarkdownTokenizer,
});

const MarkdownBlockMath = Node.create({
  name: BLOCK_MATH_NODE_TYPE,
  group: "block",
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex"),
        renderHTML: (attributes) => ({ "data-latex": attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "block-math" })];
  },

  parseMarkdown: (token) => ({
    type: BLOCK_MATH_NODE_TYPE,
    attrs: { latex: token.latex },
  }),

  renderMarkdown: (node) => ["$$", node.attrs?.latex || "", "$$"].join("\n"),
  markdownTokenizer: edgeEverBlockMathMarkdownTokenizer,
});

/** Math nodes for Markdown parsing/serialization without the browser-only KaTeX renderer. */
export const createEdgeEverMarkdownMathematics = () => [
  MarkdownBlockMath.configure(),
  MarkdownInlineMath.configure(),
];
