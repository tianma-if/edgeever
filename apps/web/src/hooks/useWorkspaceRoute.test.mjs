import { describe, expect, test } from "bun:test";
import { resolveWorkspaceRoute } from "./useWorkspaceRoute.ts";

describe("workspace route resolution", () => {
  test("recognizes the workspace destinations", () => {
    expect(resolveWorkspaceRoute("/", "")).toMatchObject({
      isTrash: false,
      isSettings: false,
      isPlugins: false,
      isTemplates: false,
      isAiPrompts: false,
      isCompanion: false,
      isExecutionCenter: false,
    });
    expect(resolveWorkspaceRoute("/", "?view=trash").isTrash).toBe(true);
    expect(resolveWorkspaceRoute("/settings", "").isSettings).toBe(true);
    expect(resolveWorkspaceRoute("/plugins", "").isPlugins).toBe(true);
    expect(resolveWorkspaceRoute("/plugins/org.edgeever.example", "").isPlugins).toBe(true);
    expect(resolveWorkspaceRoute("/templates", "").isTemplates).toBe(true);
    expect(resolveWorkspaceRoute("/ai-prompts", "").isAiPrompts).toBe(true);
    expect(resolveWorkspaceRoute("/companion", "").isCompanion).toBe(true);
    expect(resolveWorkspaceRoute("/execution-center", "").isExecutionCenter).toBe(true);
  });

  test("only treats the canonical trash query as trash", () => {
    expect(resolveWorkspaceRoute("/", "?view=trash&extra=1").isTrash).toBe(false);
    expect(resolveWorkspaceRoute("/other", "?view=trash").isTrash).toBe(false);
  });

  test("keeps the companion a standalone destination, independent of prompts and trash", () => {
    expect(resolveWorkspaceRoute("/companion", "?view=trash")).toMatchObject({
      isCompanion: true,
      isAiPrompts: false,
      isSettings: false,
      isTrash: false,
    });
    expect(resolveWorkspaceRoute("/ai-prompts", "").isCompanion).toBe(false);
    expect(resolveWorkspaceRoute("/companion-other", "").isCompanion).toBe(false);
  });

  test("extracts a standalone mobile editor return id", () => {
    expect(resolveWorkspaceRoute("/", "?mobileEditorReturn=memo-42").mobileEditorReturnMemoId).toBe("memo-42");
  });
});
