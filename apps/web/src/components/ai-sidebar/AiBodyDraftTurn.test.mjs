import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sidebar = read("./AiSidebar.tsx");
const panel = read("./AiBodyDraftTurn.tsx");
const hook = read("./useAiBodyDraft.ts");
const editor = read("../EditorPane.tsx");
const store = read("../../lib/ai-body-draft-store.ts");
const mirror = read("../../lib/local-mirror.ts");

describe("sidebar body drafts (#652 PR B)", () => {
  test("a draft is one turn of the conversation, in time order, with the request and its result", () => {
    expect(panel).toContain('<Message from="user">');
    expect(panel).toContain('<Message from="assistant">');
    expect(sidebar).toContain("const draftSlot = currentDraft ? visibleTurns.filter((turn) => turn.createdAt <= currentDraft.createdAt).length : -1;");
    expect(sidebar).toContain("{index === draftSlot ? draftTurn : null}");
    expect(sidebar).not.toContain("<AiBodyDraftPanel");
  });

  test("/translate, /improve and selection Translate run on the instance model; other turns stay with the Agent", () => {
    expect(sidebar).toContain("if (skill && onBodySkill?.(skill.id, skill.rest, raw)) return;");
    expect(sidebar).toContain('if (request.kind === "translate" && selectionPin && runBodySkill("translate", "", selectionAiUserMessage({');
    expect(sidebar).toContain("if (runBodySkill(skill.id, \"\", t(`aiAssistant.sidebar.skills.${skill.id}`))) return;");
    expect(sidebar).toContain("const bodyDraftEnabled = Boolean(aiDraftEditor && memoId && companionAvailable);");
    // Explain and free-form chat still launch Agent turns.
    expect(sidebar).toContain("void launch(message, { readOnly: true })");
    expect(hook).toContain("await api.streamAiGeneration({");
  });

  test("a translation without a language asks which one before generating", () => {
    expect(hook).toContain('if (command.action === "translate" && !command.targetLanguage) {');
    expect(hook).toContain("awaitingLanguage: true");
    // The same target-language select as the former AI assistant dialog, then Translate.
    expect(panel).toContain('<SelectTrigger aria-label={t("aiAssistant.targetLanguage")}');
    expect(panel).toContain("getDefaultAiTargetLanguage(i18n.language)");
    expect(panel).toContain("onClick={() => onRegenerate(language)}");
    // No language switch once a result is there.
    expect(panel.match(/AI_TARGET_LANGUAGES\.map/g)).toHaveLength(1);
  });

  test("only a finished, complete draft on an unchanged target can replace", () => {
    expect(panel).toContain("const replaceDisabled = draft.generating || !hasText || draft.incomplete !== null;");
    expect(hook).toContain("if (replaceBlocked(current.incomplete, current.generating)) return \"failed\";");
    expect(hook).toContain('return { kind: "note-changed" };');
    expect(hook).toContain('return { kind: "selection-changed", current: editor.currentSelection() };');
    expect(editor).toContain("if (sourceEditor.sliceText(snapshot.from, snapshot.to) !== snapshot.text) return false;");
    expect(editor).toContain("hashAiDraftSource(getAiDocumentFingerprint(currentEditor.state.doc.toJSON())) === snapshot.documentHash");
    expect(editor).toContain("aiDraftEditor={aiDraftEditor}");
  });

  test("the last unapplied draft is kept per instance, user and note, outside the main local database", () => {
    expect(store).toContain('super("edgeever-ai-drafts");');
    expect(store).toContain('drafts: "[scope+memoId], scope, createdAt"');
    expect(hook).toContain("void loadAiBodyDraft(scope, memoId)");
    expect(hook).toContain("if (text.trim()) await persist(finished);");
    expect(hook).toContain("await clearAiBodyDraft(scope, memoId);");
    expect(mirror).toContain("await clearAiBodyDraftScope(scope);");
    // The main database keeps its schema version, so older app versions can still open it.
    expect(read("../../lib/local-db.ts")).not.toContain("this.version(7)");
  });
});
