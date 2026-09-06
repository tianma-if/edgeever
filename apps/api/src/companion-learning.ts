import type { CompanionMemory } from "@edgeever/shared";
import type { DatabaseAdapter } from "./storage-contract";
import type { CompanionScope } from "./companion-service";

const keys = (scope: CompanionScope) => [scope.workspaceId, scope.ownerId];
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(v => typeof v === "string" && v.length <= 100);
export type PreferenceRule = { kind: "move" | "tag"; notebookId: string; tag: string };
export function parsePreferenceRule(key: string | null | undefined): PreferenceRule | null {
  try {
    const [kind, notebookId, tag] = JSON.parse(key ?? "null");
    return ["move", "tag"].includes(kind) && typeof notebookId === "string" && typeof tag === "string" ? { kind, notebookId, tag } : null;
  } catch { return null; }
}

// Consume committed audit rows, never call a model or write from a note-save hook.
// rowid is only a processing cursor; event IDs are the durable deduplication key.
export async function learnCompanionPreferences(db: DatabaseAdapter, scope: CompanionScope) {
  const settings = await db.prepare("SELECT version, learning_cursor FROM companion_discovery_settings WHERE workspace_id = ? AND owner_id = ? AND enabled = 1 AND learning_enabled = 1")
    .bind(...keys(scope)).first<{ version: number; learning_cursor: number }>();
  if (!settings) return;
  const events = (await db.prepare(`SELECT a.rowid AS cursor, a.id, a.entity_id, a.metadata_json, a.created_at
    FROM audit_events a JOIN memos m ON m.id = a.entity_id AND m.workspace_id = ? AND m.is_deleted = 0
    WHERE a.rowid > ? AND a.actor_id = ? AND a.actor_type = 'user' AND a.action IN ('memo.move', 'memo.update', 'tag.add', 'tag.remove')
    ORDER BY a.rowid LIMIT 50`).bind(scope.workspaceId, settings.learning_cursor, scope.ownerId)
    .all<{ cursor: number; id: string; entity_id: string; metadata_json: string; created_at: string }>()).results;
  if (!events.length) return;
  const check = crypto.randomUUID();
  const statements = [db.prepare(`INSERT INTO companion_action_checks(id, valid) VALUES (?, CASE WHEN EXISTS (
    SELECT 1 FROM companion_discovery_settings WHERE workspace_id = ? AND owner_id = ? AND enabled = 1 AND learning_enabled = 1 AND version = ? AND learning_cursor = ?
    ) THEN 1 ELSE 0 END)`).bind(check, ...keys(scope), settings.version, settings.learning_cursor)];
  for (const event of events) {
    let data;
    try { data = JSON.parse(event.metadata_json).learning; } catch { continue; }
    if (data?.version !== 1 || data.workspaceId !== scope.workspaceId || !strings(data.beforeTags) || !strings(data.afterTags)
      || typeof data.toNotebookId !== "string" || typeof data.fromNotebookId !== "string") continue;
    const rules: PreferenceRule[] = [];
    if (data.fromNotebookId !== data.toNotebookId) {
      for (const tag of data.afterTags.slice(0, 5)) rules.push({ kind: "move", notebookId: data.toNotebookId, tag });
    }
    for (const tag of data.afterTags.filter((tag: string) => !data.beforeTags.includes(tag)).slice(0, 5)) {
      rules.push({ kind: "tag", notebookId: data.toNotebookId, tag });
    }
    for (const rule of rules) {
      const key = JSON.stringify([rule.kind, rule.notebookId, rule.tag]);
      // A burst/bulk operation contributes at most one choice per 10-minute window.
      const choice = String(Math.floor(Date.parse(event.created_at) / 600_000));
      statements.push(db.prepare(`INSERT OR IGNORE INTO companion_memory_evidence(workspace_id, owner_id, rule_key, event_id, memo_id, choice_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM companion_memory_exclusions WHERE workspace_id = ? AND owner_id = ? AND rule_key = ?)`)
        .bind(...keys(scope), key, event.id, event.entity_id, choice, event.created_at, ...keys(scope), key));
    }
  }
  statements.push(db.prepare("UPDATE companion_discovery_settings SET learning_cursor = ? WHERE workspace_id = ? AND owner_id = ?")
    .bind(events.at(-1)!.cursor, ...keys(scope)), db.prepare("DELETE FROM companion_action_checks WHERE id = ?").bind(check));
  try { await db.batch(statements); } catch (error) { if (/constraint/i.test(String(error))) return; throw error; }
}

