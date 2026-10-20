import type {
  CompanionEvent,
  CompanionModelContentPart,
  CompanionPreparedMessage,
  CompanionPreparedTurn,
  CompanionQuestion,
  CompanionTodo,
  CompanionToolCall,
  CompanionToolExecuteResult,
  CompanionTurn,
  CompanionTurnCompleteInput,
} from "@edgeever/shared";
import type { ModelMessage } from "ai";
import { companionFailureDiagnostics, sealCompanionProcess } from "@edgeever/shared";
import { throwIfAborted } from "./abort-signal";
import { createClientAiModel } from "./ai-model";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;

const asString = (value: unknown) => typeof value === "string" ? value : null;

const contentPart = (value: unknown): CompanionModelContentPart | null => {
  const part = asRecord(value);
  if (!part || Array.isArray(value)) return null;
  if (part.type === "text" && typeof part.text === "string") return { type: "text", text: part.text };
  if (part.type === "image" && typeof part.image === "string" && typeof part.mediaType === "string") {
    return { type: "image", image: part.image, mediaType: part.mediaType };
  }
  if (part.type === "file" && typeof part.data === "string" && typeof part.mediaType === "string"
    && (part.filename === undefined || typeof part.filename === "string")) {
    return {
      type: "file", data: part.data, mediaType: part.mediaType,
      ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
    };
  }
  return null;
};

const messageContent = (role: string, content: unknown): CompanionPreparedMessage["content"] | null => {
  if (typeof content === "string") return content;
  if (role !== "user" || !Array.isArray(content) || content.length === 0) return null;
  const parts: CompanionModelContentPart[] = [];
  for (const item of content) {
    const part = contentPart(item);
    if (!part) return null;
    parts.push(part);
  }
  return parts;
};

export const parsePreparedCompanion = (value: unknown): CompanionPreparedTurn | null => {
  const record = asRecord(value);
  const turn = asRecord(record?.turn);
  if (
    !record
    || !turn
    || (record.provider !== "openai-compatible" && record.provider !== "anthropic" && record.provider !== "google")
    || typeof record.baseUrl !== "string"
    || typeof record.apiKey !== "string"
    || typeof record.modelId !== "string"
    || typeof record.instructions !== "string"
    || typeof turn.id !== "string"
    || !Array.isArray(record.messages)
    || !Array.isArray(record.tools)
    || typeof record.maxSteps !== "number"
    || typeof record.maxOutputTokens !== "number"
  ) {
    return null;
  }
  const messages: CompanionPreparedMessage[] = [];
  for (const item of record.messages) {
    const message = asRecord(item);
    const content = message && (message.role === "user" || message.role === "assistant")
      ? messageContent(message.role, message.content)
      : null;
    if (!message || (message.role !== "user" && message.role !== "assistant") || content === null) return null;
    messages.push({ role: message.role, content });
  }
  const tools = record.tools.flatMap((item) => {
    const tool = asRecord(item);
    const inputSchema = asRecord(tool?.inputSchema);
    if (!tool || typeof tool.name !== "string" || typeof tool.description !== "string" || !inputSchema) return [];
    return [{ name: tool.name, description: tool.description, inputSchema }];
  });
  return {
    turn: turn as unknown as CompanionTurn,
    provider: record.provider,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    modelId: record.modelId,
    instructions: record.instructions,
    messages,
    tools,
    maxSteps: record.maxSteps,
    maxOutputTokens: record.maxOutputTokens,
  };
};

export const companionDirectFailureCode = (error: unknown): string => {
  const record = asRecord(error);
  const status = typeof record?.statusCode === "number" ? record.statusCode
    : typeof record?.status === "number" ? record.status : undefined;
  const code = asString(record?.code);
  if (code === "companion_context_changed" || code === "ai_not_configured" || code === "ai_credentials_rejected") return code;
  if (status === 401 || status === 403) return "ai_credentials_rejected";
  if (status === 402) return "ai_provider_payment_required";
  if (status === 429) return "ai_provider_rate_limited";
  if (status === 400) return "ai_provider_request_rejected";
  return "companion_generation_failed";
};

const usageFrom = (value: unknown): { inputTokens?: number; outputTokens?: number } => {
  const record = asRecord(value);
  const inputTokens = typeof record?.inputTokens === "number" ? record.inputTokens
    : typeof record?.promptTokens === "number" ? record.promptTokens : undefined;
  const outputTokens = typeof record?.outputTokens === "number" ? record.outputTokens
    : typeof record?.completionTokens === "number" ? record.completionTokens : undefined;
  return { inputTokens, outputTokens };
};

