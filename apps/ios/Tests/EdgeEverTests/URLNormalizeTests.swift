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

/// Long runs in parts and continuations (#652 PR B), the same cases as `packages/client`.
final class AiLongGenerationTests: XCTestCase {
    private final class Sink: @unchecked Sendable {
        private let lock = NSLock()
        private(set) var events: [AiStreamEvent] = []
        private(set) var text = ""
        private(set) var requests: [AiGenerateInput] = []
        func add(_ event: AiStreamEvent) {
            lock.withLock {
                events.append(event)
                if event.type == "text-delta" { text += event.text ?? "" }
                if event.type == "text-reset" { text = event.text ?? "" }
            }
        }
        func record(_ request: AiGenerateInput) { lock.withLock { requests.append(request) } }
    }

    private func prepared(_ prompt: String = "p", segments: [AiGenerationSegment]? = nil, long: Bool? = true) -> AiPreparedGeneration {
        AiPreparedGeneration(provider: "openai-compatible", baseUrl: "https://g.example/v1", apiKey: "k", modelId: "m", system: "s", prompt: prompt, maxOutputTokens: nil, resultBoundary: .init(start: "<r>", end: "</r>"), segments: segments, longGeneration: long)
    }

    private func finish(_ truncated: Bool) -> AiStreamEvent {
        var event = AiLongGeneration.event("finish")
        event.truncated = truncated
        return event
    }

    private let input = AiGenerateInput(action: .translate, title: "t", contentMarkdown: "full", targetLanguage: "zh-CN")
    private let parts = [
        AiGenerationSegment(markdown: "# Title\n\nFirst part.\n\n", headingPath: [], passthrough: false),
        AiGenerationSegment(markdown: "```js\ncode();\n```\n\n", headingPath: ["Title"], passthrough: true),
        AiGenerationSegment(markdown: "## Two\n\nSecond part.\n", headingPath: ["Title"], passthrough: false),
    ]

    func testPartsRunInOrderWithContextAndCodePassesThrough() async throws {
        let sink = Sink()
        let first = prepared(segments: parts)
        try await AiLongGeneration.run(input: input, first: first, prepare: { [self] request in
            sink.record(request)
            return prepared(request.contentMarkdown)
        }, stream: { request, emit in
            emit(AiLongGeneration.event("start"))
            emit(AiLongGeneration.event("text-delta", text: request.prompt.contains("First") ? "# 标题\n\n第一部分。" : "## 二\n\n第二部分。"))
            emit(self.finish(false))
        }, emit: sink.add)
        XCTAssertEqual(sink.text, "# 标题\n\n第一部分。\n\n```js\ncode();\n```\n\n## 二\n\n第二部分。")
        XCTAssertEqual(sink.requests.map { $0.segment?.index }, [0, 2])
        XCTAssertEqual(sink.requests[1].segment?.headingPath, ["Title"])
        XCTAssertEqual(sink.requests[1].segment?.previousOutputTail, "# 标题\n\n第一部分。")
        XCTAssertEqual(sink.events.filter { $0.type == "start" }.count, 1)
        XCTAssertEqual(sink.events.filter { $0.type == "progress" }.compactMap(\.part), [1, 2, 3])
        var completion = AiDraftCompletion()
        sink.events.forEach { completion.track($0) }
        XCTAssertNil(completion.incompleteReason)
    }

    func testCutOffPartIsSplitAndKeepsItsSourceWhenItStillCannotFinish() async throws {
        let sink = Sink()
        let first = prepared(segments: [parts[0], parts[2]])
        try await AiLongGeneration.run(input: input, first: first, prepare: { [self] request in
            if request.segmentation?.depth == 2 { return prepared(request.contentMarkdown) }
            if request.segmentation != nil {
                return prepared(segments: [
                    AiGenerationSegment(markdown: "## Two\n\n", headingPath: [], passthrough: false),
                    AiGenerationSegment(markdown: "Second part.\n", headingPath: ["Two"], passthrough: false),
                ])
            }
            return prepared(request.contentMarkdown)
        }, stream: { request, emit in
            if request.prompt.contains("First") {
                emit(AiLongGeneration.event("text-delta", text: "第一部分。")); emit(self.finish(false)); return
            }
            if request.prompt == "## Two\n\n" {
                emit(AiLongGeneration.event("text-delta", text: "## 二")); emit(self.finish(false)); return
            }
            emit(AiLongGeneration.event("text-delta", text: "第二部")); emit(self.finish(true))
        }, emit: sink.add)
        XCTAssertEqual(sink.text, "第一部分。\n\n## 二\n\nSecond part.")
        XCTAssertEqual(sink.events.last?.incompleteParts, [2])
        var completion = AiDraftCompletion()
        sink.events.forEach { completion.track($0) }
        XCTAssertEqual(completion.incompleteReason, .truncated, "a draft with a part that kept its source cannot replace")
        XCTAssertEqual(completion.incompleteParts, [2])
    }

