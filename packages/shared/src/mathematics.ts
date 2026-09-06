import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import {
  BLOCK_MATH_NODE_TYPE,
  edgeEverBlockMathMarkdownTokenizer,
  edgeEverInlineMathMarkdownTokenizer,
  INLINE_MATH_NODE_TYPE,
} from "./mathematics-markdown";

export {
  BLOCK_MATH_NODE_TYPE,
  INLINE_MATH_NODE_TYPE,
} from "./mathematics-markdown";

const EdgeEverInlineMath = InlineMath.extend({
  markdownTokenizer: edgeEverInlineMathMarkdownTokenizer,
});

const EdgeEverBlockMath = BlockMath.extend({
  markdownTokenizer: edgeEverBlockMathMarkdownTokenizer,
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
