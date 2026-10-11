import { infographicRequestsTimeline } from "@edgeever/shared";
import {
  cancelDesktopAcp,
  promptDesktopAcp,
  subscribeDesktopAcp,
  type DesktopAcpEvent,
  type DesktopAcpPromptInput,
} from "./desktop-acp";
import { parseGeneratedOfficialData } from "./infographic-generation";

export type InfographicLocalProposal = {
  template: string;
  data: Record<string, unknown>;
  explanation: string;
};

export type InfographicLocalReply = {
  visibleText: string;
  proposal: InfographicLocalProposal | null;
  question: string;
  rejected: boolean;
};

const DATA_SHAPES = "chart={title,values:[{label,value:number}]}; comparison={title,compares:[{label,children:[{label,desc}]}]}; quadrant={title,compares:[four items]}; hierarchy={title,root:{label,children:[...]}}; relation={title,nodes:[{id,label}],relations:[{from,to}]}; sequence={title,sequences:[{label,desc}]}; list={title,lists:[{label,desc}]}.";

export const buildInfographicLocalAgentContext = (input: {
  prompt: string;
  currentTemplate?: string;
  currentContent: string;
  candidates: string[];
  history: Array<{ prompt: string; response: string }>;
}) => {
  const history = input.history.slice(-12).map((turn) => `User: ${turn.prompt}\nAssistant: ${turn.response}`).join("\n\n");
  return [
    "You edit one AntV infographic in EdgeEver. The current infographic content is the source of truth. Keep the current template for content-only changes, including replacing one comparison subject. Change the template when the data relationship changes. Choose only from the allowed template IDs. Preserve information the user did not ask to change. data.title is the note title: change it when the subject changes, and keep it when the user only edits details.",
    infographicRequestsTimeline(input.prompt)
      ? "The user requested one subject's development history. Choose an allowed sequence-timeline template and chronological events. Do not ask for clarification."
      : "Ask a short clarification only when you cannot make a useful edit.",
    "Do not edit files, run commands, or change the note yourself. EdgeEver applies one validated change.",
    "Reply in the user's language. First write one short sentence. Then add one fenced json block and nothing after it.",
    'The json block is either {"type":"proposal","template":"...","data":{...},"explanation":"..."} or {"type":"question","question":"..."}.',
    "Binary comparisons need exactly two compares with matching children. Use concise labels and complete content.",
    `Current template: ${input.currentTemplate ?? "none"}.`,
    `Current infographic content: ${input.currentContent.slice(0, 12_000) || "none"}.`,
    `Allowed templates: ${input.candidates.join(", ")}.`,
    `Data shapes: ${DATA_SHAPES}`,
    history ? `Previous turns:\n${history}` : "",
  ].filter(Boolean).join("\n");
};

