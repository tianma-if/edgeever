import SwiftUI

struct UsersManagementView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var users: [InstanceUser] = []
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(AppTheme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(spacing: 0) {
                ForEach(Array(users.enumerated()), id: \.element.id) { index, user in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName ?? user.username)
                                .font(.system(size: 14, weight: .bold))
                            Text("@\(user.username) · \(user.role)")
                                .font(.system(size: 12))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        Spacer()
                        if user.isDisabled {
                            Text(env.preferences.t("已禁用", en: "Disabled"))
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(AppTheme.danger)
                        }
                        if user.role != "owner" {
                            Button {
                                Task {
                                    _ = try? await env.session.client.updateUser(
                                        userId: user.id,
                                        displayName: nil,
                                        password: nil,
                                        isDisabled: !user.isDisabled
                                    )
                                    users = (try? await env.session.client.listUsers()) ?? []
                                }
                            } label: {
                                Text(user.isDisabled
                                    ? env.preferences.t("启用", en: "Enable")
                                    : env.preferences.t("禁用", en: "Disable"))
                                .font(.system(size: 13, weight: .bold))
                            }
                        }
                    }
                    .padding(16)
                    .overlay(alignment: .top) {
                        if index > 0 { Rectangle().fill(AppTheme.cardBorder).frame(height: 1) }
                    }
                }
            }
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))

            VStack(alignment: .leading, spacing: 10) {
                Text(env.preferences.t("创建成员", en: "Create member"))
                    .font(.system(size: 14, weight: .heavy))
                TextField(env.preferences.t("用户名", en: "Username"), text: $username)
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background(AppTheme.searchFill)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                SecureField(env.preferences.t("密码", en: "Password"), text: $password)
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background(AppTheme.searchFill)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Button {
                    Task {
                        do {
                            _ = try await env.session.client.createUser(
                                username: username, displayName: nil, password: password
                            )
                            username = ""
                            password = ""
                            users = try await env.session.client.listUsers()
                        } catch { self.error = error.localizedDescription }
                    }
                } label: {
                    Text(env.preferences.t("创建", en: "Create"))
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(AppTheme.title)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))
        }
        .task { users = (try? await env.session.client.listUsers()) ?? [] }
    }
}
