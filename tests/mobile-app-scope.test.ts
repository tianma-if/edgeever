import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(
  new URL("../apps/mobile/src/screens/WorkspaceScreen.tsx", import.meta.url),
  "utf8"
);
const workspaceEditorsSource = readFileSync(
  new URL("../apps/mobile/src/screens/WorkspaceEditors.tsx", import.meta.url),
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
const iosWorkspaceViewSource = readFileSync(
  new URL("../apps/ios/EdgeEver/Features/Workspace/WorkspaceView.swift", import.meta.url),
  "utf8"
);
const iosMemoDetailSource = readFileSync(
  new URL("../apps/ios/EdgeEver/Features/Workspace/MemoDetailView.swift", import.meta.url),
  "utf8"
);
const mobilePickersSource = readFileSync(
  new URL("../apps/mobile/src/screens/WorkspacePickers.tsx", import.meta.url),
  "utf8"
);
const mobileTagsSource = readFileSync(
  new URL("../apps/mobile/src/lib/mobile-tags.ts", import.meta.url),
  "utf8"
);
const mobileLocalMirrorSource = readFileSync(
  new URL("../apps/mobile/src/lib/local-mirror.ts", import.meta.url),
  "utf8"
);
const iosLocalMirrorSource = readFileSync(
  new URL("../apps/ios/EdgeEver/Data/Database/LocalMirrorRepository.swift", import.meta.url),
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
    expect(memoDetailSource).toContain("{!memo.isDeleted ? (");
    expect(memoDetailSource).toContain("label={getMobileCatalog(resolvedLocale).editor.versionHistory}");
    expect(memoDetailSource).toContain("onPress={() => closeActionsAndRun(() => onOpenRevisions(memo))}");
    expect(memoDetailSource).toContain('syncStatus === "conflict"');
    expect(memoDetailSource).toContain("onResolveSyncConflict");
  });

  test("renders note detail body with the shared read-only TipTap viewer", () => {
    expect(memoDetailSource).toContain('mode={isEditing ? "editor" : "viewer"}');
    expect(memoDetailSource).toContain("LocalTiptapEditor");
    expect(memoDetailSource).not.toContain("react-native-markdown-display");
  });

  test("opens existing-note editing in place without a blocking getMemo", () => {
    const openRichEditorSource = workspaceSource.slice(
      workspaceSource.indexOf("const openRichEditor ="),
      workspaceSource.indexOf("const memos = useMemo"),
    );
    expect(openRichEditorSource).not.toContain("client.getMemo");
    expect(openRichEditorSource).not.toContain("listMobileSyncQueueItems");
    expect(openRichEditorSource).not.toContain("setSelectedMemoId(null)");
    expect(openRichEditorSource).toContain("setRichEditingSession");
    expect(workspaceSource).not.toContain("return <RichEditorModal");
    expect(memoDetailSource).toContain("useMobileRichEditor");
    expect(localTiptapEditorSource).toContain("editor.setEditable(!isViewer)");
    expect(memoDetailSource).toContain("{visible ? (");
    expect(memoDetailSource).toContain(") : null}");
    expect(memoDetailSource).toContain('accessibilityLabel="返回" accessibilityRole="button" disabled={editor.uploading}');
  });

  test("carries workspace search into note detail and scrolls active matches", () => {
    expect(workspaceSource).toContain('initialSearchQuery={selectedMemoId ? searchText.trim() : ""}');
    expect(memoDetailSource).toContain("metadataSearchMatchCount + bodySearchMatchCount");
    expect(memoDetailSource).toContain("const retryTimers = [120, 360]");
    expect(localTiptapEditorSource).toContain("createMobileNoteSearchHighlightPlugin");
    expect(localTiptapEditorSource).toContain("scrollEditorPositionIntoView(editor, match.from");
  });

  test("keeps in-note search on one icon row", () => {
    expect(memoDetailSource).toContain('accessibilityLabel="上一个搜索结果"');
    expect(memoDetailSource).toContain('accessibilityLabel="下一个搜索结果"');
    expect(memoDetailSource).toContain('accessibilityLabel="关闭搜索"');
    expect(memoDetailSource).not.toContain("label=\"上一个搜索结果\"");
    expect(memoDetailSource).not.toContain("label=\"下一个搜索结果\"");
    expect(memoDetailSource).not.toContain("label=\"关闭搜索\"");
    const stylesSource = readFileSync(
      new URL("../apps/mobile/src/screens/workspace-styles.ts", import.meta.url),
      "utf8",
    );
    expect(stylesSource).toMatch(/noteSearchPanel: \{[\s\S]*?flexDirection: "row"/);
  });

  test("keeps the Android editor caret visible while the keyboard viewport changes", () => {
    expect(workspaceEditorsSource).toContain("KeyboardAvoidingView");
    expect(workspaceEditorsSource).toContain('enabled={Platform.OS === "android"}');
    expect(localTiptapEditorSource).toContain('visualViewport?.addEventListener("resize", ensureSelectionVisible)');
    expect(localTiptapEditorSource).toContain("--edgeever-keyboard-inset");
    expect(localTiptapEditorSource).toContain("scrollEditorPositionIntoView(editor, editor.state.selection.head)");
  });

  test("puts specific tag filtering on the visible list chip instead of tagged/untagged toggles", () => {
    expect(notesViewSource).toContain("onOpenTagFilter");
    expect(notesViewSource).toContain('label={selectedTag ? `#${selectedTag}` : "按标签筛选"}');
    expect(notesViewSource).not.toContain('label="有标签"');
    expect(notesViewSource).not.toContain('label="无标签"');
    expect(workspaceSource).toContain("onOpenTagFilter={() => setTagFilterPickerOpen(true)}");

    expect(iosWorkspaceViewSource).toContain("store.showTagFilterPicker = true");
    expect(iosWorkspaceViewSource).toContain('env.preferences.t("按标签筛选", en: "Filter by tag"');
    expect(iosWorkspaceViewSource).not.toContain('env.preferences.t("有标签", en: "Tagged")');
    expect(iosWorkspaceViewSource).not.toContain('env.preferences.t("无标签", en: "Untagged")');
  });

  test("applies exact tag matching in the local memo list instead of json_each on the full note blob", () => {
    expect(workspaceSource).toContain("tag: memoView === \"notebook\" ? selectedTag ?? undefined : undefined");
    expect(mobileTagsSource).toContain("filterLocalMemosByExactTag");
    expect(mobileLocalMirrorSource).toContain("filterLocalMemosByExactTag");
    expect(mobileLocalMirrorSource).not.toContain("json_each(mobile_memos.data_json");
    expect(iosLocalMirrorSource).toContain("MobileUI.memoHasExactTag");
    expect(iosLocalMirrorSource).not.toContain("json_each(mobile_memos.data_json");
  });

  test("keeps Android memo list interactions free of spring and press-scale motion", () => {
    expect(notesViewSource).not.toContain("springify()");
    expect(notesViewSource).not.toContain("FadeInDown");
    expect(notesViewSource).not.toContain("FadeOutUp");
    expect(notesViewSource).not.toContain("LinearTransition");
    expect(notesViewSource).not.toContain("pressScale.value");
  });

  test("hardens DOM/WebView hosts against media capture probes during App Review", () => {
    expect(mobileDomSource).toContain('mediaCapturePermissionGrantType: "deny"');
    expect(mobileDomSource).toContain("mediaPlaybackRequiresUserAction: true");
    expect(workspaceEditorsSource).toContain("SAFE_DOM_WEBVIEW_PROPS");
    expect(memoDetailSource).toContain("SAFE_DOM_WEBVIEW_PROPS");
  });

  test("reads the latest create and upload state from the hardware-back handler", () => {
    expect(workspaceEditorsSource).toContain("createPendingRef.current || imageOperationRef.current");
  });

  test("focuses the note body instead of the title when creating a note", () => {
    const createMemoSource = workspaceEditorsSource.slice(
      workspaceEditorsSource.indexOf("export const CreateMemoModal ="),
      workspaceEditorsSource.indexOf("export const RichEditorModal =")
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
    expect(workspaceEditorsSource).toContain("MOBILE_EDITOR_STARTUP_TIMEOUT_MS");
    expect(workspaceEditorsSource).toContain("MobileEditorStartupOverlay");
    expect(workspaceEditorsSource).toContain("key={editorStartup.attempt}");
    expect(localTiptapEditorSource).toContain("autofocus: false");
    expect(localTiptapEditorSource).toContain('import("mermaid/dist/mermaid.min.js")');
    expect(localTiptapEditorSource).toContain('import("beautiful-mermaid")');
    expect(localTiptapEditorSource).toContain('import { toCanvas } from "html-to-image"');
    expect(localTiptapEditorSource).not.toContain('import "mermaid/dist/mermaid.min.js"');
  });

  test("lets view-mode change the note notebook without entering the editor", () => {
    expect(memoDetailSource).toContain('setViewerNotebookPickerOpen(true)');
    const selectNotebookSource = memoDetailSource.slice(
      memoDetailSource.indexOf("const handleViewerNotebookSelect ="),
      memoDetailSource.indexOf("const openViewerTags =")
    );
    expect(selectNotebookSource).toContain("setViewerNotebookId(nextNotebookId)");
    expect(selectNotebookSource).not.toContain("mutateAsync");
    expect(memoDetailSource).toContain("payload: { notebookId: viewerNotebookId, tags: viewerTags }");
    expect(memoDetailSource).toContain("onPress={() => void saveViewerMetadata()}");
    expect(memoDetailSource).toContain("includeAllNotes={false}");
    expect(memoDetailSource).toContain('accessibilityLabel="所在笔记本"');
    expect(memoDetailSource).toContain("handleViewerNotebookSelect");
    expect(mobilePickersSource).toContain("includeAllNotes = true");
    expect(iosMemoDetailSource).toContain("showNotebookPicker = true");
    expect(iosMemoDetailSource).toContain("moveMemoToNotebook");
    expect(iosMemoDetailSource).toContain("EditNotebookPickerSheet");
    expect(iosMemoDetailSource).toContain("notebookAffiliationControl");
  });

  test("declares iOS privacy strings and full-screen phone-on-iPad presentation", () => {
    const infoPlist = appJson.expo.ios?.infoPlist ?? {};
    expect(appJson.expo.ios?.supportsTablet).toBe(false);
    expect(infoPlist.UIRequiresFullScreen).toBe(true);
    expect(String(infoPlist.NSMicrophoneUsageDescription ?? "")).toMatch(/microphone/i);
    expect(String(infoPlist.NSCameraUsageDescription ?? "")).toMatch(/camera/i);
  });
});
