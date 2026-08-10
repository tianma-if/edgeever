import SwiftUI

struct ApiTokensView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var tokens: [ApiToken] = []
    @State private var scopes: [String] = []
    @State private var newName = ""
    @State private var createdToken: String?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(AppTheme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(spacing: 0) {
                ForEach(Array(tokens.enumerated()), id: \.element.id) { index, token in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(token.name).font(.system(size: 14, weight: .bold))
                            Text(token.scopes.joined(separator: ", "))
                                .font(.system(size: 12))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            Task {
                                try? await env.session.client.revokeApiToken(id: token.id)
                                await load()
                            }
                        } label: {
                            Text(env.preferences.t("吊销", en: "Revoke"))
                                .font(.system(size: 13, weight: .bold))
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
                Text(env.preferences.t("新建", en: "Create"))
                    .font(.system(size: 14, weight: .heavy))
                TextField(env.preferences.t("名称", en: "Name"), text: $newName)
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background(AppTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(AppTheme.border, lineWidth: 1))
                Button {
                    Task { await create() }
                } label: {
                    Text(env.preferences.t("创建 Token", en: "Create token"))
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(AppTheme.title)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                if let createdToken {
                    Text(createdToken)
                        .font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let res = try await env.session.client.listApiTokens()
            tokens = res.apiTokens
            scopes = res.availableScopes
        } catch { self.error = error.localizedDescription }
    }

    private func create() async {
        guard !newName.isEmpty else { return }
        do {
            let created = try await env.session.client.createApiToken(
                name: newName,
                scopes: scopes.isEmpty ? ["memos:read", "memos:write"] : scopes
            )
            createdToken = created.token
            newName = ""
            await load()
        } catch { self.error = error.localizedDescription }
    }
}
