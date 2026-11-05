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

    func testMissingEndMarkerMeansTheResultWasCutOff() {
        let cutOff = AiGenerationStreamNormalizer(resultBoundary: .init(start: "<r>", end: "</r>"))
        _ = cutOff.push("<r>\n## 1. Part one\nText that stops mid-sen")
        _ = cutOff.finish()
        XCTAssertTrue(cutOff.isUnterminated)

        // As in APIClient, the state is read after finish().
        let complete = AiGenerationStreamNormalizer(resultBoundary: .init(start: "<r>", end: "</r>"))
        _ = complete.push("<r>\nDone</r>")
        _ = complete.finish()
        XCTAssertFalse(complete.isUnterminated)

        // End marker arriving in the same chunk without a newline is only seen at finish().
        let sameChunk = AiGenerationStreamNormalizer(resultBoundary: .init(start: "<r>", end: "</r>"))
        _ = sameChunk.push("<r>Hello</r>")
        XCTAssertEqual(sameChunk.finish(), "Hello")
        XCTAssertFalse(sameChunk.isUnterminated)

        let unmarked = AiGenerationStreamNormalizer(resultBoundary: .init(start: "<r>", end: "</r>"))
        _ = unmarked.push("A model that ignored the markers")
        _ = unmarked.finish()
        XCTAssertFalse(unmarked.isUnterminated)
    }

    func testStreamEndWithoutFinishReasonNeedsTheEndMarker() {
        let boundary = AiGenerationResultBoundary(start: "<r>", end: "</r>")
        // A gateway sends a fragment with neither marker and closes the stream.
        let unmarked = AiGenerationStreamNormalizer(resultBoundary: boundary)
        _ = unmarked.push("First paragraph.\n\nSecond")
        XCTAssertTrue(unmarked.finish().contains("First paragraph."))
        XCTAssertEqual(AiDirectStream.streamEnd(finishReason: nil, normalizer: unmarked), .interrupted)
        // The same text with a provider stop is a complete result.
        XCTAssertEqual(AiDirectStream.streamEnd(finishReason: "stop", normalizer: unmarked), .finished(truncated: false))

        let started = AiGenerationStreamNormalizer(resultBoundary: boundary)
        _ = started.push("<r>\nFirst paragraph.\n")
        _ = started.finish()
        XCTAssertEqual(AiDirectStream.streamEnd(finishReason: nil, normalizer: started), .interrupted)
        XCTAssertEqual(AiDirectStream.streamEnd(finishReason: "end_turn", normalizer: started), .finished(truncated: true))

        let whole = AiGenerationStreamNormalizer(resultBoundary: boundary)
        _ = whole.push("<r>\nWhole result.\n</r>")
        _ = whole.finish()
        XCTAssertEqual(AiDirectStream.streamEnd(finishReason: nil, normalizer: whole), .finished(truncated: false))

        // As the sheet folds it: the interruption blocks Replace and keeps the text.
        var completion = AiDraftCompletion()
        completion.track(event("text-delta", text: "First paragraph."))
        completion.track(AiStreamEvent(type: "error", text: nil, code: "ai_stream_interrupted", message: "The connection ended before the AI finished.", finishReason: nil, inputTokens: nil, outputTokens: nil))
        XCTAssertEqual(completion.incompleteReason, .interrupted)
    }

    func testAnthropicStreamedStopReasonIsReadFromMessageDelta() {
        let delta = AiDirectStream.extractDelta(provider: "anthropic", payload: ["type": "message_delta", "delta": ["stop_reason": "max_tokens"], "usage": ["output_tokens": 7]])
        XCTAssertEqual(delta.finishReason, "max_tokens")
        XCTAssertEqual(delta.outputTokens, 7)
        XCTAssertTrue(AiDirectStream.isTruncatedFinishReason(delta.finishReason))
    }

    private func event(_ type: String, text: String? = nil, finishReason: String? = nil, truncated: Bool? = nil) -> AiStreamEvent {
        AiStreamEvent(type: type, text: text, code: nil, message: nil, finishReason: finishReason, inputTokens: nil, outputTokens: nil, truncated: truncated)
    }

    func testOnlyACleanFinishLetsADraftReplaceTheOriginal() {
        var complete = AiDraftCompletion()
        complete.track(event("start"))
        complete.track(event("text-delta", text: "Polished"))
        XCTAssertEqual(complete.incompleteReason, .interrupted, "a draft still streaming cannot replace")
        complete.track(event("finish", finishReason: "stop", truncated: false))
        XCTAssertNil(complete.incompleteReason)

        var truncated = AiDraftCompletion()
        truncated.track(event("text-delta", text: "Part"))
        truncated.track(event("finish", finishReason: "length"))
        XCTAssertEqual(truncated.incompleteReason, .truncated)

        var unterminated = AiDraftCompletion()
        unterminated.track(event("finish", finishReason: "stop", truncated: true))
        XCTAssertEqual(unterminated.incompleteReason, .truncated)

        var stopped = AiDraftCompletion()
        stopped.track(event("text-delta", text: "Part"))
        stopped.stop()
        XCTAssertEqual(stopped.incompleteReason, .stopped)
    }

    func testPartialTextBeforeADroppedConnectionOrStreamErrorCannotReplace() {
        // The provider sent text, then the connection dropped and the stream threw.
        var dropped = AiDraftCompletion()
        dropped.track(event("start"))
        dropped.track(event("text-delta", text: "First paragraph"))
        dropped.fail()
        XCTAssertEqual(dropped.incompleteReason, .interrupted)

        // The provider sent text, then an error event.
        var streamError = AiDraftCompletion()
        streamError.track(event("text-delta", text: "First paragraph"))
        streamError.track(event("error"))
        XCTAssertEqual(streamError.incompleteReason, .interrupted)

        // A stream that ends with neither finish nor error is not complete either.
        var ended = AiDraftCompletion()
        ended.track(event("text-delta", text: "First paragraph"))
        XCTAssertEqual(ended.incompleteReason, .interrupted)
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
