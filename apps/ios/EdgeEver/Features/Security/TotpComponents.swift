import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// Shared building blocks for TOTP two-factor authentication (login step,
/// settings flows and the forced rebind screen).
enum TotpUI {
    /// Accent for TOTP progress, focus and toggles (#059669, AppTheme.accentAction).
    static let primary = AppTheme.accentAction
    static let warningBackground = AppTheme.syncErrorBackground
    static let warningBorder = AppTheme.syncErrorBorder
    static let warningTitle = AppTheme.syncErrorTitle
    static let warningBody = AppTheme.syncErrorBody

    /// Map TOTP / MFA API errors to the same user-facing messages as Android and Web
    /// (shared `twoFactor` i18n keys).
    @MainActor
    static func errorMessage(_ error: Error, prefs: PreferencesStore) -> String {
        guard let api = error as? APIError else { return error.localizedDescription }
        switch api.code {
        case "invalid_totp_code":
            return prefs.t(
                "验证码不正确或已使用。请等待下一个验证码后重试。",
                en: "The code is incorrect or was already used. Wait for the next code and try again.",
                ja: "コードが正しくないか、すでに使用されています。次のコードを待ってからもう一度お試しください。",
                pl: "Kod jest nieprawidłowy lub został już użyty. Poczekaj na następny kod i spróbuj ponownie."
            )
        case "invalid_recovery_code":
            return prefs.t(
                "恢复码无效或已使用。",
                en: "The recovery code is incorrect or was already used.",
                ja: "リカバリーコードが正しくないか、すでに使用されています。",
                pl: "Kod odzyskiwania jest nieprawidłowy lub został już użyty."
            )
        case "mfa_challenge_expired":
            return prefs.t(
                "验证已过期，请重新输入密码。",
                en: "This verification has expired. Enter your password again.",
                ja: "確認の有効期限が切れました。もう一度パスワードを入力してください。",
                pl: "Weryfikacja wygasła. Wpisz hasło ponownie."
            )
        case "totp_unavailable":
            return prefs.t(
                "服务器无法读取验证器密钥，请改用恢复码。",
                en: "The server can't read your authenticator secret. Use a recovery code instead.",
                ja: "サーバーが認証アプリのシークレットを読み取れません。リカバリーコードを使用してください。",
                pl: "Serwer nie może odczytać sekretu aplikacji uwierzytelniającej. Użyj kodu odzyskiwania."
            )
        case "invalid_current_password":
            return prefs.t(
                "当前密码不正确。",
                en: "The current password is incorrect.",
                ja: "現在のパスワードが正しくありません。",
                pl: "Bieżące hasło jest nieprawidłowe."
            )
        case "totp_setup_expired", "recovery_codes_expired":
            return prefs.t(
                "本次设置已过期，请重新开始。",
                en: "This setup has expired. Start again.",
                ja: "この設定は期限切れです。最初からやり直してください。",
                pl: "Ta konfiguracja wygasła. Zacznij od nowa."
            )
        case "totp_encryption_unavailable":
            return unavailableMessage(reason: "encryption_unavailable", prefs: prefs)
        default:
            break
        }
        if api.status == 403, api.code == "forbidden" {
            return unavailableMessage(reason: "demo", prefs: prefs)
        }
        if api.status == 429 {
            let base = prefs.t(
                "尝试次数过多，请稍后再试。",
                en: "Too many attempts. Try again later.",
                ja: "試行回数が多すぎます。しばらくしてからお試しください。",
                pl: "Zbyt wiele prób. Spróbuj ponownie później."
            )
            guard let seconds = api.retryAfterSeconds, seconds > 0 else { return base }
            let minutes = max(1, Int((Double(seconds) / 60).rounded(.up)))
            return base + " " + prefs.t(
                "（约 \(minutes) 分钟后）",
                en: "(about \(minutes) min)",
                ja: "（約 \(minutes) 分後）",
                pl: "(ok. \(minutes) min)"
            )
        }
        return prefs.t(
            "操作失败，请重试。",
            en: "Something went wrong. Try again.",
            ja: "問題が発生しました。もう一度お試しください。",
            pl: "Coś poszło nie tak. Spróbuj ponownie."
        )
    }