export const streamDirectCompanion = async (
  prepared: CompanionPreparedTurn,
  options: {
    fetch: typeof fetch;
    signal?: AbortSignal;
    onEvent: (event: CompanionEvent) => void;
    executeTool: (body: {
      name: string;
      input: Record<string, unknown>;
      response: string;
      process: string;
    }) => Promise<CompanionToolExecuteResult>;
    checkpoint: (body: { response: string; process: string }) => Promise<void>;
    complete: (body: CompanionTurnCompleteInput) => Promise<{ turn: CompanionTurn }>;
  },
) => {
  const { streamText, isStepCount, jsonSchema, tool } = await import("ai");
  let response = prepared.turn.response ?? "";
  let process = prepared.turn.process ?? "";
  let persisted = response.length;
  let tools: CompanionToolCall[] = prepared.turn.tools ?? [];
  let todos: CompanionTodo[] = prepared.turn.todos ?? [];
  let questions: CompanionQuestion[] = prepared.turn.questions ?? [];
  const pause = { ask: false };

  options.onEvent({ type: "start", id: prepared.turn.id });
  if (process) options.onEvent({ type: "process", text: process });
  if (tools.length || todos.length) options.onEvent({ type: "tools", tools, todos, questions });

  const sealProcess = () => {
    if (!response.trim()) return;
    ({ process, response } = sealCompanionProcess(process, response));
    persisted = 0;
    options.onEvent({ type: "process", text: process });
  };

  const finish = async (status: CompanionTurnCompleteInput["status"], usage?: { inputTokens?: number; outputTokens?: number }, error?: unknown) => {
    try {
      const completed = await options.complete({
        response, process, status, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
      });
      if (status === "failed" && error) options.onEvent({ type: "error", code: companionDirectFailureCode(error), diagnostics: companionFailureDiagnostics(error) });
      else options.onEvent({ type: "done", turn: completed.turn });
    } catch (completeError) {
      options.onEvent({ type: "error", code: companionDirectFailureCode(completeError), diagnostics: companionFailureDiagnostics(completeError) });
    }
  };

  try {
    const agentTools = Object.fromEntries(prepared.tools.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.inputSchema),
        execute: async (input: unknown) => {
          sealProcess();
          const pending: CompanionToolCall = {
            id: crypto.randomUUID(), name: definition.name, status: "running", effects: [],
          };
          tools = [...tools, pending];
          options.onEvent({ type: "tools", tools, todos, questions });
          const result = await options.executeTool({
            name: definition.name,
            input: (input && typeof input === "object" ? input : {}) as Record<string, unknown>,
            response,
            process,
          });
          tools = result.tools;
          todos = result.todos;
          questions = result.questions;
          if (result.pause) pause.ask = true;
          options.onEvent({ type: "tools", tools, todos, questions });
          return result.result;
        },
      }),
    ]));

    const generation = {
      model: createClientAiModel({
        provider: prepared.provider,
        baseUrl: prepared.baseUrl,
        apiKey: prepared.apiKey,
        modelId: prepared.modelId,
        fetch: options.fetch,
      }),
      instructions: prepared.instructions,
      tools: agentTools,
      stopWhen: [isStepCount(prepared.maxSteps), () => pause.ask],
      maxOutputTokens: prepared.maxOutputTokens,
      maxRetries: 0,
      // fullStream errors are handled below; SDK logging can expose request data.
      onError: () => {},
    };
    const messages: ModelMessage[] = prepared.messages.map((message) => {
      if (message.role === "assistant") {
        if (typeof message.content !== "string") throw new Error("Assistant content must be a string.");
        return { role: "assistant", content: message.content };
      }
      if (typeof message.content === "string") return { role: "user", content: message.content };
      return {
        role: "user",
        content: message.content.map((part) => {
          if (part.type === "text") return { type: "text" as const, text: part.text };
          if (part.type === "image") return { type: "image" as const, image: part.image, mediaType: part.mediaType };
          return { type: "file" as const, data: part.data, mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}) };
        }),
      };
    });
    const result = streamText({
      ...generation,
      messages,
      abortSignal: options.signal,
    });
    for await (const part of result.fullStream) {
      throwIfAborted(options.signal);
      if (part.type === "error") throw part.error;
      if (part.type !== "text-delta") continue;
      const delta = typeof part.text === "string" ? part.text : "";
      if (!delta) continue;
      response += delta;
      if (response.length > 16000) throw new Error("Response limit exceeded.");
      options.onEvent({ type: "text-delta", text: delta });
      if (response.length - persisted >= 300) {
        await options.checkpoint({ response, process });
        persisted = response.length;
      }
    }
    if (!response.trim() && !tools.some(item => item.status === "done") && !todos.length && !questions.length) {
      throw new Error("No text returned.");
    }
    const usage = usageFrom(await result.totalUsage);
    await finish(pause.ask || questions.length ? "interrupted" : "completed", usage);
  } catch (error) {
    if (options.signal?.aborted) {
      await finish("interrupted");
      return;
    }
    await finish("failed", undefined, error);
  }
};
