import Foundation

enum AiDirectStream {
    static func providerRequest(for prepared: AiPreparedGeneration) throws -> URLRequest {
        let base = prepared.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var request: URLRequest
        var body: [String: Any]
        switch prepared.provider {
        case "anthropic":
            guard let url = URL(string: "\(base)/messages") else {
                throw APIError(status: 502, code: "ai_generation_failed", message: "Invalid AI provider URL.")
            }
            request = URLRequest(url: url)
            request.setValue(prepared.apiKey, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            body = [
                "model": prepared.modelId,
                // Anthropic requires max_tokens; instances never send nil for it.
                "max_tokens": prepared.maxOutputTokens ?? 4096,
                "stream": true,
                "system": prepared.system,
                "messages": [["role": "user", "content": prepared.prompt]],
            ]
        case "google":
            let modelId = prepared.modelId.hasPrefix("models/") ? String(prepared.modelId.dropFirst("models/".count)) : prepared.modelId
            guard let url = URL(string: "\(base)/models/\(modelId):streamGenerateContent?alt=sse") else {
                throw APIError(status: 502, code: "ai_generation_failed", message: "Invalid AI provider URL.")
            }
            request = URLRequest(url: url)
            request.setValue(prepared.apiKey, forHTTPHeaderField: "x-goog-api-key")
            body = [
                "system_instruction": ["parts": [["text": prepared.system]]],
                "contents": [["role": "user", "parts": [["text": prepared.prompt]]]],
            ]
            if let maxOutputTokens = prepared.maxOutputTokens {
                body["generationConfig"] = ["maxOutputTokens": maxOutputTokens]
            }
        default:
            guard let url = URL(string: "\(base)/chat/completions") else {
                throw APIError(status: 502, code: "ai_generation_failed", message: "Invalid AI provider URL.")
            }
            request = URLRequest(url: url)
            request.setValue("Bearer \(prepared.apiKey)", forHTTPHeaderField: "Authorization")
            body = [
                "model": prepared.modelId,
                "stream": true,
                "messages": [
                    ["role": "system", "content": prepared.system],
                    ["role": "user", "content": prepared.prompt],
                ],
            ]
            if let maxOutputTokens = prepared.maxOutputTokens {
                body["max_tokens"] = maxOutputTokens
            }
        }
        request.httpShouldHandleCookies = false
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    /// True when the provider stopped because it ran out of output or context space (#652).
    static func isTruncatedFinishReason(_ reason: String?) -> Bool {
        guard let reason else { return false }
        return ["length", "max_tokens", "model_context_window_exceeded", "MAX_TOKENS", "max_output_tokens"].contains(reason)
    }

    enum StreamEnd: Equatable {
        /// The connection closed before the provider finished and before the end marker (#652).
        case interrupted
        case finished(truncated: Bool)
    }

    /// How a stream that delivered text ended. Without a provider finish reason only the end
    /// marker proves the result is whole, with or without the start marker (#652).
    static func streamEnd(finishReason: String?, normalizer: AiGenerationStreamNormalizer) -> StreamEnd {
        if finishReason == nil, !normalizer.isComplete { return .interrupted }
        return .finished(truncated: isTruncatedFinishReason(finishReason) || normalizer.isUnterminated)
    }

    static func tagSuggestions(_ text: String, currentTags: [String], canonicalTags: [String: String]) -> [AiTagSuggestion] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        var names: [String] = []
        var structured = false
        if let first = trimmed.firstIndex(where: { $0 == "[" || $0 == "{" }),
           let last = trimmed.lastIndex(where: { $0 == "]" || $0 == "}" }), first <= last,
           let data = String(trimmed[first...last]).data(using: .utf8),
           let value = try? JSONSerialization.jsonObject(with: data) {
            structured = true
            let record = value as? [String: Any]
            let list = value as? [Any] ?? record?["suggestions"] as? [Any] ?? record?["tags"] as? [Any] ?? []
            names = list.compactMap { item in
                if let name = item as? String { return name }
                let item = item as? [String: Any]
                return item?["name"] as? String ?? item?["tag"] as? String
            }
        }
        if !structured {
            let content = trimmed.components(separatedBy: "<edgeever-tags>").last?.components(separatedBy: "</edgeever-tags>").first ?? trimmed
            names = content.components(separatedBy: .newlines)
        }
        var seen = Set(currentTags.map { $0.lowercased() })
        var result: [AiTagSuggestion] = []
        for line in names {
            let name = line.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "#-*• "))
            let key = name.lowercased()
            guard !name.isEmpty, seen.insert(key).inserted else { continue }
            result.append(AiTagSuggestion(name: canonicalTags[key] ?? name, existing: canonicalTags[key] != nil))
            if result.count == 3 { break }
        }
        return result
    }

    static func extractDelta(provider: String, payload: [String: Any]) -> (text: String, finishReason: String?, inputTokens: Int?, outputTokens: Int?) {
        if provider == "anthropic" {
            let delta = payload["delta"] as? [String: Any]
            let usage = payload["usage"] as? [String: Any]
            return (
                delta?["text"] as? String ?? "",
                // Streaming sends the stop reason in message_delta's `delta.stop_reason`.
                (delta?["stop_reason"] as? String) ?? (payload["stop_reason"] as? String),
                usage?["input_tokens"] as? Int,
                usage?["output_tokens"] as? Int
            )
        }
        if provider == "google" {
            let candidate = (payload["candidates"] as? [[String: Any]])?.first
            let parts = ((candidate?["content"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
            let text = parts.compactMap { $0["text"] as? String }.joined()
            let usage = payload["usageMetadata"] as? [String: Any]
            return (
                text,
                candidate?["finishReason"] as? String,
                usage?["promptTokenCount"] as? Int,
                usage?["candidatesTokenCount"] as? Int
            )
        }
        let choice = (payload["choices"] as? [[String: Any]])?.first
        let delta = choice?["delta"] as? [String: Any]
        let message = choice?["message"] as? [String: Any]
        let usage = payload["usage"] as? [String: Any]
        let text = (delta?["content"] as? String) ?? (message?["content"] as? String) ?? ""
        return (
            text,
            choice?["finish_reason"] as? String,
            usage?["prompt_tokens"] as? Int,
            usage?["completion_tokens"] as? Int
        )
    }
}

final class AiGenerationStreamNormalizer: @unchecked Sendable {
    private let resultBoundary: AiGenerationResultBoundary
    private var pending = ""
    private var boundaryStarted = false
    private var boundaryFinished = false
    private var openingLineRemoved = false
    private var wrapperResolved = false
    private var fencedMarkdown = false

    init(resultBoundary: AiGenerationResultBoundary) {
        self.resultBoundary = resultBoundary
    }

    func push(_ value: String) -> String {
        if boundaryFinished || value.isEmpty { return "" }
        pending += value
        if !boundaryStarted {
            guard let start = pending.range(of: resultBoundary.start) else { return "" }
            pending = String(pending[start.upperBound...])
            boundaryStarted = true
        }
        if !removeOpeningLine() { return "" }
        if !resolveMarkdownWrapper(finishing: false) { return "" }
        if let end = pending.range(of: resultBoundary.end) {
            let output = stripClosingWrapper(String(pending[..<end.lowerBound]))
                .replacingOccurrences(of: #"[\t ]*(?:\r\n|\r|\n)?$"#, with: "", options: .regularExpression)
            pending = ""
            boundaryFinished = true
            return output
        }
        let retained = resultBoundary.end.count
        if pending.count <= retained { return "" }
        let split = pending.index(pending.endIndex, offsetBy: -retained)
        let output = String(pending[..<split])
        pending = String(pending[split...])
        return output
    }

    /// The result opened with the start marker but never reached the end marker, so it was cut
    /// off even if the provider or gateway reported a normal stop (#652).
    var isUnterminated: Bool { boundaryStarted && !boundaryFinished }

    /// The end marker arrived, so the result is known to be whole (#652).
    var isComplete: Bool { boundaryFinished }

    func finish() -> String {
        if boundaryFinished { return "" }
        if !boundaryStarted {
            return normalizeFull(pending)
        }
        // The end marker can still be in the retained tail when the stream ends.
        if pending.contains(resultBoundary.end) { boundaryFinished = true }
        _ = removeOpeningLine()
        _ = resolveMarkdownWrapper(finishing: true)
        return stripClosingWrapper(pending.replacingOccurrences(of: resultBoundary.end, with: "")).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func removeOpeningLine() -> Bool {
        if openingLineRemoved { return true }
        if let match = pending.range(of: #"^[ \t]*(?:\r\n|\r|\n)"#, options: .regularExpression) {
            pending.removeSubrange(match)
            openingLineRemoved = true
            return true
        }
        if pending.range(of: #"^[ \t]*\r?$"#, options: .regularExpression) != nil { return false }
        openingLineRemoved = true
        return true
    }

    private func resolveMarkdownWrapper(finishing: Bool) -> Bool {
        if wrapperResolved { return true }
        if let match = pending.range(of: #"^```(?:markdown|md)[ \t]*(?:\r\n|\r|\n)"#, options: [.regularExpression, .caseInsensitive]) {
            pending.removeSubrange(match)
            fencedMarkdown = true
            wrapperResolved = true
            return true
        }
        if !finishing && pending.range(of: #"\r\n|\r|\n"#, options: .regularExpression) == nil { return false }
        wrapperResolved = true
        return true
    }

    private func stripClosingWrapper(_ value: String) -> String {
        guard fencedMarkdown else { return value }
        return value.replacingOccurrences(of: #"(?:\r\n|\r|\n)```[ \t]*(?:\r\n|\r|\n)?$"#, with: "", options: .regularExpression)
    }

    private func normalizeFull(_ value: String) -> String {
        var result = value.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let start = result.range(of: resultBoundary.start) {
            let contentStart = start.upperBound
            if let end = result.range(of: resultBoundary.end, range: contentStart..<result.endIndex),
               end.lowerBound >= contentStart {
                result = String(result[contentStart..<end.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                result = result
                    .replacingOccurrences(of: resultBoundary.start, with: "")
                    .replacingOccurrences(of: resultBoundary.end, with: "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        let ns = result as NSString
        if let regex = try? NSRegularExpression(pattern: #"^```(?:markdown|md)[ \t]*\n([\s\S]*?)\n```[ \t]*$"#, options: .caseInsensitive),
           let found = regex.firstMatch(in: result, range: NSRange(location: 0, length: ns.length)),
           found.numberOfRanges > 1 {
            result = ns.substring(with: found.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return result
    }
}

// MARK: - Long runs (#652 PR B)

/// Runs one body generation to completion (#652 PR B), the same way as `packages/client`.
///
/// - When prepare returns parts, each part is prepared and streamed in order with the context of
///   the part before it. A part that is cut off is split again (up to two levels); a part that still
///   cannot finish keeps its source text and is reported in `incompleteParts`.
/// - Otherwise one request runs; when it is cut off, up to three continuations append the rest,
///   only when the server says it understands them.
/// - An error, a dropped connection or a stop ends the run; the text so far stays an incomplete draft.
///
/// Events: one `start`, `text-delta` while text arrives, `text-reset` when the draft is fixed up,
/// `progress` per part, then `finish` or `error`.
enum AiLongGeneration {
    typealias Prepare = @Sendable (AiGenerateInput) async throws -> AiPreparedGeneration
    typealias Stream = @Sendable (AiPreparedGeneration, @escaping @Sendable (AiStreamEvent) -> Void) async throws -> Void

    static let continuationMaxRounds = 3
    static let maxSplitDepth = 2
    static let continuationTailChars = 20_000
    static let continuationHoldChars = 800
    static let segmentTailChars = 600

    static func run(
        input: AiGenerateInput,
        first: AiPreparedGeneration,
        prepare: @escaping Prepare,
        stream: @escaping Stream,
        emit: @escaping @Sendable (AiStreamEvent) -> Void
    ) async throws {
        let runner = Runner(input: input, prepare: prepare, stream: stream, emit: emit)
        emit(event("start"))
        if let segments = first.segments, !segments.isEmpty {
            try await runner.runParts(segments)
        } else {
            try await runner.runSingle(first)
        }
    }

    static func event(_ type: String, text: String? = nil) -> AiStreamEvent {
        AiStreamEvent(type: type, text: text, code: nil, message: nil, finishReason: nil, inputTokens: nil, outputTokens: nil)
    }

    // MARK: - Joining text

    /// The same rough estimate as `estimateAiTokens` in `packages/shared`.
    static func estimateTokens(_ text: String) -> Int {
        var cjk = 0
        var other = 0
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x3040...0x30FF, 0x3400...0x4DBF, 0x4E00...0x9FFF, 0xAC00...0xD7AF, 0xF900...0xFAFF, 0xFF00...0xFFEF:
                cjk += 1
            default:
                other += scalar.value > 0xFFFF ? 2 : 1
            }
        }
        return Int(((Double(cjk) + Double(other) / 3) * 1.1).rounded(.up))
    }

    /// A part result far shorter than its source lost text even if the model said it finished.
    static func isSegmentResultPlausible(source: String, result: String) -> Bool {
        let sourceTokens = estimateTokens(source)
        if sourceTokens < 200 { return true }
        return Double(estimateTokens(result)) >= Double(sourceTokens) * 0.25
    }

    /// The last characters of a text, for the next part's context.
    static func segmentTail(_ text: String) -> String {
        let trimmed = text.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
        return trimmed.count <= segmentTailChars ? trimmed : String(trimmed.suffix(segmentTailChars))
    }

    /// A part's result in place of its source, keeping the blank lines after the source.
    static func joinSegmentResult(_ segment: AiGenerationSegment, _ result: String) -> String {
        let separator = segment.markdown.range(of: #"\s*$"#, options: .regularExpression).map { String(segment.markdown[$0]) } ?? ""
        return result.trimmingCharacters(in: .whitespacesAndNewlines) + (separator.isEmpty ? "\n\n" : separator)
    }

    static func joinSegments(_ parts: [String]) -> String {
        parts.joined().replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
    }

    /// Append a continuation, dropping text the model repeated from the end of what it had written.
    static func joinContinuation(_ previous: String, _ next: String) -> String {
        let head = String(next.drop(while: { $0.isWhitespace }))
        let limit = min(800, previous.count, head.count)
        if limit >= 12 {
            for length in stride(from: limit, through: 12, by: -1) where previous.hasSuffix(String(head.prefix(length))) {
                return previous + head.dropFirst(length)
            }
        }
        let endsWithSpace = previous.last?.isWhitespace ?? true
        let startsWithSpace = next.first?.isWhitespace ?? false
        if endsWithSpace || !startsWithSpace {
            return previous + String(next.drop(while: { $0 == " " || $0 == "\t" }))
        }
        return previous + next
    }
}

private struct StreamResult {
    var text = ""
    var truncated = false
    var finishReason: String?
    var error: AiStreamEvent?
}

/// Collects one request's events; the stream callback may run on another task.
private final class StreamCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var result = StreamResult()
    private let onText: @Sendable (String) -> Void

    init(onText: @escaping @Sendable (String) -> Void) { self.onText = onText }

    func take(_ event: AiStreamEvent) {
        lock.lock()
        switch event.type {
        case "text-delta":
            result.text += event.text ?? ""
        case "finish":
            result.truncated = event.truncated == true
            result.finishReason = event.finishReason
        case "error":
            result.error = event
        default:
            break
        }
        lock.unlock()
        if event.type == "text-delta", let text = event.text { onText(text) }
    }

    var value: StreamResult {
        lock.lock(); defer { lock.unlock() }
        return result
    }
}

private final class Runner: @unchecked Sendable {
    let input: AiGenerateInput
    let prepare: AiLongGeneration.Prepare
    let stream: AiLongGeneration.Stream
    let emit: @Sendable (AiStreamEvent) -> Void

    init(input: AiGenerateInput, prepare: @escaping AiLongGeneration.Prepare, stream: @escaping AiLongGeneration.Stream, emit: @escaping @Sendable (AiStreamEvent) -> Void) {
        self.input = input
        self.prepare = prepare
        self.stream = stream
        self.emit = emit
    }

    private func streamOne(_ prepared: AiPreparedGeneration, onText: @escaping @Sendable (String) -> Void) async throws -> StreamResult {
        let collector = StreamCollector(onText: onText)
        // The run reports one start for all of its requests.
        try await stream(prepared) { event in if event.type != "start" { collector.take(event) } }
        return collector.value
    }

    private func request(_ change: (inout AiGenerateInput) -> Void) -> AiGenerateInput {
        var next = input
        next.segmentation = nil
        next.segment = nil
        next.continuation = nil
        change(&next)
        return next
    }

    func runSingle(_ first: AiPreparedGeneration) async throws {
        let draft = Draft()
        let emit = self.emit
        var result = try await streamOne(first) { text in
            draft.append(text)
            emit(AiLongGeneration.event("text-delta", text: text))
        }
        if let error = result.error { return emit(error) }
        let canContinue = first.longGeneration == true
        var round = 1
        while canContinue, result.truncated, round <= AiLongGeneration.continuationMaxRounds {
            try Task.checkCancellation()
            let previous = String(draft.text.suffix(AiLongGeneration.continuationTailChars))
            let next: AiPreparedGeneration
            do {
                next = try await prepare(request { $0.continuation = AiContinuationRequest(round: round, previousOutput: previous) })
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // No room left in the window: the draft stays incomplete.
                break
            }
            let before = draft.text
            let seam = Seam()
            let release: @Sendable (Bool) -> Void = { final in
                guard let held = seam.release(final: final) else { return }
                let merged = AiLongGeneration.joinContinuation(before, held)
                let added = String(merged.dropFirst(before.count))
                // A continuation that is only whitespace adds nothing to the draft.
                if final, added.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
                draft.set(merged)
                if !added.isEmpty { emit(AiLongGeneration.event("text-delta", text: added)) }
            }
            result = try await streamOne(next) { text in
                if seam.joined {
                    draft.append(text)
                    emit(AiLongGeneration.event("text-delta", text: text))
                } else {
                    seam.hold(text)
                    release(false)
                }
            }
            release(true)
            if let error = result.error { return emit(error) }
            // Only a continuation that added text can end the cut-off state; an empty one leaves
            // the draft incomplete and stops continuing (#652 PR B review).
            if String(draft.text.dropFirst(before.count)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                result.truncated = true
                break
            }
            round += 1
        }
        var finish = AiLongGeneration.event("finish")
        finish.finishReason = result.finishReason
        finish.truncated = result.truncated
        emit(finish)
    }

    func runParts(_ segments: [AiGenerationSegment]) async throws {
        var done: [String] = []
        var incomplete = Set<Int>()
        var previousSource = ""
        var previousOutput = ""
        let emit = self.emit

        func runPart(_ segment: AiGenerationSegment, part: Int, index: Int, count: Int, depth: Int) async throws -> Bool {
            if segment.passthrough {
                done.append(AiLongGeneration.joinSegmentResult(segment, segment.markdown))
                return true
            }
            try Task.checkCancellation()
            let prefix = done.joined()
            var prepared: AiPreparedGeneration?
            do {
                prepared = try await prepare(request {
                    $0.contentMarkdown = segment.markdown
                    $0.segment = AiSegmentContext(
                        index: index,
                        count: count,
                        headingPath: Array(segment.headingPath.suffix(6)),
                        previousSourceTail: previousSource.isEmpty ? nil : AiLongGeneration.segmentTail(previousSource),
                        previousOutputTail: previousOutput.isEmpty ? nil : AiLongGeneration.segmentTail(previousOutput)
                    )
                })
            } catch let error as APIError where error.code == "ai_input_too_long" {
                // A part that does not fit is split again like a part that was cut off.
                prepared = nil
            }
            var result: StreamResult?
            if let prepared {
                emit(AiLongGeneration.event("text-reset", text: prefix))
                let streamed = try await streamOne(prepared) { text in emit(AiLongGeneration.event("text-delta", text: text)) }
                if let error = streamed.error {
                    emit(AiLongGeneration.event("text-reset", text: prefix + streamed.text))
                    emit(error)
                    return false
                }
                result = streamed
            }
            if let result, !result.truncated, !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               AiLongGeneration.isSegmentResultPlausible(source: segment.markdown, result: result.text) {
                done.append(AiLongGeneration.joinSegmentResult(segment, result.text))
                previousSource = segment.markdown
                previousOutput = result.text
                emit(AiLongGeneration.event("text-reset", text: AiLongGeneration.joinSegments(done)))
                return true
            }
            // Cut off (or too long to send): split this part into smaller ones and run those.
            if depth < AiLongGeneration.maxSplitDepth {
                var smaller: AiPreparedGeneration?
                do {
                    smaller = try await prepare(request {
                        $0.contentMarkdown = segment.markdown
                        $0.segmentation = AiSegmentationRequest(depth: depth + 1)
                    })
                } catch let error as APIError where error.code == "ai_input_too_long" {
                    smaller = nil
                }
                if let children = smaller?.segments, children.count > 1 {
                    for child in children {
                        var nested = child
                        nested.headingPath = segment.headingPath + child.headingPath
                        if !(try await runPart(nested, part: part, index: index, count: count, depth: depth + 1)) { return false }
                    }
                    return true
                }
            }
            // It still cannot finish: keep the source text so nothing is lost, and say which part.
            incomplete.insert(part)
            done.append(AiLongGeneration.joinSegmentResult(segment, segment.markdown))
            emit(AiLongGeneration.event("text-reset", text: AiLongGeneration.joinSegments(done)))
            return true
        }

        for (index, segment) in segments.enumerated() {
            var progress = AiLongGeneration.event("progress")
            progress.part = index + 1
            progress.parts = segments.count
            emit(progress)
            if !(try await runPart(segment, part: index + 1, index: index, count: segments.count, depth: 0)) { return }
        }
        let parts = incomplete.sorted()
        emit(AiLongGeneration.event("text-reset", text: AiLongGeneration.joinSegments(done)))
        var finish = AiLongGeneration.event("finish")
        finish.truncated = !parts.isEmpty
        finish.incompleteParts = parts.isEmpty ? nil : parts
        emit(finish)
    }
}

private final class Draft: @unchecked Sendable {
    private let lock = NSLock()
    private var value = ""
    var text: String { lock.lock(); defer { lock.unlock() }; return value }
    func append(_ text: String) { lock.lock(); value += text; lock.unlock() }
    func set(_ text: String) { lock.lock(); value = text; lock.unlock() }
}

/// Holds the start of a continuation until a repeated seam can be recognised.
private final class Seam: @unchecked Sendable {
    private let lock = NSLock()
    private var held = ""
    private var done = false
    var joined: Bool { lock.lock(); defer { lock.unlock() }; return done }
    func hold(_ text: String) { lock.lock(); held += text; lock.unlock() }
    /// The held text once it is long enough (or the stream ended); `nil` when not yet or already released.
    func release(final: Bool) -> String? {
        lock.lock(); defer { lock.unlock() }
        guard !done, final || held.count >= AiLongGeneration.continuationHoldChars else { return nil }
        done = true
        return held
    }
}
