import { CompanionToolPlanSchema, normalizeTags, type CompanionAction, type CompanionActionNote } from "@edgeever/shared";
import { AppError } from "./app-error";
import type { AppContext } from "./api-context";
import type { CompanionScope } from "./companion-service";
import type { DatabaseAdapter, DatabaseQueryResult, PreparedStatementAdapter } from "./storage-contract";
import { getMemoDetail } from "./memo-service";
import { getCompanionAction } from "./companion-actions";
import { validateCompanionTool } from "./companion-tool-catalog";
import { executeWorkspaceTool } from "./mcp-tool-executor";
import { getNotebook } from "./notebook-service";
import { previewTagRename } from "./tag-service";

export const workspaceCursorSql = "SELECT COALESCE(MAX(id), 0) FROM mobile_sync_changes WHERE workspace_id = ?";
export const companionWorkspaceCursor = async (db: DatabaseAdapter, workspaceId: string) =>
  Number(await db.prepare(workspaceCursorSql).bind(workspaceId).first<number>("COALESCE(MAX(id), 0)"));
const stale = () => new AppError("companion_action_conflict", "Notes changed or the suggestion is no longer eligible. Request a fresh suggestion.", 409);

export async function proposeCompanionToolAction(db: DatabaseAdapter, scope: CompanionScope, turnId: string,
  toolName: string, input: Record<string, unknown>, reason: string, cursor: number, inspected: ReadonlyMap<string, number>, evidenceIds: string[] = []) {
  const { definition, args } = validateCompanionTool(toolName, input);
  if (definition.annotations.readOnlyHint || args.dryRun === true) throw new AppError("invalid_params", "This call does not need approval.", 400);
  const plan = CompanionToolPlanSchema.parse({ kind: "tool", toolName, arguments: args, reason });
  const ids = typeof args.memoId === "string" ? [args.memoId] : Array.isArray(args.memoIds) ? args.memoIds as string[] : [];
  if (ids.length > 25 || new Set(ids).size !== ids.length) throw new AppError("invalid_params", "Use at most 25 distinct notes per operation.", 400);
  const notes: CompanionActionNote[] = [];
  for (const id of new Set([...ids, ...evidenceIds])) {
    const memo = await getMemoDetail(db, scope.workspaceId, id, toolName === "restore_memos");
    if (!memo) throw stale();
    if ((toolName === "update_memo" || toolName === "merge_memos") && inspected.get(id) !== memo.revision) {
      throw new AppError("companion_action_unread", "Read the complete source notes before changing their content or merging them.", 400);
    }
    notes.push({ id, title: memo.title ?? "", revision: memo.revision, notebookId: memo.notebookId,
      updatedAt: memo.updatedAt, tags: memo.tags, excerpt: memo.excerpt.slice(0, 300) });
  }
  if (toolName === "add_tags_to_memos" && notes.some(note => new Set([...note.tags, ...normalizeTags(args.tags as string[])]).size > 24)) {
    throw new AppError("companion_action_tag_limit", "Adding these tags would exceed the limit; existing tags will not be removed.", 400);
  }
  const notebooks = [];
  for (const id of new Set([args.notebookId, args.parentId, ...notes.map(note => note.notebookId)].filter((id): id is string => typeof id === "string"))) {
    const notebook = await getNotebook(db, scope.workspaceId, id);
    if (!notebook && (id === args.notebookId || id === args.parentId)) throw stale();
    if (notebook) notebooks.push({ id, name: notebook.name });
  }
  const tagPreview = toolName === "rename_tag" || toolName === "delete_tag"
    ? await previewTagRename(db, scope.workspaceId, String(args.from ?? args.tag), toolName === "rename_tag" ? String(args.to) : null) : null;
  if (toolName === "update_memo") plan.arguments.expectedRevision = notes[0].revision;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db.prepare(`INSERT INTO companion_actions(id, turn_id, workspace_id, owner_id, payload_json, created_at, expires_at, workspace_cursor)
    SELECT ?, t.id, t.workspace_id, t.owner_id, ?, ?, ?, ? FROM companion_turns t
    JOIN companion_state s ON s.workspace_id = t.workspace_id AND s.owner_id = t.owner_id
    WHERE t.id = ? AND t.workspace_id = ? AND t.owner_id = ? AND t.status = 'running' AND t.allow_notes = 1
      AND t.memory_revision = s.memory_revision AND t.expires_at > ?
      AND (${workspaceCursorSql}) = ? AND (SELECT COUNT(*) FROM companion_actions WHERE turn_id = t.id) < 3`)
    .bind(id, JSON.stringify({ plan, notes, preview: { notebooks, affectedCount: tagPreview?.updated ?? notes.length } }), now, new Date(Date.now() + 86400000).toISOString(), cursor,
      turnId, scope.workspaceId, scope.ownerId, now, scope.workspaceId, cursor).run();
  if (Number(result.meta.changes) !== 1) throw stale();
  return { proposalId: id, status: "awaiting_user_confirmation", message: "Nothing was changed. Review and confirm the exact operation in its card." };
}

