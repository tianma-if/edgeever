import type { AiGenerateInput, AiPreparedGeneration, AiStreamEvent } from "@edgeever/shared";
import {
  AI_CONTINUATION_MAX_ROUNDS,
  AI_SEGMENT_MAX_SPLIT_DEPTH,
  aiSegmentTail,
  isAiSegmentResultPlausible,
  joinAiContinuation,
  joinAiGenerationSegments,
  joinAiSegmentResult,
  type AiGenerationSegment,
} from "@edgeever/shared/ai-generation-segments";

/** A prepared request; `segments` is set when prepare planned the task in parts. */
export type AiPreparedRun = AiPreparedGeneration & {
  segments?: AiGenerationSegment[];
  /** The server can continue a cut-off result; an older server would start over instead. */
  longGeneration?: boolean;
};

/** The extra fields one prepare call of a long run adds to the user's request. */
export type AiRunRequest = Partial<Pick<AiGenerateInput, "contentMarkdown" | "segmentation" | "segment" | "continuation">>;

type StreamResult = { text: string; truncated: boolean; finishReason?: string; error?: Extract<AiStreamEvent, { type: "error" }> };

const CONTINUATION_TAIL_CHARS = 20_000;
/** Hold back the start of a continuation until a repeated seam can be recognised. */
const CONTINUATION_HOLD_CHARS = 800;

/**
 * Run one body generation to completion (#652 PR B).
 *
 * - When prepare returns parts, each part is prepared and streamed in order with the context of
 *   the part before it. A part that is cut off is split again (up to two levels); a part that still
 *   cannot finish keeps its source text and is reported in `incompleteParts`.
 * - Otherwise one request runs; when it is cut off, up to three continuations append the rest.
 * - An error, a dropped connection or a stop ends the run; the text so far stays as an
 *   incomplete draft. Requests that already returned are never repeated.
 *
 * Events: one `start`, `text-delta` while text arrives, `text-reset` when a long run fixes up the
 * draft, `progress` per part, then `finish` or `error`.
 */
