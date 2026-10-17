import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { enUS } from "../packages/shared/src/i18n/en-US";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const androidAssistantSource = readSource("../apps/mobile/src/components/MobileAiAssistantModal.tsx");
const androidEditorSource = readSource("../apps/mobile/src/components/LocalTiptapEditor.tsx");
const androidDetailSource = readSource("../apps/mobile/src/screens/WorkspaceMemoDetail.tsx");
const androidWorkspaceSource = [
  readSource("../apps/mobile/src/screens/WorkspaceScreen.tsx"),
  readSource("../apps/mobile/src/screens/WorkspaceEditors.tsx"),
  readSource("../apps/mobile/src/screens/WorkspacePickers.tsx"),
].join("\n");
const androidSessionSource = readSource("../apps/mobile/src/lib/session.tsx");
const iosAssistantSource = readSource("../apps/ios/EdgeEver/Features/Workspace/AiAssistantSheet.swift");
const iosDetailSource = readSource("../apps/ios/EdgeEver/Features/Workspace/MemoDetailView.swift");
const iosEditorSource = readSource("../apps/ios/EdgeEver/Features/Workspace/MemoEditView.swift");
const iosApiSource = readSource("../apps/ios/EdgeEver/Data/Network/APIClient.swift");

describe("native mobile AI note assistant", () => {
  test("exposes all five first-version actions on Android and iOS", () => {
    for (const action of [
      "summarize",
      "extract-key-points",
      "extract-todos",
      "rewrite-proofread",
      "translate",
    ]) {
      expect(Object.keys(enUS.aiAssistant.actions)).toContain(action);
    }
    expect(androidAssistantSource).toContain("getMobileCatalog(resolvedLocale).aiAssistant.actions");

    for (const action of [
      "case summarize",
      'case extractKeyPoints = "extract-key-points"',
      'case extractTodos = "extract-todos"',
      'case rewriteProofread = "rewrite-proofread"',
      "case translate",
    ]) {
      expect(readSource("../apps/ios/EdgeEver/Data/Models/Models.swift")).toContain(action);
    }
  });

  test("streams AI output from the shared workspace configuration on both clients", () => {
    expect(androidAssistantSource).toContain("resolveAiAssistantOpenAction");
    expect(androidAssistantSource).toContain("readMobileAiAssistantLastAction");
    expect(androidEditorSource).toContain("readStoredAiAssistantLastActionPreference");
    expect(androidEditorSource).toContain("resolveAiAssistantOpenAction");
    expect(iosAssistantSource).toContain("lastAiAssistantAction");
    expect(iosAssistantSource).toContain("applyStoredOrDefaultAction");
    expect(readSource("../apps/ios/EdgeEver/Data/Preferences/PreferencesStore.swift")).toContain("edgeever.aiAssistant.lastAction");

    expect(androidAssistantSource).toContain("client!.listAiPrompts(resolvedLocale)");
    expect(androidAssistantSource).toContain("client.streamAiGeneration(");
    expect(androidAssistantSource).toContain("promptId: selectedPrompt.id");
    expect(androidWorkspaceSource).toContain("aiPromptsJson={aiPromptsJson}");
    expect(androidEditorSource).toContain("...(promptId ? { promptId } : {})");
    expect(androidSessionSource).toContain("fetch: expoFetch as typeof fetch");
    expect(androidSessionSource).toContain("directAiGeneration: true");
    expect(iosAssistantSource).toContain("env.session.client.listAiPrompts(locale: locale)");
    expect(iosAssistantSource).toContain("client.streamAiGeneration(input)");
    expect(iosAssistantSource).toContain("promptId: selectedPrompt?.id");
    expect(iosApiSource).toContain('path: "/api/v1/ai/generate/prepare"');
    expect(iosApiSource).toContain("streamDirectProvider");
    expect(iosApiSource).toContain('makeURL(path: "/api/v1/ai/generate")');
    expect(iosApiSource).toContain("for try await line in bytes.lines");
  });

  test("keeps AI output as a draft until append or replace is confirmed", () => {
    expect(androidAssistantSource).toContain('apply("append")');
    expect(androidAssistantSource).toContain('apply("replace")');
    expect(androidWorkspaceSource).toContain("localUpdateMemoMutation.mutateAsync");
    expect(androidWorkspaceSource).toContain("contentJson: markdownToDoc(contentMarkdown)");

    expect(iosAssistantSource).toContain("apply(.append)");
    expect(iosAssistantSource).toContain("apply(.replace)");
    expect(iosDetailSource).toContain("createMemoEditSession(memoId: sourceMemo.id)");
    expect(iosDetailSource).toContain("expectedRevision: sourceMemo.revision");
    expect(iosDetailSource).toContain("expectedContentHash: sourceMemo.contentHash");
  });

  test("keeps the assistant reachable from each native note action menu", () => {
    expect(androidDetailSource).toContain("label={getMobileCatalog(resolvedLocale).aiAssistant.title}");
    expect(androidDetailSource).toContain("setAiAssistantOpen(true)");
    expect(androidDetailSource).toContain("<MobileAiAssistantModal");
    expect(iosDetailSource).toContain('env.preferences.t("AI 笔记助手", en: "AI note assistant"');
    expect(iosDetailSource).toContain("AiAssistantSheet(memo: memo)");
  });

  test("suggests tags from native drafts and merges them without duplicates", () => {
    expect(androidWorkspaceSource).toContain("client.suggestAiTags({");
    expect(androidWorkspaceSource).toContain("contentMarkdown,");
    expect(androidWorkspaceSource).toContain("currentTags: selectedTags");
    expect(androidWorkspaceSource).toContain("onChange(Array.from(new Set([...selectedTags, ...additions])).slice(0, 24))");

    expect(iosApiSource).toContain('path: "/api/v1/ai/tag-suggestions"');
    expect(iosEditorSource).toContain("env.session.client.suggestAiTags(input)");
    expect(iosEditorSource).toContain("contentMarkdown: contentMarkdown");
    expect(iosEditorSource).toContain("currentTags: currentTags");
    expect(iosEditorSource).toContain("tagsText = (currentTags + additions).joined(separator: \", \")");
  });
});
