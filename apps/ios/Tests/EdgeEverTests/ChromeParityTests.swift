import AVFoundation
import XCTest
@testable import EdgeEver

/// Drives shipped create/detail chrome helpers + structural source markers (Android token roles).
final class ChromeParityTests: XCTestCase {
    // MARK: - Create save status (shipped CreateSaveStatus.derive)

    func testCreateSaveStatusPriorityMatchesAndroid() {
        XCTAssertEqual(
            CreateSaveStatus.derive(
                editorReady: false, isDirty: false, isSaving: false,
                isCreating: false, isUploading: false, hasError: false
            ),
            .starting
        )
        XCTAssertEqual(
            CreateSaveStatus.derive(
                editorReady: true, isDirty: false, isSaving: false,
                isCreating: false, isUploading: false, hasError: false
            ),
            .saved
        )
        XCTAssertEqual(
            CreateSaveStatus.derive(
                editorReady: true, isDirty: true, isSaving: false,
                isCreating: false, isUploading: false, hasError: false
            ),
            .saving
        )
        XCTAssertEqual(
            CreateSaveStatus.derive(
                editorReady: true, isDirty: false, isSaving: true,
                isCreating: false, isUploading: false, hasError: false
            ),
            .saving
        )
        // Upload / create win over dirty
        XCTAssertEqual(
            CreateSaveStatus.derive(
                editorReady: true, isDirty: true, isSaving: false,
                isCreating: true, isUploading: false, hasError: false
            ),
            .creating
        )
        XCTAssertEqual(
            CreateSaveStatus.derive(
                editorReady: true, isDirty: true, isSaving: false,
                isCreating: false, isUploading: true, hasError: false
            ),
            .uploading
        )
        XCTAssertEqual(
            CreateSaveStatus.derive(
                editorReady: true, isDirty: false, isSaving: false,
                isCreating: false, isUploading: false, hasError: true
            ),
            .error
        )
    }

    func testCreateSaveStatusLabels() {
        XCTAssertEqual(CreateSaveStatus.saving.labelZH, "保存中")
        XCTAssertEqual(CreateSaveStatus.saved.labelZH, "已保存")
        XCTAssertTrue(CreateSaveStatus.saving.isActive)
        XCTAssertFalse(CreateSaveStatus.saved.isActive)
    }

    // MARK: - Detail sync status (shipped DetailSyncStatus.derive)

    func testDetailSyncStatusFromOutbox() {
        XCTAssertEqual(DetailSyncStatus.derive(outboxStatus: nil, isGlobalSyncing: false), .synced)
        XCTAssertEqual(DetailSyncStatus.derive(outboxStatus: .pending, isGlobalSyncing: false), .pending)
        XCTAssertEqual(DetailSyncStatus.derive(outboxStatus: .syncing, isGlobalSyncing: false), .syncing)
        XCTAssertEqual(DetailSyncStatus.derive(outboxStatus: .conflict, isGlobalSyncing: false), .conflict)
        XCTAssertEqual(DetailSyncStatus.derive(outboxStatus: .error, isGlobalSyncing: false), .error)
        // Global sync elevates chip to syncing
        XCTAssertEqual(DetailSyncStatus.derive(outboxStatus: .pending, isGlobalSyncing: true), .syncing)
    }

    func testDetailSyncStatusLabelsAndInteraction() {
        XCTAssertEqual(DetailSyncStatus.synced.labelZH, "已同步")
        XCTAssertEqual(DetailSyncStatus.conflict.labelZH, "同步冲突")
        XCTAssertEqual(DetailSyncStatus.pending.labelZH, "待同步")
        XCTAssertTrue(DetailSyncStatus.pending.isInteractive)
        XCTAssertTrue(DetailSyncStatus.conflict.isInteractive)
        XCTAssertFalse(DetailSyncStatus.synced.isInteractive)
    }

    // MARK: - Structural source parity (read shipped Swift files)

