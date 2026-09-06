import Foundation

/// Native counterpart of the shared TypeScript sync-state contract in `packages/shared/src/sync.ts`.
enum SyncProtocol {
    static func hasCursorRewound(localCursor: Int, serverCursor: Int?) -> Bool {
        guard let serverCursor else { return false }
        return serverCursor < localCursor
    }

    static func hasIdentityChanged(localIdentity: String, serverIdentity: String?) -> Bool {
        guard let serverIdentity, !serverIdentity.isEmpty else { return false }
        return serverIdentity != localIdentity
    }

    static func isMetadataInitialized(cursorValue: String?, identityValue: String?) -> Bool {
        guard
            let identity = identityValue?.trimmingCharacters(in: .whitespacesAndNewlines),
            !identity.isEmpty,
            let cursorValue,
            !cursorValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            let _ = Int(cursorValue.trimmingCharacters(in: .whitespacesAndNewlines))
        else {
            return false
        }
        return true
    }

    static func splitBootstrapWriteBatches<T>(_ items: [T], batchSize: Int) -> [[T]] {
        let size = max(1, batchSize)
        if items.isEmpty { return [[]] }
        return stride(from: 0, to: items.count, by: size).map {
            Array(items[$0 ..< min($0 + size, items.count)])
        }
    }

    static func createDataScope(baseURL: URL, userId: String?) -> String {
        let base = baseURL.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return "\(base)|\(userId ?? "anonymous")"
    }

    static let bootstrapPageSize = 200
    static let bootstrapWriteBatchSize = 50
    static let changePageSize = 200
}
