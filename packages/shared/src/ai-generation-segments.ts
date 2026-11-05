import type { Token, Tokens } from "marked";
import { estimateAiTokens, type AiOutputBudgetPlan } from "./ai-model-capabilities";
import { createEdgeEverMarked } from "./markdown-options";

/**
 * Long body generation in parts (#652 PR B).
 *
 * Source-sized tasks (translate, proofread, polish, simplify, change tone) are split into parts
 * at top-level Markdown blocks so each part fits one request. The server plans the parts in
 * prepare and every client runs them, so the rules live here once.
 */
export const AI_SEGMENTABLE_ACTIONS = [
  "translate",
  "rewrite-proofread",
  "fix-spelling-grammar",
  "improve-writing",
  "simplify-language",
  "change-tone",
] as const;

export const isAiSegmentableAction = (action: string) =>
  (AI_SEGMENTABLE_ACTIONS as readonly string[]).includes(action);

export type AiGenerationSegment = {
  /** The part's source, exactly as it appears in the note (trailing blank lines included). */
  markdown: string;
  /** Headings in effect where the part starts, outermost first. */
  headingPath: string[];
  /** Code-only or front matter: kept as is without a request. */
  passthrough: boolean;
};

/** Context sent with one part so the model keeps terms and style consistent. */
export type AiGenerationSegmentContext = {
  index: number;
  count: number;
  headingPath: string[];
  previousSourceTail?: string;
  previousOutputTail?: string;
};

/** How deep a part that was still cut off may be split again. */
export const AI_SEGMENT_MAX_SPLIT_DEPTH = 2;
/** Without known limits, longer sources are split anyway; this is a part size, not a budget. */
export const AI_SEGMENT_UNBOUNDED_SOURCE_TOKENS = 2000;
const AI_SEGMENT_MIN_SOURCE_TOKENS = 300;
const AI_SEGMENT_MAX_PARTS = 200;
const AI_SEGMENT_TAIL_CHARS = 600;
const REASONING_HEADROOM_TOKENS = 4096;
/** Planner assumption: a source-sized result needs about 2.5× the source tokens. */
const OUTPUT_PER_SOURCE_TOKEN = 2.5;

/**
 * The largest part (in estimated source tokens) one request can finish, or `null` when the
 * source does not need splitting. Splits when the estimated output passes 80% of the output
 * limit, when the input does not fit, or, without limits, when the source is long.
 */
export const resolveAiSegmentSourceTokens = (input: {
  action: string;
  sourceText: string;
  plan: Pick<AiOutputBudgetPlan, "mode" | "maxOutputTokens" | "outputLimit" | "inputFits">;
  /** The model's input limit or shared window, when known. */
  inputLimitTokens?: number | null;
  depth?: number;
}): number | null => {
  if (!isAiSegmentableAction(input.action)) return null;
  const sourceTokens = estimateAiTokens(input.sourceText);
  const limit = input.plan.mode === "manual" ? input.plan.maxOutputTokens : input.plan.outputLimit
    ?? (input.plan.mode === "fallback" ? input.plan.maxOutputTokens : null);
  let size = limit
    ? Math.floor((limit * 0.8 - Math.min(REASONING_HEADROOM_TOKENS, limit * 0.3)) / OUTPUT_PER_SOURCE_TOKEN)
    : AI_SEGMENT_UNBOUNDED_SOURCE_TOKENS;
  // A part also has to fit the input side, with room for the prompt around it.
  if (input.inputLimitTokens) size = Math.min(size, Math.floor(input.inputLimitTokens / 4));
  size = Math.max(AI_SEGMENT_MIN_SOURCE_TOKENS, size);
  const depth = Math.max(0, Math.min(AI_SEGMENT_MAX_SPLIT_DEPTH, input.depth ?? 0));
  if (depth > 0) {
    // A part that was cut off: split it into smaller parts than it was.
    return Math.max(AI_SEGMENT_MIN_SOURCE_TOKENS / 2, Math.min(size, Math.floor(sourceTokens / 2)));
  }
  if (sourceTokens <= size && input.plan.inputFits !== false) return null;
  return size;
};

type Unit = { raw: string; tokens: number; headings: { depth: number; text: string }[]; code: boolean; heading: boolean };

const FRONT_MATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;
const SENTENCE_END = /(?<=[。！？!?；;]|[.](?=\s))\s*/u;

const splitLongText = (raw: string, maxTokens: number): string[] => {
  // Paragraphs carrying math or inline code stay whole, as does anything with no sentence end.
  if (raw.includes("$$") || raw.includes("`")) return [raw];
  const pieces: string[] = [];
  let rest = raw;
  while (rest) {
    const match = SENTENCE_END.exec(rest);
    if (!match || match.index + match[0].length >= rest.length) { pieces.push(rest); break; }
    const end = match.index + match[0].length;
    pieces.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && estimateAiTokens(current + piece) > maxTokens) {
      parts.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) parts.push(current);
  return parts;
};

