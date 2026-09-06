import { learnCompanionPreferences, refreshCompanionPreferences, applicableMemories } from "./companion-learning";
import { selectCompanionMemories } from "./companion-memory-context";
import { CompanionDiscoveryOutputSchema, type CompanionDiscoveryItem, type CompanionDiscoverySettings,
  type CompanionDiscoverySettingsInput, type MemoDetail } from "@edgeever/shared";
import type { DatabaseAdapter } from "./storage-contract";
import type { CompanionScope } from "./companion-service";
import { beginCompanionTurn, checkpointCompanionTurn, listCompanionMemories, saveCompanionMemory, getCompanionTurn, companionRevision } from "./companion-service";
import { AppError } from "./app-error";
import { getMemoDetail, searchMemoSummaries } from "./memo-service";
import { companionWorkspaceCursor, proposeCompanionToolAction, workspaceCursorSql } from "./companion-tool-actions";
import { getCompanionAction } from "./companion-actions";
import type { loadDefaultAiModel } from "./ai-service";
import type { generateCompanionDiscovery } from "./companion-discovery-runtime";
import { discoveryInputHash } from "./companion-discovery-context";

type SettingsRow = { learning_enabled: number; recall_enabled: number; last_memory_revision: number; enabled: number; version: number; last_cursor: number;
  last_check_at: string | null; last_status: CompanionDiscoverySettings["lastStatus"]; active_turn_id: string | null; last_input_hash: string | null };
type FeedRow = { memory_ids_json: string; id: string; kind: CompanionDiscoveryItem["kind"]; title: string; body: string; action_id: string | null;
  sources_json: string; seen_at: string | null; created_at: string };
const keys = (scope: CompanionScope) => [scope.workspaceId, scope.ownerId];
const changed = () => new AppError("companion_discovery_conflict", "Discovery settings or notes changed. Refresh before continuing.", 409);
const plainText = (node: MemoDetail["contentJson"]): boolean => {
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const item = value as { type?: string; marks?: unknown[]; content?: unknown[]; attrs?: Record<string, unknown> };
    return ["doc", "paragraph", "text", "hardBreak"].includes(item.type ?? "") && !item.marks?.length
      && (!item.attrs || Object.values(item.attrs).every(attribute => attribute === null))
      && (!item.content || item.content.every(visit));
  };
  return visit(node);
};
const settingsRow = (db: DatabaseAdapter, scope: CompanionScope) => db.prepare(
  "SELECT * FROM companion_discovery_settings WHERE workspace_id = ? AND owner_id = ?").bind(...keys(scope)).first<SettingsRow>();

export async function getDiscoverySettings(db: DatabaseAdapter, scope: CompanionScope): Promise<CompanionDiscoverySettings> {
  const row = await settingsRow(db, scope);
  return { enabled: row?.enabled === 1, learningEnabled: row?.learning_enabled === 1, useMemory: row?.recall_enabled === 1, version: row?.version ?? 0,
    lastCheckAt: row?.last_check_at ?? null,
    lastStatus: row?.last_status === "running" && Date.now() - Date.parse(row.last_check_at ?? "") > 90_000 ? "failed" : row?.last_status ?? "quiet" };
}

