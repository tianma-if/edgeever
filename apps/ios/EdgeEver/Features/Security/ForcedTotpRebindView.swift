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
                Text(env.preferences.t("重新绑定验证器", en: "Rebind authenticator", ja: "認証アプリを再登録", pl: "Powiąż aplikację ponownie"))
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
                    .padding(.top, 24)

                Text(env.preferences.t(
                    "完成后，旧恢复码全部失效，其他设备上的登录会被退出，并生成一组新的恢复码。",
                    en: "When you finish, all old recovery codes stop working, other devices are signed out, and a new set of recovery codes is created.",
                    ja: "完了すると、古いリカバリーコードはすべて無効になり、他のデバイスはサインアウトされ、新しいリカバリーコードが作成されます。",
                    pl: "Po zakończeniu wszystkie stare kody odzyskiwania przestaną działać, inne urządzenia zostaną wylogowane i powstanie nowy zestaw kodów."
                ))
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)

                banner

                VStack(alignment: .leading, spacing: 14) {
                    if let setup {
                        TotpBindAndSaveFlow(
                            setup: setup,
                            stepLabels: [
                                env.preferences.totpStepBindNew,
                                env.preferences.totpStepNewCodes,
                            ],
                            bindIndex: 0,
                            finishTitle: env.preferences.t("完成并继续", en: "Finish and continue", ja: "完了して続行", pl: "Zakończ i kontynuuj"),
                            finishNote: env.preferences.totpDeleteOldEntry,
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
        // This page has no navigation bar: keep scrolled content from showing
        // through the status bar. A zero-height top inset whose background
        // extends into the safe area paints the status bar region.
        .safeAreaInset(edge: .top, spacing: 0) {
            Color.clear
                .frame(height: 0)
                .background(AppTheme.background)
        }
        // Part of the login flow: primary buttons look like the login button.
        .environment(\.totpButtonTone, .login)
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
                Text(env.preferences.t("退出登录", en: "Sign out", ja: "サインアウト", pl: "Wyloguj"))
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
        // Same as Android: "—" until the remaining count has loaded.
        let count = status.map { String($0.recoveryCodesRemaining) } ?? "—"
        return env.preferences.t(
            "你已使用恢复码登录（剩余 \(count) 个）。重新绑定验证器后才能继续使用笔记。此页面 30 分钟内有效。",
            en: "You signed in with a recovery code (\(count) left). Bind a new authenticator to keep using your notes. This page stays valid for 30 minutes.",
            ja: "リカバリーコードでサインインしました（残り \(count) 個）。ノートを引き続き使うには、新しい認証アプリを登録してください。このページは 30 分間有効です。",
            pl: "Zalogowano kodem odzyskiwania (pozostało: \(count)). Powiąż nową aplikację uwierzytelniającą, aby dalej korzystać z notatek. Ta strona jest ważna przez 30 minut."
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
