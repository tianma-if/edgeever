import type { CompanionMemory, CompanionSource, CompanionTurn, CompanionTurnInput } from "@edgeever/shared";
import { AppError } from "./app-error";
import type { DatabaseAdapter } from "./storage-contract";

export type CompanionScope = { workspaceId: string; ownerId: string };
type MemoryRow = { id: string; content: string; source_turn_id: string | null; version: number; created_at: string; updated_at: string };
export type TurnRow = {
  id: string; thread_id: string; message: string; response: string; status: CompanionTurn["status"];
  sources_json: string; model: string; input_tokens: number | null; output_tokens: number | null;
  created_at: string; memory_revision: number; use_memory: number; allow_notes: number; locale: string;
};
const bindScope = (scope: CompanionScope) => [scope.workspaceId, scope.ownerId];
export const mapCompanionTurn = (row: TurnRow): CompanionTurn => ({
  id: row.id, threadId: row.thread_id, message: row.message, response: row.response,
  status: row.status, sources: JSON.parse(row.sources_json) as CompanionSource[], model: row.model,
  inputTokens: row.input_tokens, outputTokens: row.output_tokens, createdAt: row.created_at,
});
export const ensureCompanionState = async (db: DatabaseAdapter, scope: CompanionScope) => {
  await db.prepare("INSERT OR IGNORE INTO companion_state(workspace_id, owner_id) VALUES (?, ?)").bind(...bindScope(scope)).run();
};
export const companionRevision = async (db: DatabaseAdapter, scope: CompanionScope) => {
  const row = await db.prepare("SELECT memory_revision FROM companion_state WHERE workspace_id = ? AND owner_id = ?")
    .bind(...bindScope(scope)).first<{ memory_revision: number }>();
  return row?.memory_revision ?? 0;
};
export const listCompanionMemories = async (db: DatabaseAdapter, scope: CompanionScope): Promise<CompanionMemory[]> => {
  const rows = await db.prepare("SELECT * FROM companion_memories WHERE workspace_id = ? AND owner_id = ? ORDER BY updated_at DESC, id LIMIT 50")
    .bind(...bindScope(scope)).all<MemoryRow>();
  return rows.results.map(row => ({ id: row.id, content: row.content, sourceTurnId: row.source_turn_id,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }));
};
export const getCompanionTurn = (db: DatabaseAdapter, scope: CompanionScope, id: string) => db.prepare(
  "SELECT * FROM companion_turns WHERE workspace_id = ? AND owner_id = ? AND id = ?",
).bind(...bindScope(scope), id).first<TurnRow>();

export const listCompanionTurns = async (db: DatabaseAdapter, scope: CompanionScope, threadId?: string) => {
  await db.prepare("UPDATE companion_turns SET status = 'interrupted' WHERE workspace_id = ? AND owner_id = ? AND status = 'running' AND expires_at < ?")
    .bind(...bindScope(scope), new Date().toISOString()).run();
  return (await db.prepare(`SELECT * FROM companion_turns WHERE workspace_id = ? AND owner_id = ?
    AND origin = 'chat' ${threadId ? "AND thread_id = ?" : ""} ORDER BY created_at DESC, id DESC LIMIT 100`)
    .bind(...bindScope(scope), ...(threadId ? [threadId] : [])).all<TurnRow>()).results;
};

// Invalidating the context epoch prevents a corrected/forgotten memory from
// leaking back through historical assistant answers or an in-flight result.
const invalidateContext = (db: DatabaseAdapter, scope: CompanionScope, condition?: { sql: string; bindings: unknown[] }) => [
  db.prepare(`UPDATE companion_state SET memory_revision = memory_revision + 1 WHERE workspace_id = ? AND owner_id = ?${condition ? ` AND (${condition.sql})` : ""}`)
    .bind(...bindScope(scope), ...(condition?.bindings ?? [])),
  db.prepare(`UPDATE companion_turns SET status = 'cancelled' WHERE workspace_id = ? AND owner_id = ? AND status = 'running'
    AND memory_revision <> (SELECT memory_revision FROM companion_state WHERE workspace_id = ? AND owner_id = ?)`)
    .bind(...bindScope(scope), ...bindScope(scope)),
];
const memoryVersionCondition = (scope: CompanionScope, id: string, version: number) => ({
  sql: "EXISTS (SELECT 1 FROM companion_memories WHERE workspace_id = ? AND owner_id = ? AND id = ? AND version = ?)",
  bindings: [...bindScope(scope), id, version],
});

