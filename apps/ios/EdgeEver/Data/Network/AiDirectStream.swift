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