const splitLongToken = (token: Token, maxTokens: number): string[] => {
  if (token.type === "list") {
    const items = (token as Tokens.List).items;
    const itemsRaw = items.map((item) => item.raw).join("");
    // The list's trailing newline is not part of any item; it stays with the last part.
    if (token.raw.startsWith(itemsRaw) && !token.raw.slice(itemsRaw.length).trim()) {
      const parts: string[] = [];
      let current = "";
      for (const item of items) {
        if (current && estimateAiTokens(current + item.raw) > maxTokens) {
          parts.push(current);
          current = "";
        }
        current += item.raw;
      }
      if (current) parts.push(current);
      parts[parts.length - 1] += token.raw.slice(itemsRaw.length);
      return parts;
    }
  }
  if (token.type === "paragraph" || token.type === "text") return splitLongText(token.raw, maxTokens);
  // Tables, code, HTML, blockquotes and math are never split inside.
  return [token.raw];
};

const headingText = (token: Tokens.Heading) => token.text.replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * Split a note into parts of at most `maxSourceTokens` (estimated), only between top-level
 * blocks: a heading stays with what follows it, blank lines stay with the block before them,
 * and code blocks, tables, HTML and math are never cut. A block that alone is too long is split
 * between list items, then between sentences. Joining every part's `markdown` gives the source
 * back exactly.
 */
export const splitAiGenerationSegments = (markdown: string, maxSourceTokens: number): AiGenerationSegment[] => {
  if (!markdown.includes("\r")) return splitNormalizedSegments(markdown, maxSourceTokens);
  // The lexer reads CRLF (and lone CR) as LF. Split the LF text, then cut the original at the same
  // places so every part keeps its own line endings and the parts still join to the exact source.
  const offsets: number[] = [];
  let normalized = "";
  for (let index = 0; index < markdown.length; index += 1) {
    const char = markdown[index];
    if (char === "\r") {
      offsets.push(index);
      normalized += "\n";
      if (markdown[index + 1] === "\n") index += 1;
      continue;
    }
    offsets.push(index);
    normalized += char;
  }
  offsets.push(markdown.length);
  let start = 0;
  return splitNormalizedSegments(normalized, maxSourceTokens).map((segment) => {
    const end = start + segment.markdown.length;
    const part = { ...segment, markdown: markdown.slice(offsets[start], offsets[end]) };
    start = end;
    return part;
  });
};

const splitNormalizedSegments = (markdown: string, maxSourceTokens: number): AiGenerationSegment[] => {
  const maxTokens = Math.max(1, maxSourceTokens);
  const segments: AiGenerationSegment[] = [];
  let body = markdown;
  const frontMatter = FRONT_MATTER.exec(markdown)?.[0];
  if (frontMatter) {
    segments.push({ markdown: frontMatter, headingPath: [], passthrough: true });
    body = markdown.slice(frontMatter.length);
  }
  const tokens = createEdgeEverMarked().lexer(body);
  if (tokens.map((token) => token.raw).join("") !== body) {
    // The lexer did not keep every character; never risk losing text, keep one part.
    return [...segments, { markdown: body, headingPath: [], passthrough: false }].filter((segment) => segment.markdown);
  }

  const units: Unit[] = [];
  for (const token of tokens) {
    const previous = units.at(-1);
    if (token.type === "space" && previous) {
      previous.raw += token.raw;
      continue;
    }
    const heading = token.type === "heading";
    const pieces = !heading && estimateAiTokens(token.raw) > maxTokens ? splitLongToken(token, maxTokens) : [token.raw];
    for (const raw of pieces) {
      units.push({
        raw,
        tokens: estimateAiTokens(raw),
        headings: heading ? [{ depth: (token as Tokens.Heading).depth, text: headingText(token as Tokens.Heading) }] : [],
        code: token.type === "code",
        heading,
      });
    }
  }

  // A heading always travels with the block after it (consecutive headings included).
  const blocks: Unit[] = [];
  let pending: Unit | null = null;
  for (const unit of units) {
    const merged: Unit = pending
      ? { raw: pending.raw + unit.raw, tokens: pending.tokens + unit.tokens, headings: [...pending.headings, ...unit.headings], code: false, heading: unit.heading }
      : unit;
    if (unit.heading) { pending = merged; continue; }
    pending = null;
    // A short code block stays with the text before it: a part that opens with code reads as the
    // previous part's context to the model, which may leave it out.
    const previous = blocks.at(-1);
    if (merged.code && previous && !previous.code && previous.tokens + merged.tokens <= maxTokens) {
      previous.raw += merged.raw;
      previous.tokens += merged.tokens;
      continue;
    }
    blocks.push(merged);
  }
  if (pending) blocks.push(pending);

  let path: { depth: number; text: string }[] = [];
  let current: { raw: string; tokens: number; path: string[]; codeOnly: boolean } | null = null;
  const flush = () => {
    if (current?.raw) segments.push({ markdown: current.raw, headingPath: current.path, passthrough: current.codeOnly });
    current = null;
  };
  for (const block of blocks) {
    // Prefer to start a part at a heading once the current part is well filled, so parts begin
    // with whole sections rather than in the middle of one.
    const opensSection = block.headings.length > 0 && block.raw.trimStart().startsWith("#");
    if (current && (current.tokens + block.tokens > maxTokens || (opensSection && current.tokens >= maxTokens * 0.6))) flush();
    if (!current) {
      // A part that opens with a heading sits beside, not under, earlier headings of its level.
      const opening = block.raw.trimStart().startsWith("#") ? block.headings[0] : undefined;
      const parents = opening ? path.filter((item) => item.depth < opening.depth) : path;
      current = { raw: "", tokens: 0, path: parents.map((item) => item.text), codeOnly: true };
    }
    current.raw += block.raw;
    current.tokens += block.tokens;
    current.codeOnly &&= block.code;
    for (const heading of block.headings) path = [...path.filter((item) => item.depth < heading.depth), heading];
  }
  flush();
  return segments.length <= AI_SEGMENT_MAX_PARTS ? segments : mergeToLimit(segments);
};

