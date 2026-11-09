import XCTest
@testable import EdgeEver

/// Model limit detection (#652). The parsing and matching cases are shared with the TypeScript
/// client (`packages/shared/test-fixtures`), so both clients read limits the same way.
final class AiModelCapabilitiesTests: XCTestCase {
    override func tearDown() {
        CapabilityStub.reset()
        super.tearDown()
    }

    // MARK: - Shared cases

    private static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // EdgeEverTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // apps
        .deletingLastPathComponent() // repository root
        .appendingPathComponent("packages/shared/test-fixtures")

    private func fixture(_ path: String) throws -> Any {
        let url = Self.fixtures.appendingPathComponent(path)
        let data = try XCTUnwrap(try? Data(contentsOf: url), "Shared fixture not readable: \(url.path)")
        return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    private func limits(_ value: Any?) -> AiModelCapabilityLimits? {
        guard let record = value as? [String: Any] else { return nil }
        return AiModelCapabilityLimits(
            maxOutputTokens: record["maxOutputTokens"] as? Int,
            maxInputTokens: record["maxInputTokens"] as? Int,
            contextWindowTokens: record["contextWindowTokens"] as? Int,
            source: record["source"] as? String ?? "models-dev"
        )
    }

    func testSharedProviderMetadataCases() throws {
        let cases = try XCTUnwrap(try fixture("model-capabilities/parse-cases.json") as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for item in cases {
            let result = AiModelCapabilityParser.parse(
                provider: item["provider"] as! String,
                modelId: item["modelId"] as! String,
                endpoint: item["endpoint"] as! String,
                body: item["body"]
            )
            XCTAssertEqual(result, limits(item["expected"]), item["name"] as! String)
        }
    }

    func testSharedProviderErrorCases() throws {
        let cases = try XCTUnwrap(try fixture("model-capabilities/error-cases.json") as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for item in cases {
            XCTAssertEqual(AiModelCapabilityParser.outputLimit(fromError: item["message"] as! String), item["expected"] as? Int, item["name"] as! String)
        }
    }

    func testSharedModelsDevMatchCases() throws {
        let index = try XCTUnwrap(ModelsDevIndex(body: try fixture("models-dev/catalog.json")))
        let cases = try XCTUnwrap(try fixture("models-dev/match-cases.json") as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for item in cases {
            let result = index.match(provider: item["provider"] as! String, baseUrl: item["baseUrl"] as! String, modelId: item["modelId"] as! String)
            XCTAssertEqual(result, limits(item["expected"]), item["name"] as! String)
        }
    }

    func testModelsDevRejectsBodiesThatAreNotCatalogues() {
        XCTAssertNil(ModelsDevIndex(body: nil))
        XCTAssertNil(ModelsDevIndex(body: [1, 2]))
        XCTAssertNil(ModelsDevIndex(body: ["broken": ["models": ["m": ["limit": ["context": 0, "output": 0]]]]]))
    }

    // MARK: - Wire formats

    func testPrepareDecodesTheCapabilityTarget() throws {
        let json = #"{"provider":"openai-compatible","baseUrl":"https://g.example/v1","apiKey":"k","modelId":"m","system":"s","prompt":"p","maxOutputTokens":null,"resultBoundary":{"start":"<r>","end":"</r>"},"capabilityTarget":{"providerConfigId":"aip_1","modelConfigId":"aim_1","configVersion":"v1"},"detectCapabilities":true}"#
        let prepared = try EdgeEverJSON.decoder.decode(AiPreparedGeneration.self, from: Data(json.utf8))
        XCTAssertEqual(prepared.capabilityTarget, AiModelCapabilityTarget(providerConfigId: "aip_1", modelConfigId: "aim_1", configVersion: "v1"))
        XCTAssertEqual(prepared.detectCapabilities, true)
        // An older server sends neither.
        let old = try EdgeEverJSON.decoder.decode(AiPreparedGeneration.self, from: Data(#"{"provider":"openai-compatible","baseUrl":"b","apiKey":"k","modelId":"m","system":"s","prompt":"p","resultBoundary":{"start":"<r>","end":"</r>"}}"#.utf8))
        XCTAssertNil(old.capabilityTarget)
        XCTAssertNil(old.detectCapabilities)
    }

    func testLimitsEncodeNullsExplicitly() throws {
        let data = try EdgeEverJSON.encoder.encode(AiModelCapabilityLimits(maxOutputTokens: 64000, maxInputTokens: nil, contextWindowTokens: nil, source: "provider-error"))
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["maxOutputTokens"] as? Int, 64000)
        XCTAssertTrue(object["maxInputTokens"] is NSNull)
        XCTAssertTrue(object["contextWindowTokens"] is NSNull)
        XCTAssertEqual(object["source"] as? String, "provider-error")
    }

    // MARK: - Detection

    private static let catalogJSON = #"{"openai":{"api":null,"models":{"gpt-5":{"limit":{"context":400000,"input":272000,"output":128000},"canonical_model_id":"openai/gpt-5"}}}}"#

    private func target(_ provider: String = "openai-compatible", baseUrl: String = "https://newapi.example/v1", modelId: String = "gpt-5") -> AiModelCapabilityDetector.Target {
        .init(provider: provider, baseUrl: baseUrl, apiKey: "k", modelId: modelId)
    }

    func testServiceWithoutLimitsFallsBackToModelsDev() async throws {
        CapabilityStub.respond { request in
            switch request.url?.path {
            case "/v1/models": return (200, #"{"data":[{"id":"gpt-5","owned_by":"openai"}]}"#, [:])
            case "/api.json": return (200, Self.catalogJSON, ["ETag": "\"v1\""])
            default: return (404, "{}", [:])
            }
        }
        let session = CapabilityStub.session()
        let result = try await AiModelCapabilityDetector.detect(target(), session: session, catalog: ModelsDevCatalog(session: session))
        XCTAssertEqual(result, AiModelCapabilityLimits(maxOutputTokens: 128000, maxInputTokens: 272000, contextWindowTokens: nil, source: "models-dev"))
        XCTAssertEqual(CapabilityStub.paths(), ["/v1/models", "/v1/model/info", "/api.json"])
        XCTAssertEqual(CapabilityStub.requests().first?.value(forHTTPHeaderField: "Authorization"), "Bearer k")
    }

    func testServiceLimitsWinAndTheCatalogueIsNotRead() async throws {
        CapabilityStub.respond { _ in (200, #"{"data":[{"id":"gpt-5","context_length":200000,"top_provider":{"max_completion_tokens":32000}}]}"#, [:]) }
        let session = CapabilityStub.session()
        let result = try await AiModelCapabilityDetector.detect(target(), session: session, catalog: ModelsDevCatalog(session: session))
        XCTAssertEqual(result?.source, "openrouter-models")
        XCTAssertEqual(result?.maxOutputTokens, 32000)
        XCTAssertEqual(CapabilityStub.paths(), ["/v1/models"])
    }

    func testUnreadableServiceIsUnknownAndNotReplaced() async throws {
        CapabilityStub.respond { _ in (401, #"{"error":"bad key"}"#, [:]) }
        let session = CapabilityStub.session()
        let result = try await AiModelCapabilityDetector.detect(target(), session: session, catalog: ModelsDevCatalog(session: session))
        XCTAssertNil(result)
        XCTAssertFalse(CapabilityStub.paths().contains("/api.json"))
    }

    func testUnsupportedMetadataPathMeansNoLimitsAndAnUnknownPrefixIsNotMatched() async throws {
        CapabilityStub.respond { request in
            request.url?.path == "/api.json" ? (200, Self.catalogJSON, [:]) : (400, #"{"error":"unsupported path"}"#, [:])
        }
        let session = CapabilityStub.session()
        let catalog = ModelsDevCatalog(session: session)
        // Anthropic type through a gateway: the single-model path answers 400, so "no limits".
        let anthropic = try await AiModelCapabilityDetector.detect(target("anthropic", modelId: "claude-unknown"), session: session, catalog: catalog)
        XCTAssertEqual(anthropic, .noLimits)
        XCTAssertEqual(CapabilityStub.requests().first?.value(forHTTPHeaderField: "x-api-key"), "k")
        XCTAssertEqual(CapabilityStub.requests().first?.url?.path, "/v1/models/claude-unknown")
        // my-team/gpt-5 must not take OpenAI gpt-5's limits (#809 review).
        CapabilityStub.respond { request in
            switch request.url?.path {
            case "/v1/models": return (200, #"{"data":[{"id":"my-team/gpt-5"}]}"#, [:])
            case "/api.json": return (200, Self.catalogJSON, [:])
            default: return (404, "{}", [:])
            }
        }
        let prefixed = try await AiModelCapabilityDetector.detect(target(modelId: "my-team/gpt-5"), session: session, catalog: catalog)
        XCTAssertEqual(prefixed, .noLimits)
    }

    func testGeminiStripsTheModelsPrefixAndUsesItsKeyHeader() async throws {
        CapabilityStub.respond { _ in (200, #"{"name":"models/gemini-x","inputTokenLimit":1048576,"outputTokenLimit":65536}"#, [:]) }
        let result = try await AiModelCapabilityDetector.detect(target("google", baseUrl: "https://gemini.example/v1beta/", modelId: "models/gemini-x"), session: CapabilityStub.session(), catalog: nil)
        XCTAssertEqual(result, AiModelCapabilityLimits(maxOutputTokens: 65536, maxInputTokens: 1048576, contextWindowTokens: nil, source: "gemini-models"))
        XCTAssertEqual(CapabilityStub.requests().first?.url?.absoluteString, "https://gemini.example/v1beta/models/gemini-x")
        XCTAssertEqual(CapabilityStub.requests().first?.value(forHTTPHeaderField: "x-goog-api-key"), "k")
    }

    // MARK: - Review fixes (#826)

    /// Requests carry the model key, so a redirect must not be followed and its target must get nothing.
    func testRedirectsAreNotFollowedAndTheTargetReceivesNothing() async throws {
        CapabilityStub.respond { request in
            request.url?.host == "gateway.example"
                ? (302, "", ["Location": "https://elsewhere.example/v1/models/claude-x"])
                : (200, #"{"id":"claude-x","max_tokens":64000,"max_input_tokens":200000}"#, [:])
        }
        let result = try await AiModelCapabilityDetector.detect(
            target("anthropic", baseUrl: "https://gateway.example/v1", modelId: "claude-x"),
            session: CapabilityStub.session(),
            catalog: nil
        )
        XCTAssertNil(result, "a redirect is unreadable metadata, not limits")
        XCTAssertEqual(CapabilityStub.requests().compactMap { $0.url?.host }, ["gateway.example"], "the redirect target must not be requested")
    }

    /// Generation and tag suggestion requests carry the model key too.
    func testGenerationAndTagRequestsDoNotFollowRedirects() async throws {
        CapabilityStub.respond { request in
            switch (request.url?.host, request.url?.path) {
            case ("notes.example", "/api/v1/ai/tag-suggestions/prepare"):
                return (200, #"{"provider":"openai-compatible","baseUrl":"https://g.example/v1","apiKey":"k","modelId":"m","system":"s","prompt":"p","maxOutputTokens":300,"currentTags":[],"canonicalTags":{}}"#, [:])
            case ("g.example", _):
                return (307, "", ["Location": "https://elsewhere.example/v1/chat/completions"])
            default:
                return (200, "data: [DONE]\n\n", ["Content-Type": "text/event-stream"])
            }
        }
        let prepared = AiPreparedGeneration(provider: "openai-compatible", baseUrl: "https://g.example/v1", apiKey: "k", modelId: "m", system: "s", prompt: "p", maxOutputTokens: 4096, resultBoundary: .init(start: "<r>", end: "</r>"))
        do {
            try await APIClient.streamDirectProvider(prepared, session: CapabilityStub.session(), emit: { _ in })
            XCTFail("a redirected generation must fail")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 307)
            XCTAssertTrue(error.message.contains("Base URL"), "the message should say how to fix it")
        }
        let client = APIClient(baseURL: URL(string: "https://notes.example")!, token: "t", session: CapabilityStub.session(), modelCatalog: nil)
        do {
            _ = try await client.suggestAiTags(AiTagSuggestionsInput(title: "Note", contentMarkdown: "Body", currentTags: [], locale: "en"))
            XCTFail("a redirected tag suggestion request must fail")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 307)
        }
        XCTAssertFalse(CapabilityStub.requests().contains { $0.url?.host == "elsewhere.example" }, "the redirect target must not be requested")
    }

    func testDetectionHasAnOverallTimeLimit() async throws {
        CapabilityStub.respond { _ in (0, "", [:]) }
        let started = Date()
        let result = try await AiModelCapabilityDetector.detect(target(), session: CapabilityStub.session(), catalog: nil, timeout: 0.5)
        XCTAssertNil(result, "no answer in time means unknown")
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    /// The time limit also covers the wait for models.dev, which is shared and not cancelled itself.
    func testTimeLimitAlsoCoversTheCatalogueDownload() async throws {
        CapabilityStub.respond { request in
            switch request.url?.path {
            case "/v1/models": return (200, #"{"data":[{"id":"gpt-5"}]}"#, [:])
            case "/v1/model/info": return (404, "{}", [:])
            default: return (0, "", [:]) // the catalogue never answers
            }
        }
        let session = CapabilityStub.session()
        let started = Date()
        let result = try await AiModelCapabilityDetector.detect(target(), session: session, catalog: ModelsDevCatalog(session: session), timeout: 0.5)
        XCTAssertNil(result)
        XCTAssertTrue(CapabilityStub.paths().contains("/api.json"), "the catalogue was being read when the time ran out")
        XCTAssertLessThan(Date().timeIntervalSince(started), 3, "the caller must not wait for the shared download")
    }

    /// Stop is a cancellation, never "continue without limits".
    func testStoppingDuringDetectionThrowsCancellation() async throws {
        for hangCatalogue in [false, true] {
            CapabilityStub.reset()
            CapabilityStub.respond { request in
                switch request.url?.path {
                case "/v1/models": return hangCatalogue ? (200, #"{"data":[{"id":"gpt-5"}]}"#, [:]) : (0, "", [:])
                case "/v1/model/info": return (404, "{}", [:])
                default: return (0, "", [:])
                }
            }
            let session = CapabilityStub.session()
            let catalog = ModelsDevCatalog(session: session)
            let target = target()
            let started = Date()
            let task = Task { try await AiModelCapabilityDetector.detect(target, session: session, catalog: catalog, timeout: 30) }
            try await Task.sleep(nanoseconds: 300_000_000)
            task.cancel()
            do {
                _ = try await task.value
                XCTFail("stopping must throw (catalogue hung: \(hangCatalogue))")
            } catch is CancellationError {
            } catch {
                XCTFail("expected CancellationError, got \(error)")
            }
            XCTAssertLessThan(Date().timeIntervalSince(started), 3, "stopping must not wait for a hung request (catalogue hung: \(hangCatalogue))")
        }
    }

    func testTemporaryLiteLlmFailuresAreUnknownNotNoLimits() async throws {
        for status in [401, 403, 429, 500, 503] {
            CapabilityStub.reset()
            CapabilityStub.respond { request in
                switch request.url?.path {
                case "/v1/models": return (200, #"{"data":[{"id":"gpt-5"}]}"#, [:])
                case "/v1/model/info": return (status, "{}", [:])
                default: return (200, Self.catalogJSON, [:])
                }
            }
            let session = CapabilityStub.session()
            let result = try await AiModelCapabilityDetector.detect(target(), session: session, catalog: ModelsDevCatalog(session: session))
            XCTAssertNil(result, "/model/info \(status) must not become 'no limits'")
            XCTAssertFalse(CapabilityStub.paths().contains("/api.json"), "/model/info \(status): the catalogue must not replace an unknown answer")
        }
    }

    func testGenerationGoesOnWithoutReportingWhenDetectionTimesOut() async throws {
        CapabilityStub.respond { request in
            switch request.url?.path {
            case "/api/v1/ai/generate/prepare":
                return (200, #"{"provider":"openai-compatible","baseUrl":"https://g.example/v1","apiKey":"k","modelId":"gpt-5","system":"s","prompt":"p","maxOutputTokens":null,"resultBoundary":{"start":"<r>","end":"</r>"},"capabilityTarget":{"providerConfigId":"aip_1","modelConfigId":"aim_1","configVersion":"v1"},"detectCapabilities":true}"#, [:])
            case "/v1/models":
                return (0, "", [:])
            case "/v1/chat/completions":
                return (200, "data: {\"choices\":[{\"delta\":{\"content\":\"<r>ok</r>\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", ["Content-Type": "text/event-stream"])
            default:
                return (404, "{}", [:])
            }
        }
        let session = CapabilityStub.session()
        let client = APIClient(baseURL: URL(string: "https://notes.example")!, token: "t", session: session, modelCatalog: ModelsDevCatalog(session: session), capabilityDetectionTimeout: 0.5)
        var types: [String] = []
        for try await event in await client.streamAiGeneration(AiGenerateInput(action: .continueWriting, title: "Note", contentMarkdown: "Body", targetLanguage: nil)) {
            types.append(event.type)
        }
        XCTAssertEqual(types.last, "finish", "generation goes on with the first prepare")
        let instance = CapabilityStub.requests().filter { $0.url?.host == "notes.example" }.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        XCTAssertEqual(instance, ["POST /api/v1/ai/generate/prepare"], "nothing is reported and prepare is not repeated")
    }

    // MARK: - Catalogue cache

    func testCatalogueIsSharedReusedAndRevalidatedWithItsETag() async throws {
        CapabilityStub.respond { request in
            request.value(forHTTPHeaderField: "If-None-Match") == "\"v1\"" ? (304, "", [:]) : (200, Self.catalogJSON, ["ETag": "\"v1\""])
        }
        let clock = TestClock()
        let catalog = ModelsDevCatalog(session: CapabilityStub.session(), now: { clock.now })
        async let first = catalog.index()
        async let second = catalog.index()
        let (a, b) = await (first, second)
        XCTAssertNotNil(a)
        XCTAssertNotNil(b)
        XCTAssertEqual(CapabilityStub.paths().count, 1, "concurrent lookups share one download")
        clock.advance(ModelsDevCatalog.freshInterval - 1)
        _ = await catalog.index()
        XCTAssertEqual(CapabilityStub.paths().count, 1, "a fresh copy needs no request")
        clock.advance(2)
        let revalidated = await catalog.index()
        XCTAssertNotNil(revalidated)
        XCTAssertEqual(CapabilityStub.requests().map { $0.value(forHTTPHeaderField: "If-None-Match") }, [nil, "\"v1\""])
        _ = await catalog.index()
        XCTAssertEqual(CapabilityStub.paths().count, 2, "the 304 renewed the copy")
    }

    func testCatalogueFailureIsRememberedThenRetried() async throws {
        let failing = LockedFlag(true)
        CapabilityStub.respond { _ in failing.value ? (503, "", [:]) : (200, Self.catalogJSON, [:]) }
        let clock = TestClock()
        let catalog = ModelsDevCatalog(session: CapabilityStub.session(), now: { clock.now })
        let firstTry = await catalog.index()
        let secondTry = await catalog.index()
        XCTAssertNil(firstTry)
        XCTAssertNil(secondTry)
        XCTAssertEqual(CapabilityStub.paths().count, 1)
        failing.set(false)
        clock.advance(ModelsDevCatalog.failureBackoff + 1)
        let retried = await catalog.index()
        XCTAssertNotNil(retried)
        XCTAssertEqual(CapabilityStub.paths().count, 2)
    }

    // MARK: - Output limit errors

    func testOutputLimitErrorIsReportedAndRetriedOnce() async throws {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"<r>ok</r>\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
        CapabilityStub.respond { request in
            let maxTokens = (try? JSONSerialization.jsonObject(with: CapabilityStub.body(of: request)) as? [String: Any])?["max_tokens"] as? Int
            return (maxTokens ?? 0) > 64000
                ? (400, #"{"error":{"message":"max_tokens: 128000 > 64000, which is the maximum allowed number of output tokens"}}"#, [:])
                : (200, sse, ["Content-Type": "text/event-stream"])
        }
        let prepared = AiPreparedGeneration(provider: "openai-compatible", baseUrl: "https://g.example/v1", apiKey: "k", modelId: "m", system: "s", prompt: "p", maxOutputTokens: 128000, resultBoundary: .init(start: "<r>", end: "</r>"))
        let reported = LockedValues<Int>()
        let events = LockedValues<String>()
        try await APIClient.streamDirectProvider(
            prepared,
            session: CapabilityStub.session(),
            emit: { events.append($0.type) },
            onOutputLimit: { _, limit in reported.append(limit) }
        )
        XCTAssertEqual(reported.values, [64000])
        XCTAssertEqual(CapabilityStub.requests().count, 2)
        XCTAssertEqual(events.values.filter { $0 == "start" }.count, 1)
        XCTAssertEqual(events.values.last, "finish")
    }

    func testUnrecognisedOrRepeatedOutputErrorsAreNotRetried() async throws {
        CapabilityStub.respond { _ in (400, #"{"error":{"message":"max_tokens: 9000 > 8000, which is the maximum"}}"#, [:]) }
        let prepared = AiPreparedGeneration(provider: "openai-compatible", baseUrl: "https://g.example/v1", apiKey: "k", modelId: "m", system: "s", prompt: "p", maxOutputTokens: 9000, resultBoundary: .init(start: "<r>", end: "</r>"))
        do {
            try await APIClient.streamDirectProvider(prepared, session: CapabilityStub.session(), emit: { _ in }, onOutputLimit: { _, _ in })
            XCTFail("expected the second 400 to surface")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 400)
        }
        XCTAssertEqual(CapabilityStub.requests().count, 2, "one retry, then the error")
    }

    // MARK: - Generation flow

    func testGenerationDetectsReportsAndPreparesAgain() async throws {
        let prepares = LockedValues<Int>()
        let preparedJSON = { (extra: String) in
            #"{"provider":"openai-compatible","baseUrl":"https://g.example/v1","apiKey":"k","modelId":"gpt-5","system":"s","prompt":"p","resultBoundary":{"start":"<r>","end":"</r>"}"# + extra + "}"
        }
        CapabilityStub.respond { request in
            switch (request.url?.host, request.url?.path) {
            case ("notes.example", "/api/v1/ai/generate/prepare"):
                prepares.append(1)
                return prepares.values.count == 1
                    ? (200, preparedJSON(#","maxOutputTokens":null,"capabilityTarget":{"providerConfigId":"aip_1","modelConfigId":"aim_1","configVersion":"v1"},"detectCapabilities":true"#), [:])
                    : (200, preparedJSON(#","maxOutputTokens":128000,"capabilityTarget":{"providerConfigId":"aip_1","modelConfigId":"aim_1","configVersion":"v1"},"detectCapabilities":false"#), [:])
            case ("notes.example", "/api/v1/ai/providers/aip_1/models/aim_1/capabilities"):
                return (200, #"{"detectedCapabilities":{}}"#, [:])
            case ("g.example", "/v1/models"):
                return (200, #"{"data":[{"id":"gpt-5","owned_by":"openai"}]}"#, [:])
            case ("models.dev", "/api.json"):
                return (200, Self.catalogJSON, [:])
            case ("g.example", "/v1/chat/completions"):
                return (200, "data: {\"choices\":[{\"delta\":{\"content\":\"<r>ok</r>\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", ["Content-Type": "text/event-stream"])
            default:
                return (404, "{}", [:])
            }
        }
        let session = CapabilityStub.session()
        let client = APIClient(baseURL: URL(string: "https://notes.example")!, token: "t", session: session, modelCatalog: ModelsDevCatalog(session: session))
        var types: [String] = []
        for try await event in await client.streamAiGeneration(AiGenerateInput(action: .continueWriting, title: "Note", contentMarkdown: "Body", targetLanguage: nil)) {
            types.append(event.type)
        }
        XCTAssertEqual(types.last, "finish")
        let instance = CapabilityStub.requests().filter { $0.url?.host == "notes.example" }
        XCTAssertEqual(instance.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }, [
            "POST /api/v1/ai/generate/prepare",
            "PUT /api/v1/ai/providers/aip_1/models/aim_1/capabilities",
            "POST /api/v1/ai/generate/prepare",
        ])
        let report = try XCTUnwrap(try JSONSerialization.jsonObject(with: CapabilityStub.body(of: instance[1])) as? [String: Any])
        XCTAssertEqual(report["provider"] as? String, "openai-compatible")
        XCTAssertEqual(report["modelId"] as? String, "gpt-5")
        XCTAssertEqual(report["baseUrl"] as? String, "https://g.example/v1")
        XCTAssertEqual(report["configVersion"] as? String, "v1")
        XCTAssertEqual(report["maxOutputTokens"] as? Int, 128000)
        XCTAssertEqual(report["maxInputTokens"] as? Int, 272000)
        XCTAssertTrue(report["contextWindowTokens"] is NSNull)
        XCTAssertEqual(report["source"] as? String, "models-dev")
        let generation = try XCTUnwrap(CapabilityStub.requests().first { $0.url?.path == "/v1/chat/completions" })
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: CapabilityStub.body(of: generation)) as? [String: Any])
        XCTAssertEqual(body["max_tokens"] as? Int, 128000, "this request already uses the detected limit")
    }

    func testFreshLimitsAreNotDetectedAgain() async throws {
        CapabilityStub.respond { request in
            switch request.url?.path {
            case "/api/v1/ai/generate/prepare":
                return (200, #"{"provider":"openai-compatible","baseUrl":"https://g.example/v1","apiKey":"k","modelId":"gpt-5","system":"s","prompt":"p","maxOutputTokens":32000,"resultBoundary":{"start":"<r>","end":"</r>"},"capabilityTarget":{"providerConfigId":"aip_1","modelConfigId":"aim_1","configVersion":"v1"},"detectCapabilities":false}"#, [:])
            case "/v1/chat/completions":
                return (200, "data: {\"choices\":[{\"delta\":{\"content\":\"<r>ok</r>\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", ["Content-Type": "text/event-stream"])
            default:
                return (404, "{}", [:])
            }
        }
        let session = CapabilityStub.session()
        let client = APIClient(baseURL: URL(string: "https://notes.example")!, token: "t", session: session, modelCatalog: ModelsDevCatalog(session: session))
        for try await _ in await client.streamAiGeneration(AiGenerateInput(action: .continueWriting, title: "Note", contentMarkdown: "Body", targetLanguage: nil)) {}
        XCTAssertEqual(CapabilityStub.paths(), ["/api/v1/ai/generate/prepare", "/v1/chat/completions"])
    }
}

// MARK: - Test helpers

private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_800_000_000)
    var now: Date { lock.withLock { current } }
    func advance(_ seconds: TimeInterval) { lock.withLock { current = current.addingTimeInterval(seconds) } }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var raw: Bool
    init(_ value: Bool) { raw = value }
    var value: Bool { lock.withLock { raw } }
    func set(_ value: Bool) { lock.withLock { raw = value } }
}

private final class LockedValues<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var raw: [T] = []
    var values: [T] { lock.withLock { raw } }
    func append(_ value: T) { lock.withLock { raw.append(value) } }
}

/// Answers every request from a handler and records the requests.
private final class CapabilityStub: URLProtocol {
    typealias Handler = @Sendable (URLRequest) -> (Int, String, [String: String])
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: Handler?
    nonisolated(unsafe) private static var log: [URLRequest] = []

    static func respond(_ handler: @escaping Handler) { lock.withLock { self.handler = handler } }
    static func reset() { lock.withLock { handler = nil; log = [] } }
    static func requests() -> [URLRequest] { lock.withLock { log } }
    static func paths() -> [String] { requests().compactMap { $0.url?.path } }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CapabilityStub.self]
        return URLSession(configuration: configuration)
    }

    /// URLSession hands bodies to protocols as a stream.
    static func body(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var recorded = request
        recorded.httpBody = Self.body(of: request)
        let handler = Self.lock.withLock { () -> Handler? in
            Self.log.append(recorded)
            return Self.handler
        }
        let (status, body, headers) = handler?(recorded) ?? (500, "", [:])
        // Status 0: never answer, like a hung gateway (the request ends only when cancelled or timed out).
        if status == 0 { return }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        if (300 ..< 400).contains(status), let location = headers["Location"], let target = URL(string: location) {
            // Let the loading system decide whether to follow, as a real redirect would.
            var redirect = request
            redirect.url = target
            client?.urlProtocol(self, wasRedirectedTo: redirect, redirectResponse: response)
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
