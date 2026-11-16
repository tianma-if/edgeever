import SwiftUI
import UIKit

/// Wrapper so `fullScreenCover(item:)` can present edit for a memo id.
struct EditingMemoRoute: Identifiable, Hashable {
    let id: String
    let initialFocus: MemoEditInitialFocus
}

private struct ShareImageMemoRoute: Hashable {
    let memoId: String
}

private struct SelectionSharePayload: Identifiable {
    let id = UUID()
    let message: String
    let url: URL
}

/// Keep each create editor's input fixed until its save and cover dismissal finish.
struct MemoCreatePresentation {
    struct Request: Identifiable {
        let id = UUID()
        let seed: CreateMemoSeed?
        let sharedImages: [ShareHandoffStore.SharedImage]

        init(seed: CreateMemoSeed?, sharedImages: [ShareHandoffStore.SharedImage] = []) {
            self.seed = seed
            self.sharedImages = sharedImages
        }
    }

    private(set) var current: Request?
    private(set) var pending: [Request] = []
    var shouldFinishForIncomingShare: Bool { !pending.isEmpty }

    /// Returns true only when a new cover can be presented immediately.
    mutating func open(_ request: Request) -> Bool {
        guard current == nil else {
            pending.append(request)
            return false
        }
        current = request
        return true
    }

    /// Called by fullScreenCover's onDismiss, after the old editor has gone away.
    mutating func didDismiss() -> Bool {
        current = pending.isEmpty ? nil : pending.removeFirst()
        return current != nil
    }
}

