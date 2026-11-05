import SwiftUI
import Pow

struct LoginView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var baseUrl = ""
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var submitting = false
    @State private var showHTTPWarning = false
    @State private var pendingHTTPLogin = false
    @State private var loginShake = 0
    // Second step (TOTP) after a 401 `mfa_required`.
    @State private var pendingMfa: PendingMfaLogin?
    @State private var mfaCode = ""
    @State private var mfaRecoveryCode = ""
    @State private var mfaUseRecovery = false
    @State private var mfaError: String?
    @State private var mfaSubmitting = false

    private let submitFill = Color(hex: 0x047857)

    private var canSubmit: Bool {
        !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !password.isEmpty
            && !submitting
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            AppTheme.background
                .ignoresSafeArea()

            Link(destination: URL(string: "https://github.com/tianma-if/edgeever")!) {
                Image(systemName: "arrow.up.right.square")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.slate)
                    .frame(width: 42, height: 42)
                    .background(AppTheme.card)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(AppTheme.border, lineWidth: 1))
            }
            .accessibilityLabel(env.preferences.t("GitHub 仓库", en: "GitHub repository", ja: "GitHub リポジトリ", pl: "Repozytorium GitHub"))
            .padding(.trailing, 18)
            .padding(.top, 18)
            .zIndex(2)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer(minLength: 72)

                    // Header row: logo + title
                    HStack(spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(AppTheme.searchFill)
                                .frame(width: 48, height: 48)
                            Image(systemName: "lock.fill")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(AppTheme.slate)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("EdgeEver")
                                .font(.system(size: 22, weight: .heavy))
                                .foregroundStyle(AppTheme.title)
                            Text(env.preferences.t("连接你的自托管笔记空间", en: "Connect your self-hosted notes", ja: "セルフホストのノート空間に接続", pl: "Połącz się ze swoimi samodzielnie hostowanymi notatkami"))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(AppTheme.secondary)
                        }
                    }
                    .padding(.bottom, 28)

                    if let pendingMfa {
                        mfaStep(pendingMfa)
                    } else {
                        passwordStep
                    }
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)
            }
        }
        .alert(env.preferences.t("使用 HTTP 连接？", en: "Use HTTP?", ja: "HTTP で接続しますか？", pl: "Użyć HTTP?"), isPresented: $showHTTPWarning) {
            Button(env.preferences.t("继续", en: "Continue", ja: "続行", pl: "Kontynuuj"), role: .destructive) {
                pendingHTTPLogin = true
                Task { await submit(forceHTTP: true) }
            }
            Button(env.preferences.t("取消", en: "Cancel", ja: "キャンセル", pl: "Anuluj"), role: .cancel) {}
        } message: {
            Text(env.preferences.t(
                "HTTP 不会加密传输凭证，仅建议用于可信局域网自托管实例。",
                en: "HTTP does not encrypt credentials. Only use on trusted LAN instances.",
                ja: "HTTP は資格情報を暗号化しません。信頼できる LAN 上の自前インスタンスにだけ使ってください。",
                pl: "HTTP nie szyfruje danych logowania. Używaj go tylko z instancjami w zaufanej sieci lokalnej."
            ))
        }
        .preferredColorScheme(env.preferences.colorScheme)
    }

    @ViewBuilder
    private var passwordStep: some View {
                    field(
                        env.preferences.t("实例地址", en: "Instance URL", ja: "インスタンス URL", pl: "Adres URL instancji"),
                        placeholder: EdgeEverPublicDemo.instanceURLString,
                        text: $baseUrl,
                        keyboard: .URL,
                        secure: false
                    )
                    .padding(.bottom, 14)

                    field(
                        env.preferences.t("用户名", en: "Username", ja: "ユーザー名", pl: "Nazwa użytkownika"),
                        placeholder: "",
                        text: $username,
                        keyboard: .default,
                        secure: false
                    )
                    .padding(.bottom, 14)

                    field(
                        env.preferences.t("密码", en: "Password", ja: "パスワード", pl: "Hasło"),
                        placeholder: env.preferences.t("首次登录密码", en: "Initial password", ja: "初回ログイン用パスワード", pl: "Hasło początkowe"),
                        text: $password,
                        keyboard: .default,
                        secure: true
                    )
                    .padding(.bottom, 16)

                    if let error {
                        Text(error)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.danger)
                            .padding(.bottom, 10)
                            .transition(Motion.softFade)
                            .edgeEverErrorShake(on: error)
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        HStack(spacing: 8) {
                            if submitting {
                                ProgressView().tint(.white)
                            }
                            Text(submitting
                                ? env.preferences.t("登录中…", en: "Signing in…", ja: "ログイン中…", pl: "Logowanie…")
                                : env.preferences.t("登录", en: "Sign in", ja: "ログイン", pl: "Zaloguj się"))
                                .font(.system(size: 16, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .foregroundStyle(.white)
                        .background(canSubmit ? submitFill : AppTheme.disabledFill)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)
                    .changeEffect(.shake, value: loginShake)
    }

    // MARK: - Two-step verification

    private var canSubmitMfa: Bool {
        guard !mfaSubmitting else { return false }
        return mfaUseRecovery
            ? !TotpFormat.normalizeRecoveryCode(mfaRecoveryCode).isEmpty
            : mfaCode.count == 6
    }

    @ViewBuilder
    private func mfaStep(_ pending: PendingMfaLogin) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(mfaUseRecovery
                ? env.preferences.t("使用恢复码", en: "Use a recovery code", ja: "リカバリーコードを使用", pl: "Użyj kodu odzyskiwania")
                : env.preferences.t("两步验证", en: "Two-step verification", ja: "2 段階認証", pl: "Weryfikacja dwuetapowa"))
                .font(.system(size: 18, weight: .heavy))
                .foregroundStyle(AppTheme.title)

            if mfaUseRecovery {
                Text(env.preferences.t(
                    "输入开启二次验证时保存的任意一个恢复码。登录后需要先重新绑定验证器，才能继续使用笔记。",
                    en: "Enter any recovery code you saved when turning on two-factor authentication. After signing in, bind a new authenticator before using your notes.",
                    ja: "二要素認証をオンにしたときに保存したリカバリーコードを 1 つ入力してください。サインイン後、ノートを使う前に新しい認証アプリを登録する必要があります。",
                    pl: "Wpisz dowolny kod odzyskiwania zapisany przy włączaniu uwierzytelniania dwuskładnikowego. Po zalogowaniu musisz powiązać nową aplikację, zanim skorzystasz z notatek."
                ))
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)

                TotpRecoveryCodeField(code: $mfaRecoveryCode)
                    .submitLabel(.go)
                    .onSubmit { Task { await submitMfa(pending) } }

                Text(env.preferences.t(
                    "不区分大小写，短横线可省略。每个恢复码只能使用一次。",
                    en: "Not case-sensitive; dashes are optional. Each recovery code works only once.",
                    ja: "大文字と小文字は区別されず、ハイフンは省略できます。各リカバリーコードは 1 回だけ使えます。",
                    pl: "Wielkość liter nie ma znaczenia, myślniki są opcjonalne. Każdy kod odzyskiwania działa tylko raz."
                ))
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
            } else {
                Text(env.preferences.t(
                    "密码已验证。请打开身份验证器 App，输入 \(pending.username) 的 6 位验证码。",
                    en: "Password verified. Open your authenticator app and enter the 6-digit code for \(pending.username).",
                    ja: "パスワードを確認しました。認証アプリを開き、\(pending.username) の 6 桁のコードを入力してください。",
                    pl: "Hasło zweryfikowane. Otwórz aplikację uwierzytelniającą i wpisz 6-cyfrowy kod dla \(pending.username)."
                ))
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)

                TotpCodeField(code: $mfaCode, focusColor: AppTheme.slate)
                    .onChange(of: mfaCode) { _, next in
                        if next.count == 6, !mfaSubmitting {
                            Task { await submitMfa(pending) }
                        }
                    }
            }

            TotpErrorText(message: mfaError)

            Button {
                Task { await submitMfa(pending) }
            } label: {
                HStack(spacing: 8) {
                    if mfaSubmitting {
                        ProgressView().tint(.white)
                    }
                    Text(mfaUseRecovery
                        ? env.preferences.t("使用恢复码登录", en: "Sign in with recovery code", ja: "リカバリーコードでサインイン", pl: "Zaloguj kodem odzyskiwania")
                        : env.preferences.t("验证并登录", en: "Verify and sign in", ja: "確認してサインイン", pl: "Zweryfikuj i zaloguj"))
                        .font(.system(size: 16, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .foregroundStyle(.white)
                .background(canSubmitMfa ? submitFill : AppTheme.disabledFill)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(!canSubmitMfa)
            .changeEffect(.shake, value: loginShake)

            VStack(alignment: .leading, spacing: 2) {
                if mfaUseRecovery {
                    TotpLinkButton(title: env.preferences.t(
                        "改用验证器验证码",
                        en: "Use an authenticator code instead",
                        ja: "認証アプリのコードを使用",
                        pl: "Użyj kodu z aplikacji"
                    ), color: AppTheme.slate) {
                        mfaError = nil
                        mfaRecoveryCode = ""
                        mfaUseRecovery = false
                    }
                } else {
                    TotpLinkButton(title: env.preferences.t(
                        "验证器不可用？改用恢复码",
                        en: "Authenticator unavailable? Use a recovery code",
                        ja: "認証アプリを使えない場合はリカバリーコードを使用",
                        pl: "Aplikacja niedostępna? Użyj kodu odzyskiwania"
                    ), color: AppTheme.slate) {
                        mfaError = nil
                        mfaCode = ""
                        mfaUseRecovery = true
                    }
                }
                TotpLinkButton(title: env.preferences.t(
                    "返回重新输入密码",
                    en: "Back to password",
                    ja: "パスワード入力に戻る",
                    pl: "Wróć do hasła"
                ), color: AppTheme.slate) {
                    leaveMfaStep(message: nil)
                }
            }
        }
        .transition(Motion.softFade)
    }

    private func leaveMfaStep(message: String?) {
        withAnimation(Motion.chip) {
            pendingMfa = nil
            mfaCode = ""
            mfaRecoveryCode = ""
            mfaUseRecovery = false
            mfaError = nil
            if message != nil { password = "" }
            error = message
        }
    }

    private func submitMfa(_ pending: PendingMfaLogin) async {
        guard canSubmitMfa else { return }
        mfaError = nil
        mfaSubmitting = true
        defer { mfaSubmitting = false }
        let useRecovery = mfaUseRecovery
        do {
            try await env.session.completeMfaSignIn(
                pending,
                code: useRecovery ? nil : mfaCode,
                recoveryCode: useRecovery ? TotpFormat.normalizeRecoveryCode(mfaRecoveryCode) : nil
            )
            await env.runSyncCycle()
        } catch {
            let message = TotpUI.errorMessage(error, prefs: env.preferences)
            let api = error as? APIError
            if api?.code == "mfa_challenge_expired" {
                leaveMfaStep(message: message)
                return
            }
            if api?.code == "totp_unavailable" {
                mfaUseRecovery = true
            }
            mfaCode = ""
            withAnimation(Motion.chip) { mfaError = message }
            loginShake += 1
        }
    }

    private func field(
        _ title: String,
        placeholder: String,
        text: Binding<String>,
        keyboard: UIKeyboardType,
        secure: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(AppTheme.meta)
            Group {
                if secure {
                    SecureField(placeholder, text: text)
                } else {
                    TextField(placeholder, text: text)
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .font(.system(size: 15))
            .foregroundStyle(AppTheme.title)
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
        }
    }

    private func submit(forceHTTP: Bool = false) async {
        error = nil
        let trimmed = baseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if !forceHTTP && !pendingHTTPLogin {
            if let url = try? EdgeEverURLNormalizer.normalizeInstanceURL(trimmed),
               url.scheme?.lowercased() == "http"
            {
                showHTTPWarning = true
                return
            }
        }
        pendingHTTPLogin = false
        submitting = true
        defer { submitting = false }
        do {
            let outcome = try await env.session.signIn(baseUrl: trimmed, username: username, password: password)
            switch outcome {
            case .signedIn:
                await env.runSyncCycle()
            case let .mfaRequired(pending):
                withAnimation(Motion.chip) {
                    mfaCode = ""
                    mfaRecoveryCode = ""
                    mfaUseRecovery = false
                    mfaError = nil
                    pendingMfa = pending
                }
            }
        } catch {
            withAnimation(Motion.chip) {
                self.error = error.localizedDescription
            }
            loginShake += 1
        }
    }
}
