import type { AiOutputBudgetMode } from "./ai-model-capabilities";
import type { AiAttachmentInput } from "./schemas";
import type { AiProvider } from "./types";

export type AiGenerationResultBoundary = Readonly<{
  start: string;
  end: string;
}>;

export type AiDirectTarget = {
  provider: AiProvider;
  baseUrl: string;
  modelId: string;
};

export type AiPreparedGeneration = AiDirectTarget & {
  apiKey: string;
  system: string;
  prompt: string;
  /** `null` asks the client to send no output limit (only for clients that opted in). */
  maxOutputTokens: number | null;
  resultBoundary: AiGenerationResultBoundary;
  /** How the budget was chosen (#652); absent from older instances. */
  outputBudget?: { mode: AiOutputBudgetMode; outputLimit: number | null; inputFits: boolean | null };
  /** Set when the instance has no fresh limits for this model; the client may detect and report them. */
  capabilityTarget?: { providerConfigId: string; modelConfigId: string };
};

export type AiPreparedTextGeneration = AiDirectTarget & {
  apiKey: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
};

export type AiPreparedTagSuggestions = AiPreparedTextGeneration & {
  currentTags: string[];
  canonicalTags: Record<string, string>;
};

export const aiDirectTargetKey = (target: AiDirectTarget) =>
  `${target.provider}\0${target.baseUrl}\0${target.modelId}`;

export const AI_GENERATION_MAX_OUTPUT_TOKENS = 4096;

export const createAiGenerationResultBoundary = (): AiGenerationResultBoundary => {
  const token = crypto.randomUUID().replaceAll("-", "");
  return {
    start: `<edgeever-result-${token}>`,
    end: `</edgeever-result-${token}>`,
  };
};

/** Extract the request-specific payload, then remove only a whole-response Markdown wrapper. */
export const normalizeAiGenerationText = (
  value: string,
  resultBoundary?: AiGenerationResultBoundary,
) => {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  let result = normalized;

  if (resultBoundary) {
    const startIndex = normalized.indexOf(resultBoundary.start);
    const contentStart = startIndex + resultBoundary.start.length;
    const endIndex = startIndex >= 0
      ? normalized.indexOf(resultBoundary.end, contentStart)
      : -1;

    if (startIndex >= 0 && endIndex >= contentStart) {
      result = normalized.slice(contentStart, endIndex).trim();
    } else {
      result = normalized
        .replaceAll(resultBoundary.start, "")
        .replaceAll(resultBoundary.end, "")
        .trim();
    }
  }

  const fencedMarkdown = /^```(?:markdown|md)[ \t]*\n([\s\S]*?)\n```[ \t]*$/i.exec(result);
  return fencedMarkdown ? fencedMarkdown[1].trim() : result;
};

/** Incrementally remove the result boundary while preserving a safe full-response fallback. */
export const createAiGenerationStreamNormalizer = (resultBoundary: AiGenerationResultBoundary) => {
  let pending = "";
  let boundaryStarted = false;
  let boundaryFinished = false;
  let openingLineRemoved = false;
  let wrapperResolved = false;
  let fencedMarkdown = false;

  const removeOpeningLine = () => {
    if (openingLineRemoved) return true;
    const openingLine = /^[ \t]*(?:\r\n|\r|\n)/.exec(pending);
    if (openingLine) {
      pending = pending.slice(openingLine[0].length);
      openingLineRemoved = true;
      return true;
    }
    if (/^[ \t]*\r?$/.test(pending)) return false;
    openingLineRemoved = true;
    return true;
  };

  const resolveMarkdownWrapper = (finishing = false) => {
    if (wrapperResolved) return true;
    const wrapper = /^```(?:markdown|md)[ \t]*(?:\r\n|\r|\n)/i.exec(pending);
    if (wrapper) {
      pending = pending.slice(wrapper[0].length);
      fencedMarkdown = true;
      wrapperResolved = true;
      return true;
    }
    if (!finishing && !/(?:\r\n|\r|\n)/.test(pending)) return false;
    wrapperResolved = true;
    return true;
  };

  const stripClosingWrapper = (value: string) => fencedMarkdown
    ? value.replace(/(?:\r\n|\r|\n)```[ \t]*(?:\r\n|\r|\n)?$/, "")
    : value;

  return {
    push(value: string) {
      if (boundaryFinished || !value) return "";
      pending += value;

      if (!boundaryStarted) {
        const startIndex = pending.indexOf(resultBoundary.start);
        if (startIndex < 0) return "";
        pending = pending.slice(startIndex + resultBoundary.start.length);
        boundaryStarted = true;
      }

      if (!removeOpeningLine()) return "";
      if (!resolveMarkdownWrapper()) return "";
      const endIndex = pending.indexOf(resultBoundary.end);
      if (endIndex >= 0) {
        const output = stripClosingWrapper(pending.slice(0, endIndex))
          .replace(/[ \t]*(?:\r\n|\r|\n)?$/, "");
        pending = "";
        boundaryFinished = true;
        return output;
      }

      const retainedLength = resultBoundary.end.length;
      if (pending.length <= retainedLength) return "";
      const output = pending.slice(0, -retainedLength);
      pending = pending.slice(-retainedLength);
      return output;
    },
    finish() {
      if (boundaryFinished) return "";
      if (!boundaryStarted) return normalizeAiGenerationText(pending, resultBoundary);
      removeOpeningLine();
      resolveMarkdownWrapper(true);
      return stripClosingWrapper(pending.replaceAll(resultBoundary.end, "")).trimEnd();
    },
  };
};