export const saveCompanionMemory = async (db: DatabaseAdapter, scope: CompanionScope,
  input: { content: string; sourceTurnId?: string }, existing?: { id: string; version: number }) => {
  await ensureCompanionState(db, scope);
  if (input.sourceTurnId) {
    const turn = await getCompanionTurn(db, scope, input.sourceTurnId);
    if (!turn || turn.message !== input.content) throw new AppError("companion_source_invalid", "Only the original user message can be saved with this source.", 400);
  }
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db.batch([
    // Predicate and mutation share a transaction. A rejected version/capacity
    // check must not advance the epoch or cancel an unrelated generation.
    ...invalidateContext(db, scope, existing ? memoryVersionCondition(scope, id, existing.version) : {
      sql: "(SELECT COUNT(*) FROM companion_memories WHERE workspace_id = ? AND owner_id = ?) < 50",
      bindings: bindScope(scope),
    }),
    existing
      ? db.prepare(`UPDATE companion_memories SET content = ?, source_turn_id = NULL, version = version + 1, updated_at = ?
          WHERE workspace_id = ? AND owner_id = ? AND id = ? AND version = ?`)
        .bind(input.content, now, ...bindScope(scope), id, existing.version)
      : db.prepare(`INSERT INTO companion_memories(id, workspace_id, owner_id, content, source_turn_id, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM companion_memories WHERE workspace_id = ? AND owner_id = ?) < 50`)
        .bind(id, ...bindScope(scope), input.content, input.sourceTurnId ?? null, now, now, ...bindScope(scope)),
  ]);
  if (Number(result[2].meta.changes) !== 1) throw new AppError("companion_memory_conflict", "Memory changed or the 50-memory limit was reached. Refresh and try again.", 409);
  return (await listCompanionMemories(db, scope)).find(memory => memory.id === id)!;
};

export const forgetCompanionMemory = async (db: DatabaseAdapter, scope: CompanionScope, id: string, version: number) => {
  await ensureCompanionState(db, scope);
  const result = await db.batch([
    ...invalidateContext(db, scope, memoryVersionCondition(scope, id, version)),
    db.prepare("DELETE FROM companion_memories WHERE workspace_id = ? AND owner_id = ? AND id = ? AND version = ?")
      .bind(...bindScope(scope), id, version),
  ]);
  if (Number(result[2].meta.changes) !== 1) throw new AppError("companion_memory_conflict", "Memory changed. Refresh and try again.", 409);
};

export const importCompanionMemories = async (db: DatabaseAdapter, scope: CompanionScope, contents: string[]) => {
  await ensureCompanionState(db, scope);
  const now = new Date().toISOString();
  // One INSERT for the entire import: concurrent additions cannot cause a
  // partially applied file or exceed the limit. JSON1 is shared by SQLite/D1.
  const incoming = [...new Set(contents)].map(content => ({ id: crypto.randomUUID(), content }));
  await db.batch([
    db.prepare(`WITH incoming AS (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.content') AS content FROM json_each(?)),
      additions AS (SELECT * FROM incoming WHERE NOT EXISTS (SELECT 1 FROM companion_memories WHERE workspace_id = ? AND owner_id = ? AND content = incoming.content))
      INSERT INTO companion_memories(id, workspace_id, owner_id, content, created_at, updated_at)
      SELECT id, ?, ?, content, ?, ? FROM additions
      WHERE (SELECT COUNT(*) FROM companion_memories WHERE workspace_id = ? AND owner_id = ?) + (SELECT COUNT(*) FROM additions) <= 50`)
      .bind(JSON.stringify(incoming), ...bindScope(scope), ...bindScope(scope), now, now, ...bindScope(scope)),
    ...invalidateContext(db, scope, {
      sql: "EXISTS (SELECT 1 FROM companion_memories WHERE workspace_id = ? AND owner_id = ? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?)))",
      bindings: [...bindScope(scope), JSON.stringify(incoming)],
    }),
  ]);
  const memories = await listCompanionMemories(db, scope);
  if (contents.some(content => !memories.some(memory => memory.content === content))) {
    throw new AppError("companion_memory_conflict", "The 50-memory limit would be exceeded. No memories were imported.", 409);
  }
  return memories;
};

