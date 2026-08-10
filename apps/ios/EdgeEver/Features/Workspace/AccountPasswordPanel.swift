import SwiftUI

struct AccountPasswordPanel: View {
    @Environment(AppEnvironment.self) private var env
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var message: String?
    @State private var isError = false
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "key.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.accentStrong)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(env.preferences.t("修改密码", en: "Change password"))
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text(env.preferences.t(
                        "修改后会保留当前设备登录，并退出其他设备上的登录会话。",
                        en: "Keeps this device signed in and signs out other sessions."
                    ))
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }

            passwordField(env.preferences.t("当前密码", en: "Current password"), text: $currentPassword)
            passwordField(env.preferences.t("新密码", en: "New password"), text: $newPassword)
            passwordField(env.preferences.t("确认新密码", en: "Confirm password"), text: $confirmPassword)

            if let message {
                Text(message)
                    .font(.system(size: 13, weight: isError ? .regular : .bold))
                    .foregroundStyle(isError ? AppTheme.danger : AppTheme.accentStrong)
            }

            Button {
                Task { await submit() }
            } label: {
                Text(busy
                    ? env.preferences.t("正在修改…", en: "Updating…")
                    : env.preferences.t("修改密码", en: "Change password"))
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                    .background(AppTheme.accentAction)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .opacity(busy ? 0.45 : 1)
            }
            .buttonStyle(.plain)
            .disabled(busy)
        }
        .padding(16)
        .padding(.bottom, 8)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private func passwordField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(AppTheme.meta)
            SecureField("", text: text)
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

    private func submit() async {
        message = nil
        isError = false
        if newPassword.count < 8 {
            isError = true
            message = env.preferences.t("新密码至少需要 8 个字符", en: "Password must be at least 8 characters")
            return
        }
        if newPassword != confirmPassword {
            isError = true
            message = env.preferences.t("两次输入的新密码不一致", en: "Passwords do not match")
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await env.session.client.changePassword(
                current: currentPassword,
                newPassword: newPassword,
                confirm: confirmPassword
            )
            currentPassword = ""
            newPassword = ""
            confirmPassword = ""
            isError = false
            message = env.preferences.t("密码已修改成功。", en: "Password updated.")
        } catch {
            isError = true
            message = error.localizedDescription
        }
    }
}
