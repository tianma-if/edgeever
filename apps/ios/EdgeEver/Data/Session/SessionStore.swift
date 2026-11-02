import Foundation
import Observation

/// Password step succeeded but the account requires a second factor.
struct PendingMfaLogin: Equatable, Sendable {
    var baseURL: URL
    var username: String
    /// Must be identical to the deviceId sent with the password step.
    var deviceId: String
    var challenge: MfaChallenge
}

enum SignInOutcome: Equatable, Sendable {
    case signedIn
    case mfaRequired(PendingMfaLogin)
}

@Observable
@MainActor
final class SessionStore {
    private(set) var isLoading = true
    private(set) var session: MobileSession?
    private(set) var lastError: String?

    let client: APIClient
    private let keychainSessionKey = KeychainStore.Key.session

    init(client: APIClient = APIClient(baseURL: URL(string: "https://localhost")!)) {
        self.client = client
    }

    var isSignedIn: Bool { session != nil }

    /// Restricted recovery-code session: only the forced rebind screen may be shown.
    var isMfaRebindRequired: Bool { session?.mfaRebindRequired == true }

    var dataScope: String? {
        guard let session else { return nil }
        guard let url = try? EdgeEverURLNormalizer.normalizeInstanceURL(session.baseUrl) else { return nil }
        return SyncProtocol.createDataScope(baseURL: url, userId: session.user?.id)
    }

    func bootstrap() async {
        defer { isLoading = false }
        do {
            guard let raw = try KeychainStore.string(forKey: keychainSessionKey),
                  let data = raw.data(using: .utf8)
            else { return }
            let stored = try EdgeEverJSON.decoder.decode(MobileSession.self, from: data)
            let baseURL = try EdgeEverURLNormalizer.normalizeInstanceURL(stored.baseUrl)
            await client.update(baseURL: baseURL, token: stored.token)
            await installClientHandlers()
            session = stored
        } catch {
            lastError = error.localizedDescription
            clearLocalSession()
        }
    }

    @discardableResult
    func signIn(baseUrl: String, username: String, password: String) async throws -> SignInOutcome {
        lastError = nil
        let url = try EdgeEverURLNormalizer.normalizeInstanceURL(baseUrl)
        if url.scheme?.lowercased() == "http" {
            // Allowed with local networking; UI should already warn.
        }
        let deviceId = try DeviceId.getOrCreate()
        await client.update(baseURL: url, token: nil)
        let auth: AuthSession
        do {
            auth = try await client.login(LoginInput(username: username, password: password, deviceId: deviceId))
        } catch let error as APIError {
            if error.code == "mfa_required", let challenge = error.mfaChallenge {
                return .mfaRequired(PendingMfaLogin(
                    baseURL: url,
                    username: username,
                    deviceId: deviceId,
                    challenge: challenge
                ))
            }
            throw error
        }
        try await finishSignIn(url: url, auth: auth)
        return .signedIn
    }

    /// Second login step. Exactly one of `code` / `recoveryCode` must be set.
    func completeMfaSignIn(_ pending: PendingMfaLogin, code: String?, recoveryCode: String?) async throws {
        lastError = nil
        await client.update(baseURL: pending.baseURL, token: nil)
        let auth = try await client.completeMfaLogin(LoginMfaInput(
            challengeToken: pending.challenge.challengeToken,
            code: code,
            recoveryCode: recoveryCode,
            deviceId: pending.deviceId
        ))
        try await finishSignIn(url: pending.baseURL, auth: auth)
    }

    /// Mark the current session as restricted (403 `mfa_rebind_required` or session payload).
    func markMfaRebindRequired() {
        guard var current = session, current.mfaRebindRequired != true else { return }
        current.mfaRebindRequired = true
        try? persist(current)
        session = current
    }

    /// After `/totp/setup/confirm`: adopt the rotated token (restricted sessions get a
    /// new normal session) and re-read the session so the app can be entered.
    func completeMfaRebind(newSessionToken: String?) async throws {
        guard var current = session else { return }
        let url = try EdgeEverURLNormalizer.normalizeInstanceURL(current.baseUrl)
        let rotated = newSessionToken.map { !$0.isEmpty } ?? false
        if rotated, let newSessionToken {
            // The server only rotates into a normal (unrestricted) session.
            current.token = newSessionToken
            current.mfaRebindRequired = nil
            await client.update(baseURL: url, token: newSessionToken)
        }
        do {
            let refreshed = try await client.getSession()
            current.user = refreshed.user ?? current.user
            current.mfaRebindRequired = refreshed.mfaRebindRequired == true ? true : nil
        } catch {
            // Without a rotated token we cannot know the session state; surface the error.
            // A 401 already cleared the local session; never resurrect it.
            if !rotated || (error as? APIError)?.isUnauthorized == true { throw error }
        }
        try persist(current)
        session = current
    }

    private func finishSignIn(url: URL, auth: AuthSession) async throws {
        guard auth.authenticated, let token = auth.sessionToken else {
            throw APIError(
                status: 400,
                code: nil,
                message: "登录成功但服务端没有返回移动端会话。请确认服务端已更新到支持 App 登录的版本。"
            )
        }
        let next = MobileSession(
            baseUrl: url.absoluteString,
            token: token,
            user: auth.user,
            mfaRebindRequired: auth.mfaRebindRequired == true ? true : nil
        )
        try persist(next)
        await client.update(baseURL: url, token: token)
        await installClientHandlers()
        session = next
    }

    private func installClientHandlers() async {
        await client.setOnUnauthorized { [weak self] in
            Task { @MainActor in self?.clearLocalSession() }
        }
        await client.setOnMfaRebindRequired { [weak self] in
            Task { @MainActor in self?.markMfaRebindRequired() }
        }
    }

    func signOut() async {
        if session != nil {
            try? await client.logout()
        }
        clearLocalSession()
    }

    private func persist(_ session: MobileSession) throws {
        let data = try EdgeEverJSON.encoder.encode(session)
        guard let raw = String(data: data, encoding: .utf8) else { return }
        try KeychainStore.setString(raw, forKey: keychainSessionKey)
    }

    func clearLocalSession() {
        try? KeychainStore.delete(forKey: keychainSessionKey)
        session = nil
        Task { await client.update(baseURL: URL(string: "https://localhost")!, token: nil) }
    }
}
