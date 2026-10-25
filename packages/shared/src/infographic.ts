import { Base64 } from "js-base64";
import { z } from "zod";

export const INFOGRAPHIC_SCHEMA_VERSION = 1 as const;
export const INFOGRAPHIC_AGENT_SOURCE_MAX_LENGTH = 100_000;
const MARKER = "edgeever-infographic-v1";
const COMMENT = /<!--\s*edgeever-infographic-v1:([A-Za-z0-9_-]+)\s*-->/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type InfographicDocument = {
  schemaVersion: typeof INFOGRAPHIC_SCHEMA_VERSION;
  // AntV Infographic's native source, separate from the visual diagram IR.
  syntax: string;
  history?: InfographicConversationTurn[];
  activeSessionId?: string;
};

export type InfographicConversationTurn = {
  id: string;
  prompt: string;
  createdAt: string;
  kind: "generated" | "refined" | "clarified" | "failed";
  resultTitle: string;
  response?: string;
  decision?: string;
  template?: string;
  error?: string;
  undoneAt?: string;
  sessionId?: string;
};

export const InfographicAgentRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
  locale: z.string().trim().min(2).max(35).optional(),
  currentTemplate: z.string().regex(/^[a-z0-9-]+$/).max(120).optional(),
  currentContent: z.string().max(INFOGRAPHIC_AGENT_SOURCE_MAX_LENGTH).default(""),
  candidates: z.array(z.string().regex(/^[a-z0-9-]+$/).max(120)).min(1).max(50),
  history: z.array(z.object({ prompt: z.string().max(1000), response: z.string().max(2000) })).max(12).default([]),
});

export type InfographicAgentRequest = z.infer<typeof InfographicAgentRequestSchema>;
export type InfographicAgentEvent =
  | { type: "start" }
  | { type: "text-delta"; text: string }
  | { type: "proposal"; template: string; data: Record<string, unknown>; explanation: string }
  | { type: "question"; question: string }
  | { type: "finish" }
  | { type: "error"; message: string };

// Only force a timeline for a clear request to replace the graphic's subject/structure.
// Mentioning a timeline in a comparison or asking to edit its label is insufficient.
export const infographicRequestsTimeline = (prompt: string) => {
  if (!/(发展历程|发展史|历史沿革|成长历程|时间线|时间轴|里程碑|timeline|chronolog)/i.test(prompt)) return false;
  if (/(对比|比较|差异|\bvs\b|补充|增加|添加|加上|加入|标题|文案|文字|不要|别|无需)/i.test(prompt)) return false;
  return /(?:换成|改成|改为|做成|生成|展示|画|制作|呈现|按时间顺序)/i.test(prompt) || prompt.trim().length <= 24;
};

export const createDefaultInfographicDocument = (): InfographicDocument => ({
  schemaVersion: INFOGRAPHIC_SCHEMA_VERSION,
  syntax: "",
});

export const infographicFallbackMarkdown = (document: InfographicDocument) =>
  document.syntax.trim() ? `\`\`\`infographic\n${document.syntax.trim()}\n\`\`\`` : "";

export const serializeInfographicDocument = (document: InfographicDocument) => {
  const fallback = infographicFallbackMarkdown(document);
  const marker = `<!-- ${MARKER}:${Base64.encodeURI(JSON.stringify(document))} -->`;
  return fallback ? `${fallback}\n\n${marker}` : marker;
};

export const hasInfographicDocumentMarker = (markdown: string | null | undefined) =>
  Boolean(markdown?.includes(`<!-- ${MARKER}:`));

export const stripInfographicDocumentMarker = (markdown: string) =>
  markdown.replace(/<!--\s*edgeever-infographic-v1:[\s\S]*?-->/g, "").trim();

export const parseInfographicDocument = (markdown: string | null | undefined): InfographicDocument | null => {
  const encoded = markdown?.match(COMMENT)?.[1];
  if (!encoded || encoded.length > 2_000_000) return null;
  try {
    const value: unknown = JSON.parse(Base64.decode(encoded));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const document = value as Record<string, unknown>;
    if (document.schemaVersion !== INFOGRAPHIC_SCHEMA_VERSION || typeof document.syntax !== "string" || document.syntax.length > 200_000) return null;
    const history = document.history;
    if (history !== undefined && (!Array.isArray(history) || !history.every((turn: unknown) => {
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) return false;
      const value = turn as Record<string, unknown>;
      return typeof value.id === "string" && typeof value.prompt === "string" && value.prompt.length <= 1000
        && typeof value.createdAt === "string" && (value.kind === "generated" || value.kind === "refined" || value.kind === "clarified" || value.kind === "failed")
        && typeof value.resultTitle === "string" && (value.response === undefined || typeof value.response === "string" && value.response.length <= 4000)
        && (value.decision === undefined || typeof value.decision === "string" && value.decision.length <= 500)
        && (value.template === undefined || typeof value.template === "string")
        && (value.error === undefined || typeof value.error === "string")
        && (value.undoneAt === undefined || typeof value.undoneAt === "string")
        && (value.sessionId === undefined || typeof value.sessionId === "string" && SESSION_ID.test(value.sessionId));
    }))) return null;
    const activeSessionId = document.activeSessionId;
    if (activeSessionId !== undefined && (typeof activeSessionId !== "string" || !SESSION_ID.test(activeSessionId))) return null;
    return {
      schemaVersion: INFOGRAPHIC_SCHEMA_VERSION,
      syntax: document.syntax,
      ...(history ? { history: history as InfographicConversationTurn[] } : {}),
      ...(typeof activeSessionId === "string" ? { activeSessionId } : {}),
    };
  } catch {
    return null;
  }
};

export const getInfographicSummary = (markdown: string | null | undefined) => ({
  infographic: Boolean(parseInfographicDocument(markdown)),
});
