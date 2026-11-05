import SwiftUI
import UIKit

enum AiDraftApplyMode: Sendable {
    case append
    case replace
}

/// The part (1-based) of `parts` a long run is working on (#652 PR B).
struct AiRunProgress: Equatable, Sendable {
    var part: Int
    var parts: Int
}

/// Why an AI draft is incomplete (#652).
enum AiDraftIncompleteReason: Sendable {
    case truncated
    case stopped
    case interrupted
}

/// The state of one streamed draft (#652). The draft may replace the original only after the
/// stream reported a finish that was not truncated and no error. Text that arrived before an
/// error, a dropped connection or a stop stays usable for copy and append, but never for replace.
struct AiDraftCompletion: Equatable, Sendable {
    private(set) var finished = false
    private(set) var truncated = false
    private(set) var failed = false
    private(set) var stopped = false
    /// Parts (1-based) of a long run that kept their source text (#652 PR B).
    private(set) var incompleteParts: [Int] = []

    mutating func track(_ event: AiStreamEvent) {
        switch event.type {
        case "finish":
            finished = true
            if event.truncated == true || AiDirectStream.isTruncatedFinishReason(event.finishReason) { truncated = true }
            if let parts = event.incompleteParts, !parts.isEmpty {
                incompleteParts = parts
                truncated = true
            }
        case "error":
            failed = true
        default:
            break
        }
    }

    /// The request threw, or the stream ended without finishing.
    mutating func fail() { failed = true }
    mutating func stop() { stopped = true }

