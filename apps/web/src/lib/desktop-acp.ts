export type DesktopAcpAdapterId = "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl";
export type DesktopAcpAdapterState = "not_installed" | "not_probed" | "installing" | "needs_login" | "available" | "failed";

export type DesktopAcpPromptCapabilities = {
  image?: boolean;
  embeddedContext?: boolean;
};

export type DesktopAcpAdapter = {
  id: DesktopAcpAdapterId;
  label: string;
  state: DesktopAcpAdapterState;
  detail?: string;
  promptCapabilities?: DesktopAcpPromptCapabilities;
  version?: string;
  managed?: boolean;
  updateError?: string;
  customPath?: string;
  authMethods?: Array<{ id: string; name: string }>;
};

export const desktopAcpUpdateErrorHintKey = (reason: string) => {
  if (/timeout|timed.?out/i.test(reason)) return "aiAssistant.agentSource.updateTimeoutHint";
  if (/fetch failed|ERR_(?:NETWORK|PROXY|CONNECTION)|ECONN|ENOTFOUND|EAI_AGAIN/i.test(reason)) return "aiAssistant.agentSource.updateNetworkHint";
  return null;
};

// Offer only login methods advertised by the agent. Unreadable saved tokens
// require a different remedy and must not invite a futile sign-in loop.
export const desktopAcpLoginRetryAvailable = (adapter: DesktopAcpAdapter | undefined) => Boolean(
  adapter?.state === "failed" &&
  (adapter.id === "workbuddyCn" || adapter.id === "workbuddyIntl") &&
  adapter.detail !== "workbuddy_credentials_unavailable" &&
  adapter.authMethods?.some((method) => adapter.id === "workbuddyCn" ? method.id !== "external" : method.id !== "internal")
);

export const displayedDesktopAcpAdapter = ({
  id,
  path,
  listed,
  probed,
}: {
  id: DesktopAcpAdapterId;
  path: string;
  listed: DesktopAcpAdapter[];
  probed: DesktopAcpAdapter | null;
}): DesktopAcpAdapter | undefined => {
  const current = listed.find((adapter) => adapter.id === id);
  const checked = probed?.id === id ? probed : undefined;
  if (id === "antigravity" && path.trim()) {
    return current?.customPath === path.trim() ? current : checked;
  }
  if (current?.customPath) return checked;
  if (current?.state === "installing" || (current?.managed && (!checked?.managed || current.version !== checked.version))) return current;
  if (checked?.state === "available" && (current?.state === "needs_login" || current?.state === "failed" || current?.state === "not_installed")) return current;
  return checked && current ? { ...checked, updateError: current.updateError } : checked ?? current;
};

export const desktopAcpSelectorVisible = (adapter: DesktopAcpAdapter, customPath: string) => (
  adapter.state !== "not_installed" || (adapter.id === "antigravity" && Boolean(customPath.trim()))
);

export const desktopAcpAutomaticProbeInput = (adapter: DesktopAcpAdapter, customPath: string) => {
  if (adapter.state === "installing") return null;
  if (adapter.id === "antigravity" && customPath.trim()) return { id: adapter.id, path: customPath.trim() };
  if (adapter.state === "not_probed" || adapter.detail === "not_probed" || adapter.state === "failed") return { id: adapter.id };
  return null;
};

export type DesktopAcpAttachment = {
  filename: string;
  mediaType: string;
  dataBase64: string;
};

export type DesktopAcpPromptInput = {
  adapterId: DesktopAcpAdapterId;
  path?: string;
  prompt: string;
  contextText?: string;
  // Replayed only when this chat has no live ACP process. A live session already contains it.
  historyText?: string;
  // Keeps one agent process for this sidebar chat. Omit it for a one-shot call.
  sessionKey?: string;
  attachments?: DesktopAcpAttachment[];
  // Infographic edits apply a validated proposal in the editor. They must not
  // also grant the agent write access to the note document.
  noteAccess?: boolean;
};

export type DesktopAcpPromptResult = {
  requestId: string;
  rejectedAttachments?: Array<{ filename: string; reason: string }>;
};

export type DesktopAcpEvent =
  | { requestId: string; type: "text-delta"; text: string; messageId?: string }
  | { requestId: string; type: "reasoning"; text: string }
  | { requestId: string; type: "tool"; name: string; status: string; title?: string }
  | { requestId: string; type: "image"; id: string; mediaType: string; base64: string }
  | { requestId: string; type: "done" }
  | { requestId: string; type: "error"; message: string };

export const AI_SIDEBAR_WIDTH_KEY = "edgeever.aiSidebar.width";
export const AI_SIDEBAR_OPEN_KEY = "edgeever.aiSidebar.open";
export const AI_SIDEBAR_THREAD_KEY = "edgeever.aiSidebar.thread";
export const AI_SIDEBAR_LOCAL_THREAD_KEY = "edgeever.aiSidebar.localThread";
export const AI_SIDEBAR_LOCAL_THREADS_KEY = "edgeever.aiSidebar.localThreads";
export const AI_SIDEBAR_SOURCE_KEY = "edgeever.aiSidebar.source";
export const AI_SIDEBAR_ADAPTER_KEY = "edgeever.aiSidebar.adapterId";
export const AI_SIDEBAR_ADAPTER_PATH_KEY = "edgeever.aiSidebar.adapterPath";
export const AI_SIDEBAR_SELECTION_EVENT = "edgeever:ai-sidebar-selection";

export type AiSidebarSource = "builtin" | "local";

export const startsNewLocalAgentThread = (
  previous: { source: AiSidebarSource; adapterId: DesktopAcpAdapterId | null },
  next: { source: AiSidebarSource; adapterId: DesktopAcpAdapterId | null },
) => next.source === "local" && (previous.source !== "local" || previous.adapterId !== next.adapterId);