    @MainActor
    static func unavailableMessage(reason: String?, prefs: PreferencesStore) -> String {
        if reason == "demo" {
            return prefs.t(
                "演示环境不支持二次验证。",
                en: "The demo environment doesn't support two-factor authentication.",
                ja: "デモ環境では二要素認証を利用できません。",
                pl: "Środowisko demonstracyjne nie obsługuje uwierzytelniania dwuskładnikowego."
            )
        }
        return prefs.t(
            "此服务器未配置凭据加密密钥，无法开启二次验证。请联系管理员设置 EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY。",
            en: "This server has no credential encryption key, so two-factor authentication can't be turned on. Ask the administrator to set EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY.",
            ja: "このサーバーには認証情報の暗号化キーが設定されていないため、二要素認証をオンにできません。管理者に EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY の設定を依頼してください。",
            pl: "Ten serwer nie ma klucza szyfrowania poświadczeń, więc nie można włączyć uwierzytelniania dwuskładnikowego. Poproś administratora o ustawienie EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY."
        )
    }
}

// MARK: - QR code

struct TotpQRCodeView: View {
    private let image: UIImage?

    init(uri: String) {
        image = Self.makeImage(uri)
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "qrcode")
                    .font(.system(size: 64))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .frame(width: 184, height: 184)
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
        .accessibilityHidden(image == nil)
    }

    static func makeImage(_ string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cgImage = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

// MARK: - Inputs

struct TotpCodeField: View {
    @Binding var code: String
    var autoFocus = true
    @FocusState private var focused: Bool

    var body: some View {
        TextField("000000", text: $code)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .font(.system(size: 22, weight: .bold, design: .monospaced))
            .kerning(6)
            .multilineTextAlignment(.center)
            .foregroundStyle(AppTheme.title)
            .frame(height: 52)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(focused ? TotpUI.primary : AppTheme.border, lineWidth: focused ? 1.5 : 1)
            )
            .focused($focused)
            .onChange(of: code) { _, next in
                let sanitized = TotpFormat.sanitizeCode(next)
                if sanitized != next { code = sanitized }
                // The number pad has no Done key and can cover the button below;
                // put it away once the code is complete.
                if sanitized.count == 6 { focused = false }
            }
            .onAppear {
                if autoFocus { focused = true }
            }
    }
}

struct TotpRecoveryCodeField: View {
    @Binding var code: String

    var body: some View {
        TextField("XXXX-XXXX-XXXX", text: $code)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .font(.system(size: 17, weight: .semibold, design: .monospaced))
            .multilineTextAlignment(.center)
            .foregroundStyle(AppTheme.title)
            .frame(height: 50)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }
}

struct TotpFieldLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(AppTheme.meta)
    }
}

struct TotpPasswordField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            TotpFieldLabel(text: label)
            SecureField("", text: $text)
                .textContentType(.password)
                .font(.system(size: 15))
                .padding(.horizontal, 13)
                .frame(minHeight: 48)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(AppTheme.border, lineWidth: 1)
                )
        }
    }
}

// MARK: - Buttons / text

enum TotpButtonRole {
    case primary
    case secondary
    case danger
}

/// Which flow a TOTP button belongs to. Login-flow buttons (the 2FA step and the
/// forced rebind after a recovery-code login) look like the login button;
/// settings-flow buttons look like the settings page's change-password button.
enum TotpButtonTone {
    case settings
    case login
}

private struct TotpButtonToneKey: EnvironmentKey {
    static let defaultValue: TotpButtonTone = .settings
}

extension EnvironmentValues {
    var totpButtonTone: TotpButtonTone {
        get { self[TotpButtonToneKey.self] }
        set { self[TotpButtonToneKey.self] = newValue }
    }
}

