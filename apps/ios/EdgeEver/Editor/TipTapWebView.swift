import CryptoKit
import SwiftUI
import WebKit

enum TipTapMode: String {
    case viewer
    case editor
}

/// SwiftUI surface that **reuses** a long-lived TipTap `WKWebView` per mode.
/// Crossing notes only re-parents the web view and calls setContent — no EditorBundle reload.
struct TipTapWebView: UIViewRepresentable {
    let mode: TipTapMode
    let documentJSON: String
    let markdown: String
    let baseURL: URL?
    let token: String?
    let locale: String
    let theme: String
    let placeholder: String
    let onChange: ((String, String) -> Void)?
    var onResourcePress: ((ResourceTarget) -> Void)? = nil
    var onImagePreview: ((_ source: String, _ alt: String) -> Void)? = nil
    var onPickImage: (() -> Void)? = nil
    var onSearchResult: ((_ count: Int, _ index: Int) -> Void)? = nil
    var onImageExportEvent: (([String: Any]) -> Void)? = nil
    var onBodyReady: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> TipTapHostView {
        let host = TipTapHostView()
        host.backgroundColor = .clear
        host.clipsToBounds = true
        return host
    }

    func updateUIView(_ host: TipTapHostView, context: Context) {
        context.coordinator.parent = self
        let runtime = context.coordinator.runtime
        runtime.attach(to: host)
        runtime.bind(
            TipTapSession(
                mode: mode,
                documentJSON: documentJSON,
                markdown: markdown,
                baseURL: baseURL,
                token: token,
                locale: locale,
                theme: theme,
                placeholder: placeholder,
                onChange: onChange,
                onResourcePress: onResourcePress,
                onImagePreview: onImagePreview,
                onPickImage: onPickImage,
                onSearchResult: onSearchResult,
                onImageExportEvent: onImageExportEvent,
                onBodyReady: onBodyReady
            )
        )
    }

    static func dismantleUIView(_ host: TipTapHostView, coordinator: Coordinator) {
        coordinator.runtime.detach(from: host)
    }

    /// Lightweight coordinator — the heavy engine lives in `SharedTipTapRuntime`.
    final class Coordinator {
        var parent: TipTapWebView
        let runtime: SharedTipTapRuntime

        init(_ parent: TipTapWebView) {
            self.parent = parent
            self.runtime = parent.mode == .viewer ? .viewer : .editor
        }

        // MARK: - Test / call-site surface (forwards to TipTapResourceLoader)

        static func loadResourceDataURL(
            source: String,
            baseURL: URL?,
            token: String?,
            resourceCache: ResourceCache
        ) async -> String? {
            await TipTapResourceLoader.loadResourceDataURL(
                source: source, baseURL: baseURL, token: token, resourceCache: resourceCache
            )
        }

        static func hydrateImageSourcesInJSON(
            _ json: String,
            baseURL: URL?,
            token: String?,
            resourceCache: ResourceCache
        ) async -> String {
            await TipTapResourceLoader.hydrateImageSourcesInJSON(
                json, baseURL: baseURL, token: token, resourceCache: resourceCache
            )
        }

        static func hydrateImageSourcesInMarkdown(
            _ markdown: String,
            baseURL: URL?,
            token: String?,
            resourceCache: ResourceCache
        ) async -> String {
            await TipTapResourceLoader.hydrateImageSourcesInMarkdown(
                markdown, baseURL: baseURL, token: token, resourceCache: resourceCache
            )
        }

        static func isSvgData(_ data: Data) -> Bool { TipTapResourceLoader.isSvgData(data) }
        static func sniffImageMime(_ data: Data) -> String { TipTapResourceLoader.sniffImageMime(data) }
        static func resolvedImageMime(header: String?, data: Data) -> String {
            TipTapResourceLoader.resolvedImageMime(header: header, data: data)
        }

        static func packagedEditorHTMLURL() -> URL? {
            TipTapResourceLoader.packagedEditorHTMLURL()
        }
    }
}

// MARK: - Resource loading (shared with tests + runtime)

