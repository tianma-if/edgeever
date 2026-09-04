import SwiftUI
import Pow

struct NotesListView: View {
    @Environment(AppEnvironment.self) private var env
    @Bindable var store: WorkspaceStore
    @Binding var path: NavigationPath
    var onCreateNote: (() -> Void)? = nil
    var onCreateFromTemplate: (() -> Void)? = nil

    /// Whole-list settle + Pow jump once when data first becomes available this session.
    @State private var listEntranceSettled = false
    @State private var listEntrancePulse = 0
    @State private var didScheduleListEntrance = false
    /// First-paint cascade: cards insert with Pow boing (cleared after entrance finishes).
    @State private var listEntranceCascade = false

    /// First-login / first-mirror bootstrap (Android `initialSyncProgress`).
    private var hasBootstrapProgress: Bool {
        env.bootstrapProgress != nil
    }

    private var bootstrapLoaded: Int {
        env.bootstrapProgress?.loadedCount ?? 0
    }

    private var bootstrapTotal: Int {
        env.bootstrapProgress?.totalCount ?? 0
    }

    private var bootstrapPercent: Double {
        guard bootstrapTotal > 0 else { return 0 }
        return min(1, Double(bootstrapLoaded) / Double(bootstrapTotal))
    }

    private var bootstrapTitle: String {
        env.preferences.t("正在同步笔记", en: "Syncing notes")
    }

    private var bootstrapDescription: String {
        if bootstrapTotal > 0 {
            return env.preferences.t(
                "已加载 \(bootstrapLoaded) / \(bootstrapTotal) 条笔记",
                en: "Loaded \(bootstrapLoaded) of \(bootstrapTotal) notes"
            )
        }
        return env.preferences.t("正在准备首次同步…", en: "Preparing first sync…")
    }

