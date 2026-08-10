import XCTest
@testable import EdgeEver

/// Integration tests against a running local EdgeEver instance (`bun run dev`).
/// Skips cleanly when the local server is offline — never fakes the response.
final class LiveLocalAPITests: XCTestCase {
    private let baseURL = URL(string: "http://127.0.0.1:8787")!

    private var localPassword: String? {
        if let env = ProcessInfo.processInfo.environment["EDGE_EVER_AUTH_PASSWORD"], !env.isEmpty {
            return env
        }
        // Discover from monorepo local env files (repo root relative to test host cwd varies).
        let candidates = [
            ".env.wrangler.generated.local",
            ".env.local",
            "../../.env.wrangler.generated.local",
            "../../../.env.wrangler.generated.local",
            "/Users/tianma/Developer/Projects/edgeever/.env.wrangler.generated.local",
        ]
        for path in candidates {
            guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n") {
                if line.hasPrefix("EDGE_EVER_AUTH_PASSWORD=") {
                    return String(line.dropFirst("EDGE_EVER_AUTH_PASSWORD=".count))
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                }
            }
        }
        return nil
    }

    private func requireLocalServer() async throws {
        var request = URLRequest(url: baseURL.appending(path: "/api/health"))
        request.timeoutInterval = 3
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw XCTSkip("Local EdgeEver not running at \(baseURL)")
            }
        } catch is XCTSkip {
            throw XCTSkip("Local EdgeEver not running at \(baseURL)")
        } catch {
            throw XCTSkip("Local EdgeEver not running at \(baseURL)")
        }
    }

    func testLoginBootstrapListAndCreateMemoThroughShippedClient() async throws {
        try await requireLocalServer()
        guard let password = localPassword, !password.isEmpty else {
            throw XCTSkip("No EDGE_EVER_AUTH_PASSWORD available for live login")
        }

        let client = APIClient(baseURL: baseURL)
        let session = try await client.login(
            LoginInput(username: "admin", password: password, deviceId: "mobile-ios-live-test-01")
        )
        XCTAssertTrue(session.authenticated, "login must authenticate against real server")
        XCTAssertNotNil(session.sessionToken)
        XCTAssertEqual(session.user?.username, "admin")

        await client.update(baseURL: baseURL, token: session.sessionToken)

        let db = try AppDatabase.makeEmpty()
        let mirror = LocalMirrorRepository(dbQueue: db)
        let outbox = SyncOutboxRepository(dbQueue: db)
        let scope = SyncProtocol.createDataScope(baseURL: baseURL, userId: session.user?.id)
        let engine = SyncEngine(mirror: mirror, client: client)
        let flusher = OutboxFlusher(outbox: outbox, mirror: mirror, client: client)

        let cursor = try await engine.sync(scope: scope)
        XCTAssertGreaterThanOrEqual(cursor, 0)

        let notebooks = try mirror.listNotebooks(scope: scope)
        XCTAssertFalse(notebooks.isEmpty, "bootstrap should leave at least one notebook in the mirror")

        let notebookId = notebooks[0].id
        let localId = "local:\(UUID().uuidString.lowercased())"
        let now = EdgeEverDate.nowString()
        let title = "iOS live test \(Int(Date().timeIntervalSince1970))"
        let markdown = "Created by LiveLocalAPITests at \(now)"
        try mirror.upsertMemo(
            scope: scope,
            memo: .localPlaceholder(
                id: localId,
                notebookId: notebookId,
                title: title,
                contentMarkdown: markdown,
                tags: ["ios-live"],
                createdAt: now
            )
        )
        try outbox.enqueueCreate(
            scope: scope,
            payload: MemoCreatePayload(
                memoId: localId,
                title: title,
                contentMarkdown: markdown,
                notebookId: notebookId,
                tags: ["ios-live"],
                createdAt: now
            )
        )
        let result = try await flusher.flush(scope: scope)
        XCTAssertEqual(result.synced, 1, "outbox flush must create memo on server: \(result)")
        XCTAssertEqual(result.failed, 0)
        XCTAssertEqual(result.conflicted, 0)

        let resolved = try mirror.resolveMemo(scope: scope, id: localId)
        XCTAssertNotNil(resolved)
        XCTAssertFalse(resolved!.id.hasPrefix("local:"), "local id must remap to server id")
        XCTAssertEqual(resolved!.title, title)

        // Verify server has the note via shipped getMemo
        let remote = try await client.getMemo(id: resolved!.id)
        XCTAssertEqual(remote.id, resolved!.id)
        XCTAssertTrue(remote.contentMarkdown.contains("LiveLocalAPITests") || remote.contentText.contains("LiveLocalAPITests") || remote.contentMarkdown == markdown)
    }
}