struct WorkspaceView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = WorkspaceStore()
    @State private var path = NavigationPath()
    @State private var showSettings = false
    @State private var showNewNote = false
    @State private var createPresentation = MemoCreatePresentation()
    @State private var showCreateChoice = false
    @State private var showTemplatePicker = false
    @State private var createLongPressConsumed = false
    @State private var showMoveSheet = false
    @State private var showSelectionMore = false
    @State private var pendingMemoShare: MemoSummary?
    @State private var pendingImageShareMemoId: String?
    @State private var selectionSharePayload: SelectionSharePayload?
    @State private var conflictItem: OutboxItem?
    /// Edit is presented from the workspace root — more reliable than cover on a pushed detail page.
    @State private var editingMemo: EditingMemoRoute?
    @State private var incomingClipURL: URL?
    @State private var isImportingShare = false
    @State private var isImportingWeChat = false
    @State private var shareImportAlert: ShareImportAlert?

    /// Android SafeAreaView edges=[top,left,right] — bottom chrome owns home indicator.
    private var showsBottomChrome: Bool {
        store.selectionMode || path.isEmpty
    }

    /// Solid chrome height = nav band + home-indicator. Create button sits *inside* the band
    /// (below the top separator), so list padding must not invent a second empty strip.
    private var bottomChromeHeight: CGFloat {
        MobileUIMetrics.bottomChromeHeight
    }

    var body: some View {
        NavigationStack(path: $path) {
            // List pads the solid white chrome height; create button lives inside the tab bar under the separator.
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    if showSettings {
                        SettingsView(onClose: { showSettings = false })
                    } else {
                        syncBanner
                        listHeader
                        NotesListView(
                            store: store,
                            path: $path,
                            onCreateNote: { openCreateNote() },
                            onCreateFromTemplate: { openCreateFromTemplate() },
                            onCreateNotebook: {
                                store.startCreatingNotebook = true
                                store.showNotebookPicker = true
                            }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .background(AppTheme.background)
                .padding(.bottom, showsBottomChrome ? bottomChromeHeight : 0)

                if store.selectionMode {
                    selectionBar
                } else if path.isEmpty {
                    bottomNav
                }
            }
            .ignoresSafeArea(.container, edges: .bottom)
            .navigationBarHidden(true)
            .navigationDestination(for: String.self) { memoId in
                memoDetail(for: memoId)
            }
            .navigationDestination(for: ShareImageMemoRoute.self) { route in
                memoDetail(for: route.memoId, shareImage: true)
            }
            // Android CreateMemoModal is fullScreen — not a half sheet / Form.
            .fullScreenCover(isPresented: $showNewNote, onDismiss: {
                showNewNote = createPresentation.didDismiss()
                store.reload(env: env)
                consumeWeChatArchive()
            }) {
                MemoEditView(
                    mode: .create(
                        notebookId: store.selectedNotebookId ?? store.notebooks.first?.id ?? "",
                        seed: createPresentation.current?.seed
                    ),
                    initialSharedImages: createPresentation.current?.sharedImages ?? [],
                    finishForIncomingShare: createPresentation.shouldFinishForIncomingShare,
                    onCreateFinished: { _ in
                        store.reload(env: env)
                    }
                )
                .id(createPresentation.current?.id)
            }
            .sheet(isPresented: $showCreateChoice) {
                CreateChoiceSheet(
                    canCreate: !store.notebooks.isEmpty,
                    onBlank: { openCreateNote() },
                    onTemplate: { openCreateFromTemplate() }
                )
            }
            .sheet(isPresented: $showTemplatePicker) {
                TemplatePickerSheet { seed in
                    openCreateNote(seed: seed)
                }
            }
            // Edit cover on workspace root; underlay is list (detail popped once cover is presented).
            .fullScreenCover(item: $editingMemo, onDismiss: consumeWeChatArchive) { route in
                MemoEditView(
                    mode: .edit(memoId: route.id),
                    initialFocus: route.initialFocus,
                    onLeaveToList: {
                        // Pop detail first (no animation) while cover still covers the stack,
                        // then dismiss the cover so the user only ever sees the list.
                        store.reload(env: env)
                        var t = Transaction()
                        t.disablesAnimations = true
                        withTransaction(t) {
                            path = NavigationPath()
                        }
                        editingMemo = nil
                    }
                )
            }
            .sheet(isPresented: $store.showNotebookPicker) {
                NotebookPickerSheet(store: store)
            }
            .sheet(isPresented: $store.showActions) {
                ListActionsSheet(store: store)
            }
            .sheet(isPresented: $store.showTagFilterPicker) {
                MemoTagPickerSheet(
                    selectedTags: store.selectedTag.map { [$0] } ?? [],
                    allowCreate: false,
                    maxSelections: 1,
                    closeOnSelection: true,
                    title: "按标签筛选",
                    titleEN: "Filter by tag",
                    titlePL: "Filtruj według tagu"
                ) { tags in
                    store.selectTag(tags.first)
                    store.reload(env: env)
                }
                .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showMoveSheet) {
                MoveNotebookSheet(notebooks: store.notebooks) { notebookId in
                    Task {
                        await store.moveSelection(env: env, notebookId: notebookId)
                        showMoveSheet = false
                    }
                }
            }
            .sheet(isPresented: $showSelectionMore, onDismiss: {
                if let memo = pendingMemoShare {
                    pendingMemoShare = nil
                    Task { await shareSelectedMemo(memo) }
                    return
                }
                guard let memoId = pendingImageShareMemoId else { return }
                pendingImageShareMemoId = nil
                store.clearSelection()
                path.append(ShareImageMemoRoute(memoId: memoId))
            }) {
                SelectionMoreSheet(
                    store: store,
                    onShare: { memo in pendingMemoShare = memo },
                    onShareImage: { memo in pendingImageShareMemoId = memo.id }
                )
                    .presentationDetents([.height(390), .medium])
                    .presentationDragIndicator(.hidden)
            }
            .sheet(item: $selectionSharePayload) { payload in
                ActivityShareView(items: [payload.message, payload.url]) { _, _, error in
                    if let error {
                        shareImportAlert = ShareImportAlert(
                            title: env.preferences.t("分享失败", en: "Share failed", pl: "Udostępnianie nie powiodło się"),
                            message: error.localizedDescription
                        )
                    }
                    selectionSharePayload = nil
                }
            }
            .sheet(item: $conflictItem) { item in
                ConflictResolutionView(item: item) {
                    conflictItem = nil
                    store.reload(env: env)
                }
            }
            .onAppear {
                store.reload(env: env)
                consumeShare()
                consumeWeChatArchive()
                detectConflicts()
            }
            .onReceive(NotificationCenter.default.publisher(for: .edgeEverShareReceived)) { _ in
                consumeShare()
                consumeWeChatArchive()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { consumeWeChatArchive() }
            }
            .onChange(of: showSettings) { _, open in
                if !open { consumeWeChatArchive() }
            }
            .onChange(of: env.session.session?.token) { _, _ in
                store.reload(env: env)
            }
            .onChange(of: env.isSyncing) { wasSyncing, isSyncing in
                // Refresh list when a background/bootstrap sync finishes.
                if wasSyncing && !isSyncing {
                    store.reload(env: env)
                    consumeWeChatArchive()
                }
            }
            // Android invalidates the memo list on each bootstrap batch so the UI
            // can show progressive counts / partial notes during first login.
            .onChange(of: env.bootstrapProgress?.loadedCount) { _, _ in
                store.reload(env: env)
            }
            .onChange(of: env.bootstrapProgress?.totalCount) { _, _ in
                store.reload(env: env)
            }
            .onChange(of: env.preferences.showDescendantNotes) { _, _ in
                store.reload(env: env)
            }
            .refreshable {
                await env.runSyncCycle(force: true)
                store.reload(env: env)
                detectConflicts()
            }
            .overlay {
                if isImportingShare || isImportingWeChat {
                    ZStack {
                        Color.black.opacity(0.34).ignoresSafeArea()
                        VStack(spacing: 12) {
                            ProgressView()
                                .controlSize(.large)
                                .tint(AppTheme.accent)
                            Text(shareProgressTitle)
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(AppTheme.title)
                            Text(shareProgressDescription)
                                .font(.system(size: 13))
                                .foregroundStyle(AppTheme.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(24)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                        if let incomingClipURL {
                            WebClipCaptureView(
                                url: incomingClipURL,
                                onCaptured: { page in finishRenderedClip(page, sourceURL: incomingClipURL) },
                                onFailed: { message in failRenderedClip(message, sourceURL: incomingClipURL) }
                            )
                            .frame(width: 1, height: 1)
                            .opacity(0.01)
                            .allowsHitTesting(false)
                        }
                    }
                    .accessibilityIdentifier("shareImportOverlay")
                }
            }
            .onChange(of: shareImportAlert?.id) { _, id in
                if id == nil {
                    consumeShare()
                    consumeWeChatArchive()
                }
            }
            .alert(item: $shareImportAlert) { alert in
                Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    dismissButton: .default(Text(env.preferences.t("好的", en: "OK", pl: "OK"))) {
                        if let draft = alert.draft { finishClip(draft) }
                    }
                )
            }
        }
        .preferredColorScheme(env.preferences.colorScheme)
    }

    // MARK: - Header (Android NotesView parity)

    private var listHeader: some View {
        let searchActive = !store.searchText.trimmingCharacters(in: .whitespaces).isEmpty
        return VStack(alignment: .leading, spacing: 0) {
            if store.selectionMode {
                HStack(spacing: 0) {
                    Button {
                        store.clearSelection()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AppTheme.slate)
                            .frame(width: 38, height: 38)
                    }
                    Text(store.selectedMemoIds.isEmpty
                        ? env.preferences.t("选择笔记", en: "Select notes", pl: "Wybierz notatki")
                        : env.preferences.t("已选择 \(store.selectedMemoIds.count) 条", en: "\(store.selectedMemoIds.count) selected", pl: "Zaznaczone: \(store.selectedMemoIds.count)"))
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                        .padding(.horizontal, 8)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
            }

            HStack(alignment: .center) {
                Button {
                    if store.selectedTag != nil {
                        clearTagFilter()
                    } else {
                        store.showNotebookPicker = true
                    }
                } label: {
                    HStack(spacing: 4) {
                        if store.selectedTag != nil {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        Text(store.selectedTag.map { "#\($0)" } ?? store.activeNotebook?.name ?? env.preferences.t("全部笔记", en: "All notes", pl: "Wszystkie notatki"))
                            .font(AppTheme.notebookTitleFont)
                            .foregroundStyle(AppTheme.title)
                            .lineLimit(1)
                        if store.selectedTag == nil {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(AppTheme.secondary)
                        }
                    }
                    .frame(minHeight: MobileUIMetrics.compactControlHeight)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    store.selectedTag == nil
                        ? env.preferences.t("切换笔记本", en: "Switch notebook", pl: "Przełącz notatnik")
                        : env.preferences.t("返回笔记列表", en: "Back to notes", pl: "Wróć do notatek")
                )
                Spacer(minLength: 8)
                Button {
                    store.showActions = true
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(AppTheme.slate)
                        .frame(width: MobileUIMetrics.compactControlHeight, height: MobileUIMetrics.compactControlHeight)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(env.preferences.t("列表选项", en: "List options", pl: "Opcje listy"))
            }
            .padding(.bottom, 12)

            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(searchActive ? AppTheme.accent : AppTheme.secondary)
                    TextField(env.preferences.t("搜索笔记", en: "Search notes", pl: "Szukaj notatek"), text: $store.searchText)
                        .font(AppTheme.searchFont)
                        .foregroundStyle(AppTheme.title)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if searchActive {
                        Button {
                            withAnimation(Motion.search) {
                                store.searchText = ""
                            }
                            store.reload(env: env)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(AppTheme.secondary)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 12)
                .frame(height: MobileUIMetrics.compactControlHeight)
                .background(searchActive ? AppTheme.searchActiveFill : AppTheme.searchFill)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(searchActive ? AppTheme.accentBright : Color.clear, lineWidth: 1)
                )
                .animation(Motion.search, value: searchActive)

                filterChip(
                    active: store.filter == .pinned,
                    // Match Android pin filter glyph (star outline / filled when active)
                    systemImage: store.filter == .pinned ? "star.fill" : "star",
                    label: env.preferences.t("置顶", en: "Pinned", pl: "Przypięte")
                ) {
                    withAnimation(Motion.chip) {
                        store.toggleFilter(.pinned)
                    }
                    store.reload(env: env)
                }
                filterChip(
                    active: store.selectedTag != nil,
                    systemImage: store.selectedTag == nil ? "tag" : "tag.fill",
                    label: store.selectedTag.map { "#\($0)" }
                        ?? env.preferences.t("按标签筛选", en: "Filter by tag", pl: "Filtruj według tagu")
                ) {
                    store.showTagFilterPicker = true
                }
            }
            .edgeEverSelectionFeedback(store.filter)
            .animation(Motion.chip, value: store.selectedTag)
            .onChange(of: store.searchText) { _, _ in
                store.scheduleSearch(env: env)
            }

            if searchActive || store.filter != .all || store.selectedTag != nil {
                constraintBar
                    .padding(.top, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(AppTheme.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.border).frame(height: 1)
        }
        .animation(Motion.search, value: searchActive || store.filter != .all || store.selectedTag != nil)
    }

    private var constraintBar: some View {
        let searchActive = !store.searchText.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: 8) {
            if searchActive {
                HStack(spacing: 4) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 10, weight: .bold))
                    Text(env.preferences.t("正在搜索", en: "Searching", pl: "Wyszukiwanie"))
                        .font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(AppTheme.accent)
                .clipShape(Capsule())

                Text(env.preferences.t("\(store.totalCount) 条结果", en: "\(store.totalCount) results", pl: "Wyniki: \(store.totalCount)"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.accentText)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(env.preferences.t("退出搜索", en: "Exit", pl: "Zakończ")) {
                    store.searchText = ""
                    store.reload(env: env)
                }
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(AppTheme.accentText)
            } else {
                Text(env.preferences.t("筛选：\(filterLabel) · \(store.totalCount) 条", en: "Filter: \(filterLabelEN) · \(store.totalCount)", pl: "Filtr: \(filterLabelPL) · \(store.totalCount)"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(env.preferences.t("重置", en: "Reset", pl: "Resetuj")) {
                    if store.selectedTag != nil {
                        clearTagFilter()
                    } else {
                        store.filter = .all
                        store.reload(env: env)
                    }
                }
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(AppTheme.slate)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minHeight: 32)
        .background(searchActive ? AppTheme.searchActiveFill : AppTheme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(searchActive ? AppTheme.accentBorder : AppTheme.border, lineWidth: 1)
        )
        .overlay(alignment: .leading) {
            if searchActive {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(AppTheme.accentBright)
                    .frame(width: 3)
                    .padding(.vertical, 1)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var filterLabel: String {
        if let selectedTag = store.selectedTag { return "#\(selectedTag)" }
        switch store.filter {
        case .pinned: return "置顶"
        case .tagged: return "有标签"
        case .untagged: return "无标签"
        case .all: return "全部"
        }
    }

    private var filterLabelEN: String {
        if let selectedTag = store.selectedTag { return "#\(selectedTag)" }
        switch store.filter {
        case .pinned: return "Pinned"
        case .tagged: return "Tagged"
        case .untagged: return "Untagged"
        case .all: return "All"
        }
    }

    private var filterLabelPL: String {
        if let selectedTag = store.selectedTag { return "#\(selectedTag)" }
        switch store.filter {
        case .pinned: return "Przypięte"
        case .tagged: return "Z tagami"
        case .untagged: return "Bez tagów"
        case .all: return "Wszystkie"
        }
    }

    private func clearTagFilter() {
        store.clearTagFilter()
        store.reload(env: env)
    }

    private func filterChip(active: Bool, systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(active ? .white : AppTheme.slate)
                .frame(width: MobileUIMetrics.compactControlHeight, height: MobileUIMetrics.compactControlHeight)
                .background(active ? AppTheme.filterActive : AppTheme.card)
                .clipShape(Circle())
                .overlay(Circle().stroke(active ? AppTheme.filterActive : AppTheme.border, lineWidth: 1))
                .accessibilityLabel(label)
        }
        .buttonStyle(.plain)
    }

    /// Bottom tab chrome:
    /// 1. top separator
    /// 2. Home | Create | Me — all *below* the separator (create must not sit on the line)
    /// 3. home-indicator slab
    /// Create is slightly smaller than the 52pt Android float so it fits cleanly under the line.
    private var bottomNav: some View {
        let canCreate = !store.notebooks.isEmpty
        let bottomInset = MobileUIMetrics.bottomSafeInset
        let createSize = MobileUIMetrics.bottomCreateButtonSize

        return VStack(spacing: 0) {
            // Separator first — tab content is strictly below this line.
            Rectangle()
                .fill(AppTheme.border)
                .frame(height: 1)
                .frame(maxWidth: .infinity)

            HStack(spacing: 0) {
                bottomNavItem(
                    systemImage: "house.fill",
                    label: env.preferences.t("首页", en: "Home", pl: "Start"),
                    active: !showSettings
                ) {
                    showSettings = false
                    withAnimation(Motion.chip) {
                        path = NavigationPath()
                    }
                    if store.selectedTag != nil {
                        clearTagFilter()
                    }
                }

                Button {
                    if createLongPressConsumed {
                        createLongPressConsumed = false
                        return
                    }
                    openCreateNote()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(canCreate ? .white : AppTheme.disabledText)
                        .frame(width: createSize, height: createSize)
                        .background(canCreate ? AppTheme.accentAction : AppTheme.disabledFill)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Color.white, lineWidth: 3))
                        .shadow(
                            color: AppTheme.fabShadow.opacity(canCreate ? 0.28 : 0),
                            radius: 6,
                            y: 3
                        )
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.45)
                        .onEnded { _ in
                            guard canCreate else { return }
                            createLongPressConsumed = true
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            showCreateChoice = true
                        }
                )
                .disabled(!canCreate)
                .accessibilityLabel(env.preferences.t("新建笔记", en: "New note", pl: "Nowa notatka"))
                .accessibilityHint(env.preferences.t("长按可从模板新建", en: "Long-press to create from a template", pl: "Przytrzymaj, aby utworzyć z szablonu"))
                .accessibilityIdentifier("bottomCreateButton")
                .frame(maxWidth: .infinity)

                bottomNavItem(
                    systemImage: "person",
                    label: env.preferences.t("我的", en: "Me", pl: "Profil"),
                    active: showSettings
                ) {
                    showSettings = true
                }
            }
            .padding(.horizontal, 28)
            .frame(height: MobileUIMetrics.bottomNavigationHeight)
            .frame(maxWidth: .infinity)

            // Home indicator — same white surface, continuous with the 52pt band.
            AppTheme.card
                .frame(height: bottomInset)
                .frame(maxWidth: .infinity)
        }
        .background(AppTheme.card)
        .accessibilityIdentifier("bottomNav")
    }

    private func bottomNavItem(
        systemImage: String,
        label: String,
        active: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: active ? .semibold : .regular))
                    .foregroundStyle(active ? AppTheme.accentAction : AppTheme.secondary)
                Text(label)
                    .font(AppTheme.bottomNavFont)
                    .foregroundStyle(active ? AppTheme.title : AppTheme.secondary)
            }
            .frame(width: 80, height: 48)
            .overlay(alignment: .top) {
                if active {
                    Capsule()
                        .fill(AppTheme.accentAction)
                        .frame(width: 20, height: 3)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }

    private func memoDetail(for memoId: String, shareImage: Bool = false) -> some View {
        MemoDetailView(memoId: memoId, initialShareImage: shareImage) { editId, initialFocus in
            editingMemo = EditingMemoRoute(id: editId, initialFocus: initialFocus)
            // Keep the list under the editor so dismissing it does not flash the detail page.
            DispatchQueue.main.async {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    path = NavigationPath()
                }
            }
        }
    }

    private func shareSelectedMemo(_ memo: MemoSummary) async {
        do {
            let share = try await env.session.client.createMemoShare(memoId: memo.id)
            let base = env.session.session?.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
            guard let url = URL(string: "\(base)/share/\(share.token)") else { return }
            let title = memo.title?.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayTitle = title?.isEmpty == false
                ? title!
                : env.preferences.t("无标题笔记", en: "Untitled note", pl: "Notatka bez tytułu")
            selectionSharePayload = SelectionSharePayload(message: "\(displayTitle)\n\(url.absoluteString)", url: url)
        } catch {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("分享失败", en: "Share failed", pl: "Udostępnianie nie powiodło się"),
                message: error.localizedDescription
            )
        }
    }

    private var selectionBar: some View {
        let bottomInset = MobileUIMetrics.bottomSafeInset
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                Button {
                    showMoveSheet = true
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "folder")
                        Text(env.preferences.t("移动", en: "Move", pl: "Przenieś")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(store.selectedMemoIds.isEmpty)
                Button(role: .destructive) {
                    Task { await store.softDeleteSelection(env: env) }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "trash")
                        Text(env.preferences.t("删除", en: "Delete", pl: "Usuń")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(store.selectedMemoIds.isEmpty)
                Button {
                    showSelectionMore = true
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "ellipsis")
                        Text(env.preferences.t("更多", en: "More", pl: "Więcej")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .frame(height: MobileUIMetrics.bottomNavigationHeight, alignment: .top)
            .frame(maxWidth: .infinity)

            AppTheme.card
                .frame(height: bottomInset)
                .frame(maxWidth: .infinity)
        }
        .background(AppTheme.card)
        .overlay(alignment: .top) {
            Rectangle().fill(AppTheme.border).frame(height: 1)
        }
        .accessibilityIdentifier("selectionBar")
    }

    /// Quiet indicator for incremental sync only.
    /// First-login progress + sync-error banners live in `NotesListView` (Android MemoList parity).
    private var syncBanner: some View {
        Group {
            if env.isSyncing && env.bootstrapProgress == nil {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(AppTheme.accent)
                    Text(env.preferences.t("正在同步笔记", en: "Syncing notes", pl: "Synchronizowanie notatek"))
                        .font(.caption2)
                        .foregroundStyle(AppTheme.secondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(AppTheme.card)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(Motion.search, value: env.isSyncing)
        .animation(Motion.search, value: env.bootstrapProgress != nil)
    }

    private func openCreateNote(
        seed: CreateMemoSeed? = nil,
        sharedImages: [ShareHandoffStore.SharedImage] = []
    ) {
        guard !store.notebooks.isEmpty else { return }
        if createPresentation.open(.init(seed: seed, sharedImages: sharedImages)) {
            showNewNote = true
        }
    }

    private func openCreateFromTemplate() {
        guard !store.notebooks.isEmpty else { return }
        showTemplatePicker = true
    }

    private var shareProgressTitle: String {
        isImportingWeChat
            ? env.preferences.t("正在导入微信聊天记录", en: "Importing WeChat chat", ja: "WeChat のチャットを取り込んでいます", pl: "Importowanie czatu WeChat")
            : env.preferences.t("正在剪藏文章", en: "Clipping article", ja: "記事を取り込んでいます", pl: "Przechwytywanie artykułu")
    }

    private var shareProgressDescription: String {
        isImportingWeChat
            ? env.preferences.t("正在保存消息和附件…", en: "Saving messages and attachments…", ja: "メッセージと添付ファイルを保存しています…", pl: "Zapisywanie wiadomości i załączników…")
            : env.preferences.t("正在提取标题、正文和图片链接…", en: "Extracting the title, body, and image links…", ja: "タイトル、本文、画像リンクを抽出しています…", pl: "Wyodrębnianie tytułu, treści i linków do obrazów…")
    }

    private func consumeWeChatArchive() {
        guard scenePhase == .active, !isImportingWeChat, !isImportingShare, shareImportAlert == nil,
              !showSettings, !showNewNote, editingMemo == nil,
              let scope = env.session.dataScope, let session = env.session.session,
              let baseURL = try? EdgeEverURLNormalizer.normalizeInstanceURL(session.baseUrl),
              let notebook = store.activeNotebook ?? store.notebooks.first(where: { $0.slug == "inbox" }) ?? store.notebooks.first,
              let directory = WeChatShareInbox.sharedDirectory, let item = WeChatShareInbox.next(in: directory)
        else { return }
        isImportingWeChat = true
        // Pin this import to the instance and account that accepted it.
        let client = APIClient(baseURL: baseURL, token: session.token)
        Task {
            var archive: WeChatChatArchive?
            var succeeded = false
            defer {
                if let archive { try? FileManager.default.removeItem(at: archive.temporaryDirectory) }
                try? FileManager.default.removeItem(at: item.directory)
                isImportingWeChat = false
                if succeeded {
                    consumeShare()
                    consumeWeChatArchive()
                }
            }
            do {
                guard let formatter = Bundle.main.url(forResource: "wechat-chat-transcript", withExtension: "cjs") else {
                    throw WeChatArchiveError.invalidArchive
                }
                let prepared = try await Task.detached(priority: .userInitiated) {
                    try WeChatChatArchive.prepare(item.archiveURL, formatterURL: formatter)
                }.value
                archive = prepared
                guard env.session.dataScope == scope else { return }
                // Release the original before making server writes. An interrupted
                // upload must not be replayed as a second note after relaunch.
                try FileManager.default.removeItem(at: item.directory)
                let memo = try await WeChatChatImport.save(prepared, notebookID: notebook.id, client: client)
                try? env.mirror.upsertMemo(scope: scope, memo: memo)
                guard env.session.dataScope == scope else { return }
                store.clearSelection()
                store.reload(env: env)
                path = NavigationPath()
                path.append(memo.id)
                succeeded = true
            } catch {
                guard env.session.dataScope == scope else { return }
                shareImportAlert = ShareImportAlert(
                    title: env.preferences.t("无法导入微信聊天记录", en: "Could not import the WeChat chat", ja: "WeChat のチャットを取り込めませんでした", pl: "Nie udało się zaimportować czatu WeChat"),
                    message: weChatImportErrorMessage(error, prepared: archive != nil)
                )
            }
        }
    }

    private func weChatImportErrorMessage(_ error: Error, prepared: Bool) -> String {
        switch error as? WeChatArchiveError {
        case .insufficientSpace:
            return env.preferences.t("手机存储空间不足。请释放一些空间，然后从微信重新分享。", en: "Free up storage on your iPhone, then share the chat again.", ja: "iPhone の空き容量を増やしてから、チャットを再共有してください。", pl: "Zwolnij miejsce na iPhonie, a następnie udostępnij czat ponownie.")
        case .expansionLimit:
            return env.preferences.t("解压后的聊天记录超过 256 MB。请分批从微信分享。", en: "The extracted chat exceeds 256 MB. Share it in smaller batches.", ja: "展開後のチャットが 256 MB を超えています。分割して共有してください。", pl: "Rozpakowany czat przekracza 256 MB. Udostępnij go w mniejszych partiach.")
        case .incompleteMemo:
            return env.preferences.t("导入中断，可能留下了一条未完成的笔记。", en: "The import was interrupted and may have left an incomplete note.", ja: "取り込みが中断され、不完全なノートが残っている可能性があります。", pl: "Import został przerwany i mógł pozostawić niekompletną notatkę.")
        default:
            return prepared
                ? env.preferences.t("请检查网络连接，然后从微信重新分享。", en: "Check your connection and share the chat from WeChat again.", ja: "ネットワーク接続を確認し、WeChat から再共有してください。", pl: "Sprawdź połączenie, a następnie udostępnij czat ponownie z WeChat.")
                : env.preferences.t("无法读取聊天压缩包。请从微信重新分享聊天记录。", en: "Could not read the chat archive. Share the chat from WeChat again.", ja: "チャットのアーカイブを読み込めませんでした。WeChat から再共有してください。", pl: "Nie udało się odczytać archiwum czatu. Udostępnij czat ponownie z WeChat.")
        }
    }

    private func consumeShare() {
        guard !isImportingWeChat else { return }
        let payloads = env.shareHandoff.consumePending()
        guard !payloads.isEmpty else { return }
        let sharedImages = env.shareHandoff.sharedImages(from: payloads)
        if !sharedImages.isEmpty {
            guard !store.notebooks.isEmpty else {
                sharedImages.forEach(env.shareHandoff.removeImage)
                shareImportAlert = ShareImportAlert(
                    title: env.preferences.t("无法保存图片", en: "Unable to save images", pl: "Nie można zapisać obrazów"),
                    message: env.preferences.t("请先在 EdgeEver 中创建一个笔记本。", en: "Create a notebook in EdgeEver first.", pl: "Najpierw utwórz notatnik w EdgeEver.")
                )
                return
            }
            openCreateNote(
                seed: CreateMemoSeed(
                    title: sharedImages.count == 1
                        ? env.preferences.t("分享的图片", en: "Shared image", pl: "Udostępniony obraz")
                        : env.preferences.t("分享的图片（\(sharedImages.count) 张）", en: "Shared images (\(sharedImages.count))", pl: "Udostępnione obrazy (\(sharedImages.count))"),
                    contentMarkdown: "",
                    tagsText: ""
                ),
                sharedImages: sharedImages
            )
            return
        }
        guard let sourceURL = WebClipper.sharedWebURL(from: payloads) else {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("无法剪藏", en: "Unable to clip", pl: "Nie można przechwycić strony"),
                message: env.preferences.t("分享内容里没有可识别的网页链接。", en: "The shared content does not contain a recognizable web link.", pl: "Udostępniona treść nie zawiera rozpoznawalnego linku do strony.")
            )
            return
        }
        guard !store.notebooks.isEmpty else {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("无法保存剪藏", en: "Unable to save clip", pl: "Nie można zapisać wycinka"),
                message: env.preferences.t("请先在 EdgeEver 中创建一个笔记本。", en: "Create a notebook in EdgeEver first.", pl: "Najpierw utwórz notatnik w EdgeEver.")
            )
            return
        }

        isImportingShare = true
        if WebClipper.isWeChatArticle(sourceURL) {
            incomingClipURL = sourceURL
        } else {
            Task {
                let draft = await WebClipper.build(sourceURL, labels: webClipLabels)
                finishClip(draft)
            }
        }
    }

    private func finishRenderedClip(_ page: RenderedWebPage, sourceURL: URL) {
        finishClip(WebClipper.buildRendered(sourceURL, page: page, labels: webClipLabels))
    }

    private var webClipLabels: WebClipLabels {
        WebClipLabels(
            sourceLabel: env.preferences.t("来源", en: "Source", ja: "出典", pl: "Źródło"),
            capturedAtLabel: env.preferences.t("剪藏时间", en: "Captured at", ja: "取り込み日時", pl: "Przechwycono"),
            unavailableBody: env.preferences.t(
                "正文暂时无法抓取，来源链接已保留，可稍后重试。",
                en: "Could not extract the page text. The source link is kept so you can retry later.",
                ja: "本文を取り込めませんでした。出典リンクは残してあるので、あとからやり直せます。",
                pl: "Nie udało się wyodrębnić tekstu strony. Link źródłowy został zachowany, więc możesz spróbować ponownie później."
            ),
            fallbackTitle: env.preferences.t("网页剪藏", en: "Web clip", ja: "ウェブクリップ", pl: "Wycinek strony"),
            imageAlt: env.preferences.t("图片", en: "Image", ja: "画像", pl: "Obraz"),
            usesFullwidthColon: env.preferences.uiLanguage == .chinese
        )
    }

    private func localizedCaptureFailure(_ message: String) -> String {
        switch message {
        case "微信文章加载超时。":
            return env.preferences.t(
                "微信文章加载超时。",
                en: "The WeChat article took too long to load.",
                ja: "WeChat 記事の読み込みがタイムアウトしました。",
                pl: "Wczytywanie artykułu WeChat trwało zbyt długo."
            )
        case "页面加载完成，但没有找到可剪藏的正文。":
            return env.preferences.t(
                "页面加载完成，但没有找到可剪藏的正文。",
                en: "The page finished loading, but there was no article text to clip.",
                ja: "ページの読み込みは終わりましたが、取り込める本文がありません。",
                pl: "Strona została wczytana, ale nie zawiera tekstu artykułu do przechwycenia."
            )
        case "没有找到可剪藏的正文。":
            return env.preferences.t(
                "没有找到可剪藏的正文。",
                en: "No article text was found to clip.",
                ja: "取り込める本文が見つかりません。",
                pl: "Nie znaleziono tekstu artykułu do przechwycenia."
            )
        default:
            return message
        }
    }

    private func failRenderedClip(_ message: String, sourceURL: URL) {
        incomingClipURL = nil
        Task {
            let draft = await WebClipper.build(sourceURL, labels: webClipLabels)
            isImportingShare = false
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("正文剪藏失败", en: "Article extraction failed", ja: "本文を取り込めませんでした", pl: "Nie udało się wyodrębnić artykułu"),
                message: localizedCaptureFailure(message) + " " + env.preferences.t(
                    "已保留文章链接，你可以稍后重新分享重试。",
                    en: "The article link was kept. Share it again later to retry.",
                    ja: "記事リンクは残してあります。あとから再共有してやり直せます。",
                    pl: "Link do artykułu został zachowany. Udostępnij go ponownie później, aby spróbować jeszcze raz."
                ),
                draft: draft
            )
        }
    }

    private func finishClip(_ draft: WebClipDraft) {
        incomingClipURL = nil
        isImportingShare = false
        openCreateNote(seed: draft.createSeed)
    }

    private func detectConflicts() {
        guard let scope = env.session.dataScope else { return }
        let items = (try? env.outbox.listItems(scope: scope)) ?? []
        conflictItem = items.first { $0.status == .conflict }
    }
}

private struct ShareImportAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    var draft: WebClipDraft? = nil
}

// NotebookPickerSheet / ListActionsSheet live in their own files for Android parity.

struct SelectionMoreSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Bindable var store: WorkspaceStore
    let onShare: (MemoSummary) -> Void
    let onShareImage: (MemoSummary) -> Void

    private var shareableMemo: MemoSummary? {
        guard store.selectedMemoIds.count == 1,
              let memo = store.memos.first(where: { store.selectedMemoIds.contains($0.id) }),
              !memo.isDeleted else { return nil }
        return memo
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 12)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(env.preferences.t("批量操作", en: "Batch actions", pl: "Działania zbiorcze"))
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text(store.selectedMemoIds.isEmpty
                        ? env.preferences.t("选择笔记", en: "Select notes", pl: "Wybierz notatki")
                        : env.preferences.t("已选择 \(store.selectedMemoIds.count) 条", en: "\(store.selectedMemoIds.count) selected", pl: "Zaznaczone: \(store.selectedMemoIds.count)"))
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(AppTheme.title)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(env.preferences.t("关闭", en: "Close", pl: "Zamknij"))
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            selectionAction(
                icon: "checkmark.square",
                label: store.allVisibleMemosSelected
                    ? env.preferences.t("全不选当前列表", en: "Deselect current list", pl: "Odznacz bieżącą listę")
                    : env.preferences.t("全选当前列表", en: "Select current list", pl: "Zaznacz bieżącą listę"),
                disabled: store.memos.isEmpty
            ) {
                store.toggleVisibleSelection()
                dismiss()
            }

            selectionAction(
                icon: "sparkles",
                label: store.nextSelectionPinValue
                    ? env.preferences.t("置顶", en: "Pin", pl: "Przypnij")
                    : env.preferences.t("取消置顶", en: "Unpin", pl: "Odepnij"),
                disabled: store.selectedMemoIds.isEmpty
            ) {
                let target = store.nextSelectionPinValue
                dismiss()
                Task { await store.pinSelection(env: env, isPinned: target) }
            }

            selectionAction(
                icon: "square.and.arrow.up",
                label: env.preferences.t("分享笔记", en: "Share note", pl: "Udostępnij notatkę"),
                disabled: shareableMemo == nil
            ) {
                guard let memo = shareableMemo else { return }
                dismiss()
                onShare(memo)
            }

            selectionAction(
                icon: "photo",
                label: env.preferences.t("分享为图片", en: "Share as image", pl: "Udostępnij jako obraz"),
                disabled: shareableMemo == nil
            ) {
                guard let memo = shareableMemo else { return }
                onShareImage(memo)
                dismiss()
            }

            selectionAction(
                icon: "xmark",
                label: env.preferences.t("取消选择", en: "Clear selection", pl: "Wyczyść zaznaczenie"),
                disabled: false
            ) {
                store.clearSelection()
                dismiss()
            }

            Spacer(minLength: 0)
        }
        .background(AppTheme.card)
    }

    private func selectionAction(
        icon: String,
        label: String,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 24)
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
            }
            .foregroundStyle(disabled ? AppTheme.muted : AppTheme.title)
            .padding(.horizontal, 18)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

struct MoveNotebookSheet: View {
    @Environment(AppEnvironment.self) private var env
    let notebooks: [Notebook]
    var onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack {
                Text(env.preferences.t("移动到", en: "Move to", pl: "Przenieś do"))
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
                Spacer()
                Button(env.preferences.t("取消", en: "Cancel", pl: "Anuluj")) { dismiss() }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.slate)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AppTheme.secondary)
                TextField(env.preferences.t("搜索笔记本", en: "Search notebooks", pl: "Szukaj notatników"), text: $query)
                    .font(.system(size: 14))
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(AppTheme.searchFill)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            ScrollView {
                let items = NotebookHierarchy.treeItems(from: notebooks)
                let visible = NotebookHierarchy.searchVisibleIds(notebooks: notebooks, searchText: query)
                VStack(spacing: 0) {
                    ForEach(items.filter { visible.contains($0.id) }) { item in
                        Button {
                            onPick(item.id)
                        } label: {
                            Text(item.name)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(AppTheme.title)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.leading, CGFloat(min(item.depth * 18, 54)))
                                .padding(.horizontal, 12)
                                .frame(minHeight: 48)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .background(AppTheme.card)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
    }
}