    /// `nil` only for a draft that finished cleanly; while streaming it reads as interrupted.
    var incompleteReason: AiDraftIncompleteReason? {
        if stopped { return .stopped }
        if truncated { return .truncated }
        if failed || !finished { return .interrupted }
        return nil
    }
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
    case polish = "pl"

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
    /// Whether the current draft finished cleanly; any other draft must not replace the source (#652).
    @State private var completion = AiDraftCompletion()
    private var incomplete: AiDraftIncompleteReason? { completion.incompleteReason }
    /// The part a long run is working on (#652 PR B); `nil` for a single request.
    @State private var progress: AiRunProgress?
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
                        en: "Choose what AI should do. Output remains a draft until you apply it.",
                        pl: "Wybierz, co ma zrobić AI. Wynik pozostaje szkicem, dopóki go nie zastosujesz."
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
                            Text(env.preferences.t("告诉 AI 你想怎么处理", en: "Tell AI what to do", pl: "Powiedz AI, co ma zrobić"))
                                .font(.system(size: 13, weight: .bold))
                            TextField(
                                env.preferences.t(
                                    "例如：改成适合周报的结构，保留所有数据",
                                    en: "For example: Restructure this for a weekly report and keep all data",
                                    pl: "Na przykład: przebuduj to na raport tygodniowy i zachowaj wszystkie dane"
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
                        Text(env.preferences.t("AI 草稿", en: "AI draft", pl: "Szkic AI"))
                            .font(.system(size: 13, weight: .bold))
                        Spacer()
                        if isGenerating {
                            ProgressView()
                                .controlSize(.small)
                            Text(env.preferences.t("生成中…", en: "Generating…", pl: "Generowanie…"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }

                    Text(output.isEmpty
                         ? env.preferences.t("生成的草稿会显示在这里。", en: "The generated draft will appear here.", pl: "Tutaj pojawi się wygenerowany szkic.")
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
                            Text(env.preferences.t("继续调整", en: "Refine result", pl: "Dopracuj wynik"))
                                .font(.system(size: 13, weight: .bold))
                            HStack(spacing: 8) {
                                TextField(
                                    env.preferences.t("例如：再简洁一点", en: "For example: Make it more concise", pl: "Na przykład: napisz to zwięźlej"),
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

                                Button(env.preferences.t("调整", en: "Refine", pl: "Dopracuj"), action: refine)
                                    .font(.system(size: 14, weight: .bold))
                                    .buttonStyle(.borderedProminent)
                                    .tint(AppTheme.accent)
                                    .frame(height: 44)
                                    .disabled(refineInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                        }
                    }

                    if let progress, isGenerating {
                        Text(env.preferences.t(
                            "正在生成第 \(progress.part)/\(progress.parts) 段…",
                            en: "Working on part \(progress.part) of \(progress.parts)…",
                            ja: "\(progress.parts) 件中 \(progress.part) 件目を生成中…",
                            pl: "Przetwarzanie części \(progress.part) z \(progress.parts)…"
                        ))
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                    }

                    if let incomplete, !output.isEmpty, !isGenerating {
                        Text(incompleteMessage(incomplete))
                            .font(.system(size: 13))
                            .foregroundStyle(AppTheme.dangerStrong)
                            .accessibilityAddTraits(.isStaticText)
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
            .navigationTitle(env.preferences.t("AI 笔记助手", en: "AI note assistant", pl: "Asystent AI notatek"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(env.preferences.t("关闭", en: "Close", pl: "Zamknij")) { dismiss() }
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
            applyStoredOrDefaultAction(from: prompts, allowPromptMatch: false)
            didSetLanguageDefault = true
        }
        .onDisappear { streamTask?.cancel() }
        .task { await loadPrompts() }
    }

    private var actionPicker: some View {
        pickerField(
            env.preferences.t("处理方式", en: "Action", pl: "Działanie"),
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
                        persistLastAction()
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
        pickerField(env.preferences.t("目标语言", en: "Target language", pl: "Język docelowy"), selection: languageTitle(targetLanguage)) {
            ForEach(AssistantTargetLanguage.allCases) { item in
                Button {
                    targetLanguage = item
                    output = ""
                    error = nil
                    persistLastAction()
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
        pickerField(env.preferences.t("语气", en: "Tone", pl: "Ton"), selection: toneTitle(tone)) {
            ForEach(AssistantTone.allCases) { item in
                Button {
                    tone = item
                    output = ""
                    error = nil
                    persistLastAction()
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
                secondaryButton(env.preferences.t("复制", en: "Copy", pl: "Kopiuj"), systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = output
                }
                if canAppendSource {
                    secondaryButton(
                        isSelection
                            ? env.preferences.t("插入到选区后", en: "Insert after", pl: "Wstaw za")
                            : env.preferences.t("追加", en: "Append", pl: "Dołącz"),
                        systemImage: "text.append"
                    ) {
                        apply(.append)
                    }
                }
                if canReplaceSource {
                    secondaryButton(
                        isSelection
                            ? env.preferences.t("替换选中内容", en: "Replace selection", pl: "Zastąp zaznaczenie")
                            : env.preferences.t("替换", en: "Replace", pl: "Zastąp"),
                        systemImage: "arrow.triangle.2.circlepath",
                        disabled: incomplete != nil
                    ) {
                        apply(.replace)
                    }
                }
            }
            if isGenerating {
                Button {
                    completion.stop()
                    streamTask?.cancel()
                } label: {
                    Label(env.preferences.t("停止", en: "Stop", pl: "Zatrzymaj"), systemImage: "stop.fill")
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
                            ? env.preferences.t("生成", en: "Generate", pl: "Generuj")
                            : env.preferences.t("重新生成", en: "Regenerate", pl: "Generuj ponownie"),
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
        case .improveWriting: env.preferences.t("润色表达", en: "Polish", pl: "Popraw styl")
        case .fixSpellingGrammar: env.preferences.t("修正拼写与语法", en: "Fix spelling & grammar", pl: "Popraw pisownię i gramatykę")
        case .summarize: env.preferences.t("精简总结", en: "Summarize", pl: "Podsumuj")
        case .extractKeyPoints: env.preferences.t("提炼要点", en: "Key points", pl: "Najważniejsze punkty")
        case .extractTodos: env.preferences.t("提取待办", en: "Extract tasks", pl: "Wyodrębnij zadania")
        case .rewriteProofread: env.preferences.t("改写与校对", en: "Rewrite & proofread", pl: "Przeredaguj i sprawdź")
        case .makeShorter: env.preferences.t("精炼表达", en: "Make concise", pl: "Skróć")
        case .makeLonger: env.preferences.t("扩写内容", en: "Make longer", pl: "Rozwiń")
        case .simplifyLanguage: env.preferences.t("简化表达", en: "Simplify language", pl: "Uprość język")
        case .changeTone: env.preferences.t("调整语气", en: "Change tone", pl: "Zmień ton")
        case .translate: env.preferences.t("全文翻译", en: "Translate", pl: "Przetłumacz")
        case .continueWriting: env.preferences.t("继续写作", en: "Continue writing", pl: "Pisz dalej")
        case .custom: env.preferences.t("自定义指令", en: "Custom prompt", pl: "Własny prompt")
        }
    }

    private func languageTitle(_ language: AssistantTargetLanguage) -> String {
        switch language {
        case .english: env.preferences.t("英语", en: "English", pl: "Angielski")
        case .simplifiedChinese: env.preferences.t("简体中文", en: "Simplified Chinese", pl: "Chiński uproszczony")
        case .traditionalChinese: env.preferences.t("繁体中文", en: "Traditional Chinese", pl: "Chiński tradycyjny")
        case .japanese: env.preferences.t("日语", en: "Japanese", pl: "Japoński")
        case .korean: env.preferences.t("韩语", en: "Korean", pl: "Koreański")
        case .spanish: env.preferences.t("西班牙语", en: "Spanish", pl: "Hiszpański")
        case .french: env.preferences.t("法语", en: "French", pl: "Francuski")
        case .german: env.preferences.t("德语", en: "German", pl: "Niemiecki")
        case .portuguese: env.preferences.t("葡萄牙语", en: "Portuguese", pl: "Portugalski")
        case .polish: env.preferences.t("波兰语", en: "Polish", ja: "ポーランド語", pl: "Polski")
        }
    }

    private func toneTitle(_ tone: AssistantTone) -> String {
        switch tone {
        case .professional: env.preferences.t("专业", en: "Professional", pl: "Profesjonalny")
        case .friendly: env.preferences.t("友好", en: "Friendly", pl: "Przyjazny")
        case .casual: env.preferences.t("轻松", en: "Casual", pl: "Swobodny")
        case .direct: env.preferences.t("直接", en: "Direct", pl: "Bezpośredni")
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

    private var defaultTargetLanguage: AssistantTargetLanguage {
        switch env.preferences.uiLanguage {
        case .chinese: return .english
        case .japanese: return .japanese
        case .polish: return .english
        case .english: return .simplifiedChinese
        }
    }

    private var promptLocale: String { env.preferences.apiLocale }

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
                locale: env.preferences.apiLocale,
                title: title,
                contentMarkdown: source,
                targetLanguage: nil,
                instruction: refinement
            )
        }

        return AiGenerateInput(
            action: selectedPrompt?.action ?? action,
            promptId: selectedPrompt?.id,
            locale: env.preferences.apiLocale,
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
        persistLastAction()
    }

    private func persistLastAction() {
        env.preferences.setLastAiAssistantAction(
            AiAssistantLastActionPreference(
                action: action,
                promptId: selectedPromptID,
                seedKey: selectedPrompt?.seedKey,
                targetLanguage: targetLanguage.rawValue,
                tone: tone.rawValue
            ),
            isSelection: isSelection
        )
    }

    private func applyStoredOrDefaultAction(from loaded: [AiPromptTemplate], allowPromptMatch: Bool) {
        let stored = isSelection ? env.preferences.lastAiAssistantAction(isSelection: true) : nil
        let fallback: AiAction = isSelection ? .improveWriting : .custom
        if let stored {
            if allowPromptMatch, let promptId = stored.promptId, let match = loaded.first(where: { $0.id == promptId }) {
                selectedPromptID = match.id
                action = match.action
                applyStoredParameters(stored)
                return
            }
            if allowPromptMatch, let seedKey = stored.seedKey, let match = loaded.first(where: { $0.seedKey == seedKey }) {
                selectedPromptID = match.id
                action = match.action
                applyStoredParameters(stored)
                return
            }
            if stored.action == .custom || loaded.isEmpty {
                selectedPromptID = nil
                action = stored.action
                applyStoredParameters(stored)
                return
            }
        }
        if fallback == .custom {
            selectedPromptID = nil
            action = .custom
            targetLanguage = defaultTargetLanguage
            return
        }
        if allowPromptMatch, let preferred = loaded.first(where: { $0.seedKey == fallback.rawValue }) ?? loaded.first {
            selectedPromptID = preferred.id
            action = preferred.action
            return
        }
        selectedPromptID = nil
        action = fallback
        targetLanguage = defaultTargetLanguage
    }

    private func applyStoredParameters(_ stored: AiAssistantLastActionPreference) {
        if let language = stored.targetLanguage.flatMap(AssistantTargetLanguage.init(rawValue:)) {
            targetLanguage = language
        } else {
            targetLanguage = defaultTargetLanguage
        }
        if let storedTone = stored.tone.flatMap(AssistantTone.init(rawValue:)) {
            tone = storedTone
        }
    }

    @MainActor
    private func loadPrompts() async {
        do {
            let locale = promptLocale
            let loaded = try await env.session.client.listAiPrompts(locale: locale)
            prompts = loaded
            applyStoredOrDefaultAction(from: loaded, allowPromptMatch: true)
        } catch {
            // Keep the built-in action list as an offline/older-server fallback.
        }
    }

    private func generate(source: String? = nil, refinement: String? = nil) {
        streamTask?.cancel()
        output = ""
        error = nil
        completion = AiDraftCompletion()
        progress = nil
        isGenerating = true
        let requestID = UUID()
        generationID = requestID
        let input = request(for: source ?? sourceMarkdown, refinement: refinement)
        streamTask = Task {
            do {
                let stream = await env.session.client.streamAiGeneration(input)
                for try await event in stream {
                    try Task.checkCancellation()
                    guard generationID == requestID else { continue }
                    completion.track(event)
                    switch event.type {
                    case "text-delta": output += event.text ?? ""
                    case "text-reset": output = event.text ?? ""
                    case "progress":
                        if let part = event.part, let parts = event.parts { progress = AiRunProgress(part: part, parts: parts) }
                    // An interrupted stream is explained by the incomplete notice instead.
                    case "error" where event.code != "ai_stream_interrupted":
                        error = event.message ?? env.preferences.t("AI 生成失败。", en: "AI generation failed.", pl: "Generowanie AI nie powiodło się.")
                    default: break
                    }
                }
            } catch is CancellationError {
                // User stopped generation, or a newer request replaced this one.
                if generationID == requestID { completion.stop() }
            } catch let apiError as APIError where apiError.code == "ai_input_too_long" {
                if generationID == requestID { completion.fail() }
                error = env.preferences.t(
                    "笔记太长，超出了所选模型的上下文窗口。请缩短笔记，或换用窗口更大的模型。",
                    en: "This note is too long for the selected model's context window. Shorten the note or choose a model with a larger window.",
                    ja: "ノートが長すぎて、選択したモデルのコンテキストウィンドウに収まりません。ノートを短くするか、より大きなウィンドウのモデルを選んでください。",
                    pl: "Notatka jest za długa dla okna kontekstu wybranego modelu. Skróć notatkę lub wybierz model z większym oknem."
                )
            } catch let apiError as APIError where apiError.code == "ai_not_configured" {
                error = env.preferences.t(
                    "请先在 Web 或桌面端的“模型与代理”中配置模型。",
                    en: "Configure a model in Models and agents on the web or desktop app first.",
                    pl: "Najpierw skonfiguruj model w sekcji „Modele i agenci” w aplikacji webowej lub desktopowej."
                )
            } catch {
                // A connection that drops after some text keeps that text as an incomplete draft.
                if generationID == requestID { completion.fail() }
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

    private func incompleteMessage(_ reason: AiDraftIncompleteReason) -> String {
        if reason == .truncated, !completion.incompleteParts.isEmpty {
            let zhParts = completion.incompleteParts.map(String.init).joined(separator: "、")
            let parts = completion.incompleteParts.map(String.init).joined(separator: ", ")
            return env.preferences.t(
                "结果不完整：第 \(zhParts) 段未能完成，保留了原文。可以复制或追加，但不能用它替换原文。",
                en: "This result is incomplete: part \(parts) could not be finished and keeps the original text. You can copy or append it, but it can't replace the original.",
                ja: "結果は不完全です：\(zhParts) 番目の部分を完了できなかったため、原文のままです。コピーや追加はできますが、元の文章を置き換えることはできません。",
                pl: "Wynik jest niepełny: części \(parts) nie udało się ukończyć i zawierają tekst oryginalny. Możesz go skopiować lub dołączyć, ale nie może zastąpić oryginału."
            )
        }
        return switch reason {
        case .truncated:
            env.preferences.t(
                "结果不完整：模型达到了输出上限。可以复制或追加，但不能用它替换原文。",
                en: "This result is incomplete: the model reached its output limit. You can copy or append it, but it can't replace the original.",
                ja: "結果は不完全です：モデルが出力上限に達しました。コピーや追加はできますが、元の文章を置き換えることはできません。",
                pl: "Wynik jest niepełny: model osiągnął limit odpowiedzi. Możesz go skopiować lub dołączyć, ale nie może zastąpić oryginału."
            )
        case .interrupted:
            env.preferences.t(
                "结果不完整：生成中途中断。可以复制或追加，但不能用它替换原文。",
                en: "This result is incomplete: generation was interrupted. You can copy or append it, but it can't replace the original.",
                ja: "結果は不完全です：生成が途中で中断されました。コピーや追加はできますが、元の文章を置き換えることはできません。",
                pl: "Wynik jest niepełny: generowanie zostało przerwane. Możesz go skopiować lub dołączyć, ale nie może zastąpić oryginału."
            )
        case .stopped:
            env.preferences.t(
                "生成已停止，结果不完整。可以复制或追加，但不能用它替换原文。",
                en: "Generation was stopped, so this result is incomplete. You can copy or append it, but it can't replace the original.",
                ja: "生成を停止したため、結果は不完全です。コピーや追加はできますが、元の文章を置き換えることはできません。",
                pl: "Generowanie zatrzymano, więc wynik jest niepełny. Możesz go skopiować lub dołączyć, ale nie może zastąpić oryginału."
            )
        }
    }

    private func apply(_ mode: AiDraftApplyMode) {
        guard !output.isEmpty, !isApplying else { return }
        if mode == .replace, incomplete != nil { return }
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