struct TotpActionButton: View {
    @Environment(\.totpButtonTone) private var tone
    let title: String
    var role: TotpButtonRole = .primary
    var busy = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy {
                    ProgressView().tint(role == .secondary ? AppTheme.title : .white)
                }
                Text(title)
                    .font(.system(size: loginStyle ? 16 : 14, weight: loginStyle ? .bold : .heavy))
            }
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(role == .secondary ? AppTheme.border : .clear, lineWidth: 1)
            )
            // The login button only switches to disabledFill when it can't be used.
            .opacity(isEnabled || loginStyle ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }

    private var isEnabled: Bool { enabled && !busy }

    /// A primary button in the login flow mirrors the login button exactly.
    private var loginStyle: Bool { tone == .login && role == .primary }

    private var foreground: Color {
        switch role {
        case .primary, .danger: return .white
        case .secondary: return AppTheme.title
        }
    }

    private var background: Color {
        switch role {
        case .primary:
            // Login flow: grey fill like the login button. Settings flow: keep the
            // colour and let the 0.45 opacity dim it, like the change-password button.
            if tone == .login { return isEnabled ? AppTheme.title : AppTheme.disabledFill }
            return AppTheme.accentAction
        case .secondary: return AppTheme.card
        case .danger: return AppTheme.dangerAction
        }
    }
}

struct TotpLinkButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(AppTheme.accentStrong)
                .frame(minHeight: 36)
        }
        .buttonStyle(.plain)
    }
}

struct TotpErrorText: View {
    let message: String?

    var body: some View {
        if let message {
            Text(message)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.danger)
                .fixedSize(horizontal: false, vertical: true)
                .transition(Motion.softFade)
                .edgeEverErrorShake(on: message)
        }
    }
}

// MARK: - Step progress

