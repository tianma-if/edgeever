import { expect, test } from "bun:test";
import { codeBuddyAuthMethodLabelKey, desktopAcpUpdateErrorHintKey, desktopAcpLoginRetryAvailable, desktopAcpNoteAccessErrorKey, aiSidebarAdapterFromStorage, aiSidebarSourceFromStorage, displayedDesktopAcpAdapter } from "./desktop-acp.ts";

test("a checked custom Antigravity executable takes priority over the managed connector status", () => {
  const managed = { id: "antigravity", label: "Antigravity", state: "failed", version: "1.2.1", managed: true };
  const custom = { id: "antigravity", label: "Antigravity", state: "available" };
  const input = { id: "antigravity", path: "/tmp/agy-acp", listed: [managed], probed: custom };
  expect(displayedDesktopAcpAdapter(input)).toBe(custom);
  expect(displayedDesktopAcpAdapter({ ...input, probed: null })).toBeUndefined();
  expect(displayedDesktopAcpAdapter({ ...input, path: "" })).toBe(managed);
});

test("a newly installed managed connector takes priority over an older probe", () => {
  const current = { id: "antigravity", label: "Antigravity", state: "available", version: "1.2.2", managed: true };
  const previous = { id: "antigravity", label: "Antigravity", state: "failed", version: "1.2.1", managed: true };
  expect(displayedDesktopAcpAdapter({ id: "antigravity", path: "", listed: [current], probed: previous })).toBe(current);
});

test("the sidebar follows a stored local agent only when the desktop bridge exists", () => {
  expect(aiSidebarSourceFromStorage("local", true)).toBe("local");
  expect(aiSidebarSourceFromStorage("local", false)).toBe("builtin");
  expect(aiSidebarSourceFromStorage("builtin", true)).toBe("builtin");
  expect(aiSidebarAdapterFromStorage("codex", "/tmp/ignored")).toEqual({ id: "codex" });
  expect(aiSidebarAdapterFromStorage("antigravity", " /tmp/agy ")).toEqual({ id: "antigravity", path: "/tmp/agy" });
  expect(aiSidebarAdapterFromStorage("missing", "")).toBeNull();
});

test("CodeBuddy is a selectable local agent with region hints only for verified sign-in methods", () => {
  expect(aiSidebarAdapterFromStorage("codebuddy", "/tmp/ignored")).toEqual({ id: "codebuddy" });
  expect(codeBuddyAuthMethodLabelKey("internal")).toBe("aiAssistant.agentSource.codebuddyMethodInternal");
  for (const methodId of ["external", "iOA", "selfhosted", "unknown"]) expect(codeBuddyAuthMethodLabelKey(methodId)).toBeNull();
  // CodeBuddy signs in from the needs_login state; WorkBuddy's failed-state retry does not apply.
  expect(desktopAcpLoginRetryAvailable({ id: "codebuddy", state: "failed", authMethods: [{ id: "internal" }] })).toBe(false);
});

test("a prompt-time login failure takes priority over an earlier successful session probe", () => {
  const current = { id: "grokBuild", label: "Grok Build", state: "needs_login", authMethods: [{ id: "browser", name: "Browser" }] };
  const earlierProbe = { id: "grokBuild", label: "Grok Build", state: "available" };
  expect(displayedDesktopAcpAdapter({ id: "grokBuild", path: "", listed: [current], probed: earlierProbe })).toBe(current);
});

test("a prompt connection failure replaces a stale successful probe", () => {
  const earlierProbe = { id: "codex", label: "Codex", state: "available" };
  for (const state of ["failed", "needs_login", "not_installed"]) {
    const current = { id: "codex", label: "Codex", state };
    expect(displayedDesktopAcpAdapter({ id: "codex", path: "", listed: [current], probed: earlierProbe })).toBe(current);
  }
});

test("custom Antigravity failures replace only a probe for the same custom path", () => {
  const earlierProbe = { id: "antigravity", label: "Antigravity", state: "available" };
  const current = { id: "antigravity", label: "Antigravity", state: "failed", customPath: "/tmp/agy-acp" };
  const input = { id: "antigravity", path: "/tmp/agy-acp", listed: [current], probed: earlierProbe };
  expect(displayedDesktopAcpAdapter(input)).toBe(current);
  expect(displayedDesktopAcpAdapter({ ...input, path: "/tmp/another-acp" })).toBe(earlierProbe);
  expect(displayedDesktopAcpAdapter({ ...input, path: "" })).toBe(earlierProbe);
});