const AI_SIDEBAR_ADAPTER_IDS = new Set<string>([
  "codex", "claudeCode", "antigravity", "openClaw", "hermesAgent", "grokBuild", "deepseekHarness", "piAgent", "workbuddyCn", "workbuddyIntl",
]);

export const aiSidebarSourceFromStorage = (value: string | null, desktopAvailable: boolean): AiSidebarSource => (
  value === "local" && desktopAvailable ? "local" : "builtin"
);

export const aiSidebarAdapterFromStorage = (id: string | null, path: string | null): { id: DesktopAcpAdapterId; path?: string } | null => {
  if (!id || !AI_SIDEBAR_ADAPTER_IDS.has(id)) return null;
  const adapterId = id as DesktopAcpAdapterId;
  const trimmed = path?.trim() ?? "";
  return adapterId === "antigravity" && trimmed ? { id: adapterId, path: trimmed } : { id: adapterId };
};

const readStorageItem = (key: string) => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const readAiSidebarSource = (): AiSidebarSource => (
  aiSidebarSourceFromStorage(readStorageItem(AI_SIDEBAR_SOURCE_KEY), desktopAcpAvailable())
);

export const readAiSidebarAdapter = () => aiSidebarAdapterFromStorage(
  readStorageItem(AI_SIDEBAR_ADAPTER_KEY),
  readStorageItem(AI_SIDEBAR_ADAPTER_PATH_KEY),
);

// Keep the settings page and sidebar on the same existing preference keys.
export const selectAiSidebarAgent = (source: AiSidebarSource, adapterId?: DesktopAcpAdapterId) => {
  const storage = window.localStorage;
  const previousSource = storage.getItem(AI_SIDEBAR_SOURCE_KEY);
  const previousAdapter = storage.getItem(AI_SIDEBAR_ADAPTER_KEY);
  try {
    if (adapterId) storage.setItem(AI_SIDEBAR_ADAPTER_KEY, adapterId);
    storage.setItem(AI_SIDEBAR_SOURCE_KEY, source);
  } catch (error) {
    try {
      const preferences: Array<[string, string | null]> = [[AI_SIDEBAR_SOURCE_KEY, previousSource], [AI_SIDEBAR_ADAPTER_KEY, previousAdapter]];
      for (const [key, value] of preferences) {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      }
    } catch { /* Report the original preference-write failure. */ }
    throw error;
  }
  window.dispatchEvent(new Event(AI_SIDEBAR_SELECTION_EVENT));
};

const bridge = () => (typeof window === "undefined" ? undefined : window.edgeeverDesktop);

export const desktopAcpAvailable = () => Boolean(bridge()?.listAcpAdapters);

export const listDesktopAcpAdapters = async (): Promise<DesktopAcpAdapter[]> => {
  const desktop = bridge();
  if (!desktop?.listAcpAdapters) return [];
  const adapters = await desktop.listAcpAdapters();
  // Older desktop hosts encoded an unchecked connector as a failed connection.
  return adapters.map((adapter) => adapter.detail === "not_probed"
    ? { ...adapter, state: "not_probed" as const } : adapter);
};

export const probeDesktopAcpAdapter = async (input: { id: DesktopAcpAdapterId; path?: string }): Promise<DesktopAcpAdapter> => {
  const desktop = bridge();
  if (!desktop?.probeAcpAdapter) {
    return { id: input.id, label: input.id, state: "failed", detail: "desktop_unavailable" };
  }
  return desktop.probeAcpAdapter(input);
};

export const installDesktopAcpAdapter = async (id: Extract<DesktopAcpAdapterId, "codex" | "claudeCode" | "antigravity" | "piAgent">) => {
  const desktop = bridge();
  if (!desktop?.installAcpAdapter) throw new Error("desktop_acp_unavailable");
  return desktop.installAcpAdapter(id);
};

export const authenticateDesktopAcpAdapter = async (input: { id: DesktopAcpAdapterId; path?: string; methodId: string }): Promise<DesktopAcpAdapter> => {
  const desktop = bridge();
  if (!desktop?.authenticateAcpAdapter) throw new Error("desktop_acp_unavailable");
  return desktop.authenticateAcpAdapter(input);
};

export const prepareDesktopAcp = async (input: Omit<DesktopAcpPromptInput, "prompt" | "contextText" | "historyText" | "attachments">) => {
  const desktop = bridge();
  if (!desktop?.prepareAcp || !input.sessionKey) return { ready: false as const };
  return desktop.prepareAcp(input);
};

export const promptDesktopAcp = async (input: DesktopAcpPromptInput): Promise<DesktopAcpPromptResult> => {
  const desktop = bridge();
  if (!desktop?.promptAcp) throw new Error("desktop_acp_unavailable");
  return desktop.promptAcp(input);
};

export const cancelDesktopAcp = async (requestId: string) => {
  const desktop = bridge();
  if (!desktop?.cancelAcp) return { ok: true as const };
  return desktop.cancelAcp(requestId);
};

export const subscribeDesktopAcp = (callback: (event: DesktopAcpEvent) => void) => {
  const desktop = bridge();
  if (!desktop?.onAcpEvent) return () => undefined;
  return desktop.onAcpEvent(callback);
};

export const desktopAcpNoteAccessErrorKey = (message: string) => {
  switch (message) {
    case "note_access_network": return "aiAssistant.sidebar.noteAccessNetwork";
    case "note_access_login_required": return "aiAssistant.sidebar.noteAccessLoginRequired";
    case "note_access_changed": return "aiAssistant.sidebar.noteAccessChanged";
    case "note_access_unavailable": return "aiAssistant.sidebar.noteAccessUnavailable";
    default: return null;
  }
};