enum TipTapResourceLoader {
    static func packagedEditorHTMLURL() -> URL? {
        let candidates: [URL?] = [
            Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "EditorBundle"),
            Bundle.main.url(forResource: "index", withExtension: "html"),
        ]
        for case let url? in candidates {
            if let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
               let size = values.fileSize,
               size > 100_000
            {
                return url
            }
            if FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }
        return nil
    }

    static func jsCall(fn: String, arg: String) -> String {
        let b64 = Data(arg.utf8).base64EncodedString()
        return """
        (function(){
          try {
            if (!window.EdgeEverEditor) return;
            var bin = atob('\(b64)');
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            var text = new TextDecoder('utf-8').decode(bytes);
            window.EdgeEverEditor.\(fn)(text);
          } catch (e) {
            try { window.webkit.messageHandlers.edgeever.postMessage({type:'error', message: String(e)}); } catch (_) {}
          }
        })();
        """
    }

    static func loadResourceDataURL(
        source: String,
        baseURL: URL?,
        token: String?,
        resourceCache: ResourceCache
    ) async -> String? {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("data:") || trimmed.hasPrefix("edgeever-res:") {
            return trimmed
        }

        let protected = ResourceCache.isProtectedResourceSource(trimmed, baseURL: baseURL)
        if protected {
            let base = baseURL ?? baseURLFromAbsoluteSource(trimmed)
            guard let base else { return nil }
            let path = ResourceCache.normalizeProtectedResourcePath(trimmed, baseURL: base)
            let id = ResourceCache.resourceId(from: path) ?? path

            if let cached = await resourceCache.cachedData(for: id) {
                let mime = resolvedImageMime(header: nil, data: cached)
                _ = try? await resourceCache.dataURL(for: id, data: cached, mimeType: mime)
                return await displayURL(for: id, data: cached, mimeType: mime)
            }

            let client = APIClient(baseURL: base, token: token)
            do {
                let result = try await client.getResourceData(path: path)
                let mime = resolvedImageMime(header: result.mimeType, data: result.data)
                _ = try? await resourceCache.dataURL(for: id, data: result.data, mimeType: mime)
                return await displayURL(for: id, data: result.data, mimeType: mime)
            } catch {
                #if DEBUG
                print("TipTapResourceLoader: getResourceData failed path=\(path) error=\(error)")
                #endif
                return nil
            }
        }

        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://"),
           let absolute = URL(string: trimmed)
        {
            let client = APIClient(baseURL: baseURL ?? absolute, token: nil)
            do {
                let result = try await client.getPublicURLData(absolute)
                let mime = resolvedImageMime(header: result.mimeType, data: result.data)
                let id = publicResourceId(for: trimmed)
                return await displayURL(for: id, data: result.data, mimeType: mime)
            } catch {
                return nil
            }
        }

        if trimmed.hasPrefix("/"), let base = baseURL {
            let absolute = base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + trimmed
            if let url = URL(string: absolute) {
                let client = APIClient(baseURL: base, token: token)
                if let result = try? await client.getPublicURLData(url) {
                    let mime = resolvedImageMime(header: result.mimeType, data: result.data)
                    let id = publicResourceId(for: absolute)
                    return await displayURL(for: id, data: result.data, mimeType: mime)
                }
            }
        }
        return nil
    }

    static func displayURL(for resourceId: String, data: Data, mimeType: String) async -> String {
        let mime = resolvedImageMime(header: mimeType, data: data)
        if mime.contains("svg") || isSvgData(data) {
            return "data:image/svg+xml;base64,\(data.base64EncodedString())"
        }
        await ResourceBlobStore.shared.put(id: resourceId, data: data, mimeType: mime)
        return EdgeEverResourceSchemeHandler.localURL(for: resourceId)
    }

    static func resolvedImageMime(header: String?, data: Data) -> String {
        let headerMime = (header ?? "")
            .split(separator: ";")
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        if headerMime.hasPrefix("image/") || headerMime == "image/svg+xml" {
            if isSvgData(data) { return "image/svg+xml" }
            return headerMime
        }
        if isSvgData(data) { return "image/svg+xml" }
        if headerMime.hasPrefix("application/") && !headerMime.contains("octet-stream") {
            if isSvgData(data) { return "image/svg+xml" }
        }
        return sniffImageMime(data)
    }

    static func isSvgData(_ data: Data) -> Bool {
        guard let head = String(data: data.prefix(256), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        else { return false }
        return head.hasPrefix("<svg") || (head.hasPrefix("<?xml") && head.contains("<svg"))
    }

    static func baseURLFromAbsoluteSource(_ source: String) -> URL? {
        guard let url = URL(string: source),
              let scheme = url.scheme,
              let host = url.host
        else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        return components.url?.edgeEverNormalizedBase
    }

    static func publicResourceId(for source: String) -> String {
        let digest = SHA256.hash(data: Data(source.utf8))
        return "pub-" + digest.map { String(format: "%02x", $0) }.joined()
    }

    static func sniffImageMime(_ data: Data) -> String {
        if isSvgData(data) { return "image/svg+xml" }
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if data.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if data.count >= 12 {
            let riff = data.prefix(4)
            let webp = data.dropFirst(8).prefix(4)
            if riff.elementsEqual([0x52, 0x49, 0x46, 0x46]), webp.elementsEqual([0x57, 0x45, 0x42, 0x50]) {
                return "image/webp"
            }
        }
        if data.starts(with: [0x47, 0x49, 0x46, 0x38]) { return "image/gif" }
        return "image/jpeg"
    }

    static func hydrateImageSourcesInJSON(
        _ json: String,
        baseURL: URL?,
        token: String?,
        resourceCache: ResourceCache
    ) async -> String {
        guard
            let data = json.data(using: .utf8),
            var root = try? JSONSerialization.jsonObject(with: data)
        else { return json }
        await replaceImageSources(in: &root, baseURL: baseURL, token: token, resourceCache: resourceCache)
        guard
            let out = try? JSONSerialization.data(withJSONObject: root, options: []),
            let text = String(data: out, encoding: .utf8)
        else { return json }
        return text
    }

    static func hydrateImageSourcesInMarkdown(
        _ markdown: String,
        baseURL: URL?,
        token: String?,
        resourceCache: ResourceCache
    ) async -> String {
        let pattern = #"!\[([^\]]*)\]\(([^)]+)\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return markdown }
        let ns = markdown as NSString
        let matches = regex.matches(in: markdown, range: NSRange(location: 0, length: ns.length))
        var result = markdown
        for match in matches.reversed() {
            guard match.numberOfRanges >= 3,
                  let srcRange = Range(match.range(at: 2), in: result)
            else { continue }
            let src = String(result[srcRange]).trimmingCharacters(in: .whitespacesAndNewlines)
            if src.hasPrefix("data:") || src.hasPrefix("edgeever-res:") { continue }
            guard let display = await loadResourceDataURL(
                source: src, baseURL: baseURL, token: token, resourceCache: resourceCache
            ) else { continue }
            result.replaceSubrange(srcRange, with: display)
        }
        return result
    }

    private static func replaceImageSources(
        in node: inout Any,
        baseURL: URL?,
        token: String?,
        resourceCache: ResourceCache
    ) async {
        if var dict = node as? [String: Any] {
            if dict["type"] as? String == "image",
               var attrs = dict["attrs"] as? [String: Any]
            {
                if let src = attrs["src"] as? String,
                   !src.hasPrefix("data:"),
                   !src.hasPrefix("edgeever-res:"),
                   !src.hasPrefix("blob:"),
                   let display = await loadResourceDataURL(
                       source: src, baseURL: baseURL, token: token, resourceCache: resourceCache
                   )
                {
                    attrs["src"] = display
                }
                if let width = attrs["width"] as? Int {
                    attrs["data-width"] = String(width)
                    attrs["width"] = NSNull()
                } else if let width = attrs["width"] as? Double {
                    attrs["data-width"] = String(Int(width))
                    attrs["width"] = NSNull()
                } else if let width = attrs["width"] as? String,
                          width.range(of: #"^\d+$"#, options: .regularExpression) != nil
                {
                    attrs["data-width"] = width
                    attrs["width"] = NSNull()
                }
                dict["attrs"] = attrs
            }
            for key in dict.keys {
                guard var child = dict[key] else { continue }
                await replaceImageSources(in: &child, baseURL: baseURL, token: token, resourceCache: resourceCache)
                dict[key] = child
            }
            node = dict
        } else if var arr = node as? [Any] {
            for i in arr.indices {
                var child = arr[i]
                await replaceImageSources(in: &child, baseURL: baseURL, token: token, resourceCache: resourceCache)
                arr[i] = child
            }
            node = arr
        }
    }

    static let fallbackHTML = """
    <!DOCTYPE html>
    <html>
    <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <style>
      html,body{margin:0;padding:12px;font: -apple-system-body; font-family: -apple-system, sans-serif; background: transparent; color: #111;}
      #editor{min-height:50vh;outline:none;line-height:1.55;white-space:pre-wrap;}
      #editor:empty:before{content:attr(data-placeholder);color:#94a3b8;}
      img{max-width:100%;}
    </style>
    </head>
    <body>
    <div id="editor" contenteditable="false" data-placeholder="开始书写…"></div>
    <script>
    (function(){
      const editor = document.getElementById('editor');
      let mode = 'viewer';
      let suppress = false;
      function post(msg){
        try { window.webkit.messageHandlers.edgeever.postMessage(msg); } catch(e) {}
      }
      function mdToHtml(md){
        if(!md) return '<p><br></p>';
        return md
          .replace(/&/g,'&amp;').replace(/</g,'&lt;')
          .replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<img alt="$1" src="$2">')
          .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
          .replace(/^### (.+)$/gm, '<h3>$1</h3>')
          .replace(/^## (.+)$/gm, '<h2>$1</h2>')
          .replace(/^# (.+)$/gm, '<h1>$1</h1>')
          .replace(/^- (.+)$/gm, '<li>$1</li>')
          .replace(/(<li>.*<\\/li>\\n?)+/g, m => '<ul>'+m+'</ul>')
          .replace(/\\n\\n/g, '</p><p>')
          .replace(/\\n/g, '<br>');
      }
      function htmlToMd(html){
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        let text = tmp.innerText || tmp.textContent || '';
        return text;
      }
      window.EdgeEverEditor = {
        configure(opts){
          mode = opts.mode || 'viewer';
          editor.contentEditable = mode === 'editor' ? 'true' : 'false';
        },
        setMarkdown(md){
          suppress = true;
          editor.innerHTML = mdToHtml(md || '');
          suppress = false;
        },
        setDocumentFromJSON(json){
          try { JSON.parse(json); } catch(e) {}
        },
        resolveResource(){},
        getMarkdown(){ return htmlToMd(editor.innerHTML); }
      };
      editor.addEventListener('input', () => {
        if (suppress || mode !== 'editor') return;
        const md = htmlToMd(editor.innerHTML);
        post({ type: 'change', contentMarkdown: md, contentJson: JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:md}]}]}) });
      });
      post({ type: 'ready', startupMs: 0 });
    })();
    </script>
    </body>
    </html>
    """
}
