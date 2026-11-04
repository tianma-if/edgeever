import Foundation

/// `error.details` of a 401 `mfa_required` login response.
struct MfaChallenge: Codable, Equatable, Sendable {
    var challengeToken: String
    var expiresAt: String
    var methods: [String]
}

struct LoginMfaInput: Encodable, Sendable {
    var challengeToken: String
    var code: String?
    var recoveryCode: String?
    var deviceId: String
}

struct TotpStatus: Codable, Equatable, Sendable {
    var enabled: Bool
    var enabledAt: String?
    var recoveryCodesRemaining: Int
    /// False when the deployment cannot encrypt secrets or runs as the demo.
    var available: Bool
    /// `"encryption_unavailable"`, `"demo"` or `nil`.
    var unavailableReason: String?
    /// The current session came from a recovery code and must rebind.
    var rebindRequired: Bool
}

struct TotpSetupResponse: Codable, Equatable, Sendable {
    /// Identifies this setup; `setup/verify` sends it back so a setup replaced by a newer one is refused.
    var setupId: String
    var secret: String
    var otpauthUri: String
    var issuer: String
    var accountName: String
    var expiresAt: String
}

struct TotpRecoveryCodesResponse: Codable, Equatable, Sendable {
    /// Identifies this batch; the confirm step sends it back so only the codes the user saw are activated.
    var batchId: String
    var recoveryCodes: [String]
}

struct TotpConfirmResponse: Codable, Equatable, Sendable {
    var ok: Bool
    /// Rotated session token after a restricted session finishes rebinding.
    var sessionToken: String?
}

/// Re-authentication body for TOTP management endpoints.
/// Fields left `nil` are omitted from the JSON body.
struct TotpReauthInput: Encodable, Equatable, Sendable {
    var password: String?
    var code: String?
    var recoveryCode: String?

    init(password: String? = nil, code: String? = nil, recoveryCode: String? = nil) {
        self.password = password
        self.code = code
        self.recoveryCode = recoveryCode
    }
}

enum TotpFormat {
    /// Keep only digits, capped at 6 (authenticator codes).
    static func sanitizeCode(_ raw: String) -> String {
        String(raw.filter(\.isASCIIDigit).prefix(6))
    }

    /// Group a base32 secret into 4-character blocks for manual entry.
    static func groupedSecret(_ secret: String) -> String {
        let clean = secret.replacingOccurrences(of: " ", with: "").uppercased()
        var groups: [String] = []
        var index = clean.startIndex
        while index < clean.endIndex {
            let end = clean.index(index, offsetBy: 4, limitedBy: clean.endIndex) ?? clean.endIndex
            groups.append(String(clean[index ..< end]))
            index = end
        }
        return groups.joined(separator: " ")
    }

    /// Trim user-entered recovery codes; the server ignores case and dashes.
    static func normalizeRecoveryCode(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0" ... "9").contains(self) }
}