// The existing services remain responsible for all business rules. This adapter
// brackets their SQL batches with an exclusive action claim and cursor checks.
// Multi-batch tools are NOT advertised as one atomic transaction: a crash or a
// later conflict leaves an uncertain receipt and is never automatically replayed.
export async function applyCompanionToolAction(context: AppContext, scope: CompanionScope, action: CompanionAction) {
  if (action.plan.kind !== "tool") throw stale();
  if (context.get("auth").workspaceId !== scope.workspaceId || context.get("auth").actorId !== scope.ownerId) throw stale();
  const { definition, args } = validateCompanionTool(action.plan.toolName, action.plan.arguments);
  if (definition.annotations.readOnlyHint || args.dryRun === true) throw stale();
  const db = context.env.storage.db;
  const token = crypto.randomUUID();
  let wrote = false;
  const underlying = new WeakMap<PreparedStatementAdapter, PreparedStatementAdapter>();
  const guardedBatch = async <T>(statements: PreparedStatementAdapter[]): Promise<DatabaseQueryResult<T>[]> => {
    const now = new Date().toISOString();
    // One JSON binding avoids exceeding D1's statement parameter budget for a
    // 25-note operation. JSON1 is already used by the shared note services.
    const noteChecks = wrote ? "" : `AND NOT EXISTS (SELECT 1 FROM json_each(?) snapshot WHERE NOT EXISTS (
      SELECT 1 FROM memos m JOIN memo_contents c ON c.memo_id = m.id
      WHERE m.id = json_extract(snapshot.value, '$.id') AND m.workspace_id = a.workspace_id
        AND c.revision = json_extract(snapshot.value, '$.revision')
        AND m.updated_at = json_extract(snapshot.value, '$.updatedAt')
        AND m.notebook_id = json_extract(snapshot.value, '$.notebookId')
        AND json(m.tags_json) = json(json_extract(snapshot.value, '$.tags'))))`;
    const guard = db.prepare(`INSERT INTO companion_action_checks(id, valid) VALUES (?, CASE WHEN EXISTS (
      SELECT 1 FROM companion_actions a JOIN companion_turns t ON t.id = a.turn_id
      JOIN companion_state s ON s.workspace_id = a.workspace_id AND s.owner_id = a.owner_id
      WHERE a.id = ? AND a.workspace_id = ? AND a.owner_id = ? AND a.status = 'pending'
        AND ${wrote ? "a.execution_token = ?" : "a.execution_token IS NULL"}
        AND a.expires_at > ? AND t.status = 'completed' AND t.allow_notes = 1 AND t.memory_revision = s.memory_revision
        AND a.workspace_cursor = (${workspaceCursorSql})
        ${noteChecks}
      ) THEN 1 ELSE 0 END)`).bind(action.id, action.id, scope.workspaceId, scope.ownerId,
        ...(wrote ? [token] : []), now, scope.workspaceId,
        ...(wrote ? [] : [JSON.stringify(action.notes)]));
    const result = await db.batch<T>([guard,
      db.prepare("UPDATE companion_actions SET execution_token = ? WHERE id = ?").bind(token, action.id),
      ...statements.map(statement => underlying.get(statement) ?? statement),
      db.prepare(`UPDATE companion_actions SET workspace_cursor = (${workspaceCursorSql}) WHERE id = ?`).bind(scope.workspaceId, action.id),
      db.prepare("DELETE FROM companion_action_checks WHERE id = ?").bind(action.id),
    ]);
    wrote = true;
    return result.slice(2, 2 + statements.length);
  };
  const wrap = (statement: PreparedStatementAdapter, readOnly: boolean): PreparedStatementAdapter => {
    const wrapped: PreparedStatementAdapter = {
      bind: (...values) => wrap(statement.bind(...values), readOnly),
      first: ((column?: string) => {
        if (!readOnly) throw new AppError("companion_tool_unavailable", "This write form is not supported by confirmed execution.", 400);
        return column === undefined ? statement.first() : statement.first(column);
      }) as PreparedStatementAdapter["first"],
      all: async <T>() => readOnly ? statement.all<T>() : (await guardedBatch<T>([statement]))[0],
      run: async <T>() => (await guardedBatch<T>([statement]))[0],
    };
    underlying.set(wrapped, statement);
    return wrapped;
  };
  // SQL is authored by the reviewed services, never supplied by the model.
  // Notebook ancestry uses a read-only recursive CTE.
  const guarded: DatabaseAdapter = { prepare: query => wrap(db.prepare(query), /^\s*(?:SELECT|WITH RECURSIVE)\b/i.test(query)), batch: guardedBatch };
  const toolContext: AppContext = Object.create(context, { env: { value: {
    ...context.env, storage: { ...context.env.storage, db: guarded },
  } }, get: { value: (key: string) => key === "auth" ? { ...context.get("auth"), actorType: "agent" } : context.get(key as "auth") } });
  try {
    const result = await executeWorkspaceTool(toolContext, { ...context.get("auth"), actorType: "agent" }, action.plan.toolName, args);
    const memo = (result as { memo?: { id?: string; notebookId?: string } } | null)?.memo;
    // Keep a compact receipt, not a second full copy of generated note bodies.
    const receipt = memo ? { memoId: memo.id, notebookId: memo.notebookId } : result;
    await guardedBatch([db.prepare("UPDATE companion_actions SET status = 'applied', result_memo_id = ?, result_notebook_id = ?, result_json = ? WHERE id = ?")
      .bind(memo?.id ?? null, memo?.notebookId ?? null, JSON.stringify(receipt ?? null), action.id)]);
    return (await getCompanionAction(db, scope, action.id))!;
  } catch (error) {
    const recovered = await getCompanionAction(db, scope, action.id);
    if (recovered?.status === "applied") return recovered;
    if (recovered?.status === "uncertain") return recovered;
    if (wrote) throw new AppError("companion_action_uncertain", "Some changes may have applied but the receipt is unavailable. Inspect your notes; do not repeat the operation.", 409);
    if (error instanceof AppError) throw error;
    if (/constraint/i.test(String(error))) throw stale();
    throw new AppError("companion_failed", "The operation could not be completed. Check your notes before trying again.", 503);
  }
}
