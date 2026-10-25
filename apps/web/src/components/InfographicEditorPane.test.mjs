import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./InfographicEditorPane.tsx", import.meta.url), "utf8");

describe("infographic editor header", () => {
  test("uses the shared note title row instead of a separate save and export bar", () => {
    const topRow = source.indexOf('cn(MEMO_EDITOR_TOP_ROW_CLASS_NAME, "border-b-0")');
    const metadata = source.indexOf("<MemoEditorMetadataRow");
    const status = source.indexOf("ref={setHeaderStatusCluster}");
    const headerEnd = source.indexOf("</header>");
    expect(topRow).toBeGreaterThan(-1);
    expect(metadata).toBeGreaterThan(topRow);
    expect(status).toBeGreaterThan(metadata);
    expect(headerEnd).toBeGreaterThan(status);
    expect(source).toContain("<MemoEditorHeaderActions");
    expect(source).toContain('t("infographic.export")');
    expect(source).toContain("data-infographic-export");
    expect(source).toContain("rasterizeInfographicSvg");
    expect(source).toContain('t("infographic.exportSvg")');
    expect(source).toContain('t("infographic.exportPng")');
    expect(source).not.toContain("toDataURL");
    expect(source).not.toContain("<PieChart");
    expect(source).not.toContain('t("infographic.save")');
    expect(source).toContain("parseTagsText(tagsRef.current)");
    expect(source).toContain("repository.moveMemos");
    expect(source).not.toContain("MemoEditorUpdatedLabel");
    expect(source).not.toContain("formatDateTime(memo.updatedAt)");
  });

  test("gives the preview the editor column and sends generation through the sidebar", () => {
    expect(source).not.toContain("lg:grid-cols-[minmax(300px,34%)_1fr]");
    expect(source).not.toContain('t("infographic.historyTitle")');
    expect(source).not.toContain('id="infographic-prompt"');
    expect(source).toContain("data-ai-assistant-launcher");
    expect(source).toContain("<AiSidebar");
    expect(source).toContain("infographic={infographicAssistant}");
    expect(source).toContain("nextInfographicNoteTitle");
    expect(source).toContain("infographicSessionHistory");
    expect(source).toContain("onCreateSession");
    expect(source).toContain("activeSessionId");
    expect(source).toContain("edgeever-infographic-preview");
  });
});
