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
                    ja: "二要素認証（TOTP）",
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
                        title: env.preferences.totpModeTitle(.rebind),
                        role: .secondary
                    ) { open(.rebind) }
                    TotpActionButton(
                        title: env.preferences.totpModeTitle(.regenerate),
                        role: .secondary
                    ) { open(.regenerate) }
                    TotpActionButton(
                        title: env.preferences.totpModeTitle(.disable),
                        role: .danger
                    ) { open(.disable) }
                }
            } else {
                unavailableNote(status.unavailableReason)
            }
        } else {
            Text(env.preferences.t(
                "登录时除密码外，还需要输入身份验证器 App 生成的 6 位验证码。开启后会生成 10 个一次性恢复码；已登录的设备保持登录，下次登录时才需要验证码。已有 API Token 不受影响。",
                en: "At sign-in, enter a 6-digit code from an authenticator app in addition to your password. Turning it on creates 10 one-time recovery codes. Devices that are already signed in stay signed in and are asked for a code at their next sign-in. Existing API tokens are not affected.",
                ja: "サインイン時に、パスワードに加えて認証アプリの 6 桁のコードを入力します。オンにすると 10 個の使い捨てリカバリーコードが作成されます。サインイン済みのデバイスはそのままで、次回のサインイン時からコードが必要になります。既存の API トークンには影響しません。",
                pl: "Przy logowaniu oprócz hasła wpisujesz 6-cyfrowy kod z aplikacji uwierzytelniającej. Włączenie tworzy 10 jednorazowych kodów odzyskiwania. Zalogowane urządzenia pozostają zalogowane i poproszą o kod przy następnym logowaniu. Istniejące tokeny API nie są zmieniane."
            ))
            .font(.system(size: 12))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
            if status.available {
                TotpActionButton(
                    title: env.preferences.totpModeTitle(.enable)
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
        let count = status.recoveryCodesRemaining
        var date = "—"
        if let enabledAt = status.enabledAt, let parsed = Self.parseDate(enabledAt) {
            let formatter = DateFormatter()
            let code = env.preferences.localeCode
            formatter.locale = code == "system" ? .current : Locale(identifier: code)
            formatter.dateStyle = .medium
            formatter.timeStyle = .none
            date = formatter.string(from: parsed)
        }
        return env.preferences.t(
            "开启于 \(date) · 剩余恢复码 \(count) / 10。以下操作都需要重新输入密码和当前验证码。",
            en: "Turned on \(date) · \(count) of 10 recovery codes left. Each action below asks for your password and a current code.",
            ja: "\(date) に有効化 · リカバリーコード残り \(count) / 10。以下の操作にはパスワードと現在のコードが必要です。",
            pl: "Włączono \(date) · pozostało \(count) z 10 kodów odzyskiwania. Każda z poniższych czynności wymaga hasła i bieżącego kodu."
        )
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
        /// Codes and the batch id the server issued for them; confirm names that batch.
        case recoveryCodes(TotpRecoveryCodesResponse)
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
                            stepLabels: stepLabels,
                            bindIndex: 1,
                            finishTitle: mode == .enable
                                ? env.preferences.t("启用二次验证", en: "Turn on two-factor authentication", ja: "二要素認証をオンにする", pl: "Włącz uwierzytelnianie dwuskładnikowe")
                                : env.preferences.t("完成重新绑定", en: "Finish rebinding", ja: "再登録を完了", pl: "Zakończ ponowne powiązanie"),
                            finishNote: mode == .enable
                                ? env.preferences.t(
                                    "已登录的设备保持登录，下次登录时才需要验证码。",
                                    en: "Devices that are already signed in stay signed in; they are asked for a code at their next sign-in.",
                                    ja: "サインイン済みのデバイスはそのままです。次回のサインイン時からコードが必要になります。",
                                    pl: "Zalogowane urządzenia pozostają zalogowane; kod będzie wymagany przy następnym logowaniu."
                                )
                                : env.preferences.totpDeleteOldEntry,
                            onConfirmed: { response in
                                if let token = response.sessionToken, !token.isEmpty {
                                    try await env.session.completeMfaRebind(newSessionToken: token)
                                }
                                finish(mode == .enable
                                    ? env.preferences.t("二次验证已开启。", en: "Two-factor authentication is on.", ja: "二要素認証をオンにしました。", pl: "Uwierzytelnianie dwuskładnikowe jest włączone.")
                                    : env.preferences.t("验证器已重新绑定。", en: "Authenticator rebound.", ja: "認証アプリを再登録しました。", pl: "Aplikacja została ponownie powiązana."))
                            },
                            onExpired: { message in
                                restart(with: message)
                            }
                        )
                    case let .recoveryCodes(batch):
                        TotpStepProgress(labels: stepLabels, current: 1)
                        TotpRecoveryCodesView(codes: batch.recoveryCodes, saved: $saved)
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
                            title: env.preferences.t("确认替换", en: "Replace codes", ja: "置き換える", pl: "Zamień kody"),
                            busy: busy,
                            enabled: saved
                        ) {
                            Task { await confirmRecoveryCodes(batchId: batch.batchId) }
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

    private var title: String { env.preferences.totpModeTitle(mode) }

    /// Same step names as Android/Web: enable binds an authenticator, rebind binds a
    /// new one, regenerate only saves new codes.
    private var stepLabels: [String] {
        let verify = env.preferences.t("验证身份", en: "Verify identity", ja: "本人確認", pl: "Potwierdź tożsamość")
        switch mode {
        case .enable:
            return [
                verify,
                env.preferences.t("绑定验证器", en: "Bind authenticator", ja: "認証アプリを登録", pl: "Powiąż aplikację"),
                env.preferences.t("保存恢复码", en: "Save recovery codes", ja: "リカバリーコードを保存", pl: "Zapisz kody odzyskiwania"),
            ]
        case .rebind:
            return [
                verify,
                env.preferences.totpStepBindNew,
                env.preferences.totpStepNewCodes,
            ]
        case .regenerate:
            return [verify, env.preferences.totpStepNewCodes]
        case .disable:
            return []
        }
    }

    @ViewBuilder
    private var identityStep: some View {
        switch mode {
        case .enable:
            TotpStepProgress(labels: stepLabels, current: 0)
            identityHint(env.preferences.t(
                "请输入当前密码以继续。",
                en: "Enter your current password to continue.",
                ja: "続行するには現在のパスワードを入力してください。",
                pl: "Wpisz bieżące hasło, aby kontynuować."
            ))
        case .rebind:
            TotpStepProgress(labels: stepLabels, current: 0)
            identityHint(env.preferences.t(
                "新验证码通过前，原验证器继续有效。完成后会生成新的恢复码，旧恢复码同时失效。",
                en: "Your current authenticator keeps working until the new one is verified. Finishing creates new recovery codes, and the old ones stop working.",
                ja: "新しいコードが確認されるまで、現在の認証アプリは引き続き使えます。完了すると新しいリカバリーコードが作成され、古いコードは無効になります。",
                pl: "Obecna aplikacja działa, dopóki nowa nie zostanie zweryfikowana. Po zakończeniu powstaną nowe kody odzyskiwania, a stare przestaną działać."
            ))
        case .regenerate:
            TotpStepProgress(labels: stepLabels, current: 0)
            identityHint(env.preferences.t(
                "点击“确认替换”前，现有恢复码继续有效。",
                en: "Your current recovery codes keep working until you confirm the replacement.",
                ja: "置き換えを確定するまで、現在のリカバリーコードは引き続き使えます。",
                pl: "Obecne kody odzyskiwania działają, dopóki nie potwierdzisz zamiany."
            ))
        case .disable:
            Text(env.preferences.t(
                "请先确认身份。关闭后，登录只需要密码，所有恢复码同时失效。",
                en: "Confirm it's you. After turning it off, sign-in only needs your password, and every recovery code stops working.",
                ja: "本人確認を行ってください。オフにすると、サインインはパスワードのみになり、すべてのリカバリーコードが無効になります。",
                pl: "Potwierdź, że to Ty. Po wyłączeniu logowanie wymaga tylko hasła, a wszystkie kody odzyskiwania przestają działać."
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

        TotpIdentityFields(input: $identity, requiresSecondFactor: requiresSecondFactor)

        TotpErrorText(message: error)

        TotpActionButton(
            title: mode == .disable
                ? env.preferences.totpModeTitle(.disable)
                : env.preferences.t("继续", en: "Continue", ja: "続行", pl: "Dalej"),
            role: mode == .disable ? .danger : .primary,
            busy: busy,
            enabled: identity.isComplete(requiresSecondFactor: requiresSecondFactor)
        ) {
            Task { await submitIdentity() }
        }
    }

    private func identityHint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
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
                withAnimation(Motion.chip) { phase = .recoveryCodes(response) }
            case .disable:
                try await client.disableTotp(input)
                finish(env.preferences.t(
                    "二次验证已关闭。",
                    en: "Two-factor authentication is off.",
                    ja: "二要素認証をオフにしました。",
                    pl: "Uwierzytelnianie dwuskładnikowe jest wyłączone."
                ))
            }
        } catch {
            identity.code = ""
            withAnimation(Motion.chip) { self.error = TotpUI.errorMessage(error, prefs: env.preferences) }
        }
    }

    private func confirmRecoveryCodes(batchId: String) async {
        guard saved, !busy else { return }
        error = nil
        busy = true
        defer { busy = false }
        do {
            try await env.session.client.confirmRecoveryCodes(batchId: batchId)
            finish(env.preferences.t(
                "恢复码已替换。",
                en: "Recovery codes replaced.",
                ja: "リカバリーコードを置き換えました。",
                pl: "Kody odzyskiwania zostały zamienione."
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

/// TOTP copy reused across the settings card, the management sheet and the forced
/// rebind screen. Text matches the shared `twoFactor` i18n keys used by Android/Web.
extension PreferencesStore {
    func totpModeTitle(_ mode: TotpManageMode) -> String {
        switch mode {
        case .enable:
            return t("开启二次验证", en: "Turn on two-factor authentication", ja: "二要素認証をオンにする", pl: "Włącz uwierzytelnianie dwuskładnikowe")
        case .rebind:
            return t("重新绑定验证器", en: "Rebind authenticator", ja: "認証アプリを再登録", pl: "Powiąż aplikację ponownie")
        case .regenerate:
            return t("重新生成恢复码", en: "Regenerate recovery codes", ja: "リカバリーコードを再生成", pl: "Wygeneruj nowe kody odzyskiwania")
        case .disable:
            return t("关闭二次验证", en: "Turn off two-factor authentication", ja: "二要素認証をオフにする", pl: "Wyłącz uwierzytelnianie dwuskładnikowe")
        }
    }

    var totpStepBindNew: String {
        t("绑定新验证器", en: "Bind new authenticator", ja: "新しい認証アプリを登録", pl: "Powiąż nową aplikację")
    }

    var totpStepNewCodes: String {
        t("保存新恢复码", en: "Save new recovery codes", ja: "新しいリカバリーコードを保存", pl: "Zapisz nowe kody odzyskiwania")
    }

    var totpDeleteOldEntry: String {
        t(
            "请先在旧验证器中删除 EdgeEver 条目（如果还能打开），避免混淆。",
            en: "If you can still open the old authenticator, delete its EdgeEver entry to avoid confusion.",
            ja: "古い認証アプリをまだ開ける場合は、混乱を避けるため EdgeEver の項目を削除してください。",
            pl: "Jeśli nadal możesz otworzyć starą aplikację, usuń z niej wpis EdgeEver, aby uniknąć pomyłek."
        )
    }
}
