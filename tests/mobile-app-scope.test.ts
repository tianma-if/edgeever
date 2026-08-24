import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(
  new URL("../apps/mobile/src/screens/WorkspaceScreen.tsx", import.meta.url),
  "utf8"
);
const memoDetailSource = readFileSync(
  new URL("../apps/mobile/src/screens/WorkspaceMemoDetail.tsx", import.meta.url),
  "utf8"
);
const localTiptapEditorSource = readFileSync(
  new URL("../apps/mobile/src/components/LocalTiptapEditor.tsx", import.meta.url),
  "utf8"
);
const notesViewSource = readFileSync(
  new URL("../apps/mobile/src/screens/WorkspaceNotesView.tsx", import.meta.url),
  "utf8"
);
const mobileDomSource = readFileSync(
  new URL("../apps/mobile/src/lib/mobile-dom.ts", import.meta.url),
  "utf8"
);
const appJson = JSON.parse(
  readFileSync(new URL("../apps/mobile/app.json", import.meta.url), "utf8")
) as {
  expo: {
    ios?: {
      infoPlist?: Record<string, unknown>;
      supportsTablet?: boolean;
    };
  };
};
const accountSecuritySource = readFileSync(
  new URL("../apps/mobile/src/screens/AccountSecurityModal.tsx", import.meta.url),
  "utf8"
);

describe("mobile app scope", () => {
  test("keeps workspace administration out of the native app", () => {
    for (const removedCapability of [
      "ApiTokensModal",
      "ResourcesModal",
      "TagsManagerModal",
      "createApiToken",
      "deleteApiToken",
      "mergeMemos",
    ]) {
      expect(workspaceSource).not.toContain(removedCapability);
    }
  });

  test("does not initialize a hidden WebView during workspace startup", () => {
    expect(workspaceSource).not.toContain("EditorRuntimePrewarm");
    expect(workspaceSource).not.toContain("editorRuntimeWarm");
  });

  test("limits account security to the signed-in user", () => {
    for (const removedCapability of ["createUser", "listUsers", "updateUser"]) {
      expect(accountSecuritySource).not.toContain(removedCapability);
    }
  });

  test("keeps version history reachable from an active note", () => {
    expect(memoDetailSource).toMatch(
      /\{memo && !memo\.isDeleted \? \(\s*<Pressable\s+accessibilityLabel="版本历史"/
    );
    expect(memoDetailSource).toContain('syncStatus === "conflict"');
    expect(memoDetailSource).toContain("onResolveSyncConflict");
  });

  test("renders note detail body with the shared read-only TipTap viewer", () => {
    expect(memoDetailSource).toContain('mode="viewer"');
    expect(memoDetailSource).toContain("LocalTiptapEditor");
    expect(memoDetailSource).not.toContain("react-native-markdown-display");
  });

  test("carries workspace search into note detail and scrolls active matches", () => {
    expect(workspaceSource).toContain('initialSearchQuery={selectedMemoId ? searchText.trim() : ""}');
    expect(memoDetailSource).toContain("metadataSearchMatchCount + bodySearchMatchCount");
    expect(memoDetailSource).toContain("const retryTimers = [120, 360]");
    expect(localTiptapEditorSource).toContain("createMobileNoteSearchHighlightPlugin");
    expect(localTiptapEditorSource).toContain("scrollEditorPositionIntoView(editor, match.from");
  });

  test("keeps the Android editor caret visible while the keyboard viewport changes", () => {
    expect(workspaceSource).toContain("KeyboardAvoidingView");
    expect(workspaceSource).toContain('enabled={Platform.OS === "android"}');
    expect(localTiptapEditorSource).toContain('visualViewport?.addEventListener("resize", ensureSelectionVisible)');
    expect(localTiptapEditorSource).toContain("--edgeever-keyboard-inset");
    expect(localTiptapEditorSource).toContain("scrollEditorPositionIntoView(editor, editor.state.selection.head)");
  });

  test("keeps Android memo list motion and spring feedback", () => {
    expect(notesViewSource).toContain("FadeInDown.duration(260).springify().damping(18)");
    expect(notesViewSource).toContain("FadeOutUp.duration(220)");
    expect(notesViewSource).toContain("LinearTransition.duration(220)");
    expect(notesViewSource).toContain("pressScale.value = withTiming(0.985");
    expect(notesViewSource).toContain("pressScale.value = withTiming(1");
  });

  test("hardens DOM/WebView hosts against media capture probes during App Review", () => {
    expect(mobileDomSource).toContain('mediaCapturePermissionGrantType: "deny"');
    expect(mobileDomSource).toContain("mediaPlaybackRequiresUserAction: true");
    expect(workspaceSource).toContain("SAFE_DOM_WEBVIEW_PROPS");
    expect(memoDetailSource).toContain("SAFE_DOM_WEBVIEW_PROPS");
  });

  test("reads the latest create and upload state from the hardware-back handler", () => {
    expect(workspaceSource).toContain("createPendingRef.current || imageOperationRef.current");
  });

  test("focuses the note body instead of the title when creating a note", () => {
    const createMemoSource = workspaceSource.slice(
      workspaceSource.indexOf("const CreateMemoModal ="),
      workspaceSource.indexOf("const RichEditorModal =")
    );
    const titleInput = createMemoSource.match(
      /<TextInput\s+autoCorrect\s+accessibilityLabel="笔记标题"[\s\S]*?\/>/
    )?.[0];

    expect(createMemoSource).toMatch(/<LocalTiptapEditor\s+autoFocus\s/);
    expect(createMemoSource).toContain("scheduleBodyKeyboard(180, false)");
    expect(titleInput).toBeDefined();
    expect(titleInput).not.toContain("autoFocus");
    expect(createMemoSource).not.toContain("scheduleTitleFocus");
  });

  test("keeps editor startup recoverable and avoids competing autofocus paths", () => {
    expect(workspaceSource).toContain("MOBILE_EDITOR_STARTUP_TIMEOUT_MS");
    expect(workspaceSource).toContain("MobileEditorStartupOverlay");
    expect(workspaceSource).toContain("key={editorStartup.attempt}");
    expect(localTiptapEditorSource).toContain("autofocus: false");
    expect(localTiptapEditorSource).toContain('import("mermaid/dist/mermaid.min.js")');
    expect(localTiptapEditorSource).toContain('import("beautiful-mermaid")');
    expect(localTiptapEditorSource).toContain('import("html-to-image")');
    expect(localTiptapEditorSource).not.toContain('import "mermaid/dist/mermaid.min.js"');
  });

  test("declares iOS privacy strings and full-screen phone-on-iPad presentation", () => {
    const infoPlist = appJson.expo.ios?.infoPlist ?? {};
    expect(appJson.expo.ios?.supportsTablet).toBe(false);
    expect(infoPlist.UIRequiresFullScreen).toBe(true);
    expect(String(infoPlist.NSMicrophoneUsageDescription ?? "")).toMatch(/microphone/i);
    expect(String(infoPlist.NSCameraUsageDescription ?? "")).toMatch(/camera/i);
  });
});