struct TotpStepProgress: View {
    let labels: [String]
    let current: Int

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                VStack(alignment: .leading, spacing: 6) {
                    Capsule()
                        .fill(index <= current ? TotpUI.primary : AppTheme.border)
                        .frame(height: 4)
                    Text("\(index + 1) \(label)")
                        .font(.system(size: 11, weight: index == current ? .heavy : .semibold))
                        .foregroundStyle(index == current ? AppTheme.title : AppTheme.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Secret key

struct TotpSecretKeyView: View {
    @Environment(AppEnvironment.self) private var env
    let secret: String
    let issuer: String
    let accountName: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            TotpFieldLabel(text: env.preferences.t(
                "无法扫码时，在 App 中选择“手动输入密钥”：",
                en: "Can't scan? In the app, choose “Enter a setup key”:",
                ja: "スキャンできない場合は、アプリで「セットアップキーを入力」を選択します：",
                pl: "Nie możesz zeskanować? W aplikacji wybierz „Wprowadź klucz konfiguracji”:"
            ))
            HStack(spacing: 10) {
                Text(TotpFormat.groupedSecret(secret))
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.title)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.string = secret
                    copied = true
                } label: {
                    Label(
                        copied
                            ? env.preferences.t("已复制", en: "Copied", ja: "コピーしました", pl: "Skopiowano")
                            : env.preferences.t("复制", en: "Copy", ja: "コピー", pl: "Kopiuj"),
                        systemImage: copied ? "checkmark" : "doc.on.doc"
                    )
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.accentStrong)
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .background(AppTheme.searchFill)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(env.preferences.t(
                "账号：\(issuer)（\(accountName)）· 30 秒 · 6 位",
                en: "Account: \(issuer) (\(accountName)) · 30 seconds · 6 digits",
                ja: "アカウント：\(issuer)（\(accountName)）· 30 秒 · 6 桁",
                pl: "Konto: \(issuer) (\(accountName)) · 30 sekund · 6 cyfr"
            ))
            .font(.system(size: 12))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Recovery codes

struct TotpRecoveryCodesView: View {
    @Environment(AppEnvironment.self) private var env
    let codes: [String]
    @Binding var saved: Bool
    @State private var copied = false

    private var joined: String { codes.joined(separator: "\n") }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(TotpUI.warningBody)
                Text(env.preferences.t(
                    "恢复码只显示这一次。验证器丢失时，用密码加一个恢复码即可登录并重新绑定。每个恢复码只能使用一次。",
                    en: "Recovery codes are shown only this once. If you lose your authenticator, sign in with your password and one recovery code, then bind a new one. Each code works only once.",
                    ja: "リカバリーコードは今回だけ表示されます。認証アプリを失くした場合は、パスワードとリカバリーコード 1 つでサインインして再登録できます。各コードは 1 回だけ使えます。",
                    pl: "Kody odzyskiwania są wyświetlane tylko teraz. Jeśli zgubisz aplikację uwierzytelniającą, zaloguj się hasłem i jednym kodem odzyskiwania, a potem powiąż nową. Każdy kod działa tylko raz."
                ))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(TotpUI.warningTitle)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(TotpUI.warningBackground)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(TotpUI.warningBorder, lineWidth: 1)
            )

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(codes, id: \.self) { code in
                    Text(code)
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .foregroundStyle(AppTheme.title)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background(AppTheme.searchFill)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .textSelection(.enabled)

            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = joined
                    copied = true
                } label: {
                    Label(
                        copied
                            ? env.preferences.t("已复制", en: "Copied", ja: "コピーしました", pl: "Skopiowano")
                            : env.preferences.t("复制全部", en: "Copy all", ja: "すべてコピー", pl: "Kopiuj wszystkie"),
                        systemImage: copied ? "checkmark" : "doc.on.doc"
                    )
                    .modifier(TotpOutlineLabel())
                }
                .buttonStyle(.plain)

                ShareLink(item: shareText) {
                    Label(
                        env.preferences.t("分享", en: "Share", ja: "共有", pl: "Udostępnij"),
                        systemImage: "square.and.arrow.up"
                    )
                    .modifier(TotpOutlineLabel())
                }
                .buttonStyle(.plain)
            }

            Toggle(isOn: $saved) {
                Text(env.preferences.t(
                    "我已把恢复码保存在安全的地方",
                    en: "I've saved these recovery codes somewhere safe",
                    ja: "リカバリーコードを安全な場所に保存しました",
                    pl: "Zapisałem te kody odzyskiwania w bezpiecznym miejscu"
                ))
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(AppTheme.title)
            }
            .tint(TotpUI.primary)
        }
    }

    private var shareText: String {
        let header = env.preferences.t(
            "EdgeEver 二次验证恢复码（每个只能使用一次）",
            en: "EdgeEver two-factor recovery codes (each works once)",
            ja: "EdgeEver 二段階認証リカバリーコード（各コード 1 回のみ）",
            pl: "Kody odzyskiwania EdgeEver (każdy działa jednokrotnie)"
        )
        return header + "\n\n" + joined
    }
}

private struct TotpOutlineLabel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(AppTheme.title)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 40)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }
}

// MARK: - Identity check

/// Password plus (when TOTP is already on) a 6-digit code or a recovery code.
struct TotpIdentityInput: Equatable {
    var password = ""
    var code = ""
    var recoveryCode = ""
    var useRecoveryCode = false

    func isComplete(requiresSecondFactor: Bool) -> Bool {
        guard !password.isEmpty else { return false }
        guard requiresSecondFactor else { return true }
        return useRecoveryCode
            ? !TotpFormat.normalizeRecoveryCode(recoveryCode).isEmpty
            : code.count == 6
    }

    func reauth(requiresSecondFactor: Bool) -> TotpReauthInput {
        guard requiresSecondFactor else { return TotpReauthInput(password: password) }
        return useRecoveryCode
            ? TotpReauthInput(password: password, recoveryCode: TotpFormat.normalizeRecoveryCode(recoveryCode))
            : TotpReauthInput(password: password, code: code)
    }
}

