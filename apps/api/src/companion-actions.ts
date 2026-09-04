import { CompanionActionPlanSchema, normalizeTags, type CompanionAction, type CompanionActionNote,
  type CompanionActionPlan } from "@edgeever/shared";
import { AppError } from "./app-error";
import { getMemoDetail, mergeMemosRecord, updateMemoRecord, type MemoMutationCommit } from "./memo-service";
import type { CompanionScope } from "./companion-service";
import type { DatabaseAdapter } from "./storage-contract";
import type { AppContext } from "./api-context";

type ActionRow = {
  id: string; turn_id: string; payload_json: string; status: "pending" | "applied" | "dismissed";
  result_memo_id: string | null; created_at: string; expires_at: string; eligible: number;
  execution_token: string | null; result_notebook_id: string | null; result_json: string | null;
};
const scopeBindings = (scope: CompanionScope) => [scope.workspaceId, scope.ownerId];
const query = `SELECT a.*, (t.status = 'completed' AND t.allow_notes = 1 AND t.memory_revision = s.memory_revision
    AND (a.workspace_cursor IS NULL OR a.workspace_cursor = (SELECT COALESCE(MAX(id), 0) FROM mobile_sync_changes WHERE workspace_id = a.workspace_id))) AS eligible
  FROM companion_actions a JOIN companion_turns t ON t.id = a.turn_id
  JOIN companion_state s ON s.workspace_id = a.workspace_id AND s.owner_id = a.owner_id
  WHERE a.workspace_id = ? AND a.owner_id = ?`;
const mapAction = (row: ActionRow): CompanionAction => ({
  id: row.id, turnId: row.turn_id, ...JSON.parse(row.payload_json) as Pick<CompanionAction, "plan" | "notes" | "preview">,
  status: row.status === "pending" && row.execution_token ? "uncertain"
    : row.status === "pending" && (!row.eligible || row.expires_at <= new Date().toISOString()) ? "unavailable" : row.status,
  resultMemoId: row.result_memo_id, createdAt: row.created_at,
  resultNotebookId: row.result_notebook_id, result: row.result_json ? JSON.parse(row.result_json) : undefined,
});
export const listCompanionActions = async (db: DatabaseAdapter, scope: CompanionScope, limit = 300) =>
  (await db.prepare(`${query} ORDER BY a.created_at DESC, a.id LIMIT ?`).bind(...scopeBindings(scope), limit).all<ActionRow>()).results.map(mapAction);
export const getCompanionAction = async (db: DatabaseAdapter, scope: CompanionScope, id: string) => {
  const row = await db.prepare(`${query} AND a.id = ?`).bind(...scopeBindings(scope), id).first<ActionRow>();
  return row ? mapAction(row) : null;
};
const conflict = () => new AppError("companion_action_conflict", "This suggestion is no longer current. Request a new suggestion before applying it.", 409);

