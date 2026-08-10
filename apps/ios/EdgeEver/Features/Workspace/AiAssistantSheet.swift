import SwiftUI
import UIKit

enum AiDraftApplyMode: Sendable {
    case append
    case replace
}

struct AiAssistantSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    let memo: MemoDetail
    let onApply: (String, AiDraftApplyMode) async throws -> Void

    @State private var action: AiAction = .summarize
    @State private var targetLanguage = ""
    @State private var output = ""
    @State private var error: String?
    @State private var isGenerating = false
    @State private var isApplying = false
    @State private var streamTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(env.preferences.t(
                        "AI 输出会先作为草稿展示，确认后才会修改笔记。",
                        en: "AI output remains a draft until you choose to apply it."
                    ))
                    .font(.system(size: 13))
                    .foregroundStyle(AppTheme.muted)

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 8)], spacing: 8) {
                        ForEach(AiAction.allCases) { item in
                            Button {
                                action = item
                            } label: {
                                Text(actionTitle(item))
                                    .font(.system(size: 13, weight: .semibold))
                                    .frame(maxWidth: .infinity, minHeight: 38)
                                    .foregroundStyle(action == item ? AppTheme.accent : AppTheme.body)
                                    .background(action == item ? AppTheme.accent.opacity(0.1) : AppTheme.card)
                                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                                            .stroke(action == item ? AppTheme.accent : AppTheme.cardBorder, lineWidth: 1)
                                    }
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if action == .translate {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(env.preferences.t("目标语言", en: "Target language"))
                                .font(.system(size: 13, weight: .bold))
                            TextField(
                                env.preferences.t("例如：英语、日语", en: "For example: English, Japanese"),
                                text: $targetLanguage
                            )
                            .textInputAutocapitalization(.never)
                            .padding(.horizontal, 12)
                            .frame(height: 44)
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
        .onDisappear { streamTask?.cancel() }
    }

    private var footer: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                secondaryButton(env.preferences.t("复制", en: "Copy"), systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = output
                }
                secondaryButton(env.preferences.t("追加", en: "Append"), systemImage: "text.append") {
                    apply(.append)
                }
                secondaryButton(env.preferences.t("替换", en: "Replace"), systemImage: "arrow.triangle.2.circlepath") {
                    apply(.replace)
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
                    Text(env.preferences.t("生成", en: "Generate"))
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.accent)
                .disabled(isApplying || (action == .translate && targetLanguage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Rectangle().fill(AppTheme.cardBorder).frame(height: 1) }
    }

    private func secondaryButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 40)
        }
        .buttonStyle(.bordered)
        .tint(AppTheme.body)
        .disabled(output.isEmpty || isGenerating || isApplying)
    }

    private func actionTitle(_ action: AiAction) -> String {
        switch action {
        case .summarize: env.preferences.t("总结", en: "Summarize")
        case .extractKeyPoints: env.preferences.t("提炼要点", en: "Key points")
        case .extractTodos: env.preferences.t("提取待办", en: "Extract tasks")
        case .rewriteProofread: env.preferences.t("改写与校对", en: "Rewrite & proofread")
        case .translate: env.preferences.t("翻译", en: "Translate")
        }
    }

    private func generate() {
        streamTask?.cancel()
        output = ""
        error = nil
        isGenerating = true
        let input = AiGenerateInput(
            action: action,
            title: memo.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            contentMarkdown: memo.contentMarkdown,
            targetLanguage: action == .translate
                ? targetLanguage.trimmingCharacters(in: .whitespacesAndNewlines)
                : nil
        )
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
            isGenerating = false
            streamTask = nil
        }
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
