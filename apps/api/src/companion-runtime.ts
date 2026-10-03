import { isStepCount, jsonSchema, tool, ToolLoopAgent, type LanguageModel, type ModelMessage } from "ai";
import type {
  AiProvider, CompanionAnswer, CompanionMemory, CompanionModelContentPart, CompanionPreparedMessage,
  CompanionSource, CompanionTurnInput,
} from "@edgeever/shared";
import type { DatabaseAdapter } from "./storage-contract";
import type { CompanionScope, TurnRow } from "./companion-service";
import type { AppContext } from "./api-context";
import { companionToolDefinitions, createCompanionTools } from "./companion-agent-tools";
import {
  companionAgentInstructions,
  companionExecutionReceipts,
  companionModelMessages,
  COMPANION_MAX_OUTPUT_TOKENS,
  COMPANION_MAX_STEPS,
  type CompanionRunState,
} from "./companion-prepare";

export {
  COMPANION_IDENTITY_VERSION,
  COMPANION_INSTRUCTIONS,
  COMPANION_MAX_OUTPUT_TOKENS,
  COMPANION_MAX_STEPS,
  companionAgentInstructions,
  companionExecutionReceipts,
  companionMessages,
  companionResumeMessages,
  companionTurnInstructions,
  companionUserContent,
  prepareCompanionTurn,
  selectCompanionMemories,
  type CompanionRunState,
} from "./companion-prepare";

const toModelMessages = (messages: CompanionPreparedMessage[]): ModelMessage[] => messages.map((message): ModelMessage => {
  if (message.role === "assistant") {
    if (typeof message.content !== "string") throw new Error("Assistant content must be a string.");
    return { role: "assistant", content: message.content };
  }
  if (typeof message.content === "string") return { role: "user", content: message.content };
  return {
    role: "user",
    content: message.content.map((part: CompanionModelContentPart) => {
      if (part.type === "text") return { type: "text" as const, text: part.text };
      if (part.type === "image") return { type: "image" as const, image: part.image, mediaType: part.mediaType };
      return { type: "file" as const, data: part.data, mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}) };
    }),
  };
});

export const streamCompanion = async (args: {
  db: DatabaseAdapter; scope: CompanionScope; input: CompanionTurnInput; model: LanguageModel;
  memories: CompanionMemory[]; history: TurnRow[]; revision: number; signal: AbortSignal;
  sources: CompanionSource[]; assertActive: () => Promise<void>; provider?: AiProvider;
  context?: AppContext; run?: CompanionRunState; resume?: { response?: string; answers?: CompanionAnswer[] };
}) => {
  const run = args.run ?? { tools: [], todos: [], questions: [], pause: { ask: false } };
  const executors = createCompanionTools({ ...args, run });
  const tools = Object.fromEntries(
    companionToolDefinitions(args.input).map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema<Record<string, unknown>>(
          definition.inputSchema as Parameters<typeof jsonSchema>[0],
        ),
        execute: (input: Record<string, unknown>) => {
          const selected = executors[definition.name];
          if (!selected) throw new Error(`Missing companion tool: ${definition.name}`);
          return selected.execute(input);
        },
      }),
    ]),
  );
  const receipts = args.input.allowNotes ? await companionExecutionReceipts(args.db, args.scope, args.input, args.revision, run.tools) : [];
  const agent = new ToolLoopAgent({
    model: args.model,
    instructions: companionAgentInstructions(args.input, args.memories, receipts, args.history, args.revision),
    tools,
    stopWhen: [isStepCount(COMPANION_MAX_STEPS), () => run.pause.ask],
    maxOutputTokens: COMPANION_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
  });
  const messages = await companionModelMessages({
    db: args.db, scope: args.scope, input: args.input, history: args.history, revision: args.revision,
    resume: args.resume, provider: args.provider ?? "openai-compatible", turnId: args.input.id,
  });
  return agent.stream({ messages: toModelMessages(messages), abortSignal: args.signal });
};
