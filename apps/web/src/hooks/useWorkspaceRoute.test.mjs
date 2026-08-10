import { describe, expect, test } from "bun:test";
import { resolveWorkspaceRoute } from "./useWorkspaceRoute.ts";

describe("workspace route resolution", () => {
  test("recognizes the four workspace destinations", () => {
    expect(resolveWorkspaceRoute("/", "")).toMatchObject({ isTrash: false, isSettings: false, isTemplates: false });
    expect(resolveWorkspaceRoute("/", "?view=trash").isTrash).toBe(true);
    expect(resolveWorkspaceRoute("/settings", "").isSettings).toBe(true);
    expect(resolveWorkspaceRoute("/templates", "").isTemplates).toBe(true);
  });

  test("only treats the canonical trash query as trash", () => {
    expect(resolveWorkspaceRoute("/", "?view=trash&extra=1").isTrash).toBe(false);
    expect(resolveWorkspaceRoute("/other", "?view=trash").isTrash).toBe(false);
  });

  test("extracts a standalone mobile editor return id", () => {
    expect(resolveWorkspaceRoute("/", "?mobileEditorReturn=memo-42").mobileEditorReturnMemoId).toBe("memo-42");
  });
});
