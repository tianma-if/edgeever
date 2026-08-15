import SwiftUI
import Pow

struct LoginView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var baseUrl = ""
    @State private var username = "admin"
    @State private var password = ""
    @State private var error: String?
    @State private var submitting = false
    @State private var showHTTPWarning = false
    @State private var pendingHTTPLogin = false
    @State private var loginShake = 0

    private var canSubmit: Bool {
        !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !password.isEmpty
            && !submitting
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            // Android login uses mint background #ecfdf5
            AppTheme.accentSoft
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
            .accessibilityLabel(env.preferences.t("GitHub 仓库", en: "GitHub repository"))
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
                                .fill(AppTheme.accent)
                                .frame(width: 48, height: 48)
                            Image(systemName: "lock.fill")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("EdgeEver")
                                .font(.system(size: 22, weight: .heavy))
                                .foregroundStyle(AppTheme.title)
                            Text(env.preferences.t("连接你的自托管笔记空间", en: "Connect your self-hosted notes"))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(AppTheme.secondary)
                        }
                    }
                    .padding(.bottom, 28)

                    field(
                        env.preferences.t("实例地址", en: "Instance URL"),
                        placeholder: EdgeEverPublicDemo.instanceURLString,
                        text: $baseUrl,
                        keyboard: .URL,
                        secure: false
                    )
                    .padding(.bottom, 14)

                    field(
                        env.preferences.t("用户名", en: "Username"),
                        placeholder: "owner",
                        text: $username,
                        keyboard: .default,
                        secure: false
                    )
                    .padding(.bottom, 14)

                    field(
                        env.preferences.t("密码", en: "Password"),
                        placeholder: env.preferences.t("首次登录密码", en: "Initial password"),
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
                                ? env.preferences.t("登录中…", en: "Signing in…")
                                : env.preferences.t("登录", en: "Sign in"))
                                .font(.system(size: 16, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .foregroundStyle(.white)
                        .background(canSubmit ? AppTheme.title : AppTheme.disabledFill)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(CreateButtonPressStyle())
                    .disabled(!canSubmit)
                    .changeEffect(.shake, value: loginShake)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)
            }
        }
        .alert(env.preferences.t("使用 HTTP 连接？", en: "Use HTTP?"), isPresented: $showHTTPWarning) {
            Button(env.preferences.t("继续", en: "Continue"), role: .destructive) {
                pendingHTTPLogin = true
                Task { await submit(forceHTTP: true) }
            }
            Button(env.preferences.t("取消", en: "Cancel"), role: .cancel) {}
        } message: {
            Text(env.preferences.t(
                "HTTP 不会加密传输凭证，仅建议用于可信局域网自托管实例。",
                en: "HTTP does not encrypt credentials. Only use on trusted LAN instances."
            ))
        }
        .preferredColorScheme(env.preferences.colorScheme)
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
            try await env.session.signIn(baseUrl: trimmed, username: username, password: password)
            await env.runSyncCycle()
        } catch {
            withAnimation(Motion.chip) {
                self.error = error.localizedDescription
            }
            loginShake += 1
        }
    }
}
