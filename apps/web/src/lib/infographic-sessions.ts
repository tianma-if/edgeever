import type { ChatThreadSummary } from "@/lib/local-agent-threads";

// Turns saved before sessions have no sessionId and stay in one note-local chat.
export const INFOGRAPHIC_LEGACY_SESSION_ID = "legacy";

type SessionTurn = {
  sessionId?: string;
  prompt: string;
  createdAt: string;
  kind: string;
  undoneAt?: string;
};

export const infographicTurnSessionId = (turn: { sessionId?: string }) => turn.sessionId?.trim() || INFOGRAPHIC_LEGACY_SESSION_ID;

export const resolveInfographicSessionId = (
  turns: readonly { sessionId?: string; createdAt: string }[],
  activeSessionId: string | null | undefined,
) => {
  if (activeSessionId) return activeSessionId;
  let latest: { sessionId?: string; createdAt: string } | null = null;
  for (const turn of turns) {
    if (!latest || turn.createdAt > latest.createdAt) latest = turn;
  }
  return latest ? infographicTurnSessionId(latest) : INFOGRAPHIC_LEGACY_SESSION_ID;
};

export const infographicSessionThreads = (turns: readonly SessionTurn[]): ChatThreadSummary[] => {
  const byId = new Map<string, ChatThreadSummary & { oldestAt: string }>();
  for (const turn of turns) {
    const id = infographicTurnSessionId(turn);
    const title = turn.prompt.replace(/\s+/g, " ").trim();
    const current = byId.get(id);
    if (!current) {
      byId.set(id, { id, title, updatedAt: turn.createdAt, oldestAt: turn.createdAt });
      continue;
    }
    if (turn.createdAt > current.updatedAt) current.updatedAt = turn.createdAt;
    if (turn.createdAt < current.oldestAt && title) {
      current.oldestAt = turn.createdAt;
      current.title = title;
    }
  }
  return [...byId.values()]
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0))
    .map(({ oldestAt: _oldestAt, ...thread }) => thread);
};

export const infographicSessionHistory = <T extends SessionTurn>(turns: readonly T[], sessionId: string) =>
  turns.filter((turn) => infographicTurnSessionId(turn) === sessionId && !turn.undoneAt && turn.kind !== "failed").slice(-12);

export const infographicSessionStamp = (sessionId: string): { sessionId?: string } =>
  sessionId === INFOGRAPHIC_LEGACY_SESSION_ID ? {} : { sessionId };
