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

/// Android `MobileTemplatePickerModal` — saved + built-in templates.
struct TemplatePickerSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    var onSelect: (CreateMemoSeed) -> Void

    @State private var saved: [SelectableMemoTemplate] = []
    @State private var isLoadingSaved = false
    @State private var savedLoadFailed = false

    private var builtIn: [SelectableMemoTemplate] {
        BuiltInMemoTemplates.all(isEnglish: env.preferences.isEnglish)
    }

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
                        "选择预设结构快速开始，也可使用网页端保存的自定义模板。",
                        en: "Start from a preset structure, or use custom templates saved on the web."
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
                    sectionTitle(env.preferences.t("我的自定义模板", en: "My custom templates"))

                    if isLoadingSaved {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(env.preferences.t("正在加载模板", en: "Loading templates"))
                                .font(.system(size: 12))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 10)
                    } else if savedLoadFailed {
                        hint(env.preferences.t(
                            "自定义模板暂时无法加载，仍可使用下方内置模板。",
                            en: "Custom templates could not load. Built-in templates are still available."
                        ))
                    } else if saved.isEmpty {
                        hint(env.preferences.t(
                            "暂无自定义模板。可在网页端将常用笔记另存为模板。",
                            en: "No custom templates yet. Save notes as templates on the web."
                        ))
                    }

                    ForEach(saved) { template in
                        templateRow(template)
                    }

                    divider

                    sectionTitle(env.preferences.t("内置推荐模板", en: "Recommended templates"))
                    ForEach(builtIn) { template in
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
        .task { await loadSaved() }
    }

    private func loadSaved() async {
        isLoadingSaved = true
        savedLoadFailed = false
        defer { isLoadingSaved = false }
        do {
            let list = try await env.session.client.listTemplates()
            saved = list.map(BuiltInMemoTemplates.fromSaved)
        } catch {
            savedLoadFailed = true
            saved = []
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

    private var divider: some View {
        Rectangle()
            .fill(AppTheme.searchFill)
            .frame(height: 1)
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
                        badge(for: template.source)
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

    private func badge(for source: MemoTemplateSource) -> some View {
        let isCustom = source == .saved
        return Text(isCustom
            ? env.preferences.t("自定义", en: "Custom")
            : env.preferences.t("内置", en: "Built-in"))
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(isCustom ? AppTheme.accentStrong : AppTheme.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(isCustom ? AppTheme.accentSoft : AppTheme.searchFill)
            .overlay(
                Capsule().stroke(isCustom ? AppTheme.accentBorder : AppTheme.border, lineWidth: 1)
            )
            .clipShape(Capsule())
    }
}
