import AVFoundation
import SwiftUI

private enum ImagePickerRoute: String, Identifiable {
    case camera
    case library

    var id: String { rawValue }
}

enum MemoEditMode: Equatable {
    /// `seed` pre-fills title/body/tags for an explicit template, clip, or share flow.
    /// A regular create always starts blank.
    case create(notebookId: String, seed: CreateMemoSeed? = nil)
    case edit(memoId: String)
}

/// Android CreateMemoModal / rich-edit shell parity (createMemo* tokens).
struct MemoEditView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    let mode: MemoEditMode
    var initialSharedImages: [ShareHandoffStore.SharedImage] = []
    /// When set (edit-from-detail), close by popping to the list under the cover first —
    /// never `dismiss()` onto a still-pushed detail page.
    var onLeaveToList: (() -> Void)? = nil
    /// Create path: called with the committed memo id so the list can bounce that card.
    var onCreateFinished: ((String) -> Void)? = nil

    @State private var viewModel = MemoEditViewModel()
    /// True after Back/Done commit starts — blocks late TipTap `change` from rewriting the
    /// `new` draft so the next create opens empty instead of the previous note body.
    /// False until `loadInitial` has filled title/body from mirror — prevents TipTap boot
    /// with empty defaults from overwriting a non-empty note via autosave / flush.
    /// Snapshot of body when edit opened (or last intentional load). Used to reject empty clobbers.
    @State private var showNotebookPicker = false
    @State private var showTagPicker = false
    @State private var showImageSourcePicker = false
    @State private var imagePickerRoute: ImagePickerRoute?
    @State private var showCameraAccessAlert = false
    @State private var cameraAccessCanOpenSettings = false
    @State private var cameraAccessMessage = ""
    @State private var showUploadError = false
    @State private var showTemplatePicker = false
    @State private var showApplyTemplateConfirm = false
    @State private var pendingTemplateSeed: CreateMemoSeed?
    @State private var resourceTarget: ResourceTarget?
    @State private var aiSelection: AiEditorSelection?
    @State private var showEmptyAiSelectionAlert = false
    @State private var aiUndoToken: UUID?
    @State private var didImportSharedImages = false

    private var title: String { get { viewModel.title } nonmutating set { viewModel.title = newValue } }
    private var tagsText: String { get { viewModel.tagsText } nonmutating set { viewModel.tagsText = newValue } }
    private var notebookId: String { get { viewModel.notebookId } nonmutating set { viewModel.notebookId = newValue } }
    private var contentMarkdown: String { get { viewModel.contentMarkdown } nonmutating set { viewModel.contentMarkdown = newValue } }
    private var contentJSON: String { get { viewModel.contentJSON } nonmutating set { viewModel.contentJSON = newValue } }
    private var expectedRevision: Int? { get { viewModel.expectedRevision } nonmutating set { viewModel.expectedRevision = newValue } }
    private var expectedContentHash: String? { get { viewModel.expectedContentHash } nonmutating set { viewModel.expectedContentHash = newValue } }
    private var memoId: String? { get { viewModel.memoId } nonmutating set { viewModel.memoId = newValue } }
    private var error: String? { get { viewModel.error } nonmutating set { viewModel.error = newValue } }
    private var editGeneration: UInt64 { get { viewModel.editGeneration } nonmutating set { viewModel.editGeneration = newValue } }
    private var isMaterializing: Bool { get { viewModel.isMaterializing } nonmutating set { viewModel.isMaterializing = newValue } }
    private var isDirty: Bool { get { viewModel.isDirty } nonmutating set { viewModel.isDirty = newValue } }
    private var isSaving: Bool { get { viewModel.isSaving } nonmutating set { viewModel.isSaving = newValue } }
    private var isCreating: Bool { get { viewModel.isCreating } nonmutating set { viewModel.isCreating = newValue } }
    private var isUploading: Bool { get { viewModel.isUploading } nonmutating set { viewModel.isUploading = newValue } }
    private var editorReady: Bool { get { viewModel.editorReady } nonmutating set { viewModel.editorReady = newValue } }
    private var suppressPersistence: Bool { get { viewModel.suppressPersistence } nonmutating set { viewModel.suppressPersistence = newValue } }
    private var contentHydrated: Bool { get { viewModel.contentHydrated } nonmutating set { viewModel.contentHydrated = newValue } }
    private var baselineMarkdown: String { get { viewModel.baselineMarkdown } nonmutating set { viewModel.baselineMarkdown = newValue } }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                createHeader
                createMain
            }

            // Impossible-to-miss upload feedback (status chip alone was too easy to miss).
            if isUploading {
                Color.black.opacity(0.28)
                    .ignoresSafeArea()
                    .allowsHitTesting(true)
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.large)
                        .tint(.white)
                    Text(env.preferences.t("正在上传图片…", en: "Uploading image…"))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .padding(24)
                .background(.ultraThinMaterial.opacity(0.9))
                .background(Color.black.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityIdentifier("createMemoUploadOverlay")
            }

            if aiUndoToken != nil {
                VStack {
                    Spacer()
                    HStack(spacing: 12) {
                        Text(env.preferences.t("AI 已更新选中内容。", en: "AI updated the selection."))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                        Spacer(minLength: 0)
                        Button(env.preferences.t("撤销", en: "Undo")) {
                            Task {
                                guard await SharedTipTapRuntime.editor.undoAiSelectionDraft() else {
                                    aiUndoToken = nil
                                    return
                                }
                                await pullEditorSnapshotIfPossible()
                                markDirtyAndScheduleSave()
                                aiUndoToken = nil
                            }
                        }
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color(red: 0.43, green: 0.91, blue: 0.72))
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .background(Color(red: 0.06, green: 0.09, blue: 0.16))
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .shadow(color: .black.opacity(0.22), radius: 14, y: 6)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 12)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .allowsHitTesting(true)
            }
        }
        .background(AppTheme.card.ignoresSafeArea())
        .accessibilityIdentifier(CreateMemoChrome.root)
        .sheet(isPresented: $showNotebookPicker) {
            EditNotebookPickerSheet(
                notebooks: availableNotebooks,
                selectedId: notebookId
            ) { id in
                notebookId = id
                markDirtyAndScheduleSave()
                showNotebookPicker = false
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showTagPicker) {
            MemoTagPickerSheet(selectedTags: viewModel.tags) { tags in
                tagsText = tags.joined(separator: ", ")
                markDirtyAndScheduleSave()
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showTemplatePicker) {
            TemplatePickerSheet { seed in
                requestApplyTemplate(seed)
            }
        }
        .sheet(item: $aiSelection) { selection in
            AiAssistantSheet(
                title: title,
                selectedMarkdown: selection.markdown.isEmpty ? selection.text : selection.markdown
            ) { draft, mode in
                let applied = await SharedTipTapRuntime.editor.applyAiSelectionDraft(
                    draft,
                    append: mode == .append
                )
                guard applied else {
                    throw NSError(
                        domain: "EdgeEverAiSelection",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: env.preferences.t(
                            "选区已失效，请重新选择文本后再试。",
                            en: "The selection expired. Select the text again and retry."
                        )]
                    )
                }
                await pullEditorSnapshotIfPossible()
                markDirtyAndScheduleSave()
                presentAiUndo()
            }
            .presentationDetents([.large])
        }
        .alert(
            env.preferences.t("请先选择正文", en: "Select text first"),
            isPresented: $showEmptyAiSelectionAlert
        ) {
            Button(env.preferences.t("好的", en: "OK"), role: .cancel) {}
        } message: {
            Text(env.preferences.t(
                "在正文中选中一段文字，然后再点 AI。",
                en: "Select some text in the note body, then tap AI again."
            ))
        }
        .alert(
            env.preferences.t("应用模板？", en: "Apply template?"),
            isPresented: $showApplyTemplateConfirm
        ) {
            Button(env.preferences.t("取消", en: "Cancel"), role: .cancel) {
                pendingTemplateSeed = nil
            }
            Button(env.preferences.t("替换", en: "Replace"), role: .destructive) {
                if let seed = pendingTemplateSeed {
                    applyTemplateSeed(seed)
                }
                pendingTemplateSeed = nil
            }
        } message: {
            Text(env.preferences.t("当前内容将被模板内容替换。", en: "The current content will be replaced by the template."))
        }
        .sheet(item: $resourceTarget) { target in
            ResourceActionSheet(
                target: target,
                canMutate: {
                    if case .edit(let id) = mode { return !id.hasPrefix("local:") }
                    return false
                }(),
                onContentChanged: {
                    Task { await reloadAfterResourceChange() }
                }
            )
            .presentationDetents([.height(360), .medium])
            .presentationDragIndicator(.hidden)
        }
        .confirmationDialog(
            env.preferences.t("添加图片", en: "Add image"),
            isPresented: $showImageSourcePicker,
            titleVisibility: .visible
        ) {
            Button(env.preferences.t("拍照", en: "Take photo")) {
                scheduleCameraCapture()
            }
            Button(env.preferences.t("从相册选择", en: "Choose from library")) {
                scheduleImagePicker(.library)
            }
            Button(env.preferences.t("取消", en: "Cancel"), role: .cancel) {}
        } message: {
            Text(env.preferences.t("直接拍照或选择已有照片", en: "Take a new photo or choose an existing one"))
        }
        // fullScreenCover avoids nested-sheet bugs when MemoEditView itself is already a fullScreenCover.
        // PHPicker + NSItemProvider (not SwiftUI PhotosPicker/Transferable) is the reliable path.
        .fullScreenCover(item: $imagePickerRoute) { route in
            Group {
                switch route {
                case .camera:
                    SystemCameraPicker(onFinish: handleImagePickerResult)
                case .library:
                    SystemImagePicker(onFinish: handleImagePickerResult)
                }
            }
            .ignoresSafeArea()
        }
        .alert(
            env.preferences.t("无法使用相机", en: "Unable to use camera"),
            isPresented: $showCameraAccessAlert
        ) {
            Button(env.preferences.t("取消", en: "Cancel"), role: .cancel) {}
            if cameraAccessCanOpenSettings {
                Button(env.preferences.t("前往设置", en: "Open settings")) {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
            }
        } message: {
            Text(cameraAccessMessage)
        }
        .alert(
            env.preferences.t("图片上传失败", en: "Image upload failed"),
            isPresented: $showUploadError
        ) {
            Button(env.preferences.t("好的", en: "OK"), role: .cancel) {}
        } message: {
            Text(error ?? env.preferences.t("请重试", en: "Please try again"))
        }
        .task {
            await loadInitial()
            contentHydrated = true
            // editorReady flips true from TipTap onBodyReady (or fallback below).
            try? await Task.sleep(nanoseconds: 800_000_000)
            if !Task.isCancelled, !editorReady {
                editorReady = true
                // One open-edit focus only (SharedTipTapRuntime also focuses once per document).
                SharedTipTapRuntime.editor.focusEnd()
            }
            await importInitialSharedImagesIfNeeded()
        }
        .onDisappear {
            viewModel.cancelScheduledSave()
            // Create commit is owned by Back / Done (Android `requestClose` = createMutation).
            // Only flush edit sessions, or create-after-image-materialize if still dirty and
            // the cover was dismissed without going through handleBack.
            if suppressPersistence { return }
            if isDirty, contentHydrated, (!isCreate || hasMaterializedServerMemo) {
                Task { await flushPending() }
            }
        }
        .preferredColorScheme(env.preferences.colorScheme)
    }

    // MARK: - Header (createMemoHeader)

    private var createHeader: some View {
        HStack(spacing: 8) {
            Button {
                Task { await handleBack() }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(busyChrome ? AppTheme.muted : AppTheme.title)
                    .frame(width: 38, height: 38)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(busyChrome)
            .accessibilityLabel(env.preferences.t("返回", en: "Back"))
            .accessibilityIdentifier(CreateMemoChrome.back)

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                Text(statusLabel)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(saveStatus.isActive ? AppTheme.accentStrong : AppTheme.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(saveStatus.isActive ? AppTheme.accentSoft : AppTheme.searchFill)
                    .clipShape(Capsule())
                    .lineLimit(1)
                    .accessibilityIdentifier(CreateMemoChrome.status)

                if isCreate {
                    Button {
                        showTemplatePicker = true
                    } label: {
                        Text(env.preferences.t("模板", en: "Template"))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(canUseTemplate ? AppTheme.title : AppTheme.secondary)
                            .frame(minHeight: 36)
                            .padding(.horizontal, 12)
                            .overlay(
                                Capsule().stroke(AppTheme.border, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(!canUseTemplate)
                    .accessibilityLabel(env.preferences.t("模板", en: "Template"))
                    .accessibilityIdentifier(CreateMemoChrome.template)
                }

                Button {
                    Task {
                        if let selection = await SharedTipTapRuntime.editor.captureAiSelection() {
                            aiSelection = selection
                        } else {
                            showEmptyAiSelectionAlert = true
                        }
                    }
                } label: {
                    Image(systemName: "sparkles")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(editorReady && !busyChrome ? AppTheme.accentStrong : AppTheme.muted)
                        .frame(width: 36, height: 36)
                        .background(AppTheme.accentSoft)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!editorReady || busyChrome)
                .accessibilityLabel(env.preferences.t("用 AI 处理选中内容", en: "Use AI on selection"))

                Button {
                    Task { await handleDone() }
                } label: {
                    Group {
                        if isCreating || isSaving && isCreate {
                            ProgressView()
                                .controlSize(.small)
                                .tint(AppTheme.secondary)
                        } else {
                            Text(env.preferences.t("完成", en: "Done"))
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(canSubmitDone ? Color.white : AppTheme.secondary)
                        }
                    }
                    .frame(minWidth: 58, minHeight: 36)
                    .padding(.horizontal, 12)
                    .background(canSubmitDone ? AppTheme.title : AppTheme.disabledFill)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(!canSubmitDone)
                .accessibilityLabel(env.preferences.t("完成", en: "Done"))
                .accessibilityIdentifier(CreateMemoChrome.done)
            }
            .accessibilityIdentifier(CreateMemoChrome.header)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 52)
        .background(AppTheme.card)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
        }
        .accessibilityIdentifier(CreateMemoChrome.header)
    }

    // MARK: - Main (createMemoMain)

    private var createMain: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField(
                env.preferences.t("无标题笔记", en: "Untitled note"),
                text: Binding(
                    get: { viewModel.title },
                    set: { viewModel.title = $0 }
                )
            )
            .font(.system(size: 28, weight: .heavy))
            .foregroundStyle(AppTheme.title)
            .textFieldStyle(.plain)
            .padding(.top, 14)
            .padding(.bottom, 8)
            .onChange(of: title) { _, _ in markDirtyAndScheduleSave() }
            .accessibilityLabel(env.preferences.t("笔记标题", en: "Note title"))
            .accessibilityIdentifier(CreateMemoChrome.title)

            HStack(spacing: 10) {
                Button {
                    showNotebookPicker = true
                } label: {
                    HStack(spacing: 3) {
                        Text(selectedNotebookName)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(AppTheme.secondary)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(AppTheme.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: 160, alignment: .leading)
                .frame(minHeight: 30)
                .layoutPriority(1)
                .accessibilityLabel(env.preferences.t("所在笔记本", en: "Notebook"))
                .accessibilityIdentifier(CreateMemoChrome.notebook)

                Button {
                    showTagPicker = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "tag")
                            .font(.system(size: 13, weight: .semibold))
                        Text(viewModel.tags.isEmpty
                             ? env.preferences.t("添加标签", en: "Add tags")
                             : viewModel.tags.map { "#\($0)" }.joined(separator: ", "))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 15))
                    .foregroundStyle(viewModel.tags.isEmpty ? AppTheme.muted : AppTheme.secondary)
                    .frame(minHeight: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(env.preferences.t("笔记标签", en: "Tags"))
                .accessibilityIdentifier(CreateMemoChrome.tags)

            }
            .frame(minHeight: 40)
            .accessibilityIdentifier(CreateMemoChrome.metaRow)

            ZStack {
                // Mount TipTap only after local body is loaded — shared WebView must not
                // receive empty defaults first (that used to autosave-wipe demo notes).
                if contentHydrated {
                    TipTapWebView(
                        mode: .editor,
                        documentJSON: contentJSON,
                        markdown: contentMarkdown,
                        baseURL: env.session.session.map { URL(string: $0.baseUrl) } ?? nil,
                        token: env.session.session?.token,
                        locale: env.preferences.isEnglish ? "en-US" : "zh-CN",
                        theme: colorScheme == .dark ? "dark" : "light",
                        placeholder: env.preferences.t("开始输入…", en: "Start writing…"),
                        onChange: { md, json in
                            guard contentHydrated, !suppressPersistence else { return }
                            // Accept the JSON and Markdown emitted by the same TipTap transaction.
                            // Native code only falls back to its compatibility serializer when the
                            // editor cannot provide Markdown at all.
                            viewModel.applyEditorPayload(markdown: md, json: json)
                            if !isUploading {
                                markDirtyAndScheduleSave()
                            } else {
                                isDirty = true
                            }
                        },
                        onResourcePress: { target in
                            resourceTarget = target
                        },
                        onImagePreview: nil,
                        onPickImage: {
                            guard !isUploading else { return }
                            UIApplication.shared.sendAction(
                                #selector(UIResponder.resignFirstResponder),
                                to: nil,
                                from: nil,
                                for: nil
                            )
                            error = nil
                            showImageSourcePicker = true
                        },
                        onSearchResult: nil,
                        onBodyReady: {
                            // Do not focusEnd here — bodyReady also fires on typing re-binds.
                            // Open-edit focus is owned by SharedTipTapRuntime (once per document).
                            editorReady = true
                        }
                    )
                    .opacity(1)
                }

                if !editorReady || !contentHydrated {
                    VStack(spacing: 10) {
                        ProgressView()
                            .tint(AppTheme.title)
                        Text(env.preferences.t("正在启动本地编辑器", en: "Starting local editor"))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(AppTheme.card)
                    .allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
            .padding(.top, 4)
            .padding(.horizontal, -4)
            .accessibilityIdentifier(CreateMemoChrome.editorFrame)

            if let error {
                Text(error)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.danger)
                    .padding(.top, 8)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: - Image source

    private func scheduleImagePicker(_ route: ImagePickerRoute) {
        Task { @MainActor in
            // Let the confirmation dialog finish dismissing before presenting UIKit.
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            imagePickerRoute = route
        }
    }

    private func scheduleCameraCapture() {
        Task { @MainActor in
            // Permission prompts and full-screen covers must not race the source dialog dismissal.
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            beginCameraCapture()
        }
    }

    @MainActor
    private func beginCameraCapture() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch CameraCaptureAccess.nextStep(
            isCameraAvailable: SystemCameraPicker.isAvailable,
            authorizationStatus: status
        ) {
        case .openCamera:
            imagePickerRoute = .camera
        case .requestPermission:
            Task {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                await MainActor.run {
                    if granted {
                        imagePickerRoute = .camera
                    } else {
                        showCameraSettingsAlert()
                    }
                }
            }
        case .showSettings:
            showCameraSettingsAlert()
        case .unavailable:
            cameraAccessCanOpenSettings = false
            cameraAccessMessage = env.preferences.t(
                "此设备没有可用相机。",
                en: "This device does not have an available camera."
            )
            showCameraAccessAlert = true
        }
    }

    @MainActor
    private func showCameraSettingsAlert() {
        cameraAccessCanOpenSettings = true
        cameraAccessMessage = env.preferences.t(
            "请前往系统设置，允许 EdgeEver 使用相机后再试。",
            en: "Open system settings and allow EdgeEver to use the camera, then try again."
        )
        showCameraAccessAlert = true
    }

    @MainActor
    private func handleImagePickerResult(_ result: ImagePickerResult) {
        imagePickerRoute = nil
        switch result {
        case .cancelled:
            break
        case .failed(let message):
            error = message
            showUploadError = true
        case .picked(let data, let filename):
            Task { _ = await insertImageData(data, filename: filename) }
        }
    }

    // MARK: - Derived state

    private var isCreate: Bool {
        if case .create = mode { return true }
        return false
    }

    private var busyChrome: Bool {
        isCreating || isUploading
    }

    private var saveStatus: CreateSaveStatus {
        CreateSaveStatus.derive(
            editorReady: editorReady,
            isDirty: isDirty,
            isSaving: isSaving,
            isCreating: isCreating,
            isUploading: isUploading,
            hasError: error != nil
        )
    }

    private var statusLabel: String {
        env.preferences.isEnglish ? saveStatus.labelEN : saveStatus.labelZH
    }

    private var canSubmitDone: Bool {
        if isCreate {
            return !notebookId.isEmpty && !isCreating && !isUploading
        }
        return !isSaving && !isUploading && editorReady
    }

    private var canUseTemplate: Bool {
        isCreate && !isCreating && !isUploading
    }

    private var availableNotebooks: [Notebook] {
        (try? env.mirror.listNotebooks(scope: env.session.dataScope ?? "")) ?? []
    }

    private var selectedNotebookName: String {
        if let name = availableNotebooks.first(where: { $0.id == notebookId })?.name {
            return name
        }
        return env.preferences.t("选择笔记本", en: "Choose notebook")
    }

    private var tags: [String] {
        viewModel.tags
    }

    // MARK: - Actions

    private func markDirtyAndScheduleSave() {
        viewModel.markDirty()
        guard !suppressPersistence, !isUploading else { return }
        scheduleSave()
    }

    private func requestApplyTemplate(_ seed: CreateMemoSeed) {
        let current = CreateMemoSeed(title: title, contentMarkdown: contentMarkdown, tagsText: tagsText)
        if current.hasContent {
            pendingTemplateSeed = seed
            showApplyTemplateConfirm = true
            return
        }
        applyTemplateSeed(seed)
    }

    private func applyTemplateSeed(_ seed: CreateMemoSeed) {
        title = seed.title
        tagsText = seed.tagsText
        contentMarkdown = seed.contentMarkdown
        // Empty stub JSON forces TipTapContentSource to open from markdown structure.
        contentJSON = MemoEditViewModel.emptyDocJSON
        baselineMarkdown = seed.contentMarkdown
        editorReady = false
        markDirtyAndScheduleSave()
        // Re-push body into the shared editor runtime.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 50_000_000)
            SharedTipTapRuntime.editor.focusEnd()
            editorReady = true
        }
    }

    private func handleBack() async {
        // Android CreateMemoModal `requestClose`: flush editor then always run createMutation.
        // Text-only create must mint a local:/server memo + clear the new-note draft so:
        // 1) the note appears in the list, 2) the next "New note" opens empty.
        if isCreate {
            if busyChrome { return }
            await pullEditorSnapshotIfPossible()
            await commitCreate()
        } else {
            await flushPending()
            leaveEditor()
        }
    }

    private func handleDone() async {
        await pullEditorSnapshotIfPossible()
        if isCreate {
            await commitCreate()
        } else {
            await flushPending()
            leaveEditor()
        }
    }

    /// Edit-from-detail: parent pops path then clears the cover so list is revealed.
    /// Create / other hosts: standard environment dismiss.
    private func leaveEditor() {
        if let onLeaveToList {
            onLeaveToList()
        } else {
            dismiss()
        }
    }

    /// True once `materializeForImage` (or edit open) holds a real server memo id.
    private var hasMaterializedServerMemo: Bool {
        guard let memoId else { return false }
        return !memoId.hasPrefix("local:")
    }

    /// Pull markdown/JSON from TipTap so saves don't race the async change bridge.
    private func pullEditorSnapshotIfPossible() async {
        guard let snap = await SharedTipTapRuntime.editor.snapshotContent() else { return }
        viewModel.applyEditorPayload(markdown: snap.markdown, json: snap.json)
    }

    private func presentAiUndo() {
        let token = UUID()
        aiUndoToken = token
        Task {
            try? await Task.sleep(nanoseconds: 6_500_000_000)
            guard !Task.isCancelled, aiUndoToken == token else { return }
            aiUndoToken = nil
        }
    }

    private func loadInitial() async {
        guard let scope = env.session.dataScope else { return }
        switch mode {
        case .create(let nb, let seed):
            // A regular create must never inherit state from the previous create
            // session. Clear both in-memory fields and any legacy persisted draft.
            title = ""
            tagsText = ""
            contentMarkdown = ""
            contentJSON = MemoEditViewModel.emptyDocJSON
            notebookId = nb
            memoId = nil
            expectedRevision = nil
            expectedContentHash = nil
            try? env.drafts.clear(scope: scope, key: DraftRepository.newKey)
            if let seed {
                // Only explicit template / clip / share input may prefill a create.
                title = seed.title
                tagsText = seed.tagsText
                contentMarkdown = seed.contentMarkdown
                contentJSON = MemoEditViewModel.emptyDocJSON
            }
            baselineMarkdown = contentMarkdown
        case .edit(let id):
            memoId = id
            // Prefer mirror body over a stale empty draft that could wipe the note.
            if let memo = try? env.mirror.resolveMemo(scope: scope, id: id) {
                title = memo.title ?? ""
                tagsText = memo.tags.joined(separator: ", ")
                contentMarkdown = memo.contentMarkdown
                contentJSON = (try? memo.contentJson.jsonString()) ?? contentJSON
                notebookId = memo.notebookId
                expectedRevision = memo.revision
                expectedContentHash = memo.contentHash
                memoId = memo.id
                // Overlay draft only when it still has body (or memo was already empty).
                if let draft = try? env.drafts.read(scope: scope, key: DraftRepository.memoKey(id)) {
                    let draftBody = draft.contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines)
                    let memoBody = memo.contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !draftBody.isEmpty || memoBody.isEmpty {
                        title = draft.title
                        tagsText = draft.tagsText
                        contentMarkdown = draft.contentMarkdown
                        contentJSON = draft.contentJson ?? contentJSON
                        if !draft.notebookId.isEmpty { notebookId = draft.notebookId }
                        expectedRevision = draft.expectedRevision ?? expectedRevision
                    }
                }
            } else if let draft = try? env.drafts.read(scope: scope, key: DraftRepository.memoKey(id)) {
                title = draft.title
                tagsText = draft.tagsText
                contentMarkdown = draft.contentMarkdown
                contentJSON = draft.contentJson ?? contentJSON
                notebookId = draft.notebookId
                expectedRevision = draft.expectedRevision
            }
            baselineMarkdown = contentMarkdown
        }
    }

    /// After server-side rename/delete, pull the latest memo body into the editor.
    private func reloadAfterResourceChange() async {
        guard case .edit(let id) = mode, let scope = env.session.dataScope else { return }
        // Prefer live server copy when online.
        if let remote = try? await env.session.client.getMemo(id: id) {
            try? env.mirror.upsertMemo(scope: scope, memo: remote)
            title = remote.title ?? ""
            tagsText = remote.tags.joined(separator: ", ")
            contentMarkdown = remote.contentMarkdown
            contentJSON = (try? remote.contentJson.jsonString()) ?? contentJSON
            expectedRevision = remote.revision
            expectedContentHash = remote.contentHash
            baselineMarkdown = contentMarkdown
            return
        }
        if let memo = try? env.mirror.resolveMemo(scope: scope, id: id) {
            title = memo.title ?? ""
            tagsText = memo.tags.joined(separator: ", ")
            contentMarkdown = memo.contentMarkdown
            contentJSON = (try? memo.contentJson.jsonString()) ?? contentJSON
            expectedRevision = memo.revision
            expectedContentHash = memo.contentHash
            baselineMarkdown = contentMarkdown
        }
    }

    private func scheduleSave() {
        viewModel.scheduleSave {
            await persistDraftOrQueue()
        }
    }

    private func persistDraftOrQueue() async {
        guard let scope = env.session.dataScope else { return }
        guard contentHydrated, !suppressPersistence else { return }
        guard !isSaving else { return }
        let generationAtStart = editGeneration
        // Last chance: only backfill Markdown when the editor supplied none. Never replace
        // valid TipTap Markdown with the intentionally limited native compatibility serializer.
        viewModel.reconcileMarkdownWithJSON()
        if viewModel.wouldClobberNonEmptyBody(isCreate: isCreate) {
            NSLog(
                "MemoEditView: skip persist — refusing body clobber baseText=%d nextText=%d",
                EditorContentCodec.plainTextFromMarkdown(baselineMarkdown).count,
                EditorContentCodec.plainText(markdown: contentMarkdown, json: contentJSON).count
            )
            isDirty = false
            return
        }
        isSaving = true
        defer {
            isSaving = false
            if generationAtStart == editGeneration {
                isDirty = false
            } else if !suppressPersistence {
                scheduleSave()
            }
        }
        let now = EdgeEverDate.nowString()

        // A non-materialized create remains in memory until Done/Back commits it.
        // Persisting it under the shared `new` key would leak this content into a
        // later create session.
        if isCreate, !hasMaterializedServerMemo {
            return
        }

        guard let memoId, !memoId.hasPrefix("local:") else {
            return
        }

        guard var memo = try? env.mirror.resolveMemo(scope: scope, id: memoId) else {
            NSLog("MemoEditView persist: mirror miss for \(memoId)")
            return
        }
        memo.title = title.isEmpty ? env.preferences.t("无标题笔记", en: "Untitled note") : title
        memo.contentMarkdown = contentMarkdown
        memo.contentText = contentMarkdown
        memo.tags = tags
        memo.notebookId = notebookId
        memo.updatedAt = now
        memo.excerpt = String(contentMarkdown.prefix(160))
        if let json = try? JSONValue.parse(contentJSON) {
            memo.contentJson = json
        }
        // Capture server base BEFORE writing local content. Never prefer a stale
        // in-memory expectedRevision that lagged behind a completed sync — that was
        // causing endless "Note changed before the offline draft could sync" conflicts.
        let rev = memo.revision
        let hash = memo.contentHash
        try? env.mirror.upsertMemo(scope: scope, memo: memo)

        try? env.outbox.enqueueUpdate(
            scope: scope,
            payload: MemoUpdatePayload(
                memoId: memo.id,
                expectedRevision: rev,
                expectedContentHash: hash,
                title: memo.title ?? title,
                contentMarkdown: contentMarkdown,
                contentJson: contentJSON,
                notebookId: notebookId,
                tags: tags
            )
        )
        expectedRevision = rev
        expectedContentHash = hash
        if !isCreate {
            try? env.drafts.write(
                scope: scope,
                draft: viewModel.makeDraft(
                    key: DraftRepository.memoKey(memo.id),
                    expectedRevision: rev,
                    updatedAt: now
                )
            )
        }
        NSLog(
            "MemoEditView persist update memo=%@ baseRev=%d mdLen=%d hasImg=%d jsonHasImg=%d",
            memo.id,
            rev,
            contentMarkdown.count,
            contentMarkdown.contains("/api/v1/resources/") ? 1 : 0,
            contentJSON.contains("/api/v1/resources/") ? 1 : 0
        )
        await env.runSyncCycle()
        // Refresh base from mirror after flush so the next keystroke doesn't reuse a dead revision.
        if let refreshed = try? env.mirror.resolveMemo(scope: scope, id: memoId) {
            expectedRevision = refreshed.revision
            expectedContentHash = refreshed.contentHash
        }
    }

    private func commitCreate() async {
        guard let scope = env.session.dataScope else { return }
        guard !notebookId.isEmpty else {
            error = env.preferences.t("请选择笔记本", en: "Choose a notebook")
            return
        }
        guard let finishedId = await viewModel.performCreateCommit(operation: {
            // Android createMutation: if image materialize already created a server memo,
            // Done/Back updates that memo — never mint a second local: create.
            let outcome = try MemoCreateCommit.commit(
                scope: scope,
                memoId: memoId,
                expectedRevision: expectedRevision,
                expectedContentHash: expectedContentHash,
                notebookId: notebookId,
                title: title,
                untitledTitle: env.preferences.t("无标题笔记", en: "Untitled note"),
                contentMarkdown: contentMarkdown,
                contentJSON: contentJSON,
                tags: tags,
                mirror: env.mirror,
                outbox: env.outbox,
                drafts: env.drafts
            )
            switch outcome {
            case .createdLocal(let id), .updatedMaterialized(let id):
                memoId = id
            }
            // Prefer mirror id after sync (create may remap local: → server id).
            var resolvedFinishedId = memoId!
            // Belt-and-suspenders: clear create draft again after commit (race with in-flight write).
            try? env.drafts.clear(scope: scope, key: DraftRepository.newKey)
            await env.runSyncCycle()
            if let id = memoId, let refreshed = try? env.mirror.resolveMemo(scope: scope, id: id) {
                expectedRevision = refreshed.revision
                expectedContentHash = refreshed.contentHash
                memoId = refreshed.id
                resolvedFinishedId = refreshed.id
            }
            // Clear again after sync — materialize/persist paths may have re-touched `new`.
            try? env.drafts.clear(scope: scope, key: DraftRepository.newKey)
            return resolvedFinishedId
        }) else { return }
        onCreateFinished?(finishedId)
        // Create modal sits on the list already; WorkspaceView reloads on cover dismiss.
        dismiss()
    }

    private func flushPending() async {
        await drainPendingSave()
        await env.runSyncCycle()
    }

    /// Wait for an in-flight autosave before forcing the latest editor generation to disk.
    private func drainPendingSave() async {
        await viewModel.drainScheduledSave {
            await persistDraftOrQueue()
        }
    }

    /// K24 materialize: ensure a server memo id before image upload.
    private func materializeForImage() async throws -> String {
        if let memoId, !memoId.hasPrefix("local:") {
            return memoId
        }
        guard let scope = env.session.dataScope else {
            throw APIError(status: 0, code: nil, message: "未登录")
        }
        if isMaterializing {
            try await Task.sleep(nanoseconds: 300_000_000)
            if let memoId, !memoId.hasPrefix("local:") { return memoId }
        }
        isMaterializing = true
        defer { isMaterializing = false }

        if let localId = memoId, localId.hasPrefix("local:"),
           let pending = try env.outbox.pendingCreate(scope: scope, memoId: localId)
        {
            if pending.status == .syncing {
                await env.runSyncCycle()
                if let resolved = try env.mirror.resolveMemo(scope: scope, id: localId), !resolved.id.hasPrefix("local:") {
                    memoId = resolved.id
                    expectedRevision = resolved.revision
                    expectedContentHash = resolved.contentHash
                    return resolved.id
                }
            }
            try env.outbox.cancelMemo(scope: scope, memoId: localId)
            try env.mirror.deleteMemo(scope: scope, id: localId)
        }

        // Capture latest editor body before minting the server memo (avoid stale empty markdown).
        await pullEditorSnapshotIfPossible()
        viewModel.reconcileMarkdownWithJSON()
        let memo = try await env.session.client.createMemo(
            notebookId: notebookId.isEmpty ? (availableNotebooks.first?.id ?? "") : notebookId,
            title: title.isEmpty ? env.preferences.t("无标题笔记", en: "Untitled note") : title,
            contentMarkdown: contentMarkdown,
            tags: tags
        )
        try env.mirror.upsertMemo(scope: scope, memo: memo)
        try env.drafts.clear(scope: scope, key: DraftRepository.newKey)
        memoId = memo.id
        expectedRevision = memo.revision
        expectedContentHash = memo.contentHash
        notebookId = memo.notebookId
        return memo.id
    }

    /// Upload bytes from the system PHPicker and insert into TipTap.
    private func insertImageData(_ data: Data, filename: String) async -> Bool {
        let succeeded = await viewModel.performUpload {
            NSLog("MemoEditView insertImageData: start bytes=%d name=%@", data.count, filename)
            let compress = env.preferences.useCompression
            let prepared = compress
                ? ImageCompressor.compressIfNeeded(data) // Android parity: WebP @ 0.82, max edge 2560
                : Self.preparedUpload(from: data, preferredName: filename)
            NSLog(
                "MemoEditView insertImageData: start=%d → prepared=%d mime=%@ file=%@ compress=%d",
                data.count,
                prepared.data.count,
                prepared.mimeType,
                prepared.filename,
                compress ? 1 : 0
            )
            let serverId = try await materializeForImage()
            NSLog("MemoEditView insertImageData: memoId=%@", serverId)
            let resource = try await env.session.client.uploadMemoResource(
                memoId: serverId,
                filename: prepared.filename,
                mimeType: prepared.mimeType,
                data: prepared.data
            )
            NSLog("MemoEditView insertImageData: uploaded resourceId=%@ url=%@", resource.id, resource.url)
            // Prefer protected relative path so hydrate + menus work offline/online.
            let imageSrc: String = {
                if resource.url.contains("/api/v1/resources/") {
                    return ResourceCache.normalizeProtectedResourcePath(
                        resource.url,
                        baseURL: env.session.session.flatMap { URL(string: $0.baseUrl) }
                    )
                }
                return "/api/v1/resources/\(resource.id)/blob"
            }()
            // TipTap is JSON-driven: must insert via JS (markdown-only never re-renders).
            // Seed blob cache + hydrate so file:// WebView can paint the protected src.
            let inserted = await SharedTipTapRuntime.editor.insertImage(
                src: imageSrc,
                alt: prepared.filename,
                displayData: prepared.data,
                mimeType: prepared.mimeType
            )
            if !inserted {
                throw APIError(
                    status: 0,
                    code: nil,
                    message: env.preferences.t(
                        "图片已上传，但插入编辑器失败，请重试。",
                        en: "Upload succeeded but insert into editor failed. Please try again."
                    )
                )
            }
            // Snapshot TipTap JSON (order is authoritative). Only inject if the resource
            // is truly missing — never append a second image node at document end.
            await pullEditorSnapshotIfPossible()
            if !EditorContentCodec.jsonContainsResource(contentJSON, src: imageSrc) {
                viewModel.ensureImageInContent(imageSrc: imageSrc, alt: prepared.filename)
            } else {
                viewModel.reconcileMarkdownWithJSON()
            }
            editGeneration &+= 1
            isDirty = true
            // Persist immediately so leaving the editor cannot orphan the resource.
            await drainPendingSave()
            NSLog(
                "MemoEditView insertImageData: done src=%@ mdHas=%d jsonHas=%d textLen=%d",
                imageSrc,
                contentMarkdown.contains(imageSrc) ? 1 : 0,
                EditorContentCodec.jsonContainsResource(contentJSON, src: imageSrc) ? 1 : 0,
                EditorContentCodec.plainText(markdown: contentMarkdown, json: contentJSON).count
            )
        }
        if !succeeded {
            showUploadError = true
            NSLog("MemoEditView insertImageData failed: %@", error ?? "unknown")
        }
        return succeeded
    }

    private func importInitialSharedImagesIfNeeded() async {
        guard !didImportSharedImages, !initialSharedImages.isEmpty else { return }
        didImportSharedImages = true
        for image in initialSharedImages {
            do {
                let data = try Data(contentsOf: image.fileURL)
                let succeeded = await insertImageData(data, filename: image.filename)
                env.shareHandoff.removeImage(image)
                guard succeeded else { return }
            } catch {
                env.shareHandoff.removeImage(image)
                self.error = error.localizedDescription
                showUploadError = true
                return
            }
        }
    }

    /// When compression is off, still normalize HEIC → JPEG for reliable upload mime.
    private static func preparedUpload(
        from data: Data,
        preferredName: String
    ) -> (data: Data, mimeType: String, filename: String) {
        let normalized = ImagePickerData.normalize(data)
        let mime = TipTapResourceLoader.sniffImageMime(normalized)
        let resolvedMime = mime == "application/octet-stream" ? "image/jpeg" : mime
        let ext: String
        switch resolvedMime {
        case "image/png": ext = "png"
        case "image/gif": ext = "gif"
        case "image/webp": ext = "webp"
        default: ext = "jpg"
        }
        let base = (preferredName as NSString).deletingPathExtension
        let name = base.isEmpty ? "image.\(ext)" : "\(base).\(ext)"
        return (normalized, resolvedMime, name)
    }
}

private struct MemoTagPickerSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var selection: [String]
    @State private var query = ""
    @State private var availableTags: [TagSummary] = []
    @State private var error: String?
    let onChange: ([String]) -> Void

    init(selectedTags: [String], onChange: @escaping ([String]) -> Void) {
        _selection = State(initialValue: selectedTags)
        self.onChange = onChange
    }

    private var normalizedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "^#", with: "", options: .regularExpression)
    }

    private var visibleTags: [TagSummary] {
        guard !normalizedQuery.isEmpty else { return availableTags }
        return availableTags.filter { $0.name.localizedCaseInsensitiveContains(normalizedQuery) }
    }

    private var hasExactMatch: Bool {
        availableTags.contains { $0.name.caseInsensitiveCompare(normalizedQuery) == .orderedSame }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if !selection.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(selection, id: \.self) { tag in
                                Button {
                                    toggle(tag)
                                } label: {
                                    HStack(spacing: 4) {
                                        Text("#\(tag)")
                                        Image(systemName: "xmark")
                                    }
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(AppTheme.accent)
                                    .padding(.horizontal, 11)
                                    .frame(minHeight: 32)
                                    .background(AppTheme.accentSoft)
                                    .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(env.preferences.t("移除标签 \(tag)", en: "Remove tag \(tag)"))
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                }

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(AppTheme.muted)
                    TextField(env.preferences.t("搜索或输入新标签", en: "Search or enter a new tag"), text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(createTag)
                    if !normalizedQuery.isEmpty && !hasExactMatch && selection.count < 24 {
                        Button(env.preferences.t("新建", en: "Create"), action: createTag)
                            .font(.system(size: 13, weight: .bold))
                    }
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 42)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(AppTheme.border, lineWidth: 1))
                .padding(.horizontal, 16)

                if let error {
                    Text(error).font(.system(size: 13)).foregroundStyle(AppTheme.danger)
                }

                List(visibleTags, id: \.name) { tag in
                    Button {
                        toggle(tag.name)
                    } label: {
                        HStack {
                            Image(systemName: selection.contains(tag.name) ? "checkmark.square.fill" : "square")
                                .foregroundStyle(selection.contains(tag.name) ? AppTheme.accent : AppTheme.muted)
                            Text("#\(tag.name)").foregroundStyle(AppTheme.title)
                            Spacer()
                            Text(env.preferences.t("\(tag.memoCount) 条笔记", en: "\(tag.memoCount) notes"))
                                .font(.system(size: 12))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.plain)
                .overlay {
                    if visibleTags.isEmpty {
                        ContentUnavailableView(
                            env.preferences.t("暂无匹配标签", en: "No matching tags"),
                            systemImage: "tag",
                            description: Text(env.preferences.t("可以输入名称创建新标签。", en: "Enter a name to create a new tag."))
                        )
                    }
                }
            }
            .padding(.top, 12)
            .navigationTitle(env.preferences.t("选择标签", en: "Choose tags"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(env.preferences.t("完成", en: "Done")) { dismiss() }
                }
            }
            .task { loadTags() }
        }
    }

    private func loadTags() {
        guard let scope = env.session.dataScope else { return }
        do {
            availableTags = try env.mirror.listTags(scope: scope)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ tag: String) {
        if let index = selection.firstIndex(of: tag) {
            selection.remove(at: index)
        } else if selection.count < 24 {
            selection.append(tag)
        }
        onChange(selection)
    }

    private func createTag() {
        let additions = normalizedQuery
            .split(whereSeparator: { $0 == "," || $0 == "，" || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        for tag in additions where selection.count < 24 && !selection.contains(tag) {
            selection.append(tag)
        }
        query = ""
        onChange(selection)
    }
}


// MARK: - Compact notebook picker for create/edit

private struct EditNotebookPickerSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    let notebooks: [Notebook]
    let selectedId: String
    var onSelect: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(env.preferences.t("选择笔记本", en: "Choose notebook"))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(AppTheme.title)
                Spacer()
                Button(env.preferences.t("关闭", en: "Close")) { dismiss() }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.slate)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(AppTheme.card)
            .overlay(alignment: .bottom) {
                Rectangle().fill(AppTheme.border).frame(height: 1)
            }

            List {
                ForEach(notebooks, id: \.id) { nb in
                    Button {
                        onSelect(nb.id)
                        dismiss()
                    } label: {
                        HStack {
                            Text(nb.name)
                                .foregroundStyle(AppTheme.title)
                            Spacer()
                            if nb.id == selectedId {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(AppTheme.accent)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
        }
        .background(AppTheme.card)
    }
}
