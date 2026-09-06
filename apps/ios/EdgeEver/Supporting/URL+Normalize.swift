import Foundation

extension URL {
    /// Strip trailing slashes for stable instance keys / API base URLs.
    var edgeEverNormalizedBase: URL {
        var absolute = absoluteString
        while absolute.hasSuffix("/") {
            absolute.removeLast()
        }
        return URL(string: absolute) ?? self
    }
}

enum EdgeEverPublicDemo {
    static let instanceURLString = "https://demo.edgeever.org"
}

enum EdgeEverURLNormalizer {
    static func normalizeInstanceURL(_ raw: String) throws -> URL {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            throw EdgeEverURLError.empty
        }
        if !trimmed.contains("://") {
            trimmed = "https://\(trimmed)"
        }
        guard var components = URLComponents(string: trimmed), let host = components.host, !host.isEmpty else {
            throw EdgeEverURLError.invalid
        }
        if host.lowercased() == "demo" {
            components.scheme = "https"
            components.host = "demo.edgeever.org"
        }
        components.fragment = nil
        components.query = nil
        guard let url = components.url else {
            throw EdgeEverURLError.invalid
        }
        return url.edgeEverNormalizedBase
    }
}

enum EdgeEverURLError: LocalizedError {
    case empty
    case invalid

    var errorDescription: String? {
        switch self {
        case .empty:
            return "Instance URL is required."
        case .invalid:
            return "Instance URL is invalid."
        }
    }
}
