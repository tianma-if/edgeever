import SwiftUI

/// Android `MobileCreateChoiceModal` — blank vs template.
struct CreateChoiceSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    var canCreate: Bool
    var onBlank: () -> Void
    var onTemplate: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(env.preferences.t("新建笔记", en: "New note"))
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text(env.preferences.t("选择创建方式", en: "Choose how to create"))
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
                .accessibilityLabel(env.preferences.t("关闭", en: "Close"))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .overlay(alignment: .bottom) {
                Rectangle().fill(AppTheme.border).frame(height: 1)
            }

            VStack(spacing: 0) {
                choiceRow(
                    systemImage: "doc.text",
                    title: env.preferences.t("空白笔记", en: "Blank note"),
                    description: env.preferences.t("从空白页开始记录", en: "Start with an empty page")
                ) {
                    dismiss()
                    onBlank()
                }
                choiceRow(
                    systemImage: "square.grid.2x2",
                    title: env.preferences.t("从模板新建", en: "New from template"),
                    description: env.preferences.t(
                        "使用会议纪要、周报等预设结构",
                        en: "Use meeting notes, weekly reviews, and more"
                    )
                ) {
                    dismiss()
                    onTemplate()
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .padding(.bottom, 12)
        }
        .background(AppTheme.card)
        .presentationDetents([.height(280)])
        .presentationDragIndicator(.hidden)
        .accessibilityIdentifier("createChoiceSheet")
    }

    private func choiceRow(
        systemImage: String,
        title: String,
        description: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.title)
                    .frame(width: 40, height: 40)
                    .background(AppTheme.searchFill)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(AppTheme.title)
                    Text(description)
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
            .opacity(canCreate ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!canCreate)
    }
}

/// Android `MobileTemplatePickerModal` — persisted, editable templates.
struct TemplatePickerSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    var onSelect: (CreateMemoSeed) -> Void

    @State private var templates: [SelectableMemoTemplate] = []
    @State private var isLoading = false
    @State private var loadFailed = false

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(env.preferences.t("从模板新建", en: "New from template"))
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text(env.preferences.t(
                        "选择一个模板快速开始。所有模板都可以在网页端修改或删除。",
                        en: "Choose a template to get started. Every template can be edited or deleted on the web."
                    ))
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
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
                .accessibilityLabel(env.preferences.t("关闭", en: "Close"))
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(AppTheme.border).frame(height: 1)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    sectionTitle(env.preferences.t("模板", en: "Templates"))

                    if isLoading {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(env.preferences.t("正在加载模板", en: "Loading templates"))
                                .font(.system(size: 12))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 10)
                    } else if loadFailed {
                        hint(env.preferences.t(
                            "模板暂时无法加载，请稍后重试。",
                            en: "Templates could not load. Please try again later."
                        ))
                    } else if templates.isEmpty {
                        hint(env.preferences.t(
                            "暂无模板。可在网页端新建模板，或将常用笔记另存为模板。",
                            en: "No templates yet. Create one or save a note as a template on the web."
                        ))
                    }

                    ForEach(templates) { template in
                        templateRow(template)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
                .padding(.bottom, 20)
            }
        }
        .background(AppTheme.card)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
        .accessibilityIdentifier("templatePickerSheet")
        .task { await loadTemplates() }
    }

    private func loadTemplates() async {
        isLoading = true
        loadFailed = false
        defer { isLoading = false }
        do {
            let list = try await env.session.client.listTemplates()
            templates = list.map(SelectableMemoTemplate.init)
        } catch {
            loadFailed = true
            templates = []
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(AppTheme.secondary)
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 4)
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
    }

    private func templateRow(_ template: SelectableMemoTemplate) -> some View {
        Button {
            onSelect(template.createSeed)
            dismiss()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "square.grid.2x2")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.accentStrong)
                    .frame(width: 32, height: 32)
                    .background(AppTheme.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(template.name)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(AppTheme.title)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    if !template.description.isEmpty {
                        Text(template.description)
                            .font(.system(size: 12))
                            .foregroundStyle(AppTheme.secondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("templateRow-\(template.id)")
    }

}