    var body: some View {
        Group {
            // Android MemoList: full loading card while first mirror is empty.
            if hasBootstrapProgress && store.memos.isEmpty {
                bootstrapLoadingCard
                    .transition(Motion.softFade)
            } else if store.memos.isEmpty && env.lastSyncError != nil && !store.isLoadingList {
                // Failed first sync with no cached notes — don't pretend the account is empty.
                initialSyncErrorCard
                    .transition(Motion.softFade)
            } else if store.notebooks.isEmpty && store.memos.isEmpty && !store.isLoadingList {
                emptyCard(
                    title: env.preferences.t("暂无笔记本", en: "No notebooks"),
                    description: env.preferences.t(
                        "同步完成后，笔记本会出现在这里。可在桌面/Web 端创建笔记本。",
                        en: "Notebooks appear after sync. Create them on desktop/web."
                    ),
                    showCreate: false
                )
                .transition(Motion.softFade)
            } else if store.memos.isEmpty && !store.isLoadingList {
                emptyCard(title: emptyTitle, description: emptyDescription, showCreate: store.searchText.isEmpty && store.filter == .all)
                    .transition(Motion.softFade)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        // Android FlatList `list`: paddingTop 12, paddingHorizontal 12, paddingBottom 18
                        LazyVStack(spacing: 0) {
                            if hasBootstrapProgress {
                                bootstrapProgressBanner
                                    // memoSyncBanner marginBottom: 10
                                    .padding(.bottom, 10)
                            } else if env.lastSyncError != nil, !store.memos.isEmpty {
                                syncPausedBanner
                                    .padding(.bottom, 10)
                            }

                            ForEach(Array(store.memos.enumerated()), id: \.element.id) { index, memo in
                                memoCard(for: memo)
                                    .padding(.bottom, env.preferences.listDensity.cardBottomMargin)
                                    .id(memo.id)
                                    // First open: elastic boing cascade. Later reshuffles: quiet opacity.
                                    .transition(listEntranceCascade ? Motion.listCardEntrance : Motion.cardAppear)
                                    .animation(
                                        listEntranceCascade
                                            ? Motion.listEntrance.delay(Double(min(index, 12)) * Motion.listEntranceStagger)
                                            : Motion.listContent,
                                        value: listEntranceCascade
                                    )
                                    .onAppear {
                                        if memo.id == store.memos.last?.id {
                                            store.loadMore(env: env)
                                        }
                                    }
                            }
                            if store.isLoadingMore {
                                ProgressView()
                                    .tint(AppTheme.title)
                                    .padding(.vertical, 18)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .padding(.bottom, 18)
                        .animation(Motion.listContent, value: store.memos.map(\.id))
                        .animation(Motion.listContent, value: store.filter)
                        .animation(Motion.listContent, value: store.searchText)
                        .animation(Motion.search, value: hasBootstrapProgress)
                    }
                    .contentMargins(.bottom, 0, for: .scrollContent)
                    .background(AppTheme.background)
                    .edgeEverNotesListEntrance(settled: listEntranceSettled, entrancePulse: listEntrancePulse)
                    .onChange(of: store.bounceMemoId) { _, memoId in
                        guard let memoId else { return }
                        // Scroll immediately (no delayed animation beat) so the settling card is on-screen.
                        if store.memos.contains(where: { $0.id == memoId }) {
                            proxy.scrollTo(memoId, anchor: .top)
                        }
                        // Clear bounce marker after settle completes (~0.42s spring).
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                            if store.bounceMemoId == memoId {
                                store.clearMemoBounce()
                            }
                        }
                    }
                    .onChange(of: store.bouncePulse) { _, _ in
                        // If id remapped after create sync, ensure the new row is visible.
                        if let memoId = store.bounceMemoId,
                           store.memos.contains(where: { $0.id == memoId }) {
                            proxy.scrollTo(memoId, anchor: .top)
                        }
                    }
                }
            }
        }
        .animation(Motion.listContent, value: store.memos.isEmpty)
        .animation(Motion.search, value: hasBootstrapProgress)
        .onChange(of: store.memos.count) { _, count in
            scheduleListEntranceIfNeeded(hasMemos: count > 0)
        }
        .onAppear {
            scheduleListEntranceIfNeeded(hasMemos: !store.memos.isEmpty)
        }
        .overlay(alignment: .bottom) {
            if let err = store.listError {
                Text(err)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.danger)
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(AppTheme.card.opacity(0.96))
                    .transition(Motion.softFade)
                    .edgeEverErrorShake(on: err)
            }
        }
        .animation(Motion.search, value: store.listError)
        .accessibilityElement(children: .contain)
    }

    // MARK: - First-sync progress (pixel tokens from Android workspace-styles.ts)

    /// Android `memoListStateWrap` + `memoListLoadingCard`.
    private var bootstrapLoadingCard: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                ProgressView()
                    .controlSize(.large)
                    .tint(AppTheme.syncProgressFill)

                Text(bootstrapTitle)
                    .font(.system(size: 16, weight: AppTheme.heavy))
                    .foregroundStyle(AppTheme.title)
                    .multilineTextAlignment(.center)
                    .padding(.top, 14)

                Text(bootstrapDescription)
                    .font(.system(size: 13))
                    .foregroundStyle(AppTheme.secondary)
                    .lineSpacing(4) // ~lineHeight 20 on 13pt
                    .multilineTextAlignment(.center)
                    .padding(.top, 7)
                    .frame(maxWidth: 300)

                if bootstrapTotal > 0 {
                    // Android `memoSyncProgressTrack` marginTop: 10
                    bootstrapProgressTrack(percent: bootstrapPercent)
                        .padding(.top, 10)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 34)
            .background(AppTheme.card)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                    .foregroundStyle(AppTheme.accentBorder)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8))
            // memoListStateWrap: paddingHorizontal 12, paddingTop 16
            .padding(.horizontal, 12)
            .padding(.top, 16)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(bootstrapTitle). \(bootstrapDescription)")

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(AppTheme.background)
    }

    /// Android `memoSyncBanner` (+ track always visible while bootstrap is active).
    private var bootstrapProgressBanner: some View {
        HStack(alignment: .center, spacing: 12) {
            ProgressView()
                .controlSize(.small)
                .tint(AppTheme.syncProgressFill)

            VStack(alignment: .leading, spacing: 0) {
                Text(bootstrapTitle)
                    .font(.system(size: 13, weight: AppTheme.heavy))
                    .foregroundStyle(AppTheme.accentText)

                Text(bootstrapDescription)
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.accentStrong)
                    .padding(.top, 2)

                bootstrapProgressTrack(percent: bootstrapPercent)
                    .padding(.top, 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(AppTheme.accentSoft)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppTheme.accentBorder, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(bootstrapTitle). \(bootstrapDescription)")
    }

    /// Android `memoSyncProgressTrack` / `memoSyncProgressFill`.
    private func bootstrapProgressTrack(percent: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(AppTheme.syncProgressTrack)
                Capsule()
                    .fill(AppTheme.syncProgressFill)
                    .frame(width: max(0, geo.size.width * percent))
                    .animation(.easeOut(duration: 0.2), value: percent)
            }
        }
        .frame(height: 4)
        .frame(maxWidth: .infinity)
        .clipShape(Capsule())
    }

    /// Android `memoListErrorCard` + retry.
    private var initialSyncErrorCard: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Text(env.preferences.t("暂时没有拉到笔记", en: "Could not load notes"))
                    .font(.system(size: 14, weight: AppTheme.heavy))
                    .foregroundStyle(AppTheme.syncErrorTitle)
                    .multilineTextAlignment(.center)

                Text(env.preferences.t(
                    "网络或 PWA 后台恢复可能短暂中断了同步。这里不会把它当作空笔记本。",
                    en: "A network hiccup may have interrupted sync. This is not treated as an empty notebook."
                ))
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.syncErrorBody)
                .lineSpacing(4) // ~lineHeight 20
                .multilineTextAlignment(.center)
                .padding(.top, 8)
                .frame(maxWidth: 300)

                Button {
                    Task { await env.runSyncCycle(force: true) }
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 15, weight: .semibold))
                        Text(env.preferences.t("重试", en: "Retry"))
                            .font(.system(size: 13, weight: AppTheme.heavy))
                    }
                    .foregroundStyle(AppTheme.syncErrorBody)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .background(AppTheme.syncErrorRetryFill)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .padding(.top, 16)
                .accessibilityLabel(env.preferences.t("重试加载", en: "Retry loading"))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 34)
            .background(AppTheme.syncErrorBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                    .foregroundStyle(AppTheme.syncErrorBorder)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 12)
            .padding(.top, 16)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(AppTheme.background)
    }

    /// Android `memoSyncErrorBanner` (no technical error string in the banner body).
    private var syncPausedBanner: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(env.preferences.t("同步已暂停", en: "Sync paused"))
                    .font(.system(size: 13, weight: AppTheme.heavy))
                    .foregroundStyle(AppTheme.syncErrorTitle)

                Text(env.preferences.t(
                    "已加载的笔记仍可使用，请检查网络后重试。",
                    en: "Loaded notes remain available. Check your connection and retry."
                ))
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.syncErrorBody)
                .lineSpacing(3) // ~lineHeight 18
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                Task { await env.runSyncCycle(force: true) }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                    Text(env.preferences.t("重试", en: "Retry"))
                        .font(.system(size: 13, weight: AppTheme.heavy))
                }
                .foregroundStyle(AppTheme.syncErrorBody)
                .padding(.horizontal, 4)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(AppTheme.syncErrorBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppTheme.syncErrorBorder, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func scheduleListEntranceIfNeeded(hasMemos: Bool) {
        guard hasMemos, !didScheduleListEntrance else { return }
        didScheduleListEntrance = true
        listEntranceSettled = false
        listEntranceCascade = true
        // Next frame: settle in (stagger lives on per-card delay, not a late global jump).
        DispatchQueue.main.async {
            withAnimation(Motion.listEntrance) {
                listEntranceSettled = true
            }
            listEntrancePulse &+= 1
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.85) {
            listEntranceCascade = false
        }
    }

    private var emptyTitle: String {
        if !store.searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            return env.preferences.t("没有找到匹配笔记", en: "No matching notes")
        }
        if store.filter != .all {
            return env.preferences.t("没有符合筛选的笔记", en: "No notes match this filter")
        }
        return env.preferences.t("暂无笔记", en: "No notes yet")
    }

    private var emptyDescription: String {
        if !store.searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            return env.preferences.t("换个关键词再试", en: "Try another keyword")
        }
        if store.filter != .all {
            return env.preferences.t("试试切换筛选条件，或调整搜索关键词。", en: "Try another filter or search.")
        }
        return env.preferences.t(
            "先创建一条笔记，之后可以在这里快速预览、搜索和批量整理。",
            en: "Create a note to preview, search, and batch-organize here."
        )
    }

    /// Android `memoListEmptyCard` + `emptyTitle` / `mutedText` + dual create actions.
    private func emptyCard(title: String, description: String, showCreate: Bool) -> some View {
        VStack(spacing: 10) {
            Text(title)
                .font(.system(size: 16, weight: AppTheme.heavy))
                .foregroundStyle(AppTheme.meta)
            Text(description)
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.secondary)
                .multilineTextAlignment(.center)
            if showCreate, !store.notebooks.isEmpty {
                HStack(spacing: 8) {
                    if let onCreateNote {
                        Button(action: onCreateNote) {
                            HStack(spacing: 8) {
                                Image(systemName: "plus")
                                    .font(.system(size: 14, weight: .bold))
                                Text(env.preferences.t("新建笔记", en: "New note"))
                                    .font(.system(size: 13, weight: .heavy))
                            }
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 38)
                            .background(AppTheme.title)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("emptyCreateNote")
                    }
                    if let onCreateFromTemplate {
                        Button(action: onCreateFromTemplate) {
                            HStack(spacing: 8) {
                                Image(systemName: "square.grid.2x2")
                                    .font(.system(size: 13, weight: .semibold))
                                Text(env.preferences.t("从模板新建", en: "New from template"))
                                    .font(.system(size: 13, weight: .heavy))
                            }
                            .foregroundStyle(AppTheme.title)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 38)
                            .background(AppTheme.card)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(AppTheme.border, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("emptyCreateFromTemplate")
                    }
                }
                .padding(.top, 0)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 34)
        .background(AppTheme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                .foregroundStyle(AppTheme.emptyDashBorder)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        // memoListEmptyCard: marginHorizontal 12, marginTop 12
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(AppTheme.background)
    }

    @ViewBuilder
    private func memoCard(for memo: MemoSummary) -> some View {
        let selected = store.selectedMemoIds.contains(memo.id)
        let density = env.preferences.listDensity
        let bouncePulse = store.bounceMemoId == memo.id ? store.bouncePulse : 0

        Button {
            if store.selectionMode {
                store.toggleSelected(memo.id)
            } else {
                path.append(memo.id)
            }
        } label: {
            memoCardChrome(memo: memo, selected: selected, density: density)
                .contextMenu {
                    Button {
                        Task { await store.togglePin(env: env, memo: memo) }
                    } label: {
                        Label(
                            memo.isPinned
                                ? env.preferences.t("取消置顶", en: "Unpin")
                                : env.preferences.t("置顶", en: "Pin"),
                            systemImage: memo.isPinned ? "pin.slash" : "pin"
                        )
                    }
                    Button(role: .destructive) {
                        Task { await store.softDelete(env: env, memoId: memo.id) }
                    } label: {
                        Label(env.preferences.t("删除", en: "Delete"), systemImage: "trash")
                    }
                }
        }
        .buttonStyle(MemoCardPressStyle())
        // Return-from-create/edit rebound on this card only.
        .edgeEverMemoReturnBounce(pulse: bouncePulse)
        .edgeEverSelectionFeedback(selected)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.52).onEnded { _ in
                if !store.selectionMode {
                    store.enterSelection(memoId: memo.id)
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                }
            }
        )
    }

    /// Visual chrome for a list card.
    @ViewBuilder
    private func memoCardChrome(memo: MemoSummary, selected: Bool, density: ListDensity) -> some View {
        HStack(alignment: .center, spacing: 0) {
            if store.selectionMode {
                ZStack {
                    Circle()
                        .stroke(selected ? AppTheme.title : AppTheme.border, lineWidth: 1)
                        .background(Circle().fill(selected ? AppTheme.title : Color.clear))
                        .frame(width: 24, height: 24)
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: 44)
                .padding(.leading, 8)
                .animation(Motion.chip, value: selected)
            }

            MemoCardContent(
                memo: memo,
                density: density,
                locale: env.preferences.resolvedLocale,
                isEnglish: env.preferences.isEnglish,
                sort: store.sort
            )
            .padding(density.cardPadding)
            .padding(.leading, store.selectionMode ? 12 : density.cardPadding)
        }
        .frame(maxWidth: .infinity, minHeight: density.cardMinHeight, alignment: .leading)
        .background(selected ? AppTheme.background : AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(selected ? AppTheme.border : AppTheme.cardBorder, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .animation(Motion.chip, value: selected)
    }
}

/// Android MemoCard content: title (+ pin star) → optional excerpt → date + tag chips.
struct MemoCardContent: View {
    let memo: MemoSummary
    var density: ListDensity = .preview
    var locale: Locale = .current
    var isEnglish: Bool = false
    var sort: MemoSortMode = .updatedDesc

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 6) {
                if memo.isPinned {
                    Text("★")
                        .font(.system(size: 16))
                        .foregroundStyle(AppTheme.secondary)
                        .frame(width: 16, height: 16)
                }
                Text(displayTitle)
                    .font(AppTheme.memoTitleFont)
                    .foregroundStyle(AppTheme.title)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if density.showsExcerpt {
                Text(memo.excerpt.isEmpty ? (isEnglish ? "Empty note" : "空笔记") : memo.excerpt)
                    .font(AppTheme.memoExcerptFont)
                    .foregroundStyle(AppTheme.body)
                    .lineLimit(2)
                    .lineSpacing(2)
                    .frame(minHeight: 40, alignment: .topLeading)
                    .padding(.top, 8)
            }

            HStack(alignment: .center, spacing: 8) {
                Text("\(timestampLabel) \(MemoPreviewDate.format(timestampField.value(from: memo), locale: locale, isEnglish: isEnglish))")
                    .font(AppTheme.memoDateFont)
                    .foregroundStyle(AppTheme.meta)
                ForEach(Array(memo.tags.prefix(3)), id: \.self) { tag in
                    Text("#\(tag)")
                        .font(AppTheme.tagFont)
                        .foregroundStyle(AppTheme.title)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppTheme.tagBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
                }
            }
            .padding(.top, density.metaTop)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var displayTitle: String {
        let t = memo.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? (isEnglish ? "Untitled note" : "无标题笔记") : t
    }

    private var timestampField: MemoListTimestampField {
        MemoListTimestampField.resolve(for: sort)
    }

    private var timestampLabel: String {
        switch timestampField {
        case .createdAt: isEnglish ? "Created" : "创建"
        case .updatedAt: isEnglish ? "Updated" : "更新"
        }
    }
}
