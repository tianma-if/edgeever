import SwiftUI

/// Full-screen gate for a restricted recovery-code session. Only rebinding the
/// authenticator (or signing out) is possible until the server rotates the session.
struct ForcedTotpRebindView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var status: TotpStatus?
    @State private var setup: TotpSetupResponse?
    @State private var setupError: String?
    @State private var loading = false
    @State private var flowID = UUID()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(env.preferences.t("重新绑定验证器", en: "Rebind authenticator", ja: "認証アプリを再登録", pl: "Powiąż ponownie uwierzytelniacz"))
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
                    .padding(.top, 24)

                banner

                VStack(alignment: .leading, spacing: 14) {
                    if let setup {
                        TotpBindAndSaveFlow(
                            setup: setup,
                            stepLabels: [
                                env.preferences.t("绑定新验证器", en: "Bind new authenticator", ja: "新しい認証アプリを登録", pl: "Powiąż nowy uwierzytelniacz"),
                                env.preferences.t("保存新恢复码", en: "Save new recovery codes", ja: "新しいリカバリーコードを保存", pl: "Zapisz nowe kody odzyskiwania"),
                            ],
                            bindIndex: 0,
                            finishTitle: env.preferences.t("完成并进入笔记", en: "Finish and continue", ja: "完了してノートへ", pl: "Zakończ i kontynuuj"),
                            onConfirmed: { response in
                                try await env.session.completeMfaRebind(newSessionToken: response.sessionToken)
                                Task { await env.runSyncCycle() }
                            },
                            onExpired: { message in
                                Task { await startSetup(message: message) }
                            }
                        )
                        .id(flowID)
                    } else if let setupError {
                        TotpErrorText(message: setupError)
                        TotpActionButton(
                            title: env.preferences.t("重试", en: "Retry", ja: "再試行", pl: "Ponów"),
                            busy: loading
                        ) {
                            Task { await startSetup() }
                        }
                    } else {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .frame(minHeight: 120)
                    }
                }
                .padding(16)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(AppTheme.border, lineWidth: 1)
                )
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 40)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .preferredColorScheme(env.preferences.colorScheme)
        .task {
            await startSetup()
            await loadStatus()
        }
    }

    private var banner: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(TotpUI.warningBody)
                Text(bannerText)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(TotpUI.warningTitle)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Task { await env.session.signOut() }
            } label: {
                Text(env.preferences.t("退出登录", en: "Sign out", ja: "ログアウト", pl: "Wyloguj się"))
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(TotpUI.warningTitle)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 36)
                    .background(AppTheme.syncErrorRetryFill)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TotpUI.warningBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(TotpUI.warningBorder, lineWidth: 1)
        )
    }

    private var bannerText: String {
        if let remaining = status?.recoveryCodesRemaining {
            return env.preferences.t(
                "你已使用恢复码登录（剩余 \(remaining) 个）。重新绑定验证器后才能继续使用笔记。此页面 30 分钟内有效。",
                en: "You signed in with a recovery code (\(remaining) left). Rebind your authenticator to continue using your notes. This page is valid for 30 minutes.",
                ja: "リカバリーコードでログインしました（残り \(remaining) 個）。ノートを引き続き使うには認証アプリを再登録してください。このページは 30 分間有効です。",
                pl: "Zalogowano kodem odzyskiwania (pozostało: \(remaining)). Powiąż ponownie uwierzytelniacz, aby dalej korzystać z notatek. Ta strona jest ważna przez 30 minut."
            )
        }
        return env.preferences.t(
            "你已使用恢复码登录。重新绑定验证器后才能继续使用笔记。此页面 30 分钟内有效。",
            en: "You signed in with a recovery code. Rebind your authenticator to continue using your notes. This page is valid for 30 minutes.",
            ja: "リカバリーコードでログインしました。ノートを引き続き使うには認証アプリを再登録してください。このページは 30 分間有効です。",
            pl: "Zalogowano kodem odzyskiwania. Powiąż ponownie uwierzytelniacz, aby dalej korzystać z notatek. Ta strona jest ważna przez 30 minut."
        )
    }

    private func loadStatus() async {
        if let next = try? await env.session.client.getTotpStatus() {
            status = next
        }
    }

    private func startSetup(message: String? = nil) async {
        loading = true
        defer { loading = false }
        do {
            // Restricted sessions start setup with an empty body.
            let next = try await env.session.client.startTotpSetup(TotpReauthInput())
            setupError = nil
            setup = next
            flowID = UUID()
        } catch {
            setup = nil
            setupError = message ?? TotpUI.errorMessage(error, prefs: env.preferences)
        }
    }
}