struct TotpIdentityFields: View {
    @Environment(AppEnvironment.self) private var env
    @Binding var input: TotpIdentityInput
    let requiresSecondFactor: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TotpPasswordField(
                label: env.preferences.t("当前密码", en: "Current password", ja: "現在のパスワード", pl: "Bieżące hasło"),
                text: $input.password
            )
            if requiresSecondFactor {
                if input.useRecoveryCode {
                    VStack(alignment: .leading, spacing: 7) {
                        TotpFieldLabel(text: env.preferences.t("恢复码", en: "Recovery code", ja: "リカバリーコード", pl: "Kod odzyskiwania"))
                        TotpRecoveryCodeField(code: $input.recoveryCode)
                        Text(env.preferences.t(
                            "不区分大小写，短横线可省略。每个恢复码只能使用一次。",
                            en: "Not case-sensitive; dashes are optional. Each recovery code works only once.",
                            ja: "大文字と小文字は区別されず、ハイフンは省略できます。各リカバリーコードは 1 回だけ使えます。",
                            pl: "Wielkość liter nie ma znaczenia, myślniki są opcjonalne. Każdy kod odzyskiwania działa tylko raz."
                        ))
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    TotpLinkButton(title: env.preferences.t(
                        "改用验证器验证码",
                        en: "Use an authenticator code instead",
                        ja: "認証アプリのコードを使用",
                        pl: "Użyj kodu z aplikacji"
                    )) {
                        input.useRecoveryCode = false
                        input.recoveryCode = ""
                    }
                } else {
                    VStack(alignment: .leading, spacing: 7) {
                        TotpFieldLabel(text: env.preferences.t(
                            "验证器上的 6 位验证码",
                            en: "6-digit code from your authenticator",
                            ja: "認証アプリの 6 桁のコード",
                            pl: "6-cyfrowy kod z aplikacji uwierzytelniającej"
                        ))
                        TotpCodeField(code: $input.code, autoFocus: false)
                    }
                    TotpLinkButton(title: env.preferences.t(
                        "验证器不可用？改用恢复码",
                        en: "Authenticator unavailable? Use a recovery code",
                        ja: "認証アプリを使えない場合はリカバリーコードを使用",
                        pl: "Aplikacja niedostępna? Użyj kodu odzyskiwania"
                    )) {
                        input.useRecoveryCode = true
                        input.code = ""
                    }
                }
            }
        }
    }
}

// MARK: - Bind authenticator + save codes