export async function saveDiscoverySettings(db: DatabaseAdapter, scope: CompanionScope, input: CompanionDiscoverySettingsInput) {
  await db.prepare("INSERT OR IGNORE INTO companion_discovery_settings(workspace_id, owner_id) VALUES (?, ?)").bind(...keys(scope)).run();
  await db.prepare("INSERT OR IGNORE INTO companion_state(workspace_id, owner_id) VALUES (?, ?)").bind(...keys(scope)).run();
  const previous = await settingsRow(db, scope);
  const learning = input.learningEnabled ?? previous?.learning_enabled === 1;
  const useMemory = input.useMemory ?? previous?.recall_enabled === 1;
  const check = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO companion_action_checks(id, valid) VALUES (?, CASE WHEN EXISTS (
      SELECT 1 FROM companion_discovery_settings WHERE workspace_id = ? AND owner_id = ? AND version = ?) THEN 1 ELSE 0 END)`)
      .bind(check, ...keys(scope), input.version),
    db.prepare("UPDATE companion_state SET memory_revision = memory_revision + 1 WHERE workspace_id = ? AND owner_id = ?").bind(...keys(scope)),
    db.prepare("UPDATE companion_turns SET status = 'cancelled' WHERE workspace_id = ? AND owner_id = ? AND status = 'running'").bind(...keys(scope)),
    // Revoke unconfirmed work atomically with settings. Already-started user
    // confirmations retain their receipt and are allowed to finish.
    db.prepare(`UPDATE companion_turns SET status = 'cancelled' WHERE workspace_id = ? AND owner_id = ?
      AND (id IN (SELECT turn_id FROM companion_discoveries WHERE workspace_id = ? AND owner_id = ?)
        OR id = (SELECT active_turn_id FROM companion_discovery_settings WHERE workspace_id = ? AND owner_id = ?))
      AND NOT EXISTS (SELECT 1 FROM companion_actions a WHERE a.turn_id = companion_turns.id AND (a.execution_token IS NOT NULL OR a.status = 'applied'))`)
      .bind(...keys(scope), ...keys(scope), ...keys(scope)),
    // Keep the old storage column for migration compatibility, not permissions.
    db.prepare(`UPDATE companion_discovery_settings SET enabled = ?, learning_cursor = CASE WHEN ? = 1 AND (learning_enabled = 0 OR enabled = 0)
        THEN (SELECT COALESCE(MAX(rowid), 0) FROM audit_events) ELSE learning_cursor END,
      learning_enabled = ?, recall_enabled = ?, last_memory_revision = -1, notebook_ids_json = '[]', version = version + 1,
      last_status = 'quiet', active_turn_id = NULL WHERE workspace_id = ? AND owner_id = ?`)
      .bind(Number(input.enabled), Number(learning), Number(learning), Number(useMemory), ...keys(scope)),
    db.prepare("DELETE FROM companion_action_checks WHERE id = ?").bind(check),
  ]).catch(error => { if (/constraint/i.test(String(error))) throw changed(); throw error; });
  return getDiscoverySettings(db, scope);
}

export async function listDiscoveries(db: DatabaseAdapter, scope: CompanionScope): Promise<CompanionDiscoveryItem[]> {
  const memories = await listCompanionMemories(db, scope);
  const rows = await db.prepare(`SELECT d.* FROM companion_discoveries d JOIN companion_discovery_settings s
    ON s.workspace_id = d.workspace_id AND s.owner_id = d.owner_id
    JOIN companion_turns t ON t.id = d.turn_id JOIN companion_state cs ON cs.workspace_id = d.workspace_id AND cs.owner_id = d.owner_id
    WHERE d.workspace_id = ? AND d.owner_id = ? AND s.enabled = 1 AND s.version = d.settings_version
      AND d.dismissed_at IS NULL AND t.status = 'completed' AND t.memory_revision = cs.memory_revision
      AND d.created_at > ? ORDER BY d.created_at DESC LIMIT 20`)
    .bind(...keys(scope), new Date(Date.now() - 7 * 86400000).toISOString()).all<FeedRow>();
  const items: CompanionDiscoveryItem[] = [];
  for (const row of rows.results) {
    const sources = JSON.parse(row.sources_json) as CompanionDiscoveryItem["sources"];
    const action = row.action_id ? await getCompanionAction(db, scope, row.action_id) : null;
    // Keep applied receipts, but never re-display old excerpts or model text
    // about a deleted/edited note in a pending discovery.
    if (action?.status !== "applied") {
      let valid = true;
      for (const source of sources) {
        const memo = await db.prepare(`SELECT m.notebook_id, c.revision FROM memos m JOIN memo_contents c ON c.memo_id = m.id
          WHERE m.id = ? AND m.workspace_id = ? AND m.is_deleted = 0`).bind(source.id, scope.workspaceId)
          .first<{ notebook_id: string; revision: number }>();
        if (!memo || memo.revision !== source.revision || memo.notebook_id !== source.notebookId) { valid = false; break; }
      }
      if (!valid || (action && action.status !== "pending" && action.status !== "uncertain")) continue;
    }
    items.push({ id: row.id, kind: row.kind, title: row.title, body: row.body, sources, action,
      memories: (JSON.parse(row.memory_ids_json) as string[]).flatMap(id => {
        const memory = memories.find(m => m.id === id); return memory ? [memory] : [];
      }), seen: row.seen_at !== null, createdAt: row.created_at });
  }
  return items;
}

export async function acknowledgeDiscovery(db: DatabaseAdapter, scope: CompanionScope, id: string, dismiss: boolean) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE companion_discoveries SET seen_at = COALESCE(seen_at, ?)${dismiss ? ", dismissed_at = ?" : ""}
      WHERE workspace_id = ? AND owner_id = ? AND id = ?`).bind(now, ...(dismiss ? [now] : []), ...keys(scope), id),
    ...(dismiss ? [db.prepare(`UPDATE companion_actions SET status = 'dismissed' WHERE workspace_id = ? AND owner_id = ?
      AND status = 'pending' AND execution_token IS NULL AND id IN (SELECT action_id FROM companion_discoveries WHERE id = ? AND workspace_id = ? AND owner_id = ?)`)
      .bind(...keys(scope), id, ...keys(scope))] : []),
  ]);
}

