import SwiftUI

/// Settings → Account: "Two-factor authentication (TOTP)" card.
struct TotpSettingsPanel: View {
    @Environment(AppEnvironment.self) private var env
    @State private var status: TotpStatus?
    @State private var loadError: String?
    @State private var loading = false
    @State private var activeFlow: TotpManageMode?
    @State private var notice: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            if let status {
                content(status)
            } else if let loadError {
                TotpErrorText(message: loadError)
                TotpActionButton(
                    title: env.preferences.t("重试", en: "Retry", ja: "再試行", pl: "Ponów"),
                    role: .secondary,
                    busy: loading
                ) {
                    Task { await load() }
                }
            } else {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .frame(minHeight: 48)
            }

            if let notice {
                Text(notice)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(AppTheme.accentStrong)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
        .task { await load() }
        .sheet(item: $activeFlow) { mode in
            TotpManageSheet(mode: mode) { message in
                notice = message
                Task { await load() }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AppTheme.accentStrong)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(env.preferences.t(
                    "二次验证（TOTP）",
                    en: "Two-factor authentication (TOTP)",
                    ja: "二段階認証（TOTP）",
                    pl: "Uwierzytelnianie dwuskładnikowe (TOTP)"
                ))
                .font(.system(size: 16, weight: .heavy))
                .foregroundStyle(AppTheme.title)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if let status {
                badge(enabled: status.enabled)
            }
        }
    }

    private func badge(enabled: Bool) -> some View {
        Text(enabled
            ? env.preferences.t("已开启", en: "On", ja: "オン", pl: "Włączone")
            : env.preferences.t("未开启", en: "Off", ja: "オフ", pl: "Wyłączone"))
            .font(.system(size: 11, weight: .heavy))
            .foregroundStyle(enabled ? AppTheme.accentText : AppTheme.secondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(enabled ? AppTheme.accentSoft : AppTheme.searchFill)
            .clipShape(Capsule())
    }

    @ViewBuilder
    private func content(_ status: TotpStatus) -> some View {
        if status.enabled {
            Text(enabledSummary(status))
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if status.available {
                VStack(spacing: 10) {
                    TotpActionButton(
                        title: env.preferences.t("重新绑定验证器", en: "Rebind authenticator", ja: "認証アプリを再登録", pl: "Powiąż ponownie uwierzytelniacz"),
                        role: .secondary
                    ) { open(.rebind) }
                    TotpActionButton(
                        title: env.preferences.t("重新生成恢复码", en: "Regenerate recovery codes", ja: "リカバリーコードを再生成", pl: "Wygeneruj nowe kody odzyskiwania"),
                        role: .secondary
                    ) { open(.regenerate) }
                    TotpActionButton(
                        title: env.preferences.t("关闭二次验证", en: "Turn off", ja: "二段階認証をオフにする", pl: "Wyłącz"),
                        role: .danger
                    ) { open(.disable) }
                }
            } else {
                unavailableNote(status.unavailableReason)
            }
        } else {
            Text(env.preferences.t(
                "登录时除密码外，还需输入验证器 App 生成的 6 位验证码。开启时会生成 10 个一次性恢复码，并退出其他设备上的登录；已有的 API Token 不受影响。",
                en: "At sign-in you'll also enter a 6-digit code from an authenticator app. Enabling generates 10 one-time recovery codes and signs out your other devices. Existing API tokens are not affected.",
                ja: "ログイン時にパスワードに加えて、認証アプリが生成する 6 桁のコードを入力します。有効にすると 1 回限りのリカバリーコードが 10 個生成され、他のデバイスはログアウトされます。既存の API トークンには影響しません。",
                pl: "Przy logowaniu wpiszesz też 6-cyfrowy kod z aplikacji uwierzytelniającej. Włączenie wygeneruje 10 jednorazowych kodów odzyskiwania i wyloguje pozostałe urządzenia. Istniejące tokeny API nie zostaną zmienione."
            ))
            .font(.system(size: 12))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
            if status.available {
                TotpActionButton(
                    title: env.preferences.t("开启二次验证", en: "Enable", ja: "二段階認証を有効にする", pl: "Włącz")
                ) { open(.enable) }
            } else {
                unavailableNote(status.unavailableReason)
            }
        }
    }

    private func unavailableNote(_ reason: String?) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle")
                .foregroundStyle(AppTheme.infoText)
            Text(TotpUI.unavailableMessage(reason: reason, prefs: env.preferences))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(AppTheme.infoText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.infoSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func enabledSummary(_ status: TotpStatus) -> String {
        let remaining = env.preferences.t(
            "剩余恢复码 \(status.recoveryCodesRemaining) / 10",
            en: "Recovery codes left \(status.recoveryCodesRemaining) / 10",
            ja: "残りのリカバリーコード \(status.recoveryCodesRemaining) / 10",
            pl: "Pozostałe kody odzyskiwania \(status.recoveryCodesRemaining) / 10"
        )
        guard let enabledAt = status.enabledAt, let date = Self.parseDate(enabledAt) else { return remaining }
        let formatter = DateFormatter()
        let code = env.preferences.localeCode
        formatter.locale = code == "system" ? .current : Locale(identifier: code)
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        let when = formatter.string(from: date)
        let prefix = env.preferences.t(
            "开启于 \(when)",
            en: "Enabled \(when)",
            ja: "\(when) に有効化",
            pl: "Włączono \(when)"
        )
        return "\(prefix) · \(remaining)"
    }

    private static func parseDate(_ iso: String) -> Date? {
        [ISO8601DateFormatter.edgeEver, ISO8601DateFormatter.edgeEverFallback]
            .compactMap { $0.date(from: iso) }
            .first
    }

    private func open(_ mode: TotpManageMode) {
        notice = nil
        activeFlow = mode
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let next = try await env.session.client.getTotpStatus()
            status = next
            loadError = nil
        } catch {
            if status == nil {
                loadError = TotpUI.errorMessage(error, prefs: env.preferences)
            }
        }
    }
}

enum TotpManageMode: String, Identifiable {
    case enable
    case rebind
    case regenerate
    case disable

