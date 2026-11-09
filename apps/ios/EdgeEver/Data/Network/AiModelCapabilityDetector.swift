import Foundation

/// Requests to a model service carry its API key, so they never follow a redirect (as
/// `redirect: "error"` in the shared client): the 3xx answer itself comes back and is handled as a
/// failed request, and the redirect target receives nothing (#652).
final class AiProviderRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let reject = AiProviderRedirects()

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

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

    /// The whole detection (provider metadata plus models.dev) must finish within this time;
    /// otherwise generation goes on with the first prepare, as if the limits were unknown.
    static let defaultTimeout: TimeInterval = 8

    private enum Outcome: Sendable {
        case finished(AiModelCapabilityLimits?)
        case timedOut
    }

    /// - Returns the limits found, or `.noLimits` when the provider answered without any (and models.dev
    ///   has no match), so the instance does not ask again for a while.
    /// - Returns `nil` when the metadata could not be read (network, authentication, rate-limit or
    ///   server errors, a redirect, or no answer within `timeout`); nothing should be reported then.
    /// - Throws only `CancellationError` when the task is cancelled.
    static func detect(
        _ target: Target,
        session: URLSession,
        catalog: ModelsDevCatalog?,
        timeout: TimeInterval = defaultTimeout
    ) async throws -> AiModelCapabilityLimits? {
        try await withThrowingTaskGroup(of: Outcome.self) { group in
            group.addTask { .finished(try await detectWithoutTimeLimit(target, session: session, catalog: catalog, timeout: timeout)) }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(max(timeout, 0) * 1_000_000_000))
                return .timedOut
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else { return nil }
            // A Stop that lands together with the timeout is still a Stop.
            try Task.checkCancellation()
            switch first {
            case let .finished(limits): return limits
            case .timedOut: return nil
            }
        }
    }

    private static func detectWithoutTimeLimit(
        _ target: Target,
        session: URLSession,
        catalog: ModelsDevCatalog?,
        timeout: TimeInterval
    ) async throws -> AiModelCapabilityLimits? {
        let fromService = try await detectFromService(target, session: session, timeout: timeout)
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

    private static func detectFromService(_ target: Target, session: URLSession, timeout: TimeInterval) async throws -> AiModelCapabilityLimits? {
        var base = target.baseUrl.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        let headers = headers(for: target)

        func read(_ url: String, endpoint: String, missingIsEmpty: Bool) async throws -> AiModelCapabilityLimits? {
            guard let requestURL = URL(string: url) else { throw Unavailable() }
            var request = URLRequest(url: requestURL, timeoutInterval: max(timeout, 1))
            request.httpMethod = "GET"
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
            let (data, response) = try await session.data(for: request, delegate: AiProviderRedirects.reject)
            guard let http = response as? HTTPURLResponse else { throw Unavailable() }
            // Gateways answer unsupported metadata paths with 404 or, often, 400. Any client error
            // other than authentication or rate limiting means "this endpoint has no metadata".
            // Authentication, rate limiting, server errors and redirects mean "unknown" (thrown).
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
            // Only an unsupported path means "no limits"; a temporary failure here stays "unknown", so a
            // limit saved earlier is kept and detection is tried again next time.
            return try await read("\(base)/model/info", endpoint: "litellm-model-info", missingIsEmpty: true) ?? AiModelCapabilityLimits.noLimits
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

    /// The lookup, or `nil` when the catalogue cannot be read now. Never throws. A cancelled caller
    /// (a detection that timed out, or a user who stopped) stops waiting at once and gets `nil`; the
    /// shared download carries on for others and ends within `timeout`.
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
        let first = ResumeOnce<ModelsDevIndex?>()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                first.attach(continuation)
                Task { first.resume(await task.value) }
            }
        } onCancel: {
            first.resume(nil)
        }
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

/// Resumes a continuation once, with whichever value arrives first (#652).
private final class ResumeOnce<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Never>?
    private var resolved = false
    private var value: Value?

    func attach(_ continuation: CheckedContinuation<Value, Never>) {
        lock.lock()
        if resolved, let value {
            lock.unlock()
            continuation.resume(returning: value)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    func resume(_ result: Value) {
        lock.lock()
        guard !resolved else { lock.unlock(); return }
        resolved = true
        let waiting = continuation
        continuation = nil
        if waiting == nil { value = result }
        lock.unlock()
        waiting?.resume(returning: result)
    }
}
