import Foundation

// MARK: - TipTap content helpers (native Markdown serializer is recovery-only)

enum EditorContentCodec {
    /// TipTap's Markdown extension is authoritative because it understands the complete
    /// registered schema (tables, nested/ordered lists, code languages, links and images).
    /// The native serializer remains only as a recovery path for an absent bridge payload.
    static func preferredMarkdown(
        editorMarkdown: String?,
        documentJSON: String,
        fallback: String
    ) -> String {
        // A present-but-empty payload means the user intentionally cleared the note.
        if let editorMarkdown {
            return editorMarkdown
        }
        if !fallback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return fallback
        }
        return markdownFromTipTapJSON(documentJSON) ?? ""
    }

    static func protectedResourceRefs(in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(
            pattern: #"/api/v1/resources/[A-Za-z0-9_-]+(?:/blob)?"#,
            options: []
        ) else { return [] }
        let ns = text as NSString
        let matches = regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length))
        var seen = Set<String>()
        var refs: [String] = []
        for match in matches {
            let ref = ns.substring(with: match.range)
            if seen.insert(ref).inserted { refs.append(ref) }
        }
        return refs
    }

    static func looksLikeTipTapDoc(_ json: String) -> Bool {
        guard let data = json.data(using: .utf8),
              let doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = doc["type"] as? String
        else { return false }
        return type == "doc"
    }

    static func containsImageNode(_ json: String) -> Bool {
        json.contains("\"type\":\"image\"") || json.contains("\"type\": \"image\"")
    }

    /// Match resource by id so `/blob` vs bare path doesn't look like a missing image.
    static func jsonContainsResource(_ json: String, src: String) -> Bool {
        if json.contains(src) { return true }
        if let id = ResourceCache.resourceId(from: src), json.contains(id) {
            return true
        }
        return false
    }

    static func plainText(markdown: String, json: String) -> String {
        let a = plainTextFromMarkdown(markdown)
        let b = plainTextFromJSON(json)
        return a.count >= b.count ? a : b
    }

    static func plainTextFromMarkdown(_ markdown: String) -> String {
        var s = markdown
        // Strip image / link targets; keep link labels lightly.
        s = s.replacingOccurrences(of: #"!\[[^\]]*\]\([^)]*\)"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\[[^\]]*\]\([^)]*\)"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"[#>*`_~\-]+"#, with: " ", options: .regularExpression)
        return s
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    static func plainTextFromJSON(_ json: String) -> String {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data)
        else { return "" }
        var parts: [String] = []
        collectText(obj, into: &parts)
        return parts.joined(separator: " ")
    }

    private static func collectText(_ any: Any, into parts: inout [String]) {
        if let dict = any as? [String: Any] {
            if let type = dict["type"] as? String, type == "text", let text = dict["text"] as? String, !text.isEmpty {
                parts.append(text)
            }
            if let content = dict["content"] as? [Any] {
                for child in content { collectText(child, into: &parts) }
            }
            return
        }
        if let arr = any as? [Any] {
            for child in arr { collectText(child, into: &parts) }
        }
    }

    /// Best-effort TipTap JSON → markdown so sync wire format keeps body text + images.
    static func markdownFromTipTapJSON(_ json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let content = doc["content"] as? [Any]
        else { return nil }
        var lines: [String] = []
        for node in content {
            guard let dict = node as? [String: Any], let type = dict["type"] as? String else { continue }
            switch type {
            case "paragraph":
                lines.append(inlineMarkdown(dict["content"] as? [Any] ?? []))
            case "heading":
                let level = (dict["attrs"] as? [String: Any])?["level"] as? Int ?? 2
                let prefix = String(repeating: "#", count: min(max(level, 1), 6))
                lines.append("\(prefix) \(inlineMarkdown(dict["content"] as? [Any] ?? []))")
            case "image":
                let attrs = dict["attrs"] as? [String: Any] ?? [:]
                let src = attrs["src"] as? String ?? ""
                let alt = attrs["alt"] as? String ?? ""
                if !src.isEmpty { lines.append("![\(alt)](\(src))") }
            case "bulletList", "orderedList":
                if let items = dict["content"] as? [Any] {
                    for item in items {
                        guard let itemDict = item as? [String: Any] else { continue }
                        let text = blockText(itemDict)
                        if !text.isEmpty { lines.append("- \(text)") }
                    }
                }
            case "blockquote":
                let text = blockText(dict)
                if !text.isEmpty { lines.append("> \(text)") }
            case "codeBlock":
                let text = blockText(dict)
                lines.append("```\n\(text)\n```")
            case "horizontalRule":
                lines.append("---")
            default:
                let text = blockText(dict)
                if !text.isEmpty { lines.append(text) }
            }
        }
        let joined = lines.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return joined.isEmpty ? nil : joined + "\n"
    }

    private static func blockText(_ node: [String: Any]) -> String {
        if let type = node["type"] as? String, type == "text" {
            return node["text"] as? String ?? ""
        }
        guard let content = node["content"] as? [Any] else { return "" }
        return content.compactMap { child -> String? in
            guard let dict = child as? [String: Any] else { return nil }
            if dict["type"] as? String == "image" {
                let attrs = dict["attrs"] as? [String: Any] ?? [:]
                let src = attrs["src"] as? String ?? ""
                let alt = attrs["alt"] as? String ?? ""
                return src.isEmpty ? nil : "![\(alt)](\(src))"
            }
            let t = blockText(dict)
            return t.isEmpty ? nil : t
        }.joined()
    }

    private static func inlineMarkdown(_ content: [Any]) -> String {
        content.compactMap { child -> String? in
            guard let dict = child as? [String: Any] else { return nil }
            if dict["type"] as? String == "hardBreak" { return "\n" }
            if dict["type"] as? String == "text" {
                var t = dict["text"] as? String ?? ""
                let marks = dict["marks"] as? [[String: Any]] ?? []
                // Apply outer marks last so **`code`** style nesting is reasonable.
                for mark in marks.reversed() {
                    switch mark["type"] as? String {
                    case "code":
                        t = "`\(t)`"
                    case "bold", "strong":
                        t = "**\(t)**"
                    case "italic", "em":
                        t = "*\(t)*"
                    case "strike":
                        t = "~~\(t)~~"
                    case "link":
                        let href = (mark["attrs"] as? [String: Any])?["href"] as? String ?? ""
                        t = "[\(t)](\(href))"
                    default:
                        break
                    }
                }
                return t
            }
            return blockText(dict)
        }.joined()
    }

    /// Append image node without wiping existing document content.
    static func appendingImage(toJSON json: String, src: String, alt: String) -> String {
        if json.contains(src) { return json }
        guard let data = json.data(using: .utf8),
              var doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            // Only invent a stub when we truly have no document yet.
            let safeAlt = alt.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            return """
            {"type":"doc","content":[{"type":"paragraph"},{"type":"image","attrs":{"src":"\(src)","alt":"\(safeAlt)"}},{"type":"paragraph"}]}
            """
        }
        var content = doc["content"] as? [[String: Any]] ?? []
        // Avoid blanking a doc that already has text — only append.
        content.append([
            "type": "image",
            "attrs": ["src": src, "alt": alt] as [String: Any],
        ])
        content.append(["type": "paragraph"] as [String: Any])
        doc["type"] = doc["type"] ?? "doc"
        doc["content"] = content
        guard let out = try? JSONSerialization.data(withJSONObject: doc),
              let s = String(data: out, encoding: .utf8)
        else { return json }
        return s
    }
}