/// Steps shared by "enable", "rebind" and the forced rebind screen:
/// bind authenticator (QR / key / open in app + verify code) → save recovery codes → confirm.
struct TotpBindAndSaveFlow: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.openURL) private var openURL

    let setup: TotpSetupResponse
    /// Progress labels; `bindIndex` is the position of the bind step (save is `bindIndex + 1`).
    let stepLabels: [String]
    let bindIndex: Int
    let finishTitle: String
    var finishNote: String?
    /// Called after `/setup/confirm`; may throw to show an inline error.
    let onConfirmed: (TotpConfirmResponse) async throws -> Void
    /// Called when the pending setup expired; parent should restart the flow.
    var onExpired: ((String) -> Void)?

    @State private var code = ""
    /// Codes and the batch id the server issued for them; confirm names that batch.
    @State private var recoveryCodes: TotpRecoveryCodesResponse?
    @State private var saved = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TotpStepProgress(labels: stepLabels, current: recoveryCodes == nil ? bindIndex : bindIndex + 1)
            if let recoveryCodes {
                saveStep(recoveryCodes.recoveryCodes)
            } else {
                bindStep
            }
        }
    }

    private var bindStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(env.preferences.t(
                "用身份验证器 App 扫描二维码。",
                en: "Scan the QR code with your authenticator app.",
                ja: "認証アプリで QR コードをスキャンしてください。",
                pl: "Zeskanuj kod QR aplikacją uwierzytelniającą."
            ))
            .font(.system(size: 13))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)

            HStack {
                Spacer(minLength: 0)
                TotpQRCodeView(uri: setup.otpauthUri)
                Spacer(minLength: 0)
            }

            if let url = URL(string: setup.otpauthUri) {
                TotpActionButton(
                    title: env.preferences.t(
                        "用本机验证器打开",
                        en: "Open in authenticator app",
                        ja: "認証アプリで開く",
                        pl: "Otwórz w aplikacji uwierzytelniającej"
                    ),
                    role: .secondary
                ) {
                    openURL(url) { accepted in
                        if !accepted {
                            error = env.preferences.t(
                                "本机没有可打开此链接的验证器 App，请手动输入上方密钥。",
                                en: "No authenticator app could open this link. Enter the setup key above manually.",
                                ja: "このリンクを開ける認証アプリが見つかりません。上のセットアップキーを手動で入力してください。",
                                pl: "Żadna aplikacja uwierzytelniająca nie może otworzyć tego linku. Wpisz powyższy klucz ręcznie."
                            )
                        }
                    }
                }
            }

            TotpSecretKeyView(secret: setup.secret, issuer: setup.issuer, accountName: setup.accountName)

            VStack(alignment: .leading, spacing: 7) {
                TotpFieldLabel(text: env.preferences.t(
                    "验证器上的 6 位验证码",
                    en: "6-digit code from your authenticator",
                    ja: "認証アプリの 6 桁のコード",
                    pl: "6-cyfrowy kod z aplikacji uwierzytelniającej"
                ))
                TotpCodeField(code: $code, autoFocus: false)
            }

            Text(env.preferences.t(
                "验证成功后，下一步会生成恢复码。完成全部步骤前，二次验证不会生效。",
                en: "After verification, the next step creates recovery codes. Two-factor authentication isn't on until every step is done.",
                ja: "確認できると、次のステップでリカバリーコードが作成されます。すべてのステップが完了するまで二要素認証は有効になりません。",
                pl: "Po weryfikacji w następnym kroku zostaną utworzone kody odzyskiwania. Uwierzytelnianie dwuskładnikowe zacznie działać dopiero po ukończeniu wszystkich kroków."
            ))
            .font(.system(size: 12))
            .foregroundStyle(AppTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)

            TotpErrorText(message: error)

            TotpActionButton(
                title: env.preferences.t("验证并继续", en: "Verify and continue", ja: "確認して続行", pl: "Zweryfikuj i kontynuuj"),
                busy: busy,
                enabled: code.count == 6
            ) {
                Task { await verify() }
            }
        }
    }

    private func saveStep(_ codes: [String]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            TotpRecoveryCodesView(codes: codes, saved: $saved)
            if let finishNote {
                Text(finishNote)
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TotpErrorText(message: error)
            TotpActionButton(title: finishTitle, busy: busy, enabled: saved) {
                Task { await confirm() }
            }
        }
    }

    private func verify() async {
        guard code.count == 6, !busy else { return }
        error = nil
        busy = true
        defer { busy = false }
        do {
            let response = try await env.session.client.verifyTotpSetup(setupId: setup.setupId, code: code)
            withAnimation(Motion.chip) { recoveryCodes = response }
        } catch {
            handle(error)
            code = ""
        }
    }

    private func confirm() async {
        guard saved, !busy, let batchId = recoveryCodes?.batchId else { return }
        error = nil
        busy = true
        defer { busy = false }
        do {
            let response = try await env.session.client.confirmTotpSetup(batchId: batchId)
            try await onConfirmed(response)
        } catch {
            handle(error)
        }
    }

    private func handle(_ error: Error) {
        let message = TotpUI.errorMessage(error, prefs: env.preferences)
        if (error as? APIError)?.code == "totp_setup_expired", let onExpired {
            onExpired(message)
            return
        }
        withAnimation(Motion.chip) { self.error = message }
    }
}
