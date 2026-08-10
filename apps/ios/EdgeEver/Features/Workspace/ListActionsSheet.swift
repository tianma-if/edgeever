import SwiftUI

/// Android `NotesActionsModal` parity: floating sheet with handle, subtitle, density + sort options.
struct ListActionsSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Bindable var store: WorkspaceStore
    @Environment(\.dismiss) private var dismiss

    private var listTitle: String { store.activeNotebook?.name ?? env.preferences.t("全部笔记", en: "All notes") }
    private var listDescription: String {
        env.preferences.t("\(store.totalCount) 条笔记", en: "\(store.totalCount) notes")
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(env.preferences.t("列表选项", en: "List options"))
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text("\(listTitle) · \(listDescription)")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.title)
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .overlay(alignment: .bottom) {
                Rectangle().fill(AppTheme.border).frame(height: 1)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !store.selectionMode {
                        sheetItem(
                            icon: "checkmark.square",
                            label: env.preferences.t("选择笔记", en: "Select notes"),
                            disabled: store.memos.isEmpty
                        ) {
                            store.enterSelection()
                            dismiss()
                        }
                        divider
                    }

                    sectionTitle(env.preferences.t("显示方式", en: "Display"))
                    optionRow(
                        active: env.preferences.listDensity == .preview,
                        icon: "doc.text",
                        label: env.preferences.t("预览列表", en: "Preview list")
                    ) {
                        env.preferences.listDensity = .preview
                        dismiss()
                    }
                    optionRow(
                        active: env.preferences.listDensity == .compact,
                        icon: "list.bullet",
                        label: env.preferences.t("紧凑列表", en: "Compact list")
                    ) {
                        env.preferences.listDensity = .compact
                        dismiss()
                    }

                    divider
                    sectionTitle(env.preferences.t("排序方式", en: "Sort by"))
                    optionRow(
                        active: store.sort == .updatedDesc,
                        icon: nil,
                        label: env.preferences.t("最近更新", en: "Recently updated")
                    ) {
                        store.sort = .updatedDesc
                        store.reload(env: env)
                        dismiss()
                    }
                    optionRow(
                        active: store.sort == .createdDesc,
                        icon: nil,
                        label: env.preferences.t("创建时间", en: "Created time")
                    ) {
                        store.sort = .createdDesc
                        store.reload(env: env)
                        dismiss()
                    }
                    optionRow(
                        active: store.sort == .titleAsc,
                        icon: nil,
                        label: env.preferences.t("标题 A-Z", en: "Title A-Z")
                    ) {
                        store.sort = .titleAsc
                        store.reload(env: env)
                        dismiss()
                    }

                    divider
                    sheetItem(
                        icon: "arrow.clockwise",
                        label: env.preferences.t("立即同步", en: "Sync now"),
                        disabled: false
                    ) {
                        Task {
                            await env.runSyncCycle()
                            store.reload(env: env)
                            dismiss()
                        }
                    }
                }
                .padding(8)
            }
        }
        .background(AppTheme.card)
        .presentationDetents([.medium])
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(MobileUIMetrics.floatingSheetCornerRadius)
    }

    private var divider: some View {
        Rectangle()
            .fill(AppTheme.cardBorder)
            .frame(height: 1)
            .padding(.vertical, 8)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(AppTheme.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
    }

    private func sheetItem(icon: String, label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(AppTheme.title)
                    .frame(width: 22)
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.title)
                Spacer()
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }

    private func optionRow(active: Bool, icon: String?, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(active ? AppTheme.accentBright : AppTheme.secondary)
                        .frame(width: 22)
                }
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(active ? AppTheme.accentStrong : AppTheme.title)
                Spacer()
                ZStack {
                    Circle()
                        .fill(active ? AppTheme.accentBright : Color.clear)
                        .frame(width: 22, height: 22)
                    if active {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .opacity(active ? 1 : 0)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background(active ? AppTheme.accentSoft.opacity(0.55) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