// Bounded SQL retrieval, no embeddings, background worker or full-library body
// scan. Prefer recent fragments plus keyword matches from older notes.
async function candidatesFor(db: DatabaseAdapter, scope: CompanionScope) {
  // Permission covers the entire current workspace, including new/child
  // notebooks. Retrieval budgets are global, never multiplied by notebook count.
  const recent = (await searchMemoSummaries(db, { workspaceId: scope.workspaceId, limit: 12 }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const anchor = recent[0];
  if (!anchor || Date.parse(anchor.updatedAt) < Date.now() - 14 * 86400000) return [];
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  const terms = [...new Set([...segmenter.segment(anchor.title || anchor.excerpt)]
    .filter(part => part.isWordLike && part.segment.length >= 2).map(part => part.segment))].slice(0, 3);
  const related = (await Promise.all(terms.map(query => searchMemoSummaries(db, { workspaceId: scope.workspaceId, query, limit: 4 })))).flat();
  const ids = [...new Set([anchor.id, ...related.map(note => note.id), ...recent.map(note => note.id)])].slice(0, 12);
  const notes: MemoDetail[] = [];
  let budget = 12000;
  for (const id of ids) {
    const note = await getMemoDetail(db, scope.workspaceId, id);
    if (!note) continue;
    if (!note.contentMarkdown.trim() || note.contentMarkdown.length > Math.min(8000, budget)) {
      if (id === anchor.id) return []; // Never propose writes from truncated sources.
      continue;
    }
    notes.push(note); budget -= note.contentMarkdown.length;
    if (notes.length === 6) break;
  }
  return notes;
}

export async function checkDiscoveries(db: DatabaseAdapter, scope: CompanionScope, options: {
  locale: string; signal: AbortSignal; loadModel: () => ReturnType<typeof loadDefaultAiModel>;
  generate?: typeof generateCompanionDiscovery;
}) {
  let settings = await settingsRow(db, scope);
  if (!settings?.enabled) return;
  await learnCompanionPreferences(db, scope);
  await refreshCompanionPreferences(db, scope);
  const memoryRevision = await companionRevision(db, scope);
  const allMemories = await listCompanionMemories(db, scope, false);
  settings = await settingsRow(db, scope);
  if (!settings?.enabled) return;
  if (await companionRevision(db, scope) !== memoryRevision) throw changed();
  const cursor = await companionWorkspaceCursor(db, scope.workspaceId);
  const now = new Date().toISOString();
  const turnId = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE companion_discovery_settings SET last_check_at = ?, last_cursor = ?, last_memory_revision = ?, last_status = 'running', active_turn_id = ?
    WHERE workspace_id = ? AND owner_id = ? AND enabled = 1 AND version = ? AND (last_cursor <> ? OR last_memory_revision <> ?)
      AND (last_check_at IS NULL OR last_check_at < ? OR (last_memory_revision <> ? AND last_check_at < ?))`)
    .bind(now, cursor, memoryRevision, turnId, ...keys(scope), settings.version, cursor, memoryRevision,
      new Date(Date.now() - 86400000).toISOString(), memoryRevision, new Date(Date.now() - 3600000).toISOString()).run();
  if (Number(claim.meta.changes) !== 1) return;
  let turn: Awaited<ReturnType<typeof beginCompanionTurn>> | null = null;
  const finish = (status: string, inputHash: string | null = null) => db.prepare(`UPDATE companion_discovery_settings SET last_status = ?, active_turn_id = NULL,
    last_input_hash = COALESCE(?, last_input_hash)
    WHERE workspace_id = ? AND owner_id = ? AND active_turn_id = ?`).bind(status, inputHash, ...keys(scope), turnId).run();
  const assertCurrent = async () => {
    options.signal.throwIfAborted();
    const current = await settingsRow(db, scope);
    if (await companionRevision(db, scope) !== memoryRevision || !current?.enabled || current.version !== settings.version || current.active_turn_id !== turnId
      || await companionWorkspaceCursor(db, scope.workspaceId) !== cursor) throw changed();
    if (turn && ((await getCompanionTurn(db, scope, turnId))?.status !== "running"
      || await companionRevision(db, scope) !== turn.memory_revision)) throw changed();
  };
  try {
    const candidates = await candidatesFor(db, scope);
    if (candidates.length < 1) { await finish("quiet"); return; }
    await assertCurrent();
    const memories = settings.recall_enabled ? selectCompanionMemories(applicableMemories(allMemories,
      candidates.map(note => note.notebookId), candidates.flatMap(note => note.tags)),
      candidates.map(note => `${note.title} ${note.tags.join(" ")} ${note.contentMarkdown.slice(0, 500)}`).join(" ")) : [];
    const notebooks = (await db.prepare("SELECT id, name FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 ORDER BY id LIMIT 100")
      .bind(scope.workspaceId).all<{ id: string; name: string }>()).results;
    const generationInput = {
      memories, notebooks,
      candidates: candidates.map(note => ({ id: note.id, title: note.title, contentMarkdown: note.contentMarkdown, updatedAt: note.updatedAt, notebookId: note.notebookId, tags: note.tags, plainText: plainText(note.contentJson) })),
      anchorId: candidates[0].id, locale: options.locale,
    };
    const contextRevision = await companionRevision(db, scope);
    // Read configuration versions without decrypting credentials/loading SDKs.
    // Switching providers or models must not reuse the previous analysis cache.
    const modelConfiguration = await db.prepare(`SELECT s.default_model_id, s.updated_at AS settings_updated_at,
      p.updated_at AS provider_updated_at, m.updated_at AS model_updated_at
      FROM ai_workspace_settings s LEFT JOIN ai_models m ON m.id = s.default_model_id
      LEFT JOIN ai_provider_configs p ON p.id = m.provider_config_id AND p.workspace_id = s.workspace_id
      WHERE s.workspace_id = ?`).bind(scope.workspaceId).first();
    const inputHash = await discoveryInputHash({ ...generationInput, settingsVersion: settings.version, contextRevision, modelConfiguration });
    await assertCurrent();
    if (inputHash === settings.last_input_hash) { await finish("quiet"); return; }
    const model = await options.loadModel();
    turn = await beginCompanionTurn(db, scope, { id: turnId, threadId: turnId, message: "Quiet discovery", useMemory: settings.recall_enabled === 1,
      allowNotes: true, locale: options.locale === "zh-CN" ? "zh-CN" : "en-US" }, model.modelId);
    await db.prepare("UPDATE companion_turns SET origin = 'discovery' WHERE id = ? AND workspace_id = ? AND owner_id = ?").bind(turnId, ...keys(scope)).run();
    await assertCurrent();
    const generate = options.generate ?? (await import("./companion-discovery-runtime")).generateCompanionDiscovery;
    const { suggestion } = CompanionDiscoveryOutputSchema.parse(await generate({ ...generationInput, model, signal: options.signal }));
    await assertCurrent();
    if (!suggestion) {
      await db.prepare("DELETE FROM companion_turns WHERE id = ? AND workspace_id = ? AND owner_id = ?").bind(turnId, ...keys(scope)).run();
      await finish("quiet", inputHash); return;
    }
    const sources = suggestion.sourceIds.map(id => candidates.find(note => note.id === id));
    if (sources.some(note => !note) || new Set(suggestion.sourceIds).size !== sources.length || !suggestion.sourceIds.includes(candidates[0].id)) throw changed();
    const notes = sources as MemoDetail[];
    if ((suggestion.memoryIds ?? []).some(id => !memories.some(memory => memory.id === id))) throw changed();
    if (["insight", "merge", "append"].includes(suggestion.kind) && notes.length < 2) throw changed();
    if (settings.recall_enabled && allMemories.some(memory => (!memory.state || memory.state === "active") && notes.some(note => memory.ruleKey === JSON.stringify(["avoid", note.notebookId, suggestion.kind])))) {
      await db.prepare("DELETE FROM companion_turns WHERE id = ? AND workspace_id = ? AND owner_id = ?").bind(turnId, ...keys(scope)).run();
      await finish("quiet", inputHash); return;
    }
    const fingerprint = `${suggestion.kind}:${[...suggestion.sourceIds].sort().join(":")}${["move", "tag"].includes(suggestion.kind) ? `:${suggestion.notebookId ?? ""}:${JSON.stringify(suggestion.tags ?? [])}` : ""}`;
    const duplicate = await db.prepare("SELECT id FROM companion_discoveries WHERE workspace_id = ? AND owner_id = ? AND fingerprint = ?")
      .bind(...keys(scope), fingerprint).first();
    if (duplicate) {
      await db.prepare("DELETE FROM companion_turns WHERE id = ? AND workspace_id = ? AND owner_id = ?").bind(turnId, ...keys(scope)).run();
      await finish("quiet", inputHash); return;
    }
    let actionId: string | null = null;
    const inspected = new Map(notes.map(note => [note.id, note.revision]));
    if (suggestion.kind !== "insight") {
      let toolName: string;
      let args: Record<string, unknown>;
      if (suggestion.kind === "move") {
        if (!suggestion.notebookId || !notebooks.some(n => n.id === suggestion.notebookId) || notes.some(n => n.notebookId === suggestion.notebookId)) throw changed();
        toolName = "move_memos";
        args = { memoIds: notes.map(n => n.id), notebookId: suggestion.notebookId };
      } else if (suggestion.kind === "tag") {
        if (notes.length !== 1 || !suggestion.tags?.length || suggestion.tags.some(tag => !candidates.some(n => n.tags.includes(tag)))) throw changed();
        toolName = "add_tags_to_memos";
        args = { memoIds: [notes[0].id], tags: suggestion.tags };
      } else if (suggestion.kind === "merge") {
        toolName = "merge_memos";
        args = { memoIds: notes.map(note => note.id), title: suggestion.title, notebookId: notes[0].notebookId };
      } else {
        const target = notes.find(note => note.id === suggestion.targetId);
        const source = notes.find(note => note.id !== suggestion.targetId);
        if (notes.length !== 2 || !target || !source || source.id !== candidates[0].id || !notes.every(note => plainText(note.contentJson))) throw changed();
        // Resource associations are not copied by update_memo; defer these cases
        // to merge_memos instead of creating broken attachment ownership.
        if (await db.prepare("SELECT id FROM resources WHERE memo_id = ? AND is_deleted = 0 LIMIT 1")
          .bind(source.id).first()) throw changed();
        toolName = "update_memo";
        args = { memoId: target.id, contentMarkdown: `${target.contentMarkdown}\n\n---\n\n${source.contentMarkdown}` };
      }
      actionId = (await proposeCompanionToolAction(db, scope, turnId, toolName, args, suggestion.body, cursor, inspected,
        notes.map(note => note.id))).proposalId;
    }
    const sourceRefs = notes.map(note => ({ id: note.id, title: note.title || "", notebookId: note.notebookId, revision: note.revision }));
    const id = crypto.randomUUID();
    // Publication and turn completion share one transaction. A revoked setting,
    // forgotten context or edited note can never become a confirmable proposal.
    await db.batch([
      db.prepare(`INSERT INTO companion_action_checks(id, valid) VALUES (?, CASE WHEN EXISTS (
        SELECT 1 FROM companion_discovery_settings s JOIN companion_turns t ON t.id = s.active_turn_id
        JOIN companion_state cs ON cs.workspace_id = s.workspace_id AND cs.owner_id = s.owner_id
        WHERE s.workspace_id = ? AND s.owner_id = ? AND s.enabled = 1 AND s.version = ? AND s.active_turn_id = ?
          AND t.status = 'running' AND t.memory_revision = cs.memory_revision AND t.expires_at > ?
          AND (${workspaceCursorSql}) = ?) THEN 1 ELSE 0 END)`)
        .bind(id, ...keys(scope), settings.version, turnId, new Date().toISOString(), scope.workspaceId, cursor),
      db.prepare(`INSERT INTO companion_discoveries(id, workspace_id, owner_id, turn_id, action_id, settings_version,
        kind, title, body, sources_json, fingerprint, created_at, memory_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, ...keys(scope), turnId, actionId, settings.version, suggestion.kind, suggestion.title, suggestion.body, JSON.stringify(sourceRefs), fingerprint, now, JSON.stringify(suggestion.memoryIds ?? [])),
      db.prepare("UPDATE companion_turns SET status = 'completed', response = ?, sources_json = ? WHERE id = ?")
        .bind(suggestion.body, JSON.stringify(sourceRefs), turnId),
      db.prepare("DELETE FROM companion_action_checks WHERE id = ?").bind(id),
    ]);
    await finish("ready", inputHash);
  } catch (error) {
    if (turn) await checkpointCompanionTurn(db, scope, turn, "", [], "failed").catch(() => {});
    await finish("failed");
    throw error;
  }
}

// An explicit feedback button is a user statement, not an inference from dismissal.
export async function rememberDiscoveryFeedback(db: DatabaseAdapter, scope: CompanionScope, id: string) {
  const item = (await listDiscoveries(db, scope)).find(item => item.id === id);
  if (!item || item.kind === "insight" || !item.action || item.action.status !== "pending") throw changed();
  const source = item.sources[0];
  const notebook = await db.prepare("SELECT name FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0")
    .bind(source.notebookId, scope.workspaceId).first<{ name: string }>();
  if (!notebook) throw changed();
  const content = `Do not suggest ${item.kind} operations for notes in notebook “${notebook.name}”. The user explicitly requested this.`.slice(0, 500);
  const previous = (await listCompanionMemories(db, scope)).find(memory => memory.content === content && memory.scopeNotebookId === source.notebookId);
  if (!previous) await saveCompanionMemory(db, scope, { content, scopeNotebookId: source.notebookId,
    ruleKey: JSON.stringify(["avoid", source.notebookId, item.kind]) });
  await acknowledgeDiscovery(db, scope, id, true);
}