export const beginCompanionTurn = async (db: DatabaseAdapter, scope: CompanionScope, input: CompanionTurnInput, model: string) => {
  await ensureCompanionState(db, scope);
  await listCompanionTurns(db, scope);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM companion_turns WHERE workspace_id = ? AND owner_id = ?")
    .bind(...bindScope(scope)).first<{ count: number }>();
  if ((count?.count ?? 0) >= 500) throw new AppError("companion_history_full", "Export and clear conversation history before continuing.", 409);
  try {
    await db.prepare(`INSERT INTO companion_turns(id, workspace_id, owner_id, thread_id, memory_revision, message,
      status, model, use_memory, allow_notes, locale, created_at, expires_at)
      SELECT ?, ?, ?, ?, memory_revision, ?, 'running', ?, ?, ?, ?, ?, ? FROM companion_state WHERE workspace_id = ? AND owner_id = ?`)
      .bind(input.id, ...bindScope(scope), input.threadId, input.message, model, Number(input.useMemory), Number(input.allowNotes), input.locale,
        new Date().toISOString(), new Date(Date.now() + 90_000).toISOString(), ...bindScope(scope)).run();
  } catch (error) {
    if (/unique|constraint/i.test(String(error))) throw new AppError("companion_busy", "A conversation is already running or this request was already submitted. Refresh to recover its result.", 409);
    throw error;
  }
  return (await getCompanionTurn(db, scope, input.id))!;
};

export const checkpointCompanionTurn = async (db: DatabaseAdapter, scope: CompanionScope, row: TurnRow,
  response: string, sources: CompanionSource[], status: CompanionTurn["status"], usage?: { inputTokens?: number; outputTokens?: number }) => {
  const result = await db.prepare(`UPDATE companion_turns SET response = ?, sources_json = ?, status = ?, input_tokens = ?, output_tokens = ?
    WHERE workspace_id = ? AND owner_id = ? AND id = ? AND status = 'running'
      AND memory_revision = (SELECT memory_revision FROM companion_state WHERE workspace_id = ? AND owner_id = ?)`)
    .bind(response, JSON.stringify(sources), status, usage?.inputTokens ?? null, usage?.outputTokens ?? null,
      ...bindScope(scope), row.id, ...bindScope(scope)).run();
  if (Number(result.meta.changes) !== 1) throw new AppError("companion_context_changed", "Memory or conversation changed. Start a new request.", 409);
};

export const clearCompanionHistory = async (db: DatabaseAdapter, scope: CompanionScope) => {
  await ensureCompanionState(db, scope);
  await db.batch([
    db.prepare("UPDATE companion_memories SET source_turn_id = NULL, version = version + 1 WHERE workspace_id = ? AND owner_id = ? AND source_turn_id IS NOT NULL").bind(...bindScope(scope)),
    db.prepare("DELETE FROM companion_turns WHERE workspace_id = ? AND owner_id = ?").bind(...bindScope(scope)),
    db.prepare("UPDATE companion_discovery_settings SET last_input_hash = NULL WHERE workspace_id = ? AND owner_id = ?").bind(...bindScope(scope)),
    ...invalidateContext(db, scope),
  ]);
};
