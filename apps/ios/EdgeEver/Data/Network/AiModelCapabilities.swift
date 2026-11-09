import Foundation

/// A model's output and context limits (#652). Mirrors `packages/shared/src/ai-model-capabilities.ts`:
/// a shared window (input and output fit together) or independent input and output limits.
struct AiModelCapabilityLimits: Equatable, Sendable, Encodable {
    var maxOutputTokens: Int?
    var maxInputTokens: Int?
    /// Shared window that input and output must fit into together.
    var contextWindowTokens: Int?
    var source: String

    var hasLimits: Bool { maxOutputTokens != nil || maxInputTokens != nil || contextWindowTokens != nil }

    static let noLimits = AiModelCapabilityLimits(maxOutputTokens: nil, maxInputTokens: nil, contextWindowTokens: nil, source: "none")

    // Nulls are sent explicitly: the instance requires every field.
    private enum CodingKeys: String, CodingKey { case maxOutputTokens, maxInputTokens, contextWindowTokens, source }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(maxOutputTokens, forKey: .maxOutputTokens)
        try container.encode(maxInputTokens, forKey: .maxInputTokens)
        try container.encode(contextWindowTokens, forKey: .contextWindowTokens)
        try container.encode(source, forKey: .source)
    }
}

/// Where to report limits for the model a prepare used (#652).
struct AiModelCapabilityTarget: Decodable, Equatable, Sendable {
    var providerConfigId: String
    var modelConfigId: String
    var configVersion: String
}

/// Reads limits from provider metadata and errors. Same rules as the shared TypeScript module;
/// both sides run the cases in `packages/shared/test-fixtures/model-capabilities`.
enum AiModelCapabilityParser {
    static let maxTokens = 100_000_000

    /// A positive whole number within range; booleans, fractions and other types are unknown.
    static func positiveTokens(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double.rounded() == double, double > 0, double <= Double(maxTokens) else { return nil }
        return Int(double)
    }

    private static func records(_ body: [String: Any]?, _ key: String) -> [[String: Any]] {
        (body?[key] as? [Any])?.compactMap { $0 as? [String: Any] } ?? []
    }

    private static func limits(_ output: Int?, _ input: Int?, _ window: Int?, _ source: String) -> AiModelCapabilityLimits? {
        let result = AiModelCapabilityLimits(maxOutputTokens: output, maxInputTokens: input, contextWindowTokens: window, source: source)
        return result.hasLimits ? result : nil
    }

    /// Read limits from one metadata response; `nil` when it has nothing usable.
    /// `endpoint` is `model`, `models` or `litellm-model-info`.
    static func parse(provider: String, modelId: String, endpoint: String, body: Any?) -> AiModelCapabilityLimits? {
        let body = body as? [String: Any]
        if provider == "anthropic" {
            // `GET /v1/models/{id}` or the list: `max_tokens` and the shared `max_input_tokens` window.
            let model = body.flatMap { $0["max_tokens"] != nil ? $0 : nil }
                ?? records(body, "data").first { ($0["id"] as? String) == modelId }
            guard let model else { return nil }
            return limits(positiveTokens(model["max_tokens"]), nil, positiveTokens(model["max_input_tokens"]), "anthropic-models")
        }
        if provider == "google" {
            // `models.get` / `models.list`: independent `inputTokenLimit` and `outputTokenLimit`.
            let bare = modelId.hasPrefix("models/") ? String(modelId.dropFirst("models/".count)) : modelId
            let matches: ([String: Any]) -> Bool = { item in
                let name = item["name"] as? String
                return name == "models/\(bare)" || name == bare || (item["baseModelId"] as? String) == bare
            }
            let model = body.flatMap { $0["outputTokenLimit"] != nil || $0["inputTokenLimit"] != nil ? $0 : nil }
                ?? records(body, "models").first(where: matches)
            guard let model else { return nil }
            return limits(positiveTokens(model["outputTokenLimit"]), positiveTokens(model["inputTokenLimit"]), nil, "gemini-models")
        }
        if endpoint == "litellm-model-info" {
            // LiteLLM `GET /model/info`: independent `max_input_tokens` and `max_output_tokens`.
            let model = records(body, "data").first { ($0["model_name"] as? String) == modelId }
            guard let info = model?["model_info"] as? [String: Any] else { return nil }
            return limits(positiveTokens(info["max_output_tokens"]), positiveTokens(info["max_input_tokens"]), nil, "litellm-model-info")
        }
        // OpenAI-compatible `GET /models`: OpenRouter and DeepSeek extend the model objects.
        guard let model = records(body, "data").first(where: { ($0["id"] as? String) == modelId }) else { return nil }
        let topProvider = model["top_provider"] as? [String: Any]
        if topProvider != nil || model.keys.contains("context_length") {
            let window = positiveTokens(topProvider?["context_length"]) ?? positiveTokens(model["context_length"])
            return limits(positiveTokens(topProvider?["max_completion_tokens"]), nil, window, "openrouter-models")
        }
        if model.keys.contains("max_output_tokens") || model.keys.contains("context_window") {
            return limits(positiveTokens(model["max_output_tokens"]), nil, positiveTokens(model["context_window"]), "deepseek-models")
        }
        return nil
    }

