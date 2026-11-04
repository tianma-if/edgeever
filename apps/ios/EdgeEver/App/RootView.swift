import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Group {
            if env.session.isLoading {
                ProgressView(env.preferences.t("启动中…", en: "Starting…", ja: "起動しています…", pl: "Uruchamianie…"))
            } else if env.session.isSignedIn {
                if env.session.isMfaRebindRequired {
                    ForcedTotpRebindView()
                } else {
                    WorkspaceView()
                }
            } else {
                LoginView()
            }
        }
        .task {
            await env.bootstrap()
            await AutoLogin.attemptIfConfigured(env: env)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            Task {
                if env.session.isSignedIn {
                    await env.runSyncCycle()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            Task {
                if let scope = env.session.dataScope {
                    _ = try? await env.outboxFlusher.flush(scope: scope)
                }
            }
        }
    }
}