    func testMemoEditViewUsesCreateChromeNotFormToolbar() throws {
        let src = try readShippedSource("Features/Workspace/MemoEditView.swift")
        // Must implement Android create shell roles
        XCTAssertTrue(src.contains("CreateMemoChrome.header") || src.contains("createMemoHeader"), src)
        XCTAssertTrue(src.contains("CreateMemoChrome.back"), "missing back chrome")
        XCTAssertTrue(src.contains("CreateMemoChrome.status"), "missing status chip")
        XCTAssertTrue(src.contains("CreateMemoChrome.done"), "missing Done button")
        XCTAssertTrue(src.contains("CreateMemoChrome.title"), "missing large title")
        XCTAssertTrue(src.contains("CreateMemoChrome.metaRow"), "missing meta row")
        XCTAssertTrue(src.contains("CreateMemoChrome.notebook"), "missing notebook control")
        XCTAssertTrue(src.contains("CreateMemoChrome.tags"), "missing tags field")
        XCTAssertTrue(src.contains("CreateMemoChrome.smartTags"), "missing one-tap smart tags control")
        XCTAssertTrue(src.contains("generateAndApplySmartTags"), "smart tags must generate and apply in one action")
        XCTAssertTrue(src.contains("tag.badge.plus"), "smart tags must use the same tag-plus metaphor as web and Android")
        XCTAssertFalse(src.contains("Image(systemName: \"tag\")"), "tags field must not repeat the tag icon beside the smart-tags control")
        XCTAssertFalse(src.contains("AI 推荐标签"), "tag picker must not retain the multi-step AI suggestion flow")
        XCTAssertTrue(src.contains("CreateMemoChrome.editorFrame"), "missing bordered editor")
        XCTAssertTrue(src.contains("TipTapWebView"), "editor wiring must remain")
        XCTAssertTrue(src.contains("commitCreate") || src.contains("persistDraftOrQueue"), "save path must remain")
        // Done must route through MemoCreateCommit (materialize-safe: update vs create)
        XCTAssertTrue(src.contains("MemoCreateCommit.commit"), "create Done must use MemoCreateCommit")
        // Android CreateMemoModal.requestClose always runs createMutation — Back must commit, not draft-only dismiss.
        XCTAssertTrue(
            src.contains("handleBack") && src.range(of: #"func handleBack[\s\S]*?commitCreate\(\)"#, options: .regularExpression) != nil,
            "create Back must call commitCreate (Android requestClose parity)"
        )
        // Must NOT use Form as primary create chrome (nested picker sheets may use List/nav).
        XCTAssertFalse(src.contains("Form {"), "Form-based primary chrome is not Android parity")
        // Primary shell is createHeader / createMain, not NavigationStack+toolbar chrome.
        XCTAssertTrue(src.contains("createHeader"), "custom createHeader required")
        XCTAssertTrue(src.contains("createMain"), "custom createMain required")
        XCTAssertFalse(src.contains("ToolbarItem(placement: .confirmationAction)"), "system Done toolbar not Android create chrome")
        XCTAssertFalse(src.contains("ToolbarItem(placement: .cancellationAction)"), "system Close toolbar not Android create chrome")
    }

    func testRegularCreateNeverRestoresOrPersistsPreviousCreateContent() throws {
        let src = try readShippedSource("Features/Workspace/MemoEditView.swift")

        XCTAssertFalse(
            src.contains("env.drafts.read(scope: scope, key: DraftRepository.newKey)"),
            "regular create must not restore the previous new-note draft"
        )
        XCTAssertFalse(
            src.contains("makeDraft(key: DraftRepository.newKey"),
            "regular create must not persist content for a later create session"
        )
        XCTAssertTrue(
            src.contains("env.drafts.clear(scope: scope, key: DraftRepository.newKey)"),
            "regular create must remove legacy new-note drafts"
        )
    }

    func testMemoDetailViewUsesDetailChromeAndEditFab() throws {
        let src = try readShippedSource("Features/Workspace/MemoDetailView.swift")
        XCTAssertTrue(src.contains("DetailMemoChrome.header") || src.contains("detailHeader"), src)
        XCTAssertTrue(src.contains("DetailMemoChrome.syncStatus"), "missing sync chip")
        XCTAssertTrue(src.contains("DetailMemoChrome.share"), "missing share action")
        XCTAssertTrue(src.contains("DetailMemoChrome.history"), "missing history action")
        XCTAssertTrue(src.contains("DetailMemoChrome.metaRow"), "missing meta row")
        XCTAssertTrue(src.contains("DetailMemoChrome.title"), "missing detail title")
        XCTAssertTrue(src.contains("TipTapWebView"), "viewer wiring must remain")
        // Edit is requested via callback; presentation is owned by WorkspaceView (reliable).
        XCTAssertTrue(src.contains("onEdit"), "detail requests edit via onEdit callback")
        XCTAssertTrue(src.contains("EditFabButton"), "UIKit FAB so WebView cannot steal taps")
        XCTAssertTrue(src.contains("onSearchResult"), "in-note search must receive match count/index")
        XCTAssertTrue(src.contains("SharedTipTapRuntime.viewer.search"), "search controls must drive TipTap selection")
        XCTAssertTrue(src.contains("ActivityShareView"), "public links must open the iOS system share sheet")
        XCTAssertTrue(src.contains(".overlay(alignment: .bottomTrailing)"), "FAB overlay above WebView")
        // UIKit FAB file wires green + a11y id
        let fabSrc = try readShippedSource("DesignSystem/EditFabButton.swift")
        XCTAssertTrue(fabSrc.contains("0x10") || fabSrc.contains("B9") || fabSrc.contains("10B981") || fabSrc.contains("0x10 / 255"), fabSrc)
        XCTAssertTrue(fabSrc.contains("DetailMemoChrome.editFab") || fabSrc.contains("detailEditFab"), "FAB a11y id")
    }

    func testWorkspaceIncludesAndroidBatchAndWebClipActions() throws {
        let view = try readShippedSource("Features/Workspace/WorkspaceView.swift")
        let store = try readShippedSource("Features/Workspace/WorkspaceStore.swift")
        XCTAssertTrue(view.contains("SelectionMoreSheet"))
        XCTAssertTrue(view.contains("全选当前列表"))
        XCTAssertTrue(view.contains("WebClipCaptureView"))
        XCTAssertTrue(view.contains("WebClipper.build"))
        XCTAssertTrue(store.contains("toggleVisibleSelection"))
        XCTAssertTrue(store.contains("pinSelection"))
    }

    func testEditorBundleBridgeMatchesAndroidToolbarAndTheme() throws {
        let source = try readIOSFile("EditorSource/src/main.ts")
        let runtime = try readShippedSource("Editor/TipTapWarmPool.swift")
        XCTAssertTrue(source.contains("sinkListItem"))
        XCTAssertTrue(source.contains("liftListItem"))
        XCTAssertTrue(source.contains(#"type: "pickImage""#))
        XCTAssertTrue(source.contains(#"type: "searchResult""#))
        XCTAssertTrue(runtime.contains("session.theme"))
        XCTAssertTrue(runtime.contains("session.locale"))
        XCTAssertFalse(runtime.contains("locale: 'zh-CN', theme: 'light'"))
    }

    func testWorkspacePresentsEditFromRootCover() throws {
        let src = try readShippedSource("Features/Workspace/WorkspaceView.swift")
        XCTAssertTrue(src.contains("editingMemo"), "workspace holds editing route")
        XCTAssertTrue(src.contains("fullScreenCover(item: $editingMemo)"), "edit presented at workspace root")
        // Multi-line call site: MemoEditView(\n mode: .edit(memoId: route.id)
        XCTAssertTrue(
            src.contains(".edit(memoId:") || src.contains("MemoEditView(mode: .edit(memoId:"),
            "edit cover builds MemoEditView"
        )
    }

    func testWorkspacePresentsCreateAsFullScreenCover() throws {
        let src = try readShippedSource("Features/Workspace/WorkspaceView.swift")
        XCTAssertTrue(src.contains("fullScreenCover(isPresented: $showNewNote)"), src)
        XCTAssertTrue(
            src.contains("mode: .create(") || src.contains("MemoEditView(mode: .create"),
            "create wiring"
        )
        XCTAssertTrue(src.contains("fullScreenCover(isPresented: $showSettings)"), "Me full screen")
    }

    /// Bottom chrome must be one bar: nav height + home-indicator padding (Android parity).
    func testBottomNavUsesSingleChromeWithSafeInset() throws {
        let src = try readShippedSource("Features/Workspace/WorkspaceView.swift")
        XCTAssertTrue(src.contains("bottomSafeInset") || src.contains("bottomChromeHeight"), src)
        XCTAssertTrue(src.contains("bottomNavigationHeight"), "52pt nav band")
        // Overlay chrome pinned to physical bottom (RN edges without bottom).
        XCTAssertTrue(src.contains("ZStack(alignment: .bottom)"), "overlay bottom chrome")
        XCTAssertTrue(src.contains("ignoresSafeArea(.container, edges: .bottom)"), "shell owns home indicator")
        XCTAssertTrue(src.contains("accessibilityIdentifier(\"bottomNav\")"), "a11y id for bottom nav")
        // Home-indicator is an explicit white slab under the 52pt band — one continuous surface.
        XCTAssertTrue(
            src.contains("Color.white") && src.contains("bottomInset"),
            "home-indicator slab must be white continuous with nav band"
        )
        // Create sits in the HStack *below* the top separator (no mid-line overlap).
        XCTAssertTrue(src.contains("bottomCreateButton"), "create a11y id")
        XCTAssertTrue(src.contains("bottomCreateButtonSize"), "smaller create disc under separator")
        // List pad must use bottomChromeHeight without +16 ghost strip.
        XCTAssertFalse(
            src.contains("bottomChromeHeight + 16"),
            "must not pad list by createLift — causes empty strip above white bar"
        )
        XCTAssertFalse(
            src.contains("createLift"),
            "create must not lift over the top separator"
        )

        // Metrics must expose the Android height formula
        XCTAssertEqual(MobileUIMetrics.bottomNavigationHeight, 52)
        XCTAssertEqual(MobileUIMetrics.bottomCreateButtonSize, 44)
        XCTAssertEqual(
            MobileUIMetrics.bottomChromeHeight,
            MobileUIMetrics.bottomNavigationHeight + MobileUIMetrics.bottomSafeInset
        )
    }

    func testChromeRoleConstantsStable() {
        // Stable ids used by UI tests / a11y — keep aligned with Android token names.
        XCTAssertEqual(CreateMemoChrome.done, "createMemoDoneButton")
        XCTAssertEqual(CreateMemoChrome.editorFrame, "createMemoEditorFrame")
        XCTAssertEqual(DetailMemoChrome.editFab, "detailEditFab")
        XCTAssertEqual(DetailMemoChrome.syncStatus, "detailSyncStatus")
    }

    // MARK: - Image source parity

    func testCameraAccessDecisionCoversEveryPermissionState() {
        XCTAssertEqual(
            CameraCaptureAccess.nextStep(isCameraAvailable: false, authorizationStatus: .authorized),
            .unavailable
        )
        XCTAssertEqual(
            CameraCaptureAccess.nextStep(isCameraAvailable: true, authorizationStatus: .authorized),
            .openCamera
        )
        XCTAssertEqual(
            CameraCaptureAccess.nextStep(isCameraAvailable: true, authorizationStatus: .notDetermined),
            .requestPermission
        )
        XCTAssertEqual(
            CameraCaptureAccess.nextStep(isCameraAvailable: true, authorizationStatus: .denied),
            .showSettings
        )
        XCTAssertEqual(
            CameraCaptureAccess.nextStep(isCameraAvailable: true, authorizationStatus: .restricted),
            .showSettings
        )
    }

    func testCameraFilenameIsStableAndUploadFriendly() {
        let date = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(ImagePickerData.cameraFilename(at: date), "photo-19700101T000000Z.jpg")
    }

    func testCameraCoordinatorSettlesOnlyOnce() {
        var callbackCount = 0
        let coordinator = SystemCameraPicker.Coordinator { _ in callbackCount += 1 }
        coordinator.finish(.cancelled)
        coordinator.finish(.failed("late callback"))
        XCTAssertEqual(callbackCount, 1)
    }

    func testMemoEditorOffersCameraAndLibrarySources() throws {
        let source = try readShippedSource("Features/Workspace/MemoEditView.swift")
        XCTAssertTrue(source.contains("showImageSourcePicker = true"))
        XCTAssertTrue(source.contains("SystemCameraPicker"))
        XCTAssertTrue(source.contains("SystemImagePicker"))
        XCTAssertTrue(source.contains("从相册选择"))
        XCTAssertTrue(source.contains("拍照"))
    }

    // MARK: - Helpers

    private func readShippedSource(_ relativeUnderEdgeEver: String) throws -> String {
        // Tests/EdgeEverTests/ThisFile.swift → apps/ios/
        let testsDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let iosRoot = testsDir.deletingLastPathComponent().deletingLastPathComponent()
        let url = iosRoot.appendingPathComponent("EdgeEver").appendingPathComponent(relativeUnderEdgeEver)
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func readIOSFile(_ relativeUnderIOS: String) throws -> String {
        let testsDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let iosRoot = testsDir.deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: iosRoot.appendingPathComponent(relativeUnderIOS), encoding: .utf8)
    }
}
