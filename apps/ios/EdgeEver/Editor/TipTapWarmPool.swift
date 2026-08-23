import Foundation
import UIKit
import WebKit

/// Active binding from a SwiftUI `TipTapWebView` surface onto a shared runtime.
struct TipTapSession {
    var mode: TipTapMode
    var documentJSON: String
    var markdown: String
    var baseURL: URL?
    var token: String?
    var locale: String
    var theme: String
    var placeholder: String
    var onChange: ((String, String) -> Void)?
    var onResourcePress: ((ResourceTarget) -> Void)?
    var onImagePreview: ((_ source: String, _ alt: String) -> Void)?
    var onPickImage: (() -> Void)?
    var onSearchResult: ((_ count: Int, _ index: Int) -> Void)?
    var onImageExportEvent: (([String: Any]) -> Void)?
    var onBodyReady: (() -> Void)?
}

struct AiEditorSelection: Decodable, Sendable, Identifiable {
    var from: Int
    var to: Int
    var markdown: String
    var text: String

    var id: String { "\(from):\(to)" }
}

/// One long-lived TipTap WKWebView per mode (viewer / editor).
/// Note switches re-parent the same web view and only call setContent — no 4MB bundle reload.
@MainActor
final class SharedTipTapRuntime: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    enum Slot: String {
        case viewer
        case editor
    }

    static let viewer = SharedTipTapRuntime(slot: .viewer)
    static let editor = SharedTipTapRuntime(slot: .editor)

    static let processPool = WKProcessPool()

    let slot: Slot
    let webView: WKWebView
    private let resourceCache = ResourceCache()
    /// Retained — WKWebViewConfiguration does not keep a strong ref that we own.
    private let schemeHandler: EdgeEverResourceSchemeHandler

    private var ready = false
    private var lastPushedJSON: String?
    private var lastEditorEmittedFingerprint: String?
    private var lastAppliedConfiguration: String?
    private var hydrateGeneration: UInt64 = 0
    private var bodyReadyGeneration: UInt64 = 0
    private var contentGeneration: UInt64 = 0
    /// Only auto-focus caret once per content generation (open edit), never while typing.
    private var focusedGeneration: UInt64 = 0
    /// Set on detach so the next attach always re-pushes host content (create must not
    /// keep the previous note body when the fingerprint skip would otherwise fire).
    private var needsForcePushOnBind = false

    private(set) var session: TipTapSession?
    private weak var hostContainer: UIView?

    private init(slot: Slot) {
        self.slot = slot
        let handler = EdgeEverResourceSchemeHandler()
        self.schemeHandler = handler
        let config = WKWebViewConfiguration()
        config.processPool = Self.processPool
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        // Scheme handler must be registered before first load.
        config.setURLSchemeHandler(handler, forURLScheme: EdgeEverResourceSchemeHandler.scheme)
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.isOpaque = false
        wv.backgroundColor = .clear
        wv.scrollView.backgroundColor = .clear
        wv.scrollView.clipsToBounds = true
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.delaysContentTouches = false
        // Editor HTML owns scrolling inside #editor so the format toolbar can stay pinned
        // at the top of the WebView. Outer bounce would reintroduce sticky/toolbar jumps.
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.bounces = false
        self.webView = wv
        super.init()
        wv.navigationDelegate = self
        let ucc = wv.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "edgeever")
        ucc.add(self, name: "edgeever")
        loadEditorBundle()
    }

    // MARK: - Warmup

    /// Ensure both runtimes exist and EditorBundle is loading (call after sign-in).
    static func warmIfNeeded() {
        _ = SharedTipTapRuntime.viewer
        _ = SharedTipTapRuntime.editor
        #if DEBUG
        NSLog("SharedTipTapRuntime: warm viewer+editor slots")
        #endif
    }

    // MARK: - Attach / bind

    func attach(to container: UIView) {
        let reparented = hostContainer !== container || webView.superview !== container
        if hostContainer === container, webView.superview === container {
            layoutWebView(in: container)
            return
        }
        hostContainer = container
        if webView.superview !== container {
            webView.removeFromSuperview()
            container.addSubview(webView)
        }
        layoutWebView(in: container)
        if slot == .editor {
            WKWebViewProgrammaticKeyboard.allowProgrammaticKeyboard(on: webView)
            // New host (create/edit sheet): allow focus+keyboard again even if content fingerprint matches.
            if reparented {
                focusedGeneration = 0
            }
        }
    }

    func detach(from container: UIView) {
        guard hostContainer === container else { return }
        // Keep the engine alive off-screen; only leave the hierarchy.
        webView.removeFromSuperview()
        hostContainer = nil
        // Next present of create/edit must re-raise the keyboard and re-push body.
        if slot == .editor {
            focusedGeneration = 0
            needsForcePushOnBind = true
            webView.resignFirstResponder()
        } else {
            needsForcePushOnBind = true
        }
        // Drop action callbacks for the dismantled SwiftUI host so late JS `change`
        // events cannot rewrite a later editor session with this session's body.
        if var s = session {
            s.onChange = nil
            s.onResourcePress = nil
            s.onImagePreview = nil
            s.onPickImage = nil
            s.onSearchResult = nil
            s.onBodyReady = nil
            session = s
        }
    }

    func bind(_ newSession: TipTapSession) {
        let previousMode = session?.mode
        let previousFingerprint = lastPushedJSON
        session = newSession
        let fp = contentDecision(newSession).fingerprint
        // Any fingerprint change OR a fresh host after detach is a new document open.
        let isNewDocument = fp != previousFingerprint
            || needsForcePushOnBind
            || (fp != lastEditorEmittedFingerprint && previousFingerprint == nil)
        if fp != previousFingerprint || needsForcePushOnBind {
            contentGeneration &+= 1
            hydrateGeneration &+= 1
            // Do not zero bodyReadyGeneration here — pushContent / skip path will notify.
        }
        let modeChanged = previousMode != nil && previousMode != newSession.mode
        let forcePush = modeChanged || needsForcePushOnBind
        needsForcePushOnBind = false
        applyMode()
        // Mode switch / re-open after detach must re-push even when fingerprints match
        // (empty create twice, or lastPushedJSON was stamped before a cancelled push).
        pushContentIfNeeded(force: forcePush)
        // Open-edit / re-open create: raise caret + keyboard once.
        // Also when fingerprint matches (empty create twice) — focusedGeneration was cleared on detach.
        if newSession.mode == .editor, isNewDocument || focusedGeneration == 0 {
            scheduleFocusEnd(for: contentGeneration)
        }
    }

    /// Focus document end + raise the software keyboard.
    ///
    /// iOS WKWebView will often draw a caret from JS `focus()` **without** opening the IME
    /// unless (1) the content view is first responder and (2) programmatic keyboard is allowed.
    /// Safe to call once when create/edit opens — not on every keystroke.
    func focusEnd() {
        guard session?.mode == .editor else { return }
        focusEnd(attempt: 0)
    }

    /// Select a match inside the current viewer/editor and return the total + active index.
    func search(_ query: String, index: Int) {
        guard ready else {
            session?.onSearchResult?(0, 0)
            return
        }
        let queryB64 = Data(query.utf8).base64EncodedString()
        let js = """
        (function(){
          try {
            if (!window.EdgeEverEditor || !window.EdgeEverEditor.search) return false;
            var bin = atob('\(queryB64)');
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            window.EdgeEverEditor.search(new TextDecoder('utf-8').decode(bytes), \(max(0, index)));
            return true;
          } catch (e) { return false; }
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Capture the current non-empty editor selection and keep its range in the JS runtime.
    func captureAiSelection() async -> AiEditorSelection? {
        guard ready, session?.mode == .editor else { return nil }
        let raw: Any? = await withCheckedContinuation { continuation in
            webView.evaluateJavaScript(
                "window.EdgeEverEditor && window.EdgeEverEditor.captureSelection ? window.EdgeEverEditor.captureSelection() : null"
            ) { value, _ in
                continuation.resume(returning: value)
            }
        }
        guard let json = raw as? String,
              let data = json.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(AiEditorSelection.self, from: data)
    }

    /// Insert after or replace the range captured by `captureAiSelection()`.
    func applyAiSelectionDraft(_ markdown: String, append: Bool) async -> Bool {
        guard ready, session?.mode == .editor, !markdown.isEmpty else { return false }
        let markdownB64 = Data(markdown.utf8).base64EncodedString()
        let modeValue = append ? "append" : "replace"
        let js = """
        (function(){
          try {
            if (!window.EdgeEverEditor || !window.EdgeEverEditor.applySelectionDraft) return false;
            var bin = atob('\(markdownB64)');
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            var markdown = new TextDecoder('utf-8').decode(bytes);
            return window.EdgeEverEditor.applySelectionDraft(markdown, '\(modeValue)') === true;
          } catch (e) { return false; }
        })();
        """
        return await withCheckedContinuation { continuation in
            webView.evaluateJavaScript(js) { value, _ in
                continuation.resume(returning: (value as? Bool) ?? false)
            }
        }
    }

    func undoAiSelectionDraft() async -> Bool {
        guard ready, session?.mode == .editor else { return false }
        return await withCheckedContinuation { continuation in
            webView.evaluateJavaScript(
                "window.EdgeEverEditor && window.EdgeEverEditor.undo ? window.EdgeEverEditor.undo() : false"
            ) { value, _ in
                continuation.resume(returning: (value as? Bool) ?? false)
            }
        }
    }

    private func focusEnd(attempt: Int) {
        guard session?.mode == .editor else { return }
        // fullScreenCover animation / re-parent: wait until we are in a window.
        if webView.window == nil {
            guard attempt < 12 else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.focusEnd(attempt: attempt + 1)
            }
            return
        }

        WKWebViewProgrammaticKeyboard.allowProgrammaticKeyboard(on: webView)
        _ = WKWebViewProgrammaticKeyboard.becomeFirstResponder(for: webView)

        webView.evaluateJavaScript(
            """
            (function(){
              try {
                if (window.EdgeEverEditor && window.EdgeEverEditor.focusEnd) {
                  window.EdgeEverEditor.focusEnd();
                } else {
                  var el = document.querySelector('.ProseMirror');
                  if (el && el.focus) el.focus({ preventScroll: true });
                }
                return true;
              } catch (e) { return false; }
            })();
            """
        ) { [weak self] _, _ in
            // Re-assert first responder after WebKit applies the DOM focus (keyboard handshake).
            DispatchQueue.main.async {
                guard let self, self.session?.mode == .editor else { return }
                _ = WKWebViewProgrammaticKeyboard.becomeFirstResponder(for: self.webView)
                // One more pass after the sheet finishes presenting (common 0.3–0.4s cover).
                if attempt == 0 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                        guard let self, self.session?.mode == .editor else { return }
                        _ = WKWebViewProgrammaticKeyboard.becomeFirstResponder(for: self.webView)
                        self.webView.evaluateJavaScript(
                            """
                            (function(){
                              try {
                                if (window.EdgeEverEditor && window.EdgeEverEditor.focusEnd) {
                                  window.EdgeEverEditor.focusEnd();
                                }
                              } catch (e) {}
                            })();
                            """,
                            completionHandler: nil
                        )
                    }
                }
            }
        }
    }

    /// Seed local blob + disk cache so a newly uploaded image can render without a network round-trip.
    func seedResource(id: String, data: Data, mimeType: String) async {
        await ResourceBlobStore.shared.put(id: id, data: data, mimeType: mimeType)
        _ = try? await resourceCache.dataURL(for: id, data: data, mimeType: mimeType)
    }

    /// Insert an image at the caret (protected API `src` for persistence), then hydrate display.
    /// Returns `false` if the editor session is not ready or JS insert failed.
    @discardableResult
    func insertImage(src: String, alt: String, displayData: Data? = nil, mimeType: String? = nil) async -> Bool {
        guard session?.mode == .editor else {
            NSLog("SharedTipTapRuntime insertImage skipped: mode=\(String(describing: session?.mode)) ready=\(ready)")
            return false
        }
        guard ready else {
            NSLog("SharedTipTapRuntime insertImage skipped: editor bundle not ready")
            return false
        }

        if let displayData, let mimeType, let resourceId = ResourceCache.resourceId(from: src) {
            await seedResource(id: resourceId, data: displayData, mimeType: mimeType)
        }

        let srcB64 = Data(src.utf8).base64EncodedString()
        let altB64 = Data(alt.utf8).base64EncodedString()
        let uploadId = "up-\(UUID().uuidString)"
        let idB64 = Data(uploadId.utf8).base64EncodedString()
        let js = """
        (function(){
          function dec(b64){
            var bin = atob(b64);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new TextDecoder('utf-8').decode(bytes);
          }
          try {
            if (!window.EdgeEverEditor || !window.EdgeEverEditor.completeImageUpload) return false;
            var id = dec('\(idB64)');
            var src = dec('\(srcB64)');
            var alt = dec('\(altB64)');
            // Stores protected path in TipTap JSON; native hydrate paints it under file://.
            window.EdgeEverEditor.completeImageUpload(id, src, alt);
            return true;
          } catch (e) {
            try { window.webkit.messageHandlers.edgeever.postMessage({type:'error', message: String(e)}); } catch (_) {}
            return false;
          }
        })();
        """
        let ok: Bool = await withCheckedContinuation { cont in
            webView.evaluateJavaScript(js) { result, error in
                if let error { NSLog("SharedTipTapRuntime insertImage error: \(error)") }
                else { NSLog("SharedTipTapRuntime insertImage ok result=\(String(describing: result))") }
                cont.resume(returning: (result as? Bool) ?? (error == nil))
            }
        }
        guard ok else { return false }
        await nativeHydrateDOMImages(generation: contentGeneration)
        return true
    }

    /// Read current editor markdown + JSON after a mutation (avoids racing the async bridge onChange).
    func snapshotContent() async -> (markdown: String, json: String)? {
        guard ready else { return nil }
        let js = """
        (function(){
          try {
            if (!window.EdgeEverEditor) return null;
            var md = '';
            var json = '';
            try { md = window.EdgeEverEditor.getMarkdown() || ''; } catch (e) {}
            try { json = window.EdgeEverEditor.getDocument() || ''; } catch (e) {}
            return JSON.stringify({ md: md, json: json });
          } catch (e) { return null; }
        })();
        """
        let raw: Any? = await withCheckedContinuation { cont in
            webView.evaluateJavaScript(js) { value, _ in
                cont.resume(returning: value)
            }
        }
        guard let text = raw as? String,
              let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let md = obj["md"] as? String ?? ""
        let json = obj["json"] as? String ?? ""
        guard !json.isEmpty || !md.isEmpty else { return nil }
        return (md, json)
    }

    func exportNoteImage(request: [String: Any]) {
        guard ready,
              JSONSerialization.isValidJSONObject(request),
              let data = try? JSONSerialization.data(withJSONObject: request),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let requestId = request["requestId"] as? String ?? ""
        let requestIdLiteral = String(data: (try? JSONSerialization.data(withJSONObject: requestId, options: .fragmentsAllowed)) ?? Data("\"\"".utf8), encoding: .utf8) ?? "\"\""
        let js = """
        (function(){
          try {
            if (!window.EdgeEverEditor || !window.EdgeEverEditor.exportImage) return false;
            window.EdgeEverEditor.exportImage(\(json));
            return true;
          } catch (e) {
            try { window.webkit.messageHandlers.edgeever.postMessage({type:'imageExportError', requestId:\(requestIdLiteral), message:String(e)}); } catch (_) {}
            return false;
          }
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func scheduleFocusEnd(for generation: UInt64) {
        guard focusedGeneration != generation else { return }
        focusedGeneration = generation
        // Delay past SwiftUI fullScreenCover layout; focusEnd itself retries if window is nil.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.20) { [weak self] in
            guard let self else { return }
            // Generation may stay the same for empty create→create; focusedGeneration was reset on detach.
            guard self.focusedGeneration == generation || self.focusedGeneration == 0 else { return }
            self.focusedGeneration = generation
            self.focusEnd()
        }
    }

    private func layoutWebView(in container: UIView) {
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.deactivate(webView.constraints)
        // Fill container via frame autoresizing for simplicity under SwiftUI hosting.
        webView.translatesAutoresizingMaskIntoConstraints = true
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.frame = container.bounds
    }

    // MARK: - Bundle load

    private func loadEditorBundle() {
        if let bundleURL = TipTapResourceLoader.packagedEditorHTMLURL() {
            let dir = bundleURL.deletingLastPathComponent()
            #if DEBUG
            NSLog("SharedTipTapRuntime[\(slot.rawValue)]: load EditorBundle size=%d", (try? Data(contentsOf: bundleURL))?.count ?? -1)
            #endif
            webView.loadFileURL(bundleURL, allowingReadAccessTo: dir)
        } else {
            #if DEBUG
            NSLog("SharedTipTapRuntime[\(slot.rawValue)]: EditorBundle missing — fallback HTML")
            #endif
            webView.loadHTMLString(TipTapResourceLoader.fallbackHTML, baseURL: Bundle.main.bundleURL)
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        lastAppliedConfiguration = nil
        applyMode()
        pushContentIfNeeded(force: true)
    }

    // MARK: - Content

    private func applyMode() {
        guard ready, let session else { return }
        let mode = session.mode.rawValue
        let locale = session.locale == "en-US" ? "en-US" : "zh-CN"
        let theme = session.theme == "dark" ? "dark" : "light"
        let configuration = "\(mode)|\(locale)|\(theme)|\(session.placeholder)"
        if lastAppliedConfiguration == configuration { return }
        lastAppliedConfiguration = configuration
        let options: [String: String] = [
            "mode": mode,
            "locale": locale,
            "theme": theme,
            "placeholder": session.placeholder,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: options),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let js = """
        (function(){
          if (!window.EdgeEverEditor) return;
          window.EdgeEverEditor.configure(\(json));
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func contentDecision(_ session: TipTapSession) -> TipTapContentSource.Decision {
        TipTapContentSource.resolve(
            mode: session.mode,
            documentJSON: session.documentJSON,
            markdown: session.markdown
        )
    }

    func pushContentIfNeeded(force: Bool = false) {
        guard ready, let session else { return }
        let decision = contentDecision(session)
        let fingerprint = decision.fingerprint
        let useJSON = decision.useJSON
        let gen = contentGeneration

        // Already showing this document (including editor-originated typing updates).
        // Notify ready only — never refocus caret (that jumps to end while typing).
        if !force {
            if fingerprint == lastPushedJSON || fingerprint == lastEditorEmittedFingerprint {
                notifyBodyReady(generation: gen)
                return
            }
        }

        let shouldFocusAfterPush = session.mode == .editor && focusedGeneration != gen

        applyMode()

        let fn = useJSON ? "setDocumentFromJSON" : "setMarkdown"
        let payload = decision.payload
        let js = TipTapResourceLoader.jsCall(fn: fn, arg: payload)
        // Capture callback now — detach may nil session callbacks before the JS completion runs.
        let bodyReadyCb = session.onBodyReady
        webView.evaluateJavaScript(js) { [weak self] _, error in
            #if DEBUG
            if let error { NSLog("SharedTipTapRuntime pushContent error: \(error)") }
            #endif
            guard let self else { return }
            Task { @MainActor in
                // Only stamp fingerprints after a successful push for this generation.
                // Stamping before JS completed caused empty-create to skip a later force
                // while the WebView still held the previous note body.
                guard self.contentGeneration == gen else { return }
                self.lastPushedJSON = fingerprint
                self.lastEditorEmittedFingerprint = fingerprint
                self.notifyBodyReady(generation: gen, callback: bodyReadyCb)
                if shouldFocusAfterPush {
                    self.scheduleFocusEnd(for: gen)
                }
                await self.nativeHydrateDOMImages(generation: gen)
            }
        }
    }

    private func notifyBodyReady(generation: UInt64, callback: (() -> Void)? = nil) {
        let cb = callback ?? session?.onBodyReady
        // Always invoke the *current* host callback when re-binding the same content,
        // even if we already marked this generation ready (new SwiftUI view needs it).
        bodyReadyGeneration = generation
        DispatchQueue.main.async { cb?() }
    }

    // MARK: - Image hydrate

    private func nativeHydrateDOMImages(generation: UInt64) async {
        guard contentGeneration == generation else { return }
        let listJS = """
        (function(){
          return Array.from(document.querySelectorAll('img[src]')).map(function(img){
            return img.dataset.originalSrc || img.getAttribute('src') || '';
          });
        })();
        """
        let raw: Any? = await withCheckedContinuation { cont in
            webView.evaluateJavaScript(listJS) { value, _ in
                cont.resume(returning: value)
            }
        }
        guard contentGeneration == generation else { return }
        let srcs = (raw as? [Any])?.compactMap { $0 as? String } ?? []
        let unique = Array(Set(srcs.filter { !$0.isEmpty }))
        let base = session?.baseURL
        let token = session?.token
        for source in unique {
            guard contentGeneration == generation else { return }
            if source.hasPrefix("data:") || source.hasPrefix("edgeever-res:") || source.hasPrefix("blob:") {
                continue
            }
            guard let display = await TipTapResourceLoader.loadResourceDataURL(
                source: source,
                baseURL: base,
                token: token,
                resourceCache: resourceCache
            ) else { continue }
            guard contentGeneration == generation else { return }
            let srcB64 = Data(source.utf8).base64EncodedString()
            let urlB64 = Data(display.utf8).base64EncodedString()
            let setJS = """
            (function(){
              function dec(b64){
                var bin = atob(b64);
                var bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return new TextDecoder('utf-8').decode(bytes);
              }
              var src = dec('\(srcB64)');
              var url = dec('\(urlB64)');
              document.querySelectorAll('img').forEach(function(img){
                var cur = img.getAttribute('src') || '';
                var orig = img.dataset.originalSrc || '';
                if (cur === src || orig === src) {
                  if (!img.dataset.originalSrc && src.indexOf('data:') !== 0) img.dataset.originalSrc = src;
                  img.setAttribute('src', url);
                  var wAttr = img.getAttribute('width') || img.getAttribute('data-width');
                  if (wAttr && String(wAttr).match(/^\\d+(\\.\\d+)?$/)) {
                    img.removeAttribute('width');
                    img.style.width = wAttr + '%';
                  }
                  img.style.maxWidth = '100%';
                  img.style.height = 'auto';
                  img.style.display = 'block';
                  img.style.margin = '12px 0';
                }
              });
            })();
            """
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                webView.evaluateJavaScript(setJS) { _, _ in cont.resume() }
            }
        }
    }

    // MARK: - JS bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "edgeever",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String
        else { return }

        switch type {
        case "ready":
            ready = true
            lastAppliedConfiguration = nil
            pushContentIfNeeded(force: true)
        case "change":
            // Host dismantled (create/edit dismissed) — drop late events so they cannot
            // resurrect the previous body in a later editor session.
            guard let session, session.onChange != nil else { return }
            let md = body["contentMarkdown"] as? String ?? ""
            let json = body["contentJson"] as? String ?? session.documentJSON
            let emptyStub = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}"
            let j = json.trimmingCharacters(in: .whitespacesAndNewlines)
            let emitted = (!j.isEmpty && j != emptyStub) ? "json:\(j)" : "md:\(md)"
            lastEditorEmittedFingerprint = emitted
            lastPushedJSON = emitted
            session.onChange?(md, json)
        case "loadResource":
            let requestId = body["requestId"] as? String ?? ""
            let source = body["source"] as? String ?? ""
            let gen = contentGeneration
            Task { await resolveResource(requestId: requestId, source: source, generation: gen) }
        case "resourcePress":
            if let targetJson = body["targetJson"] as? String,
               let target = ResourceTarget.parse(targetJson)
            {
                let cb = session?.onResourcePress
                DispatchQueue.main.async { cb?(target) }
            }
        case "imagePreview":
            let source = body["source"] as? String ?? ""
            let alt = body["alt"] as? String ?? ""
            guard !source.isEmpty else { break }
            let cb = session?.onImagePreview
            DispatchQueue.main.async { cb?(source, alt) }
        case "pickImage":
            let cb = session?.onPickImage
            DispatchQueue.main.async { cb?() }
        case "searchResult":
            let count = (body["count"] as? NSNumber)?.intValue ?? 0
            let index = (body["index"] as? NSNumber)?.intValue ?? 0
            let cb = session?.onSearchResult
            DispatchQueue.main.async { cb?(count, index) }
        case "imageExportChunk", "imageExportComplete", "imageExportError":
            let cb = session?.onImageExportEvent
            DispatchQueue.main.async { cb?(body) }
        default:
            break
        }
    }

    private func resolveResource(requestId: String, source: String, generation: UInt64) async {
        guard contentGeneration == generation else { return }
        let token = session?.token
        let base = session?.baseURL
        let displayURL = await TipTapResourceLoader.loadResourceDataURL(
            source: source,
            baseURL: base,
            token: token,
            resourceCache: resourceCache
        )
        guard contentGeneration == generation else { return }
        let reqEscaped = requestId
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        let urlLiteral: String
        if let displayURL {
            let escaped = displayURL
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            urlLiteral = "'\(escaped)'"
        } else {
            urlLiteral = "null"
        }
        let js = """
        (function(){
          try {
            if (window.EdgeEverEditor) {
              window.EdgeEverEditor.resolveResource('\(reqEscaped)', \(urlLiteral));
            }
          } catch (e) {}
        })();
        """
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            webView.evaluateJavaScript(js) { _, _ in cont.resume() }
        }
    }
}

// Keep TipTapWarmPool name as a thin alias so existing call sites compile.
enum TipTapWarmPool {
    static var processPool: WKProcessPool { SharedTipTapRuntime.processPool }

    @MainActor
    static func warmIfNeeded() {
        SharedTipTapRuntime.warmIfNeeded()
    }
}

/// Host UIView that only owns layout; the shared WKWebView is re-parented into it.
final class TipTapHostView: UIView {
    var onLayout: ((CGRect) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?(bounds)
        for sub in subviews {
            sub.frame = bounds
        }
    }
}
