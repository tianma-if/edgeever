import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// Shared building blocks for TOTP two-factor authentication (login step,
/// settings flows and the forced rebind screen).
enum TotpUI {
    /// Mobile primary color for the TOTP flows (#10b981).
    static let primary = AppTheme.accentBright
    static let warningBackground = AppTheme.syncErrorBackground
    static let warningBorder = AppTheme.syncErrorBorder
    static let warningTitle = AppTheme.syncErrorTitle
    static let warningBody = AppTheme.syncErrorBody

    /// Map TOTP / MFA API errors to localized, user-facing messages.
    @MainActor
    static func errorMessage(_ error: Error, prefs: PreferencesStore) -> String {
        guard let api = error as? APIError else { return error.localizedDescription }
        switch api.code {
        case "invalid_totp_code":
            return prefs.t(
                "验证码不正确，请重新输入。",
                en: "That code is incorrect. Try again.",
                ja: "確認コードが正しくありません。もう一度入力してください。",
                pl: "Nieprawidłowy kod. Spróbuj ponownie."
            )
        case "invalid_recovery_code":
            return prefs.t(
                "恢复码不正确或已被使用。",
                en: "That recovery code is invalid or has already been used.",
                ja: "リカバリーコードが正しくないか、すでに使用されています。",
                pl: "Kod odzyskiwania jest nieprawidłowy lub został już użyty."
            )
        case "mfa_challenge_expired":
            return prefs.t(
                "验证已过期，请重新输入密码。",
                en: "Verification expired. Enter your password again.",
                ja: "確認の有効期限が切れました。パスワードを再入力してください。",
                pl: "Weryfikacja wygasła. Wprowadź hasło ponownie."
            )
        case "totp_unavailable":
            return prefs.t(
                "服务器暂时无法校验验证器，请改用恢复码登录。",
                en: "The server cannot verify authenticator codes right now. Sign in with a recovery code instead.",
                ja: "サーバーが現在認証アプリのコードを確認できません。リカバリーコードでログインしてください。",
                pl: "Serwer nie może teraz zweryfikować kodów uwierzytelniacza. Zaloguj się kodem odzyskiwania."
            )
        case "invalid_current_password":
            return prefs.t(
                "当前密码不正确。",
                en: "Current password is incorrect.",
                ja: "現在のパスワードが正しくありません。",
                pl: "Bieżące hasło jest nieprawidłowe."
            )
        case "totp_setup_expired":
            return prefs.t(
                "绑定已过期，请重新开始。",
                en: "Setup expired. Please start again.",
                ja: "設定の有効期限が切れました。最初からやり直してください。",
                pl: "Konfiguracja wygasła. Zacznij od nowa."
            )
        case "recovery_codes_expired":
            return prefs.t(
                "新恢复码已过期，请重新生成。",
                en: "The new recovery codes expired. Generate them again.",
                ja: "新しいリカバリーコードの有効期限が切れました。再生成してください。",
                pl: "Nowe kody odzyskiwania wygasły. Wygeneruj je ponownie."
            )
        case "totp_encryption_unavailable":
            return unavailableMessage(reason: "encryption_unavailable", prefs: prefs)
        default:
            break
        }
        if api.status == 429 {
            let base = prefs.t(
                "尝试次数过多，请稍后再试。",
                en: "Too many attempts. Please try again later.",
                ja: "試行回数が多すぎます。しばらくしてから再試行してください。",
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
        return api.message
    }

    @MainActor
    static func unavailableMessage(reason: String?, prefs: PreferencesStore) -> String {
        if reason == "demo" {
            return prefs.t(
                "演示实例不支持开启二次验证。",
                en: "Two-factor authentication is not available on the demo instance.",
                ja: "デモインスタンスでは二段階認証を利用できません。",
                pl: "Uwierzytelnianie dwuskładnikowe nie jest dostępne w instancji demonstracyjnej."
            )
        }
        return prefs.t(
            "服务器未配置加密密钥，暂时无法开启二次验证。请联系实例管理员。",
            en: "The server has no encryption key configured, so two-factor authentication cannot be enabled. Contact the instance owner.",
            ja: "サーバーに暗号化キーが設定されていないため、二段階認証を有効にできません。インスタンス管理者に連絡してください。",
            pl: "Serwer nie ma skonfigurowanego klucza szyfrowania, więc nie można włączyć uwierzytelniania dwuskładnikowego. Skontaktuj się z właścicielem instancji."
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

struct TotpActionButton: View {
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
                    .font(.system(size: 15, weight: .heavy))
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
            .opacity(isEnabled ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }

    private var isEnabled: Bool { enabled && !busy }

    private var foreground: Color {
        switch role {
        case .primary, .danger: return .white
        case .secondary: return AppTheme.title
        }
    }

    private var background: Color {
        switch role {
        case .primary: return isEnabled ? TotpUI.primary : AppTheme.disabledFill
        case .secondary: return AppTheme.card
        case .danger: return isEnabled ? AppTheme.dangerAction : AppTheme.disabledFill
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
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            TotpFieldLabel(text: env.preferences.t(
                "无法扫码？手动输入密钥",
                en: "Can't scan? Enter this key manually",
                ja: "スキャンできない場合は、このキーを手動で入力",
                pl: "Nie możesz zeskanować? Wpisz ten klucz ręcznie"
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
                    "恢复码只显示这一次。每个恢复码只能使用一次，验证器不可用时可用于登录。",
                    en: "These codes are shown only once. Each code works once and lets you sign in if your authenticator is unavailable.",
                    ja: "リカバリーコードは今回だけ表示されます。各コードは 1 回のみ使用でき、認証アプリが使えないときのログインに使えます。",
                    pl: "Te kody są wyświetlane tylko raz. Każdy kod działa jednokrotnie i pozwala zalogować się, gdy uwierzytelniacz jest niedostępny."
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
                        env.preferences.t("分享或保存", en: "Share or save", ja: "共有または保存", pl: "Udostępnij lub zapisz"),
                        systemImage: "square.and.arrow.up"
                    )
                    .modifier(TotpOutlineLabel())
                }
                .buttonStyle(.plain)
            }

            Toggle(isOn: $saved) {
                Text(env.preferences.t(
                    "我已把恢复码保存在安全的地方",
                    en: "I saved these codes somewhere safe",
                    ja: "リカバリーコードを安全な場所に保存しました",
                    pl: "Zapisałem te kody w bezpiecznym miejscu"
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
                    }
                    TotpLinkButton(title: env.preferences.t(
                        "改用验证器验证码",
                        en: "Use an authenticator code instead",
                        ja: "認証アプリのコードを使う",
                        pl: "Użyj kodu z uwierzytelniacza"
                    )) {
                        input.useRecoveryCode = false
                        input.recoveryCode = ""
                    }
                } else {
                    VStack(alignment: .leading, spacing: 7) {
                        TotpFieldLabel(text: env.preferences.t(
                            "验证器中的 6 位验证码",
                            en: "6-digit code from your authenticator",
                            ja: "認証アプリの 6 桁のコード",
                            pl: "6-cyfrowy kod z uwierzytelniacza"
                        ))
                        TotpCodeField(code: $input.code, autoFocus: false)
                    }
                    TotpLinkButton(title: env.preferences.t(
                        "验证器不可用？改用恢复码",
                        en: "Authenticator unavailable? Use a recovery code instead",
                        ja: "認証アプリが使えない場合はリカバリーコードを使う",
                        pl: "Uwierzytelniacz niedostępny? Użyj kodu odzyskiwania"
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
    @State private var recoveryCodes: [String]?
    @State private var saved = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TotpStepProgress(labels: stepLabels, current: recoveryCodes == nil ? bindIndex : bindIndex + 1)
            if let recoveryCodes {
                saveStep(recoveryCodes)
            } else {
                bindStep
            }
        }
    }

    private var bindStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(env.preferences.t(
                "用验证器 App（如 Google Authenticator、1Password、iOS 密码）扫描二维码，或手动输入密钥。",
                en: "Scan the QR code with an authenticator app (such as Google Authenticator, 1Password or iOS Passwords), or enter the key manually.",
                ja: "認証アプリ（Google Authenticator、1Password、iOS パスワードなど）で QR コードをスキャンするか、キーを手動で入力してください。",
                pl: "Zeskanuj kod QR aplikacją uwierzytelniającą (np. Google Authenticator, 1Password lub Hasła w iOS) albo wpisz klucz ręcznie."
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
                        ja: "このデバイスの認証アプリで開く",
                        pl: "Otwórz w aplikacji uwierzytelniającej"
                    ),
                    role: .secondary
                ) {
                    openURL(url) { accepted in
                        if !accepted {
                            error = env.preferences.t(
                                "本机没有可以打开该链接的验证器 App，请扫码或手动输入密钥。",
                                en: "No authenticator app on this device can open the link. Scan the QR code or enter the key manually.",
                                ja: "このリンクを開ける認証アプリがありません。QR コードをスキャンするか、キーを手動で入力してください。",
                                pl: "Na tym urządzeniu nie ma aplikacji, która otworzy ten link. Zeskanuj kod QR lub wpisz klucz ręcznie."
                            )
                        }
                    }
                }
            }

            TotpSecretKeyView(secret: setup.secret)

            VStack(alignment: .leading, spacing: 7) {
                TotpFieldLabel(text: env.preferences.t(
                    "输入验证器显示的 6 位验证码",
                    en: "Enter the 6-digit code shown in the app",
                    ja: "認証アプリに表示された 6 桁のコードを入力",
                    pl: "Wpisz 6-cyfrowy kod z aplikacji"
                ))
                TotpCodeField(code: $code, autoFocus: false)
            }

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
            let response = try await env.session.client.verifyTotpSetup(code: code)
            withAnimation(Motion.chip) { recoveryCodes = response.recoveryCodes }
        } catch {
            handle(error)
            code = ""
        }
    }

    private func confirm() async {
        guard saved, !busy else { return }
        error = nil
        busy = true
        defer { busy = false }
        do {
            let response = try await env.session.client.confirmTotpSetup()
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
