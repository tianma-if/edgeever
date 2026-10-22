import SwiftUI

/// Android `NotesActionsModal` parity: floating sheet with handle, subtitle, density + sort options.
struct ListActionsSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Bindable var store: WorkspaceStore
    @Environment(\.dismiss) private var dismiss

    private var listTitle: String {
        if let selectedTag = store.selectedTag { return "#\(selectedTag)" }
        return store.activeNotebook?.name ?? env.preferences.t("全部笔记", en: "All notes", pl: "Wszystkie notatki")
    }
    private var listDescription: String {
        env.preferences.t("\(store.totalCount) 条笔记", en: "\(store.totalCount) notes", pl: "Notatki: \(store.totalCount)")
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
                    Text(env.preferences.t("列表选项", en: "List options", pl: "Opcje listy"))
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
                            label: env.preferences.t("选择笔记", en: "Select notes", pl: "Wybierz notatki"),
                            disabled: store.memos.isEmpty
                        ) {
                            store.enterSelection()
                            dismiss()
                        }
                        sheetItem(
                            icon: "tag",
                            label: env.preferences.t("按标签筛选", en: "Filter by tag", pl: "Filtruj według tagu"),
                            disabled: false
                        ) {
                            dismiss()
                            DispatchQueue.main.async {
                                store.showTagFilterPicker = true
                            }
                        }
                        divider
                    }

                    sectionTitle(env.preferences.t("显示方式", en: "Display", pl: "Widok"))
                    optionRow(
                        active: env.preferences.listDensity == .preview,
                        icon: "doc.text",
                        label: env.preferences.t("预览列表", en: "Preview list", pl: "Lista z podglądem")
                    ) {
                        env.preferences.listDensity = .preview
                        dismiss()
                    }
                    optionRow(
                        active: env.preferences.listDensity == .compact,
                        icon: "list.bullet",
                        label: env.preferences.t("紧凑列表", en: "Compact list", pl: "Lista kompaktowa")
                    ) {
                        env.preferences.listDensity = .compact
                        dismiss()
                    }

                    divider
                    sectionTitle(env.preferences.t("排序方式", en: "Sort by", pl: "Sortuj według"))
                    optionRow(
                        active: store.sort == .updatedDesc,
                        icon: nil,
                        label: env.preferences.t("最近更新", en: "Recently updated", pl: "Ostatnio zaktualizowane")
                    ) {
                        store.sort = .updatedDesc
                        store.reload(env: env)
                        dismiss()
                    }
                    optionRow(
                        active: store.sort == .createdDesc,
                        icon: nil,
                        label: env.preferences.t("创建时间", en: "Created time", pl: "Data utworzenia")
                    ) {
                        store.sort = .createdDesc
                        store.reload(env: env)
                        dismiss()
                    }
                    optionRow(
                        active: store.sort == .titleAsc,
                        icon: nil,
                        label: env.preferences.t("标题 A-Z", en: "Title A-Z", pl: "Tytuł A–Z")
                    ) {
                        store.sort = .titleAsc
                        store.reload(env: env)
                        dismiss()
                    }
                    optionRow(
                        active: store.sort == .titleDesc,
                        icon: nil,
                        label: env.preferences.t("标题 Z-A", en: "Title Z-A", ja: "タイトル Z-A", pl: "Tytuł Z–A")
                    ) {
                        store.sort = .titleDesc
                        store.reload(env: env)
                        dismiss()
                    }

                    divider
                    sheetItem(
                        icon: "arrow.clockwise",
                        label: env.preferences.t("立即同步", en: "Sync now", pl: "Synchronizuj teraz"),
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
