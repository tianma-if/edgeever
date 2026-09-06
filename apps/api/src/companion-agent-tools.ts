import { jsonSchema, tool, type ToolSet } from "ai";
import type { CompanionSource, CompanionTurnInput, MemoDetail, MemoSummary } from "@edgeever/shared";
import type { DatabaseAdapter } from "./storage-contract";
import type { AppContext } from "./api-context";
import type { CompanionScope } from "./companion-service";
import { COMPANION_MCP_TOOLS, validateCompanionTool } from "./companion-tool-catalog";
import { companionWorkspaceCursor, proposeCompanionToolAction } from "./companion-tool-actions";
import { executeWorkspaceTool } from "./mcp-tool-executor";

export function createCompanionTools(args: { db: DatabaseAdapter; scope: CompanionScope; input: CompanionTurnInput;
  context?: AppContext; signal: AbortSignal; assertActive: () => Promise<void>; sources: CompanionSource[] }): ToolSet {
  if (!args.input.allowNotes || !args.context) return {};
  let calls = 0;
  let noteRemaining = 12000;
  let metadataRemaining = 12000;
  let cursor: number | undefined;
  const inspected = new Map<string, number>();
  const takeNoteText = (text: string, limit: number) => {
    const result = text.slice(0, Math.min(limit, noteRemaining));
    noteRemaining -= result.length;
    return result;
  };
  const remember = (memo: MemoSummary) => {
    const source = { id: memo.id, title: (memo.title ?? "").slice(0, 200), revision: memo.revision };
    const index = args.sources.findIndex(item => item.id === memo.id);
    if (index < 0) args.sources.push(source); else args.sources[index] = source;
    return source;
  };
  return Object.fromEntries(COMPANION_MCP_TOOLS.map(definition => {
    const readOnly = definition.annotations.readOnlyHint;
    return [definition.name, tool({
      description: `${definition.description}${readOnly ? "" : " This only proposes changes; the user must confirm the card. Supply a short _reason."}`,
      inputSchema: jsonSchema<Record<string, unknown>>((readOnly ? definition.inputSchema : {
        ...definition.inputSchema, properties: { ...definition.inputSchema.properties, _reason: { type: "string", minLength: 1, maxLength: 400 } },
        required: [...(definition.inputSchema.required ?? []), "_reason"],
      }) as Parameters<typeof jsonSchema>[0]),
      execute: async input => {
        args.signal.throwIfAborted();
        await args.assertActive();
        if (++calls > 16) throw new Error("Tool call limit reached.");
        const { _reason, ...parameters } = input;
        const { args: parameters_ } = validateCompanionTool(definition.name, parameters);
        const current = await companionWorkspaceCursor(args.db, args.scope.workspaceId);
        cursor ??= current;
        if (cursor !== current) return { error: "Notes changed during this request. Start a fresh request." };
        if (!readOnly && parameters_.dryRun !== true) return proposeCompanionToolAction(args.db, args.scope, args.input.id,
          definition.name, parameters_, typeof _reason === "string" ? _reason : definition.title, cursor, inspected);
        if (definition.name === "get_memo" && inspected.has(String(parameters_.memoId))) {
          // The original full result remains in this run's model messages. Only
          // reuse it after authorization/context/cursor checks, never across runs.
          return { id: parameters_.memoId, revision: inspected.get(String(parameters_.memoId)), alreadyRead: true,
            message: "Use the complete get_memo result already returned in this run." };
        }
        if (definition.name === "search_memos" || definition.name === "list_memos") {
          parameters_.limit = Math.min(Number(parameters_.limit ?? 5), 5);
          if (definition.name === "list_memos") parameters_.includeContent = false;
        }
        const result = await executeWorkspaceTool(args.context!, args.context!.get("auth"), definition.name, parameters_);
        if (current !== await companionWorkspaceCursor(args.db, args.scope.workspaceId)) return { error: "Notes changed during this read. Start a fresh request." };
        if (definition.name === "get_memo") {
          const memo = (result as { memo: MemoDetail }).memo;
          const content = takeNoteText(memo.contentMarkdown, 8000);
          remember(memo);
          if (content.length === memo.contentMarkdown.length) inspected.set(memo.id, memo.revision); else inspected.delete(memo.id);
          return { id: memo.id, title: memo.title, notebookId: memo.notebookId, tags: memo.tags, revision: memo.revision,
            content, truncated: content.length !== memo.contentMarkdown.length };
        }
        if (definition.name === "search_memos" || definition.name === "list_memos") return {
          ...result as object,
          memos: (result as { memos: MemoSummary[] }).memos.map(memo => ({ ...remember(memo), notebookId: memo.notebookId,
            tags: memo.tags, excerpt: takeNoteText(memo.excerpt, 1000) })),
        };
        const serialized = JSON.stringify(result);
        const text = serialized.slice(0, Math.min(8000, metadataRemaining));
        metadataRemaining -= text.length;
        return text.length === serialized.length ? result : { truncated: true, data: text };
      },
    })];
  }));
}