/** Too many parts: merge neighbours so a run never needs more than the part limit. */
const mergeToLimit = (segments: AiGenerationSegment[]) => {
  const size = Math.ceil(segments.length / AI_SEGMENT_MAX_PARTS);
  const merged: AiGenerationSegment[] = [];
  for (let index = 0; index < segments.length; index += size) {
    const group = segments.slice(index, index + size);
    merged.push({
      markdown: group.map((segment) => segment.markdown).join(""),
      headingPath: group[0].headingPath,
      passthrough: group.every((segment) => segment.passthrough),
    });
  }
  return merged;
};

/** The last characters of a text, for the next part's context. */
export const aiSegmentTail = (text: string) => {
  const trimmed = text.trimEnd();
  return trimmed.length <= AI_SEGMENT_TAIL_CHARS ? trimmed : trimmed.slice(-AI_SEGMENT_TAIL_CHARS);
};

/**
 * Put one part's result back in place: the result replaces the part's text and keeps the blank
 * lines that separated it from the next part in the source.
 */
export const joinAiSegmentResult = (segment: Pick<AiGenerationSegment, "markdown">, result: string) => {
  const separator = /\s*$/.exec(segment.markdown)?.[0] ?? "";
  return `${result.trim()}${separator || "\n\n"}`;
};

/** Merge the results of all parts, in order, into the finished note. */
export const joinAiGenerationSegments = (parts: string[]) => {
  const joined = parts.join("");
  return joined.replace(/\s+$/, "");
};

/** Continuation of a cut-off result: at most this many rounds after the first request. */
export const AI_CONTINUATION_MAX_ROUNDS = 3;
const AI_CONTINUATION_MIN_OVERLAP = 12;
const AI_CONTINUATION_MAX_OVERLAP = 800;

/**
 * Append a continuation to a cut-off result, dropping any text the model repeated from the end
 * of what it had already written.
 */
export const joinAiContinuation = (previous: string, next: string) => {
  const head = next.replace(/^\s+/, "");
  const limit = Math.min(AI_CONTINUATION_MAX_OVERLAP, previous.length, head.length);
  for (let length = limit; length >= AI_CONTINUATION_MIN_OVERLAP; length -= 1) {
    if (previous.endsWith(head.slice(0, length))) return previous + head.slice(length);
  }
  // The cut happened mid-line; keep the model's own leading whitespace only after a line end.
  return previous + (/\s$/.test(previous) || !/^\s/.test(next) ? next.replace(/^[ \t]+/, "") : next);
};

const AI_SEGMENT_MIN_RESULT_RATIO = 0.25;
const AI_SEGMENT_JUDGED_SOURCE_TOKENS = 200;

/**
 * Whether a part's result is long enough to be the whole part. A model sometimes treats the start
 * of a part as context and returns only a fragment while reporting a normal finish; such a result
 * is handled like a cut-off part (split again, or the source kept) instead of silently losing text.
 */
export const isAiSegmentResultPlausible = (source: string, result: string) => {
  const sourceTokens = estimateAiTokens(source);
  if (sourceTokens < AI_SEGMENT_JUDGED_SOURCE_TOKENS) return true;
  return estimateAiTokens(result) >= sourceTokens * AI_SEGMENT_MIN_RESULT_RATIO;
};
