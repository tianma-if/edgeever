import Foundation
import SwiftUI
import WebKit

struct WebClipDraft: Equatable, Sendable {
    var title: String
    var contentMarkdown: String
    var tagsText: String

    var createSeed: CreateMemoSeed {
        CreateMemoSeed(title: title, contentMarkdown: contentMarkdown, tagsText: tagsText)
    }
}

struct RenderedWebPage: Equatable, Sendable {
    var title: String
    var contentHTML: String
    var finalURL: String
}

enum WebClipper {
    static func sharedWebURL(from payloads: [ShareHandoffStore.SharePayload]) -> URL? {
        for payload in payloads {
            for candidate in [payload.url, payload.text].compactMap({ $0 }) {
                guard let range = candidate.range(of: #"https?://[^\s<>\"'）)]+"#, options: .regularExpression),
                      let url = URL(string: String(candidate[range])),
                      url.scheme == "http" || url.scheme == "https"
                else { continue }
                return url
            }
        }
        return nil
    }

    static func isWeChatArticle(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
            && url.host?.lowercased() == "mp.weixin.qq.com"
            && url.path.hasPrefix("/s")
    }

    static func build(_ sourceURL: URL, capturedAt: Date = Date()) async -> WebClipDraft {
        var request = URLRequest(url: sourceURL)
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200 ..< 300).contains(http.statusCode),
                  let html = String(data: data, encoding: .utf8)
                    ?? String(data: data, encoding: .isoLatin1)
            else { return fallback(sourceURL, capturedAt: capturedAt) }
            let finalURL = response.url ?? sourceURL
            let title = extractTitle(html) ?? hostnameTitle(sourceURL)
            let bodyHTML = firstInnerHTML(html, tags: ["article", "main"])
            return buildRendered(
                sourceURL,
                page: RenderedWebPage(title: title, contentHTML: bodyHTML, finalURL: finalURL.absoluteString),
                capturedAt: capturedAt
            )
        } catch {
            return fallback(sourceURL, capturedAt: capturedAt)
        }
    }

    static func buildRendered(
        _ sourceURL: URL,
        page: RenderedWebPage,
        capturedAt: Date = Date()
    ) -> WebClipDraft {
        let title = normalizedText(page.title).nilIfEmpty ?? hostnameTitle(sourceURL)
        let markdown = htmlToMarkdown(page.contentHTML, baseURL: URL(string: page.finalURL) ?? sourceURL)
        guard !markdown.isEmpty else {
            var draft = fallback(sourceURL, capturedAt: capturedAt)
            draft.title = title
            return draft
        }
        return WebClipDraft(
            title: title,
            contentMarkdown: [
                "来源：[\(escapeMarkdown(sourceURL.absoluteString))](\(sourceURL.absoluteString))",
                "剪藏时间：\(ISO8601DateFormatter.edgeEver.string(from: capturedAt))",
                "---",
                markdown,
            ].joined(separator: "\n\n"),
            tagsText: isWeChatArticle(sourceURL) ? "web-clip, wechat" : "web-clip"
        )
    }

    static func fallback(_ sourceURL: URL, capturedAt: Date = Date()) -> WebClipDraft {
        WebClipDraft(
            title: hostnameTitle(sourceURL),
            contentMarkdown: [
                "来源：[\(escapeMarkdown(sourceURL.absoluteString))](\(sourceURL.absoluteString))",
                "剪藏时间：\(ISO8601DateFormatter.edgeEver.string(from: capturedAt))",
                "正文暂时无法抓取，来源链接已保留，可稍后重试。",
            ].joined(separator: "\n\n"),
            tagsText: isWeChatArticle(sourceURL) ? "web-clip, wechat" : "web-clip"
        )
    }

    static func htmlToMarkdown(_ html: String, baseURL: URL) -> String {
        guard !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        var value = replace(html, pattern: #"<!--[\s\S]*?-->"#) { _ in "" }
        value = replace(
            value,
            pattern: #"<(script|style|noscript|template|iframe|svg|canvas)\b[^>]*>[\s\S]*?</\1\s*>"#
        ) { _ in "" }
        value = replace(value, pattern: #"<img\b[^>]*>"#) { match in
            let source = attribute(match, "data-src").nilIfEmpty
                ?? attribute(match, "data-original").nilIfEmpty
                ?? attribute(match, "src").nilIfEmpty
            guard let source, !source.hasPrefix("data:"), let resolved = resolve(source, against: baseURL) else { return "" }
            let alt = normalizedText(attribute(match, "alt")).nilIfEmpty ?? "图片"
            return "\n\n![\(escapeMarkdown(alt))](\(resolved))\n\n"
        }
        value = replace(value, pattern: #"<a\b[^>]*>([\s\S]*?)</a\s*>"#) { match in
            let href = attribute(match, "href")
            let label = normalizedText(stripTags(capture(match, pattern: #"<a\b[^>]*>([\s\S]*?)</a\s*>"#) ?? ""))
            guard !href.isEmpty, !href.lowercased().hasPrefix("javascript:"),
                  let resolved = resolve(href, against: baseURL)
            else { return label }
            return "[\(escapeMarkdown(label.isEmpty ? resolved : label))](\(resolved))"
        }
        value = replace(value, pattern: #"<h([1-6])\b[^>]*>"#) { match in
            let level = Int(capture(match, pattern: #"<h([1-6])\b"#) ?? "1") ?? 1
            return "\n\n\(String(repeating: "#", count: level)) "
        }
        let substitutions: [(String, String)] = [
            (#"</h[1-6]\s*>"#, "\n\n"), (#"<br\s*/?>"#, "\n"),
            (#"<hr\b[^>]*>"#, "\n\n---\n\n"), (#"<li\b[^>]*>"#, "\n- "),
            (#"</li\s*>"#, "\n"), (#"<(strong|b)\b[^>]*>"#, "**"),
            (#"</(strong|b)\s*>"#, "**"), (#"<(em|i)\b[^>]*>"#, "*"),
            (#"</(em|i)\s*>"#, "*"), (#"<code\b[^>]*>"#, "`"),
            (#"</code\s*>"#, "`"), (#"</?blockquote\b[^>]*>"#, "\n\n> "),
            (#"</?(article|aside|div|figure|figcaption|footer|header|main|p|section|table|tbody|td|th|thead|tr)\b[^>]*>"#, "\n\n"),
            (#"</?[a-z][a-z0-9-]*\b[^>]*>"#, ""),
        ]
        for (pattern, replacement) in substitutions {
            value = replace(value, pattern: pattern) { _ in replacement }
        }
        return decodeEntities(value)
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: #"[ \t]+\n"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"\n[ \t]+"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"[ \t]{2,}"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractTitle(_ html: String) -> String? {
        let metas = matches(html, pattern: #"<meta\b[^>]*>"#)
        for key in ["og:title", "twitter:title"] {
            if let tag = metas.first(where: {
                (attribute($0, "property").nilIfEmpty ?? attribute($0, "name")).lowercased() == key
            }), let title = normalizedText(attribute(tag, "content")).nilIfEmpty { return title }
        }
        guard let title = capture(html, pattern: #"<title\b[^>]*>([\s\S]*?)</title\s*>"#) else { return nil }
        return normalizedText(stripTags(title)).nilIfEmpty
    }

    private static func firstInnerHTML(_ html: String, tags: [String]) -> String {
        for tag in tags {
            if let value = capture(html, pattern: "<\(tag)\\b[^>]*>([\\s\\S]*?)</\(tag)\\s*>") { return value }
        }
        return ""
    }

    private static func hostnameTitle(_ url: URL) -> String { url.host ?? "网页剪藏" }
    private static func normalizedText(_ value: String) -> String {
        decodeEntities(value).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private static func stripTags(_ value: String) -> String {
        value.replacingOccurrences(of: #"<[^>]*>"#, with: " ", options: .regularExpression)
    }
    private static func escapeMarkdown(_ value: String) -> String {
        value.replacingOccurrences(of: #"([\[\]])"#, with: #"\\$1"#, options: .regularExpression)
    }
    private static func resolve(_ value: String, against baseURL: URL) -> String? {
        guard let url = URL(string: value, relativeTo: baseURL)?.absoluteURL,
              url.scheme == "http" || url.scheme == "https" else { return nil }
        return url.absoluteString
    }
    private static func attribute(_ tag: String, _ name: String) -> String {
        let pattern = "(?:^|\\s)\(NSRegularExpression.escapedPattern(for: name))\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: tag, range: NSRange(tag.startIndex..., in: tag)) else { return "" }
        for index in 1 ..< match.numberOfRanges where match.range(at: index).location != NSNotFound {
            if let range = Range(match.range(at: index), in: tag) { return decodeEntities(String(tag[range])) }
        }
        return ""
    }
    private static func capture(_ value: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: value) else { return nil }
        return String(value[range])
    }
    private static func matches(_ value: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return [] }
        return regex.matches(in: value, range: NSRange(value.startIndex..., in: value)).compactMap {
            Range($0.range, in: value).map { String(value[$0]) }
        }
    }
    private static func replace(_ value: String, pattern: String, transform: (String) -> String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return value }
        var output = value
        for match in regex.matches(in: value, range: NSRange(value.startIndex..., in: value)).reversed() {
            guard let originalRange = Range(match.range, in: value), let outputRange = Range(match.range, in: output) else { continue }
            output.replaceSubrange(outputRange, with: transform(String(value[originalRange])))
        }
        return output
    }
    private static func decodeEntities(_ value: String) -> String {
        let named = ["amp": "&", "apos": "'", "gt": ">", "hellip": "…", "ldquo": "“", "lsquo": "‘", "lt": "<", "middot": "·", "nbsp": " ", "ndash": "–", "quot": "\"", "rdquo": "”", "rsquo": "’"]
        return replace(value, pattern: #"&(#x?[0-9a-f]+|[a-z][a-z0-9]+);?"#) { entity in
            let key = String(entity.dropFirst().dropLast(entity.hasSuffix(";") ? 1 : 0))
            if key.lowercased().hasPrefix("#x"), let scalar = UInt32(key.dropFirst(2), radix: 16).flatMap(UnicodeScalar.init) { return String(scalar) }
            if key.hasPrefix("#"), let scalar = UInt32(key.dropFirst()).flatMap(UnicodeScalar.init) { return String(scalar) }
            return named[key.lowercased()] ?? entity
        }
    }
}

/// Hidden rendered-page capture used for WeChat pages that server-side fetch cannot reliably read.
struct WebClipCaptureView: UIViewRepresentable {
    let url: URL
    let onCaptured: (RenderedWebPage) -> Void
    let onFailed: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCaptured: onCaptured, onFailed: onFailed) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(context.coordinator, name: "webClip")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onCaptured = onCaptured
        context.coordinator.onFailed = onFailed
        guard context.coordinator.loadedURL != url else { return }
        context.coordinator.loadedURL = url
        view.load(URLRequest(url: url))
        context.coordinator.startTimeout()
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.timeout?.cancel()
        view.stopLoading()
        view.configuration.userContentController.removeScriptMessageHandler(forName: "webClip")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var onCaptured: (RenderedWebPage) -> Void
        var onFailed: (String) -> Void
        var loadedURL: URL?
        var timeout: DispatchWorkItem?
        private var completed = false

        init(onCaptured: @escaping (RenderedWebPage) -> Void, onFailed: @escaping (String) -> Void) {
            self.onCaptured = onCaptured
            self.onFailed = onFailed
        }

        func startTimeout() {
            completed = false
            timeout?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.finishFailure("微信文章加载超时。") }
            timeout = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript(Self.captureScript, completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            finishFailure(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            finishFailure(error.localizedDescription)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard !completed, let body = message.body as? [String: Any], let status = body["status"] as? String else { return }
            if status == "captured", let html = body["contentHtml"] as? String, !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                completed = true
                timeout?.cancel()
                onCaptured(RenderedWebPage(
                    title: body["title"] as? String ?? "",
                    contentHTML: html,
                    finalURL: body["finalUrl"] as? String ?? loadedURL?.absoluteString ?? ""
                ))
            } else {
                finishFailure(body["message"] as? String ?? "没有找到可剪藏的正文。")
            }
        }

        private func finishFailure(_ message: String) {
            guard !completed else { return }
            completed = true
            timeout?.cancel()
            onFailed(message)
        }

        private static let captureScript = #"""
        (function(){
          var attempts=0, completed=false;
          function send(value){ if(completed)return; completed=true; window.webkit.messageHandlers.webClip.postMessage(value); }
          function text(selector){ var el=document.querySelector(selector); return el&&el.textContent?el.textContent.trim():""; }
          function capture(){
            var content=document.getElementById("js_content")||document.querySelector("article")||document.querySelector("main");
            if(content && content.textContent && content.textContent.trim()){
              var meta=document.querySelector('meta[property="og:title"],meta[name="twitter:title"]');
              send({status:"captured",title:(meta&&meta.getAttribute("content"))||text("#activity-name")||text(".rich_media_title")||document.title||"",contentHtml:content.innerHTML,finalUrl:location.href}); return;
            }
            var error=text(".weui-msg__title")||text(".weui-msg__desc");
            if(error){send({status:"failed",message:error});return;}
            attempts++; if(attempts>=50){send({status:"failed",message:"页面加载完成，但没有找到可剪藏的正文。"});return;}
            setTimeout(capture,250);
          }
          capture();
        })();
        """#
    }
}

private extension String {
    var nilIfEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