test("switching into an external agent starts a fresh chat without changing built-in chats", async () => {
  const { startsNewLocalAgentThread } = await import("./desktop-acp.ts");
  const builtin = { source: "builtin", adapterId: "codex" };
  const codex = { source: "local", adapterId: "codex" };
  const claude = { source: "local", adapterId: "claudeCode" };
  expect(startsNewLocalAgentThread(builtin, codex)).toBe(true);
  expect(startsNewLocalAgentThread(codex, claude)).toBe(true);
  expect(startsNewLocalAgentThread(codex, codex)).toBe(false);
  expect(startsNewLocalAgentThread(codex, builtin)).toBe(false);
});

test("agent selection reuses preference keys, preserves the custom path and notifies only after saving", async () => {
  const { selectAiSidebarAgent, AI_SIDEBAR_SELECTION_EVENT, AI_SIDEBAR_SOURCE_KEY, AI_SIDEBAR_ADAPTER_KEY, AI_SIDEBAR_ADAPTER_PATH_KEY } = await import("./desktop-acp.ts");
  const previousWindow = globalThis.window;
  const data = new Map([[AI_SIDEBAR_SOURCE_KEY, "builtin"], [AI_SIDEBAR_ADAPTER_KEY, "codex"], [AI_SIDEBAR_ADAPTER_PATH_KEY, "/custom/antigravity"]]);
  const snapshots = [];
  let fail = false;
  globalThis.window = {
    localStorage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => {
        if (fail && key === AI_SIDEBAR_SOURCE_KEY) { fail = false; throw new Error("storage full"); }
        data.set(key, value);
      },
      removeItem: key => data.delete(key),
    },
    dispatchEvent: event => snapshots.push({ type: event.type, source: data.get(AI_SIDEBAR_SOURCE_KEY), adapter: data.get(AI_SIDEBAR_ADAPTER_KEY) }),
  };
  try {
    selectAiSidebarAgent("local", "claudeCode");
    expect(snapshots).toEqual([{ type: AI_SIDEBAR_SELECTION_EVENT, source: "local", adapter: "claudeCode" }]);
    expect(data.get(AI_SIDEBAR_ADAPTER_PATH_KEY)).toBe("/custom/antigravity");
    selectAiSidebarAgent("builtin");
    expect(data.get(AI_SIDEBAR_ADAPTER_KEY)).toBe("claudeCode");
    fail = true;
    expect(() => selectAiSidebarAgent("local", "codex")).toThrow("storage full");
    expect(data.get(AI_SIDEBAR_SOURCE_KEY)).toBe("builtin");
    expect(data.get(AI_SIDEBAR_ADAPTER_KEY)).toBe("claudeCode");
    expect(snapshots).toHaveLength(2);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("older desktop hosts expose unchecked connectors as unchecked, not failed", async () => {
  const { listDesktopAcpAdapters, desktopAcpAutomaticProbeInput } = await import("./desktop-acp.ts");
  const previousWindow = globalThis.window;
  const unchecked = { id: "codex", label: "Codex", state: "failed", detail: "not_probed", version: "2.1.1", managed: true };
  const failed = { id: "hermesAgent", label: "Hermes Agent", state: "failed", detail: "connection_timeout" };
  globalThis.window = { edgeeverDesktop: { listAcpAdapters: async () => [unchecked, failed] } };
  try {
    const listed = await listDesktopAcpAdapters();
    expect(listed[0]).toEqual({ ...unchecked, state: "not_probed" });
    expect(listed[1]).toEqual(failed);
    expect(desktopAcpAutomaticProbeInput(listed[0], "")).toEqual({ id: "codex" });
    expect(desktopAcpAutomaticProbeInput(listed[1], "")).toEqual({ id: "hermesAgent" });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("automatic checks skip missing, installing, ready and login-required agents but honor custom Antigravity paths", async () => {
  const { desktopAcpAutomaticProbeInput } = await import("./desktop-acp.ts");
  const codex = { id: "codex", label: "Codex" };
  for (const state of ["not_installed", "installing", "available", "needs_login"]) {
    expect(desktopAcpAutomaticProbeInput({ ...codex, state }, " /custom/agy ")).toBeNull();
  }
  expect(desktopAcpAutomaticProbeInput({ ...codex, state: "not_probed" }, " /custom/agy ")).toEqual({ id: "codex" });
  const antigravity = { id: "antigravity", label: "Antigravity", state: "not_installed" };
  expect(desktopAcpAutomaticProbeInput(antigravity, " /custom/agy ")).toEqual({ id: "antigravity", path: "/custom/agy" });
  expect(desktopAcpAutomaticProbeInput({ ...antigravity, state: "installing" }, "/custom/agy")).toBeNull();
});

test("the quick selector hides absent connectors while keeping detected agents and custom Antigravity paths", async () => {
  const { desktopAcpSelectorVisible } = await import("./desktop-acp.ts");
  const absent = { id: "claudeCode", label: "Claude Code", state: "not_installed" };
  expect(desktopAcpSelectorVisible(absent, "")).toBe(false);
  expect(desktopAcpSelectorVisible(absent, "/custom/agy")).toBe(false);
  for (const state of ["not_probed", "installing", "needs_login", "available", "failed"]) {
    expect(desktopAcpSelectorVisible({ ...absent, state }, "")).toBe(true);
  }
  const custom = { ...absent, id: "antigravity" };
  expect(desktopAcpSelectorVisible(custom, " /custom/agy ")).toBe(true);
  expect(desktopAcpSelectorVisible(custom, "  ")).toBe(false);
});

test("note access failures distinguish network, EdgeEver sign-in, and account changes", () => {
  expect(desktopAcpNoteAccessErrorKey("note_access_network")).toBe("aiAssistant.sidebar.noteAccessNetwork");
  expect(desktopAcpNoteAccessErrorKey("note_access_login_required")).toBe("aiAssistant.sidebar.noteAccessLoginRequired");
  expect(desktopAcpNoteAccessErrorKey("note_access_changed")).toBe("aiAssistant.sidebar.noteAccessChanged");
  expect(desktopAcpNoteAccessErrorKey("note_access_unavailable")).toBe("aiAssistant.sidebar.noteAccessUnavailable");
  expect(desktopAcpNoteAccessErrorKey("needs_login")).toBeNull();
});

test("WorkBuddy connection failures keep an edition-specific sign-in recovery path", () => {
  for (const id of ["workbuddyCn", "workbuddyIntl"]) {
    const methodId = id === "workbuddyCn" ? "internal" : "external";
    const adapter = { id, state: "failed", authMethods: [{ id: methodId, name: "Browser" }] };
    expect(desktopAcpLoginRetryAvailable(adapter)).toBe(true);
    expect(desktopAcpLoginRetryAvailable({ ...adapter, detail: "workbuddy_credentials_unavailable" })).toBe(false);
    expect(desktopAcpLoginRetryAvailable({ ...adapter, authMethods: [] })).toBe(false);
    expect(desktopAcpLoginRetryAvailable({ ...adapter, authMethods: [{ id: methodId === "internal" ? "external" : "internal" }] })).toBe(false);
  }
  expect(desktopAcpLoginRetryAvailable(undefined)).toBe(false);
  expect(desktopAcpLoginRetryAvailable({ id: "codex", state: "failed", authMethods: [{ id: "browser" }] })).toBe(false);
});

test("settings preserves the latest update failure alongside an earlier successful connection probe", () => {
  const probed = { id: "antigravity", state: "available", version: "1.3.0", managed: true };
  const current = { ...probed, updateError: "download: timeout" };
  const input = { id: "antigravity", path: "", listed: [current], probed };
  expect(displayedDesktopAcpAdapter(input).updateError).toBe("download: timeout");
  expect(displayedDesktopAcpAdapter({ ...input, listed: [{ ...probed }] }).updateError).toBeUndefined();
});

test("update errors offer a network remedy while keeping unrelated failures distinct", () => {
  expect(desktopAcpUpdateErrorHintKey("download: The operation was aborted due to timeout")).toBe("aiAssistant.agentSource.updateTimeoutHint");
  expect(desktopAcpUpdateErrorHintKey("download: fetch failed (ETIMEDOUT)")).toBe("aiAssistant.agentSource.updateTimeoutHint");
  expect(desktopAcpUpdateErrorHintKey("registry: fetch failed (ENOTFOUND)")).toBe("aiAssistant.agentSource.updateNetworkHint");
  expect(desktopAcpUpdateErrorHintKey("extract: invalid_adapter_archive")).toBeNull();
});