// Also run while learning is paused: deletion, contradictory edits and age must
// stop invalid evidence being recalled. Explicit corrections are never rewritten.
export async function refreshCompanionPreferences(db: DatabaseAdapter, scope: CompanionScope) {
  const cursor = await db.prepare("SELECT COALESCE(MAX(id), 0) AS value FROM mobile_sync_changes WHERE workspace_id = ?").bind(scope.workspaceId).first<{ value: number }>();
  const evidence = (await db.prepare(`SELECT e.*, m.tags_json, m.notebook_id, n.name AS notebook_name
    FROM companion_memory_evidence e JOIN memos m ON m.id = e.memo_id AND m.workspace_id = e.workspace_id AND m.is_deleted = 0
    JOIN notebooks n ON n.id = m.notebook_id AND n.workspace_id = m.workspace_id AND n.is_deleted = 0
    WHERE e.workspace_id = ? AND e.owner_id = ? AND e.created_at >= ? ORDER BY e.created_at DESC LIMIT 2000`)
    .bind(...keys(scope), new Date(Date.now() - 90 * 86400000).toISOString())
    .all<{ rule_key: string; choice_id: string; memo_id: string; created_at: string; tags_json: string; notebook_id: string; notebook_name: string }>()).results;
  const groups = new Map<string, typeof evidence>();
  for (const entry of evidence) groups.set(entry.rule_key, [...(groups.get(entry.rule_key) ?? []), entry]);
  const old = (await db.prepare("SELECT rule_key FROM companion_memories WHERE workspace_id = ? AND owner_id = ? AND kind = 'inferred'").bind(...keys(scope)).all<{ rule_key: string }>()).results;
  for (const row of old) if (!groups.has(row.rule_key)) groups.set(row.rule_key, []);
  if (!groups.size) return;
  await db.prepare("INSERT OR IGNORE INTO companion_state(workspace_id, owner_id) VALUES (?, ?)").bind(...keys(scope)).run();
  const ordered = [...groups].sort(([a], [b]) => Number(old.some(row => row.rule_key === b)) - Number(old.some(row => row.rule_key === a)));
  for (const [key, entries] of ordered.slice(0, 50)) {
    const rule = parsePreferenceRule(key);
    if (!rule) continue;
    const supports = entries.filter(e => e.notebook_id === rule.notebookId && (JSON.parse(e.tags_json) as string[]).includes(rule.tag));
    const choices = new Set(supports.map(e => e.choice_id)).size;
    const days = new Set(supports.map(e => e.created_at.slice(0, 10))).size;
    const distinctNotes = new Set(supports.map(e => e.memo_id)).size;
    const competing = rule.kind === "move" && evidence.some(e => {
      const other = parsePreferenceRule(e.rule_key);
      return other?.kind === "move" && other.tag === rule.tag && other.notebookId !== rule.notebookId
        && e.notebook_id === other.notebookId && (JSON.parse(e.tags_json) as string[]).includes(other.tag);
    });
    const state = supports.length < entries.length || competing ? "conflicted" : choices >= 3 && days >= 2 && distinctNotes >= 3 ? "active" : "candidate";
    const notebook = supports[0]?.notebook_name ?? rule.notebookId;
    const content = rule.kind === "move" ? `Notes tagged “${rule.tag}” are usually filed in “${notebook}”.` : `Notes in “${notebook}” are usually tagged “${rule.tag}”.`;
    const now = new Date().toISOString();
    const check = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO companion_action_checks(id, valid) VALUES (?, CASE WHEN
        (SELECT COALESCE(MAX(id), 0) FROM mobile_sync_changes WHERE workspace_id = ?) = ? THEN 1 ELSE 0 END)`)
        .bind(check, scope.workspaceId, cursor?.value ?? 0),
      db.prepare(`INSERT INTO companion_memories(id, workspace_id, owner_id, content, kind, scope_notebook_id, rule_key, state, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'inferred', ?, ?, ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM companion_memory_exclusions WHERE workspace_id = ? AND owner_id = ? AND rule_key = ?)
          AND (((SELECT COUNT(*) FROM companion_memories WHERE workspace_id = ? AND owner_id = ?) < 50
            AND (SELECT COUNT(*) FROM companion_memories WHERE workspace_id = ? AND owner_id = ? AND kind = 'inferred') < 30) OR EXISTS (
            SELECT 1 FROM companion_memories WHERE workspace_id = ? AND owner_id = ? AND rule_key = ?))
        ON CONFLICT(workspace_id, owner_id, rule_key) DO UPDATE SET content = excluded.content, state = excluded.state,
          version = companion_memories.version + 1, updated_at = excluded.updated_at
          WHERE companion_memories.kind = 'inferred' AND (companion_memories.content <> excluded.content OR companion_memories.state <> excluded.state)`)
        .bind(crypto.randomUUID(), ...keys(scope), content.slice(0, 500), rule.notebookId, key, state, now, now,
          ...keys(scope), key, ...keys(scope), ...keys(scope), ...keys(scope), key),
      db.prepare("UPDATE companion_state SET memory_revision = memory_revision + 1 WHERE workspace_id = ? AND owner_id = ? AND changes() > 0").bind(...keys(scope)),
      db.prepare(`UPDATE companion_turns SET status = 'cancelled' WHERE workspace_id = ? AND owner_id = ? AND status = 'running'
        AND memory_revision <> (SELECT memory_revision FROM companion_state WHERE workspace_id = ? AND owner_id = ?)`)
        .bind(...keys(scope), ...keys(scope)),
      db.prepare("DELETE FROM companion_action_checks WHERE id = ?").bind(check),
    ]);
  }
  await db.prepare(`DELETE FROM companion_memory_evidence WHERE workspace_id = ? AND owner_id = ? AND
    (created_at < ? OR NOT EXISTS (SELECT 1 FROM memos m WHERE m.id = memo_id AND m.workspace_id = companion_memory_evidence.workspace_id AND m.is_deleted = 0))`)
    .bind(...keys(scope), new Date(Date.now() - 90 * 86400000).toISOString()).run();
}

export function applicableMemories(memories: CompanionMemory[], notebookIds: string[], tags: string[]) {
  return memories.filter(memory => {
    if (memory.state && memory.state !== "active") return false;
    const rule = parsePreferenceRule(memory.ruleKey);
    if (rule?.kind === "move") return tags.includes(rule.tag);
    if (memory.scopeNotebookId) return notebookIds.includes(memory.scopeNotebookId);
    return memory.kind !== "inferred";
  });
}