export const proposeCompanionAction = async (db: DatabaseAdapter, scope: CompanionScope, turnId: string,
  input: CompanionActionPlan, inspected: ReadonlyMap<string, number>) => {
  const plan = CompanionActionPlanSchema.parse(input);
  if (plan.kind === "tool") throw new AppError("invalid_params", "Use the shared tool adapter.", 400);
  const ids = plan.kind === "merge" ? plan.memoIds : [plan.memoId];
  if (new Set(ids).size !== ids.length || ids.some(id => !inspected.has(id))) {
    throw new AppError("companion_action_unread", "Read each distinct source note before proposing an action.", 400);
  }
  const notes: CompanionActionNote[] = [];
  for (const id of ids) {
    const memo = await getMemoDetail(db, scope.workspaceId, id);
    if (!memo || memo.isDeleted || memo.revision !== inspected.get(id)) throw conflict();
    notes.push({ id, title: memo.title ?? "", revision: memo.revision, notebookId: memo.notebookId,
      updatedAt: memo.updatedAt, tags: memo.tags, excerpt: memo.excerpt.slice(0, 300) });
  }
  if (plan.kind === "tag") {
    plan.tags = normalizeTags(plan.tags).filter(tag => tag && !notes[0].tags.includes(tag));
    if (!plan.tags.length) throw new AppError("companion_action_no_change", "The note already has these tags.", 400);
    if (new Set([...notes[0].tags, ...plan.tags]).size > 24) {
      throw new AppError("companion_action_tag_limit", "Adding these tags would exceed the 24-tag limit. Existing tags will not be removed.", 400);
    }
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db.prepare(`INSERT INTO companion_actions(id, turn_id, workspace_id, owner_id, payload_json, created_at, expires_at)
    SELECT ?, t.id, t.workspace_id, t.owner_id, ?, ?, ? FROM companion_turns t
    JOIN companion_state s ON s.workspace_id = t.workspace_id AND s.owner_id = t.owner_id
    WHERE t.id = ? AND t.workspace_id = ? AND t.owner_id = ? AND t.status = 'running' AND t.allow_notes = 1
      AND t.memory_revision = s.memory_revision AND t.expires_at > ?
      AND (SELECT COUNT(*) FROM companion_actions WHERE turn_id = t.id) < 3`)
    .bind(id, JSON.stringify({ plan, notes }), now, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      turnId, ...scopeBindings(scope), now).run();
  if (Number(result.meta.changes) !== 1) throw conflict();
  return { proposalId: id, status: "awaiting_user_confirmation", message: "No notes have been changed. The user must review and confirm the suggestion card." };
};

export const dismissCompanionAction = async (db: DatabaseAdapter, scope: CompanionScope, id: string) => {
  await db.prepare("UPDATE companion_actions SET status = 'dismissed' WHERE id = ? AND workspace_id = ? AND owner_id = ? AND status = 'pending' AND execution_token IS NULL")
    .bind(id, ...scopeBindings(scope)).run();
  const action = await getCompanionAction(db, scope, id);
  if (!action) throw new AppError("not_found", "Suggestion not found.", 404);
  return action;
};

// Snapshot checks and note writes share one batch, including the receipt. This
// covers edits/deletion/dismissal on another device and retries after disconnect.
export const applyCompanionAction = async (db: DatabaseAdapter, scope: CompanionScope, id: string, context?: AppContext) => {
  const action = await getCompanionAction(db, scope, id);
  if (!action) throw new AppError("not_found", "Suggestion not found.", 404);
  if (action.status === "applied") return action;
  if (action.status !== "pending") throw conflict();
  if (action.plan.kind === "tool") {
    if (!context) throw new AppError("companion_tool_unavailable", "An authenticated tool context is required.", 400);
    const { applyCompanionToolAction } = await import("./companion-tool-actions");
    return applyCompanionToolAction(context, scope, action);
  }
  const noteConditions = action.notes.map(() => `EXISTS (SELECT 1 FROM memos m
    JOIN memo_contents c ON c.memo_id = m.id JOIN notebooks n ON n.id = m.notebook_id
    WHERE m.id = ? AND m.workspace_id = ? AND m.is_deleted = 0 AND n.is_deleted = 0
      AND n.workspace_id = m.workspace_id AND c.revision = ? AND m.updated_at = ? AND m.notebook_id = ? AND json(m.tags_json) = json(?))`);
  const commit: MemoMutationCommit = {
    before: [db.prepare(`INSERT INTO companion_action_checks(id, valid) VALUES (?, CASE WHEN
      EXISTS (SELECT 1 FROM companion_actions a JOIN companion_turns t ON t.id = a.turn_id
        JOIN companion_state s ON s.workspace_id = a.workspace_id AND s.owner_id = a.owner_id
        WHERE a.id = ? AND a.workspace_id = ? AND a.owner_id = ? AND a.status = 'pending' AND a.expires_at > ?
          AND t.status = 'completed' AND t.allow_notes = 1 AND t.memory_revision = s.memory_revision)
      AND ${noteConditions.join(" AND ")} THEN 1 ELSE 0 END)`)
      .bind(id, id, ...scopeBindings(scope), new Date().toISOString(), ...action.notes.flatMap(note =>
        [note.id, scope.workspaceId, note.revision, note.updatedAt, note.notebookId, JSON.stringify(note.tags)]))],
    after: memoId => [
      db.prepare("UPDATE companion_actions SET status = 'applied', result_memo_id = ? WHERE id = ? AND workspace_id = ? AND owner_id = ?")
        .bind(memoId, id, ...scopeBindings(scope)),
      db.prepare("DELETE FROM companion_action_checks WHERE id = ?").bind(id),
    ],
  };
  try {
    const actor = { actorType: "user" as const, actorId: scope.ownerId };
    if (action.plan.kind === "merge") {
      await mergeMemosRecord(db, scope.workspaceId, { memoIds: action.plan.memoIds,
        title: action.plan.title, notebookId: action.notes[0].notebookId }, actor, scope.ownerId, commit);
    } else {
      const result = await updateMemoRecord(db, scope.workspaceId, action.plan.memoId, {
        tags: normalizeTags([...action.notes[0].tags, ...action.plan.tags]), expectedRevision: action.notes[0].revision,
      }, actor, scope.ownerId, false, commit);
      if (result.error) throw conflict();
    }
    const completed = await getCompanionAction(db, scope, id);
    if (completed?.status !== "applied") throw conflict();
    return completed;
  } catch (error) {
    const recovered = await getCompanionAction(db, scope, id);
    if (recovered?.status === "applied") return recovered;
    if (error instanceof AppError || /constraint/i.test(String(error))) throw conflict();
    throw error;
  }
};
