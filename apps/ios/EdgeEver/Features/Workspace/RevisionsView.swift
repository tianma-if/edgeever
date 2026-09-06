import SwiftUI

struct RevisionsView: View {
    @Environment(AppEnvironment.self) private var env
    let memoId: String
    var memoTitle: String?
    var isDeleted: Bool = false
    var onRestored: () -> Void

    @State private var revisions: [MemoRevision] = []
    @State private var selectedId: String?
    @State private var error: String?
    @State private var restoreError: String?
    @State private var isLoading = true
    @State private var isRestoring = false
    @State private var confirmRestore: MemoRevision?

    private var selected: MemoRevision? {
        if let selectedId, let match = revisions.first(where: { $0.id == selectedId }) {
            return match
        }
        return revisions.first
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    summaryRow
                    timelineSection
                    previewSection
                    if let restoreError {
                        Text(restoreError)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.danger)
                    }
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .background(AppTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(env.preferences.t("版本历史", en: "Version history"))
                                .font(.system(size: 16, weight: .heavy))
                                .foregroundStyle(AppTheme.title)
                            Text(displayTitle)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(AppTheme.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        onRestored()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(AppTheme.title)
                            .frame(width: 32, height: 32)
                            .background(AppTheme.searchFill)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(env.preferences.t("关闭", en: "Close"))
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .confirmationDialog(
                env.preferences.t("恢复到这个历史版本", en: "Restore this version"),
                isPresented: Binding(
                    get: { confirmRestore != nil },
                    set: { if !$0 { confirmRestore = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button(env.preferences.t("恢复", en: "Restore")) {
                    if let rev = confirmRestore {
                        Task { await restore(rev) }
                    }
                }
                Button(env.preferences.t("取消", en: "Cancel"), role: .cancel) {
                    confirmRestore = nil
                }
            } message: {
                Text(
                    env.preferences.t(
                        "当前内容会被这个历史版本替换，恢复后仍会产生新的历史记录。",
                        en: "Current content will be replaced. Restoring creates a new history entry."
                    )
                )
            }
        }
    }

    // MARK: Summary + restore (Android revisionSummaryRow)

    private var summaryRow: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(
                    selected.map {
                        env.preferences.t("版本 \($0.revision)", en: "Version \($0.revision)")
                    } ?? env.preferences.t("未选择历史版本", en: "No version selected")
                )
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(AppTheme.title)
                Text(
                    env.preferences.t(
                        "选择历史记录后可预览并恢复。",
                        en: "Select a revision to preview and restore."
                    )
                )
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let selected {
                Button {
                    confirmRestore = selected
                } label: {
                    HStack(spacing: 6) {
                        if isRestoring {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.counterclockwise")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        Text(
                            isRestoring
                                ? env.preferences.t("恢复中", en: "Restoring")
                                : env.preferences.t("恢复该版本", en: "Restore")
                        )
                        .font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(canRestore ? AppTheme.title : AppTheme.muted)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(AppTheme.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!canRestore)
            }
        }
        .padding(14)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private var canRestore: Bool {
        !isRestoring && !isDeleted && selected != nil
    }

    // MARK: Timeline pills

    private var timelineSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(env.preferences.t("历史记录", en: "History"))
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(AppTheme.meta)

            if isLoading {
                timelineState {
                    ProgressView()
                    Text(env.preferences.t("加载中", en: "Loading"))
                        .font(.system(size: 13))
                        .foregroundStyle(AppTheme.secondary)
                }
            } else if let error {
                timelineState {
                    Text(env.preferences.t("加载失败", en: "Failed to load"))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(AppTheme.danger)
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        .multilineTextAlignment(.center)
                    Button(env.preferences.t("重试", en: "Retry")) {
                        Task { await load() }
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(AppTheme.title)
                }
            } else if revisions.isEmpty {
                timelineState {
                    Text(env.preferences.t("暂无历史版本", en: "No revisions yet"))
                        .font(.system(size: 13))
                        .foregroundStyle(AppTheme.secondary)
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(revisions) { rev in
                            revisionPill(rev)
                        }
                    }
                }
            }
        }
    }

    private func revisionPill(_ rev: MemoRevision) -> some View {
        let active = selected?.id == rev.id
        return Button {
            selectedId = rev.id
            restoreError = nil
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(env.preferences.t("版本 \(rev.revision)", en: "Version \(rev.revision)"))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(active ? .white : AppTheme.title)
                Text("\(MemoPreviewDate.format(rev.createdAt, locale: env.preferences.resolvedLocale, isEnglish: env.preferences.isEnglish)) · \(Self.formatActor(rev.createdBy))")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(active ? Color.white.opacity(0.9) : AppTheme.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(active ? AppTheme.filterActive : AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(active ? AppTheme.filterActive : AppTheme.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func timelineState<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 10) {
            content()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 12)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    // MARK: Preview

    @ViewBuilder
    private var previewSection: some View {
        if let selected {
            VStack(alignment: .leading, spacing: 8) {
                Text(env.preferences.t("预览", en: "Preview"))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(AppTheme.meta)
                Text(selected.contentMarkdown.isEmpty ? env.preferences.t("空笔记", en: "Empty note") : selected.contentMarkdown)
                    .font(.system(size: 14))
                    .foregroundStyle(AppTheme.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(14)
                    .background(AppTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
            }
        }
    }

    private var displayTitle: String {
        let t = memoTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? env.preferences.t("无标题笔记", en: "Untitled note") : t
    }

    /// Android `formatRevisionActor`.
    static func formatActor(_ actor: String) -> String {
        if actor.hasPrefix("user:") { return "user" }
        if actor.hasPrefix("agent:") { return "agent" }
        return actor.isEmpty ? "system" : actor
    }

    private func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let list = try await env.session.client.listMemoRevisions(memoId: memoId)
            revisions = list
            if selectedId == nil || !list.contains(where: { $0.id == selectedId }) {
                selectedId = list.first?.id
            }
        } catch {
            self.error = error.localizedDescription
            revisions = []
        }
    }

    private func restore(_ rev: MemoRevision) async {
        guard let scope = env.session.dataScope else { return }
        isRestoring = true
        restoreError = nil
        defer {
            isRestoring = false
            confirmRestore = nil
        }
        do {
            let memo = try await env.session.client.restoreMemoRevision(memoId: memoId, revisionId: rev.id)
            try env.mirror.upsertMemo(scope: scope, memo: memo)
            await env.runSyncCycle()
            onRestored()
        } catch {
            restoreError = error.localizedDescription
        }
    }
}
