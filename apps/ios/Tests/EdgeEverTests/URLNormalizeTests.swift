import XCTest
@testable import EdgeEver

final class URLNormalizeTests: XCTestCase {
    func testDirectTagSuggestionsKeepCanonicalNamesAndExcludeCurrentTags() {
        let result = AiDirectStream.tagSuggestions("<edgeever-tags>\nreact\nReact\n#Current\nnew-topic\n</edgeever-tags>", currentTags: ["Current"], canonicalTags: ["react": "React"])
        XCTAssertEqual(result.map(\.name), ["React", "new-topic"])
        XCTAssertEqual(result.map(\.existing), [true, false])
        let json = AiDirectStream.tagSuggestions(#"{"suggestions":[{"name":"react"},"Current","one","two","three"]}"#, currentTags: ["Current"], canonicalTags: ["react": "React"])
        XCTAssertEqual(json.map(\.name), ["React", "one", "two"])
        XCTAssertTrue(AiDirectStream.tagSuggestions(#"{"suggestions":[]}"#, currentTags: [], canonicalTags: [:]).isEmpty)
    }

    func testDirectModelRequestsUseTheConfiguredPrivateEndpoint() throws {
        let prepared = AiPreparedGeneration(provider: "openai-compatible", baseUrl: "http://192.168.1.20:11434/v1", apiKey: "model-key", modelId: "local", system: "Suggest tags", prompt: "Body", maxOutputTokens: 300, resultBoundary: .init(start: "", end: ""))
        let request = try AiDirectStream.providerRequest(for: prepared)
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertEqual(request.url?.absoluteString, "http://192.168.1.20:11434/v1/chat/completions")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer model-key")
    }

    // #652: automatic output budgets.
    private func requestBody(_ prepared: AiPreparedGeneration) throws -> [String: Any] {
        let request = try AiDirectStream.providerRequest(for: prepared)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
    }

    func testPreparedGenerationDecodesAMissingOutputLimit() throws {
        let json = #"{"provider":"openai-compatible","baseUrl":"https://g.example/v1","apiKey":"k","modelId":"m","system":"s","prompt":"p","maxOutputTokens":null,"resultBoundary":{"start":"<r>","end":"</r>"},"outputBudget":{"mode":"auto-unbounded","outputLimit":null,"inputFits":null}}"#
        let prepared = try JSONDecoder().decode(AiPreparedGeneration.self, from: Data(json.utf8))
        XCTAssertNil(prepared.maxOutputTokens)
    }

    func testRequestsOmitTheOutputLimitWhenNoneIsKnown() throws {
        let openAi = AiPreparedGeneration(provider: "openai-compatible", baseUrl: "https://g.example/v1", apiKey: "k", modelId: "m", system: "s", prompt: "p", maxOutputTokens: nil, resultBoundary: .init(start: "", end: ""))
        XCTAssertNil(try requestBody(openAi)["max_tokens"])
        var withLimit = openAi
        withLimit.maxOutputTokens = 32000
        XCTAssertEqual(try requestBody(withLimit)["max_tokens"] as? Int, 32000)

        let gemini = AiPreparedGeneration(provider: "google", baseUrl: "https://gemini.example/v1beta", apiKey: "k", modelId: "gemini-x", system: "s", prompt: "p", maxOutputTokens: nil, resultBoundary: .init(start: "", end: ""))
        XCTAssertNil(try requestBody(gemini)["generationConfig"])

        // Anthropic requires max_tokens.
        let anthropic = AiPreparedGeneration(provider: "anthropic", baseUrl: "https://anthropic.example/v1", apiKey: "k", modelId: "claude-x", system: "s", prompt: "p", maxOutputTokens: nil, resultBoundary: .init(start: "", end: ""))
        XCTAssertEqual(try requestBody(anthropic)["max_tokens"] as? Int, 4096)
    }

    func testTruncatedFinishReasonsAcrossProviders() {
        for reason in ["length", "max_tokens", "MAX_TOKENS", "model_context_window_exceeded"] {
            XCTAssertTrue(AiDirectStream.isTruncatedFinishReason(reason), reason)
        }
        for reason in ["stop", "end_turn", "STOP"] {
            XCTAssertFalse(AiDirectStream.isTruncatedFinishReason(reason), reason)
        }
        XCTAssertFalse(AiDirectStream.isTruncatedFinishReason(nil))
    }

    func testGenerateRequestDeclaresUnboundedOutputSupport() throws {
        let input = AiGenerateInput(action: .translate, title: "t", contentMarkdown: "Body", targetLanguage: "en")
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        XCTAssertEqual(encoded["allowUnboundedOutput"] as? Bool, true)
    }

    func testAddsHTTPS() throws {
        let url = try EdgeEverURLNormalizer.normalizeInstanceURL("demo.edgeever.org")
        XCTAssertEqual(url.absoluteString, "https://demo.edgeever.org")
    }

    func testStripsTrailingSlash() throws {
        let url = try EdgeEverURLNormalizer.normalizeInstanceURL("https://demo.edgeever.org/")
        XCTAssertEqual(url.absoluteString, "https://demo.edgeever.org")
    }

    func testRejectsEmpty() {
        XCTAssertThrowsError(try EdgeEverURLNormalizer.normalizeInstanceURL("  "))
    }

    func testMapsBareDemoAliasToPublicInstance() throws {
        XCTAssertEqual(
            try EdgeEverURLNormalizer.normalizeInstanceURL("demo").absoluteString,
            EdgeEverPublicDemo.instanceURLString
        )
        XCTAssertEqual(
            try EdgeEverURLNormalizer.normalizeInstanceURL("https://demo").absoluteString,
            EdgeEverPublicDemo.instanceURLString
        )
        XCTAssertEqual(
            try EdgeEverURLNormalizer.normalizeInstanceURL("DEMO/").absoluteString,
            EdgeEverPublicDemo.instanceURLString
        )
    }
}
