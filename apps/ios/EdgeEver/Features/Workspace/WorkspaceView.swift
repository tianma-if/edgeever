import SwiftUI
import UIKit
import Pow

/// Wrapper so `fullScreenCover(item:)` can present edit for a memo id.
struct EditingMemoRoute: Identifiable, Hashable {
    let id: String
    let initialFocus: MemoEditInitialFocus
}

struct WorkspaceView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var store = WorkspaceStore()
    @State private var path = NavigationPath()
    @State private var showSettings = false
    @State private var showNewNote = false
    @State private var createSeed: CreateMemoSeed?
    @State private var createSharedImages: [ShareHandoffStore.SharedImage] = []
    @State private var showCreateChoice = false
    @State private var showTemplatePicker = false
    @State private var createLongPressConsumed = false
    @State private var showMoveSheet = false
    @State private var showSelectionMore = false
    @State private var conflictItem: OutboxItem?
    @State private var createTapCount = 0
    @State private var syncPulse = 0
    /// Edit is presented from the workspace root — more reliable than cover on a pushed detail page.
    @State private var editingMemo: EditingMemoRoute?
    /// Create finished id, applied as list bounce after cover dismiss + reload.
    @State private var pendingCreateBounceId: String?
    @State private var incomingClipURL: URL?
    @State private var isImportingShare = false
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
                    syncBanner
                    listHeader
                    NotesListView(
                        store: store,
                        path: $path,
                        onCreateNote: { openCreateNote() },
                        onCreateFromTemplate: { openCreateFromTemplate() }
                    )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                MemoDetailView(memoId: memoId) { editId, initialFocus in
                    // 1) Show edit cover over detail.
                    editingMemo = EditingMemoRoute(id: editId, initialFocus: initialFocus)
                    // 2) After the cover is up, silently drop detail so the underlay is the list.
                    //    Dismissing edit then reveals list only — no detail flash.
                    DispatchQueue.main.async {
                        var t = Transaction()
                        t.disablesAnimations = true
                        withTransaction(t) {
                            path = NavigationPath()
                        }
                    }
                }
            }
            // Android Me is full-screen (activeView === "settings"), not a half-sheet Form.
            .fullScreenCover(isPresented: $showSettings) {
                SettingsView()
            }
            // Android CreateMemoModal is fullScreen — not a half sheet / Form.
            .fullScreenCover(isPresented: $showNewNote) {
                MemoEditView(
                    mode: .create(
                        notebookId: store.selectedNotebookId ?? store.notebooks.first?.id ?? "",
                        seed: createSeed
                    ),
                    initialSharedImages: createSharedImages,
                    onCreateFinished: { memoId in
                        // Prime list + bounce **before** dismiss so settle runs under/with the cover,
                        // not half a second after the list is already static.
                        store.reload(env: env)
                        store.requestMemoBounce(memoId: memoId)
                        pendingCreateBounceId = nil
                    }
                )
                .onDisappear {
                    createSeed = nil
                    createSharedImages = []
                    // Safety refresh if create finished without callback (e.g. swipe-dismiss empty).
                    store.reload(env: env)
                }
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
            .fullScreenCover(item: $editingMemo) { route in
                MemoEditView(
                    mode: .edit(memoId: route.id),
                    initialFocus: route.initialFocus,
                    onLeaveToList: {
                        // Pop detail first (no animation) while cover still covers the stack,
                        // then dismiss the cover so the user only ever sees the list.
                        let bounceId = route.id
                        // Reload + start settle **before** clearing the cover so the spring
                        // is already in motion when the list is revealed (no post-dismiss pause).
                        store.reload(env: env)
                        store.requestMemoBounce(memoId: bounceId)
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
            .sheet(isPresented: $showMoveSheet) {
                MoveNotebookSheet(notebooks: store.notebooks) { notebookId in
                    Task {
                        await store.moveSelection(env: env, notebookId: notebookId)
                        showMoveSheet = false
                    }
                }
            }
            .sheet(isPresented: $showSelectionMore) {
                SelectionMoreSheet(store: store)
                    .presentationDetents([.height(290), .medium])
                    .presentationDragIndicator(.hidden)
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
                detectConflicts()
            }
            .onReceive(NotificationCenter.default.publisher(for: .edgeEverShareReceived)) { _ in
                consumeShare()
            }
            .onChange(of: env.session.session?.token) { _, _ in
                store.reload(env: env)
            }
            .onChange(of: env.isSyncing) { wasSyncing, isSyncing in
                // Refresh list when a background/bootstrap sync finishes.
                if wasSyncing && !isSyncing {
                    store.reload(env: env)
                    syncPulse += 1
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
            .refreshable {
                await env.runSyncCycle(force: true)
                store.reload(env: env)
                detectConflicts()
            }
            .overlay {
                if isImportingShare {
                    ZStack {
                        Color.black.opacity(0.34).ignoresSafeArea()
                        VStack(spacing: 12) {
                            ProgressView()
                                .controlSize(.large)
                                .tint(AppTheme.accent)
                            Text(env.preferences.t("正在剪藏文章", en: "Clipping article"))
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(AppTheme.title)
                            Text(env.preferences.t("正在提取标题、正文和图片链接…", en: "Extracting the title, body, and image links…"))
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
            .alert(item: $shareImportAlert) { alert in
                Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    dismissButton: .default(Text(env.preferences.t("好的", en: "OK"))) {
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
                        ? env.preferences.t("选择笔记", en: "Select notes")
                        : env.preferences.t("已选择 \(store.selectedMemoIds.count) 条", en: "\(store.selectedMemoIds.count) selected"))
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                        .padding(.horizontal, 8)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
            }

            HStack(alignment: .center) {
                Button {
                    store.showNotebookPicker = true
                } label: {
                    HStack(spacing: 4) {
                        Text(store.activeNotebook?.name ?? env.preferences.t("全部笔记", en: "All notes"))
                            .font(AppTheme.notebookTitleFont)
                            .foregroundStyle(AppTheme.title)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AppTheme.secondary)
                    }
                    .frame(minHeight: MobileUIMetrics.compactControlHeight)
                }
                .buttonStyle(.plain)
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
                .accessibilityLabel(env.preferences.t("列表选项", en: "List options"))
            }
            .padding(.bottom, 12)

            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(searchActive ? AppTheme.accent : AppTheme.secondary)
                        .symbolEffect(.bounce, value: searchActive)
                    TextField(env.preferences.t("搜索笔记", en: "Search notes"), text: $store.searchText)
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
                    label: env.preferences.t("置顶", en: "Pinned")
                ) {
                    withAnimation(Motion.chip) {
                        store.toggleFilter(.pinned)
                    }
                    store.reload(env: env)
                }
                filterChip(
                    active: store.filter == .tagged,
                    systemImage: "tag",
                    label: env.preferences.t("有标签", en: "Tagged")
                ) {
                    withAnimation(Motion.chip) {
                        store.toggleFilter(.tagged)
                    }
                    store.reload(env: env)
                }
                filterChip(
                    active: store.filter == .untagged,
                    systemImage: "tag.fill",
                    label: env.preferences.t("无标签", en: "Untagged")
                ) {
                    withAnimation(Motion.chip) {
                        store.toggleFilter(.untagged)
                    }
                    store.reload(env: env)
                }
            }
            .edgeEverSelectionFeedback(store.filter)
            .onChange(of: store.searchText) { _, _ in
                store.scheduleSearch(env: env)
            }

            if searchActive || store.filter != .all {
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
        .animation(Motion.search, value: searchActive || store.filter != .all)
    }

    private var constraintBar: some View {
        let searchActive = !store.searchText.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: 8) {
            if searchActive {
                HStack(spacing: 4) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 10, weight: .bold))
                    Text(env.preferences.t("正在搜索", en: "Searching"))
                        .font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(AppTheme.accent)
                .clipShape(Capsule())

                Text(env.preferences.t("\(store.totalCount) 条结果", en: "\(store.totalCount) results"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.accentText)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(env.preferences.t("退出搜索", en: "Exit")) {
                    store.searchText = ""
                    store.reload(env: env)
                }
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(AppTheme.accentText)
            } else {
                Text(env.preferences.t("筛选：\(filterLabel) · \(store.totalCount) 条", en: "Filter: \(filterLabelEN) · \(store.totalCount)"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(env.preferences.t("重置", en: "Reset")) {
                    store.filter = .all
                    store.reload(env: env)
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
        switch store.filter {
        case .pinned: return "置顶"
        case .tagged: return "有标签"
        case .untagged: return "无标签"
        case .all: return "全部"
        }
    }

    private var filterLabelEN: String {
        switch store.filter {
        case .pinned: return "Pinned"
        case .tagged: return "Tagged"
        case .untagged: return "Untagged"
        case .all: return "All"
        }
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
                // Quiet ring when filter turns on (lower opacity than before — less "showy" than Android)
                .changeEffect(
                    .ping(shape: Circle(), style: AppTheme.filterActive.opacity(0.22), count: 1),
                    value: active,
                    isEnabled: active
                )
        }
        .buttonStyle(FilterChipButtonStyle(active: active))
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
                    label: env.preferences.t("首页", en: "Home"),
                    active: true
                ) {
                    withAnimation(Motion.chip) {
                        path = NavigationPath()
                    }
                }

                Button {
                    if createLongPressConsumed {
                        createLongPressConsumed = false
                        return
                    }
                    createTapCount += 1
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
                .buttonStyle(CreateButtonPressStyle())
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.45)
                        .onEnded { _ in
                            guard canCreate else { return }
                            createLongPressConsumed = true
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            showCreateChoice = true
                        }
                )
                .edgeEverCreatePing(count: createTapCount)
                .disabled(!canCreate)
                .accessibilityLabel(env.preferences.t("新建笔记", en: "New note"))
                .accessibilityHint(env.preferences.t("长按可从模板新建", en: "Long-press to create from a template"))
                .accessibilityIdentifier("bottomCreateButton")
                .frame(maxWidth: .infinity)

                bottomNavItem(
                    systemImage: "person",
                    label: env.preferences.t("我的", en: "Me"),
                    active: false
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
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(active ? AppTheme.title : AppTheme.secondary)
                Text(label)
                    .font(AppTheme.bottomNavFont)
                    .foregroundStyle(active ? AppTheme.title : AppTheme.secondary)
            }
            .frame(minWidth: 58, minHeight: MobileUIMetrics.minimumTouchTarget)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
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
                        Text(env.preferences.t("移动", en: "Move")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(store.selectedMemoIds.isEmpty)
                Button(role: .destructive) {
                    Task { await store.softDeleteSelection(env: env) }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "trash")
                        Text(env.preferences.t("删除", en: "Delete")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(store.selectedMemoIds.isEmpty)
                Button {
                    showSelectionMore = true
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "ellipsis")
                        Text(env.preferences.t("更多", en: "More")).font(.caption2.weight(.bold))
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
                    Text(env.preferences.t("正在同步笔记", en: "Syncing notes"))
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
        createSeed = seed
        createSharedImages = sharedImages
        showNewNote = true
    }

    private func openCreateFromTemplate() {
        guard !store.notebooks.isEmpty else { return }
        showTemplatePicker = true
    }

    private func consumeShare() {
        let payloads = env.shareHandoff.consumePending()
        guard !payloads.isEmpty else { return }
        let sharedImages = env.shareHandoff.sharedImages(from: payloads)
        if !sharedImages.isEmpty {
            guard !store.notebooks.isEmpty else {
                sharedImages.forEach(env.shareHandoff.removeImage)
                shareImportAlert = ShareImportAlert(
                    title: env.preferences.t("无法保存图片", en: "Unable to save images"),
                    message: env.preferences.t("请先在 EdgeEver 中创建一个笔记本。", en: "Create a notebook in EdgeEver first.")
                )
                return
            }
            openCreateNote(
                seed: CreateMemoSeed(
                    title: sharedImages.count == 1
                        ? env.preferences.t("分享的图片", en: "Shared image")
                        : env.preferences.t("分享的图片（\(sharedImages.count) 张）", en: "Shared images (\(sharedImages.count))"),
                    contentMarkdown: "",
                    tagsText: ""
                ),
                sharedImages: sharedImages
            )
            return
        }
        guard let sourceURL = WebClipper.sharedWebURL(from: payloads) else {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("无法剪藏", en: "Unable to clip"),
                message: env.preferences.t("分享内容里没有可识别的网页链接。", en: "The shared content does not contain a recognizable web link.")
            )
            return
        }
        guard !store.notebooks.isEmpty else {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("无法保存剪藏", en: "Unable to save clip"),
                message: env.preferences.t("请先在 EdgeEver 中创建一个笔记本。", en: "Create a notebook in EdgeEver first.")
            )
            return
        }

        isImportingShare = true
        if WebClipper.isWeChatArticle(sourceURL) {
            incomingClipURL = sourceURL
        } else {
            Task {
                let draft = await WebClipper.build(sourceURL)
                finishClip(draft)
            }
        }
    }

    private func finishRenderedClip(_ page: RenderedWebPage, sourceURL: URL) {
        finishClip(WebClipper.buildRendered(sourceURL, page: page))
    }

    private func failRenderedClip(_ message: String, sourceURL: URL) {
        incomingClipURL = nil
        Task {
            let draft = await WebClipper.build(sourceURL)
            isImportingShare = false
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("正文剪藏失败", en: "Article extraction failed"),
                message: message + env.preferences.t(
                    " 已保留文章链接，你可以稍后重新分享重试。",
                    en: " The article link was preserved; you can share it again later to retry."
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

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 12)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(env.preferences.t("批量操作", en: "Batch actions"))
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text(store.selectedMemoIds.isEmpty
                        ? env.preferences.t("选择笔记", en: "Select notes")
                        : env.preferences.t("已选择 \(store.selectedMemoIds.count) 条", en: "\(store.selectedMemoIds.count) selected"))
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
                .accessibilityLabel(env.preferences.t("关闭", en: "Close"))
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            selectionAction(
                icon: "checkmark.square",
                label: store.allVisibleMemosSelected
                    ? env.preferences.t("全不选当前列表", en: "Deselect current list")
                    : env.preferences.t("全选当前列表", en: "Select current list"),
                disabled: store.memos.isEmpty
            ) {
                store.toggleVisibleSelection()
                dismiss()
            }

            selectionAction(
                icon: "sparkles",
                label: store.nextSelectionPinValue
                    ? env.preferences.t("置顶", en: "Pin")
                    : env.preferences.t("取消置顶", en: "Unpin"),
                disabled: store.selectedMemoIds.isEmpty
            ) {
                let target = store.nextSelectionPinValue
                dismiss()
                Task { await store.pinSelection(env: env, isPinned: target) }
            }

            selectionAction(
                icon: "xmark",
                label: env.preferences.t("取消选择", en: "Clear selection"),
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
                Text(env.preferences.t("移动到", en: "Move to"))
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
                Spacer()
                Button(env.preferences.t("取消", en: "Cancel")) { dismiss() }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.slate)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AppTheme.secondary)
                TextField(env.preferences.t("搜索笔记本", en: "Search notebooks"), text: $query)
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
