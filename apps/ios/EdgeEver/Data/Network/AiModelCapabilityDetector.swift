import Foundation

/// Reads a model's limits from the provider's own metadata, falling back to models.dev (#652).
/// Same flow as `packages/client/src/ai-model-capabilities-direct.ts`. Read-only GET requests;
/// they never generate text.
enum AiModelCapabilityDetector {
    struct Target: Sendable {
        var provider: String
        var baseUrl: String
        var apiKey: String
        var modelId: String
    }

    private struct Unavailable: Error {}

    /// - Returns the limits found, or `.noLimits` when the provider answered without any (and models.dev
    ///   has no match), so the instance does not ask again for a while.
    /// - Returns `nil` when the metadata could not be read (network, authentication, rate-limit or
    ///   server errors); nothing should be reported then.
    /// - Throws only `CancellationError` when the task is cancelled.
    static func detect(_ target: Target, session: URLSession, catalog: ModelsDevCatalog?) async throws -> AiModelCapabilityLimits? {
        let fromService = try await detectFromService(target, session: session)
        guard let fromService, fromService.source == "none", let catalog else { return fromService }
        guard let index = await catalog.index() else { return fromService }
        try Task.checkCancellation()
        return index.match(provider: target.provider, baseUrl: target.baseUrl, modelId: target.modelId) ?? fromService
    }

    static func headers(for target: Target) -> [String: String] {
        var headers = ["Accept": "application/json"]
        switch target.provider {
        case "anthropic":
            headers["x-api-key"] = target.apiKey
            headers["anthropic-version"] = "2023-06-01"
        case "google":
            headers["x-goog-api-key"] = target.apiKey
        default:
            headers["Authorization"] = "Bearer \(target.apiKey)"
        }
        return headers
    }

    /// `encodeURIComponent` for one path segment.
    static func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static func detectFromService(_ target: Target, session: URLSession) async throws -> AiModelCapabilityLimits? {
        var base = target.baseUrl.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        let headers = headers(for: target)

        func read(_ url: String, endpoint: String, missingIsEmpty: Bool) async throws -> AiModelCapabilityLimits? {
            guard let requestURL = URL(string: url) else { throw Unavailable() }
            var request = URLRequest(url: requestURL)
            request.httpMethod = "GET"
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw Unavailable() }
            // Gateways answer unsupported metadata paths with 404 or, often, 400. Any client error
            // other than authentication or rate limiting means "this endpoint has no metadata".
            let status = http.statusCode
            let unsupported = (400 ..< 500).contains(status) && status != 401 && status != 403 && status != 429
            if unsupported && missingIsEmpty { return nil }
            guard (200 ..< 300).contains(status) else { throw Unavailable() }
            let body = try? JSONSerialization.jsonObject(with: data)
            return AiModelCapabilityParser.parse(provider: target.provider, modelId: target.modelId, endpoint: endpoint, body: body)
        }

        do {
            if target.provider == "anthropic" {
                return try await read("\(base)/models/\(pathSegment(target.modelId))", endpoint: "model", missingIsEmpty: true) ?? AiModelCapabilityLimits.noLimits
            }
            if target.provider == "google" {
                let modelId = target.modelId.hasPrefix("models/") ? String(target.modelId.dropFirst("models/".count)) : target.modelId
                return try await read("\(base)/models/\(pathSegment(modelId))", endpoint: "model", missingIsEmpty: true) ?? AiModelCapabilityLimits.noLimits
            }
            // OpenRouter and DeepSeek put limits on the model list; LiteLLM serves them on /model/info.
            // The list itself must answer: it is the same endpoint model discovery uses.
            if let limits = try await read("\(base)/models", endpoint: "models", missingIsEmpty: false) { return limits }
            let liteLlm: AiModelCapabilityLimits?
            do {
                liteLlm = try await read("\(base)/model/info", endpoint: "litellm-model-info", missingIsEmpty: true)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                liteLlm = nil
            }
            return liteLlm ?? AiModelCapabilityLimits.noLimits
        } catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled {
                throw CancellationError()
            }
            return nil
        }
    }
}

/// In-memory cache of the models.dev catalogue (#652).
/// - The instance stores each model's limits for every client, so the catalogue is only needed when
///   a model's limits are missing or stale; it is kept in memory, not on disk.
/// - A fresh copy is reused for a day, then revalidated with its ETag (an unchanged catalogue costs a 304).
/// - Concurrent lookups share one download. A failure is remembered briefly, so a blocked or slow
///   network does not delay every generation in a row.
actor ModelsDevCatalog {
    static let shared = ModelsDevCatalog()

    static let freshInterval: TimeInterval = 24 * 60 * 60
    static let failureBackoff: TimeInterval = 10 * 60
    static let timeout: TimeInterval = 5

    private let session: URLSession
    private let now: @Sendable () -> Date
    private var cached: (index: ModelsDevIndex, etag: String?, checkedAt: Date)?
    private var failedAt: Date?
    private var pending: Task<ModelsDevIndex?, Never>?

    init(session: URLSession = .shared, now: @escaping @Sendable () -> Date = { Date() }) {
        self.session = session
        self.now = now
    }

    /// The lookup, or `nil` when the catalogue cannot be read now. Never throws. The shared download
    /// is never cancelled by one caller; it ends within `timeout`.
    func index() async -> ModelsDevIndex? {
        let time = now()
        if let cached, time.timeIntervalSince(cached.checkedAt) < Self.freshInterval { return cached.index }
        if let failedAt, time.timeIntervalSince(failedAt) < Self.failureBackoff { return cached?.index }
        let task: Task<ModelsDevIndex?, Never>
        if let pending {
            task = pending
        } else {
            let etag = cached?.etag
            let session = self.session
            task = Task { await self.finish(Self.download(session: session, etag: etag)) }
            pending = task
        }
        return await task.value
    }

    private enum DownloadResult: Sendable {
        case fresh(ModelsDevIndex, etag: String?)
        case notModified
        case failed
    }

    private func finish(_ result: DownloadResult) -> ModelsDevIndex? {
        pending = nil
        switch result {
        case let .fresh(index, etag):
            cached = (index, etag, now())
            failedAt = nil
            return index
        case .notModified:
            if let current = cached {
                cached = (current.index, current.etag, now())
                return current.index
            }
            failedAt = now()
            return nil
        case .failed:
            failedAt = now()
            // A stale copy is still better than nothing.
            return cached?.index
        }
    }

    private static func download(session: URLSession, etag: String?) async -> DownloadResult {
        var request = URLRequest(url: ModelsDevIndex.catalogURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failed }
            if http.statusCode == 304, etag != nil { return .notModified }
            guard (200 ..< 300).contains(http.statusCode),
                  let index = ModelsDevIndex(body: try? JSONSerialization.jsonObject(with: data)) else { return .failed }
            return .fresh(index, etag: http.value(forHTTPHeaderField: "ETag"))
        } catch {
            return .failed
        }
    }
}