export const runAiLongGeneration = async (options: {
  first: AiPreparedRun;
  prepare: (request: AiRunRequest) => Promise<AiPreparedRun>;
  stream: (prepared: AiPreparedGeneration, onEvent: (event: AiStreamEvent) => void) => Promise<void>;
  signal?: AbortSignal;
  onEvent: (event: AiStreamEvent) => void;
}) => {
  const { onEvent, signal } = options;
  // Token usage summed over every request of the run, when the provider reports it.
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const usage = () => ({
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  });
  const aborted = () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  };

  /** Stream one prepared request; `onText` gets each delta, the result says how it ended. */
  const streamOne = async (prepared: AiPreparedGeneration, onText: (text: string) => void): Promise<StreamResult> => {
    let text = "";
    let finish: Extract<AiStreamEvent, { type: "finish" }> | null = null;
    let error: StreamResult["error"];
    await options.stream(prepared, (event) => {
      if (event.type === "text-delta") {
        text += event.text;
        onText(event.text);
      } else if (event.type === "finish") {
        finish = event;
      } else if (event.type === "error") {
        error = event;
      }
    });
    const ended = finish as Extract<AiStreamEvent, { type: "finish" }> | null;
    if (typeof ended?.inputTokens === "number") inputTokens = (inputTokens ?? 0) + ended.inputTokens;
    if (typeof ended?.outputTokens === "number") outputTokens = (outputTokens ?? 0) + ended.outputTokens;
    return { text, truncated: Boolean(ended?.truncated), finishReason: ended?.finishReason, error };
  };

  onEvent({ type: "start" });
  if (options.first.segments?.length) {
    await runParts(options.first.segments);
  } else {
    await runSingle(options.first);
  }

  async function runSingle(first: AiPreparedGeneration) {
    let draft = "";
    let result = await streamOne(first, (text) => {
      draft += text;
      onEvent({ type: "text-delta", text });
    });
    if (result.error) return onEvent(result.error);
    let truncated = result.truncated;
    let finishReason = result.finishReason;
    const canContinue = options.first.longGeneration === true;
    for (let round = 1; canContinue && truncated && round <= AI_CONTINUATION_MAX_ROUNDS; round += 1) {
      aborted();
      let next: AiPreparedRun;
      try {
        next = await options.prepare({ continuation: { round, previousOutput: draft.slice(-CONTINUATION_TAIL_CHARS) } });
      } catch {
        // No room left in the window (or the server cannot continue): the draft stays incomplete.
        break;
      }
      const before = draft;
      let held = "";
      let joined = false;
      const release = (final: boolean) => {
        if (joined || (!final && held.length < CONTINUATION_HOLD_CHARS)) return;
        joined = true;
        const merged = joinAiContinuation(before, held);
        const added = merged.slice(before.length);
        // A continuation that is only whitespace adds nothing to the draft.
        if (final && !added.trim()) return;
        draft = merged;
        if (added) onEvent({ type: "text-delta", text: added });
      };
      result = await streamOne(next, (text) => {
        if (joined) {
          draft += text;
          onEvent({ type: "text-delta", text });
          return;
        }
        held += text;
        release(false);
      });
      release(true);
      if (result.error) return onEvent(result.error);
      // Only a continuation that added text can end the cut-off state; an empty one (or one that
      // only repeated what was there) leaves the draft incomplete and stops continuing.
      if (!draft.slice(before.length).trim()) break;
      truncated = result.truncated;
      finishReason = result.finishReason;
    }
    onEvent({ type: "finish", finishReason, truncated, ...usage() });
  }

  async function runParts(segments: AiGenerationSegment[]) {
    const done: string[] = [];
    const incomplete = new Set<number>();
    let previousSource = "";
    let previousOutput = "";
    const draftSoFar = () => joinAiGenerationSegments(done);

    /** Run one part; returns false when the run must end (an error was already reported). */
    const runPart = async (segment: AiGenerationSegment, part: number, context: { index: number; count: number }, depth: number): Promise<boolean> => {
      if (segment.passthrough) {
        done.push(joinAiSegmentResult(segment, segment.markdown));
        return true;
      }
      aborted();
      // The parts already finished, with their separators, so this part's text follows them.
      const prefix = done.join("");
      let prepared: AiPreparedRun | null = null;
      try {
        prepared = await options.prepare({
          contentMarkdown: segment.markdown,
          segment: {
            index: context.index,
            count: context.count,
            headingPath: segment.headingPath.slice(-6),
            ...(previousSource ? { previousSourceTail: aiSegmentTail(previousSource) } : {}),
            ...(previousOutput ? { previousOutputTail: aiSegmentTail(previousOutput) } : {}),
          },
        });
      } catch (error) {
        // A part that does not fit is split again like a part that was cut off.
        if (!isInputTooLong(error)) throw error;
      }
      let result: StreamResult | null = null;
      if (prepared) {
        onEvent({ type: "text-reset", text: prefix });
        result = await streamOne(prepared, (text) => onEvent({ type: "text-delta", text }));
        if (result.error) {
          onEvent({ type: "text-reset", text: prefix + result.text });
          onEvent(result.error);
          return false;
        }
      }
      // A result far shorter than its part lost text even if the model said it finished.
      if (result && !result.truncated && result.text.trim() && isAiSegmentResultPlausible(segment.markdown, result.text)) {
        done.push(joinAiSegmentResult(segment, result.text));
        previousSource = segment.markdown;
        previousOutput = result.text;
        onEvent({ type: "text-reset", text: draftSoFar() });
        return true;
      }
      // Cut off (or too long to send): split this part into smaller ones and run those instead.
      if (depth < AI_SEGMENT_MAX_SPLIT_DEPTH) {
        let smaller: AiPreparedRun | null = null;
        try {
          smaller = await options.prepare({ contentMarkdown: segment.markdown, segmentation: { depth: depth + 1 } });
        } catch (error) {
          if (!isInputTooLong(error)) throw error;
        }
        const parts = smaller?.segments ?? [];
        if (parts.length > 1) {
          for (const child of parts) {
            const ok = await runPart(
              { ...child, headingPath: [...segment.headingPath, ...child.headingPath] },
              part,
              context,
              depth + 1,
            );
            if (!ok) return false;
          }
          return true;
        }
      }
      // It still cannot finish: keep the source text so nothing is lost, and say which part.
      incomplete.add(part);
      done.push(joinAiSegmentResult(segment, segment.markdown));
      onEvent({ type: "text-reset", text: draftSoFar() });
      return true;
    };

    for (const [index, segment] of segments.entries()) {
      onEvent({ type: "progress", part: index + 1, parts: segments.length });
      const ok = await runPart(segment, index + 1, { index, count: segments.length }, 0);
      if (!ok) return;
    }
    const incompleteParts = [...incomplete].sort((left, right) => left - right);
    onEvent({ type: "text-reset", text: draftSoFar() });
    onEvent({ type: "finish", truncated: incompleteParts.length > 0, ...(incompleteParts.length ? { incompleteParts } : {}), ...usage() });
  }
};

const isInputTooLong = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ai_input_too_long");