    func testContinuationDropsTheRepeatedSeamAndOlderServersAreNotAsked() async throws {
        final class Replies: @unchecked Sendable {
            var items: [(String, Bool)] = [("Paragraph one.\n\nParagraph two is cut", true), ("Paragraph two is cut short here.\n\nThe end.", false)]
        }
        let replies = Replies()
        let sink = Sink()
        let writing = AiGenerateInput(action: .continueWriting, title: "t", contentMarkdown: "x", targetLanguage: nil)
        try await AiLongGeneration.run(input: writing, first: prepared(), prepare: { [self] request in
            sink.record(request)
            return prepared()
        }, stream: { _, emit in
            let (text, cut) = replies.items.removeFirst()
            emit(AiLongGeneration.event("text-delta", text: text)); emit(self.finish(cut))
        }, emit: sink.add)
        XCTAssertEqual(sink.text, "Paragraph one.\n\nParagraph two is cut short here.\n\nThe end.")
        XCTAssertEqual(sink.requests.first?.continuation, AiContinuationRequest(round: 1, previousOutput: "Paragraph one.\n\nParagraph two is cut"))
        XCTAssertEqual(sink.events.last?.truncated, false)

        let older = Sink()
        try await AiLongGeneration.run(input: writing, first: prepared(long: nil), prepare: { [self] request in
            older.record(request)
            return prepared()
        }, stream: { _, emit in
            emit(AiLongGeneration.event("text-delta", text: "more")); emit(self.finish(true))
        }, emit: older.add)
        XCTAssertTrue(older.requests.isEmpty, "an older server would start over instead of continuing")
        XCTAssertEqual(older.events.last?.truncated, true)
    }

    func testAnEmptyContinuationKeepsTheDraftIncomplete() async throws {
        final class Replies: @unchecked Sendable {
            var items: [(String, Bool)] = [("Paragraph one.\n\nParagraph two is cut", true), ("   \n", false)]
        }
        let replies = Replies()
        let sink = Sink()
        let writing = AiGenerateInput(action: .continueWriting, title: "t", contentMarkdown: "x", targetLanguage: nil)
        try await AiLongGeneration.run(input: writing, first: prepared(), prepare: { [self] request in
            sink.record(request)
            return prepared()
        }, stream: { _, emit in
            let (text, cut) = replies.items.isEmpty ? ("more", true) : replies.items.removeFirst()
            emit(AiLongGeneration.event("text-delta", text: text)); emit(self.finish(cut))
        }, emit: sink.add)
        XCTAssertEqual(sink.requests.count, 1)
        XCTAssertEqual(sink.text, "Paragraph one.\n\nParagraph two is cut")
        XCTAssertEqual(sink.events.last?.truncated, true)
        var completion = AiDraftCompletion()
        sink.events.forEach { completion.track($0) }
        XCTAssertEqual(completion.incompleteReason, .truncated)
    }

    func testAnErrorInAPartEndsTheRunWithTheTextSoFar() async throws {
        final class Count: @unchecked Sendable { var value = 0 }
        let count = Count()
        let sink = Sink()
        try await AiLongGeneration.run(input: input, first: prepared(segments: [parts[0], parts[2]]), prepare: { [self] request in
            prepared(request.contentMarkdown)
        }, stream: { _, emit in
            count.value += 1
            if count.value == 1 { emit(AiLongGeneration.event("text-delta", text: "第一部分。")); emit(self.finish(false)); return }
            emit(AiLongGeneration.event("text-delta", text: "第二"))
            emit(AiStreamEvent(type: "error", text: nil, code: "ai_stream_interrupted", message: "x", finishReason: nil, inputTokens: nil, outputTokens: nil))
        }, emit: sink.add)
        XCTAssertEqual(sink.text, "第一部分。\n\n第二")
        XCTAssertEqual(sink.events.last?.code, "ai_stream_interrupted")
        var completion = AiDraftCompletion()
        sink.events.forEach { completion.track($0) }
        XCTAssertEqual(completion.incompleteReason, .interrupted)
    }

    func testAPartResultFarTooShortIsNotTakenAsTheResult() async throws {
        let long = AiGenerationSegment(markdown: "## 30. 节\n\n" + String(repeating: "这一段需要被完整处理。", count: 40) + "\n\n", headingPath: [], passthrough: false)
        let sink = Sink()
        try await AiLongGeneration.run(input: input, first: prepared(segments: [parts[0], long]), prepare: { [self] request in
            sink.record(request)
            return prepared(request.contentMarkdown)
        }, stream: { request, emit in
            emit(AiLongGeneration.event("text-delta", text: request.prompt.contains("First") ? "第一部分。" : "只返回了一句话。"))
            emit(self.finish(false))
        }, emit: sink.add)
        XCTAssertTrue(sink.requests.contains { $0.segmentation?.depth == 1 })
        XCTAssertTrue(sink.text.contains("这一段需要被完整处理。"))
        XCTAssertFalse(sink.text.contains("只返回了一句话。"))
        XCTAssertEqual(sink.events.last?.incompleteParts, [2])
        XCTAssertFalse(AiLongGeneration.isSegmentResultPlausible(source: long.markdown, result: "只返回了一句话。"))
        XCTAssertTrue(AiLongGeneration.isSegmentResultPlausible(source: "短。", result: "x"))
    }

    func testJoiningHelpers() {
        XCTAssertEqual(AiLongGeneration.joinContinuation("第一段。\n\n第二段写到一半", "，后半句。"), "第一段。\n\n第二段写到一半，后半句。")
        XCTAssertEqual(AiLongGeneration.segmentTail(String(repeating: "x", count: 1000)).count, 600)
        XCTAssertEqual(AiLongGeneration.joinSegmentResult(AiGenerationSegment(markdown: "A\n\n", headingPath: [], passthrough: false), " 甲 "), "甲\n\n")
    }
}
