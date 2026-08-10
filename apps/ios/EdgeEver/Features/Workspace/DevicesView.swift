import SwiftUI

struct DevicesView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var sessions: [LoginDeviceSession] = []

    var body: some View {
        VStack(spacing: 12) {
            VStack(spacing: 0) {
                ForEach(Array(sessions.enumerated()), id: \.element.id) { index, s in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.label ?? s.userAgent ?? s.id)
                                .font(.system(size: 14, weight: .bold))
                                .lineLimit(2)
                            Text("\(s.isCurrent ? env.preferences.t("当前 · ", en: "Current · ") : "")\(s.lastSeenAt)")
                                .font(.system(size: 11))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        Spacer()
                    }
                    .padding(16)
                    .overlay(alignment: .top) {
                        if index > 0 { Rectangle().fill(AppTheme.cardBorder).frame(height: 1) }
                    }
                    .swipeActions {
                        if !s.isCurrent {
                            Button(role: .destructive) {
                                Task {
                                    try? await env.session.client.revokeLoginDeviceSession(id: s.id)
                                    sessions = (try? await env.session.client.listLoginDeviceSessions()) ?? []
                                }
                            } label: {
                                Text(env.preferences.t("注销", en: "Revoke"))
                            }
                        }
                    }
                }
            }
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))

            Button {
                Task {
                    try? await env.session.client.revokeOtherLoginDeviceSessions()
                    sessions = (try? await env.session.client.listLoginDeviceSessions()) ?? []
                }
            } label: {
                Text(env.preferences.t("注销其他设备", en: "Sign out other devices"))
                    .font(.system(size: 14, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .foregroundStyle(AppTheme.title)
                    .background(AppTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .task { sessions = (try? await env.session.client.listLoginDeviceSessions()) ?? [] }
    }
}
