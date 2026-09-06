import Foundation

/// Pure policy for which TipTap payload to push (JSON vs Markdown).
/// Extracted so unit tests can lock viewer Markdown rendering without a simulator UI path.
enum TipTapContentSource: Sendable {
    struct Decision: Equatable, Sendable {
        var useJSON: Bool
        var payload: String
        var fingerprint: String
    }

    private static let emptyStub = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}"

    static func resolve(mode: TipTapMode, documentJSON: String, markdown: String) -> Decision {
        let json = documentJSON.trimmingCharacters(in: .whitespacesAndNewlines)
        let mdTrim = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
        let jsonUsable = !json.isEmpty && json != emptyStub

        // Detail/viewer: prefer JSON when it carries image width attrs (markdown drops them).
        // Fall back to markdown for empty/stub JSON or when markdown encodes richer structure
        // (tables / headings) that a flattened contentJson lost.
        if mode == .viewer {
            // Visual diagram metadata lives only in Markdown. The editor bundle
            // converts both current and legacy envelopes into a Mermaid view.
            if markdown.contains("<!-- edgeever-diagram-v1:") {
                return Decision(useJSON: false, payload: markdown, fingerprint: "md:\(markdown)")
            }
            if jsonUsable {
                if jsonHasImageWidth(json) {
                    return Decision(useJSON: true, payload: documentJSON, fingerprint: "json:\(json)")
                }
                if !mdTrim.isEmpty, markdownIsStructurallyRicher(markdown, thanJSON: json) {
                    return Decision(useJSON: false, payload: markdown, fingerprint: "md:\(markdown)")
                }
                // Non-empty JSON still preferred so image nodes keep nodeView + ⋯ chrome.
                return Decision(useJSON: true, payload: documentJSON, fingerprint: "json:\(json)")
            }
            if !mdTrim.isEmpty {
                return Decision(useJSON: false, payload: markdown, fingerprint: "md:\(markdown)")
            }
        }

        // Editor: open from markdown when it encodes richer structure than JSON
        // (demo / web-authored notes), so the user does not edit flattened plain text.
        if mode == .editor, !mdTrim.isEmpty, markdownIsStructurallyRicher(markdown, thanJSON: json) {
            return Decision(useJSON: false, payload: markdown, fingerprint: "md:\(markdown)")
        }

        if jsonUsable {
            return Decision(useJSON: true, payload: documentJSON, fingerprint: "json:\(json)")
        }
        return Decision(useJSON: false, payload: markdown, fingerprint: "md:\(markdown)")
    }

    /// True when TipTap JSON stores at least one image `width` (25–100 display size).
    static func jsonHasImageWidth(_ json: String) -> Bool {
        // Match `"width":50` / `"width": 50` near image nodes without full parse.
        json.range(of: #""width"\s*:\s*\d+"#, options: .regularExpression) != nil
    }

    static func markdownIsStructurallyRicher(_ markdown: String, thanJSON json: String) -> Bool {
        let markdownHasMath = markdown.range(
            of: #"(?s)(?<!\\)\$\$.*?(?<!\\)\$\$|(?<!\\)\$(?!\$|\d)[^\n$]+?(?<!\\)\$"#,
            options: .regularExpression
        ) != nil
        let jsonHasMath = json.contains(#""type":"inlineMath""#)
            || json.contains(#""type": "inlineMath""#)
            || json.contains(#""type":"blockMath""#)
            || json.contains(#""type": "blockMath""#)
        if markdownHasMath && !jsonHasMath {
            return true
        }

        let markdownHasTaskList = markdown.range(
            of: #"(?m)^\s*[-*+]\s+\[[ xX]\]\s*"#,
            options: .regularExpression
        ) != nil
        let jsonHasTaskList = json.contains(#""type":"taskList""#)
            || json.contains(#""type": "taskList""#)
        if markdownHasTaskList && !jsonHasTaskList {
            return true
        }

        let md = structureScore(markdown: markdown)
        let js = structureScore(json: json)
        return md >= 2 && md > js
    }

    static func structureScore(markdown: String) -> Int {
        var score = 0
        if markdown.contains("```") { score += 3 }
        if markdown.range(of: #"(?m)^#{1,6}\s+\S"#, options: .regularExpression) != nil { score += 3 }
        if markdown.contains("|") && markdown.contains("\n") { score += 2 }
        if markdown.range(of: #"(?m)^(\s*[-*+]|\s*\d+\.)\s+\S"#, options: .regularExpression) != nil { score += 2 }
        if markdown.range(of: #"(?m)^>\s+\S"#, options: .regularExpression) != nil { score += 1 }
        if markdown.contains("**") || markdown.contains("__") { score += 1 }
        if markdown.contains("![") { score += 1 }
        if markdown.contains("$$") { score += 3 }
        return score
    }

    static func structureScore(json: String) -> Int {
        guard !json.isEmpty else { return 0 }
        var score = 0
        if json.contains("\"heading\"") { score += 3 }
        if json.contains("\"table\"") || json.contains("\"tableRow\"") { score += 2 }
        if json.contains("\"codeBlock\"") { score += 3 }
        if json.contains("\"bulletList\"") || json.contains("\"orderedList\"") || json.contains("\"taskList\"") { score += 2 }
        if json.contains("\"blockquote\"") { score += 1 }
        if json.contains("\"bold\"") || json.contains("\"italic\"") { score += 1 }
        if json.contains("\"type\":\"image\"") || json.contains("\"type\": \"image\"") { score += 1 }
        if json.contains("\"inlineMath\"") || json.contains("\"blockMath\"") { score += 3 }
        return score
    }
}