    var id: String { rawValue }
}

/// Sheet for enable / rebind / regenerate recovery codes / disable.
struct TotpManageSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    let mode: TotpManageMode
    /// Called after a successful change with a short confirmation message.
    let onCompleted: (String) -> Void

    private enum Phase: Equatable {
        case identity
        case bind(TotpSetupResponse)
        case recoveryCodes([String])
    }

    @State private var phase: Phase = .identity
    @State private var identity = TotpIdentityInput()
    @State private var busy = false
    @State private var error: String?
    @State private var saved = false

    private var requiresSecondFactor: Bool { mode != .enable }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    switch phase {
                    case .identity:
                        identityStep
                    case let .bind(setup):
                        TotpBindAndSaveFlow(
                            setup: setup,
                            stepLabels: setupStepLabels,
                            bindIndex: 1,
                            finishTitle: mode == .enable
                                ? env.preferences.t("启用二次验证", en: "Enable", ja: "二段階認証を有効にする", pl: "Włącz")
                                : env.preferences.t("完成重新绑定", en: "Finish rebinding", ja: "再登録を完了", pl: "Zakończ ponowne powiązanie"),
                            finishNote: mode == .enable
                                ? env.preferences.t(
                                    "启用后，其他设备上的登录会被退出。",
                                    en: "Other devices will be signed out after enabling.",
                                    ja: "有効にすると、他のデバイスはログアウトされます。",
                                    pl: "Po włączeniu pozostałe urządzenia zostaną wylogowane."
                                )
                                : nil,
                            onConfirmed: { response in
                                if let token = response.sessionToken, !token.isEmpty {
                                    try await env.session.completeMfaRebind(newSessionToken: token)
                                }
                                finish(mode == .enable
                                    ? env.preferences.t("二次验证已开启。", en: "Two-factor authentication is on.", ja: "二段階認証を有効にしました。", pl: "Uwierzytelnianie dwuskładnikowe jest włączone.")
                                    : env.preferences.t("验证器已重新绑定。", en: "Authenticator rebound.", ja: "認証アプリを再登録しました。", pl: "Uwierzytelniacz został ponownie powiązany."))
                            },
                            onExpired: { message in
                                restart(with: message)
                            }
                        )
                    case let .recoveryCodes(codes):
                        TotpStepProgress(labels: regenerateStepLabels, current: 1)
                        TotpRecoveryCodesView(codes: codes, saved: $saved)
                        Text(env.preferences.t(
                            "确认替换后，旧的恢复码将全部失效。",
                            en: "Once replaced, all previous recovery codes stop working.",
                            ja: "置き換えると、以前のリカバリーコードはすべて無効になります。",
                            pl: "Po zastąpieniu wszystkie poprzednie kody odzyskiwania przestaną działać."
                        ))
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        TotpErrorText(message: error)
                        TotpActionButton(
                            title: env.preferences.t("确认替换", en: "Replace codes", ja: "コードを置き換える", pl: "Zastąp kody"),
                            busy: busy,
                            enabled: saved
                        ) {
                            Task { await confirmRecoveryCodes() }
                        }
                    }
                }
                .padding(18)
            }
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(env.preferences.t("取消", en: "Cancel", ja: "キャンセル", pl: "Anuluj")) { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(phase != .identity)
        .preferredColorScheme(env.preferences.colorScheme)
    }

    private var title: String {
        switch mode {
        case .enable: return env.preferences.t("开启二次验证", en: "Enable two-factor", ja: "二段階認証を有効にする", pl: "Włącz 2FA")
        case .rebind: return env.preferences.t("重新绑定验证器", en: "Rebind authenticator", ja: "認証アプリを再登録", pl: "Powiąż ponownie")
        case .regenerate: return env.preferences.t("重新生成恢复码", en: "Regenerate codes", ja: "コードを再生成", pl: "Nowe kody")
        case .disable: return env.preferences.t("关闭二次验证", en: "Turn off two-factor", ja: "二段階認証をオフ", pl: "Wyłącz 2FA")
        }
    }

    private var identityLabel: String {
        env.preferences.t("验证身份", en: "Verify identity", ja: "本人確認", pl: "Potwierdź tożsamość")
    }

    private var setupStepLabels: [String] {
        [
            identityLabel,
            env.preferences.t("绑定验证器", en: "Bind authenticator", ja: "認証アプリを登録", pl: "Powiąż uwierzytelniacz"),
            env.preferences.t("保存恢复码", en: "Save recovery codes", ja: "リカバリーコードを保存", pl: "Zapisz kody odzyskiwania"),
        ]
    }

    private var regenerateStepLabels: [String] {
        [
            identityLabel,
            env.preferences.t("保存新恢复码", en: "Save new codes", ja: "新しいコードを保存", pl: "Zapisz nowe kody"),
        ]
    }

    @ViewBuilder
    private var identityStep: some View {
        switch mode {
        case .enable, .rebind:
            TotpStepProgress(labels: setupStepLabels, current: 0)
        case .regenerate:
            TotpStepProgress(labels: regenerateStepLabels, current: 0)
        case .disable:
            Text(env.preferences.t(
                "关闭后，登录时只需输入密码，所有恢复码将失效。",
                en: "After turning off, sign-in only needs your password and all recovery codes stop working.",
                ja: "オフにすると、ログインにはパスワードのみが必要になり、すべてのリカバリーコードが無効になります。",
                pl: "Po wyłączeniu logowanie wymaga tylko hasła, a wszystkie kody odzyskiwania przestaną działać."
            ))
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(AppTheme.dangerStrong)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.dangerSurface)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.dangerBorder, lineWidth: 1)
            )
        }

        Text(requiresSecondFactor
            ? env.preferences.t(
                "请输入当前密码和验证器中的 6 位验证码。",
                en: "Enter your current password and the 6-digit code from your authenticator.",
                ja: "現在のパスワードと認証アプリの 6 桁のコードを入力してください。",
                pl: "Wpisz bieżące hasło i 6-cyfrowy kod z uwierzytelniacza."
            )
            : env.preferences.t(
                "请输入当前密码以继续。",
                en: "Enter your current password to continue.",
                ja: "続行するには現在のパスワードを入力してください。",
                pl: "Wpisz bieżące hasło, aby kontynuować."
            ))
            .font(.system(size: 13))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)

        TotpIdentityFields(input: $identity, requiresSecondFactor: requiresSecondFactor)

        TotpErrorText(message: error)

        TotpActionButton(
            title: mode == .disable
                ? env.preferences.t("关闭二次验证", en: "Turn off", ja: "オフにする", pl: "Wyłącz")
                : env.preferences.t("继续", en: "Continue", ja: "続行", pl: "Dalej"),
            role: mode == .disable ? .danger : .primary,
            busy: busy,
            enabled: identity.isComplete(requiresSecondFactor: requiresSecondFactor)
        ) {
            Task { await submitIdentity() }
        }
    }

    private func submitIdentity() async {
        guard identity.isComplete(requiresSecondFactor: requiresSecondFactor), !busy else { return }
        error = nil
        busy = true
        defer { busy = false }
        let input = identity.reauth(requiresSecondFactor: requiresSecondFactor)
        let client = env.session.client
        do {
            switch mode {
            case .enable, .rebind:
                let setup = try await client.startTotpSetup(input)
                withAnimation(Motion.chip) { phase = .bind(setup) }
            case .regenerate:
                let response = try await client.regenerateRecoveryCodes(input)
                saved = false
                withAnimation(Motion.chip) { phase = .recoveryCodes(response.recoveryCodes) }
            case .disable:
                try await client.disableTotp(input)
                finish(env.preferences.t(
                    "二次验证已关闭。",
                    en: "Two-factor authentication is off.",
                    ja: "二段階認証をオフにしました。",
                    pl: "Uwierzytelnianie dwuskładnikowe jest wyłączone."
                ))
            }
        } catch {
            identity.code = ""
            withAnimation(Motion.chip) { self.error = TotpUI.errorMessage(error, prefs: env.preferences) }
        }
    }

    private func confirmRecoveryCodes() async {
        guard saved, !busy else { return }
        error = nil
        busy = true
        defer { busy = false }
        do {
            try await env.session.client.confirmRecoveryCodes()
            finish(env.preferences.t(
                "恢复码已替换。",
                en: "Recovery codes replaced.",
                ja: "リカバリーコードを置き換えました。",
                pl: "Kody odzyskiwania zostały zastąpione."
            ))
        } catch {
            if (error as? APIError)?.code == "recovery_codes_expired" {
                restart(with: TotpUI.errorMessage(error, prefs: env.preferences))
            } else {
                withAnimation(Motion.chip) { self.error = TotpUI.errorMessage(error, prefs: env.preferences) }
            }
        }
    }

    private func restart(with message: String) {
        identity = TotpIdentityInput()
        saved = false
        withAnimation(Motion.chip) {
            phase = .identity
            error = message
        }
    }

    private func finish(_ message: String) {
        onCompleted(message)
        dismiss()
    }
}
