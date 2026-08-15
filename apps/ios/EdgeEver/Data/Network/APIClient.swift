import Foundation

actor APIClient {
    private(set) var baseURL: URL
    private(set) var token: String?
    private var onUnauthorized: (@Sendable () -> Void)?

    private let session: URLSession

    init(
        baseURL: URL,
        token: String? = nil,
        session: URLSession = .shared,
        onUnauthorized: (@Sendable () -> Void)? = nil
    ) {
        self.baseURL = baseURL.edgeEverNormalizedBase
        self.token = token
        self.session = session
        self.onUnauthorized = onUnauthorized
    }

    func update(baseURL: URL, token: String?, onUnauthorized: (@Sendable () -> Void)? = nil) {
        self.baseURL = baseURL.edgeEverNormalizedBase
        self.token = token
        if let onUnauthorized {
            self.onUnauthorized = onUnauthorized
        }
    }

    func setOnUnauthorized(_ handler: (@Sendable () -> Void)?) {
        onUnauthorized = handler
    }

    // MARK: - Auth

    func login(_ input: LoginInput) async throws -> AuthSession {
        try await request(path: "/api/v1/auth/login", method: "POST", body: input)
    }

    func logout() async throws {
        let _: OkResponse = try await request(path: "/api/v1/auth/logout", method: "POST", body: EmptyBody())
    }

    func getSession() async throws -> AuthSession {
        try await request(path: "/api/v1/auth/session")
    }

    func changePassword(current: String, newPassword: String, confirm: String) async throws {
        struct Body: Encodable {
            var currentPassword: String
            var newPassword: String
            var confirmPassword: String
        }
        let _: OkResponse = try await request(
            path: "/api/v1/auth/change-password",
            method: "POST",
            body: Body(currentPassword: current, newPassword: newPassword, confirmPassword: confirm)
        )
    }

    func listLoginDeviceSessions() async throws -> [LoginDeviceSession] {
        let response: SessionsResponse = try await request(path: "/api/v1/auth/sessions")
        return response.sessions
    }

    func revokeLoginDeviceSession(id: String) async throws {
        let _: OkResponse = try await request(path: "/api/v1/auth/sessions/\(id)", method: "DELETE")
    }

    func revokeOtherLoginDeviceSessions() async throws {
        let _: OkResponse = try await request(path: "/api/v1/auth/sessions", method: "DELETE")
    }

    // MARK: - Sync

    func getMobileSyncBootstrapPage(afterId: String?, limit: Int = 200) async throws -> MobileSyncBootstrapPage {
        var items: [URLQueryItem] = [.init(name: "limit", value: String(limit))]
        if let afterId { items.append(.init(name: "afterId", value: afterId)) }
        return try await request(path: "/api/v1/sync/bootstrap", query: items)
    }

    func getMobileSyncChanges(cursor: Int, limit: Int = 200) async throws -> MobileSyncChangesPage {
        try await request(
            path: "/api/v1/sync/changes",
            query: [
                .init(name: "cursor", value: String(cursor)),
                .init(name: "limit", value: String(limit)),
            ]
        )
    }

    // MARK: - Memos

    func createMemo(
        notebookId: String,
        title: String?,
        contentMarkdown: String?,
        tags: [String]?,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) async throws -> MemoDetail {
        struct Body: Encodable {
            var notebookId: String
            var title: String?
            var contentMarkdown: String?
            var tags: [String]?
            var createdAt: String?
            var updatedAt: String?
        }
        let response: MemoResponse = try await request(
            path: "/api/v1/memos",
            method: "POST",
            body: Body(
                notebookId: notebookId,
                title: title,
                contentMarkdown: contentMarkdown,
                tags: tags,
                createdAt: createdAt,
                updatedAt: updatedAt
            )
        )
        return response.memo
    }

    func updateMemo(
        id: String,
        expectedRevision: Int?,
        expectedContentHash: String?,
        editSessionId: String?,
        notebookId: String?,
        title: String?,
        isPinned: Bool?,
        contentMarkdown: String?,
        contentJson: JSONValue? = nil,
        tags: [String]?
    ) async throws -> MemoDetail {
        struct Body: Encodable {
            var expectedRevision: Int?
            var expectedContentHash: String?
            var editSessionId: String?
            var notebookId: String?
            var title: String?
            var isPinned: Bool?
            var contentMarkdown: String?
            var contentJson: JSONValue?
            var tags: [String]?
        }
        let response: MemoResponse = try await request(
            path: "/api/v1/memos/\(id)",
            method: "PATCH",
            body: Body(
                expectedRevision: expectedRevision,
                expectedContentHash: expectedContentHash,
                editSessionId: editSessionId,
                notebookId: notebookId,
                title: title,
                isPinned: isPinned,
                contentMarkdown: contentMarkdown,
                contentJson: contentJson,
                tags: tags
            )
        )
        return response.memo
    }

    func getMemo(id: String, includeDeleted: Bool = false) async throws -> MemoDetail {
        var query: [URLQueryItem] = []
        if includeDeleted { query.append(.init(name: "includeDeleted", value: "1")) }
        let response: MemoResponse = try await request(path: "/api/v1/memos/\(id)", query: query)
        return response.memo
    }

    func deleteMemo(id: String, permanent: Bool = false) async throws {
        var query: [URLQueryItem] = []
        if permanent { query.append(.init(name: "permanent", value: "1")) }
        let _: OkResponse = try await request(path: "/api/v1/memos/\(id)", method: "DELETE", query: query)
    }

    func createMemoEditSession(memoId: String) async throws -> MemoEditSession {
        let response: EditSessionResponse = try await request(
            path: "/api/v1/memos/\(memoId)/edit-sessions",
            method: "POST",
            body: EmptyBody()
        )
        return response.editSession
    }

    // MARK: - AI note processing

    func listAiPrompts(locale: String) async throws -> [AiPromptTemplate] {
        let response: AiPromptsResponse = try await request(
            path: "/api/v1/ai/prompts",
            query: [.init(name: "locale", value: locale)]
        )
        return response.prompts
    }

    func streamAiGeneration(_ input: AiGenerateInput) -> AsyncThrowingStream<AiStreamEvent, Error> {
        var request = URLRequest(url: makeURL(path: "/api/v1/ai/generate"))
        request.httpMethod = "POST"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let encodedBody: Data
        do {
            encodedBody = try EdgeEverJSON.encoder.encode(input)
        } catch {
            return AsyncThrowingStream { continuation in continuation.finish(throwing: error) }
        }
        request.httpBody = encodedBody
        let streamRequest = request
        let session = self.session
        let unauthorized = onUnauthorized

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: streamRequest)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIError(status: -1, code: nil, message: "Invalid response")
                    }
                    if http.statusCode == 401 {
                        unauthorized?()
                    }
                    guard (200 ..< 300).contains(http.statusCode) else {
                        var data = Data()
                        for try await byte in bytes { data.append(byte) }
                        let message = Self.parseErrorMessage(data: data)
                            ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
                        throw APIError(
                            status: http.statusCode,
                            code: Self.parseErrorCode(data: data),
                            message: message
                        )
                    }
                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        guard line.hasPrefix("data: ") else { continue }
                        let payload = String(line.dropFirst(6))
                        guard let data = payload.data(using: .utf8) else { continue }
                        continuation.yield(try EdgeEverJSON.decoder.decode(AiStreamEvent.self, from: data))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Templates

    func listTemplates() async throws -> [MemoTemplate] {
        let response: TemplatesResponse = try await request(path: "/api/v1/templates")
        return response.templates
    }

    func useTemplate(templateId: String, notebookId: String) async throws -> MemoDetail {
        struct Body: Encodable {
            var notebookId: String
        }
        let response: MemoResponse = try await request(
            path: "/api/v1/templates/\(templateId)/use",
            method: "POST",
            body: Body(notebookId: notebookId)
        )
        return response.memo
    }

    // MARK: - Resources / tokens / tags

    func uploadMemoResource(memoId: String, filename: String, mimeType: String, data: Data) async throws -> Resource {
        let boundary = "EdgeEverBoundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: makeURL(path: "/api/v1/memos/\(memoId)/resources"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        return try await perform(request).resource
    }

    /// Fetch a resource path (usually `/api/v1/resources/:id/blob`) with session auth.
    func getResourceData(path: String) async throws -> (data: Data, mimeType: String) {
        var request = URLRequest(url: makeURL(path: path))
        request.httpMethod = "GET"
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: -1, code: nil, message: "Invalid response")
        }
        if http.statusCode == 401 {
            onUnauthorized?()
        }
        guard (200 ..< 300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, code: nil, message: HTTPURLResponse.localizedString(forStatusCode: http.statusCode))
        }
        let header = http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
        let mimeType = header.split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? "application/octet-stream"
        return (data, mimeType)
    }

    /// Fetch an absolute public URL and return bytes + mime (for file:// WebView display).
    func getPublicURLData(_ absoluteURL: URL) async throws -> (data: Data, mimeType: String) {
        var request = URLRequest(url: absoluteURL)
        request.httpMethod = "GET"
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: -1, code: nil, message: "Invalid response")
        }
        guard (200 ..< 300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, code: nil, message: HTTPURLResponse.localizedString(forStatusCode: http.statusCode))
        }
        let header = http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
        let mimeType = header.split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? "application/octet-stream"
        return (data, mimeType)
    }

    func renameResource(id: String, filename: String) async throws -> Resource {
        struct Body: Encodable { var filename: String }
        let response: ResourceResponse = try await request(
            path: "/api/v1/resources/\(id)",
            method: "PATCH",
            body: Body(filename: filename)
        )
        return response.resource
    }

    func deleteResource(id: String) async throws {
        let _: OkResponse = try await request(path: "/api/v1/resources/\(id)", method: "DELETE")
    }

    func listApiTokens() async throws -> ApiTokensResponse {
        try await request(path: "/api/v1/api-tokens")
    }

    func createApiToken(name: String, scopes: [String]) async throws -> CreatedApiToken {
        struct Body: Encodable {
            var name: String
            var scopes: [String]
        }
        return try await request(path: "/api/v1/api-tokens", method: "POST", body: Body(name: name, scopes: scopes))
    }

    func revokeApiToken(id: String) async throws {
        let _: OkResponse = try await request(path: "/api/v1/api-tokens/\(id)", method: "DELETE")
    }

    func listTags() async throws -> [TagSummary] {
        let response: TagsResponse = try await request(path: "/api/v1/tags")
        return response.tags
    }

    func renameTag(tag: String, name: String) async throws {
        struct Body: Encodable { var name: String }
        let encoded = tag.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? tag
        let _: OkResponse = try await request(
            path: "/api/v1/tags/\(encoded)",
            method: "PATCH",
            body: Body(name: name)
        )
    }

    func deleteTag(tag: String) async throws {
        let encoded = tag.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? tag
        let _: OkResponse = try await request(path: "/api/v1/tags/\(encoded)", method: "DELETE")
    }

    func listMemoRevisions(memoId: String) async throws -> [MemoRevision] {
        struct Response: Codable { var revisions: [MemoRevision] }
        let response: Response = try await request(path: "/api/v1/memos/\(memoId)/revisions")
        return response.revisions
    }

    func restoreMemoRevision(memoId: String, revisionId: String) async throws -> MemoDetail {
        let response: MemoResponse = try await request(
            path: "/api/v1/memos/\(memoId)/revisions/\(revisionId)/restore",
            method: "POST",
            body: EmptyBody()
        )
        return response.memo
    }

    func getMemoShare(memoId: String) async throws -> MemoShare? {
        struct Response: Codable { var share: MemoShare? }
        let response: Response = try await request(path: "/api/v1/memos/\(memoId)/share")
        return response.share
    }

    func createMemoShare(memoId: String) async throws -> MemoShare {
        struct Response: Codable { var share: MemoShare }
        let response: Response = try await request(
            path: "/api/v1/memos/\(memoId)/share",
            method: "POST",
            body: EmptyBody()
        )
        return response.share
    }

    func revokeMemoShare(memoId: String) async throws {
        let _: OkResponse = try await request(path: "/api/v1/memos/\(memoId)/share", method: "DELETE")
    }

    func listUsers() async throws -> [InstanceUser] {
        struct Response: Codable { var users: [InstanceUser] }
        let response: Response = try await request(path: "/api/v1/users")
        return response.users
    }

    func createUser(username: String, displayName: String?, password: String) async throws -> InstanceUser {
        struct Body: Encodable {
            var username: String
            var displayName: String?
            var password: String
        }
        struct Response: Codable { var user: InstanceUser }
        let response: Response = try await request(
            path: "/api/v1/users",
            method: "POST",
            body: Body(username: username, displayName: displayName, password: password)
        )
        return response.user
    }

    func updateUser(userId: String, displayName: String?, password: String?, isDisabled: Bool?) async throws -> InstanceUser {
        struct Body: Encodable {
            var displayName: String?
            var password: String?
            var isDisabled: Bool?
        }
        struct Response: Codable { var user: InstanceUser }
        let response: Response = try await request(
            path: "/api/v1/users/\(userId)",
            method: "PATCH",
            body: Body(displayName: displayName, password: password, isDisabled: isDisabled)
        )
        return response.user
    }

    func deleteMemos(memoIds: [String], permanent: Bool = false) async throws {
        struct Body: Encodable {
            var memoIds: [String]
            var permanent: Bool?
        }
        let _: OkResponse = try await request(
            path: "/api/v1/memos/batch/delete",
            method: "POST",
            body: Body(memoIds: memoIds, permanent: permanent ? true : nil)
        )
    }

    func moveMemos(memoIds: [String], notebookId: String) async throws {
        struct Body: Encodable {
            var memoIds: [String]
            var notebookId: String
        }
        let _: OkResponse = try await request(
            path: "/api/v1/memos/batch/move",
            method: "POST",
            body: Body(memoIds: memoIds, notebookId: notebookId)
        )
    }

    // MARK: - Core request

    private struct EmptyBody: Encodable {}

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: (any Encodable)? = nil
    ) async throws -> T {
        var request = URLRequest(url: makeURL(path: path, query: query))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try EdgeEverJSON.encoder.encode(AnyEncodable(body))
        }
        let data = try await performRaw(request)
        return try EdgeEverJSON.decoder.decode(T.self, from: data)
    }

    private func perform(_ request: URLRequest) async throws -> ResourceResponse {
        let data = try await performRaw(request)
        return try EdgeEverJSON.decoder.decode(ResourceResponse.self, from: data)
    }

    private func performRaw(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: -1, code: nil, message: "Invalid response")
        }
        if http.statusCode == 401 {
            onUnauthorized?()
        }
        guard (200 ..< 300).contains(http.statusCode) else {
            let message = Self.parseErrorMessage(data: data) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            let code = Self.parseErrorCode(data: data)
            throw APIError(status: http.statusCode, code: code, message: message)
        }
        return data
    }

    private func makeURL(path: String, query: [URLQueryItem] = []) -> URL {
        let base = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let suffix = path.hasPrefix("/") ? path : "/\(path)"
        guard var components = URLComponents(string: base + suffix) else {
            preconditionFailure("Invalid URL for path \(path)")
        }
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else {
            preconditionFailure("Invalid URL components for path \(path)")
        }
        return url
    }

    private static func parseErrorMessage(data: Data) -> String? {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = json["error"] as? [String: Any],
            let message = error["message"] as? String
        else { return nil }
        return message
    }

    private static func parseErrorCode(data: Data) -> String? {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = json["error"] as? [String: Any],
            let code = error["code"] as? String
        else { return nil }
        return code
    }
}

struct APIError: Error, LocalizedError, Equatable, Sendable {
    let status: Int
    let code: String?
    let message: String

    var errorDescription: String? { message }
    var isUnauthorized: Bool { status == 401 }
    var isRevisionConflict: Bool { code == "revision_conflict" || status == 409 }
    /// Server has no **memo** row for this id (update / edit-session).
    /// Tight match only — never treat notebook/resource/workspace "not found" as memo 404.
    var isMemoNotFound: Bool {
        let lower = message.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        // API: `notFound(c, "Memo not found")` → code not_found, message "Memo not found".
        let messageIsMemo = lower == "memo not found"
            || lower.hasPrefix("memo not found")
            || (lower.contains("memo") && lower.contains("not found")
                && !lower.contains("notebook")
                && !lower.contains("resource")
                && !lower.contains("revision")
                && !lower.contains("workspace"))
        if status == 404, code == "not_found" || code == nil {
            return messageIsMemo
        }
        return code == "not_found" && messageIsMemo
    }
}

private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init(_ value: any Encodable) { encodeFunc = value.encode }
    func encode(to encoder: Encoder) throws { try encodeFunc(encoder) }
}