export const redactAiProviderError = (value: string) =>
  value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/x-api-key["'\s:=]+[^\s"']+/gi, "x-api-key [redacted]")
    .replace(/x-goog-api-key["'\s:=]+[^\s"']+/gi, "x-goog-api-key [redacted]")
    .slice(0, 1000);

export type AiDirectProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

const decodeBase64Text = (base64Data: string) => {
  const binary = atob(base64Data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const userTextParts = (prompt: string, attachments: AiAttachmentInput[] = []) => {
  const parts = [prompt];
  for (const attachment of attachments) {
    if (attachment.mediaType.startsWith("text/") || attachment.mediaType === "application/json") {
      parts.push(`Attached file (${attachment.filename}):\n${decodeBase64Text(attachment.base64Data)}`);
      continue;
    }
    if (!attachment.mediaType.startsWith("image/")) {
      parts.push(`Attached file (${attachment.filename}, ${attachment.mediaType}) is included as binary data.`);
    }
  }
  return parts.join("\n\n");
};

export const buildAiDirectProviderRequest = (
  prepared: AiPreparedGeneration,
  attachments: AiAttachmentInput[] = [],
): AiDirectProviderRequest => {
  const baseUrl = prepared.baseUrl.replace(/\/+$/, "");
  const prompt = userTextParts(prepared.prompt, attachments);
  const images = attachments.filter((attachment) => attachment.mediaType.startsWith("image/"));

  if (prepared.provider === "anthropic") {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    for (const image of images) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.base64Data },
      });
    }
    return {
      url: `${baseUrl}/messages`,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-api-key": prepared.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: prepared.modelId,
        // Anthropic requires max_tokens; instances never send null for it, keep a safe default.
        max_tokens: prepared.maxOutputTokens ?? AI_GENERATION_MAX_OUTPUT_TOKENS,
        stream: true,
        system: prepared.system,
        messages: [{ role: "user", content }],
      }),
    };
  }

  if (prepared.provider === "google") {
    const modelId = prepared.modelId.replace(/^models\//, "");
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    for (const image of images) {
      parts.push({ inline_data: { mime_type: image.mediaType, data: image.base64Data } });
    }
    return {
      url: `${baseUrl}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-goog-api-key": prepared.apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: prepared.system }] },
        contents: [{ role: "user", parts }],
        ...(prepared.maxOutputTokens === null ? {} : { generationConfig: { maxOutputTokens: prepared.maxOutputTokens } }),
      }),
    };
  }

  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const image of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mediaType};base64,${image.base64Data}` },
    });
  }
  for (const attachment of attachments) {
    if (attachment.mediaType === "application/pdf") {
      content.push({
        type: "file",
        file: {
          filename: attachment.filename,
          file_data: `data:${attachment.mediaType};base64,${attachment.base64Data}`,
        },
      });
    }
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${prepared.apiKey}`,
    },
    body: JSON.stringify({
      model: prepared.modelId,
      ...(prepared.maxOutputTokens === null ? {} : { max_tokens: prepared.maxOutputTokens }),
      stream: true,
      messages: [
        { role: "system", content: prepared.system },
        { role: "user", content: content.length === 1 ? prompt : content },
      ],
    }),
  };
};

export const extractAiDirectStreamDelta = (provider: AiProvider, payload: unknown) => {
  if (!payload || typeof payload !== "object") return { text: "", finishReason: undefined, inputTokens: undefined, outputTokens: undefined };
  const record = payload as Record<string, unknown>;

  if (provider === "anthropic") {
    const delta = record.delta && typeof record.delta === "object" ? record.delta as Record<string, unknown> : null;
    const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : null;
    return {
      text: typeof delta?.text === "string" ? delta.text : "",
      finishReason: typeof record.stop_reason === "string" ? record.stop_reason : undefined,
      inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
    };
  }

  if (provider === "google") {
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    const first = candidates[0] && typeof candidates[0] === "object" ? candidates[0] as Record<string, unknown> : null;
    const content = first?.content && typeof first.content === "object" ? first.content as Record<string, unknown> : null;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const text = parts
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""))
      .join("");
    const usage = record.usageMetadata && typeof record.usageMetadata === "object"
      ? record.usageMetadata as Record<string, unknown>
      : null;
    return {
      text,
      finishReason: typeof first?.finishReason === "string" ? first.finishReason : undefined,
      inputTokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : undefined,
      outputTokens: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined,
    };
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
  const delta = first?.delta && typeof first.delta === "object" ? first.delta as Record<string, unknown> : null;
  const message = first?.message && typeof first.message === "object" ? first.message as Record<string, unknown> : null;
  const usage = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : null;
  const text = typeof delta?.content === "string"
    ? delta.content
    : typeof message?.content === "string"
      ? message.content
      : "";
  return {
    text,
    finishReason: typeof first?.finish_reason === "string" ? first.finish_reason : undefined,
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined,
  };
};
