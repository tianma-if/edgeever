export const LOCAL_AGENT_THREAD_LIMIT = 30;
export const LOCAL_AGENT_TURN_LIMIT = 40;
const LOCAL_AGENT_TEXT_LIMIT = 12_000;
const LOCAL_AGENT_REASONING_LIMIT = 4_000;
const LOCAL_AGENT_TRANSCRIPT_TURNS = 8;
const LOCAL_AGENT_TRANSCRIPT_LINE = 1_000;
const LOCAL_AGENT_TRANSCRIPT_LIMIT = 4_000;
const LOCAL_AGENT_STORE_VERSION = 1;

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LocalAgentTurnStatus = "running" | "completed" | "failed" | "cancelled";

export type LocalAgentToolRecord = { id: string; name: string; status: string; title?: string };

export type LocalAgentAttachmentRecord = {
  id: string;
  filename: string;
  mediaType: string;
  byteLength: number;
};

// Generated pictures are stored separately in IndexedDB to keep large image data out of localStorage.
export type LocalAgentTurnRecord = {
  id: string;
  threadId: string;
  message: string;
  response: string;
  reasoning: string;
  tools: LocalAgentToolRecord[];
  attachments: LocalAgentAttachmentRecord[];
  status: LocalAgentTurnStatus;
  createdAt: string;
};

export type ChatThreadSummary = { id: string; title: string; updatedAt: string };

type StorageLike = { setItem: (key: string, value: string) => void };

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

const isThreadId = (value: unknown): value is string => typeof value === "string" && THREAD_ID_PATTERN.test(value);

const isStatus = (value: unknown): value is LocalAgentTurnStatus => (
  value === "running" || value === "completed" || value === "failed" || value === "cancelled"
);

const cleanTools = (value: unknown): LocalAgentToolRecord[] => {
  if (!Array.isArray(value)) return [];
  const tools: LocalAgentToolRecord[] = [];
  for (const item of value.slice(-12)) {
    if (!item || typeof item !== "object") continue;
    const tool = item as { id?: unknown; name?: unknown; status?: unknown; title?: unknown };
    const name = clip(tool.name, 120);
    const status = clip(tool.status, 40);
    if (!name || !status) continue;
    const title = clip(tool.title, 200);
    tools.push({
      id: clip(tool.id, 80) || name,
      name,
      status,
      ...(title ? { title } : {}),
    });
  }
  return tools;
};

const cleanAttachments = (value: unknown): LocalAgentAttachmentRecord[] => {
  if (!Array.isArray(value)) return [];
  const attachments: LocalAgentAttachmentRecord[] = [];
  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const attachment = item as { id?: unknown; filename?: unknown; mediaType?: unknown; byteLength?: unknown };
    const filename = clip(attachment.filename, 200);
    if (!filename) continue;
    const byteLength = typeof attachment.byteLength === "number" && Number.isFinite(attachment.byteLength)
      ? Math.max(0, Math.round(attachment.byteLength))
      : 0;
    attachments.push({
      id: clip(attachment.id, 80) || filename,
      filename,
      mediaType: clip(attachment.mediaType, 120),
      byteLength,
    });
  }
  return attachments;
};

const cleanTurn = (value: unknown, statusForRunning: LocalAgentTurnStatus): LocalAgentTurnRecord | null => {
  if (!value || typeof value !== "object") return null;
  const turn = value as Partial<LocalAgentTurnRecord>;
  if (!isThreadId(turn.id) || !isThreadId(turn.threadId) || !isStatus(turn.status)) return null;
  const createdAt = typeof turn.createdAt === "string" ? turn.createdAt : "";
  if (!Number.isFinite(Date.parse(createdAt))) return null;
  const message = clip(turn.message, LOCAL_AGENT_TEXT_LIMIT).trim();
  if (!message) return null;
  return {
    id: turn.id,
    threadId: turn.threadId,
    message,
    response: clip(turn.response, LOCAL_AGENT_TEXT_LIMIT),
    reasoning: clip(turn.reasoning, LOCAL_AGENT_REASONING_LIMIT),
    tools: cleanTools(turn.tools),
    attachments: cleanAttachments(turn.attachments),
    status: turn.status === "running" ? statusForRunning : turn.status,
    createdAt,
  };
};

const turnsByThread = (turns: LocalAgentTurnRecord[]) => {
  const grouped = new Map<string, LocalAgentTurnRecord[]>();
  for (const turn of turns) {
    const list = grouped.get(turn.threadId);
    if (list) list.push(turn);
    else grouped.set(turn.threadId, [turn]);
  }
  return [...grouped.entries()]
    .map(([id, items]) => {
      const ordered = items.slice().sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1));
      return {
        id,
        updatedAt: ordered[ordered.length - 1]?.createdAt ?? "",
        turns: ordered.slice(-LOCAL_AGENT_TURN_LIMIT),
      };
    })
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
    .slice(0, LOCAL_AGENT_THREAD_LIMIT);
};

