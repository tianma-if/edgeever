import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("AI assistant modes", () => {
  test("keeps the companion sidebar wired through the editor", () => {
    const editor = readFileSync(new URL("../EditorPane.tsx", import.meta.url), "utf8");
    const sidebar = readFileSync(new URL("../ai-sidebar/AiSidebar.tsx", import.meta.url), "utf8");
    expect(editor).toContain("<AiSidebar");
    expect(editor).toContain("companionAvailable={companionAvailable}");
    expect(editor).toContain("beforeCompanionApply={beforeCompanionApply}");
    expect(editor).not.toContain("<AiAssistantDialog");
    expect(editor).not.toContain("onApply={applyAiDraft}");
    expect(sidebar).toContain("companionAvailable");
    expect(sidebar).toContain("sidebarRevealTransition");
    expect(sidebar).not.toContain("{open && <AiSidebarSession");
    expect(sidebar).not.toContain("hidden w-0");
    expect(sidebar).toContain("<AiSidebarSession");
    expect(sidebar).not.toContain("props.infographic ? (");
    expect(sidebar).toContain("<InfographicSidebarSession");
    expect(sidebar).toContain("aiAssistant.sidebar.currentInfographic");
    expect(sidebar).toContain("<AiAgentSelector");
    const infographic = readFileSync(new URL("../ai-sidebar/InfographicSidebarSession.tsx", import.meta.url), "utf8");
    const mode = readFileSync(new URL("../ai-sidebar/SidebarAgentModeStatus.tsx", import.meta.url), "utf8");
    const status = readFileSync(new URL("../ai-sidebar/BuiltinAgentStatus.tsx", import.meta.url), "utf8");
    const pane = readFileSync(new URL("../InfographicEditorPane.tsx", import.meta.url), "utf8");
    expect(infographic).toContain("<SidebarAgentModeStatus");
    expect(infographic).not.toContain("<AiSidebarThreadMenu");
    expect(sidebar).toContain("<AiSidebarThreadMenu");
    expect(mode).toContain("readAiSidebarSource");
    expect(mode).toContain("<AiAgentSelector");
    expect(pane).toContain('readAiSidebarSource() === "local"');
    expect(pane).toContain("noteAccess: false");
    expect(status).toContain('data-ai-builtin-agent=""');
    expect(status).toContain('t("aiAssistant.agentSource.builtin")');
    expect(status).toContain('t("aiModel.noDefaultModel")');
  });

  test("agent mode opens a fresh thread and only resumes last chat on request", () => {
    const chat = readFileSync(new URL("../CompanionChat.tsx", import.meta.url), "utf8");
    expect(chat).toContain("useState<string>(() => crypto.randomUUID())");
    expect(chat).toContain('t("aiAssistant.modes.resumeLast")');
    expect(chat).not.toContain("sessionStorage.getItem");
    expect(chat).not.toContain("edgeever.assistant.threadId");
    expect(chat).toContain('event.key !== "Enter"');
    expect(chat).toContain("requestSubmit()");
    expect(chat).toContain("useMemory");
    expect(chat).not.toContain("useMemory: false");
    expect(chat).toContain("parseCompanionMentionQuery");
    expect(chat).toContain("resumeCompanionTurn");
  });
});
