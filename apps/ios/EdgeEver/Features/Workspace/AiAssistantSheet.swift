import SwiftUI
import UIKit

enum AiDraftApplyMode: Sendable {
    case append
    case replace
}

private enum AssistantTone: String, CaseIterable, Identifiable {
    case professional
    case friendly
    case casual
    case direct

    var id: String { rawValue }
}

private enum AssistantTargetLanguage: String, CaseIterable, Identifiable {
    case english = "en"
    case simplifiedChinese = "zh-CN"
    case traditionalChinese = "zh-TW"
    case japanese = "ja"
    case korean = "ko"
    case spanish = "es"
    case french = "fr"
    case german = "de"
    case portuguese = "pt"

    var id: String { rawValue }
}

struct AiAssistantSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    let title: String
    let sourceMarkdown: String
    let isSelection: Bool
    let onApply: (String, AiDraftApplyMode) async throws -> Void

    init(memo: MemoDetail, onApply: @escaping (String, AiDraftApplyMode) async throws -> Void) {
        title = memo.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        sourceMarkdown = memo.contentMarkdown
        isSelection = false
        self.onApply = onApply
    }

    init(
        title: String,
        selectedMarkdown: String,
        onApply: @escaping (String, AiDraftApplyMode) async throws -> Void
    ) {
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        sourceMarkdown = selectedMarkdown
        isSelection = true
        self.onApply = onApply
    }

    @State private var action: AiAction = .summarize
    @State private var prompts: [AiPromptTemplate] = []
    @State private var selectedPromptID: String?
    @State private var targetLanguage: AssistantTargetLanguage = .english
    @State private var tone: AssistantTone = .professional
    @State private var customInstruction = ""
    @State private var refineInstruction = ""
    @State private var output = ""
    @State private var error: String?
    @State private var isGenerating = false
    @State private var isApplying = false
    @State private var didSetLanguageDefault = false
    @State private var generationID = UUID()
    @State private var streamTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(env.preferences.t(
                        "选择 AI 要做的事。输出只会作为草稿，确认后才会修改笔记。",
                        en: "Choose what AI should do. Output remains a draft until you apply it."
                    ))
                    .font(.system(size: 13))
                    .foregroundStyle(AppTheme.muted)

                    actionPicker

                    if needsTargetLanguage {
                        languagePicker
                    }

                    if needsTone {
                        tonePicker
                    }

                    if selectedPrompt == nil, action == .custom {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(env.preferences.t("告诉 AI 你想怎么处理", en: "Tell AI what to do"))
                                .font(.system(size: 13, weight: .bold))
                            TextField(
                                env.preferences.t(
                                    "例如：改成适合周报的结构，保留所有数据",
                                    en: "For example: Restructure this for a weekly report and keep all data"
                                ),
                                text: $customInstruction,
                                axis: .vertical
                            )
                            .lineLimit(3...6)
                            .textInputAutocapitalization(.sentences)
                            .padding(12)
                            .background(AppTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .stroke(AppTheme.cardBorder, lineWidth: 1)
                            }
                        }
                    }

                    HStack {
                        Text(env.preferences.t("AI 草稿", en: "AI draft"))
                            .font(.system(size: 13, weight: .bold))
                        Spacer()
                        if isGenerating {
                            ProgressView()
                                .controlSize(.small)
                            Text(env.preferences.t("生成中…", en: "Generating…"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }

                    Text(output.isEmpty
                         ? env.preferences.t("生成的草稿会显示在这里。", en: "The generated draft will appear here.")
                         : output)
                        .font(.system(size: 15))
                        .foregroundStyle(output.isEmpty ? AppTheme.muted : AppTheme.body)
                        .frame(maxWidth: .infinity, minHeight: 230, alignment: .topLeading)
                        .padding(14)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(AppTheme.cardBorder, lineWidth: 1)
                        }
                        .textSelection(.enabled)

                    if !output.isEmpty, !isGenerating {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(env.preferences.t("继续调整", en: "Refine result"))
                                .font(.system(size: 13, weight: .bold))
                            HStack(spacing: 8) {
                                TextField(
                                    env.preferences.t("例如：再简洁一点", en: "For example: Make it more concise"),
                                    text: $refineInstruction
                                )
                                .submitLabel(.send)
                                .onSubmit(refine)
                                .padding(.horizontal, 12)
                                .frame(height: 44)
                                .background(AppTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .stroke(AppTheme.cardBorder, lineWidth: 1)
                                }

                                Button(env.preferences.t("调整", en: "Refine"), action: refine)
                                    .font(.system(size: 14, weight: .bold))
                                    .buttonStyle(.borderedProminent)
                                    .tint(AppTheme.accent)
                                    .frame(height: 44)
                                    .disabled(refineInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                        }
                    }

                    if let error, !error.isEmpty {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(AppTheme.dangerStrong)
                    }
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle(env.preferences.t("AI 笔记助手", en: "AI note assistant"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(env.preferences.t("关闭", en: "Close")) { dismiss() }
                        .disabled(isApplying)
                }
            }
            .safeAreaInset(edge: .bottom) {
                footer
            }
        }
        .interactiveDismissDisabled(isApplying)
        .onAppear {
            guard !didSetLanguageDefault else { return }
            targetLanguage = env.preferences.isEnglish ? .simplifiedChinese : .english
            action = isSelection ? .improveWriting : .summarize
            didSetLanguageDefault = true
        }
        .onDisappear { streamTask?.cancel() }
        .task { await loadPrompts() }
    }

    private var actionPicker: some View {
        pickerField(
            env.preferences.t("处理方式", en: "Action"),
            selection: selectedPrompt?.name ?? actionTitle(action)
        ) {
            if prompts.isEmpty {
                ForEach(availableActions) { item in
                    Button {
                        selectAction(item)
                    } label: {
                        if selectedPromptID == nil, action == item {
                            Label(actionTitle(item), systemImage: "checkmark")
                        } else {
                            Text(actionTitle(item))
                        }
                    }
                }
            } else {
                ForEach(prompts) { prompt in
                    Button {
                        streamTask?.cancel()
                        selectedPromptID = prompt.id
                        action = prompt.action
                        output = ""
                        error = nil
                    } label: {
                        if selectedPromptID == prompt.id {
                            Label(prompt.name, systemImage: "checkmark")
                        } else {
                            Text(prompt.name)
                        }
                    }
                }
                Button {
                    selectAction(.custom)
                } label: {
                    if selectedPromptID == nil, action == .custom {
                        Label(actionTitle(.custom), systemImage: "checkmark")
                    } else {
                        Text(actionTitle(.custom))
                    }
                }
            }
        }
    }

    private var languagePicker: some View {
        pickerField(env.preferences.t("目标语言", en: "Target language"), selection: languageTitle(targetLanguage)) {
            ForEach(AssistantTargetLanguage.allCases) { item in
                Button {
                    targetLanguage = item
                    output = ""
                    error = nil
                } label: {
                    if targetLanguage == item {
                        Label(languageTitle(item), systemImage: "checkmark")
                    } else {
                        Text(languageTitle(item))
                    }
                }
            }
        }
    }

    private var tonePicker: some View {
        pickerField(env.preferences.t("语气", en: "Tone"), selection: toneTitle(tone)) {
            ForEach(AssistantTone.allCases) { item in
                Button {
                    tone = item
                    output = ""
                    error = nil
                } label: {
                    if tone == item {
                        Label(toneTitle(item), systemImage: "checkmark")
                    } else {
                        Text(toneTitle(item))
                    }
                }
            }
        }
    }

    private func pickerField<MenuContent: View>(
        _ title: String,
        selection: String,
        @ViewBuilder content: () -> MenuContent
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
            Menu(content: content) {
                HStack {
                    Text(selection)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.body)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(AppTheme.cardBorder, lineWidth: 1)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private var footer: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                secondaryButton(env.preferences.t("复制", en: "Copy"), systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = output
                }
                if canAppendSource {
                    secondaryButton(
                        isSelection
                            ? env.preferences.t("插入到选区后", en: "Insert after")
                            : env.preferences.t("追加", en: "Append"),
                        systemImage: "text.append"
                    ) {
                        apply(.append)
                    }
                }
                if canReplaceSource {
                    secondaryButton(
                        isSelection
                            ? env.preferences.t("替换选中内容", en: "Replace selection")
                            : env.preferences.t("替换", en: "Replace"),
                        systemImage: "arrow.triangle.2.circlepath"
                    ) {
                        apply(.replace)
                    }
                }
            }
            if isGenerating {
                Button {
                    streamTask?.cancel()
                } label: {
                    Label(env.preferences.t("停止", en: "Stop"), systemImage: "stop.fill")
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.accent)
            } else {
                Button {
                    generate()
                } label: {
                    Label(
                        output.isEmpty
                            ? env.preferences.t("生成", en: "Generate")
                            : env.preferences.t("重新生成", en: "Regenerate"),
                        systemImage: output.isEmpty ? "sparkles" : "arrow.clockwise"
                    )
                    .font(.system(size: 15, weight: .bold))
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.accent)
                .disabled(isApplying || (selectedPrompt == nil && action == .custom && customInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Rectangle().fill(AppTheme.cardBorder).frame(height: 1) }
    }

    private func secondaryButton(
        _ title: String,
        systemImage: String,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 40)
        }
        .buttonStyle(.bordered)
        .tint(AppTheme.body)
        .disabled(disabled || output.isEmpty || isGenerating || isApplying)
    }

    private func actionTitle(_ action: AiAction) -> String {
        switch action {
        case .improveWriting: env.preferences.t("改进写作", en: "Improve writing")
        case .fixSpellingGrammar: env.preferences.t("修正拼写与语法", en: "Fix spelling & grammar")
        case .summarize: env.preferences.t("总结", en: "Summarize")
        case .extractKeyPoints: env.preferences.t("提炼要点", en: "Key points")
        case .extractTodos: env.preferences.t("提取待办", en: "Extract tasks")
        case .rewriteProofread: env.preferences.t("转为小红书风格", en: "Convert to Xiaohongshu style")
        case .makeShorter: env.preferences.t("精炼表达", en: "Make concise")
        case .makeLonger: env.preferences.t("扩写内容", en: "Make longer")
        case .simplifyLanguage: env.preferences.t("转为推特风格", en: "Convert to X (Twitter) style")
        case .changeTone: env.preferences.t("调整语气", en: "Change tone")
        case .translate: env.preferences.t("翻译", en: "Translate")
        case .continueWriting: env.preferences.t("继续写作", en: "Continue writing")
        case .custom: env.preferences.t("自定义指令", en: "Custom prompt")
        }
    }

    private func languageTitle(_ language: AssistantTargetLanguage) -> String {
        switch language {
        case .english: env.preferences.t("英语", en: "English")
        case .simplifiedChinese: env.preferences.t("简体中文", en: "Simplified Chinese")
        case .traditionalChinese: env.preferences.t("繁体中文", en: "Traditional Chinese")
        case .japanese: env.preferences.t("日语", en: "Japanese")
        case .korean: env.preferences.t("韩语", en: "Korean")
        case .spanish: env.preferences.t("西班牙语", en: "Spanish")
        case .french: env.preferences.t("法语", en: "French")
        case .german: env.preferences.t("德语", en: "German")
        case .portuguese: env.preferences.t("葡萄牙语", en: "Portuguese")
        }
    }

    private func toneTitle(_ tone: AssistantTone) -> String {
        switch tone {
        case .professional: env.preferences.t("专业", en: "Professional")
        case .friendly: env.preferences.t("友好", en: "Friendly")
        case .casual: env.preferences.t("轻松", en: "Casual")
        case .direct: env.preferences.t("直接", en: "Direct")
        }
    }

    private var availableActions: [AiAction] {
        if isSelection {
            return [
                .summarize,
                .translate,
                .improveWriting,
                .makeShorter,
                .rewriteProofread,
                .simplifyLanguage,
                .custom,
            ]
        }
        return [
            .summarize,
            .translate,
            .improveWriting,
            .makeShorter,
            .rewriteProofread,
            .simplifyLanguage,
            .custom,
        ]
    }

    private var canReplaceSource: Bool {
        if let selectedPrompt {
            return selectedPrompt.resultMode == .replace || selectedPrompt.resultMode == .both
        }
        switch action {
        case .summarize, .extractKeyPoints, .extractTodos, .continueWriting:
            return false
        default:
            return true
        }
    }

    private var canAppendSource: Bool {
        guard let selectedPrompt else { return true }
        return selectedPrompt.resultMode == .append || selectedPrompt.resultMode == .both
    }

    private var selectedPrompt: AiPromptTemplate? {
        guard let selectedPromptID else { return nil }
        return prompts.first { $0.id == selectedPromptID }
    }

    private var needsTargetLanguage: Bool {
        selectedPrompt?.parameterKind == .targetLanguage || (selectedPrompt == nil && action == .translate)
    }

    private var needsTone: Bool {
        selectedPrompt?.parameterKind == .tone || (selectedPrompt == nil && action == .changeTone)
    }

    private func request(for source: String, refinement: String? = nil) -> AiGenerateInput {
        if let refinement, !refinement.isEmpty {
            return AiGenerateInput(
                action: .custom,
                locale: env.preferences.isEnglish ? "en-US" : "zh-CN",
                title: title,
                contentMarkdown: source,
                targetLanguage: nil,
                instruction: refinement
            )
        }

        return AiGenerateInput(
            action: selectedPrompt?.action ?? action,
            promptId: selectedPrompt?.id,
            locale: env.preferences.isEnglish ? "en-US" : "zh-CN",
            title: title,
            contentMarkdown: source,
            targetLanguage: needsTargetLanguage ? targetLanguage.rawValue : nil,
            tone: needsTone ? tone.rawValue : nil,
            instruction: selectedPrompt == nil && action == .custom
                ? customInstruction.trimmingCharacters(in: .whitespacesAndNewlines)
                : nil
        )
    }

    private func selectAction(_ nextAction: AiAction) {
        streamTask?.cancel()
        selectedPromptID = nil
        action = nextAction
        output = ""
        error = nil
    }

    @MainActor
    private func loadPrompts() async {
        do {
            let locale = env.preferences.isEnglish ? "en-US" : "zh-CN"
            let loaded = try await env.session.client.listAiPrompts(locale: locale)
            prompts = loaded
            let preferredAction: AiAction = isSelection ? .improveWriting : .summarize
            if let preferred = loaded.first(where: { $0.seedKey == preferredAction.rawValue }) ?? loaded.first {
                selectedPromptID = preferred.id
                action = preferred.action
            }
        } catch {
            // Keep the built-in action list as an offline/older-server fallback.
        }
    }

    private func generate(source: String? = nil, refinement: String? = nil) {
        streamTask?.cancel()
        output = ""
        error = nil
        isGenerating = true
        let requestID = UUID()
        generationID = requestID
        let input = request(for: source ?? sourceMarkdown, refinement: refinement)
        streamTask = Task {
            do {
                let stream = await env.session.client.streamAiGeneration(input)
                for try await event in stream {
                    try Task.checkCancellation()
                    switch event.type {
                    case "text-delta": output += event.text ?? ""
                    case "error": error = event.message ?? env.preferences.t("AI 生成失败。", en: "AI generation failed.")
                    default: break
                    }
                }
            } catch is CancellationError {
                // User stopped generation.
            } catch let apiError as APIError where apiError.code == "ai_not_configured" {
                error = env.preferences.t(
                    "请先在 Web 或桌面端的“AI 集成”中配置模型。",
                    en: "Configure a model in AI Integrations on the web or desktop app first."
                )
            } catch {
                self.error = error.localizedDescription
            }
            if generationID == requestID {
                isGenerating = false
                streamTask = nil
            }
        }
    }

    private func refine() {
        let instruction = refineInstruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !output.isEmpty, !instruction.isEmpty else { return }
        let source = output
        refineInstruction = ""
        generate(source: source, refinement: instruction)
    }

    private func apply(_ mode: AiDraftApplyMode) {
        guard !output.isEmpty, !isApplying else { return }
        isApplying = true
        error = nil
        Task {
            do {
                try await onApply(output, mode)
                dismiss()
            } catch {
                self.error = error.localizedDescription
                isApplying = false
            }
        }
    }
}