    /// Best-effort: the accepted output limit from a provider's "too many output tokens" error.
    static func outputLimit(fromError message: String) -> Int? {
        let patterns: [(String, (Int) -> Int)] = [
            // Anthropic: "max_tokens: 128001 > 64000, which is the maximum allowed ..."
            (#"max_tokens:\s*\d+\s*>\s*(\d+)"#, { $0 }),
            // OpenAI: "This model supports at most 4096 completion tokens"
            (#"supports at most\s+(\d+)\s+completion tokens"#, { $0 }),
            // Gemini: "... supported range is from 1 (inclusive) to 65537 (exclusive)"
            (#"supported range is from\s+\d+\s+\(inclusive\)\s+to\s+(\d+)\s+\(exclusive\)"#, { $0 - 1 }),
            // Generic: "max_tokens must be less than or equal to 8192" / "<= 8192"
            (#"max(?:imum)?[_ ](?:completion[_ ]|output[_ ])?tokens?[^0-9]{0,40}(?:<=|less than or equal to|at most)\s*(\d+)"#, { $0 }),
        ]
        let range = NSRange(message.startIndex..., in: message)
        for (pattern, adjust) in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                  let match = regex.firstMatch(in: message, range: range),
                  let captured = Range(match.range(at: 1), in: message),
                  let value = Int(message[captured]) else { continue }
            if let limit = positiveTokens(NSNumber(value: adjust(value))) { return limit }
        }
        return nil
    }
}

// MARK: - models.dev

/// The public models.dev catalogue (#652), used only when the provider reports no limits.
/// Same rules as `packages/shared/src/ai-models-dev.ts`; both sides run the cases in
/// `packages/shared/test-fixtures/models-dev`.
struct ModelsDevIndex: Sendable {
    struct RawLimit: Sendable { var context: Int?; var input: Int?; var output: Int? }
    struct Entry: Sendable {
        var provider: String
        var modelKey: String
        /// `vendor/model` from `canonical_model_id`, lower case.
        var canonical: String?
        var raw: RawLimit
        var limits: AiModelCapabilityLimits
    }

    static let catalogURL = URL(string: "https://models.dev/api.json")!

    /// Provider key -> lower-case model key -> entry.
    private(set) var providers: [String: [String: Entry]] = [:]
    /// Lower-case API host -> provider keys.
    private(set) var hosts: [String: [String]] = [:]
    /// Lower-case model key, canonical ID, or canonical model part without a `/` -> entries.
    private(set) var ids: [String: [Entry]] = [:]
    private(set) var size = 0

    /// `with input`: independent limits, plus the shared window only when input + output exceed it.
    /// Without input, `context` is a window shared by input and output.
    static func mapLimit(_ raw: RawLimit) -> AiModelCapabilityLimits? {
        let window: Int?
        if let input = raw.input {
            window = raw.context.flatMap { input + (raw.output ?? 0) > $0 ? $0 : nil }
        } else {
            window = raw.context
        }
        let result = AiModelCapabilityLimits(maxOutputTokens: raw.output, maxInputTokens: raw.input, contextWindowTokens: window, source: "models-dev")
        return result.hasLimits ? result : nil
    }

    static func readLimit(_ value: Any?) -> RawLimit? {
        guard let record = value as? [String: Any] else { return nil }
        return RawLimit(
            context: AiModelCapabilityParser.positiveTokens(record["context"]),
            input: AiModelCapabilityParser.positiveTokens(record["input"]),
            output: AiModelCapabilityParser.positiveTokens(record["output"])
        )
    }

    static func host(of url: String) -> String? {
        guard let components = URLComponents(string: url.trimmingCharacters(in: .whitespaces)),
              let host = components.host, !host.isEmpty else { return nil }
        return (components.port.map { "\(host):\($0)" } ?? host).lowercased()
    }

    /// Build the lookup from the `api.json` body; `nil` when the body is not a catalogue.
    init?(body: Any?) {
        guard let root = body as? [String: Any] else { return nil }
        for (providerKey, providerValue) in root {
            guard let provider = providerValue as? [String: Any], let models = provider["models"] as? [String: Any] else { continue }
            let key = providerKey.lowercased()
            if let api = provider["api"] as? String, let host = Self.host(of: api) {
                hosts[host, default: []].append(key)
            }
            var entries: [String: Entry] = [:]
            for (modelKey, modelValue) in models {
                guard let model = modelValue as? [String: Any], let raw = Self.readLimit(model["limit"]), let limits = Self.mapLimit(raw) else { continue }
                let canonicalId = (model["canonical_model_id"] as? String).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                let canonical = canonicalId?.contains("/") == true ? canonicalId : nil
                let entry = Entry(provider: key, modelKey: modelKey.lowercased(), canonical: canonical, raw: raw, limits: limits)
                entries[entry.modelKey] = entry
                add(entry.modelKey, entry)
                if let canonical {
                    add(canonical, entry)
                    // A bare ID (no `/`) may match the canonical model part; a prefixed ID must match in full.
                    let modelPart = Self.modelPart(of: canonical)
                    if !modelPart.contains("/") { add(modelPart, entry) }
                }
                size += 1
            }
            if !entries.isEmpty { providers[key] = entries }
        }
        if size == 0 { return nil }
    }

    private mutating func add(_ key: String, _ entry: Entry) {
        var list = ids[key] ?? []
        if !list.contains(where: { $0.provider == entry.provider && $0.modelKey == entry.modelKey }) { list.append(entry) }
        ids[key] = list
    }

    private static func vendor(of canonical: String) -> String {
        String(canonical[..<(canonical.firstIndex(of: "/") ?? canonical.endIndex)])
    }

    private static func modelPart(of canonical: String) -> String {
        guard let slash = canonical.firstIndex(of: "/") else { return canonical }
        return String(canonical[canonical.index(after: slash)...])
    }

    /// Relay listings that disagree: the lower median of each number, mapped like one listing.
    /// An input limit counts only when at least half the listings have one.
    private static func combine(_ entries: [Entry]) -> AiModelCapabilityLimits? {
        func lowerMedian(_ values: [Int]) -> Int? {
            guard !values.isEmpty else { return nil }
            return values.sorted()[(values.count - 1) / 2]
        }
        let inputs = entries.compactMap { $0.raw.input }
        return mapLimit(RawLimit(
            context: lowerMedian(entries.compactMap { $0.raw.context }),
            input: inputs.count * 2 >= entries.count ? lowerMedian(inputs) : nil,
            output: lowerMedian(entries.compactMap { $0.raw.output })
        ))
    }

    /// The catalogue providers that describe this endpoint, from its host or provider type.
    private func endpointProviders(provider: String, baseUrl: String) -> [String] {
        let host = Self.host(of: baseUrl)
        var keys = host.flatMap { hosts[$0] } ?? []
        if host == "api.openai.com" { keys.append("openai") }
        if provider == "anthropic" { keys.append("anthropic") }
        if provider == "google" { keys.append("google") }
        return keys
    }

    /// Exact, case-insensitive matching; an unknown prefix is never removed to find a match.
    func match(provider: String, baseUrl: String, modelId: String) -> AiModelCapabilityLimits? {
        var id = modelId.trimmingCharacters(in: .whitespaces)
        if id.lowercased().hasPrefix("models/") { id = String(id.dropFirst("models/".count)) }
        id = id.lowercased()
        guard !id.isEmpty else { return nil }
        for key in endpointProviders(provider: provider, baseUrl: baseUrl) {
            if let entry = providers[key]?[id] { return entry.limits }
        }
        guard let candidates = ids[id], !candidates.isEmpty else { return nil }
        // The original vendor's listing, looked up under the canonical IDs the candidates record.
        var seen = Set<String>()
        for canonical in candidates.compactMap(\.canonical) where seen.insert(canonical).inserted {
            let own = providers[Self.vendor(of: canonical)]
            if let entry = own?[Self.modelPart(of: canonical)] ?? (id.contains("/") ? nil : own?[id]) {
                return entry.limits
            }
        }
        return Self.combine(candidates)
    }
}