export const compactLocalAgentTurns = (turns: readonly unknown[]): LocalAgentTurnRecord[] => (
  turnsByThread(
    turns.flatMap((turn) => {
      const cleaned = cleanTurn(turn, "running");
      return cleaned ? [cleaned] : [];
    }),
  ).flatMap((thread) => thread.turns)
);

export const parseLocalAgentTurns = (raw: string | null): LocalAgentTurnRecord[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; turns?: unknown };
    if (!parsed || parsed.version !== LOCAL_AGENT_STORE_VERSION || !Array.isArray(parsed.turns)) return [];
    return turnsByThread(
      parsed.turns.flatMap((turn) => {
        const cleaned = cleanTurn(turn, "cancelled");
        return cleaned ? [cleaned] : [];
      }),
    ).flatMap((thread) => thread.turns);
  } catch {
    return [];
  }
};

export const serializeLocalAgentTurns = (turns: readonly unknown[]) => (
  JSON.stringify({ version: LOCAL_AGENT_STORE_VERSION, turns: compactLocalAgentTurns(turns) })
);

export const saveLocalAgentTurns = (storage: StorageLike, key: string, turns: readonly unknown[]) => {
  let remaining = compactLocalAgentTurns(turns);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      storage.setItem(key, JSON.stringify({ version: LOCAL_AGENT_STORE_VERSION, turns: remaining }));
      return remaining;
    } catch {
      const threads = turnsByThread(remaining);
      if (threads.length > 1) {
        remaining = threads.slice(0, -1).flatMap((thread) => thread.turns);
        continue;
      }
      if (remaining.length <= 1) return null;
      remaining = remaining.slice(Math.ceil(remaining.length / 2));
    }
  }
  return null;
};

export const resolveLocalAgentThreadId = (
  stored: string | null,
  turns: readonly { threadId: string; createdAt: string }[],
) => {
  if (isThreadId(stored)) return stored;
  let latest: { threadId: string; createdAt: string } | null = null;
  for (const turn of turns) {
    if (!latest || turn.createdAt > latest.createdAt) latest = turn;
  }
  return latest?.threadId ?? null;
};

export const chatThreadsFromTurns = (
  turns: readonly { threadId: string; message: string; createdAt: string }[],
): ChatThreadSummary[] => {
  const byId = new Map<string, ChatThreadSummary & { oldestAt: string }>();
  for (const turn of turns) {
    const title = turn.message.replace(/\s+/g, " ").trim();
    const current = byId.get(turn.threadId);
    if (!current) {
      byId.set(turn.threadId, { id: turn.threadId, title, updatedAt: turn.createdAt, oldestAt: turn.createdAt });
      continue;
    }
    if (turn.createdAt > current.updatedAt) current.updatedAt = turn.createdAt;
    if (turn.createdAt < current.oldestAt && title) {
      current.oldestAt = turn.createdAt;
      current.title = title;
    }
  }
  return [...byId.values()]
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
    .map(({ oldestAt: _oldestAt, ...thread }) => thread);
};

const clipLine = (value: string) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > LOCAL_AGENT_TRANSCRIPT_LINE ? `${text.slice(0, LOCAL_AGENT_TRANSCRIPT_LINE)}…` : text;
};

// Sent only when the desktop has to start a new ACP process. A live chat already has this history.
export const localAgentTranscript = (
  turns: readonly { threadId: string; message: string; response: string; status: string; createdAt: string }[],
  threadId: string,
) => {
  const prior = turns
    .filter((turn) => turn.threadId === threadId && turn.status !== "running" && turn.message.trim())
    .slice()
    .sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1))
    .slice(-LOCAL_AGENT_TRANSCRIPT_TURNS);
  const lines: string[] = [];
  for (const turn of prior) {
    lines.push(`User: ${clipLine(turn.message)}`);
    const reply = clipLine(turn.response);
    if (reply) lines.push(`Assistant: ${reply}`);
  }
  while (lines.length > 1 && lines.join("\n").length > LOCAL_AGENT_TRANSCRIPT_LIMIT) lines.shift();
  const text = lines.join("\n");
  if (!text || text.length > LOCAL_AGENT_TRANSCRIPT_LIMIT) return text.slice(-LOCAL_AGENT_TRANSCRIPT_LIMIT);
  return `Earlier turns in this chat:\n${text}`;
};