export const visibleInfographicAgentReply = (raw: string) => {
  const withoutFences = raw.replace(/```(?:json)?\s*[\s\S]*?```/gi, "");
  const openFence = withoutFences.indexOf("```");
  const clipped = (openFence >= 0 ? withoutFences.slice(0, openFence) : withoutFences).trim();
  const payload = clipped.search(/\{\s*"(?:type|template|question)"/);
  if (payload < 0) return clipped;
  return clipped.slice(0, payload).trim();
};

const jsonRecord = (raw: string): Record<string, unknown> | null => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const value: unknown = JSON.parse(fenced.slice(first, last + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const explanationOf = (record: Record<string, unknown>) => (
  typeof record.explanation === "string" ? record.explanation.trim().slice(0, 500) : ""
);

export const parseInfographicLocalReply = (raw: string, candidates: string[], prompt: string): InfographicLocalReply => {
  const visibleText = visibleInfographicAgentReply(raw);
  const record = jsonRecord(raw);
  const questionText = record && typeof record.question === "string" ? record.question.trim().slice(0, 300) : "";
  if (record?.type === "question" && questionText) {
    return { visibleText: visibleText || questionText, proposal: null, question: questionText, rejected: false };
  }
  if (record && (record.type === "proposal" || typeof record.template === "string") && record.type !== "question") {
    const template = typeof record.template === "string" ? record.template : "";
    const timelineMismatch = infographicRequestsTimeline(prompt) && !template.startsWith("sequence-timeline-");
    const data = !timelineMismatch && candidates.includes(template) ? parseGeneratedOfficialData(JSON.stringify(record), template) : null;
    if (template && data) {
      const explanation = explanationOf(record);
      return {
        visibleText: visibleText || explanation,
        proposal: { template, data, explanation },
        question: "",
        rejected: false,
      };
    }
    if (record.type === "proposal" || timelineMismatch) {
      return { visibleText: visibleText || explanationOf(record), proposal: null, question: "", rejected: true };
    }
  }
  if (visibleText) return { visibleText, proposal: null, question: visibleText.slice(0, 300), rejected: false };
  return { visibleText: "", proposal: null, question: "", rejected: true };
};

export const infographicLocalAgentErrorKey = (message: string, adapterId: string | null) => {
  if (message === "workbuddy_credentials_unavailable") return "aiAssistant.agentSource.workbuddyCredentialsUnavailable";
  if (message === "needs_login") {
    return adapterId === "workbuddyCn" || adapterId === "workbuddyIntl"
      ? "aiAssistant.sidebar.workbuddyLoginRequired"
      : "aiAssistant.sidebar.localLoginRequired";
  }
  if (message === "agent_refused") return "aiAssistant.sidebar.agentRefused";
  if (message === "note_access_unavailable") return "aiAssistant.sidebar.noteAccessUnavailable";
  if (message === "not_installed" || message === "desktop_acp_unavailable") return "aiAssistant.sidebar.localMissing";
  return null;
};

type AcpTextDeps = {
  prompt: (input: DesktopAcpPromptInput) => Promise<{ requestId: string }>;
  subscribe: (callback: (event: DesktopAcpEvent) => void) => () => void;
  cancel: (requestId: string) => Promise<unknown>;
};

export const collectInfographicLocalAgentText = async ({
  request,
  signal,
  onText,
  deps,
}: {
  request: DesktopAcpPromptInput;
  signal: AbortSignal;
  onText?: (visible: string) => void;
  deps?: AcpTextDeps;
}) => {
  const prompt = deps?.prompt ?? promptDesktopAcp;
  const subscribe = deps?.subscribe ?? subscribeDesktopAcp;
  const cancel = deps?.cancel ?? cancelDesktopAcp;
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  let requestId = "";
  let text = "";
  let settled = false;
  let failure: Error | null = null;
  const pending: DesktopAcpEvent[] = [];
  let resolveDone: (() => void) | null = null;
  let rejectDone: ((error: Error) => void) | null = null;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => undefined);
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    failure = error ?? null;
    if (error) rejectDone?.(error);
    else resolveDone?.();
  };
  const apply = (event: DesktopAcpEvent) => {
    if (!requestId || event.requestId !== requestId || settled) return;
    if (event.type === "text-delta") {
      text += event.text;
      onText?.(visibleInfographicAgentReply(text));
      return;
    }
    if (event.type === "error") finish(new Error(event.message || "connection_failed"));
    if (event.type === "done") finish();
  };
  const unsubscribe = subscribe((event) => {
    if (!requestId) pending.push(event);
    else apply(event);
  });
  const onAbort = () => {
    if (requestId) void cancel(requestId);
    finish(new DOMException("aborted", "AbortError"));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const started = await prompt(request);
    requestId = started.requestId;
    if (signal.aborted) {
      void cancel(requestId);
      throw new DOMException("aborted", "AbortError");
    }
    for (const event of pending.splice(0)) apply(event);
    if (!settled) await done;
    if (failure) throw failure;
    return text;
  } finally {
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
  }
};
